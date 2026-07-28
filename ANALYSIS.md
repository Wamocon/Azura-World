# Azura World Residence & Hotel — Competitor Situation Analysis

**Date:** 27 July 2026 · **Task:** W0-B (INTERNAL-107) · **Method:** Playwright harvest of 60 pages
across 30 registered sources, per-host parsing, provenance reconciliation
**Artefacts:** `sources/manifest.json` · `apps/web/lib/azura-world-data.ts` · `sources/raw/**`

---

## 0. Evidence quality — read this first

Every claim below is labelled:

- **`[V]` Verified** — observed directly in a stored snapshot under `sources/raw/`, in a command's
  real output, or in an HTTP response. Each one is re-openable: the dataset carries a `sha256` for
  the exact bytes it was read from, and `pnpm qa:evidence` recomputes every hash from disk.
- **`[I]` Inference** — my reasoning from verified facts, labelled as reasoning.
- **`[GAP]`** — not established. **Never filled with a plausible guess.** §6 lists all of them.

**The most important `[GAP]`:** there is still **no tier-1 or tier-2 source for any structural
figure** — no block count, no unit count, no area, no date, no distance, no price. The developer's
own site is marketing prose plus a contact block; its project detail page is broken (`[V]`, §2.2).
Every number in §3 rests on tier 4–6 portals. That does not make the numbers wrong — several are
corroborated across six independent hosts — but it means **nobody with authority over this project
has ever published them**, and that must be stated wherever they are displayed.

**Second most important:** the price evidence (§4) is not merely uncertain, it is _structurally_
uncertain. Two currencies, one publisher contradicting itself, one publisher's whole inventory two
years stale, and at least two listings that appear to belong to a different building. F-002 is
deliberately unresolved and must stay that way.

---

## 1. What Azura World actually is

A residence-plus-hotel complex in **Türkler, Alanya, Antalya, Türkiye**, developed by **Cebeci
Group** (est. **1982** `[V]`, three independent hosts). `[V]`

| Figure                       | Value         | Confidence                 | Independent hosts |
| ---------------------------- | ------------- | -------------------------- | ----------------- |
| Plot area                    | **76,000 m²** | confirmed                  | 6                 |
| Total apartments             | **656**       | confirmed                  | 4                 |
| Residence blocks             | **7**         | confirmed                  | 3                 |
| Buildings × floors           | 14 × 6        | single_source / conflicted | 1 (Haspo)         |
| Building footprint           | 15,000 m²     | confirmed                  | 2                 |
| Outdoor / sport / water area | 41,000 m²     | confirmed                  | 2                 |
| Green area                   | 20,000 m²     | **conflicted**             | 3 vs 1            |
| Construction start           | 2022-01-30    | confirmed                  | 2                 |
| Completion                   | 2024-05-30    | confirmed                  | 5                 |
| Distance to sea              | 300 m         | **conflicted**             | 7 hosts, 3 values |
| Down payment                 | from 30%      | single_source              | 1                 |

### The arithmetic cross-check still closes — and now from two hosts `[V]`

Alanya-Home and TERRA Real Estate independently break the site down the same way:

```
green 20,000  +  footprint 15,000  +  outdoor 41,000  =  76,000 m²
```

That is exactly the plot area six hosts state. The identity closing is what settles F-008: ENS
Pride's _"Over 41,000 m² of landscaped green areas"_ is the **outdoor-facility** figure relabelled,
not a competing measurement of green space. `[I]` — but a strong inference, because the alternative
requires the other three components to be wrong by exactly the same amount.

### The hotel

**Azura World Hotel** — 5★, All-Inclusive, **188 rooms** `[V]`, 6 floors, opened **2025** `[V]`,
13-slide aquapark, beach 1 km with shuttle, check-in 14:00 / check-out 12:00. Tripadvisor
**4.6/5 from 359 reviews, #10 of 33 hotels in Türkler** `[V]`.

---

## 2. The source estate

### 2.1 What the deep harvest recovered

Nine of fifteen ticket URLs failed a plain fetch. A real browser recovered most of them. `[V]`

