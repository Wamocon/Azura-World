import type { ReactNode } from "react"

import { cn } from "@/lib/cn"

/**
 * Shared scaffolding for the SVG chart primitives.
 *
 * Four rules hold across every chart in this directory. They are not style
 * preferences; each one exists because the alternative produces a chart that
 * lies, breaks, or disappears.
 *
 * ## 1. The SVG draws geometry. HTML carries every glyph.
 *
 * No `<text>` element appears in any chart here. Text inside an SVG scales with
 * the viewBox, so a category label that is legible on a dashboard becomes 7px on
 * a phone and cannot wrap — and German runs about 30% longer than English, with
 * Russian longer still. Labels are therefore real HTML, at real font sizes, free
 * to wrap and hyphenate. The plots use `preserveAspectRatio="none"` precisely
 * because nothing inside them can be distorted by a non-uniform scale: rects
 * stay rects, and strokes are pinned with `vector-effect="non-scaling-stroke"`.
 *
 * ## 2. The picture is decoration. The table is the record.
 *
 * The whole visual is `aria-hidden`, exactly as `PriceConflictLadder` is, and
 * every number it draws exists again as text in a `sr-only` `<table>` whose
 * `<caption>` is the chart's `ariaLabel`. A screen reader gets the data, not a
 * description of a picture. Marking the SVG `role="img"` *as well* would make
 * assistive tech announce the same chart twice, so it is deliberately absent.
 *
 * This is only safe because nothing in a chart is focusable — `aria-hidden`
 * around a focusable element is a defect. Do not put a link or a button inside
 * the visual; put it beside the figure.
 *
 * ## 3. No `id`, anywhere.
 *
 * SVG ids are document-global. Two donuts on one page sharing a `clipPath` id
 * silently cross-reference, and a Server Component cannot call `useId`. So there
 * are no gradients, no clip paths, no filters and no markers in this directory.
 * Rounded ends come from an HTML wrapper with `overflow-hidden`; tinted areas
 * come from `fill-opacity`. That constraint costs nothing and removes an entire
 * class of bug that only appears when a page renders two charts.
 *
 * ## 4. The component formats no numbers.
 *
 * `ChartPoint.value` is geometry and is never rendered. `formattedValue` is what
 * a person reads, and the caller produces it with `Intl` at the correct locale.
 * These primitives are shared across four locales; a `toFixed(1)` in here would
 * print "1234.5" to a German reader who expects "1.234,5". For the same reason
 * every user-visible string — the basis line, the axis labels, the empty state,
 * the table headers — arrives as a prop from `messages/*`.
 */

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/**
 * Index into `--chart-1` … `--chart-5`.
 *
 * A union rather than a `number` so `var(--chart-${tone})` can never be built
 * from a value that has no token behind it — an undefined custom property makes
 * a shape render black, which reads as a deliberate colour rather than a bug.
 *
 * Measured from `globals.css` in the light theme, the five are NOT interchangeable
 * and no chart here may assume they are. In OKLCH they run L 0.52–0.64 and
 * C 0.03–0.14: `--chart-2` is a saturated blue and `--chart-5` a near-neutral
 * slate, so tone order is a visual weight order. Worse for the charts that cycle
 * them, `--chart-1` (L 0.566 C 0.077 h 76°) and `--chart-3` (L 0.569 C 0.078
 * h 123°) differ only in hue, in the yellow-to-green band, which is the classic
 * deuteranopia confusion; and tones 1, 3 and 4 sit within 0.022 L of each other,
 * so they collapse to one grey in greyscale. Hence the rule below: colour is
 * never the only signal.
 */
export type ChartTone = 1 | 2 | 3 | 4 | 5

export const CHART_TONES: readonly ChartTone[] = [1, 2, 3, 4, 5]

/** The CSS custom property for a tone. The only source of chart colour. */
export function toneVar(tone: ChartTone): string {
  return `var(--chart-${tone})`
}

/** Cycles the five tones, so a sixth segment is never invisible. */
export function toneAt(index: number): ChartTone {
  return CHART_TONES[Math.abs(index) % CHART_TONES.length] ?? 1
}

/**
 * Chrome colours. Restricted on purpose to the tokens a chart is allowed to
 * touch: a hairline is `--border`, a reference line is `--muted-foreground`.
 * Nothing here is ever a hex literal, in either theme.
 */
