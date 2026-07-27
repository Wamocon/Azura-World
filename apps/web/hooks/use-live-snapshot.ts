"use client"

/**
 * The live-data hook every dashboard surface consumes.
 *
 * Wraps a repository call in realtime-or-polling, and reports **which one is
 * actually running**. The honesty requirement outranks the liveness one: a
 * surface that silently stopped updating is worse than one that says "polling,
 * last updated 30 s ago", so the returned `mode` is derived from observed state
 * (`lib/realtime.ts`'s `resolveLiveMode`) rather than from what was configured.
 *
 * ## Behaviours that are not obvious from the signature
 *
 * - **`static` does not poll.** Supabase unconfigured, or the repository
 *   returned `local-seed`: seed data does not change, so a timer would be pure
 *   churn and a "last updated 3 s ago" badge over static data would be a lie.
 * - **A backgrounded tab pauses.** Polling a hidden tab for hours costs the
 *   user's battery and the project's quota. Focus triggers an immediate
 *   refetch, so the first thing a returning user sees is current.
 * - **Never two requests in flight.** An in-flight guard plus an `AbortController`;
 *   a slow response cannot land on top of a newer one.
 * - **`lastUpdated` is the server's `fetchedAt`**, never `Date.now()`. A client
 *   clock eleven minutes fast would otherwise report fresh data as stale.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useConnectionStatus } from "./use-connection-status"
import { useRealtimeChannel } from "./use-realtime-channel"
import {
  isStale as computeStale,
  resolveLiveMode,
  shouldPoll,
  type LiveMode,
  type RealtimeChannelConfig,
} from "@/lib/realtime"
import { isSupabaseConfigured } from "@/lib/env"
import type { ApiError, RepositoryResult } from "@/lib/contracts"

export const DEFAULT_POLL_INTERVAL_MS = 30_000

export interface UseLiveSnapshotConfig<T> {
  fetcher: () => Promise<RepositoryResult<T>>
  channels?: readonly RealtimeChannelConfig[]
  pollIntervalMs?: number
  enabled?: boolean
  /** Distinguishes two subscriptions on one page. */
  channelName?: string
}

export interface UseLiveSnapshotResult<T> {
  data: T | null
  source: "supabase" | "local-seed" | null
  mode: LiveMode
  /** Server-provided ISO timestamp of the data currently displayed. */
  lastUpdated: string | null
  error: ApiError | null
  isStale: boolean
  refresh: () => Promise<void>
}

export function useLiveSnapshot<T>(
  config: UseLiveSnapshotConfig<T>
): UseLiveSnapshotResult<T> {
  const {
    fetcher,
    channels = [],
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    enabled = true,
    channelName = "live-snapshot",
  } = config

  const [data, setData] = useState<T | null>(null)
  const [source, setSource] = useState<"supabase" | "local-seed" | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const connection = useConnectionStatus()

  const fetcherRef = useRef(fetcher)
  const inFlight = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const mounted = useRef(true)

  // Synced in an effect, not during render: writing a ref while rendering is a
  // tearing hazard under concurrent React, and the compiler lint is right to
  // reject it. The initial `useRef(fetcher)` already holds the first render's
  // value, and this effect is declared before every consumer below, so no
  // reader can observe a stale one.
  useEffect(() => {
    fetcherRef.current = fetcher
  }, [fetcher])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      abortRef.current?.abort()
    }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    // The guard, not a queue: a second request while one is in flight is
    // dropped, because it would return the same data a moment later and the
    // responses could land out of order.
    if (inFlight.current) return
    inFlight.current = true
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    try {
      const result = await fetcherRef.current()
      if (!mounted.current) return
      setData(result.data)
      setSource(result.source)
      setLastUpdated(result.fetchedAt)
      setError(null)
    } catch (caught) {
      if (!mounted.current) return
      // The repository throws only when Supabase is *configured and failing* —
      // CONVENTIONS §2 makes "unconfigured" a labelled fallback, not an error.
      // So reaching here means a real outage, and the previous data is kept on
      // screen with the badge reporting how old it is.
      setError({
        code: "persistence_unavailable",
        message:
          caught instanceof Error && caught.message.length < 200
            ? caught.message
            : "Live data is temporarily unavailable.",
        retryable: true,
      })
    } finally {
      inFlight.current = false
    }
  }, [])

  const realtime = useRealtimeChannel({
    name: channelName,
    channels,
    onChange: () => {
      void refresh()
    },
    enabled: enabled && connection.online && channels.length > 0,
  })

  const mode = resolveLiveMode({
    online: connection.online,
    supabaseConfigured: isSupabaseConfigured(),
    realtimeStatus: realtime.status,
    source,
  })

  // First load, and a reload whenever the tab comes back to the foreground.
  useEffect(() => {
    if (!enabled) return
    if (!connection.visible) return
    void refresh()
  }, [enabled, connection.visible, connection.online, refresh])

  // The polling timer. Absent entirely in `static` and `offline`, and paused
  // while the tab is hidden — `shouldPoll` is the single place that decides.
  useEffect(() => {
    if (!enabled || !connection.visible || !shouldPoll(mode)) return
    const handle = setInterval(() => {
      void refresh()
    }, pollIntervalMs)
    return () => clearInterval(handle)
  }, [enabled, connection.visible, mode, pollIntervalMs, refresh])

  // Drives the relative timestamp in the badge. A separate, slow ticker so the
  // age display advances without the data being refetched.
  useEffect(() => {
    if (!connection.visible) return
    const handle = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(handle)
  }, [connection.visible])

  const isStale = useMemo(
    () => computeStale(lastUpdated, pollIntervalMs, now),
    [lastUpdated, pollIntervalMs, now]
  )

  return { data, source, mode, lastUpdated, error, isStale, refresh }
}
