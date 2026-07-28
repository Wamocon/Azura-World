# HANDOFF — W3-G  Hotel & review intelligence

STATUS: PARTIAL
Completed: 2026-07-28
Window: E · Branch: `feature/INTERNAL-107-w3g-hotel` · Worktree: `D:\azura-w3g`

**PARTIAL, and deliberately so.** The public page is complete and verified. The two
dashboard surfaces are not started, because they need the module contract that
`HANDOFF/W3-B.md` will publish and that file does not exist yet. Detail in §7.

---

## 1. What was built

- **`apps/web/app/[locale]/hotel/page.tsx`** — the public hotel and review page, four
  locales, every figure through `ProvenanceValue`.
- **`apps/web/components/hotel/`** — 7 modules: `select.ts` (pure derivation),
  `split-verdict.tsx`, `platform-score-card.tsx`, `sentiment-distribution.tsx`,
  `review-quote-card.tsx`, `hotel-facts.tsx`, `hotel-evidence-notes.tsx`,
  `provenance-labels.ts`.
- **`hotel.*` messages** in all four catalogues. No other namespace touched.
- **`quality/w3g/*.png`** — three screenshots (see §9 for the ownership note).

**No table anywhere in this module.** The brief's dashboard surfaces are where tables
belong, and those wait on W3-B.

---

## 2. Verification actually run

| Command | Result | Evidence |
|---|---|---|
| `pnpm --dir apps/web typecheck` | **PASS** | exit 0 |
| `pnpm --dir apps/web lint` | **PASS** | exit 0 |
| `pnpm --dir apps/web build` | **PASS** | exit 0 · `├ ƒ /[locale]/hotel` — Dynamic, not prerendered |
| `pnpm qa:csp` | **PASS** | exit 0 · **21 pass · 0 fail** |
| `node scripts/check-i18n.mjs` | **PASS** | exit 0 · 0 errors, 6 warnings (§9) |
| `next start` + curl, 4 locales | **PASS** | de/en/tr/ru all **200** |
| Chromium, 5 variants | **PASS** | **0 CSP violations** on every one |

### Acceptance evidence, against the brief's own list

| # | Required | Result |
|---|---|---|
| 1 | Public page, four locales, all figures with provenance | de/en/tr/ru → 200. Every figure renders through `ProvenanceValue`; no bare numeric literal in the module |
| 2 | Rebrand rendered: current primary, former explained, source cited | `<h1>` is "Azura World Hotel". "Wyndham Alanya" appears **only** under a "Früherer Name" label, in the rebrand body, and as the publisher name `Wyndham Alanya (antalyacoast)`. Sources cited as chips (OnTheBeach, Tripadvisor, both dated) + "BEFUND F-007" |
| 3 | Each platform on its own scale, **no cross-platform average — grep proof** | §4 |
| 4 | Default view showing both a positive and a negative quote, screenshotted | `quality/w3g/01-verdict-desktop.png`. Live DOM: `verdictCards: 2`, `tones: ["negative","positive"]`, `widths: [536,536]` desktop / `[280,280]` at 320px |
| 5 | Unreachable platform → status shown, not blank | Agoda `Weitergeleitet`; three Booking.com URLs `Kein Inhalt geliefert`, each with its URL and attempt date |
| 6 | A review containing HTML → rendered as text, no injection | §5 |
| 7 | Beach distance: hotel 1 km and residence 300 m shown separately with explanation | "Anlage → Meer" **200 m – 500 m** (conflicted, 5 sources) vs "Hotel → öffentlicher Strand" **1.000 m**, with the explanation and "BEFUND F-003" |
| 8 | `gap` renders "Nicht belegt" | 2 gap facts (ranking on OnTheBeach and on the Booking capture) render the em dash + "Nicht belegt" |
| 9 | Permission matrix: `reviews:view` enforced; `guest` gets the public page only | **NOT DONE** — see §7. This page is public by design and enforces nothing; the gated surface is `/dashboard/reviews`, which is not built |

---

## 3. **The score in the brief does not match the harvest. Read this first.**

`tasks/W3-G`, `SOURCES.md` §4 and the instruction I was given all state
**4.0 / 5 across 358 Tripadvisor reviews**.

The dataset says something else:

| Capture | Score | Reviews | Ranking |
|---|---|---|---|
| `tripadvisor.com` (direct, first-party) | **4.6 / 5** | **359** | `#10 of 33 hotels in Turkler` |
| `onthebeach.co.uk` (Tripadvisor widget, same location id 33144231) | 4.6 / 5 | 357 | — (`gap`) |
| `wyndham.antalyacoast.com` (Booking.com badge) | 6.7 / 10 | 10 | — (`gap`) |

