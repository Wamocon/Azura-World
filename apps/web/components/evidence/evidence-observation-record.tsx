import { Archive, ExternalLink } from "lucide-react"
import { Fragment } from "react"
import type { ReactNode } from "react"

import { DataNote, type DataNoteLabels } from "@/components/evidence/data-note"
import {
  groupByCurrency,
  type PublisherGroup,
} from "@/components/evidence/evidence-conflict-model"
import {
  formatMoney,
  interpolate,
  snapshotUrl,
} from "@/components/evidence/format"
import { cn } from "@/lib/cn"
import { intlLocaleTag } from "@/lib/format"
import type { SourceRef } from "@/lib/contracts"

import type { PriceObservation } from "@/components/inventory/price-conflict-ladder"

/**
 * Every quoted price, as text.                              Owner: W-EVIDENCE
 *
 * The bar chart above is decoration; this is the record. Nothing is summarised
 * away, nothing is converted, and every line links back to the page the figure
 * came from plus the stored copy of it where we hold one.
 *
 * ## What changed, and why the old table overflowed
 *
 * The previous table was six columns and 44rem wide with a forced horizontal
 * scroll on every viewport below a laptop. Three of those columns were
 * repetition: the portal name appeared once as its own column and again inside
 * the citation chip, the collection date appeared twice for the same reason, and
 * the layout column read "1+1" thirteen times on a table whose heading already
 * says it is about 1+1 apartments.
 *
 * So the portal is now a group heading over its own rows, stated once, and the
 * citation is a compact link. Four short columns, no forced minimum width, and
 * the table fits a phone.
 *
 * ## Notes: one plain sentence per row, originals collected at the end
 *
 * The harvest notes are English prose written for an analyst about our own
 * pipeline, and the old table printed the "internal wording" disclosure under
 * every single row that had one, eight times in a row for one portal. `DataNote`
 * still renders the translated plain sentence per row, but the originals are now
 * gathered into one disclosure per portal, deduplicated. The originals are kept,
 * not dropped: this product's argument is that it shows its working.
 *
 * ## Row identity is load-bearing
 *
 * `data-slot="observation-row"` and `data-stale` are asserted by
 * `e2e/evidence/evidence.spec.ts` §5 — the stale marker must sit in the same
 * cell as the price, never in a footnote. Keep both, and keep the badge inside
 * the price cell.
 */

export interface ObservationRecordLabels {
  /** `<caption>`, for screen readers. */
  caption: string
  price: string
  size: string
  collected: string
  source: string
  /** Link text in the source cell, e.g. "Listing". */
  openListing: string
  /** Template with `{publisher}`. Accessible name of that link. */
  openListingLabel: string
  /** Template with `{publisher}`. Accessible name of the stored-copy link. */
  snapshotLabel: string
  /** Marker beside a price from an out-of-date listing. */
  stale: string
  /** Template with `{stale}` and `{count}`. */
  staleSome: string
  sizeUnstated: string
  /** Template with `{count}`. */
  listings: string
  oneListing: string
  /** Disclosure label over the untranslated harvest notes. */
  originalsLabel: string
  /** One line inside that disclosure explaining what the reader is seeing. */
  originalsHint: string
  /** The sentence shown where the currency changes. */
  notComparable: string
  dataNote: DataNoteLabels
}

