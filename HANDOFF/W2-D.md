# HANDOFF — W2-D  Realtime, sync, offline posture

STATUS: COMPLETE
Completed: 2026-07-27 (build) · 2026-07-28 (the three browser proofs)
Window: 2 (stretch, after W1-B → W2-C) · Branches: `feature/INTERNAL-107-w1b-w2c-auth-ai` @ `bb90784` (build), `feature/INTERNAL-107-w2d-browser` @ `3deef2c` (browser proofs, own worktree `D:\azura-w2d`)

**Was PARTIAL; now complete.** The build and the 93-assertion probe landed on 2026-07-27 with
three checks unproven because they needed a browser: a channel actually closing on unmount, a real
Cache Storage enumeration, and a real socket dropping mid-session. W4-A shipped a Playwright
harness on 2026-07-28 and all three are now closed against a real Chromium — see §"The three
browser proofs".

Three things that turned out differently from what this document claimed, all recorded below
rather than quietly corrected:

1. **The 30 s backoff ladder does not govern observed retry timing.** `nextBackoffDelay` is
   correct in isolation and `supabase-js` retries first, every time. §"Measured reconnect backoff"
   now carries both ladders.
2. **`NEXT_PUBLIC_SUPABASE_*` never reached the browser.** The repository's `.env.local` sits at
   the repo root; Next reads env from `apps/web`. Realtime could not have connected from any dev
   server started the documented way. Fixed locally, and a request to W0-A is filed.
3. **A cached URL can contain the word `dashboard` and be perfectly safe.** The first version of
   the privacy assertion fired on a webpack chunk. §"The PWA caching boundary" states the
   distinction that matters.

---

## What was built

- **`lib/realtime.ts`** — mode resolution, reconnect backoff, burst coalescing, staleness, the
  published-table list. All pure.
- **`lib/pwa.ts`** — the caching boundary. `isProtectedPath` / `cacheStrategyFor` are the privacy
  control, and they are the single source of truth for it.
- **`hooks/use-live-snapshot.ts`** — the hook every live surface consumes.
- **`hooks/use-realtime-channel.ts`** — one channel, with backoff, coalescing and teardown.
- **`hooks/use-connection-status.ts`** — online + tab visibility.
- **`hooks/use-optimistic-mutation.ts`** — optimistic write with exact rollback.
- **`components/sync-badge.tsx`** — the mode indicator. Self-contained: no import from W1-D's
  `components/ui/*`, because it has to render correctly in a `static` deployment with no design
  system loaded, which is exactly the situation where mislabelling the data mode matters most.
- **`components/connection-banner.tsx`** — the page-level offline/stale statement.
- **`app/manifest.ts`**, **`public/sw.js`**, **`public/offline.html`**.
- **`scripts/realtime-probe.mts`** — 93 assertions.

---

## The `useLiveSnapshot` API — W3-B and every live surface consumes this

```ts
export function useLiveSnapshot<T>(config: {
  fetcher: () => Promise<RepositoryResult<T>>
  channels?: readonly RealtimeChannelConfig[]   // default []
  pollIntervalMs?: number                       // default 30_000
  enabled?: boolean                             // default true
  channelName?: string                          // default "live-snapshot"
}): {
  data: T | null
  source: "supabase" | "local-seed" | null
  mode: "realtime" | "polling" | "static" | "offline"
  lastUpdated: string | null      // the server's RepositoryResult.fetchedAt
  error: ApiError | null
  isStale: boolean
  refresh: () => Promise<void>
}
```

Typical use, from a dashboard surface:

```tsx
const { data, mode, lastUpdated, isStale, refresh } = useLiveSnapshot({
  fetcher: () => getInventorySnapshot(),
  channels: [{ table: "units" }, { table: "activities" }],
  channelName: "inventory",
})

<SyncBadge mode={mode} lastUpdated={lastUpdated} locale={locale} />
<ConnectionBanner mode={mode} isStale={isStale} lastUpdated={lastUpdated} onRetry={refresh} />
```

Four behaviours a caller needs to know:

