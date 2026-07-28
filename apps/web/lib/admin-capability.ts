import "server-only"

import {
  classifyAuthorityChange,
  lastAdminVerdict,
  mapProfileWriteError,
  type AdminPopulationRow,
  type AuthorityChangeClassification,
  type AuthorityState,
} from "./admin-capability-rules"
import { createClient } from "./supabase/server"
import { conflict, forbidden, upstreamFailed } from "./api-errors"
import type { ApiError, Role } from "./contracts"
import type { ProfileRecord } from "./governance-data"

export * from "./admin-capability-rules"

/**
 * Admin capability — the user-management write paths.       Owner: W3-H / N5
 *
 * W-UX §5: "an administrator can do anything, without a developer". Until
 * tonight `POST` and `PATCH` on `/api/site-management/users` both carried a
 * declared `writeGap` and answered 503, so an admin could read the people
 * directory and change nothing in it. This module is the write half.
 *
 * ## Where the boundary actually is
 *
 * Not here. `supabase/migrations/00000000000015_admin_capability.sql` holds it:
 * `profiles_admin_write` (RLS) decides who may write, and two triggers decide
 * what the result may look like. Everything in this file is a **second** copy of
 * rules Postgres already enforces, and it exists for one reason — so the
 * administrator reads a sentence instead of `SQLSTATE AZLAD`.
 *
 * That duplication is deliberate and is the standard shape here (`safeNextPath`
 * validates in the page *and* in the action). It is only safe while the two
 * copies cannot disagree about the outcome, so `lastAdminVerdict` is written to
 * mirror `enforce_last_admin_survives()` clause for clause, and
 * `scripts/admin-capability-probe.mts` runs the same table of cases past it.
 * If they ever do disagree, Postgres wins: this module's refusal is advisory and
 * the trigger's is final.
 *
 * ## Why these calls use the CALLER's client, never the service role
 *
 * `createClient()` carries the caller's cookies, so:
 *
 *  - `profiles_admin_write` is evaluated. A non-admin who somehow reached this
 *    code writes nothing, and the RLS policy is a boundary rather than
 *    decoration.
 *  - `auth.uid()` is populated inside the trigger, so the audit row names a real
 *    actor. Under the service-role client `auth.uid()` is NULL and every
 *    authority change in the trail would read "actor unknown" — which would
 *    defeat guard 2 completely, since self-elevation is detected by comparing
 *    the actor to the subject.
 *
 * `createServiceRoleClient()` appears nowhere in this file on purpose.
 */

// ---------------------------------------------------------------------------
// The write paths
// ---------------------------------------------------------------------------

const PROFILE_COLUMNS =
  "id, email, full_name, role, phone, locale, company_id, is_active, avatar_url, created_at, updated_at, version"

/**
 * `ProfileRecord` plus the concurrency token.
 *
 * W2-A's `ProfileRecord` has no `version` because `profiles` had no such column
 * until migration 15 added it. Widening their interface would be a write into
 * `lib/governance-data.ts`, which is theirs; extending it here costs one line
 * and leaves every existing consumer untouched. The request to fold it in is in
 * HANDOFF/W3-H.md.
 */
export interface AdminProfileRecord extends ProfileRecord {
  version: number
}

/**
 * Thrown so `createHandler`'s catch turns it into the mapped error rather than a
 * generic 502. `RepositoryError` would be the natural vehicle, but it is
 * W2-A's and carries a repository name this module has no business claiming.
 */
export class AdminCapabilityError extends Error {
  readonly apiError: ApiError
  constructor(apiError: ApiError) {
    super(apiError.message)
    this.name = "AdminCapabilityError"
    this.apiError = apiError
  }
}

function mapRow(row: Record<string, unknown>): AdminProfileRecord {
  const role = row["role"]
  const version = row["version"]
  return {
    version: typeof version === "number" ? version : 1,
    id: String(row["id"] ?? ""),
    email: typeof row["email"] === "string" ? row["email"] : null,
    fullName: typeof row["full_name"] === "string" ? row["full_name"] : null,
    role: typeof role === "string" ? (role as Role) : null,
    phone: typeof row["phone"] === "string" ? row["phone"] : null,
    locale: typeof row["locale"] === "string" ? row["locale"] : "de",
    companyId: typeof row["company_id"] === "string" ? row["company_id"] : null,
    isActive: row["is_active"] === true,
    avatarUrl: typeof row["avatar_url"] === "string" ? row["avatar_url"] : null,
    createdAt: String(row["created_at"] ?? ""),
    updatedAt: String(row["updated_at"] ?? ""),
  }
}

