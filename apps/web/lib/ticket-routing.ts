/**
 * # Ticket routing — which team owns which kind of work
 *
 * Owned by **W3-E**. Pure functions over the ticket's own fields: no clock, no
 * database, no randomness. The same ticket routes the same way on the server,
 * in the browser and in a test, which is what makes a routing decision
 * something an operator can argue with.
 *
 * Routing **proposes**; a dispatcher disposes. Every decision here is a
 * suggestion the UI presents with its reason attached, and
 * {@link overrideRouting} records the override rather than replacing it, so the
 * history shows both what the rules said and what the human did.
 *
 * ## Scope, honestly
 *
 * The site has no published staffing roster and `supabase/seed.sql` seeds no
 * staff members against teams, so this module routes to a **team**, not to a
 * person, unless the caller supplies candidates. {@link selectAssignee} is the
 * person-level half and it takes its candidate list as an argument for exactly
 * that reason: inventing a duty roster would be inventing data.
 */

import type {
  TicketCategory,
  TicketPriority,
  TicketSeverity,
} from "@/lib/operations-data"

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

/**
 * The operational teams a ticket can land on.
 *
 * `[I]` Not a harvested fact. No Azura World or Cebeci Group source publishes a
 * departmental structure, so this is a conventional resort-operations split
 * chosen by this window. It is never presented to a user as sourced.
 */
export const opsTeams = [
  "maintenance",
  "housekeeping",
  "security",
  "technical",
  "facilities",
  "front_office",
  "finance_desk",
] as const

export type OpsTeam = (typeof opsTeams)[number]

/**
 * Category → team. **Exhaustive over `TicketCategory` by type**, not by a
 * default branch: adding a category to the enum without routing it becomes a
 * compile error here rather than a ticket that silently lands on the front desk.
 */
const teamByCategory: Record<TicketCategory, OpsTeam> = {
  maintenance: "maintenance",
  cleaning: "housekeeping",
  security: "security",
  technical: "technical",
  amenity: "facilities",
  billing: "finance_desk",
  concierge: "front_office",
  inspection: "maintenance",
  complaint: "front_office",
  // The genuine unknown. Front office is the triage desk, so an unclassified
  // ticket reaches a human who can reclassify it, rather than a queue nobody
  // watches.
  other: "front_office",
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export interface RoutingInput {
  category: TicketCategory
  priority: TicketPriority
  severity: TicketSeverity
  /** Carried through so a multi-site deployment can scope the candidate list. */
  siteId?: string | null
}

export type EscalationReason = "critical_severity" | "urgent_priority" | null

export interface RoutingDecision {
  team: OpsTeam
  /**
   * Whether a duty manager is notified alongside the team. Escalation does not
   * change the team — the work is still the work — it adds a watcher.
   */
  escalate: boolean
  escalationReason: EscalationReason
  /** The category the decision was made from, so the UI can show its working. */
  matchedCategory: TicketCategory
  /** Set only by {@link overrideRouting}. */
  overriddenFrom?: OpsTeam
}

/**
 * Route a ticket to a team.
 *
 * Severity and priority are separate escalation triggers because they answer
 * different questions: severity is how bad the thing is, priority is how fast
 * someone decided to react. Either alone is enough to want a manager watching,
 * and `critical` is reported first because it is the more informative reason.
 */
export function routeTicket(input: RoutingInput): RoutingDecision {
  const escalationReason: EscalationReason =
    input.severity === "critical"
      ? "critical_severity"
      : input.priority === "urgent"
        ? "urgent_priority"
        : null

  return {
    team: teamByCategory[input.category],
    escalate: escalationReason !== null,
    escalationReason,
    matchedCategory: input.category,
  }
}

/**
 * Record a dispatcher's manual override.
 *
 * Returns a new decision keeping `overriddenFrom`, so the ticket history can
 * state "routing proposed housekeeping, dispatcher chose maintenance" instead
 * of losing the proposal. Overriding to the team already chosen is a no-op
 * rather than a self-referential record.
 */
export function overrideRouting(
  decision: RoutingDecision,
  team: OpsTeam
): RoutingDecision {
  if (team === decision.team) return decision
  return { ...decision, team, overriddenFrom: decision.team }
}

// ---------------------------------------------------------------------------
// Assignee selection
// ---------------------------------------------------------------------------

export interface RoutingCandidate {
  profileId: string
  displayName: string
  team: OpsTeam
  /**
   * A deactivated or deleted profile. The brief requires assignment to one to
   * be refused with a stated reason, so this is a first-class field rather than
   * something the caller is trusted to have filtered out.
   */
  active: boolean
  /** Open tickets already on this person. Drives least-loaded selection. */
  openTicketCount: number
}

export type AssigneeRejection =
  "unknown_profile" | "inactive_profile" | "wrong_team"

export type AssigneeDecision =
  | { assignable: true; candidate: RoutingCandidate }
  | { assignable: false; reason: AssigneeRejection }

/**
 * Whether a specific person may take a specific decision's work.
 *
 * `wrong_team` is a rejection rather than a warning: routing exists to put work
 * in front of the people who can do it, and a dispatcher who genuinely wants
 * someone from another team calls {@link overrideRouting} first, which leaves a
 * record. Silently permitting the cross-team assignment would lose that record.
 */
export function validateAssignee(
  profileId: string,
  decision: RoutingDecision,
  candidates: readonly RoutingCandidate[]
): AssigneeDecision {
  const candidate = candidates.find((entry) => entry.profileId === profileId)
  if (candidate === undefined) {
    return { assignable: false, reason: "unknown_profile" }
  }
  if (!candidate.active) {
    return { assignable: false, reason: "inactive_profile" }
  }
  if (candidate.team !== decision.team) {
    return { assignable: false, reason: "wrong_team" }
  }
  return { assignable: true, candidate }
}

/**
 * The auto-assignment: the least-loaded active member of the routed team.
 *
 * Ties break on `profileId`, ascending. That is not arbitrary tidiness — an
 * unstable tie-break makes the same ticket route to different people on two
 * renders of the same page, and the second render silently contradicts the
 * first. Returns `null` when the team has nobody available, which the UI shows
 * as an unassigned ticket rather than parking it on someone unsuitable.
 */
export function selectAssignee(
  decision: RoutingDecision,
  candidates: readonly RoutingCandidate[]
): RoutingCandidate | null {
  const eligible = candidates
    .filter((candidate) => candidate.active && candidate.team === decision.team)
    .sort(
      (a, b) =>
        a.openTicketCount - b.openTicketCount ||
        (a.profileId < b.profileId ? -1 : a.profileId > b.profileId ? 1 : 0)
    )
  return eligible[0] ?? null
}
