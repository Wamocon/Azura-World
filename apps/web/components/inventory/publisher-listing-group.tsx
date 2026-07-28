import { ExternalLink } from "lucide-react"
import type { ReactNode } from "react"

import { formatMoney } from "@/components/evidence/format"
import { cn } from "@/lib/cn"

import type { PublisherGroup } from "./listing-analysis"
import { ListingStaleBadge } from "./listing-stale-badge"

/**
 * One publisher's listings, as published.                    Owner: W3-C / N1
 *
 * The W3-C brief: *"Every scraped listing, grouped by publisher. Per listing:
 * URL, fetch date, layout, size, price in its own currency."*
 *
 * ## Grouping by publisher is the argument, not a tidy-up
 *
 * A flat table sorted by price makes the 47 rows look like one market. They are
 * not: they are seven publishers describing the same 656 apartments, four of them
 * quoting figures that cannot all be true. Grouped, the block header states how
 * much evidence a publisher actually contributed (18 rows from Haspo, 2 from
 * TERRA), which is the context that qualifies every price underneath it.
 *
 * ## The stale badge sits in the price cell
 *
 * Not a footnote, not a row tint alone, not a column at the far right. A reader
 * scanning for the cheapest number must meet the staleness in the same glance.
 * The row tint is a second, redundant channel, and the badge carries a
 * screen-reader reason so the warning is not colour-plus-shape only.
 *
 * ## Notes are printed verbatim and never truncated
 *
 * Some are four lines long ("WRONG-DISTRICT SUSPECT: Azura World is in Türkler…
 * the page states district 'Oba'"). They are the harvest's own caveats about the
 * row they sit on, and the €112 000 low anchor of the whole price range carries
 * one. Shortening evidence to tidy a layout is not a trade this module makes.
 *
 * ## No stored snapshot for a listing row, and the row says so
 *
 * `PortalListing` carries no `snapshotHash` (HANDOFF/W3-C.md §8 request 4), so a
 * listing links its live URL and nothing else. A fabricated hash would break
 * invariant 6, and a listing is the single most likely thing in this dataset to
 * be edited or deleted after collection.
 */

export interface ListingGroupLabels {
  /** Column headings. */
  price: string
  layout: string
  area: string
  kind: string
  fetchedAt: string
  source: string
  /** Cell text when the page stated no layout. */
  layoutUnstated: string
  /** Cell text when the page stated no size. */
  areaUnstated: string
  /** Cell text when the page stated no price. Never "0". */
  priceUnstated: string
  /** Price-kind values. */
  kindSale: string
  kindRent: string
  kindUnknown: string
  /** e.g. "Veraltet" */
  stale: string
  staleReason: string
  /** Screen-reader prefix for a verbatim harvest note. */
  note: string
  /** e.g. "Inserat öffnen" */
  openListing: string
  /** Template with `{publisher}`, for the table caption. */
  caption: string
  /** Template with `{count}` — rows in this group. */
  listingCount: string
  /** Template with `{count}` — distinct pages behind those rows. */
  pageCount: string
  /** Template with `{count}` — stale rows in this group. */
  staleCount: string
  /** Template with `{count}` — rent rows, which never join a sale series. */
  rentCount: string
  /** e.g. "Zuletzt erhoben" */
  lastFetched: string
}

