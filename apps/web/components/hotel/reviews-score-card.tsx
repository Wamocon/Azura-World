import {
  CalendarClock,
  ExternalLink,
  Repeat2,
  Star,
  Trophy,
} from "lucide-react"
import type { ReactNode } from "react"

import { Explain, type ExplainLabels } from "@/components/ui/explain"
import { cn } from "@/lib/cn"
import { intlLocaleTag } from "@/lib/format"
import type { ReviewSourceRecord } from "@/lib/hotel-data"

import { formatFetchedDate } from "./select"

/**
 * One review platform as a card, on its own scale.        Owner: dashboard/reviews
 *
 * The dashboard used to render every captured row in one table, which made a
 * 4,6 and a 6,7 sit in the same column and invited exactly the arithmetic this
 * module forbids. The card puts each platform's score back beside the scale it
 * was published on, at a size a reader takes in without reading a header row.
 *
 * ## Three things the shape enforces
 *
 * **1. The scale never leaves the score.** `ReviewSourceRecord` carries `score`
 * and `scoreScale` in one row and this component renders them as one unit,
 * "4,6 / 5". There is no prop through which a caller could hand in a combined
 * figure, and there is no arithmetic here that crosses two platforms.
 *
 * **2. The meter has one segment per scale point.** A five-point score draws
 * five segments and a ten-point score draws ten, so the two are visibly not the
 * same ruler. A single normalised bar (both filled to a percentage) was the
 * other option and is the one that would quietly re-introduce the comparison the
 * page refuses.
 *
 * **3. A syndicated capture is never a second platform.** OnTheBeach re-serves
 * Tripadvisor's 4.6/5 through a widget on the same location id (F-016). Two
 * cards would read as two sites agreeing, and under CONTRACTS §1 invariant 3
 * two distinct hosts agreeing is what promotes a fact to "confirmed". So
 * `groupReviewSourcesByProducer()` returns one card per producing platform and
 * lists the re-serving hosts inside it, labelled as the same number again.
 *
 * ## The distribution is the platform's own, or it is absent
 *
 * Tripadvisor publishes 269 excellent / 43 good / 19 average / 8 poor / 11
 * terrible. Booking publishes no split at all. The card draws the first and says
 * "no split published" for the second. It never derives a distribution from a
 * score, and it never renders an empty bar, because an empty bar reads as
 * "nobody complained".
 */

// ---------------------------------------------------------------------------
// Grouping — by the platform that PRODUCED the score, never the host that
// served it.
// ---------------------------------------------------------------------------

export interface ReviewPlatformGroup {
  platform: string
  /** The capture whose figures the card shows. Chosen, never computed. */
  primary: ReviewSourceRecord
  /**
   * Every other capture carrying the SAME figure on the SAME scale. Never a
   * second opinion — and never a *different* number, which is why the equality
   * is checked rather than assumed: the card tells the reader these hosts show
   * "the same score", and that sentence has to be true.
   */
  syndicated: ReviewSourceRecord[]
}

/** Same number on the same ruler. Two nulls are not "the same figure". */
function sameFigure(a: ReviewSourceRecord, b: ReviewSourceRecord): boolean {
  return (
    a.score !== null &&
    b.score !== null &&
    a.score === b.score &&
    a.scoreScale !== null &&
    a.scoreScale === b.scoreScale
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "")
  } catch {
    return ""
  }
}

/**
 * True when the host that served the capture is the platform itself.
 *
 * Exported so the source table decides "re-served" the same way the cards do.
 * Comparing `publisher` to `platform` as strings does not work: the Tripadvisor
 * row carries `publisher: "Tripadvisor"` against `platform: "tripadvisor"`, so a
 * case-sensitive `!==` badges the *direct* capture as syndicated — a false
 * provenance claim on the one page that exists to get provenance right.
 */
export function isFirstParty(source: ReviewSourceRecord): boolean {
  const host = hostOf(source.url).toLowerCase()
  return host.length > 0 && host.includes(source.platform.toLowerCase())
}

