/**
 * # Portal seed data — the local-seed half of `portal-repository.ts`
 *
 * Owned by **W2-A**. Same contract as `inventory-data.ts`: every builder
 * returns rows in the **PostgREST wire shape** (numerics as fixed-point
 * strings, timestamps as ISO UTC) so one mapper serves both the Supabase and
 * the local-seed path, and every builder is deterministic — `seedIso()` only,
 * never a wall clock.
 *
 * ## These 47 rows are the conflict register
 *
 * They are transcribed verbatim from the W0-B harvest. Three properties of the
 * set are load-bearing and must survive any edit:
 *
 *  - **27 distinct URLs across 47 rows.** One building-overview page publishes
 *    many apartments — `cestate.net/building/AzuraWorld` alone yields 8 rows,
 *    `seaside-alanya` another 8, `housearch` 4 per locale. `portal_listings`
 *    has no unique key on `url` for exactly this reason (migration 05); a
 *    `unique (url)` would reject 20 of these.
 *  - **Two currencies.** Housearch quotes USD for the same project everyone
 *    else quotes in EUR. CONVENTIONS §5 forbids converting silently, so
 *    `getPriceSpread()` never mixes them — it buckets per currency.
 *  - **Two price kinds.** Two of the rows are monthly RENT (Alto €2 100,
 *    Haspo €1 000). A rent in the sale series is wrong by two orders of
 *    magnitude, so `price_kind` buckets alongside currency.
 *
 * `claimed_block_count`, `claimed_total_units` and `claimed_build_status` are
 * `null` on every row: the columns exist in migration 05 but W0-B's parser
 * never populates them. That is a harvest gap, reported in the W2-A handoff,
 * not a reason to invent a claim.
 *
 * Notes are kept verbatim, including the ones that flag a published figure as
 * implausible (a 2+1 with a stated area of 3 m²) or the listing as being for
 * the wrong district. SYSTEM-PROMPT §2.2: the losing value stays visible.
 */

import type { UnitLayout } from "@/lib/contracts"
import type { CurrencyCode } from "@/lib/inventory-data"
import {
  SEED_LISTING_ANCHORS,
  SEED_SITE_ID,
  seedSourceRegister,
} from "@/lib/inventory-data"
import { seedIso } from "@/lib/repository-base"

// ---------------------------------------------------------------------------
// Row shapes — the PostgREST wire shape of each table
// ---------------------------------------------------------------------------

export type SeedPortalListingRow = {
  id: string
  site_id: string | null
  publisher: string
  url: string
  fetched_at: string
  layout: UnitLayout | null
  interior_m2: string | null
  price_amount: string | null
  price_currency: CurrencyCode | null
  price_kind: string | null
  claimed_block_count: number | null
  claimed_total_units: number | null
  claimed_build_status: string | null
  is_stale: boolean
  note: string | null
  created_at: string
  updated_at: string
}

export type SeedCompetingPriceRow = {
  id: string
  unit_id: string
  amount: string
  currency: CurrencyCode
  source_url: string
  publisher: string | null
  observed_at: string
  created_at: string
}

/**
 * One harvested listing. Order:
 *   publisher, url, fetchedAt, layout, interiorM2, amount, currency,
 *   priceKind, claimedBlockCount, claimedTotalUnits, claimedBuildStatus,
 *   isStale, note
 */
export type PortalListingTuple = readonly [
  publisher: string,
  url: string,
  fetchedAt: string,
  layout: UnitLayout | null,
  interiorM2: number | null,
  amount: number | null,
  currency: CurrencyCode | null,
  priceKind: string | null,
  claimedBlockCount: number | null,
  claimedTotalUnits: number | null,
  claimedBuildStatus: string | null,
  isStale: boolean,
  note: string | null,
]

