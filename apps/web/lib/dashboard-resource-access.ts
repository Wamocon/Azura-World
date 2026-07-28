/**
 * Server-side access decision for a dashboard path.        Owner: W3-B
 *
 * Every module route calls `assertDashboardAccess()` in its own Server
 * Component. That is not belt-and-braces around the client guard — it is the
 * decision, and the client guard is the belt.
 *
 * WHY THIS EXISTS AT ALL, given `proxy.ts` already guards `/dashboard/*`:
 * the proxy knows only whether a *session* exists. Resolving which **role** it
 * carries needs `cookies()` and a `profiles` read, and neither is available in
 * the proxy runtime — W1-B's handoff says so explicitly and hands per-role 403s
 * to the route segments. This module is that hand-off, made concrete so six
 * module windows implement it identically instead of six slightly different
 * ways.
 *
 * **403, never a redirect.** W3-B's brief and CONVENTIONS §5 both call for it:
 * bouncing a forbidden deep link to `/dashboard` tells the user nothing, loses
 * the URL they were trying to reach, and — when the landing route is itself
 * forbidden — forms a loop. A 403 is a terminal, honest answer.
 */

import type { Permission, Role } from "@/lib/contracts"
import { hasPermission } from "@/lib/rbac"

import {
  dashboardRoutes,
  routeForPath,
  type DashboardRoute,
} from "./dashboard-routing"

/**
 * Why a path was refused. The three cases need different pages, so they are
 * kept apart rather than collapsed into one boolean.
 */
export type DashboardAccessDenial =
  /** Authenticated, role lacks the permission. → 403. */
  | "forbidden"
  /** No session at all. → the proxy should already have caught this. → 401/login. */
  | "unauthenticated"
  /** The path matches no registered route. → 404. */
  | "unknown_route"

export type DashboardAccessDecision =
  | { allowed: true; route: DashboardRoute }
  | { allowed: false; reason: DashboardAccessDenial; route: DashboardRoute | null }

/**
 * Decide whether `role` may open `pathWithoutLocale`.
 *
 * `authenticated` is a separate argument rather than being inferred from the
 * role, because `guest` is a real role that an unauthenticated visitor also
 * carries. Inferring would make "signed out" and "signed in as a guest"
 * indistinguishable, and they need different pages.
 */
export function decideDashboardAccess(
  pathWithoutLocale: string,
  role: Role,
  authenticated: boolean,
): DashboardAccessDecision {
  const route = routeForPath(pathWithoutLocale)

  if (route === null) {
    return { allowed: false, reason: "unknown_route", route: null }
  }

  if (!authenticated) {
    return { allowed: false, reason: "unauthenticated", route }
  }

  if (!hasPermission(role, route.permission)) {
    return { allowed: false, reason: "forbidden", route }
  }

  return { allowed: true, route }
}

/**
 * The permission a path requires, or `null` for an unregistered path.
 *
 * Exposed so a module can state its own requirement in a test without
 * duplicating the mapping — the pairing of route to permission lives in
 * `dashboard-routing.ts` and nowhere else.
 */
export function permissionForPath(pathWithoutLocale: string): Permission | null {
  return routeForPath(pathWithoutLocale)?.permission ?? null
}

/**
 * Every registered dashboard path.
 *
 * Derived from the routing config at module load, so the probe enumerates the
 * real nav rather than a second list that could fall behind it. The role ×
 * route matrix is checked in full — `scripts/dashboard-probe.mts` crosses this
 * with all eleven roles, because spot-checking three roles is how the one that
 * was wrong stays wrong.
 */
export const allDashboardPaths: readonly string[] = Object.freeze(
  dashboardRoutes.map((route) => route.href),
)
