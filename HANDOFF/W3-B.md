# HANDOFF — W3-B  Dashboard shell, navigation, KPI home

STATUS: PARTIAL — **the module contract below is FINAL and safe to build against**
Published early: 2026-07-28 (contract) · Task still in progress
Branch: `feature/INTERNAL-107-w3b-shell` · Worktree: `D:\azura-w3b`

> **W3-C and W3-G: this section is what you are waiting for.** Everything under
> "THE MODULE CONTRACT" is written, typechecks and lints clean, and will not
> change shape. The rest of the task — the role-aware home, the probes, the
> screenshots — is still in progress and cannot alter these signatures.

---

## THE MODULE CONTRACT

### 1. What the shell gives you

Your route file is `app/[locale]/dashboard/<module>/page.tsx`. It renders
**inside** the shell, which already provides:

- the sidebar, topbar, locale switcher, sign-out and global search
- `<UserProvider>` — call `useUser()` in any client component beneath you
- the client route guard, which 403s a role that lacks your route's permission
- `<main>` with the page padding

You render **page content only**. No `<html>`, no `<body>`, no sidebar, no
`<UserProvider>`.

**Write a plain `page.tsx` with no rendering-mode export.** W-INT §4: the root
layout reads `headers()`, so every route beneath it is already dynamic. Adding
`export const dynamic = "force-static"`, `export const revalidate`, or a
build-time `generateStaticParams` ships a page with **zero working JavaScript**
— a prerendered document has no CSP nonce and `strict-dynamic` blocks every
script. `pnpm qa:csp` fails the build if you do. Verify under `next start`,
never `next dev`.

### 2. Registering in the navigation

**You do not edit the sidebar, and you do not add a route.** Your entry already
exists in `lib/dashboard-routing.ts`, marked `pending: true`. When your module
lands, delete that one flag. That is the whole registration.

```ts
export interface DashboardRoute {
  href: string          // locale-less, e.g. "/dashboard/units"
  labelKey: string      // e.g. "dashboard.units.title" — an existing W1-C key
  icon: string          // lucide-react export name, resolved in the sidebar
  permission: Permission // e.g. "units:view" — from CONTRACTS §3
  group: DashboardGroup
  resource: Resource
  pending?: boolean
}
```

Groups, in render order: `overview · intelligence · inventory · commercial ·
finance · operations · governance`. Empty groups are dropped, so a role that
sees four entries gets one heading, not seven.

### 3. Guarding your route — **server-side, in your own page**

The client guard is defence in depth. **It is not your boundary.** Do this at
the top of your Server Component:

```ts
import { decideDashboardAccess } from "@/lib/dashboard-resource-access"
import { getUserProfile } from "@/lib/auth"

const profile = await getUserProfile()
const decision = decideDashboardAccess(
  "/dashboard/units",
  profile.role,
  profile.authenticated,
)
if (!decision.allowed) {
  // 403, NOT a redirect. See "Why 403" below.
}
```

`decideDashboardAccess` returns a discriminated union whose denial reason is one
of `forbidden` · `unauthenticated` · `unknown_route`, kept apart because they
need different pages.

**Why 403 and not a redirect.** The brief forbids the redirect, and the 1Çatı
reference does it anyway (`router.replace("/dashboard")` alongside its panel).
Three reasons it is wrong here: it destroys the URL the user was trying to
reach, so they cannot pass it to someone who has access; it loops for any role
that also lacks `dashboard:view`; and it races the explanation panel it renders
beside, so the user reads a reason and then loses it.

### 4. `<DataTable>` — the full API

`components/dashboard/data-table.tsx`. Import `DataTable`, `DataTableColumn`,
`DataTableProps`, `DataTableSort`, `DataTableBulkAction`, `DataTableLabels`,
`VIRTUALISE_ABOVE`.

```tsx
<DataTable
  rows={rows}                   // the CURRENT PAGE. never the whole dataset
  columns={columns}
  getRowId={(u) => u.id}
  labels={tableLabels}          // DataTableLabels — see lib/dashboard-home-copy.ts
  locale={locale}
  provenanceLabels={provenance} // W1-D's ProvenanceLabels

  state={state}                 // "loading" | "error" | "empty" | "ready"
  empty={<EmptyState … />}      // REQUIRED
  error={<ErrorState … />}      // REQUIRED

  totalRows={total}             // exact count across all pages, or null

  sort={sort} onSortChange={setSort}
  selectedIds={selected} onSelectionChange={setSelected}
  bulkActions={actions}
  can={can}                     // from useUser(); gates bulk actions + export
  onExportCsv={exportCsv} exportPermission="units:export"
  columnVisibilityKey="azura.units.columns"
  rowHeight={44} height={520}
  onRowActivate={(u) => router.push(`/dashboard/units/${u.id}`)}
/>
```

**Columns are a discriminated union, and `kind: "fact"` is the important one:**

```ts
{ kind: "text",   id, header, value: (row) => string | null, … }
{ kind: "number", id, header, value: (row) => number | null, formatOptions?, … }
{ kind: "fact",   id, header, fact:  (row) => SourcedFact<unknown> | null, format?, … }
{ kind: "custom", id, header, render:(row) => ReactNode, … }
```

A `fact` column hands the fact to W1-D's `ProvenanceValue`. **This is how
provenance reaches every table in the app.** The extractor returns the *fact*,
not its value, so a module cannot print `fact.value` and silently drop the
citation. A `gap` renders "—", never `0`; a conflict shows its amber badge in
the row. CONTRACTS §8 lists "a number in JSX with no source" as a review
rejection — use `kind: "fact"` and you cannot commit one.

