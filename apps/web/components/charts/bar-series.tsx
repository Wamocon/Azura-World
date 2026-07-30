import type { ReactNode } from "react"

import { staggerDelay } from "@/lib/motion"

import type {
  ChartAxisTick,
  ChartPoint,
  ChartTableLabels,
  ChartTone,
} from "./chart-frame"
import {
  AXIS_COLOR,
  CategoryStrip,
  ChartEmpty,
  ChartFrame,
  ChartValueTable,
  GRID_COLOR,
  ValueAxis,
  domainOf,
  plottable,
  plottableTicks,
  toneVar,
  yPercent,
} from "./chart-frame"

/**
 * Vertical bars with a labelled value axis.
 *
 * ## One colour unless colour means something
 *
 * Every bar is the same tone by default. Cycling the palette across a single
 * series is the most common decorative lie in dashboards: it makes the reader
 * hunt for a distinction that does not exist. A caller sets `tone` per point
 * only when the colour carries information — a modelled figure against a
 * sourced one, a forecast against an actual.
 *
 * ## The axis and the bars cannot disagree
 *
 * The domain is `max(data, ticks, 0)` to `min(data, ticks, 0)`, so a caller who
 * rounds its ticks upward can never produce a bar that overshoots the top
 * gridline, and a caller whose ticks stop short can never produce one that
 * escapes the plot. Zero is always in the domain, so a bar's length is always
 * proportional to its value — a truncated baseline turns a 3% difference into a
 * doubling and is the reason `domainOf` folds zero in unconditionally.
 *
 * ## A non-zero value is never invisible
 *
 * A bar shorter than `MIN_BAR` is drawn at `MIN_BAR`, because a value that
 * rounds to nothing on screen is indistinguishable from an absent one, and those
 * are different claims. A value of exactly zero draws nothing at all: a hairline
 * at the baseline would be a mark where there is no quantity.
 */

export interface BarSeriesProps {
  points: readonly ChartPoint[]
  /** Gridlines and their labels. The caller formats the labels. */
  axisTicks: readonly ChartAxisTick[]
  ariaLabel: string
  /** What the bars are of. From messages. */
  basis: string
  emptyLabel: string
  tableLabels: ChartTableLabels
  /** Default tone for every bar. Per-point `tone` overrides it. */
  tone?: ChartTone
  /** Print the formatted value above each category label. */
  showValues?: boolean
  /** Plot height in px. */
  height?: number
  className?: string
}

const SLOT = "chart-bar-series"

/** Share of a category slot the bar occupies. The rest is the gutter. */
const BAR_FILL = 0.62
/** Shortest drawable bar, in viewBox units out of 100. */
const MIN_BAR = 0.9

export function BarSeries({
  points,
  axisTicks,
  ariaLabel,
  basis,
  emptyLabel,
  tableLabels,
  tone = 1,
  showValues = false,
  height = 176,
  className,
}: BarSeriesProps): ReactNode {
  const drawn = plottable(points)

  if (drawn.length === 0) {
    return (
      <ChartEmpty
        slot={SLOT}
        ariaLabel={ariaLabel}
        basis={basis}
        emptyLabel={emptyLabel}
        className={className}
      />
    )
  }

  // Filtered once, here, and used for the domain, the gridlines and the labels
  // alike. Reading `axisTicks` again anywhere below would put a `NaN` tick back
  // into the geometry. See `plottableTicks`.
  const ticks = plottableTicks(axisTicks)
  const domain = domainOf(
    drawn.map((point) => point.value),
    ticks
  )
  const zeroY = yPercent(0, domain.min, domain.max)
  const slot = 100 / drawn.length
  const barWidth = slot * BAR_FILL

  return (
    <ChartFrame
      slot={SLOT}
      ariaLabel={ariaLabel}
      basis={basis}
      className={className}
      table={<ChartValueTable tableLabels={tableLabels} points={drawn} />}
    >
      {/* `pt-1.5` is the room the topmost axis label needs: it is centred on its
          gridline, so half of it sits above the plot.

          `items-start`, not `items-stretch`: the axis is given the plot's height
          explicitly and must not be stretched over the category strip as well,
          or every tick below the first drifts down. See `ValueAxis`. */}
      <div className="flex min-w-0 items-start gap-2 pt-1.5">
        <ValueAxis
          ticks={ticks}
          min={domain.min}
          max={domain.max}
          height={height}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="block w-full"
            style={{ height: `${height}px` }}
          >
            {ticks.map((tick, index) => {
              const y = yPercent(tick.value, domain.min, domain.max)
              return (
                <line
                  key={`grid-${index}`}
                  x1={0}
                  y1={y}
                  x2={100}
                  y2={y}
                  stroke={GRID_COLOR}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              )
            })}
            {/* Zero is drawn darker than the gridlines. On a chart with negative
                values it is the line every bar is measured from, not one tick
                among several. */}
            <line
              x1={0}
              y1={zeroY}
              x2={100}
              y2={zeroY}
              stroke={AXIS_COLOR}
              strokeOpacity={0.45}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            {drawn.map((point, index) => {
              if (point.value === 0) return null
              const y = yPercent(point.value, domain.min, domain.max)
              const barHeight = Math.max(Math.abs(y - zeroY), MIN_BAR)
              const top = point.value < 0 ? zeroY : zeroY - barHeight
              return (
                <rect
                  key={`${point.label}-${index}`}
                  data-slot="chart-bar"
                  data-value={point.value}
                  x={index * slot + (slot - barWidth) / 2}
                  y={top}
                  width={barWidth}
                  height={barHeight}
                  fill={toneVar(point.tone ?? tone)}
                  // Bars grow out of the baseline in reading order, once, on
                  // arrival. Compositor-only properties, and gated behind
                  // `motion-safe` so reduced motion gets the finished frame
                  // rather than a faster one: with no transition declared the
                  // `@starting-style` block is never entered at all, so the bar
                  // is painted at full height on its first frame.
                  // `transform-box: fill-box` makes `origin-bottom` resolve
                  // against the bar and not the SVG viewport.
                  //
                  // The transition names `scale`, NOT `transform`. Tailwind v4
                  // compiles `scale-y-0` to `--tw-scale-y` plus the individual
                  // `scale` property, and `scale` is not covered by
                  // `transition-property: transform` — they are separate
                  // properties in CSS. Written the obvious way the starting
                  // style is simply discarded, because a starting style only
                  // ever supplies the before-change value for a property that
                  // is actually transitioning: the bars would fade in at full
                  // height and never grow, which is not what the comment above
                  // them says happens. Verified by compiling the candidates
                  // through Tailwind 4.3.3, not by eye.
                  className={
                    "motion-safe:transition-[opacity,scale] motion-safe:duration-500 motion-safe:ease-[var(--ease-out)] motion-safe:[transform-box:fill-box] motion-safe:starting:scale-y-0 motion-safe:starting:opacity-0 " +
                    (point.value < 0
                      ? "motion-safe:origin-top"
                      : "motion-safe:origin-bottom")
                  }
                  // `staggerDelay` returns SECONDS, and is capped so a long
                  // series still finishes arriving in about half a second.
                  style={{ transitionDelay: `${staggerDelay(index)}s` }}
                />
              )
            })}
          </svg>
          <CategoryStrip
            labels={drawn.map((point) => point.label)}
            values={
              showValues
                ? drawn.map((point) => point.formattedValue)
                : undefined
            }
          />
        </div>
      </div>
    </ChartFrame>
  )
}
