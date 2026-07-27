/**
 * # Dashboard seed data — the KPI rollup panels
 *
 * Owned by **W2-A**. Consumed only by `lib/dashboard-repository.ts`, which
 * assembles these panels into a `DashboardSnapshot` in *both* modes, so the
 * seeded and Supabase-backed dashboards are the same shape by construction.
 *
 * ## Two kinds of number live in this file, and they are not equal
 *
 * **Measured.** The inventory and evidence panels are transcribed from
 * `lib/azura-world-data.ts` — W0-B's generated dataset, counted on 2026-07-27.
 * Nothing there is estimated: 656 units, 25 `portal_listing` against 631
 * `modelled`, 7 blocks of 94/94/94/94/94/93/93, €371,036,506 of asking price,
 * 24 findings, 60 harvested sources, 1,354 sourced facts of which 633 are gaps.
 * They are transcribed rather than imported because that module is 1.5 MB and a
 * seed file has to stay safe to pull into any bundle; the upstream path is named
 * on each block so drift is findable.
 *
 * **Synthetic.** The operations and finance panels have no real-world
 * counterpart — no source publishes Cebeci Group's ticket queue or ledger, and
 * inventing one that *looked* researched would be the failure SYSTEM-PROMPT §2.3
 * names. These rows exist only to exercise the UI, every caller sees
 * `source: "local-seed"` on the envelope, and they are marked below.
 *
 * ## Deterministic
 *
 * Every builder returns a fresh object built from literals and `SEED_ANCHOR_ISO`.
 * No `Math.random()`, no `Date.now()`, no bare `new Date()` — a dashboard that
 * renders differently on each run makes Playwright snapshots worthless.
 */

import type { Role } from "@/lib/contracts"
import { SEED_ANCHOR_ISO } from "@/lib/repository-base"
import { seedHotel, seedHotelRooms, seedReviewSources } from "@/lib/hotel-data"

// ---------------------------------------------------------------------------
// Panel shapes
// ---------------------------------------------------------------------------

/**
 * Unit rollup.
 *
 * `totalUnits` is an exact `count` from Postgres and stays right even when the
 * distributions below were computed from a bounded page — which is what
 * `truncated` reports. A distribution that silently describes the first 500 of
 * 656 rows is the kind of number that survives review and then misleads someone.
 */
export interface InventoryPanel {
  /** Exact row count. `null` when the count itself could not be read. */
  totalUnits: number | null
  /** Rows the distributions below were actually computed from. */
  sampledUnits: number
  /** True when more rows exist than were sampled: distributions are partial. */
  truncated: boolean
  /** Only non-null `sale_status` values. NULL is counted separately, not as "unknown". */
  bySaleStatus: Record<string, number>
  /** A NULL `sale_status` is an unestablished fact, not a stated "unknown". */
  unitsWithoutSaleStatus: number
  byDataQuality: Record<string, number>
  /**
   * Synthesised to fill the 656-unit inventory; **never a real listing**. W3-C
   * keeps these visually distinct, which requires counting them separately here.
   */
  modelledUnits: number
  /** Units backed by a real scraped listing. */
  portalListingUnits: number
  byLayout: Record<string, number>
  byBlock: Record<string, number>
  publiclyListedUnits: number
  /** One total per currency. `sum(EUR) + sum(USD)` is meaningless (CONVENTIONS §5). */
  askingPriceTotalsByCurrency: Record<string, number>
  currencies: string[]
  /**
   * Amount NULL, currency NULL, or a currency outside the supported set. Never
   * folded into a total as a zero: a price of 0 is a bug, a gap is honest.
   */
  unitsWithoutUsablePrice: number
}

/** Service-ticket rollup. **Synthetic in seed mode.** */
export interface OperationsPanel {
  totalTickets: number | null
  sampledTickets: number
  truncated: boolean
  byStatus: Record<string, number>
  byPriority: Record<string, number>
  /** `sla_due_at` strictly before `slaEvaluatedAt`. */
  overdueTickets: number
  /** No SLA date at all. Not counted as on-time — that would be a claim. */
  ticketsWithoutSla: number
  /**
   * The instant "overdue" was judged against. Fixed to `SEED_ANCHOR_ISO` in seed
   * mode: comparing seed rows to the wall clock would make the panel change
   * between runs.
   */
  slaEvaluatedAt: string
}

