/**
 * W3-B acceptance probe — the full role × route matrix.
 *
 * Run: pnpm qa:dashboard
 *   node --experimental-strip-types --import ./scripts/register-ts-resolve.mjs \
 *        scripts/dashboard-probe.mts
 *
 * ENUMERATES, NEVER SAMPLES. The brief is explicit: "Enumerate all 11 roles ×
 * ~20 routes programmatically; do not spot-check three." Every assertion below
 * crosses the frozen role list from CONTRACTS §3 with the real
 * `dashboardRoutes` config, so a route added without a permission, or a role
 * added without a nav decision, fails here rather than in production.
 *
 * The suite fails itself if it drops below a minimum assertion count — a probe
 * that silently stops checking is worse than no probe, because it still prints
 * a green tick.
 */

import { roles, type Role } from "../apps/web/lib/contracts.ts";
import { hasPermission, getAccessibleResources } from "../apps/web/lib/rbac.ts";
import {
  DASHBOARD_GROUPS,
  dashboardRoutes,
  firstAccessibleRoute,
  navGroupsForRole,
  normalizeDashboardPath,
  routeForPath,
  routesForRole,
} from "../apps/web/lib/dashboard-routing.ts";
import {
  allDashboardPaths,
  decideDashboardAccess,
  permissionForPath,
} from "../apps/web/lib/dashboard-resource-access.ts";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, observed = ""): void {
  if (condition) {
    pass += 1;
    return;
  }
  fail += 1;
  failures.push(`${name}${observed === "" ? "" : `  ::  ${observed}`}`);
}

function section(title: string): void {
  console.log(`\n── ${title}`);
}

// ---------------------------------------------------------------------------
section("Config integrity");
// ---------------------------------------------------------------------------

check(
  "every route has a unique href",
  new Set(dashboardRoutes.map((r) => r.href)).size === dashboardRoutes.length,
  `${dashboardRoutes.length} routes, ${new Set(dashboardRoutes.map((r) => r.href)).size} unique`,
);

check(
  "every route href starts /dashboard and carries no locale prefix",
  dashboardRoutes.every(
    (r) => r.href === "/dashboard" || r.href.startsWith("/dashboard/"),
  ),
  dashboardRoutes
    .filter((r) => !r.href.startsWith("/dashboard"))
    .map((r) => r.href)
    .join(", "),
);

check(
  "every route's group is a declared group",
  dashboardRoutes.every((r) => DASHBOARD_GROUPS.includes(r.group)),
);

check(
  "every route's permission is a `<resource>:view`",
  dashboardRoutes.every((r) => r.permission === `${r.resource}:view`),
  dashboardRoutes
    .filter((r) => r.permission !== `${r.resource}:view`)
    .map((r) => `${r.href} → ${r.permission}`)
    .join(", "),
);

check(
  "`allDashboardPaths` matches the config exactly",
  allDashboardPaths.length === dashboardRoutes.length,
  `${allDashboardPaths.length} vs ${dashboardRoutes.length}`,
);

// ---------------------------------------------------------------------------
section("The full matrix — 11 roles × every route");
// ---------------------------------------------------------------------------

let matrixCells = 0;
const navSizes: Array<[Role, number]> = [];

for (const role of roles) {
  const visible = routesForRole(role);
  navSizes.push([role, visible.length]);

  for (const route of dashboardRoutes) {
    matrixCells += 1;
    const permitted = hasPermission(role, route.permission);
    const inNav = visible.some((r) => r.href === route.href);

    // 1. The nav offers exactly what the matrix permits — no more, no less.
    check(
      `nav agrees with rbac: ${role} × ${route.href}`,
      inNav === permitted,
      `nav=${inNav} rbac=${permitted}`,
    );

    // 2. The server decision agrees with the nav, for an authenticated user.
    const decision = decideDashboardAccess(route.href, role, true);
    check(
      `access decision agrees with nav: ${role} × ${route.href}`,
      decision.allowed === permitted,
      `allowed=${decision.allowed} permitted=${permitted}`,
    );

    // 3. A role WITHOUT the permission is refused with `forbidden`, never
    //    silently allowed and never a redirect signal.
    if (!permitted) {
      check(
        `forbidden is the denial reason: ${role} × ${route.href}`,
        decision.allowed === false && decision.reason === "forbidden",
        decision.allowed === false ? decision.reason : "allowed",
      );
    }
  }
}

console.log(
  `   matrix cells crossed: ${matrixCells} (${roles.length} roles × ${dashboardRoutes.length} routes)`,
);
check(
  "the matrix is the full cross product, not a sample",
  matrixCells === roles.length * dashboardRoutes.length,
  `${matrixCells}`,
);

// ---------------------------------------------------------------------------
section("Unauthenticated is distinguished from forbidden");
// ---------------------------------------------------------------------------

for (const role of roles) {
  const decision = decideDashboardAccess("/dashboard", role, false);
  check(
    `unauthenticated ${role} → "unauthenticated", not "forbidden"`,
    decision.allowed === false && decision.reason === "unauthenticated",
    decision.allowed === false ? decision.reason : "allowed",
  );
}

// ---------------------------------------------------------------------------
section("Every role lands somewhere coherent");
// ---------------------------------------------------------------------------

