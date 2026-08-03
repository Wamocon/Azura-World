"use server"

import { revalidatePath } from "next/cache"
import { getTranslations } from "next-intl/server"
import { z } from "zod"

import { getUserProfile } from "@/lib/auth"
import { locales, type Locale, type Role } from "@/lib/contracts"
import { isSupabaseConfigured } from "@/lib/env"
import { writeAuditEvent, type AuditOutcome } from "@/lib/governance-audit"
import { getProfiles } from "@/lib/governance-repository"
import { hasPermission } from "@/lib/rbac"
import {
  asBoolean,
  asNullableNumber,
  asNullableString,
  asRecord,
} from "@/lib/repository-base"
import { createClient, type ServerSupabaseClient } from "@/lib/supabase/server"

import {
  activationAuditAction,
  countOtherActiveAdmins,
  decideActivationChange,
  decideProfileDeletion,
  decideRoleChange,
  refusalStatus,
  roleChangeAuditAction,
  roleChangeAuditPayload,
  type AdminCensus,
  type GovernanceRefusal,
  type RoleChangeActor,
  type RoleChangeSubject,
} from "./role-policy"

/**
 * Role assignment, activation, and the refusal to delete.        Owner: W3-F
 *
 * `tasks/W3-F`: *"Role assignment is the most sensitive action in the system."*
 * This file is deliberately thin. Every rule lives in `./role-policy.ts`, which
 * is pure and therefore executable by `scripts/governance-probe.mts`; this shell
 * resolves the caller, counts the administrators, obeys the decision, and
 * records it.
 *
 * ## The order, and why each step is where it is
 *
 *   1. resolve the caller          — who is asking
 *   2. read the directory          — how many administrators exist
 *   3. DECIDE                      — pure, tested, in `role-policy.ts`
 *   4. audit the decision          — including refusals
 *   5. write, only if permitted    — through the CALLER's client, so RLS agrees
 *
 * **Step 4 precedes step 5.** An attempt that is refused never reaches a write,
 * so if auditing came last, refusals would go unrecorded — and a trail that
 * records only what succeeded cannot show you somebody probing the boundary.
 *
 * ## Two clients, on purpose
 *
 * The profile update runs on the **caller's** session client, so Postgres
 * re-decides it: `profiles_admin_write` requires `is_admin()`, and
 * `prevent_profile_privilege_escalation()` sits on the table as well. An
 * application bug here cannot promote anyone, because RLS would still refuse.
 *
 * The audit insert runs on the **service-role** client, because `authenticated`
 * holds no INSERT on `audit_events` by design (a session that can write the
 * ledger can forge its own history). That is the one legitimate use of the key
 * on this path, and it happens after the decision, never before it.
 *
 * ## What this cannot do without a database
 *
 * Every refusal is real in any mode, because a refusal writes nothing. A
 * *permitted* change needs a `profiles` table, so with Supabase unconfigured it
 * returns `unavailable` and says so. It never reports a saved role that is not
 * saved (OVERNIGHT-2 §4.6).
 *
 * ## A permitted change is still not a saved change
 *
 * The decision above says the product allows this. Postgres then gets its own
 * turn, and it has four distinguishable answers — the last-admin trigger, a
 * privilege refusal, a value it will not store, and zero rows matched. They are
 * kept apart by `classifyWriteError` / `faultState` below, because collapsing
 * them sends the administrator to fix the wrong thing. Until migration 21 the
 * second of those was the *only* answer this page ever got.
 */

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export type UserAdminState =
  | { status: "idle" }
  /** The decision said no. `httpStatus` is what an HTTP surface would return. */
  | {
      status: "refused"
      refusal: GovernanceRefusal
      httpStatus: number
      message: string
    }
  | { status: "invalid"; message: string }
  /** No data plane. Nothing was written. */
  | { status: "unavailable"; message: string }
  /**
   * The change landed and its log entry did not. Retryable, and reported as
   * neither success nor failure — `tasks/W3-F` requires this state to exist
   * rather than be collapsed into one of its neighbours.
   */
  | { status: "incomplete"; message: string }
  | { status: "saved"; message: string }

const localeSchema = z.enum(locales)