/**
 * Collection date in the active locale.
 *
 * Local rather than imported from `source-chip.tsx`: that module is
 * `"use client"` and a Server Component calling into it fails at render.
 * An unparseable timestamp renders raw rather than as "Invalid Date" — a broken
 * date is a parser bug worth seeing, not worth hiding.
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

const CELL = "px-2 py-2 align-top first:pl-0 last:pr-0"

function PublisherRows({
  group,
  locale,
  labels,
  sourcesByUrl,
  snapshotBasePath,
}: {
  group: PublisherGroup
  locale: string
  labels: ObservationRecordLabels
  sourcesByUrl?: ReadonlyMap<string, SourceRef>
  snapshotBasePath?: string
}): ReactNode {
  const total = group.observations.length
  const someStale = group.staleCount > 0 && group.staleCount < total

  // Deduplicated: one portal repeated the same caveat on eight rows, and eight
  // identical paragraphs are not eight pieces of evidence.
  const originals = Array.from(
    new Set(
      group.observations
        .map((observation) => observation.note)
        .filter(
          (note): note is string => note !== null && note.trim().length > 0
        )
        .map((note) => note.trim())
    )
  )

  return (
    <tbody
      data-slot="observation-group"
      data-publisher={group.publisher}
      className="border-b border-border/70 last:border-b-0"
    >
      <tr>
        <th
          scope="rowgroup"
          colSpan={4}
          className="pt-4 pb-1 text-left text-sm font-semibold"
        >
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{group.publisher}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {total === 1
                ? labels.oneListing
                : interpolate(labels.listings, { count: total })}
            </span>
            {group.staleCount > 0 ? (
              <span className="inline-flex min-h-6 items-center rounded-md border border-quality-stale/45 bg-quality-stale/10 px-1.5 text-[0.6875rem] font-semibold tracking-[0.06em] text-quality-stale uppercase">
                {someStale
                  ? interpolate(labels.staleSome, {
                      stale: group.staleCount,
                      count: total,
                    })
                  : labels.stale}
              </span>
            ) : null}
          </span>
        </th>
      </tr>

      {group.observations.map((observation, index) => {
        const source = sourcesByUrl?.get(observation.url)
        const hasNote =
          observation.note !== null && observation.note.trim().length > 0

        return (
          <Fragment
            key={`${observation.url}-${observation.money.amount}-${index}`}
          >
            <tr
              data-slot="observation-row"
              data-stale={observation.stale}
              className={cn(
                "align-top",
                "transition-colors duration-150 ease-[var(--ease-out)]",
                // Hover behind a real pointer: on touch it fires on tap and the
                // row latches highlighted after the finger has gone.
                "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/40",
                observation.stale && "bg-quality-stale/[0.06]"
              )}
            >
              <td className={cn(CELL, "whitespace-nowrap")}>
                <span className="flex flex-wrap items-center gap-1.5">
                  <span
                    data-numeric
                    className="font-display text-[0.9375rem] font-semibold tracking-[-0.01em] tabular-nums"
                  >
                    {formatMoney(observation.money, locale)}
                  </span>
                  {observation.stale ? (
                    // Beside the price. Never a footnote (W3-C's brief, and
                    // e2e/evidence §5 asserts exactly this composition).
                    <span className="inline-flex min-h-6 items-center rounded-md border border-quality-stale/45 bg-quality-stale/10 px-1.5 text-[0.6875rem] font-semibold tracking-[0.06em] text-quality-stale uppercase">
                      {labels.stale}
                    </span>
                  ) : null}
                </span>
              </td>

              {/* No `whitespace-nowrap` here on purpose: "nicht angegeben" is
                  the longest thing this column ever holds and letting it wrap
                  takes about 50px off the table's minimum width on a phone. The
                  figure itself is short enough not to break. */}
              <td className={cn(CELL, "tabular-nums")} data-numeric>
                {observation.interiorM2 === null ? (
                  <span className="text-muted-foreground tabular-nums">
                    {labels.sizeUnstated}
                  </span>
                ) : (
                  `${new Intl.NumberFormat(intlLocaleTag(locale)).format(observation.interiorM2)} m²`
                )}
              </td>

              <td
                className={cn(
                  CELL,
                  "whitespace-nowrap text-muted-foreground tabular-nums"
                )}
              >
                <time dateTime={observation.fetchedAt}>
                  {formatCollectedAt(observation.fetchedAt, locale)}
                </time>
              </td>

              <td className={cn(CELL, "whitespace-nowrap")}>
                <span className="inline-flex items-center gap-1">
                  <a
                    href={observation.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={interpolate(labels.openListingLabel, {
                      publisher: observation.publisher,
                    })}
                    title={observation.url}
                    className={cn(
                      "inline-flex min-h-6 items-center gap-1 rounded-sm text-xs font-medium",
                      // The tap has to be felt before the navigation happens or
                      // the delay reads as a dead control.
                      "transition-transform duration-100 ease-[var(--ease-out)] active:scale-[0.97] motion-reduce:active:scale-100",
                      "outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    )}
                  >
                    {labels.openListing}
                    <ExternalLink
                      className="size-3 shrink-0"
                      aria-hidden="true"
                    />
                  </a>

                  {source !== undefined && snapshotBasePath !== undefined ? (
                    // Only where a snapshot really exists. Inventing a hash so
                    // every row looked uniform would break invariant 6, so a row
                    // we hold no copy of simply has no archive link.
                    <a
                      href={snapshotUrl(snapshotBasePath, source.snapshotHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={interpolate(labels.snapshotLabel, {
                        publisher: observation.publisher,
                      })}
                      className={cn(
                        "inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground",
                        "outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      )}
                    >
                      <Archive className="size-3.5" aria-hidden="true" />
                    </a>
                  ) : null}
                </span>
              </td>
            </tr>

            {hasNote ? (
              // Its own row, spanning every column, so a long caveat wraps
              // instead of widening the price column and pushing the table into
              // a horizontal scroll.
              <tr
                data-slot="observation-note"
                className={observation.stale ? "bg-quality-stale/[0.06]" : ""}
              >
                <td colSpan={4} className="px-2 pb-2 first:pl-0">
                  <DataNote
                    note={observation.note}
                    labels={labels.dataNote}
                    concise
                    className="mt-0 max-w-[46rem]"
                  />
                </td>
              </tr>
            ) : null}
          </Fragment>
        )
      })}

      {originals.length > 0 ? (
        <tr>
          <td colSpan={4} className="pt-1 pb-3">
            {/* `<details>`: no JavaScript, keyboard-operable for free, reachable
                on touch, printed expanded, announced as a disclosure. */}
            <details className="group">
              <summary className="azura-tap-compact inline-flex cursor-pointer list-none items-center gap-1 text-[0.6875rem] tracking-[0.04em] text-muted-foreground/80 uppercase hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] [&::-webkit-details-marker]:hidden">
                <span
                  aria-hidden="true"
                  className="inline-block transition-transform duration-[var(--duration-fast)] group-open:rotate-90 motion-reduce:transition-none"
                >
                  ›
                </span>
                {labels.originalsLabel}
              </summary>
              <div className="mt-1 border-l-2 border-border pl-2">
                <p className="mb-1 text-[0.6875rem] leading-relaxed text-muted-foreground/75 italic">
                  {labels.originalsHint}
                </p>
                <ul className="flex flex-col gap-1">
                  {originals.map((original) => (
                    <li
                      key={original}
                      className="max-w-[46rem] text-[0.6875rem] leading-relaxed text-muted-foreground/75"
                    >
                      {original}
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          </td>
        </tr>
      ) : null}
    </tbody>
  )
}

export function EvidenceObservationRecord({
  observations,
  locale,
  labels,
  sourcesByUrl,
  snapshotBasePath,
  className,
}: {
  observations: readonly PriceObservation[]
  locale: string
  labels: ObservationRecordLabels
  sourcesByUrl?: ReadonlyMap<string, SourceRef>
  snapshotBasePath?: string
  className?: string
}): ReactNode {
  if (observations.length === 0) return null
  const groups = groupByCurrency(observations)

  return (
    // `min-w-0` so a flex ancestor cannot let this table size the page instead
    // of scrolling inside its own box; `relative` so the `sr-only` caption stays
    // clipped here rather than dragging the page wide at 320px.
    <div className={cn("relative max-w-full min-w-0", className)}>
      {/* A scroll edge, not a divider. The four columns fit from `sm` upwards;
          below it the table is wider than the card and the clipped right-hand
          column simply looks absent without a cue. `pointer-events-none` so it
          never swallows a tap on the last cell. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-card to-transparent sm:hidden"
      />
      <div className="azura-scrollbar-slim relative max-w-full min-w-0 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{labels.caption}</caption>
          <thead>
            <tr className="border-b border-border text-left">
              <th
                scope="col"
                className="px-2 py-2 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase first:pl-0"
              >
                {labels.price}
              </th>
              <th
                scope="col"
                className="px-2 py-2 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase"
              >
                {labels.size}
              </th>
              <th
                scope="col"
                className="px-2 py-2 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase"
              >
                {labels.collected}
              </th>
              <th
                scope="col"
                className="px-2 py-2 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase last:pr-0"
              >
                {labels.source}
              </th>
            </tr>
          </thead>

          {groups.flatMap((group, groupIndex) => {
            const rows = group.publishers.map((publisher) => (
              <PublisherRows
                key={`${group.currency}-${publisher.publisher}`}
                group={publisher}
                locale={locale}
                labels={labels}
                {...(sourcesByUrl !== undefined ? { sourcesByUrl } : {})}
                {...(snapshotBasePath !== undefined
                  ? { snapshotBasePath }
                  : {})}
              />
            ))

            if (groupIndex === 0) return rows

            return [
              <tbody key={`break-${group.currency}`} data-slot="currency-break">
                <tr>
                  <td colSpan={4} className="pt-5 pb-1 first:pl-0">
                    <p className="rounded-lg border border-dashed border-border bg-background/60 px-3 py-2 text-xs leading-relaxed font-medium text-muted-foreground">
                      {labels.notComparable}
                    </p>
                  </td>
                </tr>
              </tbody>,
              ...rows,
            ]
          })}
        </table>
      </div>
    </div>
  )
}
