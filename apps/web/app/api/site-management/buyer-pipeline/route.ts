import { createManifestHandler, type HandlerResult } from "@/lib/api-handler"
import { pipelineStages } from "@/lib/lead-data"
import {
  getBuyerPipeline,
  getPipelineSummary,
  updatePipelineEntryStage,
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

/**
 * Move one entry to another stage.
 *
 * `expectedVersion` is not optional. Without it this is a last-writer-wins
 * overwrite: two managers who both opened the same deal would both succeed, and
 * the second would silently erase the first's move. A mismatch is 409 and the
 * board re-reads.
 *
 * The handler passes `stage` and nothing else that touches the movement record.
 * `previous_stage` and `entered_stage_at` are the `track_pipeline_stage_change`
 * trigger's to maintain, so "days at this stage" cannot disagree with the move
 * that caused it.
 *
 * `reason` is validated (eight characters minimum) and is **not persisted** —
 * `buyer_pipeline_entries` has no column for it and this write may not widen
 * beyond `stage`. The move itself is audited; the sentence is not kept. The UI
 * says so, and the schema change that would fix it belongs to W1-A.
 */
export const PATCH = createManifestHandler("updateBuyerPipelineEntry", {
  schema: updatePipelineSchema,
  handler: async ({ body, profile }) => {
    const result = await updatePipelineEntryStage({
      role: profile.role,
      entryId: body.entryId,
      expectedVersion: body.expectedVersion,
      stage: body.stage,
      reason: body.reason,
    })
    return { data: result.data, source: result.source }
  },
})
