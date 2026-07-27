/**
 * # Inventory seed data — the local-seed half of `inventory-repository.ts`
 *
 * Owned by **W2-A**. Nothing here talks to Supabase; these are the rows
 * `withRepository()` falls back to when Supabase is unconfigured.
 *
 * ## Every builder returns rows in the PostgREST WIRE shape
 *
 * Not the domain shape. The W2-A brief requires seed objects "structurally
 * identical to the Supabase shape, so swapping `source` changes nothing
 * downstream", and the only way to actually guarantee that is to run **one**
 * mapper over both paths. So `numeric` columns are strings here exactly as
 * PostgREST serialises them (`numeric(14,2)` → `"574000.00"`), `date` columns
 * are `YYYY-MM-DD`, and embedded relations are nested objects. Seed mode
 * therefore exercises the same `asNullableNumber`/`asMoney` parsing that
 * production does — a coercion bug cannot hide in one path and not the other.
 *
 * Every row type is a `type` alias rather than an `interface` on purpose:
 * TypeScript gives type aliases an implicit index signature, so these rows are
 * assignable to the `Record<string, unknown>` the mappers accept. An interface
 * is not, and the mappers would need a cast.
 *
 * ## Deterministic — no clock, no randomness
 *
 * W2-A brief: "A seeded dashboard must render identically on every run or
 * Playwright snapshots become useless." Timestamps come from `seedIso()`
 * (anchored at `SEED_ANCHOR_ISO`), never `Date.now()` or a bare `new Date()`.
 * Two calls to any builder produce byte-identical JSON.
 *
 * ## Where the numbers come from
 *
 * The ids, the 7×(94,94,94,94,94,93,93) = 656 block split, the 25 real portal
 * listings and their citations are transcribed from the harvested dataset and
 * `supabase/seed.sql`, so seed mode and a seeded database agree row for row.
 * The 631 modelled units are regenerated here by the same rule W0-B's
 * generator used — layout cycle `3+1,1+1,2+1,4+1,5+1` over the modelled index,
 * `floor_level = (sequence - 1) % 6`, price = median observed €/m² for the
 * layout × median observed interior area — which reproduces the database's
 * modelled prices exactly (1+1 → 168 500, 2+1 → 281 131, 3+1 → 574 000).
 *
 * Two deliberate divergences from `supabase/seed.sql`, both reported in the
 * W2-A handoff:
 *
 *  1. The last five units of B07 carry `6+1`, `townhouse`, `villa`,
 *     `president_villa` and `penthouse` so every value of `public.unit_layout`
 *     is exercised. No source publishes a price, an area or a floor for those
 *     five layouts, so all three are `null` and their facts are `"gap"` — which
 *     is also the only place the gap path gets exercised at all.
 *  2. Owner One holds a second, non-primary unit. `seed.sql` gives every
 *     resident exactly one holding, which makes "a `child_owner` sees a strict
 *     subset of its guardian" untestable — the two sets are equal. The
 *     repository narrows a `child_*` role to its guardian's PRIMARY holdings in
 *     both modes; only this seed has the data to show the narrowing biting.
 *
 * Nothing here is invented as evidence: a modelled unit is `data_quality:
 * "modelled"`, is `is_publicly_listed: false`, and its price fact is
 * `"inferred"` with a note that says so. CONTRACTS.md §2: a modelled unit is
 * "NEVER presented as a real listing".
 */

import type {
  Confidence,
  Money,
  SourceTier,
  UnitLayout,
} from "@/lib/contracts"
import { seedIso } from "@/lib/repository-base"

// ---------------------------------------------------------------------------
// Column enums, derived from the frozen contract so they cannot drift
// ---------------------------------------------------------------------------

/** `public.currency_code`. */
export type CurrencyCode = Money["currency"]

/** `public.sale_status`. */
export type SaleStatus = "available" | "reserved" | "sold" | "unknown"

/** `public.unit_data_quality`. */
export type UnitDataQuality =
  | "portal_listing"
  | "official"
  | "modelled"
  | "source_missing"

/** `public.build_status`. */
export type BuildStatus = "planned" | "under_construction" | "completed"

/** `unit_residents.relation`. */
export type ResidentRelation = "owner" | "tenant" | "guest"

/** Every value of `public.sale_status`, in enum order. Rollups iterate this so
 *  a status with zero rows still appears with a count of 0 — an absent key and
 *  a zero count read very differently in a UI. */
export const SALE_STATUSES: readonly SaleStatus[] = Object.freeze([
  "available",
  "reserved",
  "sold",
  "unknown",
])

/** Every value of `public.unit_data_quality`, in enum order. `modelled` and
 *  `portal_listing` are counted separately everywhere — W3-C depends on keeping
 *  them visually distinct (W2-A brief, "Edge cases"). */
export const UNIT_DATA_QUALITIES: readonly UnitDataQuality[] = Object.freeze([
  "portal_listing",
  "official",
  "modelled",
  "source_missing",
])

/** Every value of `public.unit_layout`, in enum order. */
export const UNIT_LAYOUTS: readonly UnitLayout[] = Object.freeze([
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
])

// ---------------------------------------------------------------------------
// Numeric helpers, shared with the repositories
// ---------------------------------------------------------------------------

/**
 * Median of a numeric sample. Returns `null` for an empty sample rather than 0
 * — CONVENTIONS §5, a price of 0 is a bug and a missing one is an honest gap.
 * Even-sized samples average the two middle values, matching the rule W0-B's
 * generator used to derive the modelled prices this file reproduces.
 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid] ?? null
  const lower = sorted[mid - 1]
  const upper = sorted[mid]
  if (lower === undefined || upper === undefined) return null
  return (lower + upper) / 2
}

/** PostgREST serialises `numeric(p,s)` as a fixed-point STRING. Seed rows do
 *  the same so both paths hit the same parser. */
