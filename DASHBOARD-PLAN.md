# Dashboard upgrade — plan of record

**Written:** 2026-07-29 · **Owner:** W-NIGHT · **Ticket:** INTERNAL-107

This is the plan the overnight run executes. It exists so the work is checkable
against something written down beforehand rather than judged by how it looks
afterwards.

---

## 0. What is actually wrong, measured

Not opinions. Each line is something counted or screenshotted today.

| Finding | Evidence |
|---|---|
| **No charts anywhere.** Every figure in the product is a number in a box. | `components/charts/` does not exist. 1Çatı ships `bar-chart` (89 lines), `line-chart` (185), `pie-chart` (114) and uses them on its ticket page. |
| **The tickets page is 8.5× smaller than 1Çatı's.** | 478 lines vs **4,040**. `ticket-workflow.ts` 526 vs 707. |
| **No create, no edit, no search on tickets.** The surface is read-only. | 1Çatı holds `ticketForm`, `ticketEditState`, `ticketSearchQuery`, `ticketTransitionState`, `workflowDecisionState`, `preparedOrderDrafts`, `queueData`, `ownerApprovalContexts`. We hold none of them. |
| **No unit matrix.** | `lib/unit-matrix-copy.ts` exists in 1Çatı; nothing equivalent here. 656 units render as a 14-page paginated list. |
| **~17 role-specific live panels missing.** | 1Çatı: `role-focused-live-dashboard`, `admin-control-center`, `admin-approvals-inbox`, `compliance-live-cockpit`, `finance-live-ledger`, `people-directory-live`, `phase4-live-operations`, `service-proof-panel`, `manual-payment-console`, `owner-finance-statement`, `accountant-finance-panel`, `tenant-access-live-panel`, `role-governance-panel`, `user-administration-panel`, `integration-health-panel`, `dashboard-command-ribbon`, `dashboard-action-menu`. |
| **A 821-line `DataTable` that nothing imports.** | 0 consumers outside `table-demo.tsx`. 11 pages hand-roll `ui/table` instead. |
| **Realtime is built and barely wired.** | `lib/realtime.ts` (291 lines), `use-realtime-channel`, `use-live-snapshot`, a migration with a publication — consumed by 3 components and a dev harness. Not by any data page. |
| **The dashboard home is 12 identical white boxes.** | Screenshotted. Three of them repeat the same footnote verbatim. |

**What is already good, and must not be regressed:** the Evidence page's
price-spread visual — dashed markers for stale listings, separate EUR/USD bands,
"nicht vergleichbar · keine Umrechnung". That is the design language the rest of
the product should be speaking. It is the reference, not the thing to replace.

---

## 1. The design direction

**Extend the Evidence language.** Data-dense, charted, honest about what it does
not know. Not a second visual identity, and not the landing page's night surface
— a manager scanning 656 rows in daylight needs the light theme, and dark dense
tables are measurably harder to scan.

Four rules the whole upgrade is held to:

1. **Every chart states its basis.** An axis with no unit, or a share with no
   denominator, is the chart version of a number without a source.
2. **Demo data stays labelled.** 696 seeded rows carry `metadata.demo = true`.
   Any surface aggregating them says so.
3. **Charts are SVG, server-rendered, no new dependency.** A charting library is
   40–120 KB gz for what a `<path>` does. The landing route budget is already
   the tightest constraint in the repo.
4. **Reduced motion yields a complete chart**, not a blank one. Same rule the
   landing page lives by.

---

## 2. Phases

### Phase 1 — Shared primitives (highest leverage, do first)

Four files reach 57 consumers between them, so this lands everywhere at once.

| File | Consumers | Work |
|---|---|---|
| `components/charts/*` | new | `Sparkline`, `BarSeries`, `LineSeries`, `Donut`, `StackedBar`, `Heatmap`. Pure SVG, theme-aware, `aria` table fallback. |
| `ui/table.tsx` | 11 | Density, sticky header, zebra-free row separation, numeric alignment, sortable affordance, per-column alignment. |
| `ui/badge.tsx` | 31 | Semantic variants tied to the provenance/quality families already in `globals.css`. |
| `ui/empty-state.tsx` | 8 | Four real states — loading, empty, error, filtered-empty — each with the action that resolves it. |
| `dashboard/kpi-card.tsx` | 1 → many | Value, delta, sparkline, basis line. Grouped rather than 12 equal boxes. |
| `dashboard/section.tsx` | 7 | Heading rhythm, actions slot, collapsible. |

Also: **delete `dashboard/data-table.tsx`** (821 lines, 0 consumers) or adopt it.
Adopt-or-delete, not leave.

### Phase 2 — The unit matrix

The user's actual ask. 656 units as **7 blocks × floors**, each cell a unit,
coloured by status, with layout/area/price on hover and focus. Replaces reading
14 pages of table to answer "which floors in B03 are unsold".

Deep-linkable (`?block=B03&floor=4`), keyboard-navigable as a grid, and honest:
the 631 modelled units stay visually distinct from the 25 real listings.

### Phase 3 — Ticket system to parity

Ported from 1Çatı's 4,040-line page, in our register:

- create + edit forms, with optimistic state and server validation
- search with debounce
- transitions with assignee + reason capture
- **service orders** and order drafts
- **dispatch queue** and emergency routing
- **approval workflow** (owner approval, finance approval over threshold)
- **service proof panel** — photo evidence against a completed task
- SLA hours labelling, cost estimation and currency handling
- ticket history timeline (we have `ticket-timeline`; wire it to real events)

### Phase 4 — Realtime, actually wired

`lib/realtime.ts` and the hooks exist. Wire them to tickets, finance,
notifications and the dashboard home, with the four honest modes the library
already defines (`realtime` / `polling` / `static` / `offline`) surfaced in the
connection banner rather than faked.

### Phase 5 — Role by role

Eleven roles × the routes each can reach. For each: does the landing view answer
the first question that role has, is every number charted or justified, does
every empty state name its cause, and does the nav shape match the permission
set. Verified by signing in as each.

### Phase 6 — Orchestrator

`scripts/orchestrate.mjs` — a monitor that runs the full gate set, signs in as
all eleven roles, walks every route, and reports console errors, HTTP failures,
missing translations, layout overflow, contrast failures and empty states, as
one table. Re-runnable and non-destructive.

---

## 3. What this plan will NOT do

Stated so it is a decision rather than an omission.

- **No new runtime dependency.** No chart library, no table library.
- **No dark dashboard.** The landing page is the night surface; the tool is not.
- **No fabricated operational history beyond the labelled seed.** Charts read
  the seeded year, and the seed is marked demo everywhere.
- **No storage-bucket work.** `azura-documents` / `azura-evidence` still do not
  exist; document rows are register entries and the UI must say so rather than
  offer a download that 404s.
- **No commits or pushes** unless asked. Another process is committing in this
  tree concurrently.
