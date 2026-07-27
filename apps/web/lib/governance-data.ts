/**
 * # Governance seed data — `profiles`, `guardianships`, `audit_events`,
 * `access_events`, `compliance_checks`
 *
 * Owned by **W2-A**. Consumed only by `lib/governance-repository.ts` as the
 * `fallback()` argument to `withRepository()`.
 *
 * ## Everything here is invented, and that is safe
 *
 * Unlike `lib/hotel-data.ts`, none of these rows describes the real world. There
 * is no harvested source for "who works at Cebeci Group" and there must not be:
 * this is a competitor-intelligence build (CLAUDE.md §1) and putting a real
 * person's name, email or phone number in a seed file would be a privacy
 * problem, not a fidelity win. Every profile below is fictional, every address
 * is under the RFC 2606 reserved `example.com`, and every consumer of these rows
 * sees `source: "local-seed"` on the envelope.
 *
 * The *shapes*, by contrast, are exact — same columns, same nullability, same
 * TEXT-vs-uuid split — so swapping to `source: "supabase"` changes nothing
 * downstream.
 *
 * ## Deterministic
 *
 * Literal UUIDs and `seedIso()` timestamps only. No `Math.random()`, no
 * `Date.now()`, no bare `new Date()`. Two calls to any builder return
 * byte-identical JSON.
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
  eventType: string
  /** "allow" / "deny" — the decision the guard actually took. */
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
  /** True when a human must decide. The AI may recommend; it never approves. */
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
// Fixed identifiers
// ---------------------------------------------------------------------------

export const SEED_GOVERNANCE_COMPANY_ID = "00000000-0000-4000-8000-000000000c01"
export const SEED_GOVERNANCE_SITE_ID = "00000000-0000-4000-8000-000000000501"

export const SEED_PROFILE_IDS = Object.freeze({
  admin: "00000000-0000-4000-8000-000000000a01",
  manager: "00000000-0000-4000-8000-000000000a02",
  accountant: "00000000-0000-4000-8000-000000000a03",
  staff: "00000000-0000-4000-8000-000000000a04",
  serviceProvider: "00000000-0000-4000-8000-000000000a05",
  owner: "00000000-0000-4000-8000-000000000a06",
  tenant: "00000000-0000-4000-8000-000000000a07",
  guest: "00000000-0000-4000-8000-000000000a08",
  childOwner: "00000000-0000-4000-8000-000000000a09",
})

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Nine fictional profiles, one per role that the governance surfaces need to
 * exercise. `guest` is included because a role with almost no permitted resource
 * must still land on a coherent empty state rather than a broken shell
 * (CONVENTIONS §5).
 */
export function seedProfiles(): ProfileRecord[] {
  return [
    {
      id: SEED_PROFILE_IDS.admin,
      email: "admin@example.com",
      fullName: "Deniz Aksoy",
      role: "admin",
      phone: null,
      locale: "de",
      companyId: SEED_GOVERNANCE_COMPANY_ID,
      isActive: true,
      avatarUrl: null,
      createdAt: seedIso(-120),
      updatedAt: seedIso(-2),
    },
    {
      id: SEED_PROFILE_IDS.manager,
      email: "manager@example.com",
      fullName: "Lena Brandt",
      role: "manager",
      phone: null,
      locale: "de",
      companyId: SEED_GOVERNANCE_COMPANY_ID,
      isActive: true,
      avatarUrl: null,
      createdAt: seedIso(-118),
      updatedAt: seedIso(-3),
    },
    {
      id: SEED_PROFILE_IDS.accountant,
      email: "accountant@example.com",
      fullName: "Marek Novak",
      role: "accountant",
      phone: null,
      locale: "en",
      companyId: SEED_GOVERNANCE_COMPANY_ID,
      isActive: true,
      avatarUrl: null,
      createdAt: seedIso(-110),
      updatedAt: seedIso(-9),
    },
    {
      id: SEED_PROFILE_IDS.staff,
      email: "staff@example.com",
      fullName: "Selin Yıldız",
      role: "staff",
      phone: null,
      locale: "tr",
      companyId: SEED_GOVERNANCE_COMPANY_ID,
      isActive: true,
      avatarUrl: null,
      createdAt: seedIso(-95),
      updatedAt: seedIso(-5),
    },
    {
      id: SEED_PROFILE_IDS.serviceProvider,
      email: "vendor@example.com",
      fullName: "Kemal Arslan",
      role: "service_provider",
      phone: null,
      locale: "tr",
      companyId: SEED_GOVERNANCE_COMPANY_ID,
      isActive: true,
      avatarUrl: null,
      createdAt: seedIso(-60),
      updatedAt: seedIso(-6),
    },
    {
      id: SEED_PROFILE_IDS.owner,
      email: "owner@example.com",
      fullName: "Irina Petrova",
      role: "owner",
      phone: null,
      locale: "ru",
      companyId: SEED_GOVERNANCE_COMPANY_ID,
      isActive: true,
      avatarUrl: null,
      createdAt: seedIso(-45),
      updatedAt: seedIso(-4),
    },
    {
      id: SEED_PROFILE_IDS.tenant,
      email: "tenant@example.com",
      fullName: "Jonas Weber",
      role: "tenant",
      phone: null,
      locale: "de",
      companyId: SEED_GOVERNANCE_COMPANY_ID,
      isActive: true,
      avatarUrl: null,
      createdAt: seedIso(-40),
      updatedAt: seedIso(-4),
    },
    {
      id: SEED_PROFILE_IDS.guest,
      email: "guest@example.com",
      fullName: "Hannah Vogt",
      role: "guest",
      phone: null,
      locale: "en",
      companyId: null,
      isActive: true,
      avatarUrl: null,
      createdAt: seedIso(-12),
      updatedAt: seedIso(-1),
    },
    {
      id: SEED_PROFILE_IDS.childOwner,
      email: "child.owner@example.com",
      fullName: "Mila Petrova",
      role: "child_owner",
      phone: null,
      locale: "ru",
      companyId: SEED_GOVERNANCE_COMPANY_ID,
      isActive: true,
      avatarUrl: null,
      createdAt: seedIso(-30),
      updatedAt: seedIso(-2),
    },
  ]
}

