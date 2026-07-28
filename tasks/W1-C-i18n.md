# W1-C — Internationalisation (de · en · tr · ru)

**Wave:** 1 · **Depends on:** W0-A · **Blocks:** every W3-* surface · **Runs with:** W1-A, W1-B, W1-D

> Read `SYSTEM-PROMPT.md`, `CONVENTIONS.md`, `CONTRACTS.md` §7 first. Then read
> `D:\Real Estate CRM\Cati\apps\web\i18n.ts`, `messages\de.json`, and
> `components\locale-switcher.tsx`.

---

## Mission

Four locales with **German as default** — the ticket is German and 5 of 7 portal sources are
German-language. Every W3-* window writes copy against your key structure, so the structure has
to be right before wave 3 opens; renaming keys later touches eight windows at once.

The honesty rule from the Ataberg rebuild applies here: _an English fallback is honest, a
machine-translated string only looks finished._ Where you cannot produce good copy in a locale,
fall back visibly and record it — do not ship plausible-looking machine output.

---

## Files you own

```
apps/web/i18n.ts · apps/web/i18n/{routing,request,navigation}.ts
apps/web/messages/{de,en,tr,ru}.json
apps/web/app/navigation.ts
apps/web/components/locale-switcher.tsx
apps/web/lib/language-detection.ts · apps/web/lib/format.ts
scripts/check-i18n.mjs
HANDOFF/W1-C.md
```

---

## Deliverables

### 1. Routing

```ts
export const locales = ["de", "en", "tr", "ru"] as const;
export const defaultLocale = "de";
export const localePrefix = "always";
```

Import from `lib/contracts.ts` — do not redeclare. `localePrefix: "always"` means every URL
carries its locale; there is no bare `/dashboard`.

### 2. Message structure — freeze this now

Namespace by surface so eight wave-3 windows can write in parallel without collisions:

```
common.*          buttons, states, errors, units of measure
nav.*             navigation labels
landing.*         hero, why, amenities, desire, action, share, love
evidence.*        source labels, confidence levels, conflict wording
dashboard.*       shell, KPIs
dashboard.units.*        dashboard.finance.*     dashboard.tickets.*
dashboard.hotel.*        dashboard.reviews.*     dashboard.evidence.*
hotel.*           public hotel page
report.*          public report flow
concierge.*       AI assistant
legal.*           privacy, terms, impressum
```

**Ownership within messages:** each W3-* window appends to its own namespace only. Say this in
your handoff so nobody rewrites `common.*`.

### 3. Evidence vocabulary — the Azura-specific part

The provenance UI needs precise wording in four languages. Get these right; they carry the
project's credibility:

| Key                                 | de                                           | en                                   |
| ----------------------------------- | -------------------------------------------- | ------------------------------------ |
| `evidence.confidence.confirmed`     | Bestätigt (mehrere Quellen)                  | Confirmed (multiple sources)         |
| `evidence.confidence.official`      | Offizielle Angabe                            | Official statement                   |
| `evidence.confidence.single_source` | Einzelquelle                                 | Single source                        |
| `evidence.confidence.conflicted`    | **Quellen widersprechen sich**               | **Sources disagree**                 |
| `evidence.confidence.inferred`      | Abgeleitet                                   | Inferred                             |
| `evidence.confidence.gap`           | Nicht belegt                                 | Not established                      |
| `evidence.stale`                    | Veraltetes Inserat                           | Stale listing                        |
| `evidence.modelled`                 | Modellierter Datensatz — kein reales Inserat | Modelled record — not a real listing |
| `evidence.sourceUnreachable`        | Quelle nicht erreichbar                      | Source unreachable                   |

`evidence.modelled` matters most: it is the string that stops a synthesised unit being read as a
real listing. It must be unambiguous in all four languages.

### 4. `lib/format.ts` — locale-correct formatting

