"use client"

import { RotateCw } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"

import { useRouter } from "@/app/navigation"
import { useConnectionStatus } from "@/hooks/use-connection-status"
import { Button } from "@/components/ui/button"
import { SyncBadge } from "@/components/sync-badge"
import type { Locale } from "@/lib/contracts"
import type { LiveMode } from "@/lib/realtime"

/**
 * Freshness and refresh for the server-rendered dashboard home.
 *                                                          Owner: W3-B
 *
 * DIVERGENCE FROM THE BRIEF, STATED RATHER THAN BURIED. The brief says "every
 * KPI card renders through `useLiveSnapshot`". It cannot today, and the reason
 * is structural rather than a shortcut:
 *
 * `useLiveSnapshot` takes `fetcher: () => Promise<RepositoryResult<T>>` and
 * runs it in the browser. Every W2-A repository reaches
 * `lib/supabase/server.ts`, which imports `next/headers` and **throws at module
 * load in a browser** — deliberately, so the service-role key cannot be
 * bundled. So a client fetcher needs an HTTP route, and
 * `app/api/site-management/*` is W2-B's, which W-INT §8 records as not started.
 *
 * The options were: invent an API route in a file this task does not own; ship
 * KPI cards with no freshness indicator; or server-render the snapshot and
 * refresh it through the framework. The third is chosen, and it is not a
 * downgrade — `router.refresh()` re-runs the Server Component, so the refetch
 * goes through the repository and therefore through RLS, which is exactly the
 * property W2-D's handoff insists on when it says a realtime payload is never
 * read directly.
 *
 * What is genuinely lost: realtime push. The mode can reach `polling`,
 * `static` and `offline`, never `realtime`. That is reported honestly by the
 * badge rather than claimed — and claiming "Live" while nothing arrives is the
 * exact silent stall W2-D built the badge to prevent. When W2-B lands, a module
 * swaps this for `useLiveSnapshot` and the badge starts reporting `realtime`.
 */

const POLL_INTERVAL_MS = 30_000

export function DashboardHomeLive({
  source,
  fetchedAt,
  locale,
  refreshLabel,
}: {
  /** From the server's `RepositoryResult`. Authoritative about what was returned. */
  source: "supabase" | "local-seed"
  /** `RepositoryResult.fetchedAt` — the server's clock, never the browser's. */
  fetchedAt: string
  locale: Locale
  refreshLabel: string
}): ReactNode {
  const router = useRouter()
  const connection = useConnectionStatus()
  const [refreshing, setRefreshing] = useState(false)

  /**
   * Mode, in the same precedence W2-D established.
   *
   * `offline` outranks everything — nothing is fresh without a network.
   * `local-seed` forces `static` even when Supabase is configured, because the
   * repository is authoritative about what it actually returned, and seed data
   * that says "updated 3 s ago" is a lie.
   */
  const mode: LiveMode = !connection.online
    ? "offline"
    : source === "local-seed"
      ? "static"
      : "polling"

  // `static` creates no timer at all — seed data does not change, so polling it
  // is pure churn. A backgrounded tab does not poll either; `useConnectionStatus`
  // reports visibility, and a ticker running in a hidden tab for an hour is a
  // battery bug.
  useEffect(() => {
    if (mode !== "polling" || !connection.visible) return

    const timer = window.setInterval(() => {
      router.refresh()
    }, POLL_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [mode, connection.visible, router])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SyncBadge mode={mode} lastUpdated={fetchedAt} locale={locale} />
      <Button
        variant="outline"
        size="sm"
        data-testid="dashboard-refresh"
        onClick={() => {
          setRefreshing(true)
          router.refresh()
          // `router.refresh()` gives no completion signal, so the spinner is
          // released on a timer rather than left spinning forever. A control
          // that never resolves is worse than one that resolves early.
          window.setTimeout(() => setRefreshing(false), 600)
        }}
      >
        <RotateCw
          className={refreshing ? "animate-spin motion-reduce:animate-none" : undefined}
          aria-hidden="true"
        />
        {refreshLabel}
      </Button>
    </div>
  )
}
