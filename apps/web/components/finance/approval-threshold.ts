import type { CurrencyCode } from "@/lib/finance-repository"

/**
 * The payment approval threshold.                              Owner: W3-D
 *
 * A plain module rather than part of `finance/actions.ts` because a
 * `"use server"` file may only export **async** functions: Next compiles every
 * export in one into a callable server endpoint, so a synchronous helper there
 * fails the production build (caught by `next build`, not by `tsc`). The rule
 * belongs to both sides anyway — the action enforces it and the page displays
 * it, and neither should own the number.
 *
 * ## One threshold per currency, and no fallback that converts
 *
 * A single "10,000" compared against a TRY amount and a EUR amount would be two
 * completely different policies wearing one number. That is the cross-currency
 * mistake in its most expensive form, so the table is keyed by currency and
 * there is no conversion anywhere near it.
 *
 * `[I]` **These values are a working default, not a figure from a source.** No
 * harvested document states Azura World's own approval policy, and inventing a
 * precise-looking one would be the fabrication SYSTEM-PROMPT §2.3 forbids. They
 * live in one place so that a real policy replaces one constant, and the
 * inference is labelled here rather than left for a reader to assume it was
 * researched.
 *
 * Below the threshold an `accountant` records a payment alone. At or above it,
 * `finance:approve` is required — held by `accountant` and `admin`, and
 * deliberately **not** by `manager`, which holds `finance:view` and
 * `finance:export` only. `lib/rbac.ts` puts it plainly: a manager who could
 * post entries makes the segregation of duties in CONTRACTS §3 decorative.
 */

/** Minor units. `5.000,00` in the three western currencies. */
const APPROVAL_THRESHOLD_MINOR: Readonly<Record<CurrencyCode, number>> = {
  EUR: 500_000,
  USD: 500_000,
  GBP: 500_000,
  // TRY is not 500_000: a threshold set by converting the EUR figure would be a
  // conversion, which this project does not do without a dated rate. This is an
  // independently chosen lira figure, and it is an inference like the others.
  TRY: 20_000_000,
}

export interface ApprovalRule {
  thresholdMinor: number
  currency: CurrencyCode
}

/** The threshold that applies to one currency. Never a converted figure. */
export function approvalThresholdFor(currency: CurrencyCode): ApprovalRule {
  return { thresholdMinor: APPROVAL_THRESHOLD_MINOR[currency], currency }
}

/**
 * Whether an amount needs a second pair of eyes.
 *
 * `>` rather than `>=`: a payment of exactly the threshold is the last one that
 * does not need approval. Stated explicitly because the boundary is the case a
 * reader will ask about, and because the action and the page must agree on it.
 */
export function needsApproval(
  amountMinor: number,
  currency: CurrencyCode
): boolean {
  return amountMinor > approvalThresholdFor(currency).thresholdMinor
}
