# HANDOFF — W3-A Landing page (AISDALSLove funnel)

STATUS: COMPLETE
Completed: 2026-07-28
Branch: `feature/INTERNAL-107-w3a-landing` (from `main` @ `f5afde4`, own git worktree)

---

## 1. What was built

The public landing surface at `/[locale]`, four locales, as **a working chart rather than a
brochure**: an Admiralty-style hydrographic plate fused with audit working-paper notation.
Bounded plates with a neat line and a title block, bathymetric tints running shoal-to-deep,
contour hatching as texture, dot leaders binding label to value, tabular figures throughout.

That grammar was chosen because it is native to the subject — a coastal parcel whose distances to
the water are themselves disputed facts — and because it is a 200-year-old visual language for
exactly our problem: **a page covered in numbers, each of which is a measurement with a survey
date and a reliability.** The direction contract is at the top of
[`app/[locale]/page.tsx`](apps/web/app/[locale]/page.tsx) and is meant to be re-read before any
edit to this surface.

| File                                           |                                                                               |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| `app/[locale]/page.tsx`                        | direction contract, metadata + hreflang, JSON-LD, composition                 |
| `app/sections/hero.tsx`                        | Attention — the plate                                                         |
| `app/sections/chrome.tsx`                      | top bar, navbar, footer                                                       |
| `app/sections/body.tsx`                        | Interest (what it is) · Search (site) · Search (amenity gap) · Desire (hotel) |
| `app/sections/evidence-band.tsx`               | **Trust** — the section that makes this project what it is                    |
| `app/sections/close.tsx`                       | Action · Like/Loyalty · Share · Love                                          |
| `components/azura/chart.tsx`                   | `Plate`, `Sounding`, `ContourField`, `Leader`, `RecordLine`                   |
| `components/azura/section.tsx`                 | `Section`, `FactRow`, `Container` — one spacing rhythm                        |
| `components/azura/masterplan.tsx`              | seven blocks, DOM, deep-linkable                                              |
| `components/azura/landing-data.ts`             | the facts this surface renders, selected once                                 |
| `components/azura/labels.ts`, `share-link.tsx` | provenance label assembly, copy-link                                          |
| `app/robots.ts`, `app/sitemap.ts`              | four locales                                                                  |
| `messages/{de,en,tr,ru}.json`                  | `landing.*` only — 55 → **164 keys**, 691 total per locale                    |

### The one idea, in the first viewport

Three corroborated measurements and one disputed price, in the same type, at the same size, on
the same plate: **76.000 m²** (8 sources) · **7** blocks (4) · **656** units (5) · and
**125.000 €** carrying an always-visible amber conflict badge inside a dashed enclosure.
Measured at 1440×900: all four are above the fold. A visitor who leaves after one viewport should
be able to say a day later that the page showed them a number it trusted next to one it did not.

---

## 2. Verification actually run

All under `next build --webpack` + `next start`, **never `next dev`**. Exit codes captured
directly from the command, never through a pipe.

| Command                         | Result      | Evidence                                            |
| ------------------------------- | ----------- | --------------------------------------------------- |
| `pnpm --dir apps/web typecheck` | **PASS**    | `TYPECHECK_EXIT=0`, no output                       |
| `pnpm --dir apps/web lint`      | **PASS**    | `LINT_EXIT=0`, 0 errors 0 warnings                  |
| `pnpm --dir apps/web build`     | **PASS**    | `BUILD_EXIT=0`; `/[locale]` is `ƒ (Dynamic)`        |
| `node scripts/check-i18n.mjs`   | **PASS**    | `EXIT=0` — 691 keys × 4 locales, identical key sets |
| `pnpm qa:csp`                   | **PASS**    | `EXIT=0` — **30 pass · 0 fail**                     |
| `pnpm qa:layout`                | **NOT RUN** | `scripts/layout-audit.mjs` does not exist — W4-B    |
| `pnpm qa:perf`                  | **NOT RUN** | `scripts/perf.mjs` does not exist — W4-B            |
| Lighthouse                      | **NOT RUN** | no runner in this environment; see §6               |

