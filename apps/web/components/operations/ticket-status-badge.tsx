import { Badge } from "@/components/ui/badge"
import type { TicketPriority, TicketStatus } from "@/lib/operations-data"

/**
 * A ticket's status, as a badge.                              Owner: W3-E
 *
 * Colour never carries the meaning on its own. Every badge states its status in
 * words, because roughly one man in twelve cannot separate the amber from the
 * green, and because a screenshot in a status report keeps the text and loses
 * everything else.
 *
 * Labels arrive as a prop rather than being read from the catalogue here: this
 * renders inside table rows, and a component that fetches its own translations
 * per row is one `getTranslations` call per row.
 */

export type TicketStatusLabels = Record<TicketStatus, string>
export type TicketPriorityLabels = Record<TicketPriority, string>

/**
 * `cancelled` is `muted`, not `destructive`. A cancelled ticket is a closed
 * matter, not an alarm; painting it red puts the loudest thing on the screen on
 * the row that needs the least attention.
 */
const variantByStatus: Record<
  TicketStatus,
  "muted" | "outline" | "default" | "secondary" | "stale" | "confirmed"
> = {
  draft: "outline",
  open: "default",
  assigned: "secondary",
  in_progress: "secondary",
  blocked: "stale",
  resolved: "confirmed",
  closed: "muted",
  cancelled: "muted",
}

export function TicketStatusBadge({
  status,
  labels,
}: {
  status: TicketStatus
  labels: TicketStatusLabels
}) {
  return <Badge variant={variantByStatus[status]}>{labels[status]}</Badge>
}

const variantByPriority: Record<
  TicketPriority,
  "muted" | "outline" | "stale" | "destructive"
> = {
  low: "muted",
  normal: "outline",
  high: "stale",
  urgent: "destructive",
}

export function TicketPriorityBadge({
  priority,
  labels,
}: {
  priority: TicketPriority
  labels: TicketPriorityLabels
}) {
  return <Badge variant={variantByPriority[priority]}>{labels[priority]}</Badge>
}
