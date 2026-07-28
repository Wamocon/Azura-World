/**
 * Hotel & review selectors — pure derivation over the harvested dataset.
 *                                                            Owner: W3-G
 *
 * Everything the hotel surfaces render is derived here, and it is deliberately
 * a separate module from the components so that one property of this file can
 * be checked by reading it end to end:
 *
 *   ## THERE IS NO CROSS-PLATFORM AVERAGE IN THIS MODULE. THERE CANNOT BE ONE.
 *
 * A 4.6/5 and a 6.7/10 are not commensurable. Combining them — by mean, by
 * median, by normalising both to a percentage and averaging that — invents a
 * number that no source published and attaches this project's credibility to
 * it. tasks/W3-G is explicit: "Never average across platforms."
 *
 * So the rule is structural rather than remembered:
 *
 *   - No function here returns a single score across more than one platform.
 *   - `PlatformScore` carries `score` AND `scale` together, always, in one
 *     object. There is no code path that produces a bare number, so there is
 *     nothing for an averaging expression downstream to reach for.
 *   - The only arithmetic on scores is `Math.max`/`Math.min` over RATINGS
 *     WITHIN one platform's own quote list (`splitVerdict`), which selects a
 *     real review rather than computing a new value.
 *
 * `pnpm --dir apps/web exec eslint` and a grep for `reduce`/`/ length` over
 * this directory are how that claim is checked; the result is pasted in
 * HANDOFF/W3-G.md.
 *
 * ## F-016 — why platforms are grouped by PRODUCER, not by host
 *
 * OnTheBeach does not publish a guest score. The 4.6/5 on its page is an
 * embedded Tripadvisor widget carrying the same Tripadvisor location id
 * (33144231) as the direct capture. Filed under its serving host it would look
 * like a second, independent platform agreeing — and under CONTRACTS §1
 * invariant 3, two distinct hosts agreeing is exactly what promotes a fact to
 * "confirmed". One opinion would have been laundered into corroboration.
 *
 * `groupByProducer()` therefore returns ONE entry per producing platform, with
 * every capture of it listed underneath. The reseller is visible — it is
 * evidence about how review scores propagate — but it is never a second score.
 */

import type {
  AzuraHarvestEntry,
  AzuraReview,
  AzuraReviewPlatform,
  AzuraReviewQuote,
  AzuraReviewSentiment,
  AzuraScoreScale,
  AzuraSourcedFact,
  AzuraSourceRef,
} from "@/lib/azura-world-data"

// ---------------------------------------------------------------------------
// Platform grouping
// ---------------------------------------------------------------------------

/** One capture of a platform's score — the score as one host served it. */
export interface PlatformCapture {
  /** The host that served this capture. May differ from the producer (F-016). */
  publisher: string
  url: string
  fetchedAt: string | null
  review: AzuraReview
  /** True when the serving host IS the producing platform. */
  isFirstParty: boolean
}

export interface PlatformGroup {
  platform: AzuraReviewPlatform
  /**
   * The capture whose figures the page shows. Chosen, never computed:
   * first-party first, then the capture with the most reviews behind it.
   * A selection points at a real published number; an average would not.
   */
  primary: PlatformCapture
  /** Every other capture of the SAME producer's score. Never a second opinion. */
  syndicated: PlatformCapture[]
  /** Score and scale travel together. There is no bare score anywhere. */
  scale: AzuraScoreScale
}

/** Hosts that publish a score under their own name, per producing platform. */
const FIRST_PARTY_HOST: Record<AzuraReviewPlatform, string> = {
  tripadvisor: "tripadvisor.com",
  booking: "booking.com",
  agoda: "agoda.com",
  onthebeach: "onthebeach.co.uk",
  google: "google.com",
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "")
  } catch {
    return ""
  }
}

function firstSource(review: AzuraReview): AzuraSourceRef | null {
  return review.score.sources[0] ?? review.reviewCount.sources[0] ?? null
}

/**
 * Group review captures by the platform that PRODUCED the score.
 *
 * Returns one group per producer. Ordering is deterministic — most reviews
 * first — so the page renders identically on every request.
 */
