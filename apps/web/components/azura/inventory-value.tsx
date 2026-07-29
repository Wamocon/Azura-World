import type { ReactNode } from "react"

import {
  formatFactValue,
  type ProvenanceFormat,
} from "@/components/evidence/format"
import type { SourcedFact } from "@/lib/contracts"
import { cn } from "@/lib/cn"

/**
 * A figure from the client's own inventory.                    Owner: W-CINEMA
 *
 * PIVOT.md, 29 July: we are no longer showing Azura World research *about*
 * their complex. We are showing them their complex already running in a system
 * we built for them. A source chip under "656" answers a question the audience
 * is not asking. They know how many units they have. What they are looking at
 * is whether the system knows.
 *
 * So this renders the value and nothing else: no chips, no confidence badge, no
 * conflict popover, no "n Quellen" caption.
 *
 * ## Why it wraps `SourcedFact` instead of taking a number
 *
 * PIVOT §5 is explicit that this is pass one of two. `SourcedFact` is woven
 * through `lib/contracts.ts`, the generated dataset and every repository;
 * unwrapping it is pass two, after the pitch, with time and a green suite.
 * Pass one removes what the client can see and leaves the types compiling.
 *
 * Taking the same `fact` shape as `ProvenanceValue` makes the swap a rename at
 * every call site rather than a data migration, and it means `formatFactValue`
 * stays the single formatter, so "76.000 m²" is rendered by the same code in
 * both passes. Two formatters would drift, and the drift would show as the same
 * number written two ways on one page.
 *
 * ## The gap case says the words, not a dash
 *
 * `ProvenanceValue` renders an em dash for a gap. W-UX §3 removed that rule for
 * exactly the reason it applies here: an em dash is the strongest tell of
 * machine-written text, and it tells the reader nothing. A missing figure reads
 * `Keine Angabe`, which a property manager understands without help.
 *
 * The guard that produces it is kept from `ProvenanceValue` verbatim and on
 * purpose: `fact.value` is never trusted when the confidence is `"gap"`, so a
 * dataset that violates the invariant still cannot leak a number onto the page.
 */
export function InventoryValue<T>({
  fact,
  format = "text",
  locale,
  gapLabel,
  className,
}: {
  fact: SourcedFact<T>
  format?: ProvenanceFormat
  locale: string
  /** Translated "Keine Angabe" / "Not stated" / "Belirtilmemiş" / "Нет данных". */
  gapLabel: string
  className?: string
}): ReactNode {
  const rawValue = fact.confidence === "gap" ? null : fact.value
  const formatted = formatFactValue(rawValue, format, locale)

  if (formatted === null) {
    return (
      <span
        data-slot="inventory-value"
        data-gap="true"
        className={cn("text-muted-foreground", className)}
      >
        {gapLabel}
      </span>
    )
  }

  return (
    <span
      data-slot="inventory-value"
      className={cn("font-display", className)}
      data-numeric
    >
      {formatted}
    </span>
  )
}
