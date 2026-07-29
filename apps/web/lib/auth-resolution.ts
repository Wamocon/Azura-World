/**
 * The auth decision table, as pure functions.
 *
 * Everything in `lib/auth.ts` that decides *what role a caller gets* lives here
 * instead, with no I/O, no `next/headers`, no Supabase client and no `zod`.
 * `lib/auth.ts` performs the reads and hands the results to these functions.
 *
 * There is one reason for the split, and it is not tidiness: **the fail-closed
 * guarantees have to be executable proofs.** The two that matter most —
 * "authenticated with no profile row resolves to `tenant`, never `admin`" and
 * "an unknown access-profile cookie resolves to `manager`, not a crash" — are
 * assertions about a decision, not about a database. Kept inside a module that
 * statically imports `next/headers`, they could only be tested by standing up a
 * Next request, which in practice means they never get tested at all. Here they
 * are twelve lines of plain Node in `scripts/rbac-probe.mts`.
 *
 * Nothing in this file may acquire an import that needs a request context. If
 * that becomes necessary, the function belongs in `lib/auth.ts`, not here.
 */

import {
  resolveAccessProfileRole,
  type EnvironmentRecord,
} from "./access-profile-policy"
import { isValidRole, type RoleScope } from "./rbac"
import { hasPermission } from "./rbac"
import { roleLevel, type Locale, type Permission, type Role } from "./contracts"
import { roleScope } from "./rbac"

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/**
 * How the profile was resolved. Check this field first when debugging an
 * authorisation problem — it is the auth-layer analogue of
 * `RepositoryResult.source` (CONTRACTS §4), and it answers "is this a real user
 * or a QA profile?" without reading any code.
 */
export type ProfileSource = "supabase" | "access-profile" | "anonymous"

interface ProfileFields {
  id: string | null
  email: string | null
  fullName: string | null
  role: Role
  /** Every assigned role, highest authority first. Display and audit only. */
  roles: readonly Role[]
  isActive: boolean
  companyId: string | null
  phone: string | null
  locale: Locale | null
  avatarUrl: string | null
  /**
   * Set when the profile is less specific than it should have been — an absent
   * `profiles` table, an unreadable row, an unrecognised role value. Non-null
   * here means "this role was assigned defensively, not read".
   */
  degradedReason: string | null
}

/** A real session, or a QA access profile standing in for one. */
export interface AuthenticatedProfile extends ProfileFields {
  authenticated: true
  source: "supabase" | "access-profile"
  id: string
}

/** No session. Read-only `guest`, by construction. */
export interface AnonymousProfile extends ProfileFields {
  authenticated: false
  source: "anonymous"
  id: null
  email: null
  fullName: null
  role: "guest"
  isActive: false
}

export type UserProfile = AuthenticatedProfile | AnonymousProfile

/**
 * The single anonymous instance. Frozen so no caller can mutate a shared value.
 *
 * The role is `guest` rather than a nullable role because `lib/rbac.ts` proves
 * at compile time that `guest` holds no write permission on any resource. A
 * caller that forgets to check `authenticated` therefore still cannot mutate
 * anything — the fail-closed property is structural, not a rule to remember.
 */
export const ANONYMOUS_PROFILE: AnonymousProfile = Object.freeze({
  authenticated: false,
  source: "anonymous",
  id: null,
  email: null,
  fullName: null,
  role: "guest",
  roles: Object.freeze(["guest"] as const),
  isActive: false,
  companyId: null,
  phone: null,
  locale: null,
  avatarUrl: null,
  degradedReason: null,
})

// ---------------------------------------------------------------------------
// Access profile (QA only)
// ---------------------------------------------------------------------------

/** German display names — CONTRACTS §7 makes `de` the default locale. */
const accessProfileNames: Record<Role, string> = {
  admin: "QA · Administrator",
  manager: "QA · Objektleitung",
  accountant: "QA · Buchhaltung",
  staff: "QA · Technischer Dienst",
  owner: "QA · Eigentümer",
  tenant: "QA · Mieter",
  guest: "QA · Gast",
  service_provider: "QA · Dienstleister",
  child_owner: "QA · Eigentümer (Unterkonto)",
  child_tenant: "QA · Mieter (Unterkonto)",
  child_guest: "QA · Gast (Unterkonto)",
}

/** Stable synthetic id, so a QA profile is recognisable in any log line. */
export const ACCESS_PROFILE_ID = "00000000-0000-0000-0000-000000000000"

/**
 * Builds the QA profile from a cookie value.
 *
 * An unrecognised cookie does not throw and does not escalate: it falls through
 * to `ACCESS_PROFILE_ROLE` and finally to `manager`, and records why in
 * `degradedReason` so the substitution is visible rather than silent.
 */
