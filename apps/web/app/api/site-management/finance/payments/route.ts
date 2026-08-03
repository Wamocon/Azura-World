import { createManifestHandler } from "@/lib/api-handler"
import { forbidden, validationFailed } from "@/lib/api-errors"
import {
  createPayment,
  currencyCodes,
  getPaymentTransactions,
  type CurrencyCode,
} from "@/lib/finance-repository"
import { RepositoryError } from "@/lib/repository-base"
import { createPaymentSchema } from "@/lib/validation/schemas"
import { paymentDirections, paymentStatuses } from "@/lib/finance-data"
import { readEnum, readId } from "@/lib/validation/query"

export const dynamic = "force-dynamic"

export const GET = createManifestHandler("getPaymentTransactions", {
  handler: async ({ profile, limit, offset, query }) => {
    const direction = readEnum(query, "direction", paymentDirections)
    const status = readEnum(query, "status", paymentStatuses)
    const unitId = readId(query, "unitId")

    const result = await getPaymentTransactions({
      role: profile.role,
      profileId: profile.id,
      limit,
      offset,
      ...(direction === undefined ? {} : { direction }),
      ...(status === undefined ? {} : { status }),
      ...(unitId === undefined ? {} : { unitId }),
    })
    return { data: result.data, source: result.source }
  },
})

/**
 * Record one received payment.
 *
 * The company is the session's, never the payload's — a caller-supplied company
 * on a money row is how a receipt ends up filed against somebody else's books.
 * The row policy (`can_write_company_finance`) independently requires it to
 * match, so this is the second of two locks rather than the only one.
 *
 * `receivedAt` comes from the request because a payment is usually entered
 * after the fact — the bank credited it yesterday and somebody types it in
 * today. Writing `now()` instead would silently backdate every reconciliation.
 *
 * What this does NOT do is journal the payment or settle an invoice. See
 * `createPayment()` in `lib/finance-repository.ts`; the short version is that a
 * ledger posting must balance per currency inside one transaction group, so it
 * cannot be a side effect of a single-row insert.
 */
export const POST = createManifestHandler("createPayment", {
  schema: createPaymentSchema,
  handler: async ({ body, profile }) => {
    if (profile.id === null || profile.companyId === null) {
      throw new RepositoryError(
        forbidden("You do not have access to this data.")
      )
    }

    const result = await createPayment({
      role: profile.role,
      profileId: profile.id,
      companyId: profile.companyId,
      // The wire carries minor units; the repository takes major, exactly as
      // `vendorInvoice.settle` does. Converting here, once, beats every caller
      // guessing which one this endpoint wanted.
      amount: body.amountMinor / 100,
      currency: readCurrency(body.currency),
      direction: body.direction,
      method: body.method,
      reference: body.reference,
      receivedAt: body.receivedAt,
      createdBy: profile.id,
      ...(body.unitId === undefined ? {} : { unitId: body.unitId }),
      ...(body.residentId === undefined
        ? {}
        : { residentId: body.residentId }),
      ...(body.walletId === undefined ? {} : { walletId: body.walletId }),
      ...(body.note === undefined ? {} : { note: body.note }),
    })
    return { data: result.data, source: result.source }
  },
})

/**
 * Narrow the schema's loose three-letter code to a currency the ledger knows.
 *
 * `currencyCode` in the validation primitives accepts any `[A-Z]{3}`, which is
 * right for a shared primitive and wrong here. An unrecognised currency is
 * REFUSED rather than coerced — the tickets route can safely fold an unknown
 * category into `other`, because the worst outcome is a mis-filed job. Folding
 * an unknown currency into EUR would record a different amount of money than
 * the one that arrived, and `CONVENTIONS §5` forbids this system from converting
 * between currencies at all: there is no rate anywhere in the schema.
 */
function readCurrency(value: string): CurrencyCode {
  if ((currencyCodes as readonly string[]).includes(value)) {
    return value as CurrencyCode
  }
  throw new RepositoryError(
    validationFailed("That currency is not one this system can record.", {
      currency: "Use EUR, USD, TRY or GBP.",
    })
  )
}
