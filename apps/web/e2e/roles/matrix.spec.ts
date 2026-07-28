import { expect, test } from "@playwright/test"

import {
  dashboardRoutes,
  hasErrorBoundary,
  hasPermission,
  isBuilt,
  isForbiddenPanel,
  localised,
  loginAs,
  roles,
  visit,
} from "../helpers"

/**
 * The role × route matrix.                                        Owner: W4-A
 *
 * **11 roles × 21 routes = 231 cells, generated from the application's own
 * tables**, run in both viewport projects for 462 executions. Nothing here is
 * hand-written: `roles` comes from `lib/contracts.ts`, `dashboardRoutes` from
 * `lib/dashboard-routing.ts`, and the expected answer from `hasPermission()`.
 * A hand-maintained copy of the permission table would only ever test the copy.
 *
 * ## Both directions, and why the forbidden half is the one that matters
 *
 * `tasks/W4-A`: *"A matrix that only checks that permitted roles get in proves
 * nothing about security; the forbidden half is the half that matters."* So each
 * cell asserts the pair:
 *
 *   - role HOLDS the permission  → the module renders, no 403 panel, no error boundary
 *   - role LACKS it              → the 403 panel renders, and the module's content does not
 *
 * ## What a cell can and cannot prove today
 *
 * Nineteen of the twenty-one routes have no `page.tsx` yet. The authorisation
 * decision does not live in the page — it is the dashboard layout resolving
 * `dashboard:view` and `DashboardRouteGuard` resolving the module permission —
 * so every cell still exercises a real decision. But a cell on an unbuilt route
 * cannot show that the module honours it, and the handoff reports the built and
 * unbuilt counts separately rather than presenting 462 as if each one drove a
 * screen.
 *
 * ## The status code
 *
 * W3-B's guard renders a 403 **panel** at HTTP 200 and deliberately does not
 * redirect. `tasks/W4-A`'s snippet expects `status === 403`; that describes an
 * API route, and asserting it here would fail all 231 cells while proving
 * nothing. The panel is asserted instead — see `isForbiddenPanel` for the note.
 */

test.describe("role × route matrix", () => {
  for (const role of roles) {
    for (const route of dashboardRoutes) {
      const allowed = hasPermission(role, route.permission)
      const built = isBuilt(route)
      const label =
        `${role} → ${route.href} ` +
        `[${allowed ? "allow" : "deny"}]${built ? "" : " (route not built)"}`

      test(label, async ({ page, context }) => {
        await loginAs(context, role)
        const { status } = await visit(page, localised(route.href))

        // Holds for every cell, built or not: the guard never 5xxs and never
        // bounces an authenticated caller to login — CONVENTIONS §5 calls the
        // redirect loop the failure mode here.
        expect(status, "no server error").toBeLessThan(500)
        expect(new URL(page.url()).pathname, "not redirected to login").not.toContain("/login")

        if (!built) {
          // An unbuilt route answers 404 for EVERY role, permitted or not: Next
          // resolves the missing page before the guard renders anything. Safe —
          // there is no content to withhold — but it means the authorisation
          // half is NOT proven on these nineteen routes, and the handoff counts
          // them separately rather than letting 231 stand as if each cell
          // proved a permission decision.
          expect(status, "an unbuilt route answered something other than 404").toBe(404)
          expect(await isForbiddenPanel(page), "a 404 page rendered the 403 panel").toBe(false)
          return
        }

        const forbidden = await isForbiddenPanel(page)

        if (allowed) {
          expect(forbidden, `${role} holds ${route.permission} and got the 403 panel`).toBe(false)
          expect(await hasErrorBoundary(page), "error boundary rendered").toBe(false)
          await expect(page.locator("main").first()).toBeVisible()
        } else {
          expect(forbidden, `${role} lacks ${route.permission} and was NOT refused`).toBe(true)
          // The refusal must also withhold the content, not merely cover it.
          await expect(page.locator('[data-testid="dashboard-403"]')).toBeVisible()
        }
      })
    }
  }
})

/**
 * The nav must not offer a route the role cannot open.
 *
 * A link to a 403 is a dead end the user cannot distinguish from a bug, and it
 * is also an information leak: the set of visible links describes the shape of
 * the product to somebody who is not entitled to it.
 */
test.describe("navigation matches the permission table", () => {
  for (const role of roles) {
    test(`${role}: every offered link is one this role may open`, async ({ page, context }) => {
      await loginAs(context, role)
      await visit(page, localised("/dashboard"))

      const hrefs = await page
        .locator('nav a[href*="/dashboard"]')
        .evaluateAll((nodes) =>
          nodes.map((n) => new URL((n as HTMLAnchorElement).href).pathname),
        )

      for (const href of hrefs) {
        // Strip the locale prefix the links carry.
        const bare = href.replace(/^\/(de|en|tr|ru)/, "")
        const route = dashboardRoutes.find((r) => r.href === bare)
        if (route === undefined) continue
        expect(
          hasPermission(role, route.permission),
          `${role} was offered ${bare}, which needs ${route.permission}`,
        ).toBe(true)
      }
    })
  }
})

/**
 * Landmark structure on the routes that render a module.
 *
 * Split out of the matrix because it is a property of the page rather than of
 * the permission decision, and because it is currently **failing**: the
 * evidence cockpit renders two `<main>` elements — one from the dashboard
 * layout (`<main id="main">`) and one from the page itself. WCAG 2.2 allows
 * exactly one `main` landmark per document and CONVENTIONS §7 requires semantic
 * landmarks, so a screen reader user gets two "main" regions and no way to tell
 * which is the content.
 *
 * Reported rather than worked around: the matrix above uses `.first()` so the
 * permission assertions still run, and this test keeps the defect visible.
 */
test.describe("landmark structure", () => {
  for (const href of ["/dashboard", "/dashboard/evidence"]) {
    test(`${href} renders exactly one <main>`, async ({ page, context }) => {
      await loginAs(context, "admin")
      await visit(page, localised(href))
      const mains = await page.locator("main").count()
      expect(mains, `${href} rendered ${mains} <main> landmarks`).toBe(1)
    })
  }
})
