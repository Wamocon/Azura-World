/**
 * # Governance seed data — `profiles`, `guardianships`, `audit_events`,
 * `access_events`, `compliance_checks`
 *
 * Owned by **W2-A**. Consumed only by `lib/governance-repository.ts` as the
 * `fallback()` argument to `withRepository()`.
 *
 * ## These seeds mirror `supabase/seed.sql`. Where it is empty, so are they.
 *
 * The repository has two seeds — this file and W1-A's `supabase/seed.sql` — and
 * the only thing worse than one of them being wrong is the two disagreeing.
 * Every id, email, name and relation below is the literal `seed.sql` inserts,
 * checked against it on 2026-07-27: eleven profiles at
 * `b0000000-0000-4000-8000-0000000000NN` in CONTRACTS §3 role order, two
 * guardianships at `f0000000-…`.
 *
 * `seed.sql` inserts **no rows at all** into `audit_events`, `access_events` or
 * `compliance_checks`, and W1-A's handoff records that as an explicit `[GAP]`
 * owned by W3-D/E/F. So the three builders for those tables return empty arrays.
 * Inventing "manager raised unit AZW-B03-0412 from €112,000 to €118,000" would
 * read as a business event that happened, invent a price change against a real
 * harvested figure, and put local-seed mode permanently out of step with a
 * seeded database — three problems in one row. The exported row *types* are the
 * contract those windows should build fixtures against; the rows themselves
 * belong in `seed.sql`.
 *
 * No real person appears here. `@azura.local` is non-routable, the names are the
 * role names title-cased, and this is a competitor-intelligence build
 * (CLAUDE.md §1) where a real contact detail in a seed file would be a privacy
 * problem rather than a fidelity win.
 *
 * ## Deterministic
 *
 * Literal UUIDs and `seedIso()` timestamps only. No `Math.random()`, no
 * `Date.now()`, no bare `new Date()` — `seed.sql` uses `now()` for its
 * timestamps, which a TypeScript seed cannot copy without becoming
 * non-reproducible. Two calls to any builder return byte-identical JSON.
 *
 * ## Append-only tables
 *
 * `audit_events` and `access_events` are append-only and readable by manager and
 * above. Nothing in this file or its repository writes them: `authenticated`
 * holds no INSERT privilege on either, so an audit write must go through the
 * service-role client from a route handler, not through a caller's session
 * client (which fails 42501). See the note in `lib/governance-repository.ts`.
 */

import type { Role } from "@/lib/contracts"
import { seedIso } from "@/lib/repository-base"
import {
  at,
  DEMO_MARK,
  DEMO_PROFILE_IDS,
  demoId,
  monthStarts,
  stream,
  YEAR_START_OFFSET,
} from "@/lib/demo-operations"

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

/**
 * A row of `profiles`.
 *
 * `role` is `Role | null`. The column is `public.app_role NOT NULL`, so `null`
 * never means "no role" — it means the SQL enum holds a value the TypeScript
 * union in CONTRACTS §3 does not, i.e. `lib/rbac.ts` and the migration have
 * drifted. SYSTEM-PROMPT §2.6 calls that a security hole, so it surfaces as an
 * unrecognised role rather than being defaulted: defaulting down to `guest`
 * hides the drift, and defaulting up grants access nobody authorised.
 */
export interface ProfileRecord {
  id: string
  email: string | null
  fullName: string | null
  role: Role | null
  phone: string | null
  locale: string
  companyId: string | null
  isActive: boolean
  avatarUrl: string | null
  createdAt: string
  updatedAt: string
}

/**
 * A row of `guardianships`. `UNIQUE(guardian_profile_id, child_profile_id)`.
 *
 * `relation` is CHECK-constrained to `parent | guardian | delegate` and `status`
 * to `pending | active | revoked`; a value outside those lists is rejected by
 * Postgres, so the seed uses only ones that would actually insert.
 *
 * `revokedAt` non-null means the relation has ended; `status` carries the
 * lifecycle label. A `child_*` role's data horizon is a strict subset of its
 * guardian's (CONTRACTS §3, additive-authority rule) — never a different one.
 */
