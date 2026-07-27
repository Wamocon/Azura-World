#!/usr/bin/env node
/**
 * Verify the Supabase connection for the Azura World CATI.
 *
 * Runs before `pnpm install` — uses only Node built-ins (Node >= 20 has fetch).
 * The direct-Postgres check needs `pg`; it degrades to SKIP if not installed.
 *
 *   node scripts/verify-supabase.mjs
 *   node scripts/verify-supabase.mjs --verbose
 *
 * Never prints a secret. Keys are shown as a fingerprint (first 8 chars + length).
 */

import { readFileSync, existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const VERBOSE = process.argv.includes("--verbose")

// ── minimal .env.local loader (no dotenv dependency) ────────────────────────
function loadEnv(file) {
  const path = resolve(ROOT, file)
  if (!existsSync(path)) return {}
  const out = {}
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq === -1) continue
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return out
}

const env = { ...loadEnv(".env.local"), ...process.env }

// ── reporting ───────────────────────────────────────────────────────────────
const results = []
const record = (name, status, detail) => {
  results.push({ name, status, detail })
  const mark = { PASS: "\x1b[32mPASS\x1b[0m", FAIL: "\x1b[31mFAIL\x1b[0m", SKIP: "\x1b[33mSKIP\x1b[0m", WARN: "\x1b[33mWARN\x1b[0m" }[status]
  console.log(`  ${mark}  ${name}${detail ? ` — ${detail}` : ""}`)
}

/** Never print a secret. Fingerprint only. */
const fp = (v) => (!v ? "(empty)" : `${v.slice(0, 8)}… len=${v.length}`)

const need = (k) => {
  const v = env[k]
  return v && !v.startsWith("your-") && !v.startsWith("replace-with") ? v : null
}

// ── 1. presence ─────────────────────────────────────────────────────────────
console.log("\n\x1b[1m1. Environment variables\x1b[0m")

const URL_ = need("NEXT_PUBLIC_SUPABASE_URL")
const ANON = need("NEXT_PUBLIC_SUPABASE_ANON_KEY")
const SVC = need("SUPABASE_SERVICE_ROLE_KEY")
const REF = need("SUPABASE_PROJECT_REF")
const DBURL = need("SUPABASE_DB_URL")

record("NEXT_PUBLIC_SUPABASE_URL", URL_ ? "PASS" : "FAIL", URL_ ?? "not set")
record("NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON ? "PASS" : "FAIL", fp(ANON))
record("SUPABASE_SERVICE_ROLE_KEY", SVC ? "PASS" : "FAIL", fp(SVC))
record("SUPABASE_PROJECT_REF", REF ? "PASS" : "WARN", REF ?? "not set (CLI link will need it)")
record("SUPABASE_DB_URL", DBURL ? "PASS" : "WARN", DBURL ? "set" : "not set (migrations will need it)")

for (const k of [
  "CALENDAR_FEED_TOKEN_SECRET",
  "PUBLIC_REPORT_SECURITY_SECRET",
  "REGISTRATION_IDENTITY_PEPPER",
  "REGISTRATION_RECEIPT_PEPPER",
  "EVIDENCE_SNAPSHOT_HMAC_SECRET",
]) {
  const v = need(k)
  record(k, v && v.length >= 32 ? "PASS" : "FAIL", v ? `len=${v.length}` : "not set")
}

if (!URL_ || !ANON || !SVC) {
  console.log("\n\x1b[31mCannot continue: fill the [NEEDED] values in .env.local first.\x1b[0m")
  console.log("See SUPABASE-SETUP.md for where each value lives in the dashboard.\n")
  process.exit(1)
}

// ── 2. consistency ──────────────────────────────────────────────────────────
console.log("\n\x1b[1m2. Consistency\x1b[0m")

const urlRef = URL_.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] ?? null
record("URL is a supabase.co project URL", urlRef ? "PASS" : "FAIL", urlRef ?? URL_)
if (REF && urlRef) {
  record("PROJECT_REF matches URL", REF === urlRef ? "PASS" : "FAIL", REF === urlRef ? REF : `${REF} vs ${urlRef}`)
}
record(
  "anon key differs from service-role key",
  ANON !== SVC ? "PASS" : "FAIL",
  ANON === SVC ? "IDENTICAL — you pasted the same key twice" : "ok",
)
if (DBURL && urlRef) {
  record("DB_URL references the same project", DBURL.includes(urlRef) ? "PASS" : "WARN",
    DBURL.includes(urlRef) ? "ok" : "project ref not found in connection string")

  // Two valid shapes: the direct host db.<ref>.supabase.co (IPv6-only, best for
  // migrations) or the session pooler on 5432 (IPv4). The transaction pooler on
  // 6543 breaks prepared statements and advisory locks, so migrations fail there.
  const isDirect = /@db\.[a-z0-9]+\.supabase\.co:/i.test(DBURL)
  const isTxPooler = /:6543\//.test(DBURL)
  record(
    "DB_URL port suitable for migrations",
    isTxPooler ? "FAIL" : "PASS",
    isTxPooler
      ? "port 6543 is the transaction pooler — migrations and pgTAP will fail; use 5432"
      : isDirect
        ? "direct host on 5432 (IPv6-only — verified reachable)"
        : "session pooler on 5432",
  )
}

