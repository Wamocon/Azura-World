/**
 * The landing route's real cost, measured in a browser.       Owner: W-CINEMA
 *
 * The budget is the hard part of this brief: **≤250 KB gz of JavaScript on the
 * landing route, excluding the lazy 3D chunk**, against 494 KB today. Next's
 * build table reports per-route *parsed* size and lumps shared chunks together,
 * which is not the number the budget is written against — so this measures what
 * the browser actually pulls over the wire for `/de`, from a production server.
 *
 * It also captures the five defects the brief lists, so "fixed" is a diff
 * between two runs of one script rather than an assertion.
 *
 * Run: `node scripts/landing-budget.mjs [--port=3250] [--label=before]`
 */

import { spawn } from "node:child_process"
import { gzipSync } from "node:zlib"
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const APP = join(ROOT, "apps", "web")
const OUT = join(ROOT, "quality", "cinema")

const portArg = process.argv.find((a) => a.startsWith("--port="))
const labelArg = process.argv.find((a) => a.startsWith("--label="))
const PORT = Number(portArg?.slice("--port=".length) ?? 3250)
const LABEL = labelArg?.slice("--label=".length) ?? "run"
const BASE = `http://127.0.0.1:${PORT}`

if (!existsSync(join(APP, ".next", "BUILD_ID"))) {
  console.error("No production build. Run `pnpm --dir apps/web build` first.")
  process.exit(2)
}
mkdirSync(OUT, { recursive: true })

const bootstrap = `
  const next = require('next')
  const { createServer } = require('node:http')
  const app = next({ dev: false, dir: ${JSON.stringify(APP)} })
  const handle = app.getRequestHandler()
  app.prepare().then(() => {
    createServer((req, res) => handle(req, res)).listen(${PORT}, '127.0.0.1')
  })
`
const server = spawn(process.execPath, ["-e", bootstrap], {
  cwd: APP,
  stdio: "ignore",
  env: { ...process.env, NODE_ENV: "production" },
})

async function ready() {
  for (let i = 0; i < 90; i += 1) {
    try {
      const r = await fetch(`${BASE}/de`)
      if (r.status < 500) return
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error("server did not become ready")
}

/** The listening PID must be this tree. W5 lost a pass to a stale server. */
async function assertOwnPort() {
  const { execSync } = await import("node:child_process")
  const out = execSync(`netstat -ano | findstr "127.0.0.1:${PORT}"`, {
    encoding: "utf8",
  })
  const pid = (out.match(/LISTENING\s+(\d+)/) ?? [])[1]
  if (pid === undefined) throw new Error(`nothing listening on ${PORT}`)
  const cmd = execSync(
    `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`,
    { encoding: "utf8" }
  )
  const strip = (s) => s.replace(/[\\/]+/g, "").toLowerCase()
  if (!strip(cmd).includes(strip(APP))) {
    throw new Error(`port ${PORT} held by PID ${pid}, not this tree`)
  }
}

async function launch() {
  const req = createRequire(join(APP, "package.json"))
  const { chromium } = req("@playwright/test")
  try {
    return await chromium.launch({ headless: true })
  } catch {
    const root = join(process.env.LOCALAPPDATA ?? "", "ms-playwright")
    const c = readdirSync(root)
      .filter((n) => /^chromium-\d+$/.test(n))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))[0]
    const exe = [
      join(root, c, "chrome-win64", "chrome.exe"),
      join(root, c, "chrome-win", "chrome.exe"),
    ].find((p) => existsSync(p))
    return chromium.launch({ headless: true, executablePath: exe })
  }
}

