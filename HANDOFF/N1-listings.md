# HANDOFF — N1 Portal listings (`/dashboard/listings`)

STATUS: COMPLETE
Completed: 2026-07-28 · Branch: `feature/INTERNAL-107-n1-listings` · Worktree: `D:\azura-n1`
Commits: `8d76a66` (module), `e54e6d5` (browser verification + three fixes)

Closes the first of the two deliverables `HANDOFF/W3-C.md` §12.7 left unbuilt. It is
**acceptance criterion 3** — _"Informationen aus Immobilien-Portalen einbeziehen"_.

---

## 1. What was built

| File                                                  | What it is                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| `app/[locale]/dashboard/listings/page.tsx`            | The route. Server Component, no client JS of its own           |
| `components/inventory/listing-analysis.ts`            | Every derivation: bands, groups, comparison, filter blame      |
| `components/inventory/listing-price-comparison.tsx`   | The side-by-side that makes F-002 legible                      |
| `components/inventory/portal-claim-matrix.tsx`        | Which publisher claims what about the building                 |
| `components/inventory/publisher-listing-group.tsx`    | The register, one block per publisher                          |
| `components/inventory/listing-stale-badge.tsx`        | The stale marker, shared so it cannot drift between surfaces   |
| `scripts/listings-verify.mjs`                         | 55 assertions in Chromium against a production build           |
| `apps/web/messages/{de,en,tr,ru}.json`                | `dashboard.listings.*`, one contiguous hunk per file           |
| `apps/web/lib/dashboard-routing.ts`                   | Removed `pending: true` from the listings entry. One line      |

Four sections, in the order that carries the argument:

1. **what was collected** — 47 rows · 7 publishers · 2 currencies · 18 stale;
2. **the same layout across publishers, side by side**, prices as published;
3. **what each publisher claims about the building itself**;
4. **every row, grouped by who published it**.

The comparison sits **above** the register deliberately. A reader who meets the 47 rows
first reads them as a price list. A reader who meets the disagreement first reads them
as evidence.

---

## 2. How currency mixing is presented, and whether any conversion is offered

**No conversion is offered anywhere. There is no toggle, and adding one would need a rate
and a rate date that no source in this dataset publishes.**

- One column per currency. They are never joined, and between them sits a stated separator
  reading _"nicht vergleichbar, keine Umrechnung"_ — the incommensurability is the layout,
  not a footnote under it.
- Every figure renders through W1-D's `formatMoney`, which is `Intl.NumberFormat` with the
  value's own currency. `239.171 $` stays dollars in all four locales.
- Each column reports `max / min` **within its own currency**, labelled: _"Spanne 2,8-fach
  (nur EUR)"_ · _"nur ein Preis"_ for USD.
- `bandsByCurrency()` has no code path that returns one figure across two currencies, so a
  caller cannot produce one by forgetting an argument.
- **Sale and rent never share a band.** Two of the 47 rows are monthly rents (€2 100 and
  €1 000). A €1 000 rent inside a sale series would be the cheapest "1+1 for sale" on
  screen, wrong by two orders of magnitude.

### F-002's 2.1×, and the number this page refuses to compute

The page shows the four figures F-002 names — **112.000 € · 185.000 € · 220.000 € ·
239.171 $** — and quotes the finding's own 2.1× **as the finding's wording, attributed**:

> _"Befund F-002 nennt eine Spanne von 2,1-fach über vier Portale. Diese Zahl vergleicht
> einen Euro-Preis mit einem Dollar-Preis. Wir rechnen nicht um, deshalb steht oben je
> Währung eine eigene Spanne."_

That 2.1× is Haspo's €112 000 against Housearch's $239 171 — the exact cross-currency
comparison this product forbids. The EUR-only span is 2.8×. This is W3-C §8 request 2 to
W0-B, still open, and this page handles it by attribution rather than by recomputation.

---

## 3. The `claimed*` columns are null on all 47 rows, and the page says so

The brief asks for each portal's own `claimedBlockCount`, `claimedTotalUnits` and
`claimedBuildStatus`. **All three are `null` on every listing**, in the seed and in the
generated dataset. The columns exist in migration 05; W0-B's parser never populates them.
That is a harvest gap (recorded in the W2-A handoff), not a licence to invent a claim.

Three empty columns would have read as _"no portal claims anything"_, which is not what the
data says. So the page does two things instead:

