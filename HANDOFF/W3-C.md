# HANDOFF — W3-C  Inventory, evidence cockpit, leads, buyer pipeline

STATUS: PARTIAL
Completed: 2026-07-28
Branch: `feature/INTERNAL-107-w3c-inventory` · Worktree: `D:\azura-w3c` · Commit: `cae2e9b`

**What is done:** the F-002 conflict view — the surface the W3-C brief names as the one to build
first, and the one acceptance criteria 2 and 3 rest on. It is complete, rendered, measured in a
real browser, and green.

**What is not started:** the other three cockpit views (coverage, sources, fact explorer), the
656-unit table, portal listings, leads, and the buyer pipeline. The reason is in §2 and it is not
a time excuse: **`HANDOFF/W3-B.md` does not exist**, so the `data-table` module contract every one
of those surfaces consumes has not been published, and the instruction for this window was
explicit — do not build a table until it is.

---

## 1. What was built

| File | What it is |
|---|---|
| `components/inventory/price-conflict-ladder.tsx` | The signature: one axis per currency, never joined |
| `components/inventory/price-observation-table.tsx` | The record — every observation as text, with its citation |
| `components/inventory/price-conflict-panel.tsx` | Composes judgement → shape → record → resolution |
| `app/[locale]/dashboard/evidence/page.tsx` | The cockpit route, F-002 first |
| `scripts/evidence-review.mjs` | 40 assertions in Chromium; screenshots to `quality/w3c/` |
| `apps/web/messages/{de,en,tr,ru}.json` | +49 keys under `dashboard.evidence.*` (see §7) |

### The design, and why it is this

The panel is three layers in the order that carries the argument: **the judgement** (what the
finding says, and that it is unresolved), **the shape** (the ladder), then **the record** (every
observation as text). The resolution comes last, so a reader reaches the conclusion having already
seen the evidence rather than being told it first.

**One rail per currency, and they are never joined.** EUR 112.000–310.000 across three publishers
sits on its own axis; Housearch's USD figures sit on another; between them a dashed separator
reads *"nicht vergleichbar · keine Umrechnung"*. Joining them would need a rate and a rate date
that no source provides, and CONVENTIONS §5 forbids exactly that. The incommensurability is not a
footnote here — it is the layout.

There is **no midpoint, no median, no average, and no "typical" band**, because `F-002.resolvedTo`
is `null` by design and `pnpm qa:evidence` fails the build if anyone sets it. A ladder that drew a
central tendency would be arguing against its own data.

**The ladder is `aria-hidden` decoration; the table is the record.** Every observation it draws is
rendered again as real text with publisher, layout, area, collection date and a route back to the
source. A screen reader gets the evidence, not a description of a picture (azura-ui-ux §3), and
nothing about a conflict is reachable only on hover (§5.3). The whole page is a Server Component:
it renders identically before hydration, under a blocked script, and with JS off — which matters
here more than usual, given W-INT §4.

---

## 2. Why the rest is not started

`tasks/W3-C-modules-inventory.md` deliverables 2, 3 and 4 — the 656-unit table, the portal
listings, leads and the pipeline — are all **"virtualised table via W3-B's `data-table`"**. The
instruction for this window was: *"Do NOT build any table until `HANDOFF/W3-B.md` publishes it."*

That file does not exist. `D:\azura-w3b` is on the same commit as this worktree and has published
nothing. Building a table against a guessed API would produce work that either has to be thrown
away or silently forks the contract — which is the collision ORCHESTRATION §1 exists to prevent.

The evidence cockpit's other three views (**coverage**, **sources**, **fact explorer**) are each
also a table in practice. Coverage is the one that could be built without the contract — it is
counts and distributions, not rows — and it is the obvious next piece of work.

---

## 3. Verification actually run

| Command | Result | Evidence |
|---|---|---|
| `pnpm --dir apps/web typecheck` | **PASS** | `tsc --noEmit`, no output, exit 0 |
| `pnpm --dir apps/web lint` | **PASS** | 0 errors, 0 warnings, exit 0 |
| `pnpm --dir apps/web build` | **PASS** | exit 0; `├ ƒ /[locale]/dashboard/evidence` — **dynamic**, as W-INT §8 requires |
| `node scripts/check-i18n.mjs` | **PASS** | 625 keys × 4 locales, identical key sets, 0 errors 0 warnings |
| `node scripts/csp-probe.mjs` (`qa:csp`) | **PASS** | **21 pass · 0 fail**, exit 0, on a production build with this route present |
| `node scripts/evidence-review.mjs` | **PASS** | **100 pass · 0 fail**, exit 0, real Chromium |

