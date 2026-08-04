"use client"

import { RefreshCw } from "lucide-react"
import { useCallback, useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { useRealtimeChannel } from "@/hooks/use-realtime-channel"
import type { RealtimeChannelConfig } from "@/lib/realtime"
import { cn } from "@/lib/cn"

/**
 * A Server Component that keeps itself current.                 Owner: W-NIGHT
 *
 * ## What this is for
 *
 * `hooks/use-realtime-channel.ts` and migration 12's publication have existed
 * since the project started and had exactly one consumer: a dev harness. Ten
 * tables are published to `supabase_realtime` and nothing in the product
 * subscribed to any of them, so a manager watching the ticket queue while a
 * tenant filed a request saw nothing until they reloaded.
 *
 * This is the bridge. Drop it into a Server Component, name the tables that
 * page reads, and a change to one of them re-runs the page on the server.
 *
 * ## It refreshes; it never patches
 *
 * `router.refresh()` and nothing else. The alternative — splice the changed row
 * into a client copy of the list — is faster and is the wrong trade here for
 * three reasons that all come back to the same rule. A realtime payload is the
 * row as the DATABASE sees it, not as the caller's RLS scope sees it, so
 * patching could paint a row the reader is not entitled to. Half this product's
 * values are derived server-side (SLA state, "days at this stage", per-currency
 * totals) and a client that recomputed them would be inventing a second answer.
 * And a socket that drops mid-session would leave the patched copy silently
 * diverging from the database with nothing on screen to say so.
 *
 * Re-reading costs a request and buys the guarantee that what is on screen came
 * from the same query, under the same policies, as it did on first load.
 *
 * ## What it never does
 *
 * It does not move anything under the reader's cursor without saying so. The
 * indicator is the only visible change: a quiet "just updated" that fades. A
 * list that silently reorders while somebody is reading row four is a worse
 * experience than a stale list, and on a ticket queue it is how the wrong
 * ticket gets clicked.
 *
 * It is also **absent, not idle, where staleness is not a cost**. Finance,
 * evidence and inventory are deliberately not wired: a ledger row that moves
 * while it is being read is worse than one a minute old, and the evidence
 * module's entire claim is that a cited figure holds still.
 */

export interface LiveRefreshLabels {
  /** Announced and shown briefly after a refresh lands. */
  updated: string
  /** The connection dropped and the page may be stale. */
  offline: string
}

export function LiveRefresh({
  name,
  channels,
  labels,
  enabled = true,
  className,
}: {
  /** Stable per surface. Two mounts with one name are two channels. */
  name: string
  channels: readonly RealtimeChannelConfig[]
  labels: LiveRefreshLabels
  /**
   * False when there is nothing to listen to — seed mode, or a role whose
   * scope is empty. A subscription that can never fire is a socket held open
   * for nothing.
   */
  enabled?: boolean
  className?: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [flash, setFlash] = useState(false)

  const onChange = useCallback(() => {
    startTransition(() => router.refresh())
    setFlash(true)
  }, [router])

  const { status } = useRealtimeChannel({ name, channels, onChange, enabled })

  // The flash is a receipt, not a state. Three seconds is long enough to catch
  // out of the corner of an eye and short enough not to become furniture.
  useEffect(() => {
    if (!flash) return
    const timer = setTimeout(() => setFlash(false), 3000)
    return () => clearTimeout(timer)
  }, [flash])

  const stale = status === "error" || status === "closed"

  // Nothing to say: connected, quiet, current. The component renders nothing
  // rather than a permanent "live" badge — a light that is always on is not
  // information, and this product already says `source` and `fetchedAt`
  // elsewhere for the question "how fresh is this".
  if (!stale && !flash && !pending) return null

  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 text-xs",
        "transition-opacity duration-200 ease-[var(--ease-out)]",
        stale ? "text-confidence-gap" : "text-muted-foreground",
        className
      )}
    >
      <RefreshCw
        aria-hidden="true"
        className={cn(
          "size-3.5",
          pending && "animate-spin motion-reduce:animate-none"
        )}
      />
      {stale ? labels.offline : labels.updated}
    </span>
  )
}
