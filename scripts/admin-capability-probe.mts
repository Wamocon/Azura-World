/**
 * The admin-capability probe.                            Owner: W3-H / N5
 *
 *   node --experimental-strip-types --import ./scripts/register-ts-resolve.mjs \
 *        scripts/admin-capability-probe.mts
 *
 * W-UX §5 asks for an administrator who can run the system without a developer,
 * behind exactly two guards: the last active admin cannot be removed, and
 * self-elevation is recorded rather than blocked.
 *
 * Both guards live in Postgres (`supabase/migrations/00000000000015_admin_
 * capability.sql`). `lib/admin-capability.ts` mirrors them so the administrator
 * reads a sentence instead of SQLSTATE AZLAD, and a mirror is only safe while
 * the two copies cannot disagree about the outcome. This probe is what holds the
 * mirror to the original: every case below is written from the trigger's clauses,
 * and a change to either side that breaks the correspondence fails here.
 *
 * ## What this proves and what it does not
 *
 * It proves the DECISION. It does not touch a database, so it does not prove
 * that Postgres reaches the same decision — that needs a live instance and
 * §"not run" in HANDOFF/W3-H.md says so plainly rather than implying otherwise.
 * The trigger and this file were written from the same table of cases, which
 * makes agreement likely and does not make it verified.
 *
 * The case that matters most is the last one: an admin demoting themselves when
 * they are the only admin. That single row is both the actor and the subject and
 * both guards have an opinion about it, so it is the one place they could
 * contradict each other.
 */

import {
  classifyAuthorityChange,
  lastAdminVerdict,
  mapProfileWriteError,
  type AdminPopulationRow,
  type AuthorityState,
} from "../apps/web/lib/admin-capability-rules.ts"

const lines: string[] = []
let pass = 0
let fail = 0

