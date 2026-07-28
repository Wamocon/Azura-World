import { expect, test } from "@playwright/test"

import { LOCALES, localised } from "../helpers"

/**
 * The service worker, actually running.                        Owner: W2-D
 *
 * `HANDOFF/W2-D.md` recorded this as a gap in plain words: *"The service worker
 * has never run."* Its policy was proved exhaustively by
 * `scripts/realtime-probe.mts` — 15 protected URLs, near-misses, non-GET,
 * cross-origin, unparseable — but a predicate proved in Node says nothing about
 * whether `public/sw.js` executes it as written inside a browser. Those are two
 * different claims and only one of them was closed.
 *
 * This closes the other one. Chromium registers the worker, the page is
 * navigated through public routes and protected routes, and then **Cache
 * Storage is enumerated** and asserted against.
 *
 * ## This is a privacy control, not a feature test
 *
 * `tasks/W2-D` §5: *"No protected page in the cache. Ever. A cached
 * `/dashboard/finance` is a data leak on a shared device."* The threat is
 * concrete — Cache Storage survives sign-out, survives closing the tab, and is
 * readable by any script on the origin with no session, no RLS and no audit
 * trail. So the assertion here is not "the cache looks about right"; it is that
 * the set of protected URLs in the cache is **empty**, and the failure message
 * prints exactly what was found.
 *
 * ## Why the worker is registered from the test
 *
 * Nothing registers it in the application yet. `HANDOFF/W2-D.md` asked W0-A for
 * one line in `app/layout.tsx` and explicitly gated the request: *"Do not
 * register it before W4-A has an e2e test for the cache boundary."* This is that
 * test. Registering from the spec proves the worker's behaviour without editing
 * a file this window does not own, and without turning it on for real users
 * before the boundary it enforces has been demonstrated.
 */

/**
 * Every route class that must never appear in Cache Storage.
 *
 * **Anchored at the start of the pathname**, mirroring `PROTECTED_PATH_PATTERNS`
 * in `lib/pwa.ts` exactly. The first version of this list was unanchored, and it
 * fired on
 * `/_next/static/chunks/app/%5Blocale%5D/dashboard/page.js` — a webpack chunk
 * whose *path* contains the word `dashboard`.
 *
 * That is not a leak and calling it one would have been worse than missing a
 * real one: a build chunk is byte-identical for every visitor, carries no
 * session and no rows, and is exactly what the `cache-first` rule for
 * `/_next/static/**` is designed to store. The thing this control exists to stop
 * is a cached **document or API response** — an HTML page holding somebody's
 * ledger, readable from Cache Storage after sign-out with no session and no RLS.
 *
 * So the patterns are anchored, and the separate assertion below proves that
 * everything cached under a dashboard-looking path really is a build asset.
 */