### Measured in Chromium, `next start`

| Check                                                        | Result                                                                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `/de` script tags carrying the response nonce                | **62 / 62**                                                                                                |
| `/de` CSP violations                                         | **0**                                                                                                      |
| `/de` React hydrated                                         | **true**                                                                                                   |
| 320px, German — document `scrollWidth`                       | **320** (no horizontal overflow)                                                                           |
| 320px, Russian — document `scrollWidth`                      | **320**                                                                                                    |
| `prefers-reduced-motion` — elements left at `opacity: 0`     | **0**                                                                                                      |
| `prefers-reduced-motion` — canvases                          | **0** (complete static page)                                                                               |
| WebGL disabled — canvases / page renders                     | **0** / poster renders                                                                                     |
| Tap targets below 24px                                       | **0** real (the `sr-only` skip link measures 1×1 until focused)                                            |
| Deep link `?block=B03` in the **server** HTML                | `aria-pressed="true"` present                                                                              |
| `hreflang`                                                   | self-referencing canonical per locale + all four + `x-default` → `de`, verified in built HTML for all four |
| Bare numeric literal rendered outside a provenance component | **none**                                                                                                   |

Viewports captured: 1440 / 768 / 320 in `de`, 320 in `ru`, 1440 in `en`/`tr`, plus dark theme,
reduced motion and WebGL-disabled. One inspection round, one batch of fixes, one confirmation
round — the ceiling, then stop.

### JS budget — one number is over, and it is reported rather than adjusted

Measured on `/de` at 1440×900, `waitUntil: networkidle`, `encodedBodySize` (compressed body,
headers excluded):

|                                         | Measured        | Budget (CONVENTIONS §7) |                            |
| --------------------------------------- | --------------- | ----------------------- | -------------------------- |
| App + framework, 14 files               | **250.5 KB gz** | ≤ 250 KB                | **OVER by 0.5 KB (+0.2%)** |
| Lazy 3D chunk (three.js + R3F), 3 files | **228.1 KB gz** | ≤ 260 KB                | within                     |
| Total                                   | 478.6 KB gz     | —                       |                            |

Constituents of the app bundle, by fingerprint: React + Next runtime ≈ 81 KB · `@base-ui/react`
floating machinery ≈ 45 KB · GSAP + ScrollTrigger ≈ 46 KB · next-intl, lucide and application
code ≈ 78 KB. **None of the three largest is removable from this surface**: base-ui is what
`ConflictPopover` is built on and the conflict popover _is_ the product; GSAP is W1-D's `Reveal`;
React is React.

I did not amend CONVENTIONS §7 to fit this build. I set that budget line myself as W-INT
yesterday, and moving it today to accommodate my own page is precisely the failure the section's
closing paragraph warns about. **Decision for the owner:** accept +0.5 KB as within measurement
noise, or hand W4-B a 1 KB trim.

---

## 3. Which facts appear, and at what confidence

**27 facts** render on this page (26 from the dataset + the constructed entry-price fact). The
evidence band counts this exact array — `renderedFacts` in `landing-data.ts` — so the band cannot
drift from the page it describes.

| Confidence              | Count | Notable                                                                                                        |
| ----------------------- | ----- | -------------------------------------------------------------------------------------------------------------- |
| `confirmed`             | 11    | plot area, blocks, units, completion, hotel stars, former name                                                 |
| `single_source`         | 5     | buildings, down payment, hotel floors, opened, board, beach distance                                           |
| `conflicted`            | 10    | developer, green area, floors, build status, **all four distances**, hotel rooms, aquapark slides, entry price |
| `gap`                   | 1     | `hotel.brandAffiliation` — renders "—" and "Nicht belegt", never `0`, never blank                              |
| `official` / `inferred` | 0     | none occur in this set                                                                                         |

