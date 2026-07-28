import { ReviewQuoteCard, type ReviewQuoteLabels } from "./review-quote-card"
import { splitVerdict } from "./select"
import type { AzuraReviewQuote } from "@/lib/azura-world-data"

/**
 * The split verdict — the page's central claim, rendered.         Owner: W3-G
 *
 * ## What this is
 *
 * Two reviews, side by side, at identical width and identical type size: the
 * highest-rated quote this harvest recovered, and the lowest-rated one. Not a
 * carousel. Not "highlights" with criticism behind a filter. Two columns that
 * cannot be collapsed to one.
 *
 * ## Why it is built this way rather than promised in a comment
 *
 * tasks/W3-G makes balance a hard requirement: "the quote list must show both
 * extremes by default, not the positive ones with negatives behind a filter.
 * Build the default view to be balanced and let filtering *narrow* it, never
 * widen it from a positive-only default."
 *
 * A sort order satisfies that until someone changes the sort. A filter default
 * satisfies it until someone changes the default. Both are one-line
 * regressions that no test would catch, because the page would still render
 * quotes.
 *
 * So the balance is structural: this component takes the FULL quote list and
 * derives both ends itself with `splitVerdict()` — `Math.min` and `Math.max`
 * over the same array. There is no input ordering, no filter state and no prop
 * that yields two positive quotes. Removing the criticism means deleting a
 * column from this file, which is visible in a diff and obvious in review.
 *
 * The reading order is deliberate too. In a left-to-right locale the criticism
 * comes first. A hotel page that opens its review section with its worst
 * review is the opposite of what a brochure does, and that is the entire point
 * of criterion 4: this is intelligence about a property, not a pitch for it.
 *
 * ## The honest degenerate cases
 *
 * - One rated quote → `degenerate`, and the component says so rather than
 *   showing the same review twice under two different headings.
 * - No rated quotes → nothing is claimed about the extremes at all.
 */

export interface SplitVerdictLabels {
  heading: string
  intro: string
  bestEyebrow: string
  worstEyebrow: string
  /** Shown when only one rated review exists. */
  degenerate: string
  /** Shown when no quote carries a readable rating. */
  noRatings: string
  /** e.g. "{count} weitere Bewertungen ohne lesbare Wertung" */
  unrated: string
  quote: ReviewQuoteLabels
}

export function SplitVerdict({
  quotes,
  scale,
  labels,
}: {
  quotes: readonly AzuraReviewQuote[]
  scale: number
  labels: SplitVerdictLabels
}) {
  const verdict = splitVerdict(quotes)

  if (verdict.best === null || verdict.worst === null) {
    return (
      <section aria-labelledby="split-verdict-heading" className="flex flex-col gap-4">
        <h3 id="split-verdict-heading" className="font-display text-2xl">
          {labels.heading}
        </h3>
        <p className="text-sm text-muted-foreground">{labels.noRatings}</p>
      </section>
    )
  }

  return (
    <section aria-labelledby="split-verdict-heading" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h3 id="split-verdict-heading" className="font-display text-2xl text-balance">
          {labels.heading}
        </h3>
        <p className="max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
          {labels.intro}
        </p>
      </div>

      {verdict.degenerate ? (
        <p className="text-sm text-muted-foreground">{labels.degenerate}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {/*
            DOM order is worst → best, and the grid gives both columns equal
            width. Neither of those is incidental: equal width is the claim
            that the two are equally worth reading, and worst-first is the
            claim that the criticism is not an appendix.
          */}
          <ReviewQuoteCard
            quote={verdict.worst}
            scale={scale}
            labels={labels.quote}
            tone="negative"
            eyebrow={labels.worstEyebrow}
          />
          <ReviewQuoteCard
            quote={verdict.best}
            scale={scale}
            labels={labels.quote}
            tone="positive"
            eyebrow={labels.bestEyebrow}
          />
        </div>
      )}

      {verdict.unratedCount > 0 ? (
        <p className="text-xs text-muted-foreground">
          {labels.unrated.replace("{count}", String(verdict.unratedCount))}
        </p>
      ) : null}
    </section>
  )
}
