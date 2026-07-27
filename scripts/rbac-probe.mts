#!/usr/bin/env node
/**
 * W1-B acceptance suite — RBAC, the additive-authority rule, and the
 * fail-closed auth decisions.
 *
 *   node --experimental-strip-types --import ./scripts/register-ts-resolve.mjs \
 *        scripts/rbac-probe.mts
 *
 * Style follows `scripts/smoke-contracts.mts` (W0-A): plain Node, no test
 * framework, no npm dependency, hand-rolled counters, exit code as the gate.
 * The repository already has one convention for this; a second one would be
 * churn (SYSTEM-PROMPT §1).
 *
 * The eight cases the W1-B brief requires are marked `[DoD n]`. Two of them —
 * 6 and 8 — are the ones the brief calls out as the tests that matter, and both
 * are proved twice: once against a synthetic input, and once against a real
 * child process or a positive control that would catch a vacuous assertion.
 *
 * What this suite will never do:
 *   · assert only the negative case. Every fail-closed test is paired with a
 *     positive control, because a function that returns `"tenant"` for
 *     *everything* passes "no profile row ⟹ tenant" and is completely broken.
 *   · touch the network, Supabase, or the filesystem outside `scripts/`.
 *   · hide an exit code behind a pipe (LESSONS-LEARNED, and OVERNIGHT §5).
 */

import { spawnSync } from "node:child_process"

import {
  additiveParent,
  allPermissions,
  getAccessibleResources,
  hasAnyPermission,
  hasPermission,
  isPermission,
  isReadOnlyRole,
  isValidRole,
  isManagerOrAbove,
  permissionMatrix,
  roleScope,
  verifyAdditiveAuthority,
  writeActions,
  type AddedRole,
} from "../apps/web/lib/rbac.ts"
import {
  AccessProfileSafetyError,
  accessProfilesEnabledForEnvironment,
  assertAccessProfileSafety,
  resolveAccessProfileRole,
  type EnvironmentRecord,
} from "../apps/web/lib/access-profile-policy.ts"
import {
  ANONYMOUS_PROFILE,
  buildAccessProfileFor,
  normalizeRoleList,
  profileCan,
  resolveSupabaseProfile,
} from "../apps/web/lib/auth-resolution.ts"
import {
  roleLevel,
  roles,
  type Permission,
  type Role,
} from "../apps/web/lib/contracts.ts"

// ── reporting ──────────────────────────────────────────────────────────────
const useColor =
  process.env["NO_COLOR"] === undefined && process.stdout.isTTY === true
const c = (code: string, text: string): string =>
  useColor ? `\x1b[${code}m${text}\x1b[0m` : text
const bold = (text: string): string => c("1", text)

let passes = 0
let failures = 0

function pass(label: string, detail = ""): void {
  passes += 1
  console.log(`  ${c("32", "PASS")}  ${label}${detail ? ` — ${detail}` : ""}`)
}

function fail(label: string, detail: string): void {
  failures += 1
  console.log(`  ${c("31", "FAIL")}  ${label} — ${detail}`)
}

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) pass(label, detail)
  else fail(label, detail || "condition was false")
}

function section(title: string): void {
  console.log(`\n${bold(title)}`)
}

function equal<T>(label: string, actual: T, expected: T): void {
  if (Object.is(actual, expected)) {
    pass(label, `= ${JSON.stringify(actual)}`)
  } else {
    fail(
      label,
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    )
  }
}

/**
 * Casts that exist only so the suite can send values the type system would
 * reject. That is the whole point of DoD 5: `hasPermission` is typed, but the
 * strings reaching it at runtime come from cookies, JWTs and database rows, and
 * the runtime guard is unreachable from well-typed input. `unknown` rather than
 * `any`, so nothing here is accidentally assignable anywhere else.
 */
function asPermission(value: string): Permission {
  return value as unknown as Permission
}

function asRole(value: string): Role {
  return value as unknown as Role
}

// ── [DoD 1] role list matches CONTRACTS §3, in order ───────────────────────
section("[DoD 1] Role list — CONTRACTS §3, exact order")

const CONTRACT_ROLE_ORDER = [
  "admin",
  "manager",
  "accountant",
  "staff",
  "owner",
  "tenant",
  "guest",
  "service_provider",
  "child_owner",
  "child_tenant",
  "child_guest",
] as const

