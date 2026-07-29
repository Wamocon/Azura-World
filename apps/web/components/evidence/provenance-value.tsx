import type { ReactNode } from "react"

import type { SourcedFact } from "@/lib/contracts"
import { cn } from "@/lib/cn"
import type { ConfidenceLabels } from "./confidence-badge"
import type { ConflictLabels } from "./conflict-popover"
import type { SourceChipLabels } from "./source-chip"
import { formatFactValue, type ProvenanceFormat } from "./format"

/**
 * Renders a `SourcedFact` as its value.                    Owner: W1-D · PIVOT P2
 *
 * ## This component used to be the product, and now it is a formatter
 *
 * `PIVOT.md` §4 removes everything that presents the application as research
 * *about* the client rather than a system *for* them. That is the source chips,
 * the confidence badges, the conflict popovers and the dotted single-source
 * underline — all of which lived here.
 *
 * `PIVOT.md` §5 is explicit about how to remove them, and this file is the
 * clearest case of it: **pass 1 removes what the client can see; pass 2, after
 * the pitch, unwraps the types.** `SourcedFact<T>` therefore still flows through
 * `lib/contracts.ts`, every repository and every call site unchanged. Roughly
 * thirty components still pass a `fact` and a `ProvenanceLabels` here and still
 * compile; they simply get a number back instead of a number with its evidence
 * attached.
 *
 * That is why {@link ProvenanceLabels} is kept whole rather than trimmed to the
 * one field still read. Narrowing it would push a mechanical edit into all
 * thirty of those files hours before a pitch, for no visible difference. When
 * pass 2 unwraps the types, this interface goes with them.
 *
 * ## The one honesty rule that stays
 *
 * A `gap` still renders **"Keine Angabe"**, never a blank and never `0`.
 * `PIVOT.md` §4 removes provenance, not truthfulness: a missing figure printed
 * as zero is an invented figure, and that rule survives the pivot untouched.
 * The value is still read through the `confidence === "gap"` guard rather than
 * from `fact.value`, so a dataset that violates its own invariant still cannot
 * leak a number onto the screen.
 */

export interface ProvenanceLabels {
  confidence: ConfidenceLabels
  conflict: ConflictLabels
  source: SourceChipLabels
  /** Rendered for a gap, e.g. "Keine Angabe". The one label still read. */
  gap: string
  inferred: string
  more: string
  sources: string
}

export function ProvenanceValue<T>({
  fact,
  format = "text",
  locale,
  labels,
  className,
}: {
  fact: SourcedFact<T>
  format?: ProvenanceFormat
  locale: string
  labels: ProvenanceLabels
  /** Accepted and ignored since P2. Kept so call sites compile unchanged. */
  showSources?: boolean
  /** Accepted and ignored since P2. */
  snapshotBasePath?: string
  className?: string
}): ReactNode {
  const { confidence } = fact

  // Never trust `fact.value` for a gap. The contract says a gap's value is
  // null; reading it through this guard means a dataset that violates the
  // invariant still cannot leak a number into the UI.
  const rawValue = confidence === "gap" ? null : fact.value
  const formatted = formatFactValue(rawValue, format, locale)

  if (confidence === "gap" || formatted === null) {
    return (
      <span
        data-slot="provenance-value"
        className={cn("text-muted-foreground", className)}
      >
        {labels.gap}
      </span>
    )
  }

  return (
    <span
      data-slot="provenance-value"
      className={cn("font-display font-semibold", className)}
      data-numeric
    >
      {formatted}
    </span>
  )
}

/**
 * The `modelled` vs `portal_listing` marker. **Renders nothing since P2.**
 *
 * `PIVOT.md` §4: *"the `modelled` vs `portal_listing` distinction in the UI —
 * for a pitch, all 656 units are simply the client's inventory."*
 *
 * The distinction is not deleted, only unrendered: `units.data_quality` is
 * untouched in the database, in `inventory-repository.ts` and in the generated
 * dataset, so nothing is lost and pass 2 can decide what the product does with
 * it. The export is kept as a no-op so its call sites compile.
 */
export function DataQualityMark(props: {
  dataQuality: "portal_listing" | "official" | "modelled" | "source_missing"
  labels: Record<
    "portal_listing" | "official" | "modelled" | "source_missing",
    string
  >
  className?: string
}): ReactNode {
  void props
  return null
}
