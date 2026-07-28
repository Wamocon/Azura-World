/**
 * # Ticket lifecycle — one transition table, no scattered `if`s
 *
 * Owned by **W3-E**. This file is the single authority on which ticket status
 * may follow which, and who may perform the move. The UI **derives** its
 * buttons from {@link allowedTransitions}; it never hardcodes a button, so a
 * surface cannot offer a move the machine forbids, and adding an edge here adds
 * the button everywhere at once.
 *
 * ## The states are the database's, not the brief's
 *
 * `tasks/W3-E-modules-operations.md` describes the lifecycle with the names
 * `new · triaged · awaiting_parts · verified · reopened · rejected`. **None of
 * those exist in the database.** `public.ticket_status`
 * (`supabase/migrations/00000000000006_operations.sql:50`) is a Postgres enum
 * with exactly eight members:
 *
 *     draft · open · assigned · in_progress · blocked · resolved · closed · cancelled
 *
 * `updateTicketStatus()` writes that column, so a table built on the brief's
 * vocabulary would be rejected by Postgres on the first transition — a state
 * machine that typechecks and cannot run. The migration is W1-A's file and
 * `CONTRACTS.md` is frozen, so the enum is a fact this window works with rather
 * than around.
 *
 * The lifecycle survives the translation because the brief's extra names are
 * **edges, not states**, and `public.ticket_event_kind` already carries the
 * verbs (`reopened`, `cancelled`, `escalated`, `resolved`, `closed`):
 *
 * | Brief            | Here                                   |
 * | ---------------- | -------------------------------------- |
 * | `new`            | `draft` — raised, not yet submitted    |
 * | `triaged`        | `open` — in the queue, categorised     |
 * | `assigned`       | `assigned`                             |
 * | `in_progress`    | `in_progress`                          |
 * | `awaiting_parts` | `blocked` — the hold reason is on the event |
 * | `resolved`       | `resolved`                             |
 * | `verified`       | **no state** — folded into `verify_and_close`, which needs `tickets:approve` |
 * | `closed`         | `closed`                               |
 * | `reopened`       | edge `resolved`/`closed` → `assigned`, event kind `reopened` |
 * | `rejected`       | edge `open` → `cancelled`, reason mandatory |
 *
 * `verified` is the one genuine loss: resolution and verification collapse into
 * a single privileged edge, so the interval between "the engineer says it is
 * fixed" and "the manager agrees" is not a queryable state. HANDOFF/W3-E.md
 * carries the migration W1-A would need to restore it.
 *
 * ## Authority comes from RBAC, never from a list in this file
 *
 * Each edge declares a {@link Permission}, and {@link canTransition} answers by
 * asking `hasPermission()`. A hand-maintained `roles: Role[]` on each edge would
 * be a second copy of the permission matrix, and the copy that drifts is always
 * the one further from `lib/rbac.ts`. The practical consequence is that the
 * matrix already encodes the brief's approval steps:
 *
 *  - `tickets:assign` — manager, admin. Only they route work.
 *  - `tickets:update` — manager, staff, service_provider, admin. A contractor
 *    can start, hold, resume and resolve their own work and can do nothing else.
 *  - `tickets:approve` — manager, **owner**, admin. This is the brief's owner
 *    approval step: closing a resolved ticket, and rejecting one at triage, are
 *    the two moves an owner can make.
 *  - `tickets:delete` — manager, admin. Cancelling live work is not a
 *    contractor's call.
 *
 * ## The API is the boundary, not this file
 *
 * Deriving the buttons from the table means the UI cannot *offer* an invalid
 * move. It does not mean an invalid move cannot *arrive* — a hand-written
 * request can carry any pair. {@link canTransition} returns a discriminated
 * union carrying the legal alternatives precisely so a route handler can answer
 * 409 and name them.
 */

import type { Permission, Role } from "@/lib/contracts"
import { hasPermission } from "@/lib/rbac"
import {
  terminalTicketStatuses,
  ticketStatuses,
  type ServiceTicket,
  type TicketEventKind,
  type TicketPriority,
  type TicketStatus,
} from "@/lib/operations-data"

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/**
 * Stable identifiers for the edges. These are the brief's verbs, and they are
 * what the message catalogue keys off (`dashboard.tickets.transitions.*`), so a
 * status rename in a future migration does not silently retranslate a button.
 */