/**
 * The admin population of one company, for the pre-flight guard.
 *
 * Read through the caller's client, so it sees exactly the rows RLS lets the
 * caller see. That is the conservative direction: if the caller cannot see the
 * other admins, the pre-flight refuses and the caller gets the plain-language
 * message — rather than passing and letting the trigger refuse in SQLSTATE.
 */
async function readAdminPopulation(
  client: NonNullable<Awaited<ReturnType<typeof createClient>>>,
  companyId: string | null
): Promise<AdminPopulationRow[]> {
  let query = client
    .from("profiles")
    .select("id, role, is_active, company_id")
    .eq("role", "admin")
    .eq("is_active", true)
  query =
    companyId === null
      ? query.is("company_id", null)
      : query.eq("company_id", companyId)

  const { data, error } = await query
  if (error !== null)
    throw new AdminCapabilityError(mapProfileWriteError(error))
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row["id"] ?? ""),
    role: (typeof row["role"] === "string" ? row["role"] : "guest") as Role,
    isActive: row["is_active"] === true,
    companyId: typeof row["company_id"] === "string" ? row["company_id"] : null,
  }))
}

async function requireClient(): Promise<
  NonNullable<Awaited<ReturnType<typeof createClient>>>
> {
  const client = await createClient()
  if (client === null) {
    // Unreachable through createHandler: `requiresPersistence` returns 503
    // before the handler runs. Kept because this module is importable, and a
    // future caller that forgets the declaration must not silently no-op.
    throw new AdminCapabilityError({
      code: "persistence_unavailable",
      message: "This change cannot be saved: the database is not configured.",
      retryable: true,
    })
  }
  return client
}

async function readProfile(
  client: NonNullable<Awaited<ReturnType<typeof createClient>>>,
  profileId: string
): Promise<AdminProfileRecord> {
  const { data, error } = await client
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", profileId)
    .maybeSingle()
  if (error !== null)
    throw new AdminCapabilityError(mapProfileWriteError(error))
  if (data === null) {
    // Same answer for "no such profile" and "outside your scope", for the
    // reason `getProfile` gives: telling a caller that a row it may not read
    // nevertheless exists is itself a disclosure.
    throw new AdminCapabilityError({
      code: "not_found",
      message: "No such person, or you cannot see them.",
      retryable: false,
    })
  }
  return mapRow(data as Record<string, unknown>)
}

export interface ProfileWriteOutcome {
  profile: AdminProfileRecord
  /** Present on an authority change, so the route can say it was recorded. */
  authority?: AuthorityChangeClassification
}

/**
 * Create a profile row.
 *
 * **This does not create a sign-in account.** `auth.users` is written by
 * Supabase Auth through the admin API, which needs the service-role key and an
 * email delivery path, and neither is configured in this project. So the honest
 * scope is: an admin creates the person's record and their role, and the person
 * gets a sign-in when Auth is wired. The route says so in its response rather
 * than implying an invitation was sent, and HANDOFF/W3-H.md §14 records it as
 * the one capability from W-UX §5 that is not fully closed.
 */
export async function createProfile(input: {
  email: string
  fullName: string
  role: Role
  companyId?: string | undefined
  language?: string | undefined
  actorCompanyId: string | null
}): Promise<ProfileWriteOutcome> {
  const client = await requireClient()

  const { data, error } = await client
    .from("profiles")
    .insert({
      email: input.email,
      full_name: input.fullName,
      role: input.role,
      company_id: input.companyId ?? input.actorCompanyId,
      locale: input.language ?? "de",
      is_active: true,
    })
    .select(PROFILE_COLUMNS)
    .maybeSingle()

  if (error !== null)
    throw new AdminCapabilityError(mapProfileWriteError(error))
  if (data === null) {
    throw new AdminCapabilityError(
      upstreamFailed("The person was not created. Nothing was saved.")
    )
  }
  return { profile: mapRow(data as Record<string, unknown>) }
}