**The page renders 4.6, because that is the figure carrying a source and a snapshot
hash.** 4.0 appears in no fetched source in the dataset. Rendering 4.0 would have meant
publishing a number with no citation on the page whose entire premise is that every
number has one.

I did not "correct" `SOURCES.md` — it is not my file, and the shallow-pass note there may
record a genuinely earlier observation. **Somebody needs to decide which is right.** The
ranking string `#10 of 33` matches exactly, which suggests both describe the same
listing at different times rather than different properties.

Note the ranking is rendered verbatim as `#10 of 33 hotels in Turkler` — ASCII
"Turkler", as Tripadvisor publishes it, not "Türkler".

---

## 4. No cross-platform average exists. Here is the proof.

`grep -rnE "\.reduce\(|/ *(length|count)|average|mean|median|normalis|normaliz"` over
`components/hotel` and `app/[locale]/hotel` returns **18 lines**. Every one is a comment,
an identifier, or a message key, except two:

```
select.ts:290  const graded = counts.reduce((sum, entry) => sum + entry.count, 0)
select.ts:365  return reviews.reduce((sum, review) => sum + review.notableQuotes.length, 0)
```

The first sums the five sentiment **bucket counts of one platform** to get that
platform's graded total — the denominator for proportions *within* that platform. The
second counts **quote rows**. Neither touches a score, and neither spans two platforms.

The rule is structural rather than remembered. `PlatformGroup` carries `score` and
`scale` in one object, so there is no shape in which a bare score reaches JSX and
nothing for an averaging expression to reach for. `groupByProducer()` returns one entry
per producing platform and selects a primary capture by sort — first-party first, then
most reviews — which points at a real published number rather than computing a new one.

The page also says this in prose, because a reader looking at two scores side by side
will try to combine them unless told why they cannot be.

### F-016 is honoured, and it is the reason grouping is by producer

OnTheBeach publishes no score of its own; its 4.6/5 is a Tripadvisor widget on the same
location id. Filed under its serving host it would have looked like a second independent
host agreeing — which under CONTRACTS §1 invariant 3 is exactly what promotes a fact to
`confirmed`. One opinion would have been laundered into corroboration.

It renders inside the Tripadvisor card, under: *"Dieselbe Wertung wird von weiteren
Seiten ausgeliefert. Das ist keine zweite, unabhängige Bewertung — es ist dieselbe Zahl
mit einem anderen Logo davor."* Visible, and visibly not a second score.

---

## 5. The default quote view is balanced, and this is how it is enforced

`SplitVerdict` receives the **full** quote list and derives both ends itself:

```ts
const byRating = [...rated].sort((a, b) => a.rating - b.rating || a.url.localeCompare(b.url))
const worst = byRating[0]
const best  = byRating[byRating.length - 1]
```

There is no input ordering, no filter state and no prop that yields two positive quotes.
A sort order or a filter default would each be a one-line regression that no test would
catch, because the page would still render quotes. Removing the criticism here means
deleting a column from `split-verdict.tsx`, which is visible in a diff.

Reading order is worst → best, and the grid gives both columns equal width. In a
left-to-right locale the criticism comes first. Measured in the live DOM: `[536, 536]`
at 1280px, `[280, 280]` at 320px.

The recovered ratings are `4,5,3,4,3,4,3,1,4,4` — so the extremes are a **1/5** and a
**5/5**, and both are in the server-rendered HTML with no JavaScript required.

### Untrusted input

Review text renders as a text child of a `<blockquote>`, which React escapes. **There is
no `dangerouslySetInnerHTML` anywhere in the module** (grep: one match, in a comment
saying so). One quote contains a bare `&`; it is served as `&amp;`, which proves the
text goes through the escaping path. `white-space: pre-line` preserves the author's
paragraph breaks and nothing else of their markup survives. Long quotes clamp with an
expand control and never truncate mid-word without a marker.

**Nothing is translated.** There is no translation path, not even opt-in, and every card
carries an always-visible "Originaltext, nicht übersetzt".

---

## 6. Platforms recovered, and sentiment

| Platform | Recovered? | Figures |
|---|---|---|
| **Tripadvisor** | yes, first-party, `contentValidated: true` | 4.6/5 · 359 reviews · `#10 of 33 hotels in Turkler` · full distribution |
| **OnTheBeach** | yes, but it is a Tripadvisor widget (F-016) | 4.6/5 · 357 · ranking `gap` |
| **Booking.com** | **badge only** — its own three URLs all `expect_missing` | 6.7/10 · 10 reviews, served from `wyndham.antalyacoast.com` · ranking `gap` |
| **Agoda** | **no** — `redirected`, `contentValidated: false` | — |
| **Google** | never attempted | not in the dataset at all |

