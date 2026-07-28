/**
 * Query-string validation.                                   Owner: W2-B
 *
 * A request body goes through Zod. A query string, in most codebases, does not
 * — it gets read with `searchParams.get()` and passed straight into a repository
 * call as a `string`. That is the same unvalidated boundary wearing a different
 * hat, and it is the one an attacker reaches without needing a POST.
 *
 * These readers are the query-string equivalent of `lib/validation/schemas.ts`:
 * every value is bounded, every enumerated value is checked against a closed
 * list, and anything that does not fit is dropped rather than forwarded. Dropped
 * rather than rejected is deliberate for filters — an unrecognised
 * `?status=nonsense` should narrow to nothing surprising, not 400 — but a value
 * the caller *must* supply uses `requireText`, which does reject.
 *
 * Every reader returns `undefined` rather than `null` for "absent", so the
 * result spreads cleanly into a repository options object under
 * `exactOptionalPropertyTypes`.
 */

import { validationFailed } from "../api-errors"
import { RepositoryError } from "../repository-base"

/** A bounded free-text filter. Over-long or control-bearing values are dropped. */
export function readText(
  query: URLSearchParams,
  name: string,
  maxLength = 64
): string | undefined {
  const raw = query.get(name)
  if (raw === null) return undefined
  const value = raw.trim()
  if (value.length === 0 || value.length > maxLength) return undefined
  if (/[\u0000-\u001F\u007F]/.test(value)) return undefined
  return value
}

/** A value the caller must supply. Absent or invalid is a 422, not a default. */
export function requireText(
  query: URLSearchParams,
  name: string,
  maxLength = 120
): string {
  const value = readText(query, name, maxLength)
  if (value === undefined) {
    throw new RepositoryError(
      validationFailed(`The "${name}" parameter is required.`, {
        [name]: `Supply between 1 and ${maxLength} characters.`,
      })
    )
  }
  return value
}

/**
 * A value from a closed list.
 *
 * The `allowed` array is the contract — a value outside it never reaches a
 * repository, so a filter cannot be used to smuggle a string into a query
 * builder that expected an enum.
 */
export function readEnum<T extends string>(
  query: URLSearchParams,
  name: string,
  allowed: readonly T[]
): T | undefined {
  const raw = query.get(name)
  if (raw === null) return undefined
  return allowed.find((candidate) => candidate === raw)
}

/**
 * A tri-state boolean: absent, `true`, or `false`.
 *
 * `?flag` with no value and `?flag=1` both mean true, because that is what a
 * hand-written URL means. Anything unrecognised is absent, never `false` — a
 * typo must not silently invert a filter.
 */
export function readBoolean(
  query: URLSearchParams,
  name: string
): boolean | undefined {
  const raw = query.get(name)
  if (raw === null) return undefined
  const value = raw.trim().toLowerCase()
  if (value === "" || value === "true" || value === "1" || value === "yes")
    return true
  if (value === "false" || value === "0" || value === "no") return false
  return undefined
}

/** A bounded integer. Out-of-range values are clamped, not rejected. */
export function readInt(
  query: URLSearchParams,
  name: string,
  min: number,
  max: number
): number | undefined {
  const raw = query.get(name)
  if (raw === null) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value)) return undefined
  return Math.min(Math.max(Math.trunc(value), min), max)
}

/**
 * An identifier filter — a unit id, a profile id, a thread id.
 *
 * Tighter than `readText`: machine-generated ids have no reason to contain
 * anything but this alphabet, and allowing more invites homoglyph confusion
 * between ids that render identically.
 */
export function readId(
  query: URLSearchParams,
  name: string
): string | undefined {
  const value = readText(query, name, 64)
  if (value === undefined) return undefined
  return /^[A-Za-z0-9._:-]+$/.test(value) ? value : undefined
}
