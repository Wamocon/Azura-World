import { conflict, forbidden, upstreamFailed } from "./api-errors"
import { roleLevel, type ApiError, type Role } from "./contracts"

/**
 * Admin capability — the decision core.                  Owner: W3-H / N5
 *
 * Pure. No Supabase client, no `server-only`, no I/O of any kind, so
 * `scripts/admin-capability-probe.mts` can import it directly and run the whole
 * table of cases past it in milliseconds. `lib/admin-capability.ts` is the half
 * that talks to Postgres and it imports everything below.
 *
 * The same split as `app/[locale]/report/report-text.ts` and its probe, for the
 * same reason: a rule that can only be exercised through a route handler, a
 * session and a database is a rule that will be exercised once.
 *
 * ## These are mirrors, not the boundary
 *
 * `supabase/migrations/00000000000015_admin_capability.sql` holds the boundary.
 * Everything here is a second copy of a rule Postgres already enforces, and it
 * exists so the administrator reads a sentence rather than `SQLSTATE AZLAD`.
 * `lastAdminVerdict` is written to mirror `enforce_last_admin_survives()` clause
 * for clause. If the two ever disagree, Postgres wins: this refusal is advisory
 * and the trigger's is final.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The three columns migration 01 §5 and migration 15 §3 both treat as authority. */
export interface AuthorityState {
  role: Role
  isActive: boolean
  companyId: string | null
}

/** One row of the admin population, as the guard needs to see it. */
export interface AdminPopulationRow {
  id: string
  role: Role
  isActive: boolean
  companyId: string | null
}

export type LastAdminOutcome =
  /** The subject was never part of the admin population. */
  | "not_an_admin"
  /** Still an active admin of the same company afterwards. */
  | "population_unchanged"
  /** Leaves the population, and somebody else is still there. */
  | "another_admin_remains"
  /** Leaves the population, and nobody else is there. Refuse. */
  | "would_orphan_company"

export interface LastAdminVerdict {
  outcome: LastAdminOutcome
  allowed: boolean
  /** How many OTHER active admins share the subject's company. */
  remainingElsewhere: number
}

export interface AuthorityChangeClassification {
  /** Any of role / isActive / companyId actually moved. */
  isAuthorityChange: boolean
  /** The actor is the subject. True for a self-demotion as well. */
  actorIsSubject: boolean
  /** Actor is subject AND the new role outranks the old one. */
  isSelfElevation: boolean
  roleLevelBefore: number
  roleLevelAfter: number
}

// ---------------------------------------------------------------------------
// Guard 1 — the last administrator
// ---------------------------------------------------------------------------

/**
 * `null` company and `null` company group together, and neither groups with a
 * real id. SQL's `is not distinct from` in one function, so the two
 * implementations compare the same way. A bare `===` would treat two NULL
 * companies as different and the guard would never fire for platform-level
 * admins; a `==` would treat `null` and `undefined` as the same, which is a
 * different bug.
 */
function sameCompany(a: string | null, b: string | null): boolean {
  return a === null && b === null ? true : a === b
}

/**
 * Mirror of `public.enforce_last_admin_survives()`.
 *
 * Scoped per company for the reason the migration states: every admin is in
 * exactly one bucket, so keeping every bucket non-empty also keeps the global
 * population non-empty, and the reverse does not hold.
 *
 * `after === null` means DELETE.
 *
 * The population is expected to contain only *active* admins, but the filter is
 * applied again here anyway. The caller reads it with `.eq("is_active", true)`,
 * and a guard that trusts its input to have been filtered correctly is a guard
 * that fails open the day somebody passes an unfiltered list.
 */
export function lastAdminVerdict(input: {
  population: readonly AdminPopulationRow[]
  subjectId: string
  before: AuthorityState
  after: AuthorityState | null
}): LastAdminVerdict {
  const { population, subjectId, before, after } = input

  const wasActiveAdmin = before.role === "admin" && before.isActive
  if (!wasActiveAdmin) {
    return { outcome: "not_an_admin", allowed: true, remainingElsewhere: 0 }
  }

  const staysActiveAdmin =
    after !== null &&
    after.role === "admin" &&
    after.isActive &&
    sameCompany(after.companyId, before.companyId)

  if (staysActiveAdmin) {
    return {
      outcome: "population_unchanged",
      allowed: true,
      remainingElsewhere: 0,
    }
  }

  const others = population.filter(
    (row) =>
      row.id !== subjectId &&
      row.role === "admin" &&
      row.isActive &&
      sameCompany(row.companyId, before.companyId)
  ).length

  return others === 0
    ? { outcome: "would_orphan_company", allowed: false, remainingElsewhere: 0 }
    : {
        outcome: "another_admin_remains",
        allowed: true,
        remainingElsewhere: others,
      }
}

