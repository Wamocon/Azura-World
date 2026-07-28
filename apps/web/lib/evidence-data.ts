/**
 * # Evidence seed — the provenance store without a database
 *
 * Owned by **W2-A**. Consumed only by `lib/evidence-repository.ts`, which
 * serves it when `isSupabaseConfigured()` is false and labels the result
 * `source: "local-seed"` (CONTRACTS §4).
 *
 * ## What this is, and what it is not
 *
 * This is a **representative slice**, not the dataset. The real evidence store
 * is 56 sources, 55 snapshots, 1354 sourced facts and 24 findings; it lives in
 * `supabase/seed.sql` (W1-A) and `apps/web/lib/azura-world-data.ts` (W0-B).
 * What is here is 11 sources across 11 distinct hosts and all six tiers, 10
 * findings including two `critical`, and 10 facts covering **every** value of
 * `Confidence` — so a demo running without Postgres still exercises every
 * provenance path the UI has to render, including the ugly ones.
 *
 * Every value below is copied from the real harvest. Nothing is invented:
 * SYSTEM-PROMPT §2.3 forbids a plausible-looking made-up figure more strongly
 * than it forbids a missing one, and a seed is exactly where a fabricated
 * number would be least likely to be noticed.
 *
 * ## Determinism
 *
 * No `Math.random()`, no `Date.now()`, no `new Date()`. The timestamps are
 * literal ISO strings recorded by the 2026-07-27 harvest — they are
 * *observations*, so deriving them from `seedIso()` would replace a fact with
 * an arithmetic result. `seedIso()` is used only for the synthetic search
 * projection at the bottom of the file, which has no observed time.
 *
 * Every exported builder returns a **fresh deep copy**, so a caller that
 * mutates a returned array cannot poison the next call. That matters more than
 * it looks: two Playwright runs against a mutated seed diverge silently.
 *
 * ## The invariants are enforced here, not assumed
 *
 * `seedFactEntries()` runs `assertFactInvariants()` over every fact before
 * returning it. The data is static, so this either always passes or always
 * fails — it cannot become a runtime surprise, and it makes a contract
 * violation impossible to introduce by editing this file carelessly.
 */

import {
  assertFactInvariants,
  type Finding,
  type SourceRef,
  type SourceTier,
  type SourcedFact,
} from "@/lib/contracts"
import { seedIso } from "@/lib/repository-base"

// ---------------------------------------------------------------------------
// Row shapes — deliberately the SHAPE OF THE TABLES, not of the contract
//
// `public.sources` has no fetchedAt and no snapshotHash; those live on
// `public.source_snapshots`, one row per harvest attempt. A `SourceRef` is a
// JOIN of the two. Modelling the seed as the contract type instead would hide
// the join, and with it the whole of `getSourceHealth()` — a source that was
// never fetched has no snapshot at all, and that absence is the finding.
// ---------------------------------------------------------------------------

/** `public.sources.kind` — the eight values the CHECK constraint allows. */
export const SOURCE_KINDS = [
  "official",
  "developer",
  "hotel",
  "portal",
  "review",
  "booking",
  "press",
  "social",
] as const

/** One of the eight `public.sources.kind` values. */
export type SourceKind = (typeof SOURCE_KINDS)[number]

/** One row of `public.source_snapshots`: one harvest attempt against one URL. */
export interface SeedSnapshot {
  /** ISO 8601. When the harvester actually retrieved this. */
  fetchedAt: string
  /** HTTP status as text, or a transport label: "robots_disallowed", "expect_missing". */
  httpStatus: string
  snapshotPath: string | null
  /** sha256, lower-case hex. `null` when nothing was stored. */
  snapshotSha256: string | null
  bytes: number
  /** CONVENTIONS §5: validate the BYTES, not the status line. */
  contentValidated: boolean
}

/** One row of `public.sources`, with the snapshots that belong to it. */
export interface SeedSourceRecord {
  id: string
  publisher: string
  tier: SourceTier
  url: string
  /** Registrable host. Invariant 3 counts DISTINCT HOSTS on this column. */
  host: string
  kind: SourceKind
  /** Ordered oldest → newest. Empty means the source was never fetched. */
  snapshots: SeedSnapshot[]
}

/** One row of `public.sourced_facts` plus its children, keyed for lookup. */
export interface SeedFactEntry {
  entityType: string
  entityId: string
  /** Dotted CONTRACTS path, e.g. "project.residenceBlockCount". */
  fieldPath: string
  fact: SourcedFact<unknown>
}

