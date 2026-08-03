/**
 * Leads and the buyer pipeline.
 *
 * Every exported read goes through `withRepository()`: unconfigured Supabase
 * falls back to the local seed and labels itself, a **configured** Supabase that
 * fails throws, and an empty funnel is `source: "supabase"` with empty data —
 * never a seed substitution.
 *
 * ## Staff and above. Nobody else.
 *
 * `leads` and `buyer_pipeline_entries` hold commercial personal data, and
 * migration 14 is explicit that this is one of the few places where `owner` and
 * `tenant` get **nothing** rather than a scoped subset. Both RLS SELECT policies
 * read `is_admin() or has_role_level(40)`; the scoping here mirrors that
 * predicate, and there is deliberately no resident read path to invent.
 *
 * **The mirror is `roleLevel[role] >= roleLevel.staff`, not
 * `hasPermission(role, "leads:view")`, and the difference is real:** the RBAC
 * matrix in `lib/rbac.ts` grants `leads:view` to `manager` and above but not to
 * `staff`, while the RLS predicate admits any role at level 40. Repository
 * scoping exists to reproduce RLS in local-seed mode, so it follows RLS. A route
 * handler must **still** call `hasPermission(role, "leads:view")` before it gets
 * here — RLS is the security boundary, RBAC is the UX boundary, and this
 * divergence is reported in the handoff rather than papered over.
 *
 * ## Money is never aggregated across currencies
 *
 * `budget_amount` and `deal_amount` are `numeric(14,2)` and arrive as strings.
 * They are parsed with `asMoney()`, which returns `null` rather than inventing a
 * currency, and totals are reported **per currency**: `sum(EUR) + sum(USD)` is a
 * meaningless number that looks authoritative (CONVENTIONS §5).
 */

import type { Money, RepositoryResult, Role } from "@/lib/contracts"
import { roleLevel } from "@/lib/contracts"
import {
  leadSources,
  leadStatuses,
  pipelineStages,
  seedLeads,
  seedPipelineEntries,
  type LeadRecord,
  type LeadSource,
  type LeadStatus,
  type PipelineEntryRecord,
  type PipelineLeadSummary,
  type PipelineStage,
} from "@/lib/lead-data"
import {
  asMoney,
  asNullableNumber,
  asNullableString,
  asRecord,
  asString,
  clampLimit,
  clampOffset,
  degraded,
  MAX_PAGE_SIZE,
  nowIso,
  relatedRecord,
  RepositoryError,
  totalsByCurrency,
  unwrap,
  withRepository,
  type RepositoryClient,
} from "@/lib/repository-base"

export type {
  LeadRecord,
  LeadSource,
  LeadStatus,
  PipelineEntryRecord,
  PipelineLeadSummary,
  PipelineStage,
}

// ---------------------------------------------------------------------------
// Query surface
// ---------------------------------------------------------------------------

/** Filters for `getLeads()`. */
export interface LeadQueryOptions {
  role?: Role
  status?: LeadStatus | readonly LeadStatus[]
  source?: LeadSource
  assignedTo?: string
  /** `units.id`, e.g. "AZW-B03-0412". TEXT, not a uuid. */
  unitId?: string
  siteId?: string
  /** Default 50, hard ceiling 500. Never unbounded. */
  limit?: number
  offset?: number
}

/** Filters for `getBuyerPipeline()` and `getPipelineSummary()`. */
export interface PipelineQueryOptions {
  role?: Role
  stage?: PipelineStage | readonly PipelineStage[]
  ownerProfileId?: string
  unitId?: string
  leadId?: string
  limit?: number
  offset?: number
}

/** One stage of the funnel. Reported for every stage, including empty ones. */
export interface PipelineStageSummary {
  stage: PipelineStage
  count: number
  /**
   * Per-currency deal totals, e.g. `{ EUR: 434000, USD: 305000 }`. Never a
   * single number: adding EUR to USD produces a figure that means nothing.
   */
  dealTotalsByCurrency: Record<string, number>
  /** Entries with no agreed amount. Counted, never summed as 0. */
  entriesWithoutDealAmount: number
  /** Mean of the entries that carry one, to one decimal. `null` when none do. */
  averageProbability: number | null
  entriesWithoutProbability: number
}

