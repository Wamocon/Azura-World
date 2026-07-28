# W3-G — Hotel & review intelligence

**Wave:** 3 · **Depends on:** W0-B, W2-A, W2-B, W3-B · **Runs with:** all other W3-*

> Read `SYSTEM-PROMPT.md`, `SOURCES.md` §4, `HANDOFF/W0-B.md`, `HANDOFF/W3-B.md`,
> `HANDOFF/W1-D.md` (provenance components).

---

## Mission

**This module is acceptance criterion 4** — _"Bewertungen und Hotel-Buchungsquellen einbeziehen"_ —
and it fails if it turns into marketing.

Azura World Hotel scores 4.0/5 across 358 Tripadvisor reviews and ranks #10 of 33 hotels in
Türkler. The sentiment is genuinely polarised: review titles range from _"Everything is perfect"_
to _"A Five-Star Hotel in Name Only: Misleading, Unsafe, and Unprofessional."_ **Both must be
visible.** A competitor CATI that surfaces only the 4.0 average and a positive quote is not
intelligence — it is a brochure, and it will mislead whoever makes a decision from it.

There is also a branding finding to carry: the hotel was **rebranded from "Wyndham Alanya" to
"Azura World Hotel"** (F-007). The ticket's `wyndham.antalyacoast.com` source points at the
superseded brand.

---

## Files you own

```
apps/web/app/[locale]/hotel/**
apps/web/app/[locale]/dashboard/hotel/**
apps/web/app/[locale]/dashboard/reviews/**
apps/web/components/hotel/*
HANDOFF/W3-G.md
```

Messages: `hotel.*`, `dashboard.hotel.*`, `dashboard.reviews.*` only.

---

## Deliverables

### 1. Public hotel page — `/[locale]/hotel`

The operation as an asset of the complex. Every figure through `ProvenanceValue`:

| Fact           | Value                    | Confidence                                                     |
| -------------- | ------------------------ | -------------------------------------------------------------- |
| Name           | Azura World Hotel        | confirmed                                                      |
| Former name    | Wyndham Alanya           | confirmed — **shown, with the rebrand explained**              |
| Class          | 5★, All-Inclusive        | confirmed                                                      |
| Rooms          | 188 · 6 floors · 2 lifts | confirmed                                                      |
| Opened         | 2025                     | confirmed                                                      |
| Aquapark       | 13 slides                | single source                                                  |
| Beach          | 1 km + shuttle           | single source — **note it differs from the residence's 300 m** |
| Check-in / out | 14:00 / 12:00            | single source                                                  |

The beach-distance divergence (F-003) is not a contradiction — different reference points — and
the page should say so rather than leaving a reader to spot an apparent inconsistency.

### 2. Review intelligence — `/dashboard/reviews`

**Per platform** (Tripadvisor, Booking, Agoda, OnTheBeach): score, scale, review count, ranking,
last fetched, link to the live page and the local snapshot.

**Never average across platforms.** A 4.0/5 and an 8.2/10 are not commensurable and combining
them invents a number. Show each on its own scale, side by side.

**Sentiment**: positive / mixed / negative counts, plus the distribution where available. Where
the distribution was not recoverable, render `gap` — "Nicht belegt" — not a guess.

**Verbatim quotes only.** Store and render review text exactly as written, with rating, date and
permalink. Never paraphrase, never summarise a review into a claim. A paraphrased negative review
is an allegation you have authored.

**Balance is a hard requirement**: the quote list must show both extremes by default, not the
positive ones with negatives behind a filter. Build the default view to be balanced and let
filtering _narrow_ it, never widen it from a positive-only default.

### 3. Hotel operations — `/dashboard/hotel`

Room inventory (188), room types, occupancy view, and the hotel↔residence relationship (shared
amenities, shuttle, private beach access).

### 4. Booking sources

Each booking platform as a source: URL, price signal where available, board type, last fetch,
reachability status. Booking.com and Agoda were not fully recoverable in the shallow pass — if
W0-B's harvest did not recover them, **render them as unreachable with their snapshot status**,
not as missing.

---

## Edge cases

- **Different scales** — 5-point vs 10-point. Never normalise silently. If you offer a normalised
  view, label it as derived and keep the native score primary.
- **`gap` score** (Booking, Agoda) → "Nicht belegt" with the fetch status, never `0`, never blank.
- **Review text with HTML, emoji, or RTL fragments** → escape and render as text. Never
  `dangerouslySetInnerHTML` on scraped content — this is untrusted third-party input.
- **Very long review** → clamp with an expand affordance; never truncate mid-word without a marker.
- **Review in a language the viewer does not read** → show the original, label the language, do
  **not** machine-translate. A mistranslated complaint is a fabricated allegation.
- **Zero reviews on a platform** → "keine Bewertungen", distinct from "not fetched".
- **The rebrand**: any UI still saying "Wyndham" must be traceable to `formerName`, never to
  `name`. Search your own output for the string.
- **A quote naming a staff member** → the dataset should not carry identifiable staff names.
  Redact at ingestion if present; this is a real person, not a data point.
- **Ranking changes between fetches** → show the fetch date next to the ranking, always.
- **Aggregate mixing hotel and residence facts** — the 300 m and the 1 km must never end up in the
  same field. Keep `project.distanceToSeaM` and `hotel.distanceToBeachM` separate everywhere.

---

## Definition of done

```bash
pnpm --dir apps/web typecheck && pnpm --dir apps/web lint && pnpm --dir apps/web build
```

Plus, evidence pasted:

1. Public hotel page, four locales, all figures with provenance
2. **The rebrand rendered**: current name primary, former name explained, source cited
3. Review dashboard: each platform on its **own scale**, no cross-platform average anywhere —
   grep your own code to prove no averaging function exists
4. **Quote list default view showing both a positive and a negative quote**, screenshotted
5. Unreachable platform (Booking/Agoda if not recovered) → status shown, not blank
6. A review containing HTML → rendered as text, screenshot proving no injection
7. Beach distance: hotel 1 km and residence 300 m shown separately with the explanation
8. `gap` score renders "Nicht belegt"
9. Permission matrix: `reviews:view` enforced; `guest` gets the public page only

---

## Handoff must state

- Which platforms were actually recovered by W0-B and which remain `gap`
- The exact sentiment counts and how they were derived — if they are estimates, **say so**
- Confirmation that no cross-platform score averaging exists anywhere in the module
- Confirmation that the default quote view is balanced, and how you enforce it