| Source               | Tier | Shallow     | W0-B       | What changed                                   |
| -------------------- | ---- | ----------- | ---------- | ---------------------------------------------- |
| Azura World Hotel    | 3    | TLS invalid | **200 ✅** | The chain is incomplete, not invalid — see 2.3 |
| TERRA Real Estate    | 4    | 403         | **200 ✅** | Ticket URL was wrong; corrected path recovers  |
| Turizm Güncel        | 6    | 403         | **200 ✅** | The F-007 press record now has a snapshot      |
| Wyndham/antalyacoast | 5    | 403         | **200 ✅** |                                                |
| Tripadvisor          | 5    | 403         | **200 ✅** | Needs a _headed_ browser; ids resolved by W0-B |
| OnTheBeach           | 5    | 403         | **200 ✅** | Needs a headed browser                         |
| Instagram ×2         | 2/3  | not probed  | **200 ✅** | Login wall; `<head>` metadata only             |

**45 of 60 captures validated** `[V]`. Validation means the _rendered bytes_ passed — correct
`expect` token, over the size floor, no bot wall, no soft-404, and not silently redirected to an
ancestor page.

### 2.2 What is still unreachable, and why it matters

| Source                        | Tier  | Status              | Reading                                                                                                                          |
| ----------------------------- | ----- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Cebeci Group project page** | **2** | `http_500`          | **Not a bot wall — genuinely broken.** Serves a CodeIgniter error body, `Unable to load the requested file: front/404.php` `[V]` |
| Cebeci Alanya                 | 2     | `dns_timeout`       | Domain does not resolve `[V]`                                                                                                    |
| Realty Group                  | 4     | `dns_timeout`       | Domain does not resolve `[V]`                                                                                                    |
| 7AlanyHome                    | 6     | `dns_timeout`       | Resolved hours earlier on the shallow pass; dead by the deep harvest `[V]`                                                       |
| IVM Turkey                    | 4     | `soft_404`          | Redirects to `/fark/404.html` — listing confirmed removed `[V]`                                                                  |
| Booking.com ×3                | 5     | anti-bot            | HTTP **202** with an empty shell `[V]`                                                                                           |
| Agoda                         | 5     | `redirected`        | Property URL bounces to a city index — the record is gone `[V]`                                                                  |
| Trustpoint                    | 6     | `expect_missing`    | Serves generic Dubai/Avsallar listings (see 2.4)                                                                                 |
| Facebook ×2                   | 2/3   | `robots_disallowed` | `Disallow: /` for all agents. **Respected, not circumvented** `[V]`                                                              |

**The consequence is F-010 and it is unchanged in substance.** The two tier-2 developer sources that
could have carried authority are a broken page and a dead domain. `[I]` The one that _does_ respond
— the projects index — states only that Azura World exists, where it is, and that it is finished.

### 2.3 The "invalid TLS" diagnosis was wrong `[V]`

`azuraworldhotel.com` was recorded as **TLS invalid**. Under Chromium it validated **without any
tolerance flag** (`tlsToleranceUsed: false`). The server sends an **incomplete certificate chain**;
browsers repair that by fetching the missing intermediate (AIA), Node's strict TLS stack does not.

The fetch failure was real. The diagnosis was not. The tier-3 hotel source is fully usable and
**nothing was trusted on a waived check** — `--allow-invalid-tls` was passed and went unused.
Recorded as **F-012**. Worth telling the client: any non-browser client integrating with them
will fail the same way.

### 2.4 Validating bytes, not status lines — three live catches

The rule earned its place three times in this harvest. `[V]`

1. **Trustpoint** returns HTTP 200 for the Azura World path and renders a generic listing page —
   Dubai's Business Bay, Avsallar. Raw HTML contains **47** occurrences of "azura"; the _rendered
   text_ contains **zero**. A naive `html.includes('azura')` would have declared success and handed
   the parser a €395,000 Dubai apartment.
2. **Cebeci's project page** answers with a 200-shaped error body, and an early version of my
   harvester "recovered" it — by following a fallback URL to the projects _index_, whose listing
   contains the project name and so satisfied the `expect` token. Fixed by rejecting redirects that
   land on an ancestor of the requested path.
3. **Three followed Housearch unit URLs** return HTTP 200 bodies reading "This page doesn't exist"
   over a carousel of Dubai villas. The portal parser refuses any snapshot that never names Azura
   World; without that guard it emitted `project.contact.address = "Dubai, Dubailand"`.

---

## 3. The conflict register

24 findings: **2 critical, 9 high, 11 medium, 2 low**. Ten were seeded from `SOURCES.md` §3;
fourteen were found by this harvest. Full text with citations in `apps/web/lib/azura-world-data.ts`.

### F-001 — corrected: the block-count conflict was never a conflict `[V]`

`SOURCES.md` recorded Housearch as claiming **3 residence blocks**, an uncorroborated outlier against 7. Reading Housearch's markup shows it states **no block count for this project at all**. The 3 sits
inside its _developers_ panel and counts Cebeci Group's whole portfolio on Housearch — the site's own
link reads _"Property from Cebeci Group — 3 new buildings"_.