/** The funnel at a glance. */
export interface PipelineSummary {
  asOf: string
  /** All nine stages in funnel order, zero-filled. An empty stage is a fact. */
  stages: PipelineStageSummary[]
  /** Exact row count from Postgres, even when only a page was aggregated. */
  totalEntries: number
  /** How many rows the figures above were actually computed from. */
  summarisedEntries: number
  /** True when `totalEntries > summarisedEntries` — the summary is partial. */
  truncated: boolean
  dealTotalsByCurrency: Record<string, number>
  entriesWithoutDealAmount: number
  averageProbability: number | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEAD_COLUMNS =
  "id, company_id, site_id, unit_id, reference, full_name, email, phone, locale, nationality, status, source, source_detail, budget_amount, budget_currency, desired_layout, assigned_to, score, notes, last_contacted_at, next_action_at, lost_reason, consent_marketing, metadata, version, created_at, updated_at"

/** The embedded lead. One query, not one query per row (W2-A brief: no N+1). */
const PIPELINE_LEAD_EMBED = "leads(id, reference, full_name, status, locale)"

const PIPELINE_COLUMNS = `id, company_id, lead_id, unit_id, stage, previous_stage, entered_stage_at, expected_close, deal_amount, deal_currency, probability, owner_profile_id, blocker, metadata, version, created_at, updated_at, ${PIPELINE_LEAD_EMBED}`

/** Only the columns the aggregate needs. A summary must not pull whole rows. */
const PIPELINE_SUMMARY_COLUMNS =
  "stage, deal_amount, deal_currency, probability"

const TRUNCATED_SUMMARY_REASON = `Pipeline summary computed from the first ${MAX_PAGE_SIZE} entries only. Counts and totals beyond that are not included; a Postgres-side aggregate (an RPC) is needed for an exact figure at this volume.`

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

/**
 * Narrow an unknown column value to one of the enum's literals, returning the
 * literal from `allowed` so no cast is involved.
 */
function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  if (typeof value === "string") {
    for (const candidate of allowed) {
      if (candidate === value) return candidate
    }
  }
  return fallback
}

function oneOfOrNull<T extends string>(
  value: unknown,
  allowed: readonly T[]
): T | null {
  if (typeof value === "string") {
    for (const candidate of allowed) {
      if (candidate === value) return candidate
    }
  }
  return null
}

/** `public.unit_layout`, mirrored from CONTRACTS §2's `UnitLayout`. */
const unitLayouts = [
  "1+1",
  "2+1",
  "3+1",
  "4+1",
  "5+1",
  "6+1",
  "penthouse",
  "townhouse",
  "villa",
  "president_villa",
] as const

function mapLead(row: unknown): LeadRecord {
  const record = asRecord(row)
  return {
    id: asString(record["id"]),
    companyId: asString(record["company_id"]),
    siteId: asNullableString(record["site_id"]),
    unitId: asNullableString(record["unit_id"]),
    reference: asString(record["reference"]),
    fullName: asString(record["full_name"]),
    email: asNullableString(record["email"]),
    phone: asNullableString(record["phone"]),
    locale: asString(record["locale"], "de"),
    nationality: asNullableString(record["nationality"]),
    status: oneOf(record["status"], leadStatuses, "new"),
    source: oneOf(record["source"], leadSources, "unknown"),
    sourceDetail: asNullableString(record["source_detail"]),
    // numeric(14,2) arrives as a string; `asMoney` returns null rather than
    // inventing a currency for an amount that has none.
    budget: asMoney(record["budget_amount"], record["budget_currency"]),
    desiredLayout: oneOfOrNull(record["desired_layout"], unitLayouts),
    assignedTo: asNullableString(record["assigned_to"]),
    // A score of 0 and an unscored lead are different facts. Never `?? 0`.
    score: asNullableNumber(record["score"]),
    notes: asNullableString(record["notes"]),
    lastContactedAt: asNullableString(record["last_contacted_at"]),
    nextActionAt: asNullableString(record["next_action_at"]),
    lostReason: asNullableString(record["lost_reason"]),
    // Fail-closed: consent is something a person gives. Anything that does not
    // read as `true` is "no consent".
    consentMarketing: record["consent_marketing"] === true,
    metadata: asRecord(record["metadata"]),
    // 0 is not a legal version — the column defaults to 1 and only increases —
    // so a row without one fails an optimistic-concurrency check.
    version: asNullableNumber(record["version"]) ?? 0,
    createdAt: asString(record["created_at"]),
    updatedAt: asString(record["updated_at"]),
  }
}

function mapPipelineLead(value: unknown): PipelineLeadSummary | null {
  const record = relatedRecord(value)
  const id = asString(record["id"])
  // The embed returns nothing when the join produced no row. A placeholder
  // would put an invented name on a board.
  if (id.length === 0) return null
  return {
    id,
    reference: asString(record["reference"]),
    fullName: asString(record["full_name"]),
    status: oneOf(record["status"], leadStatuses, "new"),
    locale: asString(record["locale"], "de"),
  }
}

