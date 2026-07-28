/**
 * # Hotel repository — `hotels`, `hotel_rooms`, `review_sources`, `review_quotes`
 *
 * Owned by **W2-A**. Every read goes through `withRepository()` from
 * `lib/repository-base.ts`, so all five exports obey the two rules that define
 * the data layer:
 *
 * - unconfigured Supabase → `source: "local-seed"`, labelled
 * - configured Supabase that fails → **throws** a mapped `ApiError`; it does not
 *   quietly serve seed data over an outage
 * - configured Supabase that returns zero rows → `source: "supabase"` with empty
 *   data. An empty table is a fact about the database, not a failure.
 *
 * ## Access
 *
 * The hotel and its reviews are the **public showcase**. `guest` holds
 * `hotel:view` and `reviews:view` in `lib/rbac.ts`, so no function here takes a
 * `role`: there is no narrower scope to apply and a role parameter that never
 * changes the answer is a lie about how the data is protected. Governance data,
 * which is *not* public, is scoped by role in `lib/governance-repository.ts`.
 *
 * ## Two schema facts that shape this file
 *
 * 1. **`hotel_rooms` is empty and that is correct.** No harvested source
 *    publishes a room-type breakdown — only the 188-room total. `getHotelRooms()`
 *    therefore returns a shape that *says* the breakdown is unpublished, so a
 *    panel can render an honest empty state instead of a table that looks broken.
 * 2. **`review_sources` is keyed on `url`, not `platform`.** Two rows carry
 *    `platform = "tripadvisor"` because OnTheBeach re-serves the same widget
 *    (F-016). Nothing here dedupes by platform; `getReviewSummary()` instead
 *    *names* the duplicate so the caller can avoid double-counting it.
 */

import type { RepositoryResult } from "@/lib/contracts"
import {
  asBoolean,
  asNullableNumber,
  asNullableString,
  asRecord,
  asString,
  clampLimit,
  clampOffset,
  unwrap,
  withRepository,
  type RepositoryClient,
} from "@/lib/repository-base"
import {
  SEED_HOTEL_CODE,
  seedHotel,
  seedHotelRooms,
  seedReviewQuotes,
  seedReviewSources,
  type HotelRecord,
  type HotelRoomRecord,
  type ReviewQuoteRecord,
  type ReviewSentiment,
  type ReviewSourceRecord,
} from "@/lib/hotel-data"

// ---------------------------------------------------------------------------
// Columns — the real column names, listed explicitly.
//
// `select("*")` would silently start shipping any column a later migration adds,
// including ones nobody meant to expose.
// ---------------------------------------------------------------------------

export const HOTEL_COLUMNS =
  "id, company_id, site_id, code, name, former_name, stars, room_count, floors, opened_year, board, aquapark_slides, distance_to_beach_m, check_in, check_out, brand_affiliation, created_at, updated_at"

export const HOTEL_ROOM_COLUMNS =
  "id, hotel_id, code, name, room_type, room_count, interior_m2, max_occupancy, has_sea_view, source_url, sort_order, created_at, updated_at"

export const REVIEW_SOURCE_COLUMNS =
  "id, hotel_id, platform, url, publisher, score, score_scale, review_count, ranking, sentiment, fetched_at, created_at, updated_at"

export const REVIEW_QUOTE_COLUMNS =
  "id, review_source_id, url, quote_text, rating, quoted_at_label, quoted_on, created_at"

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

/**
 * `score_scale` is `smallint NOT NULL` with a CHECK for (5, 10). Anything else
 * means the constraint was bypassed, and the honest response is "I do not know
 * the scale" rather than a guess — a score normalised against the wrong scale is
 * off by a factor of two and looks entirely plausible.
 */
function asScoreScale(value: unknown): 5 | 10 | null {
  const parsed = asNullableNumber(value)
  if (parsed === 5) return 5
  if (parsed === 10) return 10
  return null
}

/** The contract's three buckets, or `null` when the jsonb is missing any of them. */
function asSentiment(value: unknown): ReviewSentiment | null {
  const raw = asRecord(value)
  const positive = asNullableNumber(raw.positive)
  const mixed = asNullableNumber(raw.mixed)
  const negative = asNullableNumber(raw.negative)
  if (positive === null || mixed === null || negative === null) return null
  return { positive, mixed, negative }
}

