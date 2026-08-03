import { Star } from "lucide-react"
import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Explain, type ExplainLabels } from "@/components/ui/explain"
import { cn } from "@/lib/cn"

import { HotelOpsStat, type HotelOpsStatItem } from "./hotelops-stat"

/**
 * The identity band — who this property is, and the four figures that size it.
 *
 * The operations page opened with nine equal label/value pairs, so the name of
 * the hotel carried the same weight as its check-out time. This band is the
 * fix: one heading, the former name under it, the category as a badge, and
 * exactly four numbers. Everything else moved down the page, because a number
 * that is always shown next to eight others is a number nobody reads.
 *
 * ## The wash is tokens, not decoration for its own sake
 *
 * The tint is `--primary` and `--accent` at low alpha over `--card`, so it
 * follows the theme rather than pinning a colour that only works in light mode.
 * It never sits under text that has to stay legible: the contrast floor is
 * measured against `--card`, and the gradient only lightens it.
 *
 * The former name is labelled as former. Nothing here claims a chain
 * affiliation, because no 2026 source states one, and that absence is written
 * out in plain words instead of being left as an empty field.
 */

export function HotelOpsIdentityBand({
  eyebrow,
  name,
  formerLabel,
  formerName,
  category,
  chainNote,
  figures,
  explainGap,
  className,
}: {
  eyebrow: string
  name: string
  formerLabel: string
  /** `null` when the property has never been renamed. */
  formerName: string | null
  /** `gap: true` renders the "not stated" wording in the gap colour. */
  category: { label: string; gap: boolean }
  /** One sentence about the chain affiliation, stated or absent. */
  chainNote: string
  figures: readonly HotelOpsStatItem[]
  explainGap: ExplainLabels
  className?: string
}): ReactNode {
  return (
    <section
      data-slot="hotelops-identity"
      className={cn(
        "relative isolate overflow-hidden rounded-2xl border border-border bg-card",
        className
      )}
    >
      {/* Decoration only. Every glyph above it is real text on `--card`. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-primary/10 via-transparent to-accent/10"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent"
      />

      <div className="flex flex-col gap-7 p-5 sm:p-7 lg:p-8">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <span className="font-mono text-[0.6875rem] tracking-[0.18em] text-muted-foreground uppercase">
              {eyebrow}
            </span>
            {category.gap ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-confidence-gap">
                {category.label}
                <Explain iconOnly labels={explainGap} />
              </span>
            ) : (
              <Badge variant="outline" data-slot="hotelops-category">
                <Star aria-hidden="true" className="text-accent" />
                {category.label}
              </Badge>
            )}
          </div>

          <h2 className="max-w-[24ch] font-display text-2xl leading-tight font-semibold tracking-[-0.02em] break-words text-foreground hyphens-auto sm:text-3xl lg:text-4xl">
            {name}
          </h2>

          <div className="flex min-w-0 flex-col gap-1">
            {formerName === null ? null : (
              <p className="text-sm text-muted-foreground">
                <span className="text-foreground/70">{formerLabel}: </span>
                {formerName}
              </p>
            )}
            <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
              {chainNote}
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-5 gap-y-6 border-t border-border/70 pt-6 sm:grid-cols-4">
          {figures.map((figure) => (
            <HotelOpsStat
              key={figure.key}
              item={figure}
              size="lg"
              explainGap={explainGap}
            />
          ))}
        </dl>
      </div>
    </section>
  )
}
