import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"

import { cn } from "@/lib/cn"

/**
 * Badge.                                                   Owner: W1-D
 *
 * WCAG 1.4.1 — colour is never the only carrier of meaning. Every semantic
 * variant here is expected to be rendered WITH an icon whose shape differs, so
 * the state survives greyscale, a monochrome print, and the ~8% of male users
 * with a colour vision deficiency. `components/evidence/confidence-badge.tsx`
 * is the enforcement of that rule for provenance; this is the generic base.
 *
 * The `conflicted` variant is the loudest thing in the design system, and that
 * is on purpose: disagreement between sources is the product.
 */
const badgeVariants = cva(
  cn(
    "inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap",
    "rounded-md border px-2 py-0.5 text-xs font-semibold tracking-[0.01em]",
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3"
  ),
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-input bg-background text-foreground",
        muted: "border-transparent bg-muted text-muted-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground",

        /* Provenance family — values and contrast measured in DESIGN.md §4. */
        confirmed:
          "border-confidence-confirmed/30 bg-confidence-confirmed/10 text-confidence-confirmed",
        official:
          "border-confidence-official/30 bg-confidence-official/10 text-confidence-official",
        single:
          "border-confidence-single/30 bg-confidence-single/10 text-confidence-single",
        /* Always visible, never hover-only. DESIGN-RESEARCH §4.6. */
        conflicted:
          "border-confidence-conflicted/45 bg-surface-conflict text-confidence-conflicted",
        inferred:
          "border-confidence-inferred/30 bg-confidence-inferred/10 text-confidence-inferred italic",
        gap: "border-confidence-gap/30 bg-confidence-gap/10 text-confidence-gap",

        modelled:
          "border-quality-modelled/40 bg-quality-modelled/10 text-quality-modelled",
        stale:
          "border-quality-stale/40 bg-quality-stale/10 text-quality-stale",
        /* Simulated data. The loudest label in the build — W3-I §1. */
        simulation:
          "border-simulation/50 bg-surface-simulation text-simulation uppercase tracking-[0.08em]",
      },
      size: {
        default: "",
        /* 24px tall — the tap-target floor, for badges that are also buttons. */
        tap: "min-h-6 px-2.5",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

function Badge({
  className,
  variant,
  size,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
