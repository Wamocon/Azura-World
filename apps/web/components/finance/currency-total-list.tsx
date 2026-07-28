import type { ReactNode } from "react"

import { cn } from "@/lib/cn"
import type { Locale } from "@/lib/contracts"

import { formatMinor } from "./money"
import type { CurrencyTotals, Minor } from "./money"

/**
 * Per-currency totals, rendered as one line each.              Owner: W3-D
 *
 * This component is the visual half of the rule that `CurrencyTotals` enforces
 * in the type system: **`sum(EUR) + sum(USD)` is a meaningless number that looks
 * authoritative on a dashboard.** There is no "combined" row here because there
 * is no combined figure to render, and there is no way to obtain one from the
 * value this component is handed.
 *
 * When more than one currency is present the fact is stated in words as well as
 * shown in the layout. A reader who sees two numbers stacked might assume the
 * second is a subtotal of the first; a reader who is told "kept apart by
 * currency" cannot.
 *
 * ## Three absences that are answers, not blanks
 *
 * - **no currencies at all** → the caller's `emptyLabel`. A real "nothing yet",
 *   not a zero.
 * - **rows whose amount or currency could not be read** → counted and reported.
 *   They were left OUT of every line above, and a total that silently dropped
 *   rows is worse than one that admits it did.
 * - **a currency whose running sum left the safe-integer range** → named, with
 *   no number. Past 2^53 an addition stops being addition, and an approximate
 *   ledger total is worse than an absent one.
 */

export interface CurrencyTotalLabels {
  /** Shown when no currency has any amount. */
  empty: string
  /** Shown above the lines when there is more than one currency. */
  multiCurrencyNote: string
  /** `{count}` rows could not be read. */
  unreadableNote: (count: number) => string
  /** The total for `{currency}` is too large to compute safely. */
  overflowNote: (currency: string) => string
}

export function CurrencyTotalList({
  totals,
  locale,
  labels,
  tone = "default",
  className,
}: {
  totals: CurrencyTotals
  locale: Locale
  labels: CurrencyTotalLabels
  /**
   * `signed` colours a negative figure. Used for balances, never for a debit or
   * a credit column where the sign carries no meaning of its own.
   */
  tone?: "default" | "signed"
  className?: string
}): ReactNode {
  const lines = totals.lines()
  const overflowed = totals.overflowedCurrencies

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {lines.length === 0 && overflowed.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.empty}</p>
      ) : null}

      {lines.length > 1 ? (
        // Stated, not implied by the layout. Two stacked numbers read as a
        // running subtotal to anybody who has used a spreadsheet.
        <p className="text-xs leading-relaxed text-muted-foreground">
          {labels.multiCurrencyNote}
        </p>
      ) : null}

      <dl className="flex flex-col gap-1">
        {lines.map((line) => (
          <div
            key={line.currency}
            className="flex items-baseline justify-between gap-4"
          >
            <dt className="font-mono text-[0.6875rem] tracking-[0.18em] text-muted-foreground uppercase">
              {line.currency}
            </dt>
            <dd
              className={cn(
                "text-base font-semibold tabular-nums",
                tone === "signed" && line.minor < 0
                  ? "text-confidence-conflicted"
                  : "text-foreground"
              )}
            >
              {formatMinor(line.minor, line.currency, locale)}
            </dd>
          </div>
        ))}
      </dl>

      {overflowed.map((currency) => (
        <p
          key={currency}
          role="status"
          className="text-xs leading-relaxed text-confidence-conflicted"
        >
          {labels.overflowNote(currency)}
        </p>
      ))}

      {totals.unreadable > 0 ? (
        <p
          role="status"
          className="text-xs leading-relaxed text-confidence-gap"
        >
          {labels.unreadableNote(totals.unreadable)}
        </p>
      ) : null}
    </div>
  )
}

/**
 * One labelled block of per-currency totals. The unit the summary panels are
 * built from, so every headline figure on every finance page carries its
 * currency at the same visual weight as its number.
 */
export function CurrencyTotalCard({
  label,
  totals,
  locale,
  labels,
  tone,
  hint,
}: {
  label: string
  totals: CurrencyTotals
  locale: Locale
  labels: CurrencyTotalLabels
  tone?: "default" | "signed"
  hint?: string
}): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-4">
      <p className="font-mono text-[0.6875rem] tracking-[0.18em] text-muted-foreground uppercase">
        {label}
      </p>
      <CurrencyTotalList
        totals={totals}
        locale={locale}
        labels={labels}
        {...(tone === undefined ? {} : { tone })}
      />
      {hint === undefined ? null : (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}

/**
 * A single amount that already knows its currency. Used in table cells.
 *
 * `null` renders the caller's gap label, never `0` and never a blank cell:
 * CONVENTIONS §5, and azura-ui-ux §6 which pins the wording to
 * "Keine Angabe" / "Not stated" rather than an em dash.
 */
export function MoneyCell({
  minor,
  currency,
  locale,
  gapLabel,
  className,
}: {
  minor: Minor | null
  currency: string | null
  locale: Locale
  gapLabel: string
  className?: string
}): ReactNode {
  if (minor === null || currency === null) {
    return (
      <span className={cn("text-sm text-confidence-gap", className)}>
        {gapLabel}
      </span>
    )
  }
  return (
    <span className={cn("tabular-nums", className)}>
      {formatMinor(
        minor,
        currency as Parameters<typeof formatMinor>[1],
        locale
      )}
    </span>
  )
}
