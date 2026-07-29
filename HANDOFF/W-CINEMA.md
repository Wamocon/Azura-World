# HANDOFF — W-CINEMA Landing experience

STATUS: **PARTIAL** — the media layer and the hero are done and verified; three of the five acts
are not built. Read §7 before planning on top of this.
Session: 2026-07-29 · Branch: `feature/INTERNAL-107-cinema2` · Worktree: `D:\azura-cinema2`
Base: `origin/main` @ `f9b6e98` · Commits: `ec92bba`, `3a613c3`, `3501fe9`

---

## 1. The headline numbers

| | before | after |
| --- | --- | --- |
| **JS on `/de`, gz, excluding the 3D chunk** | **493.1 KB** | **254.9 KB** |
| `<img>` on the rendered page | 0 | 1 |
| `<video>` | 0 | 0 (by design — §4) |
| console errors | 1 | 0 |
| `<h1>` text | doubled | single |
| document framing above the fold | 5 elements | 0 |

**The budget went down by 238 KB while photography went up from nothing.** That is the thing the
brief said was the hard part, and it is 4.9 KB over the 250 KB target rather than 243 KB over.

`scripts/landing-budget.mjs` is the instrument: it boots a production server, drives `/de` in
Chromium, and **gzips every JS body locally**, because Next's build table reports parsed size and
lumps shared chunks. Raw 1665.2 KB / gz 493.1 KB is the ~3.4× that reconciles my measurement with
the brief's 494 KB, which is how I know the instrument agrees with the one the brief was written
against.

### Where the 238 KB came from, which was not where I expected

I did not do bundle surgery. **`app/sections/hero.tsx` was importing `CoastMaquette` eagerly**, and
through it three.js, `@react-three/fiber` and `drei` — into the shared chunks, which is why the
first measurement reported "0 KB of it 3D" while the 3D was demonstrably in there. Moving the
maquette out of the hero frame, which I did for a *compositional* reason (§5), dropped the whole
graph off the initial route.

The lever the previous session identified — framer-motion behind a statically-imported
`azura-immersion.tsx` — is still there and untouched. It is the obvious next 100 KB.

---

## 2. Media: why the page had none, and what fixed it

The page rendered zero images while 889 assets sat encoded on disk. **The cause was never
rendering.** Every asset carried `usage: "internal_only"` and `delivery: "internal"`, which means
git-ignored `sources/media/` and explicitly not servable from a public page, and
`apps/web/public/media` was empty. The brief's own premise was already stale: it says four assets
are `attributed_display` and `public/media` holds one file. Neither was true — **zero** were
cleared and the directory was empty.

`scripts/publish-journey-media.mjs` (`pnpm media:journey`) closes it in one auditable pass:

1. **select** — a mechanical gate (rights, ≥1200px, no watermark, no UGC, every rung on disk, never
   `unrelated`, never a logo) plus a hand cast, §3
2. **copy** — AVIF + WebP at 800/1200/1600 into `public/media`. 132 files, 10.2 MB
3. **promote** — the 22 selected ids to `attributed_display` / `delivery: "public"` in
   `lib/media-manifest.ts`, with the reason written into each entry
4. **emit** — `lib/journey-media.ts`

**Step 4 is a budget decision.** `media-manifest.ts` is 25,204 lines. A page importing it to find
eight photographs pulls the entire harvest into the client graph. The emitted module carries 22
entries and the four fields a `<picture>` needs, and it regenerates rather than being hand-edited.

The encoder pipeline already existed — 8,649 derivatives at 400/800/1200/1600/2400 under
`sources/media/encoded`, 2.6 GB. **Nothing needed encoding.** The work was selection and rights.

---

## 3. Looking at it mattered twice, and both times it was a rights problem

### The videos: three of four cannot ship

The brief says four videos are genuinely Azura World and nine are other buildings. That is true, and
it is not sufficient.

