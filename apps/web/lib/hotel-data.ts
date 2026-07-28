/**
 * # Hotel seed data — `hotels`, `hotel_rooms`, `review_sources`, `review_quotes`
 *
 * Owned by **W2-A**. Consumed by `lib/hotel-repository.ts` as the `fallback()`
 * argument to `withRepository()`, and by nothing else.
 *
 * ## Three rules this file obeys
 *
 * 1. **Deterministic.** No `Math.random()`, no `Date.now()`, no bare `new Date()`.
 *    Every timestamp comes from `seedIso()`, anchored on `SEED_ANCHOR_ISO`. Two
 *    calls to any builder here produce byte-identical JSON, or Playwright
 *    snapshots become useless (W2-A brief, deliverable 2).
 * 2. **Structurally identical to the Supabase shape.** Each builder returns the
 *    same TypeScript record the repository produces after mapping a PostgREST
 *    row, so switching `source` from `"local-seed"` to `"supabase"` changes
 *    nothing downstream.
 * 3. **Builders, never module-level constants.** Every export is a function
 *    returning a *fresh* array/object. A shared mutable literal would let one
 *    caller's `.sort()` corrupt the next caller's data.
 *
 * ## Where these numbers come from
 *
 * All of them are the display values in `lib/azura-world-data.ts` (W0-B's
 * generated dataset, harvested 2026-07-27), transcribed rather than imported:
 * that module is 1.5 MB and a seed file must stay safe to pull into any bundle.
 * The upstream path is named on each field so drift is findable.
 *
 * **Every id, code and string below matches `supabase/seed.sql` (W1-A's file)
 * row for row**, checked against it on 2026-07-27. That is deliberate: with two
 * seeds in the repository, the only thing worse than one of them being wrong is
 * the two of them disagreeing. A deep link by hotel id or review-source id
 * resolves identically in local-seed mode and against a seeded database.
 * `hotel_rooms` is empty in both.
 *
 * Two of these figures are **conflicted**, not settled — the value here is the
 * highest-tier one, and the losing value is retained upstream in the
 * `SourcedFact.conflictsWith` array, never discarded:
 *
 * - `roomCount` 188 — F-022 records 112 from a competing source
 * - `aquaparkSlides` 13 — F-023 records 16
 *
 * And one is a *researched* null:
 *
 * - `brandAffiliation` is `null` because no CURRENT chain affiliation is
 *   asserted by any source. That is an answer, not missing data (F-007 / F-018).
 *   Rendering it as "unknown" without saying the sources disagree misreports it.
 */

import { seedIso } from "@/lib/repository-base"

// ---------------------------------------------------------------------------
// Row shapes — one per table, mapped to camelCase
// ---------------------------------------------------------------------------

/**
 * A row of `hotels`.
 *
 * `checkIn` / `checkOut` are `TIME` columns. PostgREST serialises them as
 * `"14:00:00"` — a wall-clock time with no date and no zone. Do not pass one to
 * `new Date()`; it is not an instant.
 */
export interface HotelRecord {
  id: string
  companyId: string
  siteId: string
  code: string
  name: string
  formerName: string | null
  stars: number | null
  roomCount: number | null
  floors: number | null
  openedYear: number | null
  board: string | null
  aquaparkSlides: number | null
  distanceToBeachM: number | null
  /** `TIME` — `"14:00:00"`, not an instant. */
  checkIn: string | null
  /** `TIME` — `"12:00:00"`, not an instant. */
  checkOut: string | null
  /**
   * `null` is the researched answer (F-007 / F-018), not a gap. The only source
   * naming a chain is a 2023 press report of a Wyndham licence; the hotel's own
   * site names none in 2026. Never render this as a bare "unknown".
   */
  brandAffiliation: string | null
  createdAt: string
  updatedAt: string
}

