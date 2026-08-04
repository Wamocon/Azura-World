/**
 * The facts this surface renders, selected once.                     Owner: W3-A
 *
 * Everything here is read from the generated dataset. Nothing is computed into
 * a new number except counts of facts actually rendered on this page, and those
 * are counted from the same objects that get rendered, so the band cannot drift
 * from the page it describes.
 *
 * The generated module declares its own `Azura*` types. They are structurally
 * identical to `CONTRACTS.md` §1 and, since the W-INT generator fix, carry the
 * real literal unions rather than `Record<string, unknown>` — so a fact crosses
 * into `SourcedFact<T>` without a cast. `isSourcedFact` is still used at the one
 * place a value is picked out of a heterogeneous list.
 */

import { azuraWorldDataset } from "@/lib/azura-world-data"
import type { Confidence, Money, SourcedFact, SourceRef } from "@/lib/contracts"

const dataset = azuraWorldDataset

export const project = dataset.project
export const hotel = dataset.hotel
export const blocks = dataset.blocks
export const coverage = dataset.coverage
export const unitSplit = dataset.unitSplit
export const generatedAt = dataset.generatedAt

/**
 * The two collections the landing counts, re-exported so a section counts them
 * rather than writing the count down.
 *
 * `system-flow.tsx` had `{ key: "sources", value: 56 }` as a literal under the
 * label "sources verified", beside a doc comment insisting the figures were
 * "real and counted, not decoration". The dataset says `sourcesTotal: 60,
 * sourcesValidated: 45` — 56 is neither. A literal cannot go stale loudly.
 */
export const portalListings = dataset.portalListings
export const findings = dataset.findings

// ---------------------------------------------------------------------------
// The entry price — F-002, the page's central conflict
// ---------------------------------------------------------------------------

const F002 = dataset.findings.find((f) => f.id === "F-002")

/**
 * A competing 1+1 price as published, kept in its own currency.
 *
 * **Currency is never converted** (DESIGN.md §6). A EUR figure and a USD figure
 * are two numbers in different units; inventing a rate to make them comparable
 * would be inventing a number, which is the one thing this project may not do.
 */
export interface CompetingPrice {
  money: Money
  source: SourceRef
  layout: string | null
  interiorM2: number | null
  isStale: boolean
  isEntryPrice: boolean
  note: string | null
}

function toCompetingPrice(entry: {
  value: unknown
  source: SourceRef
}): CompetingPrice | null {
  const v = entry.value
  if (typeof v !== "object" || v === null) return null
  const record = v as Record<string, unknown>
  const amount = record["amount"]
  const currency = record["currency"]
  if (typeof amount !== "number") return null
  if (
    currency !== "EUR" &&
    currency !== "USD" &&
    currency !== "TRY" &&
    currency !== "GBP"
  ) {
    return null
  }
  const layout = record["layout"]
  const interiorM2 = record["interiorM2"]
  const note = record["note"]
  return {
    money: { amount, currency },
    source: entry.source,
    layout: typeof layout === "string" ? layout : null,
    interiorM2: typeof interiorM2 === "number" ? interiorM2 : null,
    isStale: record["isStale"] === true,
    isEntryPrice: record["isEntryPrice"] === true,
    note: typeof note === "string" ? note : null,
  }
}

/** All 19 published 1+1 figures, in publication order. */
export const competingPrices: CompetingPrice[] = (F002?.competingValues ?? [])
  .map((entry) =>
    toCompetingPrice(entry as { value: unknown; source: SourceRef })
  )
  .filter((p): p is CompetingPrice => p !== null)

/**
 * The four the finding's own message names, one per publisher, chosen as the
 * publisher's extreme so the spread is not understated: the lowest EUR figure,
 * the two mid-range portals, and the USD figure. These are the four that go on
 * the front page.
 *
 * Selected by publisher rather than by rank so that the band shows four
 * *independent* disagreeing sources rather than four rows from one portal —
 * Haspo alone publishes eight of the nineteen, and four Haspo rows would
 * overstate the number of parties who disagree.
 */
export const headlinePrices: CompetingPrice[] = (() => {
  const wanted = ["Haspo Realty", "Seaside Alanya", "Alanya-Home", "Housearch"]
  const out: CompetingPrice[] = []
  for (const publisher of wanted) {
    const forPublisher = competingPrices.filter(
      (p) => p.source.publisher === publisher
    )
    if (forPublisher.length === 0) continue
    // The publisher's own extreme: lowest for the cheapest house, highest for
    // the dearest, so the band shows the true span rather than a soft middle.
    const sorted = [...forPublisher].sort(
      (a, b) => a.money.amount - b.money.amount
    )
    const pick =
      publisher === "Haspo Realty" ? sorted[0] : sorted[sorted.length - 1]
    if (pick !== undefined) out.push(pick)
  }
  return out
})()

/**
 * The hero's fourth sounding.
 *
 * The display value is **the one figure a publisher actually labels as an entry
 * price** — Alanya-Home's "price from" row. No other value in the set claims to
 * be a floor, and picking the cheapest or the median instead would be inventing
 * a primacy the sources do not state. Every other figure travels with it in
 * `conflictsWith`, so the popover shows all nineteen and the badge is always on.
 *
 * `conflictRange()` will return `null` for this fact because the set spans EUR
 * and USD, which is correct: the sounding then shows one sourced value plus the
 * conflict badge rather than a range that would silently imply a conversion.
 */
