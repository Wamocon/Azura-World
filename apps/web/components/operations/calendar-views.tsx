import { Link } from "@/app/navigation"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/cn"
import type { Locale } from "@/lib/contracts"
import { intlLocale, PROJECT_TIME_ZONE } from "@/lib/format"

/**
 * Month, week and day renderings of the operations calendar.  Owner: W3-E
 *
 * ## Every date question here is asked in the site's time zone
 *
 * The calendar shows what happens **at the resort**, so a day boundary is a day
 * boundary in Türkiye. `new Date(iso).getDate()` would answer in whatever zone
 * the Node process happens to run in, which on a European host puts a 00:30
 * Istanbul activity on the previous day for one reader and the correct day for
 * another. {@link zonedDayKey} asks `Intl` for the calendar date in
 * `PROJECT_TIME_ZONE` instead, so the bucketing is the same everywhere.
 *
 * Türkiye has been permanently UTC+3 since 2016 and has no DST, so the site's
 * own offset never moves. The *viewer's* does: a subscriber in Berlin is +2 from
 * the site in January and +1 in July. This surface therefore states the zone it
 * is drawn in rather than guessing the reader's, and the ICS feed is the path
 * for anyone who wants these times in their own zone (see `lib/ics-calendar.ts`).
 */

export type CalendarEntryKind = "activity" | "ticket_due"

export interface CalendarEntry {
  id: string
  title: string
  startsAt: string
  endsAt?: string | null
  kind: CalendarEntryKind
  href?: string
  /** Shown after the title, e.g. the location or the ticket number. */
  detail?: string | null
}

export type CalendarView = "month" | "week" | "day"

export interface CalendarLabels {
  weekdays: readonly string[]
  emptyDay: string
  moreEntries: (n: number) => string
  kinds: Record<CalendarEntryKind, string>
}

// ---------------------------------------------------------------------------
// Zone-correct date arithmetic
// ---------------------------------------------------------------------------

/**
 * The calendar date of an instant, **in a named zone**, as `YYYY-MM-DD`.
 *
 * `formatToParts` rather than `toLocaleDateString` with a hand-written parse:
 * the parts are named, so this cannot be broken by a locale that orders or
 * punctuates the date differently.
 */
export function zonedDayKey(
  iso: string,
  timeZone: string = PROJECT_TIME_ZONE
): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? ""
  const year = get("year")
  const month = get("month")
  const day = get("day")
  if (year === "" || month === "" || day === "") return null
  return `${year}-${month}-${day}`
}

/** `HH:MM` in the site's zone, 24-hour, for a compact entry chip. */
export function zonedTimeLabel(
  iso: string,
  locale: Locale,
  timeZone: string = PROJECT_TIME_ZONE
): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)
}

/** A `YYYY-MM-DD` key into a `Date` at UTC midnight, for grid arithmetic only. */
function keyToUtcDate(key: string): Date {
  return new Date(`${key}T00:00:00Z`)
}

function utcDateToKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDays(key: string, days: number): string {
  const date = keyToUtcDate(key)
  date.setUTCDate(date.getUTCDate() + days)
  return utcDateToKey(date)
}

/**
 * The Monday on or before `key`. ISO-8601 week start, which is what all four of
 * this product's locales use. `getUTCDay()` is Sunday-based, hence the shift.
 */
export function startOfWeek(key: string): string {
  const day = keyToUtcDate(key).getUTCDay()
  return addDays(key, -((day + 6) % 7))
}

export function startOfMonth(key: string): string {
  return `${key.slice(0, 7)}-01`
}

/** The 42 cells of a six-week month grid, starting on a Monday. */
export function monthGridKeys(anchor: string): string[] {
  const first = startOfWeek(startOfMonth(anchor))
  return Array.from({ length: 42 }, (_, index) => addDays(first, index))
}

export function weekKeys(anchor: string): string[] {
  const first = startOfWeek(anchor)
  return Array.from({ length: 7 }, (_, index) => addDays(first, index))
}

