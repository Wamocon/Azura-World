/**
 * Dashboard navigation, as data.                           Owner: W3-B
 *
 * IMPORTS ARE RELATIVE, NOT `@/`. This module is loaded by
 * `scripts/dashboard-probe.mts` through Node's type-stripping loader, which
 * resolves relative specifiers but not the tsconfig path alias — the same
 * reason `lib/rbac.ts` imports `./contracts`. Rewriting these to `@/lib/...`
 * compiles fine and breaks the probe.
 *
 * THIS FILE IS THE REGISTRATION POINT FOR EVERY MODULE. Six sibling windows
 * build routes into this shell at the same time; if the sidebar were JSX, each
 * of them would have to edit the same component to appear in it, and the last
 * writer would win. So navigation is a list of records, permission-filtered at
 * render time, and a module joins the nav by having its entry here — not by
 * touching `dashboard-sidebar.tsx`.
 *
 * `permission` is a `Permission` from `CONTRACTS.md` §3, checked with
 * `hasPermission()`. Never `role === "manager" || role === "admin"`
 * (CONTRACTS §8) — the matrix is the authority and it already encodes the
 * eleven roles.
 *
 * **The nav is a UX boundary, not a security one.** Hiding an entry stops
 * nobody from typing the URL. `proxy.ts` (W1-B) authenticates, and every route
 * segment re-checks server-side. This list decides what is *offered*.
 *
 * Icons are string names, not imported components: this module is imported by
 * Server Components that must not pull `lucide-react` into their graph, and by
 * the probe script, which has no JSX runtime at all. `dashboard-sidebar.tsx`
 * maps the name to a component in one place.
 */

import type { Permission, Resource, Role } from "./contracts"
import { hasPermission } from "./rbac"

/**
 * Cookie holding the sidebar collapse state.
 *
 * Declared here rather than in `layout.tsx` because the client sidebar writes
 * it and the server layout reads it. Importing a const from the layout would
 * drag `getUserProfile` — and through it `lib/supabase/server.ts`, which can
 * build a service-role client — into the browser bundle. This module imports
 * nothing but types and `rbac`, so it is safe on both sides.
 */
export const SIDEBAR_COOKIE = "azura-sidebar-collapsed"

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

/**
 * Sidebar groups, in render order.
 *
 * The order is the working day, not the org chart: what you look at first sits
 * highest. `intelligence` is second rather than buried under a "reports"
 * heading because the evidence cockpit is what makes this product defensible,
 * and a feature you have to go looking for reads as an afterthought.
 */
export const DASHBOARD_GROUPS = Object.freeze([
  "overview",
  "intelligence",
  "inventory",
  "commercial",
  "finance",
  "operations",
  "governance",
] as const)

export type DashboardGroup = (typeof DASHBOARD_GROUPS)[number]

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export interface DashboardRoute {
  /**
   * Locale-less path, always starting `/dashboard`. The locale prefix is added
   * at render time by W1-C's `Link` — storing `/de/dashboard/units` here would
   * bake one locale into the config and break the other three.
   */
  href: string
  /**
   * Full next-intl key for the nav label. Never a literal string.
   *
   * These reuse the module namespaces W1-C already ships
   * (`dashboard.units.title`, `dashboard.finance.title`, …) rather than
   * introducing a parallel `dashboard.nav.*` block. Two keys for one label is
   * two things to translate and one of them to forget.
   *
   * `dashboard.deals.title` is the one exception — it does not exist yet and is
   * requested in HANDOFF/W3-B.md. The sidebar resolves labels through
   * `t.has()`, so a missing key degrades to the route's own name instead of
   * throwing and taking the whole nav down.
   */
  labelKey: string
  /** lucide-react export name. Resolved in `dashboard-sidebar.tsx`. */
  icon: string
  /** The permission that reveals this entry. */
  permission: Permission
  group: DashboardGroup
  /** The resource this route belongs to, for `dashboard-resource-access.ts`. */
  resource: Resource
  /**
   * True when the module that owns this route does not exist yet. It still
   * appears in the nav for a permitted role — with a "coming soon" affordance —
   * because silently omitting it would make the shell look complete when it is
   * not, and because the six module windows need to see their slot.
   */
  pending?: boolean
}

