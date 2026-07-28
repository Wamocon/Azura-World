/**
 * perf — LCP, CLS, INP, TTFB, bytes, bundle budgets and a 60s soak.
 *                                                                Owner: W4-B
 *
 * `pnpm qa:perf`
 *
 * ## What this closes
 *
 * Three windows shipped with the same `[GAP]`, all waiting on this file:
 *
 *   W1-D  — "LCP / INP / CLS NOT MEASURED — `pnpm qa:perf` is W4-B's script"
 *   W3-A  — "LCP / CLS / INP NOT MEASURED. No throttled run."
 *   W3-I  — "LCP ≤ 2.5s, INP, CLS still NOT MEASURED" + "60s soak NOT RUN"
 *
 * ## Budgets are enforced, not reported
 *
 * From CONVENTIONS §7. Exceeding one **fails the run** — tasks/W4-B: "A budget
 * that only warns is a suggestion."
 *
 * The 3D chunk budget is **260KB gz, not the original 150KB**. That figure was
 * written before the stack was measured and is not reachable: three.js 0.185 +
 * R3F is the floor, and W1-D proved removing drei entirely saves 10 bytes.
 * W-INT reset it (S-010, CONVENTIONS §7) to a number the build can meet, with
 * the reasoning recorded there. A budget the build cannot meet gets ignored,
 * and then every budget gets ignored.
 *
 * ## Why the numbers are trustworthy, and where they are not
 *
 * Every measurement here is taken **inside the page** — LCP and CLS from
 * `PerformanceObserver`, bytes from the Resource Timing API — rather than from
 * Playwright's `request.sizes()`, which reports a silent 0 when the driver and
 * the browser build disagree. W-INT hit exactly that and it cost half an hour.
 * The blind spots are printed on every run.
 */

import { gzipSync } from "node:zlib"
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs"
import { join } from "node:path"

import {
  APP_DIR,
  createReporter,
  launchBrowser,
  parseArgs,
  reportBlindSpots,
  resultDir,
  startServer,
  writeJson,
} from "./qa-lib.mjs"

const args = parseArgs(process.argv.slice(2))
const PORT = Number(args.values.get("port") ?? 3270)
const RUNS = Number(args.values.get("runs") ?? 3)
const SOAK_MS = Number(args.values.get("soak-ms") ?? 60_000)
const SKIP_SOAK = args.flags.has("no-soak")

/** CONVENTIONS §7. */
const BUDGETS = {
  lcpMs: 2500,
  cls: 0.1,
  inpMs: 200,
  landingJsKb: 250,
  chunk3dKb: 260,
}

/** Lighthouse's "Slow 4G": 1.6 Mbit/s down, 750 kbit/s up, 150ms RTT, 4× CPU. */
const SLOW_4G = {
  offline: false,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
  latency: 150,
}

const BLIND_SPOTS = [
  "These are LAB numbers from one machine, not field data. Real users on real networks " +
    "will differ; this catches regressions, it does not predict CrUX.",
  "Throttling is CDP emulation (Slow 4G, 4x CPU), not a real network. It models bandwidth " +
    "and latency, not packet loss, TLS negotiation cost or a congested radio.",
  "INP is measured from SYNTHETIC clicks on the first few interactive elements, and reported " +
    "as the MAXIMUM interaction latency rather than the p98 the real metric uses. A slow " +
    "interaction this harness never clicks is invisible to it.",
  "Cold cache means a fresh browser context, not a cleared OS or disk cache.",
  "No Lighthouse score. `lighthouse` is not an installed dependency and `pnpm install` is " +
    "W0-A's to run, so the CONVENTIONS §7 'Lighthouse a11y >= 95' budget is NOT checked here. " +
    "scripts/a11y-audit.mjs checks the underlying rules directly instead.",
  "Authenticated routes are not measured — the QA access-profile cookie is disabled under " +
    "NODE_ENV=production, so /dashboard redirects to login.",
  "The 3D chunk figure is STATIC analysis of the built chunks (gzip level 9 of every emitted " +
    "chunk containing three.js/R3F markers). Actual network transfer differs slightly with " +
    "the server's compression settings; both figures are reported.",
  "The soak samples `performance.memory`, which is Chromium-only and coarse (it reports " +
    "quantised heap sizes). It detects a large leak, not a slow one.",
]

// ---------------------------------------------------------------------------
// Phase 0 — the built bundle, measured from disk
// ---------------------------------------------------------------------------