function mapPipelineEntry(row: unknown): PipelineEntryRecord {
  const record = asRecord(row)
  return {
    id: asString(record["id"]),
    companyId: asString(record["company_id"]),
    leadId: asString(record["lead_id"]),
    unitId: asNullableString(record["unit_id"]),
    stage: oneOf(record["stage"], pipelineStages, "enquiry"),
    previousStage: oneOfOrNull(record["previous_stage"], pipelineStages),
    enteredStageAt: asString(record["entered_stage_at"]),
    expectedClose: asNullableString(record["expected_close"]),
    deal: asMoney(record["deal_amount"], record["deal_currency"]),
    // 0% is a real estimate ("this is lost"); null means nobody has estimated.
    probability: asNullableNumber(record["probability"]),
    ownerProfileId: asNullableString(record["owner_profile_id"]),
    blocker: asNullableString(record["blocker"]),
    metadata: asRecord(record["metadata"]),
    version: asNullableNumber(record["version"]) ?? 0,
    createdAt: asString(record["created_at"]),
    updatedAt: asString(record["updated_at"]),
    lead: mapPipelineLead(record["leads"]),
  }
}

// ---------------------------------------------------------------------------
// Scoping
// ---------------------------------------------------------------------------

/**
 * The TypeScript mirror of `public.has_role_level(40)`.
 *
 * An omitted role means "no repository-side narrowing" — correct for a server
 * caller that has already authorised, and wrong for anything reachable from a
 * request. In Supabase mode RLS still refuses; in local-seed mode there is no
 * RLS, which is exactly why every request path must pass a role.
 */
function mayReadSalesData(role: Role | undefined): boolean {
  if (role === undefined) return true
  return roleLevel[role] >= roleLevel.staff
}

/**
 * The TypeScript mirror of `leads_staff_write` / `buyer_pipeline_staff_write`:
 * `is_admin() or (has_role_level(70) and own company)`.
 *
 * It coincides exactly with the RBAC matrix — `leads:create` and
 * `buyer_pipeline:update` are held by `admin` and `manager` only — so the UI and
 * the database agree, and the leads page can offer its control to precisely the
 * roles the database will accept. Not relied on: the route still calls
 * `hasPermission()` and RLS still rules.
 *
 * **This is NOT narrower than the read policy, and an earlier version of this
 * comment claimed it was.** Measured on the live database:
 *
 *     leads_select_staff             is_admin() OR (has_role_level(70) AND own company)
 *     buyer_pipeline_select_staff    is_admin() OR (has_role_level(70) AND own company)
 *
 * Reading is level **70**, not 40. Both tables additionally admit one personal
 * path — `leads_select_assignee` on `assigned_to = auth.uid()` and
 * `buyer_pipeline_select_owner` on `owner_profile_id = auth.uid()` — so a
 * salesperson below manager sees the records assigned to them personally and
 * nothing else. `mayReadSalesData()` below mirrors `has_role_level(40)`, which
 * is therefore WIDER than RLS: harmless in Supabase mode, where the policies
 * decide, and a real divergence in local-seed mode, where they do not.
 *
 * An omitted role means "no repository-side narrowing": correct for a server
 * caller that has already authorised, and wrong for anything reachable from a
 * request.
 */
function mayWriteSalesData(role: Role | undefined): boolean {
  if (role === undefined) return true
  return roleLevel[role] >= roleLevel.manager
}

/** The one refusal both writes share, worded for a person rather than for RLS. */
function refuseWrite(): never {
  throw new RepositoryError({
    code: "forbidden",
    message: "You do not have access to this data.",
    retryable: false,
  })
}

function requestedStatuses(
  status: LeadQueryOptions["status"]
): readonly LeadStatus[] | null {
  if (status === undefined) return null
  return typeof status === "string" ? [status] : status
}

function requestedStages(
  stage: PipelineQueryOptions["stage"]
): readonly PipelineStage[] | null {
  if (stage === undefined) return null
  return typeof stage === "string" ? [stage] : stage
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

function filterSeedLeads(
  leads: readonly LeadRecord[],
  opts: LeadQueryOptions
): LeadRecord[] {
  const statuses = requestedStatuses(opts.status)
  const limit = clampLimit(opts.limit)
  const offset = clampOffset(opts.offset)

  const matched = leads.filter((lead) => {
    if (statuses !== null && !statuses.includes(lead.status)) return false
    if (opts.source !== undefined && lead.source !== opts.source) return false
    if (opts.assignedTo !== undefined && lead.assignedTo !== opts.assignedTo) {
      return false
    }
    if (opts.unitId !== undefined && lead.unitId !== opts.unitId) return false
    if (opts.siteId !== undefined && lead.siteId !== opts.siteId) return false
    return true
  })

  matched.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return matched.slice(offset, offset + limit)
}

async function queryLeads(
  client: RepositoryClient,
  opts: LeadQueryOptions
): Promise<LeadRecord[]> {
  const limit = clampLimit(opts.limit)
  const offset = clampOffset(opts.offset)

  let query = client.from("leads").select(LEAD_COLUMNS)

  if (opts.source !== undefined) query = query.eq("source", opts.source)
  if (opts.assignedTo !== undefined)
    query = query.eq("assigned_to", opts.assignedTo)
  if (opts.unitId !== undefined) query = query.eq("unit_id", opts.unitId)
  if (opts.siteId !== undefined) query = query.eq("site_id", opts.siteId)

  const statuses = requestedStatuses(opts.status)
  if (statuses !== null) query = query.in("status", [...statuses])

  const rows = unwrap<unknown[]>(
    await query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1),
    []
  )
  return rows.map(mapLead)
}

