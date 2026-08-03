/**
 * write-grants-probe — migration 21, proved at the database.
 *
 * ## Why this exists
 *
 * Ten features in this repository were declared "not implemented: no repository
 * write path exists". Underneath every one of them was a complete, correct RLS
 * policy admitting exactly the right caller — and a revoked table GRANT, so
 * Postgres raised 42501 before any policy could be evaluated. Migration 16
 * diagnosed it for tickets, 17 for participant writes, 21 for the rest.
 *
 * Two of those were not unimplemented but **shipped and broken**: the role
 * picker and the deactivate control on /dashboard/users, which an administrator
 * could see and press, and `vendorInvoice.settle`, which docs/api/openapi.yaml
 * certifies to the world. Nothing in the codebase said so, because nothing had
 * ever pressed the button while connected to the real database.
 *
 * So this presses them. It signs in for real — anon key plus password, RLS in
 * full force, exactly the path a browser takes — and asserts on what Postgres
 * actually does.
 *
 * ## The assertion that matters most
 *
 * `grant update on public.profiles to authenticated` looks like a
 * privilege-escalation hole: `profiles_update_own` is `using (auth.uid() = id)`,
 * so any signed-in user can update their own row — including, apparently, their
 * own `role`. They cannot, because `prevent_profile_privilege_escalation`
 * refuses any change to role, company_id or is_active unless `is_admin()`.
 *
 * That trigger is now the only thing standing between a tenant and an admin
 * account. The four `tenant CANNOT …` assertions below are the regression test
 * for it, and they must never be relaxed.
 *
 * ## Reading a failure
 *
 * `want=ALLOWED got=REFUSED (42501)` — a legitimate action is blocked. The GRANT
 * is missing or was revoked again. Check table privileges before the policy.
 *
 * `want=REFUSED got=ALLOWED` — the serious direction. A guard that used to hold
 * has been dropped and the product is now accepting writes it must not.
 *
 * Restores everything it changes. Usage: pnpm qa:grants
 */
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(new URL("../apps/web/package.json", import.meta.url))
const { createClient } = require("@supabase/supabase-js")

// `fileURLToPath`, never `url.pathname`: this repository lives in a directory
// with a space in its name, and `.pathname` hands back `D:/Azura%20World`.
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

if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.log("write-grants-probe — SKIPPED, Supabase is not configured")
  process.exit(0)
}

const password = readFileSync(`${root}/quality/manual/.seed-password`, "utf8").trim()

/** Every row this probe writes carries it; the cleanup matches on it. */
const MARKER = "[probe:write-grants]"

let failures = 0
let checks = 0

function check(label, expected, error) {
  checks += 1
  const got = error === null || error === undefined ? "ALLOWED" : "REFUSED"
  const ok = got === expected
  if (!ok) failures += 1
  console.log(
    `${ok ? "pass" : "FAIL"}  ${label.padEnd(52)} want=${expected.padEnd(7)} got=${got}${error?.code ? ` (${error.code})` : ""}`
  )
  if (!ok && error) console.log(`        ${error.message}`)
}

async function as(email) {
  const client = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error !== null) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  return { client, uid: data.user.id }
}

async function companyOf(client, email) {
  const r = await client
    .from("profiles")
    .select("company_id")
    .eq("email", email)
    .maybeSingle()
  return r.data?.company_id ?? null
}

console.log("write-grants-probe — migration 21 (restored write GRANTs)\n")

const cleanup = []