/** Symbols that only appear in a chunk carrying three.js / R3F. */
const THREE_MARKERS = ["WebGLRenderer", "PerspectiveCamera", "BufferGeometry", "react-three"]

function analyseBundle(reporter) {
  const chunkDir = join(APP_DIR, ".next", "static", "chunks")
  if (!existsSync(chunkDir)) {
    reporter.check("built chunks found", false, `${chunkDir} missing — run \`pnpm --dir apps/web build\``)
    return null
  }

  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name.endsWith(".js")) files.push(full)
    }
  }
  walk(chunkDir)

  let app = 0
  let three = 0
  const threeFiles = []
  const appFiles = []

  for (const file of files) {
    const raw = readFileSync(file)
    const gz = gzipSync(raw, { level: 9 }).length
    const text = raw.toString("utf8")
    const is3d = THREE_MARKERS.some((marker) => text.includes(marker))
    if (is3d) {
      three += gz
      threeFiles.push({ file: file.slice(chunkDir.length + 1), gzip: gz })
    } else {
      app += gz
      appFiles.push({ file: file.slice(chunkDir.length + 1), gzip: gz })
    }
  }

  const toKb = (bytes) => Number((bytes / 1024).toFixed(1))
  const result = {
    chunkCount: files.length,
    appGzipKb: toKb(app),
    threeGzipKb: toKb(three),
    threeFiles: threeFiles.sort((a, b) => b.gzip - a.gzip).map((f) => ({ ...f, gzipKb: toKb(f.gzip) })),
    largestApp: appFiles.sort((a, b) => b.gzip - a.gzip).slice(0, 6).map((f) => ({ ...f, gzipKb: toKb(f.gzip) })),
  }

  reporter.section("Phase 0 — built bundle (gzip level 9, from disk)")
  console.log(`  chunks: ${result.chunkCount}   3D-bearing: ${threeFiles.length}`)
  for (const f of result.threeFiles) console.log(`    3D   ${String(f.gzipKb).padStart(7)} KB  ${f.file}`)
  for (const f of result.largestApp.slice(0, 4)) console.log(`    app  ${String(f.gzipKb).padStart(7)} KB  ${f.file}`)

  reporter.check(
    `lazy 3D chunk ≤ ${BUDGETS.chunk3dKb} KB gz`,
    result.threeGzipKb <= BUDGETS.chunk3dKb,
    `${result.threeGzipKb} KB across ${threeFiles.length} file(s)`,
  )
  return result
}

// ---------------------------------------------------------------------------
// In-page instrumentation
// ---------------------------------------------------------------------------

/** Installed before any page script runs, so nothing is missed. */
const INSTRUMENT = () => {
  window.__perf = { lcp: 0, cls: 0, inp: 0, shifts: 0 }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__perf.lcp = entry.startTime
    }).observe({ type: "largest-contentful-paint", buffered: true })
  } catch { /* unsupported */ }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) {
          window.__perf.cls += entry.value
          window.__perf.shifts += 1
        }
      }
    }).observe({ type: "layout-shift", buffered: true })
  } catch { /* unsupported */ }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.interactionId && entry.duration > window.__perf.inp) {
          window.__perf.inp = entry.duration
        }
      }
    }).observe({ type: "event", buffered: true, durationThreshold: 16 })
  } catch { /* unsupported */ }
}

/** Read back after load, plus navigation and resource timing. */
const COLLECT = () => {
  const nav = performance.getEntriesByType("navigation")[0]
  const resources = performance.getEntriesByType("resource")
  const sum = (filter) =>
    resources.filter(filter).reduce((total, r) => total + (r.transferSize || 0), 0)
  const isJs = (r) => r.initiatorType === "script" || /\.js(\?|$)/.test(r.name)
  return {
    lcpMs: Math.round(window.__perf.lcp),
    cls: Number(window.__perf.cls.toFixed(4)),
    layoutShifts: window.__perf.shifts,
    inpMs: Math.round(window.__perf.inp),
    ttfbMs: nav ? Math.round(nav.responseStart) : null,
    domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
    loadMs: nav ? Math.round(nav.loadEventEnd) : null,
    jsBytes: sum(isJs),
    totalBytes: sum(() => true),
    requests: resources.length,
  }
}

