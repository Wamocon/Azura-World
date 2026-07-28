# W0-B — Evidence layer: harvest → dataset → conflict register

**Wave:** 0 · **Depends on:** nothing · **Blocks:** W3-C, W3-G, W2-C · **Runs with:** W0-A

> Read `SYSTEM-PROMPT.md`, `CONVENTIONS.md`, `CONTRACTS.md`, `SOURCES.md` before writing anything.

---

## Mission

This task **is** the ticket. Acceptance criteria 2, 3 and 4 are satisfied here or nowhere.

Build a reproducible pipeline that harvests 23 competitor sources, extracts every fact with its
provenance, records every disagreement rather than resolving it silently, and emits a typed
dataset the rest of the app renders. Its output is the difference between competitor
_intelligence_ and competitor _rumour_.

You do not need W0-A's scaffold to start — write the scripts, generate `sources/raw/`, and only
the final TypeScript emit needs the repo to compile.

---

## Files you own

```
scripts/harvest-azura.mjs · scripts/build-azura-dataset.py · scripts/verify-evidence.mjs
scripts/sources.config.json
sources/**                       (raw snapshots, manifest)
apps/web/lib/azura-world-data.ts (generated)
supabase/imports/azura-*.sql · supabase/imports/azura-units-master.csv
ANALYSIS.md
SOURCES.md                       (append + update the status column only)
HANDOFF/W0-B.md
```

---

## Reference implementations — read before writing

| For                            | Read                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------- |
| Harvest with byte validation   | `D:\Ataberg\scripts\harvest.mjs`                                                  |
| Listing extraction             | `D:\Ataberg\scripts\extract-listings.mjs`                                         |
| Dataset build → TS + SQL + CSV | `D:\Real Estate CRM\Cati\scripts\build-new-level-premium-dataset.py`              |
| Target output shape            | `D:\Real Estate CRM\Cati\apps\web\lib\new-level-premium-data.ts` (first 70 lines) |
| Evidence grading style         | `D:\Ataberg\ANALYSIS.md` §0                                                       |

---

## Deliverables

### 1. `scripts/sources.config.json`

All 23 sources from `SOURCES.md` §1 as data: `{ id, publisher, tier, url, locale, kind, expect }`
where `kind` ∈ `official | developer | hotel | portal | review | booking | press | social`.
`expect` names a selector or text token that must be present for the fetch to count as real
content. **The config is data, not code** — adding a source must never require editing a script.

### 2. `scripts/harvest-azura.mjs` — Playwright, not `fetch`

Nine of fifteen ticket URLs returned 403/timeout to plain fetch. A real browser recovers most.

Requirements:

- **Playwright Chromium, headed-equivalent context**: real UA, `de-DE` and `en-US` locale
  variants, viewport 1440×900, `Accept-Language` set per source locale.
- **Politeness**: ≥2s between requests to the same host, respect `robots.txt`, concurrency ≤3
  across hosts, ≤1 per host. This is competitor research, not a stress test.
- **Validate the bytes, not the status line.** A 200 carrying a bot wall, a soft-404, or a
  cookie-consent interstitial is `contentValidated: false`. Check the `expect` token. Ataberg
  shipped 51 of 154 "successful" downloads as 404 pages wearing a `.jpg` extension — that
  failure mode is the reason this rule exists.
- **Snapshot everything**: raw HTML → `sources/raw/<host>/<iso>.html`, plus a full-page
  screenshot → `sources/raw/<host>/<iso>.png`. Record `sha256`. A citation you cannot re-open is
  not a citation.
- **Never disable TLS verification silently.** `azuraworldhotel.com` presents an invalid chain.
  Retry with tolerance **only** if the flag `--allow-invalid-tls` is passed, and emit a
  `critical` `Finding` recording it either way.
- **Report every failure** into the manifest with a transport label (`dns_timeout`,
  `tls_invalid`, `blocked_403`, `http_500`, `soft_404`). Nothing is silently skipped.
- `--only=<id>` and `--dry-run` flags for iteration.

Also harvest **individual unit listings**, not just project pages — that is the only route to
real per-unit prices for F-002.

### 3. `scripts/build-azura-dataset.py`

`sources/raw/` → `AzuraWorldDataset` exactly as `CONTRACTS.md` §2. Emits:

- `apps/web/lib/azura-world-data.ts` — with the do-not-hand-edit header
- `supabase/imports/azura-project-baseline.sql`
- `supabase/imports/azura-units-master.csv`

**Extraction rules:**

- Per-host parser modules. One host's markup change must not break the others.
- Every extracted value becomes a `SourcedFact` with its `SourceRef`. **No bare values.**
- Currency is parsed, never assumed. Housearch quotes USD; most others EUR. `Money` keeps its
  currency. **No conversion in the pipeline** — convert at display only, labelled, with a dated rate.