equal("contracts.roles length", roles.length, 11)
check(
  "contracts.roles is CONTRACTS §3 verbatim, in order",
  roles.length === CONTRACT_ROLE_ORDER.length &&
    CONTRACT_ROLE_ORDER.every((role, index) => roles[index] === role),
  roles.join(", ")
)
check(
  "permissionMatrix keys match the role list, in order",
  Object.keys(permissionMatrix).join(",") === CONTRACT_ROLE_ORDER.join(","),
  Object.keys(permissionMatrix).join(", ")
)
check(
  "every role has a non-empty permission set",
  roles.every((role) => permissionMatrix[role].length > 0),
  roles.map((role) => `${role}=${permissionMatrix[role].length}`).join(" ")
)
check(
  "roleScope is total over all 11 roles",
  roles.every((role) => roleScope(role) !== null)
)

// ── [DoD 2] roleLevel ordering ─────────────────────────────────────────────
section("[DoD 2] roleLevel — CONTRACTS §3 values, strictly ordered")

const CONTRACT_ROLE_LEVELS: Record<Role, number> = {
  admin: 90,
  manager: 70,
  accountant: 60,
  staff: 40,
  service_provider: 30,
  owner: 20,
  child_owner: 15,
  tenant: 10,
  child_tenant: 8,
  guest: 5,
  child_guest: 3,
}

for (const role of roles) {
  equal(`roleLevel.${role}`, roleLevel[role], CONTRACT_ROLE_LEVELS[role])
}

const descending = [...roles].sort((a, b) => roleLevel[b] - roleLevel[a])
check(
  "all eleven levels are distinct",
  new Set(roles.map((role) => roleLevel[role])).size === 11
)
check(
  "levels are strictly ordered admin > … > child_guest",
  descending.every((role, index) => {
    if (index === 0) return true
    const previous = descending[index - 1]
    return previous !== undefined && roleLevel[previous] > roleLevel[role]
  }),
  descending.map((role) => `${role}:${roleLevel[role]}`).join(" > ")
)

// ── [DoD 3] additive-authority subset proof ────────────────────────────────
section("[DoD 3] Additive authority — every added role ⊆ its parent")

const violations = verifyAdditiveAuthority()
check(
  "verifyAdditiveAuthority() reports no violations",
  violations.length === 0,
  violations.map((v) => v.detail).join(" | ") || "0 violations"
)

for (const [added, parent] of Object.entries(additiveParent) as Array<
  [AddedRole, Role]
>) {
  const parentSet = new Set<string>(permissionMatrix[parent])
  const extra = permissionMatrix[added].filter((p) => !parentSet.has(p))
  check(
    `${added} ⊆ ${parent}`,
    extra.length === 0,
    extra.length === 0
      ? `${permissionMatrix[added].length} ⊆ ${permissionMatrix[parent].length} permissions`
      : `holds ${extra.join(", ")}`
  )
  check(
    `roleLevel.${added} (${roleLevel[added]}) < roleLevel.${parent} (${roleLevel[parent]})`,
    roleLevel[added] < roleLevel[parent]
  )
}

check(
  "all five added roles have a declared parent",
  Object.keys(additiveParent).length === 5,
  Object.keys(additiveParent).join(", ")
)

// Positive control: the subset checker must be capable of reporting a failure.
// Without this, "0 violations" could mean "the checker does nothing".
{
  const guestPermissions = new Set<string>(permissionMatrix.guest)
  const tenantExtras = permissionMatrix.tenant.filter(
    (p) => !guestPermissions.has(p)
  )
  check(
    "control: tenant ⊄ guest, so the subset test is not vacuous",
    tenantExtras.length > 0,
    `tenant holds ${tenantExtras.length} permissions guest does not`
  )
}

// ── [DoD 4] admin totality, guest read-only ────────────────────────────────
section("[DoD 4] admin holds everything; guest writes nothing")

equal("allPermissions length (21 resources × 8 actions)", allPermissions.length, 168)
check(
  "admin holds every one of the 168 permissions",
  allPermissions.every((p) => hasPermission("admin", p)),
  `${permissionMatrix.admin.length} held`
)