async function measure(browser, url, { throttle, warm }) {
  const context = await browser.newContext({
    viewport: throttle ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    deviceScaleFactor: throttle ? 3 : 1,
    isMobile: throttle,
    hasTouch: throttle,
  })
  await context.addInitScript(INSTRUMENT)
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)

  if (throttle) {
    await cdp.send("Network.emulateNetworkConditions", SLOW_4G)
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })
  }

  if (warm) {
    // Prime the HTTP cache, then measure the second load in the same context.
    await page.goto(url, { waitUntil: "load", timeout: 120_000 })
    await page.waitForTimeout(300)
  }

  await page.goto(url, { waitUntil: "load", timeout: 120_000 })
  // Let LCP settle and lazy content mount.
  await page.waitForTimeout(throttle ? 2500 : 1200)

  // Synthetic interactions so INP has something to observe.
  try {
    const targets = await page.$$("button, a[href], [role=button]")
    for (const target of targets.slice(0, 4)) {
      await target.click({ trial: false, timeout: 1500, noWaitAfter: true }).catch(() => {})
      await page.waitForTimeout(120)
    }
  } catch { /* nothing clickable */ }
  await page.waitForTimeout(300)

  const result = await page.evaluate(COLLECT)
  await context.close()
  return result
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

function aggregate(samples) {
  const keys = ["lcpMs", "cls", "inpMs", "ttfbMs", "jsBytes", "totalBytes", "requests", "layoutShifts"]
  const out = { runs: samples.length }
  for (const key of keys) {
    const values = samples.map((s) => s[key]).filter((v) => typeof v === "number")
    out[key] = values.length === 0 ? null : key === "cls"
      ? Number((median(values.map((v) => v * 10_000)) / 10_000).toFixed(4))
      : median(values)
  }
  return out
}

// ---------------------------------------------------------------------------
// Soak — W3-I's open [GAP]
// ---------------------------------------------------------------------------

async function soak(browser, url, reporter, ms) {
  reporter.section(`Phase 3 — ${Math.round(ms / 1000)}s soak on the 3D route`)
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 160)))
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text().slice(0, 160))
  })

  await page.goto(url, { waitUntil: "load", timeout: 120_000 })
  // Scroll to the 3D so the IntersectionObserver fires and the canvas mounts.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 80))
    }
  })
  await page.waitForTimeout(1500)

  const sample = () =>
    page.evaluate(() => ({
      heap: performance.memory ? performance.memory.usedJSHeapSize : null,
      canvases: document.querySelectorAll("canvas").length,
      nodes: document.querySelectorAll("*").length,
      t: Date.now(),
    }))

  const first = await sample()
  const samples = [first]
  const started = Date.now()
  while (Date.now() - started < ms) {
    await page.waitForTimeout(5000)
    samples.push(await sample())
  }
  const last = samples[samples.length - 1]

  const growthMb =
    first.heap === null || last.heap === null
      ? null
      : Number(((last.heap - first.heap) / 1024 / 1024).toFixed(2))

  console.log(`  canvases: ${first.canvases} → ${last.canvases}   DOM nodes: ${first.nodes} → ${last.nodes}`)
  if (growthMb === null) {
    reporter.note("performance.memory unavailable — heap growth NOT MEASURED")
  } else {
    console.log(`  JS heap: ${(first.heap / 1048576).toFixed(1)} MB → ${(last.heap / 1048576).toFixed(1)} MB  (${growthMb >= 0 ? "+" : ""}${growthMb} MB)`)
    // A rendering loop that leaks a frame's worth of objects per frame grows
    // fast; 50 MB over a minute is well clear of GC noise.
    reporter.check("no runaway heap growth over the soak", growthMb < 50, `${growthMb} MB`)
  }
  reporter.check("no console errors during the soak", errors.length === 0,
    errors.length === 0 ? "" : errors.slice(0, 3).join(" | "))
  reporter.check("no canvas leak", last.canvases <= Math.max(1, first.canvases), `${first.canvases} → ${last.canvases}`)

  await context.close()
  return { samples, growthMb, errors, canvases: [first.canvases, last.canvases] }
}

// ---------------------------------------------------------------------------

