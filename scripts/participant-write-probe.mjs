/**
 * participant-write-probe — the two resident write paths, proved at the database.
 *
 * ## Why this exists
 *
 * Migration 17 opened exactly two writes to people below staff: a resident may
 * reply in a thread they can read, and may open a ticket about their own home.
 * Both are narrow, and the narrowness is the product decision — a resident who
 * could post as `system`, forge another sender, pre-assign a contractor or
 * attach a cost would be able to fabricate the record this whole product exists
 * to keep honest.
 *
 * None of that is checkable by reading TypeScript. The boundary is eleven row
 * policies in Postgres, and the failure mode is silent in both directions: a
 * missing GRANT makes every write fail as 42501 (which is how migration 16 was
 * found — the ticket queue had been inert for the entire project), and a policy
 * one clause too loose makes a forbidden write succeed with no visible symptom
 * at all.
 *
 * So this signs in for real — anon key plus password, the same path a browser
 * takes, with RLS fully in force — and attempts each write. Eleven assertions,
 * five of which must FAIL to pass.
 *
 * ## Reading a failure
 *
 * `want=ALLOWED got=REFUSED (42501)` means a legitimate action is blocked:
 * either the GRANT is missing or the policy is too tight. Check the table
 * privileges first; a policy cannot be evaluated at all until the table-level
 * privilege exists.
 *
 * `want=REFUSED got=ALLOWED` is the serious direction. A guard that used to
 * hold has been dropped, and the product is now accepting fabricated records.
 *
 * ## It cleans up after itself
 *
 * Every row it writes is deleted in a `finally`, matched on the marker below.
 * A probe that leaves debris behind gets switched off after the third time
 * somebody finds its rows in a demo.
 *
 * Usage:  pnpm qa:writes
 * Needs:  .env.local (anon key + SUPABASE_DB_URL) and quality/manual/.seed-password
 */
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(new URL("../apps/web/package.json", import.meta.url))
const { createClient } = require("@supabase/supabase-js")
const { Client } = createRequire(new URL("../package.json", import.meta.url))("pg")

/** Every row this probe writes carries it, and the cleanup matches on it. */
const MARKER = "[probe:participant-write]"

// `fileURLToPath`, never `url.pathname`: this repository lives in a directory
// with a space in its name, and `.pathname` hands back `D:/Azura%20World`.
const root = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "")

function readEnv() {
  return Object.fromEntries(
    readFileSync(`${root}/.env.local`, "utf8")
      .split(/\r?\n/)
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => {
        const i = line.indexOf("=")
        return [line.slice(0, i), line.slice(i + 1).replace(/^["']|["']$/g, "")]
      })
  )
}

const env = readEnv()
const password = readFileSync(`${root}/quality/manual/.seed-password`, "utf8").trim()

if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.log("participant-write-probe — SKIPPED, Supabase is not configured")
  process.exit(0)
}

let failures = 0
let checks = 0

function check(label, expected, error) {
  checks += 1
  const got = error === null || error === undefined ? "ALLOWED" : "REFUSED"
  const code = error?.code ? ` (${error.code})` : ""
  const ok = got === expected
  if (!ok) failures += 1
  console.log(
    `${ok ? "pass" : "FAIL"}  ${label.padEnd(56)} want=${expected.padEnd(7)} got=${got}${code}`
  )
  if (!ok && error) console.log(`        ${error.message}`)
}

async function signIn(email) {
  const client = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error !== null) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  return { client, profileId: data.user.id }
}

/** A ticket_no this probe owns. Nine digits keeps it clear of the TCK-1xxx seeds. */
const ticketNo = () => `TCK-9${String(Math.floor(Math.random() * 100000)).padStart(5, "0")}`

console.log("participant-write-probe — migration 17 (resident write paths)\n")