```ts
export function formatMoney(m: Money, locale: Locale): string;
export function formatArea(sqm: number, locale: Locale): string;
export function formatDate(iso: string, locale: Locale): string;
export function formatDistance(metres: number, locale: Locale): string;
export function collator(locale: Locale): Intl.Collator;
```

- `Intl.NumberFormat` with `style: "currency"`, never string concatenation.
- **Never convert currencies.** Render `Money` in its own currency. Housearch quotes USD; showing
  it as EUR without a dated rate is a fabricated number.
- `collator("tr")` for Turkish sorting — `Intl.Collator("tr")`, not `localeCompare()` default.

### 5. `scripts/check-i18n.mjs`

Exits non-zero on:

1. A key in `de.json` missing from any other locale
2. A key present in a non-default locale but absent from `de.json` (orphan)
3. An empty string value
4. Placeholder mismatch — `{count}` in `de` but `{anzahl}` in `en`
5. A value identical to the key (an unfilled stub)
6. Any German string > 1.4× its English counterpart **without** a `_long` variant — this is the
   layout-overflow early warning

Run it in W4-D's gate.

### 6. Locale switcher

Build the target URL by **replacing the locale segment**, not by prefixing. 1Çatı carries an
explicit comment about this: naive prefixing produces `/en/en/dashboard`. Preserve the path,
query string, and hash across the switch.

---

## Edge cases

- **German runs ~30% longer than English.** `"Quellen widersprechen sich"` vs `"Sources disagree"`.
  Every button and table header must survive it. Ataberg's layout harness found a Russian header
  colliding with the hero — the same class of bug.
- **Russian runs longer still** (~35%) and needs Cyrillic glyph coverage in the chosen font.
  Verify the subset actually contains Cyrillic; a missing glyph renders as a box, silently.
- **Turkish dotted/dotless i.** `"I".toLowerCase()` is `"ı"` under a Turkish locale and `"i"`
  otherwise. Use invariant casing for keys and identifiers; Turkish casing only for display.
- **German number format:** `112.000,50 €` — dot is thousands, comma is decimal. Exactly inverted
  from English. A misparse here is a 1000× error on a price.
- **Turkish unit notation `1+1`** is not translated. It is a proper noun of the market. Same for
  district names — `Türkler` stays `Türkler` in all four locales.
- **Pluralisation:** Russian has 3 plural forms (one/few/many). Use ICU plural syntax, not
  `count === 1 ? a : b`.
- **`<html lang>`** must track the active locale for screen readers and hyphenation.
- **Date format:** `27.07.2026` (de/ru) vs `07/27/2026` (en) vs `27.07.2026` (tr). Always `Intl`.
- **Untranslatable proper nouns** — "Azura World Residence & Hotel", "Cebeci Group A.Ş.",
  "Tripadvisor" — keep a `proper-nouns.ts` allowlist so `check-i18n` does not flag them as stubs.
  1Çatı has exactly this file; mirror it.
- **Locale in the 404 path**: an unknown locale must 404 cleanly, not fall through to `de`
  silently — that would make typos invisible.

---

## Definition of done

```bash
pnpm --dir apps/web typecheck
pnpm --dir apps/web lint
node scripts/check-i18n.mjs        # exits 0
```

Plus, output pasted:

- All four message files present with **identical key sets** (print the count)
- `/de`, `/en`, `/tr`, `/ru` all resolve; `/` redirects to `/de`
- `/xx/dashboard` 404s rather than silently serving German
- Locale switch from `/en/dashboard/units?q=test#top` preserves path, query and hash
- `formatMoney({amount: 112000, currency: "EUR"}, "de")` → `112.000,00 €`
- `formatMoney({amount: 239171, currency: "USD"}, "de")` → renders **as USD**, not converted

---

## Handoff must state

- The frozen namespace list, and the rule that each W3-* window appends only to its own
- Which strings are real translations vs English fallbacks — **be honest about this**. Mark
  fallbacks explicitly; a machine-translated German ERP string will read as wrong to the client.
- The `proper-nouns.ts` allowlist contents
- Measured longest-string ratio per locale vs German, so W1-D can size components
