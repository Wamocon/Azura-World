# W3-A — Landing page (AISDALSLove funnel)

**Wave:** 3 · **Depends on:** W0-B, W1-C, W1-D, W2-A · **Runs with:** all other W3-*

> Read `SYSTEM-PROMPT.md`, `CONVENTIONS.md`, `DESIGN.md` (from W1-D). Then read
> `D:\Real Estate CRM\Cati\apps\web\app\[locale]\new-level-premium\page.tsx` for the funnel
> ordering and `components\new-level-premium\*` for section construction.
> `D:\Real Estate CRM\New Level Premium\components\sections\` for the motion-rich variant.
>
> Load the `apple-design` and `emil-design-eng` skills before building interactions.

---

## Mission

The public face. It must be visually excellent **and** rigorously honest — every figure on it
carries provenance, and the conflicts are shown, not hidden. That combination is the whole
argument for this deliverable: a competitor page that looks like marketing but audits like
research.

Section order follows the **AISDALSLove** funnel, as 1Çatı's showcase does:
Attention → Interest → Search → Desire → Action → Like/Loyalty → Share → Love.

---

## Files you own

```
apps/web/app/[locale]/page.tsx
apps/web/app/sections/*        (top-bar, navbar, hero, why, immersion, amenities,
                                desire, evidence-band, action, after, share, love, footer, cta)
apps/web/components/azura/*
HANDOFF/W3-A.md
```

Messages: append to `landing.*` only. Do not touch other namespaces.

---

## Sections

| # | Section | Funnel stage | Content |
|---|---|---|---|
| 1 | `hero` | Attention | Name, one-line position, 3D coast maquette (W1-D), the three headline figures — **76.000 m² · 7 Blöcke · 656 Wohnungen** — each rendered through `ProvenanceValue` |
| 2 | `why` | Interest | What Azura World is, factually. Developer, location, timeline. Sourced. |
| 3 | `immersion` | Search | Masterplan: 7 blocks, hotel, beach at 300 m, distances. Explorable. |
| 4 | `amenities` | Search | Amenity grid from the dataset, each attributed to the source that lists it |
| 5 | `desire` | Desire | Differentiation: 5★ all-inclusive hotel on site, 188 rooms, 13-slide aquapark |
| 6 | `evidence-band` | **Trust** | **The section that makes this project what it is.** See below. |
| 7 | `action` | Action | Enquiry / access request |
| 8 | `after` | Like/Loyalty | What the CATI gives an operator |
| 9 | `share` | Share | Share + public report entry |
| 10 | `love` | Love | Emotional close |
| 11 | `footer` | — | Contact, legal, full source list |

### The evidence band — section 6

A public, honest summary of the data behind the page:

- How many sources were consulted (23), how many were **reachable** (report the real number)
- Facts by confidence: confirmed / single-source / conflicted / not established
- **The headline conflict, stated plainly:** 1+1 apartments are quoted between €112.000 and
  239.171 USD across four portals — a factor of 2.1 — and the page says so on the front page,
  not in a footnote.
- A link into the full evidence cockpit for authorised users

This section is the differentiator. Any competitor page can list amenities; one that publishes
its own uncertainty is making a verifiable claim about its rigour.

---

## Deliverables

1. **Every number rendered via `ProvenanceValue`.** A bare number in JSX fails review. Grep your
   own output before you finish: a digit in a section file that is not inside a provenance
   component or a translated string is a bug.
2. **Four locales**, real copy, German primary. Fallbacks marked honestly (see W1-C).
3. **Motion**: GSAP + ScrollTrigger for choreography, Lenis for scroll, Framer Motion for
   component state. Durations from `lib/motion.ts` — never hardcoded.
4. **3D hero** lazy-loaded behind an intersection observer, poster fallback, never blocks LCP.
5. **Metadata + SEO**: per-locale title/description, OpenGraph, `hreflang` for all four locales,
   canonical, JSON-LD. **Get `hreflang` right** — Ataberg's audit found the reference competitor
   de-indexing its own English homepage with a canonical pointing at another domain, described
   as "likely the single highest-ROI fix in the entire project". Do not reproduce that bug.
6. **`robots.ts` + `sitemap.ts`** with all four locales.

---

## Edge cases

- **`prefers-reduced-motion`** → the page must be complete and static. Content revealed only by
  ScrollTrigger is invisible to those users. Verify nothing is missing with the flag on.
- **No WebGL** → poster image. Not a blank box, not an infinite spinner.
- **German at 320px** — the longest strings against the narrowest viewport. Test this explicitly.
- **A `gap` fact in the hero** → renders "—", never `0`, never blank, never omitted silently.
- **A conflicted headline figure** → shows the range and the amber badge in the hero itself.
- **Slow connection** → LCP ≤ 2.5s throttled. The hero text must render before the 3D.
- **JS disabled** → core content and contact details still readable. Prerender the essentials.
- **Deep link to `#amenities`** → scrolls correctly with Lenis, and does not fight the smooth scroll.
- **Back/forward navigation** → GSAP contexts cleaned up; scroll does not break on the second visit.
- **Print** → readable A4, no clipped sections.
- **Long amenity list** in Russian → grid does not overflow.

---

## Definition of done

```bash
pnpm --dir apps/web typecheck && pnpm --dir apps/web lint && pnpm --dir apps/web build
pnpm qa:layout          # 8 widths × 4 locales, zero overflow
pnpm qa:perf            # LCP ≤ 2.5s throttled mobile, CLS ≤ 0.1, JS ≤ 250KB gz
```

Plus, evidence pasted:
1. Screenshots: 4 locales × {320, 768, 1440} px
2. `prefers-reduced-motion` screenshot — nothing missing versus the animated version
3. WebGL-disabled screenshot — poster renders
4. Lighthouse: performance, a11y ≥ 95, SEO
5. `hreflang` block from the built HTML, all four locales, self-referencing canonical
6. **A grep proving no bare numeric literal renders outside a provenance component**

---

## Handoff must state

- Which facts appear on the landing page and their confidence levels
- The evidence-band figures as built (sources reachable, conflicts surfaced)
- Measured LCP / CLS / JS bytes
- Any copy that is an English fallback rather than a real translation