Screenshots in `quality/w3c/`: `evidence-f002-de-light.png`, `-de-dark.png`, `-de-320.png`,
`-en-light.png`.

### The acceptance criteria, individually

| # | Brief's requirement | Result |
|---|---|---|
| 2 | F-002 rendered: all four competing 1+1 prices with publisher, date, URL, USD shown as USD | **PASS** — asserted individually: 112.000 €, 185.000 €, 220.000 €, 239.171 $ all present as text; `$`/USD present; five publishers named |
| — | Two currencies, two axes, no conversion | **PASS** — 2 rails, 1 per currency, separator text asserted |
| — | Stale badge **next to the price**, not in a footnote | **PASS** — 8 stale rows, badge in the price cell in 8/8 |
| — | Stale distinguishable without colour | **PASS** — 8px dashed hollow vs 4px solid; a shape difference |
| — | Provenance never hover-only | **PASS** — ladder `aria-hidden`, 21 table rows, 21 rows with an outbound link |
| — | Tap targets ≥ 24px | **PASS** — 0 violations |
| — | 320px German, no horizontal scroll | **PASS** — `scrollWidth=320 clientWidth=320` (see §5) |
| — | Reduced motion → complete, static page | **PASS** — 0 elements left at `opacity: 0`; every figure still present |
| — | Both themes | **PASS** — light and dark screenshotted |
| — | German **and** English | **PASS** — English asserted to be actually English, not a German fallback |

### NOT RUN

- **Nothing has been driven with a screen reader.** The semantics are correct by construction
  (`<caption>`, `<th scope>`, `<figure>`/`<blockquote>` for the quoted record, `aria-hidden` on the
  decoration) but no NVDA/VoiceOver pass has happened. Same standing gap as W1-D's.
- **The page has never been served under `next start`.** Not an oversight — see §6.
- **Turkish and Russian have not been visually reviewed.** Their keys exist and pass
  `check-i18n`, but only `de` and `en` were rendered. Russian runs ~35% longer than English and
  320px Russian is the case most likely to break.
- **Lighthouse, LCP, INP, CLS** — `qa:perf` is W4-B's and does not exist.

---

## 3a. The craft pass — what "premium" was allowed to mean here

A second pass took the surface to a higher finish. The constraint it worked inside is the one the
brief set: **on this screen restraint is the credibility.** Emil Kowalski's own frequency test
disqualifies most motion here — an analyst opens the evidence cockpit repeatedly, and repeated
animation reads as lag, not luxury. So the budget went where it compounds on a data surface:
material, type, and exactly one motion moment.

| Change | Why |
|---|---|
| The ladder sits in a **recessed well** (`bg-background/50`, inset border) rather than flat on the card | One level of layering is what separates "a page with a chart on it" from an instrument. It also groups the two rails and their separator into a single object the eye reads as one comparison. |
| **Two shadows** on the panel — a 1px contact shadow plus a wide, very soft ambient one | apple-design §12: a large surface should read as thicker than a chip. A single blurred drop reads as a sticker. |
| **Size-specific tracking**: heading `-0.018em`, price figures `-0.01em`, uppercase micro-labels `+0.06em` | apple-design §15. One `letter-spacing` value is wrong at one end of the scale or the other. All in `em`, so it holds at every size. |
| Axis line is a **gradient that fades at both ends** | It stops the axis reading as a hard container edge, which was competing with the panel border. |
| Fresh ticks carry a **3px halo** in the conflict surface colour | Separates overlapping ticks — eight Haspo observations sit between 112k and 190k and were merging into a smear. |
| **Scroll-edge fade** on the right of each table below `lg` | apple-design §12: a scroll edge, not a divider. Below `lg` the 44rem table is wider than the panel and the clipped columns simply looked absent. The fade says "there is more this way" without spending a row of chrome on it. |
| Row hover gated behind `@media (hover: hover) and (pointer: fine)` | A touch device fires hover on tap and the row latches highlighted after the finger leaves. |
| `active:scale-[0.97]` on every source link, 100ms | The interface must visibly hear the press before navigation happens. |