const guestWrites = permissionMatrix.guest.filter((p) =>
  (writeActions as readonly string[]).includes(p.slice(p.indexOf(":") + 1))
)
check(
  "guest holds no create/update/delete/manage/approve/assign anywhere",
  guestWrites.length === 0,
  guestWrites.length === 0
    ? `${permissionMatrix.guest.length} permissions, all reads`
    : `holds ${guestWrites.join(", ")}`
)
check("isReadOnlyRole(guest)", isReadOnlyRole("guest"))
check("isReadOnlyRole(child_guest)", isReadOnlyRole("child_guest"))
check(
  "control: isReadOnlyRole(manager) is false",
  !isReadOnlyRole("manager"),
  "so the read-only test is not vacuous"
)

// evidence: CONTRACTS §3 — manager and above may view; only admin may manage.
section("[DoD 4b] evidence resource — CONTRACTS §3 gating")
check("admin may evidence:manage", hasPermission("admin", "evidence:manage"))
check("manager may evidence:view", hasPermission("manager", "evidence:view"))
check(
  "manager may NOT evidence:manage",
  !hasPermission("manager", "evidence:manage")
)
for (const role of roles) {
  if (role === "admin" || role === "manager") continue
  check(
    `${role} may NOT evidence:view (level ${roleLevel[role]} < manager 70)`,
    !hasPermission(role, "evidence:view")
  )
}
check(
  "only admin holds evidence:manage",
  roles.filter((role) => hasPermission(role, "evidence:manage")).join(",") ===
    "admin"
)
check(
  "isManagerOrAbove agrees with the evidence:view holders",
  roles.every(
    (role) => isManagerOrAbove(role) === hasPermission(role, "evidence:view")
  )
)

// ── [DoD 5] malformed input is rejected ────────────────────────────────────
section("[DoD 5] Malformed input fails closed")

for (const malformed of [
  "units:viwe",
  "units",
  ":view",
  "units:",
  "UNITS:VIEW",
  "units:view:extra",
  "",
  "__proto__:view",
  "toString:view",
]) {
  check(
    `hasPermission("admin", ${JSON.stringify(malformed)}) is false`,
    !hasPermission("admin", asPermission(malformed))
  )
}
check(
  "control: hasPermission(\"admin\", \"units:view\") is true",
  hasPermission("admin", "units:view"),
  "so the malformed-input test is not vacuous"
)
check("isPermission rejects a typo", !isPermission("units:viwe"))
check("isPermission accepts a real permission", isPermission("units:view"))

for (const notARole of ["", "root", "Admin", "__proto__", "superuser"]) {
  check(
    `hasPermission(${JSON.stringify(notARole)}, "dashboard:view") is false`,
    !hasPermission(asRole(notARole), "dashboard:view")
  )
  check(
    `isValidRole(${JSON.stringify(notARole)}) is false`,
    !isValidRole(notARole)
  )
  check(
    `getAccessibleResources(${JSON.stringify(notARole)}) is empty`,
    getAccessibleResources(asRole(notARole)).length === 0
  )
}
check(
  "hasAnyPermission is false for an empty list",
  !hasAnyPermission("admin", [])
)

// ── [DoD 6] production + ENABLE_ACCESS_PROFILES ⟹ throws ───────────────────
section("[DoD 6] Access profiles cannot reach production")

const SUPABASE_ENV: EnvironmentRecord = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-anon-key-anon-key",
}

function throws(environment: EnvironmentRecord): boolean {
  try {
    assertAccessProfileSafety(environment)
    return false
  } catch (error) {
    return error instanceof AccessProfileSafetyError
  }
}