1. **States the gap in words**, under the matrix: _"Die Erhebung hat die Projektangaben je
   Inserat nicht mitgeschrieben. Alle 47 Zeilen sind dort leer. Die Tabelle oben stammt
   deshalb aus dem Quellenverzeichnis, nicht aus den Inseraten."_
2. **Answers the question from evidence that does exist.** Every structural figure is a
   `SourcedFact` whose `sources[]` name the publishers backing the displayed value and
   whose `conflictsWith[]` keeps the publishers backing a different one, with their URLs
   and fetch dates. `buildClaimRows()` pivots **both halves** by publisher.

**A cell never shows the resolved value in a dissenting publisher's row.** Measured:

```
Haspo Realty   Immobilienportal   Keine Angabe · Keine Angabe · Im Bau [ABWEICHEND] 27.07.2026
Housearch      Immobilienportal   Keine Angabe · Keine Angabe · Fertiggestellt      27.07.2026
Seaside Alanya Immobilienportal   7 · 656 · Keine Angabe
Capital Estate Presse             7 · Keine Angabe · Keine Angabe
ENS Pride      Presse             7 · 656 · Keine Angabe
```

Haspo saying "Im Bau" two years after a corroborated completion is F-006, and it is the
same fact that makes all 18 of its listings stale. The page shows the cause and the effect
on one screen.

---

## 4. The stale badge

`PortalListing.isStale` is a **stored column** set by the evidence pipeline, never
recomputed in the app — two implementations of one rule give the product two answers.

Measured: **the badge is inside the price cell in 18 of 18 stale rows**, plus in the
comparison cell next to the price, plus in the publisher block header. Its border is
**dashed** where every neighbouring chip is solid, so the distinction survives greyscale,
print and colour vision deficiency. It carries its reason in the document, not on hover:

```
Veraltet — Das Portal nennt das Projekt noch im Bau, obwohl es 2024 fertig wurde.
```

---

## 5. Verification actually run

| Command                            | Result                     | Evidence                                          |
| ---------------------------------- | -------------------------- | ------------------------------------------------- |
| `pnpm --dir apps/web typecheck`    | **PASS** exit 0            | `tsc --noEmit`, no output                         |
| `pnpm --dir apps/web lint`         | **PASS** exit 0            | 0 errors, **0 warnings**                          |
| `pnpm --dir apps/web build`        | **PASS** exit 0            | `ƒ /[locale]/dashboard/listings` — **dynamic**    |
| `node scripts/check-i18n.mjs`      | **PASS** exit 0            | **937 keys × 4 locales**, identical key sets      |
| `node scripts/listings-verify.mjs` | **PASS** — **55 pass · 0 fail**, exit 0 | production build, real Chromium       |
| `prettier --check` on owned files  | **PASS**                   | after one `--write` pass                          |

Screenshots (not committed, same convention as `quality/w3c/`):
`quality/n1-listings/listings-de-desktop.png` · `-en-desktop.png` · `listings-de-320.png`.
`results.json` **is** committed — it is the machine-readable record of the 55 assertions.

### The brief's definition of done, item by item

| Brief requirement                                            | Result                                                                                |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Every scraped listing, grouped by publisher                  | **PASS** — 47 rows, 7 groups, all seven publishers named                               |
| Per listing: URL, fetch date, layout, size, price            | **PASS** — plus price kind and the verbatim harvest note                               |
| Price in its own currency                                    | **PASS** — `239.171 $` never appears as euros, in either locale                        |
| Each portal's own claims                                     | **PARTIAL, and stated** — see §3. The `claimed*` columns are empty in the harvest      |
| Stale badge **next to the price**, not a footnote            | **PASS** — 18/18 rows, badge inside the price cell                                     |
| Comparison view, same layout across publishers               | **PASS** — one column per currency, prices unconverted                                 |
| Filter to zero → explanatory empty state                     | **PASS** — names the responsible filter, offers a link back                            |
| `gap` price → never `0`, never blank                         | **PASS** — "Keine Angabe" throughout; no listing in this set lacks a price             |
| German price format `112.000,00 €`                           | **PASS** — `Intl` end to end, no string parsing of a formatted number anywhere         |
| Sorting `null` last, both directions                         | **PASS** — `sortListings()`; unpriced rows sort last regardless of direction           |
| 320px German, no horizontal scroll                           | **PASS** — `scrollWidth 320 = clientWidth 320`                                          |
| Reduced motion → complete page                               | **PASS** — 0 elements left at `opacity: 0`                                             |
| Tap targets ≥ 24px                                           | **PASS** — 0 violations                                                                |
| Permission matrix                                            | **PASS** — see §6                                                                      |

