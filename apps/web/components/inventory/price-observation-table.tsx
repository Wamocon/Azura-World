import { ExternalLink } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/cn"
import { formatMoney } from "@/components/evidence/format"
import { SourceChip, type SourceChipLabels } from "@/components/evidence/source-chip"
import type { SourceRef } from "@/lib/contracts"

import type { PriceObservation } from "./price-conflict-ladder"

/**
 * PriceObservationTable — the record behind the ladder.      Owner: W3-C
 *
 * `PriceConflictLadder` is `aria-hidden` decoration; this is where its
 * observations exist as text. Every row carries the price in the currency the
 * publisher used, the publisher, the size they stated, when it was collected,
 * and a way back to the page it came from. Nothing is summarised away and
 * nothing is converted.
 *
 * ## Two things are deliberately NOT columns
 *
 * There is no "price per m²" column, although both inputs are present. Several
 * observations state a price without a size, so the column would be empty for
 * exactly the rows a reader would most want to compare — and a derived figure
 * shown beside sourced ones reads as equally sourced. CONTRACTS §1 would make
 * it `inferred` with a note; a table cell has nowhere to put the note.
 *
 * There is no rank or "best value" column. F-002 is unresolved by design.
 *
 * ## The stale badge sits next to the price
 *
 * W3-C's brief is specific: next to the price, not in a footnote. Haspo still
 * lists the project as under construction two years after a corroborated
 * completion date (F-006), so eight of the thirteen EUR observations here are
 * quoting a market that has moved. A reader scanning the cheapest number must
 * meet that fact in the same glance, not three lines below.
 */

/**
 * Collection date, in the active locale.
 *
 * Deliberately not imported from `components/evidence/source-chip.tsx`, which
 * exports an identical `formatFetchedAt` — that module is `"use client"`, and a
 * Server Component calling a function out of a client module fails at render
 * with *"Attempted to call formatFetchedAt() from the server"*. The boundary is
 * real, so the four lines are duplicated rather than the table being pushed to
 * the client for a date. Same fail-visible rule as the original: an unparseable
 * timestamp renders raw rather than as "Invalid Date".
 */
function formatCollectedAt(iso: string, locale: string): string {
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return iso
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(parsed))
}

export interface ObservationTableLabels {
  caption: string
  price: string
  layout: string
  area: string
  publisher: string
  observed: string
  evidence: string
  stale: string
  /** Marks a "from" price rather than a specific unit's price. */
  note: string
  /** Column value when the publisher stated no layout. */
  layoutUnstated: string
  areaUnstated: string
  source: SourceChipLabels
}

