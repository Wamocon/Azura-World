# SOURCES — evidence register

**Probed:** 2026-07-27 · **Method:** direct HTTP fetch + web search · **Probe depth:** shallow

Evidence grading throughout: `[V]` verified from a fetched source · `[I]` inference from
verified facts · `[GAP]` not established, deliberately not guessed.

> This register is the **shallow pass**. W0-B re-harvests every URL through Playwright with a
> real browser profile, which will recover most of the 403s below, and overwrites the "status"
> column with measured results. Treat prices here as _indicative pending re-harvest_.

---

## 1. Source health — 9 of 15 ticket URLs failed a plain fetch

> **Status column updated by W0-B on 2026-07-27** from the measured Playwright harvest
> (`sources/manifest.json`, run `2026-07-27T14-52-05Z`). The "Shallow" column is the original
> plain-fetch probe; "W0-B" is what a real browser measured. Every W0-B status is a validated
> _body_, not a status line — a 200 carrying a bot wall or an index page counts as a failure.

| #   | Source                        | Tier | URL                                                                                | Shallow     | W0-B                     | Yield                                                                                                                                                  |
| --- | ----------------------------- | ---- | ---------------------------------------------------------------------------------- | ----------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Azura World (official)        | 1    | `https://www.azuraworld.com/`                                                      | 200         | **200 ✅**               | Thin, but its footer is the primary source for the developer's social accounts                                                                         |
| 2   | Cebeci Group (project page)   | 2    | `https://www.cebecigroup.com/en/project/azura-world-residence-hotel`               | 500         | **http_500 ❌**          | Serves a CodeIgniter error body (`Unable to load the requested file: front/404.php`). **Not a bot wall — the developer's own project page is broken.** |
| 3   | Cebeci Group (index)          | 2    | `https://www.cebecigroup.com/en/projects`                                          | 200         | **200 ✅**               | Confirms "Alanya / Türkler"; lists Azura World _and_ a separate Wyndham Hotel Alanya                                                                   |
| 4   | Cebeci Alanya                 | 2    | `https://www.alanyacebeci.com/en/azura-world-residence-hotel`                      | DNS timeout | **dns_timeout ❌**       | Domain does not resolve                                                                                                                                |
| 5   | Azura World Hotel             | 3    | `https://azuraworldhotel.com/en`                                                   | TLS invalid | **200 ✅**               | **Recovered without TLS tolerance.** The chain is incomplete; Chromium repairs it via AIA fetching, Node's strict TLS does not. See F-012              |
| 6   | TERRA Real Estate             | 4    | `https://terrarealestate.com/project/azura-world-residence-and-villas`             | 403         | **200 ✅**               | Ticket's `/de/wohnprojekt/…` path does not exist; corrected URL recovers                                                                               |
| 7   | Alanya-Home                   | 4    | `https://alanya-home.com/property/466/de/…`                                        | 200         | **200 ✅**               | **Richest single source.** Area breakdown, dates, payment. **Also publishes the same project again as id 891 at a different entry price — see F-013**  |
| 8   | Housearch                     | 4    | `https://housearch.com/de/turkey/residential-complexes/azura-world-3403639/`       | 200         | **200 ✅**               | USD pricing, outlier block count                                                                                                                       |
| 9   | Haspo Realty                  | 4    | `https://hasporealty.com/de/complex/azura-world/`                                  | 200         | **200 ✅**               | 14 buildings, EUR ladder — stale. **18 real per-unit detail pages discovered and harvested from here**                                                 |
| 10  | Seaside Alanya                | 4    | `https://www.seaside-alanya.com/de/antalya-alanya/residence/azura-world-residence` | 200         | **200 ✅**               | **7 blocks / 656 units**, full price ladder                                                                                                            |
| 11  | Realty Group                  | 4    | `https://www.realtygroup.com.tr/property/alanya/turkler/azura-world-rg-6005`       | DNS timeout | **dns_timeout ❌**       | Domain does not resolve                                                                                                                                |
| 12  | IVM Turkey                    | 4    | `https://ivm-turkey.com/en/azura-world-residence-a-2767-1.html`                    | 404         | **soft_404 ❌**          | Redirects to `/fark/404.html`. Listing confirmed removed                                                                                               |
| 13  | Tripadvisor                   | 5    | `…-g1069655-d33144231-Reviews-Azura_World_Hotel-…`                                 | 403         | **200 ✅**               | **Recovered.** Headless gets "Please enable JS"; headed gets the full page. g/d ids resolved by W0-B — the ticket carried only a fragment              |
| 14  | Wyndham Alanya                | 5    | `https://wyndham.antalyacoast.com/en/`                                             | 403         | **200 ✅**               | Recovered. Historical brand only (F-007)                                                                                                               |
| 15a | Facebook (hotel + developer)  | 3/2  | `facebook.com/azuraworldhotel`, `facebook.com/cebecigroup`                         | not probed  | **robots_disallowed ⛔** | `Disallow: /` for all agents. **Respected, not circumvented.** Developer page is `/cebecigroup`, not `/azuraworldhotel`                                |
| 15b | Instagram (hotel + developer) | 3/2  | `instagram.com/azuraworldhotel`, `instagram.com/cebeci.group`                      | not probed  | **200 ✅**               | Both fetched. `cebeci.group` confirmed from azuraworld.com's own footer                                                                                |