const roleChangeSchema = z.strictObject({
  locale: localeSchema,
  subjectId: z.string().trim().uuid("That is not a user id."),
  // NOT `z.enum(roles)`. An unknown role must reach the decision so that the
  // decision refuses it — validating it away here would make the ordering in
  // `decideRoleChange` untestable through this action.
  role: z.string().trim().min(1).max(32),
})

const activationSchema = z.strictObject({
  locale: localeSchema,
  subjectId: z.string().trim().uuid("That is not a user id."),
  activate: z.enum(["true", "false"]),
})

async function refusalMessage(
  locale: Locale,
  refusal: GovernanceRefusal
): Promise<string> {
  const t = await getTranslations({ locale, namespace: "dashboard.users" })
  return t(`refusal.${refusal}`)
}

/**
 * Count administrators, or explain why we could not.
 *
 * `getProfiles` returns `RepositoryResult`, whose `source` distinguishes a real
 * read from the local seed. A seed-mode census is **not countable**: the seed's
 * eleven profiles describe a fixture, not the deployment, and permitting a
 * demotion on that basis would be deciding a production question with demo data.
 */
async function censusExcluding(
  subjectId: string,
  actorRole: RoleChangeActor["role"],
  actorProfileId: string | null
): Promise<AdminCensus> {
  if (!isSupabaseConfigured()) {
    return {
      countable: false,
      reason:
        "There is no database in this build, so the account list is a fixture.",
    }
  }

  try {
    const result = await getProfiles({
      role: actorRole,
      ...(actorProfileId === null ? {} : { profileId: actorProfileId }),
      subjectRole: "admin",
      isActive: true,
      limit: 500,
    })

    if (result.source !== "supabase") {
      return {
        countable: false,
        reason: "The account list could not be read from the database.",
      }
    }

    const directory: RoleChangeSubject[] = result.data.map((profile) => ({
      id: profile.id,
      role: profile.role,
      isActive: profile.isActive,
    }))

    return {
      countable: true,
      otherActiveAdmins: countOtherActiveAdmins(directory, subjectId),
    }
  } catch {
    return {
      countable: false,
      reason: "The account list could not be read.",
    }
  }
}

/**
 * Map an audit outcome onto the caller-visible result of a *completed* change.
 *
 * A change that happened without its log entry is reported as `incomplete`, not
 * as saved. The user is told both halves: what changed, and that the record of
 * it is missing. Collapsing this into "Saved" is the failure `tasks/W3-F` names.
 */
async function stateForAudit(
  locale: Locale,
  outcome: AuditOutcome,
  savedMessage: string
): Promise<UserAdminState> {
  if (outcome.status === "recorded") {
    return { status: "saved", message: savedMessage }
  }

  const users = await getTranslations({ locale, namespace: "dashboard.users" })
  const admin = await getTranslations({ locale, namespace: "dashboard.admin" })
  return {
    status: "incomplete",
    message: `${users("auditIncomplete")} ${admin(`auditReason.${outcome.reason}`)}`,
  }
}

// ---------------------------------------------------------------------------
// The write, and the four things Postgres can answer
// ---------------------------------------------------------------------------

/**
 * Why `42501` is read here rather than borrowed from the repository layer.
 *
 * `lib/repository-base.ts` → `toApiError()` maps `42501` to
 * `{ code: "forbidden", message: "You do not have access to this data." }`, and
 * `lib/admin-capability-rules.ts` → `mapProfileWriteError()` maps it to
 * *"Only an administrator can change a person's role, company or active state."*
 * For a **read** the first is right: RLS declined to show a row, and saying so
 * discloses nothing about whether the row exists. For **this write** both are
 * false statements with consequences.
 *
 * Everything that decides whether this caller may change this person has already
 * run — authentication, `users:manage`, separation of duties, the last-admin
 * census, all in `role-policy.ts`, all before a statement is sent. Only a caller
 * the product has already permitted reaches the UPDATE. So a `42501` coming back
 * from it is not the authorisation decision arriving late. There are two ways to
 * produce one, and neither is answered by the administrator asking for rights
 * they already hold:
 *
 *  - **the table GRANT is missing.** This is what actually happened.
 *    `authenticated` held `SELECT` and nothing else on `profiles`, so Postgres
 *    raised 42501 *before* `profiles_admin_write` was ever evaluated, and both
 *    controls on this page failed for every administrator who ever pressed them.
 *    Migration 21 (`grant update on public.profiles to authenticated`) is the fix
 *    and has been applied.
 *  - **`prevent_profile_privilege_escalation` fired** (migration 01 §5, `raise …
 *    using errcode = '42501'`), which means Postgres's `is_admin()` disagrees
 *    with the role this application resolved for the caller.
 *
 * Both are configuration faults an operator repairs, so 42501 gets its own
 * message naming the database as the refuser, and it never reaches the `refused`
 * arm of `UserAdminState`. That arm is reserved for `GovernanceRefusal` — the
 * set of decisions this product made and can explain.
 *
 * `AZLAD` is the opposite case and is why the two must not share a branch.
 * `enforce_last_admin_survives()` (migration 15 §2) is a governance rule, it is
 * *scoped per company* while `decideRoleChange`'s census is global, and so it can
 * legitimately refuse a change the application census permitted. That one is a
 * decision, and it is reported as the `last_admin` refusal it is.
 */

