"use client"

import { useActionState } from "react"

import {
  recordPayment,
  type PaymentPostState,
} from "@/app/[locale]/dashboard/finance/actions"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/cn"
import type { Locale } from "@/lib/contracts"
import type { CurrencyCode } from "@/lib/finance-repository"

import { amountFormatExample, formatMinor, type Minor } from "./money"

/**
 * The manual payment console.                                  Owner: W3-D
 *
 * Mirrors 1Çatı's `manual-payment-console.tsx` in shape and diverges in three
 * places, each deliberate:
 *
 * **1. The amount is parsed on the server, in the writer's locale.** This
 * component sends the raw text. A client-side parse would be a convenience, and
 * trusting one would mean the number reaching the database is whatever the
 * browser decided `1.234,56` meant. The server echoes back what it read, and
 * this component renders that echo on every outcome including the failures.
 * That echo is the round trip the brief asks to be tested, made visible to the
 * person typing rather than only to a test.
 *
 * **2. The idempotency key is a hidden field minted on the server** when the
 * form is rendered, so a double-clicked button submits the *same* key twice and
 * the database's partial unique index collapses them. A key generated here
 * would put the uniqueness guarantee in the browser.
 *
 * **3. Every message is a translated code**, never a sentence from the action.
 * The action returns `{ status, ... }` and this file looks it up. A server that
 * composes prose has one language for four locales.
 *
 * ## The button is disabled while pending
 *
 * Belt to the idempotency key's braces. `useActionState`'s `pending` prevents
 * the common double click; the key handles the resubmit, the impatient reload
 * and the second tab, which `pending` cannot see.
 */

export interface PaymentConsoleLabels {
  heading: string
  description: string
  amount: string
  amountHint: string
  currency: string
  method: string
  reference: string
  referenceHint: string
  allocation: string
  allocationNone: string
  submit: string
  submitting: string
  doubleClickSafe: string
  /** Outcome text, keyed by the action's discriminant. */
  result: {
    posted: string
    duplicate: string
    unavailable: string
    notImplemented: string
    forbidden: string
    conflict: string
    /** `{remaining}` is interpolated by the caller into a function. */
    exceedsInvoice: (remaining: string) => string
    unknownAllocation: string
    parsed: (value: string) => string
  }
  /** Amount-parse failures, keyed by `AmountParseFailure`. */
  errors: Record<string, string>
  approval: {
    /** `{amount}` is the threshold, already formatted in its own currency. */
    threshold: (amount: string) => string
    required: string
  }
}

export interface AllocationOption {
  /** `invoice:<id>` or `unit:<id>`. */
  value: string
  label: string
  currency: CurrencyCode
}

const INITIAL: PaymentPostState = { status: "idle" }