// ---------------------------------------------------------------------------
// Guard 2 — self-elevation is named, not blocked
// ---------------------------------------------------------------------------

/**
 * Mirror of the classification inside `record_profile_authority_change()`.
 *
 * W-UX §5 is explicit that self-elevation is **not blocked**, so nothing here
 * returns a refusal. It exists so the route can put the same flag in its
 * response that the trigger puts in the audit row: an admin who elevates
 * themselves is told, in the response, that the action was recorded. Being
 * quietly logged and being told you were logged are different products.
 *
 * A self-*demotion* is an authority change and is recorded, but is not flagged.
 * It is not the event the guard exists to catch, and flagging it would bury the
 * events that matter under routine ones.
 */
export function classifyAuthorityChange(input: {
  actorId: string | null
  subjectId: string
  before: AuthorityState
  after: AuthorityState
}): AuthorityChangeClassification {
  const { actorId, subjectId, before, after } = input

  const isAuthorityChange =
    before.role !== after.role ||
    before.isActive !== after.isActive ||
    !sameCompany(before.companyId, after.companyId)

  const actorIsSubject = actorId !== null && actorId === subjectId
  const roleLevelBefore = roleLevel[before.role] ?? 0
  const roleLevelAfter = roleLevel[after.role] ?? 0

  return {
    isAuthorityChange,
    actorIsSubject,
    isSelfElevation: actorIsSubject && roleLevelAfter > roleLevelBefore,
    roleLevelBefore,
    roleLevelAfter,
  }
}

// ---------------------------------------------------------------------------
// Postgres outcomes to sentences
// ---------------------------------------------------------------------------

/** Shape of a PostgREST error. Every field optional — it is untrusted input. */
interface PostgrestErrorish {
  code?: unknown
}

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null
  const code = (error as PostgrestErrorish).code
  return typeof code === "string" ? code : null
}

/**
 * Postgres outcome to a displayable `ApiError`.
 *
 * **No Postgres message ever reaches the caller.** Every branch returns a string
 * written here, and the driver's own `message` and `details` are discarded
 * without being read — a database message can carry a column name, a constraint
 * name or a fragment of another user's data. `scrubInternals` exists for the
 * cases that slip through; this function's job is that none do.
 *
 * W-UX §4 also applies: no codes in user-facing text. The caller is told what
 * happened and what to do instead, never `23503`.
 *
 * | SQLSTATE | Meaning | Answer |
 * |---|---|---|
 * | `AZLAD` | last-admin guard (migration 15) | 409, naming what to do first |
 * | `23503` | FK `on delete restrict` | 409, naming deactivation |
 * | `42501` | RLS, or the escalation trigger | 403 |
 * | `23505` | unique violation on email | 409 |
 * | anything else | unknown | 502, "Nothing was saved" |
 */
export function mapProfileWriteError(error: unknown): ApiError {
  switch (errorCode(error)) {
    case "AZLAD":
      return conflict(
        "This is the last active administrator. Removing administrator rights here would leave nobody able to manage users, so nothing was changed. Give another person administrator rights first, then repeat this change."
      )
    case "23503":
      // profiles.id is referenced by audit_events.actor_profile_id with
      // `on delete restrict`. Migration 08 calls that deliberate: losing the
      // ledger is not an acceptable way to satisfy an erasure request. So a
      // profile that has ever acted cannot be hard-deleted, by design, and the
      // honest answer names the alternative rather than reporting a failure.
      return conflict(
        "This person has already acted in the system, so their record cannot be deleted without also deleting the history of what they did. Set the account to inactive instead. An inactive account cannot sign in, and the record of past actions stays intact."
      )
    case "42501":
      return forbidden(
        "Only an administrator can change a person's role, company or active state."
      )
    case "23505":
      return conflict("A person with that email address already exists.")
    default:
      return upstreamFailed("The change could not be saved. Nothing was saved.")
  }
}