/** SQLSTATE off a PostgREST error object. Untrusted input; never interpolated. */
function sqlState(error: unknown): string {
  if (typeof error !== "object" || error === null) return ""
  const code = (error as { code?: unknown }).code
  return typeof code === "string" ? code : ""
}

type ProfileWriteFault =
  /** `AZLAD` — the per-company last-administrator trigger. A decision. */
  | "last_admin"
  /** `42501` — the statement was refused. An operator fault, never the user's. */
  | "privilege"
  /** A value the schema will not store. */
  | "rejected"
  /** The UPDATE matched no row and the row is still there: the version moved. */
  | "stale"
  /**
   * The UPDATE matched no row and neither does a plain read: the account was
   * deleted, or RLS stopped showing it to this reader.
   *
   * Split from `stale` because the two need opposite things from the operator.
   * "Somebody else changed this account, check the list and repeat" is useful
   * advice after a lost race and actively misleading when the account is gone —
   * the list will not show it, and the operator repeats an action that can
   * never succeed. Distinguishing them costs one SELECT, which is cheap on a
   * path that has already failed.
   */
  | "subject_missing"
  /** Reached the database and got something none of the above explains. */
  | "faulted"

function classifyWriteError(error: unknown): ProfileWriteFault {
  switch (sqlState(error)) {
    case "AZLAD":
      return "last_admin"
    case "42501":
      return "privilege"
    // foreign_key / not_null / check / invalid_parameter_value.
    case "23503":
    case "23502":
    case "23514":
    case "22023":
      return "rejected"
    default:
      return "faulted"
  }
}

/**
 * One fault to one caller-visible state.
 *
 * `last_admin` leaves as a `refused`, carrying the same 409 and the same sentence
 * the application's own census would have produced, so an administrator cannot
 * tell — and does not need to tell — which of the two guards stopped them. Every
 * other fault leaves as `unavailable` or `invalid`: something other than the
 * caller's rights has to change before the write can succeed.
 */
async function faultState(
  locale: Locale,
  fault: ProfileWriteFault
): Promise<UserAdminState> {
  if (fault === "last_admin") {
    return {
      status: "refused",
      refusal: "last_admin",
      httpStatus: refusalStatus.last_admin,
      message: await refusalMessage(locale, "last_admin"),
    }
  }

  const t = await getTranslations({ locale, namespace: "dashboard.users" })
  switch (fault) {
    case "privilege":
      return { status: "unavailable", message: t("privilegeFault") }
    case "stale":
      return { status: "invalid", message: t("staleWrite") }
    case "subject_missing":
      return { status: "invalid", message: t("subjectMissing") }
    case "rejected":
      return { status: "invalid", message: t("writeRejected") }
    default:
      return { status: "unavailable", message: t("writeFailed") }
  }
}

/**
 * The stored row as the database currently holds it, plus its concurrency token.
 *
 * `getProfiles` cannot supply this. `PROFILE_COLUMNS` in
 * `lib/governance-repository.ts` does not select `version` and `ProfileRecord`
 * has no field for it, so `profiles.version` — added by migration 15 precisely
 * because "the one field standing between two admins overwriting each other's
 * role change was validated for shape and then compared against nothing" — was
 * unreachable from this action. Reading it here is the only way to reach it
 * without writing into a file this task does not own.
 */
