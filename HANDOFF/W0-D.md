# HANDOFF — W0-D  Media harvest & image pipeline

STATUS: COMPLETE
Completed: 2026-07-27
Window: `tasks/W0-D-media-harvest.md`

> The two repo-wide gates fluctuate while W1-D, W2-A and W3-I are mid-write. `typecheck` was
> observed at **exit 0** with the final generated manifest in the tree, and at exit 1 twenty
> minutes later on newly-added files in `components/anim/` and `lib/inventory-repository.ts`.
> **No run at any point reported an error or warning in a W0-D file.** Full detail, with the
> owners, in "Verification actually run".

---

## What was built

- **`scripts/harvest-media.mjs`** — Playwright discovery (autoscroll, `srcset` largest-candidate,
  computed CSS backgrounds, JSON-LD, `og:image`, PDF anchors, plus **network-response sniffing**
  which is what actually catches lazy galleries) + byte-validated download, perceptual dedupe and
  a full attempt log. Shares W0-B's politeness settings by reading them, not by copying them.
- **`scripts/encode-images.mjs`** — AVIF q50 / WebP q75 / JPEG q80 at 400/800/1200/1600/2400,
  never upscaled, EXIF stripped, 20px blurred LQIP data URIs, and a **rights gate on the output
  directory** (see "Rights posture"). Incremental: content-addressed ids mean an existing variant
  is still valid, so a re-run reuses it instead of paying AVIF's ~50× CPU again.
- **`scripts/media-manifest.mjs`** — generates `apps/web/lib/media-manifest.ts`, typed against the
  frozen `SourceRef`/`Locale` contracts, with per-asset provenance and rights posture.
- **`sources/media/rights-policy.json`** — hand-authored, machine-readable rights decision per
  host, with verbatim terms quotes and their URLs. Read by the encoder and the manifest generator.
- **`MEDIA-LICENSE.md`** — the rights review: the decision, the evidence, and what would change it.
- **`sources/media/recon/*.json`** — the six recon passes (one subagent per source-host group),
  kept as the evidence behind every rights claim.
- `apps/web/lib/lqip.json`, `apps/web/public/media/.gitkeep`.

---

## Asset inventory W3-A, W3-G and W3-I can actually use

**833 unique assets** from **16 hosts** (17 of the 23 registered source entries — sources 2 and 3
share `cebecigroup.com`), after folding 261 duplicates. All 833 ids are distinct — the run asserts
this and prints the collision count rather than assuming it.

| Category | Count | Notes |
|---|---|---|
| `photo` | 514 | includes **45 flagged `constructionProgress`** — dated build-progress aerials |
| `render` | 201 | developer/architect visualisations |
| `document` | 70 | brochure pages, certificates, PDFs |
| `logo` | 15 | brand marks — the most rights-sensitive category |
| `video` | 13 | **poster frames only**; the clips are referenced, never rehosted |
| **`floorplan`** | **13** | see below |
| **`siteplan`** | **7** | see below |

By subject: `project` 368 · `hotel` 222 · `unit` 187 · `amenity` 35 · `location` 19 · `developer` 2.

Other flags carried per asset: `watermarked` 87 · `capped` (source larger than 2400px) 88 ·
`usedReferer` 46 · `tlsInvalid` 75 · cross-host duplicates credited on 75 assets · 95 assets
record the additional URLs that served byte-identical copies.

### Floor plans and site plans — the highest-value, hardest-to-get assets

**All 20 were opened and read, not inferred from filenames.** This matters: the pipeline's first
pass classified **231** assets as floor plans. Rendering them showed the truth (see "Decisions").

**13 floor plans**, every one carrying a readable area schedule:

| Source | Types |
|---|---|
| TERRA (7) | 1+1 · 2+1 XL · 3+1 XL · 4+1 Penthouse · 5+1 Penthouse XL · 2+1 Townhouse · 5+1 Private Villa |
| Seaside (6) | 1+1 (81 m²) · 2+1 XL (157 m²) · 3+1 XL (181 m²) · 5+1 XL Penthouse (392 m²) · 2+1 Townhouse (113 m²) · 5+1 Private Villa (348 m²) |

**7 site plans**, including three that are independently useful to the dataset:

- `terrarealestate.com` — **`GENERAL PLAN`**, a CAD site plan of the whole complex.
- `www.azuraworld.com` — **3D `vaziyet planı`** on the tier-1 official host, keying blocks
  A, B, C1, C2, C3, D, E, F1, F2, H, I.
