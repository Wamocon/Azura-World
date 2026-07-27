# W3-C — Inventory, evidence cockpit, leads, buyer pipeline

**Wave:** 3 · **Depends on:** W0-B, W2-A, W2-B, W3-B (shell contract) · **Runs with:** all other W3-*

> Read `SYSTEM-PROMPT.md`, `HANDOFF/W0-B.md` (dataset paths + finding list),
> `HANDOFF/W3-B.md` (module contract, `data-table` API), `HANDOFF/W1-D.md` (provenance components).

---

## Mission

The modules that carry the ticket's acceptance criteria 2 and 3 — the 656-unit inventory, the
portal listings, and the **evidence cockpit** where every conflict lives. This is the most
important module group in the build: it is where competitor intelligence is actually consumed.

---

## Files you own

```
apps/web/app/[locale]/dashboard/{evidence,units,listings,leads,buyer-pipeline}/**
apps/web/components/inventory/*
HANDOFF/W3-C.md
```

Messages: `dashboard.evidence.*`, `dashboard.units.*`, `dashboard.listings.*`,
`dashboard.leads.*`, `dashboard.pipeline.*` only.

---

## Deliverables

### 1. Evidence cockpit — `/dashboard/evidence`

The screen that justifies the project. Four views:

**Coverage** — facts by confidence (confirmed / official / single-source / conflicted / inferred /
gap), sources by reachability, findings by severity. Honest about thinness. If only 14 of 23
sources are reachable, this screen says 14, prominently.

**Sources** — all 23, with tier, publisher, last fetch, HTTP status or transport label
(`dns_timeout`, `tls_invalid`, `blocked_403`), and a link to both the live URL and the local
snapshot. **A dead source still renders** with its snapshot — that is what the snapshot is for.

**Findings** — F-001…F-010 and anything the harvest added. Per finding: severity, area, the
competing values each with its publisher and URL, the resolution, and what it resolved to. An
unresolved finding shows `resolvedTo: null` and says so. Filter by severity and area.
`admin` may annotate; `manager` may only read.

**Fact explorer** — every `SourcedFact` by dotted path, searchable, with full provenance.

Design the conflict view for **F-002** first (the four disagreeing 1+1 prices, one in USD). If
that renders clearly and honestly, everything else will.

### 2. Units — `/dashboard/units`

656 units. Virtualised table via W3-B's `data-table`.

- Columns: id, block, layout, interior m², floor, price (`ProvenanceValue`), status, data quality
- Filters: block, layout, price range, status, **data quality**
- **`modelled` units must be visually distinct from `portal_listing` at a glance in the list** —
  not only on the detail page. A tinted row plus an explicit badge, and the count shown in the
  header: "412 modelliert · 244 reale Inserate". This is the honesty control for the whole module.
- Detail view: full provenance, all `competingPrices` with publisher/date/URL, block context
- Block rollups: per-block availability and price ranges, each with its confidence

### 3. Portal listings — `/dashboard/listings`

Every scraped listing, grouped by publisher. Per listing: URL, fetch date, layout, size, price
**in its own currency**, and the portal's own claims about the project (`claimedBlockCount`,
`claimedTotalUnits`, `claimedBuildStatus`) so a user can see *which portal says what*.

**Stale listings** (contradicting a tier ≤3 source — Haspo still says "under construction" two
years after confirmed completion) carry a badge **next to the price**, not in a footnote.

A comparison view: the same layout across all publishers, side by side, prices uncconverted. This
is the view that makes F-002 legible at a glance.

### 4. Leads + buyer pipeline

Standard CRM: capture, qualify, stage, assign, convert. Stages: new → contacted → qualified →
viewing → negotiation → reserved → won/lost. Permission-gated transitions, audit on every move.

---

## Edge cases

- **`gap` price** → "—", never `0`, never blank.
- **Mixed currency in one table** — EUR and USD rows together. Show each in its own currency with
  the symbol. **Never convert silently.** If you offer a conversion toggle, label the rate and
  its date.
- **German price format**: `112.000,00 €`. Parsing or rendering `112.000` as `112.0` is a 1000×
  error and the most damaging bug available in this module.
- **A unit with 6 competing prices** → the popover scrolls; the row stays one line.
- **All 656 units filtered to zero** → empty state that explains which filter excluded everything
  and offers to clear it.
- **Sorting by a `SourcedFact` price** where some are `null` → nulls last, always, in both
  directions. Never treat `null` as `0`.
- **Sorting Turkish block names** → `Intl.Collator("tr")`.
- **A source URL now dead** → chip renders, links to the snapshot, marked unreachable.
- **CSV export** must include provenance columns. An export that strips sources recreates exactly
  the problem this system exists to solve.
- **Bulk action on a filtered selection** → operate on the selection, not the whole table.
  Confirm destructive actions with the count.
- **656 rows on mobile** → virtualisation under touch scroll.
- **A finding with `resolvedTo: null`** → renders as deliberately unresolved, not as an error.

---

## Definition of done

```bash
pnpm --dir apps/web typecheck && pnpm --dir apps/web lint && pnpm --dir apps/web build
```

Plus, evidence pasted:
1. Evidence cockpit screenshots — all four views, German + English
2. **F-002 rendered**: all four competing 1+1 prices visible with publisher, date, URL, and USD
   shown as USD
3. Units table with 656 rows: DOM node count proving virtualisation; `modelled` vs
   `portal_listing` visually distinct in a single screenshot
4. Data-quality counts in the header matching the dataset's own counts
5. Stale-listing badge on the Haspo listings
6. Filter to zero results → explanatory empty state
7. CSV export opened, provenance columns present
8. Permission matrix: `manager` can read findings, cannot annotate; `admin` can; `tenant` gets 403

---

## Handoff must state

- Which findings are surfaced in the UI and which are only in the dataset
- The `modelled` vs `portal_listing` split as rendered, matching W0-B's numbers
- How currency mixing is presented, and whether any conversion is offered
- Any dataset field you needed that W0-B did not produce (a request, not a unilateral change)
