import type { ReactNode } from "react"

import { cn } from "@/lib/cn"
import { formatMoney, interpolate } from "@/components/evidence/format"
import { staggerDelay } from "@/lib/motion"
import type { Money } from "@/lib/contracts"

/**
 * PriceConflictLadder — the shape of a disagreement.        Owner: W3-C
 *
 * F-002 is this project's primary honesty gate: the 1+1 entry price spans
 * 112.000 € to 310.000 € across three publishers, while a fourth quotes roughly
 * 239.000 USD for the same layout. There is no such thing as "the price of a
 * 1+1 at Azura World", and this component's whole job is to make that the first
 * thing a person sees rather than something they work out by reading a table.
 *
 * ## One rail per currency, and they are never joined
 *
 * The design decision that carries the argument: each currency gets its own
 * axis, with its own endpoints, separated by a gap that says "not comparable —
 * no conversion". Putting EUR and USD on one line would require a rate and a
 * rate date that no source provides, and CONVENTIONS §5 forbids exactly that.
 * The incommensurability is not a footnote here; it is the layout.
 *
 * That is also why there is no midpoint marker, no average, and no "typical"
 * band. F-002's `resolvedTo` is `null` by design and `pnpm qa:evidence` fails
 * the build if anyone sets it. A ladder that drew a median would be arguing the
 * opposite of what the finding says.
 *
 * ## The ticks are decoration; the table is the record
 *
 * The whole ladder is `aria-hidden`. Every observation it draws is rendered
 * again as real text in `PriceObservationTable` directly below, with publisher,
 * area, date and a link to both the live URL and the stored snapshot. A screen
 * reader gets the evidence, not a description of a picture — and azura-ui-ux §3
 * requires the specs to live in the DOM for exactly this reason.
 *
 * Consequently nothing here is hover-only. A `title` on each tick is a mouse
 * convenience over information that is already present as text; azura-ui-ux
 * §5.3 rules out hover as the *only* route to a conflict, not as an extra one.
 *
 * ## No JavaScript
 *
 * A Server Component with CSS positioning. It renders identically before
 * hydration, under a blocked script, and with JS off — which matters more than
 * usual here, because W-INT §4 records a night when every script on the site
 * was CSP-blocked and the pages still *looked* right.
 */

/** One observed price. `stale` comes from the listing, never inferred here. */
export interface PriceObservation {
  money: Money
  publisher: string
  /**
   * `null` when the publisher stated a price without saying which layout it is
   * for — Alanya-Home quotes a project entry price this way. Rendered as
   * "not stated" rather than guessed from the area: inferring `1+1` from
   * 85 m² would be a judgement dressed as an observation.
   */
  layout: string | null
  /** `null` when the publisher did not state a size. */
  interiorM2: number | null
  stale: boolean
  url: string
  fetchedAt: string
  /** The parser's verbatim caveat — wrong district, "from" price, etc. */
  note: string | null
}

export interface LadderLabels {
  /** Template with `{count}` and `{publishers}`. */
  railSummary: string
  /** Between the rails, e.g. "nicht vergleichbar · keine Umrechnung". */
  notComparable: string
  /**
   * Template with `{ratio}` and `{currency}`, e.g. "Spanne {ratio}× (nur
   * {currency})".
   *
   * The currency is part of the label, not context to be inferred from the rail
   * header — F-002's own message quotes a 2.1× range computed by comparing a EUR
   * figure with a USD one, which is precisely the conversion this component
   * refuses to make. The EUR-only span is 2.8×. Two different, defensible
   * numbers, and an unscoped "Spanne 2,8×" would read as contradicting the
   * finding printed directly above it.
   */
  spread: string
  /** Marks a stale observation in the legend and per tick. */
  stale: string
  /** e.g. "günstigste Angabe" / "teuerste Angabe". */
  lowest: string
  highest: string
  /** Shown when a rail has a single observation and no span. */
  singleObservation: string
  /**
   * Template with `{percent}`. Shown instead of a spread when the rail's values
   * are within `NEGLIGIBLE_SPREAD` of each other.
   */
  negligible: string
}

/**
 * Below this ratio a rail is treated as having no meaningful spread.
 *
 * Each rail normalises to its own min and max, which is right for comparing
 * publishers within a currency and **actively misleading** when the values are
 * nearly identical: Housearch's two USD observations are 0.09 % apart and were
 * being drawn at 0 % and 100 % of the axis — visually indistinguishable from
 * the EUR rail's genuine 2.8× disagreement. The numbers underneath were
 * correct and nobody reads numbers to correct an impression the picture already
 * gave them. So a negligible spread is drawn as what it is: one cluster.
 */