**Sources found during research, not in the ticket — add all of these:**

| #   | Source         | Tier | URL                                                                                                   | Shallow | W0-B               | Why it matters                                                                                                                                                                               |
| --- | -------------- | ---- | ----------------------------------------------------------------------------------------------------- | ------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 16  | ENS Pride      | 6    | `https://enspride.com/property/azura-world-residence-hotel-a-new-iconic-lifestyle-concept-in-alanya/` | 200     | **200 ✅**         | **Independently confirms 7 blocks / 656 units / 76,000 m²**                                                                                                                                  |
| 17  | Booking.com    | 5    | `https://www.booking.com/hotel/tr/wyndham-alanya.html`                                                | —       | **blocked ❌**     | Criterion 4. **The ticket's `/hotel/tr/azura-world.html` is a DIFFERENT property — see F-014.** Correct slug is the pre-rebrand `wyndham-alanya`. Returns HTTP 202 + an empty anti-bot shell |
| 18  | Agoda          | 5    | `https://www.agoda.com/azura-world-hotel-ex-wyndham-alanya/hotel/alanya-tr.html`                      | —       | **redirected ❌**  | Bounces to `/en-gb/city/alanya-tr.html`. The property record is gone; the rebrand evidence survives only in the URL slug                                                                     |
| 19  | OnTheBeach     | 5    | `https://www.onthebeach.co.uk/hotels/turkey/antalya/alanya/azura-world-hotel`                         | 403     | **200 ✅**         | **Recovered** (headed). UK package market                                                                                                                                                    |
| 20  | Kalinka Realty | 6    | `https://kalinka-realty.com/zarubezh/zhilye-kompleksy/azura-world-residence-hotel/`                   | 200     | **200 ✅**         | **Russian-language** — serves the `ru` locale                                                                                                                                                |
| 21  | Capital Estate | 6    | `https://www.cestate.net/building/AzuraWorld`                                                         | 200     | **200 ✅**         | RU/EN listing with a per-layout price table                                                                                                                                                  |
| 22  | 7AlanyHome     | 6    | `https://alanyhome.com/property/azura-world-alanya/`                                                  | 200     | **dns_timeout ❌** | Domain no longer resolves. It answered the shallow probe hours earlier — recorded, not quietly dropped                                                                                       |
| 23  | Turizm Güncel  | 6    | `https://www.turizmguncel.com/haber/ahmet-cebeci-wyndham-markasini-alanyaya-getiriyor`                | 403     | **200 ✅**         | **Recovered.** Press record of the Wyndham licence — primary evidence for F-007                                                                                                              |

**Added by W0-B (2026-07-27), beyond the 23:**

