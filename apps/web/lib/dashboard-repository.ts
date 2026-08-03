/**
 * # Dashboard repository — the KPI rollup
 *
 * Owned by **W2-A**. One export, `getDashboardSnapshot()`, wrapped in
 * `withRepository()` like every other read in the layer.
 *
 * ## Partial failure is a first-class outcome
 *
 * The five panels fan out with **`Promise.allSettled`, not `Promise.all`**. With
 * `Promise.all`, one slow or broken table takes the entire dashboard down — the
 * W2-A brief names this directly: *"Do not fail the whole dashboard for one
 * panel."* So a panel that throws is recorded in `failedPanels`, the rest are
 * returned, and `degraded()` attaches a `degradedReason` that **names** the panel
 * that did not load. A blank tile with no explanation is the outcome this design
 * exists to prevent.
 *
 * The one case that still throws is *every* attempted panel failing. That is not
 * a partial result, it is an outage, and returning an empty dashboard labelled
 * `source: "supabase"` would assert that the database is empty — which is a
 * different and much worse claim than "the database is down".
 *
 * ## Role scoping — defence in depth beside RLS
 *
 * RLS is the boundary. This duplicates it deliberately (W2-A brief §4) because
 * RLS does not exist in local-seed mode, where a `guest` would otherwise be
 * handed the ledger. Scope comes from `lib/rbac.ts`, never from a hardcoded role
 * list:
 *
 * | Panel | Gate |
 * |---|---|
 * | `hotel` | none — public showcase, every role including anonymous |
 * | `inventory` | internal scope + `units:view` |
 * | `operations` | `tickets:view` — RLS scopes the rows |
 * | `finance` | `canViewInternalFinance` (admin · manager · accountant) |
 * | `evidence` | `evidence:view` (manager and above, CONTRACTS §3) |
 *
 * "Internal scope" means `roleScope(role)` is one of company / site / finance /
 * field. `owner` and `tenant` hold `units:view` but their horizon is a single
 * unit, and a **project-wide** rollup of all 656 units and their prices is not
 * that. Scoping the rollup down to one owner needs the `unit_residents` join,
 * which is not part of the schema this window verified — so those roles get the
 * public showcase and the restriction is named in `restrictedPanels` rather than
 * silently widened. That is a request for W1-A, not a guessed table name.
 *
 * ## Bounded reads
 *
 * No `select()` here is unbounded. `units` is paged at 500 with a 2,000-row cap
 * (656 rows fit in two round trips, not 657 — `.range()`, not one query per
 * unit); every other table takes one bounded page. Exact totals come from
 * `count: "exact", head: true`, so `totalUnits` stays right even when a
 * distribution was computed from a partial sample — which `truncatedPanels`
 * reports rather than hides.
 */

import type { RepositoryResult, Role } from "@/lib/contracts"
import { canViewInternalFinance, hasPermission, roleScope } from "@/lib/rbac"
import {
  MAX_PAGE_SIZE,
  RepositoryError,
  SEED_ANCHOR_ISO,
  asBoolean,
  asMoney,
  asNullableNumber,
  asNullableString,
  degraded,
  nowIso,
  toApiError,
  totalsByCurrency,
  unwrap,
  withRepository,
  type RepositoryClient,
} from "@/lib/repository-base"
import {
  HOTEL_COLUMNS,
  REVIEW_SOURCE_COLUMNS,
  mapHotelRow,
  mapReviewSourceRow,
} from "@/lib/hotel-repository"
import {
  seedEvidencePanel,
  seedFinancePanel,
  seedHotelPanel,
  seedInventoryPanel,
  seedOperationsPanel,
  type DashboardPanel,
  type DashboardSnapshot,
  type EvidencePanel,
  type FinancePanel,
  type HotelPanel,
  type InventoryPanel,
  type OperationsPanel,
} from "@/lib/dashboard-data"

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

const ROLLUP_PAGE_SIZE = MAX_PAGE_SIZE
/** Two pages covers the 656-unit inventory with headroom, and stops there. */
const ROLLUP_ROW_CAP = 2000

const UNIT_ROLLUP_COLUMNS =
  "id, sale_status, data_quality, layout, block_code, asking_price_amount, asking_price_currency, is_publicly_listed"

const TICKET_ROLLUP_COLUMNS = "status, priority, sla_due_at"
const LEDGER_ROLLUP_COLUMNS = "status, debit_amount, credit_amount, currency"

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

