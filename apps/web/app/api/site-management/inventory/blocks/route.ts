import { createManifestHandler } from "@/lib/api-handler"
import { getBlocks, getFloors } from "@/lib/inventory-repository"
import { readId } from "@/lib/validation/query"

export const dynamic = "force-dynamic"

export const GET = createManifestHandler("getInventoryBlocks", {
  handler: async ({ limit, query }) => {
    const blockId = readId(query, "blockId")
    const result =
      blockId === undefined
        ? await getBlocks({ limit })
        : await getFloors(blockId, { limit })
    return { data: result.data, source: result.source }
  },
})
