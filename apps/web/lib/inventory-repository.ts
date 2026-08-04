/**
 * # Inventory repository — site, blocks, floors, units, availability
 *
 * Owned by **W2-A**. Every route handler and every Server Component that needs
 * inventory goes through this file; nothing else calls Supabase for it.
 *
 * ## The two rules, restated because they are the whole point
 *
 * 1. Every function returns `RepositoryResult<T>` with a `source`. Check that
 *    field before suspecting Postgres.
 * 2. Supabase **unconfigured** falls back to the local seed and labels itself.
 *    Supabase **configured and failing** throws — `withRepository` never
 *    catches a real error into seed data, because a production outage wearing
 *    plausible seed data is the bug this layer exists to prevent. A configured
 *    Supabase returning **zero rows** is `source: "supabase"` with empty data:
 *    an empty table is a fact about the database, not a failure.
 *
 * ## Provenance: why this file reads the evidence tables
 *
 * `AzuraUnit.askingPrice` is a `SourcedFact<Money>` (CONTRACTS §2), and the
 * `units` table has no provenance columns — it stores `asking_price_amount`
 * and nothing about where that figure came from. The citations live in
 * `sourced_facts → fact_sources → sources / source_snapshots` (migration 03),
 * which are world-readable. So a unit's price fact is assembled here from one
 * **batched** query over `sourced_facts` for the page's unit ids.
 *
 * When no `sourced_facts` row cites a unit's price, the fact is a `"gap"` and
 * the stored number is **not** returned. That is deliberate: SYSTEM-PROMPT §2.1
 * says every figure shown to a user carries its source URL, and a price with no
 * citation is not displayable. There is no `askingPriceRaw` escape hatch, and
 * adding one would be the CONTRACTS §8 anti-pattern "a number in JSX with no
 * source".
 *
 * `getSite()` is deliberately **not** given the same treatment. It returns the
 * `sites` row as the ERP record it is; the `SourcedFact`-wrapped project view
 * (`AzuraProject`) is composed from `getFactsForEntity("project", "AZW-TRK")`
 * by the evidence repository, and duplicating that mapping here would give the
 * project two provenance implementations that could disagree.
 *
 * ## Query counts — N+1 is a fail
 *
 * 656 units each fetching its block would be 657 queries. Instead:
 *
 * | call | queries |
 * |---|---|
 * | `getUnits()` default page of 50, staff role | 1 units (block embedded) + 1 facts + 1 competing prices + 1 source register = **4** |
 * | `getUnits()` for an owner | + 1 holdings (+ 1 guardianship for a `child_*` role) |
 * | `getUnits({ limit: 500 })` | facts and competing prices chunk at 100 ids → **≤ 14** |
 * | `getUnit(id)` | ≤ 5 |
 * | `getAvailabilityRollup()` | ⌈656 / 500⌉ = **2** |
 *
 * The source register and the competing-price query are skipped entirely when a
 * page has no competing prices.
 *
 * ## Role scoping duplicates RLS on purpose
 *
 * RLS is the boundary that must hold. The scoping below is defence in depth and
 * the only thing that works in local-seed mode, where there is no RLS at all.
 * It is never *looser* than the policies in migrations 01–02.
 */

import type {
  AzuraUnit,
  Money,
  RepositoryResult,
  Role,
  SourceRef,
  SourceTier,
  SourcedFact,
  Confidence,
  UnitLayout,
} from "@/lib/contracts"
import { roleLevel } from "@/lib/contracts"
import { isResidentRole } from "@/lib/rbac"
import type {
  CurrencyCode,
  ResidentRelation,
  SaleStatus,
  SeedCitation,
  UnitDataQuality,
} from "@/lib/inventory-data"
import {
  SALE_STATUSES,
  UNIT_DATA_QUALITIES,
  median,
  seedBlockRows,
  seedFloorRows,
  seedGuardianshipRows,
  seedCompanyRow,
  seedSiteRow,
  seedSourceRegister,
  seedUnitFactRows,
  seedUnitResidentRows,
  seedUnitRows,
} from "@/lib/inventory-data"
import { seedCompetingPriceRows } from "@/lib/portal-data"
import {
  asBoolean,
  asMoney,
  asNullableNumber,
  asNullableString,
  asNumber,
  asRecord,
  asString,
  clampLimit,
  clampOffset,
  degraded,
  relatedRecord,
  totalsByCurrency,
  withRepository,
  type RepositoryClient,
} from "@/lib/repository-base"

// ---------------------------------------------------------------------------
// Domain shapes
// ---------------------------------------------------------------------------

/** The `sites` row. One row exists: `AZW-TRK`. */
/**
 * The developer behind the site — `public.companies`.
 *
 * Read so that a screen can name an organisation instead of printing its
 * primary key. `legalName`, `foundedYear` and `website` are nullable in the
 * schema and stay nullable here: a company that has not stated its founding
 * year must render as a stated gap, not as a plausible year.
 */
export interface CompanyRecord {
  id: string
  slug: string
  name: string
  legalName: string | null
  country: string
  defaultCurrency: string
  foundedYear: number | null
  website: string | null
}

export interface SiteRecord {
  id: string
  companyId: string
  code: string
  name: string
  country: string
  province: string
  city: string
  district: string
  plotAreaSqm: number | null
  greenAreaSqm: number | null
  buildingFootprintSqm: number | null
  outdoorFacilityAreaSqm: number | null
  residenceBlockCount: number | null
  buildingCount: number | null
  floorsPerBuilding: number | null
  totalUnits: number | null
  constructionStart: string | null
  completionDate: string | null
  buildStatus: "planned" | "under_construction" | "completed" | null
  distanceToSeaM: number | null
  distanceToAlanyaCentreKm: number | null
  distanceToGazipasaAirportKm: number | null
  distanceToAntalyaAirportKm: number | null
  downPaymentPercent: number | null
  latitude: number | null
  longitude: number | null
  contact: {
    phone: string | null
    email: string | null
    address: string | null
  }
  createdAt: string
  updatedAt: string
}

/** A `site_blocks` row. */
export interface BlockRecord {
  id: string
  siteId: string
  code: string
  name: string | null
  floors: number | null
  unitCount: number | null
  sortOrder: number
}

