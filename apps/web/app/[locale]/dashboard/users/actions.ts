"use server"

import { getTranslations } from "next-intl/server"
import { z } from "zod"

import { getUserProfile } from "@/lib/auth"
import { locales, type Locale } from "@/lib/contracts"
import { isSupabaseConfigured } from "@/lib/env"
import { writeAuditEvent, type AuditOutcome } from "@/lib/governance-audit"
import { getProfiles } from "@/lib/governance-repository"
import { createClient } from "@/lib/supabase/server"

import {
  activationAuditAction,
  countOtherActiveAdmins,
  decideActivationChange,
  decideProfileDeletion,
  decideRoleChange,
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

  // The subject is read through the CALLER's client, so a caller who may not see
  // a profile cannot learn its role by trying to change it.
  const subjectResult = await getProfiles({
    role: profile.role,
    ...(actor.id === null ? {} : { profileId: actor.id }),
    limit: 500,
  })
  const subjectRow = subjectResult.data.find((row) => row.id === subjectId)

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
  const auditPromise = writeAuditEvent({
    action: roleChangeAuditAction(decision),
    entityTable: "profiles",
    entityId: subjectId,
    actorProfileId: actor.id,
    ...(subjectRow?.companyId === undefined
      ? {}
      : { companyId: subjectRow.companyId }),
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

  const { error } = await client
    .from("profiles")
    .update({ role: decision.to })
    .eq("id", subjectId)

  if (error !== null) {
    await auditPromise
    // Never the raw Postgres text: `42501` from `profiles_admin_write` and a
    // constraint violation would both name internals in a UI string.
    return { status: "unavailable", message: t("writeFailed") }
  }

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

  const subjectResult = await getProfiles({
    role: profile.role,
    ...(actor.id === null ? {} : { profileId: actor.id }),
    limit: 500,
  })
  const subjectRow = subjectResult.data.find((row) => row.id === subjectId)

  const subject: RoleChangeSubject = {
    id: subjectId,
    role: subjectRow?.role ?? null,
    isActive: subjectRow?.isActive ?? false,
  }

  const census = await censusExcluding(subjectId, profile.role, actor.id)
  const decision = decideActivationChange({ actor, subject, activate, census })

  const auditPromise = writeAuditEvent({
    action: activationAuditAction(decision),
    entityTable: "profiles",
    entityId: subjectId,
    actorProfileId: actor.id,
    ...(subjectRow?.companyId === undefined
      ? {}
      : { companyId: subjectRow.companyId }),
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

  const { error } = await client
    .from("profiles")
    .update({ is_active: activate })
    .eq("id", subjectId)

  if (error !== null) {
    await auditPromise
    return { status: "unavailable", message: t("writeFailed") }
  }

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