### The one motion moment

Each ladder tick **grows out of the axis in price order**, 500ms, `cubic-bezier(0.23, 1, 0.32, 1)`
(W1-D's `--ease-out`, which is already Emil's strong curve), staggered 50ms. It is a page-load
animation, not something a user triggers — and what it animates is the data arriving at its
position, which is the one thing on this screen worth dramatising.

Implemented as a **CSS transition with `@starting-style`**, not a keyframe:

- interruptible and retargetable, per Emil's rule for anything dynamic;
- runs off the main thread;
- needs no `@keyframes` in `globals.css`, a file this window does not own;
- degrades to "already visible" where `@starting-style` is unsupported.

Under `prefers-reduced-motion: reduce` the transition is switched **off entirely**
(`transition-property: none`) — the finished frame, never a slower journey to it.

Both of these were caught by asserting, not by looking:

1. **The stagger was 0.05ms.** `staggerDelay()` returns **seconds** (W1-D sized it for Framer
   Motion); I wrote `${…}ms`. Thirteen ticks arrived simultaneously while the code claimed a
   cascade. The assertion now requires the delays to differ by ≥ 20ms *and* increase — "they
   differ" would have passed the broken version.
2. **The reduced-motion assertion tested the wrong property.** Tailwind's `transition-none` leaves
   a residual `transition-duration` (`1e-05s`), so `duration === 0` would have passed a still-
   animating element. It now asserts `transition-property: none`.

---

## 3b. One theme — light only

**Product decision from the repository owner, 2026-07-28.** The app ships one theme.

Implemented as `forcedTheme="light"` in `components/providers/theme-provider.tsx` (W1-D's file —
declared in §7). One prop, reversible by deleting it, and it beats both `defaultTheme` and any
stored preference, so a machine that already chose dark still renders light.

**What was deliberately not done:** `globals.css`'s `.dark` block, the `dark:` utilities already
written across the component library, and `DESIGN.md`'s dark contrast table were left in place.
`forcedTheme` already makes them unreachable at runtime, which is the outcome that was asked for;
deleting them would touch every surface three other windows are building right now for no product
gain. Removing the dead tokens is a tidy-up for whoever owns `globals.css` next.

Within W3-C's own files there is **no `dark:` variant at all** — a dark override here would be dead
code that reads as a supported state.

Verified by driving a browser that *asks* for dark:

```
PASS  the document never carries the dark class — <html class="light">
PASS  the page still renders its evidence under a dark OS preference — rgb(244, 249, 251)
```

`prefers-color-scheme: dark` is the case that would have quietly re-enabled it, which is why the
assertion tests that rather than the default.

**Consequence for W1-D, recorded rather than left to be discovered:** their Playwright design suite
asserts `<html class="dark">` after toggling, and the kitchen-sink route ships a `ThemeToggle`.
Both now describe a state the app cannot enter. That suite is not wired into any gate, so nothing
goes red — but it is stale. See §8.

---

## 3c. Translation quality and pinned proper nouns

`check-i18n` was already green (0 errors, 0 warnings) before this pass — it verifies structure,
placeholders, key parity and length ratios, but it cannot judge whether a translation is *good*.
A read-through of all 55 keys side by side across the four locales found five real defects:

| Key | Was | Now | Why |
|---|---|---|---|
| `finding.severity.*` (ru) | Критично · Высокая · Средняя · Низкая | Критический · Высокий · Средний · Низкий | The set did not agree with itself — an adverb, then three feminine adjectives. A severity chip must read as one consistent set; masculine agreeing with «уровень» is the standard Russian technical register. |
| `ladder.negligible` (ru) | практически одинаково | Практически идентичны | Adverbial where the subject is two prices — needs a plural adjective. |
| `ladder.spread` / `ladder.negligible` (en, tr, ru) | mixed case | both capitalised | They occupy the **same slot** in the rail header, one replacing the other. Different registers in one position reads as a bug. |
| `ladder.lowest` / `highest` (en) | "lowest quoted" | "lowest quoted price" | Not idiomatic standing alone under a figure. |
| `source.tier.hotel` (ru) | Отель | Гостиничный оператор | Tier 3 is the hotel's own *operational* site. "Отель" named the building, losing what the tier means. |
| `finding.recordLabel` (en, ru) | "Finding text, original wording" | "Finding text as recorded" | Two fragments joined by a comma. |

