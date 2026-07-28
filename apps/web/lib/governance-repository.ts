/**
 * # Governance repository — profiles, guardianships, audit, access, compliance
 *
 * Owned by **W2-A**. Every read goes through `withRepository()`, so all six
 * exports obey the data-layer rules: unconfigured → labelled seed, configured
 * failure → **throws** a mapped `ApiError`, configured-and-empty →
 * `source: "supabase"` with empty data and no seed substitution.
 *
 * ## Role scoping is defence in depth, not the boundary
 *
 * RLS is the security boundary and it must hold on its own. The scoping below
 * duplicates it **deliberately** (W2-A brief §4), for two reasons:
 *
 * 1. In local-seed mode there is no Postgres and therefore no RLS. Without this,
 *    a demo would hand a `tenant` the whole staff directory.
 * 2. A repository that mirrors RLS makes a policy regression visible as a
 *    behaviour change in tests, instead of only in production.
 *
 * It mirrors RLS's *shape* as well as its rules: an under-privileged caller gets
 * **zero rows**, not an exception, exactly as a `SELECT` under a restrictive
 * policy does. The difference from silence is that the result carries a
 * `degradedReason` naming the restriction, so an empty governance table and an
 * empty *permission* are distinguishable — which is the whole point of the
 * envelope.
 *
 * Gates used, all read from `lib/rbac.ts` rather than hardcoded role lists:
 *
 * | Surface | Gate | Holders today |
 * |---|---|---|
 * | profiles, guardianships (directory-wide) | `users:view` | admin, manager |
 * | audit_events, access_events | level ≥ 70 | admin, manager |
 * | compliance_checks | `compliance:view` | admin, manager, accountant |
 *
 * A caller below the directory gate still sees **its own profile plus its active
 * wards** when it supplies `profileId`. That is the additive-authority rule from
 * CONTRACTS §3 read from the other end: a guardian's horizon covers the child,
 * and the child's is a strict subset of the guardian's, never a different one.
 *
 * ## These tables are append-only, and this file only reads
 *
 * `audit_events` and `access_events` are append-only and readable at manager
 * level and above. **`authenticated` holds no INSERT privilege on either.** An
 * audit write attempted with the caller's session client fails with Postgres
 * `42501`, which `toApiError` maps to `forbidden` — it must instead go through
 * `createServiceRoleClient()` from a route handler, after the RBAC check
 * (CONVENTIONS §4 step 8). No write helper is exported here, so nothing can
 * reach for the wrong client by accident.
 */

import type { Role } from "@/lib/contracts"
import type { RepositoryResult } from "@/lib/contracts"
import { hasPermission, isManagerOrAbove, isValidRole } from "@/lib/rbac"
import {
  MAX_PAGE_SIZE,
  asBoolean,
  asNullableNumber,
  asNullableString,
  asString,
  clampLimit,
  clampOffset,
  degraded,
  unwrap,
  withRepository,
  type RepositoryClient,
} from "@/lib/repository-base"
import {
  seedAccessEvents,
  seedAuditEvents,
  seedComplianceChecks,
  seedGuardianships,
  seedProfiles,
  type AccessEventRecord,
  type AuditEventRecord,
  type ComplianceCheckRecord,
  type GuardianshipRecord,
  type ProfileRecord,
} from "@/lib/governance-data"

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const PROFILE_COLUMNS =
  "id, email, full_name, role, phone, locale, company_id, is_active, avatar_url, created_at, updated_at"

const GUARDIANSHIP_COLUMNS =
  "id, guardian_profile_id, child_profile_id, relation, status, consent_recorded_at, created_at, revoked_at"

const AUDIT_EVENT_COLUMNS =
  "id, company_id, actor_profile_id, action, entity_table, entity_id, before_data, after_data, ip_address, user_agent, request_id, created_at"

const ACCESS_EVENT_COLUMNS =
  "id, company_id, actor_profile_id, event_type, decision, resource, reason, ip_address, user_agent, request_id, session_id, created_at"

