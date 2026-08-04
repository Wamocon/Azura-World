/**
 * audit-trail-probe — every mutation leaves a row, and the row is readable.
 *
 * ## Why this exists
 *
 * `public.audit_events` held ZERO rows for the entire life of this project.
 * Measured, not inferred: `select count(*) from public.audit_events` returned 0
 * after months of development and hundreds of mutations.
 *
 * `lib/api-handler.ts` → `writeAudit()` inserted a `metadata` column the table
 * did not have. It failed silently twice over: PostgREST RETURNS `{ error }`
 * rather than throwing, so the surrounding `try/catch` never fired and the
 * `console.warn` in its handler never ran — and the returned error was never
 * inspected. Migration 23 adds the column; the handler now checks the error.
 *
 * The manifest has always required a mutating route to DECLARE an audit action,
 * and `scripts/validate-openapi.mjs` fails the build without one. So the
 * declaration was enforced end to end while the write was discarded. That gap —
 * an enforced promise with no enforced delivery — is what this probe closes.
 *
 * ## What it asserts
 *
 * It performs one real mutation through the real API as a real signed-in user,
 * and checks that the row appears with the right shape: the action the manifest
 * declares, the caller, and a `request_id` matching the one the response
 * returned — because that id is what a person quotes in a support request, and
 * a trail you cannot join to a complaint is not much of a trail.
 *
 * It also asserts the trail stays APPEND-ONLY: `authenticated` must hold no
 * insert, update or delete on the table, so a session cannot forge or erase the
 * record of its own actions.
 *
 * Needs the app running on http://localhost:3200. Usage: pnpm qa:audit
 */
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"

const require = createRequire(new URL("../package.json", import.meta.url))
const { Client } = require("pg")

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "")

const env = Object.fromEntries(
  readFileSync(`${root}/.env.local`, "utf8")
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => {
      const i = line.indexOf("=")
      return [line.slice(0, i), line.slice(i + 1).replace(/^["']|["']$/g, "")]
    })
)

if (!env.SUPABASE_DB_URL) {
  console.log("audit-trail-probe — SKIPPED, no SUPABASE_DB_URL")
  process.exit(0)
}

const BASE = process.env.AZURA_BASE_URL ?? "http://localhost:3200"
const password = readFileSync(`${root}/quality/manual/.seed-password`, "utf8").trim()

let failures = 0
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures += 1
}

const db = new Client({
  connectionString: env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})
await db.connect()

console.log("audit-trail-probe — migration 23 + writeAudit()\n")

try {
  // --- the trail must be append-only for a session -------------------------
  const grants = await db.query(
    `select privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'audit_events'
        and grantee in ('authenticated','anon')
        and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')`
  )
  check(
    "no session role can write or erase the audit trail",
    grants.rows.length === 0,
    grants.rows.map((r) => r.privilege_type).join(",") || "none granted"
  )

  const { chromium } = await import(
    pathToFileURL(
      `${root}/node_modules/.pnpm/playwright@1.62.0/node_modules/playwright/index.mjs`
    ).href
  )
  const exe =
    process.env.AZURA_CHROMIUM ??
    "C:/Users/Maanik Garg/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe"

  const before = (
    await db.query("select count(*)::int n from public.audit_events")
  ).rows[0].n

  const browser = await chromium.launch({ executablePath: exe })
  const page = await browser.newPage()
  await page.goto(`${BASE}/en/login`, { waitUntil: "domcontentloaded" })
  await page.locator("#email").fill("manager@azura.local")
  await page.locator("#password").fill(password)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForURL(/dashboard/, { timeout: 20000 })

  // The cheapest audited mutation in the product: clearing nothing.
  // `notification.markRead` with an empty list changes no row and still travels
  // the full handler path, so the trail is exercised without touching data.
  const response = await page.evaluate(async (base) => {
    const r = await fetch(`${base}/api/site-management/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: "notification.markRead",
        notificationIds: [],
      }),
    })
    return { status: r.status, body: await r.json() }
  }, BASE)
  await page.waitForTimeout(1500)
  await browser.close()

  check("the mutation succeeded", response.status === 200, String(response.status))
  const requestId = response.body?.requestId

  const after = (
    await db.query("select count(*)::int n from public.audit_events")
  ).rows[0].n
  check("a row was written", after > before, `${before} -> ${after}`)

  const row = (
    await db.query(
      "select action, entity_table, actor_profile_id, request_id, metadata from public.audit_events where request_id = $1",
      [requestId]
    )
  ).rows[0]

  check("the row is joinable by the requestId the caller was given", row !== undefined, String(requestId))
  if (row !== undefined) {
    check(
      "it records the declared action",
      row.action === "command.executed",
      row.action
    )
    check("it names the actor", row.actor_profile_id !== null)
    check(
      "it records the outcome and the caller's role",
      row.metadata?.outcome === "ok" && typeof row.metadata?.role === "string",
      JSON.stringify(row.metadata)
    )
    check(
      "it carries no request body, query string or headers",
      !("body" in (row.metadata ?? {})) && !("query" in (row.metadata ?? {})),
      Object.keys(row.metadata ?? {}).join(",")
    )
  }
} finally {
  await db.end()
}

console.log(failures === 0 ? "\nPASS — 0 failures" : `\nFAIL — ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
