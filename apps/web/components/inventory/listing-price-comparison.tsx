import { ExternalLink } from "lucide-react"
import type { ReactNode } from "react"

import { formatMoney } from "@/components/evidence/format"
import { cn } from "@/lib/cn"

import type { ComparisonColumn } from "./listing-analysis"
import { ListingStaleBadge } from "./listing-stale-badge"

/**
 * The side-by-side comparison.                               Owner: W3-C / N1
 *
 * ## What this screen is for
 *
 * One layout, every publisher that quotes it, prices as published. It is the
 * view the W3-C brief names as the one that makes F-002 legible at a glance:
 * four portals, four prices, one of them in dollars.
 *
 * ## One column per currency, and they are NEVER joined
 *
 * A single table with a "price" column would put €112 000 and $239 171 into one
 * visual series and invite a reader to rank them. Ranking them needs an exchange
 * rate and the date it was taken, and **no source in this dataset publishes
 * either**. CONVENTIONS §5 forbids converting anywhere but a display edge that
 * can label the rate; there is no such rate here, so there is no conversion,
 * no toggle, and no "approximately".
 *
 * Between the columns sits a stated separator rather than a border. The
 * incommensurability is the layout, not a footnote under it.
 *
 * ## The spread figure, and the one this component refuses to compute
 *
 * Each column shows `max / min` **within its own currency**, labelled with that
 * currency. On the 1+1 sale rows that is 2.8× across the euro publishers and
 * 1.0× across the dollar one.
 *
 * F-002's own text quotes **2.1×**, and that number is Haspo's €112 000 measured
 * against Housearch's $239 171 — the exact cross-currency comparison this
 * product refuses to make. The finding is quoted where it belongs, as the
 * finding's wording with its own attribution, and never recomputed here as
 * though it were ours. (Reported to W0-B as request 2 in HANDOFF/W3-C.md.)
 *
 * ## No ranking, no "best value", no midpoint
 *
 * `F-002.resolvedTo` is `null` by design and `pnpm qa:evidence` fails the build
 * if anyone sets it. A "cheapest" ribbon would be this page resolving a conflict
 * the dataset deliberately leaves open.
 */

export interface ComparisonLabels {
  /** Column heading for the publisher, e.g. "Portal". */
  publisher: string
  /** e.g. "Preis laut Portal" */
  price: string
  /** e.g. "Inserate" */
  count: string
  /** Between the two currency columns, e.g. "nicht vergleichbar, keine Umrechnung". */
  notComparable: string
  /** Template with `{ratio}` and `{currency}`, e.g. "Spanne {ratio} (nur {currency})". */
  spread: string
  /** Shown instead of a spread when a column holds one price. */
  singlePrice: string
  /** e.g. "Veraltet" */
  stale: string
  /** Why a stale row is stale, read by screen readers next to the badge. */
  staleReason: string
  /** Template with `{count}`, e.g. "{count} Inserate". */
  listingCount: string
  /** Shown when a publisher quotes a range rather than one figure. */
  upTo: string
  /** e.g. "Inserat öffnen" */
  openListing: string
  /** Caption for the whole comparison, for screen readers. */
  caption: string
}