export function groupByProducer(
  reviews: readonly AzuraReview[]
): PlatformGroup[] {
  const byPlatform = new Map<AzuraReviewPlatform, PlatformCapture[]>()

  for (const review of reviews) {
    const ref = firstSource(review)
    const capture: PlatformCapture = {
      publisher: ref?.publisher ?? hostOf(review.url),
      url: review.url,
      fetchedAt: ref?.fetchedAt ?? null,
      review,
      isFirstParty: hostOf(review.url) === FIRST_PARTY_HOST[review.platform],
    }
    const existing = byPlatform.get(review.platform)
    if (existing) existing.push(capture)
    else byPlatform.set(review.platform, [capture])
  }

  const groups: PlatformGroup[] = []

  for (const [platform, captures] of byPlatform) {
    // Selection, not computation. Sort is total and deterministic.
    const ordered = [...captures].sort((a, b) => {
      if (a.isFirstParty !== b.isFirstParty) return a.isFirstParty ? -1 : 1
      const countA = a.review.reviewCount.value ?? 0
      const countB = b.review.reviewCount.value ?? 0
      if (countA !== countB) return countB - countA
      return a.url.localeCompare(b.url)
    })
    const primary = ordered[0]
    if (primary === undefined) continue
    groups.push({
      platform,
      primary,
      syndicated: ordered.slice(1),
      scale: primary.review.scoreScale,
    })
  }

  return groups.sort((a, b) => {
    const countA = a.primary.review.reviewCount.value ?? 0
    const countB = b.primary.review.reviewCount.value ?? 0
    if (countA !== countB) return countB - countA
    return a.platform.localeCompare(b.platform)
  })
}

// ---------------------------------------------------------------------------
// The split verdict — the mechanism that makes the default view balanced
// ---------------------------------------------------------------------------

export interface SplitVerdict {
  best: AzuraReviewQuote | null
  worst: AzuraReviewQuote | null
  /** True when best and worst resolved to the same quote — one review only. */
  degenerate: boolean
  /** Quotes carrying no readable rating; excluded from the pick, never dropped. */
  unratedCount: number
}

/**
 * Pick the highest- and lowest-rated quote.
 *
 * This is how "the default view is balanced" is ENFORCED rather than promised.
 * tasks/W3-G: "the quote list must show both extremes by default, not the
 * positive ones with negatives behind a filter." A component that renders
 * `verdict.best` and `verdict.worst` side by side cannot be positive-only,
 * because `worst` is computed by `Math.min` over the same array. There is no
 * ordering of the input, and no filter state, that produces two positive
 * quotes — the only way to break it is to delete the `worst` column, which is
 * visible in review.
 *
 * Quotes with `rating: null` are excluded from the extremes (a null rating
 * means the bubble count could not be read positionally, and guessing it would
 * distort a real person's review) but they are still counted and still
 * rendered in the full list.
 */
export function splitVerdict(
  quotes: readonly AzuraReviewQuote[]
): SplitVerdict {
  const rated = quotes.filter(
    (quote): quote is AzuraReviewQuote & { rating: number } =>
      quote.rating !== null
  )
  const unratedCount = quotes.length - rated.length

  if (rated.length === 0) {
    return { best: null, worst: null, degenerate: false, unratedCount }
  }

  // Deterministic tie-break on the published date string, then the URL, so the
  // same dataset always yields the same pair.
  const byRating = [...rated].sort((a, b) => {
    if (a.rating !== b.rating) return a.rating - b.rating
    return a.url.localeCompare(b.url)
  })

  const worst = byRating[0] ?? null
  const best = byRating[byRating.length - 1] ?? null

  return {
    best,
    worst,
    degenerate:
      rated.length === 1 ||
      (best !== null && worst !== null && best.url === worst.url),
    unratedCount,
  }
}

/**
 * Order the full quote list so the extremes stay reachable without scrolling
 * past a wall of praise: worst first, then best, then the rest by rating
 * descending. The list is never filtered here — narrowing is the user's to do.
 */