/**
 * Change a profile's role, and/or its active state.
 *
 * The pre-flight guard runs before the write so the refusal is a sentence. The
 * trigger runs during the write regardless, so a race — two admins demoting each
 * other at the same moment — is still caught by Postgres, where it is
 * serialisable and here it is not.
 */
export async function updateProfileAuthority(input: {
  profileId: string
  actorId: string | null
  role?: Role | undefined
  isActive?: boolean | undefined
  expectedVersion: number
}): Promise<ProfileWriteOutcome> {
  const client = await requireClient()
  const before = await readProfile(client, input.profileId)

  const beforeState: AuthorityState = {
    role: before.role ?? "guest",
    isActive: before.isActive,
    companyId: before.companyId,
  }
  const afterState: AuthorityState = {
    role: input.role ?? beforeState.role,
    isActive: input.isActive ?? beforeState.isActive,
    companyId: beforeState.companyId,
  }

  const verdict = lastAdminVerdict({
    population: await readAdminPopulation(client, beforeState.companyId),
    subjectId: input.profileId,
    before: beforeState,
    after: afterState,
  })
  if (!verdict.allowed) {
    throw new AdminCapabilityError(mapProfileWriteError({ code: "AZLAD" }))
  }

  const patch: Record<string, unknown> = {}
  if (input.role !== undefined) patch["role"] = input.role
  if (input.isActive !== undefined) patch["is_active"] = input.isActive
  if (Object.keys(patch).length === 0) {
    return { profile: before }
  }

  const { data, error } = await client
    .from("profiles")
    .update(patch)
    // The concurrency check is part of the WHERE clause, not a comparison done
    // in this process. Reading the version and then updating on `id` alone
    // would leave the window between the two open, which is the exact race
    // `expectedVersion` exists to close.
    .eq("id", input.profileId)
    .eq("version", input.expectedVersion)
    .select(PROFILE_COLUMNS)
    .maybeSingle()

  if (error !== null)
    throw new AdminCapabilityError(mapProfileWriteError(error))
  if (data === null) {
    // Zero rows. Two causes, and they are distinguishable here because the row
    // was read a moment ago: a version mismatch means somebody else changed it
    // in between; anything else means RLS refused. PostgREST reports both as an
    // empty result rather than an error, so this branch is the only signal —
    // reporting success would be the fake-success failure this project exists
    // to avoid.
    throw new AdminCapabilityError(
      before.version !== input.expectedVersion
        ? conflict(
            "Somebody else changed this person's details while you were editing. Nothing was changed. Open the record again to see the current values, then repeat your change."
          )
        : forbidden("You cannot change this person's role.")
    )
  }

  return {
    profile: mapRow(data as Record<string, unknown>),
    authority: classifyAuthorityChange({
      actorId: input.actorId,
      subjectId: input.profileId,
      before: beforeState,
      after: afterState,
    }),
  }
}

/**
 * Delete a profile.
 *
 * Succeeds only for somebody who has never acted. `audit_events.actor_profile_id
 * references profiles(id) on delete restrict`, so Postgres refuses to delete an
 * actor and take their history with them. `mapProfileWriteError` turns that
 * 23503 into the sentence naming deactivation as the alternative.
 */
export async function deleteProfile(input: {
  profileId: string
  actorId: string | null
}): Promise<{ deletedId: string }> {
  const client = await requireClient()
  const before = await readProfile(client, input.profileId)

  const beforeState: AuthorityState = {
    role: before.role ?? "guest",
    isActive: before.isActive,
    companyId: before.companyId,
  }

  const verdict = lastAdminVerdict({
    population: await readAdminPopulation(client, beforeState.companyId),
    subjectId: input.profileId,
    before: beforeState,
    after: null,
  })
  if (!verdict.allowed) {
    throw new AdminCapabilityError(mapProfileWriteError({ code: "AZLAD" }))
  }

  const { data, error } = await client
    .from("profiles")
    .delete()
    .eq("id", input.profileId)
    .select("id")
    .maybeSingle()

  if (error !== null)
    throw new AdminCapabilityError(mapProfileWriteError(error))
  if (data === null) {
    throw new AdminCapabilityError(
      forbidden("You cannot delete this person's record.")
    )
  }
  return { deletedId: input.profileId }
}