export function buildAccessProfileFor(
  cookieValue: string | undefined,
  environment?: EnvironmentRecord
): AuthenticatedProfile {
  const role = resolveAccessProfileRole(cookieValue, environment)
  const recognised = isValidRole(cookieValue)

  return {
    authenticated: true,
    source: "access-profile",
    id: ACCESS_PROFILE_ID,
    email: "qa@azura.local",
    fullName: accessProfileNames[role],
    role,
    roles: [role],
    isActive: true,
    companyId: null,
    phone: null,
    locale: "de",
    avatarUrl: null,
    degradedReason:
      cookieValue !== undefined && !recognised
        ? `access_profile_role cookie held an unrecognised value; resolved to "${role}"`
        : null,
  }
}

// ---------------------------------------------------------------------------
// Supabase profile
// ---------------------------------------------------------------------------

/** The columns read from `profiles`. W1-A owns the table; this is the contract. */
/**
 * The columns read from `public.profiles`, and **only columns a migration
 * actually creates**.
 *
 * ## Why this is a named constant, and why it lives in this module
 *
 * It used to be a string literal inside `lib/auth.ts`, and it named two columns
 * that do not exist: `roles` and `anonymized_at`. PostgREST answers a select
 * over an unknown column with `42703` for the **whole request**, so
 * `profileError` was non-null on every authenticated request,
 * {@link resolveSupabaseProfile} took its `profileReadFailed` branch, and every
 * user in the product resolved to `tenant`. An administrator was a tenant, the
 * eleven-role matrix was inert, and it had never once been exercised against the
 * database.
 *
 * Reproduced against the live project before the fix (SEC-002, M-002):
 *
 * ```
 * profiles?select=role           -> 200  {"role":"admin"}
 * profiles?select=roles          -> 400  42703  column profiles.roles does not exist
 * profiles?select=anonymized_at  -> 400  42703  column profiles.anonymized_at does not exist
 * ```
 *
 * The failure direction was fail-closed, so it was never an escalation. It was
 * worse in one specific way: it is indistinguishable from working.
 *
 * It lives **here** rather than beside the query because `lib/auth.ts` imports
 * `next/headers` and cannot be loaded outside a Next runtime. A projection that
 * no test can import is a projection that drifts from the schema unobserved,
 * which is the whole history of this defect. `HANDOFF/F1-role-resolution-probe.mts`
 * issues this exact list against the live database.
 *
 * ## Why the two columns were removed rather than added
 *
 * `CONTRACTS.md` §3 freezes the role list, so the resolution is what may change,
 * never the list. Fifteen migrations create `public.profiles` with exactly these
 * columns plus `created_at`/`updated_at`; `roles` appears in four migrations in
 * comments only. There is no multi-role assignment and no anonymisation feature
 * to preserve, only two names in a select list.
 *
 * ## If W1-A ever adds them
 *
 * Add the column here **in the same commit as the migration**. Both downstream
 * checks re-arm on their own: `normalizeRoleList(row.roles, role)` and the
 * `anonymized_at` suspension test below are already written to tolerate
 * `undefined`. That defensive design was correct all along; naming the columns
 * in the projection was the one thing that defeated it.
 */
export const PROFILE_COLUMNS = [
  "id",
  "email",
  "full_name",
  "role",
  "is_active",
  "company_id",
  "phone",
  "locale",
  "avatar_url",
] as const

/** The projection PostgREST is given. One source, one join. */
export const PROFILE_SELECT: string = PROFILE_COLUMNS.join(", ")

export interface ProfileRow {
  id?: unknown
  email?: unknown
  full_name?: unknown
  role?: unknown
  roles?: unknown
  is_active?: unknown
  anonymized_at?: unknown
  company_id?: unknown
  phone?: unknown
  locale?: unknown
  avatar_url?: unknown
}