/**
 * One active guardianship: the `owner` profile supervises the `child_owner`
 * profile. The child's horizon is a strict subset of the guardian's, which is
 * what `getGuardianships()` exists to let a caller verify.
 */
export function seedGuardianships(): GuardianshipRecord[] {
  return [
    {
      id: "00000000-0000-4000-8000-000000000b01",
      guardianProfileId: SEED_PROFILE_IDS.owner,
      childProfileId: SEED_PROFILE_IDS.childOwner,
      relation: "parent",
      status: "active",
      consentRecordedAt: seedIso(-30),
      createdAt: seedIso(-30),
      revokedAt: null,
    },
  ]
}

/**
 * Three audit rows. `beforeData` is null on a create and populated on an update
 * — the pair is what makes an audit trail reconstructible rather than a log of
 * verbs.
 */
export function seedAuditEvents(): AuditEventRecord[] {
  return [
    {
      id: "00000000-0000-4000-8000-000000000c11",
      companyId: SEED_GOVERNANCE_COMPANY_ID,
      actorProfileId: SEED_PROFILE_IDS.manager,
      action: "unit.price.update",
      entityTable: "units",
      // TEXT, not uuid.
      entityId: "AZW-B03-0412",
      beforeData: { asking_price_amount: "112000.00", asking_price_currency: "EUR" },
      afterData: { asking_price_amount: "118000.00", asking_price_currency: "EUR" },
      ipAddress: "203.0.113.10",
      userAgent: "Mozilla/5.0 (seed)",
      requestId: "req-seed-0001",
      createdAt: seedIso(-3, 11),
    },
    {
      id: "00000000-0000-4000-8000-000000000c12",
      companyId: SEED_GOVERNANCE_COMPANY_ID,
      actorProfileId: SEED_PROFILE_IDS.accountant,
      action: "finance.ledger_entry.post",
      entityTable: "finance_ledger_entries",
      entityId: "00000000-0000-4000-8000-0000000006a1",
      beforeData: null,
      afterData: { status: "posted", currency: "EUR" },
      ipAddress: "203.0.113.11",
      userAgent: "Mozilla/5.0 (seed)",
      requestId: "req-seed-0002",
      createdAt: seedIso(-2, 10),
    },
    {
      id: "00000000-0000-4000-8000-000000000c13",
      companyId: SEED_GOVERNANCE_COMPANY_ID,
      actorProfileId: SEED_PROFILE_IDS.admin,
      action: "profile.role.update",
      entityTable: "profiles",
      entityId: SEED_PROFILE_IDS.staff,
      beforeData: { role: "guest" },
      afterData: { role: "staff" },
      ipAddress: "203.0.113.12",
      userAgent: "Mozilla/5.0 (seed)",
      requestId: "req-seed-0003",
      createdAt: seedIso(-1, 8),
    },
  ]
}

/**
 * Three access decisions, including a denial. A log that only records successes
 * cannot answer the one question an access log exists for.
 */
