# HANDOFF — W0-C Market analysis & source register

STATUS: COMPLETE
Completed: 2026-07-27
Window: W0-C · documents only · blocks nothing · ran parallel to W0-A, W0-B, W0-D

---

## What was built

All seven owned files exist under `docs/market/`:

- **`Marktanalyse-Azura-World-2026-de.md`** — the primary document, 8 sections per the brief:
  evidence key · the market (Türkler/Alanya/Antalya) · the developer · the competitive set ·
  price positioning · buyer profile · the hotel as an asset · risks and gaps.
- **`Marktanalyse-Azura-World-2026-{en,tr,ru}.md`** — full-fidelity translations. Marker-identical
  to the German (31 × `[GAP]`, 51 × `[I]`, 2 × `[V-s]`, 103 × `[V]` in each), same source ids
  throughout. See "Languages shipped" below for what that does and does not guarantee.
- **`Competitive-Set.md`** — **13 comparable projects plus the subject**, plus Goldcity's separately
  sold 2024 phase as its own row. Every cell carries a source id or `[GAP]`.
- **`Market-Research-Annex.md`** — method, the three places the research disagreed with itself and
  how each was resolved, source-availability findings, limits, and the complete 42-item `[GAP]`
  inventory.
- **`Source-Register.md`** — **199 distinct source ids**, each with tier, the HTTP result actually
  obtained on 2026-07-27, what it yielded, and a reliability note.

---

## Verification actually run

| Command / check                                           | Result   | Evidence                                                                                                                                                                                                                                                 |
| --------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `python` coordinate parse of ALTSO PDF (S-043), Tablo 6   | **PASS** | Class-token totals `5* = 69 + 30 = 99`; nearest-y column match, **0 unmatched rows**; Okurcalar 28 · Türkler 20 · Konaklı 18 · Avsallar 9 · Payallar 6 · Oba 5 · Kargıcak 5 · Kestel 3 · Tosmur 2 · İncekum 2 · Mahmutlar 1 = **99**                     |
| ALTSO PDF download                                        | **PASS** | `HTTP 200 size=11373175` — byte size matches the research agent's report exactly                                                                                                                                                                         |
| Cross-check of Türkler from a second ALTSO table (p. 98)  | **PASS** | `1 \| 20 \| 4 \| 1 \| 1 \| 27 \| 5 \| 5 \| 32` — 20 five-star hotels, 27 certified, 32 total                                                                                                                                                             |
| Türkler population + bed capacity re-parse                | **PASS** | p. 35 `21 \| Türkler Mahallesi \| 4.949 \| 2.616 \| 2.333` (sum checks); p. 98 `Türkler 27.775 %15,7`                                                                                                                                                    |
| WebFetch `tcmb.gov.tr/kurlar/today.xml`                   | **PASS** | Bülten **2026/137**, 27.07.2026, EUR 53.9717 / USD 47.3533 — matches agent report exactly                                                                                                                                                                |
| WebFetch Emlakjet Türkler                                 | **PASS** | 64.951 ₺/m², 18 listings, ~7 yr, +2.8 %, 26.250 TL rent. 64,951 ÷ 53.9717 = €1,203 ✓                                                                                                                                                                     |
| WebFetch `cebecigroup.com/en/projects`                    | **PASS** | **28 entries counted** (brief says 26); "SINCE 1982"                                                                                                                                                                                                     |
| WebFetch `cebecigroup.com/en/azura-world-residence-hotel` | **PASS** | **HTTP 200** — 76,000 m², "2021-2024", "private beach", superlative claim                                                                                                                                                                                |
| WebFetch `newlevel-group.com/en/complexes`                | **PASS** | Completion **"July 2026"**, from €136,400, Share product €5,400 / 51 m²                                                                                                                                                                                  |
| WebFetch `goldcityhotel.com.tr`                           | **PASS** | _"211.677m2 dazzling structure"_, "5-star facility", **no room count published**                                                                                                                                                                         |
| Source-id resolution audit                                | **PASS** | `distinct ids cited: 199 · cited but unresolvable: NONE`                                                                                                                                                                                                 |
| Cross-language marker audit                               | **PASS** | Section-by-section `[V]` counts identical across de/en/tr/ru after fixing one duplicated marker in de §6.3                                                                                                                                               |
| Ownership check — filesystem                              | **PASS** | `find -newermt "-120 minutes"` over the whole tree: of 1,587 recently-touched paths, the only ones under my ownership are the 7 `docs/market/*.md` files. `SOURCES.md`, `scripts/*`, `apps/*`, `sources/*` were modified by **other windows**, not by me |
| `git status --porcelain -- docs/market HANDOFF/W0-C.md`   | **PASS** | 8 entries, all mine: `M docs/market/Competitive-Set.md` + 7 × `??` (the 6 new market docs and this handoff). **No path outside my ownership list appears under my authorship.** Tree-wide there are 27 changes, the remainder belonging to other windows |