/** The jsonb as stored, or `null` when the column is NULL rather than `{}`. */
function asJsonObject(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null
  if (typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** Map a `hotels` row. Exported so `lib/dashboard-repository.ts` cannot drift from it. */
export function mapHotelRow(row: Record<string, unknown>): HotelRecord {
  return {
    id: asString(row.id),
    companyId: asString(row.company_id),
    siteId: asString(row.site_id),
    code: asString(row.code),
    name: asString(row.name),
    formerName: asNullableString(row.former_name),
    stars: asNullableNumber(row.stars),
    roomCount: asNullableNumber(row.room_count),
    floors: asNullableNumber(row.floors),
    openedYear: asNullableNumber(row.opened_year),
    board: asNullableString(row.board),
    aquaparkSlides: asNullableNumber(row.aquapark_slides),
    distanceToBeachM: asNullableNumber(row.distance_to_beach_m),
    // TIME columns. "14:00:00" is a wall-clock time; never `new Date()` it.
    checkIn: asNullableString(row.check_in),
    checkOut: asNullableString(row.check_out),
    // NULL is the researched answer (F-007 / F-018), not a gap to fill in.
    brandAffiliation: asNullableString(row.brand_affiliation),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  }
}

function mapHotelRoomRow(row: Record<string, unknown>): HotelRoomRecord {
  return {
    id: asString(row.id),
    hotelId: asString(row.hotel_id),
    code: asString(row.code),
    name: asNullableString(row.name),
    roomType: asNullableString(row.room_type),
    roomCount: asNullableNumber(row.room_count),
    // numeric(8,2) → "24.50" on the wire. Parsed, never assumed numeric.
    interiorM2: asNullableNumber(row.interior_m2),
    maxOccupancy: asNullableNumber(row.max_occupancy),
    hasSeaView: row.has_sea_view === null ? null : asBoolean(row.has_sea_view),
    sourceUrl: asNullableString(row.source_url),
    sortOrder: asNullableNumber(row.sort_order) ?? 0,
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  }
}

/** Map a `review_sources` row. Exported for `lib/dashboard-repository.ts`. */
export function mapReviewSourceRow(row: Record<string, unknown>): ReviewSourceRecord {
  return {
    id: asString(row.id),
    hotelId: asString(row.hotel_id),
    platform: asString(row.platform),
    url: asString(row.url),
    publisher: asNullableString(row.publisher),
    // numeric(4,2) → "4.60". Never `?? 0`: a score of 0 is a different claim.
    score: asNullableNumber(row.score),
    scoreScale: asScoreScale(row.score_scale),
    reviewCount: asNullableNumber(row.review_count),
    ranking: asNullableString(row.ranking),
    sentiment: asSentiment(row.sentiment),
    sentimentRaw: asJsonObject(row.sentiment),
    fetchedAt: asNullableString(row.fetched_at),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  }
}

function mapReviewQuoteRow(row: Record<string, unknown>): ReviewQuoteRecord {
  return {
    id: asString(row.id),
    reviewSourceId: asString(row.review_source_id),
    url: asString(row.url),
    quoteText: asString(row.quote_text),
    rating: asNullableNumber(row.rating),
    quotedAtLabel: asNullableString(row.quoted_at_label),
    quotedOn: asNullableString(row.quoted_on),
    createdAt: asString(row.created_at),
  }
}

// ---------------------------------------------------------------------------
// Shared query helpers
// ---------------------------------------------------------------------------

export interface PageOptions {
  /** Clamped to [1, 500]; defaults to 50. Never unbounded. */
  limit?: number
  offset?: number
}

/**
 * Resolve which hotel a room/review query belongs to when the caller did not say.
 *
 * One extra narrow query, not an N+1: it runs once per repository call, never
 * once per row. `code` is UNIQUE, and the fallback ordering by `code` makes the
 * "there is only one hotel" case deterministic rather than whatever Postgres
 * happens to return first.
 */
async function resolveHotelId(
  client: RepositoryClient,
  code?: string,
): Promise<string | null> {
  const query = client.from("hotels").select("id, code")
  const filtered = code === undefined ? query.order("code", { ascending: true }) : query.eq("code", code)
  const rows = unwrap<Record<string, unknown>[]>(await filtered.limit(1), [])
  // noUncheckedIndexedAccess: rows[0] is `Record<string, unknown> | undefined`.
  const first = rows[0]
  if (first === undefined) return null
  const id = asNullableString(first.id)
  return id
}

// ---------------------------------------------------------------------------
// getHotel
// ---------------------------------------------------------------------------

export interface HotelQuery {
  /** `hotels.code`, UNIQUE. Omit to take the single seeded property. */
  code?: string
}

/**
 * The hotel record, or `null` when no row matches.
 *
 * `null` is a legitimate answer on a configured Supabase — an empty `hotels`
 * table is a fact, and substituting `seedHotel()` for it would be the demo lying
 * about what is in the database.
 */
export async function getHotel(
  opts: HotelQuery = {},
): Promise<RepositoryResult<HotelRecord | null>> {
  const code = opts.code
  return withRepository<HotelRecord | null>(
    async (client) => {
      const query = client.from("hotels").select(HOTEL_COLUMNS)
      const filtered =
        code === undefined ? query.order("code", { ascending: true }) : query.eq("code", code)
      const rows = unwrap<Record<string, unknown>[]>(await filtered.limit(1), [])
      const first = rows[0]
      return first === undefined ? null : mapHotelRow(first)
    },
    () => {
      if (code !== undefined && code !== SEED_HOTEL_CODE) return null
      return seedHotel()
    },
    "hotel.getHotel",
  )
}

// ---------------------------------------------------------------------------
// getHotelRooms
// ---------------------------------------------------------------------------

export interface HotelRoomQuery extends PageOptions {
  hotelId?: string
  /** Used only when `hotelId` is absent. */
  code?: string
}

/**
 * The published room-type breakdown.
 *
 * The empty case is the *expected* one and is carried in the return shape rather
 * than left for the caller to infer from `rooms.length === 0`, which is
 * indistinguishable from a failed fetch. When `breakdownPublished` is false the
 * UI should say the breakdown is unpublished and fall back to
 * `HotelRecord.roomCount` — it must not invent room types to fill the panel.
 */
export interface HotelRoomBreakdown {
  rooms: HotelRoomRecord[]
  /** False when no source publishes a per-room-type split. */
  breakdownPublished: boolean
  /** Non-null exactly when `breakdownPublished` is false. Safe to display. */
  note: string | null
  /** Sum of `roomCount` across published rows, or `null` when nothing is published. */
  publishedRoomTotal: number | null
}

const NO_BREAKDOWN_NOTE =
  "No source publishes a room-type breakdown for this property — only the total room count. Nothing has been assumed to fill the gap."

function buildBreakdown(rooms: HotelRoomRecord[]): HotelRoomBreakdown {
  if (rooms.length === 0) {
    return {
      rooms: [],
      breakdownPublished: false,
      note: NO_BREAKDOWN_NOTE,
      publishedRoomTotal: null,
    }
  }
  // Rows with a NULL room_count contribute nothing rather than a zero: `?? 0`
  // here would report a smaller total as if it were counted.
  const counted = rooms
    .map((room) => room.roomCount)
    .filter((count): count is number => count !== null)
  return {
    rooms,
    breakdownPublished: true,
    note: null,
    publishedRoomTotal:
      counted.length === 0 ? null : counted.reduce((sum, count) => sum + count, 0),
  }
}

export async function getHotelRooms(
  opts: HotelRoomQuery = {},
): Promise<RepositoryResult<HotelRoomBreakdown>> {
  const limit = clampLimit(opts.limit)
  const offset = clampOffset(opts.offset)
  const hotelId = opts.hotelId
  const code = opts.code

  return withRepository<HotelRoomBreakdown>(
    async (client) => {
      const resolved = hotelId ?? (await resolveHotelId(client, code))
      if (resolved === null) return buildBreakdown([])
      const rows = unwrap<Record<string, unknown>[]>(
        await client
          .from("hotel_rooms")
          .select(HOTEL_ROOM_COLUMNS)
          .eq("hotel_id", resolved)
          .order("sort_order", { ascending: true })
          .range(offset, offset + limit - 1),
        [],
      )
      return buildBreakdown(rows.map(mapHotelRoomRow))
    },
    () => buildBreakdown(seedHotelRooms()),
    "hotel.getHotelRooms",
  )
}

// ---------------------------------------------------------------------------
// getReviewSources
// ---------------------------------------------------------------------------

export interface ReviewSourceQuery extends PageOptions {
  hotelId?: string
  code?: string
  /**
   * Filter to one platform. This is a *filter*, not a dedupe: two rows sharing a
   * platform label are two distinct captures (F-016) and both are returned.
   */
  platform?: string
}

/**
 * Review sources, ordered by `platform` then `url` so seed and Supabase modes
 * agree on ordering and snapshots stay stable.
 */
export async function getReviewSources(
  opts: ReviewSourceQuery = {},
): Promise<RepositoryResult<ReviewSourceRecord[]>> {
  const limit = clampLimit(opts.limit)
  const offset = clampOffset(opts.offset)
  const hotelId = opts.hotelId
  const code = opts.code
  const platform = opts.platform

  return withRepository<ReviewSourceRecord[]>(
    async (client) => {
      const resolved = hotelId ?? (await resolveHotelId(client, code))
      if (resolved === null) return []
      const base = client
        .from("review_sources")
        .select(REVIEW_SOURCE_COLUMNS)
        .eq("hotel_id", resolved)
      const filtered = platform === undefined ? base : base.eq("platform", platform)
      const rows = unwrap<Record<string, unknown>[]>(
        await filtered
          .order("platform", { ascending: true })
          .order("url", { ascending: true })
          .range(offset, offset + limit - 1),
        [],
      )
      return rows.map(mapReviewSourceRow)
    },
    () => {
      const all = sortReviewSources(seedReviewSources()).filter(
        (source) => platform === undefined || source.platform === platform,
      )
      return all.slice(offset, offset + limit)
    },
    "hotel.getReviewSources",
  )
}

/** `platform` then `url`, matching the Supabase ordering above. ASCII, so no collator. */
function sortReviewSources(sources: ReviewSourceRecord[]): ReviewSourceRecord[] {
  return [...sources].sort((a, b) => {
    if (a.platform !== b.platform) return a.platform < b.platform ? -1 : 1
    if (a.url === b.url) return 0
    return a.url < b.url ? -1 : 1
  })
}

// ---------------------------------------------------------------------------
// getReviewQuotes
// ---------------------------------------------------------------------------

/**
 * Verbatim guest quotes with permalinks.
 *
 * Omitting `reviewSourceId` fetches every quote for the hotel's review sources
 * in **two** queries — the source ids, then one `.in()` — not one query per
 * source. Render `quoteText` as text; scraped review bodies are untrusted input
 * and `dangerouslySetInnerHTML` is banned (CONVENTIONS §4).
 */
export async function getReviewQuotes(
  reviewSourceId?: string,
  opts: ReviewSourceQuery = {},
): Promise<RepositoryResult<ReviewQuoteRecord[]>> {
  const limit = clampLimit(opts.limit)
  const offset = clampOffset(opts.offset)
  const hotelId = opts.hotelId
  const code = opts.code

  return withRepository<ReviewQuoteRecord[]>(
    async (client) => {
      const base = client.from("review_quotes").select(REVIEW_QUOTE_COLUMNS)

      let scoped
      if (reviewSourceId !== undefined) {
        scoped = base.eq("review_source_id", reviewSourceId)
      } else {
        const resolved = hotelId ?? (await resolveHotelId(client, code))
        if (resolved === null) return []
        const sourceRows = unwrap<Record<string, unknown>[]>(
          await client
            .from("review_sources")
            .select("id")
            .eq("hotel_id", resolved)
            .limit(clampLimit(undefined)),
          [],
        )
        const ids = sourceRows
          .map((row) => asNullableString(row.id))
          .filter((id): id is string => id !== null)
        // An empty `.in()` list is a query that can never match — skip the round
        // trip and return the empty result directly. Still `source: "supabase"`.
        if (ids.length === 0) return []
        scoped = base.in("review_source_id", ids)
      }

      const rows = unwrap<Record<string, unknown>[]>(
        await scoped
          .order("rating", { ascending: false })
          .order("url", { ascending: true })
          .range(offset, offset + limit - 1),
        [],
      )
      return rows.map(mapReviewQuoteRow)
    },
    () => {
      const all = seedReviewQuotes()
        .filter((quote) => reviewSourceId === undefined || quote.reviewSourceId === reviewSourceId)
        .sort((a, b) => {
          const ratingA = a.rating ?? -1
          const ratingB = b.rating ?? -1
          if (ratingA !== ratingB) return ratingB - ratingA
          if (a.url === b.url) return 0
          return a.url < b.url ? -1 : 1
        })
      return all.slice(offset, offset + limit)
    },
    "hotel.getReviewQuotes",
  )
}

// ---------------------------------------------------------------------------
// getReviewSummary
// ---------------------------------------------------------------------------

/** One review source, with its score both as published and as normalised. */
export interface ReviewScoreEntry {
  /** The row key. Two entries may share a `platform`; never a `url`. */
  url: string
  platform: string
  publisher: string | null
  reviewCount: number | null
  ranking: string | null
  /** Exactly as the platform published it. */
  reportedScore: number | null
  /** The scale it was published on. `null` when the row's scale is unusable. */
  reportedScale: 5 | 10 | null
  /** Rescaled to `normalisedScale`. `null` when the score or its scale is unknown. */
  normalisedScore: number | null
  normalisedScale: 5 | 10
  /** True when `reportedScale !== normalisedScale`. The UI must say so. */
  rescaled: boolean
  /** True when the row's `score_scale` was neither 5 nor 10, so nothing was rescaled. */
  scaleUnknown: boolean
  /** Other entry URLs carrying the same platform label — the F-016 case. */
  sharesPlatformWith: string[]
}

/**
 * Per-platform scores on one stated scale.
 *
 * The rule this type exists to enforce: **never silently convert 6.7/10 into
 * 3.35/5.** Every entry carries `reportedScore` + `reportedScale` alongside
 * `normalisedScore` + `normalisedScale`, and `rescaled` marks the ones that
 * moved. A bare "3.35" with no scale beside it is not renderable from this shape.
 */
export interface ReviewSummary {
  /** The scale every `normalisedScore` is expressed on. Always report it. */
  normalisedScale: 5 | 10
  entries: ReviewScoreEntry[]
  /** Distinct platform labels, sorted. Shorter than `entries` when F-016 applies. */
  platforms: string[]
  /** Platform labels carried by more than one entry, with the URLs involved. */
  duplicatePlatformGroups: Array<{ platform: string; urls: string[] }>
  /**
   * Mean of `normalisedScore` over **one entry per platform** — the entry with
   * the most reviews wins the platform. Averaging all entries would count
   * OnTheBeach's re-served Tripadvisor score twice. `null` when no entry has
   * both a score and a usable scale.
   */
  meanNormalisedScore: number | null
  /** Exactly which entries `meanNormalisedScore` was computed from. */
  meanBasisUrls: string[]
  /**
   * Sum of `reviewCount` over the same one-entry-per-platform basis. `null` when
   * no basis entry states a count. Deliberately not a sum over all entries.
   */
  distinctPlatformReviewCount: number | null
}

/** Two decimal places, so 6.7/10 → 3.35/5 rather than 3.3500000000000005. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function rescale(score: number, from: 5 | 10, to: 5 | 10): number {
  if (from === to) return score
  return round2((score * to) / from)
}

function buildSummary(
  sources: ReviewSourceRecord[],
  normalisedScale: 5 | 10,
): ReviewSummary {
  const ordered = sortReviewSources(sources)

  const byPlatform = new Map<string, ReviewSourceRecord[]>()
  for (const source of ordered) {
    const bucket = byPlatform.get(source.platform)
    if (bucket === undefined) byPlatform.set(source.platform, [source])
    else bucket.push(source)
  }

  const entries: ReviewScoreEntry[] = ordered.map((source) => {
    const siblings = byPlatform.get(source.platform) ?? []
    const scale = source.scoreScale
    const normalisedScore =
      source.score === null || scale === null ? null : rescale(source.score, scale, normalisedScale)
    return {
      url: source.url,
      platform: source.platform,
      publisher: source.publisher,
      reviewCount: source.reviewCount,
      ranking: source.ranking,
      reportedScore: source.score,
      reportedScale: scale,
      normalisedScore,
      normalisedScale,
      rescaled: scale !== null && scale !== normalisedScale,
      scaleUnknown: scale === null,
      sharesPlatformWith: siblings
        .filter((sibling) => sibling.url !== source.url)
        .map((sibling) => sibling.url),
    }
  })

  const duplicatePlatformGroups: Array<{ platform: string; urls: string[] }> = []
  const basis: ReviewScoreEntry[] = []

  for (const [platform, bucket] of byPlatform) {
    if (bucket.length > 1) {
      duplicatePlatformGroups.push({
        platform,
        urls: bucket.map((source) => source.url),
      })
    }
    // The capture with the most reviews represents the platform; a reseller
    // re-serving the same widget always reports a subset.
    const primary = [...bucket].sort((a, b) => {
      const countA = a.reviewCount ?? -1
      const countB = b.reviewCount ?? -1
      if (countA !== countB) return countB - countA
      if (a.url === b.url) return 0
      return a.url < b.url ? -1 : 1
    })[0]
    if (primary === undefined) continue
    const entry = entries.find((candidate) => candidate.url === primary.url)
    if (entry !== undefined) basis.push(entry)
  }

  duplicatePlatformGroups.sort((a, b) => (a.platform < b.platform ? -1 : a.platform > b.platform ? 1 : 0))
  basis.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))

  const scored = basis
    .map((entry) => entry.normalisedScore)
    .filter((score): score is number => score !== null)
  const counted = basis
    .map((entry) => entry.reviewCount)
    .filter((count): count is number => count !== null)

  return {
    normalisedScale,
    entries,
    platforms: [...byPlatform.keys()].sort(),
    duplicatePlatformGroups,
    meanNormalisedScore:
      scored.length === 0
        ? null
        : round2(scored.reduce((sum, score) => sum + score, 0) / scored.length),
    meanBasisUrls: basis.map((entry) => entry.url),
    distinctPlatformReviewCount:
      counted.length === 0 ? null : counted.reduce((sum, count) => sum + count, 0),
  }
}

export interface ReviewSummaryQuery extends ReviewSourceQuery {
  /** The scale to express every score on. Defaults to 5. Always reported back. */
  normaliseTo?: 5 | 10
}

/**
 * Per-platform review scores normalised onto one stated scale.
 *
 * An empty `review_sources` table yields an empty summary with
 * `source: "supabase"` — not the seed. There is nothing to average and saying so
 * is the correct answer.
 */
export async function getReviewSummary(
  opts: ReviewSummaryQuery = {},
): Promise<RepositoryResult<ReviewSummary>> {
  const normaliseTo: 5 | 10 = opts.normaliseTo ?? 5
  const limit = clampLimit(opts.limit)
  const offset = clampOffset(opts.offset)
  const hotelId = opts.hotelId
  const code = opts.code
  const platform = opts.platform

  return withRepository<ReviewSummary>(
    async (client) => {
      const resolved = hotelId ?? (await resolveHotelId(client, code))
      if (resolved === null) return buildSummary([], normaliseTo)
      const base = client
        .from("review_sources")
        .select(REVIEW_SOURCE_COLUMNS)
        .eq("hotel_id", resolved)
      const filtered = platform === undefined ? base : base.eq("platform", platform)
      const rows = unwrap<Record<string, unknown>[]>(
        await filtered
          .order("platform", { ascending: true })
          .order("url", { ascending: true })
          .range(offset, offset + limit - 1),
        [],
      )
      return buildSummary(rows.map(mapReviewSourceRow), normaliseTo)
    },
    () =>
      buildSummary(
        seedReviewSources().filter(
          (source) => platform === undefined || source.platform === platform,
        ),
        normaliseTo,
      ),
    "hotel.getReviewSummary",
  )
}
