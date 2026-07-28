import type { Page } from "@playwright/test"

/**
 * A stand-in Supabase Realtime endpoint.                       Owner: W2-D
 *
 * Replaces the far end of the WebSocket and nothing else. `supabase-js`,
 * `useRealtimeChannel`, `createCoalescer`, `useLiveSnapshot`, `resolveLiveMode`
 * and React all run unmodified above it.
 *
 * ## Why the socket is stubbed at all
 *
 * Two claims need frames this test cannot otherwise produce:
 *
 * - **Forty updates in one burst.** Producing them for real means writing forty
 *   rows to the shared cloud project, which this window has no authorisation to
 *   mutate — and forty writes would not land inside the 400 ms coalescing window
 *   over the public internet anyway.
 * - **A socket dropping mid-session, repeatedly.** The reconnect ladder needs a
 *   server that refuses on demand.
 *
 * `live-supabase.spec.ts` covers the complementary claim against the real
 * endpoint, so neither the transport nor the deployment goes unproven.
 *
 * ## The protocol, as observed rather than assumed
 *
 * `realtime-js` 2.110.8 dials with `vsn=2.0.0`, whose serializer is **positional
 * arrays**, not the object form the v1 documentation shows:
 *
 * ```
 * [join_ref, ref, topic, event, payload]
 * ```
 *
 * The first version of this stub replied in the object form. Every frame was
 * silently discarded, the client re-joined under a new topic, and the mode sat
 * at `polling` — which looks exactly like a broken feature. The shape below was
 * read off a real handshake (`C->S ["6","6","realtime:harness:0","phx_join",…]`)
 * rather than guessed a second time.
 *
 * The join reply **echoes the bindings the client asked for**, with ids
 * assigned. `realtime-js` compares that list against its own and raises
 * `CHANNEL_ERROR` on a length mismatch, so mirroring the request is what makes
 * the handshake succeed for the right reason rather than by luck.
 */

const REALTIME_URL = /realtime\/v1\/websocket/

type Frame = [string | null, string | null, string, string, unknown]

export interface RealtimeStub {
  /** Push `count` `postgres_changes` frames on the live socket. */
  push: (count: number) => Promise<void>
  /** Close the current socket, as a network drop would. */
  drop: () => Promise<void>
  /** Close every socket on sight, so the transport never comes back. */
  refuseFromNowOn: () => void
  /** Epoch ms of each socket the client opened, in order. */
  connectionTimes: number[]
  /**
   * Epoch ms of each `phx_join` the client sent, in order.
   *
   * The instrument for the application's own backoff ladder. Socket connections
   * are the wrong thing to measure: when the transport drops, `supabase-js`
   * reconnects it on its **own** schedule (`[1000, 2000, 5000, 10000]`, plateau
   * 10 s), and that ladder is what a socket-level measurement sees — 2016, 5006,
   * 10018, 10020, 10014 ms, observed. `useRealtimeChannel`'s
   * `nextBackoffDelay` runs one layer up, on `CHANNEL_ERROR`, and only join
   * attempts reveal it.
   */
  joinTimes: number[]
}

export interface StubOptions {
  /**
   * Reject every `phx_join` with `{status: "error"}`.
   *
   * Produces `CHANNEL_ERROR` on a healthy socket, which is the branch that
   * drives the hook's own capped backoff — the transport stays up, so
   * `supabase-js` has nothing to reconnect and cannot mask it.
   */
  refuseJoins?: boolean
}

export async function stubRealtime(
  page: Page,
  options: StubOptions = {}
): Promise<RealtimeStub> {
  const connectionTimes: number[] = []
  const joinTimes: number[] = []
  let current: { send: (data: string) => void; close: () => void } | null = null
  let topic = "realtime:harness:0"
  let ids: number[] = [1]
  let refusing = false

  await page.routeWebSocket(REALTIME_URL, (ws) => {
    connectionTimes.push(Date.now())

    if (refusing) {
      // Accepted then dropped: `CLOSED` is what a real server going away looks
      // like to the client, and it is the branch that schedules the backoff.
      ws.close({ code: 1006, reason: "refusing" })
      return
    }

    current = {
      send: (data) => ws.send(data),
      close: () => ws.close({ code: 1006, reason: "test-induced drop" }),
    }

    ws.onMessage((raw) => {
      const text = typeof raw === "string" ? raw : raw.toString()
      let frame: Frame
      try {
        frame = JSON.parse(text) as Frame
      } catch {
        return
      }
      if (!Array.isArray(frame) || frame.length < 5) return

      const [joinRef, ref, frameTopic, event, payload] = frame

      if (event === "heartbeat") {
        ws.send(
          JSON.stringify([joinRef, ref, frameTopic, "phx_reply", { status: "ok", response: {} }])
        )
        return
      }

      if (event === "phx_join") {
        joinTimes.push(Date.now())

        if (options.refuseJoins === true) {
          ws.send(
            JSON.stringify([
              joinRef,
              ref,
              frameTopic,
              "phx_reply",
              { status: "error", response: { reason: "refused by test" } },
            ])
          )
          return
        }

        topic = frameTopic
        const config = (payload as { config?: { postgres_changes?: unknown[] } } | undefined)
          ?.config
        const requested = config?.postgres_changes ?? []
        const echoed = requested.map((binding, index) => ({
          ...(binding as Record<string, unknown>),
          id: index + 1,
        }))
        ids = echoed.map((binding) => binding["id"] as number)
        ws.send(
          JSON.stringify([
            joinRef,
            ref,
            frameTopic,
            "phx_reply",
            { status: "ok", response: { postgres_changes: echoed } },
          ])
        )
      }
    })
  })

  return {
    connectionTimes,
    joinTimes,
    push: async (count) => {
      for (let index = 0; index < count; index += 1) {
        current?.send(
          JSON.stringify([
            null,
            null,
            topic,
            "postgres_changes",
            {
              ids,
              data: {
                type: "UPDATE",
                schema: "public",
                table: "units",
                commit_timestamp: new Date().toISOString(),
                record: { id: `AZW-B01-${String(index).padStart(4, "0")}` },
                old_record: {},
                columns: [],
                errors: null,
              },
            },
          ])
        )
      }
      // Yield to the page so the frames are delivered before the caller asserts.
      await page.waitForTimeout(50)
    },
    drop: async () => {
      current?.close()
      await page.waitForTimeout(100)
    },
    refuseFromNowOn: () => {
      refusing = true
    },
  }
}
