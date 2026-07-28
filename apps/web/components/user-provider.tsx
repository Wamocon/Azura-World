"use client"

/**
 * Client-side access to the resolved profile.
 *
 * **This is UX only.** `can()` decides whether to render a nav item, a button or
 * a KPI card. It is never the sole protection for anything: the user can type
 * the URL, and every route handler re-checks server-side (CONVENTIONS §2). If
 * the only thing standing between a `tenant` and the finance ledger is this
 * hook, the ledger is public.
 *
 * The profile is passed in from a Server Component rather than fetched here, so
 * there is no client-side auth round trip and no flash of the wrong navigation
 * while a request resolves.
 *
 * `lib/auth.ts` is imported **type-only**. `verbatimModuleSyntax` erases the
 * statement entirely, so `lib/supabase/server.ts` — which can build a
 * service-role client — is never pulled into this bundle.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react"
import {
  getAccessibleResources,
  hasAnyPermission,
  hasPermission,
  isReadOnlyRole,
} from "@/lib/rbac"
import type { Permission, Resource, Role } from "@/lib/contracts"
import type { UserProfile } from "@/lib/auth"

export interface UserContextValue {
  profile: UserProfile
  role: Role
  /** True when a real session (or a QA access profile) backs this context. */
  authenticated: boolean
  /** UX gate. Server-side authorisation is a separate, mandatory check. */
  can: (permission: Permission) => boolean
  canAny: (permissions: Permission[]) => boolean
  /** Resources this role touches at all, in a stable order. */
  accessibleResources: Resource[]
  /**
   * False when the role reaches nothing. The dashboard shell must render a
   * coherent explanation for this, not a blank frame — a `guest` on a locked
   * site is a supported state, not a bug (W1-B brief, edge cases).
   */
  hasAnyAccess: boolean
  /** True when the role holds no mutating permission anywhere. */
  readOnly: boolean
}

const UserContext = createContext<UserContextValue | null>(null)

export function UserProvider({
  children,
  profile,
}: {
  children: ReactNode
  profile: UserProfile
}) {
  const value = useMemo<UserContextValue>(() => {
    const role = profile.role
    const accessibleResources = getAccessibleResources(role)
    return {
      profile,
      role,
      authenticated: profile.authenticated,
      // An unauthenticated context can never answer `true`. Mirrors
      // `profileCan()` on the server so the two boundaries agree.
      can: (permission) =>
        profile.authenticated && hasPermission(role, permission),
      canAny: (permissions) =>
        profile.authenticated && hasAnyPermission(role, permissions),
      accessibleResources,
      hasAnyAccess: profile.authenticated && accessibleResources.length > 0,
      readOnly: isReadOnlyRole(role),
    }
  }, [profile])

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>
}

/**
 * Throws outside a provider rather than returning a permissive default. A hook
 * that silently answered "no permissions" would render an empty dashboard that
 * looks like a data problem; one that answered "all permissions" would be a
 * security bug. Failing loudly is the only honest third option.
 */
export function useUser(): UserContextValue {
  const context = useContext(UserContext)
  if (context === null) {
    throw new Error("useUser must be used inside a <UserProvider>")
  }
  return context
}

/** Convenience for the common single-permission gate. */
export function useCan(permission: Permission): boolean {
  return useUser().can(permission)
}
