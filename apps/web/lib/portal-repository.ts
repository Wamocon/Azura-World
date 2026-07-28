/**
 * # Portal repository — third-party listings, competing prices, staleness
 *
 * Owned by **W2-A**. The read side of the conflict register: what other people
 * publish about Azura World, kept verbatim, never reconciled.
 *
 * Same two rules as every repository here — a `source` field on every result,
 * and unconfigured-falls-back / configured-and-failing-throws (see
 * `repository-base.ts`). An empty `portal_listings` table is `source:
 * "supabase"` with an empty array, never a silent slide into seed data.
 *
 * ## Three things this file must never do
 *
 * 1. **Never mix currencies.** Housearch quotes USD for the same project every
 *    other portal quotes in EUR. `getPriceSpread()` buckets per currency and
 *    returns one spread per bucket; there is no combined figure to accidentally
 *    render. CONVENTIONS §5 forbids converting anywhere but the display edge.
 * 2. **Never mix sale with rent.** Two of the 47 harvested rows are monthly
 *    rents (€2 100 and €1 000). A €1 000 rent inside a sale series drags a
 *    minimum down by two orders of magnitude, so `price_kind` is part of the
 *    bucket key. Migration 05 adds the column for exactly this reason.
 * 3. **Never deduplicate.** 47 rows carry only 27 distinct URLs, and
 *    `competing_prices` deliberately has no unique key: two rows for one unit
 *    are the finding, not a defect (CONTRACTS §2, "Always keep all of them").
 *
 * ## Citations
 *
 * `competing_prices` stores `source_url` and `publisher` but neither a tier nor
 * a snapshot hash, and has no FK to `sources` — migration 05 says so and
 * explains why. `getCompetingPricesForUnit()` therefore joins the source
 * register in memory and returns `source: SourceRef | null`: **null means the
 * URL is not in the register**, not that the row is invalid. The raw
 * `sourceUrl` is always returned, so an unregistered citation is still visible
 * and still clickable. `inventory-repository` is stricter — it omits
 * unresolvable citations from `AzuraUnit.competingPrices`, because that field
 * is typed `SourceRef` and a fabricated hash would break invariant 6 — and it
 * labels the omission with a `degradedReason`.
 */

import type {
  Money,
  PortalListing,
  RepositoryResult,
  SourceRef,
  SourceTier,
  UnitLayout,
} from "@/lib/contracts"
import type { CurrencyCode, SeedCitation } from "@/lib/inventory-data"
import { median, seedSourceRegister } from "@/lib/inventory-data"
import {
  seedCompetingPriceRows,
  seedPortalListingRows,
} from "@/lib/portal-data"
import {
  asBoolean,
  asMoney,
  asNullableNumber,
  asNullableString,
  asRecord,
  asString,
  clampLimit,
  clampOffset,
  withRepository,
  type RepositoryClient,
} from "@/lib/repository-base"

// ---------------------------------------------------------------------------
// Domain shapes
// ---------------------------------------------------------------------------

/** `PortalListing` (CONTRACTS §2) plus the columns migration 05 adds. */
export interface PortalListingRecord extends PortalListing {
  id: string
  siteId: string | null
  /** `"sale"`, `"rent"`, or `null` when the page did not say. A null kind is
   *  excluded from the sale spread rather than assumed to be a sale. */
  priceKind: "sale" | "rent" | null
  /** The parser's verbatim caveat: wrong district, implausible area, "price
   *  from" rather than a unit price. Never edited to tidy the data. */
  note: string | null
  createdAt: string
  updatedAt: string
}

/** One `competing_prices` row. */
export interface CompetingPriceRecord {
  id: string
  unitId: string
  money: Money
  sourceUrl: string
  publisher: string | null
  observedAt: string
  /** `null` when `sourceUrl` is not in the source register — the row is still
   *  returned, because dropping evidence is worse than an unresolved citation. */
  source: SourceRef | null
}

