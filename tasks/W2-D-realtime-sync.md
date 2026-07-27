# W2-D — Realtime, sync, offline posture

**Wave:** 2 · **Depends on:** W1-A, W2-A · **Blocks:** W3-B · **Runs with:** W2-A, W2-B, W2-C

> Read `SYSTEM-PROMPT.md`, `CONVENTIONS.md`. Then read
> `D:\Real Estate CRM\Cati\apps\web\hooks\use-live-dashboard-snapshot.ts` and
> `components\sync-badge.tsx`, plus migration `…0004_realtime_operational_dashboard.sql`.

---

## Mission

Live data where it is available, honest degradation where it is not, and a visible indicator of
which mode the user is actually in. The pattern from 1Çatı: **Supabase Realtime where configured,
30-second polling fallback, and a badge that tells the truth about which one is running.**

The honesty requirement matters more than the liveness. A dashboard that silently stopped
updating is worse than one that says "polling, last updated 30s ago".

---

## Files you own

```
apps/web/hooks/use-live-snapshot.ts · use-realtime-channel.ts
apps/web/hooks/use-connection-status.ts · use-optimistic-mutation.ts
apps/web/components/sync-badge.tsx · components/connection-banner.tsx
apps/web/lib/realtime.ts · apps/web/lib/pwa.ts
apps/web/app/manifest.ts · apps/web/public/sw.js
HANDOFF/W2-D.md
```

---

## Deliverables

### 1. `hooks/use-live-snapshot.ts`

```ts
export function useLiveSnapshot<T>(config: {
  fetcher: () => Promise<RepositoryResult<T>>
  channels?: RealtimeChannelConfig[]
  pollIntervalMs?: number      // default 30_000
  enabled?: boolean
}): {
  data: T | null
  source: "supabase" | "local-seed" | null
  mode: "realtime" | "polling" | "static" | "offline"
  lastUpdated: string | null
  error: ApiError | null
  isStale: boolean
  refresh: () => Promise<void>
}
```

Mode resolution:
- Realtime subscribed and healthy → `realtime`
- Realtime unavailable or dropped → `polling`
- Supabase unconfigured → `static` (seed data, no polling — polling seed data is pointless churn)
- Browser offline → `offline`

### 2. `components/sync-badge.tsx`

Shows the mode plainly, with a relative timestamp. Colour is **not** the only signal — include
text and an icon, for colour-blind users and for screenshots.

| Mode | Shown |
|---|---|
| `realtime` | "Live" + pulse |
| `polling` | "Aktualisiert alle 30 s · vor 12 s" |
| `static` | "Demo-Daten" — **must be unmistakable** |
| `offline` | "Offline · Stand vor 4 min" |

`static` is the one that must never be missable. A demo showing seed data that reads as live
production data is the kind of thing that gets promised to a client by mistake.

### 3. Realtime channels

Subscribe only to dashboard-relevant tables (W1-A migration 12): units, findings, tickets,
activities, ledger entries, leads, notifications.

- **Debounce**: burst of 40 unit updates → one re-render, not 40.
- **Reconnect with exponential backoff + jitter**, capped at 30s. Never a tight retry loop.
- **Unsubscribe on unmount.** Leaked channels exhaust the connection pool and the symptom appears
  three pages later, which makes it expensive to diagnose.
- **Never trust a realtime payload as authoritative.** It is an invalidation signal. On reconnect,
  refetch — do not replay a buffered queue into state.

### 4. Optimistic mutations

```ts
export function useOptimisticMutation<TInput, TResult>(config: {
  mutate: (input: TInput) => Promise<ApiResponse<TResult>>
  optimisticUpdate: (current: TResult[], input: TInput) => TResult[]
  rollbackOnError?: boolean       // default true
}): { execute; isPending; error }
```

Rollback must restore the **exact** prior state, not a refetch — a refetch can race with another
concurrent change and produce a state neither the user nor the server intended.

### 5. PWA — deliberately conservative

Mirror 1Çatı's boundary exactly, and do not exceed it:

- Manifest, installable, offline fallback page for **public routes only**
- **No protected page in the cache. Ever.** A cached `/dashboard/finance` is a data leak on a
  shared device.
- **No persistent offline mutation queue.** 1Çatı's status document is explicit that this is not
  built and must not be claimed. Do not build it here either — a half-working sync queue
  silently loses writes.
- Service worker: network-first for HTML, cache-first for hashed static assets only.
- A versioned cache name and a clean upgrade path, or users get stuck on a stale bundle forever.

---

## Edge cases

- **Tab backgrounded** → pause polling; resume and refetch immediately on focus. Polling a hidden
  tab for hours wastes the user's battery and your quota.
- **Laptop sleep/wake** → the socket is dead but reports open. Heartbeat, detect, reconnect.
- **Clock skew** → "last updated" from server time, never `Date.now()` alone.
- **Realtime message for a row the user may not see** → RLS filters at the database, but verify;
  never render a payload without re-checking scope client-side.
- **Two tabs** → each holds its own channel. Do not attempt cross-tab coordination; it is a
  BroadcastChannel rabbit hole with little payoff here.
- **Poll overlapping a slow response** → in-flight guard; never stack requests.
- **Offline → online** → single refetch, not one per subscribed channel.
- **Seed mode + `mode: "static"`** → do **not** poll. There is nothing to poll.
- **Realtime configured but the publication missing** (migration not deployed) → detect, fall back
  to polling, log a `degradedReason`. This exact drift exists in the reference project, where
  cloud sits at migration 53 and local at 63.
- **Service worker upgrade** while the app is open → prompt to reload, never hot-swap under the user.
- **`prefers-reduced-motion`** → the live pulse must not animate.

---

## Definition of done

```bash
pnpm --dir apps/web typecheck
pnpm --dir apps/web lint
pnpm --dir apps/web build
```

Plus, output pasted:

1. Realtime configured → `mode: "realtime"`, badge shows Live
2. Realtime killed mid-session → falls back to `polling` within one interval, badge updates
3. Supabase unconfigured → `mode: "static"`, **no network polling** (assert zero requests)
4. `navigator.onLine = false` → `mode: "offline"`, last-updated preserved
5. 40 rapid updates → **one** re-render (assert the count)
6. Unmount → all channels closed (assert via the client's channel list)
7. Optimistic update + forced server error → exact prior state restored
8. Service worker caches **no** `/dashboard/*` URL — enumerate the cache and assert empty
9. Reconnect backoff measured: intervals grow and cap at 30s

Test 3 and test 8 are the ones that matter. Test 8 is a privacy control.

---

## Handoff must state

- The `useLiveSnapshot` API — W3-B and every live surface consumes it
- Which tables are realtime-subscribed
- The exact PWA caching boundary, and proof no protected route is cached
- Measured reconnect backoff sequence
- Explicitly: **no offline mutation queue exists.** Say it, so nobody claims it later.
