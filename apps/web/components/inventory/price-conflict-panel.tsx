import type { ReactNode } from "react"

import { cn } from "@/lib/cn"
import type { Finding, SourceRef } from "@/lib/contracts"

import {
  PriceConflictLadder,
  type LadderLabels,
  type PriceObservation,
} from "./price-conflict-ladder"
import {
  PriceObservationTable,
  type ObservationTableLabels,
} from "./price-observation-table"

/**
 * PriceConflictPanel — F-002, rendered.                     Owner: W3-C
 *
 * The screen the project is judged on. Three layers, in this order, because the
 * order is the argument:
 *
 *   1. **the judgement** — what the finding says, and that it is unresolved
 *   2. **the shape**     — the ladder: two currencies, two axes, no conversion
 *   3. **the record**    — every observation as text, with its citation
 *
 * ## Why the observations come from the listings, not from the finding
 *
 * `Finding.competingValues` is a *curated* echo of the price evidence — the
 * values the analyst chose to name in the message. The listings are the
 * evidence itself. Rendering the curated set would mean the panel silently
 * narrows as the curation narrows: W2-A's seed slice names three of the four
 * publishers F-002's own message describes, so a panel built on
 * `competingValues` would show a 2.1× spread while claiming four publishers,
 * and would be *understating a conflict* — the one direction this product must
 * never fail in.
 *
 * So the finding supplies the narrative and the listings supply the numbers.
 * Both come from repositories, both carry `RepositoryResult.source`, and the
 * caller renders that label (CONTRACTS §4) so a reader always knows whether
 * they are looking at the full store or a seed slice.
 *
 * ## What this panel refuses to draw
 *
 * No average, no midpoint, no median line, no "typical range", no converted
 * total. `F-002.resolvedTo` is `null` and `pnpm qa:evidence` fails the build if
 * anyone sets it; a panel that drew a central tendency would be arguing against
 * its own data. The unresolved state is shown as a deliberate outcome, not as
 * missing work.
 */

export interface ConflictPanelLabels {
  /**
   * The page's own heading for this finding, in the reader's language.
   *
   * Supplied per finding rather than derived from `Finding.message`, because
   * that message is English analyst prose stored in the dataset and would
   * otherwise be the German page's `<h2>`.
   */
  headline: string
  /** Labels the quoted finding text, e.g. "Befundtext (Original)". */
  recordLabel: string
  /** Template with `{id}`, e.g. "Befund {id}". */
  findingId: string
  severity: Record<Finding["severity"], string>
  area: Record<Finding["area"], string>
  /** Heading above the resolution paragraph. */
  resolutionHeading: string
  /** Shown in place of a resolved value. */
  unresolved: string
  /** Explains that unresolved is a decision, e.g. "bewusst offen gelassen". */
  unresolvedNote: string
  resolvedHeading: string
  /** Template with `{count}` and `{publishers}`. */
  observationSummary: string
  /** Heading for the layout-unstated appendix. */
  unstatedHeading: string
  /** Why those observations are listed but not plotted. */
  unstatedLead: string
  ladder: LadderLabels
  table: ObservationTableLabels
}

const SEVERITY_CLASS: Record<Finding["severity"], string> = {
  critical:
    "border-confidence-conflicted/60 bg-confidence-conflicted/15 text-confidence-conflicted",
  high: "border-confidence-conflicted/45 bg-surface-conflict text-confidence-conflicted",
  medium: "border-quality-stale/45 bg-quality-stale/10 text-quality-stale",
  low: "border-input bg-muted text-muted-foreground",
  info: "border-input bg-muted text-muted-foreground",
}

