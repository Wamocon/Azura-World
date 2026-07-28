/**
 * RBAC — the TypeScript half of the security boundary. W1-A owns the SQL half.
 *
 * **RLS is the security boundary. RBAC is the UX boundary** (CONVENTIONS §2).
 * Nothing in this file protects data. It decides what a role is *offered*;
 * Postgres row-level security decides what a role can *reach*. Every route
 * handler re-checks `hasPermission` server-side even when the UI already hid the
 * entry point, because the user can type the URL.
 *
 * `roles`, `resources`, `actions` and `roleLevel` are imported from
 * `lib/contracts.ts` and are **never redeclared here**. CONTRACTS §3 freezes
 * them; W1-A's SQL enum is generated from the same list in the same order. A
 * divergence between the two halves is a security hole that typechecks, which is
 * exactly why there is one source of truth.
 *
 * ## The additive-authority rule, proved at compile time
 *
 * CONTRACTS §3: the five added roles (`guest`, `service_provider`, `child_*`)
 * sit strictly below the canonical six and may never widen an existing role's
 * permissions.
 *
 * That is not asserted in a comment here — it is enforced by the type checker.
 * Each canonical parent's permission list is declared `as const`, so its element
 * type is a union of string literals. Each added role's list is then declared
 * `satisfies readonly ParentPermission[]`. Adding a permission to `child_owner`
 * that `owner` does not hold is a **compile error**, not a review finding.
 * `scripts/rbac-probe.mts` re-proves the same property at runtime, so the
 * guarantee survives someone weakening a type later.
 */

import {
  actions,
  resources,
  roleLevel,
  roles,
  type Action,
  type Permission,
  type Resource,
  type Role,
} from "./contracts"

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

/**
 * The data horizon a role operates in. Seven scopes for eleven roles: the three
 * `child_*` roles share their guardian's scope because a supervised minor sees a
 * subset of the same horizon, never a different one.
 */
export type RoleScope =
  | "company"
  | "site"
  | "finance"
  | "field"
  | "owned_unit"
  | "rented_unit"
  | "public"

const roleScopes: Record<Role, RoleScope> = {
  admin: "company",
  manager: "site",
  accountant: "finance",
  staff: "field",
  // A vendor does field work on assigned tickets. There is no separate "vendor"
  // scope in the frozen union, and inventing one would put this file out of step
  // with the SQL helper W1-A generates from the same list.
  service_provider: "field",
  owner: "owned_unit",
  tenant: "rented_unit",
  guest: "public",
  child_owner: "owned_unit",
  child_tenant: "rented_unit",
  child_guest: "public",
}

// ---------------------------------------------------------------------------
// Permission construction
// ---------------------------------------------------------------------------

/**
 * Generic so the literal types survive: `permission("units", "view")` has type
 * `"units:view"`, not the widened `Permission`. The compile-time subset proof
 * below depends on that narrowing.
 */
export function permission<R extends Resource, A extends Action>(
  resource: R,
  action: A
): `${R}:${A}` {
  return `${resource}:${action}`
}

/** Every legal permission string — the full 21 × 8 cross-product. */
export const allPermissions: readonly Permission[] = Object.freeze(
  resources.flatMap((resource) =>
    actions.map((action) => permission(resource, action))
  )
)

const allPermissionSet: ReadonlySet<string> = new Set(allPermissions)

// ---------------------------------------------------------------------------
// The matrix — canonical six first, added five derived from them
// ---------------------------------------------------------------------------

/**
 * `admin` holds every permission on every resource, including `evidence:manage`
 * — CONTRACTS §3 reserves that one for `admin` alone.
 */
const ADMIN = allPermissions

/**
 * `manager` runs the site. It may review finance but not post entries (that is
 * `accountant`), and may `view` the evidence cockpit but never `manage` it.
 */
