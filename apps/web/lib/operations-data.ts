/**
 * # Operations seed data — tickets, history, activities, field work, intake
 *
 * Owned by **W2-A**. Consumed by `lib/operations-repository.ts` as the
 * `fallback()` of every `withRepository()` call, and by nothing else.
 *
 * Same two rules as `lib/finance-data.ts`:
 *
 *  - **Deterministic.** Every instant is `seedIso(dayOffset)` from
 *    `SEED_ANCHOR_ISO`. No `Math.random()`, no `Date.now()`, no bare `new Date()`.
 *    A seeded board that reshuffles between runs makes Playwright snapshots
 *    worthless.
 *  - **Structurally identical to the Supabase shape.** Each builder returns
 *    exactly what the repository's mapper produces from a PostgREST row, so
 *    flipping `source` changes nothing downstream.
 *
 * The residency fixture lives in `lib/finance-data.ts` and is re-exported here.
 * Operations and finance scope owner/tenant access on the same
 * `unit_residents` edge, and a security predicate that exists twice is one that
 * will eventually disagree with itself.
 */

import type { Money } from "@/lib/contracts"
import { seedIso } from "@/lib/repository-base"
import {
  SEED_COMPANY_ID,
  SEED_PROFILE_IDS,
  SEED_SITE_ID,
} from "@/lib/finance-data"

export {
  SEED_COMPANY_ID,
  SEED_PROFILE_IDS,
  SEED_RESIDENT_IDS,
  SEED_SITE_ID,
  seedDate,
  seedGuardianships,
  seedUnitResidency,
} from "@/lib/finance-data"
export type { UnitResidency, UnitResidentRelation } from "@/lib/finance-data"

// ---------------------------------------------------------------------------
// Domain enums — the TS union and the SQL enum are the same list in the same
// order (migration 00000000000006_operations.sql).
// ---------------------------------------------------------------------------

export const ticketStatuses = [
  "draft",
  "open",
  "assigned",
  "in_progress",
  "blocked",
  "resolved",
  "closed",
  "cancelled",
] as const
export type TicketStatus = (typeof ticketStatuses)[number]

export const ticketPriorities = ["low", "normal", "high", "urgent"] as const
export type TicketPriority = (typeof ticketPriorities)[number]

export const ticketSeverities = [
  "minor",
  "moderate",
  "major",
  "critical",
] as const
export type TicketSeverity = (typeof ticketSeverities)[number]

export const ticketCategories = [
  "maintenance",
  "cleaning",
  "security",
  "technical",
  "amenity",
  "billing",
  "concierge",
  "inspection",
  "complaint",
  "other",
] as const
export type TicketCategory = (typeof ticketCategories)[number]

export const ticketEventKinds = [
  "created",
  "status_changed",
  "assigned",
  "unassigned",
  "comment",
  "escalated",
  "sla_breached",
  "cost_estimated",
  "media_attached",
  "resolved",
  "reopened",
  "closed",
  "cancelled",
] as const
export type TicketEventKind = (typeof ticketEventKinds)[number]

export const activityStatuses = [
  "draft",
  "scheduled",
  "open",
  "full",
  "in_progress",
  "completed",
  "cancelled",
] as const
export type ActivityStatus = (typeof activityStatuses)[number]

export const activityCategories = [
  "wellness",
  "sports",
  "kids",
  "social",
  "excursion",
  "dining",
  "maintenance_window",
  "other",
] as const
export type ActivityCategory = (typeof activityCategories)[number]

export const workforceTaskStatuses = [
  "open",
  "assigned",
  "in_progress",
  "blocked",
  "completed",
  "verified",
  "cancelled",
] as const
export type WorkforceTaskStatus = (typeof workforceTaskStatuses)[number]

export const mediaReportStatuses = [
  "new",
  "triaged",
  "linked",
  "resolved",
  "rejected",
  "spam",
] as const
export type MediaReportStatus = (typeof mediaReportStatuses)[number]

/**
 * The statuses that take a ticket out of the SLA clock. A ticket in any other
 * status whose `sla_due_at` is in the past is a breach.
 */
export const terminalTicketStatuses: readonly TicketStatus[] = [
  "resolved",
  "closed",
  "cancelled",
]

