/**
 * The two W3-G dashboard surfaces, verified.                      Owner: W3-G
 *
 * Runs against the **production build**, served through Next's programmatic API
 * with `dev: false` so the access profile is reachable — W4-A's fixture, the
 * same one `scripts/evidence-production-verify.mjs` uses. `next start` forces
 * `NODE_ENV=production`, where W1-B disables the role picker by design, and
 * `/[locale]/login` is a 404, so there is no other way to hold a session here.
 *
 * What that proves: the production compilation renders and gates these pages.
 * What it does not: it is not a production runtime.
 *
 * Run: `node scripts/hotel-dashboard-verify.mjs`
 */

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const APP = join(ROOT, "apps", "web")
const PORT = Number(process.env["AZURA_VERIFY_PORT"] ?? 3292)
const BASE = `http://127.0.0.1:${PORT}`

const results = []
let section = ""

function group(title) {
  section = title
  console.log(`\n\x1b[1m${title}\x1b[0m\n${"-".repeat(title.length)}`)
}

function check(label, passed, detail) {
  results.push({ section, label, passed })
  console.log(
    `  ${passed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${label}` +
      (detail === undefined ? "" : `  \x1b[2m— ${detail}\x1b[0m`),
  )
}

/**
 * The visible markup only: `<script>` blocks stripped.
 *
 * next-intl serialises the whole message namespace into the flight payload, so
 * a raw `body.includes(...)` sees every LABEL the catalogue carries — including
 * `dashboard.reviews.average` ("Durchschnitt"), a scaffold key this module
 * deliberately never renders. Two assertions of absence in an earlier version
 * of this file failed on exactly that and would have been reported as the page
 * showing an average. Attributes are stripped too: the exact metre value lives
 * in a `title`, by design.
 */
function visible(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/\s(?:title|data-[a-z-]+|class|href)="[^"]*"/g, "")
    // React inserts `<!-- -->` between adjacent text expressions; it sits
    // between the slash and the digits of "/ 10" and breaks a naive regex.
    .replace(/<!--[\s\S]*?-->/g, "")
}

async function get(path, role) {
  const response = await fetch(`${BASE}${path}`, {
    headers: role === undefined ? {} : { cookie: `access_profile_role=${role}` },
    redirect: "manual",
  })
  return { status: response.status, body: await response.text() }
}

if (!existsSync(join(APP, ".next", "BUILD_ID"))) {
  console.error("No production build. Run `pnpm --dir apps/web build` first.")
  process.exit(2)
}

const server = spawn(
  process.execPath,
  [
    "-e",
    `const next=require('next');const{createServer}=require('node:http');` +
      `const app=next({dev:false,dir:${JSON.stringify(APP)}});const h=app.getRequestHandler();` +
      `app.prepare().then(()=>createServer((q,s)=>h(q,s)).listen(${PORT},'127.0.0.1'))`,
  ],
  {
    cwd: APP,
    stdio: "ignore",
    env: {
      ...process.env,
      NODE_ENV: "development",
      ENABLE_ACCESS_PROFILES: "true",
      AZURA_ALLOW_REMOTE_ACCESS_PROFILES: "true",
      AZURA_DEMO_DATA_ISOLATED: "true",
    },
  },
)

