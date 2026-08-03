import type { ReactNode } from "react"

import { formatMoney, interpolate } from "@/components/evidence/format"
import {
  groupByCurrency,
  isComparable,
  NEGLIGIBLE_SPREAD,
  type CurrencyGroup,
  type PublisherGroup,
} from "@/components/evidence/evidence-conflict-model"
import { Explain, type ExplainLabels } from "@/components/ui/explain"
import { cn } from "@/lib/cn"
import { staggerDelay } from "@/lib/motion"
import type { Money } from "@/lib/contracts"

import type { PriceObservation } from "@/components/inventory/price-conflict-ladder"

/**
 * One bar per portal, and the price at the end of it.       Owner: W-EVIDENCE
 *
 * ## What this replaces, and why
 *
 * The previous graphic drew every observation as a tick on a shared rail:
 * thirteen dashes and solid marks on one line, normalised between the cheapest
 * and the dearest figure. Reviewed with the client, it failed at the first
 * question anybody asks a picture, which is "what am I looking at". A tick has
 * no name attached, the end labels collided at narrow widths, and eight ticks
 * belonging to one portal read as eight independent opinions.
 *
 * The finding is not "there are thirteen numbers". It is **four portals quote
 * different prices for the same apartment**. So the mark is the portal, not the
 * observation: one horizontal bar each, sorted cheapest first, the portal's name
 * on the left and its price on the right. Length encodes price from zero, which
 * is the one bar-chart rule that may never be bent, and four bars of visibly
 * different length answer the question before anything is read.
 *
 * ## Two scales that never touch
 *
 * Each currency is a separate block with its own zero-based scale, separated by
 * a sentence saying they are not comparable. Nothing here converts: no source
 * supplies a rate or a rate date, and a converted figure would be an invented
 * number wearing a citation (CONVENTIONS §5).
 *
 * ## What a bar deliberately does not say
 *
 * No average, no midpoint, no "typical" band, no recommendation. The solid part
 * of a bar ends at the *lowest figure that portal actually published* and the
 * pale striped part extends to its *highest*. Both ends are real observations
 * with a source; nothing between them is claimed.
 *
 * ## No JavaScript
 *
 * A Server Component. Bar widths are inline styles because a width is data, and
 * the CSP allows inline styles while forbidding inline scripts. It renders
 * identically before hydration, with a blocked script, and with JS switched off.
 */

export interface PriceBarsLabels {
  /** Heading over the whole chart. */
  heading: string
  /** Template with `{currency}`, e.g. "Quoted in {currency}". */
  groupHeading: string
  /** Template with `{portals}` and `{count}`. */
  groupMeta: string
  /** Template with `{count}`. Used when the group has one portal. */
  groupMetaSingle: string
  /** Template with `{count}`, e.g. "{count} listings". */
  listings: string
  /** Used instead of `listings` when the portal published exactly one. */
  oneListing: string
  /** Template with `{high}`, e.g. "up to {high}". */
  upTo: string
  /** Short marker on a portal whose listings are out of date. */
  stale: string
  /** Template with `{stale}` and `{count}` for a partly stale portal. */
  staleSome: string
  /** Legend line explaining the stale marker. */
  staleNote: string
  /** Legend line explaining the solid part of a bar. */
  entryNote: string
  /** Legend line explaining the striped part of a bar. */
  rangeNote: string
  /** Legend line stating that bars start at zero. */
  scaleNote: string
  /** The sentence between two currency blocks. */
  notComparable: string
  /** Template with `{low}`, `{high}` and `{ratio}`. */
  spread: string
  /** Shown when only one portal quotes in a currency. */
  singleSourceNote: string
}

export interface PriceBarsExplain {
  conflicted: ExplainLabels
  singleSource: ExplainLabels
}

/**
 * The currency in the reader's language: "Euro", "US-Dollar", "доллар США".
 *
 * From `Intl`, not from the message catalogue, so it cannot drift out of sync
 * with the four locales. Falls back to the ISO code, which is still correct and
 * still unambiguous, rather than throwing on an unexpected runtime.
 */
function currencyName(currency: string, locale: string): string {
  try {
    return (
      new Intl.DisplayNames([locale], { type: "currency" }).of(currency) ??
      currency
    )
  } catch {
    return currency
  }
}

function countLabel(count: number, labels: PriceBarsLabels): string {
  return count === 1
    ? labels.oneListing
    : interpolate(labels.listings, { count })
}

