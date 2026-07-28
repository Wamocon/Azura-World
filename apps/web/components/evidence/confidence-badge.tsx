import {
  AlertTriangle,
  CheckCheck,
  CircleSlash,
  FunctionSquare,
  ShieldCheck,
  Minus,
  type LucideIcon,
} from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/cn"
import type { Confidence } from "@/lib/contracts"
import { Badge } from "@/components/ui/badge"

/**
 * ConfidenceBadge.                                         Owner: W1-D
 *
 * One badge per `Confidence` in CONTRACTS §1, and every one of the six is
 * handled — `Record<Confidence, …>` means adding a seventh to the contract
 * breaks the build here rather than silently rendering nothing.
 *
 * COLOUR IS NEVER THE ONLY SIGNAL. Each level pairs a distinct icon SHAPE with
 * its colour, so the state survives greyscale, a monochrome print of the
 * report poster, and colour vision deficiency (WCAG 1.4.1). The icons are
 * chosen to be distinguishable in silhouette, not merely different:
 *
 *   confirmed      double tick     two strokes
 *   official       shield          enclosed
 *   single_source  minus           one horizontal
 *   conflicted     triangle        the only pointed shape
 *   inferred       function        the only glyph with a character in it
 *   gap            slashed circle  the only circle
 *
 * `conflicted` is ALWAYS VISIBLE and never hover-only. DESIGN-RESEARCH §4.6 is
 * blunt about why: a conflict badge behind a mouse hover is invisible to touch
 * and to screen readers, and the conflicts are the product.
 */

const ICONS: Record<Confidence, LucideIcon> = {
  confirmed: CheckCheck,
  official: ShieldCheck,
  single_source: Minus,
  conflicted: AlertTriangle,
  inferred: FunctionSquare,
  gap: CircleSlash,
}

const VARIANTS: Record<
  Confidence,
  "confirmed" | "official" | "single" | "conflicted" | "inferred" | "gap"
> = {
  confirmed: "confirmed",
  official: "official",
  single_source: "single",
  conflicted: "conflicted",
  inferred: "inferred",
  gap: "gap",
}

/** Localised label per level. Supplied by the caller — W1-C owns the strings. */
export type ConfidenceLabels = Record<Confidence, string>

export function ConfidenceBadge({
  confidence,
  labels,
  /** Icon-only, for dense tables. The label stays available to screen readers. */
  compact = false,
  className,
}: {
  confidence: Confidence
  labels: ConfidenceLabels
  compact?: boolean
  className?: string
}): ReactNode {
  const Icon = ICONS[confidence]
  const label = labels[confidence]

  return (
    <Badge
      variant={VARIANTS[confidence]}
      data-confidence={confidence}
      className={cn(compact && "px-1.5", className)}
      title={compact ? label : undefined}
    >
      <Icon aria-hidden="true" />
      {compact ? <span className="sr-only">{label}</span> : label}
    </Badge>
  )
}
