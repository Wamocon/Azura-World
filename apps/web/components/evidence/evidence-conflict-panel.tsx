import type { ReactNode } from "react"

import {
  EvidenceObservationRecord,
  type ObservationRecordLabels,
} from "@/components/evidence/evidence-observation-record"
import {
  EvidencePriceBars,
  type PriceBarsExplain,
  type PriceBarsLabels,
} from "@/components/evidence/evidence-price-bars"
import { publisherNames } from "@/components/evidence/evidence-conflict-model"
import { interpolate } from "@/components/evidence/format"
import { Explain, type ExplainLabels } from "@/components/ui/explain"
import { cn } from "@/lib/cn"
import type { Finding, SourceRef } from "@/lib/contracts"

import type { PriceObservation } from "@/components/inventory/price-conflict-ladder"

/**
 * F-002, rendered so it lands in five seconds.              Owner: W-EVIDENCE
 *
 * Four layers, and the order is the argument:
 *
 *   1. **the claim**   — one plain sentence a property manager can act on
 *   2. **the shape**   — one bar per portal, sorted, priced, two currencies
 *   3. **the record**  — every quote as text, with its citation
 *   4. **the outcome** — deliberately unresolved, and why
 *
 * ## The analyst prose is quoted, not spoken
 *
 * `Finding.message` and `Finding.resolution` are English analyst prose stored in
 * the dataset: *"The 1+1 entry price spans a 2.1x range across four
 * publishers…"*. They were the first two paragraphs of this panel, in English,
 * on a German page, written for somebody who models data rather than somebody
 * who manages a building. They are now behind one disclosure, labelled as the
 * recorded original, and the page speaks in its own translated voice above it.
 *
 * Kept, not deleted: an analyst checking a figure needs the exact wording, and
 * a product whose whole argument is that it shows its working does not get to
 * hide the record because the record reads badly.
 *
 * ## What this panel still refuses to draw
 *
 * No average, no midpoint, no median, no "typical range", no converted total.
 * `F-002.resolvedTo` is `null` and `pnpm qa:evidence` fails the build if anyone
 * sets it. Unresolved is presented as a decision that was taken, never as work
 * somebody forgot to finish.
 */

export interface EvidenceConflictLabels {
  /** The page's own heading for this finding, already translated. */
  headline: string
  /** Template with `{id}`, e.g. "Finding {id}". */
  findingId: string
  severity: Record<Finding["severity"], string>
  area: Record<Finding["area"], string>
  /** Template with `{portals}` and `{layout}`. The one-sentence claim. */
  summary: string
  /** States that nothing was averaged and nothing was chosen. */
  noPick: string
  /** Disclosure label over the untranslated finding text. */
  originalLabel: string
  /** One line inside it explaining what the reader is about to read. */
  originalHint: string
  /** Sub-label over the quoted `Finding.message`. */
  originalFinding: string
  /** Sub-label over the quoted `Finding.resolution`. */
  originalResolution: string
  /** Heading over the record table. */
  recordHeading: string
  /** One line above the record table. */
  recordLead: string
  /** Heading of the layout-unstated appendix. */
  unstatedHeading: string
  /** Why those quotes are listed but not charted. */
  unstatedLead: string
  resolutionHeading: string
  resolvedHeading: string
  unresolved: string
  unresolvedNote: string
  bars: PriceBarsLabels
  record: ObservationRecordLabels
}

export interface EvidenceConflictExplain extends PriceBarsExplain {
  gap: ExplainLabels
  provenance: ExplainLabels
}

const SEVERITY_CLASS: Record<Finding["severity"], string> = {
  critical:
    "border-confidence-conflicted/60 bg-confidence-conflicted/15 text-confidence-conflicted",
  high: "border-confidence-conflicted/45 bg-surface-conflict text-confidence-conflicted",
  medium: "border-quality-stale/45 bg-quality-stale/10 text-quality-stale",
  low: "border-input bg-muted text-muted-foreground",
  info: "border-input bg-muted text-muted-foreground",
}