- Two sources agreeing on the same value from **distinct hosts** ⟹ `confirmed`. Same value from
  two mirrors of one operator is one source.
- Disagreement ⟹ `conflicted` + a `Finding`, **never a silent pick**. Display value follows
  tier order (`CONTRACTS.md` §1); the losing value stays in `conflictsWith`.
- **Seed the ten findings F-001…F-010 from `SOURCES.md` §3** and add whatever the harvest turns up.
- `--strict` mode fails the build on any invariant violation. CI uses it.

**Unit inventory — read this carefully.** 656 total units is confirmed; **no source gives a
unit-by-unit breakdown**. So:

- Real scraped listings → `dataQuality: "portal_listing"`, real prices, real URLs
- The remainder, synthesised to fill 656 → `dataQuality: "modelled"`, `askingPrice.confidence:
"inferred"` with a note naming the derivation
- The counts must appear in the dataset: `{ portalListing: n, modelled: 656 - n }`
- **A modelled unit must never be displayed in a way that reads as a real listing.** W3-C
  enforces the visual distinction; you enforce the data honesty.

### 4. `scripts/verify-evidence.mjs`

Independent validator — not the builder checking its own work. Exits non-zero on:

1. Any of the six `SourcedFact` invariants violated (use `assertFactInvariants` from W0-A)
2. A `snapshotHash` with no file under `sources/raw/`
3. A `confirmed` fact whose two sources share a host
4. A `Finding` with `resolvedTo` set but an empty `resolution`
5. A `conflicted` fact with an empty `conflictsWith`
6. Any displayed-tier fact with zero sources
7. A `Money` with `amount ≤ 0`

Prints a coverage table: facts by confidence level, sources by status, findings by severity.

### 5. `ANALYSIS.md`

The competitor situation analysis, in Ataberg's register. Sections:

0. Evidence quality — the `[V]/[I]/[GAP]` key, stated first
1. What Azura World actually is
2. The source estate — 23 sources, which are authoritative, which are unreachable
3. The conflict register — all findings, with your reasoning
4. What the portals disagree about and why _(currency, staleness, subsetting)_
5. The hotel: rebrand, ratings, polarised sentiment
6. **What is not established** — the `[GAP]` list, unfilled

Rule: no number appears without a source. No `[GAP]` gets a plausible guess. If the developer
sites stay unreachable, §2 says so plainly and §6 records that no tier-1/2 corroboration exists
for the structural figures.

---

## Edge cases

- Cookie-consent walls hide content behind a click → dismiss, then re-check `expect`.
- Lazy-loaded prices → wait for network idle, then poll for the selector; a fixed sleep is flaky.
- Currency symbol placement differs by locale: `€112.000` (de) vs `112,000 €` vs `$239,171`.
  German uses `.` as thousands separator. Parsing `112.000` as `112.0` is a 1000× error.
- `1+1` vs `1 + 1` vs `1+1 Wohnung` vs `One bedroom` — normalise to `UnitLayout`.
- Turkish `ı/İ` in slugs and district names. `"TÜRKLER".toLowerCase()` differs under a Turkish
  locale; use invariant casing for keys, Turkish collation only for display sort.
- A portal listing with a price but no size, or a size but no price → both fields independently
  nullable. Never infer one from the other.
- Same unit on three portals at three prices → all three in `competingPrices`, none discarded.
- A source that 200s today and 403s tomorrow → the pipeline must be re-runnable and produce a
  _diff_, not a silent regression. Keep prior manifests.
- Review text containing HTML or emoji → store as text, escape at render. Never
  `dangerouslySetInnerHTML` on scraped content.
- Rate limiting / soft ban mid-run → back off, record partial, exit non-zero. A partial harvest
  reported as complete is the worst outcome.

---

## Definition of done

```bash
pnpm harvest                        # manifest written, every source has a status
pnpm dataset                        # azura-world-data.ts + .sql + .csv emitted
pnpm qa:evidence                    # exits 0
pnpm --dir apps/web typecheck       # generated TS compiles
```

Then paste, in the handoff:

- The coverage table from `verify-evidence`
- Source status: how many of 23 recovered, which remain dead, with the transport label
- Finding count by severity
- Unit split: `portal_listing` vs `modelled`
- **Proof the validator rejects**: corrupt one fact deliberately, show `qa:evidence` failing,
  restore. A validator never seen to fail has not been tested.

---

## Handoff must state

- Which of F-001…F-010 the harvest **resolved**, and which remain open
- Whether developer sites 2/4 and hotel site 5 were recovered — if not, F-010 stands and every
  structural figure is tier-4-or-worse. Say so explicitly; W3-A and W3-C must surface it.
- Any new conflict found beyond `SOURCES.md` §3, numbered from F-011
- The exact `SourcedFact` paths W3-C and W3-G will render
