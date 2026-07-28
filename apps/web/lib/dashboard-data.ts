/**
 * # Dashboard seed data — the KPI rollup panels
 *
 * Owned by **W2-A**. Consumed only by `lib/dashboard-repository.ts`, which
 * assembles these panels into a `DashboardSnapshot` in *both* modes, so the
 * seeded and Supabase-backed dashboards are the same shape by construction.
 *
 * ## Every number here was counted, and the counts come from `supabase/seed.sql`
 *
 * Not from the harvested dataset and not from judgement: these panels have to
 * describe the same database the Supabase-backed loaders read, so each figure
 * below was measured against W1-A's `supabase/seed.sql` on 2026-07-27 — 656
 * units, 25 `portal_listing` against 631 `modelled`, 22 publicly listed, 7
 * blocks of 94/94/94/94/94/93/93, €371,036,506 of asking price, 24 findings, 56
 * sources, 1,354 sourced facts of which 633 are gaps. They are transcribed
 * rather than imported because the generated dataset module is 1.5 MB and a seed
 * file has to stay safe to pull into any bundle.
 *
 * ## Operations and finance are empty, and that is the honest answer
 *
 * `seed.sql` inserts **zero** rows into `service_tickets` and
 * `finance_ledger_entries`; W1-A's handoff records it as a `[GAP]` for W3-D/E/F.
 * So `seedOperationsPanel()` and `seedFinancePanel()` report zeros rather than a
 * plausible 18 tickets and €486,300 of ledger movement. A fabricated figure
 * would look researched, contradict the database the moment Supabase is
 * configured, and — for a project whose entire premise is that every number
 * carries provenance — be the one number on the dashboard that carries none.
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
  /**
   * By `sale_status`, which is `NOT NULL DEFAULT 'unknown'`. The `unknown`
   * bucket is therefore where an unestablished status lands — 631 of 656 today
   * — and it means "no source states this", not "a source states it is unknown".
   */
  bySaleStatus: Record<string, number>
  /**
   * Rows with a NULL `sale_status`. The column forbids NULL, so this should stay
   * 0; it exists because a rollup that silently folds an impossible value into a
   * bucket is how a schema change becomes a wrong number instead of a visible one.
   */
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

/** Service-ticket rollup. Empty in seed mode — `seed.sql` has no tickets. */
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

/**
 * Ledger rollup. Empty in seed mode — `seed.sql` has no ledger entries.
 *
 * Per-currency, never summed across: `sum(EUR) + sum(TRY)` is a number with no
 * meaning, and returning two maps instead of two totals removes the temptation
 * to compute one.
 */
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
 * **Counted** from the 656 unit rows in `supabase/seed.sql` on 2026-07-27.
 *
 * Three figures worth reading twice:
 *
 * - 631 of 656 units are `modelled` — synthesised to fill the inventory, not
 *   scraped. Only 25 are backed by a real portal listing.
 * - those same 631 carry `sale_status = 'unknown'`, which is the column's way of
 *   saying no source states one. The dashboard should read "25 known, 631
 *   unestablished", never "631 units are in an unknown state".
 * - 22, not 25, are publicly listed: the modelled rows are excluded from the
 *   public catalogue, and `seed.sql` additionally unlists three portal units so
 *   the RLS tests have something an owner may *not* read.
 */
export function seedInventoryPanel(): InventoryPanel {
  return {
    totalUnits: 656,
    sampledUnits: 656,
    truncated: false,
    bySaleStatus: { available: 25, unknown: 631 },
    unitsWithoutSaleStatus: 0,
    byDataQuality: { modelled: 631, portal_listing: 25 },
    modelledUnits: 631,
    portalListingUnits: 25,
    publiclyListedUnits: 22,
    byLayout: { "1+1": 136, "2+1": 134, "3+1": 132, "4+1": 127, "5+1": 127 },
    byBlock: { B01: 94, B02: 94, B03: 94, B04: 94, B05: 94, B06: 93, B07: 93 },
    askingPriceTotalsByCurrency: { EUR: 371036506 },
    currencies: ["EUR"],
    unitsWithoutUsablePrice: 0,
  }
}

/**
 * **Counted** from `supabase/seed.sql`: 24 `findings`, 56 `sources`, 1,354
 * `sourced_facts`.
 *
 * `gap: 633` and `inferred: 631` are dominated by the modelled units, and that
 * is exactly what the cockpit should show: most of this inventory is derived,
 * not observed. 47 of 1,354 facts — three and a half percent — reach
 * `confirmed` or `conflicted`.
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
    totalSources: 56,
    // tier 1 official · 2 developer · 3 hotel · 4 portal · 5 review · 6 press.
    // **One** tier-1 source for the entire project, and three tier-3. No
    // official or developer page states a structural figure, which is why the
    // confidence split above looks the way it does.
    sourcesByTier: { "1": 1, "2": 5, "3": 3, "4": 33, "5": 7, "6": 7 },
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
// The two empty panels
//
// `supabase/seed.sql` inserts no rows into `service_tickets` or
// `finance_ledger_entries` — W1-A's handoff flags both as a `[GAP]` with
// W3-D/E/F owning the missing fixtures. These builders report that rather than
// filling it. The panel *shapes* are complete, so the UI can build its empty,
// loading, error and partial states against them (CONVENTIONS §5 wants all
// four); only the rows are missing, and they are missing in both modes.
// ---------------------------------------------------------------------------

/**
 * Zero tickets — `seed.sql` has none.
 *
 * `slaEvaluatedAt` is still the fixed anchor rather than the wall clock: an
 * empty panel that reported a different timestamp on every render would break
 * snapshot determinism for no benefit.
 */
export function seedOperationsPanel(): OperationsPanel {
  return {
    totalTickets: 0,
    sampledTickets: 0,
    truncated: false,
    byStatus: {},
    byPriority: {},
    overdueTickets: 0,
    ticketsWithoutSla: 0,
    slaEvaluatedAt: SEED_ANCHOR_ISO,
  }
}

/** Zero ledger entries — `seed.sql` has none. No currencies, so no totals. */
export function seedFinancePanel(): FinancePanel {
  return {
    totalEntries: 0,
    sampledEntries: 0,
    truncated: false,
    byStatus: {},
    debitTotalsByCurrency: {},
    creditTotalsByCurrency: {},
    currencies: [],
    entriesWithoutUsableAmount: 0,
  }
}