const BADGE =
  "inline-flex min-h-6 items-center rounded-md border px-2 text-[0.6875rem] font-semibold tracking-[0.06em] uppercase"

export function EvidenceConflictPanel({
  finding,
  observations,
  unstatedLayoutObservations = [],
  layout,
  locale,
  labels,
  explain,
  sourcesByUrl,
  snapshotBasePath,
  className,
}: {
  finding: Finding
  observations: readonly PriceObservation[]
  /**
   * Sale listings whose portal quoted a price without naming a layout.
   *
   * Listed, never charted. Alanya-Home's 220.000 € is one of the four figures
   * F-002's own message names, so dropping it would under-report the conflict,
   * but it sits in the same bucket as a 305 m² penthouse, so putting it on the
   * 1+1 scale would over-report it. Showing it as a different claim avoids both.
   */
  unstatedLayoutObservations?: readonly PriceObservation[]
  /** The layout every charted observation describes, e.g. "1+1". */
  layout: string
  locale: string
  labels: EvidenceConflictLabels
  explain: EvidenceConflictExplain
  sourcesByUrl?: ReadonlyMap<string, SourceRef>
  snapshotBasePath?: string
  className?: string
}): ReactNode {
  const portals = publisherNames(observations).length
  const resolved =
    finding.resolvedTo !== null && finding.resolvedTo !== undefined

  return (
    <section
      data-slot="evidence-conflict-panel"
      data-finding={finding.id}
      aria-labelledby={`finding-${finding.id}-heading`}
      className={cn(
        // `min-w-0` for the same reason as on the table inside it: without it a
        // flex ancestor lets the widest child set the page width.
        "flex min-w-0 flex-col gap-7 rounded-2xl border border-border bg-card p-5 sm:p-7",
        // Two shadows, per apple-design §12: a tight contact shadow plus a wide
        // ambient one. A single blurred drop reads as a sticker.
        "shadow-[0_1px_2px_rgb(0_0_0/0.04),0_24px_48px_-32px_rgb(0_0_0/0.22)]",
        className
      )}
    >
      {/* 1. The claim. */}
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn(BADGE, SEVERITY_CLASS[finding.severity])}>
            {labels.severity[finding.severity]}
          </span>
          <span
            className={cn(
              BADGE,
              "border-input bg-background text-muted-foreground"
            )}
          >
            {labels.area[finding.area]}
          </span>
          {/* The conflict itself, named in plain language and carrying its own
              explanation. Visible, never hover-only: azura-ui-ux §5.3, and the
              conflicts are the product. */}
          <span
            className={cn(
              BADGE,
              "border-confidence-conflicted/45 bg-surface-conflict text-confidence-conflicted normal-case"
            )}
          >
            <Explain
              labels={explain.conflicted}
              className="text-[0.6875rem] font-semibold tracking-[0.02em]"
            />
          </span>
          <span
            data-numeric
            className="text-xs font-semibold text-muted-foreground tabular-nums"
          >
            {interpolate(labels.findingId, { id: finding.id })}
          </span>
        </div>

        {/* Tracking tightens as display type grows, in `em` so it holds at every
            size (apple-design §15). */}
        <h2
          id={`finding-${finding.id}-heading`}
          className="font-display text-xl leading-[1.15] font-semibold tracking-[-0.018em] text-balance sm:text-2xl"
        >
          {labels.headline}
        </h2>

        <p className="max-w-2xl text-sm leading-relaxed text-foreground/90 sm:text-base">
          {interpolate(labels.summary, { portals, layout })}
        </p>
        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
          {labels.noPick}
        </p>

        <details className="group max-w-2xl">
          <summary className="azura-tap-compact inline-flex cursor-pointer list-none items-center gap-1 text-[0.6875rem] tracking-[0.04em] text-muted-foreground/80 uppercase hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] [&::-webkit-details-marker]:hidden">
            <span
              aria-hidden="true"
              className="inline-block transition-transform duration-[var(--duration-fast)] group-open:rotate-90 motion-reduce:transition-none"
            >
              ›
            </span>
            {labels.originalLabel}
          </summary>
          <div className="mt-2 flex flex-col gap-3 border-l-2 border-confidence-conflicted/40 pl-3">
            <p className="text-[0.6875rem] leading-relaxed text-muted-foreground/75 italic">
              {labels.originalHint}
            </p>
            <figure className="m-0">
              <figcaption className="text-[0.6875rem] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                {labels.originalFinding}
              </figcaption>
              <blockquote className="mt-1 text-sm leading-relaxed text-foreground/85">
                {finding.message}
              </blockquote>
            </figure>
            <figure className="m-0">
              <figcaption className="text-[0.6875rem] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                {labels.originalResolution}
              </figcaption>
              <blockquote className="mt-1 text-sm leading-relaxed text-foreground/85">
                {finding.resolution}
              </blockquote>
            </figure>
          </div>
        </details>
      </header>

      {/* 2. The shape. Set into a recessed well: one level of layering is what
          separates "a page with a chart on it" from an instrument, and it groups
          the two currency scales into a single object the eye reads as one
          comparison. */}
      <div className="rounded-xl border border-border/60 bg-background/50 p-4 sm:p-5">
        <EvidencePriceBars
          observations={observations}
          locale={locale}
          labels={labels.bars}
          explain={explain}
        />
      </div>

      {/* 3. The record. */}
      <section className="flex min-w-0 flex-col gap-2">
        <h3 className="flex flex-wrap items-center gap-2 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {labels.recordHeading}
          <Explain
            labels={explain.provenance}
            iconOnly
            className="min-w-6 normal-case"
          />
        </h3>
        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
          {labels.recordLead}
        </p>
        <EvidenceObservationRecord
          observations={observations}
          locale={locale}
          labels={labels.record}
          className="mt-1"
          {...(sourcesByUrl !== undefined ? { sourcesByUrl } : {})}
          {...(snapshotBasePath !== undefined ? { snapshotBasePath } : {})}
        />
      </section>

      {unstatedLayoutObservations.length > 0 ? (
        <section className="flex min-w-0 flex-col gap-2 border-t border-border pt-5">
          <h3 className="flex flex-wrap items-center gap-2 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {labels.unstatedHeading}
            <Explain
              labels={explain.gap}
              iconOnly
              className="min-w-6 normal-case"
            />
          </h3>
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {labels.unstatedLead}
          </p>
          <EvidenceObservationRecord
            observations={unstatedLayoutObservations}
            locale={locale}
            // Its own `<caption>`. Both tables otherwise announce themselves
            // with the same sentence, and a screen-reader user listing the
            // tables on this page would hear one name twice with no way to tell
            // the charted record from the appendix that is deliberately not on
            // the scale.
            labels={{ ...labels.record, caption: labels.unstatedHeading }}
            className="mt-1"
            {...(sourcesByUrl !== undefined ? { sourcesByUrl } : {})}
            {...(snapshotBasePath !== undefined ? { snapshotBasePath } : {})}
          />
        </section>
      ) : null}

      {/* 4. The outcome, last: a reader should reach it having seen the
          evidence, not be told a conclusion first. */}
      <footer className="flex flex-col gap-2 rounded-lg border border-border bg-background p-4">
        <h3 className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {resolved ? labels.resolvedHeading : labels.resolutionHeading}
        </h3>
        <p
          className={cn(
            "font-display text-base font-semibold",
            resolved
              ? "text-confidence-confirmed"
              : "text-confidence-conflicted"
          )}
        >
          {resolved ? String(finding.resolvedTo) : labels.unresolved}
        </p>
        {resolved ? null : (
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {labels.unresolvedNote}
          </p>
        )}
      </footer>
    </section>
  )
}
