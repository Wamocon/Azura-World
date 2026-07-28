# HANDOFF — N1 Leads and buyer pipeline

STATUS: COMPLETE
Completed: 2026-07-28 · Branch: `feature/INTERNAL-107-n1-listings` · Worktree: `D:\azura-n1`
Commit: `47c7b67`

Closes the second of the two deliverables `HANDOFF/W3-C.md` §12.7 left unbuilt. With
`HANDOFF/N1-listings.md`, **W3-C's scope is complete**.

---

## 1. What was built

| File                                                    | What it is                                            |
| ------------------------------------------------------- | ----------------------------------------------------- |
| `app/[locale]/dashboard/leads/page.tsx`                 | Seven enquiries, four currencies, no capture form     |
| `app/[locale]/dashboard/buyer-pipeline/page.tsx`        | Nine stages, three of them empty and rendered anyway  |
| `components/inventory/currency-totals.tsx`              | A money total that **cannot** be expressed as one sum |
| `apps/web/messages/{de,en,tr,ru}.json`                  | `dashboard.leads.*` + `dashboard.pipeline.*`          |
| `apps/web/lib/dashboard-routing.ts`                     | Removed `pending: true` from both entries             |
| `scripts/listings-verify.mjs`                           | Extended from 55 to **93** assertions                 |

Both are Server Components with no client JavaScript of their own, no
`export const dynamic`, and a server-side `hasPermission` check before any
repository call.

---

## 2. Currency handling — the honesty control for this module

The seed was built to punish the obvious mistake, and it does. **Seven leads carry
budgets in four currencies** (EUR, USD, TRY, GBP) and one carries none. **Six pipeline
entries carry deals in three currencies** and two carry none.

A single "Gesamtbudget" over the leads would read **10.485.000** — a figure dominated by
the ₺9,500,000 line, which the next person to see it would quote as euros. That is not a
hypothetical: it is the exact shape of error CONVENTIONS §5 and OVERNIGHT-2 §4.5 exist
to prevent.

So `CurrencyTotals` takes `Record<currency, amount>` — the shape
`totalsByCurrency()` already returns — and renders one figure per currency.
**There is no prop that could produce a single number.** A component that cannot express
the wrong answer is stronger than a comment asking for the right one.

Measured on the served page:

```
Leads     590.000 €   220.000 £   9.500.000 TRY   310.000 $     1 ohne Angabe
Pipeline  434.000 €   215.000 £   305.000 $                     2 ohne Summe
```

`1 ohne Angabe` / `2 ohne Summe` are **counts**, never zeros folded into a total. A lead
with no stated budget and a lead with a budget of zero are different facts.

An unrecognised ISO code — one outside `Money`'s `EUR | USD | TRY | GBP` union — renders
with its raw code rather than being dropped. A figure the component cannot pretty-print
is still a figure, and silently omitting a currency would understate a total.

---

## 3. Neither page has a write control, and that is a decision

`POST /api/site-management/leads` and `PATCH /api/site-management/buyer-pipeline` are
**declared write gaps** in `lib/api-routes.ts`. They authenticate, authorise, validate,
and then answer **503** naming W2-A, because no repository write path exists — there is no
`buyer_pipeline` write in `lead-repository.ts` and no audit table behind it.

A "Neue Anfrage" button or a "move to next stage" control could therefore do exactly two
things: fake a success, which OVERNIGHT-2 §4.6 forbids outright, or fail on every press.
The third option is the one taken: **state the gap once, in words**, and render the audit
trail that does exist.

> _"Diese Seite zeigt Anfragen nur an. Neue Anfragen lassen sich noch nicht speichern,
> weil der Schreibweg zur Datenbank fehlt."_

Asserted rather than asserted-about: **0 `<button>`, `[type=submit]` or `<form>` elements
inside `<main>` on either page.** The shell's own controls (sidebar collapse, search,
sign-out) sit outside `<main>` and are unaffected — the first version of that assertion
counted the whole document and failed on them.

**What the pipeline shows instead of a transition control:** each entry's previous stage
(translated), the date it entered the current one, and how many days it has sat there.
That is history, which exists. A control would be a promise, which does not.

The brief's *"permission-gated transitions, audit on every move"* is therefore **NOT
BUILT**, and it is blocked rather than skipped: it needs `buyer_pipeline` writes from
W2-A and an audit table from W1-A. Named in §7.

---

## 4. A defect the render caught, and the dataset bug behind it

The leads page printed a raw profile uuid at a property manager:

```
BETREUT VON
0a1b2c3d-0001-4000-8000-000000000002
```

That is the database showing through the product (azura-ui-ux §7b: no implementation
detail in user-visible copy). Fixed by joining the people directory —
`getProfiles()` enforces `users:view` inside the repository and returns an empty,
labelled result for a role that lacks it, so calling it here widens nobody's access.

**The name still does not resolve, and that is a real dataset defect rather than a UI
one.** The two seeds use different profile id spaces:

