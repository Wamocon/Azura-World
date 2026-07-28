import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/cn"

/**
 * Places on a scheduled activity.                             Owner: W3-E
 *
 * ## Three states, and the third is the one that matters
 *
 * 1. **Capacity is `null`** — the activity is uncapped. Rendered as "no limit",
 *    never as `0`. `activities.capacity` carries a comment in migration 06
 *    making the same point about the column: NULL means uncapped, and 0 is
 *    rejected by a CHECK rather than stored and later misread as unlimited.
 *
 * 2. **Capacity is a number and the booking count is known** — the ordinary
 *    case. Both figures, plus a bar.
 *
 * 3. **Capacity is a number and the booking count is `null`** — the case as
 *    shipped tonight. There is no `activity_bookings` table in the database, so
 *    nothing in this product knows how many places are taken. The meter says so
 *    in words and prints no bar.
 *
 * State 3 is why `booked` is `number | null` and not `number`. Defaulting an
 * unknown occupancy to `0` would render "12 of 12 places free" for an activity
 * nobody can book, which reads as researched and is invented. That is the exact
 * failure `SYSTEM-PROMPT` §2.3 forbids, and the fact that the invented figure
 * here is a headcount rather than a price changes nothing about it.
 */

export interface CapacityLabels {
  /** e.g. "{booked} von {capacity} Plätzen belegt" */
  occupancy: (booked: number, capacity: number) => string
  /** e.g. "{n} Plätze frei" */
  remaining: (free: number) => string
  full: string
  uncapped: string
  /** The state-3 statement. Must name the reason, not just the absence. */
  unknown: string
  waitlist: (n: number) => string
  totalPlaces: (capacity: number) => string
}

export function CapacityMeter({
  capacity,
  booked,
  waitlisted,
  labels,
  className,
}: {
  capacity: number | null
  /** `null` = not known. See state 3 above. Never coerce to 0. */
  booked: number | null
  waitlisted?: number | null
  labels: CapacityLabels
  className?: string
}) {
  if (capacity === null) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Badge variant="muted">{labels.uncapped}</Badge>
      </div>
    )
  }

  if (booked === null) {
    return (
      <div className={cn("flex flex-col gap-1", className)}>
        <span className="text-sm text-foreground tabular-nums">
          {labels.totalPlaces(capacity)}
        </span>
        {/* A gap, marked as one. Same treatment the provenance system gives a
            missing price, for the same reason. */}
        <Badge variant="gap">{labels.unknown}</Badge>
      </div>
    )
  }

  const free = Math.max(0, capacity - booked)
  const ratio = capacity === 0 ? 1 : Math.min(1, booked / capacity)

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm text-foreground tabular-nums">
          {labels.occupancy(booked, capacity)}
        </span>
        {free === 0 ? (
          <Badge variant="stale">{labels.full}</Badge>
        ) : (
          <span className="text-xs text-muted-foreground tabular-nums">
            {labels.remaining(free)}
          </span>
        )}
      </div>
      <div
        role="img"
        aria-label={labels.occupancy(booked, capacity)}
        className="h-1.5 w-full max-w-56 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full",
            free === 0 ? "bg-quality-stale" : "bg-primary"
          )}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
      {waitlisted !== undefined && waitlisted !== null && waitlisted > 0 ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          {labels.waitlist(waitlisted)}
        </span>
      ) : null}
    </div>
  )
}