export const SEED_PORTAL_LISTINGS: readonly PortalListingTuple[] = Object.freeze([
  ["Alanya-Home", "https://alanya-home.com/property/466/de/verkauf_wohnungen_in_azura_world_residence_hotel_turkler_alanya_turkei", "2026-07-27T14:47:11.080Z", null, 85, 220000, "EUR", "sale", null, null, null, false, "portal overview 'price from' row; the page does not attach this price to a layout; listing last updated 2023-02-25 16:50:01"],
  ["Alanya-Home", "https://alanya-home.com/property/891/en/azura_world_residence_hotel", "2026-07-27T14:47:16.229Z", null, 80, 125000, "EUR", "sale", null, null, null, false, "portal overview 'price from' row; the page does not attach this price to a layout; page states a size range: 80 - 300 m2; listing last updated 2025-08-11 12:39:54"],
  ["Alto Real Estate", "https://altoprealestate.com/property/id-10331", "2026-07-27T14:49:00.588Z", "1+1", 70, 2100, "EUR", "rent", null, null, null, false, "monthly rent for one furnished apartment in Azura World; currency read from the listing markup data-base-price=\"2100\" data-base-currency=\"eur\" — the on-page figure sits next to a currency switcher and carries no glyph of its own"],
  ["Capital Estate", "https://www.cestate.net/building/AzuraWorld", "2026-07-27T14:48:50.999Z", "1+1", 63, 230000, "EUR", "sale", null, null, null, false, null],
  ["Capital Estate", "https://www.cestate.net/building/AzuraWorld", "2026-07-27T14:48:50.999Z", "1+1", 58, 265000, "EUR", "sale", null, null, null, false, null],
  ["Capital Estate", "https://www.cestate.net/building/AzuraWorld", "2026-07-27T14:48:50.999Z", "1+1", 68, 310000, "EUR", "sale", null, null, null, false, null],
  ["Capital Estate", "https://www.cestate.net/building/AzuraWorld", "2026-07-27T14:48:50.999Z", "2+1", 93, 450000, "EUR", "sale", null, null, null, false, null],
  ["Capital Estate", "https://www.cestate.net/building/AzuraWorld", "2026-07-27T14:48:50.999Z", "2+1", 93, 500000, "EUR", "sale", null, null, null, false, null],
  ["Capital Estate", "https://www.cestate.net/building/AzuraWorld", "2026-07-27T14:48:50.999Z", "3+1", 145, 415000, "EUR", "sale", null, null, null, false, null],
  ["Capital Estate", "https://www.cestate.net/building/AzuraWorld", "2026-07-27T14:48:50.999Z", null, 305, 1450000, "EUR", "sale", null, null, null, false, "page states the layout as '5+ rooms', which is outside the frozen UnitLayout union"],
  ["Capital Estate", "https://www.cestate.net/building/AzuraWorld", "2026-07-27T14:48:50.999Z", null, 312, 1200000, "EUR", "sale", null, null, null, false, "page states the layout as '5+ rooms', which is outside the frozen UnitLayout union"],
  ["Haspo Realty", "https://hasporealty.com/en/properties/prodaetsya-apartamenty-3-1-xl-v-komplekse-azura-world-tyurkler-alanya/", "2026-07-27T14:49:32.311Z", "3+1", 183, 574000, "EUR", "sale", null, null, null, true, null],
  ["Haspo Realty", "https://hasporealty.com/en/properties/prodaetsya-kvartira-1-1-v-komplekse-azura-world-oba-alanya/", "2026-07-27T14:49:40.807Z", "1+1", 80, 112000, "EUR", "sale", null, null, null, true, "WRONG-DISTRICT SUSPECT: Azura World is in Türkler, Alanya; the page states district 'Oba', not Türkler. Emitted unchanged so the builder can decide; do not treat this price as an Azura World anchor without resolving the mismatch (F-002)"],
  ["Haspo Realty", "https://hasporealty.com/en/properties/prodaetsya-apartamenty-3-1-xl-v-komplekse-azura-world-tyurkler-alanya-2/", "2026-07-27T14:49:47.983Z", "3+1", 183, 574000, "EUR", "sale", null, null, null, true, null],
  ["Haspo Realty", "https://hasporealty.com/en/properties/kvartira-1-1-azura-world-turkler-alanya-3/", "2026-07-27T14:49:56.133Z", "1+1", 85, 1000, "EUR", "rent", null, null, null, true, "page tags this listing as RENT, not sale — the monthly rent must never enter the sale-price series (F-002)"],
  ["Haspo Realty", "https://hasporealty.com/en/properties/kvartira-3-1-azura-world-tyurkler-alanya-2/", "2026-07-27T14:50:04.156Z", "3+1", 140, 415000, "EUR", "sale", null, null, null, true, null],
  ["Haspo Realty", "https://hasporealty.com/en/properties/kvartira-3-1-azura-world-tyurkler-alanya/", "2026-07-27T14:50:12.413Z", "3+1", 140, 445000, "EUR", "sale", null, null, null, true, null],
  ["Haspo Realty", "https://hasporealty.com/en/properties/kvartira-2-1-azura-world-tyurkler-alanya-3/", "2026-07-27T14:50:19.464Z", "2+1", 129, 242000, "EUR", "sale", null, null, null, true, null],
  ["Haspo Realty", "https://hasporealty.com/en/properties/kvartira-2-1-azura-world-tyurkler-alanya-2/", "2026-07-27T14:50:26.884Z", "2+1", 3, 242000, "EUR", "sale", null, null, null, true, "stated area 3 m² is implausible for a 2+1 unit; reported as published, not corrected"],
  ["Haspo Realty", "https://hasporealty.com/en/properties/kvartira-1-1-v-azura-world-residence-turkler-alaniya/", "2026-07-27T14:50:34.458Z", "1+1", 85, 169000, "EUR", "sale", null, null, null, true, null],
  ["Haspo Realty", "https://hasporealty.com/en/properties/kvartira-1-1-azura-world-tyurkler-alanya/", "2026-07-27T14:50:41.339Z", "1+1", 85, 168000, "EUR", "sale", null, null, null, true, null],
  ["Haspo Realty", "https://hasporealty.com/en/properties/prostornaya-kvartira-1-1-v-azura-world-residencetyurkler-alaniya/", "2026-07-27T14:50:48.387Z", "1+1", 85, 161000, "EUR", "sale", null, null, null, true, null],
  ["Haspo Realty", "https://hasporealty.com/en/properties/kvartira-1-1-azura-world-turkler-alanya/", "2026-07-27T14:50:55.666Z", "1+1", 85, 161000, "EUR", "sale", null, null, null, true, null],
  ["Haspo Realty", "https://hasporealty.com/en/properties/kvartira-1-1-azura-world-tyurkler-alanya-2/", "2026-07-27T14:51:02.462Z", "1+1", 85, 137000, "EUR", "sale", null, null, null, true, null],
  ["Haspo Realty", "https://hasporealty.com/en/properties/kvartira-2-1-azura-world-tyurkler-alanya/", "2026-07-27T14:51:09.691Z", "2+1", 129, 259000, "EUR", "sale", null, null, null, true, null],
  ["Haspo Realty", "https://hasporealty.com/en/properties/kvartira-1-1-azura-world-turkler-alanya-2/", "2026-07-27T14:51:15.913Z", "1+1", 85, 178000, "EUR", "sale", null, null, null, true, "WRONG-DISTRICT SUSPECT: Azura World is in Türkler, Alanya; the page states district 'Mahmutlar', not Türkler (its own headline still says Türkler: 'Apartment 1+1 Azura World, Turkler, Alanya'). Emitted unchanged so the builder can decide; do not treat this price as an Azura World anchor without resolving the mismatch (F-002)"],
  ["Haspo Realty", "https://hasporealty.com/en/properties/kvartira-2-1-xl-azura-world-residence-hotel/", "2026-07-27T14:51:22.365Z", "2+1", 249, 390000, "EUR", "sale", null, null, null, true, "page states no floor for this unit"],
  ["Haspo Realty", "https://hasporealty.com/en/properties/kvartira-2-1-azura-world-residence-hotel/", "2026-07-27T14:51:28.623Z", "2+1", 105, 245000, "EUR", "sale", null, null, null, true, "page states no floor for this unit"],
  ["Haspo Realty", "https://hasporealty.com/en/properties/kvartira-1-1-azura-world-residence-hotel/", "2026-07-27T14:51:34.586Z", "1+1", 89, 190000, "EUR", "sale", null, null, null, true, null],
  ["Housearch", "https://housearch.com/de/turkey/residential-complexes/azura-world-3403639/", "2026-07-27T14:51:43.796Z", "1+1", 75, 239171, "USD", "sale", null, null, null, false, "advertised entry price for this floor-plan group, not a specific unit"],
  ["Housearch", "https://housearch.com/de/turkey/residential-complexes/azura-world-3403639/", "2026-07-27T14:51:43.796Z", "2+1", 105, 284728, "USD", "sale", null, null, null, false, "advertised entry price for this floor-plan group, not a specific unit"],
  ["Housearch", "https://housearch.com/de/turkey/residential-complexes/azura-world-3403639/", "2026-07-27T14:51:43.796Z", "3+1", 178, 456704, "USD", "sale", null, null, null, false, "advertised entry price for this floor-plan group, not a specific unit"],
  ["Housearch", "https://housearch.com/de/turkey/residential-complexes/azura-world-3403639/", "2026-07-27T14:51:43.796Z", "4+1", 349, 1366695, "USD", "sale", null, null, null, false, "advertised entry price for this floor-plan group, not a specific unit"],
  ["Housearch", "https://housearch.com/ru/turkey/residential-complexes/azura-world-3403639/", "2026-07-27T14:51:39.282Z", "1+1", 75, 238967, "USD", "sale", null, null, null, false, "advertised entry price for this floor-plan group, not a specific unit"],
  ["Housearch", "https://housearch.com/ru/turkey/residential-complexes/azura-world-3403639/", "2026-07-27T14:51:39.282Z", "2+1", 105, 284485, "USD", "sale", null, null, null, false, "advertised entry price for this floor-plan group, not a specific unit"],
  ["Housearch", "https://housearch.com/ru/turkey/residential-complexes/azura-world-3403639/", "2026-07-27T14:51:39.282Z", "3+1", 178, 456314, "USD", "sale", null, null, null, false, "advertised entry price for this floor-plan group, not a specific unit"],
  ["Housearch", "https://housearch.com/ru/turkey/residential-complexes/azura-world-3403639/", "2026-07-27T14:51:39.282Z", "4+1", 349, 1365529, "USD", "sale", null, null, null, false, "advertised entry price for this floor-plan group, not a specific unit"],
  ["Seaside Alanya", "https://www.seaside-alanya.com/de/antalya-alanya/residence/azura-world-residence", "2026-07-27T14:47:31.915Z", "1+1", 92, 185000, "EUR", "sale", null, null, null, false, null],
  ["Seaside Alanya", "https://www.seaside-alanya.com/de/antalya-alanya/residence/azura-world-residence", "2026-07-27T14:47:31.915Z", "1+1", 85, 210000, "EUR", "sale", null, null, null, false, null],
  ["Seaside Alanya", "https://www.seaside-alanya.com/de/antalya-alanya/residence/azura-world-residence", "2026-07-27T14:47:31.915Z", "2+1", 129, 264000, "EUR", "sale", null, null, null, false, null],
  ["Seaside Alanya", "https://www.seaside-alanya.com/de/antalya-alanya/residence/azura-world-residence", "2026-07-27T14:47:31.915Z", "2+1", 157, 363000, "EUR", "sale", null, null, null, false, null],
  ["Seaside Alanya", "https://www.seaside-alanya.com/de/antalya-alanya/residence/azura-world-residence", "2026-07-27T14:47:31.915Z", "3+1", 183, 401000, "EUR", "sale", null, null, null, false, null],
  ["Seaside Alanya", "https://www.seaside-alanya.com/de/antalya-alanya/residence/azura-world-residence", "2026-07-27T14:47:31.915Z", "2+1", 118, 450000, "EUR", "sale", null, null, null, false, null],
  ["Seaside Alanya", "https://www.seaside-alanya.com/de/antalya-alanya/residence/azura-world-residence", "2026-07-27T14:47:31.915Z", "4+1", 313, 650000, "EUR", "sale", null, null, null, false, null],
  ["Seaside Alanya", "https://www.seaside-alanya.com/de/antalya-alanya/residence/azura-world-residence", "2026-07-27T14:47:31.915Z", "5+1", 361, 1200000, "EUR", "sale", null, null, null, false, "floor cell reads 'Villentyp', which is not a floor level"],
  ["TERRA Real Estate", "https://terrarealestate.com/property/2059-azura-world-apartments-with-5-star-hotel-facilities-in-alanya", "2026-07-27T14:46:59.591Z", null, null, 200000, "EUR", "sale", null, null, null, false, "\"From\" price for a project listing card, not a single unit; card states the size range 81 m2 - 349 m2"],
  ["TERRA Real Estate", "https://terrarealestate.com/property/2062-azura-world-villas-in-alanya-turkler-with-private-beach", "2026-07-27T14:46:59.591Z", null, null, 400000, "EUR", "sale", null, null, null, false, "\"From\" price for a project listing card, not a single unit; card states the size range 118 m2 - 361 m2"],
] as readonly PortalListingTuple[])

