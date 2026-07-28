# HANDOFF — W3-B Dashboard shell, navigation, KPI home

STATUS: COMPLETE
Contract published early: 2026-07-28 · Completed: 2026-07-28
Branch: `feature/INTERNAL-107-w3b-shell` · Worktree: `D:\azura-w3b`

> **W3-C and W3-G: "THE MODULE CONTRACT" below is what you are waiting for.**
> It was published before the rest of the task and has not changed since.

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
  href: string; // locale-less, e.g. "/dashboard/units"
  labelKey: string; // e.g. "dashboard.units.title" — an existing W1-C key
  icon: string; // lucide-react export name, resolved in the sidebar
  permission: Permission; // e.g. "units:view" — from CONTRACTS §3
  group: DashboardGroup;
  resource: Resource;
  pending?: boolean;
}
```

Groups, in render order: `overview · intelligence · inventory · commercial ·
finance · operations · governance`. Empty groups are dropped, so a role that
sees four entries gets one heading, not seven.

### 3. Guarding your route — **server-side, in your own page**

The client guard is defence in depth. **It is not your boundary.** Do this at
the top of your Server Component:

```ts
import { decideDashboardAccess } from "@/lib/dashboard-resource-access";
import { getUserProfile } from "@/lib/auth";

const profile = await getUserProfile();
const decision = decideDashboardAccess(
  "/dashboard/units",
  profile.role,
  profile.authenticated,
);
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
provenance reaches every table in the app.** The extractor returns the _fact_,
not its value, so a module cannot print `fact.value` and silently drop the
citation. A `gap` renders "—", never `0`; a conflict shows its amber badge in
the row. CONTRACTS §8 lists "a number in JSX with no source" as a review
rejection — use `kind: "fact"` and you cannot commit one.

`text` and `number` columns render `labels.noValue` ("—") for `null`. **Never
map a missing number to `0` before passing it in.**

Other guarantees:

|                     |                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Virtualisation      | Automatic above **100 rows** (`VIRTUALISE_ABOVE`). Measured: 656 rows render **25 `<tr>`**.                                                                   |
| Four states         | `empty` and `error` are **required props** — a populated-only table cannot be written.                                                                        |
| Sort                | Server-side. `onSortChange` emits intent; cycles asc → desc → unsorted. `aria-sort` is set.                                                                   |
| Pagination / filter | Server-side. This component never fetches and never sorts a full dataset.                                                                                     |
| Column visibility   | Persisted per user via `columnVisibilityKey`, through `useSyncExternalStore` — so it also syncs across tabs. Omit the key to disable.                         |
| Selection           | `selectedIds` / `onSelectionChange`. Bulk actions are withheld entirely when the role lacks their `permission`, never shown disabled.                         |
| CSV export          | `onExportCsv` is yours to implement — it must respect the **current filter**, which is why the component does not do it for you. Gated by `exportPermission`. |
| Keyboard            | Sortable headers are buttons; rows are focusable and Enter-activatable when `onRowActivate` is given.                                                         |

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

## Verification actually run

| Command                                 | Result                           | Evidence                                                            |
| --------------------------------------- | -------------------------------- | ------------------------------------------------------------------- |
| `pnpm --dir apps/web typecheck`         | **PASS** exit 0                  | `tsc --noEmit`, whole tree, no output                               |
| `pnpm --dir apps/web lint`              | **PASS** exit 0                  | `eslint`, whole tree, 0 errors 0 warnings                           |
| `pnpm --dir apps/web build`             | **PASS** exit 0                  | `/[locale]/dashboard` emits as **f (Dynamic)** — W-INT §4 satisfied |
| `pnpm qa:dashboard`                     | **PASS** — **647 pass · 0 fail** | 11 roles × 21 routes = **231 cells**, enumerated                    |
| `pnpm qa:csp`                           | **PASS** — **21 pass · 0 fail**  | production build + `next start` + Chromium                          |
| Browser acceptance, Chromium            | **PASS** — **104 pass · 0 fail** | all 11 roles; output below                                          |
| End-to-end 403 on a forbidden deep link | **NOT PROVEN**                   | see "The one gap"                                                   |

### `pnpm qa:dashboard` — the full matrix, enumerated not sampled

```
matrix cells crossed: 231 (11 roles x 21 routes)
nav size by role: admin=21 manager=21 accountant=12 staff=13 owner=13
                  tenant=12 guest=8 service_provider=8 child_owner=9
                  child_tenant=9 child_guest=7
647 pass . 0 fail
```

It asserts, for **every** cell: the nav offers exactly what `hasPermission`
permits; the server decision agrees with the nav; and every refusal carries
`reason === "forbidden"`. Plus additive authority in the nav (a route offered
to a child but not its guardian would be an escalation via the sidebar) with a
non-vacuity control, path resolution including near-misses, and a floor of 500
assertions so the suite fails if it ever stops checking.