/**
 * One group per producing platform, most-reviewed first.
 *
 * Ordering is total and deterministic — first-party capture first, then the
 * capture standing on the most reviews, then the URL — so the page renders the
 * same way on every request and a snapshot stays stable.
 */
export function groupReviewSourcesByProducer(
  sources: readonly ReviewSourceRecord[]
): ReviewPlatformGroup[] {
  const byPlatform = new Map<string, ReviewSourceRecord[]>()
  for (const source of sources) {
    const existing = byPlatform.get(source.platform)
    if (existing === undefined) byPlatform.set(source.platform, [source])
    else existing.push(source)
  }

  const groups: ReviewPlatformGroup[] = []
  for (const [platform, captures] of byPlatform) {
    const ordered = [...captures].sort((a, b) => {
      const firstA = isFirstParty(a)
      const firstB = isFirstParty(b)
      if (firstA !== firstB) return firstA ? -1 : 1
      const countA = a.reviewCount ?? 0
      const countB = b.reviewCount ?? 0
      if (countA !== countB) return countB - countA
      return a.url.localeCompare(b.url)
    })
    // A capture of the same platform that carries a DIFFERENT figure is not
    // "the same score shown again" and must not be folded away under that
    // sentence — the reader would never see the number it actually serves. It
    // gets its own card, where the two figures visibly disagree, which is the
    // honest outcome and not the invariant-3 hazard (disagreeing captures do
    // not promote anything to "confirmed").
    let remaining: ReviewSourceRecord[] = ordered
    while (remaining.length > 0) {
      const primary = remaining[0]
      if (primary === undefined) break
      const matched: ReviewSourceRecord[] = []
      const deferred: ReviewSourceRecord[] = []
      for (const capture of remaining.slice(1)) {
        if (sameFigure(primary, capture)) matched.push(capture)
        else deferred.push(capture)
      }
      groups.push({ platform, primary, syndicated: matched })
      remaining = deferred
    }
  }

  return groups.sort((a, b) => {
    const countA = a.primary.reviewCount ?? 0
    const countB = b.primary.reviewCount ?? 0
    if (countA !== countB) return countB - countA
    if (a.platform !== b.platform) return a.platform.localeCompare(b.platform)
    return a.primary.url.localeCompare(b.primary.url)
  })
}

// ---------------------------------------------------------------------------
// Distribution — read off the platform's own published split, or null.
// ---------------------------------------------------------------------------

const GRADED_KEYS = [
  "excellent",
  "good",
  "average",
  "poor",
  "terrible",
] as const
const FOLD_KEYS = ["positive", "mixed", "negative"] as const

export type ReviewsBucketKey =
  (typeof GRADED_KEYS)[number] | (typeof FOLD_KEYS)[number]

type BucketTone = "positive" | "mixed" | "negative"

const BUCKET_TONE: Record<ReviewsBucketKey, BucketTone> = {
  excellent: "positive",
  good: "positive",
  average: "mixed",
  poor: "negative",
  terrible: "negative",
  positive: "positive",
  mixed: "mixed",
  negative: "negative",
}

const TONE_FILL: Record<BucketTone, string> = {
  positive: "bg-confidence-confirmed",
  mixed: "bg-confidence-inferred",
  negative: "bg-confidence-conflicted",
}

interface ReviewsBucket {
  key: ReviewsBucketKey
  count: number
  /** Share within THIS platform, 0 to 1. Presentational, never a score. */
  share: number
}

interface ReviewsDistribution {
  buckets: ReviewsBucket[]
  /** The sum of the published buckets. Not the platform's review count. */
  total: number
}

/**
 * The published count for one bucket, or `null` when the platform did not
 * publish that bucket at all.
 *
 * A published `0` and an absent key are different facts and must not collapse
 * into the same rendered "0": drawing "terrible 0" for a platform that never
 * stated a "terrible" bucket writes a figure nobody published.
 */
function countAt(
  raw: Record<string, unknown> | null,
  key: string
): number | null {
  if (raw === null) return null
  const value = raw[key]
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null
}

