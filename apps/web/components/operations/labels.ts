import type { getTranslations } from "next-intl/server"

import {
  activityStatuses,
  mediaReportStatuses,
  ticketCategories,
  ticketEventKinds,
  ticketPriorities,
  ticketSeverities,
  ticketStatuses,
  type ActivityStatus,
  type MediaReportStatus,
  type TicketCategory,
  type TicketEventKind,
  type TicketPriority,
  type TicketSeverity,
  type TicketStatus,
} from "@/lib/operations-data"
import { transitionIds, type TransitionId } from "@/lib/ticket-workflow"
import type { SlaState } from "@/lib/ticket-workflow"
import type { DeliveryState } from "@/components/operations/delivery-notice"

/**
 * Label records for the operations modules.                   Owner: W3-E
 *
 * Built once per page and passed down, rather than each row component calling
 * `getTranslations` for itself. A translator lookup inside a table row is one
 * lookup per row per column.
 *
 * Every builder maps over the **enum**, not over a hand-written key list. A
 * status added to `operations-data.ts` therefore produces a missing-message
 * warning at the one place that renders it, instead of a silently absent badge.
 */

type Translator = Awaited<ReturnType<typeof getTranslations>>

/**
 * next-intl types a message key as a literal union drawn from the catalogue.
 * The keys here are assembled at runtime from the enum, so that union cannot be
 * proven and the typed call resolves its argument list to `never`.
 *
 * One cast, in one function, rather than at each of the eleven call sites. It is
 * not a `any`: the shape asserted is exactly what a translator is. A key that
 * does not exist still fails, at runtime, the way any missing message does.
 */
type LooseTranslator = (key: string) => string

function fromEnum<K extends string>(
  keys: readonly K[],
  t: Translator,
  prefix: string
): Record<K, string> {
  const translate = t as unknown as LooseTranslator
  const out = {} as Record<K, string>
  for (const key of keys) out[key] = translate(`${prefix}.${key}`)
  return out
}

export function ticketStatusLabels(
  t: Translator
): Record<TicketStatus, string> {
  return fromEnum(ticketStatuses, t, "status")
}

export function ticketPriorityLabels(
  t: Translator
): Record<TicketPriority, string> {
  return fromEnum(ticketPriorities, t, "priority")
}

export function ticketSeverityLabels(
  t: Translator
): Record<TicketSeverity, string> {
  return fromEnum(ticketSeverities, t, "severity")
}

export function ticketCategoryLabels(
  t: Translator
): Record<TicketCategory, string> {
  return fromEnum(ticketCategories, t, "category")
}

export function ticketEventKindLabels(
  t: Translator
): Record<TicketEventKind, string> {
  return fromEnum(ticketEventKinds, t, "eventKind")
}

export function transitionLabels(t: Translator): Record<TransitionId, string> {
  return fromEnum(transitionIds, t, "transitions")
}

const slaStates: readonly SlaState[] = [
  "none",
  "on_track",
  "due_soon",
  "breached",
]

export function slaLabels(t: Translator): Record<SlaState, string> {
  return fromEnum(slaStates, t, "sla")
}

export function activityStatusLabels(
  t: Translator
): Record<ActivityStatus, string> {
  return fromEnum(activityStatuses, t, "status")
}

export function mediaReportStatusLabels(
  t: Translator
): Record<MediaReportStatus, string> {
  return fromEnum(mediaReportStatuses, t, "reportStatus")
}

const deliveryStates: readonly DeliveryState[] = [
  "not_configured",
  "portal_only",
  "queued",
  "sent",
  "delivered",
  "failed",
  "internal_note",
]

export function deliveryLabels(t: Translator): Record<DeliveryState, string> {
  return fromEnum(deliveryStates, t, "delivery")
}
