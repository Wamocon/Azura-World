/**
 * Concurrency probe for the proposed activity-booking capacity mechanism.
 *
 *   Written by W3-E (night 2, N3), alongside `HANDOFF/W3-E-activity-capacity.sql`.
 *
 * `tasks/W3-E-modules-operations.md` requires capacity to be enforced at the
 * database and demands the race be tested "with true concurrency, not sequential
 * calls". This drives a real PostgreSQL server over N separate connections and
 * fires the bookings in one tick, so the contention is real and happens inside
 * the server rather than inside a mock.
 *
 * It applies the proposed migration to a THROWAWAY database. It never touches
 * the linked Supabase project, and it creates its own stub of the four objects
 * migration 15 depends on rather than requiring the other fourteen.
 *
 *   docker run -d --name azura-n3-capacity -e POSTGRES_PASSWORD="$PGPASSWORD" \
 *     -e POSTGRES_DB=probe -p 55433:5432 postgres:17-alpine
 *   PGPASSWORD=... node HANDOFF/W3-E-activity-capacity-probe.mjs
 *
 * The connection string carries no credential: `pg` reads PGPASSWORD from the
 * environment, and DATABASE_URL overrides the target entirely. Nothing that
 * looks like a secret belongs in a file this repository tracks, even a
 * throwaway one for a container that lives for a minute.
 *
 * Exit code is 0 only if every assertion passes.
 */

import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"
import pg from "pg"

const { Client } = pg

const DSN =
  process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55433/probe"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MIGRATION = path.join(HERE, "W3-E-activity-capacity.sql")

let passed = 0
let failed = 0

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1
    console.log(`PASS  ${label}${detail ? `  ${detail}` : ""}`)
  } else {
    failed += 1
    console.log(`FAIL  ${label}${detail ? `  ${detail}` : ""}`)
  }
}

/**
 * The objects migration 15 references that live in migrations 00-06. Stubbed
 * rather than replayed: this probe is about the capacity mechanism, and pulling
 * in RBAC, evidence and finance would make a failure here ambiguous.
 */
const PREREQUISITES = `
create extension if not exists pgcrypto;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'activity_status') then
    create type public.activity_status as enum
      ('draft','scheduled','open','full','in_progress','completed','cancelled');
  end if;
end $$;

create table if not exists public.companies (id uuid primary key default gen_random_uuid());
create table if not exists public.sites     (id uuid primary key default gen_random_uuid());
create table if not exists public.profiles  (id uuid primary key default gen_random_uuid());

create table if not exists public.activities (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  site_id     uuid not null references public.sites(id) on delete cascade,
  title       text not null,
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz not null default now(),
  capacity    integer,
  status      public.activity_status not null default 'open',
  constraint activities_capacity_positive check (capacity is null or capacity > 0)
);

create or replace function public.set_updated_at() returns trigger
language plpgsql as $fn$
begin new.updated_at = now(); return new; end $fn$;

-- Stubs. The probe runs as the owner, so RLS is not exercised here; these exist
-- only so the policy bodies in the migration compile.
create or replace function public.has_role_level(_level integer) returns boolean
language sql stable as $fn$ select true $fn$;
create or replace function public.current_user_scope_profile_id() returns uuid
language sql stable as $fn$ select null::uuid $fn$;
`

async function connect() {
  const client = new Client({ connectionString: DSN })
  await client.connect()
  return client
}

/** A fresh activity with the given capacity, plus `count` profiles to book it. */
async function fixture(admin, capacity, count) {
  const { rows: co } = await admin.query(
    "insert into public.companies default values returning id"
  )
  const { rows: si } = await admin.query(
    "insert into public.sites default values returning id"
  )
  const { rows: act } = await admin.query(
    `insert into public.activities (company_id, site_id, title, capacity)
     values ($1, $2, 'Sunrise Yoga', $3) returning id`,
    [co[0].id, si[0].id, capacity]
  )
  const profiles = []
  for (let i = 0; i < count; i += 1) {
    const { rows } = await admin.query(
      "insert into public.profiles default values returning id"
    )
    profiles.push(rows[0].id)
  }
  return { activityId: act[0].id, profileIds: profiles }
}

function reasonOf(result) {
  if (result.status === "fulfilled") return "ok"
  const message = String(result.reason?.message ?? result.reason)
  if (message.includes("activity_full")) return "activity_full"
  if (message.includes("duplicate key")) return "unique_violation"
  return message.slice(0, 80)
}

