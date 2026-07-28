import { expect, test } from "@playwright/test"

/**
 * The burst and the connection, against the REAL project.      Owner: W2-D
 *
 * `coalescing-and-backoff.spec.ts` measures the 40-updates-one-render claim
 * against a **stubbed** socket, and says so. That was the right call when it was
 * written — it refused to mutate a shared cloud project to satisfy a test — but
 * it leaves the claim proven for the hook and unproven for the deployment. The
 * publication could be missing, the socket could deliver differently, and the
 * stub would never know.
 *
 * This file closes that. It opens a real WebSocket to the configured Supabase
 * project, fires forty real `INSERT`s through PostgREST, and asserts React
 * committed **one** render.
 *
 * ## What it writes to, and why nothing of value is at risk
 *
 * `public.notifications`, which is:
 *
 *   - **in the `supabase_realtime` publication** (`REALTIME_TABLES`), so the
 *     transport under test is the same one `units` uses;
 *   - **empty** — 0 rows before this runs, verified in the test itself;
 *   - **not evidence.** It holds no harvested fact, no source, no price. The 656
 *     units and the 47 portal listings are untouched.
 *
 * Bursting on `units` would have been closer to the product and was rejected:
 * inserting forty rows into the table whose count — 656, of which 631 modelled
 * and 25 real — every surface asserts, and which the whole honesty argument
 * rests on, is not a trade worth making for a test. A failed cleanup would
 * corrupt the project's central figure permanently.
 *
 * **Cleanup is asserted, not hoped for.** The final check reads the row count
 * back and fails if it is not zero, so a half-cleaned run is a red test rather
 * than silent residue in a shared project.
 *
 * ## Dev, not production, and that is not a compromise
 *
 * `/dev/live-harness` is `notFound()` in a production build — deliberately, and
 * `e2e/production/live-harness-absent.spec.ts` proves it. The harness is the
 * only surface that exposes the hook's commit counter, so the burst runs under
 * `next dev`. What that costs is stated in `HANDOFF/W2-D.md`: this proves the
 * hook and the transport, not the production bundle's behaviour.
 */

const HARNESS = "/de/dev/live-harness?tables=notifications"
const BURST = 40

const URL = process.env["NEXT_PUBLIC_SUPABASE_URL"]
const SERVICE_ROLE = process.env["SUPABASE_SERVICE_ROLE_KEY"]

const configured =
  typeof URL === "string" &&
  URL.length > 0 &&
  typeof SERVICE_ROLE === "string" &&
  SERVICE_ROLE.length > 0

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE as string,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  })
}

async function countNotifications(): Promise<number> {
  const response = await rest("notifications?select=id", {
    method: "HEAD",
    headers: { Prefer: "count=exact", Range: "0-0" },
  })
  const range = response.headers.get("content-range") ?? "0-0/0"
  return Number(range.split("/")[1] ?? 0)
}

test.describe("Supabase Realtime — a real socket, a real burst", () => {
  test.skip(
    !configured,
    "No Supabase project configured; this checkout cannot run the live proof."
  )
  test.setTimeout(180_000)

  let profileId: string | undefined

  test.beforeAll(async () => {
    const response = await rest("profiles?select=id&limit=1")
    const rows = (await response.json()) as Array<{ id: string }>
    profileId = rows[0]?.id
    expect(
      profileId,
      "the live project has no profiles row to attach a notification to"
    ).toBeTruthy()
  })

  test("the table under test starts empty", async () => {
    expect(
      await countNotifications(),
      "notifications is not empty — refusing to burst on top of real rows"
    ).toBe(0)
  })

  test("a channel reaches SUBSCRIBED, and 40 real inserts commit ONE render", async ({
    page,
  }) => {
    const failures: string[] = []
    page.on("console", (m) => {
      if (m.type() === "error") failures.push(m.text())
    })

    await page.goto(HARNESS, { waitUntil: "domcontentloaded" })

    // 1. The connection itself. `realtime` here means the handshake completed
    //    against the real project AND `notifications` is in the publication —
    //    a channel on an unpublished table subscribes and then never fires,
    //    which is indistinguishable from a feature nobody built.
    await expect(
      page.getByTestId("mode"),
      "the channel never reached realtime — is `notifications` in supabase_realtime?"
    ).toHaveText("realtime", { timeout: 45_000 })

    // 2. Zero the counters so the burst is measured as a clean delta.
    await page.evaluate(() => window.__azuraHarness?.reset())
    const before = await page.evaluate(
      () => window.__azuraHarness?.counters() ?? null
    )
    expect(before, "the harness exposed no counters").not.toBeNull()

    // 3. Forty inserts as fast as PostgREST will take them, in one request so
    //    they land inside a single transaction and arrive as a burst rather
    //    than a trickle — which is the case the coalescer exists for.
    const rows = Array.from({ length: BURST }, (_, i) => ({
      profile_id: profileId,
      category: "system",
      severity: "info",
      title: `W2-D live burst ${i + 1}/${BURST}`,
      locale: "de",
    }))
    const insert = await rest("notifications", {
      method: "POST",
      body: JSON.stringify(rows),
      headers: { Prefer: "return=minimal" },
    })
    expect(insert.status, `insert failed: ${await insert.text()}`).toBeLessThan(
      300
    )

    // 4. Let the coalescing window close, then read the committed renders.
    //    The window is the hook's, not this test's — waiting longer only makes
    //    a failure more certain, never a pass more likely.
    await page.waitForTimeout(4_000)
    const after = await page.evaluate(
      () => window.__azuraHarness?.counters() ?? null
    )
    expect(after).not.toBeNull()

    const commits = (after!.commits ?? 0) - (before!.commits ?? 0)
    expect(
      commits,
      `${BURST} real inserts produced ${commits} committed render(s); the coalescer should collapse them to 1`
    ).toBe(1)

    expect(
      failures,
      `console errors during the burst: ${failures.join(" | ")}`
    ).toEqual([])
  })

  test.afterAll(async () => {
    if (!configured) return
    // Cleanup is asserted below, not merely attempted.
    await rest("notifications?title=like.W2-D%20live%20burst*", {
      method: "DELETE",
    })
  })

  test("the project is left exactly as it was found", async () => {
    // A separate test rather than an afterAll assertion, so a failed cleanup is
    // a named red test instead of a warning nobody reads.
    await rest("notifications?title=like.W2-D%20live%20burst*", {
      method: "DELETE",
    })
    expect(
      await countNotifications(),
      "cleanup did not restore notifications to 0 — a shared cloud project has residue from this run"
    ).toBe(0)
  })
})