function numericString(value: number, scale = 2): string {
  return value.toFixed(scale)
}

function seedUuid(prefix: string, ordinal: number): string {
  return `${prefix}-0000-4000-8000-${String(ordinal).padStart(12, "0")}`
}

/**
 * The 47 harvested listings as `portal_listings` rows.
 *
 * `site_id` is set for every row here, which is a seed-mode simplification:
 * migration 05 keeps the column nullable precisely because a scraped listing's
 * identity is its URL and not its position in our hierarchy. Nothing in the
 * repository depends on it being non-null.
 */
export function seedPortalListingRows(): SeedPortalListingRow[] {
  return SEED_PORTAL_LISTINGS.map((tuple, index) => {
    const [
      publisher,
      url,
      fetchedAt,
      layout,
      interiorM2,
      amount,
      currency,
      priceKind,
      claimedBlockCount,
      claimedTotalUnits,
      claimedBuildStatus,
      isStale,
      note,
    ] = tuple

    return {
      id: seedUuid("a1000000", index + 1),
      site_id: SEED_SITE_ID,
      publisher,
      url,
      fetched_at: fetchedAt,
      layout,
      interior_m2: interiorM2 === null ? null : numericString(interiorM2),
      price_amount: amount === null ? null : numericString(amount),
      price_currency: currency,
      price_kind: priceKind,
      claimed_block_count: claimedBlockCount,
      claimed_total_units: claimedTotalUnits,
      claimed_build_status: claimedBuildStatus,
      is_stale: isStale,
      note,
      created_at: seedIso(-1),
      updated_at: seedIso(0),
    }
  })
}