The four distances are the most-disputed facts in the dataset and they sit deliberately next to
the masterplan: "300 m from the sea" is the claim this category of marketing stretches most, and
here it argues with itself in public.

### Evidence band, as built

|                               |                                                           |
| ----------------------------- | --------------------------------------------------------- |
| Sources fetched               | **60**                                                    |
| Content-validated             | **45** (so 15 failed, stated as plainly as the successes) |
| Publishers cited on this page | **18**                                                    |
| Figures on this page          | **27**                                                    |
| Recorded findings             | **24**                                                    |
| Units                         | **25 real listings · 631 modelled · 656 total**           |

**F-002 is on the front page, in full.** Four publishers, four prices, each in its own currency:
Haspo Realty **112.000 €** (80 m², stale) · Seaside Alanya **210.000 €** (85 m²) · Alanya-Home
**220.000 €** (85 m²) · Housearch **239.171 $** (75 m²). Across all six publishers the span is
112.000 € to 400.000 € over 19 published figures.

Nothing is converted, averaged or resolved. The hero's displayed value is **the only figure a
publisher itself labels as a "from" price** (Alanya-Home's `isEntryPrice` row) — picking the
cheapest or the median instead would have invented a primacy the sources do not state. The
selection rule is stated in the note under the figure. `conflictRange()` correctly returns `null`
because the set spans EUR and USD, so the sounding shows one sourced value plus the badge rather
than a range that would imply a conversion.

**The amenity section renders the gap.** `dataset.amenities` is empty and the generator emits
`AzuraAmenity = never` to record that nothing reaches it. A plausible grid of pools and a fitness
suite would have taken five minutes and would have been the exact failure this product exists to
make visible. The absence is a designed empty state and it is counted in the band.

---

## 4. Contracts I consumed

`SourcedFact<T>`, `SourceRef`, `SourceTier`, `Confidence`, `Money`, `Locale`/`locales`. All
fitted. `CONTRACTS.md` and `lib/contracts.ts` untouched.

The generated `Azura*` types crossed into `SourcedFact<T>` **without a cast** — the direct payoff
of the W-INT generator fix. Before it, every one of these call sites would have needed an
`isSourcedFact()` guard.

Components consumed as built, none modified: `ProvenanceValue`, `DataQualityMark`,
`ConfidenceBadge`, `ConflictPopover`, `SourceChip`, `SourceChipList`, `formatMoney`, `Reveal`,
`ScrambleText`, `CoastMaquette`, `CoastPoster`, `LocaleSwitcher`.

---

## 5. Decisions I made

| Decision                                                                     | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Chart plate, not a photographic hero**                                     | The rut for this category is a full-bleed render behind thin serif; its predictable opposite is a bare data table. The chart is neither, it is native to a coastal parcel, and it gives uncertainty a visual grammar that predates the web. Also: LANDING-CRAFT §2 rules out full-bleed use of Cebeci's photography, so a photographic hero was never available.                                                                                                                                                                                                               |
| **Playfair Display + Manrope kept**                                          | `impeccable`'s craft floor lists Playfair among training-data default faces. The brief, `azura-ui-ux` §2 and `DESIGN.md` §5 all pin it, the Cyrillic subset is already verified and self-hosted at 137 KB, and impeccable's own first rule is that a pinned brief wins. No change.                                                                                                                                                                                                                                                                                             |
| **Metallic wordmark deliberately NOT used**                                  | `azura-ui-ux` §3 offers it; I declined. `color: transparent` defeats automated contrast checking, and `DESIGN.md` §4's measured-contrast table is one of this project's strongest artifacts — introducing an unmeasurable heading would undercut it. In a forensic register, polished-metal type is also the promotional tell we are avoiding. `ScrambleText` is kept as the one signature, once, on the wordmark.                                                                                                                                                             |
| **No 3D unit configurator**                                                  | `azura-ui-ux` §3 proposes one and the brief said "consider". Three reasons not to: W3-I already shipped `AzuraUnitExplorer`, so a second would duplicate another window's surface; we hold 13 floorplans for 656 units, and §3 itself says a photoreal render of a unit we have no plan for is a fabrication; and the 3D route is already the larger half of the JS budget. **DRACO/KTX2 consequently do not apply** — there is no imported geometry on this page, and adding the loaders would grow the bundle to solve a problem we do not have (LANDING-CRAFT §3.5 agrees). |
| **W3-I's `AzuraImmersionSection` not composed here**                         | It is a complete surface — maquette, site world, unit explorer, evidence flow, live simulation — with its own aurora/tilt visual world. Mounting it inside the chart grammar would have broken the page's identity, and the landing route's Search stage is a masterplan, not the whole ERP demo. It stays available for the dedicated immersion surface. The masterplan I built instead is DOM, deep-linkable, and carries the `MODELLED` mark on every block.                                                                                                                |
| **Masterplan deep link resolved server-side**                                | `?block=B03` arrives as a prop from `searchParams`, not read from `window` in an effect. A cited deep link therefore renders selected with JavaScript disabled, and there is no `setState`-in-effect cascade — which the React compiler rejects (it is the same rule that produced S-002).                                                                                                                                                                                                                                                                                     |
| **Section files grouped 7-not-13**                                           | The brief lists 13 section names; chrome (top bar/navbar/footer) and the close (action/after/share/love) share their imports and grammar, and 13 files of six lines each would be filing rather than structure. File layout inside my own scope is mine to decide (SYSTEM-PROMPT §6). Every named section exists as an exported component.                                                                                                                                                                                                                                     |
| **`landing.provenance.*` duplicates some `evidence.*` copy**                 | `ProvenanceLabels` needs `conflict.trigger`, `source.tier.*` and `more`, none of which `evidence.*` carries. A half-mapping across two namespaces would break the moment either moved, and I may only append to `landing.*`. Consolidation request in §7.                                                                                                                                                                                                                                                                                                                      |
| **Four price cells use `formatMoney` + `SourceChip`, not `ProvenanceValue`** | They are competing values, not facts — each is one publisher's figure, and wrapping each in a synthetic `single_source` fact would badge a contested price as reliably sourced. The conflict apparatus sits at the top of the section on the real fact; the table is its expansion, inlined on the front page rather than hidden behind the popover.                                                                                                                                                                                                                           |
| **JSON-LD is a `Dataset`, not a `Residence`/`Offer`**                        | Marking this page up as a property listing would tell a crawler we are selling apartments in Türkler. That is false, and it is the impersonation the media-rights line forbids.                                                                                                                                                                                                                                                                                                                                                                                                |
| **The record line is not an eyebrow**                                        | `impeccable`'s craft floor bans kickers outright. `RecordLine` is a dateline — identifier, place, data date, sheet — in the order a filed document carries them. It answers "which record is this and how old", which the heading cannot, and it sits above the plate rather than as a caption on the `<h1>`.                                                                                                                                                                                                                                                                  |

---

## 6. Requests for other windows

- **W0-A — `app/not-found.tsx` and `app/global-error.tsx`, 2 lines each.** I edited files I do not
  own, and I am flagging it rather than burying it. `/de` became a real page route in wave 3, so
  `@next/next/no-html-link-for-pages` started firing on their deliberate plain `<a href="/de">`.
  Both files document _why_ the plain anchor is right — a full navigation is the correct recovery
  when the router may be the thing that failed — so I added a
  `// eslint-disable-next-line` carrying that reason rather than replacing the anchor with
  `<Link>`, which would soft-navigate through the same broken router. Please confirm or replace.
- **W-INT / W4-D — `scripts/csp-probe.mjs`.** `PROBE_PAGES` now leads with `/de`, the landing
  surface, which is the page the gate actually exists to protect. Its own comment asked for this
  once the route existed. 30 assertions, still green.
- **W1-C — `landing.provenance.*` vs `evidence.*`.** Two copies of the confidence and source
  vocabulary now exist. Mine is scoped to this surface because I may only append to `landing.*`;
  the right end state is one shared namespace that carries the full `ProvenanceLabels` shape.
- **W1-C — `<html lang>` is still hard-coded to `de`** for all four locales (your own open
  request). It is now visible on a real public page in four languages, which raises its priority.
  I did not fix it: `app/layout.tsx` is W0-A's and the fix belongs with your request, not mine.
- **W4-B — the 0.5 KB overage** in §2, and `qa:layout` / `qa:perf`, which this surface is the
  first real customer for.
- **Whoever owns `MEDIA-LICENSE.md`.** No harvested asset is used on this page. The visual
  identity is entirely ours, Cebeci Group's marks stay out of our header, and their name appears
  only as the attributed subject of the analysis. Nothing was promoted to `attributed_display`.

---

## 7. Known gaps

- `[GAP]` **LCP / CLS / INP NOT MEASURED.** No throttled run, no Lighthouse. `qa:perf` does not
  exist (W4-B). What _is_ measured is the JS payload (§2) and that the `<h1>` is server-rendered
  text in the initial HTML — so the LCP element does not wait on the 3D — but the numbers
  themselves are not established and I will not infer them.
- `[GAP]` **Print stylesheet not tested.** The brief lists "readable A4, no clipped sections" as
  an edge case. Not verified; no print rules were added.
- `[GAP]` **Turkish and Russian copy is mine, not native-reviewed.** All four locales carry real
  copy — there are **no English fallback strings** and `check-i18n` reports 0 English stubs — but
  `tr` and `ru` were written by me and have not been read by a native speaker. German and English
  I am confident in. Three German labels were shortened to clear the gate's 1.5× length rule
  (`sourcesReachable`, and `conflicted`/`trigger` → "Widerspruch", which matches the existing
  `evidence.confidenceShort.conflicted`).
- `[GAP]` **Screen-reader pass not run.** Semantics are correct by construction — one `<h1>`,
  `<section>` landmarks with ids, a real `<table>` with `<caption>` and `<th scope>`, `<dl>` for
  term/description pairs, `aria-live` on the masterplan selection, skip link first in tab order —
  but nothing was driven with NVDA or VoiceOver.
- `[GAP]` **Contrast not re-measured for this surface.** Every colour comes from `DESIGN.md` §3's
  tokens, which W1-D measured with 0 gated failures, and no component here hardcodes a colour.
  The one new composite is `--confidence-conflicted` text over `--surface-conflict` inside the
  hero sounding, which W1-D measured at 5.81 light / 8.91 dark. Not independently re-measured.
- `[I]` (inference) 17 elements sit at `opacity: 0` below the fold on the animated path — that is
  `Reveal` awaiting its ScrollTrigger, and it resolves on scroll. The reduced-motion path measures
  **0**, which is the contract that matters. I did not verify every one of the 17 becomes visible
  on a real scroll-through; the count matching the number of `Reveal` instances is the basis.
- The `AfterSection` originally shipped as a heading with no content. It now carries three named
  capabilities the system actually has. Flagging it because it is the kind of section that decays
  back into a heading and a mood.

---

## 8. Is this surface ready for the rest of wave 3?

**Yes, with one open decision** — the 0.5 KB JS overage in §2, which is the owner's to accept or
hand to W4-B. Nothing else is blocking, and no other wave-3 window depends on this file.

For any window building a surface after this one, three things carry over:

1. **Do not set a rendering mode.** No `force-static`, no `revalidate`. The root layout's
   `headers()` read is what keeps S-009 fixed; `pnpm qa:csp` fails the build if you break it.
2. **`components/azura/chart.tsx` and `section.tsx` are the page grammar.** `Plate`, `Sounding`,
   `FactRow`, `Section`, `Container`. Reuse them before inventing a second one — one spacing
   rhythm across the product is most of what makes it read as one product.
3. **`landing-data.ts` is the pattern for fact selection**: pick the facts once, in one module,
   and let the evidence band count that same array. A band that counts something other than what
   the page renders is a band that will eventually lie.