export const transitionIds = [
  "submit",
  "assign",
  "start",
  "hold",
  "resume",
  "resolve",
  "verify_and_close",
  "reopen",
  "reopen_closed",
  "reject",
  "cancel",
  "discard_draft",
] as const

export type TransitionId = (typeof transitionIds)[number]

/**
 * What an edge means for the person reading the button, independent of which
 * status it lands on. Drives the visual treatment: an operator scanning a
 * ticket should be able to tell a destructive move from a routine one before
 * reading the label.
 */
export type TransitionIntent =
  | "advance" // the ordinary forward move
  | "hold" // work stops, ticket stays alive
  | "resume" // work restarts
  | "reopen" // a finished ticket comes back
  | "reject" // refused at triage, never worked
  | "cancel" // abandoned after work began

export interface TicketTransition {
  id: TransitionId
  from: TicketStatus
  to: TicketStatus
  /** Checked against `lib/rbac.ts`. The only source of authority. */
  permission: Permission
  /** Written to `ticket_events.kind` by the caller performing the move. */
  eventKind: TicketEventKind
  intent: TransitionIntent
  /**
   * A move that ends or interrupts work must say why. The note lands in the
   * append-only history, which is the only place that survives to explain a
   * decision six months later.
   */
  requiresNote: boolean
}

/**
 * **The transition table.** Every legal status move in the product is a row
 * here; nothing else is legal anywhere.
 *
 * Deliberately a flat list of edges rather than a `Record<from, to[]>`: an edge
 * carries a permission, an event kind and a note requirement, and several
 * statuses share the same cancel edge. A nested map would either duplicate that
 * payload per source status or push it into a second lookup that can disagree
 * with the first.
 */
export const ticketTransitions: readonly TicketTransition[] = Object.freeze([
  // -- intake ---------------------------------------------------------------
  {
    id: "submit",
    from: "draft",
    to: "open",
    permission: "tickets:create",
    eventKind: "status_changed",
    intent: "advance",
    requiresNote: false,
  },
  {
    id: "discard_draft",
    from: "draft",
    to: "cancelled",
    permission: "tickets:create",
    eventKind: "cancelled",
    intent: "reject",
    // A draft nobody submitted has no history worth explaining. Demanding a
    // reason to throw away your own unsent draft is friction with no reader.
    requiresNote: false,
  },

  // -- triage ---------------------------------------------------------------
  {
    id: "assign",
    from: "open",
    to: "assigned",
    permission: "tickets:assign",
    eventKind: "assigned",
    intent: "advance",
    requiresNote: false,
  },
  {
    // The brief's `rejected`, from the brief's `triaged`. Refused before any
    // work happened, and the requester is owed the reason.
    id: "reject",
    from: "open",
    to: "cancelled",
    permission: "tickets:approve",
    eventKind: "cancelled",
    intent: "reject",
    requiresNote: true,
  },

  // -- execution ------------------------------------------------------------
  {
    id: "start",
    from: "assigned",
    to: "in_progress",
    permission: "tickets:update",
    eventKind: "status_changed",
    intent: "advance",
    requiresNote: false,
  },
  {
    // The brief's `awaiting_parts`. The reason is mandatory because "blocked"
    // with no cause is the status that quietly ages past its SLA.
    id: "hold",
    from: "in_progress",
    to: "blocked",
    permission: "tickets:update",
    eventKind: "status_changed",
    intent: "hold",
    requiresNote: true,
  },
  {
    id: "resume",
    from: "blocked",
    to: "in_progress",
    permission: "tickets:update",
    eventKind: "status_changed",
    intent: "resume",
    requiresNote: false,
  },
  {
    id: "resolve",
    from: "in_progress",
    to: "resolved",
    permission: "tickets:update",
    eventKind: "resolved",
    intent: "advance",
    requiresNote: false,
  },

  // -- verification and closure --------------------------------------------
  {
    // The brief's `verified` → `closed`, collapsed. `tickets:approve` is the
    // separation that matters: manager, owner and admin hold it, and
    // service_provider does not, so the contractor who resolved a ticket cannot
    // also sign it off.
    id: "verify_and_close",
    from: "resolved",
    to: "closed",
    permission: "tickets:approve",
    eventKind: "closed",
    intent: "advance",
    requiresNote: false,
  },
  {
    id: "reopen",
    from: "resolved",
    to: "assigned",
    permission: "tickets:update",
    eventKind: "reopened",
    intent: "reopen",
    requiresNote: true,
  },
  {
    // Reopening something already closed is a heavier act than reopening a
    // resolution nobody signed off yet, so it needs the approval permission.
    id: "reopen_closed",
    from: "closed",
    to: "assigned",
    permission: "tickets:approve",
    eventKind: "reopened",
    intent: "reopen",
    requiresNote: true,
  },

  // -- abandonment ----------------------------------------------------------
  // Four rows rather than one many-source edge. Enumerated so that
  // `transitionsFrom` needs no special case and so that removing one source
  // status is a one-line change with no reachability argument attached.
  {
    id: "cancel",
    from: "open",
    to: "cancelled",
    permission: "tickets:delete",
    eventKind: "cancelled",
    intent: "cancel",
    requiresNote: true,
  },
  {
    id: "cancel",
    from: "assigned",
    to: "cancelled",
    permission: "tickets:delete",
    eventKind: "cancelled",
    intent: "cancel",
    requiresNote: true,
  },
  {
    id: "cancel",
    from: "in_progress",
    to: "cancelled",
    permission: "tickets:delete",
    eventKind: "cancelled",
    intent: "cancel",
    requiresNote: true,
  },
  {
    id: "cancel",
    from: "blocked",
    to: "cancelled",
    permission: "tickets:delete",
    eventKind: "cancelled",
    intent: "cancel",
    requiresNote: true,
  },
] as const satisfies readonly TicketTransition[])