### NOT RUN

- **CSV export.** Not built for this module. The brief's export requirement is written
  against the units and evidence surfaces; `/dashboard/evidence/export` exists and carries
  provenance columns (W3-C §12.3). A listings export would be new scope, and it is named
  here rather than silently skipped.
- **Screen reader.** Semantics are correct by construction — `<caption>` on every table,
  `<th scope>`, `aria-hidden` on the dashed rules, every warning in the document rather
  than in a tooltip — but nothing was driven with NVDA or VoiceOver. Same standing gap as
  W1-D's and W3-C's.
- **Turkish and Russian visually.** Their keys are real translations and pass `check-i18n`,
  but only `de` and `en` were rendered. Russian runs ~35% longer than English and 320px
  Russian is the case most likely to break.
- **Lighthouse / LCP / INP / CLS.** `qa:perf` is W4-B's.
- **A real production runtime.** See §7.

---

## 6. Permission matrix, measured per role

```
admin              200 · sees listing data
manager            200 · sees listing data
staff              200 · sees listing data
service_provider   refused · NO listing data in the payload  (clean)
child_guest        refused · NO listing data in the payload  (clean)
```

The refusal is **server-side, in the page body, before any repository call**. This is the
SEC-003 lesson from the evidence cockpit: `DashboardRouteGuard` is a client component, and
by the time it decides, a Server Component has already rendered into the RSC flight
payload. The assertion is written as a leak test — it greps the response for `Haspo
Realty`, `Housearch`, `239.171` and `112.000` — rather than as "a 403 panel is shown",
because the visible panel was never the thing in doubt.

---

## 7. Why this is not `next start`

Same three blockers W3-C §12.1 documented, unchanged:

1. `accessProfilesEnabledForEnvironment()` returns `false` for any process where
   `NODE_ENV` is `production`, **before it reads a flag**, and `next start` sets exactly
   that. So `/de/dashboard/listings` correctly 307s to `/de/login` there.
2. `docker info` exits 1, so `supabase start` cannot run and no real session can be seeded.
3. `/[locale]/login` has no `page.tsx`, so there is no form to drive.

The harness boots Next programmatically with `dev: false` — the same `.next` artifact
`next start` serves, in a process where the access profile is reachable.

**What that proves:** the production *compilation* renders and gates this page.
**What it does not:** it is not a production *runtime*. It says nothing about production
environment variables, production nonce generation, or a real session.

---

## 8. Three defects the render caught that reading the code did not

Recorded because each shipped green through typecheck, lint and build.

1. **The currency separator painted over the last EUR card.** `lg:w-px` sized the flex item
   to the hairline while its rotated caption is about `1em` wide, so the label overflowed
   onto the column beside it. A rule is a hairline; a rule *with a label on it* needs the
   label's width. The assertion is now geometry — the columns' bounding boxes must not
   intersect — not a class name, because a class name would have passed the broken version.

2. **The layout-unstated band called every row an "entry price".** Wrong for three of six.
   Alanya-Home's and TERRA's rows are "price from" overview figures; Capital Estate's are
   specific 305 m² and 312 m² apartments whose page states "5+ rooms", a label outside the
   frozen `UnitLayout` union. Copy in all four locales now names both causes.

3. **That band also showed "Spanne 11,6-fach"**, computed across a "from" price and a
   penthouse. A spread is a claim that the figures at either end describe comparable
   things, and those do not — the same reasoning that keeps EUR and USD apart. Suppressed
   with an explicit `showSpread={false}` and the reason written at the prop.

### And three of my own assertions were wrong first

Two of them would have been reported as green.

- **`!/umgerechnet|approx|≈/` failed on the page's own promise**, _"Nichts wird
  umgerechnet."_ Asserting the absence of a word was the wrong shape: the word is there
  precisely because the page refuses to convert. It now looks for an *equivalence* — a
  figure offered as the same money in another currency — and separately requires every
  mention of conversion to be a negation of it.
- **`[data-slot='price-comparison']:first-of-type`** selects by **element type** among
  siblings, not by the attribute in front of it, and the two panels are not siblings. It
  reported a single `EUR` column and would have passed a comparison with no USD column at
  all. Scoped in JS now.
- **The desktop screenshot was taken while the page was still on the filter-to-zero URL**,
  so the "evidence" of the register was a picture of its empty state.

---

## 9. Decisions

