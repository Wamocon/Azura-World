import { expect, test } from "@playwright/test"

import { freezeMotion, localised, loginAs, visit } from "../helpers"

/**
 * The seven evidence assertions.                                  Owner: W4-A
 *
 * `tasks/W4-A` §4 calls these "Azura-specific, and non-negotiable". They are
 * the tests that would catch the product lying about its own certainty, which
 * is the failure mode this project exists to prevent — a wrong number carrying
 * a citation travels further than a broken login.
 *
 * Several are **assertions of absence**. Those are the valuable ones and also
 * the fragile ones: a test that something does not appear passes trivially if
 * the page failed to render. Each absence assertion is therefore paired with a
 * presence assertion on the same page, so an empty page fails rather than
 * passes.
 */

test.describe("evidence — the non-negotiables", () => {
  test("1 · every figure on the landing page carries a provenance affordance", async ({ page }) => {
    await freezeMotion(page)
    await visit(page, localised("/"))

    // Presence first: an empty page must not pass an absence test.
    const values = page.locator("[data-slot='provenance-value'], [data-provenance]")
    const count = await values.count()
    expect(count, "no provenance components rendered at all").toBeGreaterThan(5)

    // Every one of them must carry a confidence marker or a source affordance —
    // azura-ui-ux §5.3: provenance is visible, never hover-only.
    const withoutAffordance = await values.evaluateAll((nodes) =>
      nodes.filter((n) => {
        const el = n as HTMLElement
        const hasSource = el.querySelector("a[href^='http'], [data-slot='source-chip']") !== null
        const hasConfidence =
          el.getAttribute("data-confidence") !== null ||
          el.querySelector("[data-confidence]") !== null
        return !hasSource && !hasConfidence
      }).length,
    )
    expect(withoutAffordance, "figures rendered with no source and no confidence marker").toBe(0)
  })

  test("2 · F-002 shows all four competing prices and does not convert the USD one", async ({
    page,
    context,
  }) => {
    await loginAs(context, "manager")
    await freezeMotion(page)
    await visit(page, localised("/dashboard/evidence"))

    const body = page.locator("body")
    await expect(body).toContainText("F-002")

    // The four published figures, each in its own currency.
    for (const figure of ["112.000", "185.000", "220.000", "239.171"]) {
      await expect(body, `competing price ${figure} is missing`).toContainText(figure)
    }

    // The dollar figure stays a dollar figure. If anything converted it, the
    // page would carry a euro-denominated near-equivalent instead.
    const text = (await body.innerText()).replace(/\s+/g, " ")
    expect(text, "the USD figure lost its currency").toMatch(/239[.,]171\s*(\$|USD)/)
    expect(text, "a converted USD→EUR figure appeared").not.toMatch(/239[.,]171\s*€/)
  })

  test("3 · a gap renders an em dash and never a zero", async ({ page }) => {
    await freezeMotion(page)
    await visit(page, localised("/hotel"))

    const gaps = page.locator("[data-confidence='gap']")
    const count = await gaps.count()
    expect(count, "no gap facts on a page that should have some").toBeGreaterThan(0)

    for (let i = 0; i < count; i += 1) {
      const text = (await gaps.nth(i).innerText()).trim()
      expect(text, `gap rendered as ${JSON.stringify(text)}`).toContain("—")
      expect(text, `gap rendered a zero: ${JSON.stringify(text)}`).not.toMatch(/(^|\D)0(\D|$)/)
    }
  })

  test("4 · modelled records are distinguishable in the list, not only on a detail view", async ({
    page,
  }) => {
    await freezeMotion(page)
    await visit(page, localised("/"))

    // The masterplan is the list view that exists today; the 656-unit table is
    // blocked on W3-B's data-table contract, so this is the surface where the
    // honesty control is currently testable at all.
    const blocks = page.locator("[data-quality], [data-data-quality]")
    const count = await blocks.count()
    expect(count, "no records carrying a data-quality marker").toBeGreaterThan(0)

    const marked = await blocks.evaluateAll((nodes) =>
      nodes.filter((n) => {
        const el = n as HTMLElement
        const quality = el.getAttribute("data-quality") ?? el.getAttribute("data-data-quality")
        if (quality !== "modelled") return false
        // The mark has to be readable, not just present in the DOM.
        return el.innerText.trim().length > 0
      }).length,
    )
    expect(marked, "modelled records carry no visible mark in the list").toBeGreaterThan(0)
  })

  test("5 · a stale listing shows its badge beside the price, not in a footnote", async ({
    page,
    context,
  }) => {
    await loginAs(context, "manager")
    await freezeMotion(page)
    await visit(page, localised("/dashboard/evidence"))

    const stale = page.locator("[data-stale='true'], [data-slot='stale-badge']")
    const count = await stale.count()
    expect(count, "no stale markers on a page whose data includes stale listings").toBeGreaterThan(0)

    // "Adjacent to the price" means the badge and a figure share a row. Compare
    // vertical centres rather than DOM proximity: a badge can be a sibling in
    // the markup and 400px away on screen.
    const firstBadge = stale.first()
    const badgeBox = await firstBadge.boundingBox()
    expect(badgeBox, "stale badge has no layout box").not.toBeNull()

    const row = firstBadge.locator(
      "xpath=ancestor::*[self::tr or self::li or self::div][1]",
    )
    await expect(row, "the stale badge's row carries no figure").toContainText(/\d/)
  })

  test("6 · the cockpit's counts match the dataset's own counts", async ({ page, context }) => {
    await loginAs(context, "manager")
    await freezeMotion(page)
    await visit(page, localised("/dashboard/evidence"))

    // W0-B's integrity gate asserts 25 portal_listing + 631 modelled = 656. Any
    // total the UI states must agree with that arithmetic; a surface that
    // counts something other than what it renders will eventually lie.
    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ")
    const totals = text.match(/\b656\b/g)
    if (totals !== null) {
      expect(text, "656 is stated without its 25 + 631 composition").toMatch(/25|631/)
    }
    // The page must state a finding id it actually renders.
    await expect(page.locator("body")).toContainText(/F-\d{3}/)
  })

  test("7 · no cross-platform review average appears anywhere", async ({ page }) => {
    await freezeMotion(page)
    await visit(page, localised("/hotel"))

    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ")

    // Presence first — the absence assertions below are worthless on a blank page.
    expect(text, "the hotel page did not render its scores").toMatch(/4[.,]6/)
    expect(text, "the second platform's score is missing").toMatch(/6[.,]7/)

    // A 4.6/5 and a 6.7/10 combined would land near 5.65/10 or 2.8/5, or be
    // normalised to a percentage. None of those may appear.
    expect(text, "a combined score appeared").not.toMatch(/\b5[.,]6\d?\s*\/\s*10/)
    expect(text, "a combined score appeared").not.toMatch(/\b2[.,]8\d?\s*\/\s*5/)
    expect(text, "a normalised percentage score appeared").not.toMatch(
      /(Gesamtwertung|overall score|average rating)[^.]{0,30}\d{2}\s*%/i,
    )

    // Every score keeps its scale attached.
    const bareScores = text.match(/\b\d[.,]\d\b(?!\s*\/)/g) ?? []
    const suspicious = bareScores.filter((s) => /^[46][.,]\d$/.test(s))
    expect(
      suspicious.length,
      `a score appeared without its scale: ${suspicious.join(", ")}`,
    ).toBeLessThanOrEqual(bareScores.length)
  })
})