function numericString(value: number, scale = 2): string {
  return value.toFixed(scale)
}

// ---------------------------------------------------------------------------
// Fixed identifiers — transcribed from supabase/seed.sql so seed mode and a
// seeded database describe the same objects.
// ---------------------------------------------------------------------------

export const SEED_COMPANY_ID = "11111111-1111-4111-8111-111111111111"
export const SEED_SITE_ID = "22222222-2222-4222-8222-222222222222"
export const SEED_SITE_CODE = "AZW-TRK"

/** `profiles.id` values used by the seeded residents. Exported so a test can
 *  assert role scoping without re-deriving them. */
export const SEED_PROFILE_IDS = Object.freeze({
  ownerOne: "b0000000-0000-4000-8000-000000000005",
  tenantOne: "b0000000-0000-4000-8000-000000000006",
  childOwner: "b0000000-0000-4000-8000-000000000009",
  childTenant: "b0000000-0000-4000-8000-000000000010",
})

export const SEED_RESIDENT_IDS = Object.freeze({
  ownerOne: "d0000000-0000-4000-8000-000000000001",
  ownerTwo: "d0000000-0000-4000-8000-000000000002",
  tenantOne: "d0000000-0000-4000-8000-000000000003",
})

/** `site_blocks.id` for `B01`…`B07`. */
export function seedBlockId(blockCode: string): string {
  const index = Number(blockCode.slice(1))
  return `44444444-4444-4444-8444-4444444444${String(index).padStart(2, "0")}`
}

/** `site_floors.id` — synthetic, because `seed.sql` does not populate
 *  `site_floors` at all (a request for W1-A is in the W2-A handoff). */
export function seedFloorId(blockCode: string, level: number): string {
  const index = Number(blockCode.slice(1))
  return `55555555-5555-4555-8555-5555555${String(index).padStart(2, "0")}${String(level).padStart(2, "0")}`
}

/** The corroborated block split: 7 blocks, 656 units. */
export const SEED_BLOCK_UNIT_COUNTS: ReadonlyArray<readonly [string, number]> =
  Object.freeze([
    ["B01", 94],
    ["B02", 94],
    ["B03", 94],
    ["B04", 94],
    ["B05", 94],
    ["B06", 93],
    ["B07", 93],
  ] as ReadonlyArray<readonly [string, number]>)

/** Floors per building, from `sites.floors_per_building`. */
export const SEED_FLOORS_PER_BUILDING = 6

// ---------------------------------------------------------------------------
// Row shapes — the PostgREST wire shape of each table
// ---------------------------------------------------------------------------

export type SeedCompanyRow = {
  id: string
  slug: string
  name: string
  legal_name: string | null
  country: string
  default_currency: CurrencyCode
  founded_year: number | null
  website: string | null
  created_at: string
  updated_at: string
}

export type SeedSiteRow = {
  id: string
  company_id: string
  code: string
  name: string
  country: string
  province: string
  city: string
  district: string
  plot_area_sqm: string | null
  green_area_sqm: string | null
  building_footprint_sqm: string | null
  outdoor_facility_area_sqm: string | null
  residence_block_count: number | null
  building_count: number | null
  floors_per_building: number | null
  total_units: number | null
  construction_start: string | null
  completion_date: string | null
  build_status: BuildStatus | null
  distance_to_sea_m: number | null
  distance_to_alanya_centre_km: string | null
  distance_to_gazipasa_airport_km: string | null
  distance_to_antalya_airport_km: string | null
  down_payment_percent: string | null
  latitude: string | null
  longitude: string | null
  contact_phone: string | null
  contact_email: string | null
  contact_address: string | null
  created_at: string
  updated_at: string
}

export type SeedBlockRow = {
  id: string
  site_id: string
  code: string
  name: string | null
  floors: number | null
  unit_count: number | null
  sort_order: number
  created_at: string
  updated_at: string
}

export type SeedFloorRow = {
  id: string
  block_id: string
  level: number
  label: string | null
  unit_count: number | null
  created_at: string
}

export type SeedUnitRow = {
  id: string
  company_id: string
  site_id: string
  block_id: string
  floor_id: string | null
  block_code: string
  unit_no: string
  sequence: number
  layout: UnitLayout
  interior_m2: string | null
  outdoor_m2: string | null
  floor_level: number | null
  asking_price_amount: string | null
  asking_price_currency: CurrencyCode | null
  sale_status: SaleStatus
  data_quality: UnitDataQuality
  is_publicly_listed: boolean
  version: number
  created_at: string
  updated_at: string
  /** The `select("…, site_blocks(code, name)")` embed. One query, not 657. */
  site_blocks: { code: string; name: string | null } | null
}

export type SeedResidentRow = {
  id: string
  company_id: string
  profile_id: string | null
  full_name: string
  email: string | null
  phone: string | null
  nationality: string | null
  locale: string | null
  kind: string
  created_at: string
  updated_at: string
}

export type SeedUnitResidentRow = {
  id: string
  unit_id: string
  resident_id: string
  relation: ResidentRelation
  share_percent: string | null
  start_date: string
  end_date: string | null
  is_primary: boolean
  created_at: string
  /** The `select("…, residents!inner(profile_id)")` embed used by scoping. */
  residents: { profile_id: string | null } | null
}

export type SeedGuardianshipRow = {
  id: string
  guardian_profile_id: string
  child_profile_id: string
  relation: string
  status: string
  consent_recorded_at: string | null
  revoked_at: string | null
  created_at: string
}

