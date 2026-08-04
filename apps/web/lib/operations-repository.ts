/**
 * # Operations repository — tickets, history, activities, field work, intake
 *
 * Owned by **W2-A**. Every read goes through `withRepository()`; nothing in this
 * file calls Supabase directly and nothing writes its own fallback logic.
 *
 * ## Two schema facts that shape this file
 *
 * **1. `ticket_events` is append-only.** `reject_ticket_events_mutation` raises
 * 42501 on UPDATE and DELETE, and the table carries no UPDATE or DELETE policy
 * at any role level — not even for `admin`. So there is only
 * `appendTicketEvent()` here, and a correction is a further event. History you
 * can edit is not history.
 *
 * **2. `service_tickets.version` is optimistic concurrency.** Every write below
 * carries `.eq("version", expectedVersion)`; a stale write matches zero rows and
 * surfaces as `conflict` (409). Last-write-wins is a bug (CONVENTIONS §5).
 *
 * ## Role scoping, and why it is duplicated
 *
 * RLS is the boundary that must hold. `operationsScope()` is a line-by-line
 * mirror of the SELECT policies in `00000000000006_operations.sql`, repeated
 * here as defence in depth and because it is the only thing that works in
 * local-seed mode, where there is no database and therefore no RLS.
 *
 * The gates, from that migration:
 *
 *  - staff (40) and above → their company; `admin` (90) across companies
 *  - residency at level ≥ 8 (`child_tenant`) → own units and own requests.
 *    The level gate is doing real work rather than restating the join:
 *    `unit_residents` also carries `relation = 'guest'`, so without it a guest
 *    would receive the ticket history of the flat they are staying in.
 *  - assignee → personal, on `auth.uid()`, not the guardian-resolved profile
 *  - `service_provider` (30) → tickets reachable from their assigned tasks
 *  - guest (5), child_guest (3), anon → nothing at all
 *
 * **An absent `role` fails closed.**
 */

import type { ApiError, Money, RepositoryResult, Role } from "@/lib/contracts"
import { roleLevel } from "@/lib/contracts"
import {
  asMoney,
  asNullableNumber,
  asNullableString,
  asBoolean,
  asRecord,
  asString,
  clampLimit,
  clampOffset,
  nowIso,
  RepositoryError,
  totalsByCurrency,
  unwrap,
  withRepository,
  type RepositoryClient,
} from "@/lib/repository-base"
import {
  resolveScopedUnitIds,
  seedUnitIdsForProfile,
} from "@/lib/finance-repository"
import {
  activityCategories,
  activityStatuses,
  mediaReportStatuses,
  seedActivities,
  seedMediaReports,
  seedServiceTickets,
  seedTicketEvents,
  seedWorkforceTasks,
  terminalTicketStatuses,
  terminalWorkforceTaskStatuses,
  ticketCategories,
  ticketEventKinds,
  ticketPriorities,
  ticketSeverities,
  ticketStatuses,
  workforceTaskStatuses,
  type Activity,
  type ActivityCategory,
  type ActivityStatus,
  type MediaReport,
  type MediaReportStatus,
  type ServiceTicket,
  type TicketCategory,
  type TicketEvent,
  type TicketEventKind,
  type TicketPriority,
  type TicketSeverity,
  type TicketStatus,
  type WorkforceTask,
  type WorkforceTaskStatus,
} from "@/lib/operations-data"

export type {
  Activity,
  ActivityCategory,
  ActivityStatus,
  MediaReport,
  MediaReportStatus,
  ServiceTicket,
  TicketCategory,
  TicketEvent,
  TicketEventKind,
  TicketPriority,
  TicketSeverity,
  TicketStatus,
  WorkforceTask,
  WorkforceTaskStatus,
}

// ---------------------------------------------------------------------------
// Tables and column lists
// ---------------------------------------------------------------------------

const T_TICKETS = "service_tickets"
const T_TICKET_EVENTS = "ticket_events"
const T_ACTIVITIES = "activities"
const T_WORKFORCE_TASKS = "workforce_tasks"
const T_MEDIA_REPORTS = "media_reports"

const TICKET_COLUMNS =
  "id, company_id, site_id, unit_id, ticket_no, title, description, category, priority, status, severity, requester_profile_id, assignee_profile_id, reported_at, sla_due_at, resolved_at, closed_at, estimated_cost, currency, requires_finance_approval, metadata, idempotency_key, version, created_at, updated_at"

const TICKET_EVENT_COLUMNS =
  "id, ticket_id, company_id, kind, actor_profile_id, from_status, to_status, note, payload, created_at"

const ACTIVITY_COLUMNS =
  "id, company_id, site_id, title, description, category, starts_at, ends_at, capacity, location, status, organiser_profile_id, metadata, created_at, updated_at"

const WORKFORCE_TASK_COLUMNS =
  "id, company_id, site_id, ticket_id, unit_id, assignee_profile_id, task_no, title, team, status, priority, sla_due_at, started_at, completed_at, checklist, field_note, metadata, created_at, updated_at"

const MEDIA_REPORT_COLUMNS =
  "id, company_id, site_id, unit_id, ticket_id, reporter_profile_id, reporter_name, reporter_email, reporter_phone, description, media_paths, status, is_public_intake, triaged_by_profile_id, triaged_at, metadata, created_at, updated_at"

/**
 * The same list without the reporter's name, e-mail and phone.
 *
 * `media_reports` has a PUBLIC intake path: `media_reports_insert_intake` lets a
 * `guest` file a row, and the CHECK on the table requires a way to reach them,
 * so a passer-by's contact details are exactly what those three columns hold.
 * `media_reports_select_own_unit` then hands the WHOLE row to every resident of
 * the unit the report names, because RLS is row-level and cannot withhold a
 * column.
 *
 * Measured on 2026-08-03: the live table was empty, so the leak was latent. A
 * probe inside a rolled-back transaction seeded one public-intake report against
 * tenant@azura.local's unit and read it back through RLS as that tenant — the
 * row came back with "Passer-by Ahmet", their e-mail and their phone number, all
 * three unredacted. A resident being told the gate is broken does not need the
 * phone number of the stranger who noticed.
 *
 * Staff (40) and above keep the columns: triaging a report means calling the
 * person back. `scope.staffWide` is already that gate.
 */
const MEDIA_REPORT_COLUMNS_SCOPED =
  "id, company_id, site_id, unit_id, ticket_id, reporter_profile_id, description, media_paths, status, is_public_intake, triaged_by_profile_id, triaged_at, metadata, created_at, updated_at"

/**
 * The fields a narrowed report withholds. `null` on one of these means WITHHELD
 * for a non-staff caller and "never recorded" for a staff one; the two are
 * different facts, so a surface that renders them must ask
 * `reporterContactIsWithheld()` first rather than printing a blank.
 */
export const withheldReporterFields = [
  "reporterName",
  "reporterEmail",
  "reporterPhone",
] as const

/** True when this role's media reports arrive without the reporter's contact. */
export function reporterContactIsWithheld(role: Role | undefined): boolean {
  return role === undefined || !isStaffOrAbove(role)
}

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

/**
 * A NOT NULL SQL enum carrying a value the TS union does not contain means the
 * schema is ahead of the code — a deployment error, not bad data.
 * `persistence_unavailable` (503) is honest: a deploy genuinely fixes it, and
 * guessing a default would mis-state a ticket's status on a board somebody acts
 * on.
 */
function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  column: string
): T {
  const match = allowed.find((candidate) => candidate === value)
  if (match === undefined) {
    const apiError: ApiError = {
      code: "persistence_unavailable",
      message: "The data service is temporarily unavailable.",
      details: { column },
      retryable: true,
    }
    throw new RepositoryError(
      apiError,
      new Error(`Unrecognised value for ${column}`)
    )
  }
  return match
}

function optionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[]
): T | null {
  if (value === null || value === undefined) return null
  return allowed.find((candidate) => candidate === value) ?? null
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

function asUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? [...value] : []
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapTicket(value: unknown): ServiceTicket {
  const row = asRecord(value)
  return {
    id: asString(row["id"]),
    companyId: asString(row["company_id"]),
    siteId: asString(row["site_id"]),
    unitId: asNullableString(row["unit_id"]),
    ticketNo: asString(row["ticket_no"]),
    title: asString(row["title"]),
    description: asNullableString(row["description"]),
    category: requireEnum(row["category"], ticketCategories, "category"),
    priority: requireEnum(row["priority"], ticketPriorities, "priority"),
    status: requireEnum(row["status"], ticketStatuses, "status"),
    severity: requireEnum(row["severity"], ticketSeverities, "severity"),
    requesterProfileId: asNullableString(row["requester_profile_id"]),
    assigneeProfileId: asNullableString(row["assignee_profile_id"]),
    reportedAt: asString(row["reported_at"]),
    slaDueAt: asNullableString(row["sla_due_at"]),
    resolvedAt: asNullableString(row["resolved_at"]),
    closedAt: asNullableString(row["closed_at"]),
    // `numeric` arrives as a string and the currency is a separate column;
    // `asMoney` returns null unless BOTH are present and valid. Never invents a
    // currency, and never coerces a missing cost to 0.
    estimatedCost: asMoney(row["estimated_cost"], row["currency"]),
    requiresFinanceApproval: asBoolean(row["requires_finance_approval"]),
    metadata: asRecord(row["metadata"]),
    idempotencyKey: asNullableString(row["idempotency_key"]),
    version: asNullableNumber(row["version"]) ?? 1,
    createdAt: asString(row["created_at"]),
    updatedAt: asString(row["updated_at"]),
  }
}

function mapTicketEvent(value: unknown): TicketEvent {
  const row = asRecord(value)
  return {
    id: asString(row["id"]),
    ticketId: asString(row["ticket_id"]),
    companyId: asString(row["company_id"]),
    kind: requireEnum(row["kind"], ticketEventKinds, "kind"),
    actorProfileId: asNullableString(row["actor_profile_id"]),
    fromStatus: optionalEnum(row["from_status"], ticketStatuses),
    toStatus: optionalEnum(row["to_status"], ticketStatuses),
    note: asNullableString(row["note"]),
    payload: asRecord(row["payload"]),
    createdAt: asString(row["created_at"]),
  }
}

function mapActivity(value: unknown): Activity {
  const row = asRecord(value)
  return {
    id: asString(row["id"]),
    companyId: asString(row["company_id"]),
    siteId: asString(row["site_id"]),
    title: asString(row["title"]),
    description: asNullableString(row["description"]),
    category: requireEnum(row["category"], activityCategories, "category"),
    startsAt: asString(row["starts_at"]),
    endsAt: asString(row["ends_at"]),
    // null = uncapped. `?? 0` here would render "0 places left" for an
    // uncapped activity, which is the CONVENTIONS §5 null-vs-zero bug exactly.
    capacity: asNullableNumber(row["capacity"]),
    location: asNullableString(row["location"]),
    status: requireEnum(row["status"], activityStatuses, "status"),
    organiserProfileId: asNullableString(row["organiser_profile_id"]),
    metadata: asRecord(row["metadata"]),
    createdAt: asString(row["created_at"]),
    updatedAt: asString(row["updated_at"]),
  }
}

function mapWorkforceTask(value: unknown): WorkforceTask {
  const row = asRecord(value)
  return {
    id: asString(row["id"]),
    companyId: asString(row["company_id"]),
    siteId: asString(row["site_id"]),
    ticketId: asNullableString(row["ticket_id"]),
    unitId: asNullableString(row["unit_id"]),
    assigneeProfileId: asNullableString(row["assignee_profile_id"]),
    taskNo: asString(row["task_no"]),
    title: asString(row["title"]),
    team: asNullableString(row["team"]),
    status: requireEnum(row["status"], workforceTaskStatuses, "status"),
    priority: requireEnum(row["priority"], ticketPriorities, "priority"),
    slaDueAt: asNullableString(row["sla_due_at"]),
    startedAt: asNullableString(row["started_at"]),
    completedAt: asNullableString(row["completed_at"]),
    checklist: asUnknownArray(row["checklist"]),
    fieldNote: asNullableString(row["field_note"]),
    metadata: asRecord(row["metadata"]),
    createdAt: asString(row["created_at"]),
    updatedAt: asString(row["updated_at"]),
  }
}

function mapMediaReport(value: unknown): MediaReport {
  const row = asRecord(value)
  return {
    id: asString(row["id"]),
    companyId: asString(row["company_id"]),
    siteId: asNullableString(row["site_id"]),
    unitId: asNullableString(row["unit_id"]),
    ticketId: asNullableString(row["ticket_id"]),
    reporterProfileId: asNullableString(row["reporter_profile_id"]),
    reporterName: asNullableString(row["reporter_name"]),
    reporterEmail: asNullableString(row["reporter_email"]),
    reporterPhone: asNullableString(row["reporter_phone"]),
    description: asString(row["description"]),
    mediaPaths: asStringArray(row["media_paths"]),
    status: requireEnum(row["status"], mediaReportStatuses, "status"),
    isPublicIntake: asBoolean(row["is_public_intake"]),
    triagedByProfileId: asNullableString(row["triaged_by_profile_id"]),
    triagedAt: asNullableString(row["triaged_at"]),
    metadata: asRecord(row["metadata"]),
    createdAt: asString(row["created_at"]),
    updatedAt: asString(row["updated_at"]),
  }
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

export interface OperationsAccess {
  role?: Role
  /** The caller's own profile — `auth.uid()`, used for the assignee paths. */
  profileId?: string | null
  /** Pre-resolved units the caller holds. Trusted input from a route handler. */
  unitIds?: readonly string[]
}

/**
 * Two different identities, deliberately:
 *
 *  - `unitIds` is the GUARDIAN's unit set. `current_user_unit_ids()` resolves a
 *    `child_*` role through `guardianships`, so a child receives exactly its
 *    guardian's units and never more.
 *  - `selfProfileId` is the caller's OWN id (`auth.uid()`), used for the
 *    assignee, requester and reporter paths. A child therefore does not inherit
 *    tickets its guardian personally authored.
 *
 * That second point is stricter than RLS, which resolves the requester path
 * through `current_user_scope_profile_id()`. Erring strict is safe: a caller
 * that wants the guardian's horizon passes the guardian's `profileId`
 * explicitly. Erring wide would not be recoverable.
 */
interface OperationsScope {
  /** level ≥ 40: staff, accountant, manager, admin — their whole company. */
  staffWide: boolean
  /** level ≥ 8: the residency and requester paths are open. */
  residency: boolean
  unitIds: readonly string[]
  selfProfileId: string | null
  /** Tickets reachable through `workforce_tasks.assignee_profile_id`. */
  assignedTicketIds: readonly string[]
  /** guest, child_guest, anon, or no role: operations data is invisible. */
  denied: boolean
}

const DENIED_SCOPE: OperationsScope = {
  staffWide: false,
  residency: false,
  unitIds: [],
  selfProfileId: null,
  assignedTicketIds: [],
  denied: true,
}

/** `has_role_level(40)`. */
function isStaffOrAbove(role: Role): boolean {
  return roleLevel[role] >= roleLevel.staff
}

/**
 * `has_role_level(8)`. Everything from `child_tenant` upward. Guest (5) and
 * child_guest (3) fall below it, which is the whole point of the threshold.
 */
function isResidencyLevel(role: Role): boolean {
  return roleLevel[role] >= roleLevel.child_tenant
}

function operationsScope(
  access: OperationsAccess,
  unitIds: readonly string[],
  assignedTicketIds: readonly string[]
): OperationsScope {
  const { role } = access
  if (role === undefined || !isResidencyLevel(role)) return DENIED_SCOPE
  return {
    staffWide: isStaffOrAbove(role),
    residency: true,
    unitIds,
    selfProfileId: access.profileId ?? null,
    assignedTicketIds,
    denied: false,
  }
}

function seedAssignedTicketIds(profileId: string | null): string[] {
  if (profileId === null) return []
  const ids = seedWorkforceTasks()
    .filter(
      (task) => task.assigneeProfileId === profileId && task.ticketId !== null
    )
    .map((task) => task.ticketId)
    .filter((ticketId): ticketId is string => ticketId !== null)
  return [...new Set(ids)]
}

/**
 * Mirrors `current_user_assigned_ticket_ids()`. One query, not one per task:
 * a per-ticket lookup here is the N+1 the W2-A brief calls out by name.
 */
async function fetchAssignedTicketIds(
  client: RepositoryClient,
  profileId: string | null
): Promise<string[]> {
  if (profileId === null) return []
  const response = await client
    .from(T_WORKFORCE_TASKS)
    .select("ticket_id")
    .eq("assignee_profile_id", profileId)
    .not("ticket_id", "is", null)
    .limit(500)
  const ids = unwrap<unknown[]>(response, [])
    .map((row) => asNullableString(asRecord(row)["ticket_id"]))
    .filter((ticketId): ticketId is string => ticketId !== null)
  return [...new Set(ids)]
}

function seedScope(access: OperationsAccess): OperationsScope {
  const { role } = access
  if (role === undefined || !isResidencyLevel(role)) return DENIED_SCOPE
  const profileId = access.profileId ?? null
  const unitIds = access.unitIds ?? seedUnitIdsForProfile(profileId)
  return operationsScope(access, unitIds, seedAssignedTicketIds(profileId))
}

async function scopeFor(
  client: RepositoryClient,
  access: OperationsAccess
): Promise<OperationsScope> {
  const { role } = access
  if (role === undefined || !isResidencyLevel(role)) return DENIED_SCOPE
  const profileId = access.profileId ?? null

  // Staff and above never need either lookup: their read path is company-wide.
  if (isStaffOrAbove(role))
    return operationsScope(access, access.unitIds ?? [], [])

  const unitIds =
    access.unitIds ?? (await resolveScopedUnitIds(client, profileId))
  const assignedTicketIds = await fetchAssignedTicketIds(client, profileId)
  return operationsScope(access, unitIds, assignedTicketIds)
}

// ---------------------------------------------------------------------------
// Visibility predicates — the JS twin of the SELECT policies
// ---------------------------------------------------------------------------

function ticketVisible(ticket: ServiceTicket, scope: OperationsScope): boolean {
  if (scope.denied) return false
  if (scope.staffWide) return true
  if (ticket.unitId !== null && scope.unitIds.includes(ticket.unitId))
    return true
  if (
    scope.selfProfileId !== null &&
    ticket.requesterProfileId === scope.selfProfileId
  ) {
    return true
  }
  if (
    scope.selfProfileId !== null &&
    ticket.assigneeProfileId === scope.selfProfileId
  ) {
    return true
  }
  return scope.assignedTicketIds.includes(ticket.id)
}

function activityVisible(activity: Activity, scope: OperationsScope): boolean {
  if (scope.denied) return false
  if (scope.staffWide) return true
  // Residents see the published calendar; drafts stay internal, because an
  // activity still being planned is not a promise to a resident.
  return activity.status !== "draft"
}

function workforceTaskVisible(
  task: WorkforceTask,
  scope: OperationsScope
): boolean {
  if (scope.denied) return false
  if (scope.staffWide) return true
  if (
    scope.selfProfileId !== null &&
    task.assigneeProfileId === scope.selfProfileId
  ) {
    return true
  }
  return task.unitId !== null && scope.unitIds.includes(task.unitId)
}

function mediaReportColumnsFor(scope: OperationsScope): string {
  return scope.staffWide ? MEDIA_REPORT_COLUMNS : MEDIA_REPORT_COLUMNS_SCOPED
}

/**
 * Blank the reporter's contact on a row a non-staff caller is about to receive.
 * The seed twin of not selecting the columns, so the two modes are
 * indistinguishable to a caller.
 */
function narrowMediaReport(report: MediaReport): MediaReport {
  return {
    ...report,
    reporterName: null,
    reporterEmail: null,
    reporterPhone: null,
  }
}

function applyMediaReportProjection(
  reports: readonly MediaReport[],
  scope: OperationsScope
): MediaReport[] {
  if (scope.staffWide) return [...reports]
  return reports.map(narrowMediaReport)
}

function mediaReportVisible(
  report: MediaReport,
  scope: OperationsScope
): boolean {
  if (scope.denied) return false
  if (scope.staffWide) return true
  if (report.unitId !== null && scope.unitIds.includes(report.unitId))
    return true
  if (
    scope.selfProfileId !== null &&
    report.reporterProfileId === scope.selfProfileId
  ) {
    return true
  }
  return (
    report.ticketId !== null &&
    scope.assignedTicketIds.includes(report.ticketId)
  )
}

// ---------------------------------------------------------------------------
// Shared query plumbing
// ---------------------------------------------------------------------------

export interface PageOptions {
  /** Clamped to [1, 500]; defaults to 50. Never unbounded. */
  limit?: number
  offset?: number
}

function compareDesc(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a < b ? 1 : -1
}

function compareAsc(a: string | null, b: string | null): number {
  return -compareDesc(a, b)
}

function paginate<T>(rows: readonly T[], options: PageOptions): T[] {
  const limit = clampLimit(options.limit)
  const offset = clampOffset(options.offset)
  return rows.slice(offset, offset + limit)
}

/**
 * Build a PostgREST `or=(…)` clause list for a non-staff caller.
 * An empty list means nothing is visible, and the caller must return `[]`
 * WITHOUT querying — `.or("")` would be a syntax error, and, more importantly,
 * an unfiltered query would lean on RLS alone.
 */
function ticketOrClauses(scope: OperationsScope): string[] {
  const clauses: string[] = []
  if (scope.unitIds.length > 0)
    clauses.push(`unit_id.in.(${scope.unitIds.join(",")})`)
  if (scope.selfProfileId !== null) {
    clauses.push(`requester_profile_id.eq.${scope.selfProfileId}`)
    clauses.push(`assignee_profile_id.eq.${scope.selfProfileId}`)
  }
  if (scope.assignedTicketIds.length > 0) {
    clauses.push(`id.in.(${scope.assignedTicketIds.join(",")})`)
  }
  return clauses
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export interface TicketQuery extends OperationsAccess, PageOptions {
  companyId?: string
  siteId?: string
  unitId?: string
  status?: TicketStatus
  /** Convenience for a board: every status that is not resolved/closed/cancelled. */
  openOnly?: boolean
  priority?: TicketPriority
  severity?: TicketSeverity
  category?: TicketCategory
  assigneeProfileId?: string
  requesterProfileId?: string
  requiresFinanceApproval?: boolean
  /** Only tickets whose `sla_due_at` has passed and which are not terminal. */
  slaBreachedOnly?: boolean
  /** Reference instant for `slaBreachedOnly`. Defaults to the repository clock. */
  asOf?: string
}

function isSlaBreached(ticket: ServiceTicket, asOf: string): boolean {
  if (ticket.slaDueAt === null) return false
  if (terminalTicketStatuses.includes(ticket.status)) return false
  return ticket.slaDueAt < asOf
}

function seedTicketsFiltered(
  query: TicketQuery,
  scope: OperationsScope,
  asOf: string
) {
  const rows = seedServiceTickets()
    .filter((ticket) => ticketVisible(ticket, scope))
    .filter(
      (ticket) =>
        query.companyId === undefined || ticket.companyId === query.companyId
    )
    .filter(
      (ticket) => query.siteId === undefined || ticket.siteId === query.siteId
    )
    .filter(
      (ticket) => query.unitId === undefined || ticket.unitId === query.unitId
    )
    .filter(
      (ticket) => query.status === undefined || ticket.status === query.status
    )
    .filter(
      (ticket) =>
        query.openOnly !== true ||
        !terminalTicketStatuses.includes(ticket.status)
    )
    .filter(
      (ticket) =>
        query.priority === undefined || ticket.priority === query.priority
    )
    .filter(
      (ticket) =>
        query.severity === undefined || ticket.severity === query.severity
    )
    .filter(
      (ticket) =>
        query.category === undefined || ticket.category === query.category
    )
    .filter(
      (ticket) =>
        query.assigneeProfileId === undefined ||
        ticket.assigneeProfileId === query.assigneeProfileId
    )
    .filter(
      (ticket) =>
        query.requesterProfileId === undefined ||
        ticket.requesterProfileId === query.requesterProfileId
    )
    .filter(
      (ticket) =>
        query.requiresFinanceApproval === undefined ||
        ticket.requiresFinanceApproval === query.requiresFinanceApproval
    )
    .filter(
      (ticket) => query.slaBreachedOnly !== true || isSlaBreached(ticket, asOf)
    )
    .sort((a, b) => compareDesc(a.reportedAt, b.reportedAt))
  return paginate(rows, query)
}

async function fetchTicketRows(
  client: RepositoryClient,
  query: TicketQuery,
  scope: OperationsScope,
  page: PageOptions,
  asOf: string
): Promise<ServiceTicket[]> {
  if (scope.denied) return []

  let builder = client.from(T_TICKETS).select(TICKET_COLUMNS)

  if (!scope.staffWide) {
    const clauses = ticketOrClauses(scope)
    // Nothing in scope. An empty result under `source: "supabase"` — never a
    // reason to fall back to seed data.
    if (clauses.length === 0) return []
    builder = builder.or(clauses.join(","))
  }

  if (query.companyId !== undefined)
    builder = builder.eq("company_id", query.companyId)
  if (query.siteId !== undefined) builder = builder.eq("site_id", query.siteId)
  if (query.unitId !== undefined) builder = builder.eq("unit_id", query.unitId)
  if (query.status !== undefined) builder = builder.eq("status", query.status)
  if (query.openOnly === true) {
    builder = builder.not(
      "status",
      "in",
      `(${terminalTicketStatuses.join(",")})`
    )
  }
  if (query.priority !== undefined)
    builder = builder.eq("priority", query.priority)
  if (query.severity !== undefined)
    builder = builder.eq("severity", query.severity)
  if (query.category !== undefined)
    builder = builder.eq("category", query.category)
  if (query.assigneeProfileId !== undefined) {
    builder = builder.eq("assignee_profile_id", query.assigneeProfileId)
  }
  if (query.requesterProfileId !== undefined) {
    builder = builder.eq("requester_profile_id", query.requesterProfileId)
  }
  if (query.requiresFinanceApproval !== undefined) {
    builder = builder.eq(
      "requires_finance_approval",
      query.requiresFinanceApproval
    )
  }
  if (query.slaBreachedOnly === true) {
    builder = builder
      .lt("sla_due_at", asOf)
      .not("status", "in", `(${terminalTicketStatuses.join(",")})`)
  }

  const limit = clampLimit(page.limit)
  const offset = clampOffset(page.offset)
  const response = await builder
    .order("reported_at", { ascending: false })
    .range(offset, offset + limit - 1)

  return unwrap<unknown[]>(response, []).map(mapTicket)
}

/** Tickets in the caller's scope, newest report first. */
export async function getTickets(
  query: TicketQuery = {}
): Promise<RepositoryResult<ServiceTicket[]>> {
  const asOf = query.asOf ?? nowIso()
  return withRepository(
    async (client) => {
      const scope = await scopeFor(client, query)
      return fetchTicketRows(client, query, scope, query, asOf)
    },
    () => seedTicketsFiltered(query, seedScope(query), asOf),
    "operations.getTickets"
  )
}

/**
 * One ticket, or `null` when it does not exist **or** the caller's scope
 * excludes it. Both map to 404 at the route: telling a tenant that ticket X
 * exists but belongs to another unit is itself a disclosure.
 */
export async function getTicket(
  id: string,
  access: OperationsAccess = {}
): Promise<RepositoryResult<ServiceTicket | null>> {
  return withRepository(
    async (client) => {
      const scope = await scopeFor(client, access)
      if (scope.denied) return null
      const response = await client
        .from(T_TICKETS)
        .select(TICKET_COLUMNS)
        .eq("id", id)
        .maybeSingle()
      const row = unwrap<unknown>(response, null)
      if (row === null) return null
      const ticket = mapTicket(row)
      return ticketVisible(ticket, scope) ? ticket : null
    },
    () => {
      const scope = seedScope(access)
      const ticket = seedServiceTickets().find(
        (candidate) => candidate.id === id
      )
      if (ticket === undefined) return null
      return ticketVisible(ticket, scope) ? ticket : null
    },
    "operations.getTicket"
  )
}

/**
 * The full history of one ticket, oldest first.
 *
 * Visibility is delegated to the ticket: everyone who is not staff sees exactly
 * the history of the tickets they can already see, mirroring
 * `current_user_can_view_ticket()`. Restating the ticket predicate here is how
 * the two would drift.
 */
export async function getTicketEvents(
  ticketId: string,
  access: OperationsAccess = {},
  page: PageOptions = {}
): Promise<RepositoryResult<TicketEvent[]>> {
  return withRepository(
    async (client) => {
      const scope = await scopeFor(client, access)
      if (scope.denied) return []
      const ticketResponse = await client
        .from(T_TICKETS)
        .select(TICKET_COLUMNS)
        .eq("id", ticketId)
        .maybeSingle()
      const ticketRow = unwrap<unknown>(ticketResponse, null)
      if (ticketRow === null) return []
      if (!ticketVisible(mapTicket(ticketRow), scope)) return []

      const limit = clampLimit(page.limit)
      const offset = clampOffset(page.offset)
      const response = await client
        .from(T_TICKET_EVENTS)
        .select(TICKET_EVENT_COLUMNS)
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: true })
        .range(offset, offset + limit - 1)
      return unwrap<unknown[]>(response, []).map(mapTicketEvent)
    },
    () => {
      const scope = seedScope(access)
      const ticket = seedServiceTickets().find(
        (candidate) => candidate.id === ticketId
      )
      if (ticket === undefined || !ticketVisible(ticket, scope)) return []
      const rows = seedTicketEvents()
        .filter((event) => event.ticketId === ticketId)
        .sort((a, b) => compareAsc(a.createdAt, b.createdAt))
      return paginate(rows, page)
    },
    "operations.getTicketEvents"
  )
}

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

export interface ActivityQuery extends OperationsAccess, PageOptions {
  companyId?: string
  siteId?: string
  status?: ActivityStatus
  category?: ActivityCategory
  /** Inclusive ISO bounds on `starts_at`. */
  startsAfter?: string
  startsBefore?: string
  /** Only activities that have not started yet, relative to `asOf`. */
  upcomingOnly?: boolean
  asOf?: string
}

function seedActivitiesFiltered(
  query: ActivityQuery,
  scope: OperationsScope,
  asOf: string
): Activity[] {
  const rows = seedActivities()
    .filter((activity) => activityVisible(activity, scope))
    .filter(
      (activity) =>
        query.companyId === undefined || activity.companyId === query.companyId
    )
    .filter(
      (activity) =>
        query.siteId === undefined || activity.siteId === query.siteId
    )
    .filter(
      (activity) =>
        query.status === undefined || activity.status === query.status
    )
    .filter(
      (activity) =>
        query.category === undefined || activity.category === query.category
    )
    .filter(
      (activity) =>
        query.startsAfter === undefined ||
        activity.startsAt >= query.startsAfter
    )
    .filter(
      (activity) =>
        query.startsBefore === undefined ||
        activity.startsAt <= query.startsBefore
    )
    .filter(
      (activity) => query.upcomingOnly !== true || activity.startsAt >= asOf
    )
    .sort((a, b) => compareAsc(a.startsAt, b.startsAt))
  return paginate(rows, query)
}

async function fetchActivityRows(
  client: RepositoryClient,
  query: ActivityQuery,
  scope: OperationsScope,
  page: PageOptions,
  asOf: string
): Promise<Activity[]> {
  if (scope.denied) return []

  let builder = client.from(T_ACTIVITIES).select(ACTIVITY_COLUMNS)
  if (!scope.staffWide) builder = builder.neq("status", "draft")
  if (query.companyId !== undefined)
    builder = builder.eq("company_id", query.companyId)
  if (query.siteId !== undefined) builder = builder.eq("site_id", query.siteId)
  if (query.status !== undefined) builder = builder.eq("status", query.status)
  if (query.category !== undefined)
    builder = builder.eq("category", query.category)
  if (query.startsAfter !== undefined)
    builder = builder.gte("starts_at", query.startsAfter)
  if (query.startsBefore !== undefined)
    builder = builder.lte("starts_at", query.startsBefore)
  if (query.upcomingOnly === true) builder = builder.gte("starts_at", asOf)

  const limit = clampLimit(page.limit)
  const offset = clampOffset(page.offset)
  const response = await builder
    .order("starts_at", { ascending: true })
    .range(offset, offset + limit - 1)
  return unwrap<unknown[]>(response, []).map(mapActivity)
}

export async function getActivities(
  query: ActivityQuery = {}
): Promise<RepositoryResult<Activity[]>> {
  const asOf = query.asOf ?? nowIso()
  return withRepository(
    async (client) => {
      const scope = await scopeFor(client, query)
      return fetchActivityRows(client, query, scope, query, asOf)
    },
    () => seedActivitiesFiltered(query, seedScope(query), asOf),
    "operations.getActivities"
  )
}

// ---------------------------------------------------------------------------
// Workforce tasks
// ---------------------------------------------------------------------------

export interface WorkforceTaskQuery extends OperationsAccess, PageOptions {
  companyId?: string
  siteId?: string
  ticketId?: string
  unitId?: string
  assigneeProfileId?: string
  team?: string
  status?: WorkforceTaskStatus
  priority?: TicketPriority
  openOnly?: boolean
  slaBreachedOnly?: boolean
  asOf?: string
}

function isTaskSlaBreached(task: WorkforceTask, asOf: string): boolean {
  if (task.slaDueAt === null) return false
  if (terminalWorkforceTaskStatuses.includes(task.status)) return false
  return task.slaDueAt < asOf
}

function seedWorkforceTasksFiltered(
  query: WorkforceTaskQuery,
  scope: OperationsScope,
  asOf: string
): WorkforceTask[] {
  const rows = seedWorkforceTasks()
    .filter((task) => workforceTaskVisible(task, scope))
    .filter(
      (task) =>
        query.companyId === undefined || task.companyId === query.companyId
    )
    .filter(
      (task) => query.siteId === undefined || task.siteId === query.siteId
    )
    .filter(
      (task) => query.ticketId === undefined || task.ticketId === query.ticketId
    )
    .filter(
      (task) => query.unitId === undefined || task.unitId === query.unitId
    )
    .filter(
      (task) =>
        query.assigneeProfileId === undefined ||
        task.assigneeProfileId === query.assigneeProfileId
    )
    .filter((task) => query.team === undefined || task.team === query.team)
    .filter(
      (task) => query.status === undefined || task.status === query.status
    )
    .filter(
      (task) => query.priority === undefined || task.priority === query.priority
    )
    .filter(
      (task) =>
        query.openOnly !== true ||
        !terminalWorkforceTaskStatuses.includes(task.status)
    )
    .filter(
      (task) => query.slaBreachedOnly !== true || isTaskSlaBreached(task, asOf)
    )
    .sort((a, b) => compareDesc(a.createdAt, b.createdAt))
  return paginate(rows, query)
}

async function fetchWorkforceTaskRows(
  client: RepositoryClient,
  query: WorkforceTaskQuery,
  scope: OperationsScope,
  page: PageOptions,
  asOf: string
): Promise<WorkforceTask[]> {
  if (scope.denied) return []

  let builder = client.from(T_WORKFORCE_TASKS).select(WORKFORCE_TASK_COLUMNS)
  if (!scope.staffWide) {
    const clauses: string[] = []
    if (scope.selfProfileId !== null) {
      clauses.push(`assignee_profile_id.eq.${scope.selfProfileId}`)
    }
    if (scope.unitIds.length > 0)
      clauses.push(`unit_id.in.(${scope.unitIds.join(",")})`)
    if (clauses.length === 0) return []
    builder = builder.or(clauses.join(","))
  }

  if (query.companyId !== undefined)
    builder = builder.eq("company_id", query.companyId)
  if (query.siteId !== undefined) builder = builder.eq("site_id", query.siteId)
  if (query.ticketId !== undefined)
    builder = builder.eq("ticket_id", query.ticketId)
  if (query.unitId !== undefined) builder = builder.eq("unit_id", query.unitId)
  if (query.assigneeProfileId !== undefined) {
    builder = builder.eq("assignee_profile_id", query.assigneeProfileId)
  }
  if (query.team !== undefined) builder = builder.eq("team", query.team)
  if (query.status !== undefined) builder = builder.eq("status", query.status)
  if (query.priority !== undefined)
    builder = builder.eq("priority", query.priority)
  if (query.openOnly === true) {
    builder = builder.not(
      "status",
      "in",
      `(${terminalWorkforceTaskStatuses.join(",")})`
    )
  }
  if (query.slaBreachedOnly === true) {
    builder = builder
      .lt("sla_due_at", asOf)
      .not("status", "in", `(${terminalWorkforceTaskStatuses.join(",")})`)
  }

  const limit = clampLimit(page.limit)
  const offset = clampOffset(page.offset)
  const response = await builder
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)
  return unwrap<unknown[]>(response, []).map(mapWorkforceTask)
}

