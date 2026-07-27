# Market Research Annex — methodology, limits, and what could not be found

**Task:** W0-C · **Compiled:** 2026-07-27 · **Owner:** W0-C
**STRICTLY CONFIDENTIAL — competitor intelligence.**

Companion documents: [`Marktanalyse-Azura-World-2026-de.md`](Marktanalyse-Azura-World-2026-de.md) (primary) ·
[`Competitive-Set.md`](Competitive-Set.md) · [`Source-Register.md`](Source-Register.md)

This annex exists so that a reader can judge **how much weight the findings carry**. It is written to
be uncomfortable reading in places. That is the point: a market analysis whose method section makes
the research sound uniformly successful is describing a different piece of work than the one that
happened.

---

## 1. What was asked, and what governed the work

W0-C's brief asks for market research to complement W0-B's product research: what the Alanya market
looks like, what comparable projects cost, who buys. It is documents-only, touches no code and blocks
nothing.

**The rule that governed every decision:**

> If a market statistic cannot be sourced, it is a `[GAP]`. Never an estimate.
> **A market analysis with no gaps has been fabricated.**

That rule was applied literally. §6 of this annex lists 42 distinct things that were sought and not
found. Several of them are the figures a reader would most want — district transaction prices, rental
yields, absorption rates. **They are absent because they could not be established, not because they
were overlooked.**

---

## 2. Method

### 2.1 Structure

Research was fanned out across **four parallel independent agents**, per ORCHESTRATION.md §7's
prescribed split for this task, plus one nested stream that a research agent spawned itself:

| Stream | Scope | URLs attempted | Usable |
|---|---|---|---|
| A | Market + developer: Türkler, Alanya, TÜİK/TCMB statistics, Cebeci Group | 44 | 38 |
| B | Competitive set: comparable projects on the Alanya coastal strip | 46 | 36 |
| C | Price positioning + buyer profile | 72 | 40 |
| D | Official / statistical / regulatory sweep | ~100 | ~60 |
| E *(nested)* | Türkler geography, KGM road distances, DHMİ, Ministry tourism registers | ~25 | ~18 |
| **Total** | | **≈ 287** | **≈ 192** |

Each stream was given SYSTEM-PROMPT.md §3 (the evidence grading rules) and the brief's
"no invented benchmarks" clause **explicitly in its instructions**, and was required to report the
HTTP result actually obtained for every URL plus an exhaustive `[GAP]` list. None was permitted to
write files; all returned content, which the owning window integrated.

### 2.2 Verification of subagent output

ORCHESTRATION.md §7.4 states that *"a subagent reporting success is a claim, not evidence."* Thirteen
load-bearing claims were re-fetched or re-parsed by the owning window before use. The full list is in
[`Source-Register.md`](Source-Register.md) §4. **Two agent claims were corrected as a result**, and
one agent disagreement was resolved — see §3.

### 2.3 Search strategy

- **Official sources first, in the publisher's own language.** Turkish statistical and regulatory
  bodies were queried in Turkish; German-, Russian- and Norwegian-language portals were read in their
  own languages rather than through translation.
- **Multi-modal search per question.** Each substantive question was pursued through at least two
  routes: direct URL construction against the publisher, and search. Where both failed the item
  became a `[GAP]`.
- **Machine-readable formats preferred over rendered pages.** The decisive sources in this study were
  an XLSX (Göç İdaresi closed-neighbourhood list), a 28 MB XLSX (KGM road distances), an XLSX of
  DHMİ passenger traffic, and an 11.4 MB PDF (ALTSO). None of these was reachable by reading a web
  page; all required downloading and parsing the artefact.
- **Control probes on hosts suspected of returning empty shells.** See §4.2 — this changed how three
  major sources were graded.

### 2.4 Currency handling

**One rate, one date, cited everywhere:** TCMB bulletin **2026/137 of 27.07.2026, EUR/TRY 53.9717,
USD/TRY 47.3533** (P-12), verified by the owning window directly against `tcmb.gov.tr/kurlar/today.xml`.

