import { createHash, createHmac, timingSafeEqual } from "node:crypto"

import { createManifestHandler } from "@/lib/api-handler"
import { notFound } from "@/lib/api-errors"
import { getActivities } from "@/lib/operations-repository"
import { RepositoryError } from "@/lib/repository-base"
import { serverEnv } from "@/lib/env"

export const dynamic = "force-dynamic"

/**
 * An iCalendar feed, reached by an opaque token instead of a session.
 *
 * Calendar clients cannot carry a cookie, so the token IS the credential. That
 * makes three things mandatory:
 *
 * - **Constant-time comparison.** A token checked with `===` leaks its prefix
 *   through response timing, one character at a time. Both sides are hashed
 *   first so the comparison is over fixed-length buffers — `timingSafeEqual`
 *   throws on a length mismatch, which would itself be a length oracle.
 * - **404, never 403 — for the whole request, not just the token check.** A
 *   wrong token must be indistinguishable from a token that does not exist, or
 *   the endpoint confirms which tokens are real. The token comparison always
 *   said 404; what leaked was everything *after* it. `getActivities` runs with
 *   no session, `withRepository` deliberately throws rather than falling back
 *   when Supabase is configured and refuses the read (CONVENTIONS §2), and
 *   `RepositoryError(forbidden)` reaches the caller as **403**. So a correct
 *   token answered 403 and every wrong one answered 404: a free, unlimited
 *   oracle for confirming a guessed token, and the more useful half of the
 *   attack, since the attacker learns the token is right even while the feed
 *   itself is failing. `feedUnavailable()` below closes that.
 * - **Read-only, one purpose.** The feed carries activity times and titles. A
 *   leaked calendar URL — and they leak, into shared calendars and phone
 *   backups — costs only the calendar.
 *
 * ## Revocation
 *
 * There is one token for the whole deployment and it is not individually
 * revocable. It is derived from `CALENDAR_FEED_TOKEN_SECRET` (see
 * `expectedFeedToken`), so rotating that secret revokes it — and every other
 * subscription with it, which is the entire granularity available.
 *
 * Per-subscriber tokens are not reachable from this file. Deriving one is easy
 * (`HMAC(secret, label + profileId)`), but the route must then map a presented
 * token back to a profile with no session to look it up by, and revoking a
 * single subscriber needs somewhere to record that it was revoked. Both need a
 * table this schema does not have, and the second needs it irreducibly — a
 * derived token is valid for exactly as long as the secret is, by construction.
 * Recorded rather than half-built: a per-user token that cannot be revoked is
 * strictly worse than one shared token, because it multiplies the number of
 * credentials in circulation without adding the property it was built for.
 */
function tokenMatches(supplied: string, expected: string): boolean {
  const a = createHash("sha256").update(supplied).digest()
  const b = createHash("sha256").update(expected).digest()
  return timingSafeEqual(a, b)
}

/**
 * The feed token is **derived** from `CALENDAR_FEED_TOKEN_SECRET`, not equal to
 * it.
 *
 * The environment variable is named `…_SECRET` because that is what it is, and
 * putting a secret directly into a URL would publish it — into browser history,
 * into the calendar client's stored subscription, into any log that records
 * request paths. An HMAC of a fixed label gives a stable, opaque token that can
 * be rotated by changing the secret, and that reveals nothing about it.
 */
function expectedFeedToken(secret: string): string {
  return createHmac("sha256", secret)
    .update("calendar-feed:activities")
    .digest("hex")
}

/**
 * The one failure this endpoint is allowed to express.
 *
 * Every reachable failure — no secret configured, an empty token, a wrong
 * token, a repository that refused the read — must produce this exact
 * `ApiError`, so the response is byte-identical apart from `requestId`. A
 * second message, or a second code, is a second bit of information about which
 * branch ran, and the branches are exactly what must stay hidden.
 */
function feedUnavailable(): RepositoryError {
  return new RepositoryError(notFound("No calendar feed is available."))
}

/** Escapes the characters RFC 5545 §3.3.11 gives meaning to. */
function icsEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n")
}

function icsInstant(value: string): string | null {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  const [datePart] = parsed.toISOString().replace(/[-:]/g, "").split(".")
  return datePart === undefined ? null : `${datePart}Z`
}

export const GET = createManifestHandler("getCalendarFeed", {
  handler: async ({ params, requestId }) => {
    const supplied = params.token ?? ""
    const secret = serverEnv.CALENDAR_FEED_TOKEN_SECRET

    // No configured secret means no feed. Failing closed matters more here than
    // anywhere else in this API, because there is nothing behind it.
    if (secret === undefined || secret.length === 0 || supplied.length === 0) {
      throw feedUnavailable()
    }
    if (!tokenMatches(supplied, expectedFeedToken(secret))) {
      throw feedUnavailable()
    }

    // The feed is a fixed, manager-scoped view of site activities. The token
    // grants exactly this and carries no identity, so there is no caller role to
    // widen or narrow it with.
    //
    // Past this line the token is known good, and that is precisely why the
    // failure has to be laundered. `getActivities` runs unauthenticated: with
    // Supabase configured, RLS refuses the read and `withRepository` throws
    // `forbidden` rather than quietly serving seed data. Letting that reach the
    // caller answers 403 to a right token and 404 to a wrong one.
    //
    // The cause is not swallowed — it is logged here, under the same
    // `requestId` the caller was handed, because a feed that cannot read its
    // own data is an outage and must stay diagnosable. What the *caller* gets
    // is the one answer this endpoint ever gives. This is not a fake success:
    // no feed is served and none is claimed (SYSTEM-PROMPT honesty rule).
    let result
    try {
      result = await getActivities({ role: "manager", limit: 200 })
    } catch (cause) {
      console.error(
        "azura.calendar.feed-read-failed",
        JSON.stringify({
          requestId,
          // The token is a credential. Never logged, not even truncated.
          detail:
            cause instanceof Error ? cause.message.slice(0, 400) : "unknown",
          code: cause instanceof RepositoryError ? cause.apiError.code : null,
        })
      )
      throw feedUnavailable()
    }

    const lines: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Azura World CATI//Activities//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
    ]
    for (const activity of result.data) {
      const start = icsInstant(activity.startsAt)
      if (start === null) continue
      const end = activity.endsAt === null ? null : icsInstant(activity.endsAt)
      lines.push(
        "BEGIN:VEVENT",
        `UID:${icsEscape(activity.id)}@azura-world.cati`,
        `DTSTAMP:${start}`,
        `DTSTART:${start}`,
        ...(end === null ? [] : [`DTEND:${end}`]),
        `SUMMARY:${icsEscape(activity.title)}`,
        "END:VEVENT"
      )
    }
    lines.push("END:VCALENDAR")

    return { data: lines, source: result.source }
  },
  // RFC 5545 requires CRLF line endings. A feed joined with "\n" is accepted by
  // some clients and silently ignored by others, which is the worst of both.
  serialize: (lines) => ({
    body: `${lines.join("\r\n")}\r\n`,
    contentType: "text/calendar; charset=utf-8",
    headers: {
      "Content-Disposition": 'attachment; filename="azura-activities.ics"',
    },
  }),
})