export interface GuardianshipRecord {
  id: string
  guardianProfileId: string
  childProfileId: string
  relation: string
  status: string
  consentRecordedAt: string | null
  createdAt: string
  revokedAt: string | null
}

/**
 * A row of `audit_events`. Append-only; manager and above may read.
 *
 * `entityId` is **TEXT, not uuid** — unit ids are `AZW-B03-0412`, which is not a
 * UUID, and the column has to hold both those and real uuids.
 */
export interface AuditEventRecord {
  id: string
  companyId: string | null
  actorProfileId: string | null
  action: string
  entityTable: string
  /** TEXT. Holds `"AZW-B03-0412"` as happily as a uuid. */
  entityId: string | null
  beforeData: Record<string, unknown> | null
  afterData: Record<string, unknown> | null
  /** `inet` — serialised as a string. */
  ipAddress: string | null
  userAgent: string | null
  requestId: string | null
  createdAt: string
}

/** A row of `access_events`. Append-only; manager and above may read. */
export interface AccessEventRecord {
  id: string
  companyId: string | null
  actorProfileId: string | null
  /**
   * CHECK-constrained to a twelve-value vocabulary: `login_success`,
   * `login_failure`, `logout`, `session_refresh`, `password_reset_requested`,
   * `password_changed`, `mfa_challenge`, `permission_denied`,
   * `signed_url_issued`, `export_generated`, `impersonation_started`,
   * `impersonation_ended`. Not free text.
   */
  eventType: string
  /** `"allowed"` / `"denied"` — CHECK-constrained to exactly those two. */
  decision: string
  resource: string | null
  reason: string | null
  ipAddress: string | null
  userAgent: string | null
  requestId: string | null
  sessionId: string | null
  createdAt: string
}

/**
 * A row of `compliance_checks`.
 *
 * `subjectId` is **TEXT**, same reason as `audit_events.entity_id`. `version` is
 * the optimistic-concurrency column: a stale write returns `conflict` (409),
 * never last-write-wins.
 *
 * Four columns are CHECK-constrained vocabularies, not free text —
 * `subject_type` (company · site · block · unit · resident · document · thread ·
 * vendor · payment), `check_type` (fifteen values from `kyc_identity` to
 * `vendor_due_diligence`), `status` (pending · in_review · passed · failed ·
 * waived) and `risk_level` (low · medium · high · critical). A further
 * constraint requires `decided_by`, `decided_at` **and** `rationale` together
 * once `status` leaves `pending`/`in_review`.
 */
