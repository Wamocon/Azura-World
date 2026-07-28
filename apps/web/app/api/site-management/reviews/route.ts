import { createManifestHandler, type HandlerResult } from "@/lib/api-handler"
import type { ReviewQuoteRecord, ReviewSourceRecord } from "@/lib/hotel-data"
import {
  getReviewQuotes,
  getReviewSources,
  getReviewSummary,
  type ReviewSummary,
} from "@/lib/hotel-repository"
import { readEnum, readId, readInt, readText } from "@/lib/validation/query"

export const dynamic = "force-dynamic"

const VIEWS = ["sources", "quotes", "summary"] as const

export const GET = createManifestHandler("getHotelReviews", {
  handler: async ({
    limit,
    offset,
    query,
  }): Promise<
    HandlerResult<ReviewSummary | ReviewQuoteRecord[] | ReviewSourceRecord[]>
  > => {
    const platform = readText(query, "platform", 64)
    const base = {
      limit,
      offset,
      ...(platform === undefined ? {} : { platform }),
    }
    const view = readEnum(query, "view", VIEWS) ?? "sources"

    if (view === "summary") {
      // The scale is a choice the caller makes and the response always reports
      // back. Booking.com scores out of 10 and TripAdvisor out of 5; a summary
      // that normalised silently would be inventing a number.
      const normaliseTo = readInt(query, "normaliseTo", 5, 10) === 10 ? 10 : 5
      const result = await getReviewSummary({ ...base, normaliseTo })
      return { data: result.data, source: result.source }
    }
    if (view === "quotes") {
      const result = await getReviewQuotes(
        readId(query, "reviewSourceId"),
        base
      )
      return { data: result.data, source: result.source }
    }
    const result = await getReviewSources(base)
    return { data: result.data, source: result.source }
  },
})
