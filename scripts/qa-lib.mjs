/**
 * Shared harness plumbing for the W4-B quality scripts.          Owner: W4-B
 *
 * `layout-audit`, `perf`, `a11y-audit`, `browser-audit`, `evidence-drift` and
 * `phase-harness` all need the same four things: a production server, a
 * Chromium, a reporter that counts, and a place to write results. This module
 * is those four things, so there is one copy of each rather than six.
 *
 * ## A note on ownership
 *
 * ORCHESTRATION §4 lists W4-B's six scripts individually; this is a seventh
 * file, created because six copies of `startServer()` is how a harness rots.
 * Nothing outside `scripts/{layout-audit,perf,a11y-audit,browser-audit,
 * evidence-drift,phase-harness}.mjs` imports it. Flagged in HANDOFF/W4-B.md
 * rather than done quietly.
 *
 * ## Things learned the hard way, encoded here
 *
 * - **Never pipe an exit code through `tail`.** Every spawn here returns its
 *   status directly. CONVENTIONS §8 records that exact mistake from the
 *   reference project.
 * - **Windows paths contain spaces** (`D:\Azura World`). Every path is passed
 *   as a spawn argument, never interpolated into a shell string.
 * - **`next dev` reproduces none of this.** The CSP differs, chunks differ, and
 *   a page can pass every dev check and ship dead (S-009). Every harness here
 *   drives `next start` over a real build.
 */

import { spawn } from "node:child_process"
import { createConnection } from "node:net"
import { createRequire } from "node:module"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
export const ROOT = join(HERE, "..")
export const APP_DIR = join(ROOT, "apps", "web")
export const QUALITY_DIR = join(ROOT, "quality")

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

/** CONTRACTS §7. German runs ~30% longer than English, Russian ~35%. */
export const LOCALES = ["de", "en", "tr", "ru"]

/**
 * tasks/W4-B: 8 widths. 320 is the one that matters — azura-ui-ux §5.6 says
 * "test at 320px in German, that is where layouts actually break".
 */
export const WIDTHS = [320, 375, 414, 768, 1024, 1280, 1440, 1920]

export const THEMES = ["light", "dark"]

/**
 * Every route, with what the harness can and cannot do with it.
 *
 * `auth: true` marks a route behind `proxy.ts`'s PROTECTED_PREFIXES. Under
 * `next start` with NODE_ENV=production, `accessProfilesEnabledForEnvironment()`
 * returns false, so the QA role cookie cannot open them and an unauthenticated
 * request is redirected to the login page. Those routes are AUDITED AS THE
 * REDIRECT TARGET, and every report says so — see `blindSpots()`.
 */
export const ROUTES = [
  { path: "", name: "landing", auth: false, has3d: true },
  { path: "/hotel", name: "hotel", auth: false, has3d: false },
  { path: "/kitchen-sink", name: "kitchen-sink", auth: false, has3d: true, needsFlag: true },
  { path: "/dashboard", name: "dashboard", auth: true, has3d: false },
  { path: "/dashboard/evidence", name: "dashboard-evidence", auth: true, has3d: false },
]

export function publicRoutes() {
  return ROUTES.filter((route) => !route.auth)
}

/** `/de`, `/de/hotel`, … */
export function urlFor(base, locale, route) {
  return `${base}/${locale}${route.path}`
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export function waitForPort(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = createConnection({ host: "127.0.0.1", port })
      socket.once("connect", () => {
        socket.destroy()
        resolve()
      })
      socket.once("error", () => {
        socket.destroy()
        if (Date.now() > deadline) {
          reject(new Error(`nothing listening on 127.0.0.1:${port} after ${timeoutMs}ms`))
          return
        }
        setTimeout(attempt, 250)
      })
    }
    attempt()
  })
}

/**
 * Starts `next start` against the existing build.
 *
 * `AZURA_ENABLE_KITCHEN_SINK=1` because that route calls `notFound()` in a
 * production build without it, and a harness measuring the 404 page would pass
 * while proving nothing. Same reasoning as `csp-probe.mjs`.
 */
