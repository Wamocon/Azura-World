import { expect, test, type Page } from "@playwright/test"

import { stubRealtime } from "./realtime-stub"

/**
 * `useLiveSnapshot`, rendered.                                 Owner: W2-D
 *
 * `HANDOFF/W2-D.md` §"Known gaps": *"[GAP] No hook has ever been rendered. The
 * largest gap."* Decision logic was deliberately moved into `lib/realtime.ts` so
 * a pure probe could prove it, and 93 assertions do. What stayed in the hook is
 * effect wiring — the subscription lifecycle, the polling timer, focus handling,
 * the abort on unmount — and none of it had ever executed.
 *
 * Every mode below is reached through a **real** cause, never a prop that names
 * the mode:
 *
 * | mode | how it is caused here |
 * |---|---|
 * | `realtime` | a WebSocket completes the Supabase join handshake |
 * | `polling` | that socket is closed mid-session |
 * | `static` | the repository result carries `source: "local-seed"` |
 * | `offline` | `context.setOffline(true)` — a real `navigator.onLine` flip |
 *
 * The harness at `/[locale]/dev/live-harness` supplies the fetcher and nothing
 * else.
 */

const HARNESS = "/de/dev/live-harness"

async function counters(page: Page) {
  return await page.evaluate(() => window.__azuraHarness?.counters() ?? null)
}

test.describe("useLiveSnapshot — the four modes, rendered in a browser", () => {
  test.setTimeout(90_000)

  test("realtime: a completed socket handshake reports Live", async ({ page }) => {
    await stubRealtime(page)
    await page.goto(HARNESS)

    await expect(page.getByTestId("mode")).toHaveText("realtime", { timeout: 30_000 })
    await expect(page.getByTestId("source")).toHaveText("supabase")

    // `subscribing` must not be shown as Live. The mode only claims realtime
    // once the socket has confirmed — showing Live while nothing arrives is the
    // silent stall this whole feature exists to prevent.
    const state = await counters(page)
    expect(state?.mode).toBe("realtime")
  })

  test("polling: killing the socket mid-session falls back within one interval", async ({
    page,
  }) => {
    const socket = await stubRealtime(page)
    await page.goto(HARNESS)
    await expect(page.getByTestId("mode")).toHaveText("realtime", { timeout: 30_000 })

    socket.refuseFromNowOn()
    await socket.drop()

    // `CLOSED` → `polling`, per `resolveLiveMode`. The reconnect timer is
    // running underneath; the badge must not keep claiming Live while it is.
    await expect(page.getByTestId("mode")).toHaveText("polling", { timeout: 30_000 })
  })

  test("static: a local-seed result does not poll at all", async ({ page }) => {
    // No realtime stub, and **no channels** — `?tables=` is empty on purpose.
    //
    // This is the scenario `tasks/W2-D` §DoD test 3 actually describes: seed
    // data with nothing live attached, where any request at all is a polling
    // request. An earlier version of this test left the default channels in
    // place and saw exactly one fetch; that fetch was not polling but the
    // deliberate refetch `useRealtimeChannel` performs on subscribe, to close
    // the gap a disconnection may have hidden. Counting it here would have
    // reported a defect that is not one — and removing the assertion would have
    // hidden the one that would be. Removing the channels measures the claim.
    let apiRequests = 0
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests += 1
    })

    await page.goto(`${HARNESS}?source=local-seed&poll=500&tables=`)
    await expect(page.getByTestId("mode")).toHaveText("static", { timeout: 30_000 })

    const before = await counters(page)
    expect(before, "harness did not expose counters").not.toBeNull()

    // Six poll intervals at 500 ms. `static` must create no timer at all, so the
    // fetch count may not move even once.
    await page.waitForTimeout(3_000)
    const after = await counters(page)

    expect(
      after!.fetches - before!.fetches,
      "static polled — tasks/W2-D §DoD test 3 requires zero requests"
    ).toBe(0)
    expect(apiRequests, "static issued an API request").toBe(0)
  })

  test("offline: last-updated is preserved, not cleared", async ({ page, context }) => {
    await stubRealtime(page)
    await page.goto(HARNESS)
    await expect(page.getByTestId("mode")).toHaveText("realtime", { timeout: 30_000 })

    // Wait for the fetch count to stop moving before reading the timestamp.
    // The subscribe-gap refetch lands shortly after `realtime` is reported, and
    // reading across it would compare two different fetches and call the
    // difference a bug.
    await expect
      .poll(
        async () => {
          const first = (await counters(page))?.fetches ?? -1
          await page.waitForTimeout(800)
          const second = (await counters(page))?.fetches ?? -2
          return first === second ? "settled" : "moving"
        },
        { timeout: 20_000, message: "the fetch count never settled" }
      )
      .toBe("settled")

    const lastUpdatedBefore = await page.getByTestId("last-updated").textContent()
    expect(lastUpdatedBefore).not.toBe("null")

    await context.setOffline(true)
    await page.evaluate(() => window.dispatchEvent(new Event("offline")))

    await expect(page.getByTestId("mode")).toHaveText("offline", { timeout: 30_000 })

    // The point of the check: going offline must not blank the timestamp. A
    // surface that forgets when its data is from is worse than one showing old
    // data with an honest age.
    await expect(page.getByTestId("last-updated")).toHaveText(lastUpdatedBefore ?? "")

    // The failed refetch is surfaced rather than swallowed, and the data stays
    // on screen beside it. Silently showing stale data with no error is the
    // failure mode this whole feature exists to avoid.
    await expect(page.getByTestId("error")).toHaveText("persistence_unavailable")

    await context.setOffline(false)
  })

  test("unmount: the channel is torn down and nothing further is scheduled", async ({ page }) => {
    const socket = await stubRealtime(page)
    await page.goto(HARNESS)
    await expect(page.getByTestId("mode")).toHaveText("realtime", { timeout: 30_000 })

    const socketsAtMount = socket.connectionTimes.length

    await page.getByTestId("unmount").click()
    await expect(page.getByTestId("unmounted")).toBeVisible()

    // Pushing after unmount must reach nothing: the coalescer was cancelled and
    // the channel removed. A leaked channel keeps refetching against a component
    // that is gone — the failure `tasks/W2-D` describes as surfacing three pages
    // later, which is what makes it expensive to diagnose.
    await socket.push(5)
    await page.waitForTimeout(2_000)

    expect(
      await page.evaluate(() => window.__azuraHarness === undefined),
      "the harness cleanup ran, so the subject really unmounted"
    ).toBe(true)
    expect(
      socket.connectionTimes.length,
      "a new socket was opened after unmount — the reconnect timer outlived the component"
    ).toBe(socketsAtMount)
  })
})
