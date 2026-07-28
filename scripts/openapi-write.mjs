/**
 * Writes `docs/api/openapi.yaml` from the route manifest.    Owner: W2-B
 *
 *   node --experimental-strip-types \
 *        --import ./scripts/register-ts-resolve.mjs \
 *        scripts/generate-openapi.mjs
 *
 * The spec is a build output, not a source file. Editing it by hand is
 * pointless — `pnpm test:contract` rebuilds it and fails on any difference — and
 * that is the whole point: the document cannot describe an API the code does
 * not implement, because nobody writes the document.
 */

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { apiRoutes, apiTags } from "../apps/web/lib/api-routes.ts"
import { buildSpec, toYaml } from "./openapi-build.mjs"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const outPath = path.join(rootDir, "docs", "api", "openapi.yaml")

/**
 * A date, not a semver.
 *
 * The spec has no independent release cycle — it is regenerated whenever the
 * manifest changes — so a semantic version would be a number somebody had to
 * remember to bump, and would be wrong the first time they forgot. Taken from
 * the manifest's own contract date so the value is stable across runs and does
 * not churn the file on every regeneration.
 */
const SPEC_VERSION = "2026.07.28"

const yaml = toYaml(buildSpec(apiRoutes, apiTags, SPEC_VERSION))

await mkdir(path.dirname(outPath), { recursive: true })
await writeFile(outPath, yaml, "utf8")

const operationCount = apiRoutes.reduce((total, route) => total + route.operations.length, 0)
console.log(
  `Wrote ${path.relative(rootDir, outPath)} — ${apiRoutes.length} paths, ${operationCount} operations, ${yaml.length} bytes.`
)
