/**
 * Small, dependency-light utilities shared across windows.
 *
 * Deliberately NOT here: `cn()`. W1-D owns `apps/web/lib/cn.ts` per
 * ORCHESTRATION §4, and two `cn` implementations is exactly the "second way to
 * do something that already has one" that CONVENTIONS forbids. Import class
 * merging from `lib/cn`, not from here.
 *
 * Nothing in this file may import from a repository, a component, or `lib/env`.
 * It is safe in both bundles and is loaded by code that runs before anything
 * else is ready.
 */

/**
 * The single source of "now" for `RepositoryResult.fetchedAt`,
 * `SourceRef.fetchedAt` and every other timestamp that reaches a contract.
 *
 * Always UTC ISO 8601 with milliseconds. CONVENTIONS §5 requires portable date
 * handling — never shell date math, never a locale-formatted string in stored
 * data. Formatting for display is W1-C's `lib/format.ts`.
 */
export function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Exhaustiveness check for discriminated unions. Put it in the `default` branch
 * of a switch: if a new variant is added to the union and this switch is not
 * updated, the build fails instead of silently falling through.
 *
 * CONTRACTS §5's `ApiResponse` and §1's `Confidence` are the unions this exists
 * for.
 */
export function assertNever(value: never, context: string): never {
  throw new Error(
    `Unhandled variant in ${context}: ${JSON.stringify(value)}. A union gained a member without its switch being updated.`
  )
}

/**
 * Lower-cased hostname of a URL, or `null` when it does not parse.
 *
 * Used wherever sources are grouped or de-duplicated by publisher domain —
 * CONTRACTS §1 invariant 3 ("≥2 sources with distinct hosts") is the reason
 * this concept exists at all. `contracts.ts` has its own throwing variant
 * because an unparseable citation is a hard invariant failure there; this one
 * is the tolerant version for UI grouping.
 */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** A string that is present and not just whitespace. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

/**
 * Hard length ceiling for a string crossing a trust boundary.
 *
 * CONVENTIONS §4 step 3 requires a length ceiling on every validated string.
 * This is the enforcement of last resort for places Zod does not reach — log
 * lines, error details, and anything derived from scraped competitor HTML,
 * which is untrusted input.
 */
export function clampText(value: string, maxLength: number): string {
  if (maxLength <= 0) return ""
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1)}…`
}

/**
 * Locale-aware comparator. Turkish is not optional here: `"I".toLowerCase()` is
 * `"i"` in every locale except `tr`, where the dotless `"ı"` is a distinct
 * letter, and a default sort puts `ı İ ş ğ ç ö ü` in the wrong order
 * (CONVENTIONS §5). Any list a user sees sorted must go through this.
 */
export function collatorFor(locale: string): Intl.Collator {
  return new Intl.Collator(locale, { sensitivity: "base", numeric: true })
}
