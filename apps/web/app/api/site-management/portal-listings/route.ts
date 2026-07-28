import { createManifestHandler, type HandlerResult } from "@/lib/api-handler"
import {
  getCompetingPricesForUnit,
  getPortalListings,
  getPriceSpread,
  getStaleListings,
  type CompetingPriceRecord,
  type PortalListingRecord,
  type PriceSpreadBucket,
} from "@/lib/portal-repository"
import { readEnum, readId, readText } from "@/lib/validation/query"

export const dynamic = "force-dynamic"

const VIEWS = ["listings", "stale", "spread"] as const

export const GET = createManifestHandler("getPortalListings", {
  handler: async ({
    limit,
    offset,
    query,
  }): Promise<
    HandlerResult<
      CompetingPriceRecord[] | PriceSpreadBucket[] | PortalListingRecord[]
    >
  > => {
    const unitId = readId(query, "unitId")
    if (unitId !== undefined) {
      // The F-002 case: one unit, four portals, prices that disagree by 2.1x
      // across two currencies. Every capture is returned, none is converted and
      // none is dropped as an outlier — the disagreement IS the finding.
      const result = await getCompetingPricesForUnit(unitId, { limit })
      return { data: result.data, source: result.source }
    }

    const view = readEnum(query, "view", VIEWS) ?? "listings"
    if (view === "spread") {
      const result = await getPriceSpread()
      return { data: result.data, source: result.source }
    }
    if (view === "stale") {
      const result = await getStaleListings({ limit, offset })
      return { data: result.data, source: result.source }
    }

    const publisher = readText(query, "publisher", 64)
    const result = await getPortalListings({
      limit,
      offset,
      ...(publisher === undefined ? {} : { publisher }),
    })
    return { data: result.data, source: result.source }
  },
})
