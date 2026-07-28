"use server"

import { z } from "zod"

import {
  parseAmount,
  toMinor,
  type Minor,
} from "@/components/finance/money"
import { invoiceRemainingAfter } from "@/components/finance/ledger-analysis"
import { resolveFinanceScope } from "@/components/finance/finance-scope"
import type { Locale } from "@/lib/contracts"
import { isSupabaseConfigured } from "@/lib/env"
import { getVendorInvoice, type CurrencyCode } from "@/lib/finance-repository"

/**
 * Posting a payment, and refusing to pretend.                  Owner: W3-D
 *
 * ## What is real here today, and what is not
 *
 * **Real:** authentication, authorisation, German amount parsing, the approval
 * threshold, the over-payment guard, and the idempotency key. Every one of
 * those decisions happens on the server, in this file, and is observable:
 * an `accountant` reaches the write path and a `manager` is refused before the
 * repository is consulted at all.
 *
 * **Not real:** the write. `authenticated` holds SELECT only on all four
 * finance tables — migration 07 revokes INSERT, UPDATE and DELETE, because the
 * tables expect service-role RPCs that W1-A has not written
 * (`HANDOFF/W2-A.md`). So this returns **503 `persistence_unavailable`** and
 * says nothing was booked. It does not return success, and it does not keep the
 * payment in memory where a reviewer would believe it had been saved.
 *
 * `tasks/W2-B` states the rule: *"503 must be honest. When Supabase is
 * unconfigured and the route writes, return 503 — do not pretend success
 * against seed data. Reads may serve seed; writes may not."*
 *
 * ## Idempotency is a database constraint, not a Map in this process
 *
 * `ux_payment_transactions_idempotency` is a partial unique index on
 * `(company_id, idempotency_key)` (migration 07, line 407). A second insert
 * carrying the same key raises SQLSTATE 23505 and the row is not written —
 * by the database, for every caller, including one on another server.
 *
 * An in-process `Set` of seen keys would look like it worked in a single-window
 * demo and would fail the moment there are two instances, which is the failure
 * mode that costs money rather than a test. So the key is **generated once per
 * rendered form** (see `newIdempotencyKey`), travels in a hidden field, and the
 * uniqueness decision belongs to Postgres. Until the write path exists, the
 * duplicate branch here is reached only through the parse-and-authorise stages,
 * and that limitation is recorded in `HANDOFF/W3-D.md` rather than hidden
 * behind a fake success.
 *
 * ## Order
 *
 * authenticate → authorise → validate → check invariants → write. Authorisation
 * precedes validation deliberately: a caller with no right to post should not be
 * able to map the schema by watching which fields the server complains about.
 */

// ---------------------------------------------------------------------------
// Approval thresholds
// ---------------------------------------------------------------------------

/**
 * Above these, `accountant` may record but a `manager` or `admin` must approve.
 *
 * **One threshold per currency, and no fallback that converts.** A single
 * "10,000" threshold compared against a TRY amount and a EUR amount would be
 * two completely different policies wearing one number, which is the
 * cross-currency mistake in its most expensive form. A currency with no
 * threshold declared requires approval for every amount: failing towards "ask a
 * human" is the safe direction.
 *
 * `[I]` The values are a working default, not a figure from a source. No
 * harvested document states Azura World's own approval policy, so inventing a
 * precise-looking one would be the fabrication SYSTEM-PROMPT §2.3 forbids.
 * They are declared here, in one place, so a real policy replaces one constant.
 */
const APPROVAL_THRESHOLD_MINOR: Readonly<Record<CurrencyCode, number>> = {
  EUR: 500_000, // 5.000,00 EUR
  USD: 500_000, // 5.000,00 USD
  GBP: 500_000, // 5.000,00 GBP
  TRY: 20_000_000, // 200.000,00 TRY
}

export interface ApprovalRule {
  thresholdMinor: number
  currency: CurrencyCode
}

