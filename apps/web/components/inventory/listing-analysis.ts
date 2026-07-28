/**
 * Derivations over the harvested portal listings.            Owner: W3-C / N1
 *
 * Pure functions, no JSX, no formatting. Everything `/dashboard/listings`
 * computes lives here so the page stays a layout and the arithmetic can be read
 * in one place — which matters, because on this dataset the arithmetic is where
 * the honesty rules bite.
 *
 * ## Three rules encoded as types, not as discipline
 *
 * 1. **A currency is part of every bucket key.** Housearch quotes USD for the
 *    same apartments every other portal quotes in EUR. There is deliberately no
 *    function here that returns one number across both, so a caller cannot
 *    accidentally render `min` over a mixed set. `CurrencyBand` carries its
 *    currency and nothing spans two.
 * 2. **A price kind is part of every bucket key.** Two of the 47 rows are
 *    monthly rents (€2 100 and €1 000). A €1 000 rent inside a sale series drags
 *    a minimum down by two orders of magnitude and would make the cheapest "1+1
 *    for sale" on the page a rental.
 * 3. **A row with no price is counted, never zeroed.** `withoutPrice` is a
 *    field on the band set for exactly that reason. `0` would be a lie and
 *    dropping the row silently would understate how thin a publisher's data is.
 *
 * ## What is deliberately absent
 *
 * No mean, no median, no midpoint, no "typical price", and no cross-currency
 * ratio. F-002 is unresolved by design and `pnpm qa:evidence` fails the build if
 * anyone sets `resolvedTo`. A figure computed here would be the product arguing
 * against its own dataset.
 */

import type { PortalListingRecord } from "@/lib/portal-repository"

/** ISO 4217 as it appears in this dataset. Mirrors `inventory-data`'s union. */
export type ListingCurrency = "EUR" | "USD" | "TRY" | "GBP"

/** `"sale"`, `"rent"`, or the honest third case: the page did not say. */
export type ListingPriceKind = "sale" | "rent" | "unknown"

export function priceKindOf(listing: PortalListingRecord): ListingPriceKind {
  return listing.priceKind ?? "unknown"
}

/**
 * Every price a set of listings states in ONE currency.
 *
 * `spreadRatio` is `max / min` **inside this band**, so it is always a
 * comparison between two figures a single currency actually holds. The 2.1×
 * figure F-002's own text quotes is not this: it compares a Haspo euro price
 * against a Housearch dollar one, which is the conversion this product refuses
 * to perform. See `listing-price-comparison.tsx`, which shows both and says so.
 */
export interface CurrencyBand {
  currency: ListingCurrency
  /** Rows that stated a price in this currency. */
  count: number
  min: number
  max: number
  /** The cheapest and dearest rows themselves, so the UI can cite them. */
  cheapest: PortalListingRecord
  dearest: PortalListingRecord
  /** Distinct publishers. One publisher is a price list; four is a disagreement. */
  publishers: string[]
  /** `max / min`. `1` when a band holds a single price. */
  spreadRatio: number
}

/** The bands of a listing set, plus what did not fit into any of them. */
export interface BandSet {
  bands: CurrencyBand[]
  /** Rows with no stated price, or an amount with no currency. Never summed. */
  withoutPrice: number
}

/**
 * Bands for one set of listings, one per currency, sorted by currency code.
 *
 * The caller is responsible for having already narrowed to a single price kind.
 * That is not an oversight: making the caller pass a filtered set means a mixed
 * sale/rent band cannot be produced by forgetting an argument, only by writing
 * the filter wrongly on purpose.
 */
export function bandsByCurrency(
  listings: readonly PortalListingRecord[]
): BandSet {
  const byCurrency = new Map<ListingCurrency, PortalListingRecord[]>()
  let withoutPrice = 0

  for (const listing of listings) {
    const currency = currencyOf(listing)
    if (currency === null) {
      withoutPrice += 1
      continue
    }
    const bucket = byCurrency.get(currency)
    if (bucket === undefined) byCurrency.set(currency, [listing])
    else bucket.push(listing)
  }

  const bands: CurrencyBand[] = []
  for (const [currency, rows] of byCurrency) {
    // Every row in `rows` passed `currencyOf`, so `price` is non-null on all of
    // them; the guards below are `noUncheckedIndexedAccess` doing its job.
    const sorted = [...rows].sort(
      (a, b) => (a.price?.amount ?? 0) - (b.price?.amount ?? 0)
    )
    const cheapest = sorted[0]
    const dearest = sorted[sorted.length - 1]
    if (cheapest?.price == null || dearest?.price == null) continue

    const min = cheapest.price.amount
    const max = dearest.price.amount
    bands.push({
      currency,
      count: sorted.length,
      min,
      max,
      cheapest,
      dearest,
      publishers: distinctPublishers(sorted),
      // A price of 0 is rejected by the CHECK constraint on `price_amount`
      // (migration 05), so this cannot divide by zero. The guard states the
      // assumption rather than trusting it.
      spreadRatio: min === 0 ? 1 : max / min,
    })
  }

  bands.sort((a, b) => a.currency.localeCompare(b.currency))
  return { bands, withoutPrice }
}

