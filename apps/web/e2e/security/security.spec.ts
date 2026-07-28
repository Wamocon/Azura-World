import { expect, test } from "@playwright/test"

import { localised, loginAs, roles, visit } from "../helpers"

/**
 * Security behaviour at the browser boundary.                     Owner: W4-A
 *
 * W4-C's probe covers these at the module and HTTP level. What a browser adds
 * is the composed path — a redirect actually followed, a payload actually
 * rendered, a role actually switched — which is where a guard that is correct
 * in isolation can still be bypassed by the surface around it.
 *
 * Overlap with `scripts/security-probe.mjs` is deliberate and stated: if the
 * two ever disagree, that disagreement is the finding.
 */

test.describe("open redirect", () => {
  // Every encoding `tasks/W4-A` §5 names, plus the ones that defeat a naive
  // `startsWith("/")` check.
  const HOSTILE = [
    "https://evil.example",
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "/%5Cevil.example",
    "%2F%2Fevil.example",
    "/%2F%2Fevil.example",
    "/\\/\\evil.example",
    "javascript:alert(1)",
    "/dashboard\r\nSet-Cookie:%20a=b",
  ]

  for (const next of HOSTILE) {
    test(`?next=${next} cannot leave the origin`, async ({ page }) => {
      await page.goto(`${localised("/login")}?next=${encodeURIComponent(next)}`, {
        waitUntil: "domcontentloaded",
      })
      const url = new URL(page.url())
      expect(url.hostname, `left the origin for ${url.hostname}`).toBe("127.0.0.1")
    })
  }
})

test.describe("role elevation", () => {
  test("an unknown access-profile cookie resolves down, never up", async ({ page, context }) => {
    // `admin ` and a JSON blob are rejected by CDP as invalid cookie fields
    // before they ever reach the app, so they are sent percent-encoded — which
    // is how a browser would transmit them anyway.
    const HOSTILE = ["ADMIN", "admin%20", "superuser", "__proto__", "%7B%22role%22%3A%22admin%22%7D"]
    for (const hostile of HOSTILE) {
      await context.clearCookies()
      await context.addCookies([
        {
          name: "access_profile_role",
          value: hostile,
          domain: "127.0.0.1",
          path: "/",
          sameSite: "Lax",
        },
      ])
      await visit(page, localised("/dashboard"))
      const body = (await page.locator("body").innerText()).toLowerCase()
      expect(body, `cookie ${JSON.stringify(hostile)} produced an admin surface`).not.toContain(
        "administrator",
      )
    }
  })

  test("a low role cannot reach the evidence cockpit's content", async ({ page, context }) => {
    // The RSC payload, not just the visible DOM. W4-C's SEC-003 found the
    // cockpit's contents shipped to nine of eleven roles inside the flight data
    // while the visible page showed a correct 403 — a screenshot-based review
    // cannot see that, and neither can `toBeVisible()`.
    await loginAs(context, "tenant")
    const response = await page.goto(localised("/dashboard/evidence"), {
      waitUntil: "domcontentloaded",
    })
    const html = (await response?.text()) ?? ""

    for (const needle of ["Housearch", "239.171", "F-002"]) {
      expect(
        html.includes(needle),
        `SEC-003: a tenant received "${needle}" in the response body`,
      ).toBe(false)
    }
  })
})

test.describe("untrusted content", () => {
  test("harvested review text renders as text, never as markup", async ({ page }) => {
    await visit(page, localised("/hotel"))
    // Any script that arrived from harvested content would execute; assert that
    // no inline script exists outside the framework's own nonce-carrying set.
    const unnonced = await page.evaluate(() =>
      Array.from(document.querySelectorAll("script:not([src])")).filter(
        (s) => !s.hasAttribute("nonce"),
      ).length,
    )
    expect(unnonced, "an inline script without a nonce reached the page").toBe(0)

    // And the escaping path is exercised: a quote containing a bare ampersand
    // proves the text went through React's escaping rather than innerHTML.
    const html = await page.content()
    expect(html, "no evidence that review text is escaped").toContain("&amp;")
  })
})

test.describe("the seed is never presented as live", () => {
  for (const role of ["admin", "manager"] as const) {
    test(`${role}: a surface serving seed data says so`, async ({ page, context }) => {
      await loginAs(context, role)
      await visit(page, localised("/dashboard"))
      const text = (await page.locator("body").innerText()).toLowerCase()
      // With no Supabase configured every repository answers `local-seed`, and
      // CONTRACTS §4 requires the surface to say it.
      expect(
        /seed|demo|beispiel|lokale daten|local data/.test(text),
        "seed data served with no notice",
      ).toBe(true)
    })
  }
})

test.describe("no role sees a server error", () => {
  test("every role loads the dashboard home without a 5xx", async ({ page, context }) => {
    const failures: string[] = []
    for (const role of roles) {
      await loginAs(context, role)
      const { status } = await visit(page, localised("/dashboard"))
      if (status >= 500) failures.push(`${role} → ${status}`)
    }
    expect(failures, `server errors: ${failures.join(", ")}`).toEqual([])
  })
})
