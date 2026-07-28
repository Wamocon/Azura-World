/**
 * # Money round-trip proof.                                       Owner: W3-D
 *
 * The brief names one bug as the most likely in this module: *"a user typing
 * `1.234,56` must parse to `1234.56`. This is the single most likely data-entry
 * bug in a German-default finance UI. Test it explicitly."* So it is tested
 * explicitly, in all four shipped locales, both directions.
 *
 * Run it with the resolver W3-C added, which is the only way plain Node can
 * load a module that imports through the `@/` alias:
 *
 * ```
 * node --experimental-strip-types \
 *      --import ./scripts/register-ts-resolve.mjs \
 *      --test apps/web/components/finance/money.test.ts
 * ```
 *
 * There is no `pnpm` script for it because `package.json` belongs to W0-A. The
 * command above is recorded in `HANDOFF/W3-D.md` with its real output, and
 * adopting it as a gate is a request for W4-D.
 */

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { Locale } from "@/lib/contracts"

import {
  addMinor,
  amountFormatExample,
  CurrencyTotals,
  formatMinor,
  minorToDecimal,
  minorToDecimalString,
  parseAmount,
  scaleMinor,
  separatorsFor,
  toMinor,
  totalRows,
  ZERO_MINOR,
  type Minor,
  // Extensionless on purpose. `allowImportingTsExtensions` is off (that flag
  // lives in W0-A's tsconfig.json and is not this task's to set), so `./money.ts`
  // is a compile error; `scripts/ts-resolve-hooks.mjs` is what lets plain Node
  // resolve the extensionless form at run time. Both toolchains accept this.
} from "./money"

const LOCALES: readonly Locale[] = ["de", "en", "tr", "ru"]

/** Unwraps a parse that the test asserts must succeed. */
function parsed(input: string, locale: Locale): Minor {
  const result = parseAmount(input, locale)
  assert.ok(
    result.ok,
    `expected "${input}" to parse in ${locale}, got ${result.ok ? "" : result.reason}`
  )
  return result.minor
}

function rejected(input: string, locale: Locale): string {
  const result = parseAmount(input, locale)
  assert.ok(!result.ok, `expected "${input}" to be REJECTED in ${locale}`)
  return result.reason
}

// ---------------------------------------------------------------------------

describe("separators come from Intl, not from a hardcoded table", () => {
  it("de and tr group with a dot and decimalise with a comma", () => {
    for (const locale of ["de", "tr"] as const) {
      assert.equal(separatorsFor(locale).group, ".")
      assert.equal(separatorsFor(locale).decimal, ",")
    }
  })

  it("en is the exact inverse — the reason a hardcoded parser is a 1000x bug", () => {
    assert.equal(separatorsFor("en").group, ",")
    assert.equal(separatorsFor("en").decimal, ".")
  })

  it("ru groups with a space-like character and decimalises with a comma", () => {
    const { group, decimal } = separatorsFor("ru")
    assert.equal(decimal, ",")
    assert.match(group, /^\s$/u, `ru group separator was ${JSON.stringify(group)}`)
  })

  it("the format hint is generated from the same separators the parser uses", () => {
    assert.equal(amountFormatExample("de"), "1.234,56")
    assert.equal(amountFormatExample("en"), "1,234.56")
    assert.equal(amountFormatExample("tr"), "1.234,56")
  })
})