/** One row of `public.operational_search_documents`. */
export interface SeedSearchDocument {
  entityTable: string
  entityId: string
  title: string
  summary: string | null
  language: "de" | "en" | "tr" | "ru"
  /** Authority floor. The RPC compares this to the caller's role level. */
  minRoleLevel: number
  metadata: Record<string, unknown>
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Sources
//
// Eleven sources, eleven distinct hosts, all six tiers, and all three
// reachability states:
//
//   validated          9 — content fetched and the bytes checked
//   fetched, unvalidated 1 — booking.com returned a 3.7 KB anti-bot body
//   never fetched      1 — facebook.com publishes `Disallow: /` (F-015)
//
// The last two exist so the evidence cockpit is never demoed against a
// suspiciously healthy dataset. "We were not allowed to look" and "we looked
// and found nothing" are different claims and the seed must be able to say
// both.
// ---------------------------------------------------------------------------

const SOURCE_RECORDS: SeedSourceRecord[] = [
  {
    id: "azuraworld-com",
    publisher: "Azura World",
    tier: 1,
    url: "https://www.azuraworld.com/",
    host: "azuraworld.com",
    kind: "official",
    snapshots: [
      {
        fetchedAt: "2026-07-27T14:46:43.214Z",
        httpStatus: "200",
        snapshotPath:
          "sources/raw/azuraworld.com/2026-07-27T14-46-42Z__azuraworld-official.html",
        snapshotSha256:
          "ca28fe4952729f846a1a080e1fc134ae18d787f2091f8cdc9e42c00ce79f04ab",
        bytes: 41932,
        contentValidated: true,
      },
    ],
  },
  {
    id: "cebecigroup-com-en-projects",
    publisher: "Cebeci Group",
    tier: 2,
    url: "https://www.cebecigroup.com/en/projects",
    host: "cebecigroup.com",
    kind: "developer",
    snapshots: [
      {
        fetchedAt: "2026-07-27T14:47:18.081Z",
        httpStatus: "200",
        snapshotPath:
          "sources/raw/cebecigroup.com/2026-07-27T14-47-17Z__cebecigroup-index.html",
        snapshotSha256:
          "21b88be518266cdd79724b0424a30982000445ea4d694a38cc5f9a28fc61c08f",
        bytes: 66894,
        contentValidated: true,
      },
    ],
  },
  {
    // F-015: robots.txt publishes `Disallow: /` for all agents. Not fetched,
    // deliberately. Zero snapshots is the honest record of that — it is why
    // `getSourceHealth()` reports "never_fetched" rather than a failed status.
    id: "facebook-com-cebecigroup",
    publisher: "Facebook — Cebeci Group",
    tier: 2,
    url: "https://www.facebook.com/cebecigroup",
    host: "facebook.com",
    kind: "developer",
    snapshots: [],
  },
  {
    id: "azuraworldhotel-com-en",
    publisher: "Azura World Hotel",
    tier: 3,
    url: "https://azuraworldhotel.com/en",
    host: "azuraworldhotel.com",
    kind: "hotel",
    snapshots: [
      {
        fetchedAt: "2026-07-27T14:46:54.389Z",
        httpStatus: "200",
        snapshotPath:
          "sources/raw/azuraworldhotel.com/2026-07-27T14-46-51Z__azuraworldhotel.html",
        snapshotSha256:
          "72d182be2fb412a648fba5085d267c84d43f4fc0e2c960b0802aa21942812040",
        bytes: 336781,
        contentValidated: true,
      },
    ],
  },
  {
    id: "seaside-alanya-com-de-antalya-alanya-residence-azura-world-residence",
    publisher: "Seaside Alanya",
    tier: 4,
    url: "https://www.seaside-alanya.com/de/antalya-alanya/residence/azura-world-residence",
    host: "seaside-alanya.com",
    kind: "portal",
    snapshots: [
      {
        fetchedAt: "2026-07-27T14:47:31.915Z",
        httpStatus: "200",
        snapshotPath:
          "sources/raw/seaside-alanya.com/2026-07-27T14-47-31Z__seaside-alanya.html",
        snapshotSha256:
          "3d74064c8eb4e79bb1bcfbf5c5647aa8b1b49818f41820c6bf14ac3fff03a7f6",
        bytes: 65796,
        contentValidated: true,
      },
    ],
  },
  {
    id: "hasporealty-com-de-complex-azura-world",
    publisher: "Haspo Realty",
    tier: 4,
    url: "https://hasporealty.com/de/complex/azura-world/",
    host: "hasporealty.com",
    kind: "portal",
    snapshots: [
      {
        fetchedAt: "2026-07-27T14:47:23.370Z",
        httpStatus: "200",
        snapshotPath:
          "sources/raw/hasporealty.com/2026-07-27T14-47-22Z__hasporealty.html",
        snapshotSha256:
          "23bb2b7bc3451f75ca0191786c58ae0805781e41d3dcfb44b2ae13b4a940f694",
        bytes: 186846,
        contentValidated: true,
      },
    ],
  },
  {
    // Two snapshots of one source: the overview page and a later unit page.
    // `getSources()` must cite the LATEST; `getFactsForEntity()` must cite the
    // exact snapshot the fact was read from. Those are different rows, and a
    // seed with one snapshot per source would never catch a mapper that
    // conflates them.
    id: "housearch-com-de-turkey-residential-complexes-azura-world-3403639",
    publisher: "Housearch",
    tier: 4,
    url: "https://housearch.com/de/turkey/residential-complexes/azura-world-3403639/",
    host: "housearch.com",
    kind: "portal",
    snapshots: [
      {
        fetchedAt: "2026-07-27T14:47:21.849Z",
        httpStatus: "200",
        snapshotPath:
          "sources/raw/housearch.com/2026-07-27T14-47-20Z__housearch.html",
        snapshotSha256:
          "643c8293224695449ccbdd26f25bb41fb8d4fe7154f61e37cabcbd765e01bb1e",
        bytes: 419823,
        contentValidated: true,
      },
      {
        fetchedAt: "2026-07-27T14:51:43.796Z",
        httpStatus: "200",
        snapshotPath:
          "sources/raw/housearch.com/2026-07-27T14-51-43Z__housearch-units-02.html",
        snapshotSha256:
          "8e93a3f9274d55fdfadbc42e66b4eaa2216b3fc1553d7a209ed211227affe2aa",
        bytes: 419754,
        contentValidated: true,
      },
    ],
  },
  {
    id: "tripadvisor-com-hotel-review-g1069655-d33144231-reviews-azura-world-hotel-tu",
    publisher: "Tripadvisor",
    tier: 5,
    url: "https://www.tripadvisor.com/Hotel_Review-g1069655-d33144231-Reviews-Azura_World_Hotel-Turkler_Alanya_Turkish_Mediterranean_Coast.html",
    host: "tripadvisor.com",
    kind: "review",
    snapshots: [
      {
        fetchedAt: "2026-07-27T14:47:49.207Z",
        httpStatus: "200",
        snapshotPath:
          "sources/raw/tripadvisor.com/2026-07-27T14-47-44Z__tripadvisor.html",
        snapshotSha256:
          "b0a8ff3e5ef1a37c2031f8c12dda59b9c001b2e4054e1e3090eed73f52803bc1",
        bytes: 1000843,
        contentValidated: true,
      },
    ],
  },
  {
    // F-014: this is the ticket's Booking.com URL and it is a DIFFERENT
    // property. Retained as evidence for that finding and for nothing else —
    // it contributes no hotel facts. The body came back 3.7 KB of anti-bot
    // interstitial, so `contentValidated` is false: a 200 that carries a bot
    // wall is not a fetch.
    id: "booking-com-hotel-tr-azura-world-html",
    publisher: "Booking.com",
    tier: 5,
    url: "https://www.booking.com/hotel/tr/azura-world.html",
    host: "booking.com",
    kind: "review",
    snapshots: [
      {
        fetchedAt: "2026-07-27T14:49:19.312Z",
        httpStatus: "expect_missing",
        snapshotPath:
          "sources/raw/booking.com/2026-07-27T14-49-19Z__booking-ticket-url.html",
        snapshotSha256:
          "8e8915b31b55bff4e44971243ba6bae38a6a6ebea8434f54ab6d2f2a755d09a4",
        bytes: 3782,
        contentValidated: false,
      },
    ],
  },
  {
    id: "enspride-com-property-azura-world-residence-hotel-a-new-iconic-lifestyle-",
    publisher: "ENS Pride",
    tier: 6,
    url: "https://enspride.com/property/azura-world-residence-hotel-a-new-iconic-lifestyle-concept-in-alanya/",
    host: "enspride.com",
    kind: "press",
    snapshots: [
      {
        fetchedAt: "2026-07-27T14:48:12.142Z",
        httpStatus: "200",
        snapshotPath:
          "sources/raw/enspride.com/2026-07-27T14-48-08Z__enspride.html",
        snapshotSha256:
          "36e5a6844ac2ff181c400a3898b677f7985474167a43ac82c2885c2cff4fce0c",
        bytes: 309669,
        contentValidated: true,
      },
    ],
  },
  {
    id: "cestate-net-building-azuraworld",
    publisher: "Capital Estate",
    tier: 6,
    url: "https://www.cestate.net/building/AzuraWorld",
    host: "cestate.net",
    kind: "press",
    snapshots: [
      {
        fetchedAt: "2026-07-27T14:48:50.999Z",
        httpStatus: "200",
        snapshotPath:
          "sources/raw/cestate.net/2026-07-27T14-48-50Z__cestate.html",
        snapshotSha256:
          "461832b1eb58703503de109d9cfd65e842637f83686b3a035fc135b96b2a64dd",
        bytes: 72709,
        contentValidated: true,
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// SourceRef construction
// ---------------------------------------------------------------------------

function recordById(id: string): SeedSourceRecord {
  const found = SOURCE_RECORDS.find((record) => record.id === id)
  if (found === undefined) {
    // A citation naming a source that is not in the register is a broken
    // citation, and a broken citation in a seed would ship as a broken
    // citation in the UI. Fail at module load instead.
    throw new Error(
      `evidence-data: no seed source with id "${id}". Every citation must name a source in SOURCE_RECORDS.`
    )
  }
  return found
}

/**
 * The `SourceRef` for a specific stored snapshot of a source.
 *
 * The snapshot hash is passed explicitly rather than defaulted to "the latest",
 * because a fact cites the bytes it was actually read from. Housearch has two
 * snapshots four minutes apart; silently citing the newer one would attach a
 * fact to a page that may not contain it.
 */
function refAtSnapshot(sourceId: string, snapshotSha256: string): SourceRef {
  const record = recordById(sourceId)
  const snapshot = record.snapshots.find(
    (candidate) => candidate.snapshotSha256 === snapshotSha256
  )
  if (snapshot === undefined) {
    throw new Error(
      `evidence-data: source "${sourceId}" has no snapshot ${snapshotSha256}.`
    )
  }
  return {
    url: record.url,
    publisher: record.publisher,
    fetchedAt: snapshot.fetchedAt,
    snapshotHash: snapshotSha256,
    tier: record.tier,
  }
}

/** Newest snapshot of a source, or `null` when it was never fetched. */
function latestSnapshot(record: SeedSourceRecord): SeedSnapshot | null {
  let latest: SeedSnapshot | null = null
  for (const snapshot of record.snapshots) {
    if (latest === null || snapshot.fetchedAt > latest.fetchedAt) latest = snapshot
  }
  return latest
}

/**
 * The `SourceRef` for the source register itself — the newest snapshot.
 *
 * A source that was never fetched carries `fetchedAt: ""` and
 * `snapshotHash: ""`. That is a deliberate signal and not a default: there is
 * no retrieval time to state and no bytes to point at, and inventing either
 * would produce a citation that cannot be re-opened. Such a ref must never be
 * attached to a `SourcedFact` — it would fail invariant 6 — and it never is:
 * `getSourceHealth()` is the only surface that reports it, as "never_fetched".
 */
function registerRef(record: SeedSourceRecord): SourceRef {
  const snapshot = latestSnapshot(record)
  return {
    url: record.url,
    publisher: record.publisher,
    fetchedAt: snapshot?.fetchedAt ?? "",
    snapshotHash: snapshot?.snapshotSha256 ?? "",
    tier: record.tier,
  }
}

// Shorthands used by the findings and facts below. Each names one source and
// one snapshot, so every citation in this file resolves to stored bytes.
const AZURAWORLD = refAtSnapshot(
  "azuraworld-com",
  "ca28fe4952729f846a1a080e1fc134ae18d787f2091f8cdc9e42c00ce79f04ab"
)
const CEBECIGROUP = refAtSnapshot(
  "cebecigroup-com-en-projects",
  "21b88be518266cdd79724b0424a30982000445ea4d694a38cc5f9a28fc61c08f"
)
const AZURAWORLDHOTEL = refAtSnapshot(
  "azuraworldhotel-com-en",
  "72d182be2fb412a648fba5085d267c84d43f4fc0e2c960b0802aa21942812040"
)
const SEASIDE = refAtSnapshot(
  "seaside-alanya-com-de-antalya-alanya-residence-azura-world-residence",
  "3d74064c8eb4e79bb1bcfbf5c5647aa8b1b49818f41820c6bf14ac3fff03a7f6"
)
const HASPO = refAtSnapshot(
  "hasporealty-com-de-complex-azura-world",
  "23bb2b7bc3451f75ca0191786c58ae0805781e41d3dcfb44b2ae13b4a940f694"
)
const HOUSEARCH = refAtSnapshot(
  "housearch-com-de-turkey-residential-complexes-azura-world-3403639",
  "643c8293224695449ccbdd26f25bb41fb8d4fe7154f61e37cabcbd765e01bb1e"
)
const TRIPADVISOR = refAtSnapshot(
  "tripadvisor-com-hotel-review-g1069655-d33144231-reviews-azura-world-hotel-tu",
  "b0a8ff3e5ef1a37c2031f8c12dda59b9c001b2e4054e1e3090eed73f52803bc1"
)
const BOOKING = refAtSnapshot(
  "booking-com-hotel-tr-azura-world-html",
  "8e8915b31b55bff4e44971243ba6bae38a6a6ebea8434f54ab6d2f2a755d09a4"
)
const ENSPRIDE = refAtSnapshot(
  "enspride-com-property-azura-world-residence-hotel-a-new-iconic-lifestyle-",
  "36e5a6844ac2ff181c400a3898b677f7985474167a43ac82c2885c2cff4fce0c"
)
const CESTATE = refAtSnapshot(
  "cestate-net-building-azuraworld",
  "461832b1eb58703503de109d9cfd65e842637f83686b3a035fc135b96b2a64dd"
)

// ---------------------------------------------------------------------------
// Findings
//
// Ten of the real register's twenty-four, chosen to cover every severity and
// six of the seven areas, and condensed from the full text in
// `supabase/seed.sql`. Two are `critical`, and both of them are unresolved —
// which is the point. A findings list where everything is resolved is a
// findings list nobody read.
//
// `competingValues` is empty on the findings that record a *defect* rather
// than a disagreement (F-011, F-014). An empty array there is accurate; a
// fabricated pair of values to make the row look richer would not be.
// ---------------------------------------------------------------------------

const FINDINGS: Finding[] = [
  {
    id: "F-001",
    severity: "high",
    area: "structure",
    field: "project.residenceBlockCount",
    message:
      "Block structure was reported three ways: 7 residence blocks (Seaside, ENS Pride, Capital Estate) and 14 buildings of 6 floors (Haspo). Housearch's apparent '3' is its developer panel counting Cebeci Group's whole portfolio, not this project — read in context it is not a competing claim at all.",
    competingValues: [
      { value: 7, source: SEASIDE },
      { value: 7, source: ENSPRIDE },
      { value: 7, source: CESTATE },
      { value: 14, source: HASPO },
    ],
    resolution:
      "residenceBlockCount = 7, confirmed across three independent hosts. buildingCount = 14 stays single_source on Haspo: 7 blocks CONTAINING 14 buildings is compatible with both readings, so nothing is suppressed.",
    resolvedTo: 7,
  },
  {
    id: "F-002",
    severity: "critical",
    area: "pricing",
    field: "units[].askingPrice",
    message:
      "The 1+1 entry price spans a 2.1x range across four publishers — Haspo EUR 112,000 (80-89 m²), Seaside EUR 185,000 (85-92 m²), Housearch USD 239,171 (75 m²). The causes compound: two currencies, no observation dates, different unit subsets, and at least one listing stale by roughly two years (F-006).",
    competingValues: [
      { value: { amount: 112000, currency: "EUR" }, source: HASPO },
      { value: { amount: 185000, currency: "EUR" }, source: SEASIDE },
      { value: { amount: 239171, currency: "USD" }, source: HOUSEARCH },
    ],
    resolution:
      "DELIBERATELY UNRESOLVED. Rendered as a range with all sources visible and a 'prices disagree across portals' badge. No average, no midpoint, no 'most likely' pick — any single number here would be a fabrication with a citation stapled to it.",
    resolvedTo: null,
  },
  {
    id: "F-003",
    severity: "medium",
    area: "geography",
    field: "project.distanceToSeaM",
    message:
      "Distance to sea: 200 m (Seaside) against 300 m (Haspo, ENS Pride). The 1 km quoted elsewhere is the hotel-to-public-beach walk, a different measurement rather than a contradiction.",
    competingValues: [
      { value: 200, source: SEASIDE },
      { value: 300, source: HASPO },
      { value: 300, source: ENSPRIDE },
    ],
    resolution:
      "Residence distanceToSeaM = 300 m, corroborated. The hotel's beach distance is stored separately as hotel.distanceToBeachM so two different measurements are never collapsed into one field. Seaside's uncorroborated 200 m is retained.",
    resolvedTo: 300,
  },
  {
    id: "F-006",
    severity: "high",
    area: "availability",
    field: "project.buildStatus",
    message:
      "Build status: 'completed' (Housearch) against 'under construction' (Haspo). Completion 2024-05-30 is corroborated by three hosts and this harvest ran 2026-07-27, so Haspo's listing is stale by roughly two years.",
    competingValues: [
      { value: "completed", source: HOUSEARCH },
      { value: "under_construction", source: HASPO },
    ],
    resolution:
      "buildStatus = completed. Every price harvested from Haspo therefore inherits isStale = true and must be flagged wherever shown — a stale price presented as current is the most damaging error this project can make.",
    resolvedTo: "completed",
  },
  {
    id: "F-007",
    severity: "high",
    area: "branding",
    field: "hotel.brandAffiliation",
    message:
      "Cebeci İnşaat signed a Wyndham licence for the hotel component. Review platforms list the property as 'Azura World Hotel (ex. Wyndham Alanya)' and Tripadvisor renamed the same property id in place. The Wyndham branding was dropped between opening and 2026.",
    competingValues: [
      { value: "Azura World Hotel", source: AZURAWORLDHOTEL },
      { value: "Azura World Hotel (ex. Wyndham Alanya)", source: TRIPADVISOR },
    ],
    resolution:
      "name = 'Azura World Hotel', formerName = 'Wyndham Alanya', brandAffiliation = null with a note. The ticket's Wyndham link is kept as a historical source, never as current identity.",
    resolvedTo: null,
  },
  {
    id: "F-008",
    severity: "medium",
    area: "structure",
    field: "project.greenAreaSqm",
    message:
      "Green area: 20,000 m² (Housearch) against 'over 41,000 m² of landscaped green areas' (ENS Pride). The published breakdown closes arithmetically — green 20,000 + footprint 15,000 + outdoor 41,000 = 76,000 m², exactly the plot area three other hosts state independently.",
    competingValues: [
      { value: 20000, source: HOUSEARCH },
      { value: 41000, source: ENSPRIDE },
    ],
    resolution:
      "greenAreaSqm = 20,000. ENS Pride conflated the outdoor-facility figure with green space; the arithmetic identity settles it, not a preference between publishers. ENS Pride's 41,000 stays in conflictsWith.",
    resolvedTo: 20000,
  },
  {
    id: "F-011",
    severity: "high",
    area: "structure",
    field: "units[].id",
    message:
      "No source publishes a unit-by-unit inventory. 656 total units is corroborated (Seaside, ENS Pride) but the per-block and per-floor breakdown is not stated anywhere. 25 units are backed by real portal listings; 631 are synthesised to fill the confirmed total.",
    competingValues: [],
    resolution:
      "Synthesised units carry dataQuality 'modelled' and an askingPrice confidence of 'inferred' (or 'gap' where no basis exists), with the derivation named in the note. Block and sequence ids are internal addressing keys, not developer unit numbers. A modelled unit must never render as a real listing.",
    resolvedTo: null,
  },
  {
    id: "F-014",
    severity: "high",
    area: "harvest",
    field: "harvest.booking",
    message:
      "The ticket's Booking.com URL (/hotel/tr/azura-world.html) is a DIFFERENT property — a private apartment near Alanya centre, roughly 15 km from Türkler — not the 5-star hotel. The hotel kept its pre-rebrand slug, which is itself further evidence for F-007. Unchecked, another property's rating would have been published as Azura World's, correctly cited to a URL that genuinely resolves.",
    competingValues: [
      {
        value: "https://www.booking.com/hotel/tr/azura-world.html",
        source: BOOKING,
      },
    ],
    resolution:
      "The corrected URL is the source of record; the ticket's URL is harvested and retained as evidence for this finding only, and contributes no hotel facts. Both are anti-bot blocked in any case, so Booking scores remain a gap.",
    resolvedTo: null,
  },
  {
    id: "F-018",
    severity: "critical",
    area: "branding",
    field: "reviews[].url",
    message:
      "azuraworldhotel.com — the hotel's OWN site — links a Tripadvisor review page for 'Azura_Deluxe_Resort_Spa-Avsallar' (g609052-d7391617), a different Cebeci hotel 60 km away. The correct listing for this property is g1069655-d33144231. Anyone collecting reviews by following the operator's own link attaches another hotel's ratings to Azura World, with a citation that resolves perfectly.",
    competingValues: [
      { value: "g609052-d7391617", source: AZURAWORLDHOTEL },
      { value: "g1069655-d33144231", source: TRIPADVISOR },
    ],
    resolution:
      "The review set uses the independently resolved Tripadvisor id, never the operator's link. The bad link is recorded because a downstream consumer or a later harvest would otherwise walk into it.",
    resolvedTo: null,
  },
  {
    id: "F-023",
    severity: "medium",
    area: "branding",
    field: "hotel.roomCount",
    message:
      "Sources disagree on hotel.roomCount: 188 (Azura World Hotel, the operator's own site) against 112 (Tripadvisor).",
    competingValues: [
      { value: 188, source: AZURAWORLDHOTEL },
      { value: 112, source: TRIPADVISOR },
    ],
    resolution:
      "Display value follows tier order (CONTRACTS §1) — tier 3 outranks tier 5. Every competing value is retained in conflictsWith with its own source and snapshot. Not resolved: no evidence here justifies calling either publisher wrong.",
    resolvedTo: null,
  },
]

/** `severity` in the order the enum declares it — critical first. */
const SEVERITY_ORDER: ReadonlyArray<Finding["severity"]> = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
]

/**
 * The order `getFindings()` returns rows in, in both modes: severity ascending
 * by enum position (critical first), then id. Postgres orders an enum by its
 * declaration order, so this comparator and `order("severity")` agree.
 */
export function compareFindings(a: Finding, b: Finding): number {
  const bySeverity =
    SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
  if (bySeverity !== 0) return bySeverity
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

// ---------------------------------------------------------------------------
// Sourced facts
//
// Eleven facts across three entities, covering all six `Confidence` values:
//
//   confirmed     4   two or more sources on DISTINCT hosts
//   official      1   stated by a Cebeci-operated domain
//   single_source 1
//   conflicted    3   losing value kept in conflictsWith
//   inferred      1   a MODELLED unit price; the note states the derivation
//   gap           1   value null, note explains the absence
//
// The real generated dataset contains **zero** `official` facts — every fact
// the tier <=3 sources state is also stated elsewhere, so it lands on
// `confirmed`. The seed carries one anyway: a fixture that never exercises a
// branch is a fixture that hides a bug in it.
// ---------------------------------------------------------------------------

const FACT_ENTRIES: SeedFactEntry[] = [
  {
    entityType: "project",
    entityId: "AZW-TRK",
    fieldPath: "project.totalUnits",
    fact: {
      value: 656,
      confidence: "confirmed",
      sources: [SEASIDE, ENSPRIDE],
    },
  },
  {
    entityType: "project",
    entityId: "AZW-TRK",
    fieldPath: "project.residenceBlockCount",
    fact: {
      value: 7,
      confidence: "confirmed",
      sources: [SEASIDE, ENSPRIDE, CESTATE],
    },
  },
  {
    // The only fact in the slice corroborated by BOTH tier 1 and tier 2 — the
    // project's own site and the developer's. Copied verbatim from the real
    // dataset, including both snapshot hashes.
    entityType: "project",
    entityId: "AZW-TRK",
    fieldPath: "project.contact.email",
    fact: {
      value: "info@cebecigroup.com",
      confidence: "confirmed",
      sources: [AZURAWORLD, CEBECIGROUP],
    },
  },
  {
    entityType: "project",
    entityId: "AZW-TRK",
    fieldPath: "project.plotAreaSqm",
    fact: {
      value: 76000,
      confidence: "confirmed",
      sources: [HOUSEARCH, ENSPRIDE],
    },
  },
  {
    entityType: "project",
    entityId: "AZW-TRK",
    fieldPath: "project.buildingCount",
    fact: {
      value: 14,
      confidence: "single_source",
      sources: [HASPO],
      note: "Stated only by Haspo Realty. Compatible with the confirmed 7 residence blocks rather than competing with it — see F-001.",
    },
  },
  {
    entityType: "project",
    entityId: "AZW-TRK",
    fieldPath: "project.greenAreaSqm",
    fact: {
      value: 20000,
      confidence: "conflicted",
      sources: [HOUSEARCH],
      conflictsWith: [{ value: 41000, source: ENSPRIDE }],
      note: "F-008. The displayed value is the one the published area breakdown closes on arithmetically; the competing 41,000 m² is retained and remains visible on demand. Nothing was averaged or discarded.",
    },
  },
  {
    entityType: "project",
    entityId: "AZW-TRK",
    fieldPath: "project.buildStatus",
    fact: {
      value: "completed",
      confidence: "conflicted",
      sources: [HOUSEARCH],
      conflictsWith: [{ value: "under_construction", source: HASPO }],
      note: "F-006. Completion 2024-05-30 predates this harvest by two years, so the competing 'under construction' is a stale listing rather than a live disagreement — and every price on that listing inherits the staleness.",
    },
  },
  {
    entityType: "hotel",
    entityId: "AZW-HOTEL",
    fieldPath: "hotel.name",
    fact: {
      value: "Azura World Hotel",
      confidence: "official",
      sources: [AZURAWORLDHOTEL],
      note: "Stated by the operator's own domain. The full dataset corroborates the same name across review platforms and rates it 'confirmed'; the seed keeps the single official citation so the 'official' branch is exercised.",
    },
  },
  {
    entityType: "hotel",
    entityId: "AZW-HOTEL",
    fieldPath: "hotel.roomCount",
    fact: {
      value: 188,
      confidence: "conflicted",
      sources: [AZURAWORLDHOTEL],
      conflictsWith: [{ value: 112, source: TRIPADVISOR }],
      note: "F-023. Display follows tier order — tier 3 (the operator) outranks tier 5 (Tripadvisor). The losing 112 is kept.",
    },
  },
  {
    entityType: "unit",
    entityId: "AZW-B01-0027",
    fieldPath: "unit.askingPrice",
    fact: {
      value: { amount: 168500, currency: "EUR" },
      confidence: "inferred",
      sources: [HASPO, SEASIDE],
      note: "MODELLED, NOT A LISTING. No source publishes a unit-by-unit inventory (F-011). Price = median observed EUR/m² for layout 1+1 (1982 EUR/m², n=10) x median observed interior area (85 m²). The EUR/m² basis is itself disputed across portals — see F-002, deliberately unresolved — so this figure inherits that uncertainty and must never be shown as an asking price.",
    },
  },
  {
    entityType: "unit",
    entityId: "AZW-B01-0027",
    fieldPath: "unit.saleStatus",
    fact: {
      value: null,
      confidence: "gap",
      sources: [],
      note: "No source publishes unit-level availability for this project. Recorded as an established absence rather than guessed as 'available'.",
    },
  },
]

// ---------------------------------------------------------------------------
// Search projection
//
// `public.operational_search_documents` is revoked from `authenticated`
// entirely; the only read path is the `search_operational_records` RPC, which
// refuses a caller below staff (role level 40) and filters each row against
// `min_role_level`. The seed mirrors the ROWS so the seed-mode search behaves
// like the RPC rather than like a different feature.
//
// These are the only timestamps in this file with no observed value, so they
// are the only ones built from `seedIso()`.
// ---------------------------------------------------------------------------

const SEARCH_DOCUMENTS: SeedSearchDocument[] = [
  {
    entityTable: "findings",
    entityId: "F-002",
    title: "F-002 · 1+1 Einstiegspreis: 2,1-fache Spanne über vier Portale",
    summary:
      "Kritischer Preisbefund. Haspo EUR 112.000, Seaside EUR 185.000, Housearch USD 239.171. Bewusst ungelöst.",
    language: "de",
    minRoleLevel: 70,
    metadata: { severity: "critical", area: "pricing", resolved: false },
    updatedAt: seedIso(0),
  },
  {
    entityTable: "findings",
    entityId: "F-018",
    title: "F-018 · Hotel site links the wrong Tripadvisor listing",
    summary:
      "The operator's own site links a review page for a different Cebeci hotel 60 km away. Critical branding finding.",
    language: "en",
    minRoleLevel: 70,
    metadata: { severity: "critical", area: "branding", resolved: false },
    updatedAt: seedIso(0),
  },
  {
    entityTable: "units",
    entityId: "AZW-B01-0027",
    title: "AZW-B01-0027 · 1+1, 85 m² (modelliert)",
    summary:
      "Modellierte Einheit. Preis abgeleitet aus dem beobachteten EUR/m²-Median — keine reale Anzeige.",
    language: "de",
    minRoleLevel: 0,
    metadata: { layout: "1+1", dataQuality: "modelled", blockCode: "B01" },
    updatedAt: seedIso(0),
  },
  {
    entityTable: "sources",
    entityId: "azuraworld-com",
    title: "Azura World — offizielle Projektseite",
    summary: "Tier 1. Zuletzt geprüft 2026-07-27, Inhalt validiert.",
    language: "de",
    minRoleLevel: 0,
    metadata: { tier: 1, kind: "official", host: "azuraworld.com" },
    updatedAt: seedIso(0),
  },
  {
    entityTable: "hotel",
    entityId: "AZW-HOTEL",
    title: "Azura World Hotel — 5 Sterne, 188 Zimmer (strittig)",
    summary:
      "Zimmerzahl strittig: 188 laut Betreiber, 112 laut Tripadvisor (F-023).",
    language: "de",
    minRoleLevel: 0,
    metadata: { stars: 5, conflicted: ["hotel.roomCount"] },
    updatedAt: seedIso(0),
  },
  {
    entityTable: "sources",
    entityId: "booking-com-hotel-tr-azura-world-html",
    title: "Booking.com — ticket URL, wrong property (F-014)",
    summary:
      "Anti-bot body, 3.7 KB, not validated. Retained as evidence for F-014 only; contributes no hotel facts.",
    language: "en",
    minRoleLevel: 40,
    metadata: { tier: 5, contentValidated: false, finding: "F-014" },
    updatedAt: seedIso(0),
  },
]

// ---------------------------------------------------------------------------
// Builders — every one returns a fresh deep copy
// ---------------------------------------------------------------------------

function clone<T>(value: T): T {
  return structuredClone(value)
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * The source register with its snapshots — the shape of the two tables,
 * ordered by id exactly as the Supabase path orders `public.sources`.
 */
export function seedSourceRecords(): SeedSourceRecord[] {
  return clone(SOURCE_RECORDS).sort(byId)
}

/**
 * The source register as `SourceRef[]`, in the same id order.
 * A never-fetched source carries empty `fetchedAt` / `snapshotHash` — see
 * `registerRef()` for why that is a signal rather than a default.
 */
export function seedSources(): SourceRef[] {
  return seedSourceRecords().map(registerRef)
}

/**
 * Ordered critical-first, then by id — the same order the Supabase path
 * produces, so a UI cannot depend on an ordering that only exists in one mode.
 */
export function seedFindings(): Finding[] {
  return clone(FINDINGS).sort(compareFindings)
}

/**
 * Every seeded fact, invariants checked.
 *
 * `assertFactInvariants` throws `FactInvariantError` naming the offending
 * dotted path and the invariant number. Running it here means a seed that
 * violates CONTRACTS §1 fails loudly at the first call rather than rendering a
 * "confirmed" fact with one source.
 */
export function seedFactEntries(): SeedFactEntry[] {
  const entries = clone(FACT_ENTRIES)
  for (const entry of entries) {
    assertFactInvariants(entry.fact, entry.fieldPath)
  }
  return entries
}

/** Facts for one entity, keyed by dotted field path — `getFactsForEntity`'s shape. */
export function seedFactsForEntity(
  entityType: string,
  entityId: string
): Record<string, SourcedFact<unknown>> {
  const facts: Record<string, SourcedFact<unknown>> = {}
  for (const entry of seedFactEntries()) {
    if (entry.entityType !== entityType) continue
    if (entry.entityId !== entityId) continue
    facts[entry.fieldPath] = entry.fact
  }
  return facts
}

/** The search projection rows, ordered by entity so two runs agree. */
export function seedSearchDocuments(): SeedSearchDocument[] {
  return clone(SEARCH_DOCUMENTS).sort((a, b) => {
    if (a.entityTable !== b.entityTable) {
      return a.entityTable < b.entityTable ? -1 : 1
    }
    return a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0
  })
}
