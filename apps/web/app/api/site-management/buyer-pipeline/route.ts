import { createManifestHandler, type HandlerResult } from "@/lib/api-handler"
import { pipelineStages } from "@/lib/lead-data"
import {
  getBuyerPipeline,
  getPipelineSummary,
  type PipelineEntryRecord,
  type PipelineSummary,
} from "@/lib/lead-repository"
import { updatePipelineSchema } from "@/lib/validation/schemas"
import { readEnum, readId } from "@/lib/validation/query"

export const dynamic = "force-dynamic"

export const GET = createManifestHandler("getBuyerPipeline", {
  handler: async ({
    profile,
    limit,
    offset,
    query,
  }): Promise<HandlerResult<PipelineSummary | PipelineEntryRecord[]>> => {
    const stage = readEnum(query, "stage", pipelineStages)
    const unitId = readId(query, "unitId")
    const options = {
      role: profile.role,
      limit,
      offset,
      ...(stage === undefined ? {} : { stage }),
      ...(unitId === undefined ? {} : { unitId }),
    }

    if (
      readEnum(query, "view", ["entries", "summary"] as const) === "summary"
    ) {
      const summary = await getPipelineSummary(options)
      return { data: summary.data, source: summary.source }
    }
    const result = await getBuyerPipeline(options)
    return { data: result.data, source: result.source }
  },
})

export const PATCH = createManifestHandler("updateBuyerPipelineEntry", {
  schema: updatePipelineSchema,
  handler: () => {
    throw new Error(
      "unreachable: updateBuyerPipelineEntry declares a write gap"
    )
  },
})