export function orderQuotes(
  quotes: readonly AzuraReviewQuote[]
): AzuraReviewQuote[] {
  const verdict = splitVerdict(quotes)
  const pinned = [verdict.worst, verdict.best].filter(
    (quote): quote is AzuraReviewQuote => quote !== null
  )
  const pinnedUrls = new Set(pinned.map((quote) => quote.url))
  const rest = quotes
    .filter((quote) => !pinnedUrls.has(quote.url))
    .sort((a, b) => {
      const ratingA = a.rating ?? -1
      const ratingB = b.rating ?? -1
      if (ratingA !== ratingB) return ratingB - ratingA
      return a.url.localeCompare(b.url)
    })
  return [...pinned, ...rest]
}

// ---------------------------------------------------------------------------
// Sentiment
// ---------------------------------------------------------------------------

export interface SentimentBucket {
  key: "excellent" | "good" | "average" | "poor" | "terrible"
  count: number
  /** Share of the graded total, 0–1. Presentational only. */
  share: number
  tone: "positive" | "mixed" | "negative"
}

export interface SentimentBreakdown {
  buckets: SentimentBucket[]
  total: number
  positive: number
  mixed: number
  negative: number
  /** True when the platform published only the three-way fold. */
  foldOnly: boolean
}

const BUCKET_TONE: Record<SentimentBucket["key"], SentimentBucket["tone"]> = {
  excellent: "positive",
  good: "positive",
  average: "mixed",
  poor: "negative",
  terrible: "negative",
}

const BUCKET_ORDER: SentimentBucket["key"][] = [
  "excellent",
  "good",
  "average",
  "poor",
  "terrible",
]

/**
 * Expand a platform's own distribution.
 *
 * `share` is a proportion WITHIN one platform — it is not a score, it is not
 * comparable to another platform's share, and nothing downstream combines two
 * of them. Returns `null` when the platform published no distribution, so the
 * caller renders a gap rather than a zeroed bar. An empty bar reads as
 * "nobody complained"; a gap reads as "not established", and only one of those
 * is true.
 */
export function sentimentBreakdown(
  sentiment: AzuraReviewSentiment | null
): SentimentBreakdown | null {
  if (sentiment === null) return null

  const counts = BUCKET_ORDER.map((key) => ({
    key,
    count: sentiment[key] ?? 0,
  }))
  const graded = counts.reduce((sum, entry) => sum + entry.count, 0)
  const foldOnly = graded === 0

  if (foldOnly) {
    const fold = sentiment.positive + sentiment.mixed + sentiment.negative
    if (fold === 0) return null
    return {
      buckets: [],
      total: fold,
      positive: sentiment.positive,
      mixed: sentiment.mixed,
      negative: sentiment.negative,
      foldOnly: true,
    }
  }

  return {
    buckets: counts.map((entry) => ({
      key: entry.key,
      count: entry.count,
      share: entry.count / graded,
      tone: BUCKET_TONE[entry.key],
    })),
    total: graded,
    positive: sentiment.positive,
    mixed: sentiment.mixed,
    negative: sentiment.negative,
    foldOnly: false,
  }
}

// ---------------------------------------------------------------------------
// Reachability — a platform that was never recovered is NOT a platform with
// no reviews. Both render, and they must never render the same way.
// ---------------------------------------------------------------------------

export interface PlatformReachability {
  publisher: string
  url: string
  /** HTTP status, or the transport label the harvester recorded. */
  status: string
  fetchedAt: string
  contentValidated: boolean
}

const BOOKING_HOSTS = ["booking.com", "agoda.com"]

/**
 * Booking platforms the harvest attempted and did not recover.
 *
 * tasks/W3-G: "if W0-B's harvest did not recover them, render them as
 * unreachable with their snapshot status, not as missing." A blank cell is
 * indistinguishable from a platform nobody tried, which is the difference
 * between "we looked and were blocked" and "we did not look".
 */
export function unrecoveredBookingSources(
  harvest: readonly AzuraHarvestEntry[]
): PlatformReachability[] {
  return harvest
    .filter((entry) => {
      const host = hostOf(entry.url)
      return (
        BOOKING_HOSTS.some((booking) => host.endsWith(booking)) &&
        !entry.contentValidated
      )
    })
    .map((entry) => ({
      publisher: entry.publisher,
      url: entry.url,
      status: String(entry.status),
      fetchedAt: entry.fetchedAt,
      contentValidated: entry.contentValidated,
    }))
    .sort((a, b) => a.url.localeCompare(b.url))
}

