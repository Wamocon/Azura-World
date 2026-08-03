import { ExternalLink } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/cn"
import { intlLocaleTag } from "@/lib/format"
import type { ReviewSourceRecord } from "@/lib/hotel-data"

import { isFirstParty } from "./reviews-score-card"
import { formatFetchedDate } from "./select"

/**
 * Every captured source, one row each.               Owner: dashboard/reviews
 *
 * The cards above are what a reader looks at; this is what an auditor checks.
 * It lists the captures the cards fold together — including the syndicated
 * OnTheBeach row, which the cards show *inside* the Tripadvisor card so it can
 * never read as a second platform agreeing (F-016).
 *
 * The same rule as everywhere else: **the score and its scale live in one
 * cell**, never in two columns a spreadsheet could sort apart. A row whose
 * `scoreScale` is null says the scale is unusable rather than printing a bare
 * "4,6" that a reader will assume is out of five.
 *
 * There is no total row, no mean row and no normalised column, and there is no
 * prop through which a caller could add one.
 */

export interface ReviewsSourceTableLabels {
  caption: string
  platform: string
  publisher: string
  score: string
  reviews: string
  ranking: string
  fetchedAt: string
  open: string
  scaleUnknown: string
  syndicated: string
  notStated: string
}

export function ReviewsSourceTable({
  sources,
  platformName,
  labels,
  locale,
  className,
}: {
  sources: readonly ReviewSourceRecord[]
  /** Resolves a platform key to its display name. */
  platformName: (key: string) => string
  labels: ReviewsSourceTableLabels
  locale: string
  className?: string
}): ReactNode {
  const tag = intlLocaleTag(locale)
  const number = new Intl.NumberFormat(tag)
  // `score` is `numeric(4,2)`, so a published 8.75 has two decimals. Capping at
  // one would render it "8,8" — a rounded figure no platform published, in the
  // column that exists to reproduce what the platform published.
  const score = new Intl.NumberFormat(tag, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  })

  const headers = [
    labels.platform,
    labels.publisher,
    labels.score,
    labels.reviews,
    labels.ranking,
    labels.fetchedAt,
  ]

  return (
    <div
      className={cn(
        "azura-scrollbar-slim overflow-x-auto rounded-xl border border-border bg-card",
        className
      )}
    >
      <table
        className="w-full min-w-[44rem] border-collapse text-sm"
        data-slot="platform-score-table"
      >
        <caption className="sr-only">{labels.caption}</caption>
        <thead>
          <tr className="border-b border-border text-left">
            {headers.map((header, index) => (
              <th
                key={header}
                scope="col"
                className={cn(
                  "px-4 py-3 font-mono text-[0.6875rem] tracking-[0.14em] text-muted-foreground uppercase",
                  index === 2 || index === 3 ? "text-right" : "text-left"
                )}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sources.map((source) => {
            // Decided by the HOST that served the capture, exactly as the cards
            // decide it. `publisher !== platform` looks equivalent and is not:
            // "Tripadvisor" !== "tripadvisor" is true, which badged the direct
            // capture as re-served.
            const syndicated = !isFirstParty(source)

            return (
              <tr
                key={source.url}
                data-slot="platform-score-row"
                data-platform={source.platform}
                data-syndicated={syndicated ? "true" : "false"}
                className="border-b border-border/60 last:border-0"
              >
                <td className="px-4 py-3 font-medium text-foreground">
                  {platformName(source.platform)}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {source.publisher ?? labels.notStated}
                  {syndicated ? (
                    <span className="ml-2 rounded-sm bg-muted px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground">
                      {labels.syndicated}
                    </span>
                  ) : null}
                </td>

                {/* Score and scale in ONE cell. "/ 5" is part of the value. */}
                <td className="px-4 py-3 text-right" data-slot="score-cell">
                  {source.scoreScale === null ? (
                    <span className="text-muted-foreground">
                      {labels.scaleUnknown}
                    </span>
                  ) : source.score === null ? (
                    <span className="text-muted-foreground">
                      {labels.notStated}
                    </span>
                  ) : (
                    <span className="font-medium whitespace-nowrap text-foreground tabular-nums">
                      {score.format(source.score)}
                      <span className="text-muted-foreground">
                        {" "}
                        / {source.scoreScale}
                      </span>
                    </span>
                  )}
                </td>

                <td className="px-4 py-3 text-right text-foreground tabular-nums">
                  {source.reviewCount === null
                    ? labels.notStated
                    : number.format(source.reviewCount)}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {source.ranking ?? labels.notStated}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  <span className="whitespace-nowrap">
                    {source.fetchedAt === null
                      ? labels.notStated
                      : formatFetchedDate(source.fetchedAt, tag)}
                  </span>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer noopener nofollow"
                    className={cn(
                      "azura-tap-compact ml-2 inline-flex items-center gap-1 rounded-sm align-middle text-primary",
                      "underline underline-offset-4 transition-transform duration-[var(--duration-instant)]",
                      "ease-[var(--ease-out)] active:scale-[0.97] motion-reduce:transition-none",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    )}
                  >
                    <ExternalLink
                      className="size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="sr-only">{labels.open}</span>
                  </a>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