export async function getWorkforceTasks(
  query: WorkforceTaskQuery = {}
): Promise<RepositoryResult<WorkforceTask[]>> {
  const asOf = query.asOf ?? nowIso()
  return withRepository(
    async (client) => {
      const scope = await scopeFor(client, query)
      return fetchWorkforceTaskRows(client, query, scope, query, asOf)
    },
    () => seedWorkforceTasksFiltered(query, seedScope(query), asOf),
    "operations.getWorkforceTasks"
  )
}

// ---------------------------------------------------------------------------
// Media reports
// ---------------------------------------------------------------------------

export interface MediaReportQuery extends OperationsAccess, PageOptions {
  companyId?: string
  siteId?: string
  unitId?: string
  ticketId?: string
  status?: MediaReportStatus
  isPublicIntake?: boolean
  /** Only reports that have not been triaged yet. */
  untriagedOnly?: boolean
}

function seedMediaReportsFiltered(
  query: MediaReportQuery,
  scope: OperationsScope
): MediaReport[] {
  const rows = seedMediaReports()
    .filter((report) => mediaReportVisible(report, scope))
    .filter(
      (report) =>
        query.companyId === undefined || report.companyId === query.companyId
    )
    .filter(
      (report) => query.siteId === undefined || report.siteId === query.siteId
    )
    .filter(
      (report) => query.unitId === undefined || report.unitId === query.unitId
    )
    .filter(
      (report) =>
        query.ticketId === undefined || report.ticketId === query.ticketId
    )
    .filter(
      (report) => query.status === undefined || report.status === query.status
    )
    .filter(
      (report) =>
        query.isPublicIntake === undefined ||
        report.isPublicIntake === query.isPublicIntake
    )
    .filter((report) => query.untriagedOnly !== true || report.status === "new")
    .sort((a, b) => compareDesc(a.createdAt, b.createdAt))
  return applyMediaReportProjection(paginate(rows, query), scope)
}

