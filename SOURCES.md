# SOURCES — evidence register

**Probed:** 2026-07-27 · **Method:** direct HTTP fetch + web search · **Probe depth:** shallow

Evidence grading throughout: `[V]` verified from a fetched source · `[I]` inference from
verified facts · `[GAP]` not established, deliberately not guessed.

> This register is the **shallow pass**. W0-B re-harvests every URL through Playwright with a
> real browser profile, which will recover most of the 403s below, and overwrites the "status"
> column with measured results. Treat prices here as *indicative pending re-harvest*.

---

## 1. Source health — 9 of 15 ticket URLs failed a plain fetch

| # | Source | Tier | URL | Status | Yield |
|---|---|---|---|---|---|
| 1 | Azura World (official) | 1 | `https://www.azuraworld.com/` | **200** | Thin. Developer + "walking distance to sea" only |
| 2 | Cebeci Group (project page) | 2 | `https://www.cebecigroup.com/en/project/azura-world-residence-hotel` | **500** | — |
| 3 | Cebeci Group (index) | 2 | `https://www.cebecigroup.com/en/projects` | **200** | Confirms "Alanya / Türkler"; 26-project portfolio |
| 4 | Cebeci Alanya | 2 | `https://www.alanyacebeci.com/en/azura-world-residence-hotel` | **DNS timeout** | — |
| 5 | Azura World Hotel | 3 | `https://azuraworldhotel.com/en` | **TLS invalid** | — |
| 6 | TERRA Real Estate | 4 | `https://terrarealestate.com/de/wohnprojekt/…` | **403** | Canonical is `/project/azura-world-residence-and-villas` |
| 7 | Alanya-Home | 4 | `https://alanya-home.com/property/466/de/…` | **200** | **Richest single source.** Area breakdown, dates, payment |
| 8 | Housearch | 4 | `https://housearch.com/de/turkey/residential-complexes/azura-world-3403639/` | **200** | USD pricing, outlier block count |
| 9 | Haspo Realty | 4 | `https://hasporealty.com/de/complex/azura-world/` | **200** | 14 buildings, EUR ladder — but stale status |
| 10 | Seaside Alanya | 4 | `https://www.seaside-alanya.com/de/antalya-alanya/residence/azura-world-residence` | **200** | **7 blocks / 656 units**, full price ladder |
| 11 | Realty Group | 4 | `https://www.realtygroup.com.tr/property/alanya/turkler/azura-world-rg-6005` | **DNS timeout** | — |
| 12 | IVM Turkey | 4 | `https://ivm-turkey.com/en/azura-world-residence-a-2767-1.html` | **404** | Listing removed |
| 13 | Tripadvisor | 5 | `…Reviews-Azura_World_Hotel-Turkler_Alanya…` | **403** | Recovered via search: 4.0/5, 358 reviews, #10/33 |
| 14 | Wyndham Alanya | 5 | `https://wyndham.antalyacoast.com/en/` | **403** | — |
| 15 | Facebook / Instagram | 1/2 | `facebook.com/azuraworldhotel`, `instagram.com/cebeci.group` | not probed | Deferred to W0-B |

**Sources found during research, not in the ticket — add all of these:**

| # | Source | Tier | URL | Why it matters |
|---|---|---|---|---|
| 16 | ENS Pride | 6 | `https://enspride.com/property/azura-world-residence-hotel-a-new-iconic-lifestyle-concept-in-alanya/` | **Independently confirms 7 blocks / 656 units / 76,000 m²** |
| 17 | Booking.com | 5 | `https://www.booking.com/hotel/tr/azura-world.html` | Criterion 4 — hotel booking |
| 18 | Agoda | 5 | `https://www.agoda.com/azura-world-hotel-ex-wyndham-alanya/hotel/alanya-tr.html` | Names the rebrand explicitly |
| 19 | OnTheBeach | 5 | `https://www.onthebeach.co.uk/hotels/turkey/antalya/alanya/azura-world-hotel` | UK package market |
| 20 | Kalinka Realty | 6 | `https://kalinka-realty.com/zarubezh/zhilye-kompleksy/azura-world-residence-hotel/` | **Russian-language** — serves the `ru` locale |
| 21 | Capital Estate | 6 | `https://www.cestate.net/building/AzuraWorld` | RU/EN listing |
| 22 | 7AlanyHome | 6 | `https://alanyhome.com/property/azura-world-alanya/` | Additional price observation |
| 23 | Turizm Güncel | 6 | `https://www.turizmguncel.com/haber/ahmet-cebeci-wyndham-markasini-alanyaya-getiriyor` | **403.** Press record of the Wyndham licence |

> **[V]** Two of the three unreachable tier-1/2 sources are *developer* sites — exactly the tier
> the ticket says should win conflicts. Until W0-B recovers them, the highest-authority values
> come from tier 4–6, and every project-level figure inherits that weakness. This is a `[GAP]`
> on authority, not on data, and it must be stated wherever these figures are displayed.

---

## 2. Confirmed facts — ≥2 independent hosts agree

