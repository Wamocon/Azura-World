import { createManifestHandler, type HandlerResult } from "@/lib/api-handler"
import { notFound } from "@/lib/api-errors"
import type { HotelRecord } from "@/lib/hotel-data"
import {
  getHotel,
  getHotelRooms,
  type HotelRoomBreakdown,
} from "@/lib/hotel-repository"
import { RepositoryError } from "@/lib/repository-base"
import { readEnum } from "@/lib/validation/query"

export const dynamic = "force-dynamic"

export const GET = createManifestHandler("getHotel", {
  handler: async ({
    limit,
    query,
  }): Promise<HandlerResult<HotelRecord | HotelRoomBreakdown>> => {
    if (readEnum(query, "view", ["hotel", "rooms"] as const) === "rooms") {
      const rooms = await getHotelRooms({ limit })
      return { data: rooms.data, source: rooms.source }
    }
    const result = await getHotel()
    if (result.data === null) {
      throw new RepositoryError(notFound("No hotel record is available."))
    }
    return { data: result.data, source: result.source }
  },
})