/** Ledger rollup. **Synthetic in seed mode.** Per-currency, never summed across. */
export interface FinancePanel {
  totalEntries: number | null
  sampledEntries: number
  truncated: boolean
  byStatus: Record<string, number>
  debitTotalsByCurrency: Record<string, number>
  creditTotalsByCurrency: Record<string, number>
  currencies: string[]
  /** Amount or currency missing or unsupported. Excluded from the totals. */
  entriesWithoutUsableAmount: number
}

/**
 * The dataset's self-assessment.
 *
 * This panel is supposed to be uncomfortable reading: 633 of 1,354 facts are
 * gaps and 15 of 60 sources never validated. A cockpit that flattered the data
 * would defeat the point of collecting provenance at all.
 */
export interface EvidencePanel {
  totalFindings: number | null
  findingsBySeverity: Record<string, number>
  findingsByArea: Record<string, number>
  totalFacts: number | null
  factsByConfidence: Record<string, number>
  totalSources: number | null
  sourcesByTier: Record<string, number>
  truncated: boolean
}

/** The public showcase panel. Visible to every role, including anonymous. */
export interface HotelPanel {
  name: string | null
  roomCount: number | null
  /** Rows in `hotel_rooms`. Zero is the correct answer — see `seedHotelRooms()`. */
  publishedRoomTypes: number
  roomBreakdownPublished: boolean
  reviewSourceCount: number
  /**
   * Keyed on URL, because `review_sources` is. Two entries may share a platform
   * label (F-016); a score is meaningless without the `scale` beside it.
   */
  scores: Array<{
    url: string
    platform: string
    publisher: string | null
    score: number | null
    scale: 5 | 10 | null
    reviewCount: number | null
  }>
}

/**
 * The whole rollup.
 *
 * Three distinct ways a panel can be absent, deliberately kept apart:
 *
 * - `restrictedPanels` — the caller's role may not see it. The correct answer,
 *   not a fault.
 * - `failedPanels` — it was attempted and threw. One panel failing must not take
 *   the dashboard down with it (W2-A brief, edge cases).
 * - `truncatedPanels` — it loaded, but its distributions come from a bounded
 *   sample and its percentages are therefore approximate.
 */
export interface DashboardSnapshot {
  generatedAt: string
  role: Role | null
  profileId: string | null
  restrictedPanels: string[]
  failedPanels: string[]
  truncatedPanels: string[]
  inventory: InventoryPanel | null
  operations: OperationsPanel | null
  finance: FinancePanel | null
  evidence: EvidencePanel | null
  hotel: HotelPanel | null
}

/** Panel identifiers, used for the three lists above. */
export const DASHBOARD_PANELS = Object.freeze([
  "inventory",
  "operations",
  "finance",
  "evidence",
  "hotel",
] as const)

export type DashboardPanel = (typeof DASHBOARD_PANELS)[number]

// ---------------------------------------------------------------------------
// Measured panels
// ---------------------------------------------------------------------------

/**
 * **Measured** from `azuraWorldDataset.units` (656 rows) on 2026-07-27.
 *
 * Two figures worth reading twice:
 *
 * - 631 of 656 units are `modelled` — synthesised to fill the inventory, not
 *   scraped. Only 25 are backed by a real portal listing.
 * - those same 631 carry no `sale_status`, which is why `unitsWithoutSaleStatus`
 *   dwarfs `bySaleStatus`. Reporting them as "unknown" would turn 631 absent
 *   facts into 631 stated ones.
 */
