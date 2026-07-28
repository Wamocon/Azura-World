/**
 * a11y-audit — structural accessibility over every route × locale × theme.
 *                                                                Owner: W4-B
 *
 * `node scripts/a11y-audit.mjs`
 *
 * ## READ THIS BEFORE TRUSTING A PASS: this is not axe
 *
 * tasks/W4-B asks for "axe-core over every route × 4 locales". **axe-core is
 * not an installed dependency**, and adding one means `pnpm install`, which is
 * W0-A's to run and is explicitly not to be run concurrently. So this harness
 * implements the specific rules the brief then names — landmarks, one `<h1>`,
 * form-label association, focus visibility in both themes — plus the subset of
 * axe's catalogue that is cheap and unambiguous to check directly.
 *
 * It is **narrower than axe** and says so on every run. It does not do colour
 * contrast (that is `layout-audit`, across 8 widths and both themes), ARIA
 * attribute validity, or anything requiring the accessibility tree. A pass here
 * means "none of these specific rules is violated", not "accessible".
 *
 * Installing `axe-core` and replacing the RULES array below is a strictly
 * better harness and is filed as a request in HANDOFF/W4-B.md.
 */

import {
  LOCALES,
  THEMES,
  createReporter,
  launchBrowser,
  parseArgs,
  preparePage,
  publicRoutes,
  reportBlindSpots,
  resultDir,
  startServer,
  urlFor,
  writeJson,
} from "./qa-lib.mjs"

const args = parseArgs(process.argv.slice(2))
const PORT = Number(args.values.get("port") ?? 3290)

const BLIND_SPOTS = [
  "THIS IS NOT axe-core. axe is not installed and `pnpm install` is W0-A's to run. This " +
    "harness checks a hand-written rule set, listed in the report as `rules`. A pass means " +
    "those rules hold — not that the page is accessible.",
  "No accessibility-tree inspection: computed roles, accessible names from complex " +
    "aria-labelledby chains, and live-region behaviour are unchecked.",
  "Colour contrast is NOT checked here — layout-audit does it across 8 widths and both " +
    "themes, which is a wider net than a single-viewport a11y pass.",
  "Keyboard navigation is checked only for focus VISIBILITY, not for order, traps, or " +
    "whether every workflow is reachable. A keyboard trap will pass this harness.",
  "No screen-reader pass. W1-D and W3-I both record that as an open [GAP]; nothing here " +
    "closes it, because an automated check cannot.",
  "Authenticated routes are not audited (QA access profiles are off under NODE_ENV=production).",
]

const RULES = [
  "html-has-lang",
  "html-lang-matches-route",
  "single-h1",
  "heading-order",
  "landmark-main",
  "landmark-unique",
  "image-alt",
  "control-has-name",
  "label-association",
  "duplicate-id",
  "list-structure",
  "focus-visible",
  "link-name",
  "skip-to-content",
]