`text` and `number` columns render `labels.noValue` ("—") for `null`. **Never
map a missing number to `0` before passing it in.**

Other guarantees:

| | |
|---|---|
| Virtualisation | Automatic above **100 rows** (`VIRTUALISE_ABOVE`). 656 units renders ~23 `<tr>`. |
| Four states | `empty` and `error` are **required props** — a populated-only table cannot be written. |
| Sort | Server-side. `onSortChange` emits intent; cycles asc → desc → unsorted. `aria-sort` is set. |
| Pagination / filter | Server-side. This component never fetches and never sorts a full dataset. |
| Column visibility | Persisted per user via `columnVisibilityKey`, through `useSyncExternalStore` — so it also syncs across tabs. Omit the key to disable. |
| Selection | `selectedIds` / `onSelectionChange`. Bulk actions are withheld entirely when the role lacks their `permission`, never shown disabled. |
| CSV export | `onExportCsv` is yours to implement — it must respect the **current filter**, which is why the component does not do it for you. Gated by `exportPermission`. |
| Keyboard | Sortable headers are buttons; rows are focusable and Enter-activatable when `onRowActivate` is given. |

**What it deliberately does not do: fetch.** You own your `useLiveSnapshot`,
and therefore your channels, your polling and your sync badge — none of which
this component can choose correctly on your behalf.

### 5. Page layout primitives

`components/dashboard/section.tsx` — Server Components:

```tsx
<DashboardPageHeader
  title={t("units.title")}     // owns the single <h1> on your page
  description={…}
  actions={<RefreshButton … />}
  meta={<SyncBadge mode={mode} lastUpdated={lastUpdated} locale={locale} />}
/>
<DashboardSection title={…} description={…}>…</DashboardSection>
<DashboardKpiGrid>…</DashboardKpiGrid>
```

Your page has **one `<h1>`**, from `DashboardPageHeader`. `DashboardSection`
renders `<h2>`.

### 6. `<KpiCard>`

`components/dashboard/kpi-card.tsx`. Either a sourced fact or a plain count —
the union makes it impossible to pass a sourced figure as a bare number:

```tsx
<KpiCard kind="fact"  label={…} state="ready" fact={project.totalUnits}
         format="number" provenanceLabels={p} labels={kpiLabels} locale={locale} />

<KpiCard kind="count" label={…} state="ready" value={snapshot.evidence.totalFindings}
         labels={kpiLabels} locale={locale} />
```

`state` is `"loading" | "ready" | "restricted" | "failed"`, mirroring
`getDashboardSnapshot()`'s three absence lists. **Keep them apart**: `restricted`
is the correct answer for a role and offers no retry; `failed` broke and offers
one; `truncated` loaded but its proportions come from a bounded sample. A failing
card renders its failure at card size — **it never takes the page down**.

### 7. Sync badge — put it on the surface, not in the topbar

The topbar carries **no** sync badge, deliberately: it spans a page that may
hold several surfaces in different modes, so one badge up there would be wrong
about the rest. Put `<SyncBadge>` in your `DashboardPageHeader`'s `meta`, and on
each KPI card via its `mode` / `lastUpdated` props. Render W2-D's
`<ConnectionBanner>` **once per page** — it describes the connection, not a
surface.

### 8. Copy

Nav labels reuse W1-C's existing `dashboard.<module>.title` keys — no new
catalogue entries were needed. Shell copy the catalogue does not carry (group
headings, the 403 body, table chrome, KPI labels) lives in
`lib/dashboard-home-copy.ts` as a `Record<Locale, …>` in all four languages.
`shellCopy(locale)` and `fill(template, values)` are the accessors.

---

## Verification so far

| Command | Result |
|---|---|
| `pnpm --dir apps/web typecheck` | **PASS** exit 0, whole tree |
| `pnpm --dir apps/web lint` | **PASS** exit 0, whole tree, 0 errors 0 warnings |
| `pnpm --dir apps/web build` | **NOT RUN YET** |
| `pnpm qa:csp` | **NOT RUN YET** — required before this task closes |
| 11 roles × 21 routes | **NOT RUN YET** — `scripts/dashboard-probe.mts`, in progress |

Five React-Compiler lint errors were found and fixed rather than suppressed:
three `set-state-in-effect` and two `preserve-manual-memoization`. The
column-visibility store became a `useSyncExternalStore`, which removed a real
flicker (default columns painting before the saved ones) and gained cross-tab
sync; the search's too-short-query branch became derived state, which removed a
flash of the previous query's hits while deleting characters.

---

## Requests for other windows

| File | Owner | What is needed |
|---|---|---|
| `messages/*.json` | **W1-C** | `dashboard.deals.title` in all four locales — the only nav label with no key. The sidebar resolves labels through `t.has()`, so today it degrades to `"deals"` rather than throwing, but that is a fallback and not a translation. |
| `app/api/site-management/search` | **W2-B** | Global search calls `GET /api/site-management/search?q=…` and expects `ApiResponse<{ hits: GlobalSearchHit[] }>` with `{ id, entity: "units"\|"tickets"\|"documents"\|"people", title, subtitle?, href }`. **Role scoping must happen server-side** — the client sends no role, by design. Until it exists the search shows its error state, which is deliberate: falling back to filtering a local list would make "no such unit" indistinguishable from "not loaded". |
| `messages/*.json` | **W1-C** | Eventually, the ~40 keys now in `lib/dashboard-home-copy.ts` should migrate into the catalogue. They are there because editing four files you own while you are working in them collides (ORCHESTRATION §4), not because a second copy layer is desirable. |

---

*The rest of this handoff — role-aware home, the 11 × 21 matrix, the four
table states, Cmd/K, mobile, and the keyboard path — is appended when the task
completes.*