check(
  "production + ENABLE_ACCESS_PROFILES=true + Supabase ⟹ THROWS",
  throws({
    ...SUPABASE_ENV,
    NODE_ENV: "production",
    ENABLE_ACCESS_PROFILES: "true",
  })
)
check(
  "production + all three flags + Supabase still configured ⟹ THROWS",
  throws({
    ...SUPABASE_ENV,
    NODE_ENV: "production",
    ENABLE_ACCESS_PROFILES: "true",
    AZURA_ALLOW_REMOTE_ACCESS_PROFILES: "true",
    AZURA_DEMO_DATA_ISOLATED: "true",
  }),
  "claiming isolation while a data plane is configured is the misconfiguration"
)
check(
  "VERCEL_ENV=production (NODE_ENV unset) + flag ⟹ THROWS",
  throws({ ...SUPABASE_ENV, VERCEL_ENV: "production", ENABLE_ACCESS_PROFILES: "true" })
)
check(
  "AZURA_ENV=production + flag ⟹ THROWS",
  throws({ ...SUPABASE_ENV, AZURA_ENV: "production", ENABLE_ACCESS_PROFILES: "true" })
)
check(
  "production + flag + SUPABASE_DB_URL only ⟹ THROWS",
  throws({
    NODE_ENV: "production",
    ENABLE_ACCESS_PROFILES: "true",
    AZURA_ALLOW_REMOTE_ACCESS_PROFILES: "true",
    AZURA_DEMO_DATA_ISOLATED: "true",
    SUPABASE_DB_URL: "postgresql://user:pw@host:5432/postgres",
  }),
  "any single data-plane variable is enough"
)
check(
  "production + provably isolated (no data plane at all) ⟹ does NOT throw",
  !throws({
    NODE_ENV: "production",
    ENABLE_ACCESS_PROFILES: "true",
    AZURA_ALLOW_REMOTE_ACCESS_PROFILES: "true",
    AZURA_DEMO_DATA_ISOLATED: "true",
  }),
  "the escape hatch downgrades the throw; it never enables the picker"
)
check(
  "production + no flag ⟹ does NOT throw",
  !throws({ ...SUPABASE_ENV, NODE_ENV: "production" })
)
check(
  "development + all three flags ⟹ does NOT throw",
  !throws({
    ...SUPABASE_ENV,
    NODE_ENV: "development",
    ENABLE_ACCESS_PROFILES: "true",
    AZURA_ALLOW_REMOTE_ACCESS_PROFILES: "true",
    AZURA_DEMO_DATA_ISOLATED: "true",
  })
)

section("[DoD 6b] The runtime gate is false in production, always")
check(
  "production + all three flags ⟹ accessProfilesEnabledForEnvironment() === false",
  !accessProfilesEnabledForEnvironment({
    NODE_ENV: "production",
    ENABLE_ACCESS_PROFILES: "true",
    AZURA_ALLOW_REMOTE_ACCESS_PROFILES: "true",
    AZURA_DEMO_DATA_ISOLATED: "true",
  })
)
check(
  "production + no Supabase at all ⟹ still false",
  !accessProfilesEnabledForEnvironment({ NODE_ENV: "production" }),
  "the unconfigured-Supabase clause must not open a hole in production"
)
check(
  "dev + Supabase configured + only two flags ⟹ false",
  !accessProfilesEnabledForEnvironment({
    ...SUPABASE_ENV,
    NODE_ENV: "development",
    ENABLE_ACCESS_PROFILES: "true",
    AZURA_DEMO_DATA_ISOLATED: "true",
  })
)
check(
  "dev + Supabase configured + all three flags ⟹ true",
  accessProfilesEnabledForEnvironment({
    ...SUPABASE_ENV,
    NODE_ENV: "development",
    ENABLE_ACCESS_PROFILES: "true",
    AZURA_ALLOW_REMOTE_ACCESS_PROFILES: "true",
    AZURA_DEMO_DATA_ISOLATED: "true",
  })
)
check(
  "dev + Supabase unconfigured ⟹ true (the seed-fallback mode)",
  accessProfilesEnabledForEnvironment({ NODE_ENV: "development" })
)

// [DoD 6c] The guard must actually fire at MODULE LOAD, not merely be callable.
// A real child process is the only thing that proves that.
section("[DoD 6c] The module-load guard fires in a real process")
{
  // File URLs throughout, never Windows paths: this repository lives under
  // `D:\Azura World`, and the space breaks `--import` when passed as a path.
  const registerUrl = new URL("./register-ts-resolve.mjs", import.meta.url).href
  const policyUrl = new URL(
    "../apps/web/lib/access-profile-policy.ts",
    import.meta.url
  ).href
  const nodeArgs = [
    "--experimental-strip-types",
    "--disable-warning=ExperimentalWarning",
    "--import",
    registerUrl,
    "--input-type=module",
    "-e",
    `await import(${JSON.stringify(policyUrl)})`,
  ]
  const child = spawnSync(
    process.execPath,
    nodeArgs,
    {
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "production",
        ENABLE_ACCESS_PROFILES: "true",
        AZURA_ALLOW_REMOTE_ACCESS_PROFILES: "false",
        AZURA_DEMO_DATA_ISOLATED: "false",
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-anon-key-anon-key",
      },
    }
  )
  const stderr = child.stderr ?? ""
  check(
    "importing the module in NODE_ENV=production with the flag exits non-zero",
    child.status !== 0,
    `exit status ${String(child.status)}`
  )
  check(
    "the failure is an AccessProfileSafetyError",
    stderr.includes("AccessProfileSafetyError"),
    stderr.split("\n").find((line) => line.includes("AccessProfile"))?.trim() ??
      "(no matching stderr line)"
  )
  check(
    "the error names the variable and never a value",
    stderr.includes("ENABLE_ACCESS_PROFILES") &&
      !stderr.includes("anon-key-anon-key-anon-key")
  )

  // Control: the same import succeeds without the production flag combination.
  const control = spawnSync(process.execPath, nodeArgs, {
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "development",
      ENABLE_ACCESS_PROFILES: "true",
    },
  })
  check(
    "control: the same import succeeds in development",
    control.status === 0,
    `exit status ${String(control.status)}${
      control.status === 0 ? "" : ` — ${(control.stderr ?? "").trim().slice(0, 200)}`
    }`
  )
}