/**
 * Every dashboard route, in nav order within each group.
 *
 * A module window adds nothing here: its entry already exists, marked
 * `pending`. When the module lands, that flag comes off. That way the nav's
 * shape is settled now — while six windows are building against it — rather
 * than growing a row at a time.
 */
export const dashboardRoutes: readonly DashboardRoute[] = Object.freeze([
  // overview
  {
    href: "/dashboard",
    labelKey: "dashboard.shell.title",
    icon: "LayoutDashboard",
    permission: "dashboard:view",
    group: "overview",
    resource: "dashboard",
  },

  // intelligence
  {
    href: "/dashboard/evidence",
    labelKey: "dashboard.evidence.title",
    icon: "ShieldCheck",
    permission: "evidence:view",
    group: "intelligence",
    resource: "evidence",
    pending: true,
  },
  {
    href: "/dashboard/reports",
    labelKey: "dashboard.reports.title",
    icon: "FileBarChart",
    permission: "reports:view",
    group: "intelligence",
    resource: "reports",
    pending: true,
  },

  // inventory
  {
    href: "/dashboard/units",
    labelKey: "dashboard.units.title",
    icon: "Building2",
    permission: "units:view",
    group: "inventory",
    resource: "units",
    pending: true,
  },
  {
    href: "/dashboard/listings",
    labelKey: "dashboard.listings.title",
    icon: "Tags",
    permission: "listings:view",
    group: "inventory",
    resource: "listings",
    pending: true,
  },
  {
    href: "/dashboard/hotel",
    labelKey: "dashboard.hotel.title",
    icon: "Hotel",
    permission: "hotel:view",
    group: "inventory",
    resource: "hotel",
    pending: true,
  },
  {
    href: "/dashboard/reviews",
    labelKey: "dashboard.reviews.title",
    icon: "Star",
    permission: "reviews:view",
    group: "inventory",
    resource: "reviews",
    pending: true,
  },

  // commercial
  {
    href: "/dashboard/leads",
    labelKey: "dashboard.leads.title",
    icon: "UserPlus",
    permission: "leads:view",
    group: "commercial",
    resource: "leads",
    pending: true,
  },
  {
    href: "/dashboard/buyer-pipeline",
    labelKey: "dashboard.pipeline.title",
    icon: "Workflow",
    permission: "buyer_pipeline:view",
    group: "commercial",
    resource: "buyer_pipeline",
    pending: true,
  },
  {
    href: "/dashboard/deals",
    labelKey: "dashboard.deals.title",
    icon: "Handshake",
    permission: "deals:view",
    group: "commercial",
    resource: "deals",
    pending: true,
  },

  // finance
  {
    href: "/dashboard/finance",
    labelKey: "dashboard.finance.title",
    icon: "Landmark",
    permission: "finance:view",
    group: "finance",
    resource: "finance",
    pending: true,
  },
  {
    href: "/dashboard/wallet",
    labelKey: "dashboard.wallet.title",
    icon: "Wallet",
    permission: "wallet:view",
    group: "finance",
    resource: "wallet",
    pending: true,
  },
  {
    href: "/dashboard/vendor-invoices",
    labelKey: "dashboard.vendorInvoices.title",
    icon: "ReceiptText",
    permission: "vendor_invoices:view",
    group: "finance",
    resource: "vendor_invoices",
    pending: true,
  },

  // operations
  {
    href: "/dashboard/tickets",
    labelKey: "dashboard.tickets.title",
    icon: "TicketCheck",
    permission: "tickets:view",
    group: "operations",
    resource: "tickets",
    pending: true,
  },
  {
    href: "/dashboard/activities",
    labelKey: "dashboard.activities.title",
    icon: "Activity",
    permission: "activities:view",
    group: "operations",
    resource: "activities",
    pending: true,
  },
  {
    href: "/dashboard/calendar",
    labelKey: "dashboard.calendar.title",
    icon: "CalendarDays",
    permission: "calendar:view",
    group: "operations",
    resource: "calendar",
    pending: true,
  },
  {
    href: "/dashboard/communications",
    labelKey: "dashboard.communications.title",
    icon: "MessagesSquare",
    permission: "communications:view",
    group: "operations",
    resource: "communications",
    pending: true,
  },

  // governance
  {
    href: "/dashboard/documents",
    labelKey: "dashboard.documents.title",
    icon: "FolderOpen",
    permission: "documents:view",
    group: "governance",
    resource: "documents",
    pending: true,
  },
  {
    href: "/dashboard/compliance",
    labelKey: "dashboard.compliance.title",
    icon: "ClipboardCheck",
    permission: "compliance:view",
    group: "governance",
    resource: "compliance",
    pending: true,
  },
  {
    href: "/dashboard/users",
    labelKey: "dashboard.users.title",
    icon: "Users",
    permission: "users:view",
    group: "governance",
    resource: "users",
    pending: true,
  },
  {
    href: "/dashboard/settings",
    labelKey: "dashboard.settings.title",
    icon: "Settings",
    permission: "settings:view",
    group: "governance",
    resource: "settings",
    pending: true,
  },
])

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/** One group with the entries a role may actually see. Never emitted empty. */
export interface DashboardNavGroup {
  group: DashboardGroup
  routes: readonly DashboardRoute[]
}

