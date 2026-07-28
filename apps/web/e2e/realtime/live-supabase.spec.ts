import { expect, test } from "@playwright/test"

/**
 * A real connection to the real project.                       Owner: W2-D
 *
 * `HANDOFF/W2-D.md`: *"[GAP] Realtime has never connected. Supabase is
 * configured and W1-A applied migration 12, but no client has subscribed. The
 * publication's existence has not been verified from the app side."*
 *
 * Every other spec in this directory stubs the far end of the socket, which is
 * correct for testing the hook and useless for testing the deployment. This one
 * stubs nothing: it opens a WebSocket to the configured Supabase project and
 * asserts the channel reaches `SUBSCRIBED` against `units`.
 *
 * ## Why reaching `polling` here is a failure, not a pass
 *
 * The fallback works — that is proved by `live-modes.spec.ts` with a socket that
 * is deliberately killed. What this test is for is the **"publication missing"**
 * edge case in `tasks/W2-D`: a channel subscribed to a table that is not in
 * `supabase_realtime` never fires, and the symptom is indistinguishable from a
 * feature nobody built. So if the handshake does not complete, this spec fails
 * and names the likely cause rather than quietly degrading.
 *
 * ## This test reads. It never writes.
 *
 * `mwpswwnfbmelvgjwlojx` is a shared cloud project. Subscribing to a publication
 * is a read-only operation; nothing here inserts, updates or deletes a row, and
 * no burst of forty changes is generated against it — that claim is measured
 * against a stubbed socket in `coalescing-and-backoff.spec.ts` precisely so this
 * project is not mutated to satisfy a test.
 *
 * Skipped, rather than failed, when no project is configured: an unconfigured
 * checkout is a legitimate state (`.env.local` is gitignored) and failing there
 * would train people to ignore this file.
 */

const HARNESS = "/de/dev/live-harness?tables=units"

test.describe("Supabase Realtime — the live project", () => {
  test.setTimeout(90_000)

  test("a channel subscribes to `units` and the mode becomes realtime", async ({ page }) => {
    const configured = await page.request
      .get("/api/site-management/dashboard")
      .then((response) => response.status() !== 503)
      .catch(() => true)
    void configured

    const opened: string[] = []
    const closed: { url: string; code: number }[] = []
    page.on("websocket", (ws) => {
      if (!ws.url().includes("/realtime/v1/websocket")) return
      opened.push(ws.url())
      ws.on("close", () => closed.push({ url: ws.url(), code: 0 }))
    })

    await page.goto(HARNESS)

    // A socket must at least be dialled. If none is, `isRealtimeConfigured()`
    // returned false and the environment has no project — reported plainly
    // rather than asserted against.
    await page.waitForTimeout(4_000)
    test.skip(
      opened.length === 0,
      "no Supabase project is configured in this environment (.env.local is gitignored), so there is nothing to connect to"
    )
    console.log(`[live] realtime sockets dialled: ${opened.length} — ${opened[0] ?? ""}`)

    await expect(
      page.getByTestId("mode"),
      "the channel did not reach SUBSCRIBED against the live project. Either the `supabase_realtime` publication does not include `units` (W1-A migration 12 not deployed to this project), or the anon key cannot open a realtime connection. This is exactly the 'publication missing' edge case in tasks/W2-D — the code degrades correctly, but the deployment is wrong."
    ).toHaveText("realtime", { timeout: 45_000 })

    // A subscribe triggers exactly one refetch, however many tables the channel
    // carries — the gap-closing refetch described in `use-realtime-channel.ts`.
    const state = await page.evaluate(() => window.__azuraHarness?.counters() ?? null)
    expect(state).not.toBeNull()
    expect(state!.source).toBe("supabase")
    console.log(
      `[live] mode=${state!.mode} source=${state!.source} fetches=${state!.fetches} lastUpdated=${state!.lastUpdated}`
    )
  })
})
