/* eslint-disable */
/**
 * Service worker — deliberately conservative.
 *
 * ## The rule that matters
 *
 * **No protected route is ever cached.** A cached `/de/dashboard/finance` is a
 * data leak on a shared device: the next person to open the browser gets the
 * previous user's ledger out of Cache Storage, with no session, no RLS, and no
 * way for the server to know. The deny-list below is checked before any
 * positive rule, so nothing downstream can re-admit a dashboard URL.
 *
 * ## This is a copy, and the copy is checked
 *
 * `apps/web/lib/pwa.ts` is the source of truth. A service worker cannot import
 * an application module, so the policy is duplicated here — and
 * `scripts/realtime-probe.mts` reads this file and asserts that every pattern in
 * `PROTECTED_PATH_PATTERNS` appears in it. Editing one without the other fails a
 * gate rather than silently opening a hole.
 *
 * ## What this worker does NOT do
 *
 *  - **No offline mutation queue.** Not built, not started. A half-working sync
 *    queue loses writes silently, which is worse than refusing them while
 *    offline. `components/connection-banner.tsx` tells the user so explicitly.
 *  - **No background sync, no push.** Neither has a use here.
 *  - **No hot swap.** A new worker waits; the page asks the user to reload.
 *    Swapping the bundle under someone mid-form is how a PWA eats a half-filled
 *    form.
 */

const CACHE_VERSION = "azura-v1"
const STATIC_CACHE = CACHE_VERSION + "-static"
const PAGE_CACHE = CACHE_VERSION + "-pages"
const OFFLINE_FALLBACK_PATH = "/offline.html"

/** MUST match PROTECTED_PATH_PATTERNS in apps/web/lib/pwa.ts. */
const PROTECTED_PATH_PATTERNS = [
  /^\/(de|en|tr|ru)\/dashboard(\/|$)/,
  /^\/dashboard(\/|$)/,
  /^\/api\//,
  /^\/(de|en|tr|ru)\/login(\/|$)/,
  /^\/(de|en|tr|ru)\/signup(\/|$)/,
  /^\/(de|en|tr|ru)\/report(\/|$)/,
  /^\/auth(\/|$)/,
]

/** MUST match STATIC_PREFIXES in apps/web/lib/pwa.ts. */
const STATIC_PREFIXES = ["/_next/static/", "/fonts/", "/media/"]

function isProtectedPath(pathname) {
  return PROTECTED_PATH_PATTERNS.some(function (pattern) {
    return pattern.test(pathname)
  })
}

function cacheStrategyFor(request, origin) {
  if (request.method !== "GET") return "never"

  var url
  try {
    url = new URL(request.url)
  } catch (error) {
    return "never"
  }
  if (url.origin !== origin) return "never"
  if (isProtectedPath(url.pathname)) return "never"

  var isStatic = STATIC_PREFIXES.some(function (prefix) {
    return url.pathname.indexOf(prefix) === 0
  })
  return isStatic ? "cache-first" : "network-first"
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then(function (cache) {
        return cache.addAll([OFFLINE_FALLBACK_PATH])
      })
      // A missing offline page must not abort installation and leave the site
      // with no worker at all.
      .catch(function () {})
      .then(function () {
        // Do NOT skipWaiting: the new worker waits until every tab using the old
        // one has gone, or until the page explicitly asks. See the header.
        return undefined
      })
  )
})

self.addEventListener("activate", function (event) {
  var keep = [STATIC_CACHE, PAGE_CACHE]
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names.map(function (name) {
            // Anything from a previous CACHE_VERSION goes. Without this a user
            // is stuck on a stale bundle forever, which is the failure that
            // makes people uninstall a PWA rather than report a bug.
            return keep.indexOf(name) === -1 ? caches.delete(name) : undefined
          })
        )
      })
      .then(function () {
        return self.clients.claim()
      })
  )
})

/** The page asks for the upgrade; the worker never takes it. */
self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "AZURA_SKIP_WAITING") {
    self.skipWaiting()
  }
})

self.addEventListener("fetch", function (event) {
  var strategy = cacheStrategyFor(event.request, self.location.origin)

  // Not intercepted at all. The request goes to the network exactly as it would
  // with no service worker installed, and nothing about it is stored.
  if (strategy === "never") return

  if (strategy === "cache-first") {
    event.respondWith(
      caches.match(event.request).then(function (cached) {
        if (cached) return cached
        return fetch(event.request).then(function (response) {
          // Only a clean, same-origin 200 is worth storing. An opaque or partial
          // response cached here would be served forever with no way to tell it
          // is broken.
          if (response && response.status === 200 && response.type === "basic") {
            var copy = response.clone()
            caches.open(STATIC_CACHE).then(function (cache) {
              cache.put(event.request, copy)
            })
          }
          return response
        })
      })
    )
    return
  }

  // network-first
  event.respondWith(
    fetch(event.request)
      .then(function (response) {
        if (
          event.request.mode === "navigate" &&
          response &&
          response.status === 200 &&
          response.type === "basic"
        ) {
          var copy = response.clone()
          caches.open(PAGE_CACHE).then(function (cache) {
            cache.put(event.request, copy)
          })
        }
        return response
      })
      .catch(function () {
        return caches.match(event.request).then(function (cached) {
          if (cached) return cached
          if (event.request.mode === "navigate") {
            return caches.match(OFFLINE_FALLBACK_PATH)
          }
          return Response.error()
        })
      })
  )
})
