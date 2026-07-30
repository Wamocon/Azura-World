#!/usr/bin/env node
/**
 * The orchestrator: sign in as every role, walk every route, report.
 *                                                          Owner: W-NIGHT
 *
 * `pnpm orchestrate`                      full sweep, all 11 roles
 * `pnpm orchestrate -- --role admin`      one role
 * `pnpm orchestrate -- --base http://127.0.0.1:3251`
 * `pnpm orchestrate -- --shots`           also write a screenshot per route
 *
 * ## What it is for
 *
 * The dashboard is 24 routes times 11 roles. Nobody clicks 264 combinations by
 * hand, which is exactly why bugs live there: the English analyst note that
 * reached the German masterplan, the Router-updated-during-render warning on
 * every block click, the four hundred rows of empty operational tables. Each of
 * those was found by opening one page and looking. This opens all of them.
 *
 * It reports rather than asserts. A route that is empty for a `guest` is
 * correct; a route that is empty for `admin` is a finding. The tool cannot tell
 * those apart, so it prints what it saw and lets a human read the table. The
 * one thing it DOES fail on is a console error, because there is no role for
 * which a React error is the right answer.
 *
 * ## What it checks per route
 *
 *   console errors        any severity, deduped, first 140 chars
 *   page errors           uncaught exceptions
 *   HTTP >= 400           failed requests, excluding expected auth probes
 *   MISSING_MESSAGE       an i18n key that does not resolve
 *   raw analyst notes     English dataset prose leaking into a German page
 *   horizontal overflow   scrollWidth > clientWidth on the document
 *   empty surfaces        a main region with under 400 characters of text
 *   nav shape             how many links this role is offered
 *
 * ## Non-destructive
 *
 * It reads. It signs in with the demo accounts and never writes. It cannot
 * damage the database, and it can be run against a production build safely.
 */

import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs"
import { createConnection } from "node:net"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}
const ONLY_ROLE = argOf("role", null)
const SHOTS = argv.includes("--shots")
const OUT = argOf("out", join(repoRoot, "quality/orchestrate"))

const ROLES = [
  "admin", "manager", "accountant", "staff", "owner", "tenant",
  "guest", "service_provider", "child_owner", "child_tenant", "child_guest",
]

/** Every dashboard route. `""` is the home. */
const ROUTES = [
  "", "/units", "/listings", "/evidence", "/reports", "/hotel", "/reviews",
  "/leads", "/buyer-pipeline", "/finance", "/wallet", "/vendor-invoices",
  "/tickets", "/activities", "/calendar", "/communications", "/documents",
  "/compliance", "/users", "/settings", "/admin",
]

// A German page showing English dataset prose is the bug class that produced
// "Block composition is not published by any source" on the masterplan. These
// are fragments of real notes in lib/azura-world-data.ts.
const ANALYST_NOTE_TELLS = [
  "is not published by any source",
  "MODELLED, NOT A LISTING",
  "WRONG-DISTRICT SUSPECT",
  "as published by",
  "No source publishes",
  "portal overview 'price from'",
]

/**
 * The newest Chromium Playwright has already downloaded here, or null.
 *
 * Playwright pins one revision per version and refuses to launch if that exact
 * build is absent, even when four newer ones are sitting beside it. On this
 * machine the pin is 1234 and 1228 is installed, so a strict launch fails with
 * "Executable doesn't exist" and the whole sweep never runs.
 *
 * This is lifted deliberately from `scripts/csp-probe.mjs`, which solved the
 * same problem first. Two different fallbacks for one machine quirk is how the
 * second one rots.
 */
function findInstalledChromium() {
  const explicit = argOf("chromium", null)
  if (explicit !== null) return explicit

  const root =
    process.env["PLAYWRIGHT_BROWSERS_PATH"] ??
    (process.env["LOCALAPPDATA"] === undefined
      ? null
      : join(process.env["LOCALAPPDATA"], "ms-playwright"))
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

function readEnvValue(key) {
  for (const file of ["apps/web/.env.local", ".env.local"]) {
    try {
      const body = readFileSync(join(repoRoot, file), "utf8")
      const m = body.match(new RegExp(`^${key}=(.*)$`, "m"))
      if (m !== null && m[1].trim().length > 0) return m[1].trim()
    } catch {
      /* next */
    }
  }
  return process.env[key] ?? null
}

function readPassword() {
  if (typeof process.env["DEMO_PASSWORD"] === "string" && process.env["DEMO_PASSWORD"].length > 0) {
    return process.env["DEMO_PASSWORD"]
  }
  try {
    return readFileSync(join(repoRoot, "quality/manual/.seed-password"), "utf8").trim()
  } catch {
    return null
  }
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port })
    socket.once("connect", () => { socket.destroy(); resolve(true) })
    socket.once("error", () => { resolve(false) })
    setTimeout(() => { socket.destroy(); resolve(false) }, 900)
  })
}