/**
 * The platform's own split, five buckets where it published five and three
 * where it published only the fold. `null` when it published neither, which the
 * card renders as "no split published" rather than as a bar of zeroes.
 */
export function reviewDistribution(
  source: ReviewSourceRecord
): ReviewsDistribution | null {
  // All five, or none of them. A platform that published three of the five
  // buckets has not published a distribution, and inventing the missing two as
  // zeroes would say "nobody rated it poor" on its behalf.
  const graded = GRADED_KEYS.map((key) => countAt(source.sentimentRaw, key))
  const gradedComplete = graded.every((count) => count !== null)
  let gradedTotal = 0
  if (gradedComplete) for (const count of graded) gradedTotal += count ?? 0

  if (gradedComplete && gradedTotal > 0) {
    return {
      buckets: GRADED_KEYS.map((key, index) => {
        const count = graded[index] ?? 0
        return { key, count, share: count / gradedTotal }
      }),
      total: gradedTotal,
    }
  }

  const fold = source.sentiment
  if (fold === null) return null
  const foldTotal = fold.positive + fold.mixed + fold.negative
  if (foldTotal <= 0) return null

  return {
    buckets: FOLD_KEYS.map((key) => ({
      key,
      count: fold[key],
      share: fold[key] / foldTotal,
    })),
    total: foldTotal,
  }
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export interface ReviewsScoreCardLabels {
  /** Row heading above the big figure, e.g. "Wertung". */
  scoreLabel: string
  /** Carries {scale} and {platform}; substituted here. */
  scaleCaption: string
  /** Shown instead of a bare number when the scale is unusable. */
  scaleUnknown: string
  reviewsLabel: string
  rankingLabel: string
  fetchedLabel: string
  /** Carries {platform}; substituted here. */
  open: string
  /** The standing "no source states this" wording. */
  notStated: string
  syndicatedHeading: string
  syndicatedNote: string
  /** Carries {publisher}; substituted here. */
  syndicatedBy: string
  distribution: {
    heading: string
    /** Carries {count}; substituted here with a locale-formatted number. */
    totalOf: string
    none: string
    bucket: Record<ReviewsBucketKey, string>
  }
  explain: {
    gap: ExplainLabels
    singleSource: ExplainLabels
    provenance: ExplainLabels
  }
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** A value no source published. Never a zero, never a blank cell. */
function NotStated({
  label,
  explain,
}: {
  label: string
  explain: ExplainLabels
}): ReactNode {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      {label}
      <Explain labels={explain} iconOnly />
    </span>
  )
}

/**
 * One segment per point of the platform's own scale.
 *
 * Five segments for a five-point score and ten for a ten-point one, so the two
 * rulers are visibly different objects. The figure beside it is the accessible
 * content; this is decoration and is hidden from screen readers rather than
 * repeated to them.
 */
function ScoreMeter({
  score,
  scale,
}: {
  score: number
  scale: number
}): ReactNode {
  return (
    <div aria-hidden="true" className="flex items-center gap-1">
      {Array.from({ length: scale }, (_, index) => {
        const fill = Math.min(1, Math.max(0, score - index))
        return (
          <span
            key={index}
            className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
          >
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${(fill * 100).toFixed(1)}%` }}
            />
          </span>
        )
      })}
    </div>
  )
}

function DistributionBars({
  distribution,
  labels,
  locale,
}: {
  distribution: ReviewsDistribution
  labels: ReviewsScoreCardLabels["distribution"]
  locale: string
}): ReactNode {
  const number = new Intl.NumberFormat(intlLocaleTag(locale))

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-mono text-[0.6875rem] tracking-[0.16em] text-muted-foreground uppercase">
          {labels.heading}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {labels.totalOf.replace("{count}", number.format(distribution.total))}
        </p>
      </div>

      <dl className="flex flex-col gap-1.5">
        {distribution.buckets.map((bucket) => (
          <div
            key={bucket.key}
            className="grid grid-cols-[minmax(4.5rem,7rem)_minmax(0,1fr)] items-center gap-x-2.5"
          >
            <dt className="text-xs text-muted-foreground">
              {labels.bucket[bucket.key]}
            </dt>
            {/*
              The bar carries the shape and the number carries the fact. The bar
              is hidden from screen readers rather than duplicated into a label
              they would then hear twice.
            */}
            <dd className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden="true"
                className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
              >
                <span
                  className={cn(
                    "block h-full rounded-full",
                    TONE_FILL[BUCKET_TONE[bucket.key]]
                  )}
                  style={{
                    // True proportion, with a floor so a 3% tail cannot vanish.
                    width: `${(bucket.share * 100).toFixed(2)}%`,
                    minWidth: bucket.count > 0 ? "0.375rem" : "0",
                  }}
                />
              </span>
              <span
                data-numeric
                className="shrink-0 text-xs text-foreground tabular-nums"
              >
                {number.format(bucket.count)}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export function ReviewsScoreCard({
  group,
  platformName,
  labels,
  locale,
  className,
}: {
  group: ReviewPlatformGroup
  /** The platform's display name, already resolved by the caller. */
  platformName: string
  labels: ReviewsScoreCardLabels
  locale: string
  className?: string
}): ReactNode {
  const source = group.primary
  const tag = intlLocaleTag(locale)
  const scale = source.scoreScale
  const score = source.score
  const distribution = reviewDistribution(source)

  // The platform's own precision. Rounding 4,6 to 5 would be this hotel's
  // score improved by 0.4 on the one page that exists to refuse flattery — and
  // the column is `numeric(4,2)`, so capping at one decimal would round a
  // published 8,75 to 8,8. Two decimals is the storage precision; the minimum
  // of one keeps the figure reading as a score rather than a count.
  const formatScore = (value: number): string =>
    new Intl.NumberFormat(tag, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 2,
    }).format(value)

  return (
    <article
      data-slot="reviews-score-card"
      data-platform={source.platform}
      className={cn(
        "azura-edge-light flex flex-col gap-5 rounded-xl border border-border bg-card p-5 sm:p-6",
        className
      )}
    >
      <header className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "grid size-11 shrink-0 place-items-center rounded-xl border border-primary/25",
            "bg-[color-mix(in_srgb,var(--primary)_12%,var(--card))] font-display text-sm",
            // `text-primary` measures 4.02:1 on its own 12% tint — under AA for
            // 14px text. Derived toward --foreground instead of toward black so
            // the same expression moves LIGHTER on the night surface: 5.7:1 by
            // day, comfortably above it at night.
            "tracking-[0.06em] text-[color:color-mix(in_srgb,var(--primary)_75%,var(--foreground))]"
          )}
        >
          {platformName.slice(0, 2).toUpperCase()}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="font-display text-lg leading-tight font-semibold tracking-[-0.015em] text-foreground">
            {platformName}
          </h3>
          <p className="text-xs break-words text-muted-foreground">
            {/* `hostOf` returns "" on an unparseable URL; an empty line under
                the platform name reads as a rendering fault, so say the field
                is not stated instead. */}
            {source.publisher ?? (hostOf(source.url) || labels.notStated)}
          </p>
        </div>
      </header>

      {/*
        Score and scale as ONE object. "/ 5" is part of the value, not a caption
        on it, and there is no code path here that renders the number alone.
      */}
      <div className="flex flex-col gap-2.5">
        <p className="font-mono text-[0.6875rem] tracking-[0.16em] text-muted-foreground uppercase">
          {labels.scoreLabel}
        </p>

        {scale === null ? (
          // A score with no scale is not rendered as a number. 4,6 means
          // nothing without its scale, and a reader will assume it is out of 5.
          <p className="text-sm text-muted-foreground">{labels.scaleUnknown}</p>
        ) : score === null ? (
          <p className="text-sm">
            <NotStated label={labels.notStated} explain={labels.explain.gap} />
          </p>
        ) : (
          <>
            <p className="flex items-baseline gap-1.5">
              <span
                data-numeric
                className="font-display text-[2.75rem] leading-none tracking-[-0.02em] text-foreground tabular-nums"
              >
                {formatScore(score)}
              </span>
              <span className="font-display text-xl leading-none text-muted-foreground">
                / {scale}
              </span>
            </p>
            <ScoreMeter score={score} scale={scale} />
            <p className="text-xs text-muted-foreground">
              {labels.scaleCaption
                .replace("{scale}", String(scale))
                .replace("{platform}", platformName)}
            </p>
          </>
        )}
      </div>

      <dl className="flex flex-col rounded-lg border border-border/70 bg-background/40 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border/70 px-3.5 py-2.5">
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <Star className="size-3.5 shrink-0" aria-hidden="true" />
            {labels.reviewsLabel}
          </dt>
          <dd className="min-w-0 text-right">
            {source.reviewCount === null ? (
              <NotStated
                label={labels.notStated}
                explain={labels.explain.gap}
              />
            ) : (
              <span
                data-numeric
                className="font-medium text-foreground tabular-nums"
              >
                {new Intl.NumberFormat(tag).format(source.reviewCount)}
              </span>
            )}
          </dd>
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border/70 px-3.5 py-2.5">
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <Trophy className="size-3.5 shrink-0" aria-hidden="true" />
            {labels.rankingLabel}
          </dt>
          <dd className="min-w-0 text-right break-words">
            {source.ranking === null ? (
              <NotStated
                label={labels.notStated}
                explain={labels.explain.gap}
              />
            ) : (
              <span className="text-foreground">{source.ranking}</span>
            )}
          </dd>
        </div>

        {/* A ranking is a statement about one moment, so the moment travels
            with it and is never further away than the row below. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3.5 py-2.5">
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
            {labels.fetchedLabel}
            <Explain labels={labels.explain.provenance} iconOnly />
          </dt>
          <dd className="min-w-0 text-right">
            {source.fetchedAt === null ? (
              <NotStated
                label={labels.notStated}
                explain={labels.explain.gap}
              />
            ) : (
              <span className="text-foreground tabular-nums">
                {formatFetchedDate(source.fetchedAt, tag)}
              </span>
            )}
          </dd>
        </div>
      </dl>

      {distribution === null ? (
        <div className="flex flex-col gap-1.5">
          <p className="font-mono text-[0.6875rem] tracking-[0.16em] text-muted-foreground uppercase">
            {labels.distribution.heading}
          </p>
          <p className="text-xs leading-relaxed">
            <NotStated
              label={labels.distribution.none}
              explain={labels.explain.gap}
            />
          </p>
        </div>
      ) : (
        <DistributionBars
          distribution={distribution}
          labels={labels.distribution}
          locale={locale}
        />
      )}

      {group.syndicated.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border bg-muted/40 p-3.5">
          <p className="flex flex-wrap items-center gap-1.5 font-mono text-[0.625rem] tracking-[0.16em] text-muted-foreground uppercase">
            <Repeat2 className="size-3.5 shrink-0" aria-hidden="true" />
            {labels.syndicatedHeading}
            <Explain labels={labels.explain.singleSource} iconOnly />
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {labels.syndicatedNote}
          </p>
          <ul className="flex flex-col gap-1">
            {group.syndicated.map((capture) => (
              <li key={capture.url} className="text-xs">
                <a
                  href={capture.url}
                  target="_blank"
                  rel="noreferrer noopener nofollow"
                  className={cn(
                    "azura-tap-compact inline-flex items-center gap-1 rounded-sm underline underline-offset-4",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  )}
                >
                  {labels.syndicatedBy.replace(
                    "{publisher}",
                    capture.publisher ?? hostOf(capture.url)
                  )}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <a
        href={source.url}
        target="_blank"
        rel="noreferrer noopener nofollow"
        className={cn(
          "azura-tap-compact mt-auto inline-flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium",
          "text-primary underline underline-offset-4",
          "transition-transform duration-[var(--duration-instant)] ease-[var(--ease-out)] active:scale-[0.98]",
          "motion-reduce:transition-none",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        )}
      >
        <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
        {labels.open.replace("{platform}", platformName)}
      </a>
    </article>
  )
}
