/**
 * read-boundary-probe — migration 22, proved with real data.
 *
 * Three reads the database allowed and only the application refused. All three
 * came out of an adversarial audit of the RLS policies, and all three were
 * LATENT: the tables were empty, so an earlier version of this probe reported
 * "0 rows" for every one and proved nothing at all. That is the trap this file
 * exists to avoid — it seeds the sensitive row first, checks who can read it,
 * and removes it again.
 *
 *   1. `messages.is_internal_note` — a staff-only annotation. The SELECT policy
 *      delegated wholesale to `current_user_can_access_thread()` with no
 *      predicate on the column, so the resident a note was written about could
 *      read it. Only `getMessages()` stood in the way, and migration 17 had
 *      just opened the write path that produces the data.
 *
 *   2. `ai_conversations` — scoped by `current_user_scope_profile_id()`, which
 *      resolves a child_* role to its GUARDIAN. Right for the flat and the
 *      ledger; wrong for a transcript of what one person typed. The UPDATE
 *      policy beside it already used `auth.uid()`, which is what gave it away.
 *
 *   3. Deactivation — three policies and two helpers resolved the caller with a
 *      bare `auth.uid()`, which `is_active` does not affect. A fired contractor
 *      kept reading every ticket and task assigned to them, on the same token.
 *      Measured before the fix: 24 tickets. After: 0.
 *
 * Restores everything it touches, including the contractor's active flag.
 * Usage: pnpm qa:reads
 */
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

const web = createRequire("D:/Azura World/apps/web/package.json")
const root = createRequire("D:/Azura World/package.json")
const { createClient } = web("@supabase/supabase-js")
const { Client } = root("pg")

const env = Object.fromEntries(
  readFileSync("D:/Azura World/.env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=")
      return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]
    })
)
const PASSWORD = readFileSync(
  "D:/Azura World/quality/manual/.seed-password",
  "utf8"
).trim()

const MARK = "[probe:leaks]"

async function as(email) {
  const c = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  const { data, error } = await c.auth.signInWithPassword({ email, password: PASSWORD })
  if (error !== null) throw new Error(`${email}: ${error.message}`)
  return { c, uid: data.user.id }
}

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

try {
  // --- seed one internal note on a thread the tenant participates in ------
  const thread = (
    await db.query(
      `select t.id, t.company_id from public.threads t
        where t.unit_id is not null order by t.id limit 1`
    )
  ).rows[0]
  const staff = (
    await db.query("select id from public.profiles where email='staff@azura.local'")
  ).rows[0]

  await db.query(
    `insert into public.messages
       (thread_id, company_id, sender_profile_id, sender_kind, body, channel, is_internal_note)
     values ($1,$2,$3,'user',$4,'portal',true)`,
    [thread.id, thread.company_id, staff.id, `${MARK} staff-only note about this resident`]
  )

  // --- seed one AI conversation owned by the GUARDIAN ---------------------
  const guardian = (
    await db.query("select id, company_id from public.profiles where email='tenant@azura.local'")
  ).rows[0]
  await db.query(
    `insert into public.ai_conversations (company_id, profile_id, role_at_time, surface, locale, running_summary)
     values ($1,$2,(select role from public.profiles where id=$2),'dashboard','en',$3)`,
    [guardian.company_id, guardian.id, `${MARK} guardian private chat`]
  )

  console.log("seeded 1 internal note and 1 guardian AI conversation\n")

  // === the assertions ====================================================
  {
    const { c } = await as("tenant@azura.local")
    const notes = await c.from("messages").select("id, body").eq("is_internal_note", true)
    check(
      "a resident CANNOT read a staff internal note",
      (notes.data ?? []).length === 0,
      `${(notes.data ?? []).length} row(s)`
    )
    const all = await c.from("messages").select("id").eq("thread_id", thread.id)
    check(
      "the resident can still read the thread's normal messages",
      (all.data ?? []).length > 0,
      `${(all.data ?? []).length} row(s)`
    )
  }
  {
    const { c } = await as("staff@azura.local")
    const notes = await c.from("messages").select("id").eq("is_internal_note", true)
    check(
      "staff CAN still read internal notes",
      (notes.data ?? []).length > 0,
      `${(notes.data ?? []).length} row(s)`
    )
  }
  {
    const { c } = await as("child_tenant@azura.local")
    const convos = await c.from("ai_conversations").select("id, running_summary")
    const guardians = (convos.data ?? []).filter((r) => String(r.running_summary).includes(MARK))
    check(
      "a child CANNOT read its guardian's AI conversation",
      guardians.length === 0,
      `${guardians.length} row(s)`
    )
  }
  {
    const { c } = await as("tenant@azura.local")
    const convos = await c.from("ai_conversations").select("id, running_summary")
    const own = (convos.data ?? []).filter((r) => String(r.running_summary).includes(MARK))
    check(
      "the guardian CAN still read their own AI conversation",
      own.length === 1,
      `${own.length} row(s)`
    )
  }

  // --- deactivation must revoke assignment-derived access ----------------
  {
    const contractor = (
      await db.query(
        "select id from public.profiles where email='service_provider@azura.local'"
      )
    ).rows[0]
    const before = await as("service_provider@azura.local")
    const seen = await before.c.from("service_tickets").select("id")
    const seenCount = (seen.data ?? []).length

    // prevent_profile_privilege_escalation refuses is_active changes unless
    // is_admin(), which is false on a raw connection. session_replication_role
    // is session-scoped and reverts when this connection closes, so a crash
    // cannot leave the trigger disabled for anyone else.
    await db.query("set session_replication_role = replica")
    await db.query("update public.profiles set is_active=false where id=$1", [contractor.id])
    await db.query("set session_replication_role = origin")
    // Same token, deactivated account.
    const after = await before.c.from("service_tickets").select("id")
    check(
      "a deactivated contractor loses assignment-derived ticket access",
      (after.data ?? []).length === 0,
      `${seenCount} -> ${(after.data ?? []).length} ticket(s) on the SAME token`
    )
    const tasks = await before.c.from("workforce_tasks").select("id")
    check(
      "…and loses their workforce tasks",
      (tasks.data ?? []).length === 0,
      `${(tasks.data ?? []).length} task(s)`
    )
    await db.query("set session_replication_role = replica")
    await db.query("update public.profiles set is_active=true where id=$1", [contractor.id])
    await db.query("set session_replication_role = origin")
  }
} finally {
  const removed = await db.query(
    `with m as (delete from public.messages where body like $1 returning 1),
          a as (delete from public.ai_conversations where running_summary like $1 returning 1)
     select (select count(*) from m) msgs, (select count(*) from a) convos`,
    [`%${MARK}%`]
  )
  const { msgs, convos } = removed.rows[0]
  console.log(`\ncleanup: removed ${msgs} message(s), ${convos} conversation(s)`)
  await db.end()
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`)
process.exitCode = failures === 0 ? 0 : 1