async function main() {
  console.log(`target: ${DSN.replace(/:[^:@/]*@/, ":***@")}\n`)

  const admin = await connect()
  await admin.query(PREREQUISITES)
  await admin.query(await readFile(MIGRATION, "utf8"))
  console.log("proposed migration applied\n")

  // -------------------------------------------------------------------------
  console.log("1. THE RACE — N genuinely concurrent bookings for the last seat")
  // -------------------------------------------------------------------------
  {
    const CONTENDERS = 8
    const { activityId, profileIds } = await fixture(admin, 5, CONTENDERS + 4)

    // Fill four of the five seats, sequentially, so exactly one is left.
    for (let i = 0; i < 4; i += 1) {
      await admin.query("select public.book_activity($1, $2, false)", [
        activityId,
        profileIds[i],
      ])
    }
    const { rows: before } = await admin.query(
      "select count(*)::int n from public.activity_bookings where activity_id=$1 and state='booked'",
      [activityId]
    )
    check("four seats taken, one free", before[0].n === 4, `booked=${before[0].n}`)

    // Eight separate connections. Not eight awaits on one connection: a single
    // connection serialises by construction and would prove nothing.
    const clients = await Promise.all(
      Array.from({ length: CONTENDERS }, () => connect())
    )
    const pids = await Promise.all(
      clients.map(async (c) => (await c.query("select pg_backend_pid() p")).rows[0].p)
    )
    check(
      "each contender is a distinct backend",
      new Set(pids).size === CONTENDERS,
      `pids=${new Set(pids).size}/${CONTENDERS}`
    )

    // An observer samples pg_stat_activity while the batch is in flight, so
    // "concurrent" is something measured rather than assumed.
    const observer = await connect()
    let maxConcurrent = 0
    const sampler = setInterval(async () => {
      try {
        const { rows } = await observer.query(
          `select count(*)::int n from pg_stat_activity
            where pid = any($1::int[]) and state <> 'idle'`,
          [pids]
        )
        maxConcurrent = Math.max(maxConcurrent, rows[0].n)
      } catch {
        /* sampling is best-effort; it must never fail the run */
      }
    }, 2)

    const started = Date.now()
    const results = await Promise.allSettled(
      clients.map((client, i) =>
        client.query("select public.book_activity($1, $2, false) as b", [
          activityId,
          profileIds[4 + i],
        ])
      )
    )
    const elapsed = Date.now() - started
    clearInterval(sampler)

    const reasons = results.map(reasonOf)
    const wins = reasons.filter((r) => r === "ok").length
    const clean = reasons.filter((r) => r === "activity_full").length
    const other = reasons.filter((r) => r !== "ok" && r !== "activity_full")

    check("exactly one booking succeeded", wins === 1, `wins=${wins}`)
    check(
      "every loser got a clean activity_full",
      clean === CONTENDERS - 1 && other.length === 0,
      `activity_full=${clean} other=${JSON.stringify(other)}`
    )
    check(
      "contenders overlapped in the server",
      maxConcurrent >= 2,
      `max simultaneously non-idle backends=${maxConcurrent}, elapsed=${elapsed}ms`
    )

    const { rows: after } = await admin.query(
      `select count(*)::int booked, count(distinct seat_no)::int seats, max(seat_no)::int top
         from public.activity_bookings where activity_id=$1 and state='booked'`,
      [activityId]
    )
    check(
      "capacity was never exceeded",
      after[0].booked === 5 && after[0].seats === 5 && after[0].top === 5,
      `booked=${after[0].booked} distinctSeats=${after[0].seats} maxSeat=${after[0].top}`
    )

    await Promise.all(clients.map((c) => c.end()))
    await observer.end()
  }

  // -------------------------------------------------------------------------
  console.log("\n2. The index enforces it even when the function is bypassed")
  // -------------------------------------------------------------------------
  {
    const { activityId, profileIds } = await fixture(admin, 3, 4)
    await admin.query("select public.book_activity($1,$2,false)", [
      activityId,
      profileIds[0],
    ])
    const { rows: co } = await admin.query(
      "select company_id from public.activities where id=$1",
      [activityId]
    )
    // Two raw INSERTs, neither taking the advisory lock, both claiming seat 2.
    const a = await connect()
    const b = await connect()
    const raw = (client, profileId) =>
      client.query(
        `insert into public.activity_bookings
           (company_id, activity_id, profile_id, state, seat_no)
         values ($1,$2,$3,'booked',2)`,
        [co[0].company_id, activityId, profileId]
      )
    const results = await Promise.allSettled([
      raw(a, profileIds[1]),
      raw(b, profileIds[2]),
    ])
    const reasons = results.map(reasonOf)
    check(
      "two direct inserts for one seat: one wins, one unique_violation",
      reasons.filter((r) => r === "ok").length === 1 &&
        reasons.filter((r) => r === "unique_violation").length === 1,
      JSON.stringify(reasons)
    )
    await a.end()
    await b.end()
  }

  // -------------------------------------------------------------------------
  console.log("\n3. Cancellation frees the seat, and the next booking reuses it")
  // -------------------------------------------------------------------------
  {
    const { activityId, profileIds } = await fixture(admin, 5, 7)
    const ids = []
    for (let i = 0; i < 5; i += 1) {
      const { rows } = await admin.query(
        "select (public.book_activity($1,$2,false)).id as id",
        [activityId, profileIds[i]]
      )
      ids.push(rows[0].id)
    }
    await admin.query("select public.cancel_activity_booking($1)", [ids[1]])
    const { rows } = await admin.query(
      "select (public.book_activity($1,$2,false)).seat_no as seat",
      [activityId, profileIds[5]]
    )
    check(
      "the freed seat 2 is reissued, not seat 6",
      rows[0].seat === 2,
      `seat_no=${rows[0].seat}`
    )
  }

  // -------------------------------------------------------------------------
  console.log("\n4. Waitlist, and audited promotion on cancellation")
  // -------------------------------------------------------------------------
  {
    const { activityId, profileIds } = await fixture(admin, 2, 6)
    const booked = []
    for (let i = 0; i < 2; i += 1) {
      const { rows } = await admin.query(
        "select (public.book_activity($1,$2,true)).id as id",
        [activityId, profileIds[i]]
      )
      booked.push(rows[0].id)
    }
    const waitIds = []
    for (let i = 2; i < 5; i += 1) {
      const { rows } = await admin.query(
        "select (public.book_activity($1,$2,true)).* ",
        [activityId, profileIds[i]]
      )
      waitIds.push(rows[0])
    }
    check(
      "over-capacity bookings are waitlisted 1,2,3 — not rejected",
      waitIds.every((r) => r.state === "waitlisted") &&
        waitIds.map((r) => r.waitlist_no).join(",") === "1,2,3",
      waitIds.map((r) => `${r.state}#${r.waitlist_no}`).join(" ")
    )

    await admin.query("select public.cancel_activity_booking($1)", [booked[0]])
    const { rows: promoted } = await admin.query(
      `select state, seat_no, promoted_at is not null as flagged
         from public.activity_bookings where id=$1`,
      [waitIds[0].id]
    )
    check(
      "head of the waitlist is promoted into the freed seat",
      promoted[0].state === "booked" &&
        promoted[0].seat_no === 1 &&
        promoted[0].flagged === true,
      `state=${promoted[0].state} seat=${promoted[0].seat_no}`
    )
    const { rows: audit } = await admin.query(
      `select kind from public.activity_booking_events
        where booking_id=$1 order by created_at`,
      [waitIds[0].id]
    )
    check(
      "the promotion is audited",
      audit.map((r) => r.kind).join(",") === "waitlisted,promoted",
      audit.map((r) => r.kind).join(",")
    )
    let appendOnly = false
    try {
      await admin.query("delete from public.activity_booking_events")
    } catch (error) {
      appendOnly = String(error.message).includes("append-only")
    }
    check("the audit trail cannot be deleted", appendOnly)
  }

  // -------------------------------------------------------------------------
  console.log("\n5. Uncapped is uncapped, not zero")
  // -------------------------------------------------------------------------
  {
    const { activityId, profileIds } = await fixture(admin, null, 20)
    const clients = await Promise.all(
      Array.from({ length: 20 }, () => connect())
    )
    const results = await Promise.allSettled(
      clients.map((c, i) =>
        c.query("select public.book_activity($1,$2,false)", [
          activityId,
          profileIds[i],
        ])
      )
    )
    check(
      "20 concurrent bookings on an uncapped activity all succeed",
      results.every((r) => r.status === "fulfilled"),
      `ok=${results.filter((r) => r.status === "fulfilled").length}/20`
    )
    await Promise.all(clients.map((c) => c.end()))

    let rejectedZero = false
    try {
      const { rows: co } = await admin.query(
        "insert into public.companies default values returning id"
      )
      const { rows: si } = await admin.query(
        "insert into public.sites default values returning id"
      )
      await admin.query(
        "insert into public.activities (company_id,site_id,title,capacity) values ($1,$2,'x',0)",
        [co[0].id, si[0].id]
      )
    } catch (error) {
      rejectedZero = String(error.message).includes("capacity_positive")
    }
    check("capacity 0 is rejected by the CHECK, not stored", rejectedZero)
  }

  // -------------------------------------------------------------------------
  console.log("\n6. One live booking per person")
  // -------------------------------------------------------------------------
  {
    const { activityId, profileIds } = await fixture(admin, 5, 2)
    await admin.query("select public.book_activity($1,$2,false)", [
      activityId,
      profileIds[0],
    ])
    let blocked = false
    try {
      await admin.query("select public.book_activity($1,$2,false)", [
        activityId,
        profileIds[0],
      ])
    } catch (error) {
      blocked = String(error.message).includes("duplicate key")
    }
    check("the same profile cannot hold two live bookings", blocked)
  }

  await admin.end()

  console.log(`\n${passed} pass · ${failed} fail`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error("PROBE ABORTED:", error.message)
  process.exit(2)
})