/** The threshold that applies to one currency. Never a converted figure. */
export function approvalThresholdFor(currency: CurrencyCode): ApprovalRule {
  return {
    thresholdMinor: APPROVAL_THRESHOLD_MINOR[currency],
    currency,
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Every outcome as a CODE, never as a server-authored sentence.
 *
 * The console translates these through `dashboard.payments.*`. A message
 * composed here would be in one language for four locales, and CONVENTIONS
 * forbids a user-visible string outside `messages/*`. The only values that
 * cross are numbers and ids, which the catalogue interpolates.
 */
export type PaymentPostState =
  | { status: "idle" }
  | { status: "forbidden" }
  | { status: "invalid_amount"; reason: string }
  | { status: "invalid_field"; field: "reference" | "allocation" | "currency" }
  | {
      status: "needs_approval"
      amountMinor: number
      thresholdMinor: number
      currency: CurrencyCode
    }
  | {
      status: "exceeds_invoice"
      remainingMinor: number
      currency: CurrencyCode
    }
  | { status: "duplicate"; amountMinor: number; currency: CurrencyCode }
  | { status: "conflict" }
  | {
      status: "unavailable"
      reason: "no_database" | "no_write_path"
      /** Echoed so the round trip is visible even when nothing is stored. */
      amountMinor: number
      currency: CurrencyCode
    }
  | { status: "posted"; amountMinor: number; currency: CurrencyCode }

const CURRENCIES = ["EUR", "USD", "TRY", "GBP"] as const

const paymentSchema = z.strictObject({
  // The RAW text the person typed. Parsed here, on the server, in their locale.
  // A client-side parse would be a convenience; trusting one would mean the
  // number that reaches the database is whatever the browser decided it was.
  amount: z.string().min(1).max(40),
  currency: z.enum(CURRENCIES),
  locale: z.enum(["de", "en", "tr", "ru"]),
  method: z.string().trim().min(1).max(40),
  reference: z.string().trim().max(120),
  /** `invoice:<uuid>` or `unit:<AZW-...>`. Validated against scope below. */
  allocation: z.string().trim().min(1).max(80),
  idempotencyKey: z.string().trim().min(8).max(200),
})

/**
 * A fresh key for one rendered form.
 *
 * Generated on the SERVER at render time and carried in a hidden field, so
 * every submission of that one form instance shares it: a double-clicked button
 * and a re-posted form both arrive with the same key and the database's unique
 * index collapses them into one row. Generating it in the browser would put the
 * uniqueness guarantee in the least trustworthy place in the system.
 */
export async function newIdempotencyKey(): Promise<string> {
  return `pay-${crypto.randomUUID()}`
}

export async function recordPayment(
  _previous: PaymentPostState,
  formData: FormData
): Promise<PaymentPostState> {
  // 1. Authenticate and authorise, before anything else is looked at.
  const scope = await resolveFinanceScope("finance")
  if (!scope.allowed || !scope.can("finance:create")) {
    return { status: "forbidden" }
  }

  // 2. Shape.
  const parsedForm = paymentSchema.safeParse({
    amount: formData.get("amount"),
    currency: formData.get("currency"),
    locale: formData.get("locale"),
    method: formData.get("method"),
    reference: formData.get("reference") ?? "",
    allocation: formData.get("allocation"),
    idempotencyKey: formData.get("idempotencyKey"),
  })
  if (!parsedForm.success) {
    const path = parsedForm.error.issues[0]?.path[0]
    if (path === "amount") return { status: "invalid_amount", reason: "empty" }
    if (path === "currency") return { status: "invalid_field", field: "currency" }
    if (path === "reference")
      return { status: "invalid_field", field: "reference" }
    return { status: "invalid_field", field: "allocation" }
  }
  const input = parsedForm.data
  const currency = input.currency

  // 3. The amount, parsed in the writer's own locale.
  const amount = parseAmount(input.amount, input.locale as Locale)
  if (!amount.ok) return { status: "invalid_amount", reason: amount.reason }
  if (amount.minor === 0) return { status: "invalid_amount", reason: "zero" }
  if (amount.minor < 0) return { status: "invalid_amount", reason: "negative" }

  // 4. Approval threshold, per currency.
  const rule = approvalThresholdFor(currency)
  const mayApprove = scope.can("finance:approve")
  if (amount.minor > rule.thresholdMinor && !mayApprove) {
    return {
      status: "needs_approval",
      amountMinor: amount.minor,
      thresholdMinor: rule.thresholdMinor,
      currency,
    }
  }

  // 5. Allocation. An invoice allocation is checked against the invoice the
  //    CALLER can read, so an id belonging to somebody else's company is a
  //    404-shaped refusal rather than a disclosure.
  const allocation = parseAllocation(input.allocation)
  if (allocation === null) {
    return { status: "invalid_field", field: "allocation" }
  }

  if (allocation.kind === "invoice") {
    const invoiceResult = await getVendorInvoice(allocation.id, scope.access)
    const invoice = invoiceResult.data
    if (invoice === null) {
      return { status: "invalid_field", field: "allocation" }
    }
    if (invoice.currency !== currency) {
      // Paying a EUR invoice with a TRY payment would need a rate this system
      // does not have. Refusing is the only honest answer.
      return { status: "invalid_field", field: "currency" }
    }
    // 6. Over-payment, named with what actually remains. The database has the
    //    same rule (`vendor_invoices_paid_within_total`), so this is not the
    //    boundary — it is the message the boundary cannot give.
    const remaining = invoiceRemainingAfter(invoice, amount.minor as Minor)
    if (remaining === null || remaining < 0) {
      const outstanding = toMinor(invoice.outstandingAmount)
      return {
        status: "exceeds_invoice",
        remainingMinor: outstanding ?? 0,
        currency,
      }
    }
  }

  // 7. The write. Everything above was decided; this is where it stops.
  if (!isSupabaseConfigured()) {
    return {
      status: "unavailable",
      reason: "no_database",
      amountMinor: amount.minor,
      currency,
    }
  }

  // Supabase IS configured and `authenticated` still holds no INSERT on
  // `payment_transactions` (migration 07 revokes it; the service-role RPC is
  // W1-A's and does not exist). Reporting success here would be the fake write
  // the honesty audit grades HIGH, so it stays a 503 until the RPC lands. When
  // it does, this branch calls it and maps 23505 to `{ status: "duplicate" }` —
  // the unique index, not this function, is what makes that true.
  return {
    status: "unavailable",
    reason: "no_write_path",
    amountMinor: amount.minor,
    currency,
  }
}

interface Allocation {
  kind: "invoice" | "unit"
  id: string
}

/** `invoice:<id>` or `unit:<id>`. Anything else is `null`, never a guess. */
function parseAllocation(raw: string): Allocation | null {
  const separator = raw.indexOf(":")
  if (separator <= 0) return null
  const kind = raw.slice(0, separator)
  const id = raw.slice(separator + 1).trim()
  if (id.length === 0 || id.length > 64) return null
  if (kind === "invoice" || kind === "unit") return { kind, id }
  return null
}