async function fetchMediaReportRows(
  client: RepositoryClient,
  query: MediaReportQuery,
  scope: OperationsScope,
  page: PageOptions
): Promise<MediaReport[]> {
  if (scope.denied) return []

  // Narrowed for anyone below staff: the reporter's contact details are not
  // selected at all, so they never cross the wire to a resident.
  let builder = client.from(T_MEDIA_REPORTS).select(mediaReportColumnsFor(scope))
  if (!scope.staffWide) {
    const clauses: string[] = []
    if (scope.unitIds.length > 0)
      clauses.push(`unit_id.in.(${scope.unitIds.join(",")})`)
    if (scope.selfProfileId !== null) {
      clauses.push(`reporter_profile_id.eq.${scope.selfProfileId}`)
    }
    if (scope.assignedTicketIds.length > 0) {
      clauses.push(`ticket_id.in.(${scope.assignedTicketIds.join(",")})`)
    }
    if (clauses.length === 0) return []
    builder = builder.or(clauses.join(","))
  }

  if (query.companyId !== undefined)
    builder = builder.eq("company_id", query.companyId)
  if (query.siteId !== undefined) builder = builder.eq("site_id", query.siteId)
  if (query.unitId !== undefined) builder = builder.eq("unit_id", query.unitId)
  if (query.ticketId !== undefined)
    builder = builder.eq("ticket_id", query.ticketId)
  if (query.status !== undefined) builder = builder.eq("status", query.status)
  if (query.isPublicIntake !== undefined) {
    builder = builder.eq("is_public_intake", query.isPublicIntake)
  }
  if (query.untriagedOnly === true) builder = builder.eq("status", "new")

  const limit = clampLimit(page.limit)
  const offset = clampOffset(page.offset)
  const response = await builder
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)
  return applyMediaReportProjection(
    unwrap<unknown[]>(response, []).map(mapMediaReport),
    scope
  )
}

