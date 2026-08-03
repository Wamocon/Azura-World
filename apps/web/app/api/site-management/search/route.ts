import { createManifestHandler } from "@/lib/api-handler"
import { encodePublicId } from "@/lib/public-id"
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
    return { data: { hits: result.data.map(toHit) }, source: result.source }
  },
})

/**
 * One search hit, reshaped for the browser.
 *
 * The repository's `SearchHit` is the RPC's row and carries two things the
 * command palette has no use for and that should not leave the server:
 *
 *   `entityId`  the row's primary key, which the client used only to build a
 *               href and as a React key. It went into the address bar from
 *               there, and from the address bar into the Referer header of the
 *               next outbound link. Replaced by an opaque token.
 *   `metadata`  an unbounded `jsonb` column, forwarded verbatim. The client
 *               declares it in its own type and never reads it. Whatever a
 *               future writer puts in that column would have been published to
 *               every searcher's browser without anyone deciding to.
 *
 * So both are dropped here rather than in the client, which is the only place
 * dropping them actually prevents the disclosure.
 */
function toHit(hit: {
  entityTable: string
  entityId: string
  title: string
  summary: string | null
}): {
  entityTable: string
  ref: string | null
  key: string
  title: string
  summary: string | null
} {
  const ref = detailTokenFor(hit.entityTable, hit.entityId)
  return {
    entityTable: hit.entityTable,
    ref,
    // A stable key for the client list that reveals nothing. Two hits from the
    // same table without a detail route share a table name and nothing else, so
    // the title disambiguates them; it is already being rendered.
    key: `${hit.entityTable}:${ref ?? hit.title}`,
    title: hit.title,
    summary: hit.summary,
  }
}

/**
 * A token for the tables that have a detail route, and `null` for the rest.
 *
 * `null` is not a failure: units, leads, documents and profiles have no
 * per-record page, so their hits land on the list where the record lives. That
 * was already true — this only stops the id travelling to say so.
 *
 * Guarded by the uuid test because not every entity here is keyed by one:
 * `units.id` is a business code (`AZW-B01-0003`), and `encodePublicId` throws on
 * anything that is not a uuid rather than quietly encoding the wrong thing.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function detailTokenFor(table: string, id: string): string | null {
  if (!UUID.test(id)) return null
  switch (table) {
    case "service_tickets":
    case "tickets":
      return encodePublicId("ticket", id)
    case "threads":
      return encodePublicId("thread", id)
    default:
      return null
  }
}