const MANAGER = [
  "dashboard:view",
  "listings:view",
  "listings:create",
  "listings:update",
  "listings:delete",
  "listings:approve",
  "listings:assign",
  "listings:export",
  "units:view",
  "units:create",
  "units:update",
  "units:delete",
  "units:assign",
  "units:export",
  "leads:view",
  "leads:create",
  "leads:update",
  "leads:delete",
  "leads:assign",
  "leads:export",
  "buyer_pipeline:view",
  "buyer_pipeline:create",
  "buyer_pipeline:update",
  "buyer_pipeline:delete",
  "buyer_pipeline:assign",
  "buyer_pipeline:export",
  "deals:view",
  "deals:create",
  "deals:update",
  "deals:delete",
  "deals:approve",
  "deals:export",
  "tickets:view",
  "tickets:create",
  "tickets:update",
  "tickets:delete",
  "tickets:assign",
  "tickets:approve",
  "activities:view",
  "activities:create",
  "activities:update",
  "activities:delete",
  "activities:export",
  "calendar:view",
  "calendar:create",
  "calendar:update",
  "calendar:delete",
  "calendar:approve",
  "documents:view",
  "documents:create",
  "documents:update",
  "documents:delete",
  "documents:export",
  "compliance:view",
  "compliance:update",
  "compliance:approve",
  "compliance:export",
  // Review, not posting. `finance:create` / `finance:update` belong to
  // `accountant`; a manager who could post entries makes the segregation of
  // duties in CONTRACTS §3 decorative.
  "finance:view",
  "finance:export",
  "wallet:view",
  "vendor_invoices:view",
  "vendor_invoices:approve",
  "reports:view",
  "reports:create",
  "reports:export",
  "users:view",
  "settings:view",
  "communications:view",
  "communications:create",
  "communications:update",
  "communications:delete",
  "hotel:view",
  "hotel:create",
  "hotel:update",
  "hotel:export",
  "reviews:view",
  "reviews:create",
  "reviews:update",
  "reviews:export",
  // CONTRACTS §3: manager and above may view the source/conflict cockpit.
  "evidence:view",
  "evidence:export",
] as const satisfies readonly Permission[]

/**
 * `accountant` posts and approves financial entries. It is level 60 — **below**
 * manager — so it deliberately has **no** `evidence:*`: CONTRACTS §3 grants the
 * evidence cockpit to "manager and above", and 60 < 70.
 */
const ACCOUNTANT = [
  "dashboard:view",
  "units:view",
  "deals:view",
  "deals:export",
  "tickets:view",
  "documents:view",
  "documents:create",
  "documents:update",
  "documents:export",
  "compliance:view",
  "compliance:export",
  "finance:view",
  "finance:create",
  "finance:update",
  "finance:approve",
  "finance:export",
  "wallet:view",
  "wallet:create",
  "wallet:update",
  "wallet:approve",
  "wallet:export",
  "vendor_invoices:view",
  "vendor_invoices:create",
  "vendor_invoices:update",
  "vendor_invoices:approve",
  "vendor_invoices:export",
  "reports:view",
  "reports:create",
  "reports:export",
  "communications:view",
  "communications:create",
  "hotel:view",
] as const satisfies readonly Permission[]

/**
 * `staff` is internal field operations. It is the declared parent of
 * `service_provider`, so it must hold every permission a vendor holds —
 * including `vendor_invoices:view` / `:create`, which internal staff use to
 * raise and check invoices for work they coordinate. RLS scopes both roles to
 * their own rows; the difference between them is the row filter, not the verb.
 */
const STAFF = [
  "dashboard:view",
  "listings:view",
  "units:view",
  "tickets:view",
  "tickets:create",
  "tickets:update",
  "activities:view",
  "activities:create",
  "activities:update",
  "calendar:view",
  "calendar:create",
  "calendar:update",
  "documents:view",
  "documents:create",
  "communications:view",
  "communications:create",
  "vendor_invoices:view",
  "vendor_invoices:create",
  "wallet:view",
  "reports:view",
  "hotel:view",
  "reviews:view",
] as const satisfies readonly Permission[]

/** `owner` sees its own units. Parent of `child_owner`. */
const OWNER = [
  "dashboard:view",
  "listings:view",
  "units:view",
  "tickets:view",
  "tickets:create",
  "tickets:approve",
  "activities:view",
  "activities:create",
  "calendar:view",
  "calendar:create",
  "documents:view",
  "documents:create",
  // The owner's own statement projection, not the internal ledger. The internal
  // finance workspace is gated separately by `canViewInternalFinance`.
  "finance:view",
  "wallet:view",
  "wallet:create",
  "communications:view",
  "communications:create",
  "reports:view",
  "hotel:view",
  "reviews:view",
] as const satisfies readonly Permission[]

/** `tenant` rents a unit. Parent of both `guest` and `child_tenant`. */
const TENANT = [
  "dashboard:view",
  "listings:view",
  "units:view",
  "tickets:view",
  "tickets:create",
  "activities:view",
  "activities:create",
  "calendar:view",
  "calendar:create",
  "documents:view",
  "wallet:view",
  "communications:view",
  "communications:create",
  "reports:view",
  "hotel:view",
  "reviews:view",
] as const satisfies readonly Permission[]

// — the five added roles. Each is typed against its parent's literal union. —

type StaffPermission = (typeof STAFF)[number]
type OwnerPermission = (typeof OWNER)[number]
type TenantPermission = (typeof TENANT)[number]

/**
 * `guest` is **read-only everywhere**. Not "mostly read-only": the probe asserts
 * that no `create`, `update`, `delete`, `manage`, `approve` or `assign`
 * permission appears in this list at all. It is also the profile an
 * unauthenticated request resolves to (`lib/auth.ts`), which is why it is the
 * one role that must fail closed by construction rather than by policy.
 */