| file | MB | verdict |
| --- | --- | --- |
| `87pi_nOUkQg` | 74 | **REJECT.** Batman, Superman and Captain America statues in the kids' area. Third-party character IP — a harder rights problem than the Cebeci question the brief anticipated |
| `lNvyyl0zTtg` | 29.2 | **REJECT.** Burnt-in Russian sales banners (*"ПЕРВЫЙ ПРАЙС ДО МАРТА"*), and the same statues in the render |
| `nGIk46Gxwds` | 12 | **REJECT.** A screen capture of Google Earth, with Google's imagery, pins and UI. Wrong rights holder entirely |
| `_95hZLr6HSo` | 17.6 | **KEEP.** Genuine cinematic footage. Carries a burnt-in Russian title card, which is honest on a page *about* how this development is marketed |

A rules-only pipeline ships all four onto a client demo. The poster frames yt-dlp saved beside each
mp4 made this one screenshot rather than an hour.

### The stills: a third of the first cast was miscast

Selecting on `subject` + width put building renders in "the approach", exterior aerials in "the
room", and the garish kids' area — with those same statues — as the opening frame of ACT II. The
manifest's `subject` describes what an asset *depicts*, not which act it belongs to.

`scripts/journey-contact-sheet.mjs` renders every candidate as one sheet
(`quality/cinema/contact-sheet.png`). The cast is now explicit in the publisher, on top of the
mechanical gate, with the two rejected ids **named** — because "not selected" and "rejected" are
different facts.

---

## 4. The film is referenced, never rehosted

My first version copied the 17 MB mp4 into `public/`. **The pre-commit hook rejected it** —
*"Evidence and media belong under git-ignored sources/"* — and it was right: `MediaVideoRef` in the
manifest already declares `rehosted: false`, *"Referenced, never rehosted — see MEDIA-LICENSE.md
§4"*. Two independent parts of the project stated the rule and my implementation broke it.

So only the **70 KB poster frame** is published; the film stays at its publisher. That is why
`<video>` is still 0, and it is a contract rather than an omission. `journey-media-guard.mjs`
asserts `src === null`.

---

## 5. The hero

A real photograph of the complex mirrored in its own pool at dusk — the strongest frame in the
harvest — 21:9, the **only** eagerly-loaded image on the route. Server-rendered `<picture>`, AVIF
then WebP, three srcset rungs, the manifest's own LQIP as the element background, real dimensions
holding the box against CLS. It ships **no JavaScript**: `<img>` went 0 → 1 and the bundle moved
493.1 → 493.4 KB before the maquette was removed, which is noise.

`next/image` is deliberately not used: the derivatives are pre-encoded at fixed rungs, so there is
nothing to optimise at request time, and a plain `<picture>` is smaller and more honest.

**The first composition was wrong, and looking at it is how I found out.** The photograph sat behind
content designed for a light page: the four soundings went dark-on-dark and the procedural maquette
read as a glitch on top of a real building. The frame is now its own band with nothing over it but
its credit, and the soundings returned to the page background where they are legible.

### Document framing, removed

Gone from the public page, and **verified absent from the served HTML rather than the source**: the
record line (`Objekt AZW-TRK`, `Lage`, `Datenstand`, `Blatt 1 von 1 · öffentlich`), the plate title
`Aufnahme · Türkler, Alanya`, its `Datenstand …` meta, and the per-figure `n Quellen` caption under
every sounding.

**The evidence itself is untouched.** The conflict badge on the 1+1 price renders exactly as before,
which was non-negotiable.

---

## 6. Verification actually run

| Command | Result |
| --- | --- |
| `pnpm --dir apps/web typecheck` | **PASS** exit 0 |
| `pnpm --dir apps/web lint` | **PASS** exit 0, 0 warnings |
| `pnpm --dir apps/web build` | **PASS** exit 0 |
| `node scripts/check-i18n.mjs` | **PASS** 0 errors |
| `pnpm gate:journey-media` | **PASS** — 11 pass · 0 fail |
| `node scripts/landing-budget.mjs` | **254.9 KB gz**, `<img>` 1, 0 console errors, 0 HTTP ≥400 |

