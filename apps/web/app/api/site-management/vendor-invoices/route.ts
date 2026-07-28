import { createManifestHandler } from "@/lib/api-handler"
import { getVendorInvoices } from "@/lib/finance-repository"
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

export const POST = createManifestHandler("createVendorInvoice", {
  schema: createVendorInvoiceSchema,
  handler: () => {
    throw new Error("unreachable: createVendorInvoice declares a write gap")
  },
})