try {
  for (let i = 0; i < 90; i += 1) {
    try {
      if ((await fetch(`${BASE}/de`)).status < 500) break
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 1000))
  }

  // -------------------------------------------------------------------------
  group("/dashboard/hotel — 188 rooms, occupancy, the relationship")

  const hotel = await get("/de/dashboard/hotel", "manager")
  check("manager receives 200", hotel.status === 200, `status ${hotel.status}`)
  check("the room total renders", hotel.body.includes("188"))
  check(
    "the room breakdown is an explicit absence, not an empty table",
    hotel.body.includes('data-slot="room-breakdown-gap"'),
  )
  check(
    "the absence states WHY nothing is published",
    /No source publishes a room-type breakdown|Keine Quelle|kein.{0,30}Aufteilung/i.test(hotel.body),
  )
  check("occupancy is an explicit gap", hotel.body.includes('data-testid="occupancy-gap"'))
  check(
    "no occupancy PERCENTAGE was invented",
    !/Belegung[^<]{0,80}\d{1,3}\s*%/i.test(hotel.body),
  )
  check("the hotel-residence relationship is stated", hotel.body.includes('data-slot="hotel-residence"'))
  check("both sides of the relationship appear", hotel.body.includes("188") && hotel.body.includes("656"))
  check(
    "exactly one <main> landmark (the layout's)",
    (hotel.body.match(/<main[\s>]/g) ?? []).length === 1,
    `${(hotel.body.match(/<main[\s>]/g) ?? []).length} found`,
  )

  // The unit question from W3-G §10. The VISIBLE text must read as km; the
  // exact metre value stays in a `title` attribute, which `visible()` strips —
  // that is the design, not a leak, so asserting against the raw body would
  // fail on the tooltip that exists to preserve the stored figure.
  const hotelVisible = visible(hotel.body)
  check(
    "the beach distance reads as km, not four digits of metres",
    /1\s*km/.test(hotelVisible) && !/1\.000\s*m\b/.test(hotelVisible),
    /1\s*km/.test(hotelVisible) ? "renders as km" : "no km form found",
  )

  // -------------------------------------------------------------------------
  group("/dashboard/reviews — own scales, and no average anywhere")

  const reviews = await get("/de/dashboard/reviews", "manager")
  check("manager receives 200", reviews.status === 200, `status ${reviews.status}`)
  check("the score table renders", reviews.body.includes('data-slot="platform-score-table"'))

  // Every score cell carries its scale. The cell is the unit under test: a
  // score and a scale in two columns could be sorted apart by a spreadsheet.
  const cells = reviews.body.replace(/<!--[\s\S]*?-->/g, "").match(/data-slot="score-cell"[\s\S]{0,220}?<\/td>/g) ?? []
  check("score cells found", cells.length > 0, `${cells.length} cell(s)`)
  const scaleless = cells.filter((cell) => !/\/\s*(5|10)\b/.test(cell) && !/unbrauchbar|unusable|kullanılamaz|непригодна/i.test(cell))
  check(
    "every score renders beside its scale",
    scaleless.length === 0,
    `${cells.length - scaleless.length}/${cells.length} carry a scale`,
  )

  check("the no-average note is on the page", reviews.body.includes('data-slot="no-average-note"'))
  check(
    "no combined score appears",
    !/\b5[.,]6\d?\s*\/\s*10/.test(reviews.body) && !/\b2[.,]8\d?\s*\/\s*5/.test(reviews.body),
  )
  // An overall score would be a LABEL FOLLOWED BY A NUMBER. Matching the word
  // alone flags this page's own sentence — "Es gibt hier bewusst keinen
  // Gesamtwert" — which says the opposite of what the check is looking for. A
  // negation and an assertion are not distinguishable by grep, so the number is
  // what the assertion has to be about.
  check(
    "no overall score is rendered as a figure",
    !/(Gesamtwert(ung)?|overall score|average rating|Durchschnittswertung)[^.<]{0,40}\d/i.test(
      visible(reviews.body),
    ),
  )

  check("both ends of the scale are shown", (reviews.body.match(/data-slot="verdict-card"/g) ?? []).length === 2)
  const tones = [...reviews.body.matchAll(/data-tone="(negative|positive)"/g)].map((m) => m[1])
  check("one negative and one positive", tones.includes("negative") && tones.includes("positive"), tones.join(", "))

  check("the language gap is recorded on the page", reviews.body.includes('data-testid="quote-language-gap"'))
  check("the title gap is recorded on the page", reviews.body.includes('data-testid="quote-title-gap"'))

  // -------------------------------------------------------------------------
  group("Permissions — both routes, both directions")

  // Expectations come from the application's own matrix, never a list written
  // here. An earlier version hardcoded four roles as "should be refused" and
  // reported seven failures against pages that were behaving correctly:
  // `hotel:view` is held by ten of eleven roles by design — the hotel is the
  // public subject of the analysis, not privileged data.
  const { roles } = await import("../apps/web/lib/contracts.ts")
  const { hasPermission } = await import("../apps/web/lib/rbac.ts")

  for (const [path, testid, permission] of [
    ["/de/dashboard/hotel", "hotel-forbidden", "hotel:view"],
    ["/de/dashboard/reviews", "reviews-forbidden", "reviews:view"],
  ]) {
    for (const role of roles) {
      const allowed = hasPermission(role, permission)
      const view = await get(path, role)
      const refused =
        view.body.includes(`data-testid="${testid}"`) || view.body.includes("dashboard-403")
      check(
        `${role} ${allowed ? "may open" : "is refused"} ${path}`,
        allowed ? !refused && view.status === 200 : refused,
        `${permission} ${allowed ? "held" : "not held"} · status ${view.status}`,
      )
    }
  }

  // -------------------------------------------------------------------------
  group("Four locales")

  for (const locale of ["de", "en", "tr", "ru"]) {
    for (const path of ["hotel", "reviews"]) {
      const view = await get(`/${locale}/dashboard/${path}`, "manager")
      const leaked = [...view.body.matchAll(/\b(dashboard|common)\.[a-z][a-zA-Z]*(?:\.[a-z][a-zA-Z]*)+/g)].map((m) => m[0])
      check(
        `${locale}/${path} renders with no raw message key`,
        view.status === 200 && leaked.length === 0,
        leaked.length === 0 ? `status ${view.status}` : [...new Set(leaked)].join(", "),
      )
    }
  }
} finally {
  server.kill()
}

const failed = results.filter((r) => !r.passed)
const bar = "─".repeat(72)
console.log(`\n${bar}`)
console.log(`${results.length - failed.length} pass · ${failed.length} fail  [hotel-dashboard-verify]`)
if (failed.length > 0) {
  console.log("\nFAILED:")
  for (const r of failed) console.log(`  ${r.section} → ${r.label}`)
}
console.log(bar)
process.exit(failed.length > 0 ? 1 : 0)
