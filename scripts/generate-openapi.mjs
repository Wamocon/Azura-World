/**
 * Regenerates `docs/api/openapi.yaml` from the route manifest.  Owner: W2-B
 *
 *   node scripts/generate-openapi.mjs
 *
 * Run this after changing `apps/web/lib/api-routes.ts`. `pnpm test:contract`
 * fails until you do, and tells you which line differs.
 *
 * A bootstrap for the same reason as `scripts/validate-openapi.mjs`.
 */

import { ensureTypeStripping } from "./ts-bootstrap.mjs"

const relaunchedExitCode = await ensureTypeStripping(import.meta.url)
if (relaunchedExitCode !== null) process.exit(relaunchedExitCode)

await import("./openapi-write.mjs")