const GUEST = [
  "dashboard:view",
  "listings:view",
  "units:view",
  "activities:view",
  "calendar:view",
  "communications:view",
  "hotel:view",
  "reviews:view",
] as const satisfies readonly TenantPermission[]

type GuestPermission = (typeof GUEST)[number]

/** A vendor: assigned tickets and its own invoices. Strict subset of `staff`. */
const SERVICE_PROVIDER = [
  "dashboard:view",
  "units:view",
  "tickets:view",
  "tickets:update",
  "activities:view",
  "activities:create",
  "calendar:view",
  "documents:view",
  "communications:view",
  "communications:create",
  "vendor_invoices:view",
  "vendor_invoices:create",
] as const satisfies readonly StaffPermission[]

/** Guardian-supervised minor on an owner account. Strict subset of `owner`. */
const CHILD_OWNER = [
  "dashboard:view",
  "units:view",
  "activities:view",
  "activities:create",
  "calendar:view",
  "wallet:view",
  "communications:view",
  "reports:view",
  "hotel:view",
  "reviews:view",
] as const satisfies readonly OwnerPermission[]

/** Guardian-supervised minor on a tenant account. Strict subset of `tenant`. */
const CHILD_TENANT = [
  "dashboard:view",
  "units:view",
  "activities:view",
  "activities:create",
  "calendar:view",
  "wallet:view",
  "communications:view",
  "reports:view",
  "hotel:view",
  "reviews:view",
] as const satisfies readonly TenantPermission[]

/**
 * Guardian-supervised minor on a guest account. Strict subset of `guest`, and
 * therefore transitively of `tenant`. Read-only by inheritance: `guest` has no
 * write permission to inherit.
 */
const CHILD_GUEST = [
  "dashboard:view",
  "units:view",
  "activities:view",
  "calendar:view",
  "communications:view",
  "hotel:view",
  "reviews:view",
] as const satisfies readonly GuestPermission[]

/**
 * The canonical permission matrix. Keys are in CONTRACTS §3 order, which is the
 * same order as W1-A's SQL enum.
 */
export const permissionMatrix: Record<Role, readonly Permission[]> =
  Object.freeze({
    admin: ADMIN,
    manager: MANAGER,
    accountant: ACCOUNTANT,
    staff: STAFF,
    owner: OWNER,
    tenant: TENANT,
    guest: GUEST,
    service_provider: SERVICE_PROVIDER,
    child_owner: CHILD_OWNER,
    child_tenant: CHILD_TENANT,
    child_guest: CHILD_GUEST,
  })

// ---------------------------------------------------------------------------
// Additive authority
// ---------------------------------------------------------------------------

/** The five roles CONTRACTS §3 adds below the canonical six. */
export type AddedRole =
  "guest" | "service_provider" | "child_owner" | "child_tenant" | "child_guest"

/**
 * Which canonical role each added role is a subset of. This is the map the
 * `satisfies` clauses above encode in the type system; it is exported so the
 * probe, the handoff table and any later audit all read the same declaration
 * rather than three independent guesses.
 *
 * Every parent's `roleLevel` is strictly greater than its child's — a property
 * the probe checks — which is what "sits strictly below" means numerically.
 */
export const additiveParent: Readonly<Record<AddedRole, Role>> = Object.freeze({
  guest: "tenant",
  service_provider: "staff",
  child_owner: "owner",
  child_tenant: "tenant",
  child_guest: "guest",
})

/** The write verbs. `view` and `export` are reads; everything else mutates. */
export const writeActions: readonly Action[] = Object.freeze([
  "create",
  "update",
  "delete",
  "manage",
  "approve",
  "assign",
] satisfies Action[])

const writeActionSet: ReadonlySet<string> = new Set(writeActions)

/** One way the additive-authority rule can be broken. */
export interface AdditiveAuthorityViolation {
  role: AddedRole
  parent: Role
  kind: "permission_not_in_parent" | "level_not_below_parent"
  detail: string
}

/**
 * Runtime re-proof of the compile-time subset guarantee. Returns every
 * violation rather than the first, so a probe run reports the whole picture
 * instead of one symptom at a time. An empty array is the pass condition.
 */