### Proper nouns

`apps/web/lib/proper-nouns.json` is W1-C's single source of truth, read by both
`lib/proper-nouns.ts` and `scripts/check-i18n.mjs`. **It was missing `1Çatı` and every publisher
name in the dataset** — so nothing prevented a translator from rendering "Haspo Realty" or
"Alanya-Home" differently per locale, and the gate's own duplicate-detection was stripping the
wrong set of terms. 17 entries added (§7), taking the list from 22 to 39.

Inserted *before* the bare `Alanya` / `Azura` entries so the longest name wins — otherwise the
stripper matches `Alanya` first and leaves `-Home` behind as a fragment.

Verified at the rendered surface, in all four locales, which is where it actually matters:

```
PASS  de: "Azura World" is unchanged        PASS  tr: "Azura World" is unchanged
PASS  de: "Haspo Realty" is unchanged       PASS  tr: "Haspo Realty" is unchanged
PASS  de: "Alanya-Home" is unchanged        PASS  tr: "Alanya-Home" is unchanged
…9 pinned terms × 4 locales, all byte-identical…
PASS  de and en are genuinely different translations
PASS  de and tr are genuinely different translations   (…all 6 pairs)
```

The pairwise difference check is the one that catches a silent fallback: a locale serving German
passes every other assertion on this page.

---

## 4. Which findings are surfaced in the UI, and which are only in the dataset

**Surfaced: F-002 only.** One of 24.

The other 23 exist in the dataset and are reachable through `getFindings()`, and the **Findings
view that renders them is not built** (§2). Two are worth naming because they are `critical` or
directly qualify what this page shows:

- **F-018 (critical)** — the hotel's own site links a different property's Tripadvisor page.
- **F-006 (high)** — the build-status conflict. It is *implicitly* present here: every Haspo
  observation inherits `isStale` from it, which is what the eight "VERALTET" badges mean, and the
  panel's stale legend cites F-006 by id. It is not otherwise rendered.
- **F-013 / F-019 (high, pricing)** — both bear directly on F-002 (Alanya-Home publishing the
  project twice; two Haspo listings tagged to the wrong district). F-019's caveat text **is**
  visible, because it rides on the listing's own `note` field and this table renders notes
  verbatim — the "WRONG-DISTRICT SUSPECT" paragraphs under 112.000 € and 178.000 € are it. The
  findings themselves are not linked.

**A `PriceConflictPanel` takes any `Finding` plus its observations**, so the Findings view is
composition, not new components.

---

## 5. Four things the render caught that reading the code would not

Recorded because each one shipped green through typecheck, lint and build.

1. **`sr-only` content caused horizontal page scroll.** The observation table sits in an
   `overflow-x-auto` box, correctly clipped — `clientWidth 246`, `scrollWidth 704`. But
   `documentElement.scrollWidth` was **526** at a 320px viewport. Cause: every `sr-only` element is
   `position: absolute`, and an absolutely-positioned descendant is only clipped by an ancestor
   that is a **containing block**. The wrapper was not positioned, so the screen-reader-only spans
   escaped it and extended the viewport. Fixed with `relative` on the wrapper.
   **`overflow: hidden` alone does not fix it** — measured both ways, 526 either way. Isolated by
   bisection against `/de/kitchen-sink`, which measured 320/320/320 on the same server, which is
   what proved it was mine rather than dev tooling.

2. **A 0.09% spread was drawn identically to a 2.8× one.** Each rail normalises to its own min and
   max — right for comparing publishers, actively misleading when the values are nearly identical.
   Housearch's two USD observations were at 0% and 100% of the axis. A rail whose ratio is under
   1.05 now clusters at the centre and says *"praktisch identisch · 0,09 % Unterschied"*. The
   endpoints are still named, so the ticks stop claiming a span the figures never did.

3. **The spread badge contradicted the finding printed above it.** The badge read "Spanne 2,8×"
   under a finding whose own text says *"a 2.1x range across four publishers"*. Both are correct:
   F-002's ratio compares Haspo's EUR figure against Housearch's USD one — the exact conversion
   this design refuses to make — while 2.8× is the EUR-only span. The badge is now scoped
   *"(nur EUR)"*. See §8 for the request this raises.

