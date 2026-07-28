# HANDOFF — W2-D Realtime, sync, offline posture

STATUS: PARTIAL
Completed: 2026-07-27
Window: 2 (stretch, after W1-B → W2-C) · Branch: `feature/INTERNAL-107-w1b-w2c-auth-ai` · Commit: `bb90784`

**PARTIAL, and precisely so:** every deliverable in the brief is built and typechecks, and 6 of
the 9 required proofs are executable and green. The other 3 need a live browser — a channel
actually closing on unmount, a real Cache Storage enumeration, and a real socket dropping
mid-session — and there is no Playwright config in this repository yet (W4-A owns it). They are
listed as **NOT RUN** below rather than approximated by something that would look like a test and
not be one.

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
  fetcher: () => Promise<RepositoryResult<T>>;
  channels?: readonly RealtimeChannelConfig[]; // default []
  pollIntervalMs?: number; // default 30_000
  enabled?: boolean; // default true
  channelName?: string; // default "live-snapshot"
}): {
  data: T | null;
  source: "supabase" | "local-seed" | null;
  mode: "realtime" | "polling" | "static" | "offline";
  lastUpdated: string | null; // the server's RepositoryResult.fetchedAt
  error: ApiError | null;
  isStale: boolean;
  refresh: () => Promise<void>;
};
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
a policy bug on a published table leaks _continuously_ rather than on request. That is why the
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

| Class                                        | Strategy                                              |
| -------------------------------------------- | ----------------------------------------------------- |
| any non-`GET`                                | **never**                                             |
| cross-origin                                 | **never**                                             |
| any path matching the deny-list              | **never**                                             |
| `/_next/static/**`, `/fonts/**`, `/media/**` | cache-first                                           |
| everything else                              | network-first, cached only on a successful navigation |

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
that _decides_ what enters the cache, over the whole class of inputs, rather than sampling one
browser's cache after one session.

**The service worker's copy cannot drift.** `public/sw.js` cannot import an application module, so
it carries a duplicate of the policy — and the probe reads the file and asserts every pattern from
`PROTECTED_PATH_PATTERNS` appears in it, that the deny-list is checked before the static-prefix
rule, that `skipWaiting()` is never called unconditionally, and that there is no background-sync
handler, no `indexedDB` and no push handler.

### There is NO offline mutation queue

Stated plainly, because the brief asks for it to be stated so nobody claims it later:

**No offline mutation queue exists. It is not built, not started, and not partially present.** A
half-working sync queue loses writes silently, which is worse than refusing them while offline.
`components/connection-banner.tsx` tells the user so in all four languages — "Änderungen können
jetzt nicht gespeichert werden — sie werden auch nicht zwischengespeichert und später gesendet" —
and `public/offline.html` repeats it. The probe asserts the service worker has no `sync` handler,
no `periodicsync` handler and no IndexedDB usage.

---

## Measured reconnect backoff

`nextBackoffDelay(attempt, random)` — base 1 s, doubling, ±25 % jitter, hard cap 30 s.

| attempt     | 0     | 1     | 2     | 3     | 4      | 5      | 6      | 7      | 8      |
| ----------- | ----- | ----- | ----- | ----- | ------ | ------ | ------ | ------ | ------ |
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

---

## Verification actually run

| Command                                                                                                                  | Result   | Evidence                          |
| ------------------------------------------------------------------------------------------------------------------------ | -------- | --------------------------------- |
| `pnpm --dir apps/web typecheck`                                                                                          | **PASS** | `tsc --noEmit`, no output, exit 0 |
| `npx eslint hooks components/sync-badge.tsx components/connection-banner.tsx lib/realtime.ts lib/pwa.ts app/manifest.ts` | **PASS** | no output, exit 0                 |
| `node … scripts/realtime-probe.mts`                                                                                      | **PASS** | `OK  93 pass · 0 fail`, exit 0    |

### The brief's nine checks

| #   | Check                                                          | Status                                                                                                                                                            |
| --- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Realtime configured → `mode: "realtime"`                       | **PASS** — `resolveLiveMode` asserted                                                                                                                             |
| 2   | Realtime killed mid-session → `polling`                        | **PASS** for the decision (`error`, `closed`, `subscribing` all → `polling`). **NOT RUN** as a live socket drop.                                                  |
| 3   | Supabase unconfigured → `static`, **zero requests**            | **PASS** — `shouldPoll("static") === false`, and exactly one of the four modes polls                                                                              |
| 4   | `navigator.onLine = false` → `offline`, last-updated preserved | **PASS** — offline outranks every other mode; `lastUpdated` is held in state and never cleared on failure                                                         |
| 5   | 40 rapid updates → **one** re-render                           | **PASS** — 40 signals, 40 timer resets, exactly 1 run; a later burst runs again                                                                                   |
| 6   | Unmount → all channels closed                                  | **PARTIAL.** `cancel()` dropping pending work is asserted; the `supabase.removeChannel` call is in the effect cleanup and is **NOT RUN** — it needs a live client |
| 7   | Optimistic update + forced error → exact prior state           | **PASS** — restored by value, and the restored array is a copy, not the caller's reference                                                                        |
| 8   | SW caches **no** `/dashboard/*` URL                            | **PASS** — 15 protected URLs, 3 near-misses, non-GET, cross-origin, unparseable; plus the sw.js drift guard                                                       |
| 9   | Reconnect backoff grows and caps at 30 s                       | **PASS** — table above                                                                                                                                            |