const NEGLIGIBLE_SPREAD = 1.05

interface Rail {
  currency: Money["currency"]
  observations: PriceObservation[]
}

/**
 * Groups observations by currency, cheapest rail first.
 *
 * Sorted by the rail's own minimum rather than by currency name so the reading
 * order is stable and meaningful; sorting alphabetically would put USD above
 * EUR for no reason a reader could infer.
 */
export function railsByCurrency(
  observations: readonly PriceObservation[]
): Rail[] {
  const byCurrency = new Map<Money["currency"], PriceObservation[]>()
  for (const observation of observations) {
    const existing = byCurrency.get(observation.money.currency)
    if (existing === undefined) byCurrency.set(observation.money.currency, [observation])
    else existing.push(observation)
  }

  const rails: Rail[] = []
  for (const [currency, group] of byCurrency) {
    rails.push({
      currency,
      observations: [...group].sort((a, b) => a.money.amount - b.money.amount),
    })
  }
  return rails.sort(
    (a, b) =>
      (a.observations[0]?.money.amount ?? 0) - (b.observations[0]?.money.amount ?? 0)
  )
}

/** Percent along the axis. A rail with no span puts everything at the centre. */
function positionOf(amount: number, min: number, max: number): number {
  if (max === min) return 50
  return ((amount - min) / (max - min)) * 100
}

function LadderRail({
  rail,
  locale,
  labels,
}: {
  rail: Rail
  locale: string
  labels: LadderLabels
}): ReactNode {
  const amounts = rail.observations.map((observation) => observation.money.amount)
  const min = Math.min(...amounts)
  const max = Math.max(...amounts)
  const publishers = Array.from(
    new Set(rail.observations.map((observation) => observation.publisher))
  )
  const cheapest = rail.observations[0]
  const dearest = rail.observations[rail.observations.length - 1]
  const spread = min > 0 ? max / min : 1
  const negligible = spread < NEGLIGIBLE_SPREAD
  const hasSpan = max > min && !negligible

  return (
    <div className="flex flex-col gap-2" data-slot="ladder-rail" data-currency={rail.currency}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {rail.currency}
          <span className="ml-2 font-normal normal-case tracking-normal">
            {interpolate(labels.railSummary, {
              count: rail.observations.length,
              publishers: publishers.join(" · "),
            })}
          </span>
        </p>
        {hasSpan ? (
          <p className="text-xs font-semibold text-confidence-conflicted" data-numeric>
            {interpolate(labels.spread, {
              ratio: new Intl.NumberFormat(locale, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              }).format(spread),
              currency: rail.currency,
            })}
          </p>
        ) : rail.observations.length < 2 ? (
          <p className="text-xs text-muted-foreground">{labels.singleObservation}</p>
        ) : (
          <p className="text-xs font-medium text-muted-foreground">
            {interpolate(labels.negligible, {
              percent: new Intl.NumberFormat(locale, {
                style: "percent",
                maximumFractionDigits: 2,
              }).format(spread - 1),
            })}
          </p>
        )}
      </div>

      {/* The axis. Decoration: every tick below is real text in the table. */}
      <div aria-hidden="true" className="relative h-11 select-none">
        <div className="absolute inset-x-0 top-5 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
        {/* End caps, so an axis with one observation still reads as an axis. */}
        <div className="absolute left-0 top-3 h-5 w-px bg-border" />
        <div className="absolute right-0 top-3 h-5 w-px bg-border" />

        {rail.observations.map((observation, index) => {
          // A negligible spread clusters at the centre instead of being
          // stretched across the axis. See NEGLIGIBLE_SPREAD.
          const left = negligible
            ? 50
            : positionOf(observation.money.amount, min, max)
          return (
            <span
              key={`${observation.url}-${observation.money.amount}-${index}`}
              data-slot="ladder-tick"
              data-stale={observation.stale}
              data-amount={observation.money.amount}
              title={`${formatMoney(observation.money, locale)} · ${observation.publisher}${
                observation.stale ? ` · ${labels.stale}` : ""
              }`}
              // An inline style, because the position is data. Tailwind cannot
              // express an arbitrary percentage per tick, and the CSP allows
              // inline STYLES (`style-src 'self' 'unsafe-inline'`) while
              // forbidding inline scripts — so this costs nothing.
              // Both values are data, so both are inline. The CSP allows inline
              // STYLES (`style-src 'self' 'unsafe-inline'`) while forbidding
              // inline scripts, so this costs nothing.
              //
              // `staggerDelay` caps its accumulation (W1-D's STAGGER_CAP), so
              // thirteen ticks still finish arriving in about half a second
              // rather than marching across the screen for two.
              style={{
                left: `${left}%`,
                // `staggerDelay` returns SECONDS — W1-D's `stagger.base` is
                // 0.05, sized for Framer Motion, which takes seconds. Writing
                // `${…}ms` produced a 0.05ms stagger: thirteen ticks arriving
                // simultaneously while the code claimed a cascade. Caught by
                // asserting the computed delays differ, not by looking at it.
                transitionDelay: `${staggerDelay(index)}s`,
              }}
              className={cn(
                "absolute top-1 -translate-x-1/2 origin-bottom",
                // The one motion moment on this screen, and it is the data
                // landing: each tick grows out of the axis, in price order.
                // Emil's frequency test permits it — a page-load animation, not
                // something triggered dozens of times a day — and
                // `@starting-style` keeps it a pure CSS *transition*: off the
                // main thread, interruptible, and needing no keyframe in
                // globals.css, which this window does not own.
                "transition-[opacity,transform] duration-500 ease-[var(--ease-out)]",
                "opacity-100 scale-y-100 starting:opacity-0 starting:scale-y-[0.35]",
                // Reduced motion gets the finished frame, never a slower one.
                "motion-reduce:transition-none motion-reduce:opacity-100 motion-reduce:scale-y-100",
                // Stale observations are a hollow, dashed, taller mark — a
                // difference in SHAPE, not only in colour. One man in twelve
                // cannot use the colour, and a screenshot in a report loses it
                // entirely (azura-ui-ux §5.5).
                observation.stale
                  ? "h-9 w-2 rounded-full border-2 border-dashed border-quality-stale bg-transparent"
                  : "h-9 w-1 rounded-full bg-confidence-conflicted shadow-[0_0_0_3px_var(--color-surface-conflict)]"
              )}
            />
          )
        })}
      </div>

      <div className="flex items-start justify-between gap-4 text-xs">
        <span className="flex flex-col">
          <span data-numeric className="font-display font-semibold">
            {cheapest === undefined ? "—" : formatMoney(cheapest.money, locale)}
          </span>
          <span className="text-muted-foreground">
            {labels.lowest}
            {cheapest === undefined ? "" : ` · ${cheapest.publisher}`}
          </span>
        </span>
        {/* Both endpoints are always named when they differ, including on a
            clustered rail — the ticks stop claiming a span, the figures still
            report one. */}
        {dearest !== undefined && cheapest !== dearest ? (
          <span className="flex flex-col text-right">
            <span data-numeric className="font-display font-semibold">
              {formatMoney(dearest.money, locale)}
            </span>
            <span className="text-muted-foreground">
              {labels.highest} · {dearest.publisher}
            </span>
          </span>
        ) : null}
      </div>
    </div>
  )
}