- **`static` does not poll.** No timer is created at all. Seed data does not change, so polling it
  is churn, and "last updated 3 s ago" over static data is a lie.
- **A backgrounded tab pauses polling** and refetches immediately on focus.
- **Never two requests in flight.** An in-flight guard plus an `AbortController`; a slow response
  cannot land on top of a newer one.
- **`lastUpdated` is `RepositoryResult.fetchedAt`**, never `Date.now()`. CONVENTIONS §5 calls out
  clock skew; a client clock eleven minutes fast would otherwise report fresh data as stale.

---

## Which tables are realtime-subscribed

`REALTIME_TABLES` in `lib/realtime.ts`, matching W1-A's migration 12 verbatim and in order. The
probe asserts the two lists are identical:

`units` · `service_tickets` · `ticket_events` · `workforce_tasks` · `media_reports` ·
`activities` · `threads` · `messages` · `notifications` · `ai_action_logs`

**Deliberately not published**, and the probe asserts each is rejected by `isRealtimeTable`:
`finance_ledger_entries`, `documents`, `audit_events`, `access_events`, `profiles`.

Realtime does **not** bypass RLS — a subscriber receives only rows its policies already allow it
to SELECT — so publishing a table does not widen access. What it does change is the failure mode:
a policy bug on a published table leaks *continuously* rather than on request. That is why the
list is short and why finance and documents are off it.

**A realtime payload is never read.** `onChange` takes no argument. A change event means "refetch",
and the refetch goes through the repository and therefore through RLS. Rendering a pushed row would
bypass the one place that decides whether this user may see it — and after a reconnect it would
replay a buffered queue, showing a sequence of intermediate states that never existed as a whole.

---

## The PWA caching boundary, and proof no protected route is cached

**Deny-list, checked before any positive rule** (`lib/pwa.ts`):

```
/^\/(de|en|tr|ru)\/dashboard(\/|$)/     /^\/dashboard(\/|$)/     /^\/api\//
/^\/(de|en|tr|ru)\/login(\/|$)/         /^\/(de|en|tr|ru)\/signup(\/|$)/
/^\/(de|en|tr|ru)\/report(\/|$)/        /^\/auth(\/|$)/
```

| Class | Strategy |
|---|---|
| any non-`GET` | **never** |
| cross-origin | **never** |
| any path matching the deny-list | **never** |
| `/_next/static/**`, `/fonts/**`, `/media/**` | cache-first |
| everything else | network-first, cached only on a successful navigation |

`/_next/image?...` is deliberately **network-first**, not cache-first: the URL carries no build
hash, so a cached copy could outlive the deploy that produced it.

**Proof** — 15 protected URLs across all four locales, 8 public URLs, plus the near-misses a
sloppier deny-list would get wrong:

```
PASS  /de/dashboard/finance ⟹ never cached
PASS  /en/dashboard/units/AZW-B01-0001 ⟹ never cached
PASS  /tr/dashboard/leads ⟹ never cached
PASS  /ru/dashboard/reports ⟹ never cached
PASS  /api/ai/chat ⟹ never cached
PASS  /de/login ⟹ never cached          (… 15 in total)
PASS  a non-GET request is never cached — a cached response to a mutation is a leak
PASS  a cross-origin request is never cached
PASS  an unparseable URL is never cached — fails closed
PASS  /de/dashboards-public is NOT treated as protected (whole-segment matching)
PASS  /de/dashboardx is NOT treated as protected
PASS  /de/hotel/dashboard-tour is NOT treated as protected
```

This is a stronger proof than enumerating one runtime cache would be: it exercises the predicate
that *decides* what enters the cache, over the whole class of inputs, rather than sampling one
browser's cache after one session.

### The runtime enumeration — the worker has now run

Registered from the spec (nothing in the app registers it yet — see the request to W0-A), the
page reloaded until `navigator.serviceWorker.controller !== null`, then driven through all four
public locales and seven protected routes. **Cache Storage was then enumerated in full:**

