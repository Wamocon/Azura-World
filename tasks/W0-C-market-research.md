# W0-C — Market analysis & source register

**Wave:** 0 · **Depends on:** nothing · **Blocks:** nothing (documents only) · **Runs with:** W0-A, W0-B

> Read `SYSTEM-PROMPT.md` §3 (evidence grading) and `SOURCES.md` first.
>
> Reference deliverables to mirror:
> `D:\Real Estate CRM\Cati\docs\Marktanalyse\1Cati-Marktanalyse-2026-de.md`-equivalents (de/en/tr/ru),
> `docs\requirements\option-3-ai-site-crm\Market-Research-Annex.md`,
> `docs\requirements\option-3-ai-site-crm\Source-Register.md`.

---

## Why this task exists

The 1Çatı project ships a full **Marktanalyse** in four languages plus a Market-Research-Annex and
a Source-Register. My original wave plan had **product** research (W0-B: what Azura World *is*)
but no **market** research (what the Alanya market looks like, what comparable projects cost, who
buys). For a competitor CATI that gap matters more than it did for the original — the point of
competitor intelligence is comparison, and comparison needs a baseline.

This task is documents only. It touches no code, blocks nothing, and can run in any window at
any time. It is separated from W0-B deliberately: W0-B has a hard, narrow job (harvest 23 sources
correctly) and widening it would dilute the thing the acceptance criteria depend on.

**Scope note:** none of the four acceptance criteria require this. It is additive, and if the
29 July deadline gets tight, this is the first task to cut — cut it whole, do not half-write it.

---

## Files you own

```
docs/market/Marktanalyse-Azura-World-2026-{de,en,tr,ru}.md
docs/market/Market-Research-Annex.md
docs/market/Source-Register.md
docs/market/Competitive-Set.md
HANDOFF/W0-C.md
```

Do not touch `SOURCES.md` — that is W0-B's, and it covers *project* sources. Yours is the
*market* register. Cross-reference by source id; do not duplicate entries.

---

## Deliverables

### 1. `Marktanalyse-Azura-World-2026-de.md` (then en, tr, ru)

Sections:

1. **Evidence key** — `[V]` / `[I]` / `[GAP]`, stated first, as in `ANALYSIS.md`
2. **The market** — Alanya / Antalya coastal residential + resort. Türkler specifically: what
   kind of district it is, why 5★ hotels cluster there, transport (D-400, Gazipaşa 60 km,
   Antalya ~100 km)
3. **The developer** — Cebeci Group A.Ş., est. 1982. Their portfolio is public and large:
   **26 projects** listed on cebecigroup.com, including Azura Deluxe Resort & SPA, Wyndham Hotel
   Alanya, Alanya Country Club, Cebeci Towers, Cebeci Vista, Arnelya Beach Residence. That
   portfolio *is* the market position — describe it factually.
4. **The competitive set** — comparable Türkler/Avsallar/Konaklı residence-plus-hotel projects.
   **New Level Premium Avsallar is the natural comparator** (769 units, 52,000 m², 5★ hotel,
   900 m to beach, 3-year 10% rental guarantee) because 1Çatı already holds a verified dataset
   for it. Comparing 656/76,000 m²/300 m against 769/52,000 m²/900 m is the single most useful
   table in this document.
5. **Price positioning** — where Azura's quoted ranges sit against the set. **Carry F-002's
   conflict into this section**; a positioning claim built on one portal's number is worthless.
6. **Buyer profile** — which markets the portals target. The source mix is itself evidence:
   5 of 7 portals are German-language, one is Russian (Kalinka), one UK (OnTheBeach). That is a
   finding about who is being sold to, not a guess.
7. **The hotel as an asset** — 5★ all-inclusive, 188 rooms, opened 2025, Wyndham licence then
   rebranded (F-007). What an on-site operating hotel does to a residence's rental proposition.
8. **Risks and unknowns** — the `[GAP]` list

### 2. `Competitive-Set.md`

A comparison table across every comparable project you can source: units, land area, beach
distance, hotel stars, price band, completion year, developer. One row per project, every cell
carrying its source.

Rows with no source are **omitted**, not estimated.

### 3. `Market-Research-Annex.md`

Methodology, search strategy, what you looked for and could not find, and the limits of the
research. Be direct about them.

### 4. `Source-Register.md`

Every market source: id, publisher, url, tier, date accessed, what it was used for, reliability
assessment. Distinct from `SOURCES.md`, which registers project sources.

---

## The rule that governs this task

**No invented benchmarks.**

Ataberg's `ANALYSIS.md` carries a warning worth copying verbatim in spirit:

> *"I have **no verified conversion-rate benchmarks** for real-estate lead generation in 2026…
> Section 3's business criteria are therefore reasoned from the audit and competitor evidence,
> not from cited industry benchmarks. **Do not present Section 3's business numbers to a client
> as researched benchmarks.**"*

If you cannot source a market statistic — average €/m² in Alanya, foreign-buyer volumes, rental
yields, absorption rates — then it is a `[GAP]`. A plausible-sounding yield figure in a document
with a Wamocon header will be quoted back to you in a client meeting, and you will not be able
to defend it. Write the gap instead.

Anything you reason rather than source is `[I]`, labelled inline, not in a footnote.

---

## Edge cases

- **Turkish real-estate statistics** (TÜİK, GYODER) are published in Turkish and often lag.
  Cite the publication date; a 2023 figure presented as current is a `[V]` fact used
  misleadingly.
- **Currency**: Turkish market data is often TRY, portals quote EUR/USD. Given TRY inflation, a
  TRY figure without its date is meaningless. Never convert without a dated rate.
- **Portal listings are asking prices**, not transaction prices. Say so every time you use one.
  The gap between the two is the whole subject of price research.
- **The developer's own portfolio page** is marketing. "26 projects" is `[V]` (it is what they
  publish); "Turkey's largest Residence & Hotel concept" is their claim, not a fact — attribute
  it as a quote.
- **New Level Premium data** lives in the 1Çatı repo under a different client's engagement. Use
  it as a market comparator only; do not copy the dataset into this repository, and do not
  disclose Ataberk-specific commercial detail.
- **Four languages**: German is primary and the others are translations. Where you cannot produce
  good copy in Turkish or Russian, ship German + English and record it — an honest two-language
  document beats four where two are machine-translated.

---

## Definition of done

- All four Marktanalyse files exist, or fewer with the shortfall explicitly recorded
- `Competitive-Set.md` has ≥3 comparable projects, every cell sourced
- `Source-Register.md` covers every source cited anywhere in your output
- **Every number in every document traces to a source id**, verified by your own read-through
- The `[GAP]` list is genuinely populated — a market analysis with no gaps has been fabricated

Paste in the handoff: the source count, the comparable-project count, and the full `[GAP]` list.

---

## Handoff must state

- Which market statistics you could **not** source, and what you left as `[GAP]`
- Any place a figure is `[I]` (your reasoning) rather than `[V]` (sourced) — these are the lines
  most likely to be quoted out of context
- Which languages actually shipped, and which are fallbacks
- Explicitly: **which numbers in this document must not be presented to a client as researched
  benchmarks**
