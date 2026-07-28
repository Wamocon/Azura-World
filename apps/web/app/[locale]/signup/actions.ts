"use server"

import { headers } from "next/headers"
import { z } from "zod"

import { createHandler } from "@/lib/api-handler"
import {
  initialAccessRequestState,
  type AccessRequestState,
} from "./form-state"
import { sanitiseReportText } from "../report/report-text"

/**
 * Access request intake.                                      Owner: W3-H
 *
 * ## This is a request, not a registration
 *
 * `tasks/W3-H` §2: *`guest` role by default; elevation is an `admin` action,
 * never self-service.* The strongest way to honour that is not to grant a role
 * at all. Nobody who fills this form receives an account, a session, or a
 * profile row; an administrator provisions all three afterwards, at which point
 * the role is chosen by the administrator. Self-service elevation is not
 * prevented by a check that could be bypassed — there is nothing to bypass.
 *
 * ## Why `supabase.auth.signUp()` is deliberately NOT called
 *
 * It would create an authenticated user with no `profiles` row, and
 * `resolveSupabaseProfile()` resolves that state to **`tenant`**, not `guest`
 * (`lib/auth-resolution.ts`: *"no profiles row for this user; fell back to the
 * minimal tenant role"*). That fallback is correct for its own case — an
 * existing user whose row is missing during incomplete onboarding — but routing
 * self-service signup through it would hand every anonymous form filler a
 * `tenant` role, which is strictly more authority than the `guest` the brief
 * specifies. Calling `signUp` here would therefore create a privilege-escalation
 * path out of a sensible fallback. Raised as a request to W1-B in
 * `HANDOFF/W3-H.md`.
 *
 * ## What it does when there is nowhere to write
 *
 * The same thing the report form does: says so. There is no repository for
 * access requests — W2-A shipped four mutations and this is not one of them —
 * so the action validates, rate-limits, and then reports `unavailable` without
 * claiming a request was filed. An acknowledgement nobody will act on is the
 * same lie as a reference number nobody can look up.
 */

/** Its own bucket, distinct from report intake and the tracker. */
const SIGNUP_LIMIT = { windowMs: 60_000, max: 5 }
const SIGNUP_LIMIT_PATH = "/signup"

/**
 * Built for its limiter only, exactly as the report tracker does. See
 * `app/[locale]/report/actions.ts` for why composing `createHandler` beats a
 * second rate limiter living in a page directory.
 */
const signupRateLimit = createHandler<never, null>({
  method: "GET",
  permission: null,
  publicJustification:
    "Rate limiting for the anonymous access-request form. Consumed in-process; not mounted as a route.",
  rateLimit: SIGNUP_LIMIT,
  handler: async () => ({ data: null, source: "local-seed" }),
})

/**
 * Bounded, and bounded here rather than only in the schema.
 *
 * Same reasoning as the report form: normalisation runs regexes over the input,
 * so the ceiling has to precede it. Larger than the schema's own limits so an
 * over-length value still produces a specific message instead of a silent trim.
 */
const MAX_ACCEPTED_FIELD = 4_000

/** Written as \u escapes, never literal bytes. See report-text.ts. */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/u

/**
 * Deliberately not `z.string().email()`.
 *
 * Zod's email regex rejects addresses that are valid under RFC 5321 — quoted
 * local parts, new gTLDs, and plenty of real corporate mail. For a form whose
 * entire purpose is "an administrator will contact you", a false rejection is
 * worse than a permissive accept: the address is never used as an identifier,
 * never trusted, and never dereferenced automatically. So the check is
 * structural and bounded, and a human reads it afterwards.
 */
const looseEmail = z
  .string()
  .trim()
  .min(3, "An email address is required.")
  .max(320, "That email address is too long.")
  .refine((value) => !CONTROL_CHARACTERS.test(value), {
    message: "That email address contains characters that are not allowed.",
  })
  .refine(
    (value) => /^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+$/u.test(value),
    "That does not look like an email address."
  )

const accessRequestSchema = z.strictObject({
  fullName: z
    .string()
    .trim()
    .min(1, "A name is required.")
    .max(200, "That name is too long.")
    .refine((value) => !CONTROL_CHARACTERS.test(value), {
      message: "That name contains characters that are not allowed.",
    }),
  email: looseEmail,
  company: z
    .string()
    .trim()
    .max(200, "That organisation name is too long.")
    .refine((value) => !CONTROL_CHARACTERS.test(value), {
      message: "That organisation name contains characters that are not allowed.",
    }),
  // Substantive, for the same reason `reason` is substantive elsewhere in the
  // codebase: an access request with no stated purpose gives the administrator
  // approving it nothing to approve on.
  reason: z
    .string()
    .trim()
    .min(8, "Give a reason of at least 8 characters.")
    .max(2_000, "That reason is too long.")
    .refine((value) => !CONTROL_CHARACTERS.test(value), {
      message: "The reason contains characters that are not allowed.",
    }),
})

function readField(form: FormData, name: string): string {
  const raw = form.get(name)
  if (typeof raw !== "string") return ""
  return sanitiseReportText(raw.slice(0, MAX_ACCEPTED_FIELD))
}

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
  return out
}

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

export async function requestAccess(
  previous: AccessRequestState,
  form: FormData
): Promise<AccessRequestState> {
  const values = {
    fullName: readField(form, "fullName"),
    email: readField(form, "email"),
    company: readField(form, "company"),
    reason: readField(form, "reason"),
  }
  const carried: AccessRequestState = {
    ...initialAccessRequestState,
    values,
  }

  // Rate limit before validation: a script probing which addresses are already
  // registered would look exactly like repeated submissions, and throttling
  // after validation would leave the cheap-to-trigger path unthrottled.
  const throttle = await signupRateLimit(
    new Request(await selfUrl(SIGNUP_LIMIT_PATH), {
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
      message: null,
      retryAfterSeconds: Number.isFinite(seconds) ? seconds : 60,
    }
  }

  const parsed = accessRequestSchema.safeParse(values)
  if (!parsed.success) {
    const fieldErrors: AccessRequestState["fieldErrors"] = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]
      if (
        key === "fullName" ||
        key === "email" ||
        key === "company" ||
        key === "reason"
      ) {
        fieldErrors[key] ??= issue.message
      }
    }
    return { ...carried, status: "invalid", fieldErrors, message: null }
  }

  /*
   * There is no access-request repository, so there is nowhere durable to put
   * this. It is reported as unavailable rather than acknowledged.
   *
   * The temptation here is a "thanks, we'll be in touch" that writes nothing —
   * it makes the form feel finished and it costs a real person their access,
   * because they stop chasing it. Same failure as issuing a reference number
   * for a report that was never stored, and the brief is explicit about that
   * one. When W2-A adds the repository, this branch becomes the write and
   * `received` becomes reachable.
   */
  return {
    ...carried,
    status: "unavailable",
    message: null,
    fieldErrors: {},
  }
}