export const GRID_COLOR = "var(--border)"
export const AXIS_COLOR = "var(--muted-foreground)"

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/** One plotted value. `value` is geometry; `formattedValue` is what is read. */
export interface ChartPoint {
  /** Category name, already localised by the caller. */
  label: string
  /** The number, used for geometry only. Never rendered. */
  value: number
  /** The same number as text, already formatted by the caller. */
  formattedValue: string
  /** Overrides the chart's default tone. Use only when colour means something. */
  tone?: ChartTone
}

/** One labelled gridline on a value axis. */
export interface ChartAxisTick {
  value: number
  /** Already formatted by the caller. */
  label: string
}

/** Column headers for the `sr-only` table. Read aloud, so they are translated. */
export interface ChartTableLabels {
  /** What one row is, e.g. "Monat" or "Block". */
  category: string
  /** What the number is, e.g. "Gebuchte Positionen". */
  value: string
}

// ---------------------------------------------------------------------------
// Scales
// ---------------------------------------------------------------------------

/**
 * Horizontal centre of a categorical slot, in percent.
 *
 * A band scale, not a point scale: value *i* of *n* sits at the middle of its
 * share of the width. Bars and lines therefore land on the same x for the same
 * category, and the HTML label grid underneath — *n* equal columns, no gap —
 * aligns exactly, with no fudge factor to drift out of date.
 */
export function bandCenter(index: number, count: number): number {
  if (count <= 0) return 50
  return ((index + 0.5) / count) * 100
}

/**
 * Horizontal position on a point scale, edge to edge, in percent.
 *
 * Used only by the sparkline, which has no category labels to align with and
 * reads better spanning its full width. `inset` keeps the end caps of a pinned
 * stroke inside the viewBox instead of clipping them in half.
 */
export function spanPosition(
  index: number,
  count: number,
  inset = 1.5
): number {
  if (count <= 1) return 50
  return inset + (index / (count - 1)) * (100 - inset * 2)
}

/** Vertical position in percent, top-down, for an SVG y coordinate. */
export function yPercent(value: number, min: number, max: number): number {
  if (max === min) return 50
  return ((max - value) / (max - min)) * 100
}

/**
 * Evenly spaced tick *values* from 0 to `max`, for the caller to label.
 *
 * Returns numbers and not strings on purpose. The caller maps them through its
 * own `Intl.NumberFormat`, because this module does not know the locale and
 * must not guess it.
 */
export function linearTicks(max: number, count = 5): number[] {
  if (!Number.isFinite(max) || count < 2)
    return [0, Number.isFinite(max) ? max : 0]
  return Array.from(
    { length: count },
    (_, index) => (max * index) / (count - 1)
  )
}

/** Drops values that would produce a `NaN` path, before any geometry is built. */
export function plottable(points: readonly ChartPoint[]): ChartPoint[] {
  return points.filter((point) => Number.isFinite(point.value))
}

/**
 * The same guard for ticks, and it is not optional.
 *
 * `domainOf` already refuses to widen a domain with a non-finite tick, but that
 * only protects the *scale*. Gridlines and axis labels are drawn straight from
 * the tick list, so a single `NaN` tick reaches the DOM as `y1="NaN"` and
 * `style="top:NaN%"` — which browsers drop in silence, leaving a chart that is
 * merely missing a line rather than one that visibly failed. Rendered and
 * grepped, so this is measured rather than assumed.
 *
 * The likely caller is not exotic: `Math.max(...[])` is `-Infinity`, so any
 * hand-built axis over an empty series lands here. (`linearTicks` already
 * returns `[0, 0]` for a non-finite max; this covers the ticks it did not make.)
 */
export function plottableTicks(
  ticks: readonly ChartAxisTick[]
): ChartAxisTick[] {
  return ticks.filter((tick) => Number.isFinite(tick.value))
}

/**
 * A domain that always contains the data, zero, and every tick.
 *
 * Folding the ticks into the domain is what stops an axis and its bars from
 * disagreeing: a caller who computes ticks from a rounded maximum can never
 * produce a bar that overshoots the top gridline. A flat domain is widened by
 * one unit rather than left at zero width, so an all-zero series draws a
 * baseline at the bottom instead of collapsing every coordinate onto 50%.
 */
