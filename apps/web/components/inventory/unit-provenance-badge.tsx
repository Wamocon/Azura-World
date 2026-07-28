import { CircleSlash, ExternalLink, ShieldCheck, Sigma, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/cn"
import { Badge } from "@/components/ui/badge"
import type { UnitDataQuality } from "@/lib/inventory-data"

/**
 * UnitProvenanceBadge.                                      Owner: W3-C
 *
 * The honesty control for the whole inventory module. 631 of 656 units are
 * `modelled` — synthesised to fill an inventory whose real shape nobody
 * published — and 25 came from an actual portal listing. A modelled unit read
 * as a real one is the single most damaging error this system can make
 * (SYSTEM-PROMPT §2.3, CONTRACTS §2 `dataQuality`), so the distinction is a
 * column of its own rather than a footnote.
 *
 * COLOUR IS NEVER THE ONLY SIGNAL — W1-D's ConfidenceBadge sets this rule and
 * this follows it. Each quality pairs a colour with a distinct icon SILHOUETTE,
 * so the state survives greyscale, a monochrome print and colour vision
 * deficiency (WCAG 1.4.1):
 *
 *   portal_listing  box with an arrow leaving it   — it points at a real source
 *   official        shield                          — enclosed
 *   modelled        sigma                           — the only glyph shape; it is a computation
 *   source_missing  slashed circle                  — the only circle
 *
 * `Record<UnitDataQuality, …>` throughout: a fifth quality added to the
 * contract breaks this file at compile time instead of rendering an unlabelled
 * row, which is the failure mode that would put a modelled unit on screen
 * wearing no marker at all.
 */

const ICONS: Record<UnitDataQuality, LucideIcon> = {
  portal_listing: ExternalLink,
  official: ShieldCheck,
  modelled: Sigma,
  source_missing: CircleSlash,
}

const VARIANTS: Record<UnitDataQuality, "confirmed" | "official" | "modelled" | "gap"> = {
  portal_listing: "confirmed",
  official: "official",
  modelled: "modelled",
  source_missing: "gap",
}

/** Localised labels. W1-C owns the strings; this component never hardcodes copy. */
export type UnitProvenanceLabels = Record<UnitDataQuality, string>

export function UnitProvenanceBadge({
  dataQuality,
  labels,
  /** Longer sentence read by assistive tech and shown as the native tooltip. */
  description,
  className,
}: {
  dataQuality: UnitDataQuality
  labels: UnitProvenanceLabels
  description?: string
  className?: string
}) {
  // `noUncheckedIndexedAccess` widens a Record lookup to `T | undefined` even
  // when the key type is exhaustive. Both maps are `Record<UnitDataQuality, …>`
  // so a miss is impossible, and the fallbacks below exist to satisfy the
  // compiler rather than to paper over a real gap — `source_missing` is the
  // safest default precisely because it claims nothing.
  const Icon = ICONS[dataQuality] ?? ICONS.source_missing
  const label = labels[dataQuality] ?? labels.source_missing

  return (
    <Badge
      variant={VARIANTS[dataQuality] ?? "gap"}
      className={cn("gap-1.5 whitespace-nowrap", className)}
      // Not `title` alone: a tooltip is invisible to touch and to a keyboard.
      // The label itself is always rendered as text next to the icon.
      title={description ?? label}
      data-data-quality={dataQuality}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {label}
    </Badge>
  )
}
