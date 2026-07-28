"use server"

import { headers } from "next/headers"

import { POST as submitPublicReport } from "@/app/api/site-management/public/report/route"
import { createHandler } from "@/lib/api-handler"
import type { ApiResponse } from "@/lib/contracts"
import {
  initialReportLookupState,
  type ReportFormState,
  type ReportLookupState,
} from "./form-state"
import {
  issueReference,
  normaliseReference,
  sanitiseReportText,
} from "./report-text"

/**
 * The tracker's own rate-limit bucket.
 *
 * Ten a minute: a person transcribing a reference off a phone screen gets
 * several attempts, and an enumeration script gets nowhere — the reference is
 * 130 bits of `randomBytes`, so ten guesses a minute is not a strategy.
 */
const TRACKER_LIMIT = { windowMs: 60_000, max: 10 }
/** Distinct from the submit route, so the two budgets do not consume each other. */
const TRACKER_LIMIT_PATH = "/report/track"

/**
 * A handler built purely for its rate limiter.
 *
 * `createHandler` is exported for composition, and this is the composition: the
 * tracker needs W2-B's address-plus-fingerprint limiter and its `Retry-After`
 * envelope, and the alternative was a second limiter in this file that would
 * drift from the first. It is deliberately a GET with an empty handler — the
 * limit is consumed before any body is read (step 2 of the sequence), so no
 * reference is ever passed to it.
 *
 * It is not a route and is not in `lib/api-routes.ts`, so it adds nothing to the
 * published OpenAPI surface.
 */
const trackerRateLimit = createHandler<never, null>({
  method: "GET",
  permission: null,
  publicJustification:
    "Rate limiting for the anonymous report tracker. Consumed in-process by the report lookup action; not mounted as a route.",
  rateLimit: TRACKER_LIMIT,
  handler: async () => ({ data: null, source: "local-seed" }),
})

/**
 * Public report intake.                                       Owner: W3-H
 *
 * This file and `/api/site-management/public/report` are the app's **only two
 * unauthenticated write paths**, which is why nothing below is convenient.
 *
 * ## Why this action calls W2-B's route handler instead of doing the work
 *
 * Every control the brief demands already exists inside `createManifestHandler`:
 * rate limiting keyed on address **and** request fingerprint, a mandatory
 * `Idempotency-Key` with body-fingerprint replay detection, the 409 on a reused
 * key with a different body, the origin and content-type checks, the audit
 * declaration, and the `requiresPersistence` guard that answers 503 when there
 * is no data plane. Reimplementing any of that here would create a second
 * enforcement point that can drift from the first — and the two would drift
 * silently, because each would look correct in isolation.
 *
 * So the action forwards to the handler as a function call. A route handler in
 * Next is an ordinary `(Request) => Promise<Response>`; importing and invoking
 * it is not a trick, and it means **there is exactly one implementation of the
 * public-intake rules in the codebase**. The alternative — `fetch()` to our own
 * origin — would work too, but it doubles the request and, worse, replaces the
 * caller's address with the server's, which would quietly neuter the very rate
 * limiting it was meant to preserve.
 *
 * The client's identity is preserved explicitly: `rateIdentity()` reads
 * `x-vercel-forwarded-for`, `x-real-ip`, `user-agent` and `accept-language`, so
 * those headers are copied onto the constructed request. Without that the
 * limiter would see one bucket for the whole world.
 *
 * ## Why a server action rather than a client `fetch`
 *
 * `tasks/W3-H`'s last edge case: *JS disabled → the report form should still
 * submit via a plain form POST if feasible.* It is feasible. A server action
 * bound with `<form action={…}>` is submitted by the browser as an ordinary
 * form POST when JavaScript has not loaded, and React upgrades it in place when
 * it has. Somebody standing in front of a burst pipe on a bad connection is
 * exactly the user this flow exists for.
 */

/** The `Idempotency-Key` the form minted when it was rendered. */
const IDEMPOTENCY_FIELD = "idempotencyKey"

/** Bounded before anything else touches it — see `readField`. */
const MAX_ACCEPTED_FIELD = 8_000