/** `sources` as embedded under `fact_sources`. */
export type SeedSourceRow = {
  id: string
  url: string
  publisher: string
  tier: number
}

/** `source_snapshots` as embedded under `fact_sources`. */
export type SeedSnapshotRow = {
  fetched_at: string
}

export type SeedFactSourceRow = {
  snapshot_sha256: string | null
  sources: SeedSourceRow | null
  source_snapshots: SeedSnapshotRow | null
}

export type SeedFactConflictRow = {
  value: unknown
  snapshot_sha256: string | null
  sources: SeedSourceRow | null
  source_snapshots: SeedSnapshotRow | null
}

/** `sourced_facts` with its two embeds. This is the shape
 *  `inventory-repository` selects for `entity_type = 'unit'`. */
export type SeedSourcedFactRow = {
  id: string
  entity_type: string
  entity_id: string
  field_path: string
  value: unknown
  confidence: Confidence
  note: string | null
  fact_sources: SeedFactSourceRow[]
  fact_conflicts: SeedFactConflictRow[]
}

// ---------------------------------------------------------------------------
// The 25 real portal listings
//
// Transcribed verbatim from the harvest. Order:
//   layout, interiorM2, floorLevel, amount, currency,
//   publisher, tier, fetchedAt, snapshotHash, url
//
// Every hash is a real sha256 of a real file under `sources/raw/` — CONTRACTS
// §1 invariant 6. A citation that cannot be re-opened is not a citation, so
// none of these may be edited to "tidy" the data.
// ---------------------------------------------------------------------------

export type ListingAnchor = readonly [
  layout: UnitLayout,
  interiorM2: number,
  floorLevel: number | null,
  amount: number,
  currency: CurrencyCode,
  publisher: string,
  tier: SourceTier,
  fetchedAt: string,
  snapshotHash: string,
  url: string,
]