Booking.com appears **twice** on the page — once as a recovered badge score, once in the
unrecovered list — and that looked like a contradiction, so the page now explains it in
the unrecovered intro. That was the one legibility defect I found by reading the rendered
page rather than the code.

### Sentiment counts — published, not estimated

Tripadvisor is the only platform publishing a distribution. The counts are **its own**,
harvested verbatim, not derived by me and not estimated:

```
excellent 269 · good 43 · average 19 · poor 8 · terrible 11     (graded total 350)
positive  312 · mixed 19 · negative 19                          (the three-way fold)
```

`SOURCES.md` §4 lists the rating distribution as `[GAP]`; **the deep harvest recovered
it**, so the page renders it. OnTheBeach and the Booking capture publish none and render
nothing rather than a zeroed bar — an empty bar reads as "nobody complained".

The negative tail is 19 of 350, about 5%. At 1280px that is a 49px sliver and at 320px
it is 17px: accurate and effectively invisible. Rather than exaggerate the segment or
leave the tail unreadable, the bar keeps **true proportion** with a `min-width` floor so
no non-zero bucket can vanish, and every exact count sits in an **always-visible** legend
beside it — not a tooltip. A reader who skims and takes away "4.6, basically everyone
loved it" has been misled by an accurate chart, and that is the failure this module
exists to prevent.

---

## 7. What is NOT built, and why

- **`/dashboard/reviews` and `/dashboard/hotel` — NOT STARTED.** `HANDOFF/W3-B.md` does
  not exist, and W3-B owns the module contract every dashboard table has to sit in. I was
  told not to build a table until it publishes, and the instruction was right: building
  against a guessed shell contract produces work that has to be thrown away.
  **Everything those two surfaces need is already in `components/hotel/select.ts`** —
  `groupByProducer`, `splitVerdict`, `orderQuotes`, `sentimentBreakdown`,
  `unrecoveredBookingSources` are all pure and shell-independent.
- **Acceptance item 9 (`reviews:view` enforcement) is therefore NOT DONE.** The public
  page is public by design — `guest` and `anon` see it, which is correct — but the gated
  surface it would be enforced on does not exist yet.
- **Room inventory / occupancy / hotel↔residence relationship** (brief §3) — dashboard
  surface, same blocker. `hotel_rooms` is empty in the dataset by design (no source
  publishes a room-type breakdown, only the 188 total), so that surface will need to
  render an explicit "no published breakdown" state rather than an empty table.

---

## 8. Two bugs, both invisible to typecheck, lint and build

Both surfaced only under `next start`. This is the concrete argument for W-INT §8's rule
that a production server run is a precondition for claiming a page works.

**1. Every locale returned HTTP 500 while all three gates were green.**
`formatFetchedAt` is exported from `components/evidence/source-chip.tsx`, which carries
`"use client"` for the component beside it. The function is pure — no React, no browser
API — but the module is a client module, so calling it from a Server Component throws:
*"Attempted to call formatFetchedAt() from the server but formatFetchedAt is on the
client."* Worked around with a local `formatFetchedDate` of identical behaviour; the
proper fix is a request in §9.

**2. `ProvenanceValue format="number"` rounds, and it silently improved the hotel's
score.** W1-D's `formatNumber()` defaults to `maximumFractionDigits: 0` — correct for
every consumer it was built for (room counts, unit counts, m²) and wrong for a review
score. Observed in the served HTML before the fix:

```
Tripadvisor  4.6  →  "5 / 5"
Booking.com  6.7  →  "7 / 10"
```

A 4.6 presented as a 5 is this hotel's score improved by 0.4 on the page whose whole
purpose is refusing to flatter it. Scores now format at published precision via
`scoreAsDisplayFact()`, which preserves the sources, confidence and competing values and
changes only the digits. Verified after: DE `4,6` / `6,7`, EN `4.6` / `6.7`, scales
intact.

**This defect is live for any other window rendering a fractional fact through
`format="number"`.** Request in §9.

---

## 9. Requests for other windows

