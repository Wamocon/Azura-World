import type { ReactNode } from "react"

import type { ChartAxisTick, ChartTone } from "./chart-frame"
import {
  AXIS_COLOR,
  CategoryStrip,
  ChartEmpty,
  ChartFrame,
  GRID_COLOR,
  ValueAxis,
  bandCenter,
  domainOf,
  plottableTicks,
  toneAt,
  toneVar,
  yPercent,
} from "./chart-frame"

/**
 * One or more series over a shared category axis.
 *
 * ## A missing month breaks the line. It is never bridged.
 *
 * `value: null` is a gap in the record, and the path stops and restarts around
 * it. Interpolating across it would draw a number nobody observed, in a product
 * whose entire premise is that every figure carries a source. The `sr-only`
 * table prints `gapLabel` for the same cell, so the absence is stated in words
 * as well as in the shape — never a zero, never a blank, never an em dash.
 *
 * A single non-null reading surrounded by gaps still renders, as a dot: a
 * zero-length subpath with a round cap. Dropping it because it has no neighbour
 * to connect to would delete an observation.
 *
 * ## Series differ by dash pattern as well as by colour
 *
 * Cycling the five chart tones puts `--chart-1` and `--chart-3` next to each
 * other, and those two differ only in hue, across the yellow-to-green band, at
 * the same lightness and the same chroma (see `ChartTone` for the measurements).
 * Deuteranopia cannot separate that pair, and greyscale cannot separate tones 1,
 * 3 and 4 at all. Each series therefore also gets its own dash pattern, and the
 * legend swatch repeats it. Colour is never the only signal.
 */

/** One reading. `null` is a genuine gap, not a zero. */
export interface LinePoint {
  value: number | null
  /** Formatted by the caller. Ignored when `value` is `null`. */
  formattedValue: string
}

export interface LineSeriesDatum {
  /** Shown in the legend and used as a column header in the record table. */
  name: string
  /** Aligned to `categories` by index. */
  points: readonly LinePoint[]
  tone?: ChartTone
}

/** The record table's first column header. The others are the series names. */
export interface LineTableLabels {
  category: string
}

export interface LineSeriesProps {
  /** X labels, already formatted by the caller. */
  categories: readonly string[]
  series: readonly LineSeriesDatum[]
  axisTicks: readonly ChartAxisTick[]
  ariaLabel: string
  basis: string
  emptyLabel: string
  /** What a missing reading is called, e.g. "Keine Angabe". From messages. */
  gapLabel: string
  tableLabels: LineTableLabels
  /** Plot height in px. */
  height?: number
  className?: string
}

const SLOT = "chart-line-series"

/**
 * Dash patterns, in device pixels — `non-scaling-stroke` takes the dash array
 * out of user space along with the width, so these do not stretch with the box.
 */
const DASHES = ["none", "6 3", "1.5 3", "9 3 1.5 3", "3 2"] as const

function dashAt(index: number): string {
  return DASHES[index % DASHES.length] ?? "none"
}

/**
 * Path data for one series, split at every gap.
 *
 * Returns a single `d` string containing one subpath per contiguous run. A run
 * of one point is emitted as `M x y L x y`, which with `stroke-linecap="round"`
 * renders as a dot of the stroke's width.
 */
function pathFor(
  points: readonly LinePoint[],
  count: number,
  min: number,
  max: number
): string {
  const runs: [number, number][][] = []
  let run: [number, number][] = []

  // A reading with no category cannot be placed: `bandCenter` would put it past
  // the right edge, where the viewBox clips it without saying so. Dropping it
  // here keeps the plot, the record table and the value domain describing one
  // and the same set of points.
  points.slice(0, count).forEach((point, index) => {
    const value = point.value
    if (value === null || !Number.isFinite(value)) {
      if (run.length > 0) runs.push(run)
      run = []
      return
    }
    run.push([bandCenter(index, count), yPercent(value, min, max)])
  })
  if (run.length > 0) runs.push(run)

  return runs
    .map((coordinates) => {
      const head = coordinates[0]
      if (head === undefined) return ""
      const body = coordinates
        .map(
          ([x, y], index) =>
            `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`
        )
        .join(" ")
      return coordinates.length === 1
        ? `${body} L${head[0].toFixed(2)} ${head[1].toFixed(2)}`
        : body
    })
    .filter((subpath) => subpath !== "")
    .join(" ")
}

export function LineSeries({
  categories,
  series,
  axisTicks,
  ariaLabel,
  basis,
  emptyLabel,
  gapLabel,
  tableLabels,
  height = 208,
  className,
}: LineSeriesProps): ReactNode {
  // Bounded by `categories`, for the same reason `pathFor` is. A series carrying
  // more readings than there are categories would otherwise stretch the value
  // axis with numbers that are drawn nowhere and listed nowhere, leaving every
  // visible point sitting below its own gridline with no way to see why.
  const values: number[] = []
  for (const datum of series) {
    for (const point of datum.points.slice(0, categories.length)) {
      if (point.value !== null && Number.isFinite(point.value)) {
        values.push(point.value)
      }
    }
  }

  if (categories.length === 0 || values.length === 0) {
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
  // alike. Reading `axisTicks` again below would put a `NaN` tick back into the
  // geometry. See `plottableTicks`.
  const ticks = plottableTicks(axisTicks)
  const domain = domainOf(values, ticks)
  const zeroY = yPercent(0, domain.min, domain.max)
  const resolved = series.map((datum, index) => ({
    datum,
    tone: datum.tone ?? toneAt(index),
    dash: dashAt(index),
  }))

  return (
    <ChartFrame
      slot={SLOT}
      ariaLabel={ariaLabel}
      basis={basis}
      className={className}
      table={
        <>
          <thead>
            <tr>
              <th scope="col">{tableLabels.category}</th>
              {series.map((datum, index) => (
                <th key={`${datum.name}-${index}`} scope="col">
                  {datum.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((category, row) => (
              <tr key={`${category}-${row}`}>
                <th scope="row">{category}</th>
                {series.map((datum, column) => {
                  const point = datum.points[row]
                  return (
                    <td key={`${datum.name}-${column}`}>
                      {point === undefined ||
                      point.value === null ||
                      !Number.isFinite(point.value)
                        ? gapLabel
                        : point.formattedValue}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </>
      }
    >
      {resolved.length > 1 ? (
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {resolved.map(({ datum, tone, dash }, index) => (
            <li
              key={`${datum.name}-${index}`}
              className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
            >
              <svg
                viewBox="0 0 24 4"
                preserveAspectRatio="none"
                className="h-1 w-6 shrink-0"
              >
                <line
                  x1={0}
                  y1={2}
                  x2={24}
                  y2={2}
                  stroke={toneVar(tone)}
                  strokeWidth={2.5}
                  strokeDasharray={dash}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <span className="min-w-0 break-words hyphens-auto">
                {datum.name}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

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
            {domain.min < 0 ? (
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
            ) : null}
            {resolved.map(({ datum, tone, dash }, index) => {
              const d = pathFor(
                datum.points,
                categories.length,
                domain.min,
                domain.max
              )
              if (d === "") return null
              return (
                <path
                  key={`${datum.name}-${index}`}
                  data-slot="chart-line"
                  d={d}
                  fill="none"
                  stroke={toneVar(tone)}
                  strokeWidth={2}
                  strokeDasharray={dash}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              )
            })}
          </svg>
          <CategoryStrip labels={categories} values={undefined} />
        </div>
      </div>
    </ChartFrame>
  )
}