The shallow pass quoted a real number accurately and attached it to the wrong subject. Nothing
contradicts 7 blocks. `residenceBlockCount = 7` is now **confirmed across three hosts**, and
`buildingCount = 14` stands alone on Haspo. **This is the clearest argument in the build for why the
deep harvest was worth doing:** the cheap pass manufactured a plausible conflict out of a correctly
transcribed figure.

### F-006 — build status, now with tier-2 backing `[V]`

Cebeci Group's own index files Azura World under its **"Finished Projects"** filter (CSS class
`bitmis`), and its contact-form project picker labels it _"Alanya · Completed"_. Against that:
Haspo still writes _"will be completed in May 2024"_, and Capital Estate's widget shows
_"Readiness 90%"_ — both read on 2026-07-27, two years after a completion date five hosts confirm.

→ `completed`. **Consequence: every price on Haspo inherits `isStale: true`.**

### F-007 / F-017 — the rebrand is messier than the register assumed `[V]`

The evidence for a Wyndham connection is solid: Turizm Güncel (11 March 2023) reports Cebeci İnşaat
signing a **licence agreement** with Wyndham Hotels & Resorts _for the hotel component_, described as
the first Wyndham licence in Alanya. Agoda and OnTheBeach both list the property as _"ex. Wyndham
Alanya"_, and Tripadvisor **renamed the same property id in place**.

But Cebeci Group's own project index lists **four confusable properties**:

| Project                           | Location              |
| --------------------------------- | --------------------- |
| Azura World Residence & Hotel     | Alanya / Türkler      |
| **Wyndham Hotel Alanya**          | **Antalya / Türkler** |
| Azura Deluxe Resort and SPA Hotel | Alanya / Avsallar     |
| Azura Park Residence              | Alanya / Mahmutlar    |

`[I]` A separately-named Wyndham hotel **in the same district** is consistent with "one property, two
names over time", but it does not establish it, and the register previously treated the identity as
settled. Every hotel fact in this dataset is sourced to a page naming _Azura World Hotel_
specifically; nothing is merged across the four. **F-017, unresolved.**

`brandAffiliation` is `null`: a licence signed in 2023 is not evidence of a brand in 2026, the
hotel's own 2026 site names no chain anywhere, and the 2023 announcement is retained in
`conflictsWith` rather than promoted to a current fact.

### F-018 — the operator cites the wrong hotel's reviews `[V]` · **critical**

`azuraworldhotel.com` — the hotel's own website — links a Tripadvisor page for
`Azura_Deluxe_Resort_Spa-Avsallar` (`g609052-d7391617`), a **different Cebeci hotel 60 km away**. The
correct listing is `g1069655-d33144231`.

Anyone collecting reviews by following the operator's own link attaches another property's ratings to
Azura World — with a citation that resolves perfectly. This is the single most dangerous link in the
source estate, and it is on the most authoritative hotel page we have.

### F-016 — two "independent" review scores are the same number `[V]`

Neither reseller publishes its own guest score:

- **OnTheBeach**'s "4.6/5 from 357 reviews" is an embedded **Tripadvisor widget**, carrying the same
  Tripadvisor location id (`33144231`) as the direct Tripadvisor capture.
- The **Wyndham-brand page**'s "6.7/10 from 10 reviews" is a **Booking.com** badge.

Filed under the serving host, one opinion would have appeared as two independent hosts agreeing —
which is precisely the input that makes a fact `confirmed` under CONTRACTS §1 invariant 3. Each score
is attributed to the platform that _produced_ it. A score whose provenance cannot be read off the
page is not recorded at all.

### F-014 — the ticket's Booking.com URL is a different property `[V]`

`booking.com/hotel/tr/azura-world.html` is a private apartment near Alanya centre (~15 km from
Türkler), not the 5★ hotel. The hotel kept its **pre-rebrand slug**,
`booking.com/hotel/tr/wyndham-alanya.html` — itself further evidence for F-007. Had this gone
unchecked, another property's rating would have been published as Azura World's, correctly cited to a
URL that genuinely resolves.

### F-013 — one publisher, two prices for the same project `[V]`

Alanya-Home publishes Azura World **twice**: property **466** (German, _from €220,000_, from 85 m²,
last updated **2023-02-25**) and property **891** (English, _from €125,000_, 80–300 m², last updated
**2025-08-11**). `[I]` A publisher contradicting _itself_ is a stronger signal about price
reliability than two publishers disagreeing, because portal-to-portal variation has innocent
explanations that this does not. Neither is treated as the correction of the other.

