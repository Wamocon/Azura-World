#!/usr/bin/env node
/**
 * Set a known password on the eleven seeded demo accounts.
 *                                                     Owner: W-DEMO
 *
 * `pnpm demo:passwords`
 *
 * ## Why this exists as a script rather than a one-off admin-API call
 *
 * The eleven `*@azura.local` accounts are created by `supabase/seed.sql` with a
 * generated password that is recorded nowhere. Without a known password there
 * is no way to reach the dashboard at all, so every manual QA pass has to set
 * one first — and at least twice now a re-seed has silently invalidated the
 * password a previous pass set, turning a documented credential into a
 * "Invalid login credentials" ten minutes after it was verified.
 *
 * A script makes that a thirty-second fix instead of a re-investigation.
 *
 * ## Where the password comes from
 *
 * `quality/manual/.seed-password`, which `.gitignore` covers, or `$DEMO_PASSWORD`.
 * It is deliberately NOT a literal in this file: this repository is public
 * (MEDIA-LICENSE.md §1), and a credential in a committed script is a credential
 * in the clone history forever, even after it is edited out.
 *
 * ## What it does NOT do
 *
 * It does not create users, and it does not touch roles. All eleven accounts
 * and their `public.profiles` rows already exist with the correct role; the
 * seed builds them and an `auth.users` trigger keeps the 1:1. This only sets a
 * password on accounts that are already there, and it reports rather than
 * creates if one is missing — a missing account means the seed did not run, and
 * papering over that with a fresh signup would hide it.
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")

const ROLES = [
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

function readEnv(key) {
  for (const file of ["apps/web/.env.local", ".env.local"]) {
    try {
      const body = readFileSync(join(repoRoot, file), "utf8")
      const match = body.match(new RegExp(`^${key}=(.*)$`, "m"))
      if (match !== null && match[1].trim().length > 0) return match[1].trim()
    } catch {
      // Next candidate.
    }
  }
  return process.env[key] ?? null
}

function readPassword() {
  if (typeof process.env["DEMO_PASSWORD"] === "string" && process.env["DEMO_PASSWORD"].length > 0) {
    return process.env["DEMO_PASSWORD"]
  }
  try {
    const value = readFileSync(join(repoRoot, "quality/manual/.seed-password"), "utf8").trim()
    if (value.length > 0) return value
  } catch {
    // Fall through to the error below.
  }
  return null
}

const url = readEnv("NEXT_PUBLIC_SUPABASE_URL")
const serviceKey = readEnv("SUPABASE_SERVICE_ROLE_KEY")
const password = readPassword()

if (url === null || serviceKey === null) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")
  process.exit(1)
}
if (password === null) {
  console.error(
    "No password. Write one to quality/manual/.seed-password (gitignored) or set $DEMO_PASSWORD."
  )
  process.exit(1)
}

const admin = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
}

const listed = await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers: admin })
  .then((r) => r.json())
  .catch(() => null)

const users = new Map(
  (listed?.users ?? []).map((u) => [String(u.email).toLowerCase(), u])
)

console.log(`\nset-demo-passwords  ${users.size} auth user(s) on this project`)
console.log("-".repeat(62))

let set = 0
let missing = 0
let failed = 0

for (const role of ROLES) {
  const email = `${role}@azura.local`
  const user = users.get(email)

  if (user === undefined) {
    console.log(`  MISSING  ${email.padEnd(30)} run supabase/seed.sql first`)
    missing += 1
    continue
  }

  const res = await fetch(`${url}/auth/v1/admin/users/${user.id}`, {
    method: "PUT",
    headers: admin,
    // `email_confirm` too: an unconfirmed account cannot sign in at all, and a
    // re-seed is exactly the thing that can leave one unconfirmed.
    body: JSON.stringify({ password, email_confirm: true }),
  })

  if (res.ok) {
    console.log(`  ok       ${email}`)
    set += 1
  } else {
    const body = await res.text()
    console.log(`  FAILED   ${email.padEnd(30)} ${res.status} ${body.slice(0, 90)}`)
    failed += 1
  }
}

// Verify through the PUBLIC auth endpoint with the anon key, not the admin one.
// A 200 from the admin PUT only proves the write landed; it does not prove the
// account can actually sign in, which is the thing being promised.
const anonKey = readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
let verified = 0
if (anonKey !== null) {
  for (const role of ROLES) {
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: `${role}@azura.local`, password }),
    })
    const body = await res.json().catch(() => ({}))
    if (typeof body.access_token === "string") verified += 1
  }
}

console.log("-".repeat(62))
console.log(
  `  ${set} set · ${missing} missing · ${failed} failed · ${verified}/${ROLES.length} verified sign-in\n`
)

process.exit(failed > 0 || missing > 0 || verified !== ROLES.length ? 1 : 0)