export function seedAccessEvents(): AccessEventRecord[] {
  return [
    {
      id: "00000000-0000-4000-8000-000000000d11",
      companyId: SEED_GOVERNANCE_COMPANY_ID,
      actorProfileId: SEED_PROFILE_IDS.manager,
      eventType: "route.view",
      decision: "allow",
      resource: "evidence",
      reason: "evidence:view held by manager",
      ipAddress: "203.0.113.10",
      userAgent: "Mozilla/5.0 (seed)",
      requestId: "req-seed-0101",
      sessionId: "sess-seed-0001",
      createdAt: seedIso(-3, 9),
    },
    {
      id: "00000000-0000-4000-8000-000000000d12",
      companyId: SEED_GOVERNANCE_COMPANY_ID,
      actorProfileId: SEED_PROFILE_IDS.owner,
      eventType: "route.view",
      decision: "deny",
      resource: "evidence",
      reason: "evidence:view not held by owner",
      ipAddress: "203.0.113.20",
      userAgent: "Mozilla/5.0 (seed)",
      requestId: "req-seed-0102",
      sessionId: "sess-seed-0002",
      createdAt: seedIso(-2, 15),
    },
    {
      id: "00000000-0000-4000-8000-000000000d13",
      companyId: SEED_GOVERNANCE_COMPANY_ID,
      actorProfileId: SEED_PROFILE_IDS.childOwner,
      eventType: "api.call",
      decision: "deny",
      resource: "finance",
      reason: "child_owner holds a strict subset of owner; finance workspace excluded",
      ipAddress: "203.0.113.21",
      userAgent: "Mozilla/5.0 (seed)",
      requestId: "req-seed-0103",
      sessionId: "sess-seed-0003",
      createdAt: seedIso(-1, 16),
    },
  ]
}

/**
 * Three compliance checks across the risk range, two of them still requiring a
 * human decision. `humanDecisionRequired` is the switch that keeps an automated
 * recommendation from becoming an automated approval.
 */
export function seedComplianceChecks(): ComplianceCheckRecord[] {
  return [
    {
      id: "00000000-0000-4000-8000-000000000e11",
      companyId: SEED_GOVERNANCE_COMPANY_ID,
      siteId: SEED_GOVERNANCE_SITE_ID,
      subjectType: "unit",
      // TEXT, not uuid.
      subjectId: "AZW-B03-0412",
      checkType: "title_deed_present",
      status: "open",
      riskLevel: "high",
      rationale: "No title deed document is attached to this unit.",
      evidenceDocumentId: null,
      humanDecisionRequired: true,
      decidedBy: null,
      decidedAt: null,
      dueAt: seedIso(14, 12),
      metadata: { blockCode: "AZW-B03" },
      version: 1,
      createdAt: seedIso(-20),
      updatedAt: seedIso(-20),
    },
    {
      id: "00000000-0000-4000-8000-000000000e12",
      companyId: SEED_GOVERNANCE_COMPANY_ID,
      siteId: SEED_GOVERNANCE_SITE_ID,
      subjectType: "listing",
      subjectId: "portal:haspo:oba-112000",
      checkType: "listing_district_matches_project",
      status: "open",
      riskLevel: "medium",
      rationale:
        "Listing states a district that contradicts its own headline. Both readings are retained; neither is trusted as a price anchor.",
      evidenceDocumentId: null,
      humanDecisionRequired: true,
      decidedBy: null,
      decidedAt: null,
      dueAt: seedIso(7, 12),
      metadata: { finding: "F-019" },
      version: 1,
      createdAt: seedIso(-15),
      updatedAt: seedIso(-15),
    },
    {
      id: "00000000-0000-4000-8000-000000000e13",
      companyId: SEED_GOVERNANCE_COMPANY_ID,
      siteId: SEED_GOVERNANCE_SITE_ID,
      subjectType: "hotel",
      subjectId: "AZW-HTL-01",
      checkType: "brand_affiliation_claim",
      status: "resolved",
      riskLevel: "low",
      rationale:
        "No current chain affiliation is asserted by any source. The 2023 licence announcement is retained as a competing value, not as a present-tense claim.",
      evidenceDocumentId: null,
      humanDecisionRequired: false,
      decidedBy: SEED_PROFILE_IDS.manager,
      decidedAt: seedIso(-5, 13),
      dueAt: null,
      metadata: { findings: ["F-007", "F-018"] },
      version: 2,
      createdAt: seedIso(-25),
      updatedAt: seedIso(-5, 13),
    },
  ]
}