```
caches = ["azura-v1-pages", "azura-v1-static"]      57 entries

/de  /en  /tr  /ru                     ← public documents, correctly cached
/offline.html                          ← precached on install
/fonts/{manrope,playfair}-var-*.woff2  ← 6 font files
/_next/static/**                       ← 45 build assets

/dashboard  → 0        /api/  → 0        /login  → 0
```

Zero protected entries, and the emptiness is not vacuous: the test fails if the worker cached
*nothing*, so 57 entries is what makes the zero meaningful.

**One distinction worth stating, because the first version of this assertion got it wrong.** Two
cached URLs contain the word `dashboard`:

```
/_next/static/chunks/app/%5Blocale%5D/dashboard/layout.js
/_next/static/chunks/app/%5Blocale%5D/dashboard/page.js
```

Those are **webpack chunks** — byte-identical for every visitor, carrying no session and no rows —
and caching them is exactly what the `cache-first` rule for `/_next/static/**` is for. An
unanchored pattern flagged them as a leak. Calling that a leak would have been worse than missing a
real one, because the next person would have loosened the assertion to make it pass. The patterns
are now **anchored at the start of the pathname**, mirroring `PROTECTED_PATH_PATTERNS` exactly, and
a separate assertion requires every cached entry mentioning `dashboard` to be a `/_next/static/`
asset — so a cached dashboard *document*, which is the actual leak, still fails.

**The service worker's copy cannot drift.** `public/sw.js` cannot import an application module, so
it carries a duplicate of the policy — and the probe reads the file and asserts every pattern from
`PROTECTED_PATH_PATTERNS` appears in it, that the deny-list is checked before the static-prefix
rule, that `skipWaiting()` is never called unconditionally, and that there is no background-sync
handler, no `indexedDB` and no push handler.

### There is NO offline mutation queue

Stated plainly, because the brief asks for it to be stated so nobody claims it later:

**No offline mutation queue exists. It is not built, not started, and not partially present.** A
half-working sync queue loses writes silently, which is worse than refusing them while offline.

This is now asserted **against the running worker as well as its source**:
`e2e/pwa/service-worker.spec.ts` fetches `/sw.js` and requires no `sync` handler, no `periodicsync`
handler, no `push` handler, no `indexedDB`, and no unconditional `skipWaiting()` inside `install`.
Adding half a queue turns a test red rather than shipping quietly.
`components/connection-banner.tsx` tells the user so in all four languages — "Änderungen können
jetzt nicht gespeichert werden — sie werden auch nicht zwischengespeichert und später gesendet" —
and `public/offline.html` repeats it. The probe asserts the service worker has no `sync` handler,
no `periodicsync` handler and no IndexedDB usage.

---

## Measured reconnect backoff

`nextBackoffDelay(attempt, random)` — base 1 s, doubling, ±25 % jitter, hard cap 30 s.

| attempt | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| un-jittered | 1 000 | 2 000 | 4 000 | 8 000 | 16 000 | 30 000 | 30 000 | 30 000 | 30 000 |

```
PASS  un-jittered sequence is 1s 2s 4s 8s 16s 30s 30s 30s 30s
PASS  the sequence is monotonically non-decreasing
PASS  nothing exceeds the 30 s cap
PASS  jittered delays stay in [0, 30000] with random()=0 (maximum negative jitter)
PASS  jittered delays stay in [0, 30000] with random()=1 (maximum positive jitter)
PASS  jitter actually varies the delay — 750 vs 10000 — without this, every client retries in lockstep
PASS  a negative attempt is clamped, not exponentiated downwards
```

The cap is reached on the sixth attempt. Jitter is not decoration: without it every client that
lost the same socket reconnects at the same instant, and the thundering herd is what keeps the
endpoint down.

### …and it is not what actually happens in a browser

**This is the correction that matters most in this document.** The table above describes
`nextBackoffDelay`, which is correct and unit-proven. It does **not** describe observed retry
timing, because `supabase-js` retries first in both failure modes and the hook's `attempt` counter
never climbs far enough to reach its own cap.

Measured in Chromium, both viewport projects, consistent across runs:

