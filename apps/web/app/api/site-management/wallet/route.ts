import { createManifestHandler } from "@/lib/api-handler"
import { getWallets } from "@/lib/finance-repository"
import { readBoolean, readEnum } from "@/lib/validation/query"
import { currencies } from "@/lib/validation/vocab"

export const dynamic = "force-dynamic"

export const GET = createManifestHandler("getWallets", {
  handler: async ({ profile, limit, offset, query }) => {
    const lowBalanceOnly = readBoolean(query, "lowBalanceOnly")
    const currency = readEnum(query, "currency", currencies)

    const result = await getWallets({
      role: profile.role,
      profileId: profile.id,
      limit,
      offset,
      ...(lowBalanceOnly === undefined ? {} : { lowBalanceOnly }),
      ...(currency === undefined ? {} : { currency }),
    })
    return { data: result.data, source: result.source }
  },
})
