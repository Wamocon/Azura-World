/**
 * Provision the eleven demo logins.                          Owner: W-SITEMODEL
 *
 * `supabase/seed.sql` already defines one account per role at
 * `<role>@azura.local`, but it takes its password from the `azura.seed_password`
 * setting and falls back to 24 random bytes. Run without that setting, the
 * accounts exist and nobody can sign in as them, which is exactly the state the
 * seed's own comment warns about. This script closes that gap over the Admin
 * API so the demo has real, known credentials.
 *
 * It uses the service-role key and therefore only ever runs from a terminal.
 * The password is read from `AZURA_DEMO_PASSWORD`, or generated and printed
 * once, so a credential is never written into the repository.
 *
 *   node scripts/provision-demo-users.mjs            # report only
 *   node scripts/provision-demo-users.mjs --apply    # create or reset
 */

import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const APPLY = process.argv.includes("--apply")

// Read the local env without adding a dependency.
const env = {}
try {
  for (const line of readFileSync(
    path.join(REPO, "apps/web/.env.local"),
    "utf8",
  ).split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
} catch {
  console.error("  apps/web/.env.local not readable")
  process.exit(1)
}

const URL_ = env["NEXT_PUBLIC_SUPABASE_URL"]
const SERVICE = env["SUPABASE_SERVICE_ROLE_KEY"]
if (!URL_ || !SERVICE) {
  console.error("  NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
  process.exit(1)
}

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

const PASSWORD =
  env["AZURA_DEMO_PASSWORD"] ??
  process.env["AZURA_DEMO_PASSWORD"] ??
  `Azura-${Math.abs(
    [...ROLES.join("")].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7),
  ).toString(36)}-2026!`

async function api(pathname, init = {}) {
  const res = await fetch(`${URL_}/auth/v1${pathname}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text.slice(0, 200) }
  }
  return { status: res.status, body }
}

console.log(`\ndemo logins  (${APPLY ? "APPLY" : "report only"})\n`)

const existing = new Map()
const listed = await api("/admin/users?per_page=200")
if (listed.status !== 200) {
  console.error(`  cannot list users: ${listed.status}`, listed.body)
  process.exit(1)
}
for (const u of listed.body?.users ?? []) existing.set(u.email, u.id)

let created = 0
let reset = 0
let failed = 0

for (const role of ROLES) {
  const email = `${role}@azura.local`
  const id = existing.get(email)

  if (!APPLY) {
    console.log(`  ${id ? "exists " : "MISSING"}  ${email}`)
    continue
  }

  if (id) {
    const r = await api(`/admin/users/${id}`, {
      method: "PUT",
      body: JSON.stringify({ password: PASSWORD, email_confirm: true }),
    })
    if (r.status === 200) {
      reset += 1
      console.log(`  reset    ${email}`)
    } else {
      failed += 1
      console.log(`  FAILED   ${email}  ${r.status}  ${JSON.stringify(r.body).slice(0, 120)}`)
    }
    continue
  }

  const r = await api("/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password: PASSWORD,
      email_confirm: true,
      // No role key here, ever. public.handle_new_user() ignores any
      // client-supplied role by design; the role is assigned by the database.
      user_metadata: {
        full_name: role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        locale: "de",
      },
    }),
  })
  if (r.status === 200 || r.status === 201) {
    created += 1
    console.log(`  created  ${email}`)
  } else {
    failed += 1
    console.log(`  FAILED   ${email}  ${r.status}  ${JSON.stringify(r.body).slice(0, 140)}`)
  }
}

if (APPLY) {
  console.log(`\n  created ${created} · reset ${reset} · failed ${failed}`)
  console.log(`  password for every account:  ${PASSWORD}`)
  console.log(
    "\n  The role each account actually gets is assigned by the database, not by\n" +
      "  this script. Verify with: select email, role from public.profiles;\n",
  )
} else {
  console.log("\n  re-run with --apply to create or reset them\n")
}
process.exit(failed === 0 ? 0 : 1)