export function PriceConflictLadder({
  observations,
  locale,
  labels,
  className,
}: {
  observations: readonly PriceObservation[]
  locale: string
  labels: LadderLabels
  className?: string
}): ReactNode {
  const rails = railsByCurrency(observations)
  if (rails.length === 0) return null

  const anyStale = observations.some((observation) => observation.stale)

  return (
    <div
      data-slot="price-conflict-ladder"
      className={cn("flex flex-col gap-5", className)}
    >
      {rails.map((rail, index) => (
        <div key={rail.currency} className="flex flex-col gap-5">
          {index > 0 ? (
            // The separator IS the argument: two currencies, no rate, no
            // conversion, therefore two axes. Not a divider for rhythm.
            <p className="flex items-center gap-3 text-xs font-medium text-muted-foreground">
              <span
                aria-hidden="true"
                className="h-px flex-1 bg-[repeating-linear-gradient(90deg,var(--color-border)_0_4px,transparent_4px_8px)]"
              />
              <span>{labels.notComparable}</span>
              <span
                aria-hidden="true"
                className="h-px flex-1 bg-[repeating-linear-gradient(90deg,var(--color-border)_0_4px,transparent_4px_8px)]"
              />
            </p>
          ) : null}
          <LadderRail rail={rail} locale={locale} labels={labels} />
        </div>
      ))}

      {anyStale ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            aria-hidden="true"
            className="inline-block h-4 w-2 rounded-full border-2 border-dashed border-quality-stale"
          />
          {labels.stale}
        </p>
      ) : null}
    </div>
  )
}