/**
 * The unit each listing anchor was assigned to. The first 25 planned units
 * (B01, sequences 1–25) are the portal-listing units, in anchor order — the
 * same assignment `inventory-data.ts` makes, derived rather than repeated.
 */
export function seedAnchorUnitId(anchorIndex: number): string {
  return `AZW-B01-${String(anchorIndex + 1).padStart(4, "0")}`
}

/**
 * `competing_prices` rows.
 *
 * 25 of them mirror the harvest one-for-one: the price each portal published
 * for the unit that portal's listing became. The last two are a **seed-mode
 * demonstration** and are marked as such here rather than in the data, because
 * the table has no note column: they attach Housearch's USD entry price and
 * Capital Estate's EUR price for a 1+1 to `AZW-B01-0002`, so that one unit
 * carries three prices in two currencies and the mixed-currency path is
 * actually exercised. Both figures are real and cite real snapshots; only the
 * attribution to that specific unit is a seed convenience. The Supabase path
 * reads the real `competing_prices` table and makes no such attribution.
 */
export function seedCompetingPriceRows(
  unitIds?: readonly string[]
): SeedCompetingPriceRow[] {
  const wanted = unitIds === undefined ? null : new Set(unitIds)
  const rows: SeedCompetingPriceRow[] = []

  SEED_LISTING_ANCHORS.forEach((anchor, index) => {
    const [, , , amount, currency, publisher, , fetchedAt, , url] = anchor
    const unitId = seedAnchorUnitId(index)
    if (wanted !== null && !wanted.has(unitId)) return
    rows.push({
      id: seedUuid("a2000000", index + 1),
      unit_id: unitId,
      amount: numericString(amount),
      currency,
      source_url: url,
      publisher,
      observed_at: fetchedAt,
      created_at: seedIso(-1),
    })
  })

  const demoUnitId = seedAnchorUnitId(1)
  if (wanted === null || wanted.has(demoUnitId)) {
    const register = seedSourceRegister()
    const housearch = register.get(
      "https://housearch.com/de/turkey/residential-complexes/azura-world-3403639/"
    )
    const capital = register.get("https://www.cestate.net/building/AzuraWorld")

    if (housearch !== undefined) {
      rows.push({
        id: seedUuid("a2000000", 900),
        unit_id: demoUnitId,
        amount: numericString(239171),
        currency: "USD",
        source_url: housearch.url,
        publisher: housearch.publisher,
        observed_at: housearch.fetchedAt,
        created_at: seedIso(-1),
      })
    }
    if (capital !== undefined) {
      rows.push({
        id: seedUuid("a2000000", 901),
        unit_id: demoUnitId,
        amount: numericString(230000),
        currency: "EUR",
        source_url: capital.url,
        publisher: capital.publisher,
        observed_at: capital.fetchedAt,
        created_at: seedIso(-1),
      })
    }
  }

  return rows
}