const COMPLIANCE_CHECK_COLUMNS =
  "id, company_id, site_id, subject_type, subject_id, check_type, status, risk_level, rationale, evidence_document_id, human_decision_required, decided_by, decided_at, due_at, metadata, version, created_at, updated_at"

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function asJsonObject(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null
  if (typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/**
 * `public.app_role` → the frozen `Role` union, or `null` when the database holds
 * a value TypeScript does not know. Never defaulted: see the note on
 * `ProfileRecord.role`.
 */
function asRole(value: unknown): Role | null {
  return isValidRole(value) ? value : null
}

function mapProfileRow(row: Record<string, unknown>): ProfileRecord {
  return {
    id: asString(row.id),
    email: asNullableString(row.email),
    fullName: asNullableString(row.full_name),
    role: asRole(row.role),
    phone: asNullableString(row.phone),
    locale: asString(row.locale),
    companyId: asNullableString(row.company_id),
    isActive: asBoolean(row.is_active),
    avatarUrl: asNullableString(row.avatar_url),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  }
}

function mapGuardianshipRow(row: Record<string, unknown>): GuardianshipRecord {
  return {
    id: asString(row.id),
    guardianProfileId: asString(row.guardian_profile_id),
    childProfileId: asString(row.child_profile_id),
    relation: asString(row.relation),
    status: asString(row.status),
    consentRecordedAt: asNullableString(row.consent_recorded_at),
    createdAt: asString(row.created_at),
    revokedAt: asNullableString(row.revoked_at),
  }
}

function mapAuditEventRow(row: Record<string, unknown>): AuditEventRecord {
  return {
    id: asString(row.id),
    companyId: asNullableString(row.company_id),
    actorProfileId: asNullableString(row.actor_profile_id),
    action: asString(row.action),
    entityTable: asString(row.entity_table),
    // TEXT column: "AZW-B03-0412" is a legal value here.
    entityId: asNullableString(row.entity_id),
    beforeData: asJsonObject(row.before_data),
    afterData: asJsonObject(row.after_data),
    ipAddress: asNullableString(row.ip_address),
    userAgent: asNullableString(row.user_agent),
    requestId: asNullableString(row.request_id),
    createdAt: asString(row.created_at),
  }
}

function mapAccessEventRow(row: Record<string, unknown>): AccessEventRecord {
  return {
    id: asString(row.id),
    companyId: asNullableString(row.company_id),
    actorProfileId: asNullableString(row.actor_profile_id),
    eventType: asString(row.event_type),
    decision: asString(row.decision),
    resource: asNullableString(row.resource),
    reason: asNullableString(row.reason),
    ipAddress: asNullableString(row.ip_address),
    userAgent: asNullableString(row.user_agent),
    requestId: asNullableString(row.request_id),
    sessionId: asNullableString(row.session_id),
    createdAt: asString(row.created_at),
  }
}

function mapComplianceCheckRow(
  row: Record<string, unknown>
): ComplianceCheckRecord {
  return {
    id: asString(row.id),
    companyId: asString(row.company_id),
    siteId: asNullableString(row.site_id),
    subjectType: asString(row.subject_type),
    // TEXT column.
    subjectId: asString(row.subject_id),
    checkType: asString(row.check_type),
    status: asString(row.status),
    riskLevel: asString(row.risk_level),
    rationale: asNullableString(row.rationale),
    evidenceDocumentId: asNullableString(row.evidence_document_id),
    humanDecisionRequired: asBoolean(row.human_decision_required),
    decidedBy: asNullableString(row.decided_by),
    decidedAt: asNullableString(row.decided_at),
    dueAt: asNullableString(row.due_at),
    metadata: asJsonObject(row.metadata) ?? {},
    // `int NOT NULL`; 0 would silently pass an optimistic-concurrency check.
    version: asNullableNumber(row.version) ?? 1,
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  }
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

/** Options every governance read accepts. */
export interface GovernanceQuery {
  /**
   * The **caller's** role — the thing scope is derived from. Not a filter on the
   * rows. `undefined` is treated as anonymous and sees nothing here: governance
   * is not part of the public showcase.
   */
  role?: Role
  /** The caller's own `profiles.id`. Required for the self-and-wards scope. */
  profileId?: string
  /** Clamped to [1, 500]; defaults to 50. */
  limit?: number
  offset?: number
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * PostgREST's `.or()` takes a filter *string*, so a value interpolated into one
 * is not parameterised the way `.eq()` is. Profile ids come from a session
 * rather than a form, but "it cannot be attacker-controlled today" is not a
 * property that survives refactoring — a malformed id is rejected outright and
 * the caller falls to the empty scope.
 */
function isUuid(value: string | undefined): value is string {
  return value !== undefined && UUID_PATTERN.test(value)
}

/** admin + manager. The gate for a directory-wide read of people data. */
function canReadDirectory(role: Role | undefined): boolean {
  return role !== undefined && hasPermission(role, "users:view")
}

/** Level ≥ 70. The gate on both append-only log tables. */
function canReadGovernanceLog(role: Role | undefined): boolean {
  return role !== undefined && isManagerOrAbove(role)
}

/** admin + manager + accountant. */
function canReadCompliance(role: Role | undefined): boolean {
  return role !== undefined && hasPermission(role, "compliance:view")
}

function restrictionReason(
  surface: string,
  role: Role | undefined,
  gate: string
): string {
  const who =
    role === undefined ? "an unauthenticated caller" : `role "${role}"`
  return `${surface} is scoped to ${gate}; ${who} sees no rows.`
}

/**
 * The profile ids a non-directory caller may read: itself, plus every child it
 * currently guards. Two queries, never one per ward.
 */
async function selfAndWardIds(
  client: RepositoryClient,
  profileId: string
): Promise<string[]> {
  const rows = unwrap<Record<string, unknown>[]>(
    await client
      .from("guardianships")
      .select("child_profile_id")
      .eq("guardian_profile_id", profileId)
      .is("revoked_at", null)
      .limit(MAX_PAGE_SIZE),
    []
  )
  const wards = rows
    .map((row) => asNullableString(row.child_profile_id))
    .filter((id): id is string => id !== null)
  return [profileId, ...wards]
}

function seedSelfAndWardIds(profileId: string): string[] {
  const wards = seedGuardianships()
    .filter(
      (link) => link.guardianProfileId === profileId && link.revokedAt === null
    )
    .map((link) => link.childProfileId)
  return [profileId, ...wards]
}

// ---------------------------------------------------------------------------
// Ordering
//
// `created_at` then `id`, in both modes, so seed and Supabase agree and
// snapshots stay stable. Deliberately NOT `full_name`: those names carry Turkish
// characters and a locale-correct people sort needs `Intl.Collator("tr")` at the
// display edge (CONVENTIONS §5), not a database collation nobody pinned.
// ---------------------------------------------------------------------------

function byCreatedAtAsc(
  a: { createdAt: string; id: string },
  b: { createdAt: string; id: string }
): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

function byCreatedAtDesc(
  a: { createdAt: string; id: string },
  b: { createdAt: string; id: string }
): number {
  return -byCreatedAtAsc(a, b)
}

// ---------------------------------------------------------------------------
// getProfiles / getProfile
// ---------------------------------------------------------------------------

export interface ProfileQuery extends GovernanceQuery {
  /**
   * Filter on the **subject's** role — the role stored on the rows returned.
   * Distinct from `role`, which is the caller's. Naming them apart is the point.
   */
  subjectRole?: Role
  isActive?: boolean
  companyId?: string
}

export async function getProfiles(
  opts: ProfileQuery = {}
): Promise<RepositoryResult<ProfileRecord[]>> {
  const { role, subjectRole, isActive, companyId } = opts
  const profileId = isUuid(opts.profileId) ? opts.profileId : undefined
  const limit = clampLimit(opts.limit)
  const offset = clampOffset(opts.offset)
  const directory = canReadDirectory(role)

  const restriction = directory
    ? null
    : profileId === undefined
      ? restrictionReason(
          "The people directory",
          role,
          'the "users:view" permission'
        )
      : `The people directory is scoped to "users:view"; role "${role ?? "anonymous"}" sees only its own profile and the children it currently guards.`

  const result = await withRepository<ProfileRecord[]>(
    async (client) => {
      let query = client.from("profiles").select(PROFILE_COLUMNS)

      if (!directory) {
        if (profileId === undefined) return []
        query = query.in("id", await selfAndWardIds(client, profileId))
      }
      if (subjectRole !== undefined) query = query.eq("role", subjectRole)
      if (isActive !== undefined) query = query.eq("is_active", isActive)
      if (companyId !== undefined) query = query.eq("company_id", companyId)

      const rows = unwrap<Record<string, unknown>[]>(
        await query
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + limit - 1),
        []
      )
      return rows.map(mapProfileRow)
    },
    () => {
      let rows = seedProfiles()
      if (!directory) {
        if (profileId === undefined) return []
        const visible = new Set(seedSelfAndWardIds(profileId))
        rows = rows.filter((profile) => visible.has(profile.id))
      }
      if (subjectRole !== undefined)
        rows = rows.filter((profile) => profile.role === subjectRole)
      if (isActive !== undefined)
        rows = rows.filter((profile) => profile.isActive === isActive)
      if (companyId !== undefined)
        rows = rows.filter((profile) => profile.companyId === companyId)
      return rows.sort(byCreatedAtAsc).slice(offset, offset + limit)
    },
    "governance.getProfiles"
  )

  return restriction === null ? result : degraded(result, restriction)
}

/**
 * One profile, or `null`.
 *
 * `null` covers both "no such row" and "out of your scope" on purpose: telling a
 * caller that a profile it may not read nevertheless *exists* is itself a
 * disclosure. The `degradedReason` says whether a scope was applied, which is
 * enough to debug without leaking existence.
 */
export async function getProfile(
  id: string,
  opts: GovernanceQuery = {}
): Promise<RepositoryResult<ProfileRecord | null>> {
  const { role } = opts
  const profileId = isUuid(opts.profileId) ? opts.profileId : undefined
  const directory = canReadDirectory(role)

  const restriction = directory
    ? null
    : `Profile reads are scoped to "users:view"; role "${role ?? "anonymous"}" may read only its own profile and the children it currently guards.`

  const result = await withRepository<ProfileRecord | null>(
    async (client) => {
      if (!directory) {
        if (profileId === undefined) return null
        const visible = await selfAndWardIds(client, profileId)
        if (!visible.includes(id)) return null
      }
      const rows = unwrap<Record<string, unknown>[]>(
        await client
          .from("profiles")
          .select(PROFILE_COLUMNS)
          .eq("id", id)
          .limit(1),
        []
      )
      // noUncheckedIndexedAccess: `rows[0]` is `Record<string, unknown> | undefined`.
      const first = rows[0]
      return first === undefined ? null : mapProfileRow(first)
    },
    () => {
      if (!directory) {
        if (profileId === undefined) return null
        if (!seedSelfAndWardIds(profileId).includes(id)) return null
      }
      return seedProfiles().find((profile) => profile.id === id) ?? null
    },
    "governance.getProfile"
  )

  return restriction === null ? result : degraded(result, restriction)
}

// ---------------------------------------------------------------------------
// getGuardianships
// ---------------------------------------------------------------------------

export interface GuardianshipQuery extends GovernanceQuery {
  status?: string
  guardianProfileId?: string
  childProfileId?: string
  /** Revoked links are hidden by default; a revoked guardianship grants nothing. */
  includeRevoked?: boolean
}

export async function getGuardianships(
  opts: GuardianshipQuery = {}
): Promise<RepositoryResult<GuardianshipRecord[]>> {
  const { role, status, includeRevoked } = opts
  const guardianProfileId = isUuid(opts.guardianProfileId)
    ? opts.guardianProfileId
    : undefined
  const childProfileId = isUuid(opts.childProfileId)
    ? opts.childProfileId
    : undefined
  const profileId = isUuid(opts.profileId) ? opts.profileId : undefined
  const limit = clampLimit(opts.limit)
  const offset = clampOffset(opts.offset)
  const directory = canReadDirectory(role)

  const restriction = directory
    ? null
    : profileId === undefined
      ? restrictionReason("Guardianships", role, 'the "users:view" permission')
      : `Guardianships are scoped to "users:view"; role "${role ?? "anonymous"}" sees only links it is a party to.`

  const result = await withRepository<GuardianshipRecord[]>(
    async (client) => {
      let query = client.from("guardianships").select(GUARDIANSHIP_COLUMNS)

      if (!directory) {
        if (profileId === undefined) return []
        // Either side of the relation. `profileId` is UUID-validated above,
        // because this filter is a string rather than a bound parameter.
        query = query.or(
          `guardian_profile_id.eq.${profileId},child_profile_id.eq.${profileId}`
        )
      }
      if (guardianProfileId !== undefined)
        query = query.eq("guardian_profile_id", guardianProfileId)
      if (childProfileId !== undefined)
        query = query.eq("child_profile_id", childProfileId)
      if (status !== undefined) query = query.eq("status", status)
      if (includeRevoked !== true) query = query.is("revoked_at", null)

      const rows = unwrap<Record<string, unknown>[]>(
        await query
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + limit - 1),
        []
      )
      return rows.map(mapGuardianshipRow)
    },
    () => {
      let rows = seedGuardianships()
      if (!directory) {
        if (profileId === undefined) return []
        rows = rows.filter(
          (link) =>
            link.guardianProfileId === profileId ||
            link.childProfileId === profileId
        )
      }
      if (guardianProfileId !== undefined) {
        rows = rows.filter(
          (link) => link.guardianProfileId === guardianProfileId
        )
      }
      if (childProfileId !== undefined) {
        rows = rows.filter((link) => link.childProfileId === childProfileId)
      }
      if (status !== undefined)
        rows = rows.filter((link) => link.status === status)
      if (includeRevoked !== true)
        rows = rows.filter((link) => link.revokedAt === null)
      return rows.sort(byCreatedAtAsc).slice(offset, offset + limit)
    },
    "governance.getGuardianships"
  )

  return restriction === null ? result : degraded(result, restriction)
}

// ---------------------------------------------------------------------------
// getAuditEvents
// ---------------------------------------------------------------------------

export interface AuditEventQuery extends GovernanceQuery {
  entityTable?: string
  /** TEXT, so `"AZW-B03-0412"` is as valid a filter as a uuid. */
  entityId?: string
  action?: string
  actorProfileId?: string
  /** ISO instant; `created_at >= since`. Bound as a value, not interpolated. */
  since?: string
}

/**
 * Append-only audit trail, newest first. **Read-only, by design.**
 *
 * There is no `writeAuditEvent()` here and there must not be: `authenticated`
 * holds no INSERT privilege on this table, so a write through the caller's
 * session client fails `42501`. Audit writes belong in a route handler using
 * `createServiceRoleClient()`, after the RBAC decision.
 */
export async function getAuditEvents(
  opts: AuditEventQuery = {}
): Promise<RepositoryResult<AuditEventRecord[]>> {
  const { role, entityTable, entityId, action, actorProfileId, since } = opts
  const limit = clampLimit(opts.limit)
  const offset = clampOffset(opts.offset)
  const allowed = canReadGovernanceLog(role)
  const restriction = allowed
    ? null
    : restrictionReason(
        "The audit trail",
        role,
        "manager level and above (level 70)"
      )

  const result = await withRepository<AuditEventRecord[]>(
    async (client) => {
      if (!allowed) return []
      let query = client.from("audit_events").select(AUDIT_EVENT_COLUMNS)
      if (entityTable !== undefined)
        query = query.eq("entity_table", entityTable)
      if (entityId !== undefined) query = query.eq("entity_id", entityId)
      if (action !== undefined) query = query.eq("action", action)
      if (actorProfileId !== undefined)
        query = query.eq("actor_profile_id", actorProfileId)
      if (since !== undefined) query = query.gte("created_at", since)

      const rows = unwrap<Record<string, unknown>[]>(
        await query
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(offset, offset + limit - 1),
        []
      )
      return rows.map(mapAuditEventRow)
    },
    () => {
      if (!allowed) return []
      let rows = seedAuditEvents()
      if (entityTable !== undefined)
        rows = rows.filter((row) => row.entityTable === entityTable)
      if (entityId !== undefined)
        rows = rows.filter((row) => row.entityId === entityId)
      if (action !== undefined)
        rows = rows.filter((row) => row.action === action)
      if (actorProfileId !== undefined) {
        rows = rows.filter((row) => row.actorProfileId === actorProfileId)
      }
      if (since !== undefined)
        rows = rows.filter((row) => row.createdAt >= since)
      return rows.sort(byCreatedAtDesc).slice(offset, offset + limit)
    },
    "governance.getAuditEvents"
  )

  return restriction === null ? result : degraded(result, restriction)
}

// ---------------------------------------------------------------------------
// getAccessEvents
// ---------------------------------------------------------------------------

export interface AccessEventQuery extends GovernanceQuery {
  eventType?: string
  /** "allow" / "deny". Filtering to denials is the common forensic case. */
  decision?: string
  resource?: string
  actorProfileId?: string
  since?: string
}

/** Append-only access log, newest first. Read-only for the same reason as audit. */
export async function getAccessEvents(
  opts: AccessEventQuery = {}
): Promise<RepositoryResult<AccessEventRecord[]>> {
  const { role, eventType, decision, resource, actorProfileId, since } = opts
  const limit = clampLimit(opts.limit)
  const offset = clampOffset(opts.offset)
  const allowed = canReadGovernanceLog(role)
  const restriction = allowed
    ? null
    : restrictionReason(
        "The access log",
        role,
        "manager level and above (level 70)"
      )

  const result = await withRepository<AccessEventRecord[]>(
    async (client) => {
      if (!allowed) return []
      let query = client.from("access_events").select(ACCESS_EVENT_COLUMNS)
      if (eventType !== undefined) query = query.eq("event_type", eventType)
      if (decision !== undefined) query = query.eq("decision", decision)
      if (resource !== undefined) query = query.eq("resource", resource)
      if (actorProfileId !== undefined)
        query = query.eq("actor_profile_id", actorProfileId)
      if (since !== undefined) query = query.gte("created_at", since)

      const rows = unwrap<Record<string, unknown>[]>(
        await query
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(offset, offset + limit - 1),
        []
      )
      return rows.map(mapAccessEventRow)
    },
    () => {
      if (!allowed) return []
      let rows = seedAccessEvents()
      if (eventType !== undefined)
        rows = rows.filter((row) => row.eventType === eventType)
      if (decision !== undefined)
        rows = rows.filter((row) => row.decision === decision)
      if (resource !== undefined)
        rows = rows.filter((row) => row.resource === resource)
      if (actorProfileId !== undefined) {
        rows = rows.filter((row) => row.actorProfileId === actorProfileId)
      }
      if (since !== undefined)
        rows = rows.filter((row) => row.createdAt >= since)
      return rows.sort(byCreatedAtDesc).slice(offset, offset + limit)
    },
    "governance.getAccessEvents"
  )

  return restriction === null ? result : degraded(result, restriction)
}

// ---------------------------------------------------------------------------
// getComplianceChecks
// ---------------------------------------------------------------------------

export interface ComplianceCheckQuery extends GovernanceQuery {
  status?: string
  riskLevel?: string
  subjectType?: string
  /** TEXT column, so unit ids like `"AZW-B03-0412"` filter directly. */
  subjectId?: string
  checkType?: string
  /** Narrow to the queue a human still has to clear. */
  humanDecisionRequired?: boolean
  companyId?: string
  siteId?: string
}

/**
 * Compliance checks, newest first.
 *
 * `humanDecisionRequired` is the field that keeps SYSTEM-PROMPT §2.9 true: a
 * model may recommend a decision, a human approves it. Nothing here clears a
 * check.
 */
export async function getComplianceChecks(
  opts: ComplianceCheckQuery = {}
): Promise<RepositoryResult<ComplianceCheckRecord[]>> {
  const {
    role,
    status,
    riskLevel,
    subjectType,
    subjectId,
    checkType,
    humanDecisionRequired,
    companyId,
    siteId,
  } = opts
  const limit = clampLimit(opts.limit)
  const offset = clampOffset(opts.offset)
  const allowed = canReadCompliance(role)
  const restriction = allowed
    ? null
    : restrictionReason(
        "Compliance checks",
        role,
        'the "compliance:view" permission'
      )

  const result = await withRepository<ComplianceCheckRecord[]>(
    async (client) => {
      if (!allowed) return []
      let query = client
        .from("compliance_checks")
        .select(COMPLIANCE_CHECK_COLUMNS)
      if (status !== undefined) query = query.eq("status", status)
      if (riskLevel !== undefined) query = query.eq("risk_level", riskLevel)
      if (subjectType !== undefined)
        query = query.eq("subject_type", subjectType)
      if (subjectId !== undefined) query = query.eq("subject_id", subjectId)
      if (checkType !== undefined) query = query.eq("check_type", checkType)
      if (humanDecisionRequired !== undefined) {
        query = query.eq("human_decision_required", humanDecisionRequired)
      }
      if (companyId !== undefined) query = query.eq("company_id", companyId)
      if (siteId !== undefined) query = query.eq("site_id", siteId)

      const rows = unwrap<Record<string, unknown>[]>(
        await query
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(offset, offset + limit - 1),
        []
      )
      return rows.map(mapComplianceCheckRow)
    },
    () => {
      if (!allowed) return []
      let rows = seedComplianceChecks()
      if (status !== undefined)
        rows = rows.filter((row) => row.status === status)
      if (riskLevel !== undefined)
        rows = rows.filter((row) => row.riskLevel === riskLevel)
      if (subjectType !== undefined)
        rows = rows.filter((row) => row.subjectType === subjectType)
      if (subjectId !== undefined)
        rows = rows.filter((row) => row.subjectId === subjectId)
      if (checkType !== undefined)
        rows = rows.filter((row) => row.checkType === checkType)
      if (humanDecisionRequired !== undefined) {
        rows = rows.filter(
          (row) => row.humanDecisionRequired === humanDecisionRequired
        )
      }
      if (companyId !== undefined)
        rows = rows.filter((row) => row.companyId === companyId)
      if (siteId !== undefined)
        rows = rows.filter((row) => row.siteId === siteId)
      return rows.sort(byCreatedAtDesc).slice(offset, offset + limit)
    },
    "governance.getComplianceChecks"
  )

  return restriction === null ? result : degraded(result, restriction)
}
