"use client"

import { AlertTriangle, Lock, RotateCw } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/cn"
import type { Locale, SourcedFact } from "@/lib/contracts"

import {
  ProvenanceValue,
  type ProvenanceLabels,
} from "@/components/evidence/provenance-value"
import type { ProvenanceFormat } from "@/components/evidence/format"
import { SyncBadge } from "@/components/sync-badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { LiveMode } from "@/lib/realtime"

/**
 * KpiCard — one figure, and how much to trust it.          Owner: W3-B
 *
 * FOUR STATES, AND THE THREE WAYS A CARD CAN BE ABSENT ARE KEPT APART.
 * `getDashboardSnapshot()` distinguishes `restrictedPanels`, `failedPanels`
 * and `truncatedPanels`, and collapsing them into "no data" would throw away
 * the only information that tells a user whether to complain, retry, or accept
 * the answer:
 *
 *   restricted → the correct answer for this role. Not a fault, no retry.
 *   failed     → it broke. Retry, and the rest of the dashboard is unaffected.
 *   truncated  → it loaded, but its proportions come from a bounded sample.
 *
 * A FAILING CARD NEVER TAKES THE PAGE DOWN. The brief is explicit, and the
 * repository already fans out with `Promise.allSettled` so one panel's failure
 * arrives as a name in `failedPanels` rather than a rejected promise. This
 * component is the other half of that: it renders the failure in place, at the
 * size of the card, so eleven other figures stay readable.
 *
 * A `gap` FACT RENDERS "—", NEVER `0`. Pass `fact` rather than `value` and
 * `ProvenanceValue` enforces it. `value` exists for counts that are genuinely
 * not sourced facts — how many findings are in the dataset is a property of
 * the dataset, not a claim about the world — and those must not be dressed up
 * with provenance they do not have.
 */

export type KpiState = "loading" | "ready" | "restricted" | "failed"

export interface KpiCardLabels {
  restricted: string
  restrictedHint: string
  failed: string
  failedHint: string
  truncated: string
  retry: string
}

interface KpiCardBase {
  label: string
  state: KpiState
  labels: KpiCardLabels
  locale: Locale
  /** Freshness of the surface behind this card. From `useLiveSnapshot`. */
  mode?: LiveMode
  lastUpdated?: string | null
  /** Distributions came from a bounded sample. Shown, never hidden. */
  truncated?: boolean
  /** Secondary line: a breakdown, a comparison, a unit. */
  hint?: string
  onRetry?: () => void
  className?: string
}

/**
 * Either a `SourcedFact` — which renders through W1-D and carries its
 * provenance — or a plain count that is a property of the dataset rather than
 * a claim about the world. The union makes it impossible to pass a sourced
 * figure as a bare number and quietly drop its citation.
 */
export type KpiCardProps =
  | (KpiCardBase & {
      kind: "fact"
      fact: SourcedFact<unknown> | null
      format?: ProvenanceFormat
      provenanceLabels: ProvenanceLabels
    })
  | (KpiCardBase & {
      kind: "count"
      /** `null` renders "—". Never coerce to 0 — they are different facts. */
      value: number | null
      formatOptions?: Intl.NumberFormatOptions
    })

export function KpiCard(props: KpiCardProps): ReactNode {
  const {
    label,
    state,
    labels,
    locale,
    mode,
    lastUpdated,
    truncated,
    hint,
    onRetry,
    className,
  } = props

  return (
    <article
      data-slot="kpi-card"
      data-state={state}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-4",
        state === "failed" && "border-destructive/40 bg-destructive/5",
        className
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <h3 className="min-w-0 truncate text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {label}
        </h3>
        {/* Freshness sits on the card, not in the topbar: two cards on one page
            can legitimately be in different modes. */}
        {mode === undefined || state !== "ready" ? null : (
          <SyncBadge
            mode={mode}
            lastUpdated={lastUpdated ?? null}
            locale={locale}
          />
        )}
      </div>

      <div className="min-w-0">
        {state === "loading" ? (
          <Skeleton preset="heading" className="w-2/3" />
        ) : state === "restricted" ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Lock className="size-4 shrink-0" aria-hidden="true" />
            {labels.restricted}
          </p>
        ) : state === "failed" ? (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            {labels.failed}
          </p>
        ) : props.kind === "fact" ? (
          props.fact === null ? (
            <span className="font-display text-2xl font-semibold text-confidence-gap">
              —
            </span>
          ) : (
            <ProvenanceValue
              fact={props.fact}
              {...(props.format === undefined ? {} : { format: props.format })}
              locale={locale}
              labels={props.provenanceLabels}
              className="font-display text-2xl font-semibold"
            />
          )
        ) : (
          <span data-numeric className="font-display text-2xl font-semibold">
            {props.value === null
              ? "—"
              : new Intl.NumberFormat(locale, props.formatOptions).format(
                  props.value
                )}
          </span>
        )}
      </div>

      {/* The explanation for the state, then the card's own hint. A restricted
          panel says why it is empty; silence would read as a bug. */}
      {state === "restricted" ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {labels.restrictedHint}
        </p>
      ) : state === "failed" ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {labels.failedHint}
          </p>
          {onRetry === undefined ? null : (
            <Button variant="outline" size="xs" onClick={onRetry}>
              <RotateCw aria-hidden="true" />
              {labels.retry}
            </Button>
          )}
        </div>
      ) : (
        <>
          {hint === undefined ? null : (
            <p className="truncate text-xs text-muted-foreground" title={hint}>
              {hint}
            </p>
          )}
          {truncated === true ? (
            <p className="text-xs leading-relaxed text-confidence-conflicted">
              {labels.truncated}
            </p>
          ) : null}
        </>
      )}
    </article>
  )
}
