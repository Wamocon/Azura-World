import { expect, test } from "@playwright/test"

import { stubRealtime } from "./realtime-stub"

/**
 * Burst coalescing and reconnect backoff, measured in a browser.  Owner: W2-D
 *
 * Two claims from `tasks/W2-D` §DoD that had only ever been checked against
 * pure functions:
 *
 *   5. *"40 rapid updates → one re-render (assert the count)"*
 *   9. *"Reconnect backoff measured: intervals grow and cap at 30 s"*
 *
 * `scripts/realtime-probe.mts` proved `createCoalescer` collapses 40 signals to
 * one call, and that `nextBackoffDelay` yields 1·2·4·8·16·30·30 s. Neither
 * proved what the claims are actually about: that forty frames arriving on a
 * socket cause **one** refetch and one React commit cycle, and that the
 * reconnect timer really waits those intervals in wall-clock time.
 *
 * Here the forty updates arrive as forty `postgres_changes` frames through the
 * real `supabase-js` client into the real hook, and the counts are React's own.
 *
 * ## Run these with `--workers=1`
 *
 * Every assertion in this file is about elapsed time or committed renders. Two
 * projects sharing one `next dev` will recompile a route under each other, and a
 * Fast Refresh navigation lands mid-measurement — observed once as
 * `page.evaluate: Execution context was destroyed`. That is the harness
 * interfering with itself, not a defect, and the fix is to stop measuring a
 * moving target rather than to widen the tolerances until the noise fits inside
 * them. `HANDOFF/W2-D.md` §"Running it" gives the command.
 */

// Within this file the tests share a dev server and each holds it for tens of
// seconds; running them serially keeps one test's reconnect storm out of
// another's timings.
test.describe.configure({ mode: "serial" })

const HARNESS = "/de/dev/live-harness"

test.describe("burst coalescing", () => {
  test.setTimeout(120_000)

  test("40 updates in one burst cause exactly one refetch", async ({
    page,
  }) => {
    const socket = await stubRealtime(page)
    await page.goto(HARNESS)
    await expect(page.getByTestId("mode")).toHaveText("realtime", {
      timeout: 30_000,
    })

    // Let the subscribe-time refetch settle first. One refetch on (re)subscribe
    // is deliberate — a gap while disconnected may have hidden changes — and is
    // not part of what this test measures.
    await page.waitForTimeout(2_000)
    await page.evaluate(() => window.__azuraHarness?.reset())

    await socket.push(40)

    // The coalescing window is 400 ms. Waiting well past it means a failure here
    // is a real failure to coalesce, not an early read.
    await page.waitForTimeout(3_000)

    const after = await page.evaluate(
      () => window.__azuraHarness?.counters() ?? null
    )
    expect(after).not.toBeNull()

    expect(
      after!.fetches,
      `40 frames produced ${after!.fetches} refetches. One is correct: a realtime event is an invalidation signal, not data.`
    ).toBe(1)

    // React may commit more than once for a single data change — the fetch
    // resolves and sets four pieces of state, and the 1 s age ticker commits on
    // its own schedule. What matters is that the burst did not produce anything
    // like forty commits.
    expect(
      after!.commits,
      `40 frames produced ${after!.commits} commits; coalescing collapses the burst to one refetch, so this must stay far below 40`
    ).toBeLessThan(12)

    console.log(
      `[coalesce] 40 frames -> ${after!.fetches} fetch, ${after!.commits} commits`
    )
  })

  test("a later burst is not swallowed by the first", async ({ page }) => {
    const socket = await stubRealtime(page)
    await page.goto(HARNESS)
    await expect(page.getByTestId("mode")).toHaveText("realtime", {
      timeout: 30_000,
    })
    await page.waitForTimeout(2_000)
    await page.evaluate(() => window.__azuraHarness?.reset())

    await socket.push(20)
    await page.waitForTimeout(2_000)
    await socket.push(20)
    await page.waitForTimeout(2_000)

    const after = await page.evaluate(
      () => window.__azuraHarness?.counters() ?? null
    )
    // Two quiet windows, two refetches. Coalescing must not become throttling
    // that drops the second burst — that is a silent stall wearing a
    // performance optimisation's name.
    expect(
      after!.fetches,
      "two separated bursts must produce two refetches"
    ).toBe(2)
    console.log(
      `[coalesce] 20+20 frames, separated -> ${after!.fetches} fetches`
    )
  })
})

function gapsBetween(times: readonly number[]): number[] {
  const gaps: number[] = []
  for (let index = 1; index < times.length; index += 1) {
    gaps.push((times[index] ?? 0) - (times[index - 1] ?? 0))
  }
  return gaps
}

