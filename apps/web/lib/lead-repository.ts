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
