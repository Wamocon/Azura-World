import { createManifestHandler } from "@/lib/api-handler"
import { getUnits } from "@/lib/inventory-repository"
import { readEnum, readId } from "@/lib/validation/query"
import {
  saleStatuses,
  unitDataQualities,
  unitLayouts,
} from "@/lib/validation/vocab"

export const dynamic = "force-dynamic"

export const GET = createManifestHandler("getInventoryUnits", {
  handler: async ({ profile, limit, offset, query }) => {
    const layout = readEnum(query, "layout", unitLayouts)
    const dataQuality = readEnum(query, "dataQuality", unitDataQualities)
    const saleStatus = readEnum(query, "saleStatus", saleStatuses)
    const blockCode = readId(query, "blockCode")

    const result = await getUnits({
      role: profile.role,
      ...(profile.id === null ? {} : { profileId: profile.id }),
      limit,
      offset,
      // Cast-free narrowing: `readEnum` returns a member of the repository's own
      // union or `undefined`, so an unrecognised `?layout=` is dropped before it
      // reaches a query builder rather than forwarded as an arbitrary string.
      ...(layout === undefined ? {} : { layout }),
      ...(dataQuality === undefined ? {} : { dataQuality }),
      ...(saleStatus === undefined ? {} : { saleStatus }),
      ...(blockCode === undefined ? {} : { blockCode }),
    })
    return { data: result.data, source: result.source }
  },
})