/** Everything `lib/auth.ts` learned from Supabase, with no client attached. */
export interface SupabaseAuthFacts {
  /** `auth.getUser()` returned an error, or no user. */
  userId: string | null
  userEmail: string | null
  /** The `profiles` read returned an error (table absent, RLS denial, timeout). */
  profileReadFailed: boolean
  /** The row, or `null` for "no such row". */
  row: ProfileRow | null
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function asLocale(value: unknown): Locale | null {
  return value === "de" || value === "en" || value === "tr" || value === "ru"
    ? value
    : null
}

/**
 * Distinct valid roles, highest authority first, always including the primary.
 * A single-role user is therefore represented identically whether or not the
 * assignment column exists.
 */
export function normalizeRoleList(value: unknown, primary: Role): Role[] {
  const candidates = Array.isArray(value) ? value : []
  const valid = candidates.filter(isValidRole)
  return Array.from(new Set<Role>([...valid, primary])).sort(
    (a, b) => roleLevel[b] - roleLevel[a]
  )
}

/**
 * The decision table for a configured Supabase.
 *
 * Every branch fails closed, and no branch can produce a role above the one the
 * database actually stated:
 *
 * | Facts | Result |
 * |---|---|
 * | no user | `ANONYMOUS_PROFILE` |
 * | user, read failed | authenticated `tenant`, `degradedReason` set |
 * | user, no row | authenticated `tenant`, `degradedReason` set |
 * | user, row suspended or anonymised | `ANONYMOUS_PROFILE` |
 * | user, row with unrecognised role | authenticated `tenant`, `degradedReason` set |
 * | user, valid row | authenticated with the stated role |
 *
 * A read failure and a missing row deliberately produce the same *role*. They
 * are different situations — the first is usually "W1-A's migrations have not
 * been applied", the second is incomplete onboarding — and `degradedReason`
 * keeps them distinguishable, but neither is allowed to widen authority, so the
 * safe answer is the same for both. Throwing instead would make every dashboard
 * page a 500 until the migrations land, which trades a fail-closed outcome for
 * an outage and buys nothing.
 */
export function resolveSupabaseProfile(facts: SupabaseAuthFacts): UserProfile {
  if (facts.userId === null) return ANONYMOUS_PROFILE

  if (facts.profileReadFailed || facts.row === null) {
    return {
      authenticated: true,
      source: "supabase",
      id: facts.userId,
      email: facts.userEmail,
      fullName: null,
      role: "tenant",
      roles: ["tenant"],
      isActive: true,
      companyId: null,
      phone: null,
      locale: null,
      avatarUrl: null,
      degradedReason: facts.profileReadFailed
        ? "profiles row could not be read; fell back to the minimal tenant role"
        : "no profiles row for this user; fell back to the minimal tenant role",
    }
  }

  const row = facts.row

  // A suspended or anonymised profile is treated as no session at all, so the
  // route guard sends it to login exactly like an expired token. `is_active ===
  // false` rather than falsy, so a legacy NULL stays active.
  //
  // **`anonymized_at` is inert today, and that is a schema fact, not a bug
  // here.** No migration creates the column, so `PROFILE_COLUMNS` in
  // `lib/auth.ts` cannot select it and `row.anonymized_at` is always
  // `undefined`. `is_active` is the suspension control that actually runs. The
  // test is kept rather than deleted because it costs nothing and re-arms by
  // itself the day W1-A adds the column and it joins the projection; deleting it
  // would mean rediscovering the requirement later. See SEC-002.
  if (row.is_active === false || (row.anonymized_at ?? null) !== null) {
    return ANONYMOUS_PROFILE
  }

  const rawRole: unknown = row.role
  const roleValid = isValidRole(rawRole)
  // The guard is called twice on purpose: an aliased boolean does not narrow
  // `unknown` inside the object literal below, and widening `role` to satisfy
  // the compiler would defeat the point of having a frozen role union.
  const role: Role = isValidRole(rawRole) ? rawRole : "tenant"

  return {
    authenticated: true,
    source: "supabase",
    id: facts.userId,
    email: facts.userEmail ?? asString(row.email),
    fullName: asString(row.full_name),
    role,
    // `row.roles` is likewise always `undefined`: the column exists in no
    // migration. `normalizeRoleList` therefore returns `[role]`, which is the
    // correct representation of a single-role user and is exactly what this
    // module's header says it should be. Multi-role assignment is unbuilt, not
    // broken.
    roles: normalizeRoleList(row.roles, role),
    isActive: true,
    companyId: asString(row.company_id),
    phone: asString(row.phone),
    locale: asLocale(row.locale),
    avatarUrl: asString(row.avatar_url),
    degradedReason: roleValid
      ? null
      : `profiles.role held an unrecognised value; fell back to "tenant"`,
  }
}

// ---------------------------------------------------------------------------
// Call-site helpers
// ---------------------------------------------------------------------------

/**
 * `hasPermission` against a resolved profile, with the `authenticated` check
 * folded in so a call site cannot forget it. This is the form route handlers
 * should use.
 */
export function profileCan(
  profile: UserProfile,
  permission: Permission
): boolean {
  if (!profile.authenticated) return false
  return hasPermission(profile.role, permission)
}

/** The data horizon of the resolved profile. `null` for an unknown role. */
export function profileScope(profile: UserProfile): RoleScope | null {
  return roleScope(profile.role)
}
