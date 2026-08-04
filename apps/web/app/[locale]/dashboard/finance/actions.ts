"use server"

import { z } from "zod"

import {
  parseAmount,
  toMinor,
  type Minor,
} from "@/components/finance/money"
import {
  approvalThresholdFor,
  needsApproval,
} from "@/components/finance/approval-threshold"
import { invoiceRemainingAfter } from "@/components/finance/ledger-analysis"
import { resolveFinanceScope } from "@/components/finance/finance-scope"
import { getUserProfile } from "@/lib/auth"
import type { Locale } from "@/lib/contracts"
import { decodePublicId } from "@/lib/public-id"
import { isSupabaseConfigured } from "@/lib/env"
import {
  createPayment,
  getVendorInvoice,
  type CurrencyCode,
} from "@/lib/finance-repository"
import { RepositoryError } from "@/lib/repository-base"

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
 * **Also real, since migration 21: the write.** For most of this project's life
 * it was not. `authenticated` held SELECT only on all four finance tables —
 * migration 07 revoked INSERT, UPDATE and DELETE — so this function did every
 * hard part and then returned 503 `persistence_unavailable`, saying plainly
 * that nothing had been booked. That was the correct behaviour at the time:
 * `tasks/W2-B` states the rule as *"503 must be honest … do not pretend success
 * against seed data. Reads may serve seed; writes may not."*
 *
 * Migration 21 restored the INSERT — the policies
 * (`payment_transactions_insert_finance`, `can_write_company_finance()`) had
 * been correct all along — and `createPayment()` in `lib/finance-repository.ts`
 * is the function the old comment here was waiting for.
 *
 * ## What `posted` claims, and what it must never be read as claiming
 *
 * That the payment is **recorded**. Not that it has been journalled to the
 * ledger, and not that it has been applied to an invoice's `paid_amount`.
 * `payment_transactions.ledger_entry_id` is nullable precisely so a receipt can
 * exist before it is journalled, and journalling is a different operation under
 * a different rule: `assert_ledger_group_balanced` requires balanced legs per
 * currency within one `transaction_group_id`, so a payment cannot become one
 * ledger row. Settling an invoice is `settleVendorInvoice()`, which is
 * optimistically concurrent and would be bypassed by doing it as a side effect
 * here.
 *
 * The copy behind `dashboard.payments.result.posted` must therefore say
 * "recorded", never "booked" or "allocated".
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
// State
//
// The approval threshold lives in `components/finance/approval-threshold.ts`,
// not here: a `"use server"` file may export only ASYNC functions, because Next
// turns every export in one into a callable server endpoint. A synchronous
// helper alongside these actions compiles under `tsc` and fails
// `next build` — which is why the build is a gate and not a formality.
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
  if (needsApproval(amount.minor, currency) && !scope.can("finance:approve")) {
    return {
      status: "needs_approval",
      amountMinor: amount.minor,
      thresholdMinor: approvalThresholdFor(currency).thresholdMinor,
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

  // The write, at last. Everything above decided; this is the only line that
  // changes anything.
  //
  // This branch used to return `no_write_path` with a comment explaining that
  // `authenticated` held no INSERT on `payment_transactions` (migration 07
  // revoked it). Migration 21 restored it, and the mapping below is the one that
  // comment specified: 23505 is a duplicate, and it is the unique index — not
  // this function — that makes that true.
  const profile = await getUserProfile()
  if (profile.companyId === null || profile.id === null) {
    // Authorised above but with no company on the profile, so there is no
    // tenant to file the payment under. Not a permission answer and not a
    // success; the operator needs their profile fixed.
    return {
      status: "unavailable",
      reason: "no_write_path",
      amountMinor: amount.minor,
      currency,
    }
  }

  try {
    await createPayment({
      ...scope.access,
      companyId: profile.companyId,
      // The repository takes major units; `amount.minor` is the parsed integer.
      amount: amount.minor / 100,
      currency,
      // The console records money that has arrived. An outbound payment is a
      // different form this surface does not offer.
      direction: "inbound",
      method: input.method,
      reference: input.reference,
      receivedAt: new Date().toISOString(),
      idempotencyKey: input.idempotencyKey,
      createdBy: profile.id,
      ...(allocation.kind === "invoice"
        ? { vendorInvoiceId: allocation.id }
        : { unitId: allocation.id }),
    })
  } catch (error) {
    if (error instanceof RepositoryError) {
      // `conflict` from this path is only ever a unique-index collision — a
      // double-clicked button or a re-posted form arriving with the same
      // idempotency key. That is a duplicate, not a lost update, and the
      // console has a message that says so.
      if (error.apiError.code === "conflict") {
        return { status: "duplicate", amountMinor: amount.minor, currency }
      }
      if (error.apiError.code === "forbidden") {
        return { status: "forbidden" }
      }
      return {
        status: "unavailable",
        reason: "no_write_path",
        amountMinor: amount.minor,
        currency,
      }
    }
    throw error
  }

  // `posted` is the console's success state. Note what it does NOT claim: the
  // payment is recorded, and it has not been journalled to the ledger or
  // applied to an invoice's `paid_amount`. Both are separate operations with
  // their own rules — see `createPayment`'s doc comment — and the copy this
  // state renders must not imply either.
  return { status: "posted", amountMinor: amount.minor, currency }
}

interface Allocation {
  kind: "invoice" | "unit"
  id: string
}

/**
 * `invoice:<token>` or `unit:<AZW-…>`. Anything else is `null`, never a guess.
 *
 * The invoice half carries an **opaque public id**, not the row's uuid, and is
 * decoded here. A token that does not decode returns `null` and the caller
 * answers "no such invoice" — which is also what a token minted for a different
 * kind does, because `decodePublicId` derives a separate key per kind and a
 * ticket token simply will not decrypt as an invoice one.
 *
 * The unit half is untouched: `AZW-B07-0064` is the building's own designation
 * and is legible by design.
 */
function parseAllocation(raw: string): Allocation | null {
  const separator = raw.indexOf(":")
  if (separator <= 0) return null
  const kind = raw.slice(0, separator)
  const value = raw.slice(separator + 1).trim()
  if (value.length === 0 || value.length > 64) return null
  if (kind === "unit") return { kind, id: value }
  if (kind === "invoice") {
    const id = decodePublicId("invoice", value)
    return id === null ? null : { kind, id }
  }
  return null
}