const AUDIT = (expectedLocale) => {
  const findings = []
  const add = (rule, impact, selector, detail) =>
    findings.push({ rule, impact, selector, detail })

  const describe = (el) => {
    if (!el) return "?"
    const id = el.id ? `#${el.id}` : ""
    const cls =
      typeof el.className === "string" && el.className
        ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}`
        : ""
    return `${el.tagName.toLowerCase()}${id}${cls}`
  }
  const visible = (el) => {
    const s = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0
  }
  const accessibleName = (el) => {
    const aria = el.getAttribute("aria-label")
    if (aria && aria.trim()) return aria.trim()
    const labelledBy = el.getAttribute("aria-labelledby")
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ")
        .trim()
      if (text) return text
    }
    const title = el.getAttribute("title")
    if (title && title.trim()) return title.trim()
    const text = (el.textContent ?? "").trim()
    if (text) return text
    const img = el.querySelector("img[alt]")
    if (img && img.getAttribute("alt").trim()) return img.getAttribute("alt").trim()
    return ""
  }

  // ---- document ------------------------------------------------------------
  const lang = document.documentElement.getAttribute("lang")
  if (!lang) add("html-has-lang", "serious", "html", "no lang attribute")
  else if (lang.split("-")[0] !== expectedLocale) {
    add(
      "html-lang-matches-route",
      "serious",
      "html",
      `lang="${lang}" but the route is /${expectedLocale}. A screen reader will pronounce this page with the wrong voice.`,
    )
  }

  // ---- headings ------------------------------------------------------------
  const h1s = [...document.querySelectorAll("h1")].filter(visible)
  if (h1s.length === 0) add("single-h1", "serious", "document", "no visible <h1>")
  else if (h1s.length > 1) add("single-h1", "moderate", "document", `${h1s.length} visible <h1> elements`)

  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(visible)
  let previous = 0
  for (const heading of headings) {
    const level = Number(heading.tagName[1])
    if (previous !== 0 && level > previous + 1) {
      add("heading-order", "moderate", describe(heading),
        `jumps from h${previous} to h${level}: "${(heading.textContent ?? "").trim().slice(0, 40)}"`)
    }
    previous = level
  }

  // ---- landmarks -----------------------------------------------------------
  const mains = [...document.querySelectorAll("main, [role=main]")].filter(visible)
  if (mains.length === 0) add("landmark-main", "serious", "document", "no <main> landmark")
  else if (mains.length > 1) add("landmark-unique", "moderate", "document", `${mains.length} main landmarks`)

  for (const [selector, role] of [["nav", "navigation"], ["header", "banner"], ["footer", "contentinfo"]]) {
    const nodes = [...document.querySelectorAll(selector)].filter(visible)
    if (nodes.length > 1) {
      const unnamed = nodes.filter((n) => !accessibleName(n) && !n.getAttribute("aria-label"))
      if (unnamed.length > 1) {
        add("landmark-unique", "moderate", selector,
          `${nodes.length} <${selector}> (${role}) landmarks and ${unnamed.length} have no accessible name to tell them apart`)
      }
    }
  }

  // ---- images --------------------------------------------------------------
  for (const img of document.querySelectorAll("img")) {
    if (!img.hasAttribute("alt")) {
      add("image-alt", "critical", describe(img), `src=${(img.getAttribute("src") ?? "").slice(0, 60)}`)
    }
  }

  // ---- controls ------------------------------------------------------------
  for (const el of document.querySelectorAll("button, [role=button]")) {
    if (!visible(el)) continue
    if (!accessibleName(el)) add("control-has-name", "critical", describe(el), "button has no accessible name")
  }
  for (const el of document.querySelectorAll("a[href]")) {
    if (!visible(el)) continue
    if (!accessibleName(el)) add("link-name", "serious", describe(el), `href=${el.getAttribute("href")?.slice(0, 50)}`)
  }
  for (const el of document.querySelectorAll("input, select, textarea")) {
    if (!visible(el)) continue
    const type = (el.getAttribute("type") ?? "").toLowerCase()
    if (type === "hidden" || type === "submit" || type === "button") continue
    const id = el.id
    const labelled =
      (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) ||
      el.closest("label") ||
      el.getAttribute("aria-label") ||
      el.getAttribute("aria-labelledby")
    if (!labelled) add("label-association", "critical", describe(el), `type=${type || el.tagName.toLowerCase()} has no label`)
  }

  // ---- duplicate ids -------------------------------------------------------
  const ids = new Map()
  for (const el of document.querySelectorAll("[id]")) {
    const id = el.id
    ids.set(id, (ids.get(id) ?? 0) + 1)
  }
  for (const [id, count] of ids) {
    if (count > 1) add("duplicate-id", "moderate", `#${id}`, `${count} elements share this id`)
  }

  // ---- list structure ------------------------------------------------------
  for (const list of document.querySelectorAll("ul, ol")) {
    for (const child of list.children) {
      if (!["LI", "SCRIPT", "TEMPLATE"].includes(child.tagName)) {
        add("list-structure", "moderate", describe(list), `<${child.tagName.toLowerCase()}> is a direct child of a list`)
        break
      }
    }
  }

  // ---- skip link -----------------------------------------------------------
  const firstLink = document.querySelector("a[href^='#']")
  const hasSkip =
    firstLink !== null && /skip|sprung|zum inhalt|content|inhalt|перейти|içeriğe/i.test(accessibleName(firstLink))
  if (!hasSkip) {
    add("skip-to-content", "moderate", "document",
      "no skip-to-content link — a keyboard user tabs through the whole header on every page")
  }

  return findings
}