export const terminalWorkforceTaskStatuses: readonly WorkforceTaskStatus[] = [
  "completed",
  "verified",
  "cancelled",
]

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

export interface ServiceTicket {
  id: string
  companyId: string
  siteId: string
  /** `null` for a common-area ticket: a lobby light belongs to no dwelling. */
  unitId: string | null
  ticketNo: string
  title: string
  description: string | null
  category: TicketCategory
  priority: TicketPriority
  status: TicketStatus
  severity: TicketSeverity
  requesterProfileId: string | null
  assigneeProfileId: string | null
  reportedAt: string
  slaDueAt: string | null
  resolvedAt: string | null
  closedAt: string | null
  /**
   * `estimated_cost` and `currency` are a both-or-neither pair enforced by CHECK,
   * so they are modelled as one `Money | null` rather than two loose columns.
   * A cost without its currency is the Housearch-quotes-USD bug in a new hat.
   */
  estimatedCost: Money | null
  requiresFinanceApproval: boolean
  metadata: Record<string, unknown>
  idempotencyKey: string | null
  /** Optimistic concurrency. A stale write is a 409, never last-write-wins. */
  version: number
  createdAt: string
  updatedAt: string
}

/**
 * Append-only history. There is no `updatedAt` because a row here is never
 * updated: `reject_ticket_events_mutation` raises 42501 on UPDATE and DELETE,
 * and the table carries no UPDATE or DELETE policy at any role level. History
 * you can edit is not history.
 */
export interface TicketEvent {
  id: string
  ticketId: string
  companyId: string
  kind: TicketEventKind
  actorProfileId: string | null
  fromStatus: TicketStatus | null
  toStatus: TicketStatus | null
  note: string | null
  payload: Record<string, unknown>
  createdAt: string
}