export interface DashboardAccess {
  inventory: boolean
  operations: boolean
  finance: boolean
  evidence: boolean
  /** Always true: the hotel and its reviews are the public showcase. */
  hotel: boolean
}

/**
 * Which panels this role may see. `undefined` is anonymous and gets the public
 * showcase only — the same as `guest` and `child_guest`, which is the point:
 * "no role supplied" must fail closed rather than default to a staff view.
 */
/** Roles that run the site rather than live in it. */
function isInternalScope(role: Role): boolean {
  const scope = roleScope(role)
  return (
    scope === "company" ||
    scope === "site" ||
    scope === "finance" ||
    scope === "field"
  )
}

export function dashboardAccess(role: Role | undefined): DashboardAccess {
  if (role === undefined) {
    return {
      inventory: false,
      operations: false,
      finance: false,
      evidence: false,
      hotel: true,
    }
  }
  return {
    /**
     * Site-wide inventory stays internal, and that is a measurement rather than
     * caution. Opening it to residents was tried, and a tenant's home came back
     * reading "Units 23": RLS had correctly narrowed 656 rows to the 22 publicly
     * listed units plus their own. A truthful row set, and a false headline —
     * a resident reads that card as "I have 23 apartments". A site-wide count is
     * a site-wide fact. Showing a resident THEIR unit needs a scoped query, not
     * a filtered global one, and inventing the number was not on the table.
     */
    inventory: isInternalScope(role) && hasPermission(role, "units:view"),
    /**
     * Operations, by contrast, is now permission-only.
     *
     * It used to demand internal scope too, which produced a tenant home whose
     * "Open tickets" card read "This panel is outside your role" — untrue (a
     * tenant holds `tickets:view` and has Tickets in their nav) and unreadable.
     * Dropping the second gate is safe because the row scoping never rested on
     * it: every query here goes through `createClient()` in `lib/supabase/server`,
     * which carries the ANON key plus the caller's own cookies, so Postgres RLS
     * decides which rows exist for that session. A resident counts the tickets
     * they may see, not the site's.
     */
    operations: hasPermission(role, "tickets:view"),
    finance: canViewInternalFinance(role),
    evidence: hasPermission(role, "evidence:view"),
    hotel: true,
  }
}

// ---------------------------------------------------------------------------
// Counting helpers
// ---------------------------------------------------------------------------

/** Stable key order, so two identical snapshots serialise to identical JSON. */
function sortedCounts(counts: Record<string, number>): Record<string, number> {
  const sorted: Record<string, number> = {}
  for (const key of Object.keys(counts).sort()) {
    const value = counts[key]
    // noUncheckedIndexedAccess: the key came from Object.keys, but the compiler
    // does not know that.
    if (value !== undefined) sorted[key] = value
  }
  return sorted
}

interface Tally {
  counts: Record<string, number>
  /** Rows whose grouping value was NULL. Never merged into a bucket. */
  missing: number
}

function tallyBy(
  rows: ReadonlyArray<Record<string, unknown>>,
  pick: (row: Record<string, unknown>) => string | null
): Tally {
  const counts: Record<string, number> = {}
  let missing = 0
  for (const row of rows) {
    const key = pick(row)
    if (key === null) {
      missing += 1
      continue
    }
    counts[key] = (counts[key] ?? 0) + 1
  }
  return { counts: sortedCounts(counts), missing }
}

/** Exact row count via `head: true` — no rows transferred, no ceiling to hit. */
async function countRows(
  client: RepositoryClient,
  table: string
): Promise<number | null> {
  const { count, error } = await client
    .from(table)
    .select("*", { count: "exact", head: true })
  if (error) throw error
  return count ?? null
}

/**
 * One bounded page. Used for the tables where this window has no verified
 * orderable key — paging without a stable ORDER BY can repeat and skip rows, so
 * a single page plus an honest `truncated` flag beats a silently wrong scan.
 */
async function fetchPage(
  client: RepositoryClient,
  table: string,
  columns: string
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const rows = unwrap<Record<string, unknown>[]>(
    await client.from(table).select(columns).limit(ROLLUP_PAGE_SIZE),
    []
  )
  return { rows, truncated: rows.length >= ROLLUP_PAGE_SIZE }
}

