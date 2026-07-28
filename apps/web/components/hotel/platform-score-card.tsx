import { ProvenanceValue, type ProvenanceLabels } from "@/components/evidence/provenance-value"
import { cn } from "@/lib/cn"

import { SentimentDistribution, type SentimentLabels } from "./sentiment-distribution"
import { formatFetchedDate, scoreAsDisplayFact, type PlatformGroup } from "./select"

/**
 * One review platform, on its own scale.                          Owner: W3-G
 *
 * ## The scale never leaves the score
 *
 * The card renders "4,6 / 5" and "6,7 / 10" — never "4,6" and "6,7" beside
 * each other, and never a normalised percentage. tasks/W3-G: "A 4.0/5 and an
 * 8.2/10 are not commensurable and combining them invents a number."
 *
 * This component takes a `PlatformGroup`, and that type carries `scale`
 * alongside the score by construction, so there is no shape in which a bare
 * score reaches JSX. The module has no averaging function at all — see the
 * header of `select.ts`.
 *
 * ## F-016 — the syndicated capture is shown, and shown as syndicated
 *
 * OnTheBeach's 4.6/5 is Tripadvisor's number served through an embedded
 * widget on the same location id. It appears here under the Tripadvisor
 * group, explicitly labelled as a re-serving of the same score, because two
 * facts matter and they point in opposite directions:
 *
 *   - it is NOT a second platform agreeing (that would have promoted the score
 *     to "confirmed" under CONTRACTS §1 invariant 3 on two distinct hosts), and
 *   - it IS real evidence about how one hotel score propagates across the
 *     booking web, which is worth a reader's attention.
 *
 * Hiding it would lose the second; listing it as a platform would fabricate
 * the first.
 *
 * ## The ranking always carries its fetch date
 *
 * "#10 of 33" is a statement about one moment. tasks/W3-G edge case: "Ranking
 * changes between fetches → show the fetch date next to the ranking, always."
 */

export interface PlatformCardLabels {
  /** Display names per platform key. */
  platform: Record<string, string>
  score: string
  reviewCount: string
  ranking: string
  fetchedAt: string
  openPlatform: string
  /** e.g. "Dieselbe Wertung, erneut ausgeliefert von {publisher}" */
  syndicatedBy: string
  /** The explanation of why a syndicated capture is not a second source. */
  syndicatedNote: string
  /** e.g. "keine Bewertungen" — distinct from "nicht abgerufen". */
  noReviews: string
  sentiment: SentimentLabels
}

export function PlatformScoreCard({
  group,
  labels,
  provenance,
  locale,
  className,
}: {
  group: PlatformGroup
  labels: PlatformCardLabels
  provenance: ProvenanceLabels
  locale: string
  className?: string
}) {
  const { primary, scale } = group
  const review = primary.review
  const platformName = labels.platform[group.platform] ?? group.platform
  const count = review.reviewCount.value

  return (
    <article
      data-slot="platform-score"
      className={cn(
        "flex flex-col gap-5 rounded-lg border border-border bg-card p-6",
        className,
      )}
    >
      <header className="flex flex-col gap-1">
        <h3 className="font-display text-xl text-foreground">{platformName}</h3>
        <p className="text-xs text-muted-foreground">{primary.publisher}</p>
      </header>

      {/*
        Score and scale in one visual unit. The "/ 5" is not a caption on the
        score — it is part of it, and it is never rendered separately.
      */}
      <div className="flex flex-col gap-1">
        <p className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted-foreground">
          {labels.score}
        </p>
        <div className="flex items-baseline gap-1.5">
          {/* text, not number: the score is formatted by scoreAsDisplayFact()
              at its published precision. See select.ts for why. */}
          <ProvenanceValue
            fact={scoreAsDisplayFact(review.score, locale)}
            format="text"
            locale={locale}
            labels={provenance}
            className="font-display text-4xl"
          />
          <span
            className="font-display text-2xl text-muted-foreground"
            data-numeric
            aria-label={`/ ${scale}`}
          >
            <span aria-hidden="true">/ {scale}</span>
          </span>
        </div>
      </div>

      <dl className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">{labels.reviewCount}</dt>
          <dd>
            {count === 0 ? (
              <span className="text-muted-foreground">{labels.noReviews}</span>
            ) : (
              <ProvenanceValue
                fact={review.reviewCount}
                format="number"
                locale={locale}
                labels={provenance}
              />
            )}
          </dd>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">{labels.ranking}</dt>
          <dd className="flex flex-wrap items-baseline gap-2">
            <ProvenanceValue
              fact={review.ranking}
              format="text"
              locale={locale}
              labels={provenance}
            />
            {primary.fetchedAt !== null ? (
              <span className="text-xs text-muted-foreground">
                {labels.fetchedAt} {formatFetchedDate(primary.fetchedAt, locale)}
              </span>
            ) : null}
          </dd>
        </div>
      </dl>

      <SentimentDistribution
        sentiment={review.sentiment}
        labels={labels.sentiment}
        locale={locale}
      />

      {group.syndicated.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-md border border-dashed border-border bg-muted/40 p-4">
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
                    "rounded-sm underline underline-offset-4",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  )}
                >
                  {labels.syndicatedBy.replace("{publisher}", capture.publisher)}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <a
        href={primary.url}
        target="_blank"
        rel="noreferrer noopener nofollow"
        className={cn(
          "mt-auto inline-flex min-h-6 w-fit items-center rounded-sm text-sm font-medium",
          "text-primary underline underline-offset-4 transition-transform duration-150 ease-out",
          "active:scale-[0.97]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        )}
      >
        {labels.openPlatform.replace("{platform}", platformName)}
      </a>
    </article>
  )
}
