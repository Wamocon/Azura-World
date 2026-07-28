import { expect, test } from "@playwright/test"

import {
  LOCALES,
  collectConsoleErrors,
  freezeMotion,
  localised,
  visit,
} from "../helpers"

/**
 * The public surfaces.                                            Owner: W4-A
 *
 * Landing and hotel, in four locales, with the console watched. `tasks/W4-B`'s
 * rule applies here too: any console error is a finding, because nobody looks
 * at them and they are almost always real.
 */

test.describe("public surfaces", () => {
  for (const locale of LOCALES) {
    test(`${locale}: the landing page renders its argument`, async ({
      page,
    }) => {
      await freezeMotion(page)
      const { status } = await visit(page, localised("/", locale))
      expect(status).toBe(200)

      await expect(page.locator("h1")).toBeVisible()
      // Exactly one h1 — WCAG landmark structure, CONVENTIONS §7.
      expect(await page.locator("h1").count(), "more than one h1").toBe(1)

      // The page's whole premise: a number it trusts beside one it does not.
      const text = (await page.locator("body").innerText()).replace(/\s+/g, " ")
      expect(text, "the corroborated unit count is missing").toMatch(/656/)
      expect(text, "the plot area is missing").toMatch(/76[.,]000|76 000/)

      // The conflict badge is visible, not hover-only.
      const conflicted = page.locator("[data-confidence='conflicted']")
      expect(
        await conflicted.count(),
        "no conflicted fact rendered"
      ).toBeGreaterThan(0)
      await expect(conflicted.first()).toBeVisible()
    })
  }

  for (const locale of LOCALES) {
    test(`${locale}: the hotel page keeps every score on its own scale`, async ({
      page,
    }) => {
      await freezeMotion(page)
      const { status } = await visit(page, localised("/hotel", locale))
      expect(status).toBe(200)
      await expect(page.locator("h1")).toBeVisible()

      const text = (await page.locator("body").innerText()).replace(/\s+/g, " ")
      expect(text, "the Tripadvisor score is missing").toMatch(/4[.,]6/)

      // The scale travels with the score, but not adjacently in `innerText`:
      // a confidence label sits between them in the DOM ("4,6 Einzelquelle / 5").
      // So the assertion is scoped to the score card rather than matched against
      // the flattened page text, which an earlier version of this test did and
      // which failed on correct markup.
      const card = page.locator("[data-slot='platform-score']").first()
      await expect(card, "no platform score card rendered").toBeVisible()
      const cardText = (await card.innerText()).replace(/\s+/g, " ")
      expect(cardText, "the score card carries no scale").toMatch(/\/\s*(5|10)/)
    })
  }

  test("the landing page logs no console errors", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await freezeMotion(page)
    await visit(page, localised("/"))
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(
      page.locator("footer, [data-slot='footer']").first()
    ).toBeVisible()
    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([])
  })

  test("reduced motion yields a complete page, not a faster one", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await visit(page, localised("/"))
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

    // azura-ui-ux §5.1: content revealed only by ScrollTrigger is invisible to
    // this user. Nothing may be left at opacity 0.
    const invisible = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll("body *")).filter((node) => {
          const style = getComputedStyle(node)
          if (style.display === "none" || style.visibility === "hidden")
            return false
          return (
            Number(style.opacity) === 0 &&
            (node as HTMLElement).innerText?.trim().length > 0
          )
        }).length
    )
    expect(invisible, "content left at opacity 0 under reduced motion").toBe(0)
  })

  test("no WebGL yields a poster, not a blank box", async ({ browser }) => {
    const context = await browser.newContext()
    await context.addInitScript(() => {
      const deny = () => null
      HTMLCanvasElement.prototype.getContext =
        deny as typeof HTMLCanvasElement.prototype.getContext
    })
    const page = await context.newPage()
    await page.goto(localised("/"), { waitUntil: "domcontentloaded" })
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

    // Something visual must stand in — azura-ui-ux §5.2.
    // W1-D's fallback is `CoastPoster`, which renders `data-slot="coast-poster"`.
    // An earlier version of this test looked for a generic `[data-slot='poster']`
    // and reported a working fallback as missing.
    const poster = page.locator("[data-slot='coast-poster']")
    expect(
      await poster.count(),
      "WebGL is unavailable and nothing stood in"
    ).toBeGreaterThan(0)
    await context.close()
  })

  test("German at 320px does not scroll horizontally", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 })
    await freezeMotion(page)
    await visit(page, localised("/", "de"))
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(
      overflow.scrollWidth,
      `horizontal overflow: ${overflow.scrollWidth} > ${overflow.clientWidth}`
    ).toBeLessThanOrEqual(overflow.clientWidth)
  })

  for (const locale of LOCALES) {
    test(`${locale}: no message key renders as its own name`, async ({
      page,
    }) => {
      await visit(page, localised("/hotel", locale))
      const text = await page.locator("body").innerText()

      // next-intl returns the KEY when a message it parsed needs an argument the
      // caller did not supply. Every one of these strings carries an ICU
      // placeholder and every call site does `t("key")` with no values and then
      // hand-interpolates with `.replace()` — so the reader sees
      // "hotel.platform.open" where a sentence should be.
      //
      // Matched as a dotted namespace token, so ordinary prose cannot trip it.
      const leaked = [
        ...text.matchAll(
          /(hotel|evidence|landing|dashboard)\.[a-z][a-zA-Z]*(?:\.[a-z][a-zA-Z]*)+/g
        ),
      ]
        .map((m) => m[0])
        .filter((k) => !k.startsWith("hotel.com"))

      expect(
        [...new Set(leaked)],
        `untranslated message keys rendered as text: ${[...new Set(leaked)].join(", ")}`
      ).toEqual([])
    })
  }
})