Evidence in `quality/cinema/`: `contact-sheet.png`, `hero-1440.png`, `budget-*.json`.

**A process note.** I screenshotted a stale server twice and nearly reported the hero as unchanged
when it had in fact rendered. Both times the fix was to grep the *served HTML* rather than trust the
picture. `landing-budget.mjs` carries a PID-ownership guard for this; my ad-hoc screenshot script
did not, and should have.

---

## 7. What is NOT built — read this before planning

**Three of the five acts do not exist.** Built: the hero frame (the photographic half of ACT I).
Not built: ACT II COMPLEX, ACT III GROUNDS, ACT IV THE CUT, ACT V THE ROOM. Their assets are
selected, published, promoted and guarded — 22 images across all five acts are on disk and in
`journey-media.ts` — but **nothing renders acts II–V yet.** `components/journey/act-media.tsx` is
the primitive they will use.

Also not done, each named rather than implied:

- **`[GAP]` No scroll choreography.** No GSAP/Lenis/R3F wiring, no single timeline, no
  `frameloop="demand"`. I read the Codrops Trionn approach and the three reference components
  (`Hero.tsx`, `CinematicBand.tsx`, `TowerMaquette.tsx`) and took two decisions from them that are
  recorded here for whoever continues: **GSAP owns the rAF loop**, and **scroll position must never
  drive video playback** — parallax the container and let the film play on its own clock.
- **`[GAP]` The amenities section is still empty**, though its 35 images are now published and
  `imagesForAct("grounds")` returns six of them.
- **`[GAP]` The sticky header overlap at ~35 % scroll** is not fixed. Not investigated.
- **`[GAP]` Large vertical gaps** between sections, unchanged.
- **`[GAP]` `MEDIA-LICENSE.md` is not updated.** The promotion is recorded in each manifest entry's
  `usageReason` and in this handoff, but the brief asks for it in that file and it is not there.
- **`[GAP]` No reduced-motion, no-WebGL, 375px or four-locale verification.** The hero is static
  server-rendered markup, so the reduced-motion and no-JS contracts hold by construction — but
  *hold by construction* is an argument, not a measurement, and I did not measure it.
- **`[GAP]` `qa:layout` and `qa:perf` not run.** No LCP/CLS/INP numbers.
- **`[GAP]` 4.9 KB over budget.** 254.9 against 250.

### The honest answer to the brief's own test

> *Put your screenshot beside New Level Premium's homepage. If a stranger can tell which one is
> selling a EUR 125,000 apartment, you are not finished.*

**A stranger can still tell.** New Level Premium opens on a full-bleed aerial film under a metallic
wordmark; this opens on a light page with a photograph in a rounded frame. The frame is good and it
is a large improvement on a page that had no photography at all, but it is a *figure on a document*,
not a *first viewport that is the film*. Finishing means acts II–V and the dark, full-bleed
treatment the reference uses — and the 238 KB now freed is what pays for it.

---

## 8. Requests for other windows

| # | Owner | Request |
| --- | --- | --- |
| 1 | **W0-D** | The brief's media premise is stale: it says four assets are `attributed_display` and `public/media` holds one file. Zero were, and it was empty. Worth correcting wherever else that claim is written down. |
| 2 | **W0-D / legal** | Three of the four Azura videos are unusable (§3). The DC/Marvel statues appear in **stills** too, and two were caught only by eye. A `subject`-level flag for third-party IP inside an otherwise-legitimate asset would make this mechanical. |
| 3 | **W3-A** | `app/sections/hero.tsx` no longer imports `CoastMaquette`. The maquette belongs in the site section, where the camera has room to move — it is currently rendered nowhere on the landing route. |
| 4 | **W4-D** | Two new gates: `pnpm gate:journey-media` (11 assertions, no server) and `node scripts/landing-budget.mjs` (needs a production build). The second is the one that should fail the build when the route crosses 250 KB. |
