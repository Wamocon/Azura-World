import { expect, test } from "@playwright/test"

import { LOCALES } from "../helpers"

/**
 * The harness cannot exist in production.                      Owner: W2-D
 *
 * `app/[locale]/dev/live-harness` mounts `useLiveSnapshot` so its effect wiring
 * can be driven from a browser. It is development scaffolding, and scaffolding
 * that ships is a liability: this page takes a `tables` parameter and opens a
 * realtime channel, so a reachable copy in production would be an unauthenticated
 * way to hold sockets open against the project.
 *
 * It is gated by `accessProfilesEnabledForEnvironment()` — W1-B's predicate,
 * which returns `false` for any process where `NODE_ENV`, `VERCEL_ENV` or
 * `AZURA_ENV` is `production` **before it reads a flag**. Reusing that gate
 * rather than writing a second `process.env.NODE_ENV` check is the point: there
 * is one place this decision is made, W4-C already verified it 39/39 at the HTTP
 * boundary, and this spec closes the loop for this specific route.
 *
 * Runs in the `production` project only — the one server where `NODE_ENV` is
 * genuinely `production`. `playwright.config.ts` sets the three access-profile
 * flags true for that server deliberately, so this asserts the gate holds *with
 * the flags on*, which is a stronger claim than asserting it with them off.
 */

test.describe("production — the live harness is not reachable", () => {
  for (const locale of LOCALES) {
    test(`/${locale}/dev/live-harness returns 404`, async ({ page }) => {
      const response = await page.goto(`/${locale}/dev/live-harness`)

      expect(
        response?.status(),
        `the development harness is reachable in a production build (${locale}). accessProfilesEnabledForEnvironment() must gate it.`
      ).toBe(404)

      // Not just the status: the harness's own markup must be absent, so a
      // future 404 page that still rendered the component would be caught.
      await expect(page.getByTestId("mode")).toHaveCount(0)
      await expect(page.getByTestId("state")).toHaveCount(0)
    })
  }

  test("no realtime socket is opened from the harness path in production", async ({
    page,
  }) => {
    const sockets: string[] = []
    page.on("websocket", (ws) => {
      if (ws.url().includes("/realtime/v1/websocket")) sockets.push(ws.url())
    })

    await page.goto("/de/dev/live-harness?tables=units")
    await page.waitForTimeout(3_000)

    expect(
      sockets,
      "a production build opened a realtime channel from the dev harness path"
    ).toEqual([])
  })
})