export function PaymentConsole({
  locale,
  idempotencyKey,
  allocations,
  currencies,
  methods,
  labels,
  className,
}: {
  locale: Locale
  /** Minted server-side per render. See the module header. */
  idempotencyKey: string
  allocations: readonly AllocationOption[]
  currencies: readonly CurrencyCode[]
  methods: readonly string[]
  labels: PaymentConsoleLabels
  className?: string
}) {
  const [state, action, pending] = useActionState(recordPayment, INITIAL)

  const example = amountFormatExample(locale)
  const message = messageFor(state, locale, labels)
  const echo = echoFor(state, locale, labels)

  return (
    <form
      action={action}
      data-slot="payment-console"
      className={cn(
        "flex flex-col gap-4 rounded-xl border border-border bg-card p-5",
        className
      )}
    >
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="locale" value={locale} />

      <div className="flex flex-col gap-1">
        <h3 className="font-display text-base font-semibold text-foreground">
          {labels.heading}
        </h3>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          {labels.description}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="payment-amount"
          label={labels.amount}
          hint={labels.amountHint.replace("{example}", example)}
        >
          <input
            id="payment-amount"
            name="amount"
            type="text"
            required
            maxLength={40}
            // `inputMode="decimal"` and NOT `type="number"`: a number input
            // silently refuses "1.234,56" in a German browser, so the user
            // watches their own keystrokes vanish with no message.
            inputMode="decimal"
            autoComplete="off"
            placeholder={example}
            className={inputClass}
          />
        </Field>

        <Field id="payment-currency" label={labels.currency}>
          <select
            id="payment-currency"
            name="currency"
            required
            className={inputClass}
          >
            {currencies.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </Field>

        <Field id="payment-method" label={labels.method}>
          <select
            id="payment-method"
            name="method"
            required
            className={inputClass}
          >
            {methods.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
        </Field>

        <Field
          id="payment-reference"
          label={labels.reference}
          hint={labels.referenceHint}
        >
          <input
            id="payment-reference"
            name="reference"
            type="text"
            maxLength={120}
            autoComplete="off"
            className={inputClass}
          />
        </Field>

        <Field
          id="payment-allocation"
          label={labels.allocation}
          className="sm:col-span-2"
        >
          <select
            id="payment-allocation"
            name="allocation"
            required
            defaultValue=""
            className={inputClass}
          >
            <option value="" disabled>
              {labels.allocationNone}
            </option>
            {allocations.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {labels.doubleClickSafe}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? labels.submitting : labels.submit}
        </Button>

        {message === null ? null : (
          <p
            // `alert` rather than `status`: every non-idle outcome here changes
            // whether money moved, which is not an ambient update.
            role="alert"
            className={cn(
              "text-sm",
              state.status === "posted"
                ? "text-confidence-confirmed"
                : "text-confidence-conflicted"
            )}
          >
            {message}
          </p>
        )}
      </div>

      {echo === null ? null : (
        // Shown for a SUCCESSFUL parse even when the write failed, because "what
        // did the server read my 1.234,56 as" is a different question from
        // "did it save", and the person typing needs the first one answered.
        <p className="text-xs text-muted-foreground">{echo}</p>
      )}
    </form>
  )
}

const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"

function Field({
  id,
  label,
  hint,
  children,
  className,
}: {
  id: string
  label: string
  hint?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label
        htmlFor={id}
        className="font-mono text-[0.6875rem] tracking-[0.18em] text-muted-foreground uppercase"
      >
        {label}
      </label>
      {children}
      {hint === undefined ? null : (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}

/** The action's discriminant → one translated sentence. */
function messageFor(
  state: PaymentPostState,
  locale: Locale,
  labels: PaymentConsoleLabels
): string | null {
  switch (state.status) {
    case "idle":
      return null
    case "forbidden":
      return labels.result.forbidden
    case "invalid_amount":
      return (
        labels.errors[state.reason]?.replace(
          "{example}",
          amountFormatExample(locale)
        ) ?? labels.errors["unexpected_character"] ?? null
      )
    case "invalid_field":
      return labels.result.unknownAllocation
    case "needs_approval":
      return `${labels.approval.required} ${labels.approval.threshold(
        formatMinor(state.thresholdMinor as Minor, state.currency, locale)
      )}`
    case "exceeds_invoice":
      return labels.result.exceedsInvoice(
        formatMinor(state.remainingMinor as Minor, state.currency, locale)
      )
    case "duplicate":
      return labels.result.duplicate
    case "conflict":
      return labels.result.conflict
    case "unavailable":
      return state.reason === "no_database"
        ? labels.result.unavailable
        : labels.result.notImplemented
    case "posted":
      return labels.result.posted
  }
}

/**
 * "Read as 1.234,56 €" — the visible half of the round trip.
 *
 * Only rendered when the server successfully parsed the text, which is exactly
 * the set of outcomes where the number is worth confirming. A rejected amount
 * has nothing to echo, and echoing a guess at what it might have meant would
 * undo the point of rejecting it.
 */
function echoFor(
  state: PaymentPostState,
  locale: Locale,
  labels: PaymentConsoleLabels
): string | null {
  if (
    state.status === "posted" ||
    state.status === "duplicate" ||
    state.status === "unavailable"
  ) {
    return labels.result.parsed(
      formatMinor(state.amountMinor as Minor, state.currency, locale)
    )
  }
  if (state.status === "needs_approval") {
    return labels.result.parsed(
      formatMinor(state.amountMinor as Minor, state.currency, locale)
    )
  }
  return null
}
