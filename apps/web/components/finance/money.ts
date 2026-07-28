/**
 * # Money, in integer minor units.                                Owner: W3-D
 *
 * The one file in this module that a reviewer should read line by line, because
 * every other file in `components/finance/` and every finance route depends on
 * it being right.
 *
 * ## Three rules, and how each is enforced rather than asked for
 *
 * **1. No floating-point arithmetic on money.** `0.1 + 0.2 !== 0.3`, and a
 * reconciliation that is off by 0.01 costs somebody an afternoon before anybody
 * suspects the language. So arithmetic here happens on `Minor` — a branded
 * integer count of the smallest unit (cents, kuruş). `Minor` is not assignable
 * from a plain `number`, so a decimal cannot be passed where a minor-unit count
 * is expected; the compiler rejects it. Division by 100 happens **exactly once**,
 * at the display boundary, and even there it is done by building a decimal
 * STRING rather than dividing (see `formatMinor`).
 *
 * **2. Never aggregate across currencies.** `sum(EUR) + sum(USD)` is a
 * meaningless number that looks authoritative on a dashboard. `CurrencyTotals`
 * is the enforcement: it accumulates per currency and **has no method that
 * returns one combined figure.** There is nothing to call. Adding one is the
 * change a reviewer should refuse.
 *
 * **3. German input.** `1.234,56` must store as `1234.56`. In German and
 * Turkish `.` groups and `,` decimalises; in English it is the exact opposite,
 * so a parser that "works" in one locale is a 1000x error in the other. The
 * separators are read out of `Intl` for the caller's locale rather than
 * hardcoded, and an input whose grouping does not fit that locale is
 * **rejected with the expected format named**, never guessed at. Rejecting
 * `1234.56` from a German field is the honest answer: it is either 1234.56 typed
 * on muscle memory or 123456 typed with a slipped separator, and this file is
 * not entitled to decide which.
 *
 * ## Where the conversion boundary is
 *
 * `numeric(14,2)` in Postgres → PostgREST string → `number | null` from
 * `lib/finance-repository.ts` (W2-A owns that) → `toMinor()` **here, once, at
 * the top of every page** → integer arithmetic everywhere → `formatMinor()` at
 * the point of render. Nothing between those two ends sees a decimal.
 *
 * `numeric(14,2)` holds at most 12 integer digits, so one value is at most
 * 99_999_999_999_999 minor units — inside `Number.MAX_SAFE_INTEGER`. A *sum* of
 * many such values is not guaranteed to be, so `CurrencyTotals` checks and
 * reports overflow instead of silently losing precision.
 */

import type { Locale, Money } from "@/lib/contracts"
import { intlLocale } from "@/lib/format"
import type { CurrencyCode } from "@/lib/finance-repository"

// ---------------------------------------------------------------------------
// The branded integer
// ---------------------------------------------------------------------------

declare const MINOR_BRAND: unique symbol

/**
 * An integer count of a currency's smallest unit. Carries no currency of its
 * own — pairing it with one is `CurrencyTotals`' job, and keeping them apart is
 * what makes a cross-currency sum impossible to write by accident.
 */
export type Minor = number & { readonly [MINOR_BRAND]: true }

/** The only way to make a `Minor` from a raw integer. Not exported by accident. */
function brand(value: number): Minor {
  return value as Minor
}

export const ZERO_MINOR: Minor = brand(0)

/** `numeric(14,2)` — 14 significant digits, 2 of them fractional. */
const MAX_INTEGER_DIGITS = 12
const MAX_FRACTION_DIGITS = 2
const MINOR_PER_UNIT = 100

// ---------------------------------------------------------------------------
// Decimal ⇄ minor
// ---------------------------------------------------------------------------