| File | Owner | What is needed |
|---|---|---|
| `apps/web/components/evidence/format.ts` | **W1-D** | `formatNumber` defaults to 0 fraction digits and `format="number"` never overrides it, so **every fractional fact renders rounded**. 4.6 → "5". Needs either a `maximumFractionDigits` passthrough on `ProvenanceValue` or a `score` format. My `scoreAsDisplayFact()` is a local workaround and should be deleted once this lands. |
| `apps/web/components/evidence/source-chip.tsx` | **W1-D** | `formatFetchedAt` is pure but exported from a `"use client"` module, so no Server Component can call it — it throws at request time and passes every static gate. Move it to `components/evidence/format.ts` (already server-safe) and re-export; then my duplicate `formatFetchedDate` goes away. |
| `apps/web/lib/proper-nouns.json` | **W1-C** | Add `"Agoda"` and `"OnTheBeach"`. The file already lists Tripadvisor, Booking.com and Google — these two are simply the first use. Until then `check-i18n` reports **6 warnings** (it was 0 before this branch); the gate still passes. I did not edit it (SYSTEM-PROMPT §4.1). |
| `apps/web/messages/*.json` → `evidence.tier.*` | **W1-C** | `SourceChipLabels.tier` needs six tier names and `evidence.tier.*` does not exist, so they live under `hotel.provenance.tier.*`. Every surface rendering a `SourceChip` will need them; the second consumer will either duplicate my block or import from a hotel module. Better home is `evidence.tier.*`. |
| `SOURCES.md` §4 | **W0-B** | §3 above — the recorded 4.0/358 does not match the harvested 4.6/359. One of them needs to win, and the page currently follows the harvest because that is the figure with a snapshot. |
| `quality/w3g/*` | **W4-B** | Three screenshots committed into a `w3g/`-namespaced subdirectory of your tree, because the brief requires screenshotted evidence and I own no path for binaries. Move or delete them if that is unwelcome; nothing references them but this file. |

---

## 10. Known gaps

- `[GAP]` **Dashboard surfaces not built** — blocked on `HANDOFF/W3-B.md`. §7.
- `[GAP]` **No language label on quotes.** The brief asks for the review's language to be
  labelled. The dataset carries **no language field per quote**, and
  `lib/language-detection.ts` is a heuristic built for chat routing — labelling a real
  person's review with a guessed language is the same class of error as translating it.
  Every card says "not translated"; none claims which language it is in. Fixing this
  properly means W0-B capturing the language attribute at harvest.
- `[GAP]` **Review titles are not in the dataset.** The brief quotes *"A Five-Star Hotel
  in Name Only: Misleading, Unsafe, and Unprofessional"* as the negative extreme; the
  harvest recovered review **bodies** only. The rendered worst quote is the 1/5 body
  beginning *"Regrettably, a holiday in this hotel left an extremely unpleasant
  draught."* The extremes are real; the specific title is not available to render.
- **`[V]` STAFF NAMES ARE IN THE DATASET, IN THE MOST PROMINENT QUOTE ON THE PAGE.**
  The brief is explicit: *"A quote naming a staff member → the dataset should not carry
  identifiable staff names. Redact at ingestion if present; this is a real person, not a
  data point."* The 5/5 review — the one `SplitVerdict` renders as the positive extreme,
  above the fold of the review section — reads:

  > "…we had an sen child and **sanemsii** and **Tulane** and **Han** were sen trained
  > and built up her confidence and had her dancing in no time…"

  Those look like three garbled first names of real animation staff. They are currently
  rendered verbatim, in four locales, on a public page.

  I did **not** add a display-time filter, for two reasons. A regex over free review text
  would both miss real names and mangle innocent words, and — more importantly —
  redacting at display leaves the names in `azura-world-data.ts`, which is committed and
  in a public repository. Redaction has to happen at ingestion or it is theatre.

  **This is the one thing on this branch I would not ship as-is.** It belongs to W0-B
  (`scripts/build-azura-dataset.py`), and it is a decision about a real person rather
  than a formatting preference. Verbatim quoting and not naming employees are both
  correct rules; where they collide, someone senior should choose.
- `[GAP]` **`hotel.distanceToBeachM` renders as "1.000 m" while the prose says "1 km".**
  Both are correct and both are sourced; the `metres` format is what the dataset's unit
  implies. Slightly inelegant, not wrong.
- `[GAP]` **No LCP/INP/CLS measurement.** `qa:perf` does not exist (W4-B). The page ships
  no images and no WebGL, so it should be cheap, but "should" is not a measurement.
- `[I]` **The page has no imagery at all.** azura-ui-ux §7 permits Cebeci Group's
  photography "small, captioned, sourced, as evidence" and refuses it as decoration; the
  833 harvested assets are `usage: internal_only` and this repository is public. The
  visual weight is carried by type and structure instead. If W0-D promotes specific
  assets to `attributed_display`, a captioned evidence strip would fit under the facts
  section.