function currencyOf(listing: PortalListingRecord): ListingCurrency | null {
  const currency = listing.price?.currency
  return currency === "EUR" ||
    currency === "USD" ||
    currency === "TRY" ||
    currency === "GBP"
    ? currency
    : null
}

function distinctPublishers(rows: readonly PortalListingRecord[]): string[] {
  const seen = new Set<string>()
  for (const row of rows) seen.add(row.publisher)
  return [...seen].sort((a, b) => a.localeCompare(b))
}

// ---------------------------------------------------------------------------
// Grouping by publisher
// ---------------------------------------------------------------------------

/** One publisher's whole contribution to the register. */
export interface PublisherGroup {
  publisher: string
  listings: PortalListingRecord[]
  /** Distinct URLs. 47 rows share 27 URLs — one page publishes many flats. */
  pageCount: number
  /** Rows contradicting a tier ≤ 3 source. Stored, never recomputed here. */
  staleCount: number
  /** Currencies this publisher quotes in, sorted. Usually one; Housearch's USD
   *  is the whole reason the comparison view exists. */
  currencies: ListingCurrency[]
  /** Newest `fetchedAt` in the group, so a reader can age the whole block. */
  lastFetchedAt: string
  /** Rent rows, counted separately — a rent is not a cheap sale. */
  rentCount: number
  /** Rows whose page stated no price kind at all. */
  unknownKindCount: number
}

/**
 * Listings grouped by publisher, publishers sorted by row count descending.
 *
 * Count-descending rather than alphabetical because the size of a publisher's
 * contribution is the first thing that qualifies it: Haspo's 18 rows and TERRA's
 * 2 are not equally strong evidence about the same project, and an alphabetical
 * list hides that behind the letter A.
 */
export function groupByPublisher(
  listings: readonly PortalListingRecord[]
): PublisherGroup[] {
  const groups = new Map<string, PortalListingRecord[]>()
  for (const listing of listings) {
    const bucket = groups.get(listing.publisher)
    if (bucket === undefined) groups.set(listing.publisher, [listing])
    else bucket.push(listing)
  }

  const result: PublisherGroup[] = []
  for (const [publisher, rows] of groups) {
    const currencies = new Set<ListingCurrency>()
    let staleCount = 0
    let rentCount = 0
    let unknownKindCount = 0
    let lastFetchedAt = ""
    const urls = new Set<string>()

    for (const row of rows) {
      const currency = currencyOf(row)
      if (currency !== null) currencies.add(currency)
      if (row.isStale) staleCount += 1
      if (row.priceKind === "rent") rentCount += 1
      if (row.priceKind === null) unknownKindCount += 1
      if (row.fetchedAt > lastFetchedAt) lastFetchedAt = row.fetchedAt
      urls.add(row.url)
    }

    rows.sort(sortListings)

    result.push({
      publisher,
      listings: rows,
      pageCount: urls.size,
      staleCount,
      currencies: [...currencies].sort((a, b) => a.localeCompare(b)),
      lastFetchedAt,
      rentCount,
      unknownKindCount,
    })
  }

  result.sort(
    (a, b) =>
      b.listings.length - a.listings.length ||
      a.publisher.localeCompare(b.publisher)
  )
  return result
}

/**
 * Row order inside a publisher block: sale before rent, then layout, then price
 * ascending, with priced rows before unpriced ones.
 *
 * **Unpriced rows sort last in this direction and would sort last in the other
 * too.** The W3-C brief calls that out for unit prices and it holds here for the
 * same reason: `null` is not `0`, and a missing price surfacing as the cheapest
 * listing is the single most misleading thing this table could do.
 */
function sortListings(a: PortalListingRecord, b: PortalListingRecord): number {
  const kindRank = (row: PortalListingRecord) =>
    row.priceKind === "sale" ? 0 : row.priceKind === null ? 1 : 2
  const byKind = kindRank(a) - kindRank(b)
  if (byKind !== 0) return byKind

  const layoutA = a.layout ?? "￿"
  const layoutB = b.layout ?? "￿"
  if (layoutA !== layoutB) return layoutA.localeCompare(layoutB)

  const priceA = a.price
  const priceB = b.price
  if (priceA === null && priceB === null) return 0
  if (priceA === null) return 1
  if (priceB === null) return -1
  if (priceA.currency !== priceB.currency) {
    return priceA.currency.localeCompare(priceB.currency)
  }
  return priceA.amount - priceB.amount
}

// ---------------------------------------------------------------------------
// The comparison view
// ---------------------------------------------------------------------------

/** One publisher's prices for one layout, in one currency. Never blended. */
export interface ComparisonCell {
  publisher: string
  currency: ListingCurrency
  count: number
  min: number
  max: number
  /** The row behind `min`, so the cell can link to the page that stated it. */
  cheapest: PortalListingRecord
  /** True when ANY row behind this cell is stale. The badge sits by the price. */
  hasStale: boolean
}

