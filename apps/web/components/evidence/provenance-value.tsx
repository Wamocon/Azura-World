"use client"

import type { ReactNode } from "react"

import { cn } from "@/lib/cn"
import type { SourcedFact } from "@/lib/contracts"

import { ConfidenceBadge, type ConfidenceLabels } from "./confidence-badge"
import { ConflictPopover, type ConflictLabels } from "./conflict-popover"
import {
  conflictRange,
  formatFactValue,
  type ProvenanceFormat,
} from "./format"
import { SourceChipList, type SourceChipLabels } from "./source-chip"

/**
 * ProvenanceValue — the component that makes this project honest.
 *                                                          Owner: W1-D
 *
 * Every number a user sees goes through here. CONTRACTS §8 lists "a number in
 * JSX with no source" as a review rejection, and this is the component that
 * makes complying easier than not.
 *
 *     <ProvenanceValue fact={project.plotAreaSqm} format="area" locale="de" … />
 *     → 76.000 m²   with its sources reachable
 *
 * The treatment per confidence level is a design contract, not a style choice
 * (W1-D brief §2):
 *
 *   confirmed / official   normal. Quiet source affordance.
 *   single_source          dotted underline.
 *   conflicted             amber badge, ALWAYS VISIBLE, never hover-only;
 *                          value shown as a range where one is honest.
 *   inferred               italic + a "berechnet" marker.
 *   gap                    "—" and "Nicht belegt". Never 0. Never blank.
 *
 * THE `gap` CASE IS THE ONE THAT MATTERS MOST. `displayValue()` in
 * contracts.ts already returns `null` for a gap regardless of what is stored,
 * so a stale value cannot leak through; this component then renders an em dash
 * rather than falling back to `0`, `""`, or `"N/A"`. A missing price is
 * honest. A plausible-looking made-up price is fraud (SYSTEM-PROMPT §2.3).
 */

export interface ProvenanceLabels {
  confidence: ConfidenceLabels
  conflict: ConflictLabels
  source: SourceChipLabels
  /** e.g. "Nicht belegt" */
  gap: string
  /** e.g. "berechnet" */
  inferred: string
  /** e.g. (n) => `+${n} weitere` */
  more: (remaining: number) => string
  /** e.g. "Quellen" — labels the source list for screen readers. */
  sources: string
}