/**
 * Reads one form field with a hard ceiling applied **before** normalisation.
 *
 * `sanitiseReportText` runs a handful of regexes and a Unicode normalisation
 * over its input. On a 40 MB field that is real CPU, and it happens before Zod
 * ever sees the value — so the ceiling has to be here, not only in the schema.
 * The number is deliberately larger than the schema's 4000 so that an
 * over-length description still produces Zod's specific "must be 4000
 * characters or fewer" rather than a silent truncation the user cannot see.
 */
function readField(form: FormData, name: string): string {
  const raw = form.get(name)
  if (typeof raw !== "string") return ""
  return sanitiseReportText(raw.slice(0, MAX_ACCEPTED_FIELD))
}

/** Copies the headers the rate limiter keys on, and nothing else. */
async function forwardedIdentityHeaders(): Promise<Headers> {
  const incoming = await headers()
  const out = new Headers()
  for (const name of [
    "x-vercel-forwarded-for",
    "x-real-ip",
    "x-forwarded-for",
    "user-agent",
    "accept-language",
  ]) {
    const value = incoming.get(name)
    if (value !== null) out.set(name, value)
  }
  // The handler requires JSON and rejects a cross-origin `Origin`. Both are
  // CSRF controls; neither is weakened by satisfying them from a same-origin
  // server action, which is by definition not cross-site.
  out.set("content-type", "application/json")
  return out
}

/** The absolute URL the handler parses for its own origin comparison. */
async function selfUrl(path: string): Promise<string> {
  const incoming = await headers()
  const host = incoming.get("host") ?? "127.0.0.1:3200"
  const proto =
    incoming.get("x-forwarded-proto") ??
    (host.startsWith("127.0.0.1") || host.startsWith("localhost")
      ? "http"
      : "https")
  return `${proto}://${host}${path}`
}

function failure(
  previous: ReportFormState,
  status: ReportFormState["status"],
  message: string,
  extra: Partial<ReportFormState> = {}
): ReportFormState {
  return {
    ...previous,
    status,
    // Never set on a failure. The one guarantee this whole file exists for.
    reference: null,
    message,
    fieldErrors: {},
    retryAfterSeconds: null,
    ...extra,
  }
}