| Failure mode | Who retries | Observed gaps (ms) |
|---|---|---|
| **Transport dropped** (the common case) | `supabase-js` socket reconnect | `2015, 5017, 10010, 10007, 10018` — plateaus at **10 s** |
| **Join refused** on a healthy socket | phoenix channel rejoin, interleaved with the hook's | `1011, 167, 1014, 336, 1016, 1536, 1013, 1167, 1016, 2006, 5017, 3393, 1006` |

Two consequences, and neither is a defect:

- The effective cap is **10 s, not 30 s** — *tighter* than this application asks for, so nothing
  retries more slowly than intended.
- The refused-join case retries at **0.65–0.70 per second** over a 20 s window. Bounded, and not
  the tight loop `tasks/W2-D` warns about, but noticeably busier than a 1·2·4·8·16·30 s ladder
  would be. The sub-second gaps (167 ms, 336 ms) are duplicate joins: the hook and the library both
  react to the same `CHANNEL_ERROR`.

`e2e/realtime/coalescing-and-backoff.spec.ts` therefore asserts what is true — a **bounded rate**,
nothing exceeding the 30 s cap, growth in the transport ladder — and does not claim to prove a cap
it cannot observe. Widening the assertion until it passed either way would have been the easy
option and would have made the test worthless.

**For whoever owns this next:** if the 30 s ladder is wanted in practice, it belongs in
`createClient`'s options (`realtime: { reconnectAfterMs }`) rather than in a hook layered above the
library's own timer. That is a change to `lib/supabase/client.ts`, which W1-B owns, so it is filed
as a request rather than made here.

---

## Verification actually run

| Command | Result | Evidence |
|---|---|---|
| `pnpm --dir apps/web typecheck` | **PASS** | `tsc --noEmit`, no output, exit 0 |
| `pnpm --dir apps/web lint` | **PASS** | no output, exit 0 |
| `pnpm --dir apps/web build` | **PASS** | `✓ Compiled successfully in 21.1s`, exit 0 |
| `node … scripts/realtime-probe.mts` | **PASS** | `OK  93 pass · 0 fail`, exit 0 |
| `pnpm --dir apps/web test:e2e -- --project=chromium --project=mobile-chrome --workers=1 e2e/realtime e2e/pwa` | **PASS** | `28 passed (4.8m)`, exit 0 |
| `AZURA_E2E_MODE=prod pnpm --dir apps/web test:e2e -- --project=production --workers=1 e2e/production/live-harness-absent.spec.ts` | **PASS** | `5 passed (8.3s)`, exit 0 |

Exit codes captured directly, never through a pipe.

**`--workers=1` is not optional for `e2e/realtime`.** Every assertion there is about elapsed time
or committed renders, and two projects sharing one `next dev` recompile routes under each other —
a Fast Refresh navigation landed mid-measurement once, as
`page.evaluate: Execution context was destroyed`. That is the harness interfering with itself. The
fix is to stop measuring a moving target, not to widen tolerances until the noise fits inside them.

**The production run needs no `apps/web/.env.local`.** With a Supabase data plane configured *and*
the access-profile flags set, `assertAccessProfileSafety` refuses to start the process and every
route returns 500 — the isolation clause requires no data plane at all. That is W1-B's guard
working exactly as designed, and it is why W4-A's production suite passes in a fresh worktree,
where the gitignored env file does not exist.

### The brief's nine checks