try {
  // === profiles: the escalation guard ====================================
  {
    const { client, uid } = await as("tenant@azura.local")
    const before = await client
      .from("profiles")
      .select("full_name")
      .eq("id", uid)
      .maybeSingle()

    check(
      "tenant CANNOT promote itself",
      "REFUSED",
      (await client.from("profiles").update({ role: "admin" }).eq("id", uid).select("id")).error
    )
    check(
      "tenant CANNOT change its own activation",
      "REFUSED",
      (await client.from("profiles").update({ is_active: false }).eq("id", uid).select("id")).error
    )
    check(
      "tenant CANNOT move itself between companies",
      "REFUSED",
      (
        await client
          .from("profiles")
          .update({ company_id: "00000000-0000-4000-8000-000000000000" })
          .eq("id", uid)
          .select("id")
      ).error
    )
    check(
      "tenant CAN edit its own display name",
      "ALLOWED",
      (await client.from("profiles").update({ full_name: `${MARKER}` }).eq("id", uid).select("id")).error
    )

    // Somebody else's row is filtered out by the policy, so the UPDATE matches
    // nothing and PostgREST reports no error. Assert on the row count.
    const other = await client
      .from("profiles")
      .update({ full_name: MARKER })
      .eq("email", "manager@azura.local")
      .select("id")
    checks += 1
    const rows = (other.data ?? []).length
    if (rows !== 0) failures += 1
    console.log(
      `${rows === 0 ? "pass" : "FAIL"}  ${"tenant CANNOT edit another person's profile".padEnd(52)} rows=${rows}`
    )

    cleanup.push(async () => {
      await client
        .from("profiles")
        .update({ full_name: before.data?.full_name ?? null })
        .eq("id", uid)
    })
  }

  // === profiles: what an administrator is for =============================
  {
    const { client } = await as("admin@azura.local")
    const target = await client
      .from("profiles")
      .select("id, role, is_active")
      .eq("email", "staff@azura.local")
      .maybeSingle()
    const was = target.data
    if (was === null) throw new Error("staff@azura.local not found")

    check(
      "admin CAN change a role",
      "ALLOWED",
      (await client.from("profiles").update({ role: "accountant" }).eq("id", was.id).select("id")).error
    )
    check(
      "admin CAN deactivate an account",
      "ALLOWED",
      (await client.from("profiles").update({ is_active: false }).eq("id", was.id).select("id")).error
    )
    cleanup.push(async () => {
      await client
        .from("profiles")
        .update({ role: was.role, is_active: was.is_active })
        .eq("id", was.id)
    })
  }

  // === leads and the pipeline: manager-and-above, not merely staff ========
  {
    const { client } = await as("staff@azura.local")
    check(
      "staff (level 40) CANNOT create a lead",
      "REFUSED",
      (
        await client
          .from("leads")
          .insert({
            company_id: await companyOf(client, "staff@azura.local"),
            full_name: MARKER,
            email: "probe@azura.local",
            reference: `PRB-${Math.floor(Math.random() * 100000)}`,
            source: "portal",
            status: "new",
          })
          .select("id")
      ).error
    )
  }
  {
    const { client } = await as("manager@azura.local")
    const companyId = await companyOf(client, "manager@azura.local")
    const created = await client
      .from("leads")
      .insert({
        company_id: companyId,
        full_name: MARKER,
        email: "probe@azura.local",
        reference: `PRB-${Math.floor(Math.random() * 100000)}`,
        source: "portal",
        status: "new",
      })
      .select("id")
    check("manager CAN create a lead", "ALLOWED", created.error)

    // The pipeline move, and the trigger that must maintain its own columns.
    const entry = await client
      .from("buyer_pipeline_entries")
      .select("id, stage, version, previous_stage, entered_stage_at")
      .limit(1)
      .maybeSingle()
    if (entry.data !== null) {
      const was = entry.data
      const nextStage = was.stage === "qualification" ? "viewing" : "qualification"
      const moved = await client
        .from("buyer_pipeline_entries")
        .update({ stage: nextStage })
        .eq("id", was.id)
        .eq("version", was.version)
        .select("id, stage, previous_stage, entered_stage_at")
      check("manager CAN move a pipeline entry", "ALLOWED", moved.error)

      const after = moved.data?.[0]
      checks += 1
      const trackedByTrigger =
        after !== undefined &&
        after.previous_stage === was.stage &&
        after.entered_stage_at !== was.entered_stage_at
      if (!trackedByTrigger) failures += 1
      console.log(
        `${trackedByTrigger ? "pass" : "FAIL"}  ${"the trigger maintains previous_stage/entered_at".padEnd(52)} ${after ? `${was.stage} -> ${after.stage}, prev=${after.previous_stage}` : "no row"}`
      )

      // A stale version must lose.
      const stale = await client
        .from("buyer_pipeline_entries")
        .update({ stage: was.stage })
        .eq("id", was.id)
        .eq("version", was.version)
        .select("id")
      checks += 1
      const staleRows = (stale.data ?? []).length
      if (staleRows !== 0) failures += 1
      console.log(
        `${staleRows === 0 ? "pass" : "FAIL"}  ${"a stale expectedVersion matches zero rows (409)".padEnd(52)} rows=${staleRows}`
      )

      cleanup.push(async () => {
        await client
          .from("buyer_pipeline_entries")
          .update({
            stage: was.stage,
            previous_stage: was.previous_stage,
            entered_stage_at: was.entered_stage_at,
          })
          .eq("id", was.id)
      })
    }
  }

  // === finance: level >= 60 within the company ============================
  {
    const { client } = await as("accountant@azura.local")
    const companyId = await companyOf(client, "accountant@azura.local")
    check(
      "accountant CAN record a payment",
      "ALLOWED",
      (
        await client
          .from("payment_transactions")
          .insert({
            company_id: companyId,
            provider: "bank_transfer",
            provider_reference: `${MARKER}-${Math.floor(Math.random() * 1000000)}`,
            direction: "inbound",
            status: "captured",
            amount: 100,
            currency: "EUR",
            paid_at: new Date().toISOString(),
          })
          .select("id")
      ).error
    )
  }
  {
    const { client } = await as("tenant@azura.local")
    check(
      "tenant CANNOT record a payment",
      "REFUSED",
      (
        await client
          .from("payment_transactions")
          .insert({
            company_id: await companyOf(client, "tenant@azura.local"),
            provider: "cash",
            provider_reference: `${MARKER}-tenant`,
            direction: "inbound",
            status: "captured",
            amount: 1,
            currency: "EUR",
            paid_at: new Date().toISOString(),
          })
          .select("id")
      ).error
    )
  }

  // === the ledger's own integrity is not weakened by the grant ============
  {
    const { client } = await as("accountant@azura.local")
    const companyId = await companyOf(client, "accountant@azura.local")
    // A single unbalanced leg must be refused at COMMIT by
    // assert_ledger_group_balanced, which is DEFERRABLE INITIALLY DEFERRED.
    const unbalanced = await client
      .from("finance_ledger_entries")
      .insert({
        company_id: companyId,
        transaction_group_id: crypto.randomUUID(),
        entry_type: "dues",
        status: "draft",
        currency: "EUR",
        debit_amount: 50,
        credit_amount: 0,
        description: MARKER,
      })
      .select("id")
    check(
      "an unbalanced ledger leg is still refused",
      "REFUSED",
      unbalanced.error
    )
  }
} finally {
  for (const undo of cleanup.reverse()) {
    try {
      await undo()
    } catch (error) {
      console.log(`        cleanup step failed: ${error.message}`)
    }
  }
  // Rows created by the probe, removed with the service role so a failed
  // assertion cannot leave debris behind.
  if (env.SUPABASE_DB_URL) {
    const { Client } = createRequire(new URL("../package.json", import.meta.url))("pg")
    const db = new Client({
      connectionString: env.SUPABASE_DB_URL,
      ssl: { rejectUnauthorized: false },
    })
    await db.connect()
    const removed = await db.query(
      `with p as (delete from public.payment_transactions where provider_reference like $1 returning 1),
            l as (delete from public.leads where full_name = $2 returning 1),
            e as (delete from public.finance_ledger_entries where description = $2 returning 1)
       select (select count(*) from p) payments, (select count(*) from l) leads,
              (select count(*) from e) ledger`,
      [`%${MARKER}%`, MARKER]
    )
    const { payments, leads, ledger } = removed.rows[0]
    console.log(
      `\ncleanup: removed ${payments} payment(s), ${leads} lead(s), ${ledger} ledger row(s); restored ${cleanup.length} record(s)`
    )
    await db.end()
  }
}

console.log(
  failures === 0
    ? `\nPASS — ${checks} checks, 0 failures`
    : `\nFAIL — ${failures} of ${checks} checks failed`
)
process.exit(failures === 0 ? 0 : 1)