export function PriceObservationTable({
  observations,
  locale,
  labels,
  /** Real `SourceRef`s, keyed by url, so a row can link to its snapshot. */
  sourcesByUrl,
  snapshotBasePath,
  className,
}: {
  observations: readonly PriceObservation[]
  locale: string
  labels: ObservationTableLabels
  sourcesByUrl?: ReadonlyMap<string, SourceRef>
  snapshotBasePath?: string
  className?: string
}): ReactNode {
  if (observations.length === 0) return null

  const rows = [...observations].sort((a, b) => {
    // Currency first so the two rails read as two blocks here too, then price.
    if (a.money.currency !== b.money.currency) {
      return a.money.currency.localeCompare(b.money.currency)
    }
    return a.money.amount - b.money.amount
  })

  return (
    // Three classes, each load-bearing, all found by measuring at 320px rather
    // than by reading the markup:
    //
    //   `min-w-0`   — a flex item defaults to `min-width: auto` and refuses to
    //                 shrink below its content, so the 44rem table would size
    //                 the column instead of scrolling inside it.
    //   `relative`  — THE subtle one. Every `sr-only` element is
    //                 `position: absolute`, and an absolutely-positioned
    //                 descendant is only clipped by an ancestor that is itself
    //                 a containing block. Without this, the screen-reader-only
    //                 spans in these cells escaped the scroll box and dragged
    //                 the PAGE to 526px at a 320px viewport — visible as
    //                 horizontal scroll on a phone, caused by content that is
    //                 invisible. `overflow: hidden` alone does NOT fix it;
    //                 measured both ways.
    //   `max-w-full`— belt and braces against a future grid ancestor.
    <div
      className={cn(
        "azura-scrollbar-slim relative min-w-0 max-w-full overflow-x-auto",
        className
      )}
    >
      <table className="w-full min-w-[44rem] border-collapse text-sm">
        <caption className="sr-only">{labels.caption}</caption>
        <thead>
          <tr className="border-b border-border text-left">
            <th scope="col" className="py-2 pr-4 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {labels.price}
            </th>
            <th scope="col" className="py-2 pr-4 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {labels.layout}
            </th>
            <th scope="col" className="py-2 pr-4 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {labels.area}
            </th>
            <th scope="col" className="py-2 pr-4 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {labels.publisher}
            </th>
            <th scope="col" className="py-2 pr-4 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {labels.observed}
            </th>
            <th scope="col" className="py-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {labels.evidence}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((observation, index) => {
            const source = sourcesByUrl?.get(observation.url)
            return (
              <tr
                key={`${observation.url}-${observation.money.amount}-${index}`}
                data-slot="observation-row"
                data-stale={observation.stale}
                className={cn(
                  "border-b border-border/60 align-top",
                  observation.stale && "bg-quality-stale/[0.06]"
                )}
              >
                <td className="py-2.5 pr-4">
                  <span className="flex flex-wrap items-center gap-2">
                    <span data-numeric className="font-display font-semibold">
                      {formatMoney(observation.money, locale)}
                    </span>
                    {observation.stale ? (
                      // Next to the price. Never a footnote.
                      <span className="inline-flex min-h-6 items-center gap-1 rounded-md border border-quality-stale/45 bg-quality-stale/10 px-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-quality-stale">
                        {labels.stale}
                      </span>
                    ) : null}
                  </span>
                  {observation.note !== null && observation.note.length > 0 ? (
                    <span className="mt-1 block max-w-[24rem] text-xs leading-relaxed text-muted-foreground">
                      <span className="sr-only">{labels.note}: </span>
                      {observation.note}
                    </span>
                  ) : null}
                </td>
                <td className="py-2.5 pr-4 text-muted-foreground">
                  {observation.layout ?? labels.layoutUnstated}
                </td>
                <td className="py-2.5 pr-4" data-numeric>
                  {observation.interiorM2 === null ? (
                    <span className="text-muted-foreground">{labels.areaUnstated}</span>
                  ) : (
                    `${new Intl.NumberFormat(locale).format(observation.interiorM2)} m²`
                  )}
                </td>
                <td className="py-2.5 pr-4">{observation.publisher}</td>
                <td className="py-2.5 pr-4 tabular-nums text-muted-foreground">
                  <time dateTime={observation.fetchedAt}>
                    {formatCollectedAt(observation.fetchedAt, locale)}
                  </time>
                </td>
                <td className="py-2.5">
                  {source !== undefined ? (
                    <SourceChip
                      source={source}
                      locale={locale}
                      labels={labels.source}
                      {...(snapshotBasePath !== undefined ? { snapshotBasePath } : {})}
                    />
                  ) : (
                    // No `SourceRef` for this url, so there is no snapshot hash
                    // to link. A fabricated hash would be far worse than a
                    // missing archive link (invariant 6), so the row keeps its
                    // live URL and simply has no archive icon.
                    //
                    // Given the SAME chip shape as a registered source, though:
                    // the earlier version used a bare text link, and the visual
                    // weight difference read as "this citation is weaker" when
                    // the only real difference is whether we happen to hold a
                    // snapshot of that exact URL.
                    <span className="inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-md border border-input bg-background px-2 py-0.5 text-xs text-muted-foreground">
                      <a
                        href={observation.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`${labels.source.openSource}: ${observation.url}`}
                        className="inline-flex min-h-6 min-w-0 items-center gap-1 rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="truncate">{observation.publisher}</span>
                        <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                      </a>
                      <span aria-hidden="true" className="text-muted-foreground/60">
                        ·
                      </span>
                      <time dateTime={observation.fetchedAt} className="shrink-0 tabular-nums">
                        {formatCollectedAt(observation.fetchedAt, locale)}
                      </time>
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