/**
 * Every row of a table, paged on a stable ordered key.
 *
 * The generalisation of `fetchUnitRows`, written because `fetchPage` silently
 * produced a WRONG number on a table larger than one page. `sourced_facts` holds
 * 1,354 rows; a single unordered 500-row page contained no `gap` confidence at
 * all, so "Unestablished facts" resolved to `undefined` and the dashboard
 * rendered an em dash where 633 belonged. Worse, with no ORDER BY the sample was
 * only stable while the table was untouched — one UPDATE moves rows in the heap
 * and the figure changes with nothing having changed.
 *
 * A bounded page is the right tool only when there is no orderable key. When
 * there is one, read the whole table.
 */
async function fetchAllRows(
  client: RepositoryClient,
  table: string,
  columns: string,
  orderKey: string
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const rows: Record<string, unknown>[] = []
  for (let offset = 0; offset < ROLLUP_ROW_CAP; offset += ROLLUP_PAGE_SIZE) {
    const size = Math.min(ROLLUP_PAGE_SIZE, ROLLUP_ROW_CAP - offset)
    const page = unwrap<Record<string, unknown>[]>(
      await client
        .from(table)
        .select(columns)
        .order(orderKey, { ascending: true })
        .range(offset, offset + size - 1),
      []
    )
    rows.push(...page)
    if (page.length < size) return { rows, truncated: false }
  }
  return { rows, truncated: true }
}

/**
 * `units`, paged on its primary key. 656 rows in two round trips — the N+1 the
 * brief warns about is 657 queries, and this is 2.
 */
async function fetchUnitRows(
  client: RepositoryClient
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const rows: Record<string, unknown>[] = []
  for (let offset = 0; offset < ROLLUP_ROW_CAP; offset += ROLLUP_PAGE_SIZE) {
    const size = Math.min(ROLLUP_PAGE_SIZE, ROLLUP_ROW_CAP - offset)
    const page = unwrap<Record<string, unknown>[]>(
      await client
        .from("units")
        .select(UNIT_ROLLUP_COLUMNS)
        // units.id is TEXT ("AZW-B03-0412"), not uuid, and is the stable key.
        .order("id", { ascending: true })
        .range(offset, offset + size - 1),
      []
    )
    rows.push(...page)
    if (page.length < size) return { rows, truncated: false }
  }
  return { rows, truncated: true }
}

// ---------------------------------------------------------------------------
// Panel loaders
// ---------------------------------------------------------------------------

async function loadInventory(
  client: RepositoryClient
): Promise<InventoryPanel> {
  const [totalUnits, page] = await Promise.all([
    countRows(client, "units"),
    fetchUnitRows(client),
  ])
  const { rows, truncated } = page

  const saleStatus = tallyBy(rows, (row) => asNullableString(row.sale_status))
  const dataQuality = tallyBy(rows, (row) => asNullableString(row.data_quality))
  const layout = tallyBy(rows, (row) => asNullableString(row.layout))
  const block = tallyBy(rows, (row) => asNullableString(row.block_code))

  const money: Array<{ amount: number; currency: string }> = []
  let unitsWithoutUsablePrice = 0
  let publiclyListedUnits = 0
  for (const row of rows) {
    // numeric(14,2) arrives as "112000.00". asMoney parses it and refuses to
    // invent a currency, so an amount with no currency stays out of the totals.
    const parsed = asMoney(row.asking_price_amount, row.asking_price_currency)
    if (parsed === null) unitsWithoutUsablePrice += 1
    else money.push(parsed)
    if (asBoolean(row.is_publicly_listed)) publiclyListedUnits += 1
  }
  const askingPriceTotalsByCurrency = sortedCounts(totalsByCurrency(money))

  return {
    totalUnits,
    sampledUnits: rows.length,
    truncated,
    bySaleStatus: saleStatus.counts,
    unitsWithoutSaleStatus: saleStatus.missing,
    byDataQuality: dataQuality.counts,
    modelledUnits: dataQuality.counts.modelled ?? 0,
    portalListingUnits: dataQuality.counts.portal_listing ?? 0,
    byLayout: layout.counts,
    byBlock: block.counts,
    publiclyListedUnits,
    askingPriceTotalsByCurrency,
    currencies: Object.keys(askingPriceTotalsByCurrency),
    unitsWithoutUsablePrice,
  }
}

/**
 * Ticket statuses that mean the work is finished. Everything else — `open`,
 * `assigned`, `in_progress`, `blocked`, `draft` — is still somebody's job and
 * counts as open.
 */
const TERMINAL_TICKET_STATUSES = new Set(["resolved", "closed", "cancelled"])

