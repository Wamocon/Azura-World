/**
 * Proper nouns that must render VERBATIM in every locale.
 *
 * Mirrors `D:\Real Estate CRM\Cati\apps\web\lib\proper-nouns.ts`, with one
 * change: the list itself lives in `proper-nouns.json` so that
 * `scripts/check-i18n.mjs` — a plain-node script with no TypeScript loader —
 * reads exactly the same data. Two hand-maintained copies of a "never translate
 * this" list is how a brand name ends up machine-translated in one locale only.
 *
 * Two jobs:
 *
 *  1. **Guard.** Copy that reaches the UI through a translation or an AI answer
 *     can carry a localised variant of the brand ("Azura Dünya", "Азура Уорлд").
 *     `pinProperNoun` / `pinProperNouns` normalise those back.
 *  2. **Allowlist.** `check-i18n` rule 5 flags a value equal to its key as an
 *     unfilled stub. `dashboard.listings.columns.portal: "Portal"` is not a stub,
 *     it is the word. `sharedTerms` is what stops that false positive.
 *
 * NOT in here, deliberately: the Turkish unit notation `1+1` and district names.
 * They are proper nouns of the market and are never passed through a translation
 * layer at all — they arrive from the dataset and are rendered as-is. See
 * `layoutNotes` in the JSON.
 */

import properNounData from "./proper-nouns.json"

/** Brand and place names that never change form across locales. */
export const properNouns: readonly string[] = properNounData.properNouns

/** Words that are legitimately identical in several locales (`Portal`, `m²`). */
export const sharedTerms: readonly string[] = properNounData.sharedTerms

/** Known localised variant → canonical form. */
const variants: Readonly<Record<string, string>> = properNounData.variants

/**
 * Exact-match guard. If the whole (trimmed) value is a canonical proper noun or
 * a known localised variant of one, returns the canonical form; otherwise null.
 */
export function pinProperNoun(value: string): string | null {
  const trimmed = value.trim()
  if (properNouns.includes(trimmed)) return trimmed
  return variants[trimmed] ?? null
}

/**
 * Substring guard. Replaces any known localised variant appearing inside a
 * larger string with the canonical form, leaving surrounding copy untouched.
 *
 * Variants are matched longest-first so a shorter variant can never partially
 * consume a longer one — "Azura World" must not eat the "Azura World Residence
 * & Hotel" it sits inside.
 */
export function pinProperNouns(value: string): string {
  let result = value
  for (const variant of Object.keys(variants).sort(
    (a, b) => b.length - a.length
  )) {
    const canonical = variants[variant]
    if (canonical !== undefined && result.includes(variant)) {
      result = result.split(variant).join(canonical)
    }
  }
  return result
}

/**
 * True when a string is entirely a proper noun or shared term — the question
 * `check-i18n` asks before deciding that an untranslated-looking value is a bug.
 *
 * Case-folded with the invariant locale on purpose: `"I".toLocaleLowerCase("tr")`
 * is `"ı"`, which would make `isProperNoun("INTERNAL-107")` depend on the user's
 * locale (CONVENTIONS §5, Turkish dotted/dotless i).
 */
export function isProperNoun(value: string): boolean {
  const lowered = value.trim().toLocaleLowerCase("en-US")
  return (
    properNouns.some((term) => term.toLocaleLowerCase("en-US") === lowered) ||
    sharedTerms.some((term) => term.toLocaleLowerCase("en-US") === lowered)
  )
}