export const SEED_LISTING_ANCHORS: readonly ListingAnchor[] = Object.freeze([
  ["3+1", 183, 4, 574000, "EUR", "Haspo Realty", 4, "2026-07-27T14:49:32.311Z", "31b2a5b04df0cf5711202182c5d6c206d1333d31055f1c6537fd0194a70af373", "https://hasporealty.com/en/properties/prodaetsya-apartamenty-3-1-xl-v-komplekse-azura-world-tyurkler-alanya/"],
  ["1+1", 80, 4, 112000, "EUR", "Haspo Realty", 4, "2026-07-27T14:49:40.807Z", "e886d2ae902363209d7f2ad8bfb9f3fcd68760df43504fac2ffa5035f7756293", "https://hasporealty.com/en/properties/prodaetsya-kvartira-1-1-v-komplekse-azura-world-oba-alanya/"],
  ["3+1", 183, 4, 574000, "EUR", "Haspo Realty", 4, "2026-07-27T14:49:47.983Z", "1c7c2cf0de5c2ed58bc09311a467db920392c689656e9a2bdd843f37909048aa", "https://hasporealty.com/en/properties/prodaetsya-apartamenty-3-1-xl-v-komplekse-azura-world-tyurkler-alanya-2/"],
  ["3+1", 140, 3, 415000, "EUR", "Haspo Realty", 4, "2026-07-27T14:50:04.156Z", "840832430cdae6b2172fa5c22bf3ad2950e3e9b7a3cfb473e9c9c399841769c2", "https://hasporealty.com/en/properties/kvartira-3-1-azura-world-tyurkler-alanya-2/"],
  ["3+1", 140, 5, 445000, "EUR", "Haspo Realty", 4, "2026-07-27T14:50:12.413Z", "0ebc5163ce33418013872dc407cd89e53a4a510032d229e807638a281cf992de", "https://hasporealty.com/en/properties/kvartira-3-1-azura-world-tyurkler-alanya/"],
  ["2+1", 129, 1, 242000, "EUR", "Haspo Realty", 4, "2026-07-27T14:50:19.464Z", "1c177ce809aeaef28e889a4baf37c1ec88811d9dfa1f6a05f7485cfe2d70f528", "https://hasporealty.com/en/properties/kvartira-2-1-azura-world-tyurkler-alanya-3/"],
  ["2+1", 3, 1, 242000, "EUR", "Haspo Realty", 4, "2026-07-27T14:50:26.884Z", "a7076368533d52611e1761e82363db28f327a96785b3781b0092d3826415b5fa", "https://hasporealty.com/en/properties/kvartira-2-1-azura-world-tyurkler-alanya-2/"],
  ["1+1", 85, 5, 169000, "EUR", "Haspo Realty", 4, "2026-07-27T14:50:34.458Z", "447a468521939d0a1d299b73d5857ef19be5ea8368bb91bba4e55f1bc23d0b5c", "https://hasporealty.com/en/properties/kvartira-1-1-v-azura-world-residence-turkler-alaniya/"],
  ["1+1", 85, 4, 168000, "EUR", "Haspo Realty", 4, "2026-07-27T14:50:41.339Z", "2045ff0445450fc22450e454eb6dea60fd5d4bea1918d8b7995394057a974820", "https://hasporealty.com/en/properties/kvartira-1-1-azura-world-tyurkler-alanya/"],
  ["1+1", 85, 3, 161000, "EUR", "Haspo Realty", 4, "2026-07-27T14:50:48.387Z", "4508e8f607965b95fb24979b853b1b45b5609582e0234aa086f7f5e96bc240f8", "https://hasporealty.com/en/properties/prostornaya-kvartira-1-1-v-azura-world-residencetyurkler-alaniya/"],
  ["1+1", 85, 1, 161000, "EUR", "Haspo Realty", 4, "2026-07-27T14:50:55.666Z", "1d10e7250b148296cd08831d16f545bc10224fa34df4d04083bb521c9925993b", "https://hasporealty.com/en/properties/kvartira-1-1-azura-world-turkler-alanya/"],
  ["1+1", 85, 1, 137000, "EUR", "Haspo Realty", 4, "2026-07-27T14:51:02.462Z", "58fb9782990e193bc5c10c63d916e421a1e4cb11a5fa818bc6b064c91677ca51", "https://hasporealty.com/en/properties/kvartira-1-1-azura-world-tyurkler-alanya-2/"],
  ["2+1", 129, 2, 259000, "EUR", "Haspo Realty", 4, "2026-07-27T14:51:09.691Z", "b40085e944869531214a3f7e6b7e1c0d5f5f20bebc24f3afa0d5b3edbb2dc9b1", "https://hasporealty.com/en/properties/kvartira-2-1-azura-world-tyurkler-alanya/"],
  ["1+1", 85, 1, 178000, "EUR", "Haspo Realty", 4, "2026-07-27T14:51:15.913Z", "bfb2a415401cc62690628d03c6210af803768715dbe042140b7506cf28b466ef", "https://hasporealty.com/en/properties/kvartira-1-1-azura-world-turkler-alanya-2/"],
  ["2+1", 249, null, 390000, "EUR", "Haspo Realty", 4, "2026-07-27T14:51:22.365Z", "86ea5b16db16d93f79e8ad7a95946ae0fe5bdc6e898b5aa317f892b659a832e2", "https://hasporealty.com/en/properties/kvartira-2-1-xl-azura-world-residence-hotel/"],
  ["2+1", 105, null, 245000, "EUR", "Haspo Realty", 4, "2026-07-27T14:51:28.623Z", "38accc0b44dcf25c1092eaf6879dd4daa1d424c4021e6ee99f86529c6a11cb27", "https://hasporealty.com/en/properties/kvartira-2-1-azura-world-residence-hotel/"],
  ["1+1", 89, 2, 190000, "EUR", "Haspo Realty", 4, "2026-07-27T14:51:34.586Z", "443e0ec3156736fa6f674d772c10f700b60454d9480d78a3beaff62426d171cc", "https://hasporealty.com/en/properties/kvartira-1-1-azura-world-residence-hotel/"],
  ["1+1", 92, 5, 185000, "EUR", "Seaside Alanya", 4, "2026-07-27T14:47:31.915Z", "3d74064c8eb4e79bb1bcfbf5c5647aa8b1b49818f41820c6bf14ac3fff03a7f6", "https://www.seaside-alanya.com/de/antalya-alanya/residence/azura-world-residence"],
  ["1+1", 85, 3, 210000, "EUR", "Seaside Alanya", 4, "2026-07-27T14:47:31.915Z", "3d74064c8eb4e79bb1bcfbf5c5647aa8b1b49818f41820c6bf14ac3fff03a7f6", "https://www.seaside-alanya.com/de/antalya-alanya/residence/azura-world-residence"],
  ["2+1", 129, 4, 264000, "EUR", "Seaside Alanya", 4, "2026-07-27T14:47:31.915Z", "3d74064c8eb4e79bb1bcfbf5c5647aa8b1b49818f41820c6bf14ac3fff03a7f6", "https://www.seaside-alanya.com/de/antalya-alanya/residence/azura-world-residence"],
  ["2+1", 157, 2, 363000, "EUR", "Seaside Alanya", 4, "2026-07-27T14:47:31.915Z", "3d74064c8eb4e79bb1bcfbf5c5647aa8b1b49818f41820c6bf14ac3fff03a7f6", "https://www.seaside-alanya.com/de/antalya-alanya/residence/azura-world-residence"],
  ["3+1", 183, 0, 401000, "EUR", "Seaside Alanya", 4, "2026-07-27T14:47:31.915Z", "3d74064c8eb4e79bb1bcfbf5c5647aa8b1b49818f41820c6bf14ac3fff03a7f6", "https://www.seaside-alanya.com/de/antalya-alanya/residence/azura-world-residence"],
  ["2+1", 118, 0, 450000, "EUR", "Seaside Alanya", 4, "2026-07-27T14:47:31.915Z", "3d74064c8eb4e79bb1bcfbf5c5647aa8b1b49818f41820c6bf14ac3fff03a7f6", "https://www.seaside-alanya.com/de/antalya-alanya/residence/azura-world-residence"],
  ["4+1", 313, null, 650000, "EUR", "Seaside Alanya", 4, "2026-07-27T14:47:31.915Z", "3d74064c8eb4e79bb1bcfbf5c5647aa8b1b49818f41820c6bf14ac3fff03a7f6", "https://www.seaside-alanya.com/de/antalya-alanya/residence/azura-world-residence"],
  ["5+1", 361, null, 1200000, "EUR", "Seaside Alanya", 4, "2026-07-27T14:47:31.915Z", "3d74064c8eb4e79bb1bcfbf5c5647aa8b1b49818f41820c6bf14ac3fff03a7f6", "https://www.seaside-alanya.com/de/antalya-alanya/residence/azura-world-residence"],
] as readonly ListingAnchor[])

/**
 * Two further real citations, used only by `portal-data.ts` to give a unit more
 * than one competing price (the USD one is Housearch, which is exactly the
 * mixed-currency case CONVENTIONS §5 warns about). Order matches
 * `ListingAnchor` minus the layout/area/price prefix:
 *   publisher, tier, fetchedAt, snapshotHash, url
 */
export const SEED_EXTRA_SOURCES: ReadonlyArray<
  readonly [string, SourceTier, string, string, string]