/**
 * Leads, newest first. Bounded: default 50 rows, ceiling 500.
 *
 * A role below staff level 40 gets an empty array — not a filtered subset.
 * There is no resident view of the sales pipeline.
 */
export async function getLeads(
  opts: LeadQueryOptions = {}
): Promise<RepositoryResult<LeadRecord[]>> {
  const permitted = mayReadSalesData(opts.role)
  return withRepository(
    (client) => (permitted ? queryLeads(client, opts) : Promise.resolve([])),
    () => (permitted ? filterSeedLeads(seedLeads(), opts) : []),
    "leads.list"
  )
}

/**
 * One lead by id, or `null` when it does not exist or the caller may not read
 * it — indistinguishable on purpose, so a 404 is not an existence oracle.
 */
export async function getLead(
  id: string,
  opts: { role?: Role } = {}
): Promise<RepositoryResult<LeadRecord | null>> {
  const permitted = mayReadSalesData(opts.role)

  return withRepository<LeadRecord | null>(
    async (client) => {
      if (!permitted) return null
      const row = unwrap<unknown>(
        await client
          .from("leads")
          .select(LEAD_COLUMNS)
          .eq("id", id)
          .maybeSingle(),
        null
      )
      return row === null ? null : mapLead(row)
    },
    () => {
      if (!permitted) return null
      return seedLeads().find((lead) => lead.id === id) ?? null
    },
    "leads.get"
  )
}

// ---------------------------------------------------------------------------
// Buyer pipeline
// ---------------------------------------------------------------------------

function filterSeedPipeline(
  entries: readonly PipelineEntryRecord[],
  opts: PipelineQueryOptions
): PipelineEntryRecord[] {
  const stages = requestedStages(opts.stage)
  const limit = clampLimit(opts.limit)
  const offset = clampOffset(opts.offset)

  const matched = entries.filter((entry) => {
    if (stages !== null && !stages.includes(entry.stage)) return false
    if (
      opts.ownerProfileId !== undefined &&
      entry.ownerProfileId !== opts.ownerProfileId
    ) {
      return false
    }
    if (opts.unitId !== undefined && entry.unitId !== opts.unitId) return false
    if (opts.leadId !== undefined && entry.leadId !== opts.leadId) return false
    return true
  })

  matched.sort((a, b) => b.enteredStageAt.localeCompare(a.enteredStageAt))
  return matched.slice(offset, offset + limit)
}

/**
 * Pipeline entries, most recent stage movement first, each with its lead
 * embedded.
 *
 * The lead is joined in the same query rather than fetched per row: a board of
 * 200 entries must not be 201 queries (W2-A brief, edge cases).
 */