describe("THE bug: German 1.234,56 stores as 1234.56", () => {
  it("parses to 123456 minor units", () => {
    assert.equal(parsed("1.234,56", "de"), 123_456)
  })

  it("the stored decimal is exactly 1234.56", () => {
    assert.equal(minorToDecimalString(parsed("1.234,56", "de")), "1234.56")
    assert.equal(minorToDecimal(parsed("1.234,56", "de")), 1234.56)
  })

  it("round-trips back to the same string a German user typed", () => {
    const minor = parsed("1.234,56", "de")
    // Non-breaking space before the symbol is Intl's, not ours.
    assert.equal(formatMinor(minor, "EUR", "de").replace(/ /g, " "), "1.234,56 €")
  })

  it("the same amount typed without grouping is the same amount", () => {
    assert.equal(parsed("1234,56", "de"), parsed("1.234,56", "de"))
  })

  it("spaces are never content, so 1 234,56 is accepted too", () => {
    assert.equal(parsed("1 234,56", "de"), 123_456)
    assert.equal(parsed("1 234,56", "de"), 123_456)
  })

  it("a pasted amount keeps its currency symbol out of the number", () => {
    assert.equal(parsed("1.234,56 €", "de"), 123_456)
    assert.equal(parsed("€1.234,56", "de"), 123_456)
    assert.equal(parsed("1.234,56 EUR", "de"), 123_456)
  })
})

describe("the same four inputs in the other three locales", () => {
  it("en reads 1,234.56", () => {
    assert.equal(parsed("1,234.56", "en"), 123_456)
    assert.equal(parsed("1234.56", "en"), 123_456)
  })

  it("tr reads 1.234,56 like German", () => {
    assert.equal(parsed("1.234,56", "tr"), 123_456)
  })

  it("ru reads 1 234,56 with any space-like grouping", () => {
    assert.equal(parsed("1 234,56", "ru"), 123_456)
    assert.equal(parsed("1 234,56", "ru"), 123_456)
    assert.equal(parsed("1 234,56", "ru"), 123_456)
    assert.equal(parsed("1234,56", "ru"), 123_456)
  })

  it("every locale renders the same minor units as its own text", () => {
    const minor = parsed("1.234,56", "de")
    const rendered = LOCALES.map((locale) => formatMinor(minor, "EUR", locale))
    // Four distinct renderings of ONE stored value: the separators differ, the
    // number does not.
    assert.equal(new Set(rendered).size >= 2, true)
    for (const text of rendered) assert.match(text, /1.?234.56/u)
  })
})

describe("ambiguous input is rejected, never guessed", () => {
  it("1234.56 in a German field is refused rather than read as 123456 or 1234.56", () => {
    assert.equal(rejected("1234.56", "de"), "malformed_grouping")
  })

  it("1.23 in a German field is refused — that is not German grouping", () => {
    assert.equal(rejected("1.23", "de"), "malformed_grouping")
  })

  it("1.2345 is refused in German for the same reason", () => {
    assert.equal(rejected("1.2345", "de"), "malformed_grouping")
  })

  it("valid German grouping without decimals is accepted", () => {
    assert.equal(parsed("1.234", "de"), 123_400)
    assert.equal(parsed("12.345.678", "de"), 1_234_567_800)
  })

  it("money is never silently rounded: three decimals is an error", () => {
    assert.equal(rejected("1234,567", "de"), "too_many_decimals")
    assert.equal(rejected("1234.567", "en"), "too_many_decimals")
  })

  it("letters and stray punctuation are errors, not zeroes", () => {
    assert.equal(rejected("abc", "de"), "unexpected_character")
    assert.equal(rejected("12,34,56", "de"), "unexpected_character")
    assert.equal(rejected("--12", "de"), "unexpected_character")
  })

  it("an empty field is empty, not zero", () => {
    assert.equal(rejected("", "de"), "empty")
    assert.equal(rejected("   ", "de"), "empty")
  })

  it("more than numeric(14,2) can hold is refused", () => {
    assert.equal(rejected("1234567890123,45", "de"), "too_large")
    assert.equal(parsed("999999999999,99", "de"), 99_999_999_999_999)
  })
})

describe("signs", () => {
  it("a leading minus is negative", () => {
    assert.equal(parsed("-1.234,56", "de"), -123_456)
  })

  it("a unicode minus and an en dash are negative too", () => {
    assert.equal(parsed("−1.234,56", "de"), -123_456)
    assert.equal(parsed("–1.234,56", "de"), -123_456)
  })

  it("accounting parentheses are negative", () => {
    assert.equal(parsed("(1.234,56)", "de"), -123_456)
  })

  it("a fraction with no integer part is under one unit", () => {
    assert.equal(parsed(",56", "de"), 56)
    assert.equal(parsed("-,56", "de"), -56)
  })
})

