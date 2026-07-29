import type { ReactNode } from "react"

import type { Confidence } from "@/lib/contracts"

/**
 * Confidence badges. **Render nothing since P2.**           Owner: W1-D · PIVOT P2
 *
 * `PIVOT.md` §4 removes confidence badges from every surface. Pass 1 makes the
 * component a no-op rather than deleting its call sites; pass 2 removes both
 * together with the `Confidence` type itself.
 *
 * This was the loudest element in the design system — the amber `conflicted`
 * variant was deliberately the most prominent thing on any data surface — and it
 * is the single clearest signal that the product was research about the client
 * rather than a system for them. It goes first and it goes completely.
 */

/** Localised label per level. Supplied by the caller — W1-C owns the strings. */
export type ConfidenceLabels = Record<Confidence, string>

export function ConfidenceBadge(props: {
  confidence: Confidence
  labels: ConfidenceLabels
  compact?: boolean
  className?: string
}): ReactNode {
  void props
  return null
}