async function loadOperations(
  client: RepositoryClient,
  slaEvaluatedAt: string
): Promise<OperationsPanel> {
  const [totalTickets, page] = await Promise.all([
    countRows(client, "service_tickets"),
    fetchPage(client, "service_tickets", TICKET_ROLLUP_COLUMNS),
  ])
  const { rows, truncated } = page

  let overdueTickets = 0
  let ticketsWithoutSla = 0
  let openTickets = 0
  for (const row of rows) {
    const due = asNullableString(row.sla_due_at)
    // No SLA date is not "on time" — it is no commitment at all, counted apart.
    if (due === null) ticketsWithoutSla += 1
    else if (due < slaEvaluatedAt) overdueTickets += 1

    // "Open" means still someone's work. The card labelled "Open tickets" used
    // to render `totalTickets`, so a site with 42 tickets of which 35 were
    // closed, cancelled or resolved reported 42 — a number a manager reads as
    // their workload, contradicted by the donut beside it on the same page.
    const status = asNullableString(row.status)
    if (status !== null && !TERMINAL_TICKET_STATUSES.has(status)) openTickets += 1
  }

  return {
    totalTickets,
    openTickets,
    sampledTickets: rows.length,
    truncated,
    byStatus: tallyBy(rows, (row) => asNullableString(row.status)).counts,
    byPriority: tallyBy(rows, (row) => asNullableString(row.priority)).counts,
    overdueTickets,
    ticketsWithoutSla,
    slaEvaluatedAt,
  }
}

async function loadFinance(client: RepositoryClient): Promise<FinancePanel> {
  const [totalEntries, page] = await Promise.all([
    countRows(client, "finance_ledger_entries"),
    fetchPage(client, "finance_ledger_entries", LEDGER_ROLLUP_COLUMNS),
  ])
  const { rows, truncated } = page

  const debits: Array<{ amount: number; currency: string }> = []
  const credits: Array<{ amount: number; currency: string }> = []
  let entriesWithoutUsableAmount = 0
  for (const row of rows) {
    const debit = asMoney(row.debit_amount, row.currency)
    const credit = asMoney(row.credit_amount, row.currency)
    if (debit === null && credit === null) {
      // Both columns are NOT NULL DEFAULT 0, so this only happens when the
      // currency is missing or outside the supported set — never a real 0.
      entriesWithoutUsableAmount += 1
      continue
    }
    // `finance_ledger_entries_single_sided` guarantees exactly one side is > 0.
    // The other is a structural 0, and adding it would list a currency as having
    // debits when every one of them was zero.
    if (debit !== null && debit.amount !== 0) debits.push(debit)
    if (credit !== null && credit.amount !== 0) credits.push(credit)
  }

  const debitTotalsByCurrency = sortedCounts(totalsByCurrency(debits))
  const creditTotalsByCurrency = sortedCounts(totalsByCurrency(credits))

  return {
    totalEntries,
    sampledEntries: rows.length,
    truncated,
    byStatus: tallyBy(rows, (row) => asNullableString(row.status)).counts,
    debitTotalsByCurrency,
    creditTotalsByCurrency,
    // Union of both sides, so a currency that only ever appears as a credit is
    // still listed. Never summed across — that number would mean nothing.
    currencies: [
      ...new Set([
        ...Object.keys(debitTotalsByCurrency),
        ...Object.keys(creditTotalsByCurrency),
      ]),
    ].sort(),
    entriesWithoutUsableAmount,
  }
}

async function loadEvidence(client: RepositoryClient): Promise<EvidencePanel> {
  const [
    totalFindings,
    totalFacts,
    totalSources,
    findingsPage,
    factsPage,
    sourcesPage,
  ] = await Promise.all([
    countRows(client, "findings"),
    countRows(client, "sourced_facts"),
    countRows(client, "sources"),
    fetchPage(client, "findings", "severity, area"),
    // `sourced_facts` is 1,354 rows — larger than one page. A single unordered
    // page dropped the whole `gap` confidence and rendered the "Unestablished
    // facts" card as an em dash. Read all of it, ordered, so the tally is the
    // real distribution rather than whatever the heap happened to return.
    fetchAllRows(client, "sourced_facts", "confidence", "id"),
    fetchPage(client, "sources", "tier"),
  ])

  return {
    totalFindings,
    findingsBySeverity: tallyBy(findingsPage.rows, (row) =>
      asNullableString(row.severity)
    ).counts,
    findingsByArea: tallyBy(findingsPage.rows, (row) =>
      asNullableString(row.area)
    ).counts,
    totalFacts,
    factsByConfidence: tallyBy(factsPage.rows, (row) =>
      asNullableString(row.confidence)
    ).counts,
    totalSources,
    sourcesByTier: tallyBy(sourcesPage.rows, (row) => {
      // `tier` is a smallint, so it arrives as a number rather than a string.
      const tier = asNullableNumber(row.tier)
      return tier === null ? null : String(tier)
    }).counts,
    truncated:
      findingsPage.truncated || factsPage.truncated || sourcesPage.truncated,
  }
}

