import { createManifestHandler, type HandlerResult } from "@/lib/api-handler"
import { ledgerEntryStatuses } from "@/lib/finance-data"
import {
  getFinanceSummary,
  getLedgerEntries,
  type FinanceSummary,
  type LedgerEntry,
} from "@/lib/finance-repository"
import { readEnum, readId } from "@/lib/validation/query"
import { currencies } from "@/lib/validation/vocab"

export const dynamic = "force-dynamic"

export const GET = createManifestHandler("getFinanceLedger", {
  /**
   * The return type is annotated rather than inferred.
   *
   * `view=summary` and `view=entries` return different shapes, and inference
   * would pick whichever branch came first and then reject the other. Writing
   * the union out states what the endpoint actually returns, which is also what
   * the OpenAPI operation has to describe.
   */
  handler: async ({
    profile,
    limit,
    offset,
    query,
  }): Promise<HandlerResult<FinanceSummary | LedgerEntry[]>> => {
    // `role` and `profileId` both go to the repository, and W2-A's finance
    // functions fail CLOSED when the role is absent. An owner's scope is
    // resolved server-side from the profile id; there is no parameter here that
    // widens it, because a parameter that could would be the whole exploit.
    const access = {
      role: profile.role,
      profileId: profile.id,
    }
    const unitId = readId(query, "unitId")
    const status = readEnum(query, "status", ledgerEntryStatuses)
    const period = readId(query, "period")
    const currency = readEnum(query, "currency", currencies)

    if (readEnum(query, "view", ["entries", "summary"] as const) === "summary") {
      const summary = await getFinanceSummary(access)
      return { data: summary.data, source: summary.source }
    }

    const result = await getLedgerEntries({
      ...access,
      limit,
      offset,
      ...(unitId === undefined ? {} : { unitId }),
      ...(status === undefined ? {} : { status }),
      ...(period === undefined ? {} : { period }),
      ...(currency === undefined ? {} : { currency }),
    })
    return { data: result.data, source: result.source }
  },
})