| #     | Source                         | Tier | URL                                                                                      | W0-B                     | Why it matters                                                                                                                                                       |
| ----- | ------------------------------ | ---- | ---------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 24    | Alanya-Home (2nd project page) | 4    | `https://alanya-home.com/property/891/en/azura_world_residence_hotel`                    | **200 ✅**               | Same project, same portal, different entry price — F-013                                                                                                             |
| 25    | Booking.com (ticket's URL)     | 5    | `https://www.booking.com/hotel/tr/azura-world.html`                                      | **blocked ❌**           | Harvested deliberately as _evidence_ for F-014, never as hotel data                                                                                                  |
| 26    | Booking.com (reviews)          | 5    | `https://www.booking.com/reviews/tr/hotel/wyndham-alanya.html`                           | **blocked ❌**           | Would have served criterion 4                                                                                                                                        |
| 27    | Facebook — Cebeci Group        | 2    | `https://www.facebook.com/cebecigroup`                                                   | **robots_disallowed ⛔** | The developer's actual Facebook, from azuraworld.com's footer                                                                                                        |
| 28    | Instagram — Azura World Hotel  | 3    | `https://www.instagram.com/azuraworldhotel/`                                             | **200 ✅**               | Hotel account, distinct from the developer's                                                                                                                         |
| 29    | Trustpoint                     | 6    | `https://trustpoint.com.tr/properties/alanya-azura-world-turkler-residence-villa-hotel/` | **expect_missing ❌**    | URL resolves but renders unrelated Dubai/Avsallar listings. 47 "azura" hits in raw HTML, **0 in rendered text** — the case for validating rendered bytes, not markup |
| 30    | Alto Real Estate               | 6    | `https://altoprealestate.com/property/id-10331`                                          | **200 ✅**               | A 1+1 in Azura World priced **per month**. Flagged `priceKind: rent` so it can never contaminate the F-002 sale series                                               |
| 31–48 | Haspo Realty per-unit pages    | 4    | 18 URLs under `hasporealty.com/en/properties/…`                                          | **200 ✅ ×18**           | **Discovered by link-following, not hand-listed.** The only true per-unit prices in the estate — the real evidence for F-002                                         |
| 49–53 | Housearch per-unit pages       | 4    | 5 of 8 followed URLs                                                                     | **200 ✅ ×5, 404 ×3**    | Three followed links are dead — recorded, not skipped                                                                                                                |

> **[V]** Two of the three unreachable tier-1/2 sources are _developer_ sites — exactly the tier
> the ticket says should win conflicts. Until W0-B recovers them, the highest-authority values
> come from tier 4–6, and every project-level figure inherits that weakness. This is a `[GAP]`
> on authority, not on data, and it must be stated wherever these figures are displayed.

---

## 2. Confirmed facts — ≥2 independent hosts agree

| Field                | Value                                                              | Sources                          | Grade        |
| -------------------- | ------------------------------------------------------------------ | -------------------------------- | ------------ |
| Location             | Türkler, Alanya, Antalya, Türkiye                                  | 1,3,7,8,9,10,16                  | `[V]`        |
| Developer            | Cebeci Group A.Ş.                                                  | all                              | `[V]`        |
| Developer founded    | 1982 · "40 years of experience"                                    | 1,7,8                            | `[V]`        |
| **Plot area**        | **76,000 m²**                                                      | 7,10,16 + TERRA via search       | `[V]`        |
| Green area           | 20,000 m²                                                          | 7,8 ("more than 20 thousand m²") | `[V]`        |
| Building footprint   | 15,000 m²                                                          | 7                                | `[V]` single |
| Outdoor/sport/water  | 41,000 m²                                                          | 7                                | `[V]` single |
| **Residence blocks** | **7**                                                              | 10,16                            | `[V]`        |
| **Total apartments** | **656**                                                            | 10,16                            | `[V]`        |
| Buildings × floors   | 14 × 6                                                             | 9 (de+en)                        | `[V]` single |
| Construction start   | 2022-01-30                                                         | 7,10,16                          | `[V]`        |
| Completion           | 2024-05-30                                                         | 7,10,16 (9: "May 2024")          | `[V]`        |
| Distance to sea      | 300 m                                                              | 7,9,16 + search                  | `[V]`        |
| Gazipaşa airport     | 60 km                                                              | 7,9,10                           | `[V]`        |
| Unit mix             | 1+1…5+1, penthouse, townhouse, 5+1 pool villa, 6+1 president villa | 7,10,16                          | `[V]`        |
| Down payment         | from 30%                                                           | 7                                | `[V]` single |
| Hotel                | 5★, All-Inclusive                                                  | all hotel sources                | `[V]`        |
| Hotel rooms          | 188, 6 floors, 2 lifts                                             | search → 5,17,18                 | `[V]`        |
| Hotel opened         | 2025                                                               | search → 5                       | `[V]`        |
| Aquapark             | 13 slides                                                          | search → 5                       | `[V]` single |

### The arithmetic cross-check — `[V]`

Alanya-Home breaks the site down as **green 20,000 + footprint 15,000 + outdoor 41,000 m²**.

```
20,000 + 15,000 + 41,000 = 76,000 m²
```

That is exactly the plot area three other hosts state independently. **The arithmetic closes**,
which raises all four figures to `confirmed` and simultaneously proves ENS Pride's _"over
41,000 m² of landscaped green areas"_ is a conflation of the outdoor-facility figure with green
space. Green area is 20,000 m². Recorded as **F-008**.

---

## 3. Conflict register

### F-001 · `high` · structure · `project.residenceBlockCount`

**3** (Housearch) · **7 residence blocks** (Seaside, ENS Pride) · **14 buildings of 6 floors** (Haspo)

`[I]` Not one disagreement but two facts plus an error. Search copy reads _"low-rise apartment
buildings (7 blocks)"_ and separately _"1+1, 2+1, 3+1 layouts located in 14 buildings of 6-story
buildings"_ — consistent with **7 blocks containing 14 buildings**. Housearch's 3 is an outlier
with no corroboration.
→ `residenceBlockCount = 7` (confirmed), `buildingCount = 14` (single_source), Housearch's 3
retained in `conflictsWith`. **Display both structural figures with the explanation.**

### F-002 · `critical` · pricing · `units[].askingPrice`

1+1 entry price across four sources:

| Source      | Value        | Size     | Currency |
| ----------- | ------------ | -------- | -------- |
| Haspo       | 112,000      | 80–89 m² | EUR      |
| Seaside     | 185,000      | 85–92 m² | EUR      |
| Alanya-Home | from 220,000 | 85 m²    | EUR      |
| Housearch   | 239,171      | 75 m²    | **USD**  |

`[V]` A **2.1× spread** on nominally the same product. `[I]` Causes are compounded: two
currencies, no observation dates, different unit subsets, and at least one stale listing (F-006).
→ **Never resolved to a single number.** Rendered as a range with all four sources visible and a
"prices disagree across portals" badge. `confidence: "conflicted"`. This is the single most
important honesty gate in the build.

### F-003 · `medium` · geography · `project.distanceToSeaM`

**200 m** (Seaside) · **300 m** (Alanya-Home, Haspo, ENS Pride, search) · **1 km** (hotel → beach)
`[I]` The 1 km is a different measurement — hotel to public beach, with shuttle — not a
contradiction. Seaside's 200 m is uncorroborated.
→ Residence `300 m` (confirmed); hotel `distanceToBeachM = 1000` stored separately.

### F-004 · `low` · geography · `project.distanceToAlanyaCentreKm`

**15 km** (Seaside, Alanya-Home, search) · **17 km** (Housearch) · **18 km** (Haspo)
→ 15 km, spread noted. `[I]` Consistent with different centre reference points.

### F-005 · `low` · geography · `project.distanceToAntalyaAirportKm`

**100 km** (Seaside, Haspo) · **110 km** (Alanya-Home) · Housearch gives drive time only ("1h30")
→ Unresolved, both retained.

### F-006 · `high` · availability · `project.buildStatus`

**"Fertig" / completed** (Housearch, search) · **"under construction"** (Haspo)
`[V]` Completion 2024-05-30 is confirmed by three sources; the probe ran 2026-07-27.
→ `completed`. **Haspo's listing is stale by ~2 years, so its price ladder (F-002) is suspect
and must be flagged `isStale: true` wherever shown.**

### F-007 · `high` · branding · `hotel.brandAffiliation`

`[V]` Cebeci İnşaat signed a Wyndham licence for the hotel component (Turizm Güncel). `[V]`
Agoda and OnTheBeach both list the property as **"Azura World Hotel (ex. Wyndham Alanya)"**.
`[I]` The Wyndham branding was dropped between opening and 2026.
→ `name = "Azura World Hotel"`, `formerName = "Wyndham Alanya"`, `brandAffiliation = null` with
a note. **The ticket's `wyndham.antalyacoast.com` link points at the superseded brand** — keep it
as a historical source, never as the current identity.

### F-008 · `medium` · structure · `project.greenAreaSqm`

**20,000 m²** (Alanya-Home, Housearch) · **"over 41,000 m²"** (ENS Pride)
→ 20,000 m². ENS Pride conflated the outdoor-facility figure; see §2 arithmetic.

### F-009 · `medium` · structure · developer experience

**"more than 30 years"** (Seaside) · **"40 years"** (azuraworld.com, Alanya-Home) · **est. 1982** (Housearch)
`[I]` 1982 → 2022 construction start = 40 years. Seaside's copy is older or rounded down.
→ `developerFoundedYear = 1982` (confirmed); the "40 years" phrasing is marketing, not a fact.

### F-010 · `critical` · harvest · source authority

`[V]` 9 of 15 ticket URLs failed a plain fetch; 2 of them are developer sites (tier 2) and 1 is
the hotel's own site (tier 3).
→ Until W0-B recovers them, **no tier-1/2/3 corroboration exists for any project figure except
location and developer.** Every project-level number currently rests on tier 4–6. Must be stated
in the UI, not buried here.

---

## 4. Hotel & reviews (criterion 4)

| Field               | Value                                          | Source        | Grade                          |
| ------------------- | ---------------------------------------------- | ------------- | ------------------------------ |
| Name                | Azura World Hotel                              | 5,17,18       | `[V]`                          |
| Former name         | Wyndham Alanya                                 | 18,19         | `[V]`                          |
| Class               | 5★ All-Inclusive                               | all           | `[V]`                          |
| Rooms               | 188 · 6 floors · 2 lifts                       | search → 5    | `[V]`                          |
| Opened              | 2025                                           | search → 5    | `[V]`                          |
| Pools               | Indoor · Oasis · aquapark **13 slides**        | search → 5    | `[V]`                          |
| Beach               | 1 km, shuttle                                  | search → 5    | `[V]`                          |
| Check-in / out      | 14:00 / 12:00                                  | search → 5    | `[V]`                          |
| **Tripadvisor**     | **4.0/5 · 358 reviews · #10 of 33 in Türkler** | 13 via search | `[V]`                          |
| Booking.com score   | —                                              | 17            | `[GAP]` — fetch returned empty |
| Agoda score         | —                                              | 18            | `[GAP]`                        |
| Rating distribution | —                                              | 13            | `[GAP]` — needs W0-B           |

**Sentiment is polarised** `[V]`. Both extremes exist in the visible review titles:
_"Everything is perfect, Wyndham and azura world"_ against _"A Five-Star Hotel in Name Only:
Misleading, Unsafe, and Unprofessional"_. Both must appear in the dataset. A competitor CATI
that shows only the 4.0 average and the positive quote is not intelligence — it is marketing,
and it will mislead the person making a decision from it.

---

### Appended by W0-B — 2026-07-27

> Findings discovered by the deep harvest. Full text, with citations and snapshot hashes, in
> `apps/web/lib/azura-world-data.ts`. **F-001 above is corrected by F-001′ below** — the original
> text is left in place so the correction is visible rather than silent.

#### F-001′ · correction to F-001 — Housearch never claimed 3 blocks

`[V]` F-001 records Housearch as stating **3** residence blocks, an outlier against 7. Housearch
states **no block count for this project at all**. The 3 sits in its _developers_ panel and counts
Cebeci Group's whole portfolio on Housearch — that site's own link reads _"Property from Cebeci
Group — 3 new buildings"_. The shallow pass quoted a real number accurately and attached it to the
wrong subject.
→ `residenceBlockCount = 7` is now **confirmed across three hosts** (Seaside, ENS Pride, Capital
Estate). Nothing contradicts it. `buildingCount = 14` remains single_source on Haspo.

#### F-011 · `high` · structure · `units[].id`

`[V]` No source publishes a unit-by-unit inventory. 25 units are backed by real listings;
**631 are modelled** to fill the confirmed 656. Block/sequence ids are internal addressing keys,
**not developer unit numbers — including for the real listings**, whose position in the project no
portal states.

#### F-012 · `medium` · harvest · `azuraworldhotel.com` TLS

`[V]` Recorded as "TLS invalid"; Chromium validated it **without any tolerance flag**. The server
sends an _incomplete chain_ which browsers repair via AIA fetching and Node's strict TLS does not.
The failure was real; the diagnosis was wrong. Nothing was trusted on a waived check.

#### F-013 · `high` · pricing · Alanya-Home publishes the project twice

`[V]` Property **466** (de, from €220,000, from 85 m², updated **2023-02-25**) and property **891**
(en, from €125,000, 80–300 m², updated **2025-08-11**). `[I]` One publisher contradicting itself is
a stronger signal about price reliability than two publishers disagreeing. → Unresolved; both prices
enter the F-002 range.

#### F-014 · `high` · harvest · the ticket's Booking.com URL is a different property

`[V]` `/hotel/tr/azura-world.html` is a private apartment near Alanya centre, not the 5★ hotel. The
hotel kept its pre-rebrand slug `/hotel/tr/wyndham-alanya.html` — itself further evidence for F-007.

#### F-015 · `medium` · harvest · robots.txt

`[V]` Facebook publishes `Disallow: /` for all agents. Both Facebook sources were **not fetched**.
Recorded as unavailable, not as empty — "we were not allowed to look" and "we looked and found
nothing" are different claims.

#### F-016 · `high` · branding · two "independent" review scores are one number

`[V]` OnTheBeach's 4.6/5 is an embedded **Tripadvisor** widget carrying the same location id
(`33144231`) as the direct capture; the Wyndham page's 6.7/10 is a **Booking.com** badge. Filed
under the serving host, one opinion would have satisfied CONTRACTS §1 invariant 3 and been promoted
to `confirmed`. → Each score attributed to the platform that produced it.

#### F-017 · `high` · branding · four confusable Cebeci properties

`[V]` The developer's own index lists **Azura World Residence & Hotel** (Alanya/Türkler),
**Wyndham Hotel Alanya** (Antalya/Türkler) as a _separate_ entry in the same district, **Azura
Deluxe Resort and SPA Hotel** (Avsallar) and **Azura Park Residence** (Mahmutlar). `[I]` Consistent
with F-007's one-property-two-names reading, but it does not establish it. → **Unresolved.** No fact
is merged across the four.

#### F-018 · `critical` · branding · the operator cites the wrong hotel's reviews

`[V]` `azuraworldhotel.com` links a Tripadvisor page for `Azura_Deluxe_Resort_Spa-Avsallar`
(`g609052-d7391617`) — a different Cebeci hotel 60 km away. Correct listing: `g1069655-d33144231`.
Following the operator's own link attaches another property's ratings, with a citation that resolves.

#### F-019 · `high` · pricing · two Haspo listings tagged to the wrong district

`[V]` One states **Oba**, one states **Mahmutlar** while its own headline says Türkler. **The Oba
listing is the €112,000 / 80 m² entry price anchoring the bottom of F-002** and quoted in §3 above
as Haspo's 1+1 price. `[I]` If it is a different building, part of the 2.1× spread is an artefact of
comparing two projects. → Both kept, flagged, neither trusted as an anchor.

#### F-020 … F-024 · conflicts found by the harvest, all unresolved

`[V]` `project.developer` (four spellings across hosts) · `project.floorsPerBuilding` 6 vs 5 ·
`project.distanceToGazipasaAirportKm` 60 / 54 / 30 · `hotel.roomCount` **188 vs 112** ·
`hotel.aquaparkSlides` **13 vs 16**. F-003 also widens: 500 m readings appear on Capital Estate and
TERRA alongside the recorded 300 m and 200 m.

---

## 5. W0-B must resolve these

**Status as delivered — 2026-07-27.**

| #   | Item                                          | Outcome                                                                                                                                                                                                              |
| --- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Re-harvest all URLs through Playwright        | ✅ **Done.** 45 of 60 captures validated. Recovered TERRA, Turizm Güncel, Wyndham, Tripadvisor, OnTheBeach, both Instagram accounts                                                                                  |
| 2   | Recover developer sites 2, 4 and hotel site 5 | ⚠️ **Partial.** Hotel site 5 recovered — **and needed no TLS tolerance** (F-012). Sites 2 and 4 remain dead: #2 serves a genuine application error (`front/404.php`), #4's domain does not resolve. **F-010 stands** |
| 3   | TERRA URL correction                          | ✅ Corrected path recovers 200                                                                                                                                                                                       |
| 4   | Individual unit listings for F-002            | ✅ **Done.** 18 Haspo per-unit pages discovered by link-following + 8 Seaside referenced rows → **21 deduplicated 1+1/entry observations across 6 publishers**                                                       |
| 5   | Tripadvisor distribution + verbatim quotes    | ✅ **Done.** 4.6/5 · 359 reviews · #10 of 33 · histogram 269/43/19/8/11 · **10 verbatim quotes with permalinks, both extremes**                                                                                      |
| 6   | Booking / Agoda / OnTheBeach scores           | ⚠️ **Partial.** OnTheBeach ✅ (but it is a syndicated Tripadvisor score — F-016). Booking ❌ anti-bot HTTP 202. Agoda ❌ property record gone                                                                        |
| 7   | Facebook + Instagram                          | ⚠️ Facebook **⛔ robots-disallowed** (F-015). Instagram ✅ but login-walled — `<head>` metadata only, no post dates                                                                                                  |
| 8   | Unit-by-unit inventory `[GAP]`                | ✅ **Confirmed still a gap.** 25 real + **631 modelled**, labelled `dataQuality: "modelled"` with `confidence: "inferred"` and the derivation named                                                                  |

**Still open for a later pass:** Booking.com and Agoda scores; Tripadvisor review pages 2+;
whether "Wyndham Hotel Alanya" is this property (F-017); whether the Oba/Mahmutlar listings belong
to this project (F-019).