const FORBIDDEN_IN_CACHE = [
  { label: "dashboard", pattern: /^\/(de|en|tr|ru)\/dashboard(\/|$|\?)/ },
  { label: "dashboard (unlocalised)", pattern: /^\/dashboard(\/|$|\?)/ },
  { label: "api", pattern: /^\/api\// },
  { label: "login", pattern: /^\/(de|en|tr|ru)\/login(\/|$|\?)/ },
  { label: "signup", pattern: /^\/(de|en|tr|ru)\/signup(\/|$|\?)/ },
  { label: "report", pattern: /^\/(de|en|tr|ru)\/report(\/|$|\?)/ },
  { label: "auth", pattern: /^\/auth(\/|$|\?)/ },
] as const

test.describe("service worker — the caching boundary, executed", () => {
  // Registration, activation and several navigations. The default 45 s is tight
  // once `next dev` has to compile each route on first request.
  test.setTimeout(120_000)

  test("registers, activates, and controls the page", async ({
    page,
    baseURL,
  }) => {
    await page.goto(localised("/", "de"))

    const state = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.register("/sw.js")
      await navigator.serviceWorker.ready
      // The page that registers a worker is not controlled by it until a
      // navigation, so `controller` is deliberately read after the reload below
      // rather than here.
      return {
        scope: registration.scope,
        hasActive:
          registration.active !== null || registration.waiting !== null,
      }
    })

    expect(state.hasActive, "the worker reached active or waiting").toBe(true)
    // Scope `/` is deliberate: a narrower scope leaves uncontrolled paths
    // falling through to the browser's ordinary HTTP cache, which this code
    // cannot govern at all. The worker needs the whole origin in order to refuse.
    expect(state.scope).toBe(`${baseURL ?? ""}/`)

    await page.reload()
    const controlled = await page.evaluate(
      () => navigator.serviceWorker.controller !== null
    )
    expect(controlled, "the page is controlled after a reload").toBe(true)
  })

  test("no protected URL is ever written to Cache Storage", async ({
    page,
  }) => {
    await page.goto(localised("/", "de"))
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js")
      await navigator.serviceWorker.ready
    })
    await page.reload()
    await page.waitForFunction(
      () => navigator.serviceWorker.controller !== null
    )

    // Public routes first, so the cache is genuinely populated. A test that
    // found an empty cache because the worker never cached anything would prove
    // nothing at all — the assertion at the end checks for that explicitly.
    for (const locale of LOCALES) {
      await page.goto(localised("/", locale), { waitUntil: "domcontentloaded" })
    }

    // Then the routes that must be refused. Their status does not matter here —
    // 200, 307 to a missing login page, or 404 — because the claim under test is
    // about what the worker *stored*, and it must store none of them either way.
    const protectedTargets = [
      "/de/dashboard",
      "/de/dashboard/evidence",
      "/en/dashboard/finance",
      "/tr/dashboard/leads",
      "/ru/dashboard/reports",
      "/de/login",
      "/api/site-management/dashboard",
    ]
    for (const target of protectedTargets) {
      await page
        .goto(target, { waitUntil: "domcontentloaded" })
        .catch(() => undefined)
    }

    // Give the worker's `cache.put()` calls — which run in `waitUntil`, after
    // the response is returned to the page — a chance to settle. Without this
    // the test could pass by racing the write it is trying to catch.
    await page.waitForTimeout(2_000)

    const cached = await page.evaluate(async () => {
      const names = await caches.keys()
      const entries: { cache: string; url: string }[] = []
      for (const name of names) {
        const cache = await caches.open(name)
        for (const request of await cache.keys()) {
          entries.push({ cache: name, url: request.url })
        }
      }
      return { names, entries }
    })

    const urls = cached.entries.map((entry) => entry.url)

    // The guard against a vacuous pass: if the worker cached nothing at all,
    // the emptiness below is meaningless.
    expect(
      urls.length,
      `the worker cached nothing, so an empty protected set proves nothing. Caches: ${cached.names.join(", ")}`
    ).toBeGreaterThan(0)

    for (const { label, pattern } of FORBIDDEN_IN_CACHE) {
      const leaked = urls.filter((url) =>
        pattern.test(new URL(url).pathname + new URL(url).search)
      )
      expect(
        leaked,
        `${label} URLs found in Cache Storage — this is the data leak tasks/W2-D §5 forbids:\n${leaked.join("\n")}`
      ).toEqual([])
    }

    // The complement of the anchored check above, and the stronger half of it.
    //
    // Anchoring the patterns means a cached URL could mention `dashboard`
    // somewhere in the middle and pass. That is correct for a webpack chunk and
    // would be a serious miss for anything else, so every such entry is required
    // to be a hashed build asset. A cached dashboard *document* — the actual
    // leak — cannot satisfy this.
    const dashboardish = urls.filter((url) =>
      new URL(url).pathname.includes("dashboard")
    )
    for (const url of dashboardish) {
      const path = new URL(url).pathname
      expect(
        path.startsWith("/_next/static/"),
        `a cached entry mentions "dashboard" and is not a build asset — this is a real leak: ${path}`
      ).toBe(true)
    }

    // Recorded rather than asserted loosely: the handoff should be able to say
    // what the worker DID cache, not only what it refused.
    console.log(
      `[sw] entries mentioning "dashboard" (all must be build assets): ${dashboardish.length}`
    )
    console.log(
      `[sw] caches=${JSON.stringify(cached.names)} entries=${urls.length}\n` +
        urls
          .map((url) => `  ${new URL(url).pathname}`)
          .sort()
          .join("\n")
    )
  })

  test("the offline fallback is precached and the cache names are versioned", async ({
    page,
  }) => {
    await page.goto(localised("/", "de"))
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js")
      await navigator.serviceWorker.ready
    })
    await page.reload()
    await page.waitForFunction(
      () => navigator.serviceWorker.controller !== null
    )
    await page.waitForTimeout(1_000)

    const names = await page.evaluate(() => caches.keys())
    // A versioned name is what makes the `activate` handler's cleanup possible.
    // Without it a user is stuck on a stale bundle with no way to be upgraded.
    expect(
      names.every((name) => name.startsWith("azura-v")),
      `cache names: ${names.join(", ")}`
    ).toBe(true)

    const hasOffline = await page.evaluate(async () => {
      const match = await caches.match("/offline.html")
      return match !== undefined
    })
    expect(
      hasOffline,
      "/offline.html is precached, or an offline navigation has nothing to show"
    ).toBe(true)
  })

  test("no background sync, no periodic sync, no push, no IndexedDB", async ({
    page,
  }) => {
    // The absence of an offline mutation queue is a deliberate design decision
    // (`tasks/W2-D` §5, `HANDOFF/W2-D.md`), and it is asserted rather than
    // merely stated so that nobody can add half of one later without a test
    // going red. A half-working sync queue loses writes silently, which is worse
    // than refusing them while offline.
    const source = await page.request
      .get("/sw.js")
      .then((response) => response.text())

    expect(
      source,
      "a sync handler would imply an offline mutation queue"
    ).not.toMatch(/addEventListener\(\s*["']sync["']/)
    expect(source).not.toMatch(/addEventListener\(\s*["']periodicsync["']/)
    expect(source).not.toMatch(/addEventListener\(\s*["']push["']/)
    expect(
      source,
      "IndexedDB in the worker would imply queued writes"
    ).not.toMatch(/indexedDB/)
    // `skipWaiting()` is allowed inside the `message` handler — that is the
    // user-initiated upgrade path — but never unconditionally on install, which
    // hot-swaps the bundle under an open form.
    expect(source).not.toMatch(
      /addEventListener\(\s*["']install["'][\s\S]{0,200}?skipWaiting\(\)/
    )
  })
})