### F-019 — two Haspo listings are tagged to the wrong district `[V]`

Two listings inside the "AZURA WORLD" complex state a district other than Türkler: one says **Oba**,
one says **Mahmutlar** while its own headline says Türkler. **The Oba listing is the €112,000 / 80 m²
entry price that anchors the bottom of the entire F-002 range** and that `SOURCES.md` quotes as
Haspo's 1+1 price.

`[I]` If it is a different building, part of the 2.1× spread in F-002 is an artefact of comparing two
projects. Both are kept, priced as published, and flagged — deleting the cheapest evidence would be
as dishonest as trusting it.

### Remaining conflicts, discovered here, all unresolved

| Finding | Field                                 | Values                                                                       |
| ------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| F-020   | `project.developer`                   | "Cebeci Group A.Ş." / "Cebeci Group LLC" / "Cebeci İnşaat" / "Cebeci-Gruppe" |
| F-021   | `project.floorsPerBuilding`           | 6 (Haspo) vs 5 (Alanya-Home)                                                 |
| F-022   | `project.distanceToGazipasaAirportKm` | 60 / 54 / 30                                                                 |
| F-023   | `hotel.roomCount`                     | **188** (hotel site, Tripadvisor) vs **112** (Wyndham page)                  |
| F-024   | `hotel.aquaparkSlides`                | **13** (hotel site) vs **16** (OnTheBeach, Wyndham page)                     |
| F-003   | `project.distanceToSeaM`              | 300 / 200 / 500 — the 500 m readings are new                                 |

Every conflicted fact in the dataset has a finding: the builder generates one automatically for any
conflict not already covered, so a disagreement recorded in the type system can never be invisible in
the UI.

---

## 4. What the portals disagree about, and why

**21 deduplicated 1+1 / entry-price observations across 6 publishers.** `[V]`

|                                          | EUR                       |                 |
| ---------------------------------------- | ------------------------- | --------------- |
| Haspo Realty (7 listings, **all stale**) | 112,000 – 190,000         | 80–89 m²        |
| Alanya-Home (id 891, updated 2025-08)    | from 125,000              | 80 m²           |
| TERRA Real Estate                        | from 200,000              | size range only |
| Seaside Alanya (2 listings)              | 185,000 – 210,000         | 85–92 m²        |
| Alanya-Home (id 466, updated 2023-02)    | from 220,000              | 85 m²           |
| Capital Estate (3 rows)                  | 230,000 – 310,000         | 58–68 m²        |
| **Housearch**                            | **238,967 – 239,171 USD** | 75 m²           |

The spread is **~2.1×** in EUR alone, and the causes compound. None is a rounding difference:

1. **Currency.** Housearch quotes USD; everyone else EUR. Nothing in this pipeline converts —
   `Money` keeps its currency, and conversion happens only at display, labelled, with a dated rate.
   `[V]` Housearch also moved its own price between two captures **six seconds apart** ($239,171 →
   $238,967), which looks like render-time FX; both are stored, and they must not be read as two
   independent sources.
2. **Staleness.** Every Haspo price — the entire bottom half of the range — is on a listing whose own
   copy still describes the build in the future tense, two years after completion (F-006).
3. **Different products.** Capital Estate's 58–68 m² "1+1" units are a different size class from
   Seaside's 85–92 m². `[I]` Comparing entry prices across portals compares different apartments.
4. **Possibly a different building.** The €112,000 low anchor is tagged **Oba** (F-019).
5. **Aggregates vs listings.** "From €200,000" for a project is not a price for an apartment. The
   dataset marks these `isEntryPrice: true` and never seats them as units.

> **This is why F-002 has no `resolvedTo` and why `pnpm qa:evidence` fails the build if anyone gives
> it one.** A single number here would be a fabrication with a citation stapled to it. The correct
> product behaviour is a range, every source visible, staleness on the face of it, and a "prices
> disagree across portals" badge.

### A rent that would have looked like a bargain `[V]`

Two rental listings sit inside the complex — an Alto Real Estate 1+1 at **€2,100 per month** and a
Haspo 1+1 at **€1,000**. Both are marked `priceKind: "rent"` and are structurally barred from the
sale-price series. Unflagged, a €1,000 "1+1 apartment" would have become the cheapest unit in the
inventory by two orders of magnitude — and it would have had a real listing behind it.

---

## 5. The hotel: rebrand, ratings, polarised sentiment

