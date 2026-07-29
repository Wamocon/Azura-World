import type { ReactNode } from "react"

import { formatMoney } from "@/components/evidence/format"
import { cn } from "@/lib/cn"
import type { Money } from "@/lib/contracts"
import { intlLocaleTag } from "@/lib/format"

/**
 * A money total, per currency, never summed across them.  Owner: W3-C / N1
 *
 * ## The rule this component exists to make unbreakable
 *
 * OVERNIGHT-2 §4.5 and CONVENTIONS §5: **never mix currencies in an aggregate.**
 * The seed makes that easy to get wrong — seven leads carry budgets in EUR, USD,
 * TRY and GBP, and one carries none. `sum(EUR) + sum(USD) + sum(TRY)` is a
 * number that looks authoritative and means nothing: at the seed's own figures
 * it would read "10.485.000", which is mostly the Turkish lira line and would be
 * quoted as euros by the next person to see it.
 *
 * So this takes `Record<currency, amount>` — the shape `totalsByCurrency()`
 * already returns — and renders one line per currency. **There is no prop that
 * would produce a single figure**, which is the point: a component that cannot
 * express the wrong answer is stronger than a comment asking for the right one.
 *
 * ## `missing` is counted, never folded into a total as zero
 *
 * A lead with no stated budget and a lead with a budget of zero are different
 * facts. The first is "nobody asked"; the second would be "they will not pay".
 * The count is rendered beside the totals rather than under them, so a reader
 * sees how much of the population the figures actually cover.
 */
/**
 * Narrow a `Record` key to `Money`'s currency union, or `null`.
 *
 * `totalsByCurrency()` returns `Record<string, number>` because it groups by
 * whatever the column held. Casting the key back would defeat the point of the
 * union, so an unrecognised code is handled instead of assumed away.
 */
function asKnownCurrency(code: string): Money["currency"] | null {
  return code === "EUR" || code === "USD" || code === "TRY" || code === "GBP"
    ? code
    : null
}

export function CurrencyTotals({
  totals,
  locale,
  /** How many rows carried no amount at all. Rendered when > 0. */
  missing = 0,
  /** Template with `{count}`, e.g. "{count} ohne Angabe". */
  missingLabel,
  /** Shown when there is no amount in any currency. */
  emptyLabel,
  className,
}: {
  totals: Readonly<Record<string, number>>
  locale: string
  missing?: number
  missingLabel: string
  emptyLabel: string
  className?: string
}): ReactNode {
  const currencies = Object.keys(totals).sort((a, b) => a.localeCompare(b))

  return (
    <span
      data-slot="currency-totals"
      className={cn("flex flex-wrap items-baseline gap-x-3 gap-y-1", className)}
    >
      {currencies.length === 0 ? (
        <span className="text-muted-foreground">{emptyLabel}</span>
      ) : (
        currencies.map((currency) => {
          const amount = totals[currency] ?? 0
          const known = asKnownCurrency(currency)
          return (
            <span
              key={currency}
              data-currency={currency}
              data-numeric
              className="font-display font-semibold tracking-[-0.01em] text-foreground tabular-nums"
            >
              {known === null
                ? // A currency outside `Money`'s union reached the totals. It is
                  // rendered with its raw ISO code rather than dropped: a figure
                  // this component cannot pretty-print is still a figure, and
                  // silently omitting a currency would understate a total.
                  `${new Intl.NumberFormat(intlLocaleTag(locale)).format(amount)} ${currency}`
                : formatMoney({ amount, currency: known }, locale)}
            </span>
          )
        })
      )}
      {missing > 0 ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          {missingLabel.replace("{count}", String(missing))}
        </span>
      ) : null}
    </span>
  )
}