| # | Check | Status |
|---|---|---|
| 1 | Realtime configured → `mode: "realtime"` | **PASS** — unit *and* browser: a completed handshake, and a real subscribe to the live project |
| 2 | Realtime killed mid-session → `polling` | **PASS** — the socket is closed mid-session in Chromium and the mode falls to `polling` |
| 3 | Supabase unconfigured → `static`, **zero requests** | **PASS** — browser-measured: 0 fetches and 0 `/api/` requests over six 500 ms intervals |
| 4 | `navigator.onLine = false` → `offline`, last-updated preserved | **PASS** — `context.setOffline(true)`; the timestamp is byte-identical across the transition and the error surfaces beside it |
| 5 | 40 rapid updates → **one** re-render | **PASS** — 40 real frames → **1 fetch, 4 commits** |
| 6 | Unmount → all channels closed | **PASS** — after unmount, 5 pushed frames reach nothing and no new socket is opened |
| 7 | Optimistic update + forced error → exact prior state | **PASS** — unit only; restored by value, and the restored array is a copy |
| 8 | SW caches **no** `/dashboard/*` URL | **PASS** — the worker ran; 57 cache entries enumerated, **zero** `/dashboard`, `/api` or `/login` |
| 9 | Reconnect backoff grows and caps at 30 s | **PASS as a pure function; DOES NOT DESCRIBE OBSERVED BEHAVIOUR.** See below — this is the finding. |

---

## The three browser proofs

Run against W4-A's Playwright harness. **28 tests across `chromium` + `mobile-chrome`, 28 passed,
0 failed, 0 skipped**, plus **5 passed** in the `production` project.

| Spec | What it proves |
|---|---|
| `e2e/realtime/live-modes.spec.ts` | 5 tests — the four modes, each reached by a real cause, plus unmount teardown |
| `e2e/realtime/coalescing-and-backoff.spec.ts` | 4 tests — 40→1 coalescing, a second burst not swallowed, and both retry ladders |
| `e2e/realtime/live-supabase.spec.ts` | 1 test — a real subscribe against the real project |
| `e2e/pwa/service-worker.spec.ts` | 4 tests — registration, control, the cache enumeration, and the no-queue guarantee |
| `e2e/production/live-harness-absent.spec.ts` | 5 tests — the harness 404s in a production build, in all four locales, *with the access-profile flags on* |

### The harness

`apps/web/app/[locale]/dev/live-harness` mounts `useLiveSnapshot` and exposes committed-render and
fetch counts on `window.__azuraHarness`. It supplies **only the fetcher**; the hook, the channel,
the coalescer, `resolveLiveMode`, `SyncBadge` and `ConnectionBanner` are the shipped code.

It is gated on `process.env.NODE_ENV === "production"`, a build-time constant the bundler inlines,
so no flag, cookie or header can bring it back in production. The first version gated it on
`accessProfilesEnabledForEnvironment()` instead, to avoid a second copy of a security decision —
that was **wrong**, and instructively so: the policy module throws at load when the access-profile
flags are set in production, which is exactly the combination `playwright.config.ts` sets for the
production server. The route returned **500** rather than 404. Reusing a shared gate is usually
right; it is not right when the shared module fails loudly by design and this route must fail
quietly.

### Realtime has now connected

```
[live] realtime sockets dialled: 1 — wss://mwpswwnfbmelvgjwlojx.supabase.co/realtime/v1/websocket?…&vsn=2.0.0
[live] mode=realtime source=supabase fetches=2
```

**The `supabase_realtime` publication includes `units`.** W1-A's migration 12 is deployed to the
cloud project, which this document previously listed as unverified. The "publication missing" edge
case is not live.

That test **reads only**. It subscribes; it inserts, updates and deletes nothing. The forty-frame
burst is measured against a stubbed socket precisely so the shared project is not mutated to
satisfy a test.

### Why the socket is stubbed for the burst and the ladders

`e2e/realtime/realtime-stub.ts` replaces the far end of the WebSocket and nothing above it.
Forty genuine changes would mean forty writes to a shared cloud project this window has no
authorisation to mutate, and they would not land inside the 400 ms coalescing window over the
public internet anyway.

The protocol was **read off a real handshake, not assumed**. `realtime-js` 2.110.8 dials with
`vsn=2.0.0`, whose serializer is positional arrays — `[join_ref, ref, topic, event, payload]` —
not the object form the v1 documentation shows. The first stub replied in the object form; every
frame was silently discarded, the client re-joined under a new topic, and the mode sat at
`polling`, which looks exactly like a broken feature.

---

## Contracts I consumed

