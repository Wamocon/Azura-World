"use client"

/**
 * The mount point that closes W2-D's largest gap.               Owner: W2-D
 *
 * `HANDOFF/W2-D.md` recorded it plainly: *"No hook has ever been rendered."*
 * Every decision this feature makes was deliberately pushed down into
 * `lib/realtime.ts` so it could be proved by a pure probe, and 93 assertions do
 * prove it — but the part that remained in the hooks is effect wiring, and
 * effect wiring is exactly what a pure probe cannot reach: the subscription
 * lifecycle, the polling timer, the focus handler, the abort on unmount.
 *
 * This page renders `useLiveSnapshot` for real, in a real browser, and exposes
 * what it did so a Playwright spec can assert on it.
 *
 * ## What is real here and what is arranged
 *
 * Real: the hook, `useRealtimeChannel`, `createCoalescer`, the Supabase client,
 * the socket, `resolveLiveMode`, `SyncBadge`, `ConnectionBanner`, and React's
 * own commit behaviour. None of it is re-implemented.
 *
 * Arranged: the **fetcher**, because a harness needs a repository result it can
 * vary — `?source=local-seed` is how the `static` branch is reached, and that is
 * a real branch of `resolveLiveMode` (*"the repository is authoritative about
 * what it returned"*), not a switch invented for the test.
 *
 * ## Why the counters are effects, not render-body increments
 *
 * A counter incremented during render is a side effect in render, which under
 * React 19's compiler and concurrent rendering may run more than once per commit
 * for reasons that have nothing to do with the data. `useEffect` with **no**
 * dependency array runs after every committed render, which is precisely the
 * thing "40 updates must cause one re-render" is a claim about.
 *
 * Strict mode double-invokes effects on mount in development, and this page only
 * exists in development. So the specs measure **deltas across an action**, never
 * absolute counts — see `e2e/realtime/live-modes.spec.ts`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { ConnectionBanner } from "@/components/connection-banner"
import { SyncBadge } from "@/components/sync-badge"
import { useLiveSnapshot } from "@/hooks/use-live-snapshot"
import type { RealtimeChannelConfig } from "@/lib/realtime"
import type { RepositoryResult } from "@/lib/contracts"
import type { Locale } from "@/lib/contracts"

interface HarnessPayload {
  rows: number
}

export interface HarnessCounters {
  /** Committed renders of this component. */
  commits: number
  /** Calls to the fetcher — i.e. refetches the hook decided to make. */
  fetches: number
  mode: string
  source: string | null
  lastUpdated: string | null
  isStale: boolean
}

declare global {
  interface Window {
    /** Read by `e2e/realtime/*.spec.ts`. Present only on this page. */
    __azuraHarness?: {
      counters: () => HarnessCounters
      /** Zero the counters so a spec can measure a delta across one action. */
      reset: () => void
      /** Unmount the hook, so channel teardown can be observed. */
      unmount: () => void
    }
  }
}

export function LiveHarnessClient({
  locale,
  source,
  tables,
  pollIntervalMs,
}: {
  locale: Locale
  source: "supabase" | "local-seed"
  tables: readonly string[]
  pollIntervalMs: number
}): React.JSX.Element {
  const [mounted, setMounted] = useState(true)

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-6 font-sans">
      <h1 className="text-xl font-semibold">Live snapshot harness</h1>
      <p className="text-sm text-neutral-600">
        Development-only. Renders <code>useLiveSnapshot</code> so its effect wiring can be
        observed from a browser.
      </p>

      <button
        type="button"
        data-testid="unmount"
        onClick={() => setMounted(false)}
        className="w-fit rounded border px-3 py-1 text-sm"
      >
        Unmount
      </button>

      {mounted ? (
        <HarnessSubject
          locale={locale}
          source={source}
          tables={tables}
          pollIntervalMs={pollIntervalMs}
          onUnmountRequest={() => setMounted(false)}
        />
      ) : (
        <p data-testid="unmounted">unmounted</p>
      )}
    </main>
  )
}

function HarnessSubject({
  locale,
  source,
  tables,
  pollIntervalMs,
  onUnmountRequest,
}: {
  locale: Locale
  source: "supabase" | "local-seed"
  tables: readonly string[]
  pollIntervalMs: number
  onUnmountRequest: () => void
}): React.JSX.Element {
  const commits = useRef(0)
  const fetches = useRef(0)

  /**
   * A repository-shaped result.
   *
   * `fetchedAt` is generated here rather than taken from `Date.now()` at render
   * time on purpose: the hook is specified to display the **server's**
   * `fetchedAt`, and a spec asserts that the badge's timestamp tracks this value
   * and not the browser clock.
   */
  const fetcher = useCallback(async (): Promise<RepositoryResult<HarnessPayload>> => {
    fetches.current += 1
    // A real repository call fails when the browser is offline, and the hook's
    // catch is what keeps the last good data and its timestamp on screen. A
    // harness fetcher that cheerfully succeeded offline would hand back a fresh
    // `fetchedAt` and make the "last updated is preserved" claim untestable —
    // it would look preserved only because nothing had gone wrong.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new Error("harness: offline")
    }
    return {
      data: { rows: fetches.current },
      source,
      fetchedAt: new Date().toISOString(),
      ...(source === "local-seed"
        ? { degradedReason: "harness: seed source requested" }
        : {}),
    }
  }, [source])

  // Stable across renders, so the subscription is not torn down and rebuilt on
  // every commit — which would look like a flapping connection to the badge.
  const channels = useMemo<readonly RealtimeChannelConfig[]>(
    () => tables.map((table) => ({ table }) as RealtimeChannelConfig),
    [tables]
  )

  const snapshot = useLiveSnapshot<HarnessPayload>({
    fetcher,
    channels,
    pollIntervalMs,
    channelName: "harness",
  })

  // No dependency array: this is a commit counter, and it must run after every
  // committed render or it is measuring something else.
  useEffect(() => {
    commits.current += 1
  })

  useEffect(() => {
    window.__azuraHarness = {
      counters: () => ({
        commits: commits.current,
        fetches: fetches.current,
        mode: snapshot.mode,
        source: snapshot.source,
        lastUpdated: snapshot.lastUpdated,
        isStale: snapshot.isStale,
      }),
      reset: () => {
        commits.current = 0
        fetches.current = 0
      },
      unmount: onUnmountRequest,
    }
    return () => {
      delete window.__azuraHarness
    }
  }, [snapshot, onUnmountRequest])

  return (
    <>
      <SyncBadge mode={snapshot.mode} lastUpdated={snapshot.lastUpdated} locale={locale} />
      <ConnectionBanner
        mode={snapshot.mode}
        isStale={snapshot.isStale}
        lastUpdated={snapshot.lastUpdated}
        locale={locale}
        onRetry={() => void snapshot.refresh()}
      />

      {/*
        The machine-readable mirror. The badge is the human surface and a spec
        asserts on it too, but a spec that could only read rendered German text
        would break the moment W1-C rewords a string — and the mode is the thing
        under test, not the copy.
      */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm" data-testid="state">
        <dt>mode</dt>
        <dd data-testid="mode">{snapshot.mode}</dd>
        <dt>source</dt>
        <dd data-testid="source">{snapshot.source ?? "null"}</dd>
        <dt>lastUpdated</dt>
        <dd data-testid="last-updated">{snapshot.lastUpdated ?? "null"}</dd>
        <dt>isStale</dt>
        <dd data-testid="is-stale">{String(snapshot.isStale)}</dd>
        <dt>error</dt>
        <dd data-testid="error">{snapshot.error?.code ?? "none"}</dd>
      </dl>
    </>
  )
}
