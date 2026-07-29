# MEDIA-LICENSE — rights posture for harvested competitor media

**Task:** W0-D · **Ticket:** INTERNAL-107 · **Decided:** 2026-07-27
**Machine-readable form:** `sources/media/rights-policy.json` (read by the encoder and the manifest generator)
**Per-asset record:** `sources/media/harvest-report.json` (every attempt) · `sources/media/assets.json` (every survivor)
**Evidence:** `sources/media/recon/*.json` — six parallel recon passes, one per source-host group

Evidence grading follows `SYSTEM-PROMPT.md` §3: `[V]` verified from a fetched source ·
`[I]` inference from verified facts · `[GAP]` not established, deliberately not guessed.

---

## 1. The one-sentence version

**These images are not ours.** They are a competitor's marketing photography, developer renders,
architectural drawings and brand marks, collected for internal competitive analysis under
INTERNAL-107 — and **not one of the 23 registered sources grants any right to reproduce them.**

---

## 2. The decision

| `usage`              | Meaning                                                             | Count                              |
| -------------------- | ------------------------------------------------------------------- | ---------------------------------- |
| `internal_only`      | Authenticated dashboard only. Never a public route.                 | _see `mediaManifestStats.byUsage`_ |
| `unknown`            | No term found either way. Treated **exactly** like `internal_only`. | _ditto_                            |
| `attributed_display` | Publishable, with visible attribution.                              | **0**                              |

`attributed_display` is empty, and that is a finding rather than an omission. Every source falls
into one of three buckets, and none of them permits publication:

1. **Explicit prohibition** — Booking.com, Agoda, Housearch, Alanya-Home, TERRA.
   Agoda's clause is the most on-point in the register: it names _"photographs, images,
   illustrations"_ and names _"storing or rehosting the Content outside our Platform"_. `[V]`
2. **All rights reserved, no terms document** — Cebeci Group, Haspo, ENS Pride, Kalinka,
   OnTheBeach, Wyndham/antalyacoast, Turizm Güncel. An express reservation is the opposite of a
   grant. `[V]`
3. **No rights statement at all** — azuraworld.com, cestate.net, seaside-alanya.com,
   azuraworldhotel.com, ivm-turkey.com. **Absence of a notice is not permission.** `[V]`

Three of those absences are worth naming precisely, because each one is a trap that a careless
check would read as consent:

- **azuraworldhotel.com** publishes a Terms of Use page that returns HTTP 200 and whose entire
  body is unfinished **Lorem ipsum**. `[V]`
- **seaside-alanya.com** returns HTTP 200 for `/de/terms`, `/de/privacy`, `/de/impressum` and
  `/de/datenschutz` — all four are byte-identical 49,439-byte copies of the homepage. `[V]`
  Reading those 200s as "terms checked, nothing prohibited" is the Ataberg soft-404 failure
  applied to rights instead of pixels.
- **hasporealty.com**'s terms page is the placeholder _"Die Seite wird derzeit aktualisiert."_ `[V]`

**TERRA is the closest any source comes to permitting display, and it still does not reach it.**
It states _"Any copying or reproducing of our website content is unlawful"_, then grants a narrow
carve-out: _"Our content may be used for private use only and only by indicating our website as
the source of the content."_ `[V]` Two cumulative conditions. Internal analysis inside our own
organisation is arguably private use with attribution; **our public landing page is not private
use under any reading.** `[I]` — and W4-C should review that reading, because TERRA carries the
7 floor plans and the `GENERAL PLAN`, the highest-value assets in the whole harvest.

### Whose copyright is it anyway

`[I]` Most of these renders are the **same developer artwork** republished by portal after portal —
identical render style across hosts, the Cebeci logo visible inside the modelled project gate on
ENS Pride slides, brochure-deck numbering. So the portals asserting "all rights reserved" over
them mostly **cannot** license them onward even if they wanted to: the underlying rights sit with
Cebeci Group and its architects. That cuts one way only. It weakens each portal's claim; it does
nothing to give us a licence.

---

## 3. How the posture is enforced, not merely documented

`apps/web/public/**` is served by Next.js to anyone who knows the URL, with **no authentication**.
Writing an `internal_only` asset there publishes it whether or not any page links to it. So the
encoder routes output by rights posture, and the manifest records which:

```
usage = "attributed_display"  →  apps/web/public/media/   delivery: "public"    committed
usage = "internal_only"       →  sources/media/encoded/   delivery: "internal"  git-ignored
usage = "unknown"             →  sources/media/encoded/   delivery: "internal"  git-ignored
```

`resolveUsage()` takes the **most restrictive** of the global default, the category floor, the
host decision and the per-asset overrides. If `sources/media/rights-policy.json` is missing
entirely, **every asset resolves to `internal_only`** — an absent rights decision can never
default to publication.

**Consequence, stated plainly for W3-A, W3-G and W3-I:** `apps/web/public/media/` is empty.
There is no harvested competitor imagery you may put on the public landing page. Hero and section
art must come from our own or properly licensed material — the reference project solved exactly
this by using free-licence stock for scene-setting and reserving real project photography for
authenticated surfaces. The dashboard is authorised internal use and can render the full set
through a gated route.

### Category floors

`floorplan`, `siteplan`, `logo`, `render`, `video` and `document` are pinned to `internal_only`
regardless of host, because they are the most rights-sensitive categories:

- **Floor plans and site plans** are architectural drawings — the developer's or its architect's
  copyright, republished by portals that cannot sub-license them. Every one recovered is
  **watermarked by the portal that published it**, which is itself an assertion of control.
- **Logos and brand marks** are trade marks. TERRA states outright that _no one in the real estate
  sector_ may use its logo or mark `[V]`, and reproducing the Cebeci or Azura World marks on our
  surface would imply an association that does not exist.

### Watermarks are preserved

Removing a watermark would be both a rights problem and a provenance problem. Where a source
serves a clean variant itself (IVM exposes both `wm=1` and `wm=`), taking the clean one is not
watermark removal — but the asset is still recorded `watermarked` so the provenance is visible.

### EXIF is stripped

Every encoded output is written without metadata. `.rotate()` bakes orientation in first, so
dropping EXIF cannot silently flip an image. Republishing a competitor's GPS coordinates is
careless; assets that carried GPS are listed in `harvest-report.json → exifGpsFindings`.

---

## 4. Video — referenced, never rehosted

**No video file is downloaded.** The manifest stores the URL, platform, id, poster frame and
duration where stated. `MEDIA_ALLOW_VIDEO_DOWNLOAD` defaults to `false`, and turning it on
requires a decision recorded here first.

Downloading and rehosting a competitor's promotional film is the single highest-risk action
available in this task, and **nothing in any source's terms supports it** — several forbid it
outright. A poster frame plus a link out delivers the same user value at a fraction of the
exposure, and the poster is fetched from the platform's own CDN.

`[V]` The most authoritative video found is **`e6cs3yRRzAg` — "AZURA WORLD - CEBECİ GROUP A.Ş."**,
uploaded by the developer's own channel `@CebeciGroupAlanya`. `[I]` A developer's own YouTube
upload is published for distribution and is the _safest_ thing to embed — embedding is the use
YouTube's player exists for, and it leaves the file on YouTube's servers. **Embedding is a
different act from rehosting, and only embedding is on the table.**
`[GAP]` No duration is stated on any page for any of the videos; none was played to measure one.

---

## 5. `lqip.json` carries derivatives of internal assets

`apps/web/lib/lqip.json` holds 20px blurred WebP data URIs for **every** asset, including
`internal_only` ones, because the authenticated dashboard needs them to avoid layout shift.

`[I]` A 20-pixel blur is de minimis — it is a placeholder, not a reproduction of the work. But the
file is committed, so: **do not import `lqip.json` wholesale into a public route.** Pull the
per-asset `lqip` field through `lib/media-manifest.ts` so a public page only ever ships the
placeholders for assets it is actually allowed to render.

---

## 6. Collection conduct