- `alanya-home.com` — block-keyed masterplans (×4, one folded from a Seaside copy at higher
  resolution) and a satellite plan annotated **"AZURA WORLD 76.000m2"**, which visually
  corroborates the plot-area figure in `SOURCES.md` §2.
- `housearch.com` — "Bebauungsplan Azura World", 2400×1344.

`[V]` The keyed site plans label **C2 as the HOTEL block** — directly useful to W3-G.
`[I]` They give block *structure*; they do **not** give per-block unit counts, so `SOURCES.md`
§5.8's per-block `[GAP]` stays open.

### Video — referenced, never rehosted

**53 video references** (51 YouTube, 2 Vimeo), **0 downloaded**. Stored as URL + platform + id +
poster frame; poster frames come from the platform's own CDN and are validated like any image.

`[V]` The most authoritative is **`e6cs3yRRzAg` — "AZURA WORLD - CEBECİ GROUP A.Ş."** on the
developer's own channel `@CebeciGroupAlanya`. `[I]` Embedding a developer's own upload is the use
YouTube's player exists for and leaves the file on YouTube's servers — that is the recommended
route for W3-A/W3-I, and it is a different act from rehosting.
`[GAP]` **No duration is stated on any page for any of the 53 videos**, and none was played to
measure one. `ffprobe` is not installed on this machine.

---

## Rights posture per category — W4-C will audit this

**Not one of the 23 sources grants any reproduction right. `attributed_display` = 0.**

Consequence, stated plainly: **`apps/web/public/media/` is empty and must stay that way.** There
is no harvested competitor imagery that may appear on the public landing page. W3-A's hero and
section art must come from our own or properly licensed material.

| `usage` | Count | Delivery | Who may render it |
|---|---|---|---|
| `attributed_display` | **0** | `apps/web/public/media/` | anyone — the directory is empty |
| `internal_only` | **789** | `sources/media/encoded/` (git-ignored) | authenticated dashboard only, via a gated route |
| `unknown` | **44** | `sources/media/encoded/` (git-ignored) | same — treated exactly as `internal_only` |

`internal_only` where a source explicitly forbids reuse or reserves all rights;
`unknown` where a source publishes **no terms at all** — a measured absence, not a refusal
(azuraworld.com and cestate.net). Both render internally only, so keeping them apart costs
nothing; it is kept because it is true, and because those 44 are the cheapest assets to seek
permission for if anyone ever wants one on a public surface.

Three sources look permissive only if you do not read carefully, and each is the rights-analogue
of the Ataberg soft-404: **azuraworldhotel.com**'s Terms page is unfinished **Lorem ipsum**;
**seaside-alanya.com** returns HTTP 200 for `/de/terms`, `/de/privacy`, `/de/impressum` and
`/de/datenschutz` with byte-identical copies of its homepage; **hasporealty.com**'s is a
placeholder. Full evidence with verbatim quotes: `MEDIA-LICENSE.md` §7 and `rights-policy.json`.

---

## Verification actually run

| Command | Result | Evidence |
|---|---|---|
| `node scripts/harvest-media.mjs --selftest` | **PASS** exit 0 | 8 of 8 cases behaved as expected — table below |
| `node scripts/harvest-media.mjs` | **PASS** | 1146 attempted · 1094 decoded · 52 rejected · 833 unique · 0 id collisions |
| `node scripts/encode-images.mjs` | **PASS** | 828 encoded (**public 0** · internal 828) · 5 PDFs skipped as `not_raster` · 828 LQIP · 668.11 MB across 8,649 files |
| `node scripts/media-manifest.mjs` | **PASS** | 2,042 KB manifest · 163 KB `lqip.json` |
| `node scripts/media-manifest.mjs --check` | **PASS** exit 0 | committed manifest is current for the committed dataset |
| `pnpm --dir apps/web typecheck` | **PASS for W0-D**; repo-wide fluctuating | Observed exit 0 with the final manifest in-tree. Later exit 1 on W1-D/W2-A files. **0 errors in `media-manifest.ts` in every run.** |
| `pnpm --dir apps/web lint` | **FAIL — not W0-D** | 6 errors, all `react-hooks/set-state-in-effect` in W1-D / W3-I components. **0 problems in W0-D files.** |
| Unit assertions on the pure helpers | **PASS** exit 0 | 28 robots/srcset/sniff/hamming + 8 classifier + 8 rights-resolution + 6 canonical-key |
| Visual verification of all 20 plan assets | **PASS** | rendered to contact sheets and read individually |

