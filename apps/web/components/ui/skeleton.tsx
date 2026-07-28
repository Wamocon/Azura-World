import type { ComponentProps } from "react"

import { cn } from "@/lib/cn"

/**
 * Skeleton.                                                Owner: W1-D
 *
 * A skeleton must occupy the SAME box the real content will. A generic grey
 * pill that is shorter than the text it stands in for guarantees a layout
 * shift the moment data lands, and CLS is budgeted at ≤ 0.1 (CONVENTIONS §7).
 * So the presets below are sized from the primitives they replace — `text`
 * matches the 1rem/1.6 body line box, `line` matches a 44px control.
 *
 * `.azura-shimmer` carries its own reduced-motion branch: it becomes a static
 * tinted block rather than losing its background entirely, so the loading
 * state is still legible as "loading" without any movement.
 */

type SkeletonProps = ComponentProps<"div"> & {
  /** Presets sized to the real components, so nothing shifts on load. */
  preset?: "text" | "heading" | "control" | "badge" | "block"
}

const presets: Record<NonNullable<SkeletonProps["preset"]>, string> = {
  text: "h-4 w-full rounded-md",
  heading: "h-7 w-2/3 rounded-md",
  control: "h-11 w-full rounded-lg",
  badge: "h-5 w-24 rounded-md",
  block: "h-32 w-full rounded-xl",
}

function Skeleton({ className, preset = "text", ...props }: SkeletonProps) {
  return (
    <div
      data-slot="skeleton"
      // Decorative: a screen reader gets the `aria-busy` region from the
      // component that owns the loading state, not a stack of empty divs.
      aria-hidden="true"
      className={cn("azura-shimmer", presets[preset], className)}
      {...props}
    />
  )
}

export { Skeleton }
