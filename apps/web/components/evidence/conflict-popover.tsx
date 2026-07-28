"use client"

import { Popover } from "@base-ui/react/popover"
import { AlertTriangle } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/cn"
import type { SourcedFact, SourceRef } from "@/lib/contracts"

import { interpolate } from "./format"
import { SourceChip, type SourceChipLabels } from "./source-chip"

/**
 * ConflictPopover — every competing value, none of them resolved.
 *                                                          Owner: W1-D
 *
 * A POPOVER, NOT A TOOLTIP. This is the single most important interaction
 * decision in the component library. A tooltip opens on hover, which means it
 * does not exist on a touch device and is awkward at best for a screen reader.
 * DESIGN-RESEARCH §4.6 rules that out explicitly, and rightly: the
 * disagreements between sources ARE the product, so putting them behind a
 * mouse hover would hide the thing the project is for.
 *
 * So: a real `<button>` trigger, in the tab order, opening on click or Enter,
 * closing on Escape, with focus returned to the trigger. The badge on the
 * trigger is always visible; the popover only adds detail.
 *
 * SCROLLS, NEVER OVERFLOWS. F-002 carries nineteen competing 1+1 prices across
 * four publishers, in two currencies, with a 2.1x spread. The list is capped in
 * height and scrolls inside itself, so a long conflict cannot push its own
 * dismiss control off the viewport.
 *
 * NEVER CONVERTS. A USD value renders as USD next to a EUR one. Converting
 * would invent a rate and a rate date, and CONVENTIONS §5 is explicit: store
 * `Money` with its currency, convert only at display, labelled, with the
 * rate's date. There is no such rate here, so there is no conversion.
 */

export interface ConflictLabels {
  /** Trigger, e.g. "Quellen widersprechen sich" */
  trigger: string
  /** Heading, e.g. "Konkurrierende Werte" */
  heading: string
  /** Template with a `{count}` placeholder. */
  summary: string
  /** The displayed value's own row, e.g. "Angezeigter Wert" */
  displayed: string
  /** Why nothing was picked. */
  unresolvedNote: string
  close: string
  source: SourceChipLabels
}

export function ConflictPopover<T>({
  fact,
  locale,
  labels,
  formatValue,
  snapshotBasePath,
  className,
}: {
  fact: SourcedFact<T>
  locale: string
  labels: ConflictLabels
  /** Renders a competing value. Receives `unknown` — CONTRACTS §1's own type. */
  formatValue: (value: unknown) => string
  snapshotBasePath?: string
  className?: string
}): ReactNode {
  const conflicts = fact.conflictsWith ?? []

  // Invariant 2 guarantees this is non-empty when confidence is "conflicted".
  // Rendering nothing rather than an empty popover keeps a malformed fact from
  // presenting as a resolved one.
  if (conflicts.length === 0) return null

  const rows: Array<{ value: unknown; source: SourceRef; displayed: boolean }> =
    [
      ...(fact.value !== null && fact.sources[0] !== undefined
        ? [{ value: fact.value, source: fact.sources[0], displayed: true }]
        : []),
      ...conflicts.map((entry) => ({
        value: entry.value,
        source: entry.source,
        displayed: false,
      })),
    ]

  return (
    <Popover.Root>
      <Popover.Trigger
        data-slot="conflict-trigger"
        className={cn(
          // 24px floor, and a real focus ring. This is a control, not a hint.
          "inline-flex min-h-6 items-center gap-1.5 rounded-md border px-2 py-0.5",
          "border-confidence-conflicted/45 bg-surface-conflict text-xs font-semibold text-confidence-conflicted",
          "transition-[transform,background-color] duration-[160ms] ease-[var(--ease-out)]",
          "outline-none hover:bg-confidence-conflicted/15 active:scale-[0.97]",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          "motion-reduce:active:scale-100",
          className
        )}
      >
        <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
        <span>{labels.trigger}</span>
        <span className="sr-only">{interpolate(labels.summary, { count: rows.length })}</span>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="start">
          <Popover.Popup
            data-slot="conflict-popover"
            className={cn(
              "z-50 flex w-[min(26rem,calc(100vw-2rem))] flex-col gap-3 rounded-xl border border-border",
              "bg-popover p-4 text-popover-foreground shadow-2xl",
              "origin-[var(--transform-origin)]",
              "transition-[transform,opacity] duration-200 ease-[var(--ease-out)]",
              "data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0",
              "data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0",
              "motion-reduce:transition-opacity motion-reduce:data-[starting-style]:scale-100 motion-reduce:data-[ending-style]:scale-100"
            )}
          >
            <div className="flex flex-col gap-1">
              <Popover.Title className="font-display text-sm font-semibold">
                {labels.heading}
              </Popover.Title>
              <Popover.Description className="text-xs text-muted-foreground">
                {interpolate(labels.summary, { count: rows.length })}
              </Popover.Description>
            </div>

            {/* Capped and scrollable. Nineteen rows must not push the page. */}
            <ul
              className="azura-scrollbar-slim -mx-1 flex max-h-64 flex-col gap-2 overflow-y-auto px-1"
              data-slot="conflict-list"
            >
              {rows.map((row, index) => (
                <li
                  key={`${row.source.url}-${index}`}
                  className={cn(
                    "flex flex-col gap-1.5 rounded-lg border p-2.5",
                    row.displayed
                      ? "border-confidence-conflicted/45 bg-surface-conflict"
                      : "border-border bg-card"
                  )}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span
                      data-numeric
                      className="font-display text-sm font-semibold"
                    >
                      {formatValue(row.value)}
                    </span>
                    {row.displayed ? (
                      <span className="shrink-0 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-confidence-conflicted">
                        {labels.displayed}
                      </span>
                    ) : null}
                  </div>
                  <SourceChip
                    source={row.source}
                    locale={locale}
                    labels={labels.source}
                    {...(snapshotBasePath !== undefined ? { snapshotBasePath } : {})}
                  />
                </li>
              ))}
            </ul>

            <p className="text-xs leading-relaxed text-muted-foreground">
              {labels.unresolvedNote}
            </p>

            <Popover.Close
              className={cn(
                "inline-flex min-h-6 items-center self-start rounded-md px-2 text-xs font-semibold text-primary",
                "outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              )}
            >
              {labels.close}
            </Popover.Close>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