/** A row of `hotel_rooms`. `UNIQUE(hotel_id, code)`. */
export interface HotelRoomRecord {
  id: string
  hotelId: string
  code: string
  name: string | null
  roomType: string | null
  roomCount: number | null
  /** `numeric(8,2)` — arrives as a string from PostgREST, parsed on the way in. */
  interiorM2: number | null
  maxOccupancy: number | null
  hasSeaView: boolean | null
  sourceUrl: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/**
 * The three-bucket sentiment split from CONTRACTS §2. Stored inside the
 * `review_sources.sentiment` jsonb alongside the platform's own finer buckets,
 * which stay reachable on `ReviewSourceRecord.sentimentRaw`.
 */
export interface ReviewSentiment {
  positive: number
  mixed: number
  negative: number
}

/**
 * A row of `review_sources`.
 *
 * **Keyed on `url`, not `platform`.** Two rows legitimately carry
 * `platform = "tripadvisor"`: OnTheBeach re-serves the same Tripadvisor widget
 * (same location id `33144231`) under its own host. Deduping by platform would
 * silently delete a row that is genuinely a distinct capture — and would also
 * hide F-016, which is the whole point of keeping both.
 */
export interface ReviewSourceRecord {
  id: string
  hotelId: string
  /** The platform that *produced* the score, not the host that served it. */
  platform: string
  /** The unique key of this table. */
  url: string
  /** The host that served it. Differs from `platform` in the F-016 case. */
  publisher: string | null
  /** `numeric(4,2)` — string on the wire. Meaningless without `scoreScale`. */
  score: number | null
  /**
   * `5` or `10`, enforced by a CHECK on a NOT NULL column.
   *
   * `null` here therefore means the row broke that constraint, and the
   * repository refuses to normalise a score whose scale it does not know rather
   * than guessing one. 4.6 means nothing without its scale.
   */
  scoreScale: 5 | 10 | null
  reviewCount: number | null
  ranking: string | null
  /** The contract's three buckets, or `null` when the jsonb lacks any of them. */
  sentiment: ReviewSentiment | null
  /** The whole jsonb. Tripadvisor's excellent/good/average/poor/terrible live here. */
  sentimentRaw: Record<string, unknown> | null
  fetchedAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * A row of `review_quotes`. Verbatim guest text with a permalink — never
 * paraphrased, never rendered through `dangerouslySetInnerHTML`.
 */
export interface ReviewQuoteRecord {
  id: string
  reviewSourceId: string
  /** Permalink to the individual review. The unique key of this table. */
  url: string
  quoteText: string
  rating: number | null
  /** The platform's own label, verbatim: `"Jul 21"`, `"May 2026"`. */
  quotedAtLabel: string | null
  /**
   * `date`, or `null` when the label does not pin one. `"Jul 21"` has no year
   * and `"May 2026"` has no day; inventing either would be a fabricated date.
   */
  quotedOn: string | null
  createdAt: string
}

// ---------------------------------------------------------------------------
// Fixed identifiers — the same literals `supabase/seed.sql` inserts.
//
// Literal UUIDs, not generated: a seed row whose id changes between runs breaks
// every snapshot that references it, and an id that differs from the SQL seed
// breaks every deep link when the database comes online.
// ---------------------------------------------------------------------------

export const SEED_COMPANY_ID = "11111111-1111-4111-8111-111111111111"
export const SEED_SITE_ID = "22222222-2222-4222-8222-222222222222"
export const SEED_HOTEL_ID = "33333333-3333-4333-8333-333333333333"
export const SEED_HOTEL_CODE = "AZW-HOTEL"

const SEED_REVIEW_SOURCE_ONTHEBEACH = "55555555-5555-4555-8555-555555555501"
const SEED_REVIEW_SOURCE_TRIPADVISOR = "55555555-5555-4555-8555-555555555502"
const SEED_REVIEW_SOURCE_BOOKING = "55555555-5555-4555-8555-555555555503"

const TRIPADVISOR_URL =
  "https://www.tripadvisor.com/Hotel_Review-g1069655-d33144231-Reviews-Azura_World_Hotel-Turkler_Alanya_Turkish_Mediterranean_Coast.html"
const ONTHEBEACH_URL =
  "https://www.onthebeach.co.uk/hotels/turkey/antalya/alanya/azura-world-hotel"
const BOOKING_BADGE_URL = "https://wyndham.antalyacoast.com/en/"

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * The hotel. Every figure below is `azuraWorldDataset.hotel.<field>.value`.
 *
 * `formerName` is "Wyndham Alanya" and `brandAffiliation` is `null` at the same
 * time, deliberately: the property was licensed to Wyndham in 2023 and carries
 * no chain today. Both statements are sourced; neither cancels the other.
 */
export function seedHotel(): HotelRecord {
  return {
    id: SEED_HOTEL_ID,
    companyId: SEED_COMPANY_ID,
    siteId: SEED_SITE_ID,
    code: SEED_HOTEL_CODE,
    name: "Azura World Hotel",
    formerName: "Wyndham Alanya",
    stars: 5,
    // Conflicted upstream: 188 (displayed, higher tier) vs 112. See F-022.
    roomCount: 188,
    floors: 6,
    openedYear: 2025,
    board: "All-Inclusive",
    // Conflicted upstream: 13 (displayed, higher tier) vs 16. See F-023.
    aquaparkSlides: 13,
    distanceToBeachM: 1000,
    // The dataset states "14:00"/"12:00"; the TIME column renders seconds.
    checkIn: "14:00:00",
    checkOut: "12:00:00",
    brandAffiliation: null,
    createdAt: seedIso(-30),
    updatedAt: seedIso(0),
  }
}

/**
 * **Empty, and that is the correct answer.**
 *
 * No harvested source publishes a room-type breakdown for this property — only
 * the 188-room total, which lives on `HotelRecord.roomCount`. Seeding invented
 * room types ("Standard 24 m², 60 rooms") to make a panel render is exactly the
 * fabrication SYSTEM-PROMPT §2.3 forbids: a plausible-looking made-up figure is
 * worse than a visible gap.
 *
 * `getHotelRooms()` returns this inside a shape that says so, so the UI can
 * render "no published breakdown" rather than an empty table that reads like a
 * loading bug.
 */
export function seedHotelRooms(): HotelRoomRecord[] {
  return []
}

/**
 * Three review sources, keyed on URL.
 *
 * Two of them are `platform: "tripadvisor"`. That is **F-016**: OnTheBeach
 * embeds the Tripadvisor widget for the same location id, so its 4.6/5 is not an
 * independent second opinion. Each score is filed under the platform that
 * produced it rather than the host that served it — filing OnTheBeach's under
 * "onthebeach" would have made two hosts agree and wrongly promoted the score to
 * `confidence: "confirmed"` under CONTRACTS §1 invariant 3.
 *
 * The third is a Booking.com badge on the *dead brand's* page, scored out of 10
 * from 10 reviews. Do not average it into the others without saying so.
 */
export function seedReviewSources(): ReviewSourceRecord[] {
  return [
    {
      id: SEED_REVIEW_SOURCE_TRIPADVISOR,
      hotelId: SEED_HOTEL_ID,
      platform: "tripadvisor",
      url: TRIPADVISOR_URL,
      publisher: "Tripadvisor",
      score: 4.6,
      scoreScale: 5,
      reviewCount: 359,
      // Verbatim from the platform, which writes "Turkler" without the dotless
      // ı. Not "corrected" to Türkler here: this is a quoted string, and
      // `supabase/seed.sql` stores the same bytes.
      ranking: "#10 of 33 hotels in Turkler",
      sentiment: { positive: 312, mixed: 19, negative: 19 },
      sentimentRaw: {
        excellent: 269,
        good: 43,
        average: 19,
        poor: 8,
        terrible: 11,
        positive: 312,
        mixed: 19,
        negative: 19,
      },
      fetchedAt: seedIso(0, 14),
      createdAt: seedIso(-7),
      updatedAt: seedIso(0, 14),
    },
    {
      id: SEED_REVIEW_SOURCE_ONTHEBEACH,
      hotelId: SEED_HOTEL_ID,
      // Not "onthebeach": the score is a syndicated Tripadvisor widget. F-016.
      platform: "tripadvisor",
      url: ONTHEBEACH_URL,
      publisher: "OnTheBeach",
      score: 4.6,
      scoreScale: 5,
      reviewCount: 357,
      // The page states no ranking. `null`, never "unranked".
      ranking: null,
      sentiment: null,
      sentimentRaw: null,
      fetchedAt: seedIso(0, 14),
      createdAt: seedIso(-7),
      updatedAt: seedIso(0, 14),
    },
    {
      id: SEED_REVIEW_SOURCE_BOOKING,
      hotelId: SEED_HOTEL_ID,
      platform: "booking",
      url: BOOKING_BADGE_URL,
      publisher: "Wyndham Alanya (antalyacoast)",
      score: 6.7,
      // Out of TEN. 6.7 next to 4.6 without both scales is a misread waiting to
      // happen — `getReviewSummary()` always reports the scale it normalised to.
      scoreScale: 10,
      reviewCount: 10,
      ranking: null,
      sentiment: null,
      sentimentRaw: null,
      fetchedAt: seedIso(0, 14),
      createdAt: seedIso(-7),
      updatedAt: seedIso(0, 14),
    },
  ]
}

/**
 * A two-row verbatim sample, both Tripadvisor permalinks that also appear in
 * `supabase/seed.sql` (which carries five and lets Postgres generate the ids, so
 * only the URL — the table's unique key — is stable across the two seeds).
 *
 * **This sample is not a sentiment distribution.** Two 4–5 star quotes are not
 * evidence that the property is 4–5 stars; the captured spread is materially
 * more critical than the headline aggregate. Any UI showing an average must take
 * its distribution from `ReviewSourceRecord.sentiment` / `sentimentRaw`, never
 * by counting these rows.
 *
 * `quotedOn` is `null` on both: "Jul 21" states no year and "May 2026" states no
 * day. The verbatim label is kept on `quotedAtLabel` instead of a guessed date,
 * which is also what the table's `review_quotes_parsed_date_needs_label`
 * constraint is there to keep true.
 */
export function seedReviewQuotes(): ReviewQuoteRecord[] {
  return [
    {
      id: "00000000-0000-4000-8000-000000000421",
      reviewSourceId: SEED_REVIEW_SOURCE_TRIPADVISOR,
      url: "https://www.tripadvisor.com/ShowUserReviews-g1069655-d33144231-r1061190498-Azura_World_Hotel-Turkler_Alanya_Turkish_Mediterranean_Coast.html",
      quoteText:
        "We had a wonderful stay here. Staff were amazing and couldn’t do enough for us we had an sen child and sanemsii and Tulane and Han were sen trained and built up her confidence and had her dancing in no time. Big thank you to the animation team for being fantastic",
      rating: 5,
      quotedAtLabel: "May 2026",
      quotedOn: null,
      createdAt: seedIso(-7),
    },
    {
      id: "00000000-0000-4000-8000-000000000422",
      reviewSourceId: SEED_REVIEW_SOURCE_TRIPADVISOR,
      url: "https://www.tripadvisor.com/ShowUserReviews-g1069655-d33144231-r1069359234-Azura_World_Hotel-Turkler_Alanya_Turkish_Mediterranean_Coast.html",
      quoteText:
        "Overall, most things at the hotel were successful; it's a quiet, relaxing family hotel. The food was above average, and the alcoholic drinks and cocktails were excellent. We'd like to thank Mert at the lobby bar, and Osman's attention was also very nice. The only downside was that the animation was a bit simple; other than that, we didn't have any problems.",
      rating: 4,
      quotedAtLabel: "Jul 21",
      quotedOn: null,
      createdAt: seedIso(-7),
    },
  ]
}