/**
 * Statuses no edge leaves. Derived from the table rather than listed, so a
 * future edge out of `cancelled` cannot leave a stale constant behind claiming
 * it is a dead end.
 *
 * Note this is a **different** question from `terminalTicketStatuses` in
 * `operations-data.ts`, which asks whether the SLA clock still runs. `resolved`
 * stops the clock but is not terminal here: it can still be closed or reopened.
 */
export const closedOutStatuses: readonly TicketStatus[] = Object.freeze(
  ticketStatuses.filter(
    (status) =>
      !ticketTransitions.some((transition) => transition.from === status)
  )
)

// ---------------------------------------------------------------------------
// Queries over the table
// ---------------------------------------------------------------------------

/** Every edge leaving a status, ignoring who is asking. */
export function transitionsFrom(
  from: TicketStatus
): readonly TicketTransition[] {
  return ticketTransitions.filter((transition) => transition.from === from)
}

/**
 * The edge joining two statuses, or `null`. `null` means the pair is not in the
 * table at all — a different answer from "you may not do it", which is why
 * {@link canTransition} distinguishes them.
 */
export function findTransition(
  from: TicketStatus,
  to: TicketStatus
): TicketTransition | null {
  return (
    ticketTransitions.find(
      (transition) => transition.from === from && transition.to === to
    ) ?? null
  )
}

/**
 * **What the UI renders.** Every edge out of `from` that `role` may actually
 * perform.
 *
 * A move the role lacks the permission for is *absent*, never present and
 * disabled. A disabled button advertises an operation and its own refusal at
 * the same time, and W3-B made the same call for bulk actions in `DataTable`.
 */
export function allowedTransitions(
  from: TicketStatus,
  role: Role
): readonly TicketTransition[] {
  return transitionsFrom(from).filter((transition) =>
    hasPermission(role, transition.permission)
  )
}

export type TransitionDenialReason =
  /** `from === to`. Not a move; usually a double-submitted form. */
  | "same_status"
  /** Nothing leaves this status. */
  | "terminal"
  /** The pair is not an edge of the machine. */
  | "no_such_transition"
  /** The edge exists and this role may not walk it. */
  | "role_not_permitted"

export type TransitionDecision =
  | { allowed: true; transition: TicketTransition }
  | {
      allowed: false
      reason: TransitionDenialReason
      /** Statuses this role could legally move to instead. Sent in the 409. */
      allowedTo: readonly TicketStatus[]
      /** Statuses *anyone* could move to, so the message can distinguish
       *  "not from here" from "not by you". */
      reachableTo: readonly TicketStatus[]
    }