/** Group entries by the site-local day they start on. */
export function bucketByDay(
  entries: readonly CalendarEntry[]
): Map<string, CalendarEntry[]> {
  const buckets = new Map<string, CalendarEntry[]>()
  for (const entry of entries) {
    const key = zonedDayKey(entry.startsAt)
    // An unparseable instant is dropped rather than bucketed to today. An entry
    // on the wrong day is worse than one that is visibly missing from the grid.
    if (key === null) continue
    const bucket = buckets.get(key)
    if (bucket === undefined) buckets.set(key, [entry])
    else bucket.push(entry)
  }
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1))
  }
  return buckets
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const MONTH_CELL_LIMIT = 3

function EntryChip({
  entry,
  locale,
  compact,
}: {
  entry: CalendarEntry
  locale: Locale
  compact: boolean
}) {
  const time = zonedTimeLabel(entry.startsAt, locale)
  const body = (
    <>
      <span className="tabular-nums opacity-70">{time}</span>{" "}
      <span className={cn(compact && "truncate")}>{entry.title}</span>
      {entry.detail === undefined || entry.detail === null || compact ? null : (
        <span className="text-muted-foreground"> · {entry.detail}</span>
      )}
    </>
  )
  const className = cn(
    "block rounded px-1.5 py-0.5 text-xs",
    compact && "truncate",
    entry.kind === "ticket_due"
      ? "bg-quality-stale/15 text-foreground"
      : "bg-primary/10 text-foreground"
  )
  return entry.href === undefined ? (
    <span className={className} title={entry.title}>
      {body}
    </span>
  ) : (
    <Link
      href={entry.href}
      className={cn(
        className,
        "hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      )}
      title={entry.title}
    >
      {body}
    </Link>
  )
}

export function CalendarMonth({
  anchor,
  entries,
  locale,
  labels,
  todayKey,
}: {
  anchor: string
  entries: readonly CalendarEntry[]
  locale: Locale
  labels: CalendarLabels
  todayKey: string
}) {
  const buckets = bucketByDay(entries)
  const keys = monthGridKeys(anchor)
  const month = anchor.slice(0, 7)

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="grid grid-cols-7 border-b border-border bg-muted/40">
        {labels.weekdays.map((day) => (
          <div
            key={day}
            className="px-2 py-1.5 text-center text-xs font-medium text-muted-foreground"
          >
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {keys.map((key) => {
          const dayEntries = buckets.get(key) ?? []
          const outside = key.slice(0, 7) !== month
          const shown = dayEntries.slice(0, MONTH_CELL_LIMIT)
          const hidden = dayEntries.length - shown.length
          return (
            <div
              key={key}
              className={cn(
                "flex min-h-24 flex-col gap-0.5 border-r border-b border-border p-1 last:border-r-0",
                outside && "bg-muted/20",
                key === todayKey && "bg-primary/5"
              )}
            >
              <span
                className={cn(
                  "px-1 text-xs tabular-nums",
                  outside
                    ? "text-muted-foreground/60"
                    : "text-muted-foreground",
                  key === todayKey && "font-semibold text-primary"
                )}
              >
                {Number(key.slice(8, 10))}
              </span>
              {shown.map((entry) => (
                <EntryChip
                  key={entry.id}
                  entry={entry}
                  locale={locale}
                  compact
                />
              ))}
              {hidden > 0 ? (
                <span className="px-1 text-xs text-muted-foreground">
                  {labels.moreEntries(hidden)}
                </span>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Week and day share one renderer: a day view is a week view with one column's
 * worth of days. Two components would be two places to fix the same bug.
 */
export function CalendarAgenda({
  dayKeys,
  entries,
  locale,
  labels,
  todayKey,
  dayHeading,
}: {
  dayKeys: readonly string[]
  entries: readonly CalendarEntry[]
  locale: Locale
  labels: CalendarLabels
  todayKey: string
  dayHeading: (key: string) => string
}) {
  const buckets = bucketByDay(entries)
  return (
    <div className="flex flex-col gap-3">
      {dayKeys.map((key) => {
        const dayEntries = buckets.get(key) ?? []
        return (
          <section
            key={key}
            className={cn(
              "rounded-lg border border-border p-3",
              key === todayKey && "border-primary/40 bg-primary/5"
            )}
          >
            <h3 className="mb-2 text-sm font-medium text-foreground">
              {dayHeading(key)}
            </h3>
            {dayEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">{labels.emptyDay}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {dayEntries.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-2">
                    <Badge variant="muted">{labels.kinds[entry.kind]}</Badge>
                    <EntryChip entry={entry} locale={locale} compact={false} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
