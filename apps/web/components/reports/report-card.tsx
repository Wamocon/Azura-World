import { Construction, Lock } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Explain, type ExplainLabels } from "@/components/ui/explain"
import { cn } from "@/lib/cn"

/**
 * One report in the catalogue.                                 Owner: W-NIGHT
 *
 * The catalogue used to be four bordered strips carrying a permission id in a
 * `<code>` tag, followed by two sections that reported the build state of the
 * export pipeline. This is the replacement: a card per report that answers the
 * three questions a manager actually has, in order. What is in this file. What
 * shape does it arrive in. Can I have it.
 *
 * ## Three states, and the reader can tell them apart at a glance
 *
 * | state     | means                                             | treatment      |
 * |-----------|---------------------------------------------------|----------------|
 * | `ready`   | it exists and you may download it                 | solid card     |
 * | `locked`  | it exists and your role may not                   | solid, no action |
 * | `planned` | it does not exist yet                             | dashed, quiet  |
 *
 * `locked` and `planned` were previously both rendered as a small grey badge on
 * the right of a row, which made "ask a colleague" and "wait for the feature"
 * look identical. They are different answers and now look different.
 *
 * A `planned` card carries no button at all. The rule from the standard is that
 * a control which cannot work must say so BEFORE it is clicked, and the
 * strongest way to say it is not to draw the control.
 *
 * ## No copy lives here
 *
 * Every string arrives as a prop, resolved from `messages/*` by the page. The
 * icon arrives the same way, so the component has no knowledge of which reports
 * exist.
 */

export type ReportCardState = "ready" | "locked" | "planned"

export interface ReportCardProps {
  /** Stable id, used for the test hook only. */
  id: string
  state: ReportCardState
  /**
   * Whether this reader holds the report's own permission, independently of
   * whether the report exists. Surfaced as `data-permitted` for the access
   * probes, which need to distinguish "may not" from "not built" on a report
   * that is both.
   */
  permitted: boolean
  icon: LucideIcon
  title: string
  /** One line: what a reader will find in the file. */
  description: string
  /** Short format name, e.g. "CSV table". Absent for a report that has none. */
  formatLabel?: string
  /** Badge text for "this file names its sources". */
  provenanceLabel?: string
  /** Glossary entry behind that badge, so the term is never hover-only. */
  provenanceExplain?: ExplainLabels
  /** Label for the column list, e.g. "Columns in the file". */
  columnsLabel?: string
  /** Translated column headers, in file order. */
  columns?: readonly string[]
  /** The download control. Rendered only in the `ready` state. */
  action?: ReactNode
  /** Why this reader may not download it. Rendered only in `locked`. */
  lockedMessage?: string
  /** That it is not finished. Rendered only in `planned`. */
  plannedLabel?: string
  className?: string
}

const ICON_TONE: Readonly<Record<ReportCardState, string>> = Object.freeze({
  ready: "border-primary/25 bg-primary/10 text-primary",
  locked: "border-input bg-muted text-muted-foreground",
  planned: "border-input bg-muted text-muted-foreground",
})

export function ReportCard({
  id,
  state,
  permitted,
  icon: Icon,
  title,
  description,
  formatLabel,
  provenanceLabel,
  provenanceExplain,
  columnsLabel,
  columns,
  action,
  lockedMessage,
  plannedLabel,
  className,
}: ReportCardProps): ReactNode {
  const planned = state === "planned"

  return (
    <article
      data-testid={`report-${id}`}
      data-state={state}
      data-permitted={permitted}
      className={cn(
        "flex min-w-0 flex-col gap-4 rounded-xl border p-5",
        // Only `transform` and `border-color` move. Layout properties and
        // shadows are not animated anywhere in this product.
        "transition-[transform,border-color] duration-200 ease-[var(--ease-out)]",
        "motion-reduce:transition-none",
        planned
          ? "border-dashed border-input bg-muted/30"
          : "border-border bg-card hover:-translate-y-0.5 hover:border-primary/40 motion-reduce:hover:translate-y-0",
        className
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg border",
            ICON_TONE[state]
          )}
        >
          <Icon className="size-5" />
        </span>

        <div className="flex min-w-0 flex-col gap-1.5">
          <h3 className="font-display text-base leading-tight font-semibold tracking-[-0.01em]">
            {title}
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
      </div>

      {formatLabel === undefined && provenanceLabel === undefined ? null : (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {formatLabel === undefined ? null : (
            <Badge variant="outline">{formatLabel}</Badge>
          )}
          {provenanceLabel === undefined ? null : (
            <span className="flex items-center gap-1">
              <Badge variant="confirmed">{provenanceLabel}</Badge>
              {provenanceExplain === undefined ? null : (
                <Explain labels={provenanceExplain} iconOnly />
              )}
            </span>
          )}
        </div>
      )}

      {columns === undefined ||
      columns.length === 0 ||
      columnsLabel === undefined ? null : (
        <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">{columnsLabel}</span>{" "}
          {columns.join(" · ")}
        </p>
      )}

      {/* `mt-auto` keeps every card's action on the same baseline, so a row of
          cards reads as one control strip rather than a ragged edge. */}
      <div className="mt-auto flex min-w-0 flex-col gap-2 pt-1">
        {state === "ready" ? action : null}

        {state === "locked" && lockedMessage !== undefined ? (
          <p className="flex min-w-0 items-start gap-2 rounded-lg border border-input bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0">{lockedMessage}</span>
          </p>
        ) : null}

        {planned && plannedLabel !== undefined ? (
          <p className="flex min-w-0 items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Construction className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0">{plannedLabel}</span>
          </p>
        ) : null}
      </div>
    </article>
  )
}