4. **`Finding.message` was rendering as the German page's `<h2>`.** It is English analyst prose
   stored in the dataset, so the German page was asserting something in a language it had not
   chosen. There is now a German heading — *"Vier Portale, vier Preise für dieselbe 1+1-Wohnung"* —
   and the finding text is a labelled quotation under *"Befundtext im Original"*. Same treatment
   for `Finding.resolution`. Translating stored evidence would have been the wrong fix.

---

## 6. How currency mixing is presented, and whether any conversion is offered

**No conversion is offered anywhere. There is no toggle, and adding one would need a rate and a
rate date that no source in this dataset provides.**

- Two rails, one per currency, with a separator that states they are not comparable.
- Every figure renders through `formatMoney`, which is `Intl.NumberFormat` with the value's own
  currency — German format `112.000 €`, and `239.171 $` stays dollars.
- The spread ratio is computed **within** a rail and labelled with its currency.
- W1-D's `conflictRange()` already returns `null` when more than one currency is present, so even
  the shared provenance components refuse to render a mixed range.

German price formatting is `Intl`-driven end to end; the brief's `112.000` → `112.0` failure mode
cannot occur because no string parsing of a formatted number happens anywhere in this module.

---

## 7. Files I touched that I do not solely own

| File | Owner | What I did, and why |
|---|---|---|
| `apps/web/messages/{de,en,tr,ru}.json` | **W1-C** | Added 49 keys, all under `dashboard.evidence.*`, which the W3-C brief assigns to this window ("Messages: `dashboard.evidence.*` … only"). Nothing outside that namespace was touched, no existing key was edited, and `check-i18n` passes at 625 keys × 4 with identical key sets. `evidence.label.openSource`, `evidence.label.snapshot` and `evidence.sourceUnreachable` are **reused** from W1-C's own namespace rather than duplicated — two copies of "Quelle öffnen" in four locales would drift. |
| `apps/web/components/providers/theme-provider.tsx` | **W1-D** | Added `forcedTheme="light"` on the repository owner's explicit instruction (§3b). One prop. Their `.dark` tokens and `dark:` utilities are untouched — only unreachable. **Their design suite and the kitchen-sink `ThemeToggle` now describe a state the app cannot enter.** |
| `apps/web/lib/proper-nouns.json` | **W1-C** | Added 17 terms — `1Çatı` and every publisher name in the dataset (§3c). Purely additive to `properNouns`; no existing entry changed. The file is shared gate config read by both the app module and `check-i18n.mjs`, and the omission meant publisher names were not pinned across locales at all. |
| `scripts/ts-resolve-hooks.mjs` | W1-B (me) | Added `@/*` → `apps/web/*` alias resolution. Purely additive: an aliased specifier previously threw `ERR_MODULE_NOT_FOUND`, so nothing that resolved before can change. Needed because W2-A's repositories import through the alias, and a probe that cannot load a repository can only test a re-implementation of it. |

One German string was rejected by `check-i18n` rule 6 (`"Anmerkung der Erhebung"` was 1.83× its
English source) and shortened to `"Erhebungsnotiz"`. The gate is doing real work.

---

## 8. Requests for other windows