/**
 * The one question the whole module asks. Returns a union rather than a boolean
 * because a refusal has to be explainable: the route handler answers 409 and
 * lists `allowedTo`, and the UI re-renders against the ticket's real status.
 */
export function canTransition(
  from: TicketStatus,
  to: TicketStatus,
  role: Role
): TransitionDecision {
  const reachableTo = transitionsFrom(from).map((transition) => transition.to)
  const allowedTo = allowedTransitions(from, role).map(
    (transition) => transition.to
  )
  const deny = (reason: TransitionDenialReason): TransitionDecision => ({
    allowed: false,
    reason,
    allowedTo,
    reachableTo,
  })

  if (from === to) return deny("same_status")
  if (reachableTo.length === 0) return deny("terminal")

  const transition = findTransition(from, to)
  if (transition === null) return deny("no_such_transition")
  if (!hasPermission(role, transition.permission)) {
    return deny("role_not_permitted")
  }
  return { allowed: true, transition }
}

/**
 * Whether a note must accompany the move. Separate from {@link canTransition}
 * because it is a validation question, not an authorisation one: the caller may
 * be entitled to the move and still be sending an incomplete request, and those
 * are a 422 and a 403 respectively.
 */
export function transitionRequiresNote(
  from: TicketStatus,
  to: TicketStatus
): boolean {
  return findTransition(from, to)?.requiresNote ?? false
}

// ---------------------------------------------------------------------------
// SLA
// ---------------------------------------------------------------------------

/**
 * Hours from report to due-by, per priority.
 *
 * `[I]` These are this window's choice, not a harvested figure: no published
 * Azura World or Cebeci Group source states a service-level target, and
 * inventing a citation for one would be worse than owning the assumption. They
 * are a plausible resort-operations ladder and nothing on screen presents them
 * as sourced.
 */
export const slaHoursByPriority: Record<TicketPriority, number> = Object.freeze(
  {
    urgent: 4,
    high: 24,
    normal: 72,
    low: 168,
  }
)

/** The due-by instant a ticket reported at `reportedAt` would carry. */
export function slaDueAt(reportedAt: string, priority: TicketPriority): string {
  const reported = new Date(reportedAt)
  if (Number.isNaN(reported.getTime())) return reportedAt
  const hours = slaHoursByPriority[priority]
  return new Date(reported.getTime() + hours * 3_600_000).toISOString()
}

export type SlaState =
  /** Terminal, or the row carries no due-by at all. No clock to run. */
  | "none"
  | "on_track"
  /** Inside the last quarter of the window. */
  | "due_soon"
  | "breached"

export interface SlaAssessment {
  state: SlaState
  /** Negative once breached. `null` when there is no clock. */
  msRemaining: number | null
  /** Whole hours the ticket has been open. `null` if `reportedAt` is unusable. */
  ageHours: number | null
}

/**
 * Where a ticket stands against its SLA.
 *
 * `asOf` is a parameter and not `Date.now()` so the caller supplies one instant
 * for a whole list. Reading the clock per row makes a long list disagree with
 * itself, and makes the result untestable.
 */
export function assessSla(
  ticket: Pick<
    ServiceTicket,
    "slaDueAt" | "status" | "priority" | "reportedAt"
  >,
  asOf: string
): SlaAssessment {
  const now = new Date(asOf).getTime()
  const reported = new Date(ticket.reportedAt).getTime()
  const ageHours = Number.isNaN(reported)
    ? null
    : Math.max(0, Math.floor((now - reported) / 3_600_000))

  if (
    ticket.slaDueAt === null ||
    terminalTicketStatuses.includes(ticket.status)
  ) {
    return { state: "none", msRemaining: null, ageHours }
  }

  const due = new Date(ticket.slaDueAt).getTime()
  if (Number.isNaN(due) || Number.isNaN(now)) {
    return { state: "none", msRemaining: null, ageHours }
  }

  const msRemaining = due - now
  if (msRemaining < 0) return { state: "breached", msRemaining, ageHours }

  const windowMs = slaHoursByPriority[ticket.priority] * 3_600_000
  const state: SlaState =
    msRemaining <= windowMs * 0.25 ? "due_soon" : "on_track"
  return { state, msRemaining, ageHours }
}