**NOT RUN, with reasons — no "should pass" anywhere:**

- `pnpm --dir apps/web typecheck` / `lint` — **NOT RUN.** W0-C is documents-only and owns no code;
  nothing it produced can affect either gate. `apps/web` did not exist when this window started, and
  SYSTEM-PROMPT §4.3 forbids running pnpm concurrently with the window that owns dependency install.
- **Nothing in these documents was tested against a live rendering surface.** They are Markdown.

**One correction to this handoff, recorded rather than silently amended:** when this window started,
`D:\Azura World` was **not** a git repository, and an earlier draft of this file stated the
`git status` ownership check was impossible. Another window ran `git init` partway through the
session. The check has since been run and **passed** — see the verification table above. Anyone
reading a cached copy of this handoff that says "NOT POSSIBLE" should use the table.

---

## Contracts I consumed

None. W0-C writes no code and consumes no `CONTRACTS.md` interface. It consumes `SOURCES.md` as
**read-only input** — cited by numeric id and finding id (`F-001` … `F-010`) and never modified.

---

## Decisions I made

1. **Added a fourth evidence mark, `[V-s]`,** for values seen only in a search-engine snippet where
   the host page itself was not fetched. SYSTEM-PROMPT §3 allows a task to be _stricter_; treating
   snippet-only values as full `[V]` would have been looser. Defined in every document and listed on
   the do-not-quote list. 2 instances per Marktanalyse, 13 in `Competitive-Set.md`.
2. **Shipped all four languages** rather than the brief's permitted de+en fallback — with the
   limitation recorded in each file's header (see below).
3. **Published the New Level Premium rental guarantee despite an internal contradiction.** One
   research pass sourced it publicly; an independent pass could not find it and advised against using
   it. I did not resolve this by preference: the evidence exists (one host, offer dated 12.11.2024)
   and is published _with that weakness stated in the same paragraph_, attributed to a sales partner
   rather than the developer. Recorded in `Market-Research-Annex.md` §3.3.
4. **Corrected three premises I was given**, rather than repeating them:
   - the brief's **"26 projects"** — I counted **28**, on both language versions, twice;
   - the brief's **"5 of 7 portals are German-language"** — a sampling artefact of the ticket, not a
     market fact: all five serve English from the same database, and `onthebeach.co.uk` is a holiday
     package channel, not a property portal;
   - `SOURCES.md`'s record of the Cebeci Azura World page as **500** — it returns **200** at the
     correct URL.
5. **Kept `ataberkestate.com` as a cited public source** for the NLP rental guarantee. It is that
   firm's public marketing page, so citing it discloses nothing confidential — but no 1Çatı
   repository data was used, and Ataberk commercial detail was deliberately excluded (see below).
6. **Discarded every undated currency conversion published by a source**, keeping only the original
   figure. One host published a single price simultaneously in EUR/USD/GBP/TRY with no rate date.
7. **Did not compute an "Azura €/m² premium" as a headline.** The only available denominator is a
   district average built from 18 listings of ~7-year-old resale stock. The range 1.2×–3.0× is given
   with that caveat attached and appears on the do-not-quote list.

---

## Languages shipped, and which are fallbacks

**All four shipped. None is a machine translation.** de is the authored original; en, tr and ru were
written directly by me, not passed through a translation engine, and carry identical figures, source
ids and evidence grades (verified mechanically — see the marker audit above).