export async function getBuyerPipeline(
  opts: PipelineQueryOptions = {}
): Promise<RepositoryResult<PipelineEntryRecord[]>> {
  const permitted = mayReadSalesData(opts.role)
  const limit = clampLimit(opts.limit)
  const offset = clampOffset(opts.offset)

  return withRepository(
    async (client) => {
      if (!permitted) return []

      let query = client.from("buyer_pipeline_entries").select(PIPELINE_COLUMNS)

      if (opts.ownerProfileId !== undefined) {
        query = query.eq("owner_profile_id", opts.ownerProfileId)
      }
      if (opts.unitId !== undefined) query = query.eq("unit_id", opts.unitId)
      if (opts.leadId !== undefined) query = query.eq("lead_id", opts.leadId)

      const stages = requestedStages(opts.stage)
      if (stages !== null) query = query.in("stage", [...stages])

      const rows = unwrap<unknown[]>(
        await query
          .order("entered_stage_at", { ascending: false })
          .range(offset, offset + limit - 1),
        []
      )
      return rows.map(mapPipelineEntry)
    },
    () => (permitted ? filterSeedPipeline(seedPipelineEntries(), opts) : []),
    "leads.pipeline"
  )
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/** One row's contribution to the aggregate: stage, money, probability. */
interface SummaryInput {
  stage: PipelineStage
  deal: Money | null
  probability: number | null
}

function summarise(
  inputs: readonly SummaryInput[],
  totalEntries: number,
  asOf: string
): PipelineSummary {
  const byStage = new Map<PipelineStage, SummaryInput[]>()
  for (const stage of pipelineStages) byStage.set(stage, [])
  for (const input of inputs) {
    // Every stage key was seeded above, so this is always defined; the guard is
    // `noUncheckedIndexedAccess` doing its job rather than a `!`.
    const bucket = byStage.get(input.stage)
    if (bucket !== undefined) bucket.push(input)
  }

  const stages = pipelineStages.map((stage): PipelineStageSummary => {
    const bucket = byStage.get(stage) ?? []
    const deals = bucket.flatMap((input) =>
      input.deal === null ? [] : [input.deal]
    )
    const probabilities = bucket.flatMap((input) =>
      input.probability === null ? [] : [input.probability]
    )
    return {
      stage,
      count: bucket.length,
      dealTotalsByCurrency: totalsByCurrency(deals),
      entriesWithoutDealAmount: bucket.length - deals.length,
      averageProbability: meanToOneDecimal(probabilities),
      entriesWithoutProbability: bucket.length - probabilities.length,
    }
  })

  const allDeals = inputs.flatMap((input) =>
    input.deal === null ? [] : [input.deal]
  )
  const allProbabilities = inputs.flatMap((input) =>
    input.probability === null ? [] : [input.probability]
  )

  return {
    asOf,
    stages,
    totalEntries,
    summarisedEntries: inputs.length,
    truncated: totalEntries > inputs.length,
    dealTotalsByCurrency: totalsByCurrency(allDeals),
    entriesWithoutDealAmount: inputs.length - allDeals.length,
    averageProbability: meanToOneDecimal(allProbabilities),
  }
}

/** `null` for an empty set — a mean of nothing is not 0. */
function meanToOneDecimal(values: readonly number[]): number | null {
  if (values.length === 0) return null
  let sum = 0
  for (const value of values) sum += value
  return Math.round((sum / values.length) * 10) / 10
}

/**
 * Counts by stage, **per-currency** deal totals and average probability by
 * stage.
 *
 * Three honesty properties, each of which a naive implementation gets wrong:
 *
 * 1. Every one of the nine stages is reported, zero-filled. A stage nobody is
 *    in is a fact about the funnel, not a row to omit.
 * 2. Totals are per currency. `sum(EUR) + sum(USD)` is meaningless, so entries
 *    with no `deal_amount` are **counted** in `entriesWithoutDealAmount` rather
 *    than summed as zero.
 * 3. PostgREST cannot GROUP BY, so the aggregate runs in TypeScript over at most
 *    `MAX_PAGE_SIZE` rows while asking Postgres for the exact total. Beyond that
 *    the result carries `truncated: true` and a `degradedReason` — a partial
 *    summary that says so beats a wrong one that does not.
 */
export async function getPipelineSummary(
  opts: PipelineQueryOptions = {}
): Promise<RepositoryResult<PipelineSummary>> {
  const permitted = mayReadSalesData(opts.role)
  const asOf = nowIso()

  const result = await withRepository<PipelineSummary>(
    async (client) => {
      if (!permitted) return summarise([], 0, asOf)

      let query = client
        .from("buyer_pipeline_entries")
        .select(PIPELINE_SUMMARY_COLUMNS, { count: "exact" })

      if (opts.ownerProfileId !== undefined) {
        query = query.eq("owner_profile_id", opts.ownerProfileId)
      }
      if (opts.unitId !== undefined) query = query.eq("unit_id", opts.unitId)

      const stages = requestedStages(opts.stage)
      if (stages !== null) query = query.in("stage", [...stages])

      const response = await query
        .order("entered_stage_at", { ascending: false })
        .range(0, MAX_PAGE_SIZE - 1)
      if (response.error !== null) throw response.error

      const rows: unknown[] = response.data ?? []
      const inputs = rows.map((row): SummaryInput => {
        const record = asRecord(row)
        return {
          stage: oneOf(record["stage"], pipelineStages, "enquiry"),
          deal: asMoney(record["deal_amount"], record["deal_currency"]),
          probability: asNullableNumber(record["probability"]),
        }
      })

      // `count` is the exact total; the aggregate covers only what was fetched.
      const totalEntries =
        typeof response.count === "number" ? response.count : inputs.length
      return summarise(inputs, totalEntries, asOf)
    },
    () => {
      if (!permitted) return summarise([], 0, asOf)
      const entries = filterSeedPipeline(seedPipelineEntries(), {
        ...opts,
        limit: MAX_PAGE_SIZE,
        offset: 0,
      })
      const inputs = entries.map((entry): SummaryInput => ({
        stage: entry.stage,
        deal: entry.deal,
        probability: entry.probability,
      }))
      return summarise(inputs, inputs.length, asOf)
    },
    "leads.pipelineSummary"
  )

  return result.data.truncated
    ? degraded(result, TRUNCATED_SUMMARY_REASON)
    : result
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** `AZW-L-2026-0007` — the format every seeded row uses. Unique per company. */
const LEAD_REFERENCE_PREFIX = "AZW-L-"
const LEAD_REFERENCE_FIRST = 1
/** Two enquiries logged in the same second collide on the unique index. */
const LEAD_REFERENCE_ATTEMPTS = 4

/** The per-year series a reference belongs to: `AZW-L-2026-`. */
function leadReferenceSeries(at: string): string {
  return `${LEAD_REFERENCE_PREFIX}${at.slice(0, 4)}-`
}

function nextLeadReference(
  series: string,
  existing: readonly string[]
): string {
  let highest = LEAD_REFERENCE_FIRST - 1
  for (const value of existing) {
    if (!value.startsWith(series)) continue
    const parsed = Number.parseInt(value.slice(series.length), 10)
    if (Number.isFinite(parsed) && parsed > highest) highest = parsed
  }
  return `${series}${String(highest + 1).padStart(4, "0")}`
}

export interface CreateLeadInput {
  role?: Role
  /** The session's company. Never accepted from a request payload. */
  companyId: string
  fullName: string
  email: string
  phone?: string | null
  source: LeadSource
  /** `units.id` — the TEXT business code, e.g. "AZW-B03-0412". */
  unitId?: string | null
  /** What the person actually said. Stored in `leads.notes`. */
  message?: string | null
}

/**
 * Record an enquiry.
 *
 * `POST /api/site-management/leads` answered 503 with "no repository write path
 * exists" — accurate, and the reason the CRM could show every enquiry ever
 * collected and could not accept the next one. A manager who took a phone call
 * had nowhere to put it.
 *
 * ## What a caller cannot decide
 *
 * There is no `status`, no `assignedTo` and no `score` parameter, because
 * `createLeadSchema` has no such field. A lead arrives `new` and unassigned:
 * that is the only honest initial state, and it also removes the obvious abuse —
 * a salesperson routing incoming enquiries to themselves at the moment of
 * capture. Both columns are written explicitly rather than left to their
 * defaults, so a later schema change cannot quietly alter what "a new enquiry"
 * means.
 *
 * `locale` is deliberately absent from the payload and from the insert. The
 * column is NOT NULL with a `'de'` default, and nobody asked this person what
 * language they read; letting the default apply records the database's own
 * fallback rather than asserting a preference the form never collected.
 *
 * ## Who is allowed
 *
 * `leads_staff_write` decides — administrator, or manager within their own
 * company. `mayWriteSalesData()` mirrors that predicate for local-seed mode,
 * where there is no RLS; in Supabase mode a caller outside the policy is refused
 * by Postgres with 42501, which `repository-base` maps to `forbidden`.
 *
 * ## reference
 *
 * Read-then-write, exactly as `createTicket()` does for `ticket_no`, and for the
 * same reason: `leads.reference` is NOT NULL, has no default and no sequence
 * behind it, and is unique per company. Two people logging a call at the same
 * moment resolve the same number and one loses on the unique index — a 23505,
 * which the loop retries with a freshly-read number rather than showing a
 * constraint name to a manager.
 */
export async function createLead(
  input: CreateLeadInput
): Promise<RepositoryResult<LeadRecord>> {
  if (!mayWriteSalesData(input.role)) refuseWrite()

  const fullName = input.fullName.trim()
  if (fullName.length === 0) {
    throw new RepositoryError({
      code: "validation_failed",
      message: "Give the enquiry a name.",
      retryable: false,
    })
  }

  const email = input.email.trim()
  const phone = (input.phone ?? "").trim()
  // The TypeScript twin of the `leads_contactable` CHECK. Refusing here means a
  // caller reads a sentence rather than "The request did not satisfy a data
  // rule.", which is what the constraint violation would have produced.
  if (email.length === 0 && phone.length === 0) {
    throw new RepositoryError({
      code: "validation_failed",
      message: "Give an email address or a telephone number.",
      retryable: false,
    })
  }

  const message = (input.message ?? "").trim()
  const unitId = input.unitId ?? null
  const at = nowIso()
  const series = leadReferenceSeries(at)

  return withRepository<LeadRecord>(
    async (client) => {
      // `leads.site_id` is nullable, so an enquiry about no particular apartment
      // legitimately belongs to no site. When a unit IS named the site is taken
      // from the unit rather than from the caller: a unit cannot be in two
      // places, and a site filter that disagreed with the unit would quietly
      // hide the lead from the site it actually concerns.
      let siteId: string | null = null
      if (unitId !== null) {
        const unitRow = unwrap<unknown>(
          await client
            .from("units")
            .select("id, site_id, company_id")
            // The company filter is the substance of this lookup, not a
            // tidiness clause. `units` carries its own `company_id`, part of
            // the inventory is readable across companies for the sales side,
            // and the row policy on `leads` checks only the LEAD's company —
            // so without this a manager could name a competitor's apartment
            // and have its `site_id` written onto a lead in their own company.
            // That is a cross-tenant reference the database would happily
            // store, because no foreign key spans the two.
            .eq("company_id", input.companyId)
            .eq("id", unitId)
            .maybeSingle(),
          null
        )
        if (unitRow === null) {
          // Absent and not-yours are the same answer, deliberately: a distinct
          // message would confirm that a unit id exists in another company.
          throw new RepositoryError({
            code: "not_found",
            message: "That apartment was not found.",
            retryable: false,
          })
        }
        siteId = asNullableString(asRecord(unitRow)["site_id"])
      }

      for (let attempt = 0; attempt < LEAD_REFERENCE_ATTEMPTS; attempt += 1) {
        const recent = unwrap<unknown[]>(
          await client
            .from("leads")
            .select("reference")
            .eq("company_id", input.companyId)
            .like("reference", `${series}%`)
            .order("reference", { ascending: false })
            .limit(1),
          []
        )
        const reference = nextLeadReference(
          series,
          recent.map((row) => asString(asRecord(row)["reference"]))
        )

        const response = await client
          .from("leads")
          .insert({
            company_id: input.companyId,
            site_id: siteId,
            unit_id: unitId,
            reference,
            full_name: fullName,
            email: email.length === 0 ? null : email,
            phone: phone.length === 0 ? null : phone,
            source: input.source,
            // Untriaged and unowned, by construction. See the doc comment.
            status: "new",
            assigned_to: null,
            notes: message.length === 0 ? null : message,
          })
          .select(LEAD_COLUMNS)
          .maybeSingle()

        // 23505 on this table is the per-company reference race and nothing
        // else — it is the only unique index `leads` carries — so retrying with
        // a re-read number is safe rather than a way to double-insert.
        const error: { code?: unknown; message?: unknown } | null =
          response.error ?? null
        if (
          error !== null &&
          error.code === "23505" &&
          String(error.message ?? "").includes("reference")
        ) {
          continue
        }

        const row = unwrap<unknown>(response, null)
        if (row === null) {
          throw new RepositoryError({
            code: "persistence_unavailable",
            message: "The enquiry could not be saved.",
            retryable: true,
          })
        }
        return mapLead(row)
      }

      throw new RepositoryError({
        code: "conflict",
        message: "Another enquiry was logged at the same moment. Try again.",
        retryable: true,
      })
    },
    () => {
      // Seed mode SIMULATES: the record is returned and nothing is stored,
      // because the seed builders are pure and must stay deterministic across
      // runs. `createManifestHandler` refuses to report a mutation whose
      // `source` is not `"supabase"` as a success, so this can never reach a
      // user as a saved lead.
      const lead: LeadRecord = {
        id: `d1ffffff-0000-4000-8000-${input.companyId.slice(-12)}`,
        companyId: input.companyId,
        siteId: null,
        unitId,
        reference: nextLeadReference(
          series,
          seedLeads().map((seeded) => seeded.reference)
        ),
        fullName,
        email: email.length === 0 ? null : email,
        phone: phone.length === 0 ? null : phone,
        // The column default, not a claim about this person. See the doc.
        locale: "de",
        nationality: null,
        status: "new",
        source: input.source,
        sourceDetail: null,
        budget: null,
        desiredLayout: null,
        assignedTo: null,
        score: null,
        notes: message.length === 0 ? null : message,
        lastContactedAt: null,
        nextActionAt: null,
        lostReason: null,
        consentMarketing: false,
        metadata: {},
        version: 1,
        createdAt: at,
        updatedAt: at,
      }
      return lead
    },
    "leads.create"
  )
}

export interface UpdatePipelineEntryStageInput {
  role?: Role
  entryId: string
  /** The version the caller read. A mismatch is a 409, never a silent overwrite. */
  expectedVersion: number
  stage: PipelineStage
  /**
   * Why the deal moved. Required by `updatePipelineSchema` — and **not stored**,
   * because `buyer_pipeline_entries` has nowhere to put it.
   *
   * The columns that could hold text are `blocker`, which means "what is
   * stopping this deal" and would be corrupted by a movement note, and
   * `metadata`, which this function may not touch: the write is confined to
   * `stage` so the `track_pipeline_stage_change` trigger stays the only author
   * of the movement record. There is no `pipeline_events` table to append to,
   * the way `ticket_events` exists for tickets.
   *
   * So the reason is validated, it gates the control in the UI, and the move
   * itself is audited (`pipeline_entry.stage_changed`, with the actor and the
   * time) — but the sentence the operator typed is discarded. That is stated in
   * the UI rather than hidden, and the fix is a schema change owned by W1-A: a
   * `pipeline_events` table, or a `stage_change_reason` column. Recorded in the
   * handoff; not invented here against another window's schema.
   */
  reason: string
}

/**
 * Move one pipeline entry to another stage, under optimistic concurrency.
 *
 * ## Only `stage` is written, and that is the whole design
 *
 * `track_pipeline_stage_change` fires BEFORE UPDATE and sets `previous_stage`
 * and `entered_stage_at` itself when `stage` changes. Setting either from here
 * would be a double write, and worse than redundant: the application's clock and
 * the database's clock are not the same clock, so "days at this stage" on the
 * board would disagree with the move that caused it. The trigger is the single
 * author of the movement record; this function only states the destination.
 *
 * The caller must therefore re-read rather than patch local state — which is
 * what `router.refresh()` does on the board.
 *
 * ## The 409
 *
 * `.eq("version", expectedVersion)` and `bump_row_version` between them make the
 * guard real. Two people who both read version 4 cannot both win: the second
 * matches zero rows and receives `conflict`. Last-write-wins on a shared funnel
 * means two managers move the same deal for different reasons and one of those
 * reasons vanishes without trace (CONVENTIONS §5).
 *
 * A row that does not exist, or that RLS hides, is `not_found` — distinguished
 * from the conflict by a read before the write, so an operator is not told "the
 * record changed" about a record they were never allowed to see.
 */
export async function updatePipelineEntryStage(
  input: UpdatePipelineEntryStageInput
): Promise<RepositoryResult<PipelineEntryRecord>> {
  if (!mayWriteSalesData(input.role)) refuseWrite()

  const notFound = (): never => {
    throw new RepositoryError({
      code: "not_found",
      message: "That record was not found.",
      retryable: false,
    })
  }

  const conflict = (): never => {
    throw new RepositoryError({
      code: "conflict",
      message:
        "The record changed while you were editing it. Reload and try again.",
      retryable: true,
    })
  }

  // A move to the stage the entry is already in is refused rather than applied.
  // The trigger would not fire, so `entered_stage_at` would stay where it was
  // while `version` and `updated_at` moved — an entry that reports a move
  // nobody can see the effect of. Refusing says what happened instead.
  const alreadyThere = (): never => {
    throw new RepositoryError({
      code: "validation_failed",
      message: "That entry is already at this stage.",
      retryable: false,
    })
  }

  const at = nowIso()

  return withRepository<PipelineEntryRecord>(
    async (client) => {
      const beforeRow = unwrap<unknown>(
        await client
          .from("buyer_pipeline_entries")
          .select(PIPELINE_COLUMNS)
          .eq("id", input.entryId)
          .maybeSingle(),
        null
      )
      if (beforeRow === null) return notFound()
      const previous = mapPipelineEntry(beforeRow)
      if (previous.stage === input.stage) return alreadyThere()

      const rows = unwrap<unknown[]>(
        await client
          .from("buyer_pipeline_entries")
          // ONE column. `previous_stage` and `entered_stage_at` belong to the
          // trigger; writing them here is the bug this line exists to avoid.
          .update({ stage: input.stage })
          .eq("id", input.entryId)
          .eq("version", input.expectedVersion)
          .select(PIPELINE_COLUMNS),
        []
      )
      const updated = rows[0]
      if (updated === undefined) return conflict()
      return mapPipelineEntry(updated)
    },
    () => {
      // Seed mode SIMULATES, as `createLead()` does. The trigger's effect is
      // reproduced here so the returned record is shaped like the real one —
      // and stored nowhere, so a second call sees the original stage again.
      const previous = seedPipelineEntries().find(
        (entry) => entry.id === input.entryId
      )
      if (previous === undefined) return notFound()
      if (previous.stage === input.stage) return alreadyThere()
      if (previous.version !== input.expectedVersion) return conflict()

      const entry: PipelineEntryRecord = {
        ...previous,
        stage: input.stage,
        previousStage: previous.stage,
        enteredStageAt: at,
        version: previous.version + 1,
        updatedAt: at,
      }
      return entry
    },
    "leads.movePipelineEntry"
  )
}