| Contract | Fitted? |
|---|---|
| §4 `RepositoryResult<T>` | Yes — `useLiveSnapshot` is generic over it, so it works with any W2-A repository without importing one. |
| §5 `ApiResponse` / `ApiError` | Yes, in `useOptimisticMutation`. |
| §7 `Locale` | Yes, in the badge and banner. |

**No contract needed amending. `CONTRACT_VERSION` stays 1.**

---

## Decisions I made

**`subscribing` reads as `polling`, not as `realtime`.** A channel that has not finished
subscribing is not delivering updates. Showing "Live" while nothing arrives is exactly the silent
stall this whole task exists to prevent, so the mode only claims `realtime` once the socket has
confirmed.

**`local-seed` forces `static` even when Supabase is configured.** The repository is authoritative
about what it returned. A configured-but-seeded response means the data on screen is not live, and
the badge must say so regardless of what the environment claims.

**`realtime` does not poll either.** `shouldPoll` is true for exactly one mode. A realtime channel
that is healthy already refetches on change; a belt-and-braces 30 s poll on top would double the
request volume to detect nothing.

**The badge is self-contained.** No import from `components/ui/*` (W1-D) and Tailwind utility
classes rather than design tokens, so it renders identically whether or not `globals.css` has
loaded. The one place a component must not silently render wrong is the one that says "this is
demo data".

**`static` gets the loudest visual treatment.** Filled amber, bordered, bold. Colour is never the
only signal — every mode carries an icon and a word — because roughly one man in twelve cannot
distinguish the green from the amber, and because a screenshot in a status report loses the
tooltip.

**Hook state is derived, not assigned in effect bodies.** `useRealtimeChannel` holds
`socketStatus: RealtimeStatus | null` and derives the public `status`. That is not a lint
workaround: a synchronous `setState` in an effect body causes a cascading render on every mount,
and "we are attempting to subscribe" is already implied by the effect having started. Every
remaining `setSocketStatus` runs from an asynchronous callback, which is where a status change
genuinely originates. Refs are synced in effects for the same reason — a ref written during render
is a tearing hazard under concurrent React.

**`start_url` is `/de`, not `/`.** `localePrefix: "always"` makes `/` a redirect, and an installed
app whose entry point is a 307 shows a blank frame for that round trip on every cold start.

**`scope` is `/`.** A narrower scope sounds safer and is the opposite: an uncontrolled path falls
through to the browser's ordinary HTTP cache, which this code cannot govern at all. The worker
needs control of the whole origin in order to *refuse*.

**`offline.html` uses a link, not a button with `onclick`.** CONVENTIONS §4 forbids
`unsafe-inline` in `script-src`, and an inline event-handler attribute is blocked by exactly that
directive — a retry button would silently do nothing the moment the page were served with the
app's CSP. Navigating to the start URL has the same effect with no script at all.

**No `skipWaiting()` on install.** A new worker waits; the page can ask for the upgrade with an
`AZURA_SKIP_WAITING` message. Hot-swapping the bundle under an open form is how a PWA eats a
half-filled form.

---

## Requests for other windows