interface ProfileWriteTarget {
  role: string | null
  isActive: boolean
  version: number
}

type ProfileTargetRead =
  | { status: "read"; target: ProfileWriteTarget }
  /** No row came back: it is gone, or RLS does not show it to this caller. */
  | { status: "gone" }
  | { status: "fault"; fault: ProfileWriteFault }

async function readWriteTarget(
  client: ServerSupabaseClient,
  subjectId: string
): Promise<ProfileTargetRead> {
  const response = await client
    .from("profiles")
    .select("role, is_active, version")
    .eq("id", subjectId)
    .maybeSingle()

  if (response.error !== null) {
    return { status: "fault", fault: classifyWriteError(response.error) }
  }

  const row = asRecord(response.data)
  if (Object.keys(row).length === 0) return { status: "gone" }

  const version = asNullableNumber(row["version"])
  if (version === null) {
    // `version integer not null default 1`. A null means the column is not
    // there, i.e. migration 15 has not been applied — and guarding an UPDATE on
    // a version we did not read is guarding on nothing, which is worse than
    // refusing, because it reads as protection.
    return { status: "fault", fault: "faulted" }
  }

  return {
    status: "read",
    target: {
      role: asNullableString(row["role"]),
      isActive: asBoolean(row["is_active"]),
      version,
    },
  }
}

/**
 * Apply the patch under optimistic concurrency, and believe only the rows.
 *
 * `.eq("version", expectedVersion)` is part of the WHERE clause rather than a
 * comparison made in this process, so the window between reading the row and
 * writing it is closed rather than narrowed; `bump_profiles_version` moves the
 * column on every UPDATE, so the guard is real.
 *
 * `.select("id")` is not decoration. An UPDATE that matches no row — a lost
 * concurrency race, or a row RLS will not admit — comes back from PostgREST with
 * **no error at all**. Without the returned rows this function would report a
 * saved role for a statement that changed nothing, which is the one thing this
 * project forbids outright.
 */
async function applyProfileWrite(
  client: ServerSupabaseClient,
  subjectId: string,
  patch: Record<string, unknown>,
  expectedVersion: number
): Promise<{ applied: true } | { applied: false; fault: ProfileWriteFault }> {
  const response = await client
    .from("profiles")
    .update(patch)
    .eq("id", subjectId)
    .eq("version", expectedVersion)
    .select("id")

  if (response.error !== null) {
    return { applied: false, fault: classifyWriteError(response.error) }
  }

  const rows: unknown = response.data
  if (!Array.isArray(rows) || rows.length === 0) {
    // PostgREST reports no error for an UPDATE that matched nothing, so this
    // branch covers two different situations and they need opposite advice.
    // One more read tells them apart: if the row is still visible, somebody
    // moved the version between the read and the write; if it is not, the
    // account is gone or RLS stopped showing it, and telling the operator to
    // "check the list and try again" would send them after a row that is not
    // in the list.
    const stillThere = await client
      .from("profiles")
      .select("id")
      .eq("id", subjectId)
      .maybeSingle()
    return {
      applied: false,
      fault: stillThere.data === null ? "subject_missing" : "stale",
    }
  }
  return { applied: true }
}

/**
 * Append a second ledger row when a permitted change did not land.
 *
 * The first row is written before the write is attempted, on purpose — that is
 * how refusals get recorded at all. The cost of that ordering is that a ledger
 * reader would otherwise see `users.role_change.elevated` for an elevation that
 * never happened. This closes it from the other side: the decision stays
 * recorded, and the outcome is recorded next to it.
 */
async function recordUnappliedWrite(input: {
  action: string
  subjectId: string
  actorProfileId: string | null
  companyId: string | null | undefined
  before: Record<string, unknown>
  attempted: Record<string, unknown>
  fault: ProfileWriteFault
}): Promise<void> {
  await writeAuditEvent({
    action: `${input.action}.not_applied.${input.fault}`,
    entityTable: "profiles",
    entityId: input.subjectId,
    actorProfileId: input.actorProfileId,
    ...(input.companyId === undefined ? {} : { companyId: input.companyId }),
    beforeData: input.before,
    afterData: { ...input.attempted, applied: false },
  })
}

