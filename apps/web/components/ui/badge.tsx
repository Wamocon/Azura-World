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

/* ---------------------------------------------------------------------------
   Provenance and quality fills, declared once and bound to two names each.

   `confirmed` is the spelling the thirty-three existing consumers use;
   `confidence-confirmed` is the globals.css token family spelled in full. They
   resolve to the SAME string deliberately. Two names for one semantic state
   that render differently is the drift this object exists to prevent: a
   maintainer picks whichever spelling reads better and gets different pixels.

   The fill is `color-mix(…, var(--card))`, not `bg-<token>/10`. A `/10` fill is
   translucent, so a badge has no background of its own and its measured
   contrast moves with whatever it was dropped on. Against `--card` the two are
   byte-identical (10% alpha over white and a 10% sRGB mix with white are the
   same arithmetic). They diverge only where the translucent version was
   already wrong: on a hovered or selected table row (`hover:bg-muted/60`,
   `data-[selected]:bg-secondary`, both `--muted` #f1eee8) the fill darkened
   under dark text and the ratio fell.

   Ratios are WCAG 2.1, (L1+.05)/(L2+.05), computed from the `:root` literals
   in app/globals.css. Text is 12px semibold, so the bar is 4.5:1, not 3:1.

   BOTH themes are live, despite `forcedTheme="light"`. That kills the `.dark`
   class, but `[data-surface="night"]` re-declares the entire token set for the
   landing route (globals.css §NIGHT SURFACE; applied at
   app/[locale]/page.tsx:226). Every value below is a `var()` on both sides of
   the mix, so the fills follow the surface without knowing it moved. Night
   measures 5.90:1 to 8.19:1 across these nine; day is the tighter case and is
   what is tabulated. Re-run the arithmetic for both if you touch a token.
   --------------------------------------------------------------------------- */
const provenance = {
  /* #0f6b4f on #e7f0ed — 5.59:1 */
  confirmed:
    "border-confidence-confirmed/30 bg-[color-mix(in_srgb,var(--confidence-confirmed)_10%,var(--card))] text-confidence-confirmed",
  /* #0b5e7d on #e7eff2 — 6.19:1 */
  official:
    "border-confidence-official/30 bg-[color-mix(in_srgb,var(--confidence-official)_10%,var(--card))] text-confidence-official",
  /* #4a6472 on #edf0f1 — 5.46:1 */
  single:
    "border-confidence-single/30 bg-[color-mix(in_srgb,var(--confidence-single)_10%,var(--card))] text-confidence-single",
  /* Opaque already, via --surface-conflict. Always visible, never hover-only:
     DESIGN-RESEARCH §4.6. #8a5200 on #fdf3e3 — 5.81:1 */
  conflicted:
    "border-confidence-conflicted/45 bg-surface-conflict text-confidence-conflicted",
  /* #5b4b8a on #efedf3 — 6.41:1 */
  inferred:
    "border-confidence-inferred/30 bg-[color-mix(in_srgb,var(--confidence-inferred)_10%,var(--card))] text-confidence-inferred italic",
  /* The one token that cannot carry itself. `--confidence-gap` #61737e is
     4.93:1 on pure white, so ANY tint of itself beneath it (8%, 10%, 12% all
     checked) lands under 4.5:1. As shipped this variant measured 4.35:1 on
     --card, 4.13:1 on --background and 3.80:1 on a selected row: a live AA
     failure on three real surfaces, not a hypothetical one. `variant="gap"` is
     rendered by dashboard/reports, dashboard/users and
     components/operations/capacity-meter.

     Fixed by deriving a darker text colour FROM the token rather than by
     inventing a hex: 85% token + 15% --foreground = #56656e, the same
     grey-blue family, 5.32:1 on the fill and 4.65:1 on a selected row.
     Deriving toward --foreground rather than toward black is what makes it
     survive the night surface, where --foreground is #eaf2f6: the identical
     expression moves the text LIGHTER against a darker fill and measures
     6.80:1.

     The root fix is to darken --confidence-gap itself in globals.css, which
     would also lift the bare `text-confidence-gap` spans on
     dashboard/compliance, dashboard/wallet and dashboard/vendor-invoices
     (4.93:1 on --card, 4.26:1 on a selected row). That file is W1-D's and is
     not written from here. */
  gap: "border-confidence-gap/40 bg-[color-mix(in_srgb,var(--confidence-gap)_10%,var(--card))] text-[color:color-mix(in_srgb,var(--confidence-gap)_85%,var(--foreground))]",
  /* #5b4b8a on #efedf3 — 6.41:1 */
  modelled:
    "border-quality-modelled/40 bg-[color-mix(in_srgb,var(--quality-modelled)_10%,var(--card))] text-quality-modelled",
  /* #9a3412 on #f5ebe7 — 6.24:1 */
  stale:
    "border-quality-stale/40 bg-[color-mix(in_srgb,var(--quality-stale)_10%,var(--card))] text-quality-stale",
  /* Simulated data. The loudest label in the build — W3-I §1. Opaque already,
     via --surface-simulation. #8a5200 on #fdf3e3 — 5.81:1 */
  simulation:
    "border-simulation/50 bg-surface-simulation tracking-[0.08em] text-simulation uppercase",
} as const

const badgeVariants = cva(
  cn(
    // `max-w-full` and no `whitespace-nowrap`: a badge is meant to hold a short
    // label, but the failure mode when someone puts a sentence in one must be
    // "it wraps", not "the page scrolls sideways at 320px". Truncation was the
    // other option and is worse — it hides meaning silently.
    "inline-flex w-fit max-w-full shrink-0 items-center gap-1.5",
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

        /* Short spelling. Values and contrast measured in DESIGN.md §4 and
           re-derived in `provenance` above. */
        confirmed: provenance.confirmed,
        official: provenance.official,
        single: provenance.single,
        conflicted: provenance.conflicted,
        inferred: provenance.inferred,
        gap: provenance.gap,
        modelled: provenance.modelled,
        stale: provenance.stale,
        simulation: provenance.simulation,

        /* Token-family spelling. Same strings, so the two spellings can never
           drift apart. `simulation` appears once because it is already the
           token-family name. */
        "confidence-confirmed": provenance.confirmed,
        "confidence-official": provenance.official,
        "confidence-single": provenance.single,
        "confidence-conflicted": provenance.conflicted,
        "confidence-inferred": provenance.inferred,
        "confidence-gap": provenance.gap,
        "quality-modelled": provenance.modelled,
        "quality-stale": provenance.stale,
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
