import { readFile } from "node:fs/promises"
import path from "node:path"

import { createManifestHandler } from "@/lib/api-handler"
import { upstreamFailed } from "@/lib/api-errors"
import { RepositoryError } from "@/lib/repository-base"

export const dynamic = "force-dynamic"

/**
 * Serves `docs/api/openapi.yaml`.
 *
 * The document is generated from `lib/api-routes.ts` by
 * `scripts/generate-openapi.mjs`, so what this endpoint returns is what the
 * code declares — it cannot describe an endpoint that does not exist, and
 * `pnpm test:contract` fails the build if the file on disk has drifted from the
 * manifest by so much as a byte.
 *
 * Publishing it costs nothing an attacker could not learn by probing, and it
 * makes the parity claim checkable from outside the repository.
 */
export const GET = createManifestHandler("getOpenApiDocument", {
  handler: async () => {
    // `process.cwd()` is `apps/web` under both `next dev` and `next start`.
    const specPath = path.resolve(process.cwd(), "..", "..", "docs", "api", "openapi.yaml")
    try {
      const spec = await readFile(specPath, "utf8")
      return { data: spec, source: "local-seed" as const }
    } catch {
      // The path is not in the message. A file-system path in a response body
      // is exactly what `scrubInternals` exists to catch, and it is cheaper not
      // to produce one.
      throw new RepositoryError(
        upstreamFailed("The API specification could not be read.")
      )
    }
  },
  serialize: (spec) => ({
    body: spec,
    contentType: "application/yaml; charset=utf-8",
  }),
})
