import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

/**
 * Re-exec the current script with the flags needed to import TypeScript.
 *
 * `package.json` declares `test:contract` as a bare `node
 * scripts/validate-openapi.mjs`, and `scripts/validate-openapi.mjs` needs to
 * import `apps/web/lib/api-routes.ts` — the manifest the whole gate is built on.
 * Under Node 22.14 that requires `--experimental-strip-types` plus W1-B's
 * resolver hooks, and a bare `node` invocation dies with
 * `ERR_UNKNOWN_FILE_EXTENSION`.
 *
 * `package.json` is W0-A's file (ORCHESTRATION §4), so this window cannot add
 * the flags to the script definition. The alternatives were worse: duplicating
 * the manifest as JSON would create the drift the manifest exists to prevent,
 * and parsing the `.ts` with a regex would be a second, weaker source of truth.
 * Re-exec keeps one source of truth and leaves the command exactly as declared.
 *
 * A `pnpm install`-free, package.json-free solution — which is the constraint,
 * not a preference. The request to fold the flags into the script definition is
 * in HANDOFF/W2-B.md; when that lands, this file's only cost is one extra
 * process that immediately finds the flags already present and returns null.
 */

const REQUIRED_FLAGS = ["--experimental-strip-types"]

function hasFlags() {
  return REQUIRED_FLAGS.every((flag) => process.execArgv.includes(flag))
}

/**
 * Returns the child's exit code when a relaunch happened, or `null` when the
 * current process already has what it needs and should carry on.
 */
export async function ensureTypeStripping(entryUrl) {
  if (hasFlags()) return null

  const entry = fileURLToPath(entryUrl)
  const register = fileURLToPath(new URL("./register-ts-resolve.mjs", import.meta.url))

  const child = spawn(
    process.execPath,
    [
      ...REQUIRED_FLAGS,
      // A file URL, not a path: `--import` misparses a Windows path containing
      // a space, and this repository lives under one.
      "--import",
      new URL("./register-ts-resolve.mjs", import.meta.url).href,
      entry,
      ...process.argv.slice(2),
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        // Suppresses the ExperimentalWarning banner so the gate's own output is
        // the only thing on stderr. The flag is still what enables the feature;
        // this only quiets the notice about it.
        NODE_NO_WARNINGS: "1",
      },
    }
  )

  void register

  return await new Promise((resolve) => {
    child.on("close", (code) => resolve(code ?? 1))
    child.on("error", () => resolve(1))
  })
}