| File | Owner | What is needed |
|---|---|---|
| `apps/web/app/layout.tsx` | **W0-A** | register the service worker, and link the manifest. Next emits `/manifest.webmanifest` from `app/manifest.ts` automatically, but the worker needs one line: `navigator.serviceWorker.register("/sw.js")` behind a `"serviceWorker" in navigator` guard, in a client component. **Do not register it before W4-A has an e2e test for the cache boundary** — an unregistered worker caches nothing, which is the safe default. |
| `package.json` | **W0-A** | `"qa:realtime": "node --experimental-strip-types --import ./scripts/register-ts-resolve.mjs scripts/realtime-probe.mts"`. Third of three; see also `smoke:rbac` (W1-B) and `qa:ai-probe` (W2-C). |
| ~~`apps/web/e2e/*`~~ | ~~W4-A~~ | **Done, by this window.** The three runtime checks are written and green — see §"The three browser proofs". |
| `apps/web/.env.local` | **W0-A** | **`NEXT_PUBLIC_SUPABASE_*` never reached the browser.** The repository's `.env.local` is at the **repo root**; Next loads env from its own project root, `apps/web`. Any dev server started the documented way (`pnpm --dir apps/web dev`, cwd `apps/web`) therefore ran with no Supabase URL in the client bundle, `isSupabaseConfigured()` was false in the browser, and every live surface would have reported `static` — which is *why* realtime had never connected. Worked around locally by placing a copy at `apps/web/.env.local`; the real fix is either to move it or to have `next.config.ts` load the root file. **Do not put the access-profile flags in that file** — with `NODE_ENV=production` they make `next build` fail W1-B's safety assert, correctly. |
| `apps/web/lib/supabase/client.ts` | **W1-B** | If the 30 s reconnect ladder is wanted in practice, set `realtime: { reconnectAfterMs }` on `createClient`. As shipped, `supabase-js` retries on its own schedule (10 s plateau) and the hook's ladder is largely bypassed — measured, see §"…and it is not what actually happens in a browser". |
| `apps/web/public/media/*` | **W0-D** | PWA icons (192, 512, maskable). `app/manifest.ts` currently ships `favicon.ico` only — an entry pointing at a missing file fails installability silently, so the list is sparse on purpose. |
| dashboard surfaces | **W3-B … W3-G** | render `<SyncBadge>` on every live data surface and `<ConnectionBanner>` once per page. A surface that shows data with no mode indicator is the failure this task was written to prevent. |

---

## Known gaps

- ~~**`[GAP]` No hook has ever been rendered.**~~ **CLOSED.** `useLiveSnapshot` is mounted and
  driven; subscription lifecycle, the polling timer, the offline transition and the abort on
  unmount are all exercised.
- ~~**`[GAP]` The service worker has never run.**~~ **CLOSED.** It registers, activates, controls
  the page, and its cache was enumerated. It is still not registered by the application — that
  request to W0-A stands, and it was deliberately gated on this test existing.
- ~~**`[GAP]` Realtime has never connected.**~~ **CLOSED.** A channel subscribes to `units` against
  the live project. The publication exists; the "publication missing" edge case is not live.
- **`[GAP]` Still no React unit-test environment.** Everything above is proved through a browser,
  which is the right tool for effects and the wrong one for a fast feedback loop. A change to a
  hook is still 45 seconds from being checked.
- **`[GAP]` Check 7 (optimistic rollback) is unit-proved only.** `useOptimisticMutation` has never
  been rendered either. It was not in this window's brief for the browser pass and no surface
  consumes it yet, so there was nothing to mount it against.
- **`[GAP]` The burst and the ladders are measured against a stubbed socket.** The transport is
  replaced; everything above it is real. Producing forty genuine changes means forty writes to a
  shared cloud project, which this window is not authorised to make. `live-supabase.spec.ts` covers
  the complementary claim — that the real endpoint accepts a real connection — so neither the
  transport nor the deployment is left unproven, but no single test covers both at once.
- **Deferred edge case — laptop sleep/wake.** Supabase's client sends its own heartbeats and
  surfaces a dead socket as `CLOSED` or `TIMED_OUT`, both of which trigger the backoff path here.
  No additional heartbeat was added on top; adding a second one without observing the first would
  be guessing.
- **Deferred edge case — two tabs.** Each holds its own channel, as the brief instructs. No
  cross-tab coordination was attempted.
- **Deferred — "never render a payload without re-checking scope client-side".** Structurally
  satisfied by never reading a payload at all: `onChange` takes no argument, so there is nothing
  to render. If a later window adds payload-carrying handlers, that guarantee is gone and the
  client-side scope check becomes mandatory.
- **`app/manifest.ts` icon set is one `favicon.ico`.** Installability will warn until W0-D
  supplies a maskable 512×512.
- **The badge's relative time uses locale-agnostic units** (`s`, `min`, `h`) so it needs no message
  catalogue and cannot drift from W1-C's translations. If W1-C later wants
  `Intl.RelativeTimeFormat`, the seam is `relativeAge` in `lib/realtime.ts`.
