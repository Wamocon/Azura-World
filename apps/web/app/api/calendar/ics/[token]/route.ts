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
 * - **404, never 403.** A wrong token must be indistinguishable from a token
 *   that does not exist, or the endpoint confirms which tokens are real.
 * - **Read-only, one purpose.** The feed carries activity times and titles. A
 *   leaked calendar URL — and they leak, into shared calendars and phone
 *   backups — costs only the calendar.
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
  return createHmac("sha256", secret).update("calendar-feed:activities").digest("hex")
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
  handler: async ({ params }) => {
    const supplied = params.token ?? ""
    const secret = serverEnv.CALENDAR_FEED_TOKEN_SECRET

    // No configured secret means no feed. Failing closed matters more here than
    // anywhere else in this API, because there is nothing behind it.
    if (secret === undefined || secret.length === 0 || supplied.length === 0) {
      throw new RepositoryError(notFound("No calendar feed is available."))
    }
    if (!tokenMatches(supplied, expectedFeedToken(secret))) {
      throw new RepositoryError(notFound("No calendar feed is available."))
    }

    // The feed is a fixed, manager-scoped view of site activities. The token
    // grants exactly this and carries no identity, so there is no caller role to
    // widen or narrow it with.
    const result = await getActivities({ role: "manager", limit: 200 })

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
    headers: { "Content-Disposition": 'attachment; filename="azura-activities.ics"' },
  }),
})