export interface Activity {
  id: string
  companyId: string
  siteId: string
  title: string
  description: string | null
  category: ActivityCategory
  startsAt: string
  endsAt: string
  /** `null` means uncapped, never zero — a CHECK rejects 0 outright. */
  capacity: number | null
  location: string | null
  status: ActivityStatus
  organiserProfileId: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface WorkforceTask {
  id: string
  companyId: string
  siteId: string
  ticketId: string | null
  unitId: string | null
  /** A profile, deliberately not a `staff_members` row — see migration 06 §5. */
  assigneeProfileId: string | null
  taskNo: string
  title: string
  team: string | null
  status: WorkforceTaskStatus
  priority: TicketPriority
  slaDueAt: string | null
  startedAt: string | null
  completedAt: string | null
  checklist: unknown[]
  fieldNote: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface MediaReport {
  id: string
  companyId: string
  siteId: string | null
  unitId: string | null
  ticketId: string | null
  reporterProfileId: string | null
  reporterName: string | null
  reporterEmail: string | null
  reporterPhone: string | null
  description: string
  /** Storage object paths, never public URLs. Signed at read time, short TTL. */
  mediaPaths: string[]
  status: MediaReportStatus
  isPublicIntake: boolean
  triagedByProfileId: string | null
  triagedAt: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const TICKET_IDS = {
  poolPump: "c1000000-0000-4000-8000-000000000001",
  liftNoise: "c1000000-0000-4000-8000-000000000002",
  poolClean: "c1000000-0000-4000-8000-000000000003",
  facade: "c1000000-0000-4000-8000-000000000004",
  sunbed: "c1000000-0000-4000-8000-000000000005",
  invoiceQuery: "c1000000-0000-4000-8000-000000000006",
  airportTransfer: "c1000000-0000-4000-8000-000000000007",
  duplicate: "c1000000-0000-4000-8000-000000000008",
  acLeak: "c1000000-0000-4000-8000-000000000009",
} as const

/**
 * Nine tickets covering all eight statuses, all four priorities, both breached
 * and healthy SLAs, a unit-scoped and a common-area case, and two currencies on
 * `estimatedCost` so no aggregate can quietly add them together.
 */
export function seedServiceTickets(): ServiceTicket[] {
  return [
    {
      id: TICKET_IDS.poolPump,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: null,
      ticketNo: "AZW-T-0001",
      title: "Poolpumpe Block B01 fällt sporadisch aus",
      description:
        "Umwälzpumpe schaltet unter Last ab. Wasserqualität sinkt, Becken derzeit gesperrt.",
      category: "technical",
      priority: "urgent",
      status: "open",
      severity: "critical",
      requesterProfileId: SEED_PROFILE_IDS.staff,
      assigneeProfileId: null,
      reportedAt: seedIso(-4, 7),
      // Past the anchor and not terminal ⟹ a breach the summary must surface.
      slaDueAt: seedIso(-2, 7),
      resolvedAt: null,
      closedAt: null,
      estimatedCost: { amount: 8400, currency: "EUR" },
      requiresFinanceApproval: true,
      metadata: { asset: "pool_pump_b01" },
      idempotencyKey: null,
      version: 3,
      createdAt: seedIso(-4, 7),
      updatedAt: seedIso(-1, 7),
    },
    {
      id: TICKET_IDS.liftNoise,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: "AZW-B01-0001",
      ticketNo: "AZW-T-0002",
      title: "Aufzug macht Geräusche beim Anfahren",
      description: "Metallisches Schleifen zwischen 3. und 4. Etage.",
      category: "maintenance",
      priority: "high",
      status: "assigned",
      severity: "major",
      requesterProfileId: SEED_PROFILE_IDS.owner,
      assigneeProfileId: SEED_PROFILE_IDS.serviceProvider,
      reportedAt: seedIso(-3, 9),
      slaDueAt: seedIso(2, 9),
      resolvedAt: null,
      closedAt: null,
      estimatedCost: { amount: 1200, currency: "EUR" },
      requiresFinanceApproval: false,
      metadata: { asset: "lift_b01_a" },
      idempotencyKey: null,
      version: 2,
      createdAt: seedIso(-3, 9),
      updatedAt: seedIso(-2, 9),
    },
    {
      id: TICKET_IDS.poolClean,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: null,
      ticketNo: "AZW-T-0003",
      title: "Reinigung Aquapark-Rutschen vor Saisonspitze",
      description: null,
      category: "cleaning",
      priority: "normal",
      status: "in_progress",
      severity: "moderate",
      requesterProfileId: SEED_PROFILE_IDS.manager,
      assigneeProfileId: SEED_PROFILE_IDS.staff,
      reportedAt: seedIso(-2, 8),
      slaDueAt: seedIso(3, 8),
      resolvedAt: null,
      closedAt: null,
      estimatedCost: null,
      requiresFinanceApproval: false,
      metadata: {},
      idempotencyKey: null,
      version: 2,
      createdAt: seedIso(-2, 8),
      updatedAt: seedIso(0, 8),
    },
    {
      id: TICKET_IDS.facade,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: null,
      ticketNo: "AZW-T-0004",
      title: "Fassadenriss Block B03 — Gutachten ausstehend",
      description: "Statiker beauftragt. Arbeiten bis zum Befund blockiert.",
      category: "inspection",
      priority: "high",
      status: "blocked",
      severity: "major",
      requesterProfileId: SEED_PROFILE_IDS.manager,
      assigneeProfileId: SEED_PROFILE_IDS.serviceProvider,
      reportedAt: seedIso(-21, 10),
      slaDueAt: seedIso(-7, 10),
      resolvedAt: null,
      closedAt: null,
      estimatedCost: { amount: 2400, currency: "EUR" },
      requiresFinanceApproval: true,
      metadata: { blocked_by: "structural_survey" },
      idempotencyKey: null,
      version: 5,
      createdAt: seedIso(-21, 10),
      updatedAt: seedIso(-6, 10),
    },
    {
      id: TICKET_IDS.sunbed,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: null,
      ticketNo: "AZW-T-0005",
      title: "Liege am Poolrand beschädigt",
      description: null,
      category: "amenity",
      priority: "low",
      status: "resolved",
      severity: "minor",
      requesterProfileId: SEED_PROFILE_IDS.tenant,
      assigneeProfileId: SEED_PROFILE_IDS.staff,
      reportedAt: seedIso(-14, 11),
      slaDueAt: seedIso(-9, 11),
      resolvedAt: seedIso(-11, 11),
      closedAt: null,
      estimatedCost: null,
      requiresFinanceApproval: false,
      metadata: {},
      idempotencyKey: null,
      version: 4,
      createdAt: seedIso(-14, 11),
      updatedAt: seedIso(-11, 11),
    },
    {
      id: TICKET_IDS.invoiceQuery,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: "AZW-B01-0002",
      ticketNo: "AZW-T-0006",
      title: "Rückfrage zur Nebenkostenabrechnung 05/2026",
      description: "Position Wasser weicht vom Vorjahr ab.",
      category: "billing",
      priority: "normal",
      status: "closed",
      severity: "moderate",
      requesterProfileId: null,
      assigneeProfileId: SEED_PROFILE_IDS.accountant,
      reportedAt: seedIso(-40, 9),
      slaDueAt: seedIso(-33, 9),
      resolvedAt: seedIso(-36, 9),
      closedAt: seedIso(-35, 9),
      estimatedCost: null,
      requiresFinanceApproval: false,
      metadata: {},
      idempotencyKey: null,
      version: 6,
      createdAt: seedIso(-40, 9),
      updatedAt: seedIso(-35, 9),
    },
    {
      id: TICKET_IDS.airportTransfer,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: "AZW-B01-0003",
      ticketNo: "AZW-T-0007",
      title: "Flughafentransfer Gazipaşa anfragen",
      description: null,
      category: "concierge",
      priority: "low",
      status: "draft",
      severity: "minor",
      requesterProfileId: SEED_PROFILE_IDS.tenant,
      assigneeProfileId: null,
      reportedAt: seedIso(-1, 16),
      slaDueAt: null,
      resolvedAt: null,
      closedAt: null,
      estimatedCost: null,
      requiresFinanceApproval: false,
      metadata: {},
      idempotencyKey: "concierge-transfer-2026-07-26",
      version: 1,
      createdAt: seedIso(-1, 16),
      updatedAt: seedIso(-1, 16),
    },
    {
      id: TICKET_IDS.duplicate,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: null,
      ticketNo: "AZW-T-0008",
      title: "Doppelt gemeldet: Poolpumpe",
      description: "Duplikat von AZW-T-0001.",
      category: "other",
      priority: "normal",
      status: "cancelled",
      severity: "minor",
      requesterProfileId: SEED_PROFILE_IDS.staff,
      assigneeProfileId: null,
      reportedAt: seedIso(-4, 12),
      slaDueAt: null,
      resolvedAt: null,
      closedAt: seedIso(-4, 13),
      estimatedCost: null,
      requiresFinanceApproval: false,
      metadata: { duplicate_of: "AZW-T-0001" },
      idempotencyKey: null,
      version: 2,
      createdAt: seedIso(-4, 12),
      updatedAt: seedIso(-4, 13),
    },
    {
      id: TICKET_IDS.acLeak,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: "AZW-B01-0003",
      ticketNo: "AZW-T-0009",
      title: "Klimaanlage tropft in Wohnung",
      description: "Kondensat läuft an der Innenwand herunter.",
      category: "maintenance",
      priority: "high",
      status: "open",
      severity: "major",
      requesterProfileId: SEED_PROFILE_IDS.tenant,
      assigneeProfileId: null,
      reportedAt: seedIso(-6, 18),
      // Breached, and on a unit — so the breach count differs by role scope.
      slaDueAt: seedIso(-3, 18),
      resolvedAt: null,
      closedAt: null,
      // A second currency on purpose: an aggregate that adds this to the EUR
      // estimates above is wrong, and this row is what makes that visible.
      estimatedCost: { amount: 8500, currency: "TRY" },
      requiresFinanceApproval: false,
      metadata: { asset: "hvac_indoor_unit" },
      idempotencyKey: null,
      version: 2,
      createdAt: seedIso(-6, 18),
      updatedAt: seedIso(-5, 18),
    },
  ]
}

/**
 * History for three of the tickets. Append-only, so every row is an addition and
 * a "correction" is a further event, never an edit.
 */
export function seedTicketEvents(): TicketEvent[] {
  return [
    {
      id: "c2000000-0000-4000-8000-000000000001",
      ticketId: TICKET_IDS.poolPump,
      companyId: SEED_COMPANY_ID,
      kind: "created",
      actorProfileId: SEED_PROFILE_IDS.staff,
      fromStatus: null,
      toStatus: "open",
      note: "Meldung aus der Frühschicht.",
      payload: {},
      createdAt: seedIso(-4, 7),
    },
    {
      id: "c2000000-0000-4000-8000-000000000002",
      ticketId: TICKET_IDS.poolPump,
      companyId: SEED_COMPANY_ID,
      kind: "cost_estimated",
      actorProfileId: SEED_PROFILE_IDS.manager,
      fromStatus: null,
      toStatus: null,
      note: "Kostenschätzung nach Sichtprüfung.",
      payload: { amount: 8400, currency: "EUR" },
      createdAt: seedIso(-3, 15),
    },
    {
      id: "c2000000-0000-4000-8000-000000000003",
      ticketId: TICKET_IDS.poolPump,
      companyId: SEED_COMPANY_ID,
      kind: "sla_breached",
      actorProfileId: null,
      fromStatus: null,
      toStatus: null,
      note: "SLA überschritten, keine Zuweisung erfolgt.",
      payload: { sla_due_at: seedIso(-2, 7) },
      createdAt: seedIso(-2, 7),
    },
    {
      id: "c2000000-0000-4000-8000-000000000004",
      ticketId: TICKET_IDS.liftNoise,
      companyId: SEED_COMPANY_ID,
      kind: "created",
      actorProfileId: SEED_PROFILE_IDS.owner,
      fromStatus: null,
      toStatus: "open",
      note: null,
      payload: {},
      createdAt: seedIso(-3, 9),
    },
    {
      id: "c2000000-0000-4000-8000-000000000005",
      ticketId: TICKET_IDS.liftNoise,
      companyId: SEED_COMPANY_ID,
      kind: "assigned",
      actorProfileId: SEED_PROFILE_IDS.manager,
      fromStatus: null,
      toStatus: null,
      note: "An Anadolu Asansör übergeben.",
      payload: { assignee_profile_id: SEED_PROFILE_IDS.serviceProvider },
      createdAt: seedIso(-2, 9),
    },
    {
      id: "c2000000-0000-4000-8000-000000000006",
      ticketId: TICKET_IDS.liftNoise,
      companyId: SEED_COMPANY_ID,
      kind: "status_changed",
      actorProfileId: SEED_PROFILE_IDS.manager,
      fromStatus: "open",
      // NOT NULL whenever kind is 'status_changed': an event that records no
      // transition is a lie about what happened, and a CHECK refuses it.
      toStatus: "assigned",
      note: null,
      payload: {},
      createdAt: seedIso(-2, 9),
    },
    {
      id: "c2000000-0000-4000-8000-000000000007",
      ticketId: TICKET_IDS.liftNoise,
      companyId: SEED_COMPANY_ID,
      kind: "comment",
      actorProfileId: SEED_PROFILE_IDS.owner,
      fromStatus: null,
      toStatus: null,
      note: "Geräusch tritt vor allem morgens auf.",
      payload: {},
      createdAt: seedIso(-1, 8),
    },
    {
      id: "c2000000-0000-4000-8000-000000000008",
      ticketId: TICKET_IDS.acLeak,
      companyId: SEED_COMPANY_ID,
      kind: "created",
      actorProfileId: SEED_PROFILE_IDS.tenant,
      fromStatus: null,
      toStatus: "open",
      note: null,
      payload: {},
      createdAt: seedIso(-6, 18),
    },
    {
      id: "c2000000-0000-4000-8000-000000000009",
      ticketId: TICKET_IDS.acLeak,
      companyId: SEED_COMPANY_ID,
      kind: "media_attached",
      actorProfileId: SEED_PROFILE_IDS.tenant,
      fromStatus: null,
      toStatus: null,
      note: null,
      payload: { media_count: 2 },
      createdAt: seedIso(-6, 19),
    },
    {
      id: "c2000000-0000-4000-8000-000000000010",
      ticketId: TICKET_IDS.acLeak,
      companyId: SEED_COMPANY_ID,
      kind: "escalated",
      actorProfileId: SEED_PROFILE_IDS.staff,
      fromStatus: null,
      toStatus: null,
      note: "Wasserschadenrisiko — Priorität angehoben.",
      payload: { from_priority: "normal", to_priority: "high" },
      createdAt: seedIso(-5, 18),
    },
  ]
}

/** Six activities across the whole status range, including one internal draft. */
export function seedActivities(): Activity[] {
  return [
    {
      id: "c3000000-0000-4000-8000-000000000001",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      title: "Sunrise Yoga auf der Poolterrasse",
      description: "Offen für alle Bewohner, Matten vorhanden.",
      category: "wellness",
      startsAt: seedIso(1, 6),
      endsAt: seedIso(1, 7),
      capacity: 20,
      location: "Poolterrasse Block B02",
      status: "scheduled",
      organiserProfileId: SEED_PROFILE_IDS.staff,
      metadata: { language: "de" },
      createdAt: seedIso(-10, 9),
      updatedAt: seedIso(-2, 9),
    },
    {
      id: "c3000000-0000-4000-8000-000000000002",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      title: "Tennisturnier — Gruppenphase",
      description: null,
      category: "sports",
      startsAt: seedIso(3, 16),
      endsAt: seedIso(3, 19),
      capacity: 16,
      location: "Tennisplatz",
      status: "open",
      organiserProfileId: SEED_PROFILE_IDS.staff,
      metadata: {},
      createdAt: seedIso(-8, 9),
      updatedAt: seedIso(-1, 9),
    },
    {
      id: "c3000000-0000-4000-8000-000000000003",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      title: "Kids Club: Wasserrutschen-Nachmittag",
      description: "Betreuung ab 6 Jahren.",
      category: "kids",
      startsAt: seedIso(2, 14),
      endsAt: seedIso(2, 17),
      capacity: 24,
      location: "Aquapark",
      status: "full",
      organiserProfileId: SEED_PROFILE_IDS.staff,
      metadata: { min_age: 6 },
      createdAt: seedIso(-12, 9),
      updatedAt: seedIso(-1, 12),
    },
    {
      id: "c3000000-0000-4000-8000-000000000004",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      title: "Bootsausflug Alanya-Burg",
      description: null,
      category: "excursion",
      startsAt: seedIso(-6, 9),
      endsAt: seedIso(-6, 17),
      // null = uncapped, not zero.
      capacity: null,
      location: "Marina Alanya",
      status: "completed",
      organiserProfileId: SEED_PROFILE_IDS.manager,
      metadata: {},
      createdAt: seedIso(-30, 9),
      updatedAt: seedIso(-6, 18),
    },
    {
      id: "c3000000-0000-4000-8000-000000000005",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      title: "Wartungsfenster Aufzüge Block B01",
      description: "Interne Planung, noch nicht angekündigt.",
      category: "maintenance_window",
      startsAt: seedIso(6, 8),
      endsAt: seedIso(6, 12),
      capacity: null,
      location: "Block B01",
      // Draft rows stay internal: an activity still being planned is not a
      // promise to a resident, and the RLS resident path excludes them.
      status: "draft",
      organiserProfileId: SEED_PROFILE_IDS.manager,
      metadata: {},
      createdAt: seedIso(-2, 9),
      updatedAt: seedIso(-2, 9),
    },
    {
      id: "c3000000-0000-4000-8000-000000000006",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      title: "Sommerfest am Strandclub",
      description: "Wegen Sturmwarnung abgesagt.",
      category: "social",
      startsAt: seedIso(-3, 19),
      endsAt: seedIso(-3, 23),
      capacity: 200,
      location: "Strandclub",
      status: "cancelled",
      organiserProfileId: SEED_PROFILE_IDS.manager,
      metadata: { cancelled_reason: "storm_warning" },
      createdAt: seedIso(-25, 9),
      updatedAt: seedIso(-4, 9),
    },
  ]
}

/** Seven field tasks across every status, two of them breached. */
export function seedWorkforceTasks(): WorkforceTask[] {
  return [
    {
      id: "c4000000-0000-4000-8000-000000000001",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      ticketId: TICKET_IDS.poolPump,
      unitId: null,
      assigneeProfileId: null,
      taskNo: "AZW-W-0001",
      title: "Umwälzpumpe ausbauen und prüfen",
      team: "technik",
      status: "open",
      priority: "urgent",
      slaDueAt: seedIso(-2, 7),
      startedAt: null,
      completedAt: null,
      checklist: [
        { step: "Becken absperren", done: true },
        { step: "Pumpe ausbauen", done: false },
      ],
      fieldNote: null,
      metadata: {},
      createdAt: seedIso(-4, 7),
      updatedAt: seedIso(-4, 7),
    },
    {
      id: "c4000000-0000-4000-8000-000000000002",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      ticketId: TICKET_IDS.liftNoise,
      unitId: "AZW-B01-0001",
      assigneeProfileId: SEED_PROFILE_IDS.serviceProvider,
      taskNo: "AZW-W-0002",
      title: "Aufzugsführung nachstellen",
      team: "aufzug",
      status: "assigned",
      priority: "high",
      slaDueAt: seedIso(2, 9),
      startedAt: null,
      completedAt: null,
      checklist: [],
      fieldNote: null,
      metadata: {},
      createdAt: seedIso(-2, 9),
      updatedAt: seedIso(-2, 9),
    },
    {
      id: "c4000000-0000-4000-8000-000000000003",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      ticketId: TICKET_IDS.poolClean,
      unitId: null,
      assigneeProfileId: SEED_PROFILE_IDS.staff,
      taskNo: "AZW-W-0003",
      title: "Rutschen entkalken",
      team: "reinigung",
      status: "in_progress",
      priority: "normal",
      slaDueAt: seedIso(3, 8),
      startedAt: seedIso(0, 8),
      completedAt: null,
      checklist: [
        { step: "Rutsche 1", done: true },
        { step: "Rutsche 2", done: false },
      ],
      fieldNote: "Kalkablagerungen stärker als erwartet.",
      metadata: {},
      createdAt: seedIso(-2, 8),
      updatedAt: seedIso(0, 9),
    },
    {
      id: "c4000000-0000-4000-8000-000000000004",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      ticketId: TICKET_IDS.facade,
      unitId: null,
      assigneeProfileId: SEED_PROFILE_IDS.serviceProvider,
      taskNo: "AZW-W-0004",
      title: "Gerüst stellen Block B03",
      team: "bau",
      status: "blocked",
      priority: "high",
      slaDueAt: seedIso(-7, 10),
      startedAt: null,
      completedAt: null,
      checklist: [],
      fieldNote: "Wartet auf Statikbefund.",
      metadata: { blocked_by: "structural_survey" },
      createdAt: seedIso(-20, 10),
      updatedAt: seedIso(-6, 10),
    },
    {
      id: "c4000000-0000-4000-8000-000000000005",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      ticketId: TICKET_IDS.sunbed,
      unitId: null,
      assigneeProfileId: SEED_PROFILE_IDS.staff,
      taskNo: "AZW-W-0005",
      title: "Liege ersetzen",
      team: "haustechnik",
      status: "completed",
      priority: "low",
      slaDueAt: seedIso(-9, 11),
      startedAt: seedIso(-12, 11),
      completedAt: seedIso(-11, 11),
      checklist: [{ step: "Ersatz aus Lager", done: true }],
      fieldNote: null,
      metadata: {},
      createdAt: seedIso(-14, 11),
      updatedAt: seedIso(-11, 11),
    },
    {
      id: "c4000000-0000-4000-8000-000000000006",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      ticketId: null,
      unitId: "AZW-B01-0002",
      assigneeProfileId: SEED_PROFILE_IDS.staff,
      taskNo: "AZW-W-0006",
      title: "Rauchmelder-Jahresprüfung",
      team: "haustechnik",
      status: "verified",
      priority: "normal",
      slaDueAt: seedIso(-25, 9),
      startedAt: seedIso(-28, 9),
      completedAt: seedIso(-27, 9),
      checklist: [{ step: "Testalarm", done: true }],
      fieldNote: null,
      metadata: {},
      createdAt: seedIso(-30, 9),
      updatedAt: seedIso(-26, 9),
    },
    {
      id: "c4000000-0000-4000-8000-000000000007",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      ticketId: TICKET_IDS.duplicate,
      unitId: null,
      assigneeProfileId: null,
      taskNo: "AZW-W-0007",
      title: "Doppelte Meldung Poolpumpe prüfen",
      team: "technik",
      status: "cancelled",
      priority: "normal",
      slaDueAt: null,
      startedAt: null,
      completedAt: null,
      checklist: [],
      fieldNote: null,
      metadata: { duplicate_of: "AZW-W-0001" },
      createdAt: seedIso(-4, 12),
      updatedAt: seedIso(-4, 13),
    },
  ]
}

/** Five intake reports covering every status, including one public-intake row. */
export function seedMediaReports(): MediaReport[] {
  return [
    {
      id: "c5000000-0000-4000-8000-000000000001",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: null,
      ticketId: null,
      // Public intake: a QR sticker on a lift identifies a place, not a dwelling.
      reporterProfileId: SEED_PROFILE_IDS.guest,
      reporterName: "Gast Lobby-QR",
      reporterEmail: null,
      reporterPhone: null,
      description: "Glasscherben am Weg zwischen Block B02 und Pool.",
      mediaPaths: ["media-reports/2026/07/intake-0001-a.jpg"],
      status: "new",
      isPublicIntake: true,
      triagedByProfileId: null,
      triagedAt: null,
      metadata: { intake_channel: "qr_lobby" },
      createdAt: seedIso(0, 10),
      updatedAt: seedIso(0, 10),
    },
    {
      id: "c5000000-0000-4000-8000-000000000002",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: "AZW-B01-0003",
      ticketId: null,
      reporterProfileId: SEED_PROFILE_IDS.tenant,
      reporterName: "Tenant One",
      reporterEmail: "tenant@azura.local",
      reporterPhone: null,
      description: "Feuchter Fleck an der Wand neben dem Klimagerät.",
      mediaPaths: [
        "media-reports/2026/07/intake-0002-a.jpg",
        "media-reports/2026/07/intake-0002-b.jpg",
      ],
      status: "triaged",
      isPublicIntake: false,
      triagedByProfileId: SEED_PROFILE_IDS.staff,
      triagedAt: seedIso(-6, 19),
      metadata: {},
      createdAt: seedIso(-6, 18),
      updatedAt: seedIso(-6, 19),
    },
    {
      id: "c5000000-0000-4000-8000-000000000003",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: "AZW-B01-0003",
      ticketId: TICKET_IDS.acLeak,
      reporterProfileId: SEED_PROFILE_IDS.tenant,
      reporterName: "Tenant One",
      reporterEmail: "tenant@azura.local",
      reporterPhone: null,
      description: "Nachtrag: Tropfen sammelt sich jetzt auf dem Boden.",
      mediaPaths: ["media-reports/2026/07/intake-0003-a.jpg"],
      status: "linked",
      isPublicIntake: false,
      triagedByProfileId: SEED_PROFILE_IDS.staff,
      triagedAt: seedIso(-5, 18),
      metadata: {},
      createdAt: seedIso(-5, 17),
      updatedAt: seedIso(-5, 18),
    },
    {
      id: "c5000000-0000-4000-8000-000000000004",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: null,
      ticketId: TICKET_IDS.sunbed,
      reporterProfileId: SEED_PROFILE_IDS.tenant,
      reporterName: null,
      reporterEmail: null,
      reporterPhone: null,
      description: "Liege am Poolrand gebrochen.",
      mediaPaths: [],
      status: "resolved",
      isPublicIntake: false,
      triagedByProfileId: SEED_PROFILE_IDS.staff,
      triagedAt: seedIso(-13, 11),
      metadata: {},
      createdAt: seedIso(-14, 10),
      updatedAt: seedIso(-11, 11),
    },
    {
      id: "c5000000-0000-4000-8000-000000000005",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: null,
      ticketId: null,
      reporterProfileId: null,
      reporterName: "unbekannt",
      reporterEmail: null,
      reporterPhone: null,
      description: "Werbe-Text ohne Bezug zur Anlage.",
      mediaPaths: [],
      status: "spam",
      isPublicIntake: true,
      triagedByProfileId: SEED_PROFILE_IDS.staff,
      triagedAt: seedIso(-9, 9),
      metadata: { intake_channel: "public_form" },
      createdAt: seedIso(-9, 8),
      updatedAt: seedIso(-9, 9),
    },
  ]
}
