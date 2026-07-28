# W0-D — Media harvest & image pipeline

**Wave:** 0 · **Depends on:** nothing · **Blocks:** W3-A, W3-G, W3-I · **Runs with:** W0-A, W0-B, W0-C

> Read `SYSTEM-PROMPT.md`, `SOURCES.md`. Then read
> `D:\Ataberg\scripts\harvest.mjs` (byte validation), `scripts\images.mjs` (AVIF/WebP/JPEG
> encode + LQIP), and `raw\lqip.json`.

---

## Mission

Every image, floor plan, render, brochure and video the 23 sources expose — collected, validated,
optimised, and **attributed**.

W0-B harvests _facts_. You harvest _media_. Split deliberately: W0-B's job is narrow and the
acceptance criteria depend on it, and a slow image pipeline must not block the dataset.

Ataberg's lesson governs this task: its first pass checked HTTP status codes and kept the body
regardless, so **51 of 154 "downloaded" photos were 404 pages wearing a `.jpg` extension** and
5 were HEIC. _Validate the bytes, not the status line._

---

## Files you own

```
scripts/harvest-media.mjs · scripts/encode-images.mjs · scripts/media-manifest.mjs
sources/media/**            (raw originals — git-ignored)
apps/web/public/media/**    (encoded, committed)
apps/web/lib/media-manifest.ts · apps/web/lib/lqip.json
MEDIA-LICENSE.md
HANDOFF/W0-D.md
```

---

## Deliverables

### 1. `scripts/harvest-media.mjs`

Playwright-driven, sharing W0-B's politeness settings (`HARVEST_MIN_DELAY_MS`, ≤1 concurrent per
host, robots.txt respected).

Collect from all 23 sources:

- Project renders and photography
- **Floor plans and site plans** — the highest-value assets; portals often expose them as PDFs
- Hotel photography (rooms, pools, aquapark, restaurants)
- Logos and brand marks
- Video: promotional, drone, walkthrough. Record the URL and duration; **only download where
  terms permit**, otherwise store the reference and a poster frame
- Instagram `cebeci.group` build-progress posts and Facebook `azuraworldhotel` — public posts
  only, no login, no scraping behind auth

**Validation, per asset:**

- Decode with `sharp` (or `ffprobe` for video). If it does not decode, it is not an image —
  reject it, do not store it.
- Reject anything under 10KB or below 200px on the long edge (thumbnails, tracking pixels, icons)
- **Perceptual-hash dedupe** — the same render appears on six portals at six sizes. Keep the
  highest resolution, record every source that carried it.
- Record `sha256`, dimensions, format, bytes, and the page it came from

**Never silently skip.** Every failure goes in the manifest with a reason.

### 2. `scripts/encode-images.mjs`

Mirror Ataberg's `images.mjs`:

- AVIF (q50) · WebP (q75) · JPEG (q80) fallback
- Responsive widths: 400 / 800 / 1200 / 1600 / 2400
- **LQIP**: 20px blur placeholder as a base64 data URI in `lqip.json` — prevents CLS
- Strip EXIF (GPS in a competitor's photo is not ours to republish)
- Preserve aspect ratio; never upscale beyond the source

### 3. `apps/web/lib/media-manifest.ts`

Typed, generated, with the same provenance discipline as the dataset:

```ts
export interface MediaAsset {
  id: string;
  category:
    | "render"
    | "photo"
    | "floorplan"
    | "siteplan"
    | "logo"
    | "video"
    | "document";
  subject: "project" | "hotel" | "unit" | "amenity" | "location" | "developer";
  sources: SourceRef[]; // every page that carried it
  originalUrl: string;
  width: number;
  height: number;
  formats: { avif: string[]; webp: string[]; jpeg: string[] };
  lqip: string;
  sha256: string;
  caption: Record<Locale, string> | null;
  /** Rights posture — see MEDIA-LICENSE.md. Drives whether it may be displayed. */
  usage: "internal_only" | "attributed_display" | "unknown";
}
```

### 4. `MEDIA-LICENSE.md` — read this section carefully

**These images are not ours.** They are a competitor's marketing photography, collected for
internal competitive analysis under INTERNAL-107.

- Default `usage` is **`internal_only`**. An asset is only `attributed_display` when the source
  page's terms actually permit it, and the display carries visible attribution.
- **No asset is republished without attribution to its source URL.**
- Developer/agency renders, floor plans and logos are the most rights-sensitive. Treat them as
  `internal_only` unless you can point to a term that says otherwise.
- Record, per asset: source URL, date collected, the terms you found (or that you found none).
- Nothing here goes to a public deployment without a rights decision recorded in this file.

If in doubt, mark `unknown` and let it render internally only. The dashboard is authorised
internal use; the public landing page is publication, and that is a different question.

### 5. Video

Prefer **reference over rehost**: store URL, poster frame, duration, and source. Downloading and
rehosting a competitor's promotional video is the highest-risk action in this task. If a video is
needed for the landing page, use a poster frame plus a link out, and record why.

---

## Edge cases

- **Soft 404s** — the Ataberg lesson. Decode every byte.
- **HEIC / AVIF sources** that `sharp` may not decode without support — detect and report, don't
  silently drop.
- **CDN URLs with size parameters** (`?w=420&h=280`) — try to reach the original; fall back to
  the largest available and record which you got.
- **Lazy-loaded galleries** — scroll and wait for network idle; a naive DOM scrape gets 3 of 40.
- **`srcset`** → parse it and take the largest candidate, not the `src` default.
- **Background images in CSS** → parse computed styles; many hero renders are never in an `<img>`.
- **Hotlink protection** (403 without a `Referer`) → send the source page as referer; it is a
  normal browser behaviour, not a bypass.
- **The same render at 6 resolutions across 6 portals** → perceptual hash, keep the best, credit
  all six.
- **Watermarked images** → keep the watermark. Removing it is both a rights problem and a
  provenance problem.
- **EXIF GPS** → strip. Republishing a competitor's geotags is careless.
- **Enormous originals** (8000px architectural renders) → cap the stored original at 2400px on
  the long edge; note the true source dimensions.
- **Instagram/Facebook** → public posts only. No login, no session cookie, no auth-walled
  content. If it needs a login, it is out of scope.
- **Total size** → thousands of encoded variants bloat the repo. Commit only what a surface
  actually uses; keep the rest in git-ignored `sources/media/`.

---

## Definition of done

```bash
node scripts/harvest-media.mjs        # manifest written, every asset has a status
node scripts/encode-images.mjs        # AVIF/WebP/JPEG + LQIP emitted
node scripts/media-manifest.mjs       # typed manifest generated
pnpm --dir apps/web typecheck
```

Paste:

1. Asset counts by category and by source
2. **Validation table: attempted / decoded / rejected, with rejection reasons** — the Ataberg
   number to beat is "51 of 154 were 404 pages"
3. Dedupe result: unique assets vs total downloaded
4. Encoded output size, total and per format
5. `usage` split: `internal_only` / `attributed_display` / `unknown`
6. Any source that yielded **zero** media, and why
7. **Proof of validation**: feed the pipeline a known 404-page-as-`.jpg` and show it rejected

---

## Handoff must state

- The asset inventory W3-A, W3-G and W3-I can actually use
- **The rights posture per category** — which assets may appear on the public landing page and
  which are dashboard-only. W4-C will audit this.
- Which floor plans and site plans were recovered (highest value, hardest to get)
- Video: what was referenced vs downloaded, and the reasoning
- Total repo size added