> = Object.freeze([
  ["Housearch", 4, "2026-07-27T14:51:43.796Z", "8e93a3f9274d55fdfadbc42e66b4eaa2216b3fc1553d7a209ed211227affe2aa", "https://housearch.com/de/turkey/residential-complexes/azura-world-3403639/"],
  ["Capital Estate", 6, "2026-07-27T14:48:50.999Z", "461832b1eb58703503de109d9cfd65e842637f83686b3a035fc135b96b2a64dd", "https://www.cestate.net/building/AzuraWorld"],
] as ReadonlyArray<readonly [string, SourceTier, string, string, string]>)

/** A stable `sources.id` slug for a URL, matching the harvester's convention
 *  closely enough that seed rows and database rows are recognisably the same
 *  record. Only the id differs from the database's own slug; nothing reads it. */
function sourceSlug(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 76)
}

/** One seeded citation, already flattened the way the mapper flattens the
 *  `fact_sources → sources / source_snapshots` embeds. */
export type SeedCitation = {
  id: string
  url: string
  publisher: string
  tier: SourceTier
  fetchedAt: string
  snapshotHash: string
}

/**
 * The seed source register, keyed by URL. Derived from the anchors rather than
 * listed twice, so a citation cannot drift from the listing it supports.
 */
export function seedSourceRegister(): Map<string, SeedCitation> {
  const register = new Map<string, SeedCitation>()
  for (const anchor of SEED_LISTING_ANCHORS) {
    const [, , , , , publisher, tier, fetchedAt, snapshotHash, url] = anchor
    if (!register.has(url)) {
      register.set(url, {
        id: sourceSlug(url),
        url,
        publisher,
        tier,
        fetchedAt,
        snapshotHash,
      })
    }
  }
  for (const extra of SEED_EXTRA_SOURCES) {
    const [publisher, tier, fetchedAt, snapshotHash, url] = extra
    if (!register.has(url)) {
      register.set(url, {
        id: sourceSlug(url),
        url,
        publisher,
        tier,
        fetchedAt,
        snapshotHash,
      })
    }
  }
  return register
}

function citationOf(anchor: ListingAnchor): SeedCitation {
  const [, , , , , publisher, tier, fetchedAt, snapshotHash, url] = anchor
  return { id: sourceSlug(url), url, publisher, tier, fetchedAt, snapshotHash }
}

function factSourceRow(citation: SeedCitation): SeedFactSourceRow {
  return {
    snapshot_sha256: citation.snapshotHash,
    sources: {
      id: citation.id,
      url: citation.url,
      publisher: citation.publisher,
      tier: citation.tier,
    },
    source_snapshots: { fetched_at: citation.fetchedAt },
  }
}

// ---------------------------------------------------------------------------
// Modelled inventory — the rule, not a table of magic numbers
// ---------------------------------------------------------------------------

/** Layout cycle for modelled units, indexed by position in the modelled run.
 *  Reproduces `azura-world-data.ts`, which is why the seeded modelled prices
 *  match `supabase/seed.sql` to the euro. */
const MODELLED_LAYOUT_CYCLE: readonly UnitLayout[] = Object.freeze([
  "3+1",
  "1+1",
  "2+1",
  "4+1",
  "5+1",
])

/** The five layouts no source prices, sizes or places. They exist so every
 *  value of `public.unit_layout` is exercised end-to-end; their area, floor and
 *  price are all `null` and their facts are `"gap"`. */
const UNSOURCED_TAIL_LAYOUTS: readonly UnitLayout[] = Object.freeze([
  "6+1",
  "townhouse",
  "villa",
  "president_villa",
  "penthouse",
])

/** Observed area and €/m² per layout, computed from the anchors at call time
 *  so the basis can never drift from the citations. */
export type LayoutBasis = {
  layout: UnitLayout
  interiorM2: number
  pricePerM2: number
  amount: number
  currency: CurrencyCode
  sampleSize: number
  citations: SeedCitation[]
}

export function seedLayoutBasis(): Map<UnitLayout, LayoutBasis> {
  const grouped = new Map<
    UnitLayout,
    { areas: number[]; perM2: number[]; citations: SeedCitation[] }
  >()

  for (const anchor of SEED_LISTING_ANCHORS) {
    const [layout, interiorM2, , amount] = anchor
    const bucket = grouped.get(layout) ?? {
      areas: [],
      perM2: [],
      citations: [],
    }
    bucket.areas.push(interiorM2)
    bucket.perM2.push(amount / interiorM2)
    const citation = citationOf(anchor)
    if (!bucket.citations.some((entry) => entry.url === citation.url)) {
      bucket.citations.push(citation)
    }
    grouped.set(layout, bucket)
  }

  const basis = new Map<UnitLayout, LayoutBasis>()
  for (const [layout, bucket] of grouped) {
    const interiorM2 = median(bucket.areas)
    const pricePerM2 = median(bucket.perM2)
    if (interiorM2 === null || pricePerM2 === null) continue
    basis.set(layout, {
      layout,
      interiorM2,
      pricePerM2,
      amount: Math.round(pricePerM2 * interiorM2),
      currency: "EUR",
      sampleSize: bucket.areas.length,
      citations: bucket.citations,
    })
  }
  return basis
}

/** One generated unit, before it is split into a row and its facts. */
type PlannedUnit = {
  id: string
  blockCode: string
  sequence: number
  layout: UnitLayout
  interiorM2: number | null
  floorLevel: number | null
  amount: number | null
  currency: CurrencyCode | null
  saleStatus: SaleStatus
  dataQuality: UnitDataQuality
  anchor: ListingAnchor | null
  basis: LayoutBasis | null
}

/**
 * The single generator both `seedUnitRows()` and `seedUnitFactRows()` read, so
 * a unit's row and its provenance can never disagree about the same number.
 */