/** A price spread for one (layout, currency, price kind). Never blended. */
export interface PriceSpreadBucket {
  layout: UnitLayout | null
  currency: CurrencyCode
  priceKind: "sale" | "rent" | "unknown"
  count: number
  min: number
  max: number
  median: number
  /** Distinct publishers behind the bucket. A spread from one publisher is a
   *  price list; a spread across four is a disagreement. */
  publishers: string[]
  /** `max / min`. F-002's 2.1× spread is the headline finding of this dataset,
   *  and it is only visible because nothing here is averaged away. */
  spreadRatio: number
}

export interface PortalListingQueryOptions {
  limit?: number
  offset?: number
  publisher?: string
  layout?: UnitLayout
  isStale?: boolean
  priceKind?: "sale" | "rent"
}

// ---------------------------------------------------------------------------
// Selects
// ---------------------------------------------------------------------------

const LISTING_SELECT =
  "id, site_id, publisher, url, fetched_at, layout, interior_m2, price_amount, price_currency, price_kind, claimed_block_count, claimed_total_units, claimed_build_status, is_stale, note, created_at, updated_at"

const SOURCE_REGISTER_SELECT =
  "id, url, publisher, tier, source_snapshots(fetched_at, snapshot_sha256)"

/** 47 rows today. The ceiling is a guard, not an expectation. */
const SPREAD_PAGE_SIZE = 500
const SPREAD_MAX_ROWS = 5000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowsOf(data: unknown): Array<Record<string, unknown>> {
  return Array.isArray(data) ? data.map(asRecord) : []
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value)
    ? value
    : value === null || value === undefined
      ? []
      : [value]
}

function asCurrency(value: unknown): CurrencyCode | null {
  return value === "EUR" ||
    value === "USD" ||
    value === "TRY" ||
    value === "GBP"
    ? value
    : null
}

