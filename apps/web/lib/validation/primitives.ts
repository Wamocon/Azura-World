import { z } from "zod"

/**
 * Bounded primitives, shared by every request schema.        Owner: W2-B
 *
 * CONVENTIONS §4 requires a length cap on every string that crosses the
 * boundary. The reason is not storage: an unbounded string is a cheap way to
 * make the server do expensive work — normalisation, regex, an index write —
 * and a 32 KB body full of one field is a denial of service that never trips a
 * rate limit, because it is one request.
 *
 * So there is no bare `z.string()` in this directory. Every string is one of
 * the constructors below, and each names the bound it enforces.
 */

/** Rejects the characters that break logs, CSV exports and terminal output. */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/

export function boundedText(max: number, label: string) {
  return z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`)
    .refine((value) => !CONTROL_CHARACTERS.test(value), {
      message: `${label} contains characters that are not allowed.`,
    })
}

/** An identifier: `AZW-B03-0412`, a uuid, a slug. Never free text. */
export const identifier = z
  .string()
  .trim()
  .min(1, "An identifier is required.")
  .max(64, "That identifier is too long.")
  // Unicode letters are deliberately excluded: an id is machine-generated, and
  // allowing them invites homoglyph confusion between visually identical ids.
  .regex(
    /^[A-Za-z0-9._:-]+$/,
    "That identifier contains characters that are not allowed."
  )

export const shortText = (label: string) => boundedText(200, label)
export const longText = (label: string) => boundedText(4_000, label)

/** An ISO-8601 instant. */
export const isoInstant = z
  .string()
  .trim()
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "That is not a valid date and time.",
  })

/** ISO 4217, upper case. Never coerced, never defaulted to EUR. */
export const currencyCode = z
  .string()
  .trim()
  .length(3, "A currency code is exactly three letters.")
  .regex(/^[A-Z]{3}$/, "A currency code is three upper-case letters.")

/**
 * A monetary amount in **minor units** — cents, kuruş — as an integer.
 *
 * Never a float. `0.1 + 0.2 !== 0.3` is not an acceptable property for money,
 * and the dataset already contains prices in two currencies that must not be
 * silently combined. The bound is roughly 90 billion minor units, far above any
 * plausible figure here and far below `Number.MAX_SAFE_INTEGER`.
 */
export const minorUnits = z
  .number()
  .int("An amount must be a whole number of minor units, e.g. cents.")
  .min(0, "An amount cannot be negative.")
  .max(9_000_000_000_000, "That amount is implausibly large.")

/** An optimistic-concurrency version, as read by the caller. */
export const version = z
  .number()
  .int("A version is a whole number.")
  .min(1, "A version starts at 1.")
  .max(1_000_000_000)

/**
 * A reason for a consequential action.
 *
 * Required, and required to be substantive. A reversal or a role change with no
 * stated reason is not an audit trail, it is a row — so the minimum is 8
 * characters rather than 1, which is the shortest thing that can carry meaning.
 */
export const reason = z
  .string()
  .trim()
  .min(8, "Give a reason of at least 8 characters.")
  .max(500, "A reason must be 500 characters or fewer.")
  .refine((value) => !CONTROL_CHARACTERS.test(value), {
    message: "The reason contains characters that are not allowed.",
  })
