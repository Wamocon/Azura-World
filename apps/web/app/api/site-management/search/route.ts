import { createManifestHandler } from "@/lib/api-handler"
import { searchOperationalRecords } from "@/lib/search-repository"
import { readInt, requireText } from "@/lib/validation/query"

export const dynamic = "force-dynamic"

/**
 * Global search — requested by W3-B for the dashboard command palette.
 *
 * Two things this endpoint does not do. It does not accept a role, a company or
 * a profile id from the query string, because a search that trusts the client
 * about who is asking is a search that returns everything to anyone. And it does
 * not page: the limit is capped at 50, because a search result set large enough
 * to page through is a data export wearing a search box.
 */
export const GET = createManifestHandler("searchOperationalRecords", {
  handler: async ({ query }) => {
    const term = requireText(query, "q", 120)
    const limit = readInt(query, "limit", 1, 50) ?? 20
    const result = await searchOperationalRecords(term, limit)
    return { data: { hits: result.data }, source: result.source }
  },
})
