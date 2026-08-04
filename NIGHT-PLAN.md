# Overnight plan — 2026-08-03 → 04

Written before starting, so the morning can check the work against what was
intended rather than against a summary of what happened.

## What the measurements say

`scripts/role-audit.mjs` walked all eleven roles across 130 pages. Body length
in characters, thinnest first:

| role | nav | thinnest pages |
|---|---|---|
| admin | 20 | **home 1077** · settings 1214 · reports 1521 |
| manager | 20 | **home 948** · settings 1057 · reports 1525 |
| accountant | 11 | **home 795** · reports 1551 · wallet 1635 |
| staff | 13 | **home 813** · vendor-invoices 1168 · wallet 1190 |
| owner | 13 | **home 666** · units 690 · communications 800 |
| tenant | 12 | **home 616** · units 684 · wallet 1254 |
| guest | 8 | communications 618 · units 681 · activities 751 |
| service_provider | 8 | documents 529 · communications 652 · **home 706** |
| child_owner | 9 | units 649 · communications 650 · wallet 1141 |
| child_tenant | 9 | units 651 · communications 652 · wallet 1143 |
| child_guest | 7 | communications 614 · units 677 · activities 747 |

Three things fall out of that table and they set the order of the work.

**1. The dashboard home is the thinnest page in the product for seven of the
eleven roles.** It is also the first thing every one of them sees. A manager
signs in and lands on 948 characters — four KPI cards and two charts — then has
to go looking for whatever actually needs them. That is the single biggest gap
and it is not a styling problem.

**2. The resident surfaces are near-empty across the board.** `units` is 649–715
characters for every residency role; `communications` is 614–800. These are the
pages a resident opens, so "the product feels empty" is mostly these two.

**3. `service_provider` is the least-served role.** A contractor's whole working
day is a job list, and their home is 706 characters with a documents page of 529.

## The five waves

### Wave 1 — The front door
Replace the KPI grid with a **cockpit** for each role: what needs you now, what
changed since you last looked, and what you can do from here without navigating.
Not more numbers — the numbers are already there and are not what a person opens
the page for. A manager wants the three tickets breaching SLA today; a tenant
wants "your request was assigned to someone this morning"; a contractor wants
today's jobs in order.

Every item must be an action or a link to one. No card that is only a figure.

### Wave 2 — Realtime
`supabase/migrations/…012_realtime.sql` and `hooks/use-realtime-channel.ts` both
exist and almost nothing uses them. Wire the surfaces where staleness is a real
cost, and only those:

- the ticket queue and one ticket (status, assignee, new comments)
- a conversation (new messages)
- the notification inbox and its badge
- the cockpit's "needs you now" list

Deliberately NOT realtime: finance, evidence, inventory. A ledger row that moves
while somebody is reading it is worse than one that is a minute old, and the
evidence module's whole claim is that a figure is stable enough to cite.

Every subscription must degrade to the current server-rendered state when the
socket drops, and must never invent a row it has not read back.

### Wave 3 — Make the business legible
The features exist and do not reference each other. The chain a building
actually runs on is:

> resident reports → manager triages → assigns a contractor → contractor works →
> resident sees progress → vendor invoices → finance pays → the ledger records it

Today each step is a separate page with no link to the next. The work is to make
the connections visible and traversable in both directions: from a ticket to the
invoice it produced, from an invoice back to the job, from a home to its open
requests, its documents and its balance. A unit page that does not show the
unit's open tickets is not an ERP, it is a spreadsheet with a nav bar.

### Wave 4 — Premium
Motion under 300 ms with real easing, never on layout properties. Depth and
density on the surfaces that currently read as flat. Empty states that say what
would fill them and offer the action that would. Loading states that hold their
shape instead of collapsing. `prefers-reduced-motion` on all of it.

### Wave 5 — Per-role finish
Walk `quality/ux/<role>/` page by page for all eleven and close what is left.

## Rules that do not bend overnight

- **Never fabricate a value.** A missing figure is a stated gap, never a
  plausible number. This is the product's entire premise.
- **No control that cannot work.** If a write is not wired, the surface says so
  rather than offering a button that fails.
- Every string in all four languages, Turkish first. `pnpm qa:i18n` is a gate.
- RLS stays the boundary. Nothing gets widened to make a screen look better.
- Verify in a browser as the actual role. A screenshot of the page a `tenant`
  sees is the only proof a tenant's page is fixed.