**The honest limitation, recorded in the header of the tr and ru files themselves:** neither has been
reviewed by a native speaker. The brief warns that "an honest two-language document beats four where
two are machine-translated" — these are not machine-translated, but **tr and ru should be treated as
unreviewed drafts for language quality**, while their _numbers_ are as reliable as the German.
Each file states that the German is authoritative on any discrepancy.

---

## Requests for other windows

**For W0-B (owns `SOURCES.md`, `ANALYSIS.md`, the dataset) — eight items:**

1. **`https://www.cebecigroup.com/en/azura-world-residence-hotel` returns 200.** `SOURCES.md` records
   **500** for the `/project/` variant; the segment is spurious, the same defect as the TERRA URL.
   **This recovers a tier-2 developer source**, which F-010 states does not exist for any Azura figure
   beyond location and developer. Verified by me directly, not only by a research agent.
2. **A three-way conflict on a confirmed field.** The developer page dates construction **"2021-2024"**;
   Antalya Homes (C-32) states completion **"May 2025"**; `SOURCES.md` confirms **2024-05-30**. The
   developer — the tier that wins per §2.2 — is on the losing side of the current display value.
   Suggest a new finding record; W0-B owns the numbering.
3. **The 188-room hotel figure now has official corroboration.** ALTSO Table 7, sourced to the Antalya
   Provincial Directorate: `Türkler | Wyndham Alanya Otel | 188 rooms | 376 beds`, at Türkler Mah.
   Kargı Çayı Cad. 10. `SOURCES.md` currently grades 188 from a search chain. **376 beds is new.**
4. **The hotel's 2024 register status is BKT (municipality-licensed simple accommodation), not
   ministry-certified.** Material to how "5★ all-inclusive" is displayed. The honest rendering is
   _"operator/portal classification; official star classification not evidenced at 31.12.2024"_ —
   **not** a denial of five-star status, since the register predates the June 2025 opening.
5. **Two new Azura price observations widen F-002 from 2.1× to 2.3×:** C-32 (€200,000 / 81 m²) and
   C-33 (from €260,000 / 72 m²). Note the sizes move _inversely_ to the prices.
6. **Four source hosts absent from `SOURCES.md`** and carrying Azura World sales listings:
   `vikingen.net` (Norwegian channel, Tyrkialeiligheter AS), `firstalanya.ru`, `antalyahomes.com`,
   `newlifeturkey.com`.
