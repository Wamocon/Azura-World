import { createManifestHandler, type HandlerResult } from "@/lib/api-handler"
import { notFound, validationFailed } from "@/lib/api-errors"
import { documentCategories } from "@/lib/document-data"
import {
  getDocument,
  getDocuments,
  getSignedDocumentUrl,
  type DocumentRecord,
  type SignedDocumentUrl,
} from "@/lib/document-repository"
import { RepositoryError } from "@/lib/repository-base"
import { createDocumentSchema } from "@/lib/validation/schemas"
import { readEnum, readId } from "@/lib/validation/query"

export const dynamic = "force-dynamic"

export const GET = createManifestHandler("getDocuments", {
  handler: async ({
    profile,
    limit,
    offset,
    query,
  }): Promise<HandlerResult<SignedDocumentUrl | DocumentRecord[]>> => {
    if (readEnum(query, "view", ["list", "signed-url"] as const) === "signed-url") {
      const id = readId(query, "id")
      if (id === undefined) {
        throw new RepositoryError(
          validationFailed("A document id is required to mint a signed URL.", {
            id: "Supply the document id.",
          })
        )
      }
      // Authorise against the caller's own scope FIRST. `getSignedDocumentUrl`
      // mints a URL for whatever id it is given; without this read, any
      // authenticated caller holding `documents:view` could mint a link to any
      // document in the system, and the link would then work for anyone.
      const visible = await getDocument(id, { role: profile.role })
      if (visible.data === null) {
        throw new RepositoryError(notFound("That document was not found."))
      }
      const signed = await getSignedDocumentUrl(id)
      if (signed.data === null) {
        throw new RepositoryError(notFound("That document has no stored file."))
      }
      return { data: signed.data, source: signed.source }
    }

    const unitId = readId(query, "unitId")
    const category = readEnum(query, "category", documentCategories)
    const result = await getDocuments({
      role: profile.role,
      limit,
      offset,
      ...(unitId === undefined ? {} : { unitId }),
      ...(category === undefined ? {} : { category }),
    })
    return { data: result.data, source: result.source }
  },
})

export const POST = createManifestHandler("createDocument", {
  schema: createDocumentSchema,
  handler: () => {
    throw new Error("unreachable: createDocument declares a write gap")
  },
})
