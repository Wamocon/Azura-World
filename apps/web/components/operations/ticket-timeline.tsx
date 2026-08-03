import { Badge } from "@/components/ui/badge"
import type { Locale } from "@/lib/contracts"
import { formatDateTime } from "@/lib/format"
import type { TicketEvent, TicketEventKind } from "@/lib/operations-data"

/**
 * The append-only history of one ticket.                      Owner: W3-E
 *
 * `ticket_events` cannot be updated or deleted: migration 06 carries no UPDATE
 * or DELETE policy at any role level, and a trigger raises 42501 on both. So
 * this list is the ticket's actual biography, and a correction to it is a
 * further entry rather than an edit. It is rendered oldest first, because a
 * history read newest-first invites you to stop after the first line.
 *
 * A move that carried a reason shows the reason. Those are exactly the moves
 * the workflow marks `requiresNote`: a hold, a rejection, a reopening, a
 * cancellation. Every one of them is a decision somebody will want explained
 * later, which is why the note is mandatory at the point it is made and printed
 * in full here rather than truncated behind a control.
 */

export type TicketEventKindLabels = Record<TicketEventKind, string>

const emphatic: readonly TicketEventKind[] = [
  "escalated",
  "sla_breached",
  "reopened",
  "cancelled",
]

export function TicketTimeline({
  events,
  locale,
  kindLabels,
  statusLabels,
  actorFallback,
  actorNames,
  selfProfileId,
  selfLabel,
  emptyLabel,
  transitionLabel,
}: {
  events: readonly TicketEvent[]
  locale: Locale
  kindLabels: TicketEventKindLabels
  statusLabels: Record<string, string>
  /** Shown when `actor_profile_id` is null, e.g. a system-raised SLA breach. */
  actorFallback: string
  /** Readable names by profile id. Empty when the caller may not read the
   *  directory — a resident, for instance. */
  actorNames?: ReadonlyMap<string, string>
  selfProfileId?: string | null
  /** What to call the reader themselves, e.g. "You". */
  selfLabel?: string
  emptyLabel: string
  /** `(from, to) => "Offen zu Zugewiesen"`, localised by the caller. */
  transitionLabel: (from: string, to: string) => string
}) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }

  return (
    <ol className="flex flex-col gap-0">
      {events.map((event, index) => {
        const from =
          event.fromStatus === null ? null : statusLabels[event.fromStatus]
        const to = event.toStatus === null ? null : statusLabels[event.toStatus]
        return (
          <li
            key={event.id}
            className="relative flex gap-3 pb-4 pl-4 last:pb-0"
          >
            {/* The rail. Drawn with a border rather than a pseudo-element so it
                survives forced-colors mode, and stopped on the last item so the
                list does not appear to continue past its end. */}
            <span
              aria-hidden="true"
              className={
                index === events.length - 1
                  ? "absolute top-2 left-0 h-2 w-px bg-border"
                  : "absolute top-2 bottom-0 left-0 w-px bg-border"
              }
            />
            <span
              aria-hidden="true"
              className="absolute top-1.5 left-[-3px] size-[7px] rounded-full bg-border"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={emphatic.includes(event.kind) ? "stale" : "muted"}
                >
                  {kindLabels[event.kind]}
                </Badge>
                {from !== undefined &&
                from !== null &&
                to !== undefined &&
                to !== null ? (
                  <span className="text-sm text-foreground">
                    {transitionLabel(from, to)}
                  </span>
                ) : null}
                <time
                  dateTime={event.createdAt}
                  className="text-xs text-muted-foreground tabular-nums"
                >
                  {formatDateTime(event.createdAt, locale)}
                </time>
              </div>
              <p className="text-xs text-muted-foreground">
                {/* A person, never a UUID. A resident cannot read the
                    directory, so an unnamed actor falls back to the neutral
                    label rather than leaking an internal identifier. */}
                {event.actorProfileId === null
                  ? actorFallback
                  : event.actorProfileId === selfProfileId
                    ? (selfLabel ?? actorFallback)
                    : (actorNames?.get(event.actorProfileId) ?? actorFallback)}
              </p>
              {event.note === null ? null : (
                // Plain text in a text node. Never dangerouslySetInnerHTML: a
                // note can contain anything an operator typed, and React's
                // escaping is the only thing between that and the page.
                <p className="max-w-prose text-sm whitespace-pre-wrap text-foreground">
                  {event.note}
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
