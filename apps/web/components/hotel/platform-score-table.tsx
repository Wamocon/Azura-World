import { ExternalLink } from "lucide-react"

import { cn } from "@/lib/cn"
import type { ReviewSourceRecord } from "@/lib/hotel-data"

import { formatFetchedDate } from "./select"
import { intlLocaleTag } from "@/lib/format"

/**
 * Per-platform scores, each on its own scale.                     Owner: W3-G
 *
 * ## The rule this component exists to enforce
 *
 * `tasks/W3-G`: *"A 4.0/5 and an 8.2/10 are not commensurable and combining
 * them invents a number."* So there is **no total row, no mean row, and no
 * normalised column**. Every score renders beside the scale it was published
 * on, and the two never separate.
 *
 * That is enforced by shape, not by discipline: this component takes
 * `ReviewSourceRecord[]` — rows that carry `score` and `scoreScale` together —
 * and there is no prop through which a caller could pass a combined figure.
 * `ReviewSummary.meanNormalisedScore` exists in the repository and is
 * deliberately **not** consumed here; see `HANDOFF/W3-G.md` §"The averaging
 * question".
 *
 * ## A score with no scale is not rendered as a number
 *
 * `scoreScale` is `NOT NULL` with a `CHECK (5, 10)` in W1-A's schema, so a
 * `null` here means the row broke that constraint. The repository refuses to
 * normalise it and so does this: the cell says the scale is unusable rather
 * than showing a bare "4,6" that a reader will assume is out of 5.
 *
 * ## F-016 — the same score served by two hosts
 *
 * OnTheBeach publishes no score of its own; its 4.6/5 is Tripadvisor's, served
 * through a widget on the same location id. Grouping by *serving host* would
 * make it look like two platforms agreeing, which under CONTRACTS §1 invariant 3
 * is what promotes a fact to `confirmed`. So the table shows the producing
 * platform and the serving publisher in separate columns, and a row whose two
 * differ is marked.
 */

export interface PlatformScoreTableLabels {
  caption: string
  platform: string
  publisher: string
  score: string
  scale: string
  reviews: string
  ranking: string
  fetchedAt: string
  open: string
  /** Shown in the score cell when `scoreScale` is unusable. */
  scaleUnknown: string
  /** Row marker when the serving publisher is not the producing platform. */
  syndicated: string
  /** The standing explanation under the table. */
  noAverageNote: string
  none: string
}

function scoreText(score: number | null, locale: string): string {
  if (score === null) return "—"
  // The platform's own precision. `maximumFractionDigits: 0` would turn 4,6
  // into 5 — W3-G measured exactly that on the public page before it was fixed.
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(score)
}

export function PlatformScoreTable({
  sources,
  labels,
  locale,
  className,
}: {
  sources: readonly ReviewSourceRecord[]
  labels: PlatformScoreTableLabels
  locale: string
  className?: string
}) {
  if (sources.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        {labels.none}
      </p>
    )
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[44rem] border-collapse text-sm" data-slot="platform-score-table">
          <caption className="sr-only">{labels.caption}</caption>
          <thead>
            <tr className="border-b border-border text-left">
              {[labels.platform, labels.publisher, labels.score, labels.reviews, labels.ranking, labels.fetchedAt].map(
                (header, i) => (
                  <th
                    key={header}
                    scope="col"
                    className={cn(
                      "px-4 py-3 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted-foreground",
                      i === 2 || i === 3 ? "text-right" : "text-left",
                    )}
                  >
                    {header}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => {
              const syndicated =
                source.publisher !== null && source.publisher !== source.platform
              return (
                <tr
                  key={source.url}
                  data-slot="platform-score-row"
                  data-platform={source.platform}
                  data-syndicated={syndicated ? "true" : "false"}
                  className="border-b border-border/60 last:border-0"
                >
                  <td className="px-4 py-3 font-medium text-foreground">{source.platform}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {source.publisher ?? "—"}
                    {syndicated ? (
                      <span className="ml-2 rounded-sm bg-muted px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground">
                        {labels.syndicated}
                      </span>
                    ) : null}
                  </td>

                  {/*
                    The score and its scale in ONE cell, never two columns that a
                    reader could scan independently and a spreadsheet could sort
                    apart. `/ 5` is part of the value, not a caption on it.
                  */}
                  <td className="px-4 py-3 text-right" data-slot="score-cell">
                    {source.scoreScale === null ? (
                      <span className="text-muted-foreground">{labels.scaleUnknown}</span>
                    ) : (
                      <span className="whitespace-nowrap font-medium tabular-nums text-foreground">
                        {scoreText(source.score, locale)}
                        <span className="text-muted-foreground"> / {source.scoreScale}</span>
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3 text-right tabular-nums text-foreground">
                    {source.reviewCount === null
                      ? "—"
                      : new Intl.NumberFormat(intlLocaleTag(locale)).format(source.reviewCount)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{source.ranking ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <span className="whitespace-nowrap">
                      {source.fetchedAt === null ? "—" : formatFetchedDate(source.fetchedAt, locale)}
                    </span>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer noopener nofollow"
                      className={cn(
                        "ml-2 inline-flex min-h-6 items-center gap-1 rounded-sm align-middle text-primary",
                        "underline underline-offset-4 transition-transform duration-150 ease-out active:scale-[0.97]",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      )}
                    >
                      <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="sr-only">{labels.open}</span>
                    </a>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/*
        Always visible, never a tooltip. A reader looking at two scores side by
        side will try to combine them unless told why they cannot be, and this
        is the sentence that stops it.
      */}
      <p
        data-slot="no-average-note"
        className="max-w-prose text-xs leading-relaxed text-muted-foreground"
      >
        {labels.noAverageNote}
      </p>
    </div>
  )
}
