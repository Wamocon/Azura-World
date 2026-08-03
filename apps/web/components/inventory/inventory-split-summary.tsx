import { Explain, type ExplainLabels } from "@/components/ui/explain"
import { cn } from "@/lib/cn"
import type { UnitDataQuality } from "@/lib/inventory-data"
import {
  UnitProvenanceBadge,
  type UnitProvenanceLabels,
} from "./unit-provenance-badge"

/**
 * InventorySplitSummary.                                    Owner: W3-C
 *
 * The header half of the module's honesty control: how much of this inventory
 * is real. 25 units came from an actual portal listing; 631 were modelled to
 * fill a 656-unit building whose real composition nobody published.
 *
 * ## Why there is a bar and not only numbers
 *
 * "25 portal_listing · 631 modelled" is accurate and it is easy to skim past.
 * The proportion is the fact that matters — **3.8% of this list is a real
 * listing** — and a bar makes that unmissable in the half-second before anyone
 * reads a digit. The bar is not decoration; it is the same datum at a
 * resolution a number cannot deliver at a glance.
 *
 * The segments are ordered real-first so the eye lands on the small true
 * segment rather than the large synthetic one, and every segment carries its
 * count as text as well as width — a bar alone would fail WCAG 1.4.1 and would
 * be unreadable in the printed report poster.
 */

/** Order is deliberate: the real ones first, the synthetic bulk last. */
const DISPLAY_ORDER: UnitDataQuality[] = [
  "portal_listing",
  "official",
  "modelled",
  "source_missing",
]

const SEGMENT_TONE: Record<UnitDataQuality, string> = {
  portal_listing: "bg-confidence-confirmed",
  official: "bg-confidence-official",
  modelled: "bg-muted-foreground/35",
  source_missing: "bg-confidence-gap/50",
}

export function InventorySplitSummary({
  byDataQuality,
  total,
  labels,
  heading,
  caption,
  countLabel,
  explain,
  className,
}: {
  byDataQuality: Record<UnitDataQuality, number>
  total: number
  labels: UnitProvenanceLabels
  heading: string
  /** Already-formatted sentence from the caller — W1-C owns ICU, not this file. */
  caption: string
  /** `(count) => localised "N units"`, so the bar segments read in every locale. */
  countLabel: (count: number) => string
  /**
   * Plain-language explanation per provenance kind, keyed by glossary term.
   * Optional: without it the badges render exactly as before. With it, the two
   * words this whole control turns on — "real listing" and "modelled" — stop
   * being vocabulary the reader is expected to already have.
   */
  explain?: Partial<Record<UnitDataQuality, ExplainLabels>>
  className?: string
}) {
  const present = DISPLAY_ORDER.filter(
    (quality) => (byDataQuality[quality] ?? 0) > 0
  )

  return (
    <section
      aria-labelledby="inventory-split-heading"
      className={cn(
        "rounded-xl border border-border bg-background/50 p-4 sm:p-5",
        className
      )}
    >
      <h2
        id="inventory-split-heading"
        className="text-sm font-semibold text-foreground"
      >
        {heading}
      </h2>

      <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground">
        {caption}
      </p>

      {total > 0 ? (
        <>
          {/* The bar is decorative in the a11y tree — every number in it is also
              rendered as text in the legend below, so a screen reader gets the
              data once rather than twice. */}
          <div
            aria-hidden
            className="mt-4 flex h-2 w-full overflow-hidden rounded-full bg-muted"
          >
            {present.map((quality) => (
              <div
                key={quality}
                className={SEGMENT_TONE[quality]}
                style={{
                  width: `${((byDataQuality[quality] ?? 0) / total) * 100}%`,
                }}
              />
            ))}
          </div>

          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
            {present.map((quality) => {
              const count = byDataQuality[quality] ?? 0
              const share = (count / total) * 100
              return (
                <div key={quality} className="flex items-center gap-2">
                  <dt className="sr-only">{labels[quality]}</dt>
                  <span className="inline-flex items-center gap-1">
                    <UnitProvenanceBadge dataQuality={quality} labels={labels} />
                    {explain?.[quality] === undefined ? null : (
                      <Explain iconOnly labels={explain[quality]} />
                    )}
                  </span>
                  <dd className="text-sm text-foreground tabular-nums">
                    {countLabel(count)}
                    <span className="ml-1.5 text-muted-foreground">
                      {/* One decimal: 25/656 is 3.8%, and rounding that to 4%
                          quietly inflates the honest number. */}
                      ({share.toFixed(1)}%)
                    </span>
                  </dd>
                </div>
              )
            })}
          </dl>
        </>
      ) : null}
    </section>
  )
}
