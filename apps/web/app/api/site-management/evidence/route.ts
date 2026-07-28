import { createManifestHandler } from "@/lib/api-handler"
import { getSourceHealth, getSources } from "@/lib/evidence-repository"

export const dynamic = "force-dynamic"

export const GET = createManifestHandler("getEvidenceSources", {
  handler: async ({ query }) => {
    const result =
      query.get("view") === "health"
        ? await getSourceHealth()
        : await getSources()
    return { data: result.data, source: result.source }
  },
})