export function verifyAdditiveAuthority(): AdditiveAuthorityViolation[] {
  const violations: AdditiveAuthorityViolation[] = []
  for (const [added, parent] of Object.entries(additiveParent) as Array<
    [AddedRole, Role]
  >) {
    const parentSet = new Set<string>(permissionMatrix[parent])
    for (const held of permissionMatrix[added]) {
      if (!parentSet.has(held)) {
        violations.push({
          role: added,
          parent,
          kind: "permission_not_in_parent",
          detail: `${added} holds ${held}, which ${parent} does not`,
        })
      }
    }
    const addedLevel = roleLevel[added]
    const parentLevel = roleLevel[parent]
    if (addedLevel >= parentLevel) {
      violations.push({
        role: added,
        parent,
        kind: "level_not_below_parent",
        detail: `roleLevel.${added} (${addedLevel}) is not strictly below roleLevel.${parent} (${parentLevel})`,
      })
    }
  }
  return violations
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Membership sets for O(1) lookup. Written out key by key rather than built with
 * `Object.fromEntries`, which erases the key union to `string` and would need a
 * cast to put back — and a cast here is exactly the thing that would let a role
 * silently go missing from the lookup while `permissionMatrix` still lists it.
 */
const permissionSets: Record<Role, ReadonlySet<string>> = Object.freeze({
  admin: new Set<string>(ADMIN),
  manager: new Set<string>(MANAGER),
  accountant: new Set<string>(ACCOUNTANT),
  staff: new Set<string>(STAFF),
  owner: new Set<string>(OWNER),
  tenant: new Set<string>(TENANT),
  guest: new Set<string>(GUEST),
  service_provider: new Set<string>(SERVICE_PROVIDER),
  child_owner: new Set<string>(CHILD_OWNER),
  child_tenant: new Set<string>(CHILD_TENANT),
  child_guest: new Set<string>(CHILD_GUEST),
})

/** Narrows unknown input — a role from a cookie, a JWT claim or a form post. */
export function isValidRole(value: unknown): value is Role {
  return (
    typeof value === "string" && (roles as readonly string[]).includes(value)
  )
}

/**
 * Narrows unknown input to a well-formed `Resource:Action` string. A permission
 * arriving from an API payload or a database row is untrusted text until this
 * says otherwise.
 */
export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && allPermissionSet.has(value)
}

/**
 * The single authorisation question.
 *
 * Fails closed on anything that is not a valid role *and* a well-formed
 * permission, even though both parameters are typed — the values reaching this
 * function at runtime come from cookies, JWTs and database rows, and a
 * `"units:viwe"` typo must deny rather than silently pass through an
 * `Array.includes` that was never going to match anything anyway.
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  if (!isValidRole(role)) return false
  if (!isPermission(permission)) return false
  return permissionSets[role].has(permission)
}

/** True when the role holds at least one of the listed permissions. */
export function hasAnyPermission(
  role: Role,
  permissions: Permission[]
): boolean {
  return permissions.some((candidate) => hasPermission(role, candidate))
}

/** True only when the role holds every listed permission. */
export function hasAllPermissions(
  role: Role,
  permissions: Permission[]
): boolean {
  return permissions.every((candidate) => hasPermission(role, candidate))
}

/**
 * Distinct resources the role touches at all, in `resources` order so the
 * sidebar is stable across renders and roles. A role with an empty result is a
 * supported state, not a bug — the caller renders the "no accessible area"
 * empty state (W1-B brief, edge cases).
 */
export function getAccessibleResources(role: Role): Resource[] {
  if (!isValidRole(role)) return []
  const held = permissionSets[role]
  return resources.filter((resource) =>
    actions.some((action) => held.has(permission(resource, action)))
  )
}

/** Every permission the role holds, in a stable order. Used by the handoff table. */
export function getRolePermissions(role: Role): readonly Permission[] {
  if (!isValidRole(role)) return []
  return permissionMatrix[role]
}

export function isAdmin(role: Role): boolean {
  return role === "admin"
}

/**
 * Level ≥ 70. This is the gate CONTRACTS §3 words as "manager and above may
 * view [evidence]" — written as a level comparison, not a role list, so adding
 * a role above manager later does not silently exclude it.
 */
export function isManagerOrAbove(role: Role): boolean {
  if (!isValidRole(role)) return false
  return roleLevel[role] >= roleLevel.manager
}

/**
 * The internal finance workspace — ledger operations, reconciliation, payment
 * controls — is broader than `finance:view`, which `owner` also holds for its
 * own statement. Keep this boundary explicit wherever a route returns ledger
 * rows rather than a projection.
 */
export function canViewInternalFinance(role: Role): boolean {
  return role === "admin" || role === "manager" || role === "accountant"
}

export function roleScope(role: Role): RoleScope | null {
  if (!isValidRole(role)) return null
  return roleScopes[role]
}

/** True when the role holds no mutating permission on any resource. */
export function isReadOnlyRole(role: Role): boolean {
  if (!isValidRole(role)) return true
  for (const held of permissionMatrix[role]) {
    const action = held.slice(held.indexOf(":") + 1)
    if (writeActionSet.has(action)) return false
  }
  return true
}
