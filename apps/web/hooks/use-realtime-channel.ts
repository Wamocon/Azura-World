"use client"

/**
 * One Supabase Realtime channel, with reconnect and coalescing.
 *
 * Three rules, all of which have a specific failure behind them:
 *
 * 1. **The payload is never read.** `onChange` takes no argument. A change event
 *    means "refetch"; the refetch goes through the repository and therefore
 *    through RLS. Reading a pushed row into state would bypass the one place
 *    that decides whether this user may see it — and after a reconnect it would
 *    replay a buffered queue, rendering a sequence of intermediate states that
 *    never existed as a whole.
 *
 * 2. **Every channel is removed on unmount.** A leaked channel holds a slot in
 *    the connection pool, and the symptom — subscriptions silently failing —
 *    surfaces three pages later, which makes it expensive to diagnose.
 *
 * 3. **Reconnect is exponential with jitter, capped at 30 s.** Never a tight
 *    loop: a tight retry against an endpoint that is already struggling is how a
 *    brief outage becomes a long one.
 */

import { useEffect, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import {
  COALESCE_WINDOW_MS,
  createCoalescer,
  isRealtimeConfigured,
  nextBackoffDelay,
  type RealtimeChannelConfig,
  type RealtimeStatus,
} from "@/lib/realtime"

export interface UseRealtimeChannelResult {
  status: RealtimeStatus
  /** How many reconnects have been attempted since the last healthy subscribe. */
  attempts: number
}

export function useRealtimeChannel(config: {
  /** A stable name. Two mounts with the same name are two distinct channels. */
  name: string
  channels: readonly RealtimeChannelConfig[]
  /** Called once per quiet window, never once per event. */
  onChange: () => void
  enabled: boolean
}): UseRealtimeChannelResult {
  /**
   * `null` means "the socket has not reported anything yet".
   *
   * The status is **derived** rather than initialised by a `setStatus` call
   * inside the effect body. That is not a lint workaround: a synchronous
   * setState in an effect causes a cascading render on every mount, and the
   * information — "we are attempting to subscribe" — is already implied by the
   * effect having started. Every remaining `setSocketStatus` below runs from an
   * asynchronous callback (Supabase's `subscribe`, or the reconnect timer),
   * which is where a status change genuinely originates.
   */
  const [socketStatus, setSocketStatus] = useState<RealtimeStatus | null>(null)
  const [attempts, setAttempts] = useState(0)

  // The callback is held in a ref so a caller passing an inline arrow does not
  // tear down and rebuild the subscription on every render — which would look
  // like a flapping connection and would reset the backoff on every keystroke.
  // Synced in an effect, never during render.
  const onChangeRef = useRef(config.onChange)
  useEffect(() => {
    onChangeRef.current = config.onChange
  }, [config.onChange])

  const tableKey = config.channels
    .map((channel) => `${channel.table}:${channel.filter ?? "*"}`)
    .join("|")

  const active =
    config.enabled && isRealtimeConfigured() && tableKey.length > 0

  useEffect(() => {
    if (!active) return

    const supabase = createClient()
    if (supabase === null) return

    let disposed = false
    let attempt = 0
    let retryHandle: ReturnType<typeof setTimeout> | null = null
    let channel: ReturnType<typeof supabase.channel> | null = null

    const coalescer = createCoalescer(() => {
      if (!disposed) onChangeRef.current()
    }, COALESCE_WINDOW_MS)

    const teardown = (): void => {
      if (channel !== null) {
        void supabase.removeChannel(channel)
        channel = null
      }
    }

    const scheduleReconnect = (): void => {
      if (disposed) return
      const delay = nextBackoffDelay(attempt)
      attempt += 1
      setAttempts(attempt)
      retryHandle = setTimeout(() => {
        // Back to "attempting" for the badge, from inside an async callback.
        setSocketStatus(null)
        connect()
      }, delay)
    }

    function connect(): void {
      if (disposed) return
      teardown()

      let next = supabase.channel(`${config.name}:${attempt}`)
      for (const entry of config.channels) {
        next = next.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: entry.table,
            ...(entry.filter === undefined ? {} : { filter: entry.filter }),
          },
          // No payload parameter, deliberately. See rule 1 in the header.
          () => coalescer.signal()
        )
      }
      channel = next

      // Annotated because the channel is built without a `Database` generic
      // (there is no generated `lib/database.types.ts` yet — see HANDOFF/W1-B.md),
      // so `subscribe`'s callback parameter does not infer. `string` rather than
      // the SDK's enum keeps this file free of a deep type import that would
      // break on a minor version bump; the values are compared as literals below.
      next.subscribe((subscribeStatus: string) => {
        if (disposed) return
        if (subscribeStatus === "SUBSCRIBED") {
          attempt = 0
          setAttempts(0)
          setSocketStatus("subscribed")
          // A gap while disconnected may have hidden changes. One refetch on
          // (re)subscribe closes it — and one is the right number, however many
          // tables are in the channel.
          coalescer.signal()
          return
        }
        if (
          subscribeStatus === "CHANNEL_ERROR" ||
          subscribeStatus === "TIMED_OUT"
        ) {
          setSocketStatus("error")
          scheduleReconnect()
          return
        }
        if (subscribeStatus === "CLOSED") {
          setSocketStatus("closed")
          scheduleReconnect()
        }
      })
    }

    connect()

    return () => {
      // Every one of these matters. A leaked channel holds a slot in the
      // connection pool and the symptom — subscriptions silently failing —
      // surfaces on an unrelated page later, which makes it expensive to find.
      disposed = true
      if (retryHandle !== null) clearTimeout(retryHandle)
      coalescer.cancel()
      teardown()
    }
    // `config.channels` is represented by `tableKey`, and `config.onChange`
    // lives in a ref — both deliberately, so an inline array or arrow from the
    // caller does not rebuild the subscription on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, config.name, tableKey])

  // Derived, never assigned in the effect body. See the note on `socketStatus`.
  const status: RealtimeStatus = !active ? "idle" : (socketStatus ?? "subscribing")

  return { status, attempts }
}
