import { cn } from "@/lib/cn"
import type { AzuraReviewSentiment } from "@/lib/azura-world-data"

import { sentimentBreakdown, type SentimentBucket } from "./select"
import { intlLocaleTag } from "@/lib/format"

/**
 * A platform's own rating distribution.                           Owner: W3-G
 *
 * ## The one design decision worth defending
 *
 * Tripadvisor's distribution for this hotel is 269 excellent, 43 good, 19
 * average, 8 poor, 11 terrible. The negative tail is 19 of 350 — 5%. Rendered
 * at true proportion in a 900px bar that is a 49px sliver, and at 320px it is
 * 17px: present, technically honest, and effectively invisible.
 *
 * Two wrong fixes were available. Exaggerating the segment widths would make
 * the chart lie about proportion. Leaving it as a sliver would make the tail
 * unreadable, which is the same failure the whole module exists to prevent —
 * a decision-maker who skims this page and takes away "4.6, basically
 * everyone loved it" has been misled by an accurate chart.
 *
 * What this does instead: the bar keeps **true proportion**, and every
 * non-zero bucket gets a `min-width` so it can never vanish, with the exact
 * count printed in a legend that is **always visible** — not a tooltip, not a
 * hover. The bar carries the shape; the legend carries the numbers; neither
 * has to distort to do its job. azura-ui-ux §5.3: "Provenance is visible,
 * never hover-only. A conflict badge behind a mouse hover is invisible to
 * touch and to screen readers."
 *
 * ## Not a score
 *
 * `share` is a proportion within ONE platform. It is never compared to another
 * platform's share and never combined with one. See `select.ts`.
 *
 * ## Gap, not zero
 *
 * A platform that published no distribution renders nothing here and the
 * caller shows "Nicht belegt". An empty bar would read as "nobody complained".
 */

export interface SentimentLabels {
  heading: string
  /** Bucket names, in the platform's own vocabulary. */
  bucket: Record<SentimentBucket["key"], string>
  /** e.g. "{count} von {total}" */
  countOf: string
  /** Screen-reader summary, e.g. "Verteilung über {total} Bewertungen". */
  distributionOf: string
  /** Shown when only the three-way fold is published. */
  foldOnly: string
  positive: string
  mixed: string
  negative: string
}

const TONE_CLASS: Record<SentimentBucket["tone"], string> = {
  positive: "bg-confidence-confirmed",
  mixed: "bg-confidence-inferred",
  negative: "bg-confidence-conflicted",
}

export function SentimentDistribution({
  sentiment,
  labels,
  locale,
  className,
}: {
  sentiment: AzuraReviewSentiment | null
  labels: SentimentLabels
  locale: string
  className?: string
}) {
  const breakdown = sentimentBreakdown(sentiment)
  if (breakdown === null) return null

  const number = new Intl.NumberFormat(intlLocaleTag(locale))

  if (breakdown.foldOnly) {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <p className="text-sm text-muted-foreground">{labels.foldOnly}</p>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{labels.positive}</dt>
            <dd data-numeric>{number.format(breakdown.positive)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{labels.mixed}</dt>
            <dd data-numeric>{number.format(breakdown.mixed)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{labels.negative}</dt>
            <dd data-numeric>{number.format(breakdown.negative)}</dd>
          </div>
        </dl>
      </div>
    )
  }

  const present = breakdown.buckets.filter((bucket) => bucket.count > 0)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <p className="font-mono text-[0.6875rem] tracking-[0.18em] text-muted-foreground uppercase">
        {labels.heading}
      </p>

      {/*
        The bar is decorative in the accessibility sense — every number in it
        is also in the legend below, as text. So it is aria-hidden and the
        legend is the accessible content, rather than duplicating counts into
        aria-labels that a screen reader would then read twice.
      */}
      <div
        aria-hidden="true"
        className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
      >
        {present.map((bucket) => (
          <span
            key={bucket.key}
            className={cn("h-full", TONE_CLASS[bucket.tone])}
            style={{
              // True proportion, with a floor so a 3% tail cannot disappear.
              width: `${(bucket.share * 100).toFixed(2)}%`,
              minWidth: "0.5rem",
            }}
          />
        ))}
      </div>

      <dl className="flex flex-wrap gap-x-5 gap-y-1.5">
        <div className="sr-only">
          {labels.distributionOf.replace(
            "{total}",
            number.format(breakdown.total)
          )}
        </div>
        {breakdown.buckets.map((bucket) => (
          <div key={bucket.key} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden="true"
              className={cn(
                "size-2 shrink-0 rounded-full",
                TONE_CLASS[bucket.tone]
              )}
            />
            <dt className="text-muted-foreground">
              {labels.bucket[bucket.key]}
            </dt>
            <dd data-numeric className="text-foreground tabular-nums">
              {number.format(bucket.count)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
