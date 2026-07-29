/**
 * Who the caller is.
 *
 * `getUserProfile()` is the one answer to that question. Route handlers,
 * Server Components and server actions all go through it; nothing else reads
 * `auth.getUser()` directly, because the resolution order below is where the
 * fail-closed guarantees live and a second copy of it will eventually disagree.
 *
 * ## Resolution order (W1-B brief §2)
 *
 *  1. **Supabase unconfigured** → local access profile, if access profiles are
 *     enabled: cookie `access_profile_role` → `ACCESS_PROFILE_ROLE` → `manager`.
 *     If they are not enabled, → anonymous.
 *  2. **Supabase configured** → `auth.getUser()`, then the `profiles` row.
 *  3. **Authenticated but no usable profile row** → minimal `tenant`.
 *     Fail closed, never open.
 *
 * This file does the **reads**. Every *decision* lives in
 * `lib/auth-resolution.ts` as a pure function, so the fail-closed guarantees can
 * be proved by `scripts/rbac-probe.mts` without standing up a Next request. See
 * that module's header for why the split exists.
 *
 * ## Why the return type is not nullable
 *
 * The brief specifies `Promise<UserProfile>`. A nullable return invites
 * `profile?.role === "admin"` at call sites, where a typo silently evaluates to
 * `false` — safe — but `profile?.role !== "admin"` silently evaluates to `true`,
 * which is not. So there is always a profile, and the unauthenticated one is a
 * distinct arm of a discriminated union carrying `authenticated: false` and the
 * read-only `guest` role.
 *
 * ## What this file is not
 *
 * It is not a security boundary. RLS is (CONVENTIONS §2). Everything here runs
 * before Postgres sees the query and exists to decide what to *offer* the user.
 */

import { cookies } from "next/headers"
import {
  ACCESS_PROFILE_COOKIE,
  accessProfilesEnabledForEnvironment,
} from "./access-profile-policy"
import {
  ANONYMOUS_PROFILE,
  buildAccessProfileFor,
  PROFILE_SELECT,
  resolveSupabaseProfile,
  type AuthenticatedProfile,
  type ProfileRow,
  type UserProfile,
} from "./auth-resolution"
import { isSupabaseConfigured } from "./env"
import { createClient } from "./supabase/server"

export { isSupabaseConfigured }

// The profile shape and the pure helpers are re-exported so `@/lib/auth` stays
// the single import path every other window uses. `lib/auth-resolution.ts` is an
// implementation detail of this module, not a second public surface.
export {
  ANONYMOUS_PROFILE,
  buildAccessProfileFor,
  normalizeRoleList,
  profileCan,
  profileScope,
  resolveSupabaseProfile,
} from "./auth-resolution"
export type {
  AnonymousProfile,
  AuthenticatedProfile,
  ProfileRow,
  ProfileSource,
  SupabaseAuthFacts,
  UserProfile,
} from "./auth-resolution"

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

/**
 * Whether the QA role picker is available. Delegates to
 * `lib/access-profile-policy.ts`, which is the single place the triple gate and
 * the production kill-switch are implemented. See that module's header for why
 * this can never be true in a production build.
 */
export function isAccessProfileEnabled(): boolean {
  return accessProfilesEnabledForEnvironment()
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function readAccessProfileCookie(): Promise<string | undefined> {
  try {
    const cookieStore = await cookies()
    return cookieStore.get(ACCESS_PROFILE_COOKIE)?.value
  } catch {
    // `cookies()` throws outside a request scope (a build-time render, a script).
    // An explicitly configured `ACCESS_PROFILE_ROLE` still applies; there is
    // deliberately no implicit role here.
    return undefined
  }
}

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

/**
 * Resolves the caller.
 *
 * **Not memoised**, deliberately. The brief's edge case is explicit: a role
 * changed while the user is logged in must be reflected on the next request, so
 * nothing here may cache for the session lifetime. Per-request memoisation via
 * React `cache()` would be safe and is a reasonable later optimisation, but it
 * is not added now — it only pays off once a page issues several profile reads,
 * and an unnecessary cache around an authorisation decision is a bad default.
 */
export async function getUserProfile(): Promise<UserProfile> {
  // 1. No data plane. Either the QA profile, or nobody.
  if (!isSupabaseConfigured()) {
    if (!isAccessProfileEnabled()) return ANONYMOUS_PROFILE
    return buildAccessProfileFor(await readAccessProfileCookie())
  }

  // 2. Configured. The session is authoritative.
  let supabase: Awaited<ReturnType<typeof createClient>>
  try {
    supabase = await createClient()
  } catch {
    return ANONYMOUS_PROFILE
  }
  if (supabase === null) return ANONYMOUS_PROFILE

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError !== null || user === null) {
      // An access profile may still stand in when the three QA flags are set.
      return isAccessProfileEnabled()
        ? buildAccessProfileFor(await readAccessProfileCookie())
        : ANONYMOUS_PROFILE
    }

    const { data, error: profileError } = await supabase
      .from("profiles")
      .select(PROFILE_SELECT)
      .eq("id", user.id)
      .maybeSingle()

    const row: ProfileRow | null =
      data !== null && typeof data === "object" ? (data as ProfileRow) : null

    // 3. Every remaining decision is the pure table in `auth-resolution.ts`.
    return resolveSupabaseProfile({
      userId: user.id,
      userEmail:
        typeof user.email === "string" && user.email.length > 0
          ? user.email
          : null,
      profileReadFailed: profileError !== null,
      row,
    })
  } catch {
    // Any unexpected failure fails closed. Never to an access profile here: at
    // this point Supabase *is* configured, so a thrown error is an outage, and
    // silently handing out a QA role during an outage is how a backdoor becomes
    // production behaviour.
    return ANONYMOUS_PROFILE
  }
}

/**
 * For server actions and Server Components that genuinely cannot proceed without
 * a user. Throws rather than returning a sentinel, so the failure is loud and
 * local. Route handlers should NOT use this — they must return a typed
 * `ApiError` with code `unauthorized` (CONTRACTS §5), not throw.
 */
export async function requireProfile(): Promise<AuthenticatedProfile> {
  const profile = await getUserProfile()
  if (!profile.authenticated) {
    throw new Error("Unauthorized: no authenticated profile")
  }
  return profile
}