export function PublisherListingGroup({
  group,
  locale,
  labels,
  className,
}: {
  group: PublisherGroup
  locale: string
  labels: ListingGroupLabels
  className?: string
}): ReactNode {
  return (
    <section
      data-slot="publisher-group"
      data-publisher={group.publisher}
      className={cn(
        "rounded-xl border border-border bg-card",
        // Two shadows: a 1px contact shadow plus a wide, very soft ambient one.
        // A single blurred drop reads as a sticker; a large surface should read
        // as thicker than a chip (apple-design §12).
        "shadow-[0_1px_0_0_var(--color-border),0_12px_32px_-24px_rgb(0_0_0/0.35)]",
        className
      )}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="font-display text-base font-semibold tracking-[-0.012em] text-foreground">
            {group.publisher}
          </h3>
          <p className="text-xs text-muted-foreground">
            {fill(labels.listingCount, {
              count: String(group.listings.length),
            })}
            {" · "}
            {fill(labels.pageCount, { count: String(group.pageCount) })}
            {group.rentCount > 0
              ? ` · ${fill(labels.rentCount, { count: String(group.rentCount) })}`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {group.currencies.map((currency) => (
            <span
              key={currency}
              className="inline-flex min-h-6 items-center rounded-md border border-input px-1.5 text-[0.6875rem] font-semibold tracking-[0.06em] text-muted-foreground uppercase"
            >
              {currency}
            </span>
          ))}
          {group.staleCount > 0 ? (
            <ListingStaleBadge
              label={fill(labels.staleCount, {
                count: String(group.staleCount),
              })}
              reason={labels.staleReason}
            />
          ) : null}
          {group.lastFetchedAt.length > 0 ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {labels.lastFetched}{" "}
              <time dateTime={group.lastFetchedAt}>
                {formatCollectedAt(group.lastFetchedAt, locale)}
              </time>
            </span>
          ) : null}
        </div>
      </header>

      <div className="relative max-w-full min-w-0">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-card to-transparent lg:hidden"
        />
        <div className="azura-scrollbar-slim relative max-w-full min-w-0 overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-sm">
            <caption className="sr-only">
              {fill(labels.caption, { publisher: group.publisher })}
            </caption>
            <thead>
              <tr className="border-b border-border text-left">
                <Th className="pl-4 sm:pl-5">{labels.price}</Th>
                <Th>{labels.layout}</Th>
                <Th>{labels.area}</Th>
                <Th>{labels.kind}</Th>
                <Th>{labels.fetchedAt}</Th>
                <Th className="pr-4 sm:pr-5">{labels.source}</Th>
              </tr>
            </thead>
            <tbody>
              {group.listings.map((listing, index) => (
                <tr
                  key={`${listing.id}-${index}`}
                  data-slot="listing-row"
                  data-stale={listing.isStale ? "" : undefined}
                  data-price-kind={listing.priceKind ?? "unknown"}
                  className={cn(
                    "border-b border-border/60 align-top last:border-b-0",
                    "transition-colors duration-150 ease-[var(--ease-out)]",
                    "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/40",
                    listing.isStale && "bg-quality-stale/[0.06]"
                  )}
                >
                  <td className="py-2.5 pr-4 pl-4 sm:pl-5">
                    <span className="flex flex-wrap items-center gap-2">
                      {listing.price === null ? (
                        // A missing price is honest; `0` would be a lie and a
                        // blank cell reads as a rendering bug.
                        <span className="text-muted-foreground">
                          {labels.priceUnstated}
                        </span>
                      ) : (
                        <span
                          data-numeric
                          className="font-display text-[0.9375rem] font-semibold tracking-[-0.01em]"
                        >
                          {/* The publisher's own currency. Never converted. */}
                          {formatMoney(listing.price, locale)}
                        </span>
                      )}
                      {listing.isStale ? (
                        <ListingStaleBadge
                          label={labels.stale}
                          reason={labels.staleReason}
                        />
                      ) : null}
                    </span>
                    {listing.note !== null && listing.note.length > 0 ? (
                      <span className="mt-1 block max-w-[26rem] text-xs leading-relaxed text-muted-foreground">
                        <span className="sr-only">{labels.note}: </span>
                        {listing.note}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2.5 pr-4 text-muted-foreground">
                    {listing.layout ?? labels.layoutUnstated}
                  </td>
                  <td className="py-2.5 pr-4" data-numeric>
                    {listing.interiorM2 === null ? (
                      <span className="text-muted-foreground">
                        {labels.areaUnstated}
                      </span>
                    ) : (
                      `${new Intl.NumberFormat(locale).format(listing.interiorM2)} m²`
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-muted-foreground">
                    {listing.priceKind === "sale"
                      ? labels.kindSale
                      : listing.priceKind === "rent"
                        ? labels.kindRent
                        : labels.kindUnknown}
                  </td>
                  <td className="py-2.5 pr-4 text-muted-foreground tabular-nums">
                    <time dateTime={listing.fetchedAt}>
                      {formatCollectedAt(listing.fetchedAt, locale)}
                    </time>
                  </td>
                  <td className="py-2.5 pr-4 sm:pr-5">
                    <span className="inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-md border border-input bg-background px-2 py-0.5 text-xs text-muted-foreground">
                      <a
                        href={listing.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`${labels.openListing}: ${listing.url}`}
                        className={cn(
                          "inline-flex min-h-6 min-w-0 items-center gap-1 rounded-sm font-medium",
                          "transition-transform duration-100 ease-[var(--ease-out)] active:scale-[0.97] motion-reduce:active:scale-100",
                          "outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        )}
                      >
                        <span className="truncate">{labels.openListing}</span>
                        <ExternalLink
                          className="size-3 shrink-0"
                          aria-hidden="true"
                        />
                      </a>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function Th({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}): ReactNode {
  return (
    <th
      scope="col"
      className={cn(
        "py-2 pr-4 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase",
        className
      )}
    >
      {children}
    </th>
  )
}

function formatCollectedAt(iso: string, locale: string): string {
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return iso
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(parsed))
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key)
      ? (values[key] ?? match)
      : match
  )
}
