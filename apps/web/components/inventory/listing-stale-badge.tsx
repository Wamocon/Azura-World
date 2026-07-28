import type { ReactNode } from "react"

import { cn } from "@/lib/cn"

/**
 * The stale marker, next to the price.                       Owner: W3-C / N1
 *
 * ## Why this is a component and not three Tailwind classes
 *
 * The W3-C brief is specific: a stale listing carries its badge **next to the
 * price, not in a footnote.** That rule is only kept if the badge looks the same
 * everywhere a price appears — the comparison view, the publisher tables, the
 * cheapest-anchor callout. Three hand-rolled copies drift, and the first one to
 * drift is the one that stops looking like a warning.
 *
 * ## What "stale" means here, precisely
 *
 * `PortalListing.isStale` is a **stored column**, set by the evidence pipeline
 * when a listing contradicts a tier ≤ 3 source. It is not recomputed in the app,
 * because two implementations of one rule give the product two answers.
 *
 * On this dataset it means one concrete thing: Haspo Realty still publishes the
 * project as under construction (F-006), while Cebeci Group's own project index
 * files it under finished projects and the corroborated completion date is
 * 2024-05-30 — two years before the harvest. Eighteen of the 47 rows are
 * Haspo's, and every price on them is quoting a market that has moved.
 *
 * ## Colour is never the only signal
 *
 * W1-D's ConfidenceBadge rule. The badge pairs its tint with a **word** and a
 * dashed border, so it survives greyscale, print and colour vision deficiency —
 * and it is rendered in the document, never behind a hover, because a warning a
 * touch user cannot reach is not a warning (azura-ui-ux §5.3).
 */
export function ListingStaleBadge({
  label,
  /** The one-line reason, e.g. "Portal nennt das Projekt noch im Bau." */
  reason,
  className,
}: {
  label: string
  reason?: string
  className?: string
}): ReactNode {
  return (
    <span
      data-slot="stale-badge"
      className={cn(
        // min-h-6 keeps the badge itself above the 24px tap/target floor even
        // when it sits inline next to a price on a phone.
        "inline-flex min-h-6 items-center gap-1 rounded-md px-1.5",
        // Dashed, not solid: a second, non-colour channel that separates this
        // from the solid-bordered chips around it at a glance.
        "border border-dashed border-quality-stale/55 bg-quality-stale/10",
        "text-[0.6875rem] font-semibold tracking-[0.06em] text-quality-stale uppercase",
        className
      )}
    >
      {label}
      {reason !== undefined && reason.length > 0 ? (
        // The word alone tells a sighted reader "old"; it does not tell anyone
        // WHY. The reason is content, not a tooltip.
        <span className="sr-only"> — {reason}</span>
      ) : null}
    </span>
  )
}
