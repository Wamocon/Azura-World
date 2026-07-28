/**
 * The PWA caching boundary — **the privacy control**, not a performance feature.
 *
 * A cached `/de/dashboard/finance` is a data leak on a shared device: the next
 * person to open the browser gets the previous user's ledger out of the Cache
 * Storage API, with no session, no RLS and no way for the server to know it
 * happened. So the rule is absolute and stated as a deny-list that is checked
 * before anything else: **no protected route is ever cached.**
 *
 * This module is the single source of truth for that boundary.
 * `apps/web/public/sw.js` carries a copy, because a service worker cannot import
 * an application module — and `scripts/realtime-probe.mts` asserts that every
 * pattern here appears in that file, so the copy cannot silently drift.
 *
 * ## Deliberately conservative, mirroring 1Çatı exactly
 *
 * - Manifest and installability: yes.
 * - Offline fallback: **public routes only**.
 * - Static assets: cache-first, but only content-hashed ones.
 * - **No persistent offline mutation queue.** Not built, not started, not
 *   planned here. A half-working sync queue loses writes silently, which is
 *   worse than refusing to accept them while offline. Stated again in
 *   HANDOFF/W2-D.md so nobody claims it later.
 */

/**
 * Bump on every service-worker change. The old cache is deleted on `activate`,
 * which is what stops a user being stuck on a stale bundle forever — the failure
 * mode that makes people uninstall a PWA rather than report a bug.
 */
export const CACHE_VERSION = "azura-v1"
export const STATIC_CACHE = `${CACHE_VERSION}-static`
export const PAGE_CACHE = `${CACHE_VERSION}-pages`

/** Served when a public navigation fails and nothing is cached. */
export const OFFLINE_FALLBACK_PATH = "/offline.html"

/**
 * Paths that must never enter any cache.
 *
 * Ordered from most to least likely so a hot path exits early, but every entry
 * is checked — this is a deny-list, and a deny-list that short-circuits on the
 * first match is only correct if the list is exhaustive, which is the point.
 *
 * `(de|en|tr|ru)` is spelled out rather than `[a-z]{2}` because CONTRACTS §7
 * freezes the locale set, and a looser pattern would also match a future public
 * route that happens to start with two letters.
 */
export const PROTECTED_PATH_PATTERNS: readonly RegExp[] = [
  /^\/(de|en|tr|ru)\/dashboard(\/|$)/,
  /^\/dashboard(\/|$)/,
  /^\/api\//,
  /^\/(de|en|tr|ru)\/login(\/|$)/,
  /^\/(de|en|tr|ru)\/signup(\/|$)/,
  /^\/(de|en|tr|ru)\/report(\/|$)/,
  /^\/auth(\/|$)/,
]

/** True when the path is off-limits to the cache. */
export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATH_PATTERNS.some((pattern) => pattern.test(pathname))
}

/**
 * Content-hashed asset prefixes. Only these are cache-first.
 *
 * `/_next/static/**` filenames contain a build hash, so a cached entry can never
 * be stale for the wrong build. `/fonts` and `/media` are W0-D's immutable
 * harvested assets. Everything else — including `/_next/image` and any
 * unhashed public file — goes network-first.
 */
const STATIC_PREFIXES = ["/_next/static/", "/fonts/", "/media/"] as const

export type CacheStrategy = "cache-first" | "network-first" | "never"

/**
 * The one decision the service worker makes.
 *
 * The order is the security property:
 *
 * 1. Anything but `GET` → `never`. A cached POST response is nonsense, and a
 *    cached response to a *mutation* is a leak.
 * 2. Cross-origin → `never`. Third-party caching is not this app's business.
 * 3. Protected → `never`. Checked before any positive rule, so no later clause
 *    can accidentally re-admit a dashboard URL.
 * 4. Hashed static → `cache-first`.
 * 5. Everything else → `network-first`, which for a navigation means the cached
 *    copy is only ever used when the network has already failed.
 */
export function cacheStrategyFor(
  request: { method: string; url: string },
  origin: string
): CacheStrategy {
  if (request.method !== "GET") return "never"

  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return "never"
  }
  if (url.origin !== origin) return "never"
  if (isProtectedPath(url.pathname)) return "never"

  if (STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    return "cache-first"
  }
  return "network-first"
}

/**
 * Every cache name this app is allowed to own. `activate` deletes anything else,
 * which is how an upgrade actually frees the old bundle.
 */
export function currentCacheNames(): string[] {
  return [STATIC_CACHE, PAGE_CACHE]
}