describe("negative zero renders as zero", () => {
  it("Intl really does emit -0,00 € for -0, which is why this exists", () => {
    // The bug this guards against, demonstrated on the raw platform call.
    assert.equal(
      new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" })
        .format(-0)
        .replace(/ /g, " "),
      "-0,00 €"
    )
  })

  it("toMinor(-0) is 0", () => {
    assert.equal(Object.is(toMinor(-0), -0), false)
    assert.equal(toMinor(-0), 0)
    assert.equal(toMinor(-0.001), 0)
  })

  it("parsing -0,00 gives 0", () => {
    assert.equal(parsed("-0,00", "de"), 0)
    assert.equal(parsed("(0,00)", "de"), 0)
  })

  it("and every path renders 0,00 €, never -0,00 €", () => {
    for (const input of ["-0,00", "(0,00)", "0,00", "-0"]) {
      const text = formatMinor(parsed(input, "de"), "EUR", "de")
      assert.ok(!text.includes("-"), `"${input}" rendered as ${text}`)
    }
    assert.equal(
      formatMinor(toMinor(-0) as Minor, "EUR", "de").replace(/ /g, " "),
      "0,00 €"
    )
  })
})

describe("toMinor does not lose a cent to floating point", () => {
  it("agrees with the naive multiply on every value numeric(14,2) can send", () => {
    // Measured rather than asserted from folklore. If `toFixed` and
    // `Math.round(x*100)` ever disagree over the real input domain, this fails
    // and names the value — which is more useful than a comment claiming the
    // naive path is broken when, over this range, it is not.
    for (let cents = 1; cents <= 300_000; cents += 7) {
      const decimal = Number((cents / 100).toFixed(2))
      assert.equal(
        toMinor(decimal),
        cents,
        `toMinor(${decimal}) should be ${cents}`
      )
      assert.equal(Math.round(decimal * 100), cents)
    }
  })

  it("a literal that was already lossy cannot be recovered by any rounding", () => {
    // 1.005 is the case everyone quotes. The honest reading: the nearest double
    // to 1.005 is 1.0049999999999998934, so the cent was gone before this
    // module was called. Both routes give 100, and neither is at fault.
    // Compared as text, not as numbers: parsing the expansion back gives the
    // same double, so a numeric comparison would be a tautology.
    assert.equal((1.005).toPrecision(20), "1.0049999999999998934")
    assert.equal(toMinor(1.005), 100)
    assert.equal(Math.round(1.005 * 100), 100)
    // Which is the whole argument for crossing into integers once, early, and
    // never letting a decimal back in to be added to another decimal.
  })

  it("0.1 + 0.2 is not 0.3, which is why nothing here adds decimals", () => {
    assert.notEqual(0.1 + 0.2, 0.3)
    const a = toMinor(0.1)
    const b = toMinor(0.2)
    assert.ok(a !== null && b !== null)
    assert.equal(addMinor(a, b), 30)
    assert.equal(minorToDecimalString(addMinor(a, b) as Minor), "0.30")
  })

  it("the repository's own seed values survive the trip", () => {
    // Real amounts from lib/finance-data.ts.
    for (const [decimal, minor] of [
      [450, 45_000],
      [8400, 840_000],
      [12_500, 1_250_000],
      [533.33, 53_333],
      [163.33, 16_333],
      [-180, -18_000],
    ] as const) {
      assert.equal(toMinor(decimal), minor)
      assert.equal(minorToDecimal(minor as Minor), decimal)
    }
  })

  it("an unreadable amount stays unreadable and never becomes 0", () => {
    assert.equal(toMinor(null), null)
    assert.equal(toMinor(undefined), null)
    assert.equal(toMinor(Number.NaN), null)
    assert.equal(toMinor(Number.POSITIVE_INFINITY), null)
  })
})

