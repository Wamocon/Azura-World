import type { ReactNode } from "react"

import type { ChartPoint, ChartTableLabels, ChartTone } from "./chart-frame"
import {
  ChartEmpty,
  ChartFrame,
  ChartLegend,
  ChartValueTable,
  GRID_COLOR,
  plottable,
  toneAt,
  toneVar,
} from "./chart-frame"

/**
 * Part-to-whole, with the total in the middle.
 *
 * ## Built from `pathLength`, not from π
 *
 * The ring is one `<circle>` per segment, each with `pathLength="100"` so that
 * `stroke-dasharray` is expressed directly in percent. No circumference to
 * compute, no arc-flag arithmetic to get wrong at 180°, and no `id` for a
 * gradient or a clip path — see `chart-frame.tsx` on why this directory emits
 * no ids at all.
 *
 * ## Colour is not the only signal
 *
 * Every segment appears in the legend underneath with its label and its value as
 * text, in the caller's order. Cycling the five tones puts `--chart-1` beside
 * `--chart-3`, which differ only in hue across the yellow-to-green band (see
 * `ChartTone`) and are the classic deuteranopia confusion, and tones 1, 3 and 4
 * are one grey in greyscale. So the ring is a summary and the list is the answer.
 *
 * ## Refusals
 *
 * No percentages are computed for display. The ring's geometry is a proportion,
 * but the number a reader sees is `formattedValue`, which the caller produced at
 * the right locale with the right rounding. A `47.6%` invented here would be a
 * figure with no source in a product built around sources.
 *
 * Negative values are clamped to zero for geometry, because a negative slice of
 * a whole is not a thing that can be drawn. The value still appears verbatim in
 * the legend and in the record table, so the oddity is visible rather than
 * silently corrected.
 */

export interface DonutProps {
  segments: readonly ChartPoint[]
  ariaLabel: string
  basis: string
  emptyLabel: string
  tableLabels: ChartTableLabels
  /** The figure in the middle, formatted by the caller. */
  centerValue: string
  /** Small caption under it, e.g. "Einheiten gesamt". From messages. */
  centerLabel?: string
  className?: string
}

const SLOT = "chart-donut"

const RADIUS = 38
const STROKE = 13
/** Separator between segments, in the same percent units as the dash array. */
const GAP = 0.7

interface Arc {
  key: string
  tone: ChartTone
  /** Length of the drawn dash, in percent of the circumference. */
  dash: number
  /** Where the segment starts, in percent, clockwise from twelve o'clock. */
  start: number
  /** For the hover tooltip: the category and its formatted value. */
  label: string
  display: string
}

/**
 * Running offsets for the ring.
 *
 * A module function rather than an accumulator threaded through `map` inside the
 * component: the React Compiler rejects reassigning a captured variable during
 * render, and it is right to — a prefix sum is a pure transform of the input and
 * has no business living in the render body.
 */
function arcsOf(segments: readonly ChartPoint[], total: number): Arc[] {
  const arcs: Arc[] = []
  let offset = 0
  for (const [index, segment] of segments.entries()) {
    const share = (Math.max(segment.value, 0) / total) * 100
    arcs.push({
      key: `${segment.label}-${index}`,
      tone: segment.tone ?? toneAt(index),
      // A segment smaller than the separator would produce a negative dash.
      dash: Math.max(share - GAP, 0),
      start: offset,
      label: segment.label,
      display: segment.formattedValue,
    })
    offset += share
  }
  return arcs
}

export function Donut({
  segments,
  ariaLabel,
  basis,
  emptyLabel,
  tableLabels,
  centerValue,
  centerLabel,
  className,
}: DonutProps): ReactNode {
  const drawn = plottable(segments)
  const total = drawn.reduce(
    (sum, segment) => sum + Math.max(segment.value, 0),
    0
  )

  if (drawn.length === 0 || total <= 0) {
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

  const arcs = arcsOf(drawn, total)

  return (
    <ChartFrame
      slot={SLOT}
      ariaLabel={ariaLabel}
      basis={basis}
      className={className}
      table={<ChartValueTable tableLabels={tableLabels} points={drawn} />}
    >
      <div className="relative mx-auto w-full max-w-56 min-w-0">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid meet"
          className="block h-auto w-full"
        >
          {/* The track, so a ring with one small segment still reads as a ring
              rather than as a stray arc. */}
          <circle
            cx={50}
            cy={50}
            r={RADIUS}
            fill="none"
            stroke={GRID_COLOR}
            strokeWidth={STROKE}
          />
          {arcs.map((arc) => (
            <circle
              key={arc.key}
              data-slot="chart-arc"
              cx={50}
              cy={50}
              r={RADIUS}
              fill="none"
              stroke={toneVar(arc.tone)}
              strokeWidth={STROKE}
              pathLength={100}
              strokeDasharray={`${arc.dash.toFixed(3)} ${(100 - arc.dash).toFixed(3)}`}
              strokeDashoffset={-arc.start}
              // Start at twelve o'clock and run clockwise, which is how a
              // proportion is read. The default start is three o'clock.
              transform="rotate(-90 50 50)"
              // Hover: the segment brightens, and a native tooltip names it with
              // its value. Costs no JavaScript and needs no client boundary, so
              // it works in the server-rendered chart exactly as shipped.
              className="cursor-default transition-[filter] duration-150 hover:brightness-115"
            >
              <title>
                {arc.label}: {arc.display}
              </title>
            </circle>
          ))}
        </svg>
        {/* HTML, not <text>: the centre label has to hold a German compound at
            320px, so it needs a real font size, wrapping and hyphenation. */}
        <div className="pointer-events-none absolute inset-[24%] flex flex-col items-center justify-center gap-0.5 text-center">
          <span
            data-numeric
            className="font-display text-lg leading-none font-semibold break-words hyphens-auto text-foreground"
          >
            {centerValue}
          </span>
          {centerLabel === undefined ? null : (
            <span className="text-[0.6875rem] leading-tight break-words hyphens-auto text-muted-foreground">
              {centerLabel}
            </span>
          )}
        </div>
      </div>
      <ChartLegend
        items={drawn.map((segment, index) => ({
          label: segment.label,
          formattedValue: segment.formattedValue,
          tone: segment.tone ?? toneAt(index),
        }))}
      />
    </ChartFrame>
  )
}
