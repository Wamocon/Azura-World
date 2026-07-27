# W3-B — Dashboard shell, navigation, KPI home

**Wave:** 3 · **Depends on:** W1-B, W1-C, W1-D, W2-A, W2-B, W2-D · **Runs with:** all other W3-*

> Read `SYSTEM-PROMPT.md`, `CONVENTIONS.md`, `HANDOFF/W1-B.md` (permission matrix),
> `HANDOFF/W2-D.md` (`useLiveSnapshot`). Then read
> `D:\Real Estate CRM\Cati\apps\web\app\[locale]\dashboard\layout.tsx`,
> `dashboard-sidebar.tsx`, `dashboard-topbar.tsx`, `dashboard-route-guard.tsx`.

---

## Mission

The frame every other W3 module hangs inside. You own the shell, the navigation, the role-aware
home, and the global search. Six sibling windows are building modules into your layout at the
same time — so the shell must be **finished and stable early**, and its contract with modules
must be explicit.

---

## Files you own

```
apps/web/app/[locale]/dashboard/layout.tsx · page.tsx
apps/web/app/[locale]/dashboard/dashboard-{sidebar,topbar,route-guard}.tsx
apps/web/components/dashboard/*    (section, kpi-card, command-ribbon, action-button,
                                    refresh-button, data-table, empty-state, global-search)
apps/web/lib/dashboard-routing.ts · dashboard-resource-access.ts · dashboard-home-copy.ts
HANDOFF/W3-B.md
```

Modules own their own route folders. You own **only** the shell and `dashboard/page.tsx`.

---

## Deliverables

### 1. Shell

Sidebar (collapsible, persisted), topbar (locale switcher, theme toggle, sync badge, user menu,
global search), content area, route guard.

**`dashboard-route-guard.tsx` is defence in depth, not the boundary.** `proxy.ts` (W1-B) is the
real guard. Never let the client guard be the only thing between a user and data.

### 2. Navigation — permission-filtered

Read `lib/rbac.ts`. Show only resources the role can `view`. Nav config lives in
`dashboard-routing.ts` as data, so modules can register without editing the sidebar component:

```ts
export const dashboardRoutes: DashboardRoute[] = [
  { href: "/dashboard",            icon: "LayoutDashboard", permission: "dashboard:view", group: "overview" },
  { href: "/dashboard/evidence",   icon: "ShieldCheck",     permission: "evidence:view",  group: "intelligence" },
  { href: "/dashboard/units",      icon: "Building2",       permission: "units:view",     group: "inventory" },
  // ... all 18
]
```

Groups: `overview · intelligence · inventory · commercial · finance · operations · governance`.

### 3. `dashboard/page.tsx` — role-aware home

Different roles need different first screens. Same shell, different content:

| Role | Lands on |
|---|---|
| `admin` | System health, evidence coverage, user activity, all KPIs |
| `manager` | Site KPIs, availability, open tickets, conflicts needing review |
| `accountant` | Ledger summary, outstanding payments, invoices |
| `staff` | My assigned tasks, today's activities |
| `owner` | My units, my finance position, my documents |
| `tenant` | My unit, my tickets, my payments |
| `service_provider` | Assigned work orders only |
| `guest` | Public information + access request |
| `child_*` | Read-only subset of the guardian's view |

Every KPI card renders through `useLiveSnapshot` and shows the sync badge state.

### 4. `data-table.tsx` — the workhorse

Six modules use this. Build it once, properly:

- Server-side pagination, sort, filter — never load 656 rows to filter client-side
- **Virtualised body** above 100 rows
- Column visibility, persisted per user
- Row selection + bulk actions, permission-gated
- CSV export, permission-gated, respecting the current filter
- **Four states**: loading skeleton / empty-with-explanation / error-with-retry / populated
- Keyboard: arrows, Enter, Escape, and full tab order
- **Renders `SourcedFact` cells through W1-D's `ProvenanceValue`** — this is how provenance
  reaches every table in the app

### 5. Global search — Cmd/Ctrl-K

Hits `/api/site-management/search`, role-scoped. Debounced 200ms, keyboard-first, deep-links to
records. Grouped by entity type.

---

## Edge cases

- **Role with no accessible resources** → coherent empty state explaining why and who to contact.
  Not a blank sidebar, not a crash.
- **Deep link to a forbidden module** → 403 page. Not a redirect to `/dashboard` (confusing) and
  not a redirect loop.
- **Role changes mid-session** → nav updates on next navigation. Do not cache for session lifetime.
- **Sidebar collapse state** → persisted, and must not cause layout shift on load (CLS).
- **German nav labels overflow** the collapsed sidebar → truncate with a title tooltip.
- **Mobile**: sidebar becomes a sheet. Must trap focus and close on route change.
- **Sync badge in `static` mode** → "Demo-Daten", unmistakable. Never let seed data read as live.
- **A KPI whose repository call fails** → that card shows an error state; the rest of the
  dashboard still renders. Never fail the whole page for one panel.
- **A KPI backed by a `gap` fact** → "—" with an explanation, never `0`.
- **656-row table on mobile** → virtualisation must work under touch scroll.
- **Two tabs, different collapse states** → localStorage, last write wins, no coordination.
- **Very long user name / email** in the topbar → truncate, do not wrap the bar.

---

## Definition of done

```bash
pnpm --dir apps/web typecheck && pnpm --dir apps/web lint && pnpm --dir apps/web build
```

Plus, output pasted:
1. **All 11 roles × the dashboard home render** — no crash, no blank, correct nav set for each.
   Enumerate programmatically; do not spot-check three roles.
2. Deep link to a forbidden route → 403 for every role that lacks it
3. `data-table` with 656 rows → measure DOM node count, prove virtualisation
4. All four table states screenshotted
5. Cmd/K opens, searches, deep-links, closes on Escape
6. Sync badge in all four modes
7. Mobile 375px: sidebar sheet opens, traps focus, closes on navigation
8. Keyboard-only path: login → dashboard → module → table row → detail, no mouse

---

## Handoff must state

- **The module contract**: the exact layout/props/slots the six module windows build against.
  Publish this early — they are blocked on it.
- `dashboardRoutes` config shape, so modules can register
- `data-table` API in full
- Which KPI cards exist and which repository each calls