export const entryPriceFact: SourcedFact<Money> | null = (() => {
  if (competingPrices.length === 0) return null
  const declared = competingPrices.find((p) => p.isEntryPrice)
  const display = declared ?? competingPrices[0]
  if (display === undefined) return null
  const rest = competingPrices.filter((p) => p !== display)
  return {
    value: display.money,
    sources: [display.source],
    confidence: "conflicted",
    conflictsWith: rest.map((p) => ({ value: p.money, source: p.source })),
    note: F002?.message ?? "",
  }
})()

/** The span, stated as two endpoints in their own currencies. Never a range. */
export const priceSpan: {
  low: CompetingPrice
  high: CompetingPrice
  factor: number
} | null = (() => {
  if (competingPrices.length < 2) return null
  const sorted = [...competingPrices].sort(
    (a, b) => a.money.amount - b.money.amount
  )
  const low = sorted[0]
  const high = sorted[sorted.length - 1]
  if (low === undefined || high === undefined) return null
  return {
    low,
    high,
    // Stated only because both endpoints happen to be EUR. If they were not,
    // this would be a currency conversion wearing a ratio's clothes.
    factor:
      low.money.currency === high.money.currency
        ? Math.round((high.money.amount / low.money.amount) * 10) / 10
        : Number.NaN,
  }
})()

// ---------------------------------------------------------------------------
// What the evidence band counts
// ---------------------------------------------------------------------------

/**
 * Exactly the facts this page renders, in render order. The band counts THIS
 * array, so "23 facts on this page" is a statement about the page rather than
 * about the dataset — which is the claim the band is allowed to make.
 */
export const renderedFacts: ReadonlyArray<{
  key: string
  fact: SourcedFact<unknown>
}> = [
  { key: "project.plotAreaSqm", fact: project.plotAreaSqm },
  { key: "project.residenceBlockCount", fact: project.residenceBlockCount },
  { key: "project.totalUnits", fact: project.totalUnits },
  { key: "project.developer", fact: project.developer },
  { key: "project.developerFoundedYear", fact: project.developerFoundedYear },
  { key: "project.buildingCount", fact: project.buildingCount },
  { key: "project.floorsPerBuilding", fact: project.floorsPerBuilding },
  { key: "project.greenAreaSqm", fact: project.greenAreaSqm },
  { key: "project.buildingFootprintSqm", fact: project.buildingFootprintSqm },
  {
    key: "project.outdoorFacilityAreaSqm",
    fact: project.outdoorFacilityAreaSqm,
  },
  { key: "project.constructionStart", fact: project.constructionStart },
  { key: "project.completionDate", fact: project.completionDate },
  { key: "project.buildStatus", fact: project.buildStatus },
  { key: "project.distanceToSeaM", fact: project.distanceToSeaM },
  {
    key: "project.distanceToAlanyaCentreKm",
    fact: project.distanceToAlanyaCentreKm,
  },
  {
    key: "project.distanceToGazipasaAirportKm",
    fact: project.distanceToGazipasaAirportKm,
  },
  {
    key: "project.distanceToAntalyaAirportKm",
    fact: project.distanceToAntalyaAirportKm,
  },
  { key: "project.downPaymentPercent", fact: project.downPaymentPercent },
  { key: "hotel.stars", fact: hotel.stars },
  { key: "hotel.roomCount", fact: hotel.roomCount },
  { key: "hotel.board", fact: hotel.board },
  { key: "hotel.aquaparkSlides", fact: hotel.aquaparkSlides },
  { key: "hotel.openedYear", fact: hotel.openedYear },
  { key: "hotel.formerName", fact: hotel.formerName },
  { key: "hotel.brandAffiliation", fact: hotel.brandAffiliation },
  { key: "hotel.distanceToBeachM", fact: hotel.distanceToBeachM },
]

export const factsByConfidence: Record<Confidence, number> = (() => {
  const counts: Record<Confidence, number> = {
    confirmed: 0,
    official: 0,
    single_source: 0,
    conflicted: 0,
    inferred: 0,
    gap: 0,
  }
  for (const { fact } of renderedFacts) counts[fact.confidence] += 1
  if (entryPriceFact !== null) counts[entryPriceFact.confidence] += 1
  return counts
})()

/** Distinct publishers cited by the facts on this page. */
export const distinctPublishers: number = (() => {
  const set = new Set<string>()
  for (const { fact } of renderedFacts) {
    for (const source of fact.sources) set.add(source.publisher)
  }
  for (const price of competingPrices) set.add(price.source.publisher)
  return set.size
})()

export const findingsBySeverity: Record<string, number> = (() => {
  const counts: Record<string, number> = {}
  for (const finding of dataset.findings) {
    counts[finding.severity] = (counts[finding.severity] ?? 0) + 1
  }
  return counts
})()

export const findingsTotal = dataset.findings.length

/**
 * Amenities are **empty in the dataset** — `amenities: []`, and the generator
 * emits `AzuraAmenity = never` to record that nothing reaches it. The page
 * states that rather than filling the section with a plausible list, and the
 * absence is itself reported in the evidence band.
 *
 * CONTRACT-GAP-02 covers the missing `Amenity` interface; this is the data half
 * of the same gap.
 */
export const amenitiesAvailable = dataset.amenities.length > 0