// ── [DoD 7] access profile resolution ──────────────────────────────────────
section("[DoD 7] Access profile — cookie → env → manager")

equal(
  "no cookie, no env ⟹ manager",
  resolveAccessProfileRole(undefined, {}),
  "manager"
)
equal(
  "unknown cookie value ⟹ manager (no crash)",
  resolveAccessProfileRole("not-a-role", {}),
  "manager"
)
equal(
  "unknown cookie, env set ⟹ env value",
  resolveAccessProfileRole("not-a-role", { ACCESS_PROFILE_ROLE: "accountant" }),
  "accountant"
)
equal(
  "unknown cookie, unknown env ⟹ manager",
  resolveAccessProfileRole("nope", { ACCESS_PROFILE_ROLE: "also-nope" }),
  "manager"
)
equal(
  "valid cookie wins over env",
  resolveAccessProfileRole("staff", { ACCESS_PROFILE_ROLE: "admin" }),
  "staff"
)
equal(
  "empty-string cookie ⟹ manager",
  resolveAccessProfileRole("", {}),
  "manager"
)

{
  const unknown = buildAccessProfileFor("not-a-role", {})
  equal("profile from unknown cookie: role", unknown.role, "manager")
  check("profile from unknown cookie: authenticated", unknown.authenticated)
  equal("profile from unknown cookie: source", unknown.source, "access-profile")
  check(
    "profile from unknown cookie: degradedReason explains the substitution",
    typeof unknown.degradedReason === "string" &&
      unknown.degradedReason.length > 0,
    unknown.degradedReason ?? "(null)"
  )

  const explicit = buildAccessProfileFor("owner", {})
  equal("control: explicit cookie is honoured", explicit.role, "owner")
  equal(
    "control: explicit cookie sets no degradedReason",
    explicit.degradedReason,
    null
  )
  check(
    "every role is reachable through the cookie",
    roles.every((role) => buildAccessProfileFor(role, {}).role === role)
  )
}

// ── [DoD 8] authenticated with no profile row ⟹ tenant, never admin ────────
section("[DoD 8] Fail-closed profile resolution")