/** A `site_floors` row. */
export interface FloorRecord {
  id: string
  blockId: string
  level: number
  label: string | null
  unitCount: number | null
}

/**
 * `AzuraUnit` (CONTRACTS §2) plus the ERP columns the contract's dataset view
 * has no reason to carry. Widening rather than editing the frozen type: an
 * `InventoryUnit[]` is assignable anywhere an `AzuraUnit[]` is expected.
 */
export interface InventoryUnit extends AzuraUnit {
  siteId: string
  blockId: string
  floorId: string | null
  unitNo: string
  blockName: string | null
  /** Anon and guest read only rows where this is true. */
  isPubliclyListed: boolean
  /** Optimistic concurrency. A stale write must 409, never last-write-wins. */
  version: number
  createdAt: string
  updatedAt: string
}

/** Price range for one currency **and one data quality**. Never blended: a
 *  modelled figure must not set a headline "from" price, and
 *  `sum(EUR) + sum(USD)` is meaningless (CONVENTIONS §5). */
export interface CurrencyPriceBucket {
  currency: CurrencyCode
  dataQuality: UnitDataQuality
  count: number
  min: number
  max: number
  median: number
  total: number
}

export interface LayoutRollup {
  layout: UnitLayout
  count: number
  available: number
  portalListing: number
  modelled: number
}

export interface BlockRollup {
  blockCode: string
  blockName: string | null
  count: number
  available: number
  portalListing: number
  modelled: number
}

export interface AvailabilityRollup {
  totalUnits: number
  bySaleStatus: Record<SaleStatus, number>
  /** `modelled` and `portal_listing` are separate keys, always. W3-C keeps them
   *  visually distinct and cannot do that from a merged total. */
  byDataQuality: Record<UnitDataQuality, number>
  byLayout: LayoutRollup[]
  byBlock: BlockRollup[]
  priceByCurrency: CurrencyPriceBucket[]
  /** Per-currency sums over every priced unit, modelled included. Per currency
   *  because adding EUR to USD is meaningless. */
  totalsByCurrency: Record<string, number>
  pricedUnits: number
  unpricedUnits: number
}

/** Caller identity plus filters. `role` and `profileId` drive scoping. */
export interface UnitQueryOptions {
  role?: Role
  profileId?: string
  limit?: number
  offset?: number
  layout?: UnitLayout
  dataQuality?: UnitDataQuality
  saleStatus?: SaleStatus
  blockCode?: string
}

/** Caller identity only. */
export interface ScopeOptions {
  role?: Role
  profileId?: string
}

// ---------------------------------------------------------------------------
// Selects
// ---------------------------------------------------------------------------

/** One query, block name embedded. The alternative is 657 queries. */
const UNIT_SELECT =
  "id, company_id, site_id, block_id, floor_id, block_code, unit_no, sequence, layout, interior_m2, outdoor_m2, floor_level, asking_price_amount, asking_price_currency, sale_status, data_quality, is_publicly_listed, version, created_at, updated_at, site_blocks(code, name)"

/** The rollup needs no provenance and no ids — six columns over 656 rows. */
const ROLLUP_SELECT =
  "block_code, layout, sale_status, data_quality, asking_price_amount, asking_price_currency, site_blocks(name)"

const FACT_SELECT =
  "id, entity_type, entity_id, field_path, value, confidence, note, fact_sources(snapshot_sha256, sources(id, url, publisher, tier), source_snapshots(fetched_at)), fact_conflicts(value, snapshot_sha256, sources(id, url, publisher, tier), source_snapshots(fetched_at))"

const SOURCE_REGISTER_SELECT =
  "id, url, publisher, tier, source_snapshots(fetched_at, snapshot_sha256)"

/** `.in()` list size. 500 text ids in one URL is a request-line length bug
 *  waiting to happen; 100 keeps every generated URL comfortably small while
 *  staying five queries away from N+1. */
const ID_CHUNK_SIZE = 100

const ROLLUP_PAGE_SIZE = 500
const ROLLUP_MAX_ROWS = 5000

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function rowsOf(data: unknown): Array<Record<string, unknown>> {
  return Array.isArray(data) ? data.map(asRecord) : []
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

function asCurrency(value: unknown): CurrencyCode | null {
  return value === "EUR" ||
    value === "USD" ||
    value === "TRY" ||
    value === "GBP"
    ? value
    : null
}

function asSaleStatus(value: unknown): SaleStatus | null {
  return SALE_STATUSES.find((status) => status === value) ?? null
}

function asDataQuality(value: unknown): UnitDataQuality | null {
  return UNIT_DATA_QUALITIES.find((quality) => quality === value) ?? null
}

function asLayout(value: unknown): UnitLayout | null {
  return typeof value === "string" ? (value as UnitLayout) : null
}

function asSourceTier(value: unknown): SourceTier | null {
  const tier = asNullableNumber(value)
  if (tier === 1 || tier === 2 || tier === 3) return tier
  if (tier === 4 || tier === 5 || tier === 6) return tier
  return null
}

const CONFIDENCE_VALUES: readonly Confidence[] = [
  "confirmed",
  "official",
  "single_source",
  "conflicted",
  "inferred",
  "gap",
]

function asConfidence(value: unknown): Confidence | null {
  return CONFIDENCE_VALUES.find((candidate) => candidate === value) ?? null
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value)
    ? value
    : value === null || value === undefined
      ? []
      : [value]
}

// ---------------------------------------------------------------------------
// Provenance mapping
// ---------------------------------------------------------------------------

/**
 * Flatten one `fact_sources` / `fact_conflicts` row into a `SourceRef`.
 * Returns `null` when any of the five required fields is missing — a partial
 * citation is not a citation, and inventing a snapshot hash to fill the hole
 * would defeat CONTRACTS §1 invariant 6.
 */
function mapSourceRef(row: Record<string, unknown>): SourceRef | null {
  const source = relatedRecord(row["sources"])
  const snapshot = relatedRecord(row["source_snapshots"])
  const url = asNullableString(source["url"])
  const publisher = asNullableString(source["publisher"])
  const snapshotHash = asNullableString(row["snapshot_sha256"])
  const fetchedAt = asNullableString(snapshot["fetched_at"])
  const tier = asSourceTier(source["tier"])
  if (
    url === null ||
    publisher === null ||
    snapshotHash === null ||
    fetchedAt === null ||
    tier === null
  ) {
    return null
  }
  return { url, publisher, fetchedAt, snapshotHash, tier }
}