async function main() {
  const reporter = createReporter("perf")
  const dir = resultDir("perf")

  reporter.section("perf — budgets from CONVENTIONS §7")
  console.log(`  LCP ≤ ${BUDGETS.lcpMs}ms (throttled mobile) · CLS ≤ ${BUDGETS.cls} · INP ≤ ${BUDGETS.inpMs}ms`)
  console.log(`  landing JS ≤ ${BUDGETS.landingJsKb} KB gz (excluding 3D) · lazy 3D chunk ≤ ${BUDGETS.chunk3dKb} KB gz`)
  const spots = reportBlindSpots(reporter, BLIND_SPOTS)

  const bundle = analyseBundle(reporter)

  const server = startServer(PORT)
  let browser
  let executablePath
  const routes = [
    { name: "landing", path: "" },
    { name: "hotel", path: "/hotel" },
  ]
  const results = {}
  const startedAt = Date.now()

  try {
    await server.ready()
    ;({ browser, executablePath } = await launchBrowser({}))
    console.log(`\n  chromium: ${executablePath}`)

    for (const [phase, throttle] of [["Phase 1 — desktop", false], ["Phase 2 — throttled mobile (Slow 4G, 4× CPU)", true]]) {
      reporter.section(phase)
      for (const route of routes) {
        for (const warm of [false, true]) {
          const url = `${server.base}/de${route.path}`
          const samples = []
          for (let i = 0; i < (throttle ? RUNS : 1); i += 1) {
            samples.push(await measure(browser, url, { throttle, warm }))
          }
          const agg = aggregate(samples)
          const key = `${route.name}:${throttle ? "mobile" : "desktop"}:${warm ? "warm" : "cold"}`
          results[key] = agg
          console.log(
            `  ${key.padEnd(28)} LCP ${String(agg.lcpMs).padStart(5)}ms · CLS ${String(agg.cls).padStart(6)} · ` +
              `INP ${String(agg.inpMs).padStart(4)}ms · TTFB ${String(agg.ttfbMs).padStart(4)}ms · ` +
              `JS ${(agg.jsBytes / 1024).toFixed(0).padStart(4)}KB · ${agg.requests} req`,
          )
        }
      }
    }

    // ---- budget verdict ---------------------------------------------------
    reporter.section("Budget verdict")
    for (const route of routes) {
      const cold = results[`${route.name}:mobile:cold`]
      reporter.check(`${route.name} LCP ≤ ${BUDGETS.lcpMs}ms (mobile, cold)`, cold.lcpMs <= BUDGETS.lcpMs, `${cold.lcpMs}ms`)
      reporter.check(`${route.name} CLS ≤ ${BUDGETS.cls}`, cold.cls <= BUDGETS.cls, `${cold.cls} over ${cold.layoutShifts} shift(s)`)
      const inp = Math.max(cold.inpMs, results[`${route.name}:desktop:cold`].inpMs)
      reporter.check(`${route.name} INP ≤ ${BUDGETS.inpMs}ms`, inp <= BUDGETS.inpMs, `${inp}ms (max observed)`)
    }

    if (bundle !== null) {
      // The landing budget is measured WITHOUT the lazy 3D chunk, per §7.
      const landingJsKb = Number(
        ((results["landing:desktop:cold"].jsBytes - bundle.threeGzipKb * 1024) / 1024).toFixed(1),
      )
      console.log(`  landing JS transferred: ${(results["landing:desktop:cold"].jsBytes / 1024).toFixed(1)} KB total`)
      reporter.check(
        `landing JS ≤ ${BUDGETS.landingJsKb} KB (static app chunks, gz)`,
        bundle.appGzipKb <= BUDGETS.landingJsKb,
        `${bundle.appGzipKb} KB across ${bundle.chunkCount - bundle.threeFiles.length} app chunk(s) — NOTE: this is EVERY app chunk, not the landing route's subset`,
      )
      results.landingJsExcluding3dKb = landingJsKb
    }

    if (!SKIP_SOAK) {
      results.soak = await soak(browser, `${server.base}/de`, reporter, SOAK_MS)
    } else {
      reporter.note("soak skipped (--no-soak) — W3-I's [GAP] stays open")
    }

    const runtimeMs = Date.now() - startedAt
    const path = writeJson(dir, "report.json", {
      harness: "perf",
      generatedAt: new Date().toISOString(),
      chromium: executablePath,
      budgets: BUDGETS,
      budgetSource: "CONVENTIONS §7 (3D chunk reset to 260KB by W-INT, S-010)",
      runsPerThrottledConfig: RUNS,
      blindSpots: spots,
      bundle,
      results,
      runtimeMs,
    })
    console.log(`\n  report: ${path}`)
    console.log(`  runtime: ${(runtimeMs / 1000).toFixed(1)}s`)
  } finally {
    if (browser) await browser.close()
    server.stop()
  }

  process.exit(reporter.summary())
}

main().catch((error) => {
  console.error(`\nperf failed to run: ${error?.stack ?? error}`)
  process.exit(2)
})