| Field | Value | Sources | Grade |
|---|---|---|---|
| Location | Türkler, Alanya, Antalya, Türkiye | 1,3,7,8,9,10,16 | `[V]` |
| Developer | Cebeci Group A.Ş. | all | `[V]` |
| Developer founded | 1982 · "40 years of experience" | 1,7,8 | `[V]` |
| **Plot area** | **76,000 m²** | 7,10,16 + TERRA via search | `[V]` |
| Green area | 20,000 m² | 7,8 ("more than 20 thousand m²") | `[V]` |
| Building footprint | 15,000 m² | 7 | `[V]` single |
| Outdoor/sport/water | 41,000 m² | 7 | `[V]` single |
| **Residence blocks** | **7** | 10,16 | `[V]` |
| **Total apartments** | **656** | 10,16 | `[V]` |
| Buildings × floors | 14 × 6 | 9 (de+en) | `[V]` single |
| Construction start | 2022-01-30 | 7,10,16 | `[V]` |
| Completion | 2024-05-30 | 7,10,16 (9: "May 2024") | `[V]` |
| Distance to sea | 300 m | 7,9,16 + search | `[V]` |
| Gazipaşa airport | 60 km | 7,9,10 | `[V]` |
| Unit mix | 1+1…5+1, penthouse, townhouse, 5+1 pool villa, 6+1 president villa | 7,10,16 | `[V]` |
| Down payment | from 30% | 7 | `[V]` single |
| Hotel | 5★, All-Inclusive | all hotel sources | `[V]` |
| Hotel rooms | 188, 6 floors, 2 lifts | search → 5,17,18 | `[V]` |
| Hotel opened | 2025 | search → 5 | `[V]` |
| Aquapark | 13 slides | search → 5 | `[V]` single |

### The arithmetic cross-check — `[V]`

Alanya-Home breaks the site down as **green 20,000 + footprint 15,000 + outdoor 41,000 m²**.

```
20,000 + 15,000 + 41,000 = 76,000 m²
```

That is exactly the plot area three other hosts state independently. **The arithmetic closes**,
which raises all four figures to `confirmed` and simultaneously proves ENS Pride's *"over
41,000 m² of landscaped green areas"* is a conflation of the outdoor-facility figure with green
space. Green area is 20,000 m². Recorded as **F-008**.

---

## 3. Conflict register

### F-001 · `high` · structure · `project.residenceBlockCount`
**3** (Housearch) · **7 residence blocks** (Seaside, ENS Pride) · **14 buildings of 6 floors** (Haspo)

`[I]` Not one disagreement but two facts plus an error. Search copy reads *"low-rise apartment
buildings (7 blocks)"* and separately *"1+1, 2+1, 3+1 layouts located in 14 buildings of 6-story
buildings"* — consistent with **7 blocks containing 14 buildings**. Housearch's 3 is an outlier
with no corroboration.
→ `residenceBlockCount = 7` (confirmed), `buildingCount = 14` (single_source), Housearch's 3
retained in `conflictsWith`. **Display both structural figures with the explanation.**

### F-002 · `critical` · pricing · `units[].askingPrice`
1+1 entry price across four sources:

| Source | Value | Size | Currency |
|---|---|---|---|
| Haspo | 112,000 | 80–89 m² | EUR |
| Seaside | 185,000 | 85–92 m² | EUR |
| Alanya-Home | from 220,000 | 85 m² | EUR |
| Housearch | 239,171 | 75 m² | **USD** |

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

| Field | Value | Source | Grade |
|---|---|---|---|
| Name | Azura World Hotel | 5,17,18 | `[V]` |
| Former name | Wyndham Alanya | 18,19 | `[V]` |
| Class | 5★ All-Inclusive | all | `[V]` |
| Rooms | 188 · 6 floors · 2 lifts | search → 5 | `[V]` |
| Opened | 2025 | search → 5 | `[V]` |
| Pools | Indoor · Oasis · aquapark **13 slides** | search → 5 | `[V]` |
| Beach | 1 km, shuttle | search → 5 | `[V]` |
| Check-in / out | 14:00 / 12:00 | search → 5 | `[V]` |
| **Tripadvisor** | **4.0/5 · 358 reviews · #10 of 33 in Türkler** | 13 via search | `[V]` |
| Booking.com score | — | 17 | `[GAP]` — fetch returned empty |
| Agoda score | — | 18 | `[GAP]` |
| Rating distribution | — | 13 | `[GAP]` — needs W0-B |

**Sentiment is polarised** `[V]`. Both extremes exist in the visible review titles:
*"Everything is perfect, Wyndham and azura world"* against *"A Five-Star Hotel in Name Only:
Misleading, Unsafe, and Unprofessional"*. Both must appear in the dataset. A competitor CATI
that shows only the 4.0 average and the positive quote is not intelligence — it is marketing,
and it will mislead the person making a decision from it.

---

## 5. W0-B must resolve these

1. Re-harvest all 23 URLs through Playwright with a real browser profile → recover the 403s
2. Recover developer sites 2, 4 and hotel site 5 — retry with TLS tolerance for #5 (record the
   invalid cert as a finding; do not disable verification silently)
3. Ticket URL for TERRA is wrong → use `/project/azura-world-residence-and-villas`
4. Harvest individual unit listings from every portal → real prices per unit for F-002
5. Full Tripadvisor rating distribution + verbatim quotes with permalinks
6. Booking.com / Agoda / OnTheBeach scores and review counts
7. Facebook + Instagram: latest post date, follower count, most recent build update
8. `[GAP]` **No source states a unit-by-unit inventory.** 656 total is confirmed; per-block and
   per-floor breakdowns are not. Units synthesised to fill the inventory carry
   `dataQuality: "modelled"` and must be visually distinct from real listings in every view.
