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

Commit `f9bc385` — *"INTERNAL-107 W1-C: four-locale i18n with a gate that proves parity"*,
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

| Command | Result | Evidence |
|---|---|---|
| `node scripts/check-i18n.mjs` | **PASS**, exit 0 | `de/en/tr/ru 576 keys` each · `PASS — 0 errors, 0 warnings, identical key sets` |
| `pnpm --dir apps/web typecheck` | **PASS**, exit 0 | `tsc --noEmit`, no output |
| `pnpm --dir apps/web lint` | **FAIL**, exit 1 | 1 error + 1 warning, **both in `components/anim/*` (W1-D)**. No W1-C file is implicated — see "Known gaps" |
| `formatMoney({112000,"EUR"},"de")` | **PASS** | `"112.000,00 €"` — codepoints `… 00a0 20ac`. The separator is U+00A0, which is exactly what `Intl.NumberFormat("de-DE",{style:"currency"})` emits; the brief's literal `112.000,00 €` is the same string |
| `formatMoney({239171,"USD"},"de")` | **PASS** | `"239.171,00 $"` — `includes("€") === false`. Rendered **as USD, not converted** |
| `formatDate("2026-07-27", …)` | **PASS** | de `27.07.2026` · en `07/27/2026` · tr `27.07.2026` · ru `27.07.2026` |
| `collator("tr")` sort | **PASS** | `ısı < Istanbul < Işık < iyi < İzmir`; German orders the same five words `Işık < Istanbul < iyi < İzmir < ısı`. Dotless ı sorts before i under `tr` and does not under `de`, which is the whole point |
| `curl /` (live dev server) | **PASS** | `307 → http://127.0.0.1:3200/de` |
| `curl /de`, `/en`, `/tr`, `/ru`, `/xx/dashboard` | **NOT VERIFIED** | All returned **500**, from a Turbopack failure unrelated to i18n — see "Known gaps" |

`pnpm --dir apps/web build` — **NOT RUN.** The machine had 1.5 GB of 16 GB free with 27 node
processes (a 776-asset image encode plus three other windows), and the same memory pressure is
what broke the dev server below. Running it would have measured the machine, not the code.

---

## The frozen namespace list

Ten top-level namespaces. **Each W3-* window appends to its own namespace only.** Nobody
rewrites `common.*`, `nav.*` or `evidence.*` — those are shared surface, and a rename in them
touches eight windows at once.

| Namespace | Keys | Children |
|---|---|---|
| `common` | 94 | actions · states · errors · units · pagination · table · filters · time · boolean · required · optional |
| `nav` | 51 | brand · home · project · hotel · … · sections · groups · modules |
| `evidence` | 44 | confidence · confidenceShort · stale · modelled · sourceUnreachable · label · conflict · panel · method · disclaimer · gapNotice |
| `landing` | 55 | topBar · hero · why · immersion · amenities · desire · evidenceBand · action · after · share · love · footer |
| `dashboard` | 255 | shell · kpi · search · evidence · units · listings · leads · pipeline · finance · payments · wallet · vendorInvoices · tickets · activities · calendar · communications · documents · compliance · reports · users · admin · settings · hotel · reviews |
| `hotel` | 16 | public hotel page |
| `report` | 12 | public report flow |
| `concierge` | 18 | AI assistant, incl. `errors.*` and `suggestions.*` |
| `auth` | 21 | login · signup · forbidden |
| `legal` | 10 | privacy · terms · imprint · mediaRights |

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

| Key | de | en | tr | ru |
|---|---|---|---|---|
| `confidence.confirmed` | Bestätigt (mehrere Quellen) | Confirmed (multiple sources) | Doğrulandı (birden çok kaynak) | Подтверждено (несколько источников) |
| `confidence.conflicted` | Quellen widersprechen sich | Sources disagree | Kaynaklar çelişiyor | Источники расходятся |
| `confidence.gap` | Nicht belegt | Not established | Belgelenmedi | Не подтверждено |
| `evidence.stale` | Veraltetes Inserat | Stale listing | Güncelliğini yitirmiş ilan | Устаревшее объявление |
| `evidence.sourceUnreachable` | Quelle nicht erreichbar | Source unreachable | Kaynağa ulaşılamadı | Источник недоступен |
| **`evidence.modelled`** | Modellierter Datensatz — kein reales Inserat | Modelled record — not a real listing | Modellenmiş kayıt — gerçek bir ilan değildir | Смоделированная запись — не реальное объявление |

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
|---|---|---|---|---|---|
| de | 10,708 | 1.000 | 1.00 | 1.00 | 160 |
| en | 9,642 | 0.905 | 1.23 | 1.73 | 134 |
| tr | 9,173 | 0.869 | 1.36 | 1.87 | 151 |
| ru | 10,608 | 0.985 | **1.50** | **2.00** | 131 |

**The number to size components against is Russian at p95 = 1.50× German, worst case 2.00×.**
German is *not* the widest locale here — the brief warned that German runs ~30% longer than
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
   a 404. So `request.ts` falls back to German *only so the 404 page has messages to render
   with*, and `layout.tsx` calls `notFound()`. The brief's requirement — an unknown locale must
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
  path *without* the locale prefix) plus `useSearchParams()` and `window.location.hash`, which
  is the correct shape and cannot produce `/en/en/dashboard`. Blocked by the same 500.
- **`[GAP]` No Cyrillic glyph-coverage check was run by me.** W1-D's NIGHT-LOG entry states the
  self-hosted Manrope/Playfair subsets include Cyrillic ("7 woff2, 134KB, Cyrillic verified
  present"); I did not re-verify it, and a missing glyph renders as a box silently.
- **`prefers-reduced-motion`, tap targets, contrast** — not W1-C's scope; W4-B's layout harness.
- `pnpm --dir apps/web build` not run (reason above).
