import type { BrowserContext, Page, Response } from "@playwright/test"

import { roles, type Locale, type Role } from "../lib/contracts"
import { dashboardRoutes, type DashboardRoute } from "../lib/dashboard-routing"
import { hasPermission } from "../lib/rbac"
import { ACCESS_PROFILE_COOKIE } from "../lib/access-profile-policy"

/**
 * Shared fixtures.                                                Owner: W4-A
 *
 * Everything the matrix iterates over is **imported from the application**, not
 * restated here. `tasks/W4-A` asks for the matrix to be generated rather than
 * hand-written, and the reason is that a hand-written copy of the permission
 * table tests the copy. If W1-B adds a role or W3-B adds a route, the matrix
 * grows on the next run without anybody editing this file.
 */

export { roles, dashboardRoutes, hasPermission }
export type { Role, DashboardRoute, Locale }

/** The four locales, and the one the suite drives by default. */
export const LOCALES: readonly Locale[] = ["de", "en", "tr", "ru"]
export const DEFAULT_LOCALE: Locale = "de"

/**
 * Routes with a real `page.tsx` today. **Nineteen of the twenty-one dashboard
 * routes are not built yet** — `dashboard-routing.ts` marks them `pending`.
 *
 * This matters for honesty, not for coverage: the matrix still runs every cell,
 * because the authorisation decision is made by the layout and the guard rather
 * than by the page, and a role that must not reach `/dashboard/finance` must be
 * refused whether or not that page exists. But a cell that lands on an unbuilt
 * route proves less than one that renders a module, and `HANDOFF/W4-A.md` §2
 * reports the two counts separately rather than letting 462 stand as if every
 * cell exercised a screen.
 */
export const BUILT_ROUTES: readonly string[] = [
  "/dashboard",
  "/dashboard/evidence",
]

export function isBuilt(route: DashboardRoute): boolean {
  return BUILT_ROUTES.includes(route.href)
}

/** A locale-prefixed path. `localePrefix: "always"`, so `/` alone is a redirect. */
export function localised(
  path: string,
  locale: Locale = DEFAULT_LOCALE
): string {
  return `/${locale}${path}`
}

/**
 * Gives the context a role.
 *
 * This is the **access-profile** path, not a login: `/[locale]/login` returns
 * 404 (W4-B §4.1 — the directory holds `actions.ts` and no `page.tsx`), so
 * there is no form to fill in, and with no Supabase configured there is no
 * session to establish either. `getUserProfile()` resolves this cookie when
 * access profiles are enabled, which is the only way eleven roles are reachable
 * in this environment.
 *
 * It follows that **this suite does not test authentication**. It tests
 * authorisation given an identity. That distinction is stated in the handoff
 * rather than left for a reader to infer from a green run.
 */
export async function loginAs(
  context: BrowserContext,
  role: Role,
  port = 3200
): Promise<void> {
  await context.clearCookies()
  await context.addCookies([
    {
      name: ACCESS_PROFILE_COOKIE,
      value: role,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ])
  void port
}

/** Removes any identity, so the caller is anonymous. */
export async function logout(context: BrowserContext): Promise<void> {
  await context.clearCookies()
}

/**
 * Navigates and returns the response, following the guard's redirect.
 *
 * Playwright reports the FINAL response after a redirect chain, so a 307 to
 * login surfaces as whatever login answered. `finalUrl` is what distinguishes
 * "rendered" from "was sent somewhere else", and the matrix asserts on both.
 */
export async function visit(
  page: Page,
  path: string
): Promise<{ status: number; finalUrl: string; response: Response | null }> {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" })
  return {
    status: response?.status() ?? 0,
    finalUrl: new URL(page.url()).pathname,
    response,
  }
}

/**
 * Whether the rendered page is the 403 panel.
 *
 * W3-B's guard renders `data-testid="dashboard-403"` in place of the module and
 * deliberately does NOT redirect — the brief called a redirect confusing and a
 * loop risk. So "forbidden" is a 200 carrying a 403 panel, not an HTTP 403, and
 * the matrix asserts the panel rather than the status code.
 *
 * That is a real divergence from `tasks/W4-A`'s illustrative snippet, which
 * expects `res.status() === 403`. The snippet describes an API; this is a
 * Server Component route. Asserting the status here would fail every cell and
 * prove nothing.
 */
export async function isForbiddenPanel(page: Page): Promise<boolean> {
  return (await page.locator('[data-testid="dashboard-403"]').count()) > 0
}

/** Any error boundary rendered anywhere on the page. */
export async function hasErrorBoundary(page: Page): Promise<boolean> {
  return (await page.locator("[data-error-boundary]").count()) > 0
}

/** Disables animation so screenshots and layout reads are deterministic. */
export async function freezeMotion(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
    }`,
  })
}

/** Collected console errors, for the "any console error is a finding" rule. */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`))
  return errors
}