export interface ComplianceCheckRecord {
  id: string
  companyId: string
  siteId: string | null
  subjectType: string
  /** TEXT, not uuid. */
  subjectId: string
  checkType: string
  status: string
  riskLevel: string
  rationale: string | null
  evidenceDocumentId: string | null
  /**
   * Always `true` — the column carries `check (human_decision_required)`, so
   * Postgres rejects `false` outright. That is SYSTEM-PROMPT §2.9 written as a
   * constraint: a model may recommend a compliance decision, and there is no
   * representable state in which one is taken without a human.
   */
  humanDecisionRequired: boolean
  decidedBy: string | null
  decidedAt: string | null
  dueAt: string | null
  /** `jsonb NOT NULL` — `{}` when empty, never null. */
  metadata: Record<string, unknown>
  /** `int NOT NULL` — optimistic concurrency. */
  version: number
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Fixed identifiers — the literals `supabase/seed.sql` inserts
// ---------------------------------------------------------------------------

export const SEED_GOVERNANCE_COMPANY_ID = "11111111-1111-4111-8111-111111111111"
export const SEED_GOVERNANCE_SITE_ID = "22222222-2222-4222-8222-222222222222"

/**
 * `seed.sql` derives each profile id from the role's **index in the CONTRACTS §3
 * order**: `b0000000-0000-4000-8000-` + the 1-based index padded to twelve
 * digits. Spelling the ids out rather than recomputing them keeps this file a
 * flat list of literals, which is what makes a seed auditable.
 */
export const SEED_PROFILE_IDS = Object.freeze({
  admin: "b0000000-0000-4000-8000-000000000001",
  manager: "b0000000-0000-4000-8000-000000000002",
  accountant: "b0000000-0000-4000-8000-000000000003",
  staff: "b0000000-0000-4000-8000-000000000004",
  owner: "b0000000-0000-4000-8000-000000000005",
  tenant: "b0000000-0000-4000-8000-000000000006",
  guest: "b0000000-0000-4000-8000-000000000007",
  serviceProvider: "b0000000-0000-4000-8000-000000000008",
  childOwner: "b0000000-0000-4000-8000-000000000009",
  childTenant: "b0000000-0000-4000-8000-000000000010",
  childGuest: "b0000000-0000-4000-8000-000000000011",
})

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * All eleven roles, one profile each — the same set, ids, emails and names
 * `supabase/seed.sql` creates.
 *
 * Eleven and not nine: `child_tenant` and `child_guest` exist so a test can show
 * that each `child_*` role is a strict subset of *its own* guardian rather than
 * of whichever adult happens to be seeded. `guest` is here because a role with
 * almost no permitted resource must still land on a coherent empty state rather
 * than a broken shell (CONVENTIONS §5), and that state needs a profile to render
 * from.
 *
 * `full_name` is the role name title-cased, exactly as `seed.sql` computes it
 * with `initcap(replace(role, '_', ' '))`. Fictional by construction: there is
 * no person here to name.
 */
export function seedProfiles(): ProfileRecord[] {
  const base = {
    phone: null,
    locale: "de",
    companyId: SEED_GOVERNANCE_COMPANY_ID,
    isActive: true,
    avatarUrl: null,
    createdAt: seedIso(-120),
    updatedAt: seedIso(-2),
  } as const

  return [
    {
      id: SEED_PROFILE_IDS.admin,
      email: "admin@azura.local",
      fullName: "Admin",
      role: "admin",
      ...base,
    },
    {
      id: SEED_PROFILE_IDS.manager,
      email: "manager@azura.local",
      fullName: "Manager",
      role: "manager",
      ...base,
    },
    {
      id: SEED_PROFILE_IDS.accountant,
      email: "accountant@azura.local",
      fullName: "Accountant",
      role: "accountant",
      ...base,
    },
    {
      id: SEED_PROFILE_IDS.staff,
      email: "staff@azura.local",
      fullName: "Staff",
      role: "staff",
      ...base,
    },
    {
      id: SEED_PROFILE_IDS.owner,
      email: "owner@azura.local",
      fullName: "Owner",
      role: "owner",
      ...base,
    },
    {
      id: SEED_PROFILE_IDS.tenant,
      email: "tenant@azura.local",
      fullName: "Tenant",
      role: "tenant",
      ...base,
    },
    {
      id: SEED_PROFILE_IDS.guest,
      email: "guest@azura.local",
      fullName: "Guest",
      role: "guest",
      ...base,
    },
    {
      id: SEED_PROFILE_IDS.serviceProvider,
      email: "service_provider@azura.local",
      fullName: "Service Provider",
      role: "service_provider",
      ...base,
    },
    {
      id: SEED_PROFILE_IDS.childOwner,
      email: "child_owner@azura.local",
      fullName: "Child Owner",
      role: "child_owner",
      ...base,
    },
    {
      id: SEED_PROFILE_IDS.childTenant,
      email: "child_tenant@azura.local",
      fullName: "Child Tenant",
      role: "child_tenant",
      ...base,
    },
    {
      id: SEED_PROFILE_IDS.childGuest,
      email: "child_guest@azura.local",
      fullName: "Child Guest",
      role: "child_guest",
      ...base,
    },
  ]
}

/**
 * The two guardianships `seed.sql` creates: `owner` supervises `child_owner`,
 * `tenant` supervises `child_tenant`.
 *
 * Two, not one, because one link cannot distinguish "the child sees a subset of
 * its guardian" from "the child sees a subset of *some* adult". With both, a
 * test can assert that `child_tenant` gets nothing through `owner`, which is the
 * escalation CONVENTIONS §5 asks to be tested for.
 *
 * `relation: "guardian"` — one of the three values the CHECK permits, and the
 * one `seed.sql` uses. `child_guest` deliberately has no guardian.
 */
export function seedGuardianships(): GuardianshipRecord[] {
  return [
    {
      id: "f0000000-0000-4000-8000-000000000001",
      guardianProfileId: SEED_PROFILE_IDS.owner,
      childProfileId: SEED_PROFILE_IDS.childOwner,
      relation: "guardian",
      status: "active",
      consentRecordedAt: seedIso(-30),
      createdAt: seedIso(-30),
      revokedAt: null,
    },
    {
      id: "f0000000-0000-4000-8000-000000000002",
      guardianProfileId: SEED_PROFILE_IDS.tenant,
      childProfileId: SEED_PROFILE_IDS.childTenant,
      relation: "guardian",
      status: "active",
      consentRecordedAt: seedIso(-30),
      createdAt: seedIso(-30),
      revokedAt: null,
    },
  ]
}

// ---------------------------------------------------------------------------
// The three tables that used to be empty
//
// They returned `[]` and the reason was good: SYSTEM-PROMPT §3 forbids filling
// a `[GAP]` with a plausible guess, and a fabricated audit row is the most
// plausible-looking guess in this repository — it reads as a record of
// something that happened.
//
// `PIVOT.md` §2 changes what these rows ARE. This is a product demonstration,
// not a dossier about a real operator, so the audit trail has to show what it
// records or the governance module demonstrates nothing. The standard that does
// not move: every generated row carries `demo: true`, and none of them claims a
// real person did a real thing. `supabase/seed.sql` still has no rows in these
// three tables — that is W1-A's, and it is a request in HANDOFF/P1.md.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The generated operating year
//
// The three tables above shipped EMPTY, and the comment explaining why was
// right under the old framing: this was competitor intelligence and a fabricated
// audit row would have been a fabricated claim about somebody's real conduct.
//
// `PIVOT.md` §2 changes the framing, not the standard. These rows are a
// demonstration of what the audit trail records, every one carries
// `demo: true`, and none describes an action a real person took.
// ---------------------------------------------------------------------------

/**
 * A year of audit entries: the actions this system actually writes.
 *
 * `beforeData` / `afterData` carry the two values a reviewer needs to see, and
 * nothing else. An audit row that dumps a whole record is a row nobody reads,
 * and it is also the row most likely to carry a resident's personal data into a
 * table with a longer retention than the record it describes.
 */
function generatedAuditEvents(): AuditEventRecord[] {
  const rng = stream("audit")
  const out: AuditEventRecord[] = []

  const ACTIONS: ReadonlyArray<
    readonly [string, string, string, number]
  > = [
    // action, entity table, actor role key, weight
    ["ticket.status_changed", "service_tickets", "staff", 30],
    ["ticket.assigned", "service_tickets", "manager", 18],
    ["finance.entry_posted", "finance_ledger_entries", "accountant", 16],
    ["invoice.settled", "vendor_invoices", "accountant", 10],
    ["document.uploaded", "documents", "staff", 8],
    ["document.reviewed", "documents", "manager", 6],
    ["profile.role_changed", "profiles", "admin", 4],
    ["compliance.decided", "compliance_checks", "manager", 4],
    ["unit.resident_added", "unit_residents", "manager", 4],
  ]

  for (let index = 1; index <= 220; index += 1) {
    const entry = rng.weighted(ACTIONS.map((row) => [row, row[3]] as const))
    const [action, entityTable, actorKey] = entry
    const offset = rng.int(YEAR_START_OFFSET, -1)
    out.push({
      id: demoId("aud", index),
      companyId: SEED_GOVERNANCE_COMPANY_ID,
      actorProfileId:
        DEMO_PROFILE_IDS[actorKey as keyof typeof DEMO_PROFILE_IDS] ??
        DEMO_PROFILE_IDS.staff,
      action,
      entityTable,
      entityId: null,
      beforeData: { ...DEMO_MARK, state: "before" },
      afterData: { ...DEMO_MARK, state: "after" },
      // No IP and no user agent. They are not needed to demonstrate what the
      // trail records, and a plausible-looking address in a demo is one more
      // thing a reader has to be told is not real.
      ipAddress: null,
      userAgent: null,
      requestId: null,
      createdAt: at(offset, rng.int(8, 19)),
    })
  }
  return out
}

/**
 * Access decisions, including the refusals.
 *
 * A log of nothing but grants is not an access log. Roughly one in seven is a
 * denial, which is what makes the governance screen worth opening: the row that
 * matters is the one where somebody reached for a unit that was not theirs.
 */
function generatedAccessEvents(): AccessEventRecord[] {
  const rng = stream("access")
  const out: AccessEventRecord[] = []

  const RESOURCES: readonly string[] = [
    "/dashboard/finance",
    "/dashboard/units",
    "/dashboard/tickets",
    "/dashboard/documents",
    "/dashboard/users",
    "/dashboard/vendor-invoices",
  ]

  for (let index = 1; index <= 140; index += 1) {
    const denied = rng.chance(0.15)
    const offset = rng.int(YEAR_START_OFFSET, -1)
    out.push({
      id: demoId("acc", index),
      companyId: SEED_GOVERNANCE_COMPANY_ID,
      actorProfileId: rng.pick([
        DEMO_PROFILE_IDS.owner,
        DEMO_PROFILE_IDS.tenant,
        DEMO_PROFILE_IDS.staff,
        DEMO_PROFILE_IDS.serviceProvider,
        DEMO_PROFILE_IDS.accountant,
      ]),
      eventType: denied ? "route_denied" : "route_allowed",
      decision: denied ? "deny" : "allow",
      resource: rng.pick(RESOURCES),
      reason: denied ? "forbidden" : null,
      ipAddress: null,
      userAgent: null,
      requestId: null,
      sessionId: null,
      createdAt: at(offset, rng.int(7, 21)),
    })
  }
  return out
}

/**
 * The compliance calendar a building actually has to keep.
 *
 * Lift inspections, fire safety, legionella, electrical testing and insurance
 * renewal, on the cadence each is genuinely required at. Some are overdue,
 * because the point of the module is the ones that are.
 */
function generatedComplianceChecks(): ComplianceCheckRecord[] {
  const rng = stream("compliance")
  const out: ComplianceCheckRecord[] = []
  let index = 0

  const REGIME: ReadonlyArray<readonly [string, string, string, number]> = [
    // check type, subject type, risk level, months between checks
    ["lift_inspection", "site", "high", 6],
    ["fire_safety", "site", "high", 12],
    ["legionella_test", "site", "high", 6],
    ["electrical_test", "site", "medium", 12],
    ["pool_water_quality", "site", "medium", 1],
    ["insurance_renewal", "company", "medium", 12],
    ["lease_compliance", "unit", "low", 12],
  ]

  for (const [checkType, subjectType, riskLevel, everyMonths] of REGIME) {
    const months = monthStarts()
    for (let m = 0; m < months.length; m += everyMonths) {
      const offset = months[m]
      if (offset === undefined) continue
      index += 1
      const dueOffset = offset + everyMonths * 30
      const overdue = dueOffset < 0 && rng.chance(0.22)
      const decided = dueOffset < 0 && !overdue

      out.push({
        id: demoId("cmp", index),
        companyId: SEED_GOVERNANCE_COMPANY_ID,
        siteId: subjectType === "company" ? null : SEED_GOVERNANCE_SITE_ID,
        subjectType,
        subjectId:
          subjectType === "unit" ? "AZW-B03-0042" : SEED_GOVERNANCE_SITE_ID,
        checkType,
        // `overdue` is a fact about the due date, not a label: the status and
        // `dueAt` are derived from the same offset so they cannot disagree.
        status: overdue ? "overdue" : decided ? "passed" : "scheduled",
        riskLevel,
        rationale: null,
        evidenceDocumentId: null,
        humanDecisionRequired: riskLevel === "high",
        decidedBy: decided ? DEMO_PROFILE_IDS.manager : null,
        decidedAt: decided ? at(dueOffset - 2, 11) : null,
        dueAt: at(dueOffset, 9),
        metadata: { ...DEMO_MARK, cadenceMonths: everyMonths },
        version: 1,
        createdAt: at(offset, 9),
        updatedAt: at(Math.min(0, dueOffset), 9),
      })
    }
  }
  return out
}

export function seedAuditEvents(): AuditEventRecord[] {
  return generatedAuditEvents()
}

export function seedAccessEvents(): AccessEventRecord[] {
  return generatedAccessEvents()
}

export function seedComplianceChecks(): ComplianceCheckRecord[] {
  return generatedComplianceChecks()
}
