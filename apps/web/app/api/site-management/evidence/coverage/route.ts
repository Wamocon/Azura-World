import { createManifestHandler } from "@/lib/api-handler"
import { getEvidenceCoverage } from "@/lib/evidence-repository"

export const dynamic = "force-dynamic"

export const GET = createManifestHandler("getEvidenceCoverage", {
  handler: async () => {
    const result = await getEvidenceCoverage()
    return { data: result.data, source: result.source }
  },
})
