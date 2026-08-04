/**
 * ux-contact-sheet — every page, for every role, as a full-page screenshot.
 *
 * The eleven roles see eleven different products. Reviewing that by hand means
 * eleven sign-ins and ~130 navigations, which is why it does not get done and
 * why gaps survive in the roles nobody logs in as. This captures the whole
 * surface in one pass so it can actually be looked at.
 *
 * For each role it records what the role's OWN navigation offers — never a
 * hardcoded list — so a page a role cannot reach is absent from its sheet
 * rather than screenshotted as a 403. Alongside each image it records the
 * measurements that turn "this looks thin" into a number: text length,
 * interactive-control count, how much of the viewport is empty, and whether the
 * page says anything a person should not be reading (a raw key, a uuid, an
 * internal term).
 *
 * Output: quality/ux/<role>/<page>.png plus quality/ux/report.json
 *
 * Usage:  pnpm qa:ux            (all roles)
 *         pnpm qa:ux tenant     (one role)
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "")
const BASE = process.env.AZURA_BASE_URL ?? "http://localhost:3201"
const LOCALE = process.env.AZURA_LOCALE ?? "en"
const OUT = `${root}/quality/ux`

const { chromium } = await import(
  pathToFileURL(
    `${root}/node_modules/.pnpm/playwright@1.62.0/node_modules/playwright/index.mjs`
  ).href
)
const EXE =
  process.env.AZURA_CHROMIUM ??
  "C:/Users/Maanik Garg/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe"

const PASSWORD = readFileSync(`${root}/quality/manual/.seed-password`, "utf8").trim()

const ALL_ROLES = [
  "admin",
  "manager",
  "accountant",
  "staff",
  "owner",
  "tenant",
  "guest",
  "service_provider",
  "child_owner",
  "child_tenant",
  "child_guest",
]
const roles = process.argv[2] ? [process.argv[2]] : ALL_ROLES

/** Things a reader should never meet. Each is a defect, not a style opinion. */
const RAW_KEY = /\b(dashboard|landing|auth|common|glossary|nav|siteModel)\.[a-zA-Z]+(\.[a-zA-Z]+)+/g
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi
const JARGON = /\bW\d-[A-Z]\b|local-seed|repository|SourcedFact|CONTRACT-GAP|TODO|FIXME|\bnull\b|undefined|NaN|\[object Object\]/g

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ executablePath: EXE })
const report = []

for (const role of roles) {
  mkdirSync(`${OUT}/${role}`, { recursive: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  const consoleErrors = []
  page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 160)))

  const entry = { role, signedIn: false, pages: [], errors: [] }

  try {
    await page.goto(`${BASE}/${LOCALE}/login`, { waitUntil: "domcontentloaded" })
    await page.locator("#email").fill(`${role}@azura.local`)
    await page.locator("#password").fill(PASSWORD)
    await page.locator('button[type="submit"]').first().click()
    await page.waitForURL(/dashboard/, { timeout: 25000 })
    entry.signedIn = true
  } catch {
    entry.errors.push("SIGN-IN FAILED")
    report.push(entry)
    await context.close()
    console.log(`${role.padEnd(18)} SIGN-IN FAILED`)
    continue
  }

  // The role's own navigation, never a hardcoded list.
  const hrefs = await page.$$eval("aside a[href], nav a[href]", (as) => [
    ...new Set(
      as.map((a) => a.getAttribute("href")).filter((h) => h?.includes("/dashboard"))
    ),
  ])

  for (const href of hrefs) {
    const slug = href.replace(/^\/[a-z]{2}\//, "").replace(/\//g, "-") || "home"
    let status = 0
    try {
      const response = await page.goto(`${BASE}${href}`, {
        waitUntil: "domcontentloaded",
        timeout: 25000,
      })
      status = response?.status() ?? 0
      // Let charts, images and any client island settle before capturing.
      await page.waitForTimeout(900)
    } catch {
      status = -1
    }

    // A client-side navigation can destroy the execution context mid-evaluate —
    // Next prefetches on hover and the shell re-renders after hydration, so this
    // is a race the harness loses roughly once per hundred pages. One retry
    // after the page settles, then an empty measurement rather than a crash:
    // losing one page's numbers must not cost the other 129.
    const measure = () =>
      page.evaluate(() => {
      const text = document.body.innerText
      const controls = document.querySelectorAll(
        "button, a[href], input, select, textarea, [role='button']"
      ).length
      const images = document.querySelectorAll("img, svg").length
      const tables = document.querySelectorAll("table").length
      const headings = [...document.querySelectorAll("h1, h2, h3")].map((h) =>
        (h.textContent ?? "").trim().slice(0, 60)
      )
      // How much vertical space the main region actually uses.
      const main = document.querySelector("main") ?? document.body
      return {
        text,
        chars: text.replace(/\s+/g, " ").trim().length,
        controls,
        images,
        tables,
        headings,
        mainHeight: Math.round(main.getBoundingClientRect().height),
        scrollHeight: document.documentElement.scrollHeight,
        }
      })

    let measured
    try {
      measured = await measure()
    } catch {
      await page.waitForTimeout(1200)
      try {
        measured = await measure()
      } catch {
        measured = {
          text: "",
          chars: 0,
          controls: 0,
          images: 0,
          tables: 0,
          headings: [],
          mainHeight: 0,
          scrollHeight: 0,
          unmeasured: true,
        }
      }
    }
    const rawKeys = [...new Set(measured.text.match(RAW_KEY) ?? [])]
    const uuids = [...new Set(measured.text.match(UUID) ?? [])]
    const jargon = [...new Set(measured.text.match(JARGON) ?? [])]

    await page.screenshot({
      path: `${OUT}/${role}/${slug}.png`,
      fullPage: true,
    })

    entry.pages.push({
      href,
      slug,
      status,
      chars: measured.chars,
      controls: measured.controls,
      images: measured.images,
      tables: measured.tables,
      headings: measured.headings,
      scrollHeight: measured.scrollHeight,
      rawKeys,
      uuids,
      jargon,
      // A page with a heading, under 600 characters and fewer than 5 controls
      // is doing almost nothing — the signal that found the guest and child_*
      // stubs the first time.
      thin: measured.chars < 600 && measured.controls < 5,
      screenshot: `quality/ux/${role}/${slug}.png`,
    })
  }

  entry.errors.push(...new Set(consoleErrors))
  report.push(entry)
  await context.close()

  const thin = entry.pages.filter((p) => p.thin).length
  const dirty = entry.pages.filter(
    (p) => p.rawKeys.length || p.uuids.length || p.jargon.length
  ).length
  console.log(
    `${role.padEnd(18)} pages=${String(entry.pages.length).padStart(2)}  thin=${thin}  text-defects=${dirty}  errors=${entry.errors.length}`
  )
}

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2), "utf8")
await browser.close()

const totals = report.reduce(
  (acc, r) => ({
    pages: acc.pages + r.pages.length,
    thin: acc.thin + r.pages.filter((p) => p.thin).length,
    defects:
      acc.defects +
      r.pages.filter((p) => p.rawKeys.length || p.uuids.length || p.jargon.length).length,
    errors: acc.errors + r.errors.length,
  }),
  { pages: 0, thin: 0, defects: 0, errors: 0 }
)
console.log(
  `\n${report.length} role(s) · ${totals.pages} page(s) · ${totals.thin} thin · ${totals.defects} with text defects · ${totals.errors} client error(s)`
)
console.log(`contact sheet: ${OUT}`)