function citationToSourceRef(citation: SeedCitation): SourceRef {
  return {
    url: citation.url,
    publisher: citation.publisher,
    fetchedAt: citation.fetchedAt,
    snapshotHash: citation.snapshotHash,
    tier: citation.tier,
  }
}

/** A gap carrying the reason it is a gap. CONTRACTS §1 invariant 1 requires a
 *  non-empty note, and "we could not find the citation" is a better note than
 *  most. */
function gapFact<T>(note: string): SourcedFact<T> {
  return { value: null, sources: [], confidence: "gap", note }
}

/**
 * Map a `sourced_facts` row (with its two embeds) onto a `SourcedFact<T>`.
 *
 * Downgrades to a gap rather than emitting a contradiction when the stored
 * value does not parse, or when a non-gap fact has no usable citation
 * (invariant 5: only a gap may be sourceless).
 */
function mapSourcedFact<T>(
  row: Record<string, unknown>,
  parse: (value: unknown) => T | null,
  label: string
): SourcedFact<T> {
  const confidence = asConfidence(row["confidence"])
  const note = asNullableString(row["note"])

  if (confidence === null) {
    return gapFact(
      `${label}: the stored fact carries an unrecognised confidence value, so it cannot be displayed.`
    )
  }

  const sources = toArray(row["fact_sources"])
    .map((entry) => mapSourceRef(asRecord(entry)))
    .filter((entry): entry is SourceRef => entry !== null)

  if (confidence === "gap") {
    return {
      value: null,
      sources: [],
      confidence: "gap",
      note:
        note ??
        `${label}: recorded as a gap — no source establishes this value.`,
    }
  }

  const value = parse(row["value"])
  if (value === null) {
    return gapFact(
      `${label}: the stored value did not parse into the shape this field requires, so it is reported as a gap rather than displayed.`
    )
  }
  if (sources.length === 0) {
    return gapFact(
      `${label}: the fact is recorded as "${confidence}" but no citation resolved to a stored snapshot, and a figure without a source URL is not displayable (SYSTEM-PROMPT §2.1).`
    )
  }

  const conflicts = toArray(row["fact_conflicts"])
    .map((entry) => {
      const record = asRecord(entry)
      const source = mapSourceRef(record)
      return source === null ? null : { value: record["value"], source }
    })
    .filter(
      (entry): entry is { value: unknown; source: SourceRef } => entry !== null
    )

  if (confidence === "conflicted" && conflicts.length === 0) {
    // Invariant 2: a conflicted fact must keep the losing value. Without it we
    // would be silently resolving a conflict, which SYSTEM-PROMPT §2.2 forbids.
    return gapFact(
      `${label}: the fact is recorded as conflicted but no competing value survived, and presenting one side of an unresolved disagreement as settled is not permitted.`
    )
  }

  return {
    value,
    sources,
    confidence,
    ...(conflicts.length > 0 ? { conflictsWith: conflicts } : {}),
    ...(note === null ? {} : { note }),
  }
}

function parseMoneyValue(value: unknown): Money | null {
  const record = asRecord(value)
  return asMoney(record["amount"], record["currency"])
}

function parseSaleStatusValue(value: unknown): SaleStatus | null {
  return asSaleStatus(value)
}

type UnitFacts = {
  askingPrice: SourcedFact<Money> | null
  saleStatus: SourcedFact<SaleStatus> | null
}

function indexUnitFacts(
  rows: ReadonlyArray<Record<string, unknown>>
): Map<string, UnitFacts> {
  const index = new Map<string, UnitFacts>()
  for (const row of rows) {
    const entityId = asNullableString(row["entity_id"])
    if (entityId === null) continue
    const current = index.get(entityId) ?? {
      askingPrice: null,
      saleStatus: null,
    }
    const field = asString(row["field_path"])
    if (field === "unit.askingPrice") {
      current.askingPrice = mapSourcedFact(
        row,
        parseMoneyValue,
        `${entityId} askingPrice`
      )
    } else if (field === "unit.saleStatus") {
      current.saleStatus = mapSourcedFact(
        row,
        parseSaleStatusValue,
        `${entityId} saleStatus`
      )
    }
    index.set(entityId, current)
  }
  return index
}

type CompetingPrice = AzuraUnit["competingPrices"][number]

/**
 * `competing_prices` carries a `source_url` but neither a tier nor a snapshot
 * hash, and there is no FK to `sources` (migration 05 says so explicitly), so
 * the register is joined in memory by URL. A row whose URL is not in the
 * register cannot become a `SourceRef` and is counted as unresolved rather than
 * silently dropped — the caller surfaces the count as a `degradedReason`, and
 * `portal-repository.getCompetingPricesForUnit()` still returns the raw row so
 * no evidence is lost.
 */