function check(ok: boolean, label: string, detail: string): void {
  if (ok) pass += 1
  else fail += 1
  lines.push(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(44)} ${detail}`)
}

const COMPANY = "11111111-1111-4111-8111-111111111111"
const OTHER_COMPANY = "22222222-2222-4222-8222-222222222222"

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const CARLA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

function admin(id: string, companyId: string | null = COMPANY): AdminPopulationRow {
  return { id, role: "admin", isActive: true, companyId }
}

function state(
  role: AuthorityState["role"],
  isActive = true,
  companyId: string | null = COMPANY
): AuthorityState {
  return { role, isActive, companyId }
}

// ---------------------------------------------------------------------------
lines.push("== 1. The last administrator cannot leave the admin population ==")
// ---------------------------------------------------------------------------

const soleAdmin = [admin(ALICE)]

check(
  lastAdminVerdict({
    population: soleAdmin,
    subjectId: ALICE,
    before: state("admin"),
    after: state("manager"),
  }).outcome === "would_orphan_company",
  "demote the only admin",
  "refused — nobody would be able to manage users afterwards"
)

check(
  lastAdminVerdict({
    population: soleAdmin,
    subjectId: ALICE,
    before: state("admin"),
    after: state("admin", false),
  }).outcome === "would_orphan_company",
  "deactivate the only admin",
  "refused — an inactive admin resolves no authority (current_user_role)"
)

check(
  lastAdminVerdict({
    population: soleAdmin,
    subjectId: ALICE,
    before: state("admin"),
    after: null,
  }).outcome === "would_orphan_company",
  "delete the only admin",
  "refused — DELETE is `after === null`"
)

check(
  lastAdminVerdict({
    population: soleAdmin,
    subjectId: ALICE,
    before: state("admin"),
    after: state("admin", true, OTHER_COMPANY),
  }).outcome === "would_orphan_company",
  "move the only admin to another company",
  "refused — still an admin, but not of the company it just left"
)

// ---------------------------------------------------------------------------
lines.push("")
lines.push("== 2. With a second administrator, every one of those is allowed ==")
// ---------------------------------------------------------------------------

const twoAdmins = [admin(ALICE), admin(BOB)]

for (const [label, after] of [
  ["demote", state("manager")],
  ["deactivate", state("admin", false)],
  ["delete", null],
  ["move company", state("admin", true, OTHER_COMPANY)],
] as const) {
  const verdict = lastAdminVerdict({
    population: twoAdmins,
    subjectId: ALICE,
    before: state("admin"),
    after,
  })
  check(
    verdict.allowed && verdict.outcome === "another_admin_remains",
    `${label} one of two admins`,
    `allowed — ${verdict.remainingElsewhere} other active admin remains`
  )
}

// ---------------------------------------------------------------------------
lines.push("")
lines.push("== 3. The guard is per company, which is STRICTER than global ==")
// ---------------------------------------------------------------------------

// Two admins exist, but in different companies. A global count would say "one
// other admin remains" and allow it; company A would then have nobody.
check(
  lastAdminVerdict({
    population: [admin(ALICE, COMPANY), admin(BOB, OTHER_COMPANY)],
    subjectId: ALICE,
    before: state("admin", true, COMPANY),
    after: state("manager", true, COMPANY),
  }).outcome === "would_orphan_company",
  "sole admin of company A, B has its own",
  "refused — a global count would have allowed this and orphaned company A"
)

// NULL company is a bucket, not a hole. `is not distinct from` in SQL,
// `a === null && b === null` in TypeScript — a bare === would call two NULL
// companies different and the guard would never fire for platform-level admins.
check(
  lastAdminVerdict({
    population: [admin(ALICE, null)],
    subjectId: ALICE,
    before: state("admin", true, null),
    after: state("manager", true, null),
  }).outcome === "would_orphan_company",
  "sole platform-level admin (company NULL)",
  "refused — NULL groups with NULL"
)

check(
  lastAdminVerdict({
    population: [admin(ALICE, null), admin(BOB, COMPANY)],
    subjectId: ALICE,
    before: state("admin", true, null),
    after: state("manager", true, null),
  }).outcome === "would_orphan_company",
  "platform admin, a company admin exists",
  "refused — NULL does not group with a real company id"
)

// ---------------------------------------------------------------------------
lines.push("")
lines.push("== 4. Changes that do not touch the admin population ==")
// ---------------------------------------------------------------------------

check(
  lastAdminVerdict({
    population: soleAdmin,
    subjectId: BOB,
    before: state("manager"),
    after: state("staff"),
  }).outcome === "not_an_admin",
  "demote a manager",
  "allowed — the subject was never in the population"
)

check(
  lastAdminVerdict({
    population: soleAdmin,
    subjectId: ALICE,
    before: state("admin"),
    after: state("admin"),
  }).outcome === "population_unchanged",
  "no-op on the only admin",
  "allowed — still an active admin of the same company"
)

check(
  lastAdminVerdict({
    population: [{ id: BOB, role: "admin", isActive: false, companyId: COMPANY }],
    subjectId: BOB,
    before: state("admin", false),
    after: state("manager", false),
  }).outcome === "not_an_admin",
  "demote an already-inactive admin",
  "allowed — an inactive admin was not holding the company up"
)

// An inactive admin does NOT count as cover for removing the active one.
check(
  lastAdminVerdict({
    population: [
      admin(ALICE),
      { id: BOB, role: "admin", isActive: false, companyId: COMPANY },
    ],
    subjectId: ALICE,
    before: state("admin"),
    after: state("manager"),
  }).outcome === "would_orphan_company",
  "sole ACTIVE admin, one inactive admin",
  "refused — a deactivated account resolves no authority, so it is not cover"
)

// ---------------------------------------------------------------------------
lines.push("")
lines.push("== 5. Self-elevation is RECORDED, never refused (W-UX §5 guard 2) ==")
// ---------------------------------------------------------------------------

const selfUp = classifyAuthorityChange({
  actorId: BOB,
  subjectId: BOB,
  before: state("manager"),
  after: state("admin"),
})
check(
  selfUp.isSelfElevation && selfUp.actorIsSubject,
  "manager raises self to admin",
  `flagged — level ${selfUp.roleLevelBefore} to ${selfUp.roleLevelAfter}, and NOT blocked`
)

const selfDown = classifyAuthorityChange({
  actorId: ALICE,
  subjectId: ALICE,
  before: state("admin"),
  after: state("manager"),
})
check(
  !selfDown.isSelfElevation && selfDown.actorIsSubject && selfDown.isAuthorityChange,
  "admin steps down voluntarily",
  "recorded as authority_changed, not flagged — a demotion is not the event"
)

const other = classifyAuthorityChange({
  actorId: ALICE,
  subjectId: CARLA,
  before: state("staff"),
  after: state("admin"),
})
check(
  !other.isSelfElevation && !other.actorIsSubject && other.isAuthorityChange,
  "admin promotes somebody else to admin",
  "recorded, not flagged — this is the ordinary case W-UX §5 requires to work"
)

const anonymous = classifyAuthorityChange({
  actorId: null,
  subjectId: CARLA,
  before: state("staff"),
  after: state("admin"),
})
check(
  !anonymous.isSelfElevation && !anonymous.actorIsSubject,
  "actor unknown (service context, auth.uid() NULL)",
  "not flagged as self-elevation — an absent actor is not the subject"
)

const noChange = classifyAuthorityChange({
  actorId: ALICE,
  subjectId: CARLA,
  before: state("staff"),
  after: state("staff"),
})
check(
  !noChange.isAuthorityChange,
  "no authority column moved",
  "no audit row — the trigger returns early on exactly this condition"
)

const activationOnly = classifyAuthorityChange({
  actorId: ALICE,
  subjectId: CARLA,
  before: state("staff", true),
  after: state("staff", false),
})
check(
  activationOnly.isAuthorityChange && !activationOnly.isSelfElevation,
  "deactivation with no role change",
  "recorded — is_active is an authority column, not a detail"
)

// ---------------------------------------------------------------------------
lines.push("")
lines.push("== 6. The interesting one: the sole admin demoting THEMSELVES ==")
// ---------------------------------------------------------------------------

// Both guards have an opinion about this row and they must not contradict each
// other. Guard 1 refuses it. Guard 2 would not have flagged it anyway, because
// it is a demotion. The refusal is guard 1's and it is the one that fires.
const soleSelfDemote = lastAdminVerdict({
  population: soleAdmin,
  subjectId: ALICE,
  before: state("admin"),
  after: state("manager"),
})
const soleSelfClass = classifyAuthorityChange({
  actorId: ALICE,
  subjectId: ALICE,
  before: state("admin"),
  after: state("manager"),
})
check(
  !soleSelfDemote.allowed && !soleSelfClass.isSelfElevation,
  "sole admin demotes themselves",
  "guard 1 refuses; guard 2 has no opinion. No contradiction."
)

// And the mirror image: the sole admin RAISING themselves is impossible to
// reach — they are already admin, which is the top level — so there is no case
// where guard 1 allows a self-elevation that empties the population.
const soleSelfElevate = classifyAuthorityChange({
  actorId: ALICE,
  subjectId: ALICE,
  before: state("admin"),
  after: state("admin"),
})
check(
  !soleSelfElevate.isSelfElevation && !soleSelfElevate.isAuthorityChange,
  "sole admin 'elevates' themselves to admin",
  "no change, no flag — admin is the top level, there is nowhere to go"
)

// ---------------------------------------------------------------------------
lines.push("")
lines.push("== 7. Postgres outcomes become sentences, never SQLSTATEs ==")
// ---------------------------------------------------------------------------

const cases: Array<[string, string, string]> = [
  ["AZLAD", "conflict", "last active administrator"],
  ["23503", "conflict", "has already acted"],
  ["42501", "forbidden", "Only an administrator"],
  ["23505", "conflict", "already exists"],
  ["08006", "upstream_failed", "Nothing was saved"],
]

for (const [code, expectedCode, fragment] of cases) {
  const mapped = mapProfileWriteError({ code })
  check(
    mapped.code === expectedCode && mapped.message.includes(fragment),
    `SQLSTATE ${code}`,
    `${mapped.code} — "${mapped.message.slice(0, 52)}…"`
  )
}

// No Postgres text reaches the caller, whatever the driver hands us.
const hostile = mapProfileWriteError({
  code: "23503",
  message:
    'insert or update on table "audit_events" violates foreign key constraint "audit_events_actor_profile_id_fkey"',
  details: "Key (actor_profile_id)=(aaaaaaaa-…) is still referenced.",
})
check(
  !hostile.message.includes("audit_events") &&
    !hostile.message.includes("constraint") &&
    !hostile.message.includes("aaaaaaaa"),
  "driver message is discarded entirely",
  "no table name, no constraint name, no key value in the answer"
)

// An error object with no code at all — a network failure, a thrown string, an
// undefined. Fails closed to "nothing was saved" rather than to a success.
for (const [label, value] of [
  ["null", null],
  ["undefined", undefined],
  ["a string", "boom"],
  ["an empty object", {}],
  ["a numeric code", { code: 500 }],
] as const) {
  const mapped = mapProfileWriteError(value)
  check(
    mapped.code === "upstream_failed" && mapped.message.includes("Nothing was saved"),
    `unrecognised error: ${label}`,
    "falls back to 'Nothing was saved', never to a success"
  )
}

// ---------------------------------------------------------------------------
lines.push("")
lines.push("== 8. No em dash in any message a user can see (W-UX §3) ==")
// ---------------------------------------------------------------------------

for (const code of ["AZLAD", "23503", "42501", "23505", "08006"]) {
  const message = mapProfileWriteError({ code }).message
  check(
    !message.includes("—") && !message.includes("–"),
    `no dash in the ${code} message`,
    `${message.length} chars, clean`
  )
}

// ---------------------------------------------------------------------------

console.log(lines.join("\n"))
console.log("")
console.log(
  fail === 0 ? `OK ${pass} pass · 0 fail` : `FAILED ${pass} pass · ${fail} fail`
)
process.exit(fail === 0 ? 0 : 1)