| Seed                  | Manager's profile id                   |
| --------------------- | -------------------------------------- |
| `document-data.ts` (leads, via `lead-data.ts`) | `0a1b2c3d-0001-4000-8000-000000000001` |
| `governance-data.ts` (the directory)           | `b0000000-0000-4000-8000-000000000002` |

So every `leads.assigned_to` in local-seed mode points at a profile no other seed knows
about. Reported to W2-A as request 1 below.

The page therefore distinguishes **two different absences**, because they send a reader to
two different people for a fix:

| State                                         | Copy                                 |
| --------------------------------------------- | ------------------------------------ |
| `assigned_to` is null                         | `Niemand zugewiesen`                 |
| assigned, viewer holds `users:view`, no match  | `Zugewiesen, Name nicht hinterlegt`  |
| assigned, viewer lacks `users:view`            | `Zugewiesen, Name nicht einsehbar`   |

Never a uuid, in any of the three.

**The seed's own profile names are the role words** — "Manager", "Staff", "Admin" — so
even a resolving join would render `Betreut von Manager`. That is W2-A's fixture rendered
honestly under a Demodaten notice, not something to dress up here.

---

## 5. Verification actually run

| Command                            | Result                                   | Evidence                                    |
| ---------------------------------- | ---------------------------------------- | ------------------------------------------- |
| `pnpm --dir apps/web typecheck`    | **PASS** exit 0                          | `tsc --noEmit`, no output                   |
| `pnpm --dir apps/web lint`         | **PASS** exit 0                          | 0 errors, **0 warnings**                    |
| `pnpm --dir apps/web build`        | **PASS** exit 0                          | both routes emit as **ƒ (Dynamic)**         |
| `node scripts/check-i18n.mjs`      | **PASS** exit 0                          | **1020 keys × 4 locales**, 0 errors 0 warnings |
| `node scripts/listings-verify.mjs` | **PASS** — **93 pass · 0 fail**, exit 0  | production build, real Chromium             |

Screenshots: `quality/n1-listings/leads-de-desktop.png` · `pipeline-de-desktop.png` ·
`leads-de-320.png` · `pipeline-de-320.png`.

### What the 38 new assertions measured

```
Leads
  all 7 seeded enquiries render
  EUR 180.000 · USD 310.000 · TRY 9.500.000 · GBP 220.000 all render in their own currency
  budget totals are one figure PER currency, never one combined figure  - EUR, GBP, TRY, USD
  the lead with no budget is counted, not summed as 0                   - "1 ohne Angabe"
  no raw uuid is shown to the reader                                    - 0 found
  an unresolvable assignee says the name is not on record
  it does NOT claim the viewer lacks permission to see the name
  marketing consent is stated in BOTH directions, never only when granted
  the write gap is stated in words
  the page ships no control that could fake a write                     - 0 found in main
  filtering to an empty status names the filter and offers to clear it
  accountant · staff · tenant receive NO personal data                  - clean

Pipeline
  all nine stages render, in funnel order
    enquiry:1 qualification:1 viewing:1 reservation:0 contract:1 payment:0
    title_deed:0 handover:1 closed:1
  the empty stages are rendered rather than dropped                     - 3 empty
  all 6 seeded entries render
  deals render in EUR, USD and GBP, each in its own currency
  the two entries with no deal amount are counted, never summed as 0
  a probability of 0 renders as 0 %, not as "not estimated"
  the previous stage renders translated, never as a raw enum member
  the page ships no control that could fake a stage change              - 0 found in main
  accountant · staff · owner receive NO pipeline data                   - clean

Both at 320px German: scrollWidth 320 = clientWidth 320
```

### NOT RUN

- **Stage transitions.** Not built. See §3.
- **Turkish and Russian visually.** Real translations, `check-i18n` green, but only `de`
  was rendered. Russian runs ~35% longer than English.
- **English visually.** The listings module has an English assertion set; these two do not.
  Their keys pass `check-i18n`'s parity and length rules, which is structure rather than
  appearance.
- **Screen reader.** Semantics correct by construction (`<dl>`/`<dt>`/`<dd>` throughout,
  `role="status"` on the notices, `role="alert"` on the 403, an ordered list for the
  funnel so its sequence is conveyed) but nothing driven with NVDA or VoiceOver.
- **A real production runtime.** Same three blockers as every other module here; see
  `HANDOFF/N1-listings.md` §7.
- **Reduced motion and tap targets on these two pages specifically.** Measured on
  `/dashboard/listings`; these two carry no motion of their own and reuse the same chip
  and badge sizes, but that is an inference, not a measurement.

---

## 6. Permission matrix, measured per role

`lib/rbac.ts` grants `leads:view` and `buyer_pipeline:view` to **admin and manager only**.

```
Leads      accountant · staff · tenant   refused, NO personal data in the payload  (clean)
Pipeline   accountant · staff · owner    refused, NO pipeline data in the payload  (clean)
```

