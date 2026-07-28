import { apiErrorStatus, type ApiError, type ApiResponse } from "./contracts"

/**
 * The HTTP boundary's error vocabulary.                     Owner: W2-B
 *
 * CONTRACTS §5 freezes eight error codes and their status mapping. This module
 * is the only place that turns anything else — a thrown repository error, a Zod
 * failure, an unexpected exception — into one of them.
 *
 * ## Never 500 for a handled condition
 *
 * W4-C treats any reachable 500 as a High finding, and the reason is not
 * tidiness: an unhandled throw in Next renders a framework error page whose
 * body can carry a stack frame, a file path, or a Postgres message. Every one
 * of those tells an attacker something about the inside. So every route runs
 * inside a catch that ends here, and a 500 in this app means a genuine bug in
 * code that was supposed to be total.
 *
 * ## The message is display copy, never diagnostics
 *
 * `ApiError.message` is rendered to a user. `scrubInternals()` is the last line
 * of defence over anything that reached it from a lower layer — W2-B's DoD test
 * 8 greps every captured response for `postgres`, `PGRST` and stack frames, and
 * this is what makes that grep come back empty. The detail is not discarded: it
 * goes to the server log with the same `requestId` the caller was given, so a
 * support conversation can still join the two ends.
 */

/** Patterns that must never reach a response body. */
const INTERNAL_MARKERS: readonly RegExp[] = [
  /\bpostgres\b/i,
  /\bpgrst\d*/i,
  /\bsupabase\b/i,
  /\bsqlstate\b/i,
  /\brelation\s+"/i,
  /\bcolumn\s+"/i,
  /\bat\s+\S+\s+\(.*:\d+:\d+\)/, // a stack frame
  /\b[a-z]:\\/i, // a Windows path
  /\/(?:home|var|usr|app)\//, // a POSIX path
  /\bnode_modules\b/,
]

/** Replaces a message that leaks internals with a safe, generic one. */
export function scrubInternals(message: string, fallback: string): string {
  if (message.length === 0 || message.length > 300) return fallback
  return INTERNAL_MARKERS.some((pattern) => pattern.test(message))
    ? fallback
    : message
}

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

export function unauthorized(message = "Sign in to continue."): ApiError {
  return { code: "unauthorized", message, retryable: false }
}

/**
 * Deliberately says nothing about whether the resource exists.
 *
 * "You do not have access to this" and "this does not exist" must be
 * indistinguishable, or the 403 becomes an existence oracle — a way to
 * enumerate unit ids or user ids by watching which ones answer differently.
 */
export function forbidden(
  message = "You do not have access to this."
): ApiError {
  return { code: "forbidden", message, retryable: false }
}

export function notFound(message = "Not found."): ApiError {
  return { code: "not_found", message, retryable: false }
}

export function validationFailed(
  message: string,
  details?: Record<string, string>
): ApiError {
  return {
    code: "validation_failed",
    message,
    retryable: false,
    ...(details === undefined ? {} : { details }),
  }
}

export function rateLimited(retryAfterSeconds: number): ApiError {
  return {
    code: "rate_limited",
    message: `Too many requests. Try again in ${retryAfterSeconds} seconds.`,
    retryable: true,
    details: { retryAfter: String(retryAfterSeconds) },
  }
}

export function conflict(
  message: string,
  details?: Record<string, string>
): ApiError {
  return {
    code: "conflict",
    message,
    retryable: false,
    ...(details === undefined ? {} : { details }),
  }
}

/**
 * The honest answer when a WRITE is attempted without a data plane.
 *
 * CONVENTIONS §2 lets a *read* fall back to seed data and label it. A write has
 * no equivalent: there is nowhere to put the row. Returning 200 against seed
 * data would tell the caller their change was saved when nothing was, which the
 * reference project names outright — *"Seed- oder Prozessdaten sind kein
 * Persistenznachweis."* 503 with `retryable: true` is the truth.
 */
export function persistenceUnavailable(
  message = "This change cannot be saved: the database is not configured."
): ApiError {
  return { code: "persistence_unavailable", message, retryable: true }
}

export function upstreamFailed(
  message = "An upstream service did not respond."
): ApiError {
  return { code: "upstream_failed", message, retryable: true }
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

/** Headers on every API response. No caching, no referrer, no sniffing. */
export const apiHeaders: Readonly<Record<string, string>> = Object.freeze({
  "Cache-Control": "no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  // Same-origin only. CONVENTIONS §4: no wildcard, ever — and no
  // `Access-Control-Allow-Origin` at all is stricter than echoing one back.
  Vary: "Origin",
})

export function successBody<T>(
  data: T,
  source: "supabase" | "local-seed",
  requestId: string
): ApiResponse<T> {
  return { ok: true, data, source, requestId }
}

export function errorBody(
  error: ApiError,
  requestId: string
): ApiResponse<never> {
  return { ok: false, error, requestId }
}

export function statusFor(error: ApiError): number {
  return apiErrorStatus[error.code]
}