try {
  // --- a resident replies -------------------------------------------------
  {
    const { client, profileId } = await signIn("tenant@azura.local")
    const { data: threads } = await client
      .from("threads")
      .select("id, company_id")
      .limit(1)
    const thread = threads?.[0]

    if (thread === undefined) {
      console.log("SKIP  the tenant can see no thread to reply in")
    } else {
      const base = {
        thread_id: thread.id,
        company_id: thread.company_id,
        sender_profile_id: profileId,
        sender_kind: "user",
        body: `${MARKER} a tenant replying in their own thread`,
      }
      check(
        "tenant replies in a thread they can read",
        "ALLOWED",
        (await client.from("messages").insert(base)).error
      )
      check(
        "tenant cannot post as sender_kind=system",
        "REFUSED",
        (await client.from("messages").insert({ ...base, sender_kind: "system" })).error
      )
      check(
        "tenant cannot write a staff-only internal note",
        "REFUSED",
        (await client.from("messages").insert({ ...base, is_internal_note: true })).error
      )
      check(
        "tenant cannot post as somebody else",
        "REFUSED",
        (
          await client.from("messages").insert({
            ...base,
            sender_profile_id: "00000000-0000-4000-8000-000000000000",
          })
        ).error
      )
    }
  }

  // --- a resident opens a ticket ------------------------------------------
  {
    const { client, profileId } = await signIn("tenant@azura.local")
    const { data: profile } = await client
      .from("profiles")
      .select("company_id")
      .eq("id", profileId)
      .maybeSingle()

    // The home they HOLD, not one they can merely see. A tenant can read other
    // flats in the block; the insert policy is deliberately narrower than the
    // select policy, and conflating the two reports a false failure here.
    const { data: held } = await client.rpc("current_user_unit_ids")
    const heldUnitId = Array.isArray(held) ? held[0] : null
    const { data: units } = await client
      .from("units")
      .select("id, site_id")
      .eq("id", heldUnitId ?? "")
      .maybeSingle()

    if (profile == null || units == null) {
      console.log("SKIP  the tenant holds no unit")
    } else {
      const base = {
        company_id: profile.company_id,
        site_id: units.site_id,
        unit_id: units.id,
        title: `${MARKER} tenant-filed request`,
        category: "maintenance",
        priority: "normal",
        severity: "moderate",
        status: "open",
        requester_profile_id: profileId,
      }
      check(
        "tenant opens an untriaged ticket on their own home",
        "ALLOWED",
        (await client.from("service_tickets").insert({ ...base, ticket_no: ticketNo() })).error
      )
      check(
        "tenant cannot file a ticket that is already resolved",
        "REFUSED",
        (
          await client
            .from("service_tickets")
            .insert({ ...base, ticket_no: ticketNo(), status: "resolved" })
        ).error
      )
      check(
        "tenant cannot pre-assign the work to someone",
        "REFUSED",
        (
          await client.from("service_tickets").insert({
            ...base,
            ticket_no: ticketNo(),
            assignee_profile_id: profileId,
          })
        ).error
      )
      check(
        "tenant cannot commit money by attaching a cost",
        "REFUSED",
        (
          await client.from("service_tickets").insert({
            ...base,
            ticket_no: ticketNo(),
            estimated_cost: 5000,
            currency: "EUR",
          })
        ).error
      )
    }
  }

  // --- a guest has no standing to open work -------------------------------
  {
    const { client, profileId } = await signIn("guest@azura.local")
    const { data: profile } = await client
      .from("profiles")
      .select("company_id")
      .eq("id", profileId)
      .maybeSingle()
    const { data: site } = await client.from("sites").select("id").limit(1).maybeSingle()
    check(
      "guest cannot open a ticket at all",
      "REFUSED",
      (
        await client.from("service_tickets").insert({
          company_id: profile?.company_id ?? "00000000-0000-4000-8000-000000000000",
          site_id: site?.id ?? "00000000-0000-4000-8000-000000000000",
          unit_id: null,
          ticket_no: ticketNo(),
          title: `${MARKER} a guest should not reach this`,
          category: "other",
          priority: "normal",
          status: "open",
          requester_profile_id: profileId,
        })
      ).error
    )
  }

  // --- staff keep the powers the resident policies must not have taken ----
  {
    const { client, profileId } = await signIn("manager@azura.local")
    const { data: profile } = await client
      .from("profiles")
      .select("company_id")
      .eq("id", profileId)
      .maybeSingle()
    const { data: threads } = await client
      .from("threads")
      .select("id, company_id")
      .limit(1)
    const { data: site } = await client.from("sites").select("id").limit(1).maybeSingle()

    if (threads?.[0]) {
      check(
        "manager can still write an internal note",
        "ALLOWED",
        (
          await client.from("messages").insert({
            thread_id: threads[0].id,
            company_id: threads[0].company_id,
            sender_profile_id: profileId,
            sender_kind: "user",
            body: `${MARKER} staff internal note`,
            is_internal_note: true,
          })
        ).error
      )
    }
    check(
      "manager can open a common-area ticket",
      "ALLOWED",
      (
        await client.from("service_tickets").insert({
          company_id: profile.company_id,
          site_id: site.id,
          unit_id: null,
          ticket_no: ticketNo(),
          title: `${MARKER} manager-filed common-area ticket`,
          category: "maintenance",
          priority: "normal",
          status: "open",
          requester_profile_id: profileId,
        })
      ).error
    )
  }
} finally {
  // Service-role cleanup, matched on the marker. Runs even if an assertion
  // above threw, because rows left behind are worse than a missing result.
  if (env.SUPABASE_DB_URL) {
    const db = new Client({
      connectionString: env.SUPABASE_DB_URL,
      ssl: { rejectUnauthorized: false },
    })
    await db.connect()
    const removed = await db.query(
      `with m as (delete from public.messages where body like $1 returning 1),
            t as (delete from public.service_tickets where title like $1 returning 1)
       select (select count(*) from m) msgs, (select count(*) from t) tickets`,
      [`%${MARKER}%`]
    )
    const { msgs, tickets } = removed.rows[0]
    console.log(`\ncleanup: removed ${msgs} message(s) and ${tickets} ticket(s)`)
    await db.end()
  } else {
    console.log("\ncleanup: SKIPPED — no SUPABASE_DB_URL; probe rows remain")
  }
}

console.log(
  failures === 0
    ? `\nPASS — ${checks} checks, 0 failures`
    : `\nFAIL — ${failures} of ${checks} checks failed`
)
process.exit(failures === 0 ? 0 : 1)
