/**
 * Locale-correct formatting.
 *
 * Everything here goes through `Intl`. No string concatenation, no manual
 * thousands separators, no `toFixed(2) + " €"`. German writes `112.000,50 €`
 * and English writes `€112,000.50` — the separators are *inverted*, so a
 * hand-rolled formatter that looks right in one locale is a 1000x error in the
 * other (CONVENTIONS §5).
 *
 * ## The rule that matters most: currencies are never converted
 *
 * `formatMoney` renders a `Money` in the currency it carries. Housearch quotes
 * USD for units that other portals quote in EUR; showing that USD figure with a
 * € sign would be a fabricated number, which SYSTEM-PROMPT §2.3 rules out
 * absolutely. There is deliberately no `convert` function in this module and
 * there must not be one added without a dated rate and a visible label.
 *
 * ## Time zone
 *
 * Dates are formatted in `Europe/Istanbul` — the project's own zone, matching
 * `i18n/request.ts`. Not the server's zone and not the viewer's: a date rendered
 * on the server and re-rendered on the client must produce identical text or
 * React reports a hydration mismatch, and "which day did the site experience"
 * is the question a dashboard is actually asking.
 */

import { defaultLocale, locales } from "./contracts"
import type { Locale, Money } from "./contracts"
import { collatorFor } from "./utils"

/**
 * App locale → BCP-47 tag.
 *
 * `en` maps to `en-US` rather than `en-GB` on purpose: the W1-C brief pins the
 * English date format as `07/27/2026`, which is the US order. `de-DE`, `tr-TR`
 * and `ru-RU` all render `27.07.2026`.
 */
const INTL_LOCALE: Readonly<Record<Locale, string>> = {
  de: "de-DE",
  en: "en-US",
  tr: "tr-TR",
  ru: "ru-RU",
}

/** The project's own time zone. Türkiye has had no DST since 2016, so this is
 *  a fixed UTC+03:00 and never shifts under a formatted date. */
export const PROJECT_TIME_ZONE = "Europe/Istanbul" as const

/** Resolves an app locale to the BCP-47 tag `Intl` expects. */
export function intlLocale(locale: Locale): string {
  // `locale` is typed `Locale` and is not always one at runtime: Next hands a
  // route segment through as `params.locale`, and a page may declare that field
  // `Locale` without anything having verified it — the paragraph under
  // `isLocale` says exactly this. A bare lookup then returns `undefined`, and a
  // *malformed* value reaches `Intl.DateTimeFormat` and throws RangeError
  // "Incorrect locale information provided", which surfaces as a 500 on a page
  // whose only fault was a bad URL. Observed once in the server log on
  // 2026-08-04 from `[locale]/page`.
  //
  // `intlLocaleTag` next to this already validates and falls back; this is the
  // same guarantee for the function the date and money formatters use.
  return INTL_LOCALE[locale] ?? INTL_LOCALE[defaultLocale]
}

/**
 * Is this string one of the four locales? A real runtime check, not a cast.
 *
 * Next hands a route segment through as `params.locale`, and a page may
 * *declare* that field `Locale` without anything having verified it. The
 * declaration is a promise about the URL that the URL never made.
 */
export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (locales as readonly string[]).includes(value)
  )
}

/**
 * Any string at all → a BCP-47 tag `Intl` accepts. **Never throws.**
 *
 * ## Why this exists
 *
 * `HANDOFF/F1.md` F1-002: `RangeError: Incorrect locale information provided`,
 * thrown out of the landing page in production. Three sections were calling
 * `new Intl.DateTimeFormat(locale)` / `new Intl.NumberFormat(locale)` with the
 * **raw route segment**, and `Intl` rejects anything that is not a structurally
 * well-formed language tag.
 *
 * The trigger is not an exotic locale. Measured against this Node:
 *
 * ```
 * "de" "en" "tr" "ru" "xx" "wp-admin"   ok      (structurally valid tags)
 * "favicon.ico" "robots.txt" "index.php" ".well-known"
 * "apple-touch-icon.png" "de_DE" "de-" "" " " "a" "123"   RangeError
 * ```
 *
 * So every browser asking for `/favicon.ico` and every crawler asking for
 * `/index.php` threw inside the landing page. The response was a 404 only
 * because `app/[locale]/layout.tsx` calls `notFound()` and won the race; the
 * page function still threw, on every one of those requests, in production.
 *
 * ## Why a guard and not just the right tag
 *
 * Passing `intlLocale(locale)` fixes the tag for the four locales we know. It
 * does nothing for the fifth string, and there is always a fifth string,
 * because the argument is a URL segment. The brief's rule is the one that
 * matters: **a landing page that throws on one locale is a dead page for that
 * market**, so an unrecognised locale has to degrade to the default rather than
 * take the page down.
 *
 * ## Why the tag is re-verified
 *
 * The last branch looks paranoid and is not. `INTL_LOCALE` is a hand-maintained
 * map; a locale added to `CONTRACTS.md` §7 without an entry here yields
 * `undefined`, and a typo yields a malformed tag. Both would put the original
 * `RangeError` back, in a module whose whole purpose is that it cannot happen.
 * The check runs once per distinct input and is cached.
 */