test.describe("reconnect backoff", () => {
  // 1 + 2 + 4 + 8 + 16 + 30 s is ~61 s before jitter, and jitter is ±25 %. Slow
  // on purpose: the claim is about real elapsed time, and shortening it would
  // mean asserting something else.
  test.setTimeout(240_000)

  test("a refused join retries at a bounded rate, never a tight loop", async ({
    page,
  }) => {
    /**
     * **This test does not prove the 30 s cap, and the reason is the finding.**
     *
     * `nextBackoffDelay` produces 1·2·4·8·16·30·30 s and
     * `scripts/realtime-probe.mts` proves it. `useRealtimeChannel` calls it from
     * `scheduleReconnect`. But with joins refused on a healthy socket, the gaps
     * observed here are:
     *
     *     1010, 19, 1008, 1229, 1007, 1002 ms
     *
     * Flat at ~1 s, not doubling. The application's ladder is not what governs
     * retry timing: `supabase-js` runs its own rejoin timer on a channel that
     * errors (`reconnectAfterMs`, starting at 1 s), and it retries first, every
     * time. The hook's `attempt` counter therefore never climbs far enough to
     * reach the cap it was written to enforce.
     *
     * So the honest assertion is the one that still matters to the endpoint
     * being retried: the rate is **bounded**, nothing exceeds the app's 30 s
     * cap, and this is not the tight loop `tasks/W2-D` warns about. The
     * discrepancy between the unit-proven ladder and the observed one is
     * recorded in `HANDOFF/W2-D.md` rather than papered over by an assertion
     * loose enough to pass either way.
     */
    const socket = await stubRealtime(page, { refuseJoins: true })
    await page.goto(HARNESS)

    // Never reaches realtime — every join is rejected — so the mode stays
    // polling, which is the correct degradation and the part a user sees.
    await expect(page.getByTestId("mode")).toHaveText("polling", {
      timeout: 30_000,
    })

    const started = Date.now()
    await page.waitForTimeout(20_000)
    const elapsedSeconds = (Date.now() - started) / 1000

    const gaps = gapsBetween(socket.joinTimes)
    const perSecond = socket.joinTimes.length / elapsedSeconds
    console.log(
      `[backoff] refused-join retries: ${socket.joinTimes.length} joins in ${elapsedSeconds.toFixed(1)}s ` +
        `(${perSecond.toFixed(2)}/s); gaps (ms): ${gaps.join(", ")}`
    )

    expect(
      gaps.length,
      "no retries were observed at all"
    ).toBeGreaterThanOrEqual(3)

    // Bounded rate. A genuine tight loop would be tens per second; this is the
    // assertion that would catch one.
    expect(
      perSecond,
      `retries are hammering the endpoint at ${perSecond.toFixed(2)}/s: ${gaps.join(", ")}`
    ).toBeLessThan(3)

    // Nothing waits longer than the application's own declared ceiling either.
    for (const gap of gaps) {
      expect(
        gap,
        `a retry gap exceeded the 30 s cap: ${gaps.join(", ")}`
      ).toBeLessThan(36_000)
    }
  })

  test("a dropped transport is reconnected by supabase-js, bounded well under the app cap", async ({
    page,
  }) => {
    /**
     * Recorded because it contradicts a reasonable reading of
     * `HANDOFF/W2-D.md`.
     *
     * When the **socket** drops — as opposed to a join being refused —
     * `supabase-js` reconnects the transport on its own schedule
     * (`[1000, 2000, 5000, 10000]`, then 10 s forever) before the channel ever
     * reports an error. So in the most common real failure, the ladder that
     * actually governs retry timing is the library's 10 s one, not this
     * application's 30 s one.
     *
     * That is not a defect: 10 s is tighter than the app's own cap, so nothing
     * retries more slowly than intended and nothing hammers the endpoint. But
     * "reconnect backoff caps at 30 s" describes the application's ladder, and
     * a reader could reasonably take it to describe observed behaviour after a
     * network drop. It does not. Measured here so the handoff can say so.
     */
    const socket = await stubRealtime(page)
    await page.goto(HARNESS)
    await expect(page.getByTestId("mode")).toHaveText("realtime", {
      timeout: 30_000,
    })

    const baseline = socket.connectionTimes.length
    socket.refuseFromNowOn()
    await socket.drop()

    const deadline = Date.now() + 90_000
    while (
      socket.connectionTimes.length < baseline + 6 &&
      Date.now() < deadline
    ) {
      await page.waitForTimeout(1_000)
    }

    const gaps = gapsBetween(socket.connectionTimes.slice(baseline))
    console.log(
      `[backoff] transport ladder, gaps between sockets (ms): ${gaps.join(", ")}`
    )

    expect(
      gaps.length,
      "not enough transport reconnects observed"
    ).toBeGreaterThanOrEqual(3)
    // Bounded, growing, and never a tight loop. The exact plateau belongs to
    // `supabase-js` and is reported rather than pinned, so a library upgrade
    // that changes it is a finding here and not a failure.
    for (const gap of gaps) {
      expect(
        gap,
        `a transport reconnect exceeded the app cap: ${gaps.join(", ")}`
      ).toBeLessThan(36_000)
    }
    expect(
      Math.min(...gaps),
      `a transport reconnect was too fast: ${gaps.join(", ")}`
    ).toBeGreaterThan(400)
    expect(
      gaps[gaps.length - 1] ?? 0,
      `transport gaps did not grow: ${gaps.join(", ")}`
    ).toBeGreaterThan(gaps[0] ?? 0)

    // The mode must have degraded honestly throughout — this is the part that
    // matters to a user regardless of which ladder is doing the waiting.
    await expect(page.getByTestId("mode")).toHaveText("polling")
  })
})