**NOT RUN, and why:**

- **A live socket drop (check 2's runtime half)** and **channel teardown on unmount (check 6)**
  need a browser with a real Supabase client. No Playwright config exists yet.
- **A real Cache Storage enumeration (check 8's runtime half).** The predicate is proved
  exhaustively; what is unproven is that `public/sw.js` executes it as written in a real browser.
- ~~`pnpm --dir apps/web build`~~ — **now RUN and PASSING.** It was skipped at commit time because
  the tree failed `lint` on six errors in W1-D / W3-I work in progress; that window fixed them and
  the build was re-run at 20:05. Exit 0, and `○ /manifest.webmanifest` appears in the route table,
  so `app/manifest.ts` is emitted as a static asset as intended. The service worker is a plain
  file in `public/` and is not part of the build graph — its presence in the output proves nothing
  about it, which is why the gap below still stands.
- **No hook has been rendered.** There is no React test environment in this repository. Everything
  provable without one was moved into `lib/realtime.ts`, `lib/pwa.ts` and
  `resolveMutationOutcome` precisely so it could be proved; what remains in the hooks is
  effect wiring, and that is genuinely untested.

---

## Contracts I consumed

| Contract                      | Fitted?                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| §4 `RepositoryResult<T>`      | Yes — `useLiveSnapshot` is generic over it, so it works with any W2-A repository without importing one. |
| §5 `ApiResponse` / `ApiError` | Yes, in `useOptimisticMutation`.                                                                        |
| §7 `Locale`                   | Yes, in the badge and banner.                                                                           |

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
needs control of the whole origin in order to _refuse_.

**`offline.html` uses a link, not a button with `onclick`.** CONVENTIONS §4 forbids
`unsafe-inline` in `script-src`, and an inline event-handler attribute is blocked by exactly that
directive — a retry button would silently do nothing the moment the page were served with the
app's CSP. Navigating to the start URL has the same effect with no script at all.

**No `skipWaiting()` on install.** A new worker waits; the page can ask for the upgrade with an
`AZURA_SKIP_WAITING` message. Hot-swapping the bundle under an open form is how a PWA eats a
half-filled form.

---

## Requests for other windows

| File                      | Owner           | What is needed                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/layout.tsx` | **W0-A**        | register the service worker, and link the manifest. Next emits `/manifest.webmanifest` from `app/manifest.ts` automatically, but the worker needs one line: `navigator.serviceWorker.register("/sw.js")` behind a `"serviceWorker" in navigator` guard, in a client component. **Do not register it before W4-A has an e2e test for the cache boundary** — an unregistered worker caches nothing, which is the safe default. |
| `package.json`            | **W0-A**        | `"qa:realtime": "node --experimental-strip-types --import ./scripts/register-ts-resolve.mjs scripts/realtime-probe.mts"`. Third of three; see also `smoke:rbac` (W1-B) and `qa:ai-probe` (W2-C).                                                                                                                                                                                                                             |
| `apps/web/e2e/*`          | **W4-A**        | the three runtime checks named above: channel teardown on unmount, a live socket drop, and a Cache Storage enumeration asserting no `/dashboard` key. The last is a **privacy control** and deserves a dedicated spec.                                                                                                                                                                                                       |
| `apps/web/public/media/*` | **W0-D**        | PWA icons (192, 512, maskable). `app/manifest.ts` currently ships `favicon.ico` only — an entry pointing at a missing file fails installability silently, so the list is sparse on purpose.                                                                                                                                                                                                                                  |
| dashboard surfaces        | **W3-B … W3-G** | render `<SyncBadge>` on every live data surface and `<ConnectionBanner>` once per page. A surface that shows data with no mode indicator is the failure this task was written to prevent.                                                                                                                                                                                                                                    |

---

## Known gaps

- **`[GAP]` No hook has ever been rendered.** The largest gap. All decision logic was deliberately
  moved out of the hooks so it could be proved, but the effect wiring — subscription lifecycle,
  the polling timer, focus handling, the abort on unmount — is untested.
- **`[GAP]` The service worker has never run.** It is not registered anywhere yet (see the request
  to W0-A), so no browser has executed it. Its policy is proved; its execution is not.
- **`[GAP]` Realtime has never connected.** Supabase is configured and W1-A applied migration 12,
  but no client has subscribed. The publication's existence has not been verified from the app
  side. **This is the "publication missing" edge case in the brief** — the code detects it
  (a channel error triggers backoff and the mode falls to `polling`), but the detection has not
  been observed.
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