export function PriceConflictPanel({
  finding,
  observations,
  unstatedLayoutObservations = [],
  locale,
  labels,
  sourcesByUrl,
  snapshotBasePath,
  className,
}: {
  finding: Finding
  observations: readonly PriceObservation[]
  /**
   * Sale listings whose publisher quoted a price without naming a layout.
   *
   * Listed, never plotted. Alanya-Home's €220,000 at 85 m² is one of the four
   * prices F-002's own message names, and dropping it would under-report the
   * conflict — but it sits in the same bucket as a 305 m² penthouse at €1.45M,
   * so putting it on the 1+1 ladder would over-report it. Both failures are
   * avoided by showing these as what they are: a different claim.
   */
  unstatedLayoutObservations?: readonly PriceObservation[]
  locale: string
  labels: ConflictPanelLabels
  sourcesByUrl?: ReadonlyMap<string, SourceRef>
  snapshotBasePath?: string
  className?: string
}): ReactNode {
  const publishers = Array.from(
    new Set(observations.map((observation) => observation.publisher))
  )
  const resolved = finding.resolvedTo !== null && finding.resolvedTo !== undefined

  return (
    <section
      data-slot="price-conflict-panel"
      data-finding={finding.id}
      aria-labelledby={`finding-${finding.id}-heading`}
      className={cn(
        // `min-w-0` on the panel for the same reason as on the table inside it:
        // without it a flex/grid ancestor lets the widest child set the page
        // width, and the table stops being independently scrollable.
        "flex min-w-0 flex-col gap-7 rounded-2xl border border-border bg-card p-5 sm:p-7",
        // Material weight, per apple-design §12: a large surface should read as
        // thicker than a chip. A tight contact shadow plus a wide, very soft
        // ambient one — two shadows, because a single blurred drop reads as a
        // sticker. Kept far below the strength that would make a data surface
        // feel like a marketing card.
        "shadow-[0_1px_2px_rgb(0_0_0/0.04),0_24px_48px_-32px_rgb(0_0_0/0.22)]",
        "dark:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_24px_48px_-28px_rgb(0_0_0/0.65)]",
        className
      )}
    >
      {/* 1. The judgement. */}
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex min-h-6 items-center rounded-md border px-2 text-[0.6875rem] font-semibold uppercase tracking-[0.06em]",
              SEVERITY_CLASS[finding.severity]
            )}
          >
            {labels.severity[finding.severity]}
          </span>
          <span className="inline-flex min-h-6 items-center rounded-md border border-input bg-background px-2 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {labels.area[finding.area]}
          </span>
          <span
            data-numeric
            className="text-xs font-semibold tabular-nums text-muted-foreground"
          >
            {labels.findingId.replace("{id}", finding.id)}
          </span>
        </div>

        {/* Tracking is size-specific (apple-design §15): display type reads too
            loose as it grows, so it tightens; the uppercase micro-labels above
            open up instead. A single letter-spacing value would be wrong at one
            end or the other. In `em`, never `px`, so it holds at every size. */}
        <h2
          id={`finding-${finding.id}-heading`}
          className="font-display text-xl font-semibold leading-[1.15] tracking-[-0.018em] text-balance sm:text-2xl"
        >
          {labels.headline}
        </h2>

        <p className="text-xs text-muted-foreground">
          {labels.observationSummary
            .replace("{count}", String(observations.length))
            .replace("{publishers}", String(publishers.length))}
        </p>

        {/*
          The finding's own text, quoted rather than spoken in the page's voice.
          `Finding.message` is analyst prose stored in the dataset, and the
          dataset is English-only — so on the German page it was previously
          rendering as an English <h2>, which read like a translation bug and,
          worse, like the product asserting something in a language it had not
          chosen. Presenting it as a labelled quotation is both honest about its
          provenance and the only treatment that stays correct when the record
          is later translated (or is not).
        */}
        <figure className="m-0 border-l-2 border-confidence-conflicted/40 pl-3">
          <figcaption className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {labels.recordLabel}
          </figcaption>
          <blockquote className="mt-1 text-sm leading-relaxed text-foreground/90">
            {finding.message}
          </blockquote>
        </figure>
      </header>

      {/* 2. The shape.
          Set into a recessed well rather than sitting flat on the card. One
          level of layering is what separates "a page with a chart on it" from
          "an instrument" — and it also does real work, grouping the two rails
          and their separator into a single object the eye reads as one
          comparison. */}
      <div className="rounded-xl border border-border/60 bg-background/50 p-4 sm:p-5">
        <PriceConflictLadder
          observations={observations}
          locale={locale}
          labels={labels.ladder}
        />
      </div>

      {/* 3. The record. */}
      <PriceObservationTable
        observations={observations}
        locale={locale}
        labels={labels.table}
        {...(sourcesByUrl !== undefined ? { sourcesByUrl } : {})}
        {...(snapshotBasePath !== undefined ? { snapshotBasePath } : {})}
      />

      {unstatedLayoutObservations.length > 0 ? (
        <section className="flex min-w-0 flex-col gap-3 border-t border-border pt-5">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {labels.unstatedHeading}
          </h3>
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {labels.unstatedLead}
          </p>
          <PriceObservationTable
            observations={unstatedLayoutObservations}
            locale={locale}
            labels={labels.table}
            {...(sourcesByUrl !== undefined ? { sourcesByUrl } : {})}
            {...(snapshotBasePath !== undefined ? { snapshotBasePath } : {})}
          />
        </section>
      ) : null}

      {/* The resolution, last: a reader should reach it having seen the
          evidence, not be told the conclusion first. */}
      <footer className="flex flex-col gap-2 rounded-lg border border-border bg-background p-4">
        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {resolved ? labels.resolvedHeading : labels.resolutionHeading}
        </h3>
        {/* Also the analyst's own words, also stored English-only. Quoted for
            the same reason as the message above. */}
        <blockquote className="border-l-2 border-border pl-3 text-sm leading-relaxed">
          {finding.resolution}
        </blockquote>
        <p
          className={cn(
            "text-sm font-semibold",
            resolved ? "text-confidence-confirmed" : "text-confidence-conflicted"
          )}
        >
          {resolved ? String(finding.resolvedTo) : labels.unresolved}
        </p>
        {resolved ? null : (
          // "Unresolved" must read as a decision that was taken, not as a gap
          // somebody forgot to close.
          <p className="text-xs leading-relaxed text-muted-foreground">
            {labels.unresolvedNote}
          </p>
        )}
      </footer>
    </section>
  )
}
