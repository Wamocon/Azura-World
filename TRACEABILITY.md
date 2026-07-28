# TRACEABILITY — acceptance criteria → proving tests

**Ticket:** INTERNAL-107 · **Produced by:** W4-D · **Commit:** see §6
**Measured:** 2026-07-28, against `next build --webpack` + `next start` (production), not `next dev`

Evidence grading follows `SYSTEM-PROMPT.md` §3 — `[V]` verified by running it, `[I]` inference,
`[GAP]` not established.

> **The rule this document is written under:** an acceptance criterion with no passing test is
> **not met**, and saying otherwise is the failure this whole wave exists to prevent. Where a
> criterion is met, the test that proves it is named and re-runnable. Where the proof is
> narrower than the criterion, §3 says exactly how.

---

## 1. Summary

| AC | Requirement (ticket, German) | Status | Proven by |
|---|---|---|---|
| **1** | Ein CATI für Azura World erstellen | **MET** `[V]` | `scripts/traceability.mjs` AC1.1–AC1.6 · 6/6 |
| **2** | Die wichtigsten Quellen und Links berücksichtigen | **MET** `[V]` | `scripts/traceability.mjs` AC2.1–AC2.4 · 4/4 · `scripts/verify-evidence.mjs` |
| **3** | Informationen aus Immobilien-Portalen einbeziehen | **MET** `[V]` | `scripts/traceability.mjs` AC3.1–AC3.2 · 2/2 |
| **4** | Bewertungen und Hotel-Buchungsquellen einbeziehen | **MET** `[V]` | `scripts/traceability.mjs` AC4.1–AC4.3 · 3/3 |

`node scripts/traceability.mjs` → **exit 0 · 15 pass · 0 fail.**

**All four are met at the depth this probe tests, and that depth is narrower than the W4-D brief
intended.** Read §3 before quoting this table.

---

## 2. The named tests, and why they are these tests

The W4-D brief names three e2e specs as the proving tests:

| Brief's named test | Exists? |
|---|---|
| `e2e/evidence/sources.spec.ts` | **No** |
| `e2e/inventory/listings.spec.ts` | **No** |
| `e2e/hotel/reviews.spec.ts` | **No** |

`[V]` `apps/web/e2e/` contains **zero** `*.spec.ts` files and `apps/web/playwright.config.ts` does
not exist. **W4-A was never started.** So on the tree as delivered, every acceptance criterion had
**no named proving test whatsoever**.

Two honest options existed: record four unproven criteria, or write the missing named test.
`scripts/traceability.mjs` is that test. It asserts the four criteria against a **production**
server, and it is in the repository, re-runnable, and wired into `.github/workflows/quality.yml`.

It runs against `next start` rather than `next dev` deliberately. S-009 — prerendered pages
shipping **0 bytes of JavaScript** under the production CSP — reproduced in neither `next dev` nor
`typecheck`/`lint`/`build`, and was caught only under `next start`. A criterion proven in dev is
not proven for a client demo.

### Assertion detail — all 15, with measured evidence

| Id | Assertion | Result | Evidence measured |
|---|---|---|---|
| AC1.1 | `/` redirects to default locale `/de` | PASS | HTTP 307 → `/de` |
| AC1.2 | landing serves 200 from a production server | PASS | HTTP 200, 303,193 bytes |
| AC1.3 | landing HTML is a real document, not an error shell | PASS | 303,193 bytes, no `__next_error__` |
| AC1.4 | public hotel route serves 200 | PASS | HTTP 200, 187,492 bytes |
| AC1.5 | protected route redirects to login, does not leak | PASS | HTTP 307 → `/de/login?next=%2Fdashboard` |
| AC1.6 | unknown locale 404s, does not silently serve German | PASS | HTTP 404 |
| AC2.1 | landing renders outbound source links | PASS | **203** `https://` occurrences |
| AC2.2 | tier 1–2 sources cited on the landing page | PASS | `azuraworld.com`, `cebecigroup` |
| AC2.3 | provenance vocabulary rendered — gaps shown, not hidden | PASS | `Nicht belegt`, `Quellen` present |
| AC2.4 | evidence invariants hold across the dataset | PASS | `verify-evidence.mjs` exit 0, no violations, 1,354 facts |
| AC3.1 | property portals cited on the landing page | PASS | **5/6**: terrarealestate, housearch, seaside-alanya, alanya-home, ivm-turkey |
| AC3.2 | portal listings distinguished from modelled records | PASS | **25 portal_listing + 631 modelled = 656** |
| AC4.1 | review/booking platforms cited on the hotel page | PASS | **4/4**: tripadvisor ×58, booking.com ×12, agoda ×4, onthebeach ×9 |
| AC4.2 | hotel page links out to those sources | PASS | **148** `https://` occurrences |
| AC4.3 | Tripadvisor cited repeatedly, not once in passing | PASS | 58 occurrences |

---

## 3. What "MET" does and does not mean here

This is the section to read before repeating the word "met" to anyone.

**AC3.2 is the strongest single result in the whole ticket.** `25 portal_listing + 631 modelled =
656` is asserted by `verify-evidence.mjs` and fails the build if the split is ever misreported. The
project's central honesty risk is a synthesised unit reading as a real listing, and that split is
machine-checked, not promised.

