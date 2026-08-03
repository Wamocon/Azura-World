/**
 * One row per portal, derived from the register.              Owner: W-NIGHT
 *
 * `/dashboard/listings` used to open on four counts and a price table, which
 * read as an analyst's worksheet: correct, and unreadable to the person the
 * dashboard is for. The page now opens on the publishers themselves, and this
 * is the arithmetic behind those cards.
 *
 * Pure functions, no JSX. Same three rules as `listing-analysis.ts`, because
 * they are the rules of the dataset rather than of a component:
 *
 * 1. **A currency never leaves its own bucket.** A portal's price range is
 *    computed by `bandsByCurrency`, so a card shows one range per currency and
 *    there is no code path that could produce a single blended figure. Housearch
 *    quotes US dollars for the same apartments everyone else quotes in euros.
 * 2. **Rent is not a cheap sale.** The range is built from `priceKind === "sale"`
 *    rows only. Alto Real Estate's single row is a monthly rent, so its card
 *    honestly shows no sale price at all rather than a €2 100 apartment.
 * 3. **A row with no price is counted, never zeroed.** `saleWithoutPrice` exists
 *    so the card can say how thin a portal's data is.
 *
 * ## Why an image is matched by publisher NAME and nothing else
 *
 * `lib/journey-media.ts` carries the published imagery with the publisher that
 * put it online. Three of the seven portals appear there; four do not. Matching
 * by host, or falling back to "any picture of this project", would put the
 * developer's own marketing photography on the card of a portal that never
 * published it, which is a claim about who said what. A portal with no
 * collected picture shows no picture and the card says so.
 */

import {
  journeyImages,
  type JourneyCategory,
  type JourneyImage,
} from "@/lib/journey-media"
import type { PortalListingRecord } from "@/lib/portal-repository"

import { bandsByCurrency, type CurrencyBand } from "./listing-analysis"

/** Everything one portal card renders. Counts only, no formatting. */
export interface PortalSummary {
  publisher: string
  /** Rows this portal contributed to the register. */
  listingCount: number
  /** Distinct pages behind those rows. One page can publish eight apartments. */
  pageCount: number
  /** Rows contradicting a tier ≤ 3 source. Stored, never recomputed. */
  staleCount: number
  /** Every row is out of date. Haspo Realty's eighteen are. */
  allStale: boolean
  /** Monthly rents, kept out of the price range and counted separately. */
  rentCount: number
  /** Sale prices, one band per currency. Never merged, never converted. */
  saleBands: CurrencyBand[]
  /** Sale rows that named no price. Counted, never read as 0. */
  saleWithoutPrice: number
  /** Distinct layouts this portal names, sorted. */
  layouts: string[]
  /** Rows whose page named no layout at all. */
  layoutUnstatedCount: number
  /** Newest observation in the group, so a reader can age the whole card. */
  lastFetchedAt: string
  /** The page carrying most of its rows. `null` only if it published none. */
  primaryUrl: string | null
  /** A picture this portal itself published, or `null`. Never substituted. */
  image: JourneyImage | null
}

/**
 * Which of a portal's pictures the card shows.
 *
 * A photograph before a visualisation before a drawing: the card is a thumbnail,
 * and a photograph of the finished site says more at that size than a plan does.
 * Whatever wins is labelled with what it actually is, so a render never passes
 * as a photograph.
 */
const CATEGORY_RANK: Record<JourneyCategory, number> = {
  photo: 0,
  render: 1,
  siteplan: 2,
  floorplan: 3,
  video: 4,
  logo: 5,
  document: 6,
}

export function portalImage(publisher: string): JourneyImage | null {
  let best: JourneyImage | null = null
  for (const image of journeyImages) {
    if (image.publisher !== publisher) continue
    if (
      best === null ||
      CATEGORY_RANK[image.category] < CATEGORY_RANK[best.category]
    ) {
      best = image
    }
  }
  return best
}

/**
 * One summary per portal, biggest contributor first.
 *
 * Count-descending rather than alphabetical, for the same reason
 * `groupByPublisher` sorts that way: eighteen rows from one portal and one from
 * another are not equally strong evidence about the same project, and the
 * alphabet hides that behind the letter A.
 */
export function buildPortalSummaries(
  listings: readonly PortalListingRecord[]
): PortalSummary[] {
  const byPublisher = new Map<string, PortalListingRecord[]>()
  for (const listing of listings) {
    const bucket = byPublisher.get(listing.publisher)
    if (bucket === undefined) byPublisher.set(listing.publisher, [listing])
    else bucket.push(listing)
  }

  const summaries: PortalSummary[] = []
  for (const [publisher, rows] of byPublisher) {
    const pageCounts = new Map<string, number>()
    const layouts = new Set<string>()
    let staleCount = 0
    let rentCount = 0
    let layoutUnstatedCount = 0
    let lastFetchedAt = ""

    for (const row of rows) {
      pageCounts.set(row.url, (pageCounts.get(row.url) ?? 0) + 1)
      if (row.isStale) staleCount += 1
      if (row.priceKind === "rent") rentCount += 1
      if (row.layout === null) layoutUnstatedCount += 1
      else layouts.add(row.layout)
      if (row.fetchedAt > lastFetchedAt) lastFetchedAt = row.fetchedAt
    }

    const { bands, withoutPrice } = bandsByCurrency(
      rows.filter((row) => row.priceKind === "sale")
    )

    summaries.push({
      publisher,
      listingCount: rows.length,
      pageCount: pageCounts.size,
      staleCount,
      allStale: rows.length > 0 && staleCount === rows.length,
      rentCount,
      saleBands: bands,
      saleWithoutPrice: withoutPrice,
      layouts: [...layouts].sort((a, b) => a.localeCompare(b)),
      layoutUnstatedCount,
      lastFetchedAt,
      primaryUrl: busiestUrl(pageCounts),
      image: portalImage(publisher),
    })
  }

  summaries.sort(
    (a, b) =>
      b.listingCount - a.listingCount || a.publisher.localeCompare(b.publisher)
  )
  return summaries
}

/**
 * The page carrying most of a portal's rows.
 *
 * Ties break alphabetically so the link a reader gets today is the link they get
 * tomorrow. Capital Estate publishes eight apartments on one page; Haspo Realty
 * publishes eighteen on eighteen, so for that portal any of them is as
 * representative as any other and the card's wording says "a page", not "the
 * listing".
 */
function busiestUrl(counts: ReadonlyMap<string, number>): string | null {
  let best: string | null = null
  let bestCount = 0
  for (const [url, count] of [...counts].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    if (count > bestCount) {
      best = url
      bestCount = count
    }
  }
  return best
}

/**
 * Substitutes `{name}` placeholders in a message read with `t.raw`.
 *
 * The labels these components take are strings with placeholders rather than
 * formatting functions, which is the same constraint `components/evidence/
 * format.ts` documents: a Server Component cannot hand a function to a client
 * component, and `messages/*.json` already has this shape.
 */
export function fillTemplate(
  template: string,
  values: Readonly<Record<string, string>>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key)
      ? (values[key] ?? match)
      : match
  )
}