export function domainOf(
  values: readonly number[],
  ticks: readonly ChartAxisTick[]
): { min: number; max: number } {
  const tickValues = ticks.map((tick) => tick.value).filter(Number.isFinite)
  const min = Math.min(0, ...values, ...tickValues)
  const max = Math.max(0, ...values, ...tickValues)
  return min === max ? { min, max: max + 1 } : { min, max }
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

const FRAME_CLASS = "relative flex min-w-0 flex-col gap-2"
const BASIS_CLASS = "text-[0.6875rem] leading-relaxed text-muted-foreground"

/**
 * `<figure>` + hidden visual + `sr-only` record + basis caption.
 *
 * `relative` on the figure is load-bearing and not decoration. `sr-only` is
 * `position: absolute`, and an absolutely positioned table with no positioned
 * ancestor resolves against the page — a 44rem-wide hidden table then drags a
 * 320px viewport into horizontal scroll. That exact bug has already been paid
 * for once in `price-observation-table.tsx`; the containing block is the fix.
 *
 * `className` is declared `string | undefined` rather than optional because
 * `exactOptionalPropertyTypes` rejects passing an absent `className` through to
 * an optional prop. Required-and-nullable keeps the five call sites free of the
 * `{...(x === undefined ? {} : { x })}` dance for a value that is always known.
 */
export function ChartFrame({
  slot,
  ariaLabel,
  basis,
  className,
  children,
  table,
}: {
  slot: string
  ariaLabel: string
  basis: string
  className: string | undefined
  /** The visual. Rendered inside `aria-hidden`; must contain nothing focusable. */
  children: ReactNode
  /** `<thead>` / `<tbody>` for the screen-reader record. */
  table: ReactNode
}): ReactNode {
  return (
    <figure data-slot={slot} className={cn(FRAME_CLASS, className)}>
      <div aria-hidden="true" className="flex min-w-0 flex-col gap-2">
        {children}
      </div>
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        {table}
      </table>
      <figcaption className={BASIS_CLASS}>{basis}</figcaption>
    </figure>
  )
}

/**
 * What a chart renders when it has nothing to draw.
 *
 * Never an empty axis, never a `NaN` path, never a zero-height bar that reads as
 * a measured zero. The basis line stays, because "no data for the last twelve
 * months" and "no data at all" are different statements and the reader is
 * entitled to know which one this is.
 */
export function ChartEmpty({
  slot,
  ariaLabel,
  basis,
  emptyLabel,
  className,
}: {
  slot: string
  ariaLabel: string
  basis: string
  emptyLabel: string
  className: string | undefined
}): ReactNode {
  return (
    <figure
      data-slot={slot}
      data-state="empty"
      className={cn(FRAME_CLASS, className)}
    >
      {/* The chart still names itself, so the empty message has a subject. */}
      <span className="sr-only">{ariaLabel}</span>
      <div className="flex min-h-20 min-w-0 items-center justify-center rounded-xl border border-dashed border-input px-4 py-6 text-center">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {emptyLabel}
        </p>
      </div>
      <figcaption className={BASIS_CLASS}>{basis}</figcaption>
    </figure>
  )
}

/** The `sr-only` record for a single-series chart. */
export function ChartValueTable({
  tableLabels,
  points,
}: {
  tableLabels: ChartTableLabels
  points: readonly ChartPoint[]
}): ReactNode {
  return (
    <>
      <thead>
        <tr>
          <th scope="col">{tableLabels.category}</th>
          <th scope="col">{tableLabels.value}</th>
        </tr>
      </thead>
      <tbody>
        {points.map((point, index) => (
          <tr key={`${point.label}-${index}`}>
            <th scope="row">{point.label}</th>
            <td>{point.formattedValue}</td>
          </tr>
        ))}
      </tbody>
    </>
  )
}

// ---------------------------------------------------------------------------
// Axis
// ---------------------------------------------------------------------------

/**
 * Labelled value axis, as HTML beside the plot.
 *
 * The column sizes itself to its widest label via a zero-height flow copy: a
 * `h-0 overflow-hidden` stack still contributes its intrinsic *width*, while the
 * labels that are actually seen are positioned absolutely at their own values.
 * A fixed `w-12` would clip "1.250.000 €" in German and waste half the gutter on
 * a percentage axis; measuring the text is the only thing that survives four
 * locales.
 *
 * `height` is required and is the plot's height in pixels, because each tick's
 * `top` is a percentage of this column and therefore only lands on its gridline
 * when the column and the plot are the same height. `self-stretch` looks like it
 * arranges that and does not: the axis sits in a flex row whose other child is a
 * *column* holding the plot **and** the category labels, so stretching hands the
 * axis the height of both. Measured, at `height={176}` with a one-line category
 * strip: the column came out 211.5px and the bottom label landed 35.5px below
 * the line it names. An explicit height is also the only version that stays
 * correct when a German category label wraps to two lines and grows the strip.
 */
export function ValueAxis({
  ticks,
  min,
  max,
  height,
}: {
  ticks: readonly ChartAxisTick[]
  min: number
  max: number
  /** The plot's height in px. Must match the `<svg>` beside it exactly. */
  height: number
}): ReactNode {
  if (ticks.length === 0) return null
  return (
    <div className="relative shrink-0" style={{ height: `${height}px` }}>
      <div
        aria-hidden="true"
        className="flex h-0 flex-col overflow-hidden pr-2 text-[0.6875rem] font-medium"
      >
        {ticks.map((tick, index) => (
          <span key={`w-${index}`} data-numeric>
            {tick.label}
          </span>
        ))}
      </div>
      {ticks.map((tick, index) => (
        <span
          key={index}
          data-numeric
          className="absolute right-2 -translate-y-1/2 text-[0.6875rem] leading-none font-medium text-muted-foreground"
          // The position is data. Tailwind cannot express an arbitrary
          // percentage per tick, and the CSP allows inline styles while
          // forbidding inline scripts, so this costs nothing.
          style={{ top: `${yPercent(tick.value, min, max).toFixed(3)}%` }}
        >
          {tick.label}
        </span>
      ))}
    </div>
  )
}

/**
 * Category labels under a plot: *n* equal columns, no gap, so column centres sit
 * exactly on `bandCenter`. A gap would shift every centre inward and the drift
 * grows with the column count.
 *
 * Labels wrap and hyphenate rather than truncate. A truncated German compound is
 * unreadable, and the whole point of keeping labels in HTML is that they can
 * reflow.
 */
export function CategoryStrip({
  labels,
  values,
}: {
  labels: readonly string[]
  /** Formatted values, printed under each label. `undefined` hides the row. */
  values: readonly string[] | undefined
}): ReactNode {
  if (labels.length === 0) return null
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))`,
      }}
    >
      {labels.map((label, index) => (
        <span
          key={`${label}-${index}`}
          className="flex min-w-0 flex-col items-center gap-0.5 px-1 text-center text-[0.6875rem] leading-tight break-words hyphens-auto"
        >
          {values === undefined ? null : (
            <span data-numeric className="font-semibold text-foreground">
              {values[index] ?? ""}
            </span>
          )}
          <span className="text-muted-foreground">{label}</span>
        </span>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

/**
 * Swatch legend for part-to-whole charts.
 *
 * It carries the label *and* the value as text, which is what makes the donut
 * and the stacked bar legible without the colours. Tones 1, 3 and 4 sit within
 * 0.022 OKLCH lightness of each other and 1 and 3 differ only in hue across the
 * yellow-to-green band (see `ChartTone`), so a ring or a bar is a summary of a
 * list and this list is the answer.
 */
export function ChartLegend({
  items,
}: {
  items: readonly { label: string; formattedValue: string; tone: ChartTone }[]
}): ReactNode {
  if (items.length === 0) return null
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item, index) => (
        <li
          key={`${item.label}-${index}`}
          className="flex min-w-0 items-baseline gap-2 text-xs"
        >
          <span
            className="size-2 shrink-0 translate-y-px rounded-sm"
            style={{ backgroundColor: toneVar(item.tone) }}
          />
          <span className="min-w-0 flex-1 break-words hyphens-auto text-muted-foreground">
            {item.label}
          </span>
          <span data-numeric className="shrink-0 font-semibold text-foreground">
            {item.formattedValue}
          </span>
        </li>
      ))}
    </ul>
  )
}