/**
 * The subject, read through the CALLER's client so a caller who may not see a
 * profile cannot learn its role by trying to change it.
 *
 * `getProfiles` **throws** when Supabase is configured and failing — that is
 * `withRepository`'s central rule, not an edge case — and an uncaught throw here
 * would surface as a generic action crash with no explanation. `ok: false` is
 * that case, and it is deliberately not the same as `row: null`: "I could not
 * read the directory" and "that person is not in it" lead to different next
 * actions, exactly as `AdminCensus` distinguishes them one layer down.
 */
interface SubjectRow {
  role: Role | null
  isActive: boolean
  companyId: string | null
}

async function findSubject(
  actorRole: Role,
  actorId: string | null,
  subjectId: string
): Promise<{ ok: true; row: SubjectRow | null } | { ok: false }> {
  try {
    const result = await getProfiles({
      role: actorRole,
      ...(actorId === null ? {} : { profileId: actorId }),
      limit: 500,
    })
    const found = result.data.find((entry) => entry.id === subjectId)
    return {
      ok: true,
      row:
        found === undefined
          ? null
          : {
              role: found.role,
              isActive: found.isActive,
              companyId: found.companyId,
            },
    }
  } catch {
    return { ok: false }
  }
}

/**
 * Answer a failed directory read without telling an unauthorised caller anything
 * about the state of the database.
 *
 * The read has to happen before the decision — the decision needs the subject —
 * so a raw "the directory could not be read" would reach callers
 * `decideRoleChange` was going to refuse anyway, and whether the database is
 * reachable is not something an anonymous request should be able to establish by
 * pressing a button. `role-policy.ts` puts authentication and `users:manage`
 * ahead of everything else for exactly this reason; this asks the same two
 * questions of the same permission matrix, and only a caller past both is told
 * what actually went wrong.
 *
 * The attempt is recorded either way, under the same action names
 * `roleChangeAuditAction` would have produced.
 */
async function abortedDirectoryRead(
  locale: Locale,
  actor: RoleChangeActor,
  base: "users.role_change" | "users.activation",
  subjectId: string,
  attempted: Record<string, unknown>
): Promise<UserAdminState> {
  const refusal: GovernanceRefusal | null = !actor.authenticated
    ? "not_authenticated"
    : hasPermission(actor.role, "users:manage")
      ? null
      : "not_permitted"

  const state: UserAdminState =
    refusal === null
      ? {
          status: "unavailable",
          message: (
            await getTranslations({ locale, namespace: "dashboard.users" })
          )("directoryUnreadable"),
        }
      : {
          status: "refused",
          refusal,
          httpStatus: refusalStatus[refusal],
          message: await refusalMessage(locale, refusal),
        }

  await writeAuditEvent({
    action:
      refusal === null
        ? `${base}.aborted.directory_unreadable`
        : `${base}.refused.${refusal}`,
    entityTable: "profiles",
    entityId: subjectId,
    actorProfileId: actor.id,
    beforeData: null,
    afterData: { ...attempted, applied: false },
  })

  return state
}

/**
 * The page this action changes. Without it the directory and the role-coverage
 * table keep rendering the values they were built with, so a successful change
 * would leave the administrator looking at the old role directly beneath a
 * message saying the new one was saved. Called only where something moved, or
 * where we have just learned the rendered values are stale.
 */
function refreshDirectory(locale: Locale): void {
  revalidatePath(`/${locale}/dashboard/users`)
}

// ---------------------------------------------------------------------------
// Role assignment
// ---------------------------------------------------------------------------

