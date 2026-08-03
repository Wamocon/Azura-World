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
 * highest.
 *
 * ## Why `intelligence` moved from second to last
 *
 * It sat second, and the reason given was that the evidence cockpit is what
 * makes this product defensible. That was true while this was a competitor
 * dossier. PIVOT.md changed the reader to Azura World's own management, and a
 * property manager does not open a source register in the morning — they open
 * the overnight work orders, then what is owed, then the inventory. Benchmarked
 * against the category (AppFolio, Buildium, Yardi, Entrata), the daily routine
 * is work orders, then delinquency, then occupancy, in that order.
 *
 * So `operations` leads, `inventory` and `finance` follow, and the analyst
 * surfaces sit at the bottom where a specialist will still find them. Nothing
 * is removed: this is an order, not a deletion, and the evidence cockpit is one
 * click away for the person whose job it actually is.
 */
export const DASHBOARD_GROUPS = Object.freeze([
  "overview",
  "operations",
  "inventory",
  "finance",
  "commercial",
  "governance",
  "intelligence",
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
  },
  {
    href: "/dashboard/reports",
    labelKey: "dashboard.reports.title",
    icon: "FileBarChart",
    permission: "reports:view",
    group: "intelligence",
    resource: "reports",
  },

  // inventory
  {
    href: "/dashboard/units",
    labelKey: "dashboard.units.title",
    icon: "Building2",
    permission: "units:view",
    group: "inventory",
    resource: "units",
  },
  {
    href: "/dashboard/listings",
    labelKey: "dashboard.listings.title",
    icon: "Tags",
    permission: "listings:view",
    group: "inventory",
    resource: "listings",
  },
  {
    href: "/dashboard/hotel",
    labelKey: "dashboard.hotel.title",
    icon: "Hotel",
    permission: "hotel:view",
    group: "inventory",
    resource: "hotel",
  },
  {
    href: "/dashboard/reviews",
    labelKey: "dashboard.reviews.title",
    icon: "Star",
    permission: "reviews:view",
    group: "inventory",
    resource: "reviews",
  },

  // commercial
  {
    href: "/dashboard/leads",
    labelKey: "dashboard.leads.title",
    icon: "UserPlus",
    permission: "leads:view",
    group: "commercial",
    resource: "leads",
  },
  {
    href: "/dashboard/buyer-pipeline",
    labelKey: "dashboard.pipeline.title",
    icon: "Workflow",
    permission: "buyer_pipeline:view",
    group: "commercial",
    resource: "buyer_pipeline",
  },
  // M-009 — `/dashboard/deals` REMOVED from the navigation.
  //
  // It had no `page.tsx`, no `dashboard.deals.title` in any of the four
  // catalogues, and no repository behind it. The sidebar's `t.has()` fallback
  // degraded the missing label to the route slug, so every role with
  // `deals:view` saw the lowercase English word "deals" sitting among German
  // labels, leading to a 404.
  //
  // **Removed rather than built.** Building it would mean inventing a deals
  // dataset: `lib/lead-repository.ts` computes `dealTotalsByCurrency` INSIDE
  // the buyer-pipeline summary, so what a "deal" is here is already a property
  // of a pipeline entry and is already on `/dashboard/buyer-pipeline`. A second
  // screen would have had to fabricate rows to fill itself, which
  // SYSTEM-PROMPT §2.3 forbids outright. An entry that leads nowhere is a
  // smaller defect than a screen of invented money.
  //
  // **`deals` stays a resource.** `lib/contracts.ts` and `lib/rbac.ts` are
  // untouched: the six `deals:*` permissions remain valid and five roles still
  // hold them. Only the nav offer is withdrawn. Re-adding this is one record in
  // this array plus a `dashboard.deals.title` in four files, and the module
  // window that builds it does exactly what every other module window did.

  // finance
  // The three finance routes shipped in W3-D. Per W3-B's module contract the
  // whole registration is deleting `pending` from the entry that already
  // existed; nothing else in this file is this task's to touch.
  {
    href: "/dashboard/finance",
    labelKey: "dashboard.finance.title",
    icon: "Landmark",
    permission: "finance:view",
    group: "finance",
    resource: "finance",
  },
  {
    href: "/dashboard/wallet",
    labelKey: "dashboard.wallet.title",
    icon: "Wallet",
    permission: "wallet:view",
    group: "finance",
    resource: "wallet",
  },
  {
    href: "/dashboard/vendor-invoices",
    labelKey: "dashboard.vendorInvoices.title",
    icon: "ReceiptText",
    permission: "vendor_invoices:view",
    group: "finance",
    resource: "vendor_invoices",
  },

  // operations
  {
    href: "/dashboard/tickets",
    labelKey: "dashboard.tickets.title",
    icon: "TicketCheck",
    permission: "tickets:view",
    group: "operations",
    resource: "tickets",
  },
  {
    href: "/dashboard/activities",
    labelKey: "dashboard.activities.title",
    icon: "Activity",
    permission: "activities:view",
    group: "operations",
    resource: "activities",
  },
  {
    href: "/dashboard/calendar",
    labelKey: "dashboard.calendar.title",
    icon: "CalendarDays",
    permission: "calendar:view",
    group: "operations",
    resource: "calendar",
  },
  {
    href: "/dashboard/communications",
    labelKey: "dashboard.communications.title",
    icon: "MessagesSquare",
    permission: "communications:view",
    group: "operations",
    resource: "communications",
  },

  // governance
  {
    href: "/dashboard/documents",
    labelKey: "dashboard.documents.title",
    icon: "FolderOpen",
    permission: "documents:view",
    group: "governance",
    resource: "documents",
  },
  {
    href: "/dashboard/compliance",
    labelKey: "dashboard.compliance.title",
    icon: "ClipboardCheck",
    permission: "compliance:view",
    group: "governance",
    resource: "compliance",
  },
  {
    href: "/dashboard/users",
    labelKey: "dashboard.users.title",
    icon: "Users",
    permission: "users:view",
    group: "governance",
    resource: "users",
  },
  {
    href: "/dashboard/settings",
    labelKey: "dashboard.settings.title",
    icon: "Settings",
    permission: "settings:view",
    group: "governance",
    resource: "settings",
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