**What the probe proves:** the criteria are satisfied *in production output* — the sources are
cited, the links are real and outbound, portal records are distinguished from modelled ones, and
the review platforms are on the hotel page with links.

**What it does not prove, and what the missing e2e suites would have:**

- `[GAP]` **No role permutation.** AC1.5 proves an unauthenticated user is redirected. It does
  **not** prove that a `manager` sees the evidence cockpit or that an `owner` cannot. The
  permission matrix is covered statically by `scripts/dashboard-probe.mts` (**647 pass**, 11 roles
  × 21 routes = 231 cells) — but that reasons over the RBAC config, **not** over a browser with a
  real session.
- `[GAP]` **The evidence cockpit has no production proof at all.** `/de/dashboard/evidence`
  correctly 307s to `/de/login` under `next start`, which is the route guard working. W3-C's
  100-assertion `evidence-review.mjs` therefore only ever ran against `next dev`. I ran it against
  production and it **failed** — timeout waiting for `[data-slot="price-conflict-ladder"]` —
  **because the page is behind auth and there is no production auth fixture**, not because the
  page is broken. AC2's richest surface is dev-proven only.
- `[GAP]` **No mobile viewport, no layout audit, no a11y audit, no measured performance.** Gates
  11–14 are NOT RUN; the scripts do not exist.
- `[GAP]` **Assertions are on server HTML, not on a hydrated DOM.** `qa:csp` separately proves
  hydration works in production (30 assertions, React hydrated `true`, 0 CSP violations), so this
  is a narrow gap rather than an open question — but the traceability assertions themselves are
  string counts over markup.
- `[I]` A citation count proves the source is *rendered*. It does not prove the figure next to it
  is *correct*. Correctness of the underlying facts is `verify-evidence.mjs`'s job (invariants) and
  the harvest's (provenance) — see §5 on why "correct" has a ceiling here.

---

## 4. Supporting suites — measured, not quoted from handoffs

Every one re-run by W4-D on this tree, exit codes captured directly from the process:

| Suite | Command | Executed | Result |
|---|---|---|---|
| Contract smoke | `pnpm smoke:contracts` | 33 | **33 pass · 0 fail** exit 0 |
| RBAC matrix | `scripts/rbac-probe.mts` | 157 | **157 pass · 0 fail** exit 0 |
| AI guardrails | `scripts/ai-probe.mjs` | 152 | **152 pass · 0 fail** exit 0 · **17/31 probes refused** |
| Realtime | `scripts/realtime-probe.mts` | 93 | **93 pass · 0 fail** exit 0 |
| Dashboard matrix | `pnpm qa:dashboard` | 647 | **647 pass · 0 fail** exit 0 · 11 roles × 21 routes |
| CSP / prerender | `pnpm qa:csp` | 30 | **30 pass · 0 fail** exit 0 |
| Unit | `node --test` | 24 | **24 pass · 0 fail** exit 0 |
| Traceability | `scripts/traceability.mjs` | 15 | **15 pass · 0 fail** exit 0 |
| **Total executed** | | **1,151** | **1,151 pass · 0 fail** |

Plus **366 pgTAP assertions** executed by W1-A against the live cloud database — **not** re-run by
W4-D, and **not** via `supabase test db`, which is NOT RUN because Docker is down. See
`RELEASE-STATUS.md` §2 for why that substitution is recorded as a substitute rather than as the
gate it stands in for.

One caution on `17/31 probes refused`: that is the AI layer **correctly refusing** ungrounded or
unauthorised requests, which is the designed behaviour under CONTRACTS §6. It is a pass, not a
failure rate.

---

## 5. The ceiling on AC2 that no test can lift

`[V]` **Two developer sources were never recovered.** Source #2 (`cebecigroup.com` project page)
returns HTTP 500 with a genuine application error — `Unable to load the requested file:
front/404.php` — and source #4 (`alanyacebeci.com`) does not resolve in DNS. No harvester fixes
either.

`[V]` Of the five tier ≤3 captures that did validate — the hotel site, the Cebeci projects index,
`azuraworld.com` and two Instagram accounts — **not one states a single structural figure.** No
block count, unit count, area, date, distance or price.

**So every structural number in this dataset rests on tier 4–6 portals** (finding **F-010**). AC2
says *"die wichtigsten Quellen berücksichtigen"* — the most important sources are *considered*, and
their unavailability is recorded as a finding rather than hidden. That is the criterion honestly
satisfied. It is **not** the same as those figures being authoritative, and no test in this
repository can make it so. `RELEASE-STATUS.md` §6 carries this as a first-class limitation.

---

## 6. Reproducing this document

```bash
pnpm install --frozen-lockfile
pnpm --dir apps/web build
node scripts/traceability.mjs --out=quality/traceability.json ; echo "exit=$?"
node scripts/quality-gate.mjs --out=quality/gate.json ; echo "exit=$?"
```

Machine-readable results: `quality/traceability.json`, `quality/gate.json`.
Console transcripts: `quality/traceability-console.txt`, `quality/gate-console.txt`.