**It found a real defect on its first run.** `routeForPath()` treated
`/dashboard` as a prefix — and `/dashboard` is a prefix of every dashboard
path — so `/dashboard/not-a-module` resolved to the home route and
`decideDashboardAccess()` answered `allowed: true` for any role holding
`dashboard:view`. An unregistered path rendered as permitted instead of
404ing. The index route now matches exactly.

### Browser acceptance — all 11 roles

```
1. All 11 roles render the dashboard home
   every role: status 200 . 0 page errors . non-blank . >=1 KPI card . non-empty nav
   KPI cards: admin=12 manager=7 accountant=3 staff=4 owner=4 tenant=3
              guest=2 service_provider=2 child_owner=2 child_tenant=2 child_guest=1
   nav size genuinely varies by role - 7 distinct sizes

3. DataTable: 656 rows
   25 <tr> in the DOM for 656 rows . count "656 von 656" . 521 nodes in the subtree
   a gap price renders an em dash, never 0
   all four states render explanatory content   (screenshots attached)

4. Cmd/K global search
   Ctrl+K opens . focus lands in the input . Escape closes
   a query with no endpoint shows an explanation, not a false empty

5. Sidebar collapse
   256px -> 64px . cookie persisted . reload observed ONE width (64) - no layout shift

6. Mobile 375px
   rail hidden . sheet opens . focus trapped inside . closes on navigation
   no horizontal page scroll (scrollWidth=375)

7. Keyboard-only
   a sidebar link reachable in 2 Tab hops
   focus ring present: rgb(17, 136, 180) 0px 0px 0px 2px   (the --ring token)

104 pass . 0 fail
```

**The role verification runs against `next dev --webpack`, not `next start`,
and that is forced rather than lazy.** Switching roles needs W1-B's QA
access-profile cookie, and `accessProfilesEnabledForEnvironment()` returns
`false` for any production runtime **before it reads a single flag** — that is
the security control working exactly as designed, not a gap in this task.
Production behaviour is covered separately and fully by `pnpm qa:csp` (21/0),
which drives a real `next start` and proves scripts are nonced, JavaScript
executes and React hydrates.

### Defects found by running it, not by reading it

1. **Escape did not close the global search.** `<input type="search">`
   consumes Escape to clear its own value and Chromium never lets it reach the
   `<dialog>` — and the dialog focuses that input on open, so the platform's
   close-on-Escape silently never fired. Handled explicitly now.
2. **`routeForPath`'s prefix bug**, above.
3. **My own focus-ring assertion was wrong.** Tailwind emits a list of
   shadows, most of them transparent placeholders; the check rejected the whole
   string on its first entry and reported a missing ring that was there all
   along. The assertion was fixed, not the CSS.

Five React-Compiler lint errors were also found and fixed rather than
suppressed: three `set-state-in-effect` and two `preserve-manual-memoization`.
The column-visibility store became a `useSyncExternalStore`, which removed a
real flicker (default columns painting before the saved ones) and gained
cross-tab sync; the search's too-short-query branch became derived state,
which removed a flash of the previous query's hits while deleting characters.

---

## The one gap: end-to-end 403

**Proven:** the decision, exhaustively — 231 cells, every forbidden case
asserting `reason === "forbidden"`, plus the guard component that renders it.

**Not proven:** the 403 actually appearing in a browser, because
`/dashboard/evidence` and `/dashboard/users` **have no `page.tsx` yet**. Next
answers an unmatched path from the ROOT not-found, outside
`dashboard/layout.tsx`, so `DashboardRouteGuard` never runs and those paths
404 today. Measured: 18 of 18 forbidden deep links showed no 403 panel.

**What I tried, and why it was reverted.** A dynamic segment (`[...slug]`,
then `[moduleSlug]`) pulls those paths inside the shell and makes the 403 fire.
Both work. Both also make `@next/next/no-html-link-for-pages` treat `/de/` as a
page, which turns two `<a href="/de/">` links in **W0-A's** `app/not-found.tsx`
and `app/global-error.tsx` into lint **errors** — files this task does not own,
in a tree that must stay green. Verified both directions: with the segment,
lint exits 1 on those two files; without it, 0. Leaving the tree red in someone
else's files is worse than the gap, so the segment was removed and the gap is
reported here.

**It closes by itself.** The moment W3-C, W3-F or any module ships a
`page.tsx`, that route renders inside the shell and the guard 403s for every
role lacking the permission. No further work is needed in the shell.

What the browser run still proves today: a forbidden deep link **leaks no
module content** and is **never redirected** — the URL survives, which is the
property the brief's no-redirect rule exists to protect.

---

## Requests for other windows