### The repo-wide gates, precisely

These were run against a tree that three other windows were writing to throughout, so the results
are a moving target. Reporting the sequence rather than the most flattering frame:

1. Early run — `typecheck` exit 2, one error: `lib/repository-base.test.ts(30,8) TS5097` (W2-A).
2. After that window fixed it — **`typecheck` exit 0** with the final generated manifest in the
   tree. That is the run that clears `apps/web/lib/media-manifest.ts`.
3. Final check ~20 min later — `typecheck` exit 1 again, errors now in
   `components/anim/reveal.tsx` (TS2339 ×2, W1-D) and `lib/inventory-repository.ts`
   (TS2724 + TS7006 ×10, W2-A, mid-write).

`lint` → exit 1 throughout: 6 × `react-hooks/set-state-in-effect` in `components/anim/reveal.tsx`,
`components/three/coast-maquette.tsx`, `app/[locale]/kitchen-sink/theme-toggle.tsx` (W1-D) and
`components/immersion/primitives.tsx` (W3-I).

**In every run of both gates, grepping the output for `media-manifest` or `lqip` returns nothing.**
Before W0-A's scaffold existed the manifest was additionally typechecked in an out-of-tree harness
against a verbatim transcription of `SourceRef`/`Locale`; when `contracts.ts` landed it matched the
transcription exactly. Exit codes were captured explicitly, never read through a pipe.

### Proof of validation — a 404 page wearing `.jpg` is rejected

`node scripts/harvest-media.mjs --selftest`, exit 0:

```
case                                             http    bytes  sniff    verdict
live 404 page requested as .jpg                  404       355  html     REJECT soft_404_or_bot_wall_html
soft 404: HTTP 200, HTML body, .jpg name, >10KB  200     20100  html     REJECT soft_404_or_bot_wall_html
bot wall served as .jpg                          200     15111  html     REJECT soft_404_or_bot_wall_html
HEIC (HEVC) — sharp cannot decode                200     10364  heic     REJECT heic_not_decodable(heic)
tracking pixel 1x1 (decodes, but below floors)   200        90  image    REJECT below_10240_bytes
thumbnail 160x120 (decodes, >10KB, under 200px)  200     57898  image    REJECT below_200px_long_edge(160x120)
truncated JPEG (valid magic, >10KB, corrupt)     200    216935  image    REJECT pixel_decode_failed: premature end of JPEG image
CONTROL: genuine 1200x800 JPEG                   200    723119  image    ACCEPT 1200x800
8 of 8 cases behaved as expected, 0 wrong
```

Case 1 is a live fetch against a real host, not a fixture. Cases 1–4 are Ataberg's two failure
modes exactly: 404 HTML wearing `.jpg`, and HEIC that `sharp` cannot decode.

### Validation table — attempted / decoded / rejected

| | Count |
|---|---|
| Attempted | **1146** |
| Decoded and accepted | **1094** |
| Rejected | **52** |
| Unique after dedupe | **833** (108 identical-byte + 153 perceptual = 261 folded) |

| Rejection reason | Count |
|---|---|
| `below_10240_bytes` | 39 |
| `robots_disallow` | 7 |
| `over_max_download_bytes` (>24MB ceiling) | 3 |
| `soft_404_or_bot_wall_html` | 2 |
| `http_404` | 1 |

**HEIC encountered in the live harvest: 0.** An earlier draft of the report claimed 3; that was a
bug in the report itself — HEIC and over-ceiling attempts share a `reportable` flag and were being
counted together. Fixed, and the number is 0. The three were `over_max_download_bytes`.

**Ataberg's number to beat was 51 of 154 (33%) soft-404s. Here: 2 of 1146 (0.17%).** Most of the
credit belongs to the recon pass, which byte-probed candidates before they reached the downloader;
the validator is the backstop, and the selftest proves the backstop works.

**53 assets carried EXIF GPS.** Every encoded output is written without metadata — verified by
re-reading an encoded AVIF/WebP/JPEG and confirming `exif` is absent.

### Dedupe — two stages, and why

261 folded into **833 unique**, in two passes:

- **108 exact duplicates** (identical `sha256`) folded unconditionally, across categories.
- **153 perceptual near-duplicates** folded within a category only, at Hamming distance ≤ 6 on a
  64-bit dHash, under **complete linkage** — every member must be within the threshold of every
  other member, not just of the group's first.

**75 assets are carried by more than one host** and credit every one in `sources[]` — the same
developer render republished across portals, kept at the highest resolution available. A further
95 record the additional URLs that served byte-identical copies.

### Sources that yielded zero media, and why

| # | Source | Measured reason |
|---|---|---|
| 4 | `alanyacebeci.com` | **Lame delegation** — REFUSED from four independent resolvers. Not a timeout; permanently unrecoverable without a DNS fix by the owner. |
| 11 | `realtygroup.com.tr` | SERVFAIL on system resolver + 1.1.1.1 + 8.8.8.8 + 9.9.9.9, apex and `www`, http and https |
| 22 | `alanyhome.com` | **NXDOMAIN** — not delegated in the `.com` zone. Deregistered, not down. |
| 13 | `tripadvisor.com` | robots: `ClaudeBot / Disallow: /` — not fetched (also 403 to a full browser) |
| 15 | `facebook.com` / `instagram.com` | robots `Disallow: /` for `*` and ClaudeBot; Instagram is login-walled. **Public posts only was the rule, so this is a clean `[GAP]`.** |
| 23 | `turizmguncel.com` | robots: `ClaudeBot / Disallow: /` — 2 assets deliberately not taken |

### Coverage bounds — disclosed, not silent

- **3204 `photo`/`render` candidates were capped** at 45 per host. `floorplan`, `siteplan`,
  `document`, `logo` and `video` were **never capped**. Without the cap, seaside-alanya.com alone
  would have been 4.6 hours of requests at its declared `Crawl-delay: 30`. Full list:
  `harvest-report.json → cappedNotHarvested`.
- **51 candidates dropped as out-of-project scope** — other Cebeci developments reachable from the
  same host. **380 dropped as site chrome** (favicons, flags, social icons, slippy-map tiles).
- `[GAP]` Housearch offers a **~50MB "Präsentation des Projekts" PDF** — by size and title the
  likeliest carrier of further plans anywhere in the register. It is **lead-gated behind a form
  demanding a phone number**. Not submitted: giving a competitor a phone number is a human's
  decision, not a harvester's. Recorded with `probe.status: 0`.

---

## Contracts I consumed

`SourceRef` and `Locale` from `CONTRACTS.md` §1 and §7, imported from `apps/web/lib/contracts.ts`.
Both fitted. Before W0-A's scaffold landed I typechecked against a verbatim transcription of them
in an out-of-tree harness; when `contracts.ts` appeared I diffed it against that transcription and
it matched exactly, then re-ran the check in-tree.

One deviation to note: `SourceRef.snapshotHash` is documented as "sha256 of the stored raw snapshot
under `sources/raw/`". For media the asset's own bytes **are** the snapshot, and they live under
`sources/media/raw/<host>/<sha16>.<ext>` (W0-B owns `sources/raw/`). The hash resolves to a real
file; only the directory differs. `verify-evidence.mjs` checks the dataset, not this manifest, so
nothing breaks — but W4-D should know before it generalises the rule.

`MediaAsset` is specified in the brief rather than `CONTRACTS.md`. I implemented every field as
written and added provenance/rights fields alongside them (`usageReason`, `delivery`,
`sourceDimensions`, `sourceCaption`, `watermarked`, `userGeneratedContent`, `fromStaleListing`,
`duplicateSourceHosts`, `constructionProgress`, `collectedAt`).

**`caption` is `null` on every asset**, deliberately. The brief types it `Record<Locale, string>`,
which would require four languages; we observed one. The observed text is in `sourceCaption` with
its detected locale. Inventing three translations to satisfy a type is exactly the failure
`SYSTEM-PROMPT.md` §2.3 forbids. **Request to W1-C below.**

---

## Decisions I made

**1. Plan classification is verified by eye, not by filename — and that changed the headline number.**
The first pass classified 231 assets as `floorplan`. I rendered them into contact sheets and looked:

- `/planlar/` on cebecigroup (Turkish for "plans") is that CMS's **construction-progress gallery** —
  drone aerials, two with burned-in "Date of Last Take" stamps. Reclassified `photo` +
  `constructionProgress`. Genuinely valuable as a build timeline for W3-I; not plans.