{
  const noRow = resolveSupabaseProfile({
    userId: "11111111-1111-1111-1111-111111111111",
    userEmail: "user@example.com",
    profileReadFailed: false,
    row: null,
  })
  check("no profiles row: authenticated", noRow.authenticated)
  equal("no profiles row: role", noRow.role, "tenant")
  check("no profiles row: role is NOT admin", noRow.role !== "admin")
  check(
    "no profiles row: degradedReason is set",
    typeof noRow.degradedReason === "string" && noRow.degradedReason.length > 0,
    noRow.degradedReason ?? "(null)"
  )
  check(
    "no profiles row: cannot reach the evidence cockpit",
    !profileCan(noRow, "evidence:view")
  )
  check(
    "no profiles row: cannot manage users",
    !profileCan(noRow, "users:manage")
  )

  const readFailed = resolveSupabaseProfile({
    userId: "11111111-1111-1111-1111-111111111111",
    userEmail: null,
    profileReadFailed: true,
    row: null,
  })
  equal("profiles read failed: role", readFailed.role, "tenant")
  check(
    "profiles read failed: degradedReason distinguishes it from a missing row",
    readFailed.degradedReason !== noRow.degradedReason,
    readFailed.degradedReason ?? "(null)"
  )

  // Positive control: the resolver must be able to return something other than
  // tenant, or every assertion above is trivially satisfied by a stub.
  const realAdmin = resolveSupabaseProfile({
    userId: "22222222-2222-2222-2222-222222222222",
    userEmail: "admin@example.com",
    profileReadFailed: false,
    row: { role: "admin", full_name: "Real Admin", is_active: true },
  })
  equal("control: a valid admin row resolves to admin", realAdmin.role, "admin")
  equal("control: a valid row sets no degradedReason", realAdmin.degradedReason, null)
  check("control: admin may evidence:manage", profileCan(realAdmin, "evidence:manage"))

  const bogusRole = resolveSupabaseProfile({
    userId: "33333333-3333-3333-3333-333333333333",
    userEmail: null,
    profileReadFailed: false,
    row: { role: "superuser", is_active: true },
  })
  equal("unrecognised profiles.role ⟹ tenant", bogusRole.role, "tenant")

  const suspended = resolveSupabaseProfile({
    userId: "44444444-4444-4444-4444-444444444444",
    userEmail: null,
    profileReadFailed: false,
    row: { role: "admin", is_active: false },
  })
  check("suspended admin ⟹ not authenticated", !suspended.authenticated)
  equal("suspended admin ⟹ guest role", suspended.role, "guest")

  const anonymised = resolveSupabaseProfile({
    userId: "55555555-5555-5555-5555-555555555555",
    userEmail: null,
    profileReadFailed: false,
    row: { role: "admin", is_active: true, anonymized_at: "2026-01-01T00:00:00Z" },
  })
  check("anonymised admin ⟹ not authenticated", !anonymised.authenticated)

  const noUser = resolveSupabaseProfile({
    userId: null,
    userEmail: null,
    profileReadFailed: false,
    row: null,
  })
  check("no user ⟹ ANONYMOUS_PROFILE", noUser === ANONYMOUS_PROFILE)
}

section("[DoD 8b] The anonymous profile cannot write anything")
check("anonymous is not authenticated", !ANONYMOUS_PROFILE.authenticated)
equal("anonymous role", ANONYMOUS_PROFILE.role, "guest")
check(
  "profileCan(anonymous, …) is false for every one of the 168 permissions",
  allPermissions.every((p) => !profileCan(ANONYMOUS_PROFILE, p))
)
check("ANONYMOUS_PROFILE is frozen", Object.isFrozen(ANONYMOUS_PROFILE))

// ── extras: child roles cannot escalate through a guardian relation ─────────
section("[extra] child_* roles cannot reach guardian-only surfaces")

for (const child of ["child_owner", "child_tenant", "child_guest"] as const) {
  for (const forbidden of [
    "documents:view",
    "finance:view",
    "tickets:create",
    "users:view",
    "settings:view",
    "evidence:view",
    "vendor_invoices:view",
  ] satisfies Permission[]) {
    check(
      `${child} may NOT ${forbidden}`,
      !hasPermission(child, forbidden)
    )
  }
  check(
    `${child} is not read-only-empty (it has a coherent surface)`,
    getAccessibleResources(child).length > 0,
    getAccessibleResources(child).join(", ")
  )
}
check(
  "control: owner MAY documents:view, so the child tests are not vacuous",
  hasPermission("owner", "documents:view")
)

section("[extra] role list normalisation")
check(
  "normalizeRoleList drops unknown values and keeps the primary",
  normalizeRoleList(["admin", "root", 7, null], "tenant").join(",") ===
    "admin,tenant"
)
check(
  "normalizeRoleList sorts highest authority first",
  normalizeRoleList(["tenant", "manager", "admin"], "tenant").join(",") ===
    "admin,manager,tenant"
)
check(
  "normalizeRoleList on a non-array returns just the primary",
  normalizeRoleList("admin", "staff").join(",") === "staff"
)

// ── summary ────────────────────────────────────────────────────────────────
const MINIMUM_ASSERTIONS = 120
console.log("")
if (passes + failures < MINIMUM_ASSERTIONS) {
  failures += 1
  console.log(
    `  ${c("31", "FAIL")}  suite ran only ${passes + failures} assertions; ` +
      `expected at least ${MINIMUM_ASSERTIONS}. A shrinking suite is a silent regression.`
  )
}

const summary = `${passes} pass · ${failures} fail`
console.log(
  failures === 0
    ? `${bold(c("32", "OK"))}  ${summary}`
    : `${bold(c("31", "FAILED"))}  ${summary}`
)
process.exit(failures === 0 ? 0 : 1)