7. **Turizm Güncel (`SOURCES.md` #23) is reachable** — recorded there as 403, fetched here as 200.
8. **The developer page claims a "private beach"** against the recorded 300 m to sea and 1 km
   hotel-to-beach with shuttle. Not necessarily contradictory, but they must be displayed together.

**For W4-B / W4-D (quality harness and gates) — one item that will otherwise produce false passes:**

9. **`qa:evidence` must compare response bodies, not status codes.** `veriportali.tuik.gov.tr`,
   `evds3.tcmb.gov.tr` and `endeksa.com` return **HTTP 200 with an empty JS shell for any path**,
   including deliberately invalid control paths I probed (S-004, S-005, S-048). `dask.gov.tr` returns
   200 on soft-404 redirects. A gate treating 200 as "source is live" will report these as healthy
   while they serve nothing — the same class of error CONVENTIONS.md §5 records for Ataberg's
   "51 of 154 downloads were 404 pages wearing a .jpg extension".

---

## Counts required by the brief

| Metric                                           | Value                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| URLs attempted across 5 research streams         | **≈ 287**                                                              |
| URLs yielding usable content                     | **≈ 192** (≈ 33 % yielded nothing)                                     |
| **Distinct source ids registered**               | **199** — all cited ids resolve, audited mechanically                  |
| **Comparable projects, fully sourced**           | **13** plus the subject, plus Goldcity's 2024 phase (brief minimum: 3) |
| Load-bearing claims re-verified by me personally | **13**                                                                 |
| Agent claims corrected as a result               | **2** (plus 1 disagreement resolved)                                   |
| `[GAP]` items in the annex inventory             | **42**                                                                 |
| Languages shipped                                | **4** (de authored; en/tr/ru direct translations, tr+ru unreviewed)    |

---

## Known gaps — the full `[GAP]` list

### Prices and value (12)

1. **Transaction prices — for any project, any district, any tier.** The single largest gap.
2. The asking-to-transaction gap — follows from 1; entirely unquantified.
3. Official district-level €/m² or ₺/m² — TCMB stops at NUTS-2 (TR61 = Antalya+Burdur+Isparta).
4. Endeksa as a primary source — six URL forms, all empty shells; all Endeksa figures relayed through
   one press article. **A single press relay of an index is not the index.**
5. TCMB "Konut Birim Fiyatları" quarterly unit prices — EVDS3 portlets serve no data.
6. Sahibinden Emlak360 index at source — 403; used only as republished by a tier-6 site.
7. Türkler, Payallar and Okurcalar are **absent from the Emlak360 EUR index entirely**.
8. New-build vs resale price differential for Alanya — no source; TÜİK gives only the volume split.
9. Off-plan vs completed price differential — no source.
10. **Current (2026) payment terms for Azura World** — the only two specifics are 3.4 years stale and
    expired May 2025 respectively.
11. Any price published by Cebeci Group for any project except Arnelya.
12. An ALTSO housing-price or market report — searched; none located.

### Yields and demand dynamics (5)

13. **Achieved rental yield for Alanya, Türkler or Azura World.** Only a _national_ gross yield exists.
14. Absorption / sell-through rates, days on market, unsold inventory — any project.
15. Hotel occupancy or ADR — for Türkler, for Alanya, or for this hotel.
16. **Any advertised rental guarantee for Azura World** — ten distribution hosts fetched, zero found.
17. Rental guarantees across the competitive set — published by 1 of 13 projects.

### Buyer data (5)

18. Foreign-buyer counts at **district (Alanya) level from TÜİK** — level-4 codelist returns 401.
19. Nationality × province cross-tabulation beyond what TÜİK's DataBrowser exposes.
20. Non-Russian nationality data at Alanya district level.
21. Whether P-30's Alanya district figures come from TÜİK or Alanya Tapu Müdürlüğü — ambiguous.
22. **Azura World's actual buyer nationalities** — nothing whatsoever.

### Geography, transport, tourism (7)

23. **Official Türkler → GZP and → AYT distances.** Only a labelled `[I]` derivation is offered.
24. Türkler → Alanya centre authoritatively — 15 km (M-34) against Wyndham's "20 km" (M-26).
25. Which D-400 section covers Türkler — KGM's PDF text layer carries no endpoint names.
26. Türkler population from TÜİK directly — ADNKS stops at province level.
27. Alanya district population from an official primary.
28. **An official causal explanation for the five-star cluster** — the designation register evidences
    the structure, not the intent.
29. Gate-level border arrivals for Antalya Merkez and Gazipaşa.

### Regulatory (7)

30. **Current status of the Alanya neighbourhood closures.** The 2022 position is settled (Türkler
    **not** closed, Avsallar closed). The reported 4 June 2026 reopening has **no official
    instrument** — local press quoting a party official and trade-body presidents, one stating the
    official letters were still pending. **Commercially the most dangerous open item in the register.**
31. The Citizenship Regulation's own text — three path variants returned HTML instead of PDF.
32. Whether **USD 400,000** is still the citizenship threshold in July 2026 — guide dated 01.02.2024.
33. **The USD 200,000 minimum for a property-based residence permit** — Göç İdaresi's own page states
    **no minimum value at all**. The figure exists only on law-firm and agency pages.
34. Any per-neighbourhood foreign-share percentage threshold — absent from both official
    announcements. **Must not be conflated with the 10 % district ownership cap in Tapu Kanunu Art. 35,
    which is a different rule.**
35. The instrument behind the 12.12.2023 kat mülkiyeti condition, read from the gazette itself.
36. Verified current text of Law 6458's residence-permit articles.

### Developer and competitive set (6)

37. Cebeci trade registry, tax and MERSİS numbers — endpoint 404s and is CAPTCHA-gated.
38. ALTSO membership status for Cebeci Group — no working member directory.
39. Independent substantiation of **"4000 apartments and 2 hotels"** — contradicted by the company's
    own Turkish page ("3500 konut, 3 otel"); neither has external support.
40. Any verification of **"Turkey's largest Residence & Hotel concept"** — nothing, any source.
41. **New Level Premium's hotel room count** — six sources confirm a 5★ hotel; none publishes rooms.
    This is the direct like-for-like against Azura World's 188 and is the most damaging missing cell
    in the competitive set.
42. Azura World's unit count, block count and price **from the developer** — not published; the
    7 blocks / 656 units figures remain portal-sourced only.

### Deliberate exclusion — not a gap

**New Level Premium block-level sales status and per-unit price ladder** held in the 1Çatı repository
are Ataberk commercial detail and were excluded on purpose. Every NLP figure used carries a **public**
source id, and the delivery date and entry price were re-fetched directly by me. This is a
confidentiality boundary, recorded so the omission is not mistaken for a research failure.

---

## Where figures are `[I]` (my reasoning) rather than `[V]` (sourced)

51 inline `[I]` marks per Marktanalyse. The ones most likely to be quoted out of context:

- **Land per unit** (Azura 115.9 m²/unit vs NLP 67.6) — my division of each project's own two verified
  figures. The arithmetic is shown so it can be checked.
- **"1.7× less dense", "1.46× the land", "39× the passengers", "33.1 % of the month's foreign sales",
  "−13.8 % H1", "−68.1 % from peak"** — all my arithmetic on verified figures.
- **Every €/m² in the district table** — my TRY→EUR conversion at one day's rate.
- **"62 km to Gazipaşa"** — a derivation from two verified values, **not a measurement**.
- **The structural cause of the five-star cluster** — my inference from the 1986–2012 tourism
  designation register. No document states the causation.
- **"The spread is specific to Azura World's listing data, not a market phenomenon"** — inference
  from the contrast with New Level Premium's 1.14× agreement across the same portal ecosystem.
- **"Azura World is Cebeci's second hotel operation, not its first"** — inference from Azura Deluxe's
  May 2015 opening.
- **"No in-district competitor in Türkler"** — a negative result from a broad but non-exhaustive
  search; labelled `[GAP]`, not asserted.

---

## Numbers that must NOT be presented to a client as researched benchmarks

Reproduced verbatim from §8.4 of each Marktanalyse — this is the most important list in the output.

1. **Every €/m² value in §5.2** — my conversion of portal figures at one day's rate, from asking
   rather than transaction prices.
2. **Every implied €/m² for Azura World** — a division of one portal's own two numbers.
3. **The range "1.2× to 3.0× above the Türkler level"** — the denominator is ~7-year-old resale stock
   and is not comparable.
4. **Portal yields (4.75 %–5.84 %)** — asking price ÷ asking rent, not achieved returns.
5. **GYODER's national gross yield (~5.2 %→5.8 %)** — a nationwide average dominated by
   İstanbul/Ankara stock. **Not an Alanya, resort or Azura yield.**
6. **"Alanya +22 %"** — true only in TRY; in EUR the same period was flat to falling, and nationally
   real house prices **fell 5.8 %**.
7. **ALTSO's USD 4.97 bn tourism revenue** — labelled an estimate by its own publisher.
8. **The USD 200,000 residence-permit threshold** — not officially evidenced.
9. **The USD 400,000 citizenship threshold without its date caveat** — evidence is from February 2024.
10. **"4000 apartments and 2 hotels"** — contradicted by the company itself in its other language.
11. **"Turkey's largest Residence & Hotel concept"** — an unevidenced self-claim; quotation only.
12. **The hotel's five-star status as an official classification** — BKT at the last available date.
13. **Every value marked `[V-s]`** in `Competitive-Set.md`.
14. **The derived 62 km to Gazipaşa** — arithmetic, not a measurement.

---

## One caveat on my own output

The `Competitive-Set.md` cells for **Konaklı (18) and Kargıcak (5)** carry **±1 extraction
uncertainty**: two independent parses of the same PDF disagreed by one row between those two mahalle,
with the total unchanged at 99. The published figures use the parse that had zero unmatched rows.
**Türkler (20), Okurcalar (28) and the total (99) are not affected** — they agree across both parses
and across a second table in the same report.