- `/obj/ornek_daire/` ("örnek daire" = **show flat**) is furnished interior photography of model
  apartments. Reclassified `photo`, subject `unit`.
- IVM tags marketing renders `alt="Off Plans"` — "off-plan" is a sales term for property sold
  before completion, not a drawing. Added as an explicit false friend.

Final: **13 floor plans, 7 site plans**, each one confirmed by looking at it. A plan-shaped word in
a path is not a plan, and for the deliverable the brief calls highest-value, a wrong one is worse
than a missing one.

**2. Ids are content-addressed and carry no category.** `azw-<host>-<sha256[0:12]>`. Classification
is a judgement that gets corrected; an id that churns when a label changes drags every encoded
filename and manifest reference with it. Categories are re-derived from current rules on every run,
so a correction costs no re-download.

**3. Stricter than W0-B on robots, deliberately.** W0-B evaluates only the `*` group, reasoning that
a browser user-agent carries no crawler product token. W0-D also honours groups naming `ClaudeBot`,
`anthropic-ai`, `claude-web`, `claude-searchbot`, and takes the most restrictive verdict.
Tripadvisor, Turizm Güncel and Facebook each publish `ClaudeBot / Disallow: /`. W0-D does a heavier
thing than W0-B — it downloads and keeps copies of images — so it accepts the stricter reading.
**Measured cost: 2 assets.** `SYSTEM-PROMPT.md` §0 permits stricter, never looser. W4-C should
review the divergence and decide whether W0-B should match.