async function resolveBase() {
  const explicit = argOf("base", null)
  if (explicit !== null) return { base: explicit, child: null }

  // Prefer an already-running server so the sweep never fights a dev server for
  // the .next directory — running `next build` beside a live `next dev` is what
  // corrupted the dev server earlier in this project.
  for (const port of [3200, 3251, 3210]) {
    if (await portOpen(port)) return { base: `http://127.0.0.1:${port}`, child: null }
  }

  const port = 3260
  const require_ = createRequire(join(repoRoot, "apps/web/package.json"))
  const nextBin = join(dirname(require_.resolve("next/package.json")), "dist/bin/next")
  const child = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: join(repoRoot, "apps/web"),
    stdio: "ignore",
  })
  for (let i = 0; i < 40; i++) {
    if (await portOpen(port)) return { base: `http://127.0.0.1:${port}`, child }
    await new Promise((r) => setTimeout(r, 500))
  }
  child.kill()
  throw new Error("could not start a server; pass --base")
}

async function main() {
  const password = readPassword()
  if (password === null) {
    console.error("No demo password. Run `pnpm demo:passwords` first.")
    process.exit(1)
  }

  const require_ = createRequire(join(repoRoot, "apps/web/package.json"))
  const pw = await import(pathToFileURL(require_.resolve("@playwright/test")).href)
  const chromium = pw.chromium ?? pw.default?.chromium

  const { base, child } = await resolveBase()
  if (SHOTS) mkdirSync(OUT, { recursive: true })

  const roles = ONLY_ROLE === null ? ROLES : [ONLY_ROLE]
  console.log(`\norchestrate  ${base}  ${roles.length} role(s) x ${ROUTES.length} routes\n`)

  const executablePath = findInstalledChromium()
  if (executablePath !== null) console.log(`  chromium: ${executablePath}
`)
  const browser = await chromium.launch(
    executablePath === null ? {} : { executablePath }
  )
  const findings = []
  let checked = 0

  for (const role of roles) {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
    const page = await ctx.newPage()

    let signedIn = false
    try {
      await page.goto(`${base}/de/login`, { waitUntil: "domcontentloaded", timeout: 90_000 })
      await page.waitForSelector('input[type="email"]', { timeout: 60_000 })
      await page.fill('input[type="email"]', `${role}@azura.local`)
      await page.fill('input[type="password"]', password)
      await page.click('button[type="submit"]')
      await page.waitForURL(/dashboard/, { timeout: 60_000, waitUntil: "commit" })
      await page.waitForTimeout(2_500)
      signedIn = true
    } catch (e) {
      findings.push({ role, route: "/login", kind: "signin", detail: String(e).split("\n")[0].slice(0, 120) })
    }

    if (signedIn) {
      for (const route of ROUTES) {
        checked += 1
        const errors = []
        const http = []
        // Next.js logs server errors through a `%c%s%c <css> <css> Server ...`
        // format string. Taking the first 140 chars of that yields 140
        // characters of CSS and none of the error, which is what the first
        // sweep printed. Strip the directives and the style arguments first.
        const clean = (raw) => {
          let t = raw.replace(/\s+/g, " ")
          if (t.startsWith("%c%s%c") || t.startsWith("%s%s")) {
            t = t
              .replace(/^%[cs](%[cs])*/, "")
              .replace(/(?:^|\s)(?:background|color|border-radius|font|padding)[^;]*;?/g, " ")
              .replace(/\s+/g, " ")
              .trim()
          }
          return t.slice(0, 200)
        }
        const onConsole = (m) => { if (m.type() === "error") errors.push(clean(m.text())) }
        const onPageError = (e) => errors.push(`PAGEERROR ${String(e).slice(0, 200)}`)
        const onResponse = (r) => {
          // 401/403 on an API probe is RBAC working, not a defect.
          if (r.status() >= 400 && r.status() !== 401 && r.status() !== 403) {
            http.push(`${r.status()} ${r.url().replace(base, "").slice(0, 90)}`)
          }
        }
        page.on("console", onConsole)
        page.on("pageerror", onPageError)
        page.on("response", onResponse)

        try {
          await page.goto(`${base}/de/dashboard${route}`, { waitUntil: "domcontentloaded", timeout: 60_000 })
          await page.waitForTimeout(2_200)

          const probe = await page.evaluate((tells) => {
            const main = document.querySelector("main") ?? document.body
            const text = main.innerText ?? ""
            return {
              chars: text.trim().length,
              navLinks: document.querySelectorAll("nav a").length,
              hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
              missingMessage: text.includes("MISSING_MESSAGE"),
              analystNote: tells.filter((t) => text.includes(t)),
              title: (document.querySelector("h1")?.textContent ?? "").trim().slice(0, 42),
            }
          }, ANALYST_NOTE_TELLS)

          const name = route === "" ? "home" : route.replace(/\//g, "-").replace(/^-/, "")
          if (SHOTS) await page.screenshot({ path: join(OUT, `${role}-${name}.png`) })

          for (const e of new Set(errors)) findings.push({ role, route, kind: "console", detail: e })
          for (const h of new Set(http)) findings.push({ role, route, kind: "http", detail: h })
          if (probe.missingMessage) findings.push({ role, route, kind: "i18n", detail: "MISSING_MESSAGE rendered" })
          for (const t of probe.analystNote) findings.push({ role, route, kind: "raw-note", detail: `English dataset prose: "${t}"` })
          if (probe.hScroll) findings.push({ role, route, kind: "overflow", detail: "document scrolls horizontally" })
          if (probe.chars < 400) findings.push({ role, route, kind: "thin", detail: `${probe.chars} chars of content ("${probe.title}")` })

          const flag = errors.length > 0 ? "ERR" : probe.chars < 400 ? "thin" : "ok"
          console.log(`  ${role.padEnd(17)} ${(route || "/").padEnd(18)} ${String(flag).padEnd(5)} ${String(probe.chars).padStart(6)} chars  nav=${probe.navLinks}`)
        } catch (e) {
          findings.push({ role, route, kind: "load", detail: String(e).split("\n")[0].slice(0, 120) })
          console.log(`  ${role.padEnd(17)} ${(route || "/").padEnd(18)} FAIL`)
        }

        page.off("console", onConsole)
        page.off("pageerror", onPageError)
        page.off("response", onResponse)
      }
    }
    await ctx.close()
  }

  await browser.close()
  if (child !== null) child.kill()

  // ------------------------------------------------------------------ report
  const byKind = {}
  for (const f of findings) (byKind[f.kind] ??= []).push(f)

  console.log(`\n${"=".repeat(76)}`)
  console.log(`  ${checked} route-views checked · ${findings.length} findings\n`)

  const ORDER = ["console", "load", "signin", "http", "i18n", "raw-note", "overflow", "thin"]
  for (const kind of ORDER) {
    const list = byKind[kind]
    if (list === undefined) continue
    console.log(`  ${kind.toUpperCase()}  (${list.length})`)
    // Group identical details so one bug in a shared component reads as one
    // line with a role list, not as eleven separate findings.
    const grouped = {}
    for (const f of list) {
      const key = `${f.route}|${f.detail}`
      ;(grouped[key] ??= []).push(f.role)
    }
    for (const [key, rolesHit] of Object.entries(grouped).slice(0, 40)) {
      const [route, detail] = key.split("|")
      const who = rolesHit.length > 3 ? `${rolesHit.length} roles` : rolesHit.join(",")
      console.log(`     ${(route || "/").padEnd(18)} ${who.padEnd(12)} ${detail}`)
    }
    console.log("")
  }

  // Only a console error is unambiguously wrong. Everything else is a report.
  const blocking = (byKind["console"]?.length ?? 0) + (byKind["load"]?.length ?? 0) + (byKind["signin"]?.length ?? 0)
  console.log(`  ${blocking === 0 ? "OK" : "FAILED"}  ${blocking} blocking (console/load/signin)\n`)
  process.exit(blocking > 0 ? 1 : 0)
}

await main()
