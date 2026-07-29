import { cn } from "@/lib/cn"
import type { HotelRoomBreakdown } from "@/lib/hotel-repository"
import { intlLocaleTag } from "@/lib/format"

/**
 * The room breakdown, and the gap where it is not published. Owner: W3-G
 *
 * ## The empty state is the point
 *
 * `hotel_rooms` is empty **by design**. No source publishes a room-type split
 * for this property — only the 188 total. `HANDOFF/W3-G.md` §7 anticipated this
 * surface and said it "will need to render an explicit 'no published breakdown'
 * state rather than an empty table."
 *
 * A grid of plausible room types — 90 standard, 60 family, 30 suite, 8 villa —
 * would take five minutes, would look complete, and would be the exact failure
 * this product exists to make visible. So the absence is a designed state that
 * says *what is missing and why*, and the total is shown beside it so a reader
 * can see the whole that has not been divided.
 *
 * ## Why the total is not derived from the rows
 *
 * `publishedRoomTotal` sums only rows that state a count, and it is presented
 * **next to** the hotel's own `roomCount` rather than in place of it. If the
 * two ever disagree that is a finding, not a rounding error, and the reader
 * sees both numbers rather than one the UI picked.
 */

export interface RoomBreakdownLabels {
  heading: string
  /** e.g. "Zimmer insgesamt" — the hotel's own published total. */
  totalLabel: string
  /** e.g. "Summe der veröffentlichten Zeilen" */
  publishedSumLabel: string
  code: string
  type: string
  rooms: string
  area: string
  occupancy: string
  seaView: string
  yes: string
  no: string
  /** The heading over the gap panel. */
  noBreakdownHeading: string
  /** Shown when the two totals disagree. */
  mismatch: string
}

export function RoomBreakdown({
  breakdown,
  hotelRoomCount,
  labels,
  locale,
  className,
}: {
  breakdown: HotelRoomBreakdown
  hotelRoomCount: number | null
  labels: RoomBreakdownLabels
  locale: string
  className?: string
}) {
  const number = (value: number | null): string =>
    value === null ? "—" : new Intl.NumberFormat(intlLocaleTag(locale)).format(value)

  const mismatch =
    breakdown.publishedRoomTotal !== null &&
    hotelRoomCount !== null &&
    breakdown.publishedRoomTotal !== hotelRoomCount

  return (
    <section className={cn("flex flex-col gap-4", className)} data-slot="room-breakdown">
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted-foreground">
            {labels.totalLabel}
          </span>
          <span className="font-display text-3xl text-foreground tabular-nums" data-slot="room-total">
            {number(hotelRoomCount)}
          </span>
        </div>

        {breakdown.breakdownPublished ? (
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted-foreground">
              {labels.publishedSumLabel}
            </span>
            <span className="font-display text-3xl text-foreground tabular-nums">
              {number(breakdown.publishedRoomTotal)}
            </span>
          </div>
        ) : null}
      </div>

      {mismatch ? (
        <p
          role="status"
          className="rounded-lg border border-confidence-conflicted/40 bg-surface-conflict px-3 py-2 text-xs leading-relaxed text-confidence-conflicted"
        >
          {labels.mismatch}
        </p>
      ) : null}

      {breakdown.breakdownPublished ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <caption className="sr-only">{labels.heading}</caption>
            <thead>
              <tr className="border-b border-border text-left">
                {[labels.code, labels.type, labels.rooms, labels.area, labels.occupancy, labels.seaView].map(
                  (header) => (
                    <th
                      key={header}
                      scope="col"
                      className="px-4 py-3 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted-foreground"
                    >
                      {header}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {breakdown.rooms.map((room) => (
                <tr key={room.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3 font-medium text-foreground">{room.code}</td>
                  <td className="px-4 py-3 text-muted-foreground">{room.roomType ?? room.name ?? "—"}</td>
                  <td className="px-4 py-3 tabular-nums">{number(room.roomCount)}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {room.interiorM2 === null ? "—" : `${number(room.interiorM2)} m²`}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{number(room.maxOccupancy)}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {room.hasSeaView === null ? "—" : room.hasSeaView ? labels.yes : labels.no}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        // The designed absence. `note` is the repository's own sentence, so the
        // reason travels with the data rather than being restated here where it
        // could drift from it.
        <div
          data-slot="room-breakdown-gap"
          className="flex flex-col gap-2 rounded-xl border border-dashed border-border bg-muted/30 p-6"
        >
          <h3 className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted-foreground">
            {labels.noBreakdownHeading}
          </h3>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{breakdown.note}</p>
        </div>
      )}
    </section>
  )
}