| # | Owner | Request |
|---|---|---|
| 1 | **W3-B** | **Publish `HANDOFF/W3-B.md`.** Four W3-C deliverables and three of the four cockpit views are waiting on the `data-table` contract. The specific things I need from it: the virtualisation API, how a row renders a `ReactNode` cell (every price cell is a `ProvenanceValue`), how sorting handles `null` (the brief requires nulls last in **both** directions, never treated as `0`), and whether row tinting is a supported prop — the `modelled` honesty control needs a tinted row, not just a badge. |
| 2 | **W0-B** | **F-002's `message` quotes a 2.1× range computed across two currencies** (Haspo EUR 112,000 → Housearch USD 239,171). Our own rule is that those two numbers cannot be compared without a rate. The EUR-only span is 2.77×. The UI now scopes its own ratio per currency, so nothing is wrong on screen — but the dataset's headline figure is derived by a method the product forbids, and W3-A or a report may quote it verbatim. Suggest either dropping the ratio from the message or stating it per currency. |
| 3 | **W2-A** | **The seed's F-002 says "four publishers" and lists three.** `lib/evidence-data.ts` condenses `competingValues` to Haspo / Seaside / Housearch and drops Alanya-Home, while keeping the "four publishers" wording. A panel built on `Finding.competingValues` would therefore *understate* a conflict — the one direction this product must never fail in. This module reads the **listings** for its numbers and the finding only for its narrative, so it is unaffected; a window that trusts `competingValues` would not be. |
| 4 | **W0-B** | **`PortalListing` carries no `snapshotHash`.** A listing row can link its live URL but not the stored snapshot unless its URL also happens to be in the source register. Ten of the 21 rows currently fall back to a live-URL-only chip. Invariant 6 exists because a citation you cannot re-open is not a citation, and a portal listing is the most likely thing in this dataset to be edited or deleted. |
| 5 | **W1-C** | `evidence.label.sourceCount` uses ICU plural syntax (`{count, plural, …}`) while W1-D's provenance components take plain `{count}` templates and interpolate themselves. They are not interchangeable — passing an ICU string to `interpolate()` renders the ICU source. Not a bug today (I did not use that key), but worth a note in the catalogue so the next window does not discover it at render time. |
| 6 | **W4-A** | The evidence route is behind the W1-B route guard, so an e2e pass needs an authenticated session or a QA access profile. See §9. |
| 7 | **W1-D** | **The app is light-only now** (§3b). Your Playwright design suite asserts `<html class="dark">` and the kitchen-sink ships a `ThemeToggle`; both now test a state that cannot occur. Nothing is gated on that suite so nothing is red, but it should be trimmed rather than left to fail confusingly later. The `.dark` block in `globals.css` is dead code — your call whether to remove it or keep it against a future reversal. |
| 8 | **W1-C** | I added 17 terms to `proper-nouns.json`, including `1Çatı` (§3c). Two things worth your eye: the ordering matters (longer names must precede `Alanya` / `Azura` or the stripper leaves fragments), and the list is still missing anything W3-D…W3-H introduce. Worth a pass once their copy lands. |

---

## 9. Known gaps

- **`[GAP]` The page has never been served under `next start`.** Not an oversight: `/de/dashboard/evidence`
  is under the `/dashboard` prefix that `proxy.ts` protects, and in a production build with no
  Supabase configured `accessProfilesEnabledForEnvironment()` is hard-`false`, so the route
  correctly **307s to `/de/login`**. That is the W1-B guard working as designed — no flag can open
  it in production — and it means production-mode visual verification needs a seeded session.
  The visual review therefore ran under `next dev --webpack`, and the production-mode evidence is
  `qa:csp` (21/21, on a build containing this route) plus the build table showing it as `ƒ`.
  **W4-A should treat "the evidence cockpit renders under `next start` with a real session" as an
  open verification.**
- **`[GAP]` The `modelled` vs `portal_listing` split is NOT rendered anywhere yet.** The brief's
  honesty control — 25 real listings and 631 modelled units, distinguishable at a glance in the
  list, with the split in the header — belongs to the units table, which is blocked on §8.1.
  W0-B's numbers for the record: **25 `portal_listing` + 631 `modelled` = 656**. Nothing in this
  module currently displays a modelled unit, so nothing currently misrepresents one.
- **`[GAP]` No CSV export.** Blocked with the tables. When it lands it must carry provenance
  columns; an export that strips sources recreates the problem this system exists to solve.
- **`[GAP]` The permission matrix is unproven for this route.** The brief requires `manager` reads
  findings but cannot annotate, `admin` can, `tenant` gets 403. There is no annotation UI yet and
  no per-role render test. The route-level guard is W1-B's and is verified; the per-role behaviour
  on this page is not.
- **`[GAP]` Turkish and Russian unreviewed visually** (§3).
- **The observation notes are long and English.** Two rows carry four-line "WRONG-DISTRICT SUSPECT"
  paragraphs that dominate their rows. They are the harvest's verbatim caveats and truncating
  evidence to tidy a layout is not a trade this module should make — but if a later pass wants
  them collapsed, the honest shape is a disclosure that is open by default, not a tooltip.
- **The seed slice is labelled, not hidden.** Running without Supabase, `getFinding` and
  `getPortalListings` return `source: "local-seed"` and the page renders a persistent notice
  saying so (CONTRACTS §4). The portal seed happens to be complete — all 47 listings — while the
  evidence seed is a deliberate 10-finding slice; the notice does not distinguish the two, and it
  errs toward warning.
