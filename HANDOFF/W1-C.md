# HANDOFF — W1-C Internationalisation (de · en · tr · ru)

STATUS: COMPLETE
Completed: 2026-07-27

> **Authorship note, stated first because it affects how you read the rest.**
> Two Claude Code executors ran the window-3 chain (`W1-C → W0-D`) concurrently against the
> single shared working tree, both on branch `feature/INTERNAL-107-w1c-w0d-i18n-media`. The
> **implementation** in commit `f9bc385` was written by the other executor. **This handoff, and
> every number in the "Verification actually run" table below, is the work of the second
> executor**, which ran each command itself against the committed tree rather than restating a
> claim. `f9bc385` shipped all 17 source files and no handoff; this file closes that gap.
> Where I did not verify something, it says so.

---

## What was built

Commit `f9bc385` — _"INTERNAL-107 W1-C: four-locale i18n with a gate that proves parity"_,
17 files, +4515/−9:

- **Routing** — `apps/web/i18n/routing.ts` calls `defineRouting` with `locales` /
  `defaultLocale` **imported from `lib/contracts.ts`**, not redeclared, so `proxy.ts` and
  next-intl cannot drift. `localePrefix: "always"`, `localeDetection: false`.
- **Request config** — `apps/web/i18n/request.ts`. Loads catalogues through an explicit
  four-arm `switch` rather than a template-literal `import()`, so the bundler sees four static
  dependencies instead of making every catalogue a dynamic dependency of every route.
  `timeZone: "Europe/Istanbul"` is pinned (Türkiye has had no DST since 2016), which is what
  stops a server-rendered date and a client-rendered date disagreeing.
- **Navigation** — `apps/web/i18n/navigation.ts` + the `apps/web/app/navigation.ts` re-export
  that mirrors the 1Çatı import path.
- **Locale layout** — `apps/web/app/[locale]/layout.tsx`: `notFound()` on an unknown segment,
  `setRequestLocale` for static rendering, `NextIntlClientProvider` for client components.
- **Four catalogues** — `messages/{de,en,tr,ru}.json`, **576 keys each, identical key sets**.
- **`lib/format.ts`** — `formatMoney` / `formatArea` / `formatDate` / `formatDistance` /
  `collator` plus `formatNumber`, `formatPercent`, `formatDateTime`, `formatDateLong`,
  `compareStrings`, `foldInvariant`.
- **`lib/proper-nouns.ts` + `lib/proper-nouns.json`** — one JSON list, two consumers (the TS
  module and the plain-`node` gate), so the allowlist cannot drift between them.
- **`scripts/check-i18n.mjs`** — all six rules from the brief plus two structural checks.
- **`next.config.ts`** — the `createNextIntlPlugin("./i18n/request.ts")` seam W0-A left is now
  enabled. This is the one W0-A-owned file W1-C was explicitly authorised to touch, by the
  instruction written into the seam comment itself.

---

## Verification actually run

Every command below was executed by me against the tree at `f9bc385`; exit codes captured
explicitly, never behind a pipe.