- **Server Component, server-side filters as links, zero client JavaScript.** Mirrors
  `dashboard/units`. It cannot be broken by the S-009 CSP class, it works with JS off, and
  there is no hydration boundary between a price and its caveat.
- **One fetch of the whole register (47 rows), every section derived in memory.** A query
  per section would let two sections disagree if a harvest landed mid-render, and the
  counts are the point of the page.
- **`?layout=` scopes the comparison only, never the register.** The register's job is to
  show every collected row; a layout defaulting to `1+1` would hide 30 of 47 on first load.
  `ListingFilter` therefore has no `layout` field at all, rather than a field the register
  never sets and a message key that never renders.
- **Publishers sorted by row count descending, not alphabetically.** Haspo's 18 rows and
  TERRA's 2 are not equally strong evidence about the same project, and an alphabetical
  list hides that behind the letter A.
- **Overview counts carry a caveat directly beneath them.** "47 Inserate" with no qualifier
  reads as "47 apartments are for sale". The copy says these are counts of what this
  collection found.
- **No ranking, no "best value", no midpoint, no median.** `F-002.resolvedTo` is `null` by
  design and `qa:evidence` fails the build if anyone sets it.
- **The claim matrix keeps every citation of a repeated assertion.** Four language editions
  of one Housearch page are one voice, not four; dropping three would hide that it is one
  voice. The cell shows the first date and `+n`.

---

## 10. Requests for other windows

| #   | Owner              | Request                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **W1-C / W3-C**    | **`app/[locale]/dashboard/units/page.tsx` calls two message keys that do not exist**: `common.notAvailable` and `common.dataSource.localSeedHint`. Verified absent from all four catalogues. `check-i18n` cannot see it (it compares catalogues, not call sites), so the page renders next-intl's missing-message fallback where it means to say "no price" and "this is seed data". Two keys, or two call sites. |
| 2   | **W0-B**           | **Populate `claimed_block_count` / `claimed_total_units` / `claimed_build_status`.** Null on all 47 rows. The per-portal structural claim is exactly what a competitor-intelligence screen is for, and the page currently has to reconstruct it from the fact register. The parsers already read these pages.                                                                                          |
| 3   | **W0-B**           | Still open from W3-C §8.2: **F-002's `message` quotes a 2.1× computed across two currencies.** This page attributes it rather than recomputing it, but a report that quotes the message verbatim would be publishing a figure the product forbids. Per-currency, or drop the ratio.                                                                                                                    |
| 4   | **W0-B**           | Still open from W3-C §8.4: **`PortalListing` carries no `snapshotHash`**, so every one of the 47 rows links a live URL and no archive. A portal listing is the single most likely thing in this dataset to be edited or deleted.                                                                                                                                                                       |
| 5   | **W3-B / W3-C**    | **`dashboard-routing.ts` still marks `evidence` and `units` as `pending`**, so the sidebar shows "In Arbeit" beside two modules that shipped and are verified from a production build. Visible in `quality/n1-listings/listings-de-desktop.png`. One flag each; not touched here because they are not this window's modules and `dashboard-routing.ts` has several claimants tonight.                  |
| 6   | **W4-D**           | `node scripts/listings-verify.mjs` is a new gate: 55 assertions, exit non-zero on any failure, needs only a production build in `apps/web/.next`. It is the only check in the repository that exercises this module.                                                                                                                                                                                  |
| 7   | **W0-A / infra**   | `@playwright/test` resolves to a Chromium revision that is not installed (`chromium_headless_shell-1234`), while six older revisions are on disk. `evidence-review.mjs` and this harness both carry the same fallback. One `npx playwright install` removes the duplication.                                                                                                                            |

---

## 11. Known gaps

- **`[GAP]` The per-listing `claimed*` fields are empty in the harvest** (§3). The page
  states this; it does not fix it.
- **`[GAP]` No CSV export for this module** (§5, NOT RUN).
- **`[GAP]` Never served from a real production runtime** (§7).
- **`[GAP]` Turkish and Russian not visually reviewed.**
- **`[GAP]` No screen-reader pass.**
- **The seed slice is smaller than the full dataset for the claim matrix.** Running without
  Supabase, `getFactsForEntity` returns W2-A's deliberate slice, so the matrix shows five
  publishers rather than every publisher in the generated dataset — and Cebeci Group
  (tier 2), which backs `buildStatus: completed` in the full data, is absent from it. The
  seed notice is displayed on the page, but it does not distinguish "a slice" from "all of
  it": the 47 portal listings **are** complete while the fact register is a slice. Same
  observation W3-C §9 made about the evidence seed.