function PortalBar({
  group,
  scaleMax,
  locale,
  labels,
  index,
  showTrack,
}: {
  group: PublisherGroup
  scaleMax: number
  locale: string
  labels: PriceBarsLabels
  index: number
  /**
   * False when the block holds one portal quoting one figure.
   *
   * A bar drawn against a scale whose maximum is its own value is always full
   * width, which says nothing and, worse, reads as "the biggest number on the
   * page" beside a block in another currency. Where there is nothing to compare,
   * nothing is drawn: the figure and the sentence explaining why carry the row.
   */
  showTrack: boolean
}): ReactNode {
  const low: Money = { amount: group.low, currency: group.currency }
  const high: Money = { amount: group.high, currency: group.currency }
  const lowPercent = scaleMax > 0 ? (group.low / scaleMax) * 100 : 0
  const highPercent = scaleMax > 0 ? (group.high / scaleMax) * 100 : 0
  const total = group.observations.length
  const allStale = group.staleCount > 0 && group.staleCount === total
  const someStale = group.staleCount > 0 && group.staleCount < total
  const hasRange = group.high > group.low

  // The bar's own delay. `staggerDelay` returns SECONDS (W1-D's `stagger.base`
  // is sized for Framer Motion), so the unit here is `s` and not `ms`.
  const delay = `${staggerDelay(index, 0.06)}s`

  return (
    <li
      data-slot="price-bar"
      data-publisher={group.publisher}
      data-currency={group.currency}
      data-stale={allStale}
      className="flex flex-col gap-1.5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{group.publisher}</span>
          {group.staleCount > 0 ? (
            // Text, not only a colour. A screenshot in a report loses hue and
            // one man in twelve cannot use it at all (azura-ui-ux §5.5).
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

        {/* The figure the eye lands on, and it is the portal's own cheapest
            published price. What it is NOT is stated one line below, where the
            range and the listing count live. */}
        <span
          data-numeric
          className="font-display text-base font-semibold tracking-[-0.01em] tabular-nums sm:text-lg"
        >
          {formatMoney(low, locale)}
        </span>
      </div>

      {/* Decoration. Every figure it encodes is text in this same row and again
          in the record table below, so it is hidden from assistive technology
          rather than described to it. */}
      {showTrack ? (
        <div
          aria-hidden="true"
          className="relative h-6 w-full overflow-hidden rounded-md border border-border/60 bg-muted/40"
        >
          {hasRange ? (
            <div
              style={{ width: `${highPercent}%`, transitionDelay: delay }}
              className={cn(
                "absolute inset-y-0 left-0 origin-left rounded-r-[2px]",
                // Transform only. Animating `width` would lay out on every frame;
                // `@starting-style` keeps this a pure CSS transition with no
                // keyframe in globals.css, which this component does not own.
                "transition-transform duration-500 ease-[var(--ease-out)]",
                "scale-x-100 starting:scale-x-0",
                "motion-reduce:scale-x-100 motion-reduce:transition-none",
                allStale
                  ? "bg-[repeating-linear-gradient(135deg,var(--color-quality-stale)_0_3px,transparent_3px_8px)]"
                  : "bg-[repeating-linear-gradient(135deg,var(--color-confidence-conflicted)_0_3px,transparent_3px_8px)]"
              )}
            />
          ) : null}

          <div
            style={{ width: `${lowPercent}%`, transitionDelay: delay }}
            className={cn(
              "absolute inset-y-0 left-0 origin-left rounded-r-[2px]",
              "transition-transform duration-500 ease-[var(--ease-out)]",
              "scale-x-100 starting:scale-x-0",
              "motion-reduce:scale-x-100 motion-reduce:transition-none",
              allStale ? "bg-quality-stale" : "bg-confidence-conflicted"
            )}
          />
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {countLabel(total, labels)}
        {hasRange ? (
          <>
            {" · "}
            <span data-numeric className="tabular-nums">
              {interpolate(labels.upTo, { high: formatMoney(high, locale) })}
            </span>
          </>
        ) : null}
      </p>
    </li>
  )
}

function CurrencyBlock({
  group,
  locale,
  labels,
  explain,
}: {
  group: CurrencyGroup
  locale: string
  labels: PriceBarsLabels
  explain: PriceBarsExplain
}): ReactNode {
  const name = currencyName(group.currency, locale)
  const portals = group.publishers.length
  const disagrees = portals > 1 && group.spread >= NEGLIGIBLE_SPREAD
  // Something to compare: either more than one portal, or one portal whose own
  // figures actually span a range. Neither ⟹ no bars, see `showTrack`. The test
  // lives in the model so the key below the chart cannot answer it differently.
  const comparable = isComparable(group)

  return (
    <section
      data-slot="price-bar-group"
      data-currency={group.currency}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 className="font-display text-sm font-semibold tracking-[-0.01em]">
          {interpolate(labels.groupHeading, { currency: name })}
        </h4>
        <p className="text-xs text-muted-foreground">
          {portals === 1
            ? interpolate(labels.groupMetaSingle, { count: group.count })
            : interpolate(labels.groupMeta, {
                portals,
                count: group.count,
              })}
        </p>
      </div>

      <ol className="flex flex-col gap-4">
        {group.publishers.map((publisher, index) => (
          <PortalBar
            key={`${group.currency}-${publisher.publisher}`}
            group={publisher}
            scaleMax={group.high}
            locale={locale}
            labels={labels}
            index={index}
            showTrack={comparable}
          />
        ))}
      </ol>

      {disagrees ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-confidence-conflicted/35 bg-surface-conflict px-3 py-2 text-xs leading-relaxed font-medium text-confidence-conflicted">
          <span data-numeric>
            {interpolate(labels.spread, {
              low: formatMoney(
                { amount: group.low, currency: group.currency },
                locale
              ),
              high: formatMoney(
                { amount: group.high, currency: group.currency },
                locale
              ),
              ratio: new Intl.NumberFormat(locale, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              }).format(group.spread),
            })}
          </span>
          {/* `iconOnly`: the sentence already says the thing in plain words, so
              repeating the glossary term beside it would read as a stray label.
              The trigger keeps its accessible name and its 24px target. */}
          <Explain
            labels={explain.conflicted}
            iconOnly
            // `min-w-6`: the icon alone is 14px wide and CONVENTIONS §5 puts the
            // floor for a tap target at 24px in BOTH directions. The component
            // sets the height; the width has to be asked for.
            className="min-w-6"
          />
        </p>
      ) : null}

      {portals === 1 ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-relaxed text-muted-foreground">
          <span>{labels.singleSourceNote}</span>
          <Explain labels={explain.singleSource} iconOnly className="min-w-6" />
        </p>
      ) : null}
    </section>
  )
}

export function EvidencePriceBars({
  observations,
  locale,
  labels,
  explain,
  className,
}: {
  observations: readonly PriceObservation[]
  locale: string
  labels: PriceBarsLabels
  explain: PriceBarsExplain
  className?: string
}): ReactNode {
  const groups = groupByCurrency(observations)
  if (groups.length === 0) return null

  const anyStale = observations.some((observation) => observation.stale)
  // The key only describes marks that are actually on screen. A block with one
  // portal and one figure draws no bar at all, so its lines are not offered.
  const anyTrack = groups.some(isComparable)
  // `isComparable` again, per group: a portal whose figures span a range is only
  // DRAWN with a striped extension if its own block drew tracks. Housearch's two
  // dollar quotes are 0.09 % apart in a single-portal block — a range in the
  // data, no stripe on screen — and describing a stripe nobody can see is the
  // same failure as omitting one that is there.
  const anyRange = groups.some(
    (group) =>
      isComparable(group) &&
      group.publishers.some((publisher) => publisher.high > publisher.low)
  )

  return (
    <section
      data-slot="evidence-price-bars"
      aria-labelledby="evidence-price-bars-heading"
      className={cn("flex min-w-0 flex-col gap-5", className)}
    >
      <h3
        id="evidence-price-bars-heading"
        className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase"
      >
        {labels.heading}
      </h3>

      {groups.map((group, index) => (
        <div key={group.currency} className="flex flex-col gap-5">
          {index > 0 ? (
            // The separator carries the argument, so it is a sentence and not a
            // rule: two currencies, no rate, therefore two scales.
            <p className="rounded-lg border border-dashed border-border bg-background/60 px-3 py-2 text-xs leading-relaxed font-medium text-muted-foreground">
              {labels.notComparable}
            </p>
          ) : null}
          <CurrencyBlock
            group={group}
            locale={locale}
            labels={labels}
            explain={explain}
          />
        </div>
      ))}

      {/* The key. A few short lines, each tied to a mark that is actually on
          screen, so the picture never depends on the reader guessing. An empty
          key is not rendered at all rather than left as a bordered gap. */}
      {anyTrack || anyStale ? (
        <ul className="flex flex-col gap-1.5 border-t border-border/70 pt-3 text-xs leading-relaxed text-muted-foreground">
          {anyTrack ? (
            <li className="flex items-start gap-2">
              <span
                aria-hidden="true"
                className="mt-1 inline-block h-2.5 w-5 shrink-0 rounded-[2px] bg-confidence-conflicted"
              />
              <span>{labels.entryNote}</span>
            </li>
          ) : null}
          {anyRange ? (
            <li className="flex items-start gap-2">
              <span
                aria-hidden="true"
                className="mt-1 inline-block h-2.5 w-5 shrink-0 rounded-[2px] border border-confidence-conflicted/40 bg-[repeating-linear-gradient(135deg,var(--color-confidence-conflicted)_0_3px,transparent_3px_8px)]"
              />
              <span>{labels.rangeNote}</span>
            </li>
          ) : null}
          {anyStale ? (
            <li className="flex items-start gap-2">
              <span
                aria-hidden="true"
                className="mt-1 inline-block h-2.5 w-5 shrink-0 rounded-[2px] bg-quality-stale"
              />
              <span>{labels.staleNote}</span>
            </li>
          ) : null}
          {anyTrack ? (
            <li className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-1 w-5 shrink-0" />
              <span>{labels.scaleNote}</span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  )
}