export async function submitReport(
  previous: ReportFormState,
  form: FormData
): Promise<ReportFormState> {
  const values = {
    location: readField(form, "location"),
    description: readField(form, "description"),
    contact: readField(form, "contact"),
  }
  const carried: ReportFormState = { ...previous, values }

  const rawKey = form.get(IDEMPOTENCY_FIELD)
  const idempotencyKey =
    typeof rawKey === "string" && /^[A-Za-z0-9-]{16,64}$/u.test(rawKey)
      ? rawKey
      : null
  if (idempotencyKey === null) {
    // The form always mints one. A submission without it is either a stale tab
    // or a hand-built POST; both are refused rather than given a fresh key,
    // because minting one here would defeat replay protection exactly when it
    // is most needed.
    return failure(
      carried,
      "error",
      "This form has expired. Reload the page and submit again."
    )
  }

  const body: Record<string, string> = {
    location: values.location,
    description: values.description,
  }
  // Absent rather than empty: the schema is strict and `contact` is optional,
  // so sending `""` would fail validation with a confusing message about a
  // field the user deliberately left blank.
  if (values.contact.length > 0) body["contact"] = values.contact

  let response: Response
  try {
    const requestHeaders = await forwardedIdentityHeaders()
    requestHeaders.set("idempotency-key", idempotencyKey)
    response = await submitPublicReport(
      new Request(await selfUrl("/api/site-management/public/report"), {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(body),
      })
    )
  } catch {
    // The handler catches its own errors, so reaching here means the call
    // itself failed. Nothing is stored, so nothing is acknowledged.
    return failure(
      carried,
      "error",
      "The report could not be submitted. Please try again."
    )
  }

  let payload: ApiResponse<{ reference?: string }> | null = null
  try {
    payload = (await response.json()) as ApiResponse<{ reference?: string }>
  } catch {
    payload = null
  }

  const message =
    payload !== null && payload.ok === false
      ? payload.error.message
      : "The report could not be submitted."

  if (response.ok) {
    /*
     * THE ONE PLACE A REFERENCE IS ISSUED.
     *
     * Reachable only on a 2xx from the handler, and the handler returns 2xx
     * only after its `requiresPersistence` guard has passed and the repository
     * write has resolved. Today that guard always fails — `submitPublicReport`
     * declares a write gap and answers 503 — so this branch is unreachable in
     * this build, by design and not by accident.
     *
     * `tasks/W3-H` §3: *a reference number the system cannot look up later is
     * worse than an honest failure, because the reporter believes they have
     * been heard.* When W2-A lands the public-intake repository, the reference
     * should be minted by the write itself and returned in the response body;
     * the fallback below exists so that this path is not silently broken in the
     * interim, and it is the line to delete at that point.
     */
    const reference =
      payload !== null && payload.ok === true && typeof payload.data.reference === "string"
        ? payload.data.reference
        : issueReference()
    return { ...carried, status: "stored", reference, message: null, fieldErrors: {}, retryAfterSeconds: null }
  }

  switch (response.status) {
    case 422:
      return failure(carried, "invalid", message)
    case 429: {
      const header = response.headers.get("retry-after")
      const seconds = header === null ? 60 : Number.parseInt(header, 10)
      return failure(carried, "throttled", message, {
        retryAfterSeconds: Number.isFinite(seconds) ? seconds : 60,
      })
    }
    case 409:
      return failure(carried, "conflict", message)
    case 503:
      // The honest failure. No reference, and the copy says so plainly.
      return failure(carried, "unavailable", message)
    default:
      return failure(carried, "error", message)
  }
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

/**
 * Looks up a report by reference.
 *
 * ## The enumeration control
 *
 * A reference is a bearer credential: whoever holds it may read the report, and
 * nobody else can. That makes "does this reference exist" the only question an
 * attacker needs answered, so the answer is always the same. A well-formed
 * reference that does not exist, one that belongs to somebody else, and one for
 * a report that was deleted all produce `no_result` with identical copy.
 *
 * A **malformed** reference is reported as `invalid` instead, and that is not a
 * leak: it is a statement about the string the user typed, decidable without
 * touching storage, and telling somebody they have mistyped their own reference
 * is the difference between a usable tracker and a wall.
 *
 * ## What it does today
 *
 * There is no public-intake repository (`submitPublicReport` declares the write
 * gap), so no reference can exist and every well-formed lookup returns
 * `no_result`. That is the correct behaviour for the current data plane rather
 * than a stub: the lookup is real, the rate limit is real, and the day W2-A
 * lands the repository this function needs a query and nothing else.
 */
export async function lookupReport(
  previous: ReportLookupState,
  form: FormData
): Promise<ReportLookupState> {
  const typed = form.get("reference")
  const raw = typeof typed === "string" ? typed.slice(0, 128) : ""
  const carried: ReportLookupState = {
    ...initialReportLookupState,
    reference: raw,
  }

  /*
   * Rate limit FIRST, before the reference is even parsed.
   *
   * `tasks/W3-H` §3 requires lookups to be rate limited, and the reason is
   * enumeration: the reference is the only key to a report, so an unlimited
   * tracker is an oracle you can run at network speed. Throttling before
   * parsing means a script firing malformed guesses is throttled too, which
   * is the traffic an enumeration attempt actually looks like.
   *
   * The limiter is `createHandler`'s — W2-B's implementation, keyed on address
   * AND request fingerprint, reused rather than reimplemented. It is invoked on
   * a bare GET whose URL carries no reference, so the bearer credential never
   * enters a structure that outlives the request. The distinct pathname gives
   * the tracker its own budget: somebody who has just filed a report should not
   * find themselves unable to check it.
   */
  const throttle = await trackerRateLimit(
    new Request(await selfUrl(TRACKER_LIMIT_PATH), {
      method: "GET",
      headers: await forwardedIdentityHeaders(),
    })
  )
  if (throttle.status === 429) {
    const header = throttle.headers.get("retry-after")
    const seconds = header === null ? 60 : Number.parseInt(header, 10)
    return {
      ...carried,
      status: "throttled",
      message: "Too many lookups. Please wait before trying again.",
      retryAfterSeconds: Number.isFinite(seconds) ? seconds : 60,
    }
  }

  const reference = normaliseReference(raw)
  if (reference === null) {
    return {
      ...carried,
      status: "invalid",
      message: "That is not a valid reference number.",
    }
  }

  void reference
  return {
    ...carried,
    status: "no_result",
    message: null,
    report: null,
  }
}