export async function assignRole(
  _previous: UserAdminState,
  formData: FormData
): Promise<UserAdminState> {
  const parsed = roleChangeSchema.safeParse({
    locale: formData.get("locale"),
    subjectId: formData.get("subjectId"),
    role: formData.get("role"),
  })

  // A malformed locale cannot be used to look up a message, so this one branch
  // carries an English fallback rather than a translated string.
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      status: "invalid",
      message: issue?.message ?? "That request is not valid.",
    }
  }

  const { locale, subjectId, role: requestedRole } = parsed.data
  const profile = await getUserProfile()

  const actor: RoleChangeActor = {
    id: profile.id,
    role: profile.role,
    authenticated: profile.authenticated,
  }

  const lookup = await findSubject(profile.role, actor.id, subjectId)
  if (!lookup.ok) {
    return abortedDirectoryRead(locale, actor, "users.role_change", subjectId, {
      requested_role: requestedRole,
    })
  }
  const subjectRow = lookup.row

  const subject: RoleChangeSubject = {
    id: subjectId,
    role: subjectRow?.role ?? null,
    isActive: subjectRow?.isActive ?? false,
  }

  const census = await censusExcluding(subjectId, profile.role, actor.id)
  const decision = decideRoleChange({
    actor,
    subject,
    requestedRole,
    census,
  })

  const payload = roleChangeAuditPayload(subject, requestedRole)
  const companyId = subjectRow === null ? undefined : subjectRow.companyId
  const auditPromise = writeAuditEvent({
    action: roleChangeAuditAction(decision),
    entityTable: "profiles",
    entityId: subjectId,
    actorProfileId: actor.id,
    ...(companyId === undefined ? {} : { companyId }),
    beforeData: payload.before,
    afterData: payload.after,
  })

  if (!decision.allowed) {
    await auditPromise
    return {
      status: "refused",
      refusal: decision.refusal,
      httpStatus: decision.status,
      message: await refusalMessage(locale, decision.refusal),
    }
  }

  const t = await getTranslations({ locale, namespace: "dashboard.users" })

  const client = await createClient()
  if (client === null) {
    await auditPromise
    return { status: "unavailable", message: t("unavailable") }
  }

  const target = await readWriteTarget(client, subjectId)
  if (target.status === "gone") {
    await auditPromise
    refreshDirectory(locale)
    return { status: "invalid", message: t("subjectMissing") }
  }
  if (target.status === "fault") {
    await auditPromise
    return faultState(locale, target.fault)
  }

  // The decision — including the last-administrator census — was taken against
  // the directory read further up. If the stored row no longer says what that
  // read said, the decision was about a state that no longer exists, and writing
  // it anyway would silently overwrite whoever got there first.
  //
  // `decision.from` rather than `subject.role`: past an allowed decision they are
  // the same value, and this one is a `Role`, so the comparison cannot be thrown
  // off by a stored enum value the application maps to `null`.
  if (
    target.target.role !== decision.from ||
    target.target.isActive !== subject.isActive
  ) {
    await auditPromise
    refreshDirectory(locale)
    return { status: "invalid", message: t("staleWrite") }
  }

  const write = await applyProfileWrite(
    client,
    subjectId,
    { role: decision.to },
    target.target.version
  )

  if (!write.applied) {
    await auditPromise
    await recordUnappliedWrite({
      action: "users.role_change",
      subjectId,
      actorProfileId: actor.id,
      companyId,
      before: payload.before,
      attempted: payload.after,
      fault: write.fault,
    })
    // Only a lost race means the rendered page is out of date; a privilege fault
    // changed nothing anywhere, and re-rendering would suggest otherwise.
    // Both faults mean the rendered list disagrees with the database — one
    // because somebody else moved the version, one because the row is gone.
    // Either way the operator must be looking at the stored truth before they
    // decide what to do next.
    if (write.fault === "stale" || write.fault === "subject_missing") {
      refreshDirectory(locale)
    }
    return faultState(locale, write.fault)
  }

  refreshDirectory(locale)
  return stateForAudit(locale, await auditPromise, t("roleSaved"))
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

/**
 * Deactivation revokes access; it does not delete history.
 *
 * The next request from a deactivated account fails closed without anything
 * further happening here: W1-B's `resolveSupabaseProfile` treats `is_active =
 * false` as no session at all, so the account resolves to the anonymous profile
 * and `lib/rbac.ts` proves at compile time that the anonymous role holds no
 * write permission anywhere.
 */