| Command                                          | Result           | Evidence                                                                                                                                                                                                 |
| ------------------------------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/check-i18n.mjs`                    | **PASS**, exit 0 | `de/en/tr/ru 576 keys` each · `PASS — 0 errors, 0 warnings, identical key sets`                                                                                                                          |
| `pnpm --dir apps/web typecheck`                  | **PASS**, exit 0 | `tsc --noEmit`, no output                                                                                                                                                                                |
| `pnpm --dir apps/web lint`                       | **FAIL**, exit 1 | 1 error + 1 warning, **both in `components/anim/*` (W1-D)**. No W1-C file is implicated — see "Known gaps"                                                                                               |
| `formatMoney({112000,"EUR"},"de")`               | **PASS**         | `"112.000,00 €"` — codepoints `… 00a0 20ac`. The separator is U+00A0, which is exactly what `Intl.NumberFormat("de-DE",{style:"currency"})` emits; the brief's literal `112.000,00 €` is the same string |
| `formatMoney({239171,"USD"},"de")`               | **PASS**         | `"239.171,00 $"` — `includes("€") === false`. Rendered **as USD, not converted**                                                                                                                         |
| `formatDate("2026-07-27", …)`                    | **PASS**         | de `27.07.2026` · en `07/27/2026` · tr `27.07.2026` · ru `27.07.2026`                                                                                                                                    |
| `collator("tr")` sort                            | **PASS**         | `ısı < Istanbul < Işık < iyi < İzmir`; German orders the same five words `Işık < Istanbul < iyi < İzmir < ısı`. Dotless ı sorts before i under `tr` and does not under `de`, which is the whole point    |
| `curl /` (live dev server)                       | **PASS**         | `307 → http://127.0.0.1:3200/de`                                                                                                                                                                         |
| `curl /de`, `/en`, `/tr`, `/ru`, `/xx/dashboard` | **NOT VERIFIED** | All returned **500**, from a Turbopack failure unrelated to i18n — see "Known gaps"                                                                                                                      |

`pnpm --dir apps/web build` — **NOT RUN.** The machine had 1.5 GB of 16 GB free with 27 node
processes (a 776-asset image encode plus three other windows), and the same memory pressure is
what broke the dev server below. Running it would have measured the machine, not the code.

---

## The frozen namespace list

Ten top-level namespaces. _*Each W3-* window appends to its own namespace only._* Nobody
rewrites `common.*`, `nav.*` or `evidence.*` — those are shared surface, and a rename in them
touches eight windows at once.

| Namespace   | Keys | Children                                                                                                                                                                                                                                                |
| ----------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `common`    | 94   | actions · states · errors · units · pagination · table · filters · time · boolean · required · optional                                                                                                                                                 |
| `nav`       | 51   | brand · home · project · hotel · … · sections · groups · modules                                                                                                                                                                                        |
| `evidence`  | 44   | confidence · confidenceShort · stale · modelled · sourceUnreachable · label · conflict · panel · method · disclaimer · gapNotice                                                                                                                        |
| `landing`   | 55   | topBar · hero · why · immersion · amenities · desire · evidenceBand · action · after · share · love · footer                                                                                                                                            |
| `dashboard` | 255  | shell · kpi · search · evidence · units · listings · leads · pipeline · finance · payments · wallet · vendorInvoices · tickets · activities · calendar · communications · documents · compliance · reports · users · admin · settings · hotel · reviews |
| `hotel`     | 16   | public hotel page                                                                                                                                                                                                                                       |
| `report`    | 12   | public report flow                                                                                                                                                                                                                                      |
| `concierge` | 18   | AI assistant, incl. `errors.*` and `suggestions.*`                                                                                                                                                                                                      |
| `auth`      | 21   | login · signup · forbidden                                                                                                                                                                                                                              |
| `legal`     | 10   | privacy · terms · imprint · mediaRights                                                                                                                                                                                                                 |

`auth.*` is **an addition beyond the brief's list**, needed by `app/[locale]/login/`. Flagged
here so W3-H knows it already exists and does not create a second one.

---

## Real translations vs English fallbacks — the honesty section

**There are no English stubs in any of the four catalogues, and no machine-translation
placeholders.** All 576 keys carry locale-native copy. Two independent checks support that
rather than one:

1. `check-i18n` rule 5 (value equals its key) and warning W1 (value byte-identical to German
   after proper nouns, digits and punctuation are stripped) both report **zero** hits.
2. I read the evidence vocabulary — the strings that carry the project's credibility — in all
   four languages:

| Key                          | de                                           | en                                   | tr                                           | ru                                              |
| ---------------------------- | -------------------------------------------- | ------------------------------------ | -------------------------------------------- | ----------------------------------------------- |
| `confidence.confirmed`       | Bestätigt (mehrere Quellen)                  | Confirmed (multiple sources)         | Doğrulandı (birden çok kaynak)               | Подтверждено (несколько источников)             |
| `confidence.conflicted`      | Quellen widersprechen sich                   | Sources disagree                     | Kaynaklar çelişiyor                          | Источники расходятся                            |
| `confidence.gap`             | Nicht belegt                                 | Not established                      | Belgelenmedi                                 | Не подтверждено                                 |
| `evidence.stale`             | Veraltetes Inserat                           | Stale listing                        | Güncelliğini yitirmiş ilan                   | Устаревшее объявление                           |
| `evidence.sourceUnreachable` | Quelle nicht erreichbar                      | Source unreachable                   | Kaynağa ulaşılamadı                          | Источник недоступен                             |
| **`evidence.modelled`**      | Modellierter Datensatz — kein reales Inserat | Modelled record — not a real listing | Modellenmiş kayıt — gerçek bir ilan değildir | Смоделированная запись — не реальное объявление |

The de/en column matches the brief's frozen table exactly. `evidence.modelled` — the string
whose whole job is to stop a synthesised unit reading as a real listing — is unambiguous in all
four.

**Pluralisation is ICU, not a ternary.** Russian carries all four CLDR forms:
`{count, plural, one {активен # фильтр} few {активно # фильтра} many {активно # фильтров} other {активно # фильтра}}`.
Turkish correctly uses `other` alone.

---

## Measured longest-string ratio per locale vs German — for W1-D

Computed across all 576 keys. Ratios use only the 12-chars-or-longer German strings, because a
ratio taken on `"Ja"`/`"Yes"` is noise.

| Locale | Total chars | Mean ratio vs de | **p95 ratio** | Max ratio | Longest single string |
| ------ | ----------- | ---------------- | ------------- | --------- | --------------------- |
| de     | 10,708      | 1.000            | 1.00          | 1.00      | 160                   |
| en     | 9,642       | 0.905            | 1.23          | 1.73      | 134                   |
| tr     | 9,173       | 0.869            | 1.36          | 1.87      | 151                   |
| ru     | 10,608      | 0.985            | **1.50**      | **2.00**  | 131                   |

**The number to size components against is Russian at p95 = 1.50× German, worst case 2.00×.**
German is _not_ the widest locale here — the brief warned that German runs ~30% longer than
English, and it does (en mean 0.905 ⟹ de ≈ 1.10× en), but Russian then runs longer than German
again. A control sized to fit German still has to survive another +50% for Russian.

Longest UI-critical strings (nav, `common.actions.*`, table columns, filters):

- de `"Lieferantenrechnungen"` (21) · tr `"Tedarikçi faturaları"` (20) · ru `"Перейти к содержимому"` (21)
- The genuinely long ones are ICU plural sources, which never render at source length: the ru
  plural above is 115 source chars and renders as ~18.

---

## The `proper-nouns.json` allowlist

`apps/web/lib/proper-nouns.json` — one file, read by `lib/proper-nouns.ts` (runtime) and by
`scripts/check-i18n.mjs` (`readFileSync`, because the gate must run under plain `node` with no
TypeScript loader). Divergence is impossible by construction.

**`properNouns` (22)** — must render verbatim in every locale:
Azura World Residence & Hotel · Azura World Hotel · Azura World · Azura Concierge · Azura ·
Cebeci Group A.Ş. · Cebeci Group · Wyndham Alanya · Wyndham · Türkler · Alanya · Antalya ·
Tripadvisor · Booking.com · Google · Housearch · Supabase · WhatsApp · SMS · RevPAR · PDF ·
INTERNAL-107

**`sharedTerms` (31)** — legitimately identical across locales, so W1's "untranslated" warning
must not fire on them:
Aquapark · Portal · Normal · Status · Email · E-Mail · Ctrl + K · m² · km · m · % · — · Live ·
Offline · Hotel · Report · Dashboard · Wallet · Tickets · Compliance · Administration ·
Snapshot · Block · System · Neutral · Menü · Profil · Kanal · Liste · Telefon · Optional

**`variants`** — localised forms normalised back to canonical, so a translator's well-meant
"Azura World Residenz & Hotel" or "Азура Ворлд" is pinned:
`Azura World Residenz & Hotel` · `Azura Dünya` · `Азура Ворлд` · `Азура Уорлд` ·
`Cebeci Grubu` · `Группа Cebeci` · `Тюрклер` · `Аланья` · `Анталья` → canonical.

Turkish unit notation (`1+1`, `2+1`) and district names stay untranslated, per the brief.

---

## Contracts I consumed

- **CONTRACTS §7 Locale** — `locales`, `defaultLocale`, `Locale` imported from
  `lib/contracts.ts` by `i18n/routing.ts`. **Fitted exactly**; nothing was redeclared.
- **CONTRACTS §2 `Money`** — `formatMoney(money: Money, locale: Locale)` takes the contract type
  and renders in the money's **own** currency. Fitted.
- **CONTRACTS §5 `ApiError`** — `common.errors.*` mirrors the eight error codes so a route
  handler's typed error has a string for every code. Fitted.
- **CONTRACTS §1 `Confidence`** — `evidence.confidence.*` covers all six values. Fitted.

No contract needed amendment.

---

## Decisions made

1. **`localeDetection: false`.** No cookie or `Accept-Language` negotiation. A shared link must
   render the same page for everyone; a locale that silently follows the browser turns "the
   German page showed English" into an unreproducible bug report.
2. **Static `switch` over template-literal catalogue import.** Keeps four static bundler
   dependencies instead of making every catalogue dynamic for every route.
3. **The unknown-locale 404 lives in `app/[locale]/layout.tsx`, not `i18n/request.ts`.**
   next-intl requires a valid locale back from `getRequestConfig`; throwing there is a 500, not
   a 404. So `request.ts` falls back to German _only so the 404 page has messages to render
   with_, and `layout.tsx` calls `notFound()`. The brief's requirement — an unknown locale must
   404 cleanly rather than silently serve German — is implemented at the layout, not the config.
4. **`check-i18n` rule 6 short-string floor of 12 chars.** Without it the rule fires on
   `"Speichern"`/`"Save"` and produces noise instead of a layout signal.
5. **`_long` semantics.** The base key holds the compact label a button or table header can
   render; `<key>_long` holds the full phrasing for wide contexts, and its presence suppresses
   rule 6 for that key.

---

## Requests for other windows

1. **W0-A — `apps/web/app/layout.tsx`: `<html lang>` does not track the locale.** It is
   hard-coded `lang="de"`, so `/en`, `/tr` and `/ru` currently serve German-tagged markup.
   Screen-reader pronunciation and CSS hyphenation both read it. Only one layout in an App
   Router tree may render `<html>`, and W0-A owns that file, so W1-C could not fix it without
   reaching across (SYSTEM-PROMPT §4.1).
   **The fix:** make `app/layout.tsx` a pass-through (`return children`) and move `<html>` /
   `<body>` into `app/[locale]/layout.tsx`, which already has the awaited `locale` in scope.
   This is the standard next-intl arrangement. Until it lands, `<html lang>` is correct for
   German and wrong for the other three.
2. **W0-A — `package.json`:** add `"check:i18n": "node scripts/check-i18n.mjs"` so W4-D's gate
   invokes it by script name rather than path.
3. **W1-D — `components/anim/reveal.tsx` and `counter.tsx`** are the only two lint findings in
   the tree (1 error `react-hooks/refs` "Cannot access refs during render" at `reveal.tsx:142`,
   1 unused-var warning at `counter.tsx:5`). They block `lint --max-warnings 0` for everyone.
4. **Every W3-\* window:** append to your own namespace only. If you need a key in `common.*`,
   `nav.*` or `evidence.*`, request it rather than adding it — those three are shared surface.

---

## Known gaps

- **`[GAP]` The four locale routes were not verified to render.** `/de`, `/en`, `/tr`, `/ru`,
  `/de/dashboard` and `/xx/dashboard` all returned **500** against a live dev server. The cause
  is **not i18n**: Turbopack failed to spawn a PostCSS worker for `app/globals.css` (W1-D's
  file), bottoming out at Windows `exit code 0xc0000142` (STATUS_DLL_INIT_FAILED) — a
  process-spawn failure, with 1.5 GB of 16 GB RAM free and 27 node processes running. The whole
  app was blocked on compiling `/_not-found/page`, which is why even `/xx/dashboard` 500s
  instead of 404ing. **Retest when the machine is quiet**; `/` → 307 → `/de` did work, so the
  proxy and the locale prefix are live. Until retested, the brief's "`/xx/dashboard` 404s rather
  than silently serving German" is implemented and reviewed in source but **unproven at runtime**.
- **`[GAP]` Locale switch preserving path + query + hash was not exercised in a browser.**
  `components/locale-switcher.tsx` rebuilds the target from `usePathname()` (which returns the
  path _without_ the locale prefix) plus `useSearchParams()` and `window.location.hash`, which
  is the correct shape and cannot produce `/en/en/dashboard`. Blocked by the same 500.
- **`[GAP]` No Cyrillic glyph-coverage check was run by me.** W1-D's NIGHT-LOG entry states the
  self-hosted Manrope/Playfair subsets include Cyrillic ("7 woff2, 134KB, Cyrillic verified
  present"); I did not re-verify it, and a missing glyph renders as a box silently.
- **`prefers-reduced-motion`, tap targets, contrast** — not W1-C's scope; W4-B's layout harness.
- `pnpm --dir apps/web build` not run (reason above).

---

# ADDENDUM — gaps closed after `f9bc385`

_Written by the first executor (the one that implemented `f9bc385`), appended rather than
merged: the section above is the other executor's work and stays as written. Everything here was
run **after** 18:54, which is why the section above could not contain it. Where this addendum
and the text above disagree, the disagreement is a change made after that snapshot, and is
named as such._

## The three `[GAP]` items above are now closed

### 1. `pnpm --dir apps/web build` — was NOT RUN, now **PASS, exit 0**

The first attempt failed, and not on i18n:

```
./app/[locale]/kitchen-sink/page.tsx
Module not found: Can't resolve './kitchen-sink-client'
BUILD_EXIT=1
```

W1-D added the missing file; the rerun is green:

```
✓ Compiled successfully in 36.8s
  Running TypeScript ... Finished TypeScript in 23.2s
✓ Generating static pages using 5 workers (6/6) in 3.3s

Route (app)
┌ ○ /_not-found
├ ● /[locale]/kitchen-sink
│ ├ /de/kitchen-sink
│ ├ /en/kitchen-sink
│ ├ /tr/kitchen-sink
│ └ /ru/kitchen-sink
└ ƒ /api/access-profile
BUILD_EXIT=0
```

Note what the route table proves independently of any HTTP request: `generateStaticParams` in
`app/[locale]/layout.tsx` prerendered exactly four locale routes, and `xx` is **absent** from
`.next/prerender-manifest.json`.

Worth recording: the build compiled `app/globals.css` **without complaint**. That is the
evidence that the Turbopack 500s were environmental, not a defect in W1-D's CSS.

### 2. The four locale routes render, and `/xx` 404s — was NOT VERIFIED, now **PASS**

The Turbopack blocker was routed around rather than waited out: **`npx next dev --webpack`**
uses a different bundler and starts cleanly on the same tree. Probed live on 127.0.0.1:3200:

```
/                              -> 307  location: /de
/de/kitchen-sink               -> 200
/en/kitchen-sink               -> 200
/tr/kitchen-sink               -> 200
/ru/kitchen-sink               -> 200
/xx/kitchen-sink               -> 404
/xx/dashboard                  -> 404
/xx                            -> 404
```

**`/xx/*` 404s rather than silently serving German.** That is the brief's requirement, now
proven at runtime rather than reviewed in source.

One trap for whoever retests: under `next start` **every** route 404s, valid locales included,
because W1-D's `kitchen-sink/page.tsx` calls `notFound()` when `NODE_ENV === "production"` by
design (it is a dev-only design gallery). A 404 there is W1-D's guard, not a routing fault. Use
`next dev --webpack`, or wait for W3-A's real page.

Messages and formatters were then read back **from the running server**, per locale, through a
temporary `app/[locale]/i18n-probe-tmp/page.tsx` that has since been **deleted** (it is in no
commit). It was needed because no production-visible route consumes `messages/*` yet — W3-A has
not landed, and kitchen-sink hardcodes its German inline:

| probe                            | de                         | en               | tr                  | ru                   |
| -------------------------------- | -------------------------- | ---------------- | ------------------- | -------------------- |
| `evidence.confidence.conflicted` | Quellen widersprechen sich | Sources disagree | Kaynaklar çelişiyor | Источники расходятся |
| `dashboard.units.count` (1)      | 1 Wohnung                  | 1 unit           | 1 daire             | 1 квартира           |
| `dashboard.units.count` (5)      | 5 Wohnungen                | 5 units          | 5 daire             | **5 квартир**        |
| `common.pagination.showing`      | 1–25 von 656               | 1–25 of 656      | 1–25 / 656          | 1–25 из 656          |
| `formatMoney` EUR 112000         | **112.000,00 €**           | €112,000.00      | €112.000,00         | 112 000,00 €         |
| `formatMoney` USD 239171         | **239.171,00 $**           | $239,171.00      | $239.171,00         | 239 171,00 $         |
| `formatArea` 76000               | 76.000 m²                  | 76,000 m²        | 76.000 m²           | 76 000 m²            |
| `formatDistance` 450 / 1250      | 450 m / 1,3 km             | 450 m / 1.3 km   | 450 m / 1,3 km      | 450 м / 1,3 км       |
| `formatDate` 2026-07-27          | 27.07.2026                 | 07/27/2026       | 27.07.2026          | 27.07.2026           |
| `formatPercent` 0.87             | 87 %                       | 87%              | %87                 | 87 %                 |

Same USD-not-converted result the table above reports from a unit call, now confirmed through
the full render path: plugin → `getRequestConfig` → catalogue → ICU → HTML.

### 3. Locale switch preserves path + query + hash — was NOT EXERCISED, now **PASS in a real browser**

Driven against the running server by dispatching a real `change` event on the `<select>`:

```
start          http://127.0.0.1:3200/en/i18n-probe-tmp?q=test#top
switch -> de   http://127.0.0.1:3200/de/i18n-probe-tmp?q=test#top
               pathname=/de/i18n-probe-tmp   search=?q=test   hash=#top
               body re-rendered: "Quellen widersprechen sich" · "5 Wohnungen"
switch -> ru   http://127.0.0.1:3200/ru/i18n-probe-tmp?q=test#top
               body re-rendered: "5 квартир" · "239 171,00 $"
```

Path, query **and** hash all survive, and the second switch produces `/ru/...` rather than
`/de/ru/...` — the `/en/en/dashboard` accumulation bug this component exists to prevent does
not occur.

---

## Two additional verifications not in the table above

### Every message parses and formats — 2304 checks, 0 failures

`check-i18n` proves key _parity_. It does not prove the messages are valid **ICU**: a wrong
plural category is invisible to a key check and throws at render time, in one locale only.
Every message in every locale was therefore parsed and formatted through `intl-messageformat`
11.2.12 — the engine next-intl actually uses at runtime:

```
ICU parse+format: 2304 messages checked across 4 locales, 0 failures

Plural forms (1 / 2 / 5 / 21):
  de  1 Wohnung   | 2 Wohnungen | 5 Wohnungen | 21 Wohnungen
  en  1 unit      | 2 units     | 5 units     | 21 units
  tr  1 daire     | 2 daire     | 5 daire     | 21 daire
  ru  1 квартира  | 2 квартиры  | 5 квартир   | 21 квартира
```

Russian produces the three required stems and correctly returns to `квартира` at 21.

### The gate is proven to REJECT, not merely to pass

A validator nobody has watched fail is a validator nobody has tested. Each rule was injected
into fixture copies of the catalogues (via a `--dir=` flag added to `check-i18n.mjs` for exactly
this purpose) and the correct rule had to fire with exit 1:

```
PASS  rule 1  missing key         exit=1
PASS  rule 2  orphan key          exit=1
PASS  rule 3  empty value         exit=1
PASS  rule 4  placeholder drift   exit=1   "missing {page}; unexpected {seite}"
PASS  rule 5  value equals key    exit=1
PASS  rule 6  German too long     exit=1   "German is 9.00x English (36 vs 4 chars)"
PASS  rule 0b shape mismatch      exit=1
PASS  rule 0c duplicate key       exit=1   "duplicate key at de.json:5"
PASS  control: real catalogues    exit=0

9 pass · 0 fail
```

**This found two real bugs in the gate itself.** Both are fixed, and both change statements made
earlier in this document:

1. **Rule 6's floor was on the English side; it is now on the German side at 20 characters.**
   This supersedes "Decisions made" item 4 above, which describes the 12-character English floor
   as shipped in `f9bc385`. The bug: a 4-character English button (`"Save"`) beside a
   36-character German label scores 9x — the single worst overflow case there is — and a floor
   on the _English_ length skipped it silently. Moving the floor to German immediately raised 24
   findings that were all just German being German (`"Zurücksetzen"` 12 vs `"Reset"` 5 = 2.4x,
   which overflows nothing), so the floor went to 20 German characters: the point where a label
   stops fitting a button at our breakpoints. Both numbers are documented in the script with the
   reasoning. **No message text was changed to satisfy the rule.**
2. **Rule 0b did not fire on a shape mismatch.** Replacing a namespace with a string produced 33
   "missing key" errors and never named the cause. It now reports the shape fault explicitly,
   and structural errors (0a/0b/0c) sort to the top of the report so the cause is read before
   its symptoms.

`node scripts/check-i18n.mjs` remains **exit 0, 576 keys x 4, 0 errors, 0 warnings** after both
changes.

---

## Corrections to the state described above

- **`pnpm --dir apps/web lint` is now PASS, exit 0, 0 errors 0 warnings.** The table above
  records FAIL from the two `components/anim/*` findings; W1-D has since fixed them. "Requests
  for other windows" item 3 above is therefore **resolved** — no action needed.
- **`<html lang>` is still wrong**, confirmed by measurement rather than inference: `/de`,
  `/en`, `/tr` and `/ru` all serve `lang="de"`. Request 1 above stands. It proposes moving
  `<html>`/`<body>` into `app/[locale]/layout.tsx`; the smaller alternative is to keep the root
  layout and make it `async` with `<html lang={await getLocale()}>`. Either works — W0-A owns
  the file and should pick. **This remains the one Definition-of-Done item in the W1-C brief
  that could not be satisfied inside W1-C's own file ownership.**
- **The Turbopack blocker has a workaround, not a fix:** `npx next dev --webpack`. The
  underlying `0xc0000142` PostCSS-worker spawn failure was still reproducing at 18:56 with ~29
  node processes running. It is environmental and belongs to nobody's task; whoever runs the
  02:00 check should expect it while the machine is this loaded.

## New gaps found while closing the old ones

- **`[GAP]` `check-i18n` does not know the `Confidence` union.** If `CONTRACTS.md` adds a
  confidence level, nothing fails until a component renders `undefined`. Cheap fix for a later
  window: assert `evidence.confidence.*` has exactly one key per union member.
- **`[GAP]` Rule 6 compares German against English only.** A Turkish or Russian string 1.9x
  German passes silently — and the p95 table above shows that is the direction which actually
  bites here. W4-B's layout harness is the real detector; rule 6 is an early warning by design.
- **`[GAP]` The `_long` convention has exactly one instance**
  (`evidence.confidence.conflicted_long`) and so is not really exercised. A W3 window that trips
  rule 6 should read the script header before inventing a different escape hatch.

---

## W0-D — not executed by this window

The window-3 chain was `W1-C → finish W0-D`. This executor did **not** start W0-D, deliberately.

The other window-3 executor claimed W0-D in `NIGHT-LOG.md` at 18:25, reported the harvest
complete at 18:40 (1051 attempted / 1000 decoded / 51 rejected / 760 unique, selftest 8/8), and
stated it would finish encode + manifest + handoff. At 18:51 it recorded killing its own encoder
in favour of a twin run with better data — W0-D's history tonight already contains one collision
between two encoders. Its encoder was still actively writing `sources/media/encoded/*` when
checked at 18:56.

Writing `scripts/encode-images.mjs`, `apps/web/lib/media-manifest.ts`, `MEDIA-LICENSE.md` or
`HANDOFF/W0-D.md` into that is exactly the "two windows writing the same file silently lose
work" failure CLAUDE.md §3 and OVERNIGHT.md §3 exist to prevent. The decision was logged in
`NIGHT-LOG.md` rather than the work duplicated.

**`HANDOFF/W0-D.md` is still unwritten and remains the outstanding item on that task.**

---

# ADDENDUM 2 — runtime routing verified (second executor, 19:52)

The `[GAP]` above said the four locale routes were never observed rendering, because every
request 500'd on a Turbopack worker-spawn failure under memory pressure. That is now closed.
Measured against the live server on `127.0.0.1:3200`, with `app/[locale]/kitchen-sink` (W1-D's
demo route) as the positive control, since `app/[locale]/page.tsx` is still W3-A's and absent:

| Path               | Code            | `<html lang>` | Verdict                                                  |
| ------------------ | --------------- | ------------- | -------------------------------------------------------- |
| `/`                | **307** → `/de` | —             | default-locale redirect works                            |
| `/de/kitchen-sink` | **200**         | `de`          | resolves                                                 |
| `/en/kitchen-sink` | **200**         | `de`          | resolves                                                 |
| `/tr/kitchen-sink` | **200**         | `de`          | resolves                                                 |
| `/ru/kitchen-sink` | **200**         | `de`          | resolves                                                 |
| `/xx/kitchen-sink` | **404**         | —             | unknown locale 404s, does **not** fall through to German |
| `/xx/dashboard`    | **404**         | —             | ditto                                                    |

`pnpm --dir apps/web build` (exit 0, 19:28) independently lists all four as SSG:
`● /[locale]/kitchen-sink → /de|/en|/tr|/ru`, and `prerender-manifest.json` carries the same four.

## The catalogues are proven to switch, not merely to load

Counting locale-specific strings in the rendered HTML — the decisive pairs are the ones that
appear in one locale and are **absent** in the other:

| Probe                          | in `/de` | in `/en` |
| ------------------------------ | -------- | -------- |
| `Bestätigt (mehrere Quellen)`  | 1        | **0**    |
| `Confirmed (multiple sources)` | **0**    | 1        |
| `Not established`              | **0**    | 1        |

So `getRequestConfig` is loading the right catalogue per request, not defaulting to German.
(A little German does leak into `/en` — `"Quellen widersprechen sich"`, `"Nicht belegt"` appear
once each. Those are **literal German sample props hardcoded in W1-D's kitchen-sink demo page**,
not catalogue output; the catalogue-driven strings above switch cleanly. Worth W1-D tidying so
the demo does not read as an i18n bug.)

## `<html lang>` — the request to W0-A is now evidence-backed, not just reasoned

Every locale serves `<html lang="de">`, including `/en`, `/tr` and `/ru`. This is the defect
filed under "Requests for other windows" §1 above, and it is now **measured** rather than
inferred from reading the source. Screen-reader pronunciation and CSS hyphenation both read this
attribute, so three of four locales are currently mis-announced. The fix is unchanged: make
`app/layout.tsx` a pass-through and move `<html>`/`<body>` into `app/[locale]/layout.tsx`, which
already has the awaited `locale`.

## Tree state at 19:52

- `pnpm --dir apps/web typecheck` → **exit 0**
- `pnpm --dir apps/web lint` → **exit 0**, clean (the two `components/anim/*` findings reported
  above were fixed by W1-D in the interim)
- `pnpm --dir apps/web build` → **exit 0 at 19:28**; a re-run at 19:47 failed **exit 1** on
  `hooks/use-realtime-channel.ts:119` — _"Parameter 'subscribeStatus' implicitly has an 'any'
  type"_. That file is **W2-D's**, mid-flight in another window, and is not touched by W1-C or
  W0-D. Reported rather than fixed: reaching into another window's file is what
  SYSTEM-PROMPT §4.1 forbids.

---

# ADDENDUM 3 — merge convention for `messages/{de,en,tr,ru}.json`

Four windows now append to these four files concurrently. **Merge conflicts here are expected,
and the resolution is always "keep both namespaces" — never pick a side.**

Rules, so that resolution stays mechanical:

1. **Keep every key you add inside your own namespace block.** Add nothing anywhere else in the
   file, and do not reformat, re-sort or re-indent a line you did not write. A whitespace-only
   reflow turns a 6-line conflict into a whole-file one.
2. **`dashboard.*` is the one namespace with multiple claimants** (W3-B … W3-G). Contiguity
   applies at the _sub_-namespace level there: `dashboard.units.*` is W3-C's single block,
   `dashboard.finance.*` is W3-D's, and so on. Nobody edits a sibling sub-namespace.
3. **`common.*`, `nav.*` and `evidence.*` are shared surface.** Request a key rather than adding
   one — a rename in those three touches eight windows at once.
4. **Append at the same position in all four locale files.** Namespace order is currently
   identical across `de`, `en`, `tr` and `ru`; keeping it that way makes the four conflict hunks
   line up so they resolve the same way.
5. **`node scripts/check-i18n.mjs` is the backstop for a bad merge.** Rules 1 and 2 (missing key
   / orphan key) fail non-zero the moment a resolution drops one side, so a lost namespace cannot
   reach `main` quietly. Run it after every conflict resolution, not just in W4-D's gate.

W1-C itself adds nothing further to these files: the ten namespaces landed in `f9bc385` as the
structure freeze, and W0-D — the other half of this window's chain — needs no message keys
(`media-manifest.ts` carries `caption: null` rather than inventing three translations for a
caption observed in one language).