export function seedInventoryPanel(): InventoryPanel {
  return {
    totalUnits: 656,
    sampledUnits: 656,
    truncated: false,
    bySaleStatus: { available: 25 },
    unitsWithoutSaleStatus: 631,
    byDataQuality: { modelled: 631, portal_listing: 25 },
    modelledUnits: 631,
    portalListingUnits: 25,
    byLayout: { "1+1": 136, "2+1": 134, "3+1": 132, "4+1": 127, "5+1": 127 },
    byBlock: { B01: 94, B02: 94, B03: 94, B04: 94, B05: 94, B06: 93, B07: 93 },
    // The 25 portal-listing units are the ones a portal actually publishes.
    publiclyListedUnits: 25,
    askingPriceTotalsByCurrency: { EUR: 371036506 },
    currencies: ["EUR"],
    unitsWithoutUsablePrice: 0,
  }
}

/**
 * **Measured** from `azuraWorldDataset.findings` (24), `.harvest` (60) and every
 * `SourcedFact` in the dataset (1,354).
 *
 * `gap: 633` and `inferred: 631` are dominated by the modelled units, and that
 * is exactly what the cockpit should show: most of this inventory is derived,
 * not observed.
 */
export function seedEvidencePanel(): EvidencePanel {
  return {
    totalFindings: 24,
    findingsBySeverity: { critical: 2, high: 9, medium: 11, low: 2 },
    findingsByArea: {
      availability: 1,
      branding: 6,
      geography: 3,
      harvest: 4,
      pricing: 3,
      structure: 7,
    },
    totalFacts: 1354,
    factsByConfidence: {
      confirmed: 14,
      conflicted: 13,
      single_source: 63,
      inferred: 631,
      gap: 633,
    },
    totalSources: 60,
    // tier 1 official · 2 developer · 3 hotel · 4 portal · 5 review · 6 press.
    // One tier-1 source for the entire project: no official site states a
    // structural figure, which is why so much is `single_source` above.
    sourcesByTier: { "1": 1, "2": 5, "3": 3, "4": 37, "5": 7, "6": 7 },
    truncated: false,
  }
}

/** Built from `lib/hotel-data.ts` so the panel cannot drift from the hotel seed. */
export function seedHotelPanel(): HotelPanel {
  const hotel = seedHotel()
  const rooms = seedHotelRooms()
  const sources = seedReviewSources()
  return {
    name: hotel.name,
    roomCount: hotel.roomCount,
    // Zero, correctly: no source publishes a room-type breakdown.
    publishedRoomTypes: rooms.length,
    roomBreakdownPublished: rooms.length > 0,
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
// Synthetic panels
//
// Nothing below describes the real world. No harvested source publishes this
// developer's ticket queue or ledger, and a made-up figure that looked
// researched would be worse than an empty panel.
// ---------------------------------------------------------------------------

/** **Synthetic.** 18 tickets, evaluated against the fixed seed anchor. */
export function seedOperationsPanel(): OperationsPanel {
  return {
    totalTickets: 18,
    sampledTickets: 18,
    truncated: false,
    byStatus: {
      open: 6,
      in_progress: 4,
      waiting_on_owner: 2,
      resolved: 5,
      cancelled: 1,
    },
    byPriority: { urgent: 2, high: 5, normal: 8, low: 3 },
    overdueTickets: 3,
    ticketsWithoutSla: 2,
    slaEvaluatedAt: SEED_ANCHOR_ISO,
  }
}

/**
 * **Synthetic.** 24 entries in two currencies.
 *
 * Debits equal credits *within* each currency and are never added across them.
 * A single "total ledger value" spanning EUR and TRY would be a number with no
 * meaning, and the temptation to compute one is exactly why this shape returns
 * two maps instead of two numbers.
 */
export function seedFinancePanel(): FinancePanel {
  return {
    totalEntries: 24,
    sampledEntries: 24,
    truncated: false,
    byStatus: { draft: 5, posted: 17, void: 2 },
    debitTotalsByCurrency: { EUR: 486300, TRY: 1250000 },
    creditTotalsByCurrency: { EUR: 486300, TRY: 1250000 },
    currencies: ["EUR", "TRY"],
    entriesWithoutUsableAmount: 0,
  }
}