Ratings are **not** three sources agreeing; they are two numbers from two platforms (F-016).

| Platform                           | Score        | Reviews | Ranking                     |
| ---------------------------------- | ------------ | ------- | --------------------------- |
| Tripadvisor (direct)               | **4.6 / 5**  | 359     | #10 of 33 hotels in Türkler |
| Tripadvisor (via OnTheBeach)       | 4.6 / 5      | 357     | —                           |
| Booking.com (via the Wyndham page) | **6.7 / 10** | **10**  | —                           |

`[V]` Scale is parsed, never assumed — Tripadvisor states _"of 5 bubbles"_, Booking states
`bestRating: 10`. A 4.6 filed as /10 would turn a well-reviewed hotel into a bad one.

**Tripadvisor's own histogram: 269 excellent · 43 good · 19 average · 8 poor · 11 terrible.** `[V]`
Note it sums to **350, not the 359** the page states — recorded, not reconciled.

### The sentiment is genuinely polarised, and the average hides it

10 verbatim quotes with permalinks were captured, **every review card on the page, in document
order, with no selection step**. The spread is **6 positive (1×5★, 5×4★) against 4 critical (3×3★,
1×1★)**, including a 1★ allegation of theft and staff indifference and three separate "not worth 5
stars" complaints. The mean of the captured cards is **3.5** — a full point below the 4.6 aggregate.

The page's own "Why guests love this hotel" carousel was **deliberately not read**: it is
Tripadvisor's 5-bubble-only shortlist, and including it would have tilted the quote set positive by
construction. `[V]`

> A competitor CATI that shows 4.6 and a glowing quote is not intelligence, it is marketing — and
> someone will make a purchase decision on it.

---

## 6. What is not established — the `[GAP]` list

**Unfilled. No guesses.**

1. **No tier-1/2 source for any structural figure.** `[V]` The official site states no block count,
   unit count, area, date, distance or price — it is prose plus a contact block. The developer's
   index gives only location and status. Every figure in §1 rests on tier 4–6.
2. **No unit-by-unit inventory exists anywhere.** 656 is confirmed; the per-block and per-floor
   breakdown is stated by nobody. 25 units are backed by real listings; **631 are modelled** and
   labelled `dataQuality: "modelled"` with `confidence: "inferred"` and the derivation named.
   Block/sequence ids are internal addressing keys — **not developer unit numbers, including for the
   real listings**, whose position in the project no portal states.
3. **Booking.com and Agoda scores.** Booking serves an anti-bot shell (HTTP 202); Agoda's property
   record is gone. The only Booking figure in the harvest arrives second-hand on the dead brand's
   page, from 10 reviews.
4. **Tripadvisor reviews 11–309.** Only page 1 was captured. 2★ reviews are absent from the quote set
   purely because of pagination — the histogram states 8 poor + 11 terrible exist.
5. **The two review titles quoted in `SOURCES.md` §4** are not in this snapshot (grepped, zero hits);
   they live on later pages. The polarisation requirement is met by the captured spread instead.
6. **Whether "Wyndham Hotel Alanya" and "Azura World Hotel" are one property** (F-017).
7. **Whether the Oba and Mahmutlar listings belong to this project** (F-019) — which leaves the
   bottom of the price range unsettled.
8. **Facebook.** `Disallow: /`. Not "we looked and found nothing" — _we were not allowed to look_.
9. **Social reach over time.** Follower counts were read from Instagram `<head>` metadata (login
   wall); no post dates, no build updates.
10. **`hotel.floors`, `openedYear`, `board`, `distanceToBeachM`** rest on the hotel's own site alone.
11. **Kalinka's entry price** is published as _"from 184,91 thsd USD"_ — a scale word this pipeline
    deliberately does not parse, because multiplying a source's number by 1000 is exactly the error
    that still looks like a plausible price.
12. **No observation dates on most prices.** Only Seaside (23/07/2026) and Alanya-Home (2023-02-25 /
    2025-08-11) publish one. A price with no date cannot be known to be current.

---

## 7. What this means for the build

- **Every structural number needs an authority caveat in the UI**, not a footnote. F-010 is not
  resolved by the harvest; it is measured by it.
- **The price surface must be a range with sources visible**, staleness on the face of it, and no
  single headline number anywhere.
- **Modelled units must be visually distinct from real listings** in every view. 631 of 656 units are
  modelled; the data enforces the honesty, W3-C must enforce the appearance.
- **The review surface must show the distribution, not the average** — and must never follow the
  operator's own Tripadvisor link (F-018).
