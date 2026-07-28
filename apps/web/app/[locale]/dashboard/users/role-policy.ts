/**
 * Who may change whose role, and what a system must never be allowed to become.
 *                                                              Owner: W3-F
 *
 * ## Why this is a separate, pure module
 *
 * Everything here is a **decision**: no I/O, no `next/headers`, no Supabase, no
 * `"use server"`. That is deliberate and it is the same split W1-B made for
 * `lib/auth-resolution.ts`, for the same reason — a `"use server"` module cannot
 * be imported by a plain Node harness, so an authorisation rule that lives
 * inside one can only ever be *reviewed*, never *executed* by a test.
 *
 * `tasks/W3-F` requires evidence, not assurance, for "self-elevation → 403" and
 * "demote the last admin → rejected". `scripts/governance-probe.mts` imports
 * this file directly and runs both. `actions.ts` is then a thin shell: resolve
 * the profile, read the directory, call `decideRoleChange`, obey it.
 *
 * ## The two rules that outrank convenience
 *
 * 1. **Nobody changes their own role.** Not upward, not sideways, not downward.
 *    The brief only forbids self-*elevation*, and this is stricter on purpose
 *    (SYSTEM-PROMPT §0 permits stricter, never looser): a self-demotion by the
 *    only administrator is how rule 2 gets violated through the front door, and
 *    "you may lower your own role but not raise it" is a rule whose edge a
 *    reviewer has to think about every time it is read. `separationOfDuties`
 *    is one sentence and has no edge.
 *
 * 2. **The last active administrator is immovable.** Not demotable, not
 *    deactivatable, not deletable. A deployment with zero administrators cannot
 *    grant anyone the right to fix it — `users:manage` is `admin`-only in the
 *    permission matrix, so the recovery path runs through the very role that was
 *    just removed. The only remaining route is direct database access, which in
 *    a managed Supabase project means the service-role key, which is exactly the
 *    credential this system is built to avoid needing.
 *
 * ## Counting administrators is the subtle part
 *
 * The count that matters is **active** administrators **other than the subject**.
 * Counting the subject makes every demotion look safe (there is always at least
 * one admin: the one being demoted). Counting inactive administrators makes a
 * deactivated account look like a recovery path it is not — a deactivated admin
 * cannot sign in, so it cannot promote anyone.
 *
 * A directory that could not be read is **not** an empty directory.
 * `AdminCensus` therefore has an explicit `countable: false` arm, and an
 * uncountable census refuses the change rather than assuming the fleet is
 * healthy. Fail closed: the cost of a wrong refusal is one retry, the cost of a
 * wrong permit is an unrecoverable system.
 */

import { roleLevel, type Role } from "@/lib/contracts"
import { hasPermission, isValidRole } from "@/lib/rbac"

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The person asking. Shaped like the fields of `UserProfile` this needs. */
export interface RoleChangeActor {
  id: string | null
  role: Role
  authenticated: boolean
}

/** The person being changed. */
export interface RoleChangeSubject {
  id: string
  role: Role | null
  isActive: boolean
}

/**
 * How many other administrators would remain.
 *
 * A discriminated union rather than `number | null`, because "0 admins" and "I
 * could not count the admins" must not be the same value at a call site that
 * writes `if (count > 0)`. The `unavailable` arm carries its reason so the
 * refusal message can say *why* rather than only *no*.
 */
export type AdminCensus =
  | { countable: true; otherActiveAdmins: number }
  | { countable: false; reason: string }

/**
 * Count the active administrators in `directory` other than `excludeProfileId`.
 *
 * `role` is `Role | null` because `governance-repository.ts` maps an unknown SQL
 * enum value to `null` rather than defaulting it (schema drift must not silently
 * become a role). A `null` role is **not** counted as an administrator: an
 * unrecognised role is not a proven recovery path.
 */
