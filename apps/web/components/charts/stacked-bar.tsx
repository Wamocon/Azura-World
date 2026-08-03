import type { ReactNode } from "react"

import { staggerDelay } from "@/lib/motion"

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
 * A single horizontal bar at 100%, split into labelled segments.
 *
 * The composition chart for a fixed whole: 656 units by layout, 833 assets by
 * licence, a portfolio by status. It answers "what is this made of" and refuses
 * to answer "how big is it" — the total belongs in the text beside it, because a
 * bar that is always full length cannot carry magnitude.
 *
 * ## Construction
 *
 * A track rect in `--border` fills the width; the segments are drawn on top with
 * a small inset on each side, so the gap between them is the track showing
 * through. That gives a separator without a second colour and without a
 * `clipPath` — the rounded ends come from an HTML wrapper with
 * `overflow-hidden`, since this directory emits no ids (see `chart-frame.tsx`).
 *
 * ## A non-zero segment is never invisible
 *
 * Below `MIN_SEGMENT` a segment is drawn at `MIN_SEGMENT`, because a category
 * with two members must not disappear into a category with none. The space comes
 * out of the segments that have room to spare, in proportion to what each has
 * spare, so the bar still measures exactly 100 and the distortion is bounded at
 * a pixel or two, only ever in the direction of showing something that exists.
 * `barsOf` has the detail, including what happens when the widening is not
 * merely a rounding matter.
 *
 * Every segment is also in the legend below with its label and value as text, so
 * a segment too small to see is still readable, and so the split survives
 * greyscale.
 */

export interface StackedBarProps {
  segments: readonly ChartPoint[]
  ariaLabel: string
  basis: string
  emptyLabel: string
  tableLabels: ChartTableLabels
  /** Bar height in px. */
  height?: number
  className?: string
}

const SLOT = "chart-stacked-bar"

const VIEW_HEIGHT = 10
/** Inset on each side of a segment, in viewBox units out of 100. */
const GAP = 0.25
/** Narrowest drawable segment, in viewBox units out of 100. */
const MIN_SEGMENT = 0.8
/** The track a segment needs: its own width plus the inset on each side. */
const MIN_SLOT = MIN_SEGMENT + GAP * 2

interface Bar {
  key: string
  tone: ChartTone
  x: number
  width: number
  value: number
  /** For the hover tooltip: the category and its formatted value. */
  label: string
  display: string
}

/**
 * Running offsets across the bar.
 *
 * A module function rather than an accumulator threaded through `map` inside the
 * component: the React Compiler rejects reassigning a captured variable during
 * render, and a prefix sum is a pure transform of the input anyway.
 *
 * Each segment gets a *slot* proportional to its value, and the rect is that
 * slot inset by `GAP` on each side — which is where the separator comes from.
 * A slot too small to draw is raised to `MIN_SLOT`, and the extra is **borrowed
 * from the slots that have room**, in proportion to what each has to spare.
 *
 * The borrowing is the part that is easy to get wrong, and getting it wrong is
 * silent. Widening a segment in place without taking the space from anywhere
 * leaves the next one starting inside it and painting over it: measured on
 * 656 units split 1 / 1 / 1 / 653, the three single-unit segments each drew at
 * `MIN_SEGMENT` and each ended up 0.46px wide on a 300px bar, which is exactly
 * the disappearance `MIN_SEGMENT` exists to prevent. Borrowing keeps the slots
 * summing to 100, so nothing overlaps and nothing is pushed off the end either.
 */
function barsOf(segments: readonly ChartPoint[], total: number): Bar[] {
  // Negative values are not a slice of a whole and take no track. They still
  // reach the legend and the record table verbatim, so the oddity stays visible.
  const slots = segments.map((segment) =>
    segment.value <= 0 ? 0 : (segment.value / total) * 100
  )

  let deficit = 0
  let spare = 0
  for (const slot of slots) {
    if (slot <= 0) continue
    if (slot < MIN_SLOT) deficit += MIN_SLOT - slot
    else spare += slot - MIN_SLOT
  }
  // Never takes more than there is to give. Past roughly 76 segments the track
  // cannot hold them all at the minimum and the tail is clipped by the viewBox,
  // which is the honest failure: a fixed-width bar cannot show what does not fit.
  const borrowed = Math.min(deficit, spare)

  const bars: Bar[] = []
  let cursor = 0
  for (const [index, segment] of segments.entries()) {
    const raw = slots[index] ?? 0
    if (raw <= 0) continue
    const slot =
      raw < MIN_SLOT
        ? MIN_SLOT
        : spare > 0
          ? raw - ((raw - MIN_SLOT) / spare) * borrowed
          : raw
    bars.push({
      key: `${segment.label}-${index}`,
      tone: segment.tone ?? toneAt(index),
      x: cursor + GAP,
      // `slot >= MIN_SLOT` holds by construction on both branches, so this is
      // never below `MIN_SEGMENT` and never negative.
      width: slot - GAP * 2,
      value: segment.value,
      label: segment.label,
      display: segment.formattedValue,
    })
    cursor += slot
  }
  return bars
}

export function StackedBar({
  segments,
  ariaLabel,
  basis,
  emptyLabel,
  tableLabels,
  height = 16,
  className,
}: StackedBarProps): ReactNode {
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

  const bars = barsOf(drawn, total)

  return (
    <ChartFrame
      slot={SLOT}
      ariaLabel={ariaLabel}
      basis={basis}
      className={className}
      table={<ChartValueTable tableLabels={tableLabels} points={drawn} />}
    >
      <div className="w-full min-w-0 overflow-hidden rounded-md">
        <svg
          viewBox={`0 0 100 ${VIEW_HEIGHT}`}
          preserveAspectRatio="none"
          className="block w-full"
          style={{ height: `${height}px` }}
        >
          <rect
            x={0}
            y={0}
            width={100}
            height={VIEW_HEIGHT}
            fill={GRID_COLOR}
          />
          {bars.map((bar, index) => (
            <rect
              key={bar.key}
              data-slot="chart-segment"
              data-value={bar.value}
              x={bar.x}
              y={0}
              width={bar.width}
              height={VIEW_HEIGHT}
              fill={toneVar(bar.tone)}
              // Hover brightens the segment; the native tooltip names it. The
              // widen-on-arrival animation still runs: it names `scale`, NOT
              // `transform` — Tailwind v4 compiles `scale-x-0` to the individual
              // `scale` property, which `transition-property: transform` does not
              // cover. Gated behind `motion-safe`, so reduced motion paints the
              // segment at full width on its first frame. See `bar-series.tsx`.
              className="cursor-default hover:brightness-110 motion-safe:origin-left motion-safe:transition-[opacity,scale] motion-safe:duration-500 motion-safe:ease-[var(--ease-out)] motion-safe:[transform-box:fill-box] motion-safe:starting:scale-x-0 motion-safe:starting:opacity-0"
              // `staggerDelay` returns SECONDS, and is capped.
              style={{ transitionDelay: `${staggerDelay(index)}s` }}
            >
              {/* One text node — see the note in `donut.tsx`. */}
              <title>{`${bar.label}: ${bar.display}`}</title>
            </rect>
          ))}
        </svg>
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