export function ListingPriceComparison({
  columns,
  locale,
  labels,
  /**
   * Show each column's `max / min`.
   *
   * **Off for the layout-unstated band, and that is not tidiness.** A spread is
   * a claim that the figures either end of it describe comparable things. Those
   * rows are not comparable to each other: Alanya-Home's €125 000 is a "from"
   * price for the whole project, while Capital Estate's €1 450 000 is a specific
   * 305 m² apartment whose page says "5+ rooms" — a label outside the frozen
   * `UnitLayout` union, which is the only reason it has no layout. Rendering
   * "11.6x" over that mixture would be exactly the false comparison the two
   * currency columns exist to refuse.
   */
  showSpread = true,
  className,
}: {
  columns: readonly ComparisonColumn[]
  locale: string
  labels: ComparisonLabels
  showSpread?: boolean
  className?: string
}): ReactNode {
  if (columns.length === 0) return null

  return (
    <div
      data-slot="price-comparison"
      className={cn(
        // A recessed well rather than a flat panel: it groups the columns and
        // their separator into ONE object the eye reads as a single comparison,
        // which is the whole argument of the section.
        "rounded-xl border border-border bg-background/50 p-4 sm:p-5",
        className
      )}
    >
      <p className="sr-only">{labels.caption}</p>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-stretch lg:gap-0">
        {columns.map((column, index) => (
          <div key={column.currency} className="contents">
            {index > 0 ? <Separator label={labels.notComparable} /> : null}
            <CurrencyColumn
              column={column}
              locale={locale}
              labels={labels}
              showSpread={showSpread}
              className="min-w-0 flex-1 lg:px-5 lg:first:pl-0 lg:last:pr-0"
            />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The gap between two currencies, stated in words.
 *
 * A plain border would read as a table gridline — decoration a reader skips. A
 * dashed rule carrying the sentence "not comparable, no conversion" is the one
 * piece of chrome on this page that has to be read, so it is text.
 *
 * **`lg:w-8`, not `lg:w-px`.** The first version sized the flex item to the
 * hairline and let the rotated label overflow it: measured on the rendered page,
 * the vertical caption sat ON TOP of the last EUR card's right edge. A rule is a
 * hairline; a rule *with a label on it* needs the label's width. The dashed line
 * is drawn by the children, so the track can be as wide as the text needs.
 */
function Separator({ label }: { label: string }): ReactNode {
  return (
    <div
      className={cn(
        "flex items-center gap-3",
        // Horizontal rule when the columns stack; vertical when they sit side by
        // side. The label rotates with it so it reads in both directions.
        "lg:w-8 lg:shrink-0 lg:flex-col lg:gap-2 lg:self-stretch"
      )}
    >
      <span
        aria-hidden="true"
        className="h-px flex-1 bg-[repeating-linear-gradient(to_right,var(--color-border)_0_4px,transparent_4px_8px)] lg:h-auto lg:w-px lg:bg-[repeating-linear-gradient(to_bottom,var(--color-border)_0_4px,transparent_4px_8px)]"
      />
      <span className="shrink-0 text-center text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase lg:[writing-mode:vertical-rl]">
        {label}
      </span>
      <span
        aria-hidden="true"
        className="h-px flex-1 bg-[repeating-linear-gradient(to_right,var(--color-border)_0_4px,transparent_4px_8px)] lg:h-auto lg:w-px lg:bg-[repeating-linear-gradient(to_bottom,var(--color-border)_0_4px,transparent_4px_8px)]"
      />
    </div>
  )
}

function CurrencyColumn({
  column,
  locale,
  labels,
  showSpread,
  className,
}: {
  column: ComparisonColumn
  locale: string
  labels: ComparisonLabels
  showSpread: boolean
  className?: string
}): ReactNode {
  const { band } = column

  return (
    <section className={className} aria-label={column.currency}>
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
        <h4 className="font-display text-sm font-semibold tracking-[0.06em] text-foreground uppercase">
          {column.currency}
        </h4>
        {band !== null && showSpread ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {band.count > 1 && band.spreadRatio > 1.005
              ? fill(labels.spread, {
                  ratio: formatRatio(band.spreadRatio, locale),
                  currency: column.currency,
                })
              : labels.singlePrice}
          </span>
        ) : null}
      </header>

      <ul className="flex flex-col gap-2.5">
        {column.cells.map((cell) => (
          <li
            key={`${cell.currency}-${cell.publisher}`}
            data-slot="comparison-cell"
            data-publisher={cell.publisher}
            data-stale={cell.hasStale ? "" : undefined}
            className={cn(
              "flex flex-col gap-1 rounded-lg border px-3 py-2.5",
              "transition-colors duration-150 ease-[var(--ease-out)]",
              "[@media(hover:hover)_and_(pointer:fine)]:hover:border-primary/40",
              cell.hasStale
                ? "border-quality-stale/30 bg-quality-stale/[0.06]"
                : "border-border bg-card"
            )}
          >
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {/* The figure is the subject of the row: display face, one size
                  step up, negative tracking so large numerals do not read
                  loose. Rendered in the publisher's own currency, always. */}
              <span
                data-numeric
                className="font-display text-base font-semibold tracking-[-0.01em] text-foreground"
              >
                {formatMoney(
                  { amount: cell.min, currency: cell.currency },
                  locale
                )}
              </span>
              {cell.max > cell.min ? (
                <span className="text-sm text-muted-foreground tabular-nums">
                  {labels.upTo}{" "}
                  {formatMoney(
                    { amount: cell.max, currency: cell.currency },
                    locale
                  )}
                </span>
              ) : null}
              {cell.hasStale ? (
                // Next to the price. This is the brief's rule and the reason the
                // badge is a shared component.
                <ListingStaleBadge
                  label={labels.stale}
                  reason={labels.staleReason}
                />
              ) : null}
            </span>

            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <a
                href={cell.cheapest.url}
                target="_blank"
                rel="noopener noreferrer"
                title={`${labels.openListing}: ${cell.cheapest.url}`}
                className={cn(
                  "inline-flex min-h-6 items-center gap-1 rounded-sm font-medium text-foreground",
                  "transition-transform duration-100 ease-[var(--ease-out)] active:scale-[0.97] motion-reduce:active:scale-100",
                  "outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                )}
              >
                {cell.publisher}
                <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
              </a>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">
                {fill(labels.listingCount, { count: String(cell.count) })}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * `2,8` — one decimal, in the reader's locale.
 *
 * One decimal deliberately: rounding 2.77 to "3" overstates a disagreement and
 * rounding 1.04 to "1" hides one.
 */
function formatRatio(ratio: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(ratio)
}

/**
 * `{name}` substitution.
 *
 * W1-D's provenance components interpolate plain `{name}` templates themselves
 * and are not interchangeable with next-intl's ICU strings (HANDOFF/W3-C.md §8
 * request 5). These labels follow the plain convention, so the same one-line
 * helper serves them.
 */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key)
      ? (values[key] ?? match)
      : match
  )
}
