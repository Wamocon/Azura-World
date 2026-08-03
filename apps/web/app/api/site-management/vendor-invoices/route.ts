import { createManifestHandler } from "@/lib/api-handler"
import { forbidden, validationFailed } from "@/lib/api-errors"
import {
  createVendorInvoice,
  currencyCodes,
  getVendorInvoices,
  type CurrencyCode,
} from "@/lib/finance-repository"
import { RepositoryError } from "@/lib/repository-base"
import { createVendorInvoiceSchema } from "@/lib/validation/schemas"
import { vendorInvoiceStatuses } from "@/lib/finance-data"
import { readBoolean, readEnum, readId } from "@/lib/validation/query"

export const dynamic = "force-dynamic"

export const GET = createManifestHandler("getVendorInvoices", {
  handler: async ({ profile, limit, offset, query }) => {
    const status = readEnum(query, "status", vendorInvoiceStatuses)
    const overdueOnly = readBoolean(query, "overdueOnly")
    const vendorProfileId = readId(query, "vendorProfileId")

    const result = await getVendorInvoices({
      role: profile.role,
      profileId: profile.id,
      limit,
      offset,
      ...(status === undefined ? {} : { status }),
      ...(overdueOnly === undefined ? {} : { overdueOnly }),
      ...(vendorProfileId === undefined ? {} : { vendorProfileId }),
    })
    return { data: result.data, source: result.source }
  },
})

/**
 * Register a supplier invoice.
 *
 * The company is the session's, never the payload's. The row policy
 * (`can_write_company_finance`) requires it to match too, so this is the second
 * of two locks — but a caller-supplied company on a money row is worth refusing
 * before it reaches the database as well as at it.
 *
 * An unrecognised currency is refused rather than coerced. See `readCurrency`.
 */
export const POST = createManifestHandler("createVendorInvoice", {
  schema: createVendorInvoiceSchema,
  handler: async ({ body, profile }) => {
    if (profile.id === null || profile.companyId === null) {
      throw new RepositoryError(
        forbidden("You do not have access to this data.")
      )
    }

    const result = await createVendorInvoice({
      role: profile.role,
      profileId: profile.id,
      companyId: profile.companyId,
      vendorProfileId: body.vendorProfileId,
      // Minor units on the wire, major in the repository — the same convention
      // `vendorInvoice.settle` and `createPayment` use.
      totalAmount: body.totalAmountMinor / 100,
      currency: readCurrency(body.currency),
      issuedOn: body.issuedOn,
      dueOn: body.dueOn,
      reference: body.reference,
      ...(body.siteId === undefined ? {} : { siteId: body.siteId }),
      ...(body.description === undefined
        ? {}
        : { description: body.description }),
    })
    return { data: result.data, source: result.source }
  },
})

/**
 * Narrow the schema's loose three-letter code to a currency the ledger knows.
 *
 * Refused, never coerced: this system has no exchange rate anywhere in its
 * schema (`CONVENTIONS §5` forbids summing across currencies at all), so
 * silently reading an unknown code as EUR would record a different amount of
 * money than the supplier actually invoiced.
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