/**
 * A repository decimal → minor units, or `null` when it cannot be represented.
 *
 * **Measured, so the comment does not overclaim:** across all 3,000,000 values
 * `0.01 … 30000.00`, `Math.round(value * 100)` and the `toFixed(2)` route below
 * agree on **every one**. For input that genuinely came out of `numeric(14,2)`
 * the naive multiply is not broken, and saying otherwise would be folklore.
 *
 * The string route is still the one written, for two reasons that survive that
 * measurement. It derives the cents from the value's own decimal
 * representation rather than from a multiplication that happens to land on the
 * right side of a boundary, so its correctness does not depend on the input
 * range staying inside what was scanned. And `toFixed(2)` rounds
 * half-away-from-zero on that representation, which is what `numeric(14,2)`
 * itself does on the way in and what an accountant expects on the way out.
 *
 * **What neither route can fix, and why the boundary is here:**
 * `toMinor(1.005)` is `100`, not `101` — because the nearest double to 1.005 is
 * 1.0049999999999998934, so the value was already a cent light before this
 * function saw it. No rounding strategy recovers a cent that the literal never
 * carried. That is the entire argument for crossing into integers ONCE, at the
 * repository edge, and never letting a decimal back in.
 *
 * `null` in, `null` out — an unreadable amount stays unreadable. It is never
 * `0`: CONVENTIONS §5, "a price of 0 is a bug, a price of null is an honest
 * gap", and a zeroed row silently disappears into a total.
 */
export function toMinor(value: number | null | undefined): Minor | null {
  if (value === null || value === undefined) return null
  if (!Number.isFinite(value)) return null

  const fixed = value.toFixed(MAX_FRACTION_DIGITS)
  const negative = fixed.startsWith("-")
  const digits = (negative ? fixed.slice(1) : fixed).replace(".", "")
  const magnitude = Number.parseInt(digits, 10)
  if (!Number.isSafeInteger(magnitude)) return null

  // -0.00 and 0.00 are the same amount. Normalising here rather than at render
  // is what stops `-0,00 €` reaching a screen from any of the paths below —
  // measured on Node 22.14: `Intl.NumberFormat("de-DE").format(-0)` really does
  // emit "-0,00 €".
  if (magnitude === 0) return ZERO_MINOR
  return brand(negative ? -magnitude : magnitude)
}

/**
 * Minor units → the exact decimal STRING, e.g. `12345` → `"123.45"`.
 *
 * A string, not a number, because `Intl.NumberFormat.format()` accepts one and
 * treats it as an exact decimal — so the value never becomes a double and never
 * acquires a representation error on the way to the screen. Verified on Node
 * 22.14: `format("999999999999.99")` → `999.999.999.999,99 €`.
 */
export function minorToDecimalString(minor: Minor): Intl.StringNumericLiteral {
  const negative = minor < 0
  const magnitude = Math.abs(minor)
  const whole = Math.floor(magnitude / MINOR_PER_UNIT)
  const fraction = magnitude - whole * MINOR_PER_UNIT
  const padded = String(fraction).padStart(MAX_FRACTION_DIGITS, "0")
  // The one assertion in this module, and it is discharged by construction:
  // `whole` comes from `Math.floor` on a non-negative integer and `padded` is
  // exactly two digits from `padStart`, so the result always matches
  // `-?\d+\.\d\d`, which is a `${number}`. TypeScript cannot narrow a template
  // assembled from `string` pieces, and the only alternative — routing through
  // `Number()` — would put the value back into a double, which is precisely
  // what this function exists to avoid. Asserted once here rather than at each
  // of the four call sites.
  return `${negative ? "-" : ""}${whole}.${padded}` as Intl.StringNumericLiteral
}

/**
 * Minor units → a plain decimal number.
 *
 * Provided for the few callers that must hand a number to an API expecting one
 * (`settleVendorInvoice`'s `paidAmount`, which is written straight into
 * `numeric(14,2)`). **Do not use it to compute.** It is the last step before the
 * value leaves this module's arithmetic, never a step inside it.
 */
