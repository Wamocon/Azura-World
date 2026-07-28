# HANDOFF — W0-B Evidence layer: harvest → dataset → conflict register

STATUS: COMPLETE
Completed: 2026-07-27
Wave: 0 · Blocks: W3-C, W3-G, W2-C

## What was built

- **`scripts/sources.config.json`** — the source estate as data. 30 registered sources (the ticket's
  23, with #15 split into four accounts, plus 6 found during W0-B) + 4 unit-listing sources. Adding a
  source never requires touching a script. Also carries the per-source behaviour the harvester needs:
  `expect` tokens, `requiresHeaded`, `tlsSuspect`, `allowRedirect`, `isStale`, `priceKind`.
- **`scripts/harvest-azura.mjs`** — Playwright Chromium harvest. Real UA derived from the browser's
  own version, per-locale contexts (de/en/tr/ru), robots.txt evaluation, ≥2.5 s between same-host
  requests, ≤3 global / 1 per-host concurrency, cookie-wall dismissal, expect-token polling, full
  HTML + text + full-page PNG + `sha256` per capture, manifest **merge** semantics, run archive and
  a diff against the previous run. `--only` · `--dry-run` · `--units` · `--headed` ·
  `--allow-invalid-tls` · `--timeout` · `--concurrency`.
- **`scripts/azura_parsers/`** — `base.py` (shared contract: `Capture`/`Claim`/`UnitObservation`/
  `ParseResult` + locale-safe money, area, date, floor and layout parsing) and five per-host modules:
  `official.py`, `portal_de.py`, `haspo.py`, `reviews.py`, `secondary.py`. Each is called inside its
  own try/except, so one publisher's redesign costs that host's claims and nothing else.
- **`scripts/build-azura-dataset.py`** — the provenance engine. Claims → `SourcedFact` with the
  confidence ladder from CONTRACTS §1, tier-ordered display values, losing values retained in
  `conflictsWith`, seeded findings F-001…F-010 plus fourteen discovered ones, the 656-unit inventory,
  and emit to TS + SQL + CSV. `--strict` for CI.
- **`scripts/verify-evidence.mjs`** — independent validator. Reads the **emitted artefact**, not the
  builder's state, and **recomputes every snapshot sha256 from disk** rather than trusting the
  manifest.
- **`ANALYSIS.md`** — the situation analysis in Ataberg's register, `[V]`/`[I]`/`[GAP]` throughout.
- **`SOURCES.md`** — status column updated with measured results; §3 appended with F-001′ and
  F-011…F-024; §5 rewritten as delivered-vs-asked.

## Verification actually run

| Command                                          | Result   | Evidence                                                                                               |
| ------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm harvest --units --allow-invalid-tls`       | **PASS** | `validated 45/60 · failed 15 · not attempted 0`, exit 0                                                |
| `pnpm dataset`                                   | **PASS** | `201 claims / 34 fields · 111 unit obs · 25 portal_listing + 631 modelled = 656 · 24 findings`, exit 0 |
| `python scripts/build-azura-dataset.py --strict` | **PASS** | exit 0                                                                                                 |
| `pnpm qa:evidence`                               | **PASS** | `1354 facts checked · 96 snapshots rehashed · no violations`, exit 0                                   |
| `pnpm --dir apps/web typecheck`                  | **PASS** | `tsc --noEmit`, exit 0, no output                                                                      |
| `pnpm --dir apps/web lint`                       | **PASS** | `eslint`, exit 0, no output                                                                            |
| `node scripts/harvest-azura.mjs --dry-run`       | **PASS** | plan for 30 sources / 24 hosts, no network, exit 0                                                     |

### Coverage table (from `pnpm qa:evidence`)

```
  snapshots on disk (sha256 recomputed) : 96
  facts checked                         : 1354

  facts by confidence          sources by status              findings by severity
    confirmed           14       validated                45     critical   2
    single_source       63       failed:expect_missing     4     high       9
    conflicted          13       failed:dns_timeout        3     medium    11
    inferred           631       failed:http_404           3     low        2
    gap                633       failed:robots_disallowed  2
                                 failed:redirected         1
                                 failed:http_500           1
                                 failed:soft_404           1

  units: 25 portal_listing + 631 modelled = 656
```

### Proof the validator rejects — three corruptions, each restored

| Corruption                                    | Result                                                                                                               |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Break a `snapshotHash` cited by project facts | **exit 1** — `inv-6-unresolvable` ×10: _"snapshotHash dddd… (alanya-home.com/…) matches no file under sources/raw/"_ |
| `F-002.resolvedTo = 185000`                   | **exit 1** — `f002-resolved`: _"the 1+1 price spread must stay unresolved"_                                          |
| Relabel modelled units as `portal_listing`    | **exit 1** — `portal-listing-no-observation` ×631                                                                    |
| Restore                                       | **exit 0**, no violations                                                                                            |

**Two of those found real bugs, not just proof.** The first corruption I tried was a no-op — I broke a
hash in `harvest[]` that no fact cites — and the third initially **passed**, because a modelled unit
relabelled `portal_listing` escaped every rule (modelled units legitimately carry the sources their
price was derived _from_). I added `portal-listing-derived-price` and `portal-listing-no-observation`
to close it. The validator also caught a genuine builder bug on its first-ever run: 656 `saleStatus`
facts had `confidence: "gap"` with value `"unknown"` instead of `null`, violating invariant 1.

## Source status — 45 of 60 captures validated

**Recovered from the shallow pass's failures:** `azuraworldhotel` (tier 3), `terrarealestate`,
`turizmguncel` (the F-007 press record), `wyndham-antalyacoast`, `tripadvisor`, `onthebeach`, both
Instagram accounts.

**Still dead, with transport labels:**

| Source                                             | Tier  | Label               | Reading                                                                                |
| -------------------------------------------------- | ----- | ------------------- | -------------------------------------------------------------------------------------- |
| `cebecigroup-project`                              | **2** | `http_500`          | **Not bot-walled — broken.** Serves `Unable to load the requested file: front/404.php` |
| `alanyacebeci`                                     | **2** | `dns_timeout`       | Domain does not resolve                                                                |
| `realtygroup`                                      | 4     | `dns_timeout`       | Domain does not resolve                                                                |
| `alanyhome`                                        | 6     | `dns_timeout`       | Answered the shallow probe hours earlier; dead now                                     |
| `ivm-turkey`                                       | 4     | `soft_404`          | Redirects to `/fark/404.html` — listing removed                                        |
| `booking`, `booking-reviews`, `booking-ticket-url` | 5     | `expect_missing`    | HTTP **202** + empty anti-bot shell                                                    |
| `agoda`                                            | 5     | `redirected`        | Property URL bounces to a city index                                                   |
| `trustpoint`                                       | 6     | `expect_missing`    | 200 serving unrelated Dubai/Avsallar listings                                          |
| `facebook-azuraworldhotel`, `facebook-cebecigroup` | 3/2   | `robots_disallowed` | `Disallow: /`. Respected                                                               |
| `housearch-units-06/07/08`                         | 4     | `http_404`          | Followed links that are dead                                                           |

### Developer sites 2 / 4 and hotel site 5 — the question the brief asks explicitly

- **Hotel site 5: RECOVERED — and it needed no TLS tolerance.** `--allow-invalid-tls` was passed and
  went **unused** (`tlsToleranceUsed: false`). The server sends an _incomplete_ chain that Chromium
  repairs via AIA fetching and Node's strict TLS does not. The fetch failure was real, the diagnosis
  "invalid certificate" was wrong. **F-012.** Nothing is trusted on a waived check.
- **Developer sites 2 and 4: NOT recovered.** #2 serves a genuine application error; #4's domain does
  not resolve. No harvester can fix either.
- **→ F-010 stands in substance.** Tier ≤3 validated: 5 captures (the hotel site, the Cebeci projects
  index, azuraworld.com, two Instagram accounts). **Not one of them states a single structural
  figure** — no block count, unit count, area, date, distance or price. **Every structural number in
  this dataset rests on tier 4–6.** W3-A and W3-C must surface this in the UI, not bury it.

## Findings: 24 total — 2 critical, 9 high, 11 medium, 2 low

### Which of F-001…F-010 the harvest resolved

|                        | Status                                                                                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **F-001** blocks       | **CORRECTED.** Housearch never claimed 3 — that figure is its _developer-portfolio_ counter ("Cebeci Group — 3 new buildings"), not a claim about this project. The conflict never existed. `residenceBlockCount = 7` now **confirmed across 3 hosts** |
| **F-002** 1+1 price    | **UNRESOLVED, permanently.** `resolvedTo: null`, and `qa:evidence` fails the build if anyone sets it. Now backed by **21 deduplicated observations across 6 publishers**                                                                               |
| F-003 sea distance     | Widened, not resolved — new **500 m** readings from Capital Estate and TERRA join 300 m and 200 m                                                                                                                                                      |
| F-004 Alanya centre    | Stands (15 km display)                                                                                                                                                                                                                                 |
| F-005 Antalya airport  | Stands, unresolved                                                                                                                                                                                                                                     |
| **F-006** build status | **Strengthened — now has tier-2 backing.** Cebeci's own index files the project under its "Finished Projects" filter. Haspo's "will be completed May 2024" and Capital Estate's "Readiness 90%" retained                                               |
| **F-007** rebrand      | **Complicated — see F-017.** `brandAffiliation` resolved to `null` with the 2023 licence announcement retained in `conflictsWith`                                                                                                                      |
| F-008 green area       | Stands. **Now arithmetically corroborated by two hosts** — TERRA independently gives the same 20,000 / 15,000 / 41,000 breakdown summing to 76,000                                                                                                     |
| F-009 founded year     | Stands (1982, 3 hosts)                                                                                                                                                                                                                                 |
| **F-010** authority    | **Measured, not resolved.** 5 tier-≤3 captures, none stating a structural figure                                                                                                                                                                       |

### New findings, F-011 … F-024

| Id          | Sev          | What                                                                                                                                                                                                                                                                                  |
| ----------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-011       | high         | No unit-by-unit inventory exists; 631 of 656 units are modelled                                                                                                                                                                                                                       |
| F-012       | medium       | The "invalid TLS" diagnosis was wrong — incomplete chain, browser-repaired                                                                                                                                                                                                            |
| F-013       | high         | **Alanya-Home publishes the project twice** — id 466 (from €220,000, updated 2023-02) vs id 891 (from €125,000, updated 2025-08)                                                                                                                                                      |
| F-014       | high         | **The ticket's Booking.com URL is a different property** (an apartment near Alanya centre). The hotel kept its pre-rebrand slug `wyndham-alanya.html`                                                                                                                                 |
| F-015       | medium       | Facebook `Disallow: /` — not fetched, recorded as unavailable rather than empty                                                                                                                                                                                                       |
| F-016       | high         | **Two "independent" review scores are one number.** OnTheBeach's 4.6/5 is an embedded Tripadvisor widget with the same location id; the Wyndham page's 6.7/10 is a Booking badge. Filed under the serving host they would have satisfied invariant 3 and been promoted to `confirmed` |
| F-017       | high         | **Four confusable Cebeci properties** — the developer's index lists "Wyndham Hotel Alanya" as a _separate_ project in the same district as Azura World. F-007's identity assumption is consistent but unproven                                                                        |
| F-018       | **critical** | **The hotel's own site links the wrong property's Tripadvisor page** (`Azura_Deluxe_Resort_Spa-Avsallar`, a different Cebeci hotel 60 km away)                                                                                                                                        |
| F-019       | high         | **Two Haspo listings are tagged to the wrong district** (Oba, Mahmutlar). The Oba one is the €112,000 low anchor of the entire F-002 range                                                                                                                                            |
| F-020…F-024 | medium       | `project.developer` spelling, `floorsPerBuilding` 6 vs 5, Gazipaşa 60/54/30, **`hotel.roomCount` 188 vs 112**, **`hotel.aquaparkSlides` 13 vs 16**                                                                                                                                    |

## Unit split

**25 `portal_listing` + 631 `modelled` = 656.**

- Real units come only from observations that identify **one apartment** — the publisher's own
  listing id plus a stated size. 17 Haspo detail pages (the 18th is a rental) + 8 Seaside referenced
  rows.
- Aggregates like Housearch's _"1BR from $238,967"_ and TERRA's _"From €200,000, 81–349 m²"_ are
  **not** seated as units. They are real evidence about a price band, not about an apartment; seating
  them would have put ~24 fictional apartments in the inventory whose sources genuinely resolve.
  They survive in `portalListings` (47 entries) and in F-002.
- Modelled units carry `confidence: "inferred"` with the derivation named (median observed EUR/m² per
  layout × median observed area) **and a statement that the underlying basis is itself disputed via
  F-002**, or `gap` where no basis exists.
- **Block/sequence ids are internal addressing keys, not developer unit numbers — including for the
  25 real listings**, whose position in the project no portal states. This is in each unit's
  `askingPrice.note`.

## Contracts I consumed

`SourcedFact` / `SourceRef` / `Confidence` / `SourceTier`, `AzuraWorldDataset`, `HarvestEntry`,
`AzuraUnit`, `Money`, `UnitLayout`, `ReviewSource`, `PortalListing`, `Finding` — all as frozen. They
fitted. Two notes:

1. **`AzuraUnit` has no `note` field**, so the "this id is an addressing key, not a unit number"
   caveat lives in `askingPrice.note`. It fits, but a unit-level note would be a better home.
2. **`ReviewSource.sentiment` is `{positive, mixed, negative}`** while Tripadvisor publishes five
   buckets. Both shapes are stored — the five literal buckets are the lossless record, the three-way
   fold satisfies the contract.

## Decisions I made

- **Generated TS declares its own interfaces** rather than importing from `apps/web/lib/contracts.ts`
  (W0-A). The brief says only the final emit needs the repo to compile, and this mirrors the
  reference file `new-level-premium-data.ts`. See request 1 below.
- **`satisfies` without `as const`.** The reference uses both, but `as const` makes every array
  `readonly` (which does not satisfy an interface declaring mutable arrays) and would ask tsc to
  instantiate a literal type per unit across 656 units.
- **Robots: an explicit `Disallow` is respected and the source is skipped.** An _unobtainable_
  robots.txt (5xx / network error) is recorded as `unavailable` and the fetch proceeds — this is a
  bounded one-page-per-source review, not a crawl. Recorded per source in the manifest.
- **Manifest merges, never replaces.** A `--only` run must not erase the other 29 sources; that would
  be the silent regression the brief forbids, and the diff would read as 29 deletions.
- **`requiresHeaded` lives in the config, not in an operator's memory.** Tripadvisor and OnTheBeach
  serve "Please enable JS" to a headless context; the harvester launches a second headed browser only
  for sources that declare the need, so one command reproduces the whole harvest.
- **Publisher-level flags (`isStale`, `priceKind`) are read from the config at build time**, not from
  the manifest snapshot — the parser pass found the German and English captures of the _same_ Haspo
  page disagreeing about their own staleness.
- **Prior snapshots are retained** (96 HTML files for 60 current captures) so re-runs diff rather than
  overwrite.
- **`scripts/azura_parsers/` is a new subtree** not named in the ownership matrix. It is the
  implementation of "per-host parser modules" required by my brief, and nothing else writes it.

## Requests for other windows

| #   | File                                      | Owner      | Request                                                                                                                                                                                                                                                                                                                                      |
| --- | ----------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `apps/web/lib/contracts.ts`               | **W0-A**   | Export `assertFactInvariants`. `verify-evidence.mjs` implements the six invariants against the CONTRACTS §1 spec because that helper does not exist yet — **two implementations of one rule set is a drift risk.** The validator should delegate once it lands                                                                               |
| 2   | `.gitignore` (line 22)                    | **W0-A**   | `sources/raw/` is git-ignored, so **the HTML snapshots every citation resolves to are not versioned.** Invariant 6 holds on this machine and would fail on a fresh clone. Either commit the `.html` (≈42 MB; the 135 MB of PNGs should stay ignored) or accept that evidence is regenerable-but-not-versioned — and say so somewhere visible |
| 3   | `scripts/azura_parsers/__pycache__/*.pyc` | **W0-A**   | A `.pyc` was swept into commit `21b4119`. I added a scoped `scripts/azura_parsers/.gitignore`; the tracked file still needs `git rm --cached`                                                                                                                                                                                                |
| 4   | ORCHESTRATION §4                          | —          | `sources/*` is listed as W0-B's while `sources/media/*` is W0-D's. Minor overlap; W0-D's subtree should be carved out explicitly                                                                                                                                                                                                             |
| 5   | W3-C / W3-G                               | W3-C, W3-G | See the render contract below                                                                                                                                                                                                                                                                                                                |

## The exact `SourcedFact` paths W3-C and W3-G will render

**Project** (`azuraWorldDataset.project.*`) — all `SourcedFact`:
`developer` · `developerFoundedYear` · `plotAreaSqm` · `greenAreaSqm` · `buildingFootprintSqm` ·
`outdoorFacilityAreaSqm` · `residenceBlockCount` · `buildingCount` · `floorsPerBuilding` ·
`totalUnits` · `constructionStart` · `completionDate` · `buildStatus` · `distanceToSeaM` ·
`distanceToAlanyaCentreKm` · `distanceToGazipasaAirportKm` · `distanceToAntalyaAirportKm` ·
`downPaymentPercent` · `contact.phone` · `contact.email` · `contact.address`
Plus `project.social[]` = `{platform, url, source}` (not a `SourcedFact`).

**Hotel** (`azuraWorldDataset.hotel.*`) — all `SourcedFact`:
`name` · `formerName` · `stars` · `roomCount` · `floors` · `openedYear` · `board` ·
`aquaparkSlides` · `distanceToBeachM` · `checkIn` · `checkOut` · `brandAffiliation` _(value is
`null` — do not render "Wyndham"; the 2023 licence is in `conflictsWith`)_

**Units** (`azuraWorldDataset.units[]`, 656): `askingPrice` and `saleStatus` are `SourcedFact`;
`competingPrices[]` carries every rival observation. **Branch on `dataQuality`** —
`"portal_listing"` (25) vs `"modelled"` (631).

**Reviews** (`azuraWorldDataset.reviews[]`, 3): `score`, `reviewCount`, `ranking` are `SourcedFact`;
`scoreScale` is a bare `5 | 10` — **always render the scale**, 4.6 means nothing without it.
`notableQuotes[]` is verbatim text; render as **text**, never `dangerouslySetInnerHTML`.

**Also on the dataset:** `findings[]` (24) · `portalListings[]` (47) · `harvest[]` (60) ·
`unitSplit` · `coverage` · `blocks[]` (7, all `dataQuality: "modelled"`).

### Four things the UI must not do

1. **Never render a single 1+1 price.** F-002 is unresolved by design. Range + all sources + a
   "prices disagree across portals" badge.
2. **Never render a modelled unit as a listing.** 631 of 656. The data enforces the honesty; W3-C
   enforces the appearance.
3. **Never present a structural figure as authoritative.** No tier-1/2 source states any of them.
4. **Never show a review average without its distribution.** The captured spread is 6 positive vs 4
   critical and the mean of captured cards (3.5) is a full point below the 4.6 aggregate.

## Known gaps

- **Booking.com and Agoda scores** — anti-bot HTTP 202 / property record gone. The only Booking
  figure in the harvest is second-hand, on the dead brand's page, from 10 reviews.
- **Tripadvisor reviews 11–309** — page 1 only. 2★ reviews are absent from the quote set purely
  because of pagination; the histogram says 8 poor + 11 terrible exist.
- **The two review titles quoted in `SOURCES.md` §4** are not in this snapshot (grepped, zero hits) —
  they are on later pages.
- **Facebook** — robots-disallowed. Instagram is login-walled: `<head>` metadata only, no post dates
  or build updates, so ticket item 7 is only partly met.
- **Whether "Wyndham Hotel Alanya" is this property** (F-017) and **whether the Oba/Mahmutlar
  listings belong to this project** (F-019) — the latter leaves the bottom of the price range
  unsettled.
- **Kalinka's entry price** ("from 184,91 thsd USD") is unparsed: `base.py` has no scale-word
  handling and multiplying a source's number by 1000 is exactly the error that still looks like a
  plausible price. Surfaced verbatim.
- **`base.parse_iso_date` does not read "Month D, YYYY"**, so ENS Pride's _"Construction Start:
  January 30, 2022"_ is surfaced rather than claimed. The dates are confirmed from other hosts
  anyway; extending `base.py` would recover the corroboration.
- **Tripadvisor's histogram sums to 350 against a stated 359.** Recorded, not reconciled.
- **`pnpm harvest` is not idempotent by design** — each run writes new timestamped snapshots. Old
  ones are retained deliberately so re-runs produce a diff.
