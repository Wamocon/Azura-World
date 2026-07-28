import { expect, test } from "@playwright/test"

import { ACCESS_PROFILE_COOKIE } from "../../lib/access-profile-policy"
import { dashboardRoutes } from "../../lib/dashboard-routing"
import { localised, visit } from "../helpers"

/**
 * Production truth.                                               Owner: W4-A
 *
 * These run against `next start` on :3201 — a real production build, with the
 * three access-profile flags deliberately SET, because the point is that
 * setting them changes nothing.
 *
 * ## W3-C's open verification, and what this can and cannot settle
 *
 * `HANDOFF/W3-C.md` §9 leaves W4-A an explicit item: *"the evidence cockpit
 * renders under `next start` with a real session"* — the page had only ever
 * been driven under `next dev`, because in production it 307s to login.
 *
 * That verification **cannot be completed in this environment**, and the reason
 * is worth stating precisely rather than recording as "not done":
 *
 *   1. A real Supabase session needs a data plane. `docker info` exits 1 on this
 *      machine and there is no `psql`, so `supabase start` cannot run.
 *   2. The QA access profile cannot substitute. `accessProfilesEnabledForEnvironment()`
 *      returns `false` for any process where `NODE_ENV` is `production`, before
 *      it reads a flag — and `next start` sets exactly that.
 *   3. There is no login form to drive. `/[locale]/login` is a 404 today: the
 *      directory holds `actions.ts` and no `page.tsx` (W4-B §4.1).
 *
 * So the tests below settle the half that *is* reachable, and say so:
 *
 *   - the guard genuinely redirects in production (which is what W3-C saw), and
 *   - the flags are inert there, which is the security guarantee underneath it.
 *
 * `e2e/production/evidence-render.spec.ts` closes the other half a different
 * way — by serving the **production build artifact** under a non-production
 * NODE_ENV — and is explicit about the narrower claim that makes.
 */

test.describe("production build", () => {
  test("the access-profile cookie buys nothing", async ({ page, context }) => {
    await context.addCookies([
      {
        name: ACCESS_PROFILE_COOKIE,
        value: "admin",
        domain: "127.0.0.1",
        path: "/",
        httpOnly: false,
        secure: false,
        sameSite: "Lax",
      },
    ])

    await visit(page, localised("/dashboard"))
    expect(
      new URL(page.url()).pathname,
      "an admin cookie reached the dashboard in a production build",
    ).toContain("/login")
  })

  test("every dashboard route redirects an anonymous caller to login", async ({ page }) => {
    const reached: string[] = []
    for (const route of dashboardRoutes) {
      await visit(page, localised(route.href))
      if (!new URL(page.url()).pathname.includes("/login")) reached.push(route.href)
    }
    expect(reached, `routes served without a session: ${reached.join(", ")}`).toEqual([])
  })

  test("W3-C's observation reproduces: the cockpit 307s without a session", async ({ page }) => {
    const response = await page.goto(localised("/dashboard/evidence"), {
      waitUntil: "domcontentloaded",
    })
    expect(new URL(page.url()).pathname).toContain("/login")
    // The guard's redirect carries the destination, so a session could return.
    expect(page.url()).toContain("next=")
    // And what it lands on is a 404 — the blocking defect W4-B reported.
    expect(response?.status(), "login rendered, so W4-B §4.1 is fixed").toBe(404)
  })

  test("the public surfaces render in production", async ({ page }) => {
    for (const path of ["/", "/hotel"]) {
      const { status } = await visit(page, localised(path))
      expect(status, `${path} did not render in a production build`).toBe(200)
      await expect(page.locator("main, body")).toBeVisible()
    }
  })
})
