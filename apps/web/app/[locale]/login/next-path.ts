import { locales } from "@/lib/contracts"

/**
 * The `?next=` allowlist.                                     Owner: W3-H
 *
 * Moved here out of `actions.ts`, unchanged in behaviour, for two reasons.
 *
 * **It must not be a server action.** Every export of a `"use server"` file is
 * a network-callable POST endpoint. `safeNextPath` was one, which meant an
 * unauthenticated caller could invoke the app's redirect validator directly. It
 * returns a sanitised path and leaks nothing, so this was a wart rather than a
 * hole, but an endpoint that exists for no reason is still an endpoint.
 *
 * **A pure function can be proved.** As an action it was `async` and reachable
 * only through Next's action runtime; here it is an ordinary function that
 * `scripts/next-path-probe.mts` calls 40 times with hostile input. An
 * open-redirect check that cannot be exercised directly tends not to be.
 *
 * ## Why a shape rule rather than a list of paths
 *
 * A literal allowlist of destinations goes stale the moment W3-B adds a route,
 * and the failure is silent: the user lands on `/dashboard` instead of where
 * they were going, and nobody files that as a bug. The rule below is instead a
 * shape: same-origin, single-slash, absolute, no backslashes, no control
 * characters, bounded length. Everything outside it becomes `/dashboard`.
 *
 * The dangerous input is not `https://evil.example` — that fails the first
 * check. It is `//evil.example`, which *looks* like a path and which browsers
 * resolve as a different origin, and its encoded and backslash variants.
 */

export const NEXT_FALLBACK = "/dashboard"

/** Longer than any real path here, short enough to bound the work below. */
const MAX_NEXT_LENGTH = 512

export function safeNextPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return NEXT_FALLBACK
  if (value.length > MAX_NEXT_LENGTH) return NEXT_FALLBACK

  // A control character can smuggle a header or a line break through a logger
  // or a redirect. Written as escapes, never as literal bytes: the literal form
  // is invisible in review and has already been shipped once in this repository.
  if (/[\u0000-\u001F\u007F]/u.test(value)) return NEXT_FALLBACK

  // Backslashes anywhere. Several parsers normalise `\` to `/`, so `/\evil.example`
  // and `/\/evil.example` can both become protocol-relative after normalisation.
  if (value.includes("\\")) return NEXT_FALLBACK

  if (!value.startsWith("/")) return NEXT_FALLBACK
  // Protocol-relative. `//evil.example` is a different origin wearing a path's
  // clothes, and it is the single most common open-redirect bypass.
  if (value.startsWith("//")) return NEXT_FALLBACK

  /*
   * Percent-encoded variants.
   *
   * Next decodes query parameters before a page sees them, so `%2f%2fevil` has
   * usually already become `//evil` and been caught above. "Usually" is not a
   * security property: a hand-built link, a double-encoded value, or a caller
   * passing a raw form field can all deliver a still-encoded string here. So the
   * value is decoded once more and re-checked.
   *
   * Decoding can throw on a malformed sequence like `%zz`; that input is
   * rejected rather than passed through, because a path the platform cannot
   * agree on the meaning of is not one to redirect to.
   */
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return NEXT_FALLBACK
  }
  if (decoded !== value) {
    if (decoded.startsWith("//")) return NEXT_FALLBACK
    if (decoded.includes("\\")) return NEXT_FALLBACK
    if (/[\u0000-\u001F\u007F]/u.test(decoded)) return NEXT_FALLBACK
    if (!decoded.startsWith("/")) return NEXT_FALLBACK
  }

  return value
}

/**
 * Strips a leading locale segment.
 *
 * A `next` captured by `proxy.ts` is already locale-free, but a hand-written
 * link may not be, and `/de/de/dashboard` is a 404 that reads as a routing bug.
 */
export function withoutLocalePrefix(path: string): string {
  const segments = path.split("/").filter(Boolean)
  const first = segments[0]
  if (first !== undefined && (locales as readonly string[]).includes(first)) {
    return `/${segments.slice(1).join("/")}`
  }
  return path
}

/**
 * The final redirect target. Always locale-prefixed.
 *
 * `localePrefix: "always"` (CONTRACTS §7) means a bare `/dashboard` is not a
 * route. It would bounce through the intl middleware onto the default locale and
 * silently move a Turkish reviewer to German mid-flow.
 */
export function localisedDestination(locale: string, path: string): string {
  const withoutLocale = withoutLocalePrefix(path)
  const normalised =
    withoutLocale === "/" || withoutLocale === "" ? NEXT_FALLBACK : withoutLocale
  return `/${locale}${normalised}`
}