// ── 3. reachability ─────────────────────────────────────────────────────────
console.log("\n\x1b[1m3. REST API reachability\x1b[0m")

async function probe(label, path, key) {
  try {
    const res = await fetch(`${URL_}${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (VERBOSE) console.log(`      → HTTP ${res.status} ${res.statusText}`)
    return res
  } catch (err) {
    record(label, "FAIL", err.name === "TimeoutError" ? "timed out after 15s" : err.message)
    return null
  }
}

// NOTE: `/rest/v1/` (the OpenAPI root) is service_role-only by design — probing it with the
// anon key always returns 401 "Only the `service_role` API key can be used for this endpoint",
// which says nothing about whether the anon key is valid. Probe a table path instead: a valid
// anon key yields a PostgREST error (PGRST205 / 42P01 for a missing table), an invalid one
// yields "Invalid API key".
const anonRes = await probe("REST reachable with anon key", "/rest/v1/__azura_probe__?select=*", ANON)
if (anonRes) {
  const body = await anonRes.text().catch(() => "")
  const invalidKey = /invalid api key/i.test(body)
  record("REST reachable with anon key", anonRes.status < 500 ? "PASS" : "FAIL", `HTTP ${anonRes.status}`)
  record(
    "anon key accepted",
    invalidKey ? "FAIL" : "PASS",
    invalidKey ? "rejected — key wrong, rotated, or project paused" : "reached PostgREST",
  )
  if (VERBOSE) console.log(`      → ${body.slice(0, 160)}`)
}

const svcRes = await probe("REST reachable with service-role key", "/rest/v1/", SVC)
if (svcRes) {
  record("REST reachable with service-role key", svcRes.status < 500 ? "PASS" : "FAIL", `HTTP ${svcRes.status}`)
  if (svcRes.status === 401) record("service-role key accepted", "FAIL", "401 — key rejected")
}

// ── 4. auth + storage ───────────────────────────────────────────────────────
console.log("\n\x1b[1m4. Auth & Storage\x1b[0m")

try {
  const res = await fetch(`${URL_}/auth/v1/settings`, {
    headers: { apikey: ANON },
    signal: AbortSignal.timeout(15_000),
  })
  record("Auth service responding", res.ok ? "PASS" : "WARN", `HTTP ${res.status}`)
  if (res.ok && VERBOSE) {
    const s = await res.json()
    console.log(`      → external providers: ${Object.keys(s.external ?? {}).filter((k) => s.external[k]).join(", ") || "none"}`)
  }
} catch (err) {
  record("Auth service responding", "FAIL", err.message)
}

try {
  const res = await fetch(`${URL_}/storage/v1/bucket`, {
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (res.ok) {
    const buckets = await res.json()
    const names = buckets.map((b) => b.name)
    record("Storage service responding", "PASS", `${names.length} bucket(s)`)

    for (const want of [env.SUPABASE_DOCUMENT_BUCKET, env.SUPABASE_EVIDENCE_BUCKET].filter(Boolean)) {
      const b = buckets.find((x) => x.name === want)
      if (!b) record(`bucket "${want}"`, "WARN", "missing — run scripts/setup-supabase.mjs")
      else record(`bucket "${want}"`, b.public ? "FAIL" : "PASS", b.public ? "PUBLIC — must be private" : "private")
    }
  } else {
    record("Storage service responding", "WARN", `HTTP ${res.status}`)
  }
} catch (err) {
  record("Storage service responding", "FAIL", err.message)
}

// ── 5. schema state ─────────────────────────────────────────────────────────
console.log("\n\x1b[1m5. Schema state\x1b[0m")

try {
  const res = await fetch(`${URL_}/rest/v1/?select=*`, {
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, Accept: "application/openapi+json" },
    signal: AbortSignal.timeout(15_000),
  })
  if (res.ok) {
    const spec = await res.json()
    const tables = Object.keys(spec.definitions ?? spec.components?.schemas ?? {})
    record("Schema introspection", "PASS", `${tables.length} table(s) exposed`)
    if (tables.length === 0) {
      record("Database state", "PASS", "empty — ready for W1-A migrations")
    } else {
      record("Database state", "WARN", `not empty: ${tables.slice(0, 8).join(", ")}${tables.length > 8 ? "…" : ""}`)
      console.log("      \x1b[33mReview these before running migrations — W1-A assumes a clean project.\x1b[0m")
    }
  } else {
    record("Schema introspection", "WARN", `HTTP ${res.status}`)
  }
} catch (err) {
  record("Schema introspection", "WARN", err.message)
}

// ── 6. direct Postgres (optional) ───────────────────────────────────────────
console.log("\n\x1b[1m6. Direct Postgres\x1b[0m")

if (!DBURL) {
  record("Direct connection", "SKIP", "SUPABASE_DB_URL not set")
} else {
  try {
    const { default: pg } = await import("pg")
    const client = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } })
    await client.connect()
    const { rows } = await client.query("select version(), current_database(), current_user")
    record("Direct connection", "PASS", rows[0].version.split(" ").slice(0, 2).join(" "))
    if (VERBOSE) console.log(`      → db=${rows[0].current_database} user=${rows[0].current_user}`)

    const ext = await client.query("select extname from pg_extension order by extname")
    record("Extensions", "PASS", ext.rows.map((r) => r.extname).join(", "))
    for (const want of ["pgcrypto", "pg_trgm"]) {
      record(`extension ${want}`, ext.rows.some((r) => r.extname === want) ? "PASS" : "WARN",
        ext.rows.some((r) => r.extname === want) ? "installed" : "W1-A migration 00 will enable it")
    }
    await client.end()
  } catch (err) {
    if (err.code === "ERR_MODULE_NOT_FOUND") {
      record("Direct connection", "SKIP", "`pg` not installed — run after pnpm install")
    } else {
      record("Direct connection", "FAIL", err.message)
    }
  }
}

// ── summary ─────────────────────────────────────────────────────────────────
const counts = results.reduce((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {})
console.log(`\n\x1b[1mSummary\x1b[0m  ${counts.PASS ?? 0} pass · ${counts.FAIL ?? 0} fail · ${counts.WARN ?? 0} warn · ${counts.SKIP ?? 0} skip`)

const failed = results.filter((r) => r.status === "FAIL")
if (failed.length) {
  console.log("\n\x1b[31mFailures:\x1b[0m")
  for (const f of failed) console.log(`  · ${f.name} — ${f.detail}`)
  console.log()
  process.exit(1)
}
console.log("\n\x1b[32mSupabase connection verified.\x1b[0m\n")