Written as leak tests — they grep the response body for `Ivanov`, `Yılmaz`, `Schneider`,
`310.000`, `305.000`, `Vertragsübersetzung` — rather than as "a 403 panel is shown". The
visible panel was never the thing in doubt; the RSC payload was (SEC-003).

### The RBAC / RLS divergence, which is real and is not a bug

`lib/lead-repository.ts` scopes at `roleLevel >= staff`, mirroring the RLS predicate
`is_admin() or has_role_level(40)` in migration 14. `lib/rbac.ts` grants `leads:view` to
manager and above. **A `staff` caller therefore passes the repository's own scoping and is
refused by RBAC.** Both pages check `hasPermission` before the call, so the divergence has
no effect on what ships — but a route handler that forgot to would return leads to
`staff`. The repository's own header documents this; it is repeated here because it is the
kind of thing that gets discovered by an audit rather than by reading.

---

## 7. Requests for other windows

| #   | Owner              | Request                                                                                                                                                                                                                                                                                                              |
| --- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **W2-A**           | **The lead seed and the profile seed use different id spaces.** `lead-data.ts` assigns to `document-data.ts`'s `0a1b2c3d-0001-…` profile ids; `governance-data.ts` seeds the directory with `b0000000-…`. Every `assigned_to` in local-seed mode dangles. One of the two constants should win.                       |
| 2   | **W2-A + W1-A**    | **`buyer_pipeline` writes and an audit table.** The brief's "permission-gated transitions, audit on every move" is the one deliverable of mine that is not built, and it is blocked rather than skipped. The permission check and the stage list are in place; only the write and its audit row are missing.          |
| 3   | **W2-A**           | **`leads` writes.** Same shape. `POST /api/site-management/leads` already authorises and validates; it needs somewhere to put the row.                                                                                                                                                                              |
| 4   | **W2-A**           | The seed's profile `fullName`s are the role words ("Manager", "Staff"). Harmless while the join dangles; the moment request 1 lands, every enquiry will read `Betreut von Manager`. Worth two minutes of realistic names in the same edit.                                                                            |
| 5   | **W1-C**           | I removed `dashboard.pipeline.stages` — a 7-key block naming stages (`new`, `qualified`, `offer`, `lost`) that are **not** members of `pipelineStages` in the contract. It was unreferenced. Flagging the deletion rather than burying it, since it was originally yours.                                             |
| 6   | **W4-D**           | `node scripts/listings-verify.mjs` now covers all three N1 modules: **93 assertions**, exit non-zero on any failure, needs only a production build in `apps/web/.next`.                                                                                                                                              |
| 7   | **W3-B / W3-C**    | Repeat of `HANDOFF/N1-listings.md` request 5: `dashboard-routing.ts` still marks `evidence` and `units` as `pending`, so the sidebar shows "In Arbeit" beside two shipped, production-verified modules. Visible in every screenshot in `quality/n1-listings/`.                                                        |

---

## 8. Decisions

- **Cards, not a table, for leads.** Half the fields are legitimately absent — no budget,
  no layout, nobody assigned, never contacted. A table renders each of those as a lonely
  dash in a column, which reads as missing data rather than as a lead nobody has worked
  yet. A card can say "Kein Budget genannt" in the space the figure would have occupied.
- **Lead totals are computed over the FILTERED set**, with the unfiltered count stated
  beside them ("3 von 7"). A figure that ignored the filter would describe rows that are
  not on screen; one that hid the total would let a filter make the pipeline look smaller
  than it is.
- **Every stage renders, including empty ones.** `getPipelineSummary()` already reports all
  nine zero-filled for the same reason. A board that omits them tells a reader the funnel
  has six steps.
- **Ages are measured against `summary.asOf`**, the repository's own timestamp, not a fresh
  clock. Measuring against `Date.now()` at render silently ages every entry by the render
  time.
- **Marketing consent is stated in both directions.** An absent badge is indistinguishable
  from a field nobody filled in, and consent is a legal fact about a real person.
- **`0 %` and "not estimated" render differently**, in both the entry and the stage
  average. 0 % is a judgement ("this is lost"); `null` is the absence of one.
- **A pipeline entry whose lead join returned nothing says so** ("Anfrage nicht auffindbar")
  rather than showing the raw `lead_id`. The repository returns `null` rather than a
  placeholder precisely so the UI cannot print an invented name on a board.

---

## 9. Known gaps

- **`[GAP]` No transitions, no capture, no audit** (§3, requests 2 and 3).
- **`[GAP]` The assignee never resolves in local-seed mode** (§4, request 1). The UI is
  correct; the fixture is not.
- **`[GAP]` Turkish, Russian and English not visually reviewed** on these two pages.
- **`[GAP]` No screen-reader pass.**
- **`[GAP]` Never served from a real production runtime.**
- **`[GAP]` No CSV export** for either module. Not in the brief for these two; named so it
  is not mistaken for an oversight.
- **`getPipelineSummary()`'s `truncated` branch has never fired.** Six entries against a
  500-row ceiling. The notice is wired and translated in all four locales, and it renders
  the exact counts, but no run has exercised it — so it is written, not proven.