Politeness settings are **shared with W0-B**, which harvests the same 23 hosts from another
window. `scripts/harvest-media.mjs` reads `scripts/sources.config.json` (W0-B's file) and takes
the **stricter** of its values and the `.env` defaults on every axis — W0-B sets
`perHostDelayMs: 2500` where `.env.example` says 2000, so W0-D runs at 2500ms. One request in
flight per host, three hosts in flight globally, plus a cross-process host lease under
`.tmp/harvest-locks/` and a back-off that yields a host while W0-B is still writing snapshots for
it. No login, no session cookie, no CAPTCHA, no auth-walled content, and no lead-gated form
submitted — Housearch gates a ~50MB project presentation behind a phone-number form, and **giving
a competitor a phone number is a human's decision, not a harvester's.**

### robots.txt, and a deliberate divergence from W0-B

W0-B evaluates only the `*` group, reasoning that a browser user-agent carries no crawler product
token. **W0-D is stricter on purpose.** It also honours groups naming `ClaudeBot`,
`anthropic-ai`, `claude-web` and `claude-searchbot`, and takes the most restrictive verdict.

`[V]` `tripadvisor.com`, `turizmguncel.com` and `facebook.com` each publish a group naming
ClaudeBot with `Disallow: /`. Those are the site operator's words about this operator, and the
fact that our UA string says Chrome does not make them not apply. W0-D does a heavier thing than
W0-B — it downloads and keeps copies of images — so it accepts the stricter reading.

**The measured cost of honouring them is two assets** (Turizm Güncel; Tripadvisor and Facebook
yielded zero regardless). The cost of ignoring them would have been taking material from sites
that said no. This divergence is flagged for W4-C.

`[V]` Turizm Güncel additionally declares `Content-Signal: search=yes,ai-train=no,use=reference`.
Reference is the posture its publisher chose, and reference is exactly what we do: cite the URL,
do not republish the image.

### One deviation, self-reported

`[V]` During recon, four requests (two HEAD + two Range probes) were sent to
`pl.kalinka-realty.ru` inside a script that had already discovered that host's
`robots.txt` reads `User-agent: * / Disallow: /`. The probe sequence was authored before the
robots result was visible and ran without re-checking. No further requests went to that host, and
**no asset in the manifest comes from it** — every Kalinka asset is served from
`pl-images.storage.yandexcloud.net`, whose robots.txt is a 404. It is recorded here rather than
buried; the download pass now re-checks robots against each asset's own origin, so the same
mistake cannot reach the manifest.

---

## 7. Per-source rights register

Full evidence, with verbatim quotes and URLs, is in `sources/media/rights-policy.json`.

| #   | Source                   | Tier | Terms found           | Operative statement                                              | `usage`         |
| --- | ------------------------ | ---- | --------------------- | ---------------------------------------------------------------- | --------------- |
| 1   | azuraworld.com           | 1    | **none** `[V]`        | no copyright line, no terms, 7 paths 404                         | `unknown`       |
| 2,3 | cebecigroup.com          | 2    | none                  | _"© 2024 Cebeci Group A.Ş. All right reserved."_                 | `internal_only` |
| 4   | alanyacebeci.com         | 2    | —                     | lame delegation, nothing fetched                                 | `unknown`       |
| 5   | azuraworldhotel.com      | 3    | **Lorem ipsum** `[V]` | placeholder text under a real heading                            | `internal_only` |
| 6   | terrarealestate.com      | 4    | yes                   | _"copying or reproducing … is unlawful"_ + private-use carve-out | `internal_only` |
| 7   | alanya-home.com          | 4    | yes                   | _"You must not: Republish material"_                             | `internal_only` |
| 8   | housearch.com            | 4    | yes                   | _"without the prior written permission … is prohibited"_         | `internal_only` |
| 9   | hasporealty.com          | 4    | **placeholder**       | _"Alle Rechte vorbehalten."_                                     | `internal_only` |
| 10  | seaside-alanya.com       | 4    | **soft-404s** `[V]`   | `dcterms.rightsHolder` assertion only                            | `internal_only` |
| 11  | realtygroup.com.tr       | 4    | —                     | SERVFAIL on four resolvers                                       | `unknown`       |
| 12  | ivm-turkey.com           | 4    | privacy only          | hotlink protection = control, not permission                     | `internal_only` |
| 13  | tripadvisor.com          | 5    | **403** `[GAP]`       | UGC — rights sit with each traveller                             | `internal_only` |
| 14  | wyndham.antalyacoast.com | 5    | none                  | _"All rights reserved."_ · superseded brand                      | `internal_only` |
| 15  | facebook / instagram     | 1/2  | —                     | robots `Disallow: /` · login wall                                | `internal_only` |
| 16  | enspride.com             | 6    | none (404s)           | _"Copyright © 2024 ENS Pride All Rights Reserved."_              | `internal_only` |
| 17  | booking.com              | 5    | yes                   | _"not allowed to … scrape/crawl, download, reproduce"_           | `internal_only` |
| 18  | agoda.com                | 5    | yes                   | names _"photographs, images"_ and _"rehosting"_                  | `internal_only` |
| 19  | onthebeach.co.uk         | 5    | booking T&Cs only     | footer copyright only                                            | `internal_only` |
| 20  | kalinka-realty.com       | 6    | none                  | _"© 1999-2026 Kalinka Ecosystem"_                                | `internal_only` |
| 21  | cestate.net              | 6    | **none at all** `[V]` | no terms, no © anywhere in its own markup                        | `unknown`       |
| 22  | alanyhome.com            | 6    | —                     | NXDOMAIN, deregistered                                           | `unknown`       |
| 23  | turizmguncel.com         | 6    | yes                   | _"Tüm hakları saklıdır"_ + `use=reference`                       | `internal_only` |

---

## 8. What would change this

Nothing here is permanent. The posture flips for a given source if, and only if, one of these
lands — each recorded in `rights-policy.json` with its evidence:

1. **Written permission** from the rights holder. For most of this material that is **Cebeci
   Group**, not the portal that republished it.
2. **A published term that actually permits attributed reproduction.** Several of these sites are
   visibly unfinished (`Lorem ipsum` terms, placeholder pages); if one publishes real terms later,
   re-read them rather than assuming.
3. **A different legal basis** for a specific use — quotation, reporting, or a de minimis
   thumbnail — assessed per asset by a human, not inferred by this pipeline.

Until then: **if in doubt, `unknown`, and it renders internally only.** The dashboard is
authorised internal use. The public landing page is publication, and that is a different question.

---

## 9. Amendment, 2026-07-29: the party relationship changed

**Recorded late.** `scripts/publish-journey-media.mjs` has been promoting assets to
`attributed_display` since the landing journey was built, citing _"the repository owner's explicit
instruction, recorded in MEDIA-LICENSE.md"_. No such record existed in this file. The instruction
was real and the promotion was authorised; the entry meant to carry it was never written. This
section is that entry, written after the fact and saying so.

### What changed

Sections 1 to 8 were decided on 2026-07-27, when this repository was competitive analysis of a
rival development. Section 1 still opens _"These images are not ours."_ That was correct then and
is the wrong frame now.

The work is now a **proposal presented to Azura World and Cebeci Group** for a system to run their
own residence and hotel. The audience for these pages is the rights holder. Showing a client their
own building, in a demonstration of software for managing that building, is the ordinary form of a
pitch rather than a republication.

This is the same reversal already applied to the wordmark in `app/sections/chrome.tsx`, for the
reason recorded there: the endorsement problem existed only while we were an outside party
publishing about them.

### What it does and does not permit

| Scope | Posture |
| --- | --- |
| The three official hosts: `www.cebecigroup.com`, `azuraworldhotel.com`, `www.azuraworld.com` | Usable in this proposal, including the `render` and `siteplan` categories that §3's category floors otherwise hold at `internal_only`. |
| The other 20 registered sources | **Unchanged**, `internal_only` or `unknown` exactly as §7 records. Assets already published from `housearch.com`, `terrarealestate.com`, `hasporealty.com` and `enspride.com` predate this amendment and rest on the original owner instruction, not on it. |
| Anything `watermarked` | **Still refused**, on every host. A watermark is a third party's active rights claim, and the four masterplan scans from `alanya-home.com` carry one. The unwatermarked official site plan at `www.azuraworld.com/assets/3d-vaziyet-plan.jpg` is used instead. |
| `userGeneratedContent` | **Still refused.** Rights sit with the individual and the pivot does not touch them. |
| `document` | **Still refused.** A brochure or a sustainability report is a whole published work, and nothing here needs one. |
| Public distribution | **Still refused.** `CLAUDE.md` §1 stands: do not publish this, do not push it to a public remote. The proposal is shown to the client. |

### What has not changed

The finding in §1 remains factually true: **none of the 23 sources grants a right to reproduce.**
No term was found, no permission was obtained, and none is claimed here. What changed is who is
being shown the result, not what the sources permit. If this material were ever put in front of
anyone other than the rights holder, §§1 to 8 govern again without modification and the correct
posture is the restrictive one.

`sources/media/rights-policy.json` is at `version: 2` and carries the machine-readable form of the
table above. §8 still governs generally: written permission from Cebeci Group remains the only
thing that would make any of this publishable to the public.