const resolvedTags = new Map<string, string>()

export function intlLocaleTag(value: string): string {
  const cached = resolvedTags.get(value)
  if (cached !== undefined) return cached

  const candidate = isLocale(value)
    ? INTL_LOCALE[value]
    : INTL_LOCALE[defaultLocale]

  let tag: string
  try {
    // Throws on a malformed tag, exactly as the `Intl` constructors do, so a
    // broken map entry is caught here instead of at a render.
    tag = Intl.getCanonicalLocales(candidate)[0] ?? INTL_LOCALE[defaultLocale]
  } catch {
    tag = INTL_LOCALE[defaultLocale]
  }

  resolvedTags.set(value, tag)
  return tag
}

// ---------------------------------------------------------------------------
// Instance caches
//
// Constructing an Intl formatter parses locale data and is expensive enough to
// matter inside a 656-row table. These are keyed by locale plus options, and
// the set of distinct keys is bounded by the code paths below.
// ---------------------------------------------------------------------------

const numberFormatters = new Map<string, Intl.NumberFormat>()
const dateFormatters = new Map<string, Intl.DateTimeFormat>()
const collators = new Map<string, Intl.Collator>()

function numberFormatter(
  locale: Locale,
  options: Intl.NumberFormatOptions
): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`
  const cached = numberFormatters.get(key)
  if (cached !== undefined) return cached
  const created = new Intl.NumberFormat(intlLocale(locale), options)
  numberFormatters.set(key, created)
  return created
}

function dateFormatter(
  locale: Locale,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`
  const cached = dateFormatters.get(key)
  if (cached !== undefined) return cached
  const created = new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: PROJECT_TIME_ZONE,
    ...options,
  })
  dateFormatters.set(key, created)
  return created
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Renders an amount **in its own currency**. Never converts.
 *
 * `formatMoney({ amount: 112000, currency: "EUR" }, "de")` → `112.000,00 €`
 * `formatMoney({ amount: 239171, currency: "USD" }, "de")` → `239.171,00 $`
 *
 * The second case is the important one: a German-locale page showing a
 * Housearch price renders it as dollars, because that is what the source said.
 */
export function formatMoney(money: Money, locale: Locale): string {
  return numberFormatter(locale, {
    style: "currency",
    currency: money.currency,
  }).format(money.amount)
}

/**
 * Money without the fractional part, for headline figures and axis labels where
 * `112.000,00 €` is noise. Same no-conversion rule.
 */
export function formatMoneyCompact(money: Money, locale: Locale): string {
  return numberFormatter(locale, {
    style: "currency",
    currency: money.currency,
    maximumFractionDigits: 0,
  }).format(money.amount)
}

// ---------------------------------------------------------------------------
// Numbers, area, distance
// ---------------------------------------------------------------------------

/** Plain number with locale separators. `76000` → `76.000` (de) / `76,000` (en). */
export function formatNumber(value: number, locale: Locale): string {
  return numberFormatter(locale, {}).format(value)
}

/**
 * A ratio expressed as a percentage. Pass `0.87`, not `87` — `Intl` multiplies
 * by 100 itself, and passing the already-multiplied number is the classic way
 * to ship "8700 %".
 */