No other conversion appears in any W0-C document. Where a source published its own undated
multi-currency conversion — Alanya Properties quoted one price simultaneously in EUR, USD, GBP and
TRY (C-24) — **the conversion was discarded and only the original figure retained.** Per the brief's
currency edge case, a TRY figure without its date is meaningless, and a portal's undated FX is worse
than no figure.

**One consequence to note honestly:** the district €/m² table in the Marktanalyse §5.2 converts
Emlakjet's 27.07.2026 TRY figures at the same day's rate, which is sound. But the Endeksa row (June
2026 data) is converted at a 27 July rate — **a date mismatch, flagged in place.**

---

## 3. Where the research disagreed with itself

Independent streams produced three genuine conflicts. All three are recorded rather than smoothed,
because how they were resolved determines how much the resulting numbers can bear.

### 3.1 The Türkler five-star count — resolved by re-parsing the source

| Stream | Claim | Grade given |
|---|---|---|
| A | Türkler holds 20 of Alanya's 99 five-star hotels; parse total matches ALTSO's own 99 | `[V]` |
| D | "Türkler 5-star count ≈20" — two readings agree but **column headers could not be aligned with certainty** in a two-column PDF | `[I]` |

**This is the single most load-bearing market claim in the analysis**, so the owning window resolved
it from the source rather than choosing a side:

