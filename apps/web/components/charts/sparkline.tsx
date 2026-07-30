import type { ReactNode } from "react"

import type { ChartPoint, ChartTableLabels, ChartTone } from "./chart-frame"
import {
  ChartEmpty,
  ChartFrame,
  ChartValueTable,
  plottable,
  spanPosition,
  toneVar,
  yPercent,
} from "./chart-frame"

/**
 * Sparkline — a trend, at the size of a line of text.
 *
 * No axes, no ticks, no numbers. A sparkline answers one question ("which way,
 * and how steadily") and deliberately cannot answer "how much" — the KPI figure
 * beside it does that. Adding an axis would make it a small bad chart instead of
 * a good small one.
 *
 * It is normalised to its own minimum and maximum, which is the honest reading
 * of "shape of the last twelve months" and a dishonest reading of "how big are
 * these numbers": a series moving between 412 and 418 fills the box exactly as
 * dramatically as one moving between 4 and 800. That is why `basis` is required
 * and why the shape is never shown without the KPI value it belongs to.
 *
 * ## Why `preserveAspectRatio="none"`
 *
 * A sparkline has to fill whatever width its card happens to be, and letterboxed
 * to a fixed ratio it would sit in a pool of empty space. Stretching the viewBox
 * would normally thin the stroke and squash any round marker, so the stroke is
 * pinned with `vector-effect="non-scaling-stroke"` and the end marker is a
 * vertical tick rather than a dot — a circle under a non-uniform scale becomes
 * an ellipse, and there is no way to correct for it in static SVG.
 */

export interface SparklineProps {
  /** In order. Non-finite values are dropped before any geometry is built. */
  points: readonly ChartPoint[]
  /** Read aloud as the caption of the `sr-only` table. */
  ariaLabel: string
  /** What the line is of, e.g. "12 Monate, gebuchte Positionen". From messages. */
  basis: string
  /** Shown instead of the line when there is nothing to draw. From messages. */
  emptyLabel: string
  tableLabels: ChartTableLabels
  tone?: ChartTone
  /** Tint the area under the line. Reads better inside a dense KPI card. */
  area?: boolean
  /** Plot height in px. */
  height?: number
  className?: string
}

const SLOT = "chart-sparkline"

/** Vertical inset, in viewBox units, so a pinned stroke is not clipped. */
const INSET = 4
const VIEW_HEIGHT = 32

export function Sparkline({
  points,
  ariaLabel,
  basis,
  emptyLabel,
  tableLabels,
  tone = 1,
  area = false,
  height = 32,
  className,
}: SparklineProps): ReactNode {
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

  const values = drawn.map((point) => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const stroke = toneVar(tone)

  // A flat series sits on the centre line rather than on the floor. Pinning it
  // to the bottom would read as "collapsed to nothing", which is the opposite of
  // what an unchanging number means.
  const coordinates = drawn.map((point, index) => {
    const x = spanPosition(index, drawn.length)
    const y =
      INSET +
      (yPercent(point.value, min, max) / 100) * (VIEW_HEIGHT - INSET * 2)
    return { x, y }
  })

  const line = coordinates
    .map(
      ({ x, y }, index) =>
        `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`
    )
    .join(" ")

  const first = coordinates[0]
  const last = coordinates[coordinates.length - 1]
  const areaPath =
    area && first !== undefined && last !== undefined && coordinates.length > 1
      ? `${line} L${last.x.toFixed(2)} ${VIEW_HEIGHT} L${first.x.toFixed(2)} ${VIEW_HEIGHT} Z`
      : null

  return (
    <ChartFrame
      slot={SLOT}
      ariaLabel={ariaLabel}
      basis={basis}
      className={className}
      table={<ChartValueTable tableLabels={tableLabels} points={drawn} />}
    >
      <svg
        viewBox={`0 0 100 ${VIEW_HEIGHT}`}
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height: `${height}px` }}
      >
        {areaPath === null ? null : (
          <path d={areaPath} fill={stroke} fillOpacity={0.1} stroke="none" />
        )}
        {coordinates.length > 1 ? (
          <path
            d={line}
            fill="none"
            stroke={stroke}
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {/* The latest reading, marked so the eye knows which end is "now".
            A vertical tick, not a dot: see the header note on aspect ratio. */}
        {last === undefined ? null : (
          <line
            x1={last.x}
            y1={Math.max(last.y - 4.5, 0)}
            x2={last.x}
            y2={Math.min(last.y + 4.5, VIEW_HEIGHT)}
            stroke={stroke}
            strokeWidth={2.5}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </ChartFrame>
  )
}