/**
 * The routes a role may see, still in config order.
 *
 * Pure and synchronous on purpose: the sidebar recomputes it per render rather
 * than caching per session, because a role that changes mid-session must show
 * the new nav on the next navigation (W3-B brief, edge cases). Memoising this
 * for the session lifetime is the bug that edge case describes.
 */
export function routesForRole(role: Role): readonly DashboardRoute[] {
  return dashboardRoutes.filter((route) =>
    hasPermission(role, route.permission)
  )
}

/**
 * The nav, grouped, with empty groups dropped.
 *
 * Dropping empty groups matters: an `owner` sees four entries, and rendering
 * seven headings above them — three with nothing underneath — reads as a
 * broken page rather than a scoped one.
 */
export function navGroupsForRole(role: Role): readonly DashboardNavGroup[] {
  const visible = routesForRole(role)
  const groups: DashboardNavGroup[] = []

  for (const group of DASHBOARD_GROUPS) {
    const routes = visible.filter((route) => route.group === group)
    if (routes.length > 0) groups.push({ group, routes })
  }

  return groups
}

/** The index route. Matches EXACTLY — see `routeForPath`. */
const HOME_HREF = "/dashboard"

/**
 * The route record for a locale-less dashboard path, or `null`.
 *
 * Matches the LONGEST `href` the path starts with, so
 * `/dashboard/units/AZW-B01-0001` resolves to `units` rather than to whichever
 * route happens to come first in the array.
 *
 * THE INDEX ROUTE MATCHES ONLY EXACTLY, AND THAT IS A SECURITY PROPERTY, NOT A
 * TIDINESS ONE. `/dashboard` is a prefix of every dashboard path, so treating
 * it as a prefix match made `/dashboard/not-a-module` resolve to the home route
 * — and `decideDashboardAccess` then answered `allowed: true` for any role
 * holding `dashboard:view`. An unregistered path would have rendered as
 * permitted instead of 404ing, and a typo in a module's own folder name would
 * have looked like it worked. Caught by `scripts/dashboard-probe.mts`, which is
 * why the probe enumerates near-misses rather than only the happy path.
 */
export function routeForPath(pathWithoutLocale: string): DashboardRoute | null {
  const path = normalizeDashboardPath(pathWithoutLocale)

  let best: DashboardRoute | null = null
  for (const route of dashboardRoutes) {
    const matches =
      route.href === HOME_HREF
        ? path === HOME_HREF
        : path === route.href || path.startsWith(`${route.href}/`)

    if (matches && (best === null || route.href.length > best.href.length)) {
      best = route
    }
  }
  return best
}

/** Trailing slashes off, query and hash removed, always leading-slashed. */
export function normalizeDashboardPath(path: string): string {
  const withoutQuery = path.split("?")[0]?.split("#")[0] ?? ""
  const leading = withoutQuery.startsWith("/")
    ? withoutQuery
    : `/${withoutQuery}`
  if (leading.length > 1 && leading.endsWith("/")) return leading.slice(0, -1)
  return leading
}

/**
 * Where to send a role whose landing route it cannot see.
 *
 * Returns `null` when the role can see nothing at all — the shell renders the
 * no-access explanation rather than redirecting into a loop.
 */
export function firstAccessibleRoute(role: Role): DashboardRoute | null {
  return routesForRole(role)[0] ?? null
}