export async function getMediaReports(
  query: MediaReportQuery = {}
): Promise<RepositoryResult<MediaReport[]>> {
  return withRepository(
    async (client) => {
      const scope = await scopeFor(client, query)
      return fetchMediaReportRows(client, query, scope, query)
    },
    () => seedMediaReportsFiltered(query, seedScope(query)),
    "operations.getMediaReports"
  )
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface OperationsSummaryQuery extends OperationsAccess {
  companyId?: string
  siteId?: string
  /** Reference instant for the SLA clock. Defaults to now. */
  asOf?: string
}

export interface OperationsSummary {
  asOf: string
  ticketsByStatus: Record<TicketStatus, number>
  ticketsByPriority: Record<TicketPriority, number>
  ticketsBySeverity: Record<TicketSeverity, number>
  ticketsByCategory: Record<TicketCategory, number>
  /** Everything not resolved, closed or cancelled. */
  openTickets: number
  /** Open tickets whose `sla_due_at` has passed. */
  slaBreachedTickets: number
  /** Their ids, so a UI can link straight to them without a second query. */
  slaBreachedTicketIds: string[]
  ticketsAwaitingFinanceApproval: number
  unassignedOpenTickets: number
  tasksByStatus: Record<WorkforceTaskStatus, number>
  openTasks: number
  slaBreachedTasks: number
  activitiesByStatus: Record<ActivityStatus, number>
  upcomingActivities: number
  mediaReportsByStatus: Record<MediaReportStatus, number>
  untriagedMediaReports: number
  /**
   * Estimated cost of open tickets, PER CURRENCY. Adding EUR to TRY would be
   * meaningless (CONVENTIONS §5), so the UI receives one total per code and
   * decides how to present them.
   */
  openEstimatedCostByCurrency: Record<string, number>
  /** Open tickets carrying no estimate at all — a gap, not a zero. */
  openTicketsWithoutEstimate: number
}

/**
 * Zeroed counters for every member of a union. `{} as Record<K, number>` is the
 * only cast in this file: the loop immediately fills every key, so the assertion
 * is discharged on the next line rather than carried around.
 */
function zeroCounts<K extends string>(keys: readonly K[]): Record<K, number> {
  const counts = {} as Record<K, number>
  for (const key of keys) counts[key] = 0
  return counts
}

const SUMMARY_PAGE: PageOptions = { limit: 500 }

function buildOperationsSummary(
  tickets: readonly ServiceTicket[],
  tasks: readonly WorkforceTask[],
  activities: readonly Activity[],
  reports: readonly MediaReport[],
  asOf: string
): OperationsSummary {
  const ticketsByStatus = zeroCounts(ticketStatuses)
  const ticketsByPriority = zeroCounts(ticketPriorities)
  const ticketsBySeverity = zeroCounts(ticketSeverities)
  const ticketsByCategory = zeroCounts(ticketCategories)
  const tasksByStatus = zeroCounts(workforceTaskStatuses)
  const activitiesByStatus = zeroCounts(activityStatuses)
  const mediaReportsByStatus = zeroCounts(mediaReportStatuses)

  const slaBreachedTicketIds: string[] = []
  const openEstimates: Array<{ amount: number; currency: string }> = []
  let openTickets = 0
  let ticketsAwaitingFinanceApproval = 0
  let unassignedOpenTickets = 0
  let openTicketsWithoutEstimate = 0

  for (const ticket of tickets) {
    ticketsByStatus[ticket.status] += 1
    ticketsByPriority[ticket.priority] += 1
    ticketsBySeverity[ticket.severity] += 1
    ticketsByCategory[ticket.category] += 1

    if (terminalTicketStatuses.includes(ticket.status)) continue
    openTickets += 1
    if (ticket.assigneeProfileId === null) unassignedOpenTickets += 1
    if (ticket.requiresFinanceApproval) ticketsAwaitingFinanceApproval += 1
    if (isSlaBreached(ticket, asOf)) slaBreachedTicketIds.push(ticket.id)

    const estimate: Money | null = ticket.estimatedCost
    if (estimate === null) {
      // No estimate is an honest gap. Counting it as 0 would understate the
      // exposure and make the total look more precise than it is.
      openTicketsWithoutEstimate += 1
    } else {
      openEstimates.push({
        amount: estimate.amount,
        currency: estimate.currency,
      })
    }
  }

  let slaBreachedTasks = 0
  let openTasks = 0
  for (const task of tasks) {
    tasksByStatus[task.status] += 1
    if (terminalWorkforceTaskStatuses.includes(task.status)) continue
    openTasks += 1
    if (isTaskSlaBreached(task, asOf)) slaBreachedTasks += 1
  }

  let upcomingActivities = 0
  for (const activity of activities) {
    activitiesByStatus[activity.status] += 1
    if (activity.startsAt >= asOf && activity.status !== "cancelled") {
      upcomingActivities += 1
    }
  }

  let untriagedMediaReports = 0
  for (const report of reports) {
    mediaReportsByStatus[report.status] += 1
    if (report.status === "new") untriagedMediaReports += 1
  }

  return {
    asOf,
    ticketsByStatus,
    ticketsByPriority,
    ticketsBySeverity,
    ticketsByCategory,
    openTickets,
    slaBreachedTickets: slaBreachedTicketIds.length,
    slaBreachedTicketIds,
    ticketsAwaitingFinanceApproval,
    unassignedOpenTickets,
    tasksByStatus,
    openTasks,
    slaBreachedTasks,
    activitiesByStatus,
    upcomingActivities,
    mediaReportsByStatus,
    untriagedMediaReports,
    openEstimatedCostByCurrency: totalsByCurrency(openEstimates),
    openTicketsWithoutEstimate,
  }
}

/**
 * Open work by status and priority, plus the SLA breaches.
 *
 * One page (500 rows) per table. A site with more than 500 tickets in scope
 * needs a SQL-side aggregate; that is a request for W1-A rather than a bigger
 * fetch here — see HANDOFF.
 */
export async function getOperationsSummary(
  query: OperationsSummaryQuery = {}
): Promise<RepositoryResult<OperationsSummary>> {
  const asOf = query.asOf ?? nowIso()
  const scoped: TicketQuery &
    WorkforceTaskQuery &
    ActivityQuery &
    MediaReportQuery = {
    ...query,
    ...SUMMARY_PAGE,
  }

  return withRepository(
    async (client) => {
      const scope = await scopeFor(client, query)
      // Sequential, not `Promise.all`: a rejection must not leave sibling queries
      // running, and a throwing query is the signal this layer must not swallow.
      const tickets = await fetchTicketRows(
        client,
        scoped,
        scope,
        SUMMARY_PAGE,
        asOf
      )
      const tasks = await fetchWorkforceTaskRows(
        client,
        scoped,
        scope,
        SUMMARY_PAGE,
        asOf
      )
      const activities = await fetchActivityRows(
        client,
        scoped,
        scope,
        SUMMARY_PAGE,
        asOf
      )
      const reports = await fetchMediaReportRows(
        client,
        scoped,
        scope,
        SUMMARY_PAGE
      )
      return buildOperationsSummary(tickets, tasks, activities, reports, asOf)
    },
    () => {
      const scope = seedScope(query)
      return buildOperationsSummary(
        seedTicketsFiltered(scoped, scope, asOf),
        seedWorkforceTasksFiltered(scoped, scope, asOf),
        seedActivitiesFiltered(scoped, scope, asOf),
        seedMediaReportsFiltered(scoped, scope),
        asOf
      )
    },
    "operations.getOperationsSummary"
  )
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface AppendTicketEventInput extends OperationsAccess {
  ticketId: string
  companyId: string
  kind: TicketEventKind
  actorProfileId?: string | null
  fromStatus?: TicketStatus | null
  toStatus?: TicketStatus | null
  note?: string | null
  payload?: Record<string, unknown>
}

function ticketEventInsertPayload(
  input: AppendTicketEventInput
): Record<string, unknown> {
  return {
    ticket_id: input.ticketId,
    company_id: input.companyId,
    kind: input.kind,
    actor_profile_id: input.actorProfileId ?? null,
    from_status: input.fromStatus ?? null,
    to_status: input.toStatus ?? null,
    note: input.note ?? null,
    payload: input.payload ?? {},
  }
}

/**
 * Append one history row. There is no update and no delete counterpart, and
 * there cannot be: the trigger rejects both with 42501 and the table carries no
 * policy for either. A correction is a further event.
 *
 * A `status_changed` event must name the status it moved to — a CHECK enforces
 * it, because an event that records no transition is a lie about what happened.
 */
export async function appendTicketEvent(
  input: AppendTicketEventInput
): Promise<RepositoryResult<TicketEvent>> {
  if (input.kind === "status_changed" && (input.toStatus ?? null) === null) {
    throw new RepositoryError({
      code: "validation_failed",
      message: "A status change must name the status it moved to.",
      retryable: false,
    })
  }
  const createdAt = nowIso()

  return withRepository(
    async (client) => {
      const scope = await scopeFor(client, input)
      if (scope.denied) {
        throw new RepositoryError({
          code: "forbidden",
          message: "You do not have access to this data.",
          retryable: false,
        })
      }
      const response = await client
        .from(T_TICKET_EVENTS)
        .insert(ticketEventInsertPayload(input))
        .select(TICKET_EVENT_COLUMNS)
        .maybeSingle()
      const row = unwrap<unknown>(response, null)
      if (row === null) {
        throw new RepositoryError({
          code: "persistence_unavailable",
          message: "The data service is temporarily unavailable.",
          retryable: true,
        })
      }
      return mapTicketEvent(row)
    },
    () => {
      // Seed mode SIMULATES: the row is returned but nothing is stored, because
      // the seed builders are pure and must stay deterministic across runs.
      const event: TicketEvent = {
        id: `c2ffffff-0000-4000-8000-${input.ticketId.slice(-12)}`,
        ticketId: input.ticketId,
        companyId: input.companyId,
        kind: input.kind,
        actorProfileId: input.actorProfileId ?? null,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        note: input.note ?? null,
        payload: input.payload ?? {},
        createdAt,
      }
      return event
    },
    "operations.appendTicketEvent"
  )
}

export interface UpdateTicketStatusInput extends OperationsAccess {
  ticketId: string
  /** The version the caller read. A mismatch is a 409, never a silent overwrite. */
  expectedVersion: number
  toStatus: TicketStatus
  actorProfileId?: string | null
  note?: string | null
  /**
   * Who the work now belongs to. **Required when `toStatus` is `assigned`.**
   *
   * Before this existed, the write payload was `{ status, ...timestamps }` and
   * nothing else. "Assign" therefore returned 200, moved the ticket to
   * `assigned`, and left `assignee_profile_id` NULL — a lift repair marked as
   * assigned to nobody, which reads as handled on every list in the product and
   * is the most expensive kind of wrong a maintenance system can be. The
   * repository now refuses that transition without a name.
   */
  assigneeProfileId?: string | null
}

export interface UpdateTicketStatusResult {
  ticket: ServiceTicket
  /** The appended history row, or `null` when the history write did not land. */
  event: TicketEvent | null
}

/**
 * Move a ticket to a new status under optimistic concurrency, and record the
 * move in the append-only history.
 *
 * The UPDATE carries `.eq("version", expectedVersion)`. Two dispatchers who both
 * read version 3 cannot both win: the second matches zero rows and receives
 * `conflict` (409). `bump_service_tickets_version` moves the column, so the
 * guard is real rather than advisory.
 *
 * The status change and its history row are two statements, not one transaction.
 * A crash between them leaves a moved ticket with no event — the correct fix is
 * a SQL-side RPC that does both atomically, which is a request for W1-A and is
 * recorded in HANDOFF rather than papered over here.
 */
export async function updateTicketStatus(
  input: UpdateTicketStatusInput
): Promise<RepositoryResult<UpdateTicketStatusResult>> {
  const at = nowIso()

  const conflict = (): never => {
    throw new RepositoryError({
      code: "conflict",
      message:
        "The record changed while you were editing it. Reload and try again.",
      retryable: true,
    })
  }

  const statusTimestamps = (
    toStatus: TicketStatus
  ): Record<string, unknown> => {
    if (toStatus === "resolved") return { resolved_at: at }
    if (toStatus === "closed") return { closed_at: at }
    if (toStatus === "cancelled") return { closed_at: at }
    return {}
  }

  // An assignment with nobody in it is not an assignment. Refused here rather
  // than in the route, so every caller — API, server action, a future job — is
  // held to it by the same line.
  if (
    input.toStatus === "assigned" &&
    (input.assigneeProfileId === undefined ||
      input.assigneeProfileId === null ||
      input.assigneeProfileId.length === 0)
  ) {
    throw new RepositoryError({
      code: "validation_failed",
      message: "Choose who should take this job before assigning it.",
      retryable: false,
    })
  }

  return withRepository(
    async (client) => {
      const scope = await scopeFor(client, input)
      if (scope.denied) {
        throw new RepositoryError({
          code: "forbidden",
          message: "You do not have access to this data.",
          retryable: false,
        })
      }

      const before = await client
        .from(T_TICKETS)
        .select(TICKET_COLUMNS)
        .eq("id", input.ticketId)
        .maybeSingle()
      const beforeRow = unwrap<unknown>(before, null)
      if (beforeRow === null) {
        throw new RepositoryError({
          code: "not_found",
          message: "That record was not found.",
          retryable: false,
        })
      }
      const previous = mapTicket(beforeRow)
      if (!ticketVisible(previous, scope)) {
        throw new RepositoryError({
          code: "not_found",
          message: "That record was not found.",
          retryable: false,
        })
      }

      const response = await client
        .from(T_TICKETS)
        .update({
          status: input.toStatus,
          ...statusTimestamps(input.toStatus),
          // The assignee travels with the status, in the same optimistic-locked
          // UPDATE, so a ticket can never be `assigned` to nobody: either both
          // land or the version check rejects both.
          ...(input.assigneeProfileId === undefined
            ? {}
            : { assignee_profile_id: input.assigneeProfileId }),
        })
        .eq("id", input.ticketId)
        .eq("version", input.expectedVersion)
        .select(TICKET_COLUMNS)
      const rows = unwrap<unknown[]>(response, [])
      const updated = rows[0]
      if (updated === undefined) return conflict()
      const ticket = mapTicket(updated)

      const eventResult = await appendTicketEvent({
        ...input,
        companyId: ticket.companyId,
        kind: "status_changed",
        fromStatus: previous.status,
        toStatus: input.toStatus,
        note: input.note ?? null,
        actorProfileId: input.actorProfileId ?? null,
      })
      return { ticket, event: eventResult.data }
    },
    () => {
      const scope = seedScope(input)
      const previous = seedServiceTickets().find(
        (candidate) => candidate.id === input.ticketId
      )
      if (previous === undefined || !ticketVisible(previous, scope)) {
        throw new RepositoryError({
          code: "not_found",
          message: "That record was not found.",
          retryable: false,
        })
      }
      if (previous.version !== input.expectedVersion) return conflict()

      const ticket: ServiceTicket = {
        ...previous,
        status: input.toStatus,
        resolvedAt: input.toStatus === "resolved" ? at : previous.resolvedAt,
        closedAt:
          input.toStatus === "closed" || input.toStatus === "cancelled"
            ? at
            : previous.closedAt,
        version: previous.version + 1,
        updatedAt: at,
      }
      const event: TicketEvent = {
        id: `c2ffffff-0000-4000-8000-${input.ticketId.slice(-12)}`,
        ticketId: previous.id,
        companyId: previous.companyId,
        kind: "status_changed",
        actorProfileId: input.actorProfileId ?? null,
        fromStatus: previous.status,
        toStatus: input.toStatus,
        note: input.note ?? null,
        payload: {},
        createdAt: at,
      }
      return { ticket, event }
    },
    "operations.updateTicketStatus"
  )
}

// ---------------------------------------------------------------------------
// Scheduling an activity
// ---------------------------------------------------------------------------

export interface CreateActivityInput extends OperationsAccess {
  companyId: string
  siteId: string
  title: string
  description?: string
  category: ActivityCategory
  startsAt: string
  endsAt: string
  organiserProfileId?: string | null
}

/**
 * Put something on the site calendar.
 *
 * ## Who can, and the mismatch this does not paper over
 *
 * `activities_manager_write` admits admin, or level >= 70 (manager) within the
 * caller's own company. `rbac.ts` is WIDER: it also grants `activities:create`
 * to `service_provider`, `child_owner` and `child_tenant`.
 *
 * That gap is real and this function does not close it in either direction. It
 * does not widen the policy — letting a contractor or a supervised minor put a
 * site-wide event on every resident's calendar is an authority decision, not a
 * plumbing fix. And it does not silently narrow RBAC, because a permission
 * matrix quietly contradicted by a repository is worse than one that is wrong
 * out loud. The page gates its control on the intersection so nobody is offered
 * a button the database will refuse; the mismatch itself is recorded here, and
 * belongs to whoever owns the matrix.
 *
 * ## Drafts, not announcements
 *
 * `status` is not an input; the column default is `draft`. Publishing is a
 * separate decision, and an activity that could be created already `published`
 * would appear on every resident's calendar the instant somebody mistyped a
 * date, with no review step in between.
 */
export async function createActivity(
  input: CreateActivityInput
): Promise<RepositoryResult<Activity>> {
  const title = input.title.trim()
  if (title.length === 0) {
    throw new RepositoryError({
      code: "validation_failed",
      message: "Give the activity a short title.",
      retryable: false,
    })
  }
  if (Date.parse(input.endsAt) <= Date.parse(input.startsAt)) {
    throw new RepositoryError({
      code: "validation_failed",
      message: "An activity must end after it starts.",
      retryable: false,
    })
  }

  return withRepository(
    async (client) => {
      const scope = await scopeFor(client, input)
      if (scope.denied) {
        throw new RepositoryError({
          code: "forbidden",
          message: "You do not have access to this data.",
          retryable: false,
        })
      }

      const row = unwrap<unknown>(
        await client
          .from(T_ACTIVITIES)
          .insert({
            company_id: input.companyId,
            site_id: input.siteId,
            title,
            category: input.category,
            starts_at: input.startsAt,
            ends_at: input.endsAt,
            // `status` deliberately omitted — the column default is 'draft'.
            ...(input.description === undefined ||
            input.description.trim() === ""
              ? {}
              : { description: input.description.trim() }),
            ...(input.organiserProfileId === undefined ||
            input.organiserProfileId === null
              ? {}
              : { organiser_profile_id: input.organiserProfileId }),
          })
          .select(ACTIVITY_COLUMNS)
          .maybeSingle(),
        null
      )
      if (row === null) {
        throw new RepositoryError({
          code: "persistence_unavailable",
          message: "The activity could not be saved.",
          retryable: true,
        })
      }
      return mapActivity(row)
    },
    () => {
      // Seed mode SIMULATES, as every other write in this module does.
      const template = seedActivities()[0]
      if (template === undefined) {
        throw new RepositoryError({
          code: "persistence_unavailable",
          message: "The activity could not be saved.",
          retryable: true,
        })
      }
      const activity: Activity = {
        ...template,
        id: `e2ffffff-0000-4000-8000-${input.siteId.slice(-12)}`,
        companyId: input.companyId,
        siteId: input.siteId,
        title,
        description: input.description ?? null,
        category: input.category,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        status: "draft",
        organiserProfileId: input.organiserProfileId ?? null,
      }
      return activity
    },
    "operations.createActivity"
  )
}

// ---------------------------------------------------------------------------
// Opening a ticket
// ---------------------------------------------------------------------------

/**
 * The homes this person actually holds — not the homes they can see.
 *
 * Those are different sets and conflating them is a real bug, not a nicety: a
 * tenant can read other flats in their block (part of the inventory is public
 * for the sales side), while `service_tickets_insert_requester` admits a ticket
 * only against a unit in `current_user_unit_ids()`. A "which home?" picker built
 * from the visible list therefore offers choices the database will refuse, and
 * the refusal arrives as a permission error on submit rather than as an absent
 * option — which reads to the resident as the product being broken.
 *
 * Same residency join the finance module scopes statements with, so one
 * definition of "your home" serves both.
 */
export async function getOwnUnitIds(
  profileId: string | null
): Promise<RepositoryResult<string[]>> {
  return withRepository(
    async (client) => resolveScopedUnitIds(client, profileId),
    () => (profileId === null ? [] : seedUnitIdsForProfile(profileId)),
    "operations.ownUnitIds"
  )
}

export interface CreateTicketInput extends OperationsAccess {
  companyId: string
  /** Resolved from the unit when absent; required for a common-area report. */
  siteId?: string
  /** `null` or absent means the common areas — a lobby light belongs to no flat. */
  unitId?: string | null
  title: string
  description?: string | null
  category: TicketCategory
  priority: TicketPriority
  severity?: TicketSeverity
  /** The person reporting it, personally. */
  requesterProfileId: string
  idempotencyKey?: string
}

/** `TCK-1041` — the format every existing row uses. Unique per company, not globally. */
const TICKET_NO_PREFIX = "TCK-"
const TICKET_NO_FIRST = 1001
/** Two people filing at the same instant collide on the unique index; one retry each. */
const TICKET_NO_ATTEMPTS = 4

function nextTicketNo(existing: readonly string[]): string {
  let highest = TICKET_NO_FIRST - 1
  for (const value of existing) {
    if (!value.startsWith(TICKET_NO_PREFIX)) continue
    const parsed = Number.parseInt(value.slice(TICKET_NO_PREFIX.length), 10)
    if (Number.isFinite(parsed) && parsed > highest) highest = parsed
  }
  return `${TICKET_NO_PREFIX}${highest + 1}`
}

/**
 * Open a service ticket.
 *
 * `POST /api/site-management/tickets` returned 503 with "no repository write
 * path exists for ticket creation" — true, and the reason a resident could read
 * every ticket about their own flat and had no way to report a new one. The
 * only route in was to ask a manager to type it for them, which is the workflow
 * an ERP is supposed to remove.
 *
 * ## Who is allowed
 *
 * Not decided here. The insert goes through the caller's own client, so
 * `service_tickets_insert_requester` (migration 17) rules: level >= 8 — which
 * excludes `guest` and `child_guest` — filing against a unit they hold or
 * against the common areas, as themselves, untriaged. Staff and above go in
 * under `service_tickets_staff_write` instead and are not narrowed to their own
 * units. A caller outside both gets 42501, mapped to `forbidden`.
 *
 * The fields a resident must not control are simply not accepted as input:
 * there is no assignee, no status, no cost and no `resolved_at` parameter on
 * `CreateTicketInput`. A ticket starts `open` and unassigned because that is the
 * only honest initial state — anything else claims work nobody has agreed to do.
 *
 * ## ticket_no
 *
 * Read-then-write, because `ticket_no` is a human-facing reference with a
 * per-company sequence and no database sequence backs it. Two simultaneous
 * filings resolve the same number and one loses on the unique index; that is a
 * 23505, and the loop retries it with a freshly-read number rather than
 * surfacing a constraint name to a resident.
 */
export async function createTicket(
  input: CreateTicketInput
): Promise<RepositoryResult<ServiceTicket>> {
  const title = input.title.trim()
  if (title.length === 0) {
    throw new RepositoryError({
      code: "validation_failed",
      message: "Give the request a short title.",
      retryable: false,
    })
  }
  const description = (input.description ?? "").trim()
  const reportedAt = nowIso()

  return withRepository(
    async (client) => {
      const scope = await scopeFor(client, input)
      if (scope.denied) {
        throw new RepositoryError({
          code: "forbidden",
          message: "You do not have access to this data.",
          retryable: false,
        })
      }

      // A ticket needs a site and the column is NOT NULL. Prefer the unit's own
      // site over anything the caller asserted: a unit cannot be in two places,
      // and trusting the caller here would let a resident file work against a
      // site they have no connection to.
      let siteId = input.siteId ?? null
      const unitId = input.unitId ?? null
      if (unitId !== null) {
        const unitRow = unwrap<unknown>(
          await client
            .from("units")
            .select("id, site_id")
            .eq("id", unitId)
            .maybeSingle(),
          null
        )
        if (unitRow === null) {
          throw new RepositoryError({
            code: "not_found",
            message: "That home was not found.",
            retryable: false,
          })
        }
        siteId = asString(asRecord(unitRow)["site_id"])
      }
      if (siteId === null) {
        throw new RepositoryError({
          code: "validation_failed",
          message: "Choose which home or which part of the site this is about.",
          retryable: false,
        })
      }

      for (let attempt = 0; attempt < TICKET_NO_ATTEMPTS; attempt += 1) {
        const recent = unwrap<unknown[]>(
          await client
            .from(T_TICKETS)
            .select("ticket_no")
            .eq("company_id", input.companyId)
            .order("ticket_no", { ascending: false })
            .limit(1),
          []
        )
        const ticketNo = nextTicketNo(
          recent.map((row) => asString(asRecord(row)["ticket_no"]))
        )

        const response = await client
          .from(T_TICKETS)
          .insert({
            company_id: input.companyId,
            site_id: siteId,
            unit_id: unitId,
            ticket_no: ticketNo,
            title,
            description: description.length === 0 ? null : description,
            category: input.category,
            priority: input.priority,
            // Untriaged, by construction. See the doc comment.
            status: "open",
            severity: input.severity ?? "moderate",
            requester_profile_id: input.requesterProfileId,
            assignee_profile_id: null,
            reported_at: reportedAt,
            requires_finance_approval: false,
            ...(input.idempotencyKey === undefined
              ? {}
              : { idempotency_key: input.idempotencyKey }),
          })
          .select(TICKET_COLUMNS)
          .maybeSingle()

        // 23505 is the per-company ticket_no race, and only that: the other
        // unique index on this table is on a caller-supplied idempotency key,
        // where a repeat genuinely is a duplicate and must not be retried.
        const error: { code?: unknown; message?: unknown } | null =
          response.error ?? null
        if (
          error !== null &&
          error.code === "23505" &&
          String(error.message ?? "").includes("ticket_no")
        ) {
          continue
        }

        const row = unwrap<unknown>(response, null)
        if (row === null) {
          throw new RepositoryError({
            code: "persistence_unavailable",
            message: "The request could not be saved.",
            retryable: true,
          })
        }
        return mapTicket(row)
      }

      throw new RepositoryError({
        code: "conflict",
        message: "Another request was filed at the same moment. Try again.",
        retryable: true,
      })
    },
    () => {
      // Seed mode SIMULATES, as `appendTicketEvent` does: returned, not stored,
      // because the seed builders are pure and must stay deterministic.
      const template = seedServiceTickets()[0]
      if (template === undefined) {
        throw new RepositoryError({
          code: "persistence_unavailable",
          message: "The request could not be saved.",
          retryable: true,
        })
      }
      const ticket: ServiceTicket = {
        ...template,
        id: `e1ffffff-0000-4000-8000-${input.requesterProfileId.slice(-12)}`,
        companyId: input.companyId,
        siteId: input.siteId ?? template.siteId,
        unitId: input.unitId ?? null,
        ticketNo: nextTicketNo(seedServiceTickets().map((t) => t.ticketNo)),
        title,
        description: description.length === 0 ? null : description,
        category: input.category,
        priority: input.priority,
        status: "open",
        severity: input.severity ?? "moderate",
        requesterProfileId: input.requesterProfileId,
        assigneeProfileId: null,
        reportedAt,
        resolvedAt: null,
        closedAt: null,
        version: 1,
        createdAt: reportedAt,
        updatedAt: reportedAt,
      }
      return ticket
    },
    "operations.createTicket"
  )
}