export async function setActivation(
  _previous: UserAdminState,
  formData: FormData
): Promise<UserAdminState> {
  const parsed = activationSchema.safeParse({
    locale: formData.get("locale"),
    subjectId: formData.get("subjectId"),
    activate: formData.get("activate"),
  })

  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      status: "invalid",
      message: issue?.message ?? "That request is not valid.",
    }
  }

  const { locale, subjectId } = parsed.data
  const activate = parsed.data.activate === "true"
  const profile = await getUserProfile()

  const actor: RoleChangeActor = {
    id: profile.id,
    role: profile.role,
    authenticated: profile.authenticated,
  }

  const lookup = await findSubject(profile.role, actor.id, subjectId)
  if (!lookup.ok) {
    return abortedDirectoryRead(locale, actor, "users.activation", subjectId, {
      is_active: activate,
    })
  }
  const subjectRow = lookup.row

  const subject: RoleChangeSubject = {
    id: subjectId,
    role: subjectRow?.role ?? null,
    isActive: subjectRow?.isActive ?? false,
  }

  const census = await censusExcluding(subjectId, profile.role, actor.id)
  const decision = decideActivationChange({ actor, subject, activate, census })

  const companyId = subjectRow === null ? undefined : subjectRow.companyId
  const auditPromise = writeAuditEvent({
    action: activationAuditAction(decision),
    entityTable: "profiles",
    entityId: subjectId,
    actorProfileId: actor.id,
    ...(companyId === undefined ? {} : { companyId }),
    beforeData: { is_active: subject.isActive },
    afterData: { is_active: activate },
  })

  if (!decision.allowed) {
    await auditPromise
    return {
      status: "refused",
      refusal: decision.refusal,
      httpStatus: decision.status,
      message: await refusalMessage(locale, decision.refusal),
    }
  }

  const t = await getTranslations({ locale, namespace: "dashboard.users" })

  const client = await createClient()
  if (client === null) {
    await auditPromise
    return { status: "unavailable", message: t("unavailable") }
  }

  const target = await readWriteTarget(client, subjectId)
  if (target.status === "gone") {
    await auditPromise
    refreshDirectory(locale)
    return { status: "invalid", message: t("subjectMissing") }
  }
  if (target.status === "fault") {
    await auditPromise
    return faultState(locale, target.fault)
  }

  // Only the two facts this decision rested on: the current activation state,
  // and whether the subject is an administrator (which is what put the census in
  // play). Comparing the role itself would report a false conflict for an account
  // holding a stored enum value the application maps to `null` — that account can
  // still legitimately be blocked.
  if (
    target.target.isActive !== subject.isActive ||
    (target.target.role === "admin") !== (subject.role === "admin")
  ) {
    await auditPromise
    refreshDirectory(locale)
    return { status: "invalid", message: t("staleWrite") }
  }

  const write = await applyProfileWrite(
    client,
    subjectId,
    { is_active: activate },
    target.target.version
  )

  if (!write.applied) {
    await auditPromise
    await recordUnappliedWrite({
      action: "users.activation",
      subjectId,
      actorProfileId: actor.id,
      companyId,
      before: { is_active: subject.isActive },
      attempted: { is_active: activate },
      fault: write.fault,
    })
    // Both faults mean the rendered list disagrees with the database — one
    // because somebody else moved the version, one because the row is gone.
    // Either way the operator must be looking at the stored truth before they
    // decide what to do next.
    if (write.fault === "stale" || write.fault === "subject_missing") {
      refreshDirectory(locale)
    }
    return faultState(locale, write.fault)
  }

  refreshDirectory(locale)
  return stateForAudit(
    locale,
    await auditPromise,
    activate ? t("activated") : t("deactivated")
  )
}

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------

/**
 * Always refused.
 *
 * It exists so the answer is a stated policy rather than a missing button, and
 * so an HTTP surface added later has something to call. `audit_events`
 * references `profiles` with `on delete restrict` specifically to make hard
 * deletion of an account that has acted impossible at the database level too.
 */
export async function deleteProfile(
  _previous: UserAdminState,
  formData: FormData
): Promise<UserAdminState> {
  const locale = localeSchema.safeParse(formData.get("locale"))
  const decision = decideProfileDeletion()

  return {
    status: "refused",
    refusal: decision.refusal,
    httpStatus: decision.status,
    message: locale.success
      ? await refusalMessage(locale.data, decision.refusal)
      : "Accounts are deactivated, never deleted.",
  }
}