export function formatPercent(
  ratio: number,
  locale: Locale,
  fractionDigits = 0
): string {
  return numberFormatter(locale, {
    style: "percent",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(ratio)
}

/**
 * Floor area. `76000` → `76.000 m²` (de) / `76,000 m²` (en).
 *
 * The symbol is appended rather than produced by `style: "unit"` because
 * `square-meter` is **not** in ECMA-402's sanctioned unit list — passing it
 * throws `RangeError`. Only the unit symbol is concatenated; the number itself
 * still goes through `Intl`, so the separators stay correct. `m²` is the SI
 * symbol and is identical in all four locales (it is also `common.units.sqm`).
 *
 * The separator is a non-breaking space: `76.000` and `m²` must never end up on
 * different lines of a table cell.
 */
export function formatArea(sqm: number, locale: Locale): string {
  const value = numberFormatter(locale, {
    maximumFractionDigits: Math.abs(sqm) < 1000 ? 1 : 0,
  }).format(sqm)
  return `${value} m²`
}

/**
 * Distance, switching unit at 1 km. `450` → `450 m`; `1250` → `1,3 km` (de).
 *
 * Below a kilometre the metre value is rounded to a whole number — a beach
 * distance of "487,3 m" claims a precision no source provides.
 */
export function formatDistance(metres: number, locale: Locale): string {
  if (Math.abs(metres) < 1000) {
    return numberFormatter(locale, {
      style: "unit",
      unit: "meter",
      unitDisplay: "short",
      maximumFractionDigits: 0,
    }).format(Math.round(metres))
  }
  return numberFormatter(locale, {
    style: "unit",
    unit: "kilometer",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(metres / 1000)
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * An unparseable date string is returned unchanged rather than replaced with a
 * dash. A dash is this project's rendering of an honest gap (`confidence:
 * "gap"`); showing one for a malformed value would disguise a parser bug as
 * missing data, which is the exact confusion SYSTEM-PROMPT §2.3 exists to stop.
 */
function toDate(iso: string): Date | null {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

/** `2026-07-27` → `27.07.2026` (de · tr · ru) / `07/27/2026` (en). */
export function formatDate(iso: string, locale: Locale): string {
  const date = toDate(iso)
  if (date === null) return iso
  return dateFormatter(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date)
}

/** Date plus 24-hour time, in the project's zone. */
export function formatDateTime(iso: string, locale: Locale): string {
  const date = toDate(iso)
  if (date === null) return iso
  return dateFormatter(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)
}

/** Long form for prose: `27. Juli 2026` / `July 27, 2026`. */
export function formatDateLong(iso: string, locale: Locale): string {
  const date = toDate(iso)
  if (date === null) return iso
  return dateFormatter(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date)
}

// ---------------------------------------------------------------------------
// Collation
// ---------------------------------------------------------------------------

/**
 * Locale-aware comparator. **Use this, never bare `localeCompare()`.**
 *
 * Turkish is the reason. Verified on Node 22.14: the same five words sort
 * `Çamlık < Istanbul < Işık < İzmir < Öz` under `tr-TR` and
 * `Çamlık < Işık < Istanbul < İzmir < Öz` under `en-US`. A unit list sorted the
 * second way looks broken to exactly the audience that would notice
 * (CONVENTIONS §5).
 *
 * Delegates to `collatorFor` in `lib/utils.ts` rather than constructing its
 * own — W0-A already owns that implementation, and CONVENTIONS forbids a second
 * way to do something that already has one. What this adds is the two things
 * `collatorFor` cannot know about: the app-`Locale` → BCP-47 mapping (`"en"` is
 * `"en-US"` here), and a cache, because a comparator built inside a sort
 * callback is reconstructed once per comparison.
 *
 * `numeric: true` (inherited from `collatorFor`) makes `AZW-B02-0009` sort
 * before `AZW-B02-0010` instead of after it, which is what unit ids need.
 */
export function collator(locale: Locale): Intl.Collator {
  const cached = collators.get(locale)
  if (cached !== undefined) return cached
  const created = collatorFor(intlLocale(locale))
  collators.set(locale, created)
  return created
}

/** Convenience wrapper for `Array.prototype.sort`. */
export function compareStrings(a: string, b: string, locale: Locale): number {
  return collator(locale).compare(a, b)
}

/**
 * Case folding for identifiers, slugs and lookup keys — **never** for display.
 *
 * `"I".toLowerCase()` is `"ı"` under a Turkish locale and `"i"` everywhere
 * else, so a case-folded comparison of the same identifier can succeed for a
 * German user and fail for a Turkish one. Pinning to `en-US` makes the result
 * independent of who is looking at it. Display text uses
 * `toLocaleLowerCase(intlLocale(locale))` instead, deliberately.
 */
export function foldInvariant(value: string): string {
  return value.toLocaleLowerCase("en-US")
}
