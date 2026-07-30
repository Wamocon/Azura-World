/**
 * Hand-rolled SVG chart primitives.
 *
 * Five shapes, no dependency, no canvas, and no `id` in the output. Each one is
 * a Server Component: they hold no state, so they cost nothing in the bundle and
 * render identically before hydration, under a blocked script, and with
 * JavaScript off.
 *
 * The contract every one of them keeps, and the reason each part of it exists,
 * is documented in `chart-frame.tsx`. In short:
 *
 *   · the SVG draws geometry, HTML carries every glyph
 *   · the picture is `aria-hidden`; a `sr-only` `<table>` is the record
 *   · a required `basis` states what the chart is *of*, the way a number states
 *     its source
 *   · empty input renders a labelled empty state, never an axis with no data
 *   · the caller formats every number, because `Intl` needs a locale this
 *     module does not have
 *   · colour comes only from `--chart-1` … `--chart-5`, `--border` and
 *     `--muted-foreground`; there is no hex literal in this directory
 *
 * Import from here, not from the individual files.
 */

export { Sparkline } from "./sparkline"
export type { SparklineProps } from "./sparkline"

export { BarSeries } from "./bar-series"
export type { BarSeriesProps } from "./bar-series"

export { LineSeries } from "./line-series"
export type {
  LinePoint,
  LineSeriesDatum,
  LineSeriesProps,
  LineTableLabels,
} from "./line-series"

export { Donut } from "./donut"
export type { DonutProps } from "./donut"

export { StackedBar } from "./stacked-bar"
export type { StackedBarProps } from "./stacked-bar"

// Shared types, scales and the helper a caller needs to build an axis.
export {
  CHART_TONES,
  bandCenter,
  linearTicks,
  spanPosition,
  toneAt,
  toneVar,
  yPercent,
} from "./chart-frame"
export type {
  ChartAxisTick,
  ChartPoint,
  ChartTableLabels,
  ChartTone,
} from "./chart-frame"