for (const [role, size] of navSizes) {
  // No role in the current matrix reaches zero — `child_guest` is the floor.
  check(`${role} sees at least one route`, size > 0, `${size} routes`);

  const landing = firstAccessibleRoute(role);
  check(
    `${role}'s landing route is one it may open`,
    landing !== null && hasPermission(role, landing.permission),
    landing === null ? "null" : landing.href,
  );

  // A group is never rendered empty — that is what makes a scoped nav read as
  // scoped rather than broken.
  const groups = navGroupsForRole(role);
  check(
    `${role} has no empty nav group`,
    groups.every((g) => g.routes.length > 0),
    groups.map((g) => `${g.group}:${g.routes.length}`).join(" "),
  );
  check(
    `${role}'s grouped nav totals its flat nav`,
    groups.reduce((total, g) => total + g.routes.length, 0) === size,
  );
}

console.log(
  "   nav size by role: " + navSizes.map(([r, n]) => `${r}=${n}`).join(" "),
);

// ---------------------------------------------------------------------------
section("Additive authority holds in the navigation too");
// ---------------------------------------------------------------------------

/**
 * CONTRACTS §3: the five added roles sit strictly below their parent and may
 * never widen it. W1-B proves that for the permission matrix; this proves the
 * NAV cannot reintroduce it — a route offered to a child but not its guardian
 * would be an escalation via the sidebar.
 */
const ADDITIVE_PARENT: ReadonlyArray<[Role, Role]> = [
  ["guest", "tenant"],
  ["service_provider", "staff"],
  ["child_owner", "owner"],
  ["child_tenant", "tenant"],
  ["child_guest", "guest"],
];

for (const [child, parent] of ADDITIVE_PARENT) {
  const childHrefs = new Set(routesForRole(child).map((r) => r.href));
  const parentHrefs = new Set(routesForRole(parent).map((r) => r.href));
  const extra = [...childHrefs].filter((href) => !parentHrefs.has(href));

  check(
    `nav: ${child} ⊆ ${parent}`,
    extra.length === 0,
    extra.length === 0 ? "" : `child-only: ${extra.join(", ")}`,
  );
}

// A positive control. Without it, a `routesForRole` that returned [] for
// everything would pass every subset assertion above while being broken.
check(
  "control: tenant is NOT a subset of guest",
  routesForRole("tenant").length > routesForRole("guest").length,
  `tenant=${routesForRole("tenant").length} guest=${routesForRole("guest").length}`,
);

// ---------------------------------------------------------------------------
section("Path resolution");
// ---------------------------------------------------------------------------

check(
  "a nested path resolves to its module, not to /dashboard",
  routeForPath("/dashboard/units/AZW-B01-0001")?.href === "/dashboard/units",
  String(routeForPath("/dashboard/units/AZW-B01-0001")?.href),
);
check(
  "/dashboard resolves to the home route",
  routeForPath("/dashboard")?.href === "/dashboard",
);
check(
  "a trailing slash does not change resolution",
  routeForPath("/dashboard/units/")?.href === "/dashboard/units",
);
check(
  "a query string does not change resolution",
  routeForPath("/dashboard/units?page=2")?.href === "/dashboard/units",
);
check(
  "a hash does not change resolution",
  routeForPath("/dashboard/units#row-3")?.href === "/dashboard/units",
);
check(
  "an unregistered path resolves to null",
  routeForPath("/dashboard/not-a-module") === null,
  String(routeForPath("/dashboard/not-a-module")?.href),
);
check(
  "an unregistered path denies with `unknown_route`, not `forbidden`",
  (() => {
    const d = decideDashboardAccess("/dashboard/not-a-module", "admin", true);
    return d.allowed === false && d.reason === "unknown_route";
  })(),
);
check(
  "a near-miss prefix is NOT treated as the module",
  routeForPath("/dashboard/unitsx") === null,
  String(routeForPath("/dashboard/unitsx")?.href),
);
check(
  "normalize strips a trailing slash",
  normalizeDashboardPath("/dashboard/") === "/dashboard",
);
check(
  "normalize adds a leading slash",
  normalizeDashboardPath("dashboard") === "/dashboard",
);

check(
  "permissionForPath agrees with the route config for every path",
  dashboardRoutes.every((r) => permissionForPath(r.href) === r.permission),
);

// ---------------------------------------------------------------------------
section("admin sees everything; guest writes nothing");
// ---------------------------------------------------------------------------

check(
  "admin sees every route",
  routesForRole("admin").length === dashboardRoutes.length,
  `${routesForRole("admin").length} of ${dashboardRoutes.length}`,
);

for (const role of ["guest", "child_guest"] as const) {
  const resources = getAccessibleResources(role);
  check(
    `${role} reaches no finance route`,
    !routesForRole(role).some((r) => r.group === "finance"),
    resources.join(","),
  );
  check(
    `${role} reaches no governance route`,
    !routesForRole(role).some((r) => r.group === "governance"),
  );
  check(
    `${role} reaches no evidence route`,
    !routesForRole(role).some((r) => r.resource === "evidence"),
  );
}

check(
  "only manager and above reach the evidence cockpit",
  roles.every(
    (role) =>
      routesForRole(role).some((r) => r.resource === "evidence") ===
      hasPermission(role, "evidence:view"),
  ),
);

// ---------------------------------------------------------------------------

const MIN_ASSERTIONS = 500;
check(
  `the suite ran at least ${MIN_ASSERTIONS} assertions`,
  pass + fail >= MIN_ASSERTIONS,
  `${pass + fail}`,
);

console.log(`\n${pass} pass · ${fail} fail`);
if (fail > 0) {
  console.log("\nFAILED:");
  for (const line of failures.slice(0, 40)) console.log(`  - ${line}`);
  if (failures.length > 40) console.log(`  … and ${failures.length - 40} more`);
}
process.exit(fail > 0 ? 1 : 0);