export function startServer(port, extraEnv = {}) {
  const nextBin = join(APP_DIR, "node_modules", "next", "dist", "bin", "next")
  if (!existsSync(nextBin)) {
    throw new Error(`next binary not found at ${nextBin} — run \`pnpm --dir apps/web build\` first`)
  }
  if (!existsSync(join(APP_DIR, ".next", "BUILD_ID"))) {
    throw new Error(`no production build at ${join(APP_DIR, ".next")} — run \`pnpm --dir apps/web build\` first`)
  }

  const child = spawn(
    process.execPath,
    [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: APP_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "production",
        AZURA_ENABLE_KITCHEN_SINK: "1",
        ...extraEnv,
      },
    },
  )

  const log = []
  child.stdout.on("data", (chunk) => log.push(String(chunk)))
  child.stderr.on("data", (chunk) => log.push(String(chunk)))

  return {
    child,
    log,
    base: `http://127.0.0.1:${port}`,
    async ready(timeoutMs = 90_000) {
      await waitForPort(port, timeoutMs)
    },
    stop() {
      if (child.exitCode === null) child.kill()
    },
  }
}

// ---------------------------------------------------------------------------
// Chromium
// ---------------------------------------------------------------------------

/**
 * Finds an installed Chromium, preferring the highest revision.
 *
 * Playwright 1.62 pins a revision this machine does not have; the fallback is
 * deliberate and every report names the executable actually used, because a
 * measurement is not reproducible if you cannot say what produced it.
 */
export function findInstalledChromium(explicit) {
  if (explicit) return explicit

  const root =
    process.env.PLAYWRIGHT_BROWSERS_PATH ??
    (process.env.LOCALAPPDATA === undefined
      ? null
      : join(process.env.LOCALAPPDATA, "ms-playwright"))
  if (root === null || !existsSync(root)) return null

  const candidates = readdirSync(root)
    .filter((name) => /^chromium(_headless_shell)?-\d+$/.test(name))
    .map((name) => ({ name, revision: Number(/(\d+)$/.exec(name)[1]) }))
    .sort((a, b) => b.revision - a.revision)

  for (const { name } of candidates) {
    for (const relative of [
      join("chrome-win64", "chrome.exe"),
      join("chrome-headless-shell-win64", "chrome-headless-shell.exe"),
      join("chrome-linux", "chrome"),
      join("chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
    ]) {
      const candidate = join(root, name, relative)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/**
 * `@playwright/test` is a devDependency of apps/web, not of the root
 * workspace, so it does not resolve from `scripts/`. Resolve it as apps/web
 * would. It is CJS; under ESM interop the named exports may only be reachable
 * through `default`.
 */
export async function loadChromium() {
  const requireFromApp = createRequire(join(APP_DIR, "package.json"))
  const mod = await import(pathToFileURL(requireFromApp.resolve("@playwright/test")).href)
  const chromium = mod.chromium ?? mod.default?.chromium
  if (chromium === undefined) throw new Error("@playwright/test exposes no chromium export")
  return chromium
}

export async function launchBrowser({ headed = false, executablePath } = {}) {
  const chromium = await loadChromium()
  const exe = findInstalledChromium(executablePath)
  if (exe === null) {
    throw new Error(
      "no Chromium found. Run `npx playwright install chromium`, or pass --chromium <path>.",
    )
  }
  const browser = await chromium.launch({ executablePath: exe, headless: !headed })
  return { browser, executablePath: exe }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const BOLD = "\u001b[1m"
const DIM = "\u001b[2m"
const RED = "\u001b[31m"
const GREEN = "\u001b[32m"
const YELLOW = "\u001b[33m"
const RESET = "\u001b[0m"

export function createReporter(title) {
  let pass = 0
  let fail = 0
  const findings = []
  const notes = []

  return {
    section(text) {
      console.log(`\n${BOLD}${text}${RESET}`)
      console.log("-".repeat(Math.min(text.length, 78)))
    },
    check(label, ok, detail = "") {
      if (ok) pass += 1
      else fail += 1
      const mark = ok ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`
      console.log(`  ${mark}  ${label}${detail ? `  ${DIM}— ${detail}${RESET}` : ""}`)
    },
    /** A violation with structured context, for the JSON report. */
    finding(entry) {
      findings.push(entry)
    },
    note(text) {
      notes.push(text)
      console.log(`  ${YELLOW}NOTE${RESET}  ${text}`)
    },
    get counts() {
      return { pass, fail, findings: findings.length }
    },
    get findings() {
      return findings
    },
    get notes() {
      return notes
    },
    /**
     * Prints the summary and returns the process exit code.
     *
     * Non-zero on any failure, always. tasks/W4-B: "exceeding one fails the
     * run, it does not warn. A budget that only warns is a suggestion."
     */
    summary() {
      console.log(
        `\n${fail === 0 ? GREEN : RED}${fail === 0 ? "OK" : "FAILED"}${RESET}  ` +
          `${pass} pass · ${fail} fail · ${findings.length} findings   ${DIM}[${title}]${RESET}`,
      )
      return fail === 0 ? 0 : 1
    },
  }
}

/**
 * Prints the harness's blind spots, and returns them for the JSON report.
 *
 * **This is not decoration.** tasks/W4-B quotes Ataberg's layout harness, which
 * found real bugs *and* exempted the header and ignored `<select>`/`<svg>` —
 * a screenshot caught what it missed. An unstated exemption reads as a clean
 * pass, so every report prints its own list before its results.
 */
export function reportBlindSpots(reporter, spots) {
  reporter.section("Blind spots — what this run did NOT check")
  for (const spot of spots) console.log(`  ${DIM}·${RESET} ${spot}`)
  return spots
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** `quality/<kind>/<ISO-ish timestamp>/`, created. */
export function resultDir(kind) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
  const dir = join(QUALITY_DIR, kind, stamp)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function writeJson(dir, name, data) {
  const path = join(dir, name)
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8")
  return path
}

// ---------------------------------------------------------------------------
// Page preparation — shared by every visual harness
// ---------------------------------------------------------------------------

/**
 * Makes a page measurable and screenshot-stable.
 *
 * Three things, each for a stated reason from tasks/W4-B's edge cases:
 *
 *  1. **Animations off.** Otherwise every screenshot diffs and every geometry
 *     read races a transition. `prefers-reduced-motion` alone is not enough —
 *     it is a request, and code that ignores it still animates — so a CSS
 *     override forces duration to zero on top of it.
 *  2. **Fonts settled.** `document.fonts.ready` before measuring, because a
 *     late webfont reflows every box and the audit would measure the fallback.
 *  3. **Scrolled through.** Lazy content below the fold has not laid out yet,
 *     and an overflow check that never scrolls cannot see it.
 */
export async function preparePage(page) {
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
      scroll-behavior: auto !important;
    }`,
  })
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready
  })
  // Walk the page so IntersectionObserver-gated content mounts, then return.
  await page.evaluate(async () => {
    const step = Math.max(window.innerHeight, 400)
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 60))
    }
    window.scrollTo(0, 0)
    await new Promise((r) => setTimeout(r, 120))
  })
}