**4. Politeness is shared by reading W0-B's numbers, not by copying them.** `harvest-media.mjs`
reads `scripts/sources.config.json` (W0-B's file) and takes the **stricter** of its values and the
`.env` defaults on every axis — W0-B sets `perHostDelayMs: 2500` where `.env.example` says 2000, so
W0-D ran at 2500ms. Plus a cross-process host lease under `.tmp/harvest-locks/` and a back-off that
yields a host while W0-B is still writing snapshots into `sources/raw/<host>/`. **No collision was
recorded during the final run** (`harvest-report.json → hostCollisionsWithW0B: []`). Declared
`Crawl-delay` is honoured for downloads too, not just navigation — seaside-alanya.com asks for 30s
and got it.

**5. `azuraworldhotel.com` is fetched over `http://`, not with TLS verification disabled.** The
origin sends a leaf certificate with no intermediate (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`,
chain length 1, ZeroSSL, expiring 2026-07-29) — a misconfiguration, not a hostile certificate. The
plain-http origin returns 200 cleanly. Nothing there is authenticated and no credential is sent.
74 assets carry `tlsInvalid: true` so the provenance stays visible. Verification was never silently
disabled.

**6. Video is referenced, not rehosted, and the flag to change that is off.**
`MEDIA_ALLOW_VIDEO_DOWNLOAD` defaults to `false`. Nothing in any source's terms supports rehosting
and several forbid it.

**7. A 24MB per-asset download ceiling.** The hotel's own site serves 7360×4912 originals up to
40MB (575MB across 229 assets) and we cap stored originals at 2400px anyway, so pulling 40MB buys
nothing but bandwidth on someone else's server. 3 assets exceeded it; all 3 are listed by URL and
real size in `harvest-report.json → oversizeFindings`, never silently skipped.

**8. Perceptual dedupe uses complete linkage and never merges across categories.** Single linkage
chained A~B~C into an A~C pair 9 apart under a threshold of 6, and that is how Seaside's site plan
was silently absorbed into an ENS Pride render. Now every member must be within the threshold of
every other, and a plan can never be folded into a photo. Seaside's site plan is now correctly
folded into the **same drawing at higher resolution** from alanya-home (distance 3), with both hosts
credited.

**9. Byte-identical assets fold unconditionally; only the perceptual pass respects category.**
Constraining the merge by category (decision 8) introduced its own defect: azuraworld.com serves
the *same bytes* as `/assets/en/1.jpg` (a brochure page → `document`) and `/assets/en/s/1.jpg` (its
thumbnail → `photo`), so 40 pairs survived as separate assets sharing one content-addressed id —
colliding in `lqip.json` and in `mediaById()`. Identical `sha256` is the same file whatever we
labelled it, so exact duplicates now fold first and across categories, keeping the most specific
label (`siteplan` > `floorplan` > `document` > `logo` > `video` > `render` > `photo`). The run
now asserts id uniqueness and prints the count; it is **0**. Caught because the encoder reported
**824 LQIP entries for 864 encoded assets** — a 40-row discrepancy worth chasing rather than
rounding off. After the fix: 828 encoded, 828 LQIP, 0 id collisions.

---

## Requests for other windows

| File | Owning task | What is needed | Why |
|---|---|---|---|
| `.gitignore` | W0-A | Add `!sources/media/rights-policy.json` and `!sources/media/recon/` (or `!sources/media/recon/*.json`) under the existing `sources/media/*` rule | `sources/media/*` currently ignores the **hand-authored rights decision record** and the **evidence behind every quote in `MEDIA-LICENSE.md`**. Both are small text files containing no competitor imagery. Without them a fresh clone has the rights conclusions but not the reasoning, and the encoder silently falls back to "everything internal_only" (fail-safe, but the decisions are lost). The bulk directories `raw/`, `originals/`, `encoded/` must stay ignored. |
| `apps/web/app/api/media/[id]/route.ts` (new) | W2-B | An authenticated route serving `sources/media/encoded/**`, gated on `hasPermission(role, "evidence:view")` | 869 of 869 assets are `internal_only`/`unknown` and therefore **not** in `public/`. Without a gated route the dashboard cannot render any harvested media. Signed short-TTL URLs would match `CONVENTIONS.md` §4. |
| `apps/web/messages/*` | W1-C | Translation keys for media captions, if captions are to be shown in four locales | `MediaAsset.caption` is `null` by design; `sourceCaption` holds the observed single-language text. Translation is an i18n decision, not a harvest one. |
| `SOURCES.md` | W0-B | Four corrections, each measured — details below | The register is wrong in ways that change what later waves attempt |
| `CONTRACTS.md` note | W4-D | `SourceRef.snapshotHash` for media resolves under `sources/media/raw/`, not `sources/raw/` | So a generalised evidence check does not report a false miss |

### `SOURCES.md` corrections for W0-B — all measured, none inferred

1. **#2 Cebeci Group was never broken; the URL is wrong.** `/en/project/azura-world-residence-hotel`
   500s because that route does not exist. The canonical page is
   **`https://www.cebecigroup.com/en/azura-world-residence-hotel`** → HTTP 200. Control:
   `/en/about-us` also 500s while `/en/about` works — this app answers unrouted paths with 500,
   not 404. **This recovers the tier-2 developer source that F-010 lists as unrecovered**, and it
   is the single richest media source in the project (218 assets).
2. **#12 IVM is wrong twice.** The ticket URL returns **200**, not 404 — this host soft-404s
   everything, so its status codes carry no information. The listing was re-slugged, not removed:
   **`https://ivm-turkey.com/en/azura-world-alanya-a-2767-1.html`** is live (48 assets).
3. **#22 `alanyhome.com` is NXDOMAIN**, not a DNS timeout — not delegated in the `.com` zone.
   Reclassify from "retry" to "permanently gone". Same for **#4 `alanyacebeci.com`** (lame
   delegation, REFUSED by all six delegated nameservers).
4. **#14 Wyndham is no longer 403** and now serves *current* Azura World content (38 assets) —
   further F-007 evidence, alongside OnTheBeach still naming every image file `Wyndham-Alanya.jpg`.

**Also not in the register:** a second TERRA listing,
`/property/2062-azura-world-villas-in-alanya-turkler-with-private-beach`, found via schema.org
`hasOfferCatalog`. It carries 3 of the 7 TERRA floor plans.

---

## Known gaps

- `[GAP]` **Video durations — all 53.** No page states one, none was played, and `ffprobe` is not
  installed here. Not guessed.
- `[GAP]` **Housearch's ~50MB project presentation PDF** — lead-gated behind a phone-number form.
  Likeliest remaining carrier of additional plans. Needs a human decision.
- `[GAP]` **Tripadvisor's user-generated-content terms clause.** The terms page returned 403 with an
  empty body to both a full browser profile and an independent fetcher, so the clause has
  deliberately **not** been paraphrased or reconstructed. Zero Tripadvisor assets were taken, so
  nothing is blocked today — but the clause must be obtained before any is. The structural position
  is independent of it: traveller photos belong to individual travellers, and a licence Tripadvisor
  holds from its members cannot be sub-granted to us.
- `[GAP]` **Instagram/Facebook build-progress posts.** Out of scope by the brief's own rule —
  public posts only, no login. Instagram's logged-out render returns zero images; Facebook
  disallows the whole origin in robots. A clean gap, not a failure.
- `[GAP]` **Per-block unit counts.** The keyed site plans give block *structure* (A–I, C2 = hotel)
  but not how many units are in each. `SOURCES.md` §5.8 stays open.
- **`unknown` vs `internal_only` is a real distinction, not a hedge.** `unknown` means a source
  publishes no terms at all. If permission is ever sought, those are the cheapest sources to ask.
- **Encoded output is git-ignored and regenerable, not committed.** A fresh clone has no media until
  `harvest-media.mjs` and `encode-images.mjs` are re-run. Deliberate: the repository is public and
  these are a competitor's assets.
- **Widths are the brief's full ladder (400–2400) for every asset.** Since nothing is publishable,
  the 1600/2400 tiers serve only the internal dashboard. If W3-* wants a smaller footprint, trim
  `WIDTHS` in `encode-images.mjs` and re-run — it is incremental, so only the new tiers cost CPU.
- **One politeness deviation, self-reported.** During recon, 4 probe requests reached
  `pl.kalinka-realty.ru` from a script that had already read that host's `Disallow: /`. The probe
  sequence was authored before the robots result was visible. No asset in the manifest comes from
  that host. The download pass now re-checks robots against **each asset's own origin**, so the
  same mistake cannot reach the manifest. Recorded in `MEDIA-LICENSE.md` §6.

---

## Files I wrote

```
scripts/harvest-media.mjs
scripts/encode-images.mjs
scripts/media-manifest.mjs
sources/media/**            (git-ignored: recon/, discovery/, raw/, originals/, encoded/,
                             assets.json, harvest-report.json, attempts.jsonl,
                             candidates.json, encoded.json, rights-policy.json)
apps/web/lib/media-manifest.ts
apps/web/lib/lqip.json
apps/web/public/media/.gitkeep
MEDIA-LICENSE.md
HANDOFF/W0-D.md
```

Nothing outside this list was modified. `git status --porcelain` shows other paths as changed —
those belong to W0-A, W0-B, W1-D and W2-A, which were running in parallel throughout.

---

# ADDENDUM — independent re-verification by the second executor

*Two Claude Code executors ran the window-3 chain (`W1-C → W0-D`) concurrently against the one
shared working tree, both on `feature/INTERNAL-107-w1c-w0d-i18n-media`. Everything above was
written by the first. This addendum is the second executor re-running the pipeline's gates
itself and reporting what they printed — appended, not merged, because the section above is the
other executor's work and stays as written.*

## Why this addendum exists at all

At 19:23 the entire W0-D deliverable existed **only in the working tree**. `git log` on the
branch showed `0b82deb` (the `--finalize` mode) and three W1-C commits — and nothing else. The
manifest, the LQIP table, the encoder changes and this handoff were all uncommitted. One
`git checkout` by any of the four windows sharing the tree would have taken the night with it.
Commit `83a696c` is that work committed: the manifest, the LQIP table, both script changes and
this handoff, and **no image bytes** — the encoded renditions stay git-ignored.

## Re-run, on the final tree, exit codes captured explicitly

| Command | Result | What it printed |
|---|---|---|
| `node scripts/harvest-media.mjs --selftest` | **PASS** exit 0 | `8 of 8 cases behaved as expected, 0 wrong`. Case 1 is a live fetch: `https://www.azuraworld.com/…-w0d-selftest.jpg` → 404, 355 bytes, sniffed `html`, `REJECT soft_404_or_bot_wall_html` |
| `node scripts/media-manifest.mjs` | **PASS** exit 0 | `25195 lines, 2042.4 KB` · usage `internal_only 789 · unknown 44 · attributed_display 0` · `video references: 53 (none rehosted)` · `assets with no encoded variants: 5` |
| `pnpm --dir apps/web typecheck` | **PASS** exit 0 | `tsc --noEmit` clean **with the 2 MB generated manifest in the tree** — the one real risk of a 25k-line generated file |
| `pnpm --dir apps/web lint` | **FAIL** exit 1 | Confirmed **not W0-D**. At my run: `components/anim/reveal.tsx:142` (`react-hooks/refs`) + `components/anim/counter.tsx:5` (unused var) — both W1-D |

## Numbers reproduced independently

Measured from `sources/media/harvest-report.json`, `assets.json` and the encoded directory,
not copied from the section above:

| Claim above | My measurement | Agrees |
|---|---|---|
| 1146 attempted · 1094 decoded · 52 rejected | `totals: {"attempted":1146,"decoded":1094,"rejected":52}` | yes |
| 833 unique | manifest `total 833` (789 + 44 + 0) | yes |
| 828 encoded, **public 0** | 833 − 5 no-encode = 828; `lqip.json` holds **828** entries | yes |
| 8,649 encoded files | `find` counts **2,883 avif + 2,883 webp + 2,883 jpg = 8,649** | yes |
| 668.11 MB encoded | 668 MB by file-size sum; **688 MB by `du`** (block overhead) — same bytes, different metric | yes |
| Rejections 39/7/3/2/1 | `{"below_10240_bytes":39,"robots_disallow(…)":7,"over_max_download_bytes(…)":3,"soft_404_or_bot_wall_html":2,"http_404":1}` | yes |
| 3204 photo/render capped per host | `cappedNotHarvested.count: 3204` | yes |

**Per format** — the ladder is doing its job: AVIF **140.1 MB** · WebP **225.4 MB** · JPEG
**302.6 MB** for the identical 2,883 renditions. AVIF is 38% under WebP and 54% under JPEG.

## The rights assertion, checked rather than trusted

This is the claim that matters most, so I resolved it from source rather than reading the
summary. Running `resolveUsage()` over **every** asset against `sources/media/rights-policy.json`:

```
attributed_display   0
internal_only      789
unknown             44
```

`attributed_display` is **0**, and `apps/web/public/media/` contains exactly one file:
`.gitkeep`, 0 bytes. **Not one byte of competitor media is published by this commit.** The
encoder's rights gate routed all 8,649 renditions into git-ignored `sources/media/encoded/`.

That is the correct outcome, not a shortfall: no source in the register grants a right to
reproduce, so the honest count of publishable assets is zero. W3-A, W3-G and W3-I must source
public hero and section art elsewhere.

## Corrections to my own earlier reporting

Stated because the numbers were on record in `HANDOFF/NIGHT-LOG.md` before they were right:

- **"174 floorplans" (19:40 log line) was wrong.** It came from a `--finalize` snapshot taken
  before the classifier fix. 173 of those were `cebecigroup.com` `/planlar/` assets that are
  **construction-progress aerials**, two with burned-in date stamps — the other executor
  rendered and inspected the pixels rather than trusting the path. The true figure is **13
  `floorplan` + 7 `siteplan` = 20 plan assets**, and TERRA carries the largest share, exactly as
  `MEDIA-LICENSE.md` §2 predicted.
- **"3 HEIC assets" was also wrong**, and for a reason worth keeping: HEIC and
  `over_max_download_bytes` shared one `reportable` flag in the report writer, so three
  over-ceiling downloads were tallied as HEIC. Live-harvest HEIC is **0**. The selftest still
  proves the HEIC path rejects, on a synthesised `ftyp` box.

Both were caught by re-deriving from `harvest-report.json` instead of restating an earlier line.

## What I changed in the pipeline

`scripts/harvest-media.mjs` gained **`--finalize`** (commit `0b82deb`): rebuild dedupe,
`assets.json` and `harvest-report.json` from `attempts.jsonl` with **no network I/O**. Those two
files were only ever written after the download pass, so a long harvest left `encode-images.mjs`
and `media-manifest.mjs` with nothing to consume for as long as it ran, even though hundreds of
byte-validated assets were already on disk. It is not a shortcut around the harvest — the
collector was already reading `attempts.jsonl` as its single source of truth, so `--finalize`
produces exactly what a completed run produces for the candidates attempted so far. Re-run it
after a download pass to pick up the remainder.

## Operational note for whoever reads this next

Three `encode-images.mjs` processes ran concurrently at one point, because both executors
reached the encode stage together. The encoder **clears its own output directory on startup**,
so the second start deleted 4,120 renditions the first had written. Resolved by killing the run
working from the stale, pre-reclassification `assets.json` and letting the one with the corrected
categories finish. The outputs are content-addressed by asset id, so nothing was corrupted —
but **do not run two encodes at once**, and if `sources/media/encoded/` ever looks short, check
for a second process before re-running.