/** Total quotes across the set — a count of rows, never a score. */
export function totalQuotes(reviews: readonly AzuraReview[]): number {
  return reviews.reduce((sum, review) => sum + review.notableQuotes.length, 0)
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

/**
 * Renders a review score at its published precision.
 *
 * ## The bug this exists to fix
 *
 * `ProvenanceValue format="number"` routes through W1-D's `formatNumber()`,
 * which defaults to `maximumFractionDigits: 0`. That default is right for
 * everything it was built for — room counts, unit counts, areas in m², all
 * whole numbers — and wrong for a review score, which is fractional by nature.
 *
 * The observed result before this fix, in the served HTML:
 *
 *     Tripadvisor  4.6  →  rendered "5 / 5"
 *     Booking.com  6.7  →  rendered "7 / 10"
 *
 * A 4.6 presented as a 5 is not a rounding preference. It is the hotel's score
 * improved by 0.4 on a five-point scale, on the page whose entire purpose is
 * refusing to flatter this property — and "7 / 10" is worse, because it reads
 * as a different and rounder claim than 6.7 ever made.
 *
 * ## Why the fix is here and not in `format.ts`
 *
 * `components/evidence/format.ts` belongs to W1-D. The proper fix is a
 * `maximumFractionDigits` passthrough or a `score` format there, and that is
 * filed as a request in HANDOFF/W3-G.md. Reaching into another window's
 * component to change a shared default — one that every other surface is
 * currently relying on — is exactly what SYSTEM-PROMPT §4.1 forbids.
 *
 * So the score is formatted here and handed to `ProvenanceValue` as a
 * `text` fact. Everything else about the fact is preserved unchanged: the
 * sources, the confidence, the note and any competing values, so the badge,
 * the chips and the conflict popover all behave exactly as they would have.
 * Only the digits are ours.
 */
export function scoreAsDisplayFact(
  fact: AzuraSourcedFact<number>,
  locale: string
): AzuraSourcedFact<string> {
  const format = (value: unknown): string =>
    typeof value === "number"
      ? new Intl.NumberFormat(locale, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }).format(value)
      : String(value)

  const conflicts = fact.conflictsWith

  return {
    ...fact,
    value: fact.value === null ? null : format(fact.value),
    // `exactOptionalPropertyTypes` is on: the key is spread in only when it
    // exists, because `conflictsWith: undefined` is not assignable to an
    // optional property.
    ...(conflicts === undefined
      ? {}
      : {
          conflictsWith: conflicts.map((entry) => ({
            ...entry,
            value: format(entry.value),
          })),
        }),
  }
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * Formats an ISO timestamp as a date in the active locale.
 *
 * ## Why this is a duplicate, and what should happen to it
 *
 * `components/evidence/source-chip.tsx` exports an identical `formatFetchedAt`.
 * It is a pure function — no React, no browser API, nothing that needs a
 * client — but that file carries `"use client"` for the `SourceChip` component
 * beside it, so the whole module is a client module and calling the function
 * from a Server Component throws at request time:
 *
 *     Attempted to call formatFetchedAt() from the server but
 *     formatFetchedAt is on the client.
 *
 * That error appears in **neither typecheck, nor lint, nor build** — all three
 * were green while every one of these pages returned a 500. It surfaced only
 * under `next start`, which is exactly why HANDOFF/W-INT.md §8 makes running
 * the production server a precondition for claiming a page works.
 *
 * The fix belongs in W1-D's module, not here: `components/evidence/format.ts`
 * is already server-safe and is where this function should live, after which
 * `source-chip.tsx` re-exports it and this copy is deleted. That is a change
 * to a file W3-G does not own, so it is a request in HANDOFF/W3-G.md rather
 * than a reach-across (SYSTEM-PROMPT §4.1).
 *
 * Behaviour is kept byte-identical to W1-D's, including the failure mode: an
 * unparseable date renders the raw string rather than "Invalid Date", so a
 * parser bug stays visible instead of being hidden behind a placeholder.
 */
export function formatFetchedDate(iso: string, locale: string): string {
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return iso
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(parsed))
}
