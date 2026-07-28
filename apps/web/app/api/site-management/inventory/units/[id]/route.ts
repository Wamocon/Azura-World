import { createManifestHandler } from "@/lib/api-handler"
import { notFound } from "@/lib/api-errors"
import { getUnit } from "@/lib/inventory-repository"
import { RepositoryError } from "@/lib/repository-base"
import { updateUnitSchema } from "@/lib/validation/schemas"

export const dynamic = "force-dynamic"

export const GET = createManifestHandler("getInventoryUnit", {
  handler: async ({ params, profile }) => {
    const id = params.id ?? ""
    const result = await getUnit(id, {
      role: profile.role,
      ...(profile.id === null ? {} : { profileId: profile.id }),
    })
    // A unit outside the caller's scope comes back null, and so does one that
    // does not exist. Both answer 404, so the endpoint cannot be walked to
    // discover which unit ids are real.
    if (result.data === null) throw new RepositoryError(notFound("That unit was not found."))
    return { data: result.data, source: result.source }
  },
})

export const PATCH = createManifestHandler("updateInventoryUnit", {
  schema: updateUnitSchema,
  handler: () => {
    throw new Error("unreachable: updateInventoryUnit declares a write gap")
  },
})