function indexCompetingPrices(
  rows: ReadonlyArray<Record<string, unknown>>,
  register: ReadonlyMap<string, SeedCitation>
): { index: Map<string, CompetingPrice[]>; unresolved: number } {
  const index = new Map<string, CompetingPrice[]>()
  let unresolved = 0

  for (const row of rows) {
    const unitId = asNullableString(row["unit_id"])
    const money = asMoney(row["amount"], row["currency"])
    const sourceUrl = asNullableString(row["source_url"])
    const observedAt = asNullableString(row["observed_at"])
    if (
      unitId === null ||
      money === null ||
      sourceUrl === null ||
      observedAt === null
    ) {
      unresolved += 1
      continue
    }
    const citation = register.get(sourceUrl)
    if (citation === undefined) {
      unresolved += 1
      continue
    }
    const entry: CompetingPrice = {
      money,
      source: citationToSourceRef(citation),
      observedAt,
    }
    const bucket = index.get(unitId)
    if (bucket === undefined) index.set(unitId, [entry])
    else bucket.push(entry)
  }

  return { index, unresolved }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function mapCompany(row: Record<string, unknown>): CompanyRecord {
  return {
    id: asString(row["id"]),
    slug: asString(row["slug"]),
    name: asString(row["name"]),
    legalName: asNullableString(row["legal_name"]),
    country: asString(row["country"]),
    defaultCurrency: asString(row["default_currency"]),
    foundedYear: asNullableNumber(row["founded_year"]),
    website: asNullableString(row["website"]),
  }
}

function mapSite(row: Record<string, unknown>): SiteRecord {
  const buildStatus = asNullableString(row["build_status"])
  return {
    id: asString(row["id"]),
    companyId: asString(row["company_id"]),
    code: asString(row["code"]),
    name: asString(row["name"]),
    country: asString(row["country"]),
    province: asString(row["province"]),
    city: asString(row["city"]),
    district: asString(row["district"]),
    plotAreaSqm: asNullableNumber(row["plot_area_sqm"]),
    greenAreaSqm: asNullableNumber(row["green_area_sqm"]),
    buildingFootprintSqm: asNullableNumber(row["building_footprint_sqm"]),
    outdoorFacilityAreaSqm: asNullableNumber(row["outdoor_facility_area_sqm"]),
    residenceBlockCount: asNullableNumber(row["residence_block_count"]),
    buildingCount: asNullableNumber(row["building_count"]),
    floorsPerBuilding: asNullableNumber(row["floors_per_building"]),
    totalUnits: asNullableNumber(row["total_units"]),
    constructionStart: asNullableString(row["construction_start"]),
    completionDate: asNullableString(row["completion_date"]),
    buildStatus:
      buildStatus === "planned" ||
      buildStatus === "under_construction" ||
      buildStatus === "completed"
        ? buildStatus
        : null,
    distanceToSeaM: asNullableNumber(row["distance_to_sea_m"]),
    distanceToAlanyaCentreKm: asNullableNumber(
      row["distance_to_alanya_centre_km"]
    ),
    distanceToGazipasaAirportKm: asNullableNumber(
      row["distance_to_gazipasa_airport_km"]
    ),
    distanceToAntalyaAirportKm: asNullableNumber(
      row["distance_to_antalya_airport_km"]
    ),
    downPaymentPercent: asNullableNumber(row["down_payment_percent"]),
    latitude: asNullableNumber(row["latitude"]),
    longitude: asNullableNumber(row["longitude"]),
    contact: {
      phone: asNullableString(row["contact_phone"]),
      email: asNullableString(row["contact_email"]),
      address: asNullableString(row["contact_address"]),
    },
    createdAt: asString(row["created_at"]),
    updatedAt: asString(row["updated_at"]),
  }
}

function mapBlock(row: Record<string, unknown>): BlockRecord {
  return {
    id: asString(row["id"]),
    siteId: asString(row["site_id"]),
    code: asString(row["code"]),
    name: asNullableString(row["name"]),
    floors: asNullableNumber(row["floors"]),
    unitCount: asNullableNumber(row["unit_count"]),
    sortOrder: asNumber(row["sort_order"]),
  }
}

function mapFloor(row: Record<string, unknown>): FloorRecord {
  return {
    id: asString(row["id"]),
    blockId: asString(row["block_id"]),
    level: asNumber(row["level"]),
    label: asNullableString(row["label"]),
    unitCount: asNullableNumber(row["unit_count"]),
  }
}

function mapUnit(
  row: Record<string, unknown>,
  facts: ReadonlyMap<string, UnitFacts>,
  competing: ReadonlyMap<string, CompetingPrice[]>
): InventoryUnit {
  const id = asString(row["id"])
  const block = relatedRecord(row["site_blocks"])
  const unitFacts = facts.get(id)
  const dataQuality = asDataQuality(row["data_quality"]) ?? "source_missing"

  const askingPrice =
    unitFacts?.askingPrice ??
    gapFact<Money>(
      `${id} askingPrice: no sourced_facts row cites this unit's price. The units table may hold a figure, but a price without a citation cannot be displayed (SYSTEM-PROMPT §2.1).`
    )

  const saleStatus =
    unitFacts?.saleStatus ??
    gapFact<SaleStatus>(
      `${id} saleStatus: no source publishes unit-level availability for this project.`
    )

  return {
    id,
    blockCode: asString(row["block_code"]),
    sequence: asNumber(row["sequence"]),
    layout: asLayout(row["layout"]) ?? "1+1",
    interiorM2: asNullableNumber(row["interior_m2"]),
    outdoorM2: asNullableNumber(row["outdoor_m2"]),
    floorLevel: asNullableNumber(row["floor_level"]),
    askingPrice,
    competingPrices: competing.get(id) ?? [],
    saleStatus,
    dataQuality,
    siteId: asString(row["site_id"]),
    blockId: asString(row["block_id"]),
    floorId: asNullableString(row["floor_id"]),
    unitNo: asString(row["unit_no"]),
    blockName: asNullableString(block["name"]),
    isPubliclyListed: asBoolean(row["is_publicly_listed"]),
    version: asNumber(row["version"], 1),
    createdAt: asString(row["created_at"]),
    updatedAt: asString(row["updated_at"]),
  }
}

// ---------------------------------------------------------------------------
// Role scoping
// ---------------------------------------------------------------------------

/** What a caller may see. */
export type InventoryScope =
  | { kind: "all" }
  | { kind: "public" }
  | { kind: "units"; unitIds: readonly string[] }

/** `staff` (40) and above see the whole inventory. */
const STAFF_LEVEL = roleLevel.staff

function isChildRole(role: Role): boolean {
  return (
    role === "child_owner" || role === "child_tenant" || role === "child_guest"
  )
}

function relationForRole(role: Role): ResidentRelation {
  return role === "tenant" || role === "child_tenant" ? "tenant" : "owner"
}

/**
 * Scope kind for a role, before any database lookup.
 *
 * `service_provider` (30) lands on `public` here: it is below `staff`, holds no
 * `unit_residents` edge, and its assignment scope lives in the operations
 * repository, not this one.
 *
 * Exported because the units PAGE has to make the same distinction and must not
 * re-derive it. A resident opening "Units" wants their own apartment; a member
 * of staff wants the 656-unit sales matrix. Deciding that from a second, local
 * role list would put two answers to one question in the tree, and the one on
 * the page would be the one that drifted.
 */
export function scopeKindForRole(
  role: Role | undefined
): "all" | "public" | "resident" {
  if (role === undefined) return "public"
  if ((roleLevel[role] ?? 0) >= STAFF_LEVEL) return "all"
  if (isResidentRole(role)) return "resident"
  return "public"
}

function isActiveEdge(endDate: string | null, today: string): boolean {
  return endDate === null || endDate >= today
}

/**
 * `child_*` roles resolve to their guardian's holdings and are then narrowed to
 * the guardian's PRIMARY holdings.
 *
 * The resolution mirrors `public.current_user_scope_profile_id()` (migration
 * 01), which is what makes "a child never sees more than its guardian"
 * structural. The extra `is_primary` narrowing is this layer's own: the
 * repository may be stricter than RLS, never looser, and without it "a
 * `child_owner` sees a *strict* subset" has no expression in the row set at all.
 */
async function resolveScope(
  client: RepositoryClient,
  options: ScopeOptions,
  today: string
): Promise<InventoryScope> {
  const kind = scopeKindForRole(options.role)
  if (kind === "all") return { kind: "all" }
  if (kind === "public") return { kind: "public" }

  const role = options.role
  if (role === undefined || options.profileId === undefined) {
    // A resident role with no identity cannot be scoped. Fail closed.
    return { kind: "units", unitIds: [] }
  }

  let effectiveProfileId = options.profileId
  const child = isChildRole(role)

  if (child) {
    const { data, error } = await client
      .from("guardianships")
      .select("guardian_profile_id")
      .eq("child_profile_id", options.profileId)
      .eq("status", "active")
      .is("revoked_at", null)
      .limit(1)
    if (error) throw error
    const first = rowsOf(data)[0]
    const guardian =
      first === undefined
        ? null
        : asNullableString(first["guardian_profile_id"])
    if (guardian === null) return { kind: "units", unitIds: [] }
    effectiveProfileId = guardian
  }

  const { data, error } = await client
    .from("unit_residents")
    .select(
      "unit_id, relation, is_primary, end_date, residents!inner(profile_id)"
    )
    .eq("relation", relationForRole(role))
    .eq("residents.profile_id", effectiveProfileId)
    .limit(500)
  if (error) throw error

  return {
    kind: "units",
    unitIds: holdingsFromRows(rowsOf(data), child, today),
  }
}

function holdingsFromRows(
  rows: ReadonlyArray<Record<string, unknown>>,
  primaryOnly: boolean,
  today: string
): string[] {
  const ids: string[] = []
  for (const row of rows) {
    if (!isActiveEdge(asNullableString(row["end_date"]), today)) continue
    if (primaryOnly && !asBoolean(row["is_primary"])) continue
    const unitId = asNullableString(row["unit_id"])
    if (unitId !== null && !ids.includes(unitId)) ids.push(unitId)
  }
  return ids.sort()
}

/** The seed-mode twin of `resolveScope`. Same rules, same order, no RLS. */
function resolveSeedScope(
  options: ScopeOptions,
  today: string
): InventoryScope {
  const kind = scopeKindForRole(options.role)
  if (kind === "all") return { kind: "all" }
  if (kind === "public") return { kind: "public" }

  const role = options.role
  if (role === undefined || options.profileId === undefined) {
    return { kind: "units", unitIds: [] }
  }

  let effectiveProfileId = options.profileId
  const child = isChildRole(role)

  if (child) {
    const guardianship = seedGuardianshipRows().find(
      (row) =>
        row.child_profile_id === options.profileId &&
        row.status === "active" &&
        row.revoked_at === null
    )
    if (guardianship === undefined) return { kind: "units", unitIds: [] }
    effectiveProfileId = guardianship.guardian_profile_id
  }

  const relation = relationForRole(role)
  const rows = seedUnitResidentRows().filter(
    (row) =>
      row.relation === relation &&
      row.residents?.profile_id === effectiveProfileId
  )
  return { kind: "units", unitIds: holdingsFromRows(rows, child, today) }
}

/** Holdings for a profile under any relation — the `getUnitsForResident` case. */
async function resolveHoldings(
  client: RepositoryClient,
  profileId: string,
  today: string
): Promise<string[]> {
  const { data, error } = await client
    .from("unit_residents")
    .select(
      "unit_id, relation, is_primary, end_date, residents!inner(profile_id)"
    )
    .eq("residents.profile_id", profileId)
    .limit(500)
  if (error) throw error
  return holdingsFromRows(rowsOf(data), false, today)
}

function resolveSeedHoldings(profileId: string, today: string): string[] {
  const rows = seedUnitResidentRows().filter(
    (row) => row.residents?.profile_id === profileId
  )
  return holdingsFromRows(rows, false, today)
}

/** Seed-mode scope predicate. The Supabase path expresses the same three cases
 *  as query filters. */
function seedRowInScope(
  row: { id: string; is_publicly_listed: boolean },
  scope: InventoryScope
): boolean {
  if (scope.kind === "all") return true
  if (scope.kind === "public") return row.is_publicly_listed
  return scope.unitIds.includes(row.id)
}

/**
 * The date the "is this holding still active?" comparison uses.
 *
 * Deliberately **not** `seedIso()`: an ownership edge that expired yesterday
 * must stop granting access today, so this one comparison is allowed to read
 * the wall clock. Nothing it produces is stored or rendered, so seed output
 * stays byte-identical across runs.
 */
function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Provenance loaders
// ---------------------------------------------------------------------------

async function loadUnitFacts(
  client: RepositoryClient,
  unitIds: readonly string[]
): Promise<Map<string, UnitFacts>> {
  if (unitIds.length === 0) return new Map()
  const rows: Array<Record<string, unknown>> = []
  for (const ids of chunk(unitIds, ID_CHUNK_SIZE)) {
    const { data, error } = await client
      .from("sourced_facts")
      .select(FACT_SELECT)
      .eq("entity_type", "unit")
      .in("entity_id", ids)
    if (error) throw error
    rows.push(...rowsOf(data))
  }
  return indexUnitFacts(rows)
}

async function loadCompetingPriceRows(
  client: RepositoryClient,
  unitIds: readonly string[]
): Promise<Array<Record<string, unknown>>> {
  if (unitIds.length === 0) return []
  const rows: Array<Record<string, unknown>> = []
  for (const ids of chunk(unitIds, ID_CHUNK_SIZE)) {
    const { data, error } = await client
      .from("competing_prices")
      .select("unit_id, amount, currency, source_url, publisher, observed_at")
      .in("unit_id", ids)
      .order("observed_at", { ascending: false })
    if (error) throw error
    rows.push(...rowsOf(data))
  }
  return rows
}

/**
 * The source register, keyed by URL: `sources` joined to its newest snapshot
 * that actually has a hash. One query — the register is a few dozen rows — and
 * it is skipped entirely when the page has no competing prices.
 */
async function loadSourceRegister(
  client: RepositoryClient
): Promise<Map<string, SeedCitation>> {
  const { data, error } = await client
    .from("sources")
    .select(SOURCE_REGISTER_SELECT)
    .limit(500)
  if (error) throw error

  const register = new Map<string, SeedCitation>()
  for (const row of rowsOf(data)) {
    const url = asNullableString(row["url"])
    const publisher = asNullableString(row["publisher"])
    const tier = asSourceTier(row["tier"])
    if (url === null || publisher === null || tier === null) continue

    let best: { fetchedAt: string; snapshotHash: string } | null = null
    for (const entry of toArray(row["source_snapshots"])) {
      const snapshot = asRecord(entry)
      const fetchedAt = asNullableString(snapshot["fetched_at"])
      const snapshotHash = asNullableString(snapshot["snapshot_sha256"])
      if (fetchedAt === null || snapshotHash === null) continue
      if (best === null || fetchedAt > best.fetchedAt)
        best = { fetchedAt, snapshotHash }
    }
    if (best === null) continue

    register.set(url, {
      id: asString(row["id"]),
      url,
      publisher,
      tier,
      fetchedAt: best.fetchedAt,
      snapshotHash: best.snapshotHash,
    })
  }
  return register
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * The one `sites` row. `null` when the table is empty — which is
 * `source: "supabase"` with `data: null`, not a fallback to the seed.
 */
export async function getSite(): Promise<RepositoryResult<SiteRecord | null>> {
  return withRepository(
    async (client) => {
      const { data, error } = await client
        .from("sites")
        .select("*")
        .order("code", { ascending: true })
        .limit(1)
      if (error) throw error
      const first = rowsOf(data)[0]
      return first === undefined ? null : mapSite(first)
    },
    () => mapSite(seedSiteRow()),
    "inventory.getSite"
  )
}

/**
 * One company by id — the caller's own, in practice.
 *
 * `companies_select_all` makes this readable by anyone including `anon`, which
 * is correct: the developer's name, country and website are on the public
 * landing page already. Nothing private lives in this table.
 */
export async function getCompany(
  companyId: string
): Promise<RepositoryResult<CompanyRecord | null>> {
  return withRepository(
    async (client) => {
      const { data, error } = await client
        .from("companies")
        .select(
          "id, slug, name, legal_name, country, default_currency, founded_year, website"
        )
        .eq("id", companyId)
        .limit(1)
      if (error) throw error
      const first = rowsOf(data)[0]
      return first === undefined ? null : mapCompany(first)
    },
    () => {
      const seed = seedCompanyRow()
      return seed.id === companyId ? mapCompany(seed) : null
    },
    "inventory.getCompany"
  )
}

/** The seven residence blocks, in `sort_order`. */
export async function getBlocks(
  options: { limit?: number } = {}
): Promise<RepositoryResult<BlockRecord[]>> {
  const limit = clampLimit(options.limit)
  return withRepository(
    async (client) => {
      const { data, error } = await client
        .from("site_blocks")
        .select("id, site_id, code, name, floors, unit_count, sort_order")
        .order("sort_order", { ascending: true })
        .limit(limit)
      if (error) throw error
      return rowsOf(data).map(mapBlock)
    },
    () => seedBlockRows().slice(0, limit).map(mapBlock),
    "inventory.getBlocks"
  )
}

/**
 * Floors of one block.
 *
 * `supabase/seed.sql` populates no `site_floors` rows, so against a seeded
 * database this legitimately returns `[]` with `source: "supabase"`. That is
 * the empty-is-not-failure case, not a bug — check `source` before assuming
 * otherwise.
 */
export async function getFloors(
  blockId: string,
  options: { limit?: number } = {}
): Promise<RepositoryResult<FloorRecord[]>> {
  const limit = clampLimit(options.limit)
  return withRepository(
    async (client) => {
      const { data, error } = await client
        .from("site_floors")
        .select("id, block_id, level, label, unit_count")
        .eq("block_id", blockId)
        .order("level", { ascending: true })
        .limit(limit)
      if (error) throw error
      return rowsOf(data).map(mapFloor)
    },
    () =>
      seedFloorRows()
        .filter((row) => row.block_id === blockId)
        .slice(0, limit)
        .map(mapFloor),
    "inventory.getFloors"
  )
}

/**
 * A page of units, scoped to the caller's role, with provenance and competing
 * prices hydrated in bulk.
 */
export async function getUnits(
  options: UnitQueryOptions = {}
): Promise<RepositoryResult<InventoryUnit[]>> {
  const limit = clampLimit(options.limit)
  const offset = clampOffset(options.offset)
  const today = todayIsoDate()
  let unresolvedCitations = 0

  const result = await withRepository(
    async (client) => {
      const scope = await resolveScope(client, options, today)
      if (scope.kind === "units" && scope.unitIds.length === 0) return []

      let query = client
        .from("units")
        .select(UNIT_SELECT)
        .order("block_code", { ascending: true })
        .order("sequence", { ascending: true })
        .range(offset, offset + limit - 1)

      if (scope.kind === "public") query = query.eq("is_publicly_listed", true)
      if (scope.kind === "units") query = query.in("id", scope.unitIds)
      if (options.layout !== undefined)
        query = query.eq("layout", options.layout)
      if (options.dataQuality !== undefined) {
        query = query.eq("data_quality", options.dataQuality)
      }
      if (options.saleStatus !== undefined) {
        query = query.eq("sale_status", options.saleStatus)
      }
      if (options.blockCode !== undefined) {
        query = query.eq("block_code", options.blockCode)
      }

      const { data, error } = await query
      if (error) throw error

      const rows = rowsOf(data)
      const ids = rows
        .map((row) => asNullableString(row["id"]))
        .filter((id): id is string => id !== null)

      const facts = await loadUnitFacts(client, ids)
      const priceRows = await loadCompetingPriceRows(client, ids)
      const register =
        priceRows.length === 0
          ? new Map<string, SeedCitation>()
          : await loadSourceRegister(client)
      const competing = indexCompetingPrices(priceRows, register)
      unresolvedCitations = competing.unresolved

      return rows.map((row) => mapUnit(row, facts, competing.index))
    },
    () => {
      const scope = resolveSeedScope(options, today)
      if (scope.kind === "units" && scope.unitIds.length === 0) return []

      const rows = seedUnitRows()
        .filter((row) => seedRowInScope(row, scope))
        .filter(
          (row) => options.layout === undefined || row.layout === options.layout
        )
        .filter(
          (row) =>
            options.dataQuality === undefined ||
            row.data_quality === options.dataQuality
        )
        .filter(
          (row) =>
            options.saleStatus === undefined ||
            row.sale_status === options.saleStatus
        )
        .filter(
          (row) =>
            options.blockCode === undefined ||
            row.block_code === options.blockCode
        )
        .slice(offset, offset + limit)

      const ids = rows.map((row) => row.id)
      const facts = indexUnitFacts(seedUnitFactRows(ids))
      const competing = indexCompetingPrices(
        seedCompetingPriceRows(ids),
        seedSourceRegister()
      )
      unresolvedCitations = competing.unresolved
      return rows.map((row) => mapUnit(row, facts, competing.index))
    },
    "inventory.getUnits"
  )

  return unresolvedCitations === 0
    ? result
    : degraded(
        result,
        `${unresolvedCitations} competing price(s) could not be resolved to a stored snapshot and were omitted from competingPrices; the raw rows remain available via portal-repository.getCompetingPricesForUnit().`
      )
}

/** One unit by its text id (`AZW-B03-0412`), or `null` when out of scope. */
export async function getUnit(
  id: string,
  options: ScopeOptions = {}
): Promise<RepositoryResult<InventoryUnit | null>> {
  const today = todayIsoDate()

  return withRepository(
    async (client) => {
      const scope = await resolveScope(client, options, today)
      if (scope.kind === "units" && !scope.unitIds.includes(id)) return null

      let query = client.from("units").select(UNIT_SELECT).eq("id", id).limit(1)
      if (scope.kind === "public") query = query.eq("is_publicly_listed", true)

      const { data, error } = await query
      if (error) throw error
      const row = rowsOf(data)[0]
      if (row === undefined) return null

      const facts = await loadUnitFacts(client, [id])
      const priceRows = await loadCompetingPriceRows(client, [id])
      const register =
        priceRows.length === 0
          ? new Map<string, SeedCitation>()
          : await loadSourceRegister(client)
      const competing = indexCompetingPrices(priceRows, register)
      return mapUnit(row, facts, competing.index)
    },
    () => {
      const scope = resolveSeedScope(options, today)
      const row = seedUnitRows().find((candidate) => candidate.id === id)
      if (row === undefined) return null
      if (!seedRowInScope(row, scope)) return null
      const facts = indexUnitFacts(seedUnitFactRows([id]))
      const competing = indexCompetingPrices(
        seedCompetingPriceRows([id]),
        seedSourceRegister()
      )
      return mapUnit(row, facts, competing.index)
    },
    "inventory.getUnit"
  )
}

/**
 * Counts by sale status, layout, block and data quality, plus price ranges
 * **per currency and per data quality**.
 *
 * Two rules are load-bearing here:
 *
 *  - `modelled` is never merged with `portal_listing`. W3-C keeps them visually
 *    distinct, and a merged "from €112 000" that silently includes synthesised
 *    prices is precisely the claim this project must not make.
 *  - Currencies are never summed together. Housearch quotes USD for the same
 *    project everyone else quotes in EUR; `sum(EUR) + sum(USD)` is not a number.
 *
 * Every `sale_status` and `data_quality` key is present even at zero, so a UI
 * can tell "none" from "not reported".
 */
export async function getAvailabilityRollup(
  options: ScopeOptions = {}
): Promise<RepositoryResult<AvailabilityRollup>> {
  const today = todayIsoDate()

  return withRepository(
    async (client) => {
      const scope = await resolveScope(client, options, today)
      if (scope.kind === "units" && scope.unitIds.length === 0) {
        return emptyRollup()
      }

      const rows: Array<Record<string, unknown>> = []
      for (
        let offset = 0;
        offset < ROLLUP_MAX_ROWS;
        offset += ROLLUP_PAGE_SIZE
      ) {
        let query = client
          .from("units")
          .select(ROLLUP_SELECT)
          .order("block_code", { ascending: true })
          .order("sequence", { ascending: true })
          .range(offset, offset + ROLLUP_PAGE_SIZE - 1)

        if (scope.kind === "public")
          query = query.eq("is_publicly_listed", true)
        if (scope.kind === "units") query = query.in("id", scope.unitIds)

        const { data, error } = await query
        if (error) throw error
        const page = rowsOf(data)
        rows.push(...page)
        if (page.length < ROLLUP_PAGE_SIZE) break
        if (rows.length >= ROLLUP_MAX_ROWS) {
          // Refuse a partial rollup rather than publish a total that silently
          // omits rows. A wrong count is worse than a failed panel.
          throw new Error("Inventory exceeds the bounded rollup read limit.")
        }
      }

      return buildRollup(rows)
    },
    () => {
      const scope = resolveSeedScope(options, today)
      if (scope.kind === "units" && scope.unitIds.length === 0)
        return emptyRollup()
      const rows = seedUnitRows()
        .filter((row) => seedRowInScope(row, scope))
        .map((row) => ({
          block_code: row.block_code,
          layout: row.layout,
          sale_status: row.sale_status,
          data_quality: row.data_quality,
          asking_price_amount: row.asking_price_amount,
          asking_price_currency: row.asking_price_currency,
          site_blocks: row.site_blocks,
        }))
      return buildRollup(rows)
    },
    "inventory.getAvailabilityRollup"
  )
}

function emptyRollup(): AvailabilityRollup {
  return buildRollup([])
}

function buildRollup(
  rows: ReadonlyArray<Record<string, unknown>>
): AvailabilityRollup {
  const bySaleStatus = Object.fromEntries(
    SALE_STATUSES.map((status) => [status, 0])
  ) as Record<SaleStatus, number>
  const byDataQuality = Object.fromEntries(
    UNIT_DATA_QUALITIES.map((quality) => [quality, 0])
  ) as Record<UnitDataQuality, number>

  const layouts = new Map<UnitLayout, LayoutRollup>()
  const blocks = new Map<string, BlockRollup>()
  const priceSamples = new Map<
    string,
    { bucketKey: string; values: number[] }
  >()
  const moneyRows: Array<{ amount: number; currency: string }> = []

  let pricedUnits = 0

  for (const row of rows) {
    const saleStatus = asSaleStatus(row["sale_status"]) ?? "unknown"
    const dataQuality = asDataQuality(row["data_quality"]) ?? "source_missing"
    const layout = asLayout(row["layout"])
    const blockCode = asString(row["block_code"])
    const blockName = asNullableString(
      relatedRecord(row["site_blocks"])["name"]
    )

    bySaleStatus[saleStatus] += 1
    byDataQuality[dataQuality] += 1

    if (layout !== null) {
      const entry = layouts.get(layout) ?? {
        layout,
        count: 0,
        available: 0,
        portalListing: 0,
        modelled: 0,
      }
      entry.count += 1
      if (saleStatus === "available") entry.available += 1
      if (dataQuality === "portal_listing") entry.portalListing += 1
      if (dataQuality === "modelled") entry.modelled += 1
      layouts.set(layout, entry)
    }

    const blockEntry = blocks.get(blockCode) ?? {
      blockCode,
      blockName,
      count: 0,
      available: 0,
      portalListing: 0,
      modelled: 0,
    }
    blockEntry.count += 1
    if (saleStatus === "available") blockEntry.available += 1
    if (dataQuality === "portal_listing") blockEntry.portalListing += 1
    if (dataQuality === "modelled") blockEntry.modelled += 1
    blocks.set(blockCode, blockEntry)

    const amount = asNullableNumber(row["asking_price_amount"])
    const currency = asCurrency(row["asking_price_currency"])
    if (amount === null || currency === null) continue

    pricedUnits += 1
    moneyRows.push({ amount, currency })
    const bucketKey = `${currency}|${dataQuality}`
    const bucket = priceSamples.get(bucketKey) ?? { bucketKey, values: [] }
    bucket.values.push(amount)
    priceSamples.set(bucketKey, bucket)
  }

  const priceByCurrency: CurrencyPriceBucket[] = []
  for (const [key, bucket] of priceSamples) {
    const [currencyPart, qualityPart] = key.split("|")
    const currency = asCurrency(currencyPart)
    const dataQuality = asDataQuality(qualityPart)
    const middle = median(bucket.values)
    if (currency === null || dataQuality === null || middle === null) continue
    priceByCurrency.push({
      currency,
      dataQuality,
      count: bucket.values.length,
      min: Math.min(...bucket.values),
      max: Math.max(...bucket.values),
      median: middle,
      total: bucket.values.reduce((sum, value) => sum + value, 0),
    })
  }
  priceByCurrency.sort(
    (a, b) =>
      a.currency.localeCompare(b.currency) ||
      a.dataQuality.localeCompare(b.dataQuality)
  )

  return {
    totalUnits: rows.length,
    bySaleStatus,
    byDataQuality,
    byLayout: [...layouts.values()].sort((a, b) =>
      a.layout.localeCompare(b.layout)
    ),
    byBlock: [...blocks.values()].sort((a, b) =>
      a.blockCode.localeCompare(b.blockCode)
    ),
    priceByCurrency,
    totalsByCurrency: totalsByCurrency(moneyRows),
    pricedUnits,
    unpricedUnits: rows.length - pricedUnits,
  }
}

/**
 * Every unit a profile holds, under any relation, ignoring the caller's role.
 *
 * Callers must have already established that the profile is the caller or that
 * the caller may act for it — this function answers "what does this resident
 * hold", not "may you ask".
 */
export async function getUnitsForResident(
  profileId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<RepositoryResult<InventoryUnit[]>> {
  const limit = clampLimit(options.limit)
  const offset = clampOffset(options.offset)
  const today = todayIsoDate()

  return withRepository(
    async (client) => {
      const unitIds = await resolveHoldings(client, profileId, today)
      if (unitIds.length === 0) return []

      const { data, error } = await client
        .from("units")
        .select(UNIT_SELECT)
        .in("id", unitIds)
        .order("block_code", { ascending: true })
        .order("sequence", { ascending: true })
        .range(offset, offset + limit - 1)
      if (error) throw error

      const rows = rowsOf(data)
      const ids = rows
        .map((row) => asNullableString(row["id"]))
        .filter((id): id is string => id !== null)

      const facts = await loadUnitFacts(client, ids)
      const priceRows = await loadCompetingPriceRows(client, ids)
      const register =
        priceRows.length === 0
          ? new Map<string, SeedCitation>()
          : await loadSourceRegister(client)
      const competing = indexCompetingPrices(priceRows, register)
      return rows.map((row) => mapUnit(row, facts, competing.index))
    },
    () => {
      const unitIds = resolveSeedHoldings(profileId, today)
      if (unitIds.length === 0) return []
      const rows = seedUnitRows()
        .filter((row) => unitIds.includes(row.id))
        .slice(offset, offset + limit)
      const ids = rows.map((row) => row.id)
      const facts = indexUnitFacts(seedUnitFactRows(ids))
      const competing = indexCompetingPrices(
        seedCompetingPriceRows(ids),
        seedSourceRegister()
      )
      return rows.map((row) => mapUnit(row, facts, competing.index))
    },
    "inventory.getUnitsForResident"
  )
}