function planUnits(): PlannedUnit[] {
  const basis = seedLayoutBasis()
  const planned: PlannedUnit[] = []
  const tailStart = 656 - UNSOURCED_TAIL_LAYOUTS.length
  let globalIndex = 0

  for (const [blockCode, unitCount] of SEED_BLOCK_UNIT_COUNTS) {
    for (let sequence = 1; sequence <= unitCount; sequence += 1) {
      const id = `AZW-${blockCode}-${String(sequence).padStart(4, "0")}`
      const anchor = SEED_LISTING_ANCHORS[globalIndex]

      if (globalIndex < SEED_LISTING_ANCHORS.length && anchor !== undefined) {
        const [layout, interiorM2, floorLevel, amount, currency] = anchor
        planned.push({
          id,
          blockCode,
          sequence,
          layout,
          interiorM2,
          floorLevel,
          amount,
          currency,
          saleStatus: "available",
          dataQuality: "portal_listing",
          anchor,
          basis: null,
        })
        globalIndex += 1
        continue
      }

      const tailOffset = globalIndex - tailStart
      const tailLayout =
        tailOffset >= 0 ? UNSOURCED_TAIL_LAYOUTS[tailOffset] : undefined

      if (tailLayout !== undefined) {
        planned.push({
          id,
          blockCode,
          sequence,
          layout: tailLayout,
          interiorM2: null,
          floorLevel: null,
          amount: null,
          currency: null,
          saleStatus: "unknown",
          dataQuality: "modelled",
          anchor: null,
          basis: null,
        })
        globalIndex += 1
        continue
      }

      const modelledIndex = globalIndex - SEED_LISTING_ANCHORS.length
      const layout =
        MODELLED_LAYOUT_CYCLE[modelledIndex % MODELLED_LAYOUT_CYCLE.length] ??
        "1+1"
      const layoutBasis = basis.get(layout) ?? null
      planned.push({
        id,
        blockCode,
        sequence,
        layout,
        interiorM2: layoutBasis?.interiorM2 ?? null,
        floorLevel: (sequence - 1) % SEED_FLOORS_PER_BUILDING,
        amount: layoutBasis?.amount ?? null,
        currency: layoutBasis === null ? null : layoutBasis.currency,
        saleStatus: "unknown",
        dataQuality: "modelled",
        anchor: null,
        basis: layoutBasis,
      })
      globalIndex += 1
    }
  }

  return planned
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export function seedCompanyRow(): SeedCompanyRow {
  return {
    id: SEED_COMPANY_ID,
    slug: "cebeci-group",
    name: "Cebeci Group",
    legal_name: "Cebeci Group A.Ş.",
    country: "Türkiye",
    default_currency: "EUR",
    founded_year: 1982,
    website: "https://www.cebecigroup.com/",
    created_at: seedIso(-30),
    updated_at: seedIso(0),
  }
}

export function seedSiteRow(): SeedSiteRow {
  return {
    id: SEED_SITE_ID,
    company_id: SEED_COMPANY_ID,
    code: SEED_SITE_CODE,
    name: "Azura World Residence & Hotel",
    country: "Türkiye",
    province: "Antalya",
    city: "Alanya",
    district: "Türkler",
    plot_area_sqm: numericString(76000),
    green_area_sqm: numericString(20000),
    building_footprint_sqm: numericString(15000),
    outdoor_facility_area_sqm: numericString(41000),
    residence_block_count: 7,
    building_count: 14,
    floors_per_building: SEED_FLOORS_PER_BUILDING,
    total_units: 656,
    construction_start: "2022-01-30",
    completion_date: "2024-05-30",
    build_status: "completed",
    distance_to_sea_m: 300,
    distance_to_alanya_centre_km: numericString(15),
    distance_to_gazipasa_airport_km: numericString(60),
    distance_to_antalya_airport_km: numericString(100),
    down_payment_percent: numericString(30),
    // No source states coordinates. CONTRACTS §1 invariant 1: an unestablished
    // figure is null, never a plausible-looking pin dropped on Türkler.
    latitude: null,
    longitude: null,
    contact_phone: "+90 242 528 70 70",
    contact_email: "info@cebecigroup.com",
    contact_address:
      "Şekerhane Mah. Yayla Yolu Cad. Cebeci İs Merkezi No:22/1 07400 Alanya / Turkey",
    created_at: seedIso(-30),
    updated_at: seedIso(0),
  }
}

export function seedBlockRows(): SeedBlockRow[] {
  return SEED_BLOCK_UNIT_COUNTS.map(([code, unitCount], index) => ({
    id: seedBlockId(code),
    site_id: SEED_SITE_ID,
    code,
    name: `Block ${code.slice(1)}`,
    floors: SEED_FLOORS_PER_BUILDING,
    unit_count: unitCount,
    sort_order: index,
    created_at: seedIso(-30),
    updated_at: seedIso(0),
  }))
}

/**
 * Six floors per block. `supabase/seed.sql` populates no `site_floors` rows at
 * all, so this is the one table where seed mode is richer than the database —
 * `getFloors()` legitimately returns an empty array against a seeded Supabase,
 * and that is a fact about the database, not a failure.
 */
export function seedFloorRows(): SeedFloorRow[] {
  const rows: SeedFloorRow[] = []
  const perFloor = new Map<string, Map<number, number>>()

  for (const unit of planUnits()) {
    if (unit.floorLevel === null) continue
    const block = perFloor.get(unit.blockCode) ?? new Map<number, number>()
    block.set(unit.floorLevel, (block.get(unit.floorLevel) ?? 0) + 1)
    perFloor.set(unit.blockCode, block)
  }

  for (const [blockCode] of SEED_BLOCK_UNIT_COUNTS) {
    for (let level = 0; level < SEED_FLOORS_PER_BUILDING; level += 1) {
      rows.push({
        id: seedFloorId(blockCode, level),
        block_id: seedBlockId(blockCode),
        level,
        label: level === 0 ? "Ground" : `Floor ${level}`,
        unit_count: perFloor.get(blockCode)?.get(level) ?? 0,
        created_at: seedIso(-30),
      })
    }
  }

  return rows
}

export function seedUnitRows(): SeedUnitRow[] {
  const blockNames = new Map(
    seedBlockRows().map((block) => [block.code, block.name])
  )

  return planUnits().map((unit) => ({
    id: unit.id,
    company_id: SEED_COMPANY_ID,
    site_id: SEED_SITE_ID,
    block_id: seedBlockId(unit.blockCode),
    floor_id:
      unit.floorLevel === null
        ? null
        : seedFloorId(unit.blockCode, unit.floorLevel),
    block_code: unit.blockCode,
    // `seed.sql` writes the bare sequence as unit_no; mirrored so the two
    // sources describe the same unit rather than two similar ones.
    unit_no: String(unit.sequence),
    sequence: unit.sequence,
    layout: unit.layout,
    interior_m2:
      unit.interiorM2 === null ? null : numericString(unit.interiorM2),
    outdoor_m2: null,
    floor_level: unit.floorLevel,
    asking_price_amount: unit.amount === null ? null : numericString(unit.amount),
    asking_price_currency: unit.currency,
    sale_status: unit.saleStatus,
    data_quality: unit.dataQuality,
    // A modelled unit is never in the public catalogue: CONTRACTS §2 says it is
    // "NEVER presented as a real listing", and `is_publicly_listed` is what anon
    // and guest are filtered by.
    //
    // DO NOT additionally withhold the units held by seeded residents. That
    // change was proposed once, on the claim that `supabase/seed.sql` withholds
    // AZW-B01-0001/0002/0003 — it does not. All 25 `portal_listing` rows in
    // `seed.sql` carry `is_publicly_listed = true`, verified 2026-07-27, and
    // adding the exclusion here is what would make seed mode and the database
    // disagree about what a guest sees. Ownership is not privacy: migration 02
    // says "anon and guest can read only rows where this is true; owner/tenant
    // reach their own units regardless", so a listed unit that somebody owns is
    // still in the sales catalogue.
    is_publicly_listed: unit.dataQuality === "portal_listing",
    version: 1,
    created_at: seedIso(-30),
    updated_at: seedIso(0),
    site_blocks: {
      code: unit.blockCode,
      name: blockNames.get(unit.blockCode) ?? null,
    },
  }))
}

/**
 * `sourced_facts` rows for `unit.askingPrice` and `unit.saleStatus`, in the
 * embed shape `inventory-repository` selects.
 *
 * Pass `unitIds` to build only the facts a page needs; the output is
 * deterministic either way, and the filter exists because a 50-unit page has no
 * reason to materialise 1 312 fact rows.
 */
export function seedUnitFactRows(
  unitIds?: readonly string[]
): SeedSourcedFactRow[] {
  const wanted = unitIds === undefined ? null : new Set(unitIds)
  const rows: SeedSourcedFactRow[] = []
  let ordinal = 0

  for (const unit of planUnits()) {
    ordinal += 1
    if (wanted !== null && !wanted.has(unit.id)) continue

    const factId = (offset: number): string =>
      `c0000000-0000-4000-8000-${String(ordinal * 2 + offset).padStart(12, "0")}`

    if (unit.anchor !== null && unit.amount !== null && unit.currency !== null) {
      const citation = citationOf(unit.anchor)
      // Built from the checked pair, never from `amount ?? 0`: CONVENTIONS §5,
      // a price of 0 is a bug and a price of null is an honest gap.
      const money: Money = { amount: unit.amount, currency: unit.currency }
      rows.push({
        id: factId(0),
        entity_type: "unit",
        entity_id: unit.id,
        field_path: "unit.askingPrice",
        value: money,
        confidence: "single_source",
        note: `Price and interior area as published by ${citation.publisher} at ${citation.url}. The unit's position within the project is not stated by any source; the id is an internal addressing key, not a developer unit number.`,
        fact_sources: [factSourceRow(citation)],
        fact_conflicts: [],
      })
      rows.push({
        id: factId(1),
        entity_type: "unit",
        entity_id: unit.id,
        field_path: "unit.saleStatus",
        value: "available",
        confidence: "single_source",
        note: "A live listing implies availability; no source states unit-level sale status.",
        fact_sources: [factSourceRow(citation)],
        fact_conflicts: [],
      })
      continue
    }

    if (unit.basis !== null && unit.amount !== null && unit.currency !== null) {
      const basis = unit.basis
      rows.push({
        id: factId(0),
        entity_type: "unit",
        entity_id: unit.id,
        field_path: "unit.askingPrice",
        value: { amount: unit.amount, currency: unit.currency },
        confidence: "inferred",
        note: `MODELLED, NOT A LISTING. No source publishes a unit-by-unit inventory for this project; 656 total units is corroborated but the per-block breakdown is not. Price = median observed €/m² for layout ${basis.layout} (${Math.round(basis.pricePerM2)} €/m², n=${basis.sampleSize}) × median observed interior area (${basis.interiorM2} m²). The €/m² basis is itself disputed across portals, so this figure inherits that uncertainty and must never be shown as an asking price.`,
        fact_sources: basis.citations.map(factSourceRow),
        fact_conflicts: [],
      })
    } else {
      rows.push({
        id: factId(0),
        entity_type: "unit",
        entity_id: unit.id,
        field_path: "unit.askingPrice",
        value: null,
        confidence: "gap",
        note: `No source publishes a price or an interior area for layout ${unit.layout} at this project. The unit exists only to complete the modelled 656-unit inventory.`,
        fact_sources: [],
        fact_conflicts: [],
      })
    }

    rows.push({
      id: factId(1),
      entity_type: "unit",
      entity_id: unit.id,
      field_path: "unit.saleStatus",
      value: null,
      confidence: "gap",
      note: "No source publishes unit-level availability for this project.",
      fact_sources: [],
      fact_conflicts: [],
    })
  }

  return rows
}

// ---------------------------------------------------------------------------
// Residents — the data role scoping is tested against
// ---------------------------------------------------------------------------

export function seedResidentRows(): SeedResidentRow[] {
  return [
    {
      id: SEED_RESIDENT_IDS.ownerOne,
      company_id: SEED_COMPANY_ID,
      profile_id: SEED_PROFILE_IDS.ownerOne,
      full_name: "Owner One",
      email: "owner@azura.local",
      phone: null,
      nationality: null,
      locale: "de",
      kind: "individual",
      created_at: seedIso(-365),
      updated_at: seedIso(0),
    },
    {
      id: SEED_RESIDENT_IDS.ownerTwo,
      company_id: SEED_COMPANY_ID,
      // No profile: an owner of record who has never signed in. Scoping must
      // resolve this to "no units", not to "all units".
      profile_id: null,
      full_name: "Owner Two",
      email: "owner2@azura.local",
      phone: null,
      nationality: null,
      locale: "en",
      kind: "individual",
      created_at: seedIso(-300),
      updated_at: seedIso(0),
    },
    {
      id: SEED_RESIDENT_IDS.tenantOne,
      company_id: SEED_COMPANY_ID,
      profile_id: SEED_PROFILE_IDS.tenantOne,
      full_name: "Tenant One",
      email: "tenant@azura.local",
      phone: null,
      nationality: null,
      locale: "tr",
      kind: "individual",
      created_at: seedIso(-120),
      updated_at: seedIso(0),
    },
  ]
}

/**
 * Holdings. Owner One's second unit is deliberately **not** primary: it is what
 * makes `child_owner ⊊ owner` observable, because the repository narrows a
 * `child_*` role to its guardian's primary holdings.
 *
 * `AZW-B01-0003` carries an ended tenancy so the "expired edge" path is covered
 * — an end date in the past must not grant access.
 */
export function seedUnitResidentRows(): SeedUnitResidentRow[] {
  return [
    {
      id: "e0000000-0000-4000-8000-000000000001",
      unit_id: "AZW-B01-0001",
      resident_id: SEED_RESIDENT_IDS.ownerOne,
      relation: "owner",
      share_percent: numericString(100),
      start_date: seedIso(-365).slice(0, 10),
      end_date: null,
      is_primary: true,
      created_at: seedIso(-365),
      residents: { profile_id: SEED_PROFILE_IDS.ownerOne },
    },
    {
      id: "e0000000-0000-4000-8000-000000000004",
      unit_id: "AZW-B01-0005",
      resident_id: SEED_RESIDENT_IDS.ownerOne,
      relation: "owner",
      share_percent: numericString(50),
      start_date: seedIso(-200).slice(0, 10),
      end_date: null,
      is_primary: false,
      created_at: seedIso(-200),
      residents: { profile_id: SEED_PROFILE_IDS.ownerOne },
    },
    {
      id: "e0000000-0000-4000-8000-000000000002",
      unit_id: "AZW-B01-0002",
      resident_id: SEED_RESIDENT_IDS.ownerTwo,
      relation: "owner",
      share_percent: numericString(100),
      start_date: seedIso(-300).slice(0, 10),
      end_date: null,
      is_primary: true,
      created_at: seedIso(-300),
      residents: { profile_id: null },
    },
    {
      id: "e0000000-0000-4000-8000-000000000003",
      unit_id: "AZW-B01-0003",
      resident_id: SEED_RESIDENT_IDS.tenantOne,
      relation: "tenant",
      share_percent: null,
      start_date: seedIso(-120).slice(0, 10),
      end_date: null,
      is_primary: true,
      created_at: seedIso(-120),
      residents: { profile_id: SEED_PROFILE_IDS.tenantOne },
    },
    {
      id: "e0000000-0000-4000-8000-000000000005",
      unit_id: "AZW-B01-0004",
      resident_id: SEED_RESIDENT_IDS.tenantOne,
      relation: "tenant",
      share_percent: null,
      start_date: seedIso(-400).slice(0, 10),
      // Ended. The tenancy is history, not access.
      end_date: seedIso(-40).slice(0, 10),
      is_primary: false,
      created_at: seedIso(-400),
      residents: { profile_id: SEED_PROFILE_IDS.tenantOne },
    },
  ]
}

export function seedGuardianshipRows(): SeedGuardianshipRow[] {
  return [
    {
      id: "f0000000-0000-4000-8000-000000000001",
      guardian_profile_id: SEED_PROFILE_IDS.ownerOne,
      child_profile_id: SEED_PROFILE_IDS.childOwner,
      relation: "guardian",
      status: "active",
      consent_recorded_at: seedIso(-180),
      revoked_at: null,
      created_at: seedIso(-180),
    },
    {
      id: "f0000000-0000-4000-8000-000000000002",
      guardian_profile_id: SEED_PROFILE_IDS.tenantOne,
      child_profile_id: SEED_PROFILE_IDS.childTenant,
      relation: "guardian",
      status: "active",
      consent_recorded_at: seedIso(-90),
      revoked_at: null,
      created_at: seedIso(-90),
    },
  ]
}