| File                                        | Owner    | What is needed                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `messages/*.json`                           | **W1-C** | `dashboard.deals.title` in all four locales — the only nav label with no key. The sidebar resolves labels through `t.has()`, so today it degrades to `"deals"` rather than throwing, but that is a fallback and not a translation.                                                                                                                                                                                                                                      |
| `app/api/site-management/search`            | **W2-B** | Global search calls `GET /api/site-management/search?q=…` and expects `ApiResponse<{ hits: GlobalSearchHit[] }>` with `{ id, entity: "units"\|"tickets"\|"documents"\|"people", title, subtitle?, href }`. **Role scoping must happen server-side** — the client sends no role, by design. Until it exists the search shows its error state, which is deliberate: falling back to filtering a local list would make "no such unit" indistinguishable from "not loaded". |
| `messages/*.json`                           | **W1-C** | Eventually, the ~40 keys now in `lib/dashboard-home-copy.ts` should migrate into the catalogue. They are there because editing four files you own while you are working in them collides (ORCHESTRATION §4), not because a second copy layer is desirable.                                                                                                                                                                                                              |
| `app/not-found.tsx`, `app/global-error.tsx` | **W0-A** | Switch `<a href="/de/">` to next-intl's `<Link>`. Not cosmetic: while those stay `<a>`, **no window can add a dynamic segment under `app/[locale]/dashboard/`** without turning them into lint errors. That is what blocked the shell's fallback route (see "The one gap"), and it will block the next person the same way. Two lines.                                                                                                                                  |

---

## Which KPI card calls which repository

Every card on the home reads **one** call: `getDashboardSnapshot({ role,
profileId })` from `lib/dashboard-repository.ts`, which fans out internally
with `Promise.allSettled` so one failing panel degrades that panel and not the
page.

| Card                  | Snapshot panel | Field                                         |
| --------------------- | -------------- | --------------------------------------------- |
| Wohneinheiten         | `inventory`    | `totalUnits`                                  |
| Davon modelliert      | `inventory`    | `modelledUnits` (hint shows `/ totalUnits`)   |
| Davon Portal-Inserate | `inventory`    | `portalListingUnits`                          |
| Offene Tickets        | `operations`   | `totalTickets`                                |
| SLA überschritten     | `operations`   | `overdueTickets`                              |
| Befunde               | `evidence`     | `totalFindings`                               |
| Kritische Befunde     | `evidence`     | `findingsBySeverity.critical`                 |
| Nicht belegte Angaben | `evidence`     | `factsByConfidence.gap` (hint `/ totalFacts`) |
| Geprüfte Quellen      | `evidence`     | `totalSources`                                |
| Buchungen             | `finance`      | `totalEntries`                                |
| Hotelzimmer           | `hotel`        | `roomCount`                                   |
| Bewertungsportale     | `hotel`        | `reviewSourceCount`                           |

Which cards a role is offered is an **exhaustive `Record<Role, KpiId[]>`** in
`dashboard/page.tsx`. Deliberately not the 1Çatı reference's if-chain: that
branches every less-privileged role out above a default which falls through to
the **admin** surface, so a role added to the matrix and forgotten lands on the
most privileged screen. A `Record` makes the same omission a compile error.

`operations` and `finance` read 0 in seed mode because `supabase/seed.sql` has
no tickets and no ledger entries — W2-A's open `[GAP]`, not a bug here. Those
are real zeroes from a real empty table, not `null` coerced to `0`; a `null`
panel renders an em dash.

---

## Known gaps

- **`[GAP]` End-to-end 403** — see the dedicated section above. Decision proven
  exhaustively; browser observation blocked until the first module ships a
  `page.tsx`.
- **`[GAP]` `useLiveSnapshot` is not used by the KPI cards.** Its fetcher runs
  in the browser, every W2-A repository reaches `lib/supabase/server.ts`, and
  that module throws at load in a browser by design. The route it would need is
  W2-B's, which is not started. The home server-renders and refreshes with
  `router.refresh()`, which re-runs the Server Component and therefore goes
  through RLS. **The badge can reach `polling`, `static` and `offline` and never
  claims `realtime`** — claiming "Live" while nothing arrives is the exact
  silent stall W2-D built the badge to prevent.
- **`[GAP]` CSV export is a callback, not an implementation.** `onExportCsv` is
  the module's, because the export must respect the module's current filter and
  this component never sees it.
- **`[GAP]` Global search has no endpoint.** It calls
  `/api/site-management/search` (W2-B, not started) and renders its error state.
  Deliberately no local fallback: filtering an in-browser list would make "no
  such unit exists" indistinguishable from "not loaded".
- **`[GAP]` `dashboard.deals.title` does not exist**, so that nav entry renders
  the literal `deals`. It degrades rather than throwing (`t.has()`), and it is
  visible in the attached screenshot.
- **`[GAP]` No screen-reader pass.** Semantics are correct by construction —
  `aria-sort` on sortable headers, `aria-current="page"` on the active nav item,
  `role="alert"` on the 403, a `<caption>` on every table, `aria-rowcount`
  reporting the full list rather than the window — but nothing was driven with
  NVDA or VoiceOver.
- **Dev-only `<DataTable>` harness** at `?w3b=table-demo`, gated on `NODE_ENV`.
  It exists because the 656-row measurement and the four-state screenshots were
  required before any module that owns a real table exists. Delete it with the
  first real module table.