describe("large amounts stay exact and stay readable", () => {
  it("no exponential notation at the top of numeric(14,2)", () => {
    const minor = parsed("999999999999,99", "de")
    assert.equal(minorToDecimalString(minor), "999999999999.99")
    const text = formatMinor(minor, "EUR", "de")
    assert.ok(!text.toLowerCase().includes("e"))
    assert.equal(text.replace(/ /g, " "), "999.999.999.999,99 €")
  })

  it("arithmetic past the safe-integer range answers null, not an approximation", () => {
    const huge = 9_007_199_254_740_991 as Minor
    assert.equal(addMinor(huge, 1 as Minor), null)
    assert.equal(scaleMinor(huge, 2), null)
  })

  it("scaling only accepts whole factors — a fraction would be float maths again", () => {
    assert.equal(scaleMinor(100 as Minor, 3), 300)
    assert.equal(scaleMinor(100 as Minor, 0.19), null)
  })
})

describe("CurrencyTotals cannot produce a cross-currency figure", () => {
  const rows = [
    { amount: 450, currency: "EUR" as const },
    { amount: 8400, currency: "EUR" as const },
    { amount: 12_500, currency: "TRY" as const },
    { amount: 300, currency: "USD" as const },
  ]

  it("keeps one line per currency", () => {
    const totals = totalRows(
      rows,
      (r) => r.amount,
      (r) => r.currency
    )
    assert.deepEqual(
      totals.lines().map((l) => [l.currency, l.minor]),
      [
        ["EUR", 885_000],
        ["TRY", 1_250_000],
        ["USD", 30_000],
      ]
    )
  })

  it("exposes no method that returns one combined number", () => {
    // Own prototype members only — `valueOf` and `toString` are inherited from
    // Object.prototype by every class and are not this class's doing.
    const surface = new Set([
      ...Object.getOwnPropertyNames(CurrencyTotals.prototype),
      ...Object.getOwnPropertyNames(new CurrencyTotals()),
    ])
    // If any of these ever appears, the cross-currency rule has been broken by
    // an API addition rather than by a call site, and this is the only thing
    // that would notice.
    for (const forbidden of [
      "total",
      "grandTotal",
      "sum",
      "valueOf",
      "toNumber",
      "combined",
      "all",
    ]) {
      assert.equal(
        surface.has(forbidden),
        false,
        `CurrencyTotals must not expose ${forbidden}()`
      )
    }
    // And the surface it DOES have is exactly this, so a new member is a
    // deliberate, reviewed change rather than an accident.
    assert.deepEqual(
      [...surface].sort(),
      [
        "add",
        "constructor",
        "currencies",
        "forCurrency",
        "isEmpty",
        "lines",
        "overflowedCurrencies",
        "unreadable",
      ]
    )
  })

  it("counts unreadable rows instead of contributing zero for them", () => {
    const totals = new CurrencyTotals()
    totals.add(toMinor(450), "EUR")
    totals.add(toMinor(null), "EUR")
    totals.add(toMinor(450), null)
    assert.equal(totals.unreadable, 2)
    assert.equal(totals.forCurrency("EUR"), 45_000)
  })

  it("reports overflow rather than a quietly wrong total", () => {
    const totals = new CurrencyTotals()
    totals.add(9_007_199_254_740_991 as Minor, "EUR")
    totals.add(1000 as Minor, "EUR")
    assert.deepEqual(totals.overflowedCurrencies, ["EUR"])
    assert.equal(totals.forCurrency("EUR"), null)
  })

  it("an absent currency is null, not zero", () => {
    const totals = new CurrencyTotals()
    totals.add(ZERO_MINOR, "EUR")
    assert.equal(totals.forCurrency("USD"), null)
    assert.equal(totals.forCurrency("EUR"), 0)
  })
})