export function countOtherActiveAdmins(
  directory: readonly RoleChangeSubject[],
  excludeProfileId: string
): number {
  return directory.filter(
    (entry) =>
      entry.id !== excludeProfileId && entry.isActive && entry.role === "admin"
  ).length
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

/**
 * Why a governance write was refused.
 *
 * Each maps to one HTTP status and one message. They are kept apart rather than
 * collapsed into `"forbidden"` because a user who is told "you cannot do this"
 * and a user who is told "this would leave the system with no administrator"
 * take completely different next actions.
 */
export type GovernanceRefusal =
  /** No session. → 401. */
  | "not_authenticated"
  /** Authenticated, role lacks `users:manage`. → 403. */
  | "not_permitted"
  /** The actor is the subject, and the change raises their level. → 403. */
  | "self_elevation"
  /** The actor is the subject, and the change does not raise their level. → 403. */
  | "self_role_change"
  /** The requested role is not one of the eleven. → 422. */
  | "unknown_role"
  /** The subject's stored role is not one of the eleven. → 409. */
  | "unknown_subject_role"
  /** Requested role equals current role. → 200, nothing written. */
  | "no_change"
  /** Would leave zero active administrators. → 409. */
  | "last_admin"
  /** The directory could not be counted, so safety cannot be proven. → 503. */
  | "census_unavailable"
  /** Accounts are deactivated, never deleted. → 405. */
  | "deletion_not_supported"

/** HTTP status for a refusal. One place, so a route and an action agree. */
export const refusalStatus: Readonly<Record<GovernanceRefusal, number>> =
  Object.freeze({
    not_authenticated: 401,
    not_permitted: 403,
    self_elevation: 403,
    self_role_change: 403,
    unknown_role: 422,
    unknown_subject_role: 409,
    no_change: 200,
    last_admin: 409,
    census_unavailable: 503,
    deletion_not_supported: 405,
  })

export type RoleChangeDecision =
  | {
      allowed: true
      from: Role
      to: Role
      /** True when the new role outranks the old one. Drives the audit action name. */
      elevation: boolean
      /**
       * True when the target is `admin`. The brief asks us to *consider* a second
       * approval for elevation to `admin`; this is that consideration made
       * explicit rather than left as a comment. See `actions.ts` for what the
       * flag currently causes, and the handoff for what it does not.
       */
      requiresSecondApproval: boolean
    }
  | { allowed: false; refusal: GovernanceRefusal; status: number }

function refuse(refusal: GovernanceRefusal): RoleChangeDecision {
  return { allowed: false, refusal, status: refusalStatus[refusal] }
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

/**
 * Decide a role assignment.
 *
 * **Order is the security property.** Authentication, then authorisation, then
 * separation of duties, then shape, then the system-integrity rules. Validating
 * the requested role before checking permission would let an unauthorised caller
 * map the role enum by watching which values produce which complaint; checking
 * the admin census before separation of duties would let a non-admin discover
 * how many administrators exist.
 */
export function decideRoleChange(input: {
  actor: RoleChangeActor
  subject: RoleChangeSubject
  requestedRole: unknown
  census: AdminCensus
}): RoleChangeDecision {
  const { actor, subject, requestedRole, census } = input

  // 1. Authentication.
  if (!actor.authenticated) return refuse("not_authenticated")

  // 2. Authorisation. `users:manage` is admin-only in the frozen matrix; this
  //    asks the matrix rather than naming the role (CONTRACTS §8), so a future
  //    matrix edit moves this gate without touching this file.
  if (!hasPermission(actor.role, "users:manage")) return refuse("not_permitted")

  // 3. Separation of duties. An actor with no resolvable id cannot be proven
  //    *not* to be the subject, so it is treated as if it were: fail closed.
  const isSelf = actor.id === null || actor.id === subject.id
  if (isSelf) {
    const target = isValidRole(requestedRole) ? requestedRole : null
    const raises =
      target !== null &&
      subject.role !== null &&
      roleLevel[target] > roleLevel[subject.role]
    return refuse(raises ? "self_elevation" : "self_role_change")
  }

  // 4. Shape.
  if (!isValidRole(requestedRole)) return refuse("unknown_role")
  if (subject.role === null) return refuse("unknown_subject_role")
  if (subject.role === requestedRole) return refuse("no_change")

  // 5. System integrity. Only a change that moves an ACTIVE admin off `admin`
  //    can strand the system, so the census is consulted for exactly that case
  //    and not as a blanket tax on every assignment.
  const removesAnAdmin =
    subject.role === "admin" && requestedRole !== "admin" && subject.isActive
  if (removesAnAdmin) {
    if (!census.countable) return refuse("census_unavailable")
    if (census.otherActiveAdmins < 1) return refuse("last_admin")
  }

  return {
    allowed: true,
    from: subject.role,
    to: requestedRole,
    elevation: roleLevel[requestedRole] > roleLevel[subject.role],
    requiresSecondApproval: requestedRole === "admin",
  }
}

export type ActivationDecision =
  | { allowed: true; from: boolean; to: boolean }
  | { allowed: false; refusal: GovernanceRefusal; status: number }

/**
 * Decide an activation or deactivation.
 *
 * Deactivation is the project's account-removal mechanism — migration
 * `…0008_documents_compliance.sql` pins `audit_events.actor_profile_id` to
 * `on delete restrict` precisely so that an account that has acted cannot be
 * hard-deleted and take the record of its actions with it. So this never
 * deletes; it flips `is_active`, and the history stays.
 *
 * Self-deactivation is refused under the same separation-of-duties rule as a
 * self role change: an administrator locking themselves out is the same
 * unrecoverable state as demoting themselves, reached by a different door.
 */
export function decideActivationChange(input: {
  actor: RoleChangeActor
  subject: RoleChangeSubject
  activate: boolean
  census: AdminCensus
}): ActivationDecision {
  const { actor, subject, activate, census } = input

  if (!actor.authenticated) {
    return {
      allowed: false,
      refusal: "not_authenticated",
      status: refusalStatus.not_authenticated,
    }
  }
  if (!hasPermission(actor.role, "users:manage")) {
    return {
      allowed: false,
      refusal: "not_permitted",
      status: refusalStatus.not_permitted,
    }
  }
  if (actor.id === null || actor.id === subject.id) {
    return {
      allowed: false,
      refusal: "self_role_change",
      status: refusalStatus.self_role_change,
    }
  }
  if (subject.isActive === activate) {
    return {
      allowed: false,
      refusal: "no_change",
      status: refusalStatus.no_change,
    }
  }

  if (!activate && subject.role === "admin") {
    if (!census.countable) {
      return {
        allowed: false,
        refusal: "census_unavailable",
        status: refusalStatus.census_unavailable,
      }
    }
    if (census.otherActiveAdmins < 1) {
      return {
        allowed: false,
        refusal: "last_admin",
        status: refusalStatus.last_admin,
      }
    }
  }

  return { allowed: true, from: subject.isActive, to: activate }
}

/**
 * Deleting a profile.
 *
 * Always refused, and this function exists so that the refusal is a *decision
 * with a reason* rather than a missing feature somebody adds later without
 * reading the migration comment. There is no UI path to it either.
 */
export function decideProfileDeletion(): {
  allowed: false
  refusal: GovernanceRefusal
  status: number
} {
  return {
    allowed: false,
    refusal: "deletion_not_supported",
    status: refusalStatus.deletion_not_supported,
  }
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/**
 * The audit action name for a decision.
 *
 * **Refusals are audited too.** A trail that records only successful changes
 * cannot tell you that somebody spent an afternoon trying to promote themselves,
 * which is the single most interesting thing an audit trail could tell you about
 * this module.
 */
export function roleChangeAuditAction(decision: RoleChangeDecision): string {
  if (!decision.allowed) return `users.role_change.refused.${decision.refusal}`
  return decision.elevation
    ? "users.role_change.elevated"
    : "users.role_change.reduced"
}

export function activationAuditAction(decision: ActivationDecision): string {
  if (!decision.allowed) return `users.activation.refused.${decision.refusal}`
  return decision.to
    ? "users.activation.activated"
    : "users.activation.deactivated"
}

/**
 * The `before_data` / `after_data` pair for a role change.
 *
 * Column-level, never the whole row: the migration's own comment on
 * `audit_events.before_data` says *"Store the changed columns, not the whole
 * payload"*, and a profile row carries an email address and a phone number that
 * have no business being copied into a ledger on every role edit.
 */
export function roleChangeAuditPayload(
  subject: RoleChangeSubject,
  requestedRole: unknown
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  return {
    before: { role: subject.role },
    after: { role: isValidRole(requestedRole) ? requestedRole : null },
  }
}