export function ProvenanceValue<T>({
  fact,
  format = "text",
  locale,
  labels,
  /** Show the source chips inline under the value. Off inside dense tables. */
  showSources = false,
  /** Route serving the stored snapshot for a hash. */
  snapshotHref,
  className,
}: {
  fact: SourcedFact<T>
  format?: ProvenanceFormat
  locale: string
  labels: ProvenanceLabels
  showSources?: boolean
  snapshotHref?: (snapshotHash: string) => string
  className?: string
}): ReactNode {
  const { confidence } = fact

  // Never trust `fact.value` for a gap. The contract says a gap's value is
  // null, but reading it through this guard means a dataset that violates the
  // invariant still cannot leak a number into the UI.
  const rawValue = confidence === "gap" ? null : fact.value
  const formatted = formatFactValue(rawValue, format, locale)

  // ---- gap ---------------------------------------------------------------
  if (confidence === "gap" || formatted === null) {
    return (
      <span
        data-slot="provenance-value"
        data-confidence="gap"
        className={cn("inline-flex items-center gap-2", className)}
      >
        <span
          aria-hidden="true"
          className="font-display text-confidence-gap"
          data-numeric
        >
          —
        </span>
        {/* The em dash alone means nothing to a screen reader, and "blank"
            would be read as a value. The reason is the content. */}
        <span className="sr-only">{labels.gap}</span>
        <ConfidenceBadge
          confidence="gap"
          labels={labels.confidence}
          className="align-middle"
        />
        {fact.note !== undefined && fact.note.length > 0 ? (
          <span className="sr-only">{fact.note}</span>
        ) : null}
      </span>
    )
  }

  // ---- conflicted --------------------------------------------------------
  if (confidence === "conflicted") {
    const competing = [
      fact.value,
      ...(fact.conflictsWith ?? []).map((entry) => entry.value),
    ]
    const range = conflictRange(competing, locale, format)

    return (
      <span
        data-slot="provenance-value"
        data-confidence="conflicted"
        className={cn(
          "inline-flex flex-wrap items-center gap-x-2 gap-y-1",
          className
        )}
      >
        <span data-numeric className="font-display font-semibold">
          {range ?? formatted}
        </span>
        <ConflictPopover
          fact={fact}
          locale={locale}
          labels={labels.conflict}
          formatValue={(value) =>
            formatFactValue(value, format, locale) ?? String(value)
          }
          {...(snapshotHref !== undefined ? { snapshotHref } : {})}
        />
        {showSources ? (
          <SourceList
            fact={fact}
            locale={locale}
            labels={labels}
            {...(snapshotHref !== undefined ? { snapshotHref } : {})}
          />
        ) : null}
      </span>
    )
  }

  // ---- inferred ----------------------------------------------------------
  if (confidence === "inferred") {
    return (
      <span
        data-slot="provenance-value"
        data-confidence="inferred"
        className={cn(
          "inline-flex flex-wrap items-center gap-x-2 gap-y-1",
          className
        )}
      >
        <span data-numeric className="font-display font-semibold italic">
          {formatted}
        </span>
        <span className="text-xs italic text-confidence-inferred">
          {labels.inferred}
        </span>
        {/* Invariant 4 guarantees a note explaining the computation. It is the
            only thing that makes an inferred number auditable, so it is text,
            not a tooltip. */}
        {fact.note !== undefined && fact.note.length > 0 ? (
          <span className="sr-only">{fact.note}</span>
        ) : null}
        {showSources ? (
          <SourceList
            fact={fact}
            locale={locale}
            labels={labels}
            {...(snapshotHref !== undefined ? { snapshotHref } : {})}
          />
        ) : null}
      </span>
    )
  }

  // ---- single_source -----------------------------------------------------
  if (confidence === "single_source") {
    return (
      <span
        data-slot="provenance-value"
        data-confidence="single_source"
        className={cn(
          "inline-flex flex-wrap items-center gap-x-2 gap-y-1",
          className
        )}
      >
        <span
          data-numeric
          className="azura-underline-dotted font-display font-semibold"
          title={labels.confidence.single_source}
        >
          {formatted}
        </span>
        {/* The dotted underline is decorative to assistive tech; the level has
            to be said out loud somewhere. */}
        <span className="sr-only">{labels.confidence.single_source}</span>
        {showSources ? (
          <SourceList
            fact={fact}
            locale={locale}
            labels={labels}
            {...(snapshotHref !== undefined ? { snapshotHref } : {})}
          />
        ) : null}
      </span>
    )
  }

  // ---- confirmed / official ----------------------------------------------
  return (
    <span
      data-slot="provenance-value"
      data-confidence={confidence}
      className={cn(
        "inline-flex flex-wrap items-center gap-x-2 gap-y-1",
        className
      )}
    >
      <span data-numeric className="font-display font-semibold">
        {formatted}
      </span>
      <span className="sr-only">{labels.confidence[confidence]}</span>
      {showSources ? (
        <SourceList
          fact={fact}
          locale={locale}
          labels={labels}
          {...(snapshotHref !== undefined ? { snapshotHref } : {})}
        />
      ) : null}
    </span>
  )
}

function SourceList<T>({
  fact,
  locale,
  labels,
  snapshotHref,
}: {
  fact: SourcedFact<T>
  locale: string
  labels: ProvenanceLabels
  snapshotHref?: (snapshotHash: string) => string
}): ReactNode {
  if (fact.sources.length === 0) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="sr-only">{labels.sources}</span>
      <SourceChipList
        sources={fact.sources}
        locale={locale}
        labels={labels.source}
        moreLabel={labels.more}
        {...(snapshotHref !== undefined ? { snapshotHref } : {})}
      />
    </span>
  )
}

/**
 * Quality marker for a unit row.
 *
 * W1-D brief §2: a `modelled` unit must be distinguishable from a
 * `portal_listing` AT A GLANCE, IN THE LIST — not only on a detail page. 631
 * of the 656 units are modelled, so getting this wrong would present a
 * synthesised inventory as a real one on every screen that shows units.
 */
export function DataQualityMark({
  dataQuality,
  labels,
  className,
}: {
  dataQuality: "portal_listing" | "official" | "modelled" | "source_missing"
  labels: Record<
    "portal_listing" | "official" | "modelled" | "source_missing",
    string
  >
  className?: string
}): ReactNode {
  if (dataQuality === "portal_listing" || dataQuality === "official") {
    return null
  }

  return (
    <span
      data-slot="data-quality"
      data-quality={dataQuality}
      className={cn(
        "inline-flex min-h-6 items-center gap-1 rounded-md border px-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.06em]",
        dataQuality === "modelled"
          ? "border-quality-modelled/40 bg-quality-modelled/10 text-quality-modelled"
          : "border-confidence-gap/40 bg-confidence-gap/10 text-confidence-gap",
        className
      )}
    >
      {labels[dataQuality]}
    </span>
  )
}
