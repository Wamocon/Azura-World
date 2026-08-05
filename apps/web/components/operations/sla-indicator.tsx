import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/cn"
import type { SlaAssessment, SlaState } from "@/lib/ticket-workflow"

/**
 * How a ticket stands against its response target.        Owner: W3-E
 *
 * Two facts, deliberately both shown: the state (a judgement) and the age (the
 * measurement it came from). A board that shows only "overdue" invites the
 * question "by how much", and a board that shows only "38 h" makes every reader
 * do the arithmetic.
 *
 * ## The response targets are ours, and this says so
 *
 * `slaHoursByPriority` is an assumption by this window, not a harvested figure:
 * no Azura World or Cebeci Group source publishes a service-level target. The
 * caller passes `assumptionNote`, and the surrounding page prints it once, so
 * nobody reads these as a commitment the operator actually made. That is the
 * same honesty rule the provenance badges enforce for prices, applied to a
 * figure whose source is us.
 */

export type SlaLabels = Record<SlaState, string>

const treatment: Record<
  SlaState,
  { variant: "muted" | "outline" | "stale" | "destructive"; emphasis: string }
> = {
  none: { variant: "muted", emphasis: "text-muted-foreground" },
  on_track: { variant: "outline", emphasis: "text-muted-foreground" },
  due_soon: { variant: "stale", emphasis: "text-foreground" },
  breached: { variant: "destructive", emphasis: "font-medium text-foreground" },
}

/** Whole hours, or days once that stops being readable. */
function humaniseHours(
  hours: number,
  hourUnit: string,
  dayUnit: string
): string {
  if (hours < 48) return `${hours} ${hourUnit}`
  return `${Math.floor(hours / 24)} ${dayUnit}`
}

export function SlaIndicator({
  assessment,
  labels,
  ageLabel,
  tookLabel,
  hourUnit,
  dayUnit,
}: {
  assessment: SlaAssessment
  labels: SlaLabels
  /** "open for {age}" — for a ticket that is still running. */
  ageLabel: (age: string) => string
  /**
   * "took {age}" — for a ticket that has finished.
   *
   * Without this the row said "open for 55 days" on a ticket closed six weeks
   * ago, and the number went up every night. It was not open. A finished
   * ticket's meaningful figure is how long it took, measured to the moment it
   * closed, and `assessment.ageIsFinal` is how the assessment says which of the
   * two numbers it just handed over.
   *
   * Optional so a caller that has not supplied the second string keeps the old
   * wording rather than rendering nothing.
   */
  tookLabel?: (age: string) => string
  hourUnit: string
  dayUnit: string
}) {
  const { variant, emphasis } = treatment[assessment.state]
  const label =
    assessment.ageIsFinal && tookLabel !== undefined ? tookLabel : ageLabel
  return (
    <span className="inline-flex items-center gap-2">
      <Badge variant={variant}>{labels[assessment.state]}</Badge>
      {assessment.ageHours === null ? null : (
        <span className={cn("text-xs tabular-nums", emphasis)}>
          {label(humaniseHours(assessment.ageHours, hourUnit, dayUnit))}
        </span>
      )}
    </span>
  )
}