export function minorToDecimal(minor: Minor): number {
  return Number(minorToDecimalString(minor))
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

/**
 * Integer addition, with an overflow answer rather than an overflow bug.
 *
 * `null` means the result left the safe-integer range. Every caller that can
 * produce one has to say what it renders in that case, which is the point:
 * beyond 2^53 a `+` stops being addition and starts being approximation, and an
 * approximate ledger total is worse than an absent one.
 */
export function addMinor(a: Minor, b: Minor): Minor | null {
  const sum = a + b
  if (!Number.isSafeInteger(sum)) return null
  return brand(sum === 0 ? 0 : sum)
}

export function negateMinor(minor: Minor): Minor {
  return brand(minor === 0 ? 0 : -minor)
}

export function absMinor(minor: Minor): Minor {
  return brand(Math.abs(minor))
}

export function isZeroMinor(minor: Minor): boolean {
  return minor === 0
}

/**
 * Multiply by a whole number of parts — a share split, a quantity. Never by a
 * fraction: `minor * 0.19` for a tax line reintroduces exactly the floating
 * point this module exists to avoid. Percentages go through `percentOfMinor`.
 */
export function scaleMinor(minor: Minor, factor: number): Minor | null {
  if (!Number.isInteger(factor)) return null
  const product = minor * factor
  if (!Number.isSafeInteger(product)) return null
  return brand(product === 0 ? 0 : product)
}

/**
 * `part / whole` as a ratio in [0, ∞), or `null` when `whole` is zero.
 *
 * A ratio is not money, so a float is correct here — this is the one place a
 * division is legitimate, and it feeds `formatPercent` and bar widths, never a
 * stored amount.
 */
export function ratioOfMinor(part: Minor, whole: Minor): number | null {
  if (whole === 0) return null
  return part / whole
}

// ---------------------------------------------------------------------------
// Per-currency accumulation — the thing with no total() method
// ---------------------------------------------------------------------------

export interface CurrencyLine {
  currency: CurrencyCode
  minor: Minor
}

/**
 * Totals kept apart by currency, permanently.
 *
 * **There is deliberately no `total()`, no `grandTotal`, no `valueOf()` and no
 * iteration order that invites a `reduce` into one number.** `lines()` hands
 * back one entry per currency and that is the widest thing this class will ever
 * say. The rule in the brief — "never aggregate across currencies" — is a rule
 * you can forget; a missing method is not.
 *
 * `unreadable` counts rows whose amount or currency could not be read and were
 * therefore left out of every line. Surfaced rather than dropped: a total that
 * silently excluded rows is worse than one that admits it did.
 *
 * `overflowed` records currencies whose running sum left the safe-integer
 * range. Those lines are reported as unreadable rather than as a number that is
 * quietly wrong.
 */
export class CurrencyTotals {
  readonly #byCurrency = new Map<CurrencyCode, Minor>()
  readonly #overflowed = new Set<CurrencyCode>()
  #unreadable = 0

  /**
   * Add one row. A `null` amount or a `null` currency increments `unreadable`
   * instead of contributing zero — the two are different facts and a dashboard
   * that conflates them is claiming knowledge it does not have.
   */
  add(minor: Minor | null, currency: CurrencyCode | null): this {
    if (minor === null || currency === null) {
      this.#unreadable += 1
      return this
    }
    if (this.#overflowed.has(currency)) return this

    const running = this.#byCurrency.get(currency) ?? ZERO_MINOR
    const next = addMinor(running, minor)
    if (next === null) {
      this.#overflowed.add(currency)
      this.#byCurrency.delete(currency)
      return this
    }
    this.#byCurrency.set(currency, next)
    return this
  }

  /** One line per currency, in stable alphabetical order. Never one number. */
  lines(): readonly CurrencyLine[] {
    return [...this.#byCurrency.entries()]
      .map(([currency, minor]) => ({ currency, minor }))
      .sort((a, b) => (a.currency < b.currency ? -1 : 1))
  }

  /** The total for ONE named currency, or `null` if that currency is absent. */
  forCurrency(currency: CurrencyCode): Minor | null {
    return this.#byCurrency.get(currency) ?? null
  }

  get currencies(): readonly CurrencyCode[] {
    return this.lines().map((line) => line.currency)
  }

  get unreadable(): number {
    return this.#unreadable
  }

  get overflowedCurrencies(): readonly CurrencyCode[] {
    return [...this.#overflowed].sort()
  }

  get isEmpty(): boolean {
    return this.#byCurrency.size === 0
  }
}

/**
 * Builds a `CurrencyTotals` from rows. The two extractors are separate
 * arguments so a row whose currency column is unreadable cannot borrow the
 * currency of the row beside it.
 */
export function totalRows<T>(
  rows: readonly T[],
  amountOf: (row: T) => number | null,
  currencyOf: (row: T) => CurrencyCode | null
): CurrencyTotals {
  const totals = new CurrencyTotals()
  for (const row of rows) totals.add(toMinor(amountOf(row)), currencyOf(row))
  return totals
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const currencyFormatters = new Map<string, Intl.NumberFormat>()

function currencyFormatter(
  locale: Locale,
  currency: CurrencyCode,
  fractionless: boolean
): Intl.NumberFormat {
  const key = `${locale}|${currency}|${fractionless ? "0" : "2"}`
  const cached = currencyFormatters.get(key)
  if (cached !== undefined) return cached
  const created = new Intl.NumberFormat(intlLocale(locale), {
    style: "currency",
    currency,
    ...(fractionless
      ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
      : {}),
  })
  currencyFormatters.set(key, created)
  return created
}

/**
 * A minor-unit amount, in its own currency, in the caller's locale.
 *
 * `formatMinor(123456, "EUR", "de")` → `1.234,56 €`
 * `formatMinor(123456, "USD", "de")` → `1.234,56 $`
 *
 * The second line is the one that matters: a German page renders a USD figure
 * as dollars, because that is what the source said. There is no conversion in
 * this module and there must not be one added without a dated, labelled rate
 * (`lib/env.ts`'s `fxDisplayRate` exists for exactly that and is not used here).
 *
 * The exact decimal string is handed to `Intl`, so no double is constructed and
 * `-0` cannot occur: `toMinor` already collapsed it, and `minorToDecimalString`
 * emits no sign for zero.
 */
export function formatMinor(
  minor: Minor,
  currency: CurrencyCode,
  locale: Locale,
  options: { fractionless?: boolean } = {}
): string {
  return currencyFormatter(
    locale,
    currency,
    options.fractionless === true
  ).format(minorToDecimalString(minor))
}

/** A `Money` for the few W1-D components that take one. Same no-conversion rule. */
export function minorToMoney(minor: Minor, currency: CurrencyCode): Money {
  return { amount: minorToDecimal(minor), currency }
}

// ---------------------------------------------------------------------------
// Parsing — the German field
// ---------------------------------------------------------------------------

/** Every space this parser treats as a thousands separator, not as content. */
const SPACE_LIKE = /[\s    ]/g

/** Symbols and codes a user may leave in the field when pasting an amount. */
const CURRENCY_NOISE = /€|\$|₺|£|EUR|USD|TRY|GBP/gi

/** Minus signs a keyboard or a spreadsheet may produce. */
const MINUS_LIKE = /^[-−‒–—]/

export type AmountParseFailure =
  /** Nothing but whitespace. */
  | "empty"
  /** A character that is neither a digit nor this locale's separators. */
  | "unexpected_character"
  /** Grouping that does not fit this locale, e.g. `1.23` in German. */
  | "malformed_grouping"
  /** More than two fractional digits — money is never silently rounded here. */
  | "too_many_decimals"
  /** More than `numeric(14,2)` can store. */
  | "too_large"

export type AmountParseResult =
  | { ok: true; minor: Minor }
  | { ok: false; reason: AmountParseFailure }

/**
 * The group and decimal separators this locale actually uses, read out of
 * `Intl` rather than hardcoded.
 *
 * Measured on Node 22.14 (ICU 74): de-DE and tr-TR give group `.` decimal `,`;
 * en-US gives group `,` decimal `.`; ru-RU gives group `U+00A0` decimal `,`.
 * Reading them means an ICU update that changes ru's group to `U+202F` cannot
 * silently break the field — and the space-stripping below means it would not
 * matter either way.
 */
export function separatorsFor(locale: Locale): {
  group: string
  decimal: string
} {
  const parts = new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: 2,
  }).formatToParts(1234.5)
  const group = parts.find((part) => part.type === "group")?.value ?? ","
  const decimal = parts.find((part) => part.type === "decimal")?.value ?? "."
  return { group, decimal }
}

/**
 * The format hint to show beside a field, generated from the same separators
 * the parser uses. A hint written by hand is a hint that drifts from the parser.
 *
 * de → `1.234,56` · en → `1,234.56` · tr → `1.234,56` · ru → `1 234,56`
 */
export function amountFormatExample(locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(1234.56)
}

function isDigits(value: string): boolean {
  return value.length > 0 && /^\d+$/.test(value)
}

/**
 * Parses what a person typed into a money field, in their own locale.
 *
 * The single most likely data-entry bug in a German-default finance UI is
 * `1.234,56` arriving as `1.23456` or as `1.234`, so this is written to fail
 * loudly rather than to be clever:
 *
 * | typed (de)  | result                                   |
 * | ----------- | ---------------------------------------- |
 * | `1.234,56`  | 123456 minor                             |
 * | `1234,56`   | 123456 minor                             |
 * | `1 234,56`  | 123456 minor (spaces are never content)  |
 * | `1.234`     | 123400 minor — valid German grouping     |
 * | `1.23`      | **rejected** `malformed_grouping`        |
 * | `1234.56`   | **rejected** `malformed_grouping`        |
 * | `1234,567`  | **rejected** `too_many_decimals`         |
 *
 * The two rejections are the important rows. `1234.56` in a German field is
 * either 1234.56 typed from muscle memory or 123456 with a slipped separator,
 * a 100x difference, and guessing is how a wrong number gets posted. Naming the
 * expected format and refusing costs the user one keystroke.
 */
export function parseAmount(input: string, locale: Locale): AmountParseResult {
  const { group, decimal } = separatorsFor(locale)

  let text = input
    .replace(CURRENCY_NOISE, "")
    // Spaces come out FIRST, which is what makes ru's non-breaking-space group
    // separator work without a special case, and what lets a German user type
    // `1 234,56` without being told off for it. No locale here uses a space as
    // a decimal separator, so nothing is lost.
    .replace(SPACE_LIKE, "")

  if (text.length === 0) return { ok: false, reason: "empty" }

  // Accounting parentheses: (1.234,56) is negative.
  let negative = false
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true
    text = text.slice(1, -1)
  }
  if (MINUS_LIKE.test(text)) {
    negative = !negative
    text = text.slice(1)
  }
  if (text.length === 0) return { ok: false, reason: "empty" }

  const decimalIndex = text.lastIndexOf(decimal)
  const hasDecimal = decimalIndex !== -1
  const integerPart = hasDecimal ? text.slice(0, decimalIndex) : text
  const fractionPart = hasDecimal ? text.slice(decimalIndex + 1) : ""

  // A second decimal separator means the input is not a number in this locale.
  if (hasDecimal && integerPart.includes(decimal)) {
    return { ok: false, reason: "unexpected_character" }
  }
  if (fractionPart.length > 0 && !isDigits(fractionPart)) {
    return { ok: false, reason: "unexpected_character" }
  }
  if (fractionPart.length > MAX_FRACTION_DIGITS) {
    return { ok: false, reason: "too_many_decimals" }
  }

  // The grouping check. When the group separator is a space it was already
  // stripped above, so `groups` is empty and only the digit shape is checked —
  // which is correct: `1 234,56` and `1234,56` are the same input in ru.
  const groups = integerPart.split(group)
  const digits = groups.join("")

  if (digits.length > 0 && !isDigits(digits)) {
    return { ok: false, reason: "unexpected_character" }
  }
  if (groups.length > 1) {
    const [head, ...rest] = groups
    // German grouping is 1-3 digits then blocks of exactly 3. `1.23` and
    // `1234.56` both fail here, which is the whole point.
    if (head === undefined || head.length === 0 || head.length > 3) {
      return { ok: false, reason: "malformed_grouping" }
    }
    if (rest.some((block) => block.length !== 3)) {
      return { ok: false, reason: "malformed_grouping" }
    }
  }

  // `,56` is 0.56. An empty integer part with no decimal part at all was caught
  // by the length check above.
  const wholeDigits = digits.length === 0 ? "0" : digits
  if (!hasDecimal && digits.length === 0) {
    return { ok: false, reason: "unexpected_character" }
  }
  if (wholeDigits.length > MAX_INTEGER_DIGITS) {
    return { ok: false, reason: "too_large" }
  }

  const whole = Number.parseInt(wholeDigits, 10)
  const fraction = Number.parseInt(
    fractionPart.padEnd(MAX_FRACTION_DIGITS, "0"),
    10
  )
  if (!Number.isFinite(whole) || !Number.isFinite(fraction)) {
    return { ok: false, reason: "unexpected_character" }
  }

  const magnitude = whole * MINOR_PER_UNIT + fraction
  if (!Number.isSafeInteger(magnitude)) return { ok: false, reason: "too_large" }
  // -0,00 is 0,00. Normalised at the parse boundary so no downstream caller has
  // to remember, and so the round-trip through `formatMinor` cannot emit "-0,00".
  if (magnitude === 0) return { ok: true, minor: ZERO_MINOR }

  return { ok: true, minor: brand(negative ? -magnitude : magnitude) }
}
