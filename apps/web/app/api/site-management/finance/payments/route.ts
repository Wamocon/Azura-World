import { createManifestHandler } from "@/lib/api-handler"
import { getPaymentTransactions } from "@/lib/finance-repository"
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

export const POST = createManifestHandler("createPayment", {
  schema: createPaymentSchema,
  handler: () => {
    throw new Error("unreachable: createPayment declares a write gap")
  },
})