function asPriceKind(value: unknown): "sale" | "rent" | null {
  return value === "sale" || value === "rent" ? value : null
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

function citationToSourceRef(citation: SeedCitation): SourceRef {
  return {
    url: citation.url,
    publisher: citation.publisher,
    fetchedAt: citation.fetchedAt,
    snapshotHash: citation.snapshotHash,
    tier: citation.tier,
  }
}

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
// Mappers
// ---------------------------------------------------------------------------

function mapListing(row: Record<string, unknown>): PortalListingRecord {
  return {
    id: asString(row["id"]),
    siteId: asNullableString(row["site_id"]),
    publisher: asString(row["publisher"]),
    url: asString(row["url"]),
    fetchedAt: asString(row["fetched_at"]),
    layout: asLayout(row["layout"]),
    interiorM2: asNullableNumber(row["interior_m2"]),
    // asMoney returns null unless BOTH amount and currency are present — a
    // bare amount is the Housearch-quotes-USD bug, and defaulting to EUR here
    // would bury it.
    price: asMoney(row["price_amount"], row["price_currency"]),
    priceKind: asPriceKind(row["price_kind"]),
    claimedBlockCount: asNullableNumber(row["claimed_block_count"]),
    claimedTotalUnits: asNullableNumber(row["claimed_total_units"]),
    claimedBuildStatus: asNullableString(row["claimed_build_status"]),
    isStale: asBoolean(row["is_stale"]),
    note: asNullableString(row["note"]),
    createdAt: asString(row["created_at"]),
    updatedAt: asString(row["updated_at"]),
  }
}

function mapCompetingPrice(
  row: Record<string, unknown>,
  register: ReadonlyMap<string, SeedCitation>
): CompetingPriceRecord | null {
  const money = asMoney(row["amount"], row["currency"])
  const unitId = asNullableString(row["unit_id"])
  const sourceUrl = asNullableString(row["source_url"])
  const observedAt = asNullableString(row["observed_at"])
  // A price with no amount, no unit or no observation date cannot be aged or
  // attributed. CONVENTIONS §5: a stale price shown as current is the most
  // damaging error available to this project.
  if (
    money === null ||
    unitId === null ||
    sourceUrl === null ||
    observedAt === null
  ) {
    return null
  }
  const citation = register.get(sourceUrl)
  return {
    id: asString(row["id"]),
    unitId,
    money,
    sourceUrl,
    publisher: asNullableString(row["publisher"]),
    observedAt,
    source: citation === undefined ? null : citationToSourceRef(citation),
  }
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * A page of harvested portal listings, newest first.
 *
 * No deduplication by URL: one building-overview page publishes many
 * apartments, and 47 rows share 27 URLs by design.
 */
export async function getPortalListings(
  options: PortalListingQueryOptions = {}
): Promise<RepositoryResult<PortalListingRecord[]>> {
  const limit = clampLimit(options.limit)
  const offset = clampOffset(options.offset)

  return withRepository(
    async (client) => {
      let query = client
        .from("portal_listings")
        .select(LISTING_SELECT)
        .order("fetched_at", { ascending: false })
        .order("publisher", { ascending: true })
        .range(offset, offset + limit - 1)

      if (options.publisher !== undefined) {
        query = query.eq("publisher", options.publisher)
      }
      if (options.layout !== undefined)
        query = query.eq("layout", options.layout)
      if (options.isStale !== undefined)
        query = query.eq("is_stale", options.isStale)
      if (options.priceKind !== undefined) {
        query = query.eq("price_kind", options.priceKind)
      }

      const { data, error } = await query
      if (error) throw error
      return rowsOf(data).map(mapListing)
    },
    () =>
      seedPortalListingRows()
        .filter(
          (row) =>
            options.publisher === undefined ||
            row.publisher === options.publisher
        )
        .filter(
          (row) => options.layout === undefined || row.layout === options.layout
        )
        .filter(
          (row) =>
            options.isStale === undefined || row.is_stale === options.isStale
        )
        .filter(
          (row) =>
            options.priceKind === undefined ||
            row.price_kind === options.priceKind
        )
        .sort(
          (a, b) =>
            b.fetched_at.localeCompare(a.fetched_at) ||
            a.publisher.localeCompare(b.publisher)
        )
        .slice(offset, offset + limit)
        .map(mapListing),
    "portal.getPortalListings"
  )
}

/**
 * Listings that contradict a tier ≤ 3 source.
 *
 * A thin wrapper on purpose: staleness is a stored column, not a computation,
 * because it is set by the evidence pipeline against the official and developer
 * sites. Recomputing it here would give the app two answers.
 */
export async function getStaleListings(
  options: { limit?: number; offset?: number } = {}
): Promise<RepositoryResult<PortalListingRecord[]>> {
  const result: PortalListingQueryOptions = { isStale: true }
  if (options.limit !== undefined) result.limit = options.limit
  if (options.offset !== undefined) result.offset = options.offset
  return getPortalListings(result)
}

/**
 * Every recorded price for one unit, newest observation first.
 *
 * Returns them all. Two rows for one unit are the finding; resolving them here
 * would destroy the register (CONTRACTS §2).
 */
export async function getCompetingPricesForUnit(
  unitId: string,
  options: { limit?: number } = {}
): Promise<RepositoryResult<CompetingPriceRecord[]>> {
  const limit = clampLimit(options.limit)

  return withRepository(
    async (client) => {
      const { data, error } = await client
        .from("competing_prices")
        .select(
          "id, unit_id, amount, currency, source_url, publisher, observed_at"
        )
        .eq("unit_id", unitId)
        .order("observed_at", { ascending: false })
        .limit(limit)
      if (error) throw error

      const rows = rowsOf(data)
      // Skip the register query entirely when there is nothing to resolve.
      const register =
        rows.length === 0
          ? new Map<string, SeedCitation>()
          : await loadSourceRegister(client)
      return rows
        .map((row) => mapCompetingPrice(row, register))
        .filter((row): row is CompetingPriceRecord => row !== null)
    },
    () => {
      const register = seedSourceRegister()
      return seedCompetingPriceRows([unitId])
        .sort((a, b) => b.observed_at.localeCompare(a.observed_at))
        .slice(0, limit)
        .map((row) => mapCompetingPrice(row, register))
        .filter((row): row is CompetingPriceRecord => row !== null)
    },
    "portal.getCompetingPricesForUnit"
  )
}

/**
 * Min / max / median asking price per layout, **per currency, per price kind**.
 *
 * Buckets are never merged. A 1+1 quoted at €112 000 by one portal and $239 171
 * by another produces two buckets, not one nonsense average; a €1 000 monthly
 * rent produces a third. `spreadRatio` is `max / min` inside a bucket, which is
 * how F-002's 2.1× disagreement stays visible instead of being smoothed into a
 * mean.
 *
 * A listing with no price, or with an amount but no currency, contributes to no
 * bucket — `null` is an honest gap and 0 would be a lie.
 */
export async function getPriceSpread(): Promise<
  RepositoryResult<PriceSpreadBucket[]>
> {
  return withRepository(
    async (client) => {
      const rows: Array<Record<string, unknown>> = []
      for (
        let offset = 0;
        offset < SPREAD_MAX_ROWS;
        offset += SPREAD_PAGE_SIZE
      ) {
        const { data, error } = await client
          .from("portal_listings")
          .select("publisher, layout, price_amount, price_currency, price_kind")
          .order("publisher", { ascending: true })
          .range(offset, offset + SPREAD_PAGE_SIZE - 1)
        if (error) throw error
        const page = rowsOf(data)
        rows.push(...page)
        if (page.length < SPREAD_PAGE_SIZE) break
        if (rows.length >= SPREAD_MAX_ROWS) {
          // A spread computed over a truncated set is a wrong number wearing a
          // confident label. Refuse instead.
          throw new Error(
            "Portal listings exceed the bounded price-spread limit."
          )
        }
      }
      return buildSpread(rows)
    },
    () => buildSpread(seedPortalListingRows()),
    "portal.getPriceSpread"
  )
}

function buildSpread(
  rows: ReadonlyArray<Record<string, unknown>>
): PriceSpreadBucket[] {
  type Bucket = {
    layout: UnitLayout | null
    currency: CurrencyCode
    priceKind: "sale" | "rent" | "unknown"
    values: number[]
    publishers: Set<string>
  }

  const buckets = new Map<string, Bucket>()

  for (const row of rows) {
    const money = asMoney(row["price_amount"], row["price_currency"])
    if (money === null) continue
    const currency = asCurrency(money.currency)
    if (currency === null) continue

    const layout = asLayout(row["layout"])
    const priceKind = asPriceKind(row["price_kind"]) ?? "unknown"
    const key = `${layout ?? "unknown"}|${currency}|${priceKind}`

    const bucket = buckets.get(key) ?? {
      layout,
      currency,
      priceKind,
      values: [],
      publishers: new Set<string>(),
    }
    bucket.values.push(money.amount)
    const publisher = asNullableString(row["publisher"])
    if (publisher !== null) bucket.publishers.add(publisher)
    buckets.set(key, bucket)
  }

  const spread: PriceSpreadBucket[] = []
  for (const bucket of buckets.values()) {
    const middle = median(bucket.values)
    if (middle === null) continue
    const min = Math.min(...bucket.values)
    const max = Math.max(...bucket.values)
    spread.push({
      layout: bucket.layout,
      currency: bucket.currency,
      priceKind: bucket.priceKind,
      count: bucket.values.length,
      min,
      max,
      median: middle,
      publishers: [...bucket.publishers].sort((a, b) => a.localeCompare(b)),
      // min > 0 is guaranteed by the CHECK constraint on price_amount, so this
      // cannot divide by zero: migration 05 rejects a price of 0 outright.
      spreadRatio: min === 0 ? 0 : max / min,
    })
  }

  return spread.sort(
    (a, b) =>
      (a.layout ?? "~").localeCompare(b.layout ?? "~") ||
      a.currency.localeCompare(b.currency) ||
      a.priceKind.localeCompare(b.priceKind)
  )
}
