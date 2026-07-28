/**
 * Display formatting for provenance values.                Owner: W1-D
 *
 * SCOPE: this exists to render a `SourcedFact`'s value, and nothing else.
 * `lib/format.ts` is W1-C's file and is the app's general formatting module;
 * when it lands, `ProvenanceValue`'s `format` prop accepts a plain function, so
 * a caller passes W1-C's formatter and these presets stop being used. Two
 * general formatting modules would be the "second way to do something that
 * already has one" that CONVENTIONS forbids — hence the deliberately narrow
 * scope here and the request in HANDOFF/W1-D.md.
 *
 * CURRENCY IS NEVER CONVERTED. `Money` carries its currency and is rendered in
 * it. Portals quote the same unit in EUR and USD (F-002), and converting would
 * require a rate and a rate date that no source provides. A silently converted
 * price is a fabricated number wearing a citation.
 */

import type { Money } from "@/lib/contracts"

/**
 * Substitutes `{name}` placeholders in a label.
 *
 * Every label in the provenance components is a STRING WITH PLACEHOLDERS, not
 * a formatting function, and that is a hard constraint rather than a style
 * preference: these components are `"use client"` and their callers are Server
 * Components, and React cannot serialise a function across that boundary. A
 * `(count: number) => string` prop throws "Functions cannot be passed directly
 * to Client Components" the first time a W3-* window renders one from a page.
 *
 * It also happens to be the shape next-intl messages already have, so the
 * labels drop straight in from `messages/*.json` with no adapter.
 */
export function interpolate(
  template: string,
  values: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key]
    return value === undefined ? match : String(value)
  })
}

/**
 * Builds the href for a stored snapshot.
 *
 * A base path plus a hash, rather than a `(hash) => string` callback — same
 * serialisation constraint as `interpolate` above.
 */
export function snapshotUrl(basePath: string, snapshotHash: string): string {
  return `${basePath.replace(/\/$/, "")}/${snapshotHash}`
}

/** Built-in presets. Anything else: pass a function. */
export type ProvenanceFormat =
  | "text"
  | "number"
  | "area"
  | "money"
  | "date"
  | "percent"
  | "metres"
  | "kilometres"
  | "stars"

function isMoney(value: unknown): value is Money {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Money).amount === "number" &&
    typeof (value as Money).currency === "string"
  )
}

/**
 * Money in its own currency, never converted, never rounded to a lie.
 *
 * `maximumFractionDigits: 0` because every observed price is a whole unit and
 * "€ 112.000,00" is noise; the cents were never in the source.
 */
export function formatMoney(money: Money, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: money.currency,
    maximumFractionDigits: 0,
  }).format(money.amount)
}

function formatNumber(
  value: number,
  locale: string,
  maximumFractionDigits = 0
): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value)
}

/**
 * Renders a fact's value for display.
 *
 * Returns `null` for `null` — the caller decides what absence looks like, and
 * for a `gap` that is the em dash plus "Nicht belegt", never `0` and never an
 * empty string. Formatting a missing value into "0 m²" is the single most
 * damaging bug this component library could ship.
 */
export function formatFactValue(
  value: unknown,
  format: ProvenanceFormat,
  locale: string
): string | null {
  if (value === null || value === undefined) return null

  switch (format) {
    case "text":
      return typeof value === "string" ? value : String(value)

    case "number":
      return typeof value === "number" ? formatNumber(value, locale) : String(value)

    case "area":
      return typeof value === "number"
        ? `${formatNumber(value, locale)} m²`
        : String(value)

    case "money":
      return isMoney(value) ? formatMoney(value, locale) : String(value)

    case "metres":
      return typeof value === "number"
        ? `${formatNumber(value, locale)} m`
        : String(value)

    case "kilometres":
      return typeof value === "number"
        ? `${formatNumber(value, locale, 1)} km`
        : String(value)

    case "percent":
      return typeof value === "number"
        ? new Intl.NumberFormat(locale, {
            style: "percent",
            maximumFractionDigits: 1,
          }).format(value / 100)
        : String(value)

    case "stars":
      return typeof value === "number" ? `${formatNumber(value, locale, 1)} ★` : String(value)

    case "date": {
      if (typeof value !== "string") return String(value)
      const parsed = Date.parse(value)
      // An unparseable date renders raw rather than as "Invalid Date". The
      // string came from a source; showing it is honest and surfaces the
      // parser bug instead of hiding it.
      if (Number.isNaN(parsed)) return value
      return new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(new Date(parsed))
    }
  }
}

/**
 * The numeric span across a conflicted fact's competing values, when one can
 * honestly be computed.
 *
 * Returns `null` — meaning "show the single display value plus the badge, not
 * a range" — whenever a range would be a lie:
 *   · fewer than two comparable numbers
 *   · more than one currency among them (EUR 185.000 – USD 239.171 is not a
 *     range, it is two numbers in different units)
 *   · every value identical, so there is nothing to span
 */
export function conflictRange(
  values: readonly unknown[],
  locale: string,
  format: ProvenanceFormat
): string | null {
  const currencies = new Set<string>()
  const numbers: number[] = []

  for (const value of values) {
    if (typeof value === "number") {
      numbers.push(value)
    } else if (isMoney(value)) {
      numbers.push(value.amount)
      currencies.add(value.currency)
    }
  }

  if (numbers.length < 2) return null
  if (currencies.size > 1) return null

  const min = Math.min(...numbers)
  const max = Math.max(...numbers)
  if (min === max) return null

  const currency = currencies.values().next().value
  if (currency !== undefined) {
    const lo = formatMoney({ amount: min, currency } as Money, locale)
    const hi = formatMoney({ amount: max, currency } as Money, locale)
    return `${lo} – ${hi}`
  }

  const lo = formatFactValue(min, format, locale)
  const hi = formatFactValue(max, format, locale)
  return lo !== null && hi !== null ? `${lo} – ${hi}` : null
}