/** Focus visibility has to be measured with a real focus, not from CSS text. */
const FOCUS_CHECK = () => {
  const results = []
  const candidates = [...document.querySelectorAll("a[href], button, input, select, textarea")]
    .filter((el) => {
      const s = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0
    })
    .slice(0, 12)

  for (const el of candidates) {
    const before = getComputedStyle(el)
    const snapshot = {
      outlineWidth: before.outlineWidth,
      outlineStyle: before.outlineStyle,
      boxShadow: before.boxShadow,
      borderColor: before.borderColor,
      backgroundColor: before.backgroundColor,
    }
    el.focus()
    const after = getComputedStyle(el)
    const changed =
      after.outlineWidth !== snapshot.outlineWidth ||
      after.outlineStyle !== snapshot.outlineStyle ||
      after.boxShadow !== snapshot.boxShadow ||
      after.borderColor !== snapshot.borderColor ||
      after.backgroundColor !== snapshot.backgroundColor
    const hasOutline = after.outlineStyle !== "none" && parseFloat(after.outlineWidth) > 0
    if (!changed && !hasOutline) {
      results.push({
        rule: "focus-visible",
        impact: "serious",
        selector: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}`,
        detail: "focusing produced no visible change",
      })
    }
    el.blur()
  }
  return results
}

async function main() {
  const reporter = createReporter("a11y-audit")
  const dir = resultDir("a11y")

  reporter.section("a11y-audit — structural rules, NOT axe-core")
  console.log(`  rules: ${RULES.join(", ")}`)
  const spots = reportBlindSpots(reporter, BLIND_SPOTS)

  const server = startServer(PORT)
  let browser
  const findings = []

  try {
    await server.ready()
    const launched = await launchBrowser({})
    browser = launched.browser

    for (const theme of THEMES) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: theme })
      const page = await context.newPage()

      for (const locale of LOCALES) {
        for (const route of publicRoutes()) {
          const url = urlFor(server.base, locale, route)
          let entries = []
          try {
            await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 })
            await preparePage(page)
            entries = await page.evaluate(AUDIT, locale)
            entries = entries.concat(await page.evaluate(FOCUS_CHECK))
          } catch (error) {
            reporter.check(`${locale}${route.path || "/"} ${theme}`, false, String(error).slice(0, 100))
            continue
          }

          const serious = entries.filter((e) => e.impact === "serious" || e.impact === "critical")
          for (const entry of entries) findings.push({ locale, theme, route: route.name, ...entry })

          reporter.check(
            `${locale}${route.path || "/"} ${theme}`,
            serious.length === 0,
            entries.length === 0
              ? ""
              : `${serious.length} serious/critical, ${entries.length - serious.length} moderate`,
          )
          for (const entry of serious.slice(0, 3)) {
            console.log(`         [${entry.impact}] ${entry.rule} — ${entry.selector}: ${entry.detail}`)
          }
        }
      }
      await context.close()
    }

    reporter.section("Summary by rule")
    const byRule = {}
    for (const f of findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1
    for (const [rule, count] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) {
      const impact = findings.find((f) => f.rule === rule).impact
      console.log(`  ${String(count).padStart(4)}  [${impact}] ${rule}`)
    }

    const path = writeJson(dir, "report.json", {
      harness: "a11y-audit",
      generatedAt: new Date().toISOString(),
      isAxeCore: false,
      rules: RULES,
      blindSpots: spots,
      counts: byRule,
      findings,
    })
    console.log(`\n  report: ${path}`)
  } finally {
    if (browser) await browser.close()
    server.stop()
  }

  process.exit(reporter.summary())
}

main().catch((error) => {
  console.error(`\na11y-audit failed to run: ${error?.stack ?? error}`)
  process.exit(2)
})