async function loadHotel(client: RepositoryClient): Promise<HotelPanel> {
  const hotelRows = unwrap<Record<string, unknown>[]>(
    await client
      .from("hotels")
      .select(HOTEL_COLUMNS)
      .order("code", { ascending: true })
      .limit(1),
    []
  )
  // noUncheckedIndexedAccess: `hotelRows[0]` is `Record<string, unknown> | undefined`.
  const first = hotelRows[0]
  if (first === undefined) {
    return {
      name: null,
      roomCount: null,
      publishedRoomTypes: 0,
      roomBreakdownPublished: false,
      reviewSourceCount: 0,
      scores: [],
    }
  }
  const hotel = mapHotelRow(first)

  const [roomCountResponse, reviewRows] = await Promise.all([
    client
      .from("hotel_rooms")
      .select("*", { count: "exact", head: true })
      .eq("hotel_id", hotel.id),
    client
      .from("review_sources")
      .select(REVIEW_SOURCE_COLUMNS)
      .eq("hotel_id", hotel.id)
      .order("platform", { ascending: true })
      .order("url", { ascending: true })
      .limit(ROLLUP_PAGE_SIZE),
  ])
  if (roomCountResponse.error) throw roomCountResponse.error
  const sources = unwrap<Record<string, unknown>[]>(reviewRows, []).map(
    mapReviewSourceRow
  )
  const publishedRoomTypes = roomCountResponse.count ?? 0

  return {
    name: hotel.name,
    roomCount: hotel.roomCount,
    // Zero rows here is the expected, correct answer: no source publishes a
    // room-type breakdown for this property, only the total.
    publishedRoomTypes,
    roomBreakdownPublished: publishedRoomTypes > 0,
    reviewSourceCount: sources.length,
    scores: sources.map((source) => ({
      url: source.url,
      platform: source.platform,
      publisher: source.publisher,
      score: source.score,
      scale: source.scoreScale,
      reviewCount: source.reviewCount,
    })),
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

interface PanelSet {
  inventory: InventoryPanel | null
  operations: OperationsPanel | null
  finance: FinancePanel | null
  evidence: EvidencePanel | null
  hotel: HotelPanel | null
}

function restrictedFrom(access: DashboardAccess): DashboardPanel[] {
  const restricted: DashboardPanel[] = []
  if (!access.inventory) restricted.push("inventory")
  if (!access.operations) restricted.push("operations")
  if (!access.finance) restricted.push("finance")
  if (!access.evidence) restricted.push("evidence")
  if (!access.hotel) restricted.push("hotel")
  return restricted
}

function truncatedFrom(panels: PanelSet): DashboardPanel[] {
  const truncated: DashboardPanel[] = []
  if (panels.inventory?.truncated === true) truncated.push("inventory")
  if (panels.operations?.truncated === true) truncated.push("operations")
  if (panels.finance?.truncated === true) truncated.push("finance")
  if (panels.evidence?.truncated === true) truncated.push("evidence")
  return truncated
}

function assembleSnapshot(input: {
  generatedAt: string
  role: Role | null
  profileId: string | null
  access: DashboardAccess
  panels: PanelSet
  failedPanels: DashboardPanel[]
}): DashboardSnapshot {
  return {
    generatedAt: input.generatedAt,
    role: input.role,
    profileId: input.profileId,
    restrictedPanels: restrictedFrom(input.access),
    failedPanels: input.failedPanels,
    truncatedPanels: truncatedFrom(input.panels),
    inventory: input.panels.inventory,
    operations: input.panels.operations,
    finance: input.panels.finance,
    evidence: input.panels.evidence,
    hotel: input.panels.hotel,
  }
}

async function loadSnapshot(
  client: RepositoryClient,
  role: Role | null,
  profileId: string | null,
  access: DashboardAccess
): Promise<DashboardSnapshot> {
  const generatedAt = nowIso()

  // allSettled, never all: one broken table must not blank the other four.
  const settled = await Promise.allSettled([
    access.inventory ? loadInventory(client) : Promise.resolve(null),
    access.operations
      ? loadOperations(client, generatedAt)
      : Promise.resolve(null),
    access.finance ? loadFinance(client) : Promise.resolve(null),
    access.evidence ? loadEvidence(client) : Promise.resolve(null),
    access.hotel ? loadHotel(client) : Promise.resolve(null),
  ])

  const failedPanels: DashboardPanel[] = []
  const failures: unknown[] = []
  function take<T>(
    outcome: PromiseSettledResult<T | null>,
    panel: DashboardPanel
  ): T | null {
    if (outcome.status === "fulfilled") return outcome.value
    failedPanels.push(panel)
    failures.push(outcome.reason)
    return null
  }

  const panels: PanelSet = {
    inventory: take(settled[0], "inventory"),
    operations: take(settled[1], "operations"),
    finance: take(settled[2], "finance"),
    evidence: take(settled[3], "evidence"),
    hotel: take(settled[4], "hotel"),
  }

  const attempted = [
    access.inventory,
    access.operations,
    access.finance,
    access.evidence,
    access.hotel,
  ].filter(Boolean).length

  // Everything the role was allowed to load failed. That is an outage, not a
  // partial result: returning empty panels labelled `source: "supabase"` would
  // assert the database is empty, which is a different claim entirely.
  if (attempted > 0 && failedPanels.length === attempted) {
    const cause = failures[0]
    throw new RepositoryError(toApiError(cause, "dashboard.snapshot"), cause)
  }

  return assembleSnapshot({
    generatedAt,
    role,
    profileId,
    access,
    panels,
    failedPanels,
  })
}

function seedSnapshot(
  role: Role | null,
  profileId: string | null,
  access: DashboardAccess
): DashboardSnapshot {
  return assembleSnapshot({
    // Fixed, not `nowIso()`: two seeded snapshots must serialise identically.
    generatedAt: SEED_ANCHOR_ISO,
    role,
    profileId,
    access,
    panels: {
      inventory: access.inventory ? seedInventoryPanel() : null,
      operations: access.operations ? seedOperationsPanel() : null,
      finance: access.finance ? seedFinancePanel() : null,
      evidence: access.evidence ? seedEvidencePanel() : null,
      hotel: access.hotel ? seedHotelPanel() : null,
    },
    failedPanels: [],
  })
}

// ---------------------------------------------------------------------------
// The export
// ---------------------------------------------------------------------------

export interface DashboardQuery {
  /** The caller's role. Omitted means anonymous: public showcase only. */
  role?: Role
  /**
   * The caller's `profiles.id`. Echoed into the snapshot and reserved for
   * per-owner scoping, which needs the `unit_residents` join this window has not
   * verified — see the header note.
   */
  profileId?: string
}

/**
 * The dashboard rollup, scoped to the caller's role.
 *
 * Read `failedPanels` before `inventory`/`operations`/`finance`/`evidence`: a
 * `null` panel means one of *restricted*, *failed* or *not applicable*, and the
 * three lists on the snapshot are what tell them apart. `degradedReason` names
 * any panel that failed or was truncated; a restricted panel does **not** set it,
 * because a scoped-down dashboard is the correct answer for that role rather
 * than a degradation of it.
 */
export async function getDashboardSnapshot(
  opts: DashboardQuery = {}
): Promise<RepositoryResult<DashboardSnapshot>> {
  const role = opts.role ?? null
  const profileId = opts.profileId ?? null
  const access = dashboardAccess(opts.role)

  const result = await withRepository<DashboardSnapshot>(
    (client) => loadSnapshot(client, role, profileId, access),
    () => seedSnapshot(role, profileId, access),
    "dashboard.getDashboardSnapshot"
  )

  const notes: string[] = []
  if (result.data.failedPanels.length > 0) {
    notes.push(
      `Panels that did not load: ${result.data.failedPanels.join(", ")}.`
    )
  }
  if (result.data.truncatedPanels.length > 0) {
    notes.push(
      `Distributions computed from a bounded sample for: ${result.data.truncatedPanels.join(", ")}.`
    )
  }
  return notes.length === 0 ? result : degraded(result, notes.join(" "))
}