1. Downloaded the ALTSO PDF (11,373,175 bytes — matching stream A's reported size exactly).
2. Located the register: **pages 125–128**, "Tablo 6: Kültür ve Turizm Bakanlığı'ndan Belgeli
   Alanya'daki Konaklama Tesisleri (2024)", sourced to Antalya İl Kültür ve Turizm Müdürlüğü.
3. Counted class tokens per page: **5★ = 69 (p125) + 30 (p126) = 99 exactly**, plus 5 × `5*TK`
   (holiday villages). The 99 total is therefore confirmed independently of any column alignment.
4. Aligned the mahalle and class columns **geometrically**, matching each class token to the nearest
   mahalle token by y-coordinate. First attempt (naive y-bucketing then zip) produced 4 column-count
   mismatches and recovered only 65 of 99. Second attempt (nearest-y matching) produced **zero
   unmatched rows** and a total of exactly 99.

**Result:** Okurcalar 28 · **Türkler 20** · Konaklı 18 · Avsallar 9 · Payallar 6 · Oba 5 · Kargıcak 5 ·
Kestel 3 · Tosmur 2 · İncekum 2 · Mahmutlar 1 = **99**.

5. **Corroborated from a second, independent table** in the same report: the summary table on p. 98
   gives Türkler as `1 | 20 | 4 | 1 | 1 | 27 | 5 | 5 | 32` — 1 five-star holiday village, **20
   five-star hotels**, 27 certified establishments, 32 total.

**Ruling: `[V]`, not `[I]`.** Two independent extractions plus a second table in the same document
agree on both the total and the Türkler figure. The `[I]` grading was over-cautious.

> **Caveat that survives the resolution:** the naive parse and the nearest-y parse disagreed by one
> row on **Konaklı (18 vs 19) and Kargıcak (5 vs 4)**, with the total unchanged. The published figures
> use the nearest-y result, which had zero unmatched rows. **Those two cells carry ±1 extraction
> uncertainty; Türkler, Okurcalar and the total do not.**

### 3.2 Whether the hotel appears in the 2024 register — an agent claim corrected

Stream A reported: *"Azura World Hotel / Wyndham Alanya does not appear anywhere in the 31.12.2024
register — its absence is confirmation of the opening date."*

**That is wrong, and the correct finding is more useful than the claimed one.** The owning window
found the property by searching the PDF directly:

> ALTSO **Table 7, "Alanya'da Basit Konaklama Tesisleri (BKT) (2024)"**, row 296:
> `Türkler | Wyndham Alanya Otel | Otel | Türkler Mah. Kargı Çayı Cad. 10 | 188 rooms | 376 beds`

The hotel **is** in the 2024 report — in the **municipality-licensed simple-accommodation table**,
not the ministry-certified table. Three consequences:

1. **The 188-room figure gains official corroboration.** In `SOURCES.md` it rested on a search-result
   chain; it now has an official provincial source. The bed count (376) is new.
2. **As at 31.12.2024 the property held a BKT record, not a ministry five-star certificate.**
3. **But the register date precedes the June 2025 opening**, so this cannot be read as "the hotel is
   not five-star" — only as "official star classification not evidenced at that date". Whether
   certification followed during 2025 is `[GAP]`; no 2025 register exists.

`[I]` Stream A's error was a reasonable one — it searched for the property in the certified register
and correctly reported it absent — but it then converted that absence into a confirmation. **Absence
from one table is not absence from the document.**

### 3.3 The New Level Premium rental guarantee — an unresolved inconsistency, published as such

| Stream | Finding |
|---|---|
| B | Guarantee found and sourced publicly: 10 % p.a., 3 years, first year's rent deducted, 3 weeks owner use; offer page dated **12.11.2024** |
| C | **Could not find it.** Searched, found the project, did not find the guarantee terms. Recommended treating the figure as a 1Çatı dataset value only and **not** presenting it as researched |

Both passes were independent and both were thorough. The owning window did **not** resolve this by
picking the more convenient answer. The evidence does exist — a single public host, 20 months old —
and it is published in the Marktanalyse §4.2 **with that weakness stated in the same paragraph**, and
flagged as the statement of a sales partner rather than a developer undertaking.

`[I]` The disagreement is itself informative: a term that one thorough search finds and another
misses is, by definition, not prominently published.

**A related judgement recorded for transparency:** the public source for the guarantee is a page on
`ataberkestate.com` — the public website of the client in the separate 1Çatı engagement. Citing a
firm's public marketing page discloses no confidential information, and the figure is treated as what
it is: **a reseller's dated offer.** No 1Çatı repository data was used (see §5).

---

## 4. What the research learned about sources themselves

### 4.1 Availability is worse than a naive fetch suggests, and better than `SOURCES.md` implies

`SOURCES.md` records 9 of 15 ticket URLs failing a plain fetch (60 %). Across W0-C's ~287 attempts
the failure rate was materially lower — roughly 33 % yielded nothing usable — but the failures
clustered in the **most authoritative** tier:

- **TÜİK's own portal returns HTTP 200 with an empty React shell for every path**, including
  deliberately invalid control paths. The working routes are the AJAX partial
  (`/Home/HaberBultenleriPartial`), browser rendering, and the DataBrowser JSON-stat API.
- **TCMB's EVDS3 returns a 1,355-byte JavaScript shell** on every path. Unit-price tables are
  effectively unreachable; only the KFE PDF yielded data.
- **Endeksa returns byte-identical 200 responses for real and nonsense URLs.** Every Endeksa figure in
  these documents is relayed through one newspaper article — **a single press relay of an index is
  not the index.**
- **An official `.gov.tr` host (`yourkeyturkiye.gov.tr`) has an incomplete TLS certificate chain.**
  Recorded as a finding; verification was **not** silently disabled.
- **TKGM publishes a page titled "TAPU İŞLEM İSTATİSTİKLERİ" containing no statistics** — the figures
  are JS-loaded. TKGM contributed nothing statistical to this study.

### 4.2 The control-probe method, and why it matters downstream

Because several hosts return 200 for anything, three explicit **control probes** were run against
deliberately invalid paths (S-004, S-005, S-048). All returned responses byte-identical to the real
URLs.

> **Operational consequence for W0-B and W4-D:** any link-checker or evidence-verification harness
> built for this project **must compare response bodies, not status codes.** A `qa:evidence` gate
> that treats HTTP 200 as "source is live" will report these hosts as healthy while they serve
> nothing. This is the same class of error CONVENTIONS.md §5 already records for Ataberg — 51 of 154
> "downloads" that were 404 pages wearing a `.jpg` extension.

### 4.3 The most valuable source was not on anyone's list

**ALTSO's *Alanya Ekonomik Rapor 2024*** (S-043) — an 11.4 MB, 134-page PDF from the Alanya Chamber of
Commerce and Industry, ISBN 978-625-390-040-3, published 17 September 2025 — is the only source found
that operates at **mahalle level**. It supplied Türkler's population, bed capacity, establishment
counts, the hotel-by-hotel certified register, the BKT register, and Alanya's foreign-buyer tables.
It was not in the ticket, not in `SOURCES.md`, and was reached only after three guessed ALTSO paths
failed.

**Its limits, stated plainly:**

- It covers **2024** and was published in **September 2025**. ALTSO's cadence is roughly 9–12 months
  after year-end, so **no 2025 edition exists as of July 2026.** Nothing from it may be presented as
  current-year data.
- It is a **chamber of commerce promoting its own district.** The tabulated figures are used; the
  prose is treated as advocacy. Its "70 km of coastline, Türkiye's longest" and its USD 4.97 bn
  tourism revenue estimate are both flagged in place as ALTSO's own claims.
- Its Turkish diacritics are destroyed by text extraction (the letter *i* renders as an unrelated
  codepoint), which is why coordinate-based parsing was necessary rather than string matching.

---

## 5. Data-handling boundaries

**New Level Premium — a confidentiality boundary, not a gap.** The brief authorises this project as a
comparator because the 1Çatı engagement holds a verified dataset for it. **No figure in any W0-C
document was taken from that dataset.** Every NLP value carries a public source id; the delivery date
and entry price were re-fetched directly by the owning window. The block-level sales status and
per-unit price ladder held in the 1Çatı repository are **Ataberk commercial detail and were
deliberately excluded.** This is recorded so the omission is not mistaken for a research failure.

**Portal listings are asking prices.** Stated at the head of every document, in every price table,
and again in every analytical paragraph that uses one. The repetition is deliberate.

**Developer self-descriptions are quoted, never asserted.** "Turkey's largest Residence & Hotel &
Entertainment concept project" and "one of the largest developers in the region" appear only inside
quotation marks with attribution, every time.

---

## 6. What was sought and not found — the complete `[GAP]` inventory

42 items. Grouped by kind. Nothing here has been filled with a plausible figure.

### 6.1 Prices and value (12)

1. **Transaction prices — for any project, any district, any tier.** The single largest gap.
2. **The asking-to-transaction gap** — follows from 1; entirely unquantified.
3. **Official district-level €/m² or ₺/m²** — TCMB stops at NUTS-2 (TR61 = Antalya + Burdur + Isparta).
4. **Endeksa as a primary source** — six URL forms, all empty shells; all Endeksa figures relayed
   through one press article.
5. **TCMB "Konut Birim Fiyatları" quarterly unit prices** — EVDS3 portlets serve no data.
6. **Sahibinden Emlak360 index at source** — 403; used only as republished by a tier-6 site.
7. **Türkler, Payallar and Okurcalar in the Emlak360 EUR index** — absent entirely.
8. **New-build vs resale price differential for Alanya** — no source; TÜİK gives only volume split.
9. **Off-plan vs completed price differential** — no source.
10. **Current (2026) payment terms for Azura World** — the only two specifics are 3.4 years stale and
    expired May 2025 respectively.
11. **Any price published by Cebeci Group for any project except Arnelya** — the developer publishes
    plot areas, not prices.
12. **An ALTSO housing-price or market report** — searched; none located.

### 6.2 Yields and demand dynamics (5)

13. **Achieved rental yield for Alanya, Türkler or Azura World.** Only a *national* gross yield exists
    (GYODER, ~5.2 %→5.8 %) which must not be transferred; portal yields are asking ÷ asking.
14. **Absorption / sell-through rates, days on market, unsold inventory** — no source, any project.
15. **Hotel occupancy or ADR** — for Türkler, for Alanya, or for this hotel.
16. **Any advertised rental guarantee for Azura World** — ten distribution hosts fetched, zero found.
17. **Rental guarantees across the competitive set** — published by 1 of 13 projects.

### 6.3 Buyer data (5)

18. **Foreign-buyer counts at district (Alanya) level from TÜİK** — the dataflow exists; the level-4
    codelist returns 401 anonymously. ALTSO is a partial substitute but counts *persons* acquiring
    *any* property type by *any* means, which is not the same metric.
19. **Nationality × province cross-tabulation beyond what TÜİK's DataBrowser exposes.**
20. **Non-Russian nationality data at Alanya district level** — the one district series found covers
    Russians only.
21. **Whether the Alanya district figures in P-30 come from TÜİK or Alanya Tapu Müdürlüğü** — the
    article is ambiguous.
22. **Azura World's actual buyer nationalities** — nothing whatsoever. The channel-language analysis
    is a proxy, and a weak one.

### 6.4 Geography, transport, tourism (7)

23. **Official Türkler → GZP and Türkler → AYT distances.** KGM resolves only to district centre; the
    airport publishes nothing. Only a clearly-labelled `[I]` derivation is offered.
24. **Türkler → Alanya centre**, authoritatively — 15 km (Wikipedia) against Wyndham's "20 km".
25. **Which D-400 section covers Türkler** — KGM's PDF text layer carries no section endpoint names.
26. **Türkler population from TÜİK directly** — the ADNKS bulletin stops at province level.
27. **Alanya district population from an official primary** — not in the ADNKS press text.
28. **An official causal explanation for the five-star cluster** — the designation register evidences
    the structure; no document states the intent.
29. **Gate-level border arrivals for Antalya Merkez and Gazipaşa** — the .XLS layout defeated parsing;
    only the province aggregate is reported.

### 6.5 Regulatory (7)

30. **Current status of the Alanya neighbourhood closures.** The 2022 position is settled from the
    official machine-readable list. The reported 4 June 2026 reopening has **no official instrument**;
    it rests on local press quoting a party official and trade-body presidents, one of which states
    the official letters were still pending. **Commercially the most dangerous open item.**
31. **The Citizenship Regulation's own text** — three `MevzuatMetin` path variants returned HTML.
    The USD 400,000 threshold rests on a TKGM guide dated 01.02.2024.
32. **Whether USD 400,000 is still the threshold in July 2026** — not established.
33. **The USD 200,000 minimum for a property-based residence permit** — Göç İdaresi's own page states
    **no minimum value at all.** The figure exists only on law-firm and agency pages.
34. **Any per-neighbourhood foreign-share percentage threshold** — absent from both official
    announcements. The only verified percentage in law is the 10 % district cap in Tapu Kanunu Art. 35,
    which is a **different rule** (ownership, not residence registration). **These must not be conflated.**
35. **The instrument behind the 12.12.2023 kat mülkiyeti condition, read from the gazette itself.**
36. **Verified current text of Law 6458's residence-permit articles** — the PDF was downloaded but
    the articles were not extracted; the rule cited comes from the Göç İdaresi FAQ.

### 6.6 Developer and competitive set (6)

37. **Cebeci trade registry, tax and MERSİS numbers** — search endpoint 404s and is CAPTCHA-gated;
    EMIS paywalls them.
38. **ALTSO membership status for Cebeci Group** — no working member directory.
39. **Independent substantiation of "4000 apartments and 2 hotels"** — or of the Turkish "3500 konut,
    3 otel". The two contradict each other and neither has external support.
40. **Any verification of "Turkey's largest Residence & Hotel concept"** — nothing found, any source.
41. **New Level Premium's hotel room count** — six sources confirm a 5★ hotel; none publishes rooms.
    This is the direct like-for-like against Azura World's 188 and its absence is the most damaging
    missing cell in the competitive set.
42. **Azura World's unit count, block count and price from the developer** — not published. The
    7 blocks / 656 units figures remain portal-sourced only.

---

## 7. Limits of this research, stated directly

**It is a desk study conducted in one day.** No site visit, no agent interview, no land-registry
search, no conversation with Göç İdaresi Alanya. Several of the gaps above — current payment terms,
the closure status of Türkler, whether the hotel holds a ministry certificate — would likely be closed
by three phone calls. **They are gaps in this document, not necessarily unknowable facts.**

**Almost every price is a reseller's asking price.** The developer publishes no price for Azura World
at all. Ten independent agencies quote it in three currencies with a 2.3× spread. `[I]` This means the
price sections describe **the distribution channel's behaviour** more reliably than they describe the
asset's value, and they are written to say so.

**The district benchmark is not like-for-like.** Türkler's portal average rests on 18 listings of
~7-year-old resale stock. It cannot benchmark a 2024 resort residence, and every comparison against
it carries that caveat in place.

**Two of the most useful findings are negative results.** No residence-plus-hotel competitor inside
Türkler; no published rental guarantee for Azura World. Negative results from an incomplete search are
weaker than positive ones, and both are labelled `[GAP]` rather than presented as established
absences — even though the searches behind them were broad.

**Currency direction changes the story.** In TRY, Alanya asking prices rose ~22 %; in EUR they were
flat to falling; nationally, real house prices fell 5.8 %. A reader taking one of these three figures
without the others would form a materially wrong impression. Every price statement in the Marktanalyse
therefore carries its currency and its date.

**The research corrected three premises it was given** — the brief's "26 projects" (it is 28), the
brief's "5 of 7 portals are German-language" (a sampling artefact of the ticket, not a market fact),
and `SOURCES.md`'s record of the Cebeci Azura World page as dead (it returns 200 at the correct URL).
`[I]` That three of the inputs needed correction is itself a finding about how much of this project's
inherited context should be re-verified rather than assumed.

---

## 8. Requests arising for other windows

W0-C owns `docs/market/*` only and does not write `SOURCES.md`. The following belong to **W0-B**:

1. **`https://www.cebecigroup.com/en/azura-world-residence-hotel` returns 200** — `SOURCES.md`
   records 500 for the `/project/` variant. This recovers a **tier-2 developer source**, which F-010
   states does not currently exist for any Azura figure beyond location and developer.
2. **A three-way conflict on a confirmed field:** the developer page dates construction "2021-2024",
   Antalya Homes (C-32) states completion "May 2025", against the confirmed 2024-05-30. The developer
   — the tier that wins per SYSTEM-PROMPT §2.2 — is on the losing side of the current value. Suggest a
   new finding record; W0-B owns the numbering.
3. **The 188-room hotel figure now has official corroboration** (ALTSO Table 7, 188 rooms / 376 beds),
   upgrading it from a search-derived single source. **New fact available: 376 beds.**
4. **The hotel's register status at 31.12.2024 is BKT (municipality-licensed), not ministry-certified**
   — material to how the "5★" claim is displayed in the CATI.
5. **Two new Azura price observations** widen F-002 from 2.1× to 2.3×: C-32 (€200,000 / 81 m²) and
   C-33 (from €260,000 / 72 m²).
6. **Two new source hosts not in `SOURCES.md`:** `vikingen.net` (Norwegian channel, Tyrkialeiligheter AS)
   and `firstalanya.ru`, plus `antalyahomes.com` and `newlifeturkey.com`.
7. **Turizm Güncel (`SOURCES.md` #23) is reachable** — recorded there as 403, recovered here as 200.
8. **The developer page claims a "private beach"** against the recorded 300 m to sea and 1 km
   hotel-to-beach with shuttle. Not necessarily contradictory, but they must be displayed together.

And for **W4-D / W4-B**, from §4.2: **the evidence-verification gate must compare response bodies, not
status codes.** Three major hosts in this study return HTTP 200 with an empty shell for any path,
including invalid control paths.