/**
 * next-themes' storage key, read from the provider rather than assumed.
 *
 * The first version of `applyTheme` wrote `localStorage.theme`. The provider
 * sets `storageKey="azura-theme"` — namespaced so a 1Çatı tab on the same
 * origin cannot reach in — so every write landed in a key nothing reads, and
 * 96 "dark" cells of the layout matrix silently rendered light. Reading the
 * literal out of the provider means renaming the key breaks this loudly.
 */
export const THEME_STORAGE_KEY = (() => {
  try {
    const source = readFileSync(join(APP_DIR, "components", "providers", "theme-provider.tsx"), "utf8")
    const match = /storageKey=["']([^"']+)["']/.exec(source)
    if (match) return match[1]
  } catch {
    /* fall through to the default below */
  }
  return "theme"
})()

/** Sets the theme the way next-themes does, before first paint. */
export async function applyTheme(context, theme) {
  await context.addInitScript(
    ({ value, key }) => {
      try {
        window.localStorage.setItem(key, value)
      } catch {
        /* storage unavailable — the class below still applies */
      }
      document.addEventListener("DOMContentLoaded", () => {
        document.documentElement.classList.toggle("dark", value === "dark")
        document.documentElement.setAttribute("data-theme", value)
      })
    },
    { value: theme, key: THEME_STORAGE_KEY },
  )
}

/**
 * What theme the page ACTUALLY rendered in, read back after load.
 *
 * A harness that cannot tell it measured the wrong thing is worse than no
 * harness: it converts an unaudited surface into a green tick. `applyTheme`
 * asks; this checks the answer, from the class next-themes really wrote and
 * from the computed background — because `forcedTheme` in the provider
 * overrides storage, the class AND any preference, and does it silently.
 */
export async function resolveTheme(page) {
  return page.evaluate(() => ({
    htmlClass: document.documentElement.className,
    resolved: document.documentElement.classList.contains("dark") ? "dark" : "light",
    requested: document.documentElement.getAttribute("data-theme"),
    background: getComputedStyle(document.body).backgroundColor,
  }))
}

export function parseArgs(argv) {
  const args = { flags: new Set(), values: new Map() }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith("--")) continue
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith("--")) {
      args.values.set(token.slice(2), next)
      i += 1
    } else {
      args.flags.add(token.slice(2))
    }
  }
  return args
}