let browser
try {
  await ready()
  await assertOwnPort()
  browser = await launch()

  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "de-DE",
  })
  const page = await ctx.newPage()

  const transfers = []
  const failures = []
  const consoleErrors = []
  page.on("response", async (r) => {
    const type = r.request().resourceType()
    // The budget is written in GZIPPED bytes. This server does not compress, so
    // the wire size here is raw; gzipping each body locally is what makes the
    // number comparable to the brief's 494 KB. (Raw 1665 KB / gz 494 KB is the
    // ~3.4x that reconciles the two.)
    let bytes = 0
    let gz = 0
    try {
      const body = await r.body()
      bytes = body.length
      if (type === "script" || /\.js(\?|$)/.test(r.url())) {
        gz = gzipSync(body).length
      }
    } catch {
      bytes = Number(r.headers()["content-length"] ?? 0)
    }
    transfers.push({ url: r.url(), type, status: r.status(), bytes, gz })
    if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`)
  })
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160))
  })

  await page.goto(`${BASE}/de`, { waitUntil: "networkidle", timeout: 60_000 })
  await page.waitForTimeout(1500)

  const js = transfers.filter(
    (t) => t.type === "script" || /\.js(\?|$)/.test(t.url)
  )
  const jsBytes = js.reduce((n, t) => n + t.bytes, 0)
  const jsGz = js.reduce((n, t) => n + t.gz, 0)
  // The 3D chunk is excluded from the budget by the brief: it is lazy, behind an
  // intersection observer, and never blocks LCP.
  const threeChunks = js.filter((t) => /three|r3f|drei|maquette|coast/i.test(t.url))
  const threeBytes = threeChunks.reduce((n, t) => n + t.bytes, 0)
  const threeGz = threeChunks.reduce((n, t) => n + t.gz, 0)

  const dom = await page.evaluate(() => {
    const h1s = [...document.querySelectorAll("h1")].map((h) =>
      (h.textContent ?? "").replace(/\s+/g, " ").trim()
    )
    return {
      images: document.querySelectorAll("img").length,
      videos: document.querySelectorAll("video").length,
      canvases: document.querySelectorAll("canvas").length,
      sections: document.querySelectorAll("section").length,
      pageHeight: document.documentElement.scrollHeight,
      h1Count: h1s.length,
      h1s,
      // The amenities section: does it render items, or the empty note?
      amenityItems: document.querySelectorAll("[data-slot='amenity']").length,
      emptyAmenityNote: /liess sich keine Ausstattungsliste|keine Ausstattungsliste/i.test(
        document.body.innerText
      ),
    }
  })

  const report = {
    label: LABEL,
    jsRequests: js.length,
    jsBytesTotal: jsBytes,
    jsKbTotal: +(jsBytes / 1024).toFixed(1),
    jsGzKbTotal: +(jsGz / 1024).toFixed(1),
    threeChunkKb: +(threeBytes / 1024).toFixed(1),
    threeGzKb: +(threeGz / 1024).toFixed(1),
    jsKbExcludingThree: +((jsBytes - threeBytes) / 1024).toFixed(1),
    budgetedGzKb: +((jsGz - threeGz) / 1024).toFixed(1),
    heaviest: js
      .slice()
      .sort((a, b) => b.gz - a.gz)
      .slice(0, 8)
      .map((t) => ({ kb: +(t.gz / 1024).toFixed(1), url: t.url.replace(/^.*\/_next\//, "_next/") })),
    ...dom,
    httpFailures: failures,
    consoleErrors,
  }

  console.log(`\n=== landing budget: ${LABEL} ===`)
  console.log(`  JS requests            ${report.jsRequests}`)
  console.log(`  JS transferred         ${report.jsKbTotal} KB`)
  console.log(`    of which 3D chunk    ${report.threeChunkKb} KB`)
  console.log(`  JS gzipped             ${report.jsGzKbTotal} KB`)
  console.log(`    of which 3D chunk    ${report.threeGzKb} KB gz`)
  console.log(`  BUDGETED gz (excl. 3D) ${report.budgetedGzKb} KB   (budget 250)`)
  console.log("  heaviest chunks (gz):")
  for (const h of report.heaviest) console.log(`    ${String(h.kb).padStart(7)} KB  ${h.url}`)
  console.log(`  <img> / <video>        ${report.images} / ${report.videos}`)
  console.log(`  <canvas> / <section>   ${report.canvases} / ${report.sections}`)
  console.log(`  page height            ${report.pageHeight}px`)
  console.log(`  <h1> count             ${report.h1Count}  ${JSON.stringify(report.h1s).slice(0, 120)}`)
  console.log(`  amenity items          ${report.amenityItems}  (empty note shown: ${report.emptyAmenityNote})`)
  console.log(`  HTTP >=400             ${failures.length}  ${failures.slice(0, 3).join(" | ")}`)
  console.log(`  console errors         ${consoleErrors.length}  ${consoleErrors.slice(0, 2).join(" | ")}`)

  writeFileSync(join(OUT, `budget-${LABEL}.json`), JSON.stringify(report, null, 2))
} finally {
  await browser?.close()
  server.kill()
}