/** One currency column of the side-by-side comparison. */
export interface ComparisonColumn {
  currency: ListingCurrency
  cells: ComparisonCell[]
  /** The band across the whole column — same currency throughout, so legal. */
  band: CurrencyBand | null
}

/**
 * The side-by-side view: one column per currency, one cell per publisher.
 *
 * **The columns are never joined, and that is the design.** A single table with
 * a "price" column would put €112 000 and $239 171 in the same visual series and
 * invite the reader to rank them, which needs a rate and a rate date no source
 * in this dataset publishes (CONVENTIONS §5). Two columns with a stated
 * separator make the incommensurability the layout rather than a footnote.
 *
 * Rent is excluded here by the caller, not filtered defensively inside: the
 * comparison is about what the same apartment is offered FOR SALE at.
 */
export function buildComparison(
  listings: readonly PortalListingRecord[]
): ComparisonColumn[] {
  const byCurrency = new Map<
    ListingCurrency,
    Map<string, PortalListingRecord[]>
  >()

  for (const listing of listings) {
    const currency = currencyOf(listing)
    if (currency === null) continue
    const publishers =
      byCurrency.get(currency) ?? new Map<string, PortalListingRecord[]>()
    const rows = publishers.get(listing.publisher) ?? []
    rows.push(listing)
    publishers.set(listing.publisher, rows)
    byCurrency.set(currency, publishers)
  }

  const columns: ComparisonColumn[] = []
  for (const [currency, publishers] of byCurrency) {
    const cells: ComparisonCell[] = []
    const all: PortalListingRecord[] = []

    for (const [publisher, rows] of publishers) {
      const sorted = [...rows].sort(
        (a, b) => (a.price?.amount ?? 0) - (b.price?.amount ?? 0)
      )
      const cheapest = sorted[0]
      const dearest = sorted[sorted.length - 1]
      if (cheapest?.price == null || dearest?.price == null) continue

      all.push(...sorted)
      cells.push({
        publisher,
        currency,
        count: sorted.length,
        min: cheapest.price.amount,
        max: dearest.price.amount,
        cheapest,
        hasStale: sorted.some((row) => row.isStale),
      })
    }

    // Cheapest publisher first: the low anchor is the number a reader is most
    // likely to quote, so it should be the one they meet with its caveats
    // attached rather than the one they scroll to.
    cells.sort(
      (a, b) => a.min - b.min || a.publisher.localeCompare(b.publisher)
    )

    const { bands } = bandsByCurrency(all)
    columns.push({ currency, cells, band: bands[0] ?? null })
  }

  // EUR before USD is alphabetical rather than a judgement about which currency
  // is the real one. Both columns carry the same weight in the layout.
  columns.sort((a, b) => a.currency.localeCompare(b.currency))
  return columns
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/**
 * The filter state the register reads out of `searchParams`.
 *
 * **Layout is deliberately not here.** `?layout=` scopes the comparison view and
 * nothing else: the register's job is to show every collected row, and a layout
 * that defaulted to `1+1` would hide 30 of the 47 on first load. The comparison
 * narrows by layout with a plain predicate and has its own empty state, which
 * names the layout it found nothing for.
 */
export interface ListingFilter {
  publisher?: string
  priceKind?: "sale" | "rent"
  staleOnly?: boolean
}

/**
 * Apply a filter in memory.
 *
 * The repository can filter server-side and does for the page's own queries.
 * This exists for the derived sections, which all read from ONE fetch of the
 * whole register: a page that issued a query per section would show sections
 * that disagree with each other after a harvest lands mid-render.
 */
export function applyFilter(
  listings: readonly PortalListingRecord[],
  filter: ListingFilter
): PortalListingRecord[] {
  return listings.filter((listing) => {
    if (
      filter.publisher !== undefined &&
      listing.publisher !== filter.publisher
    )
      return false
    if (
      filter.priceKind !== undefined &&
      listing.priceKind !== filter.priceKind
    )
      return false
    if (filter.staleOnly === true && !listing.isStale) return false
    return true
  })
}

/**
 * Which single filter is responsible for an empty result, if exactly one is.
 *
 * The W3-C brief requires an empty state that says WHICH filter excluded
 * everything rather than a bare "no results". Returns the name of the one
 * filter whose removal would produce rows, or `null` when several are involved
 * (in which case the honest message is "this combination", not a scapegoat).
 */
export function blamedFilter(
  listings: readonly PortalListingRecord[],
  filter: ListingFilter
): keyof ListingFilter | null {
  const keys: Array<keyof ListingFilter> = [
    "publisher",
    "priceKind",
    "staleOnly",
  ]
  const active = keys.filter((key) => filter[key] !== undefined)
  if (active.length === 0) return null

  const culprits = active.filter((key) => {
    const without: ListingFilter = { ...filter }
    delete without[key]
    return applyFilter(listings, without).length > 0
  })

  return culprits.length === 1 ? (culprits[0] ?? null) : null
}
