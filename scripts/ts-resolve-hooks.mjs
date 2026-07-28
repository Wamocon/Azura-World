/**
 * ESM resolution hooks that let plain Node load the app's TypeScript modules.
 *
 * Node's `--experimental-strip-types` will happily *execute* a `.ts` file, but
 * it will not *resolve* one: ESM requires a full specifier, so
 * `import { roles } from "./contracts"` — which is what the TypeScript compiler
 * and the Next bundler both want, under `moduleResolution: "bundler"` — fails
 * with `ERR_MODULE_NOT_FOUND`.
 *
 * `scripts/smoke-contracts.mts` (W0-A) sidesteps this because
 * `lib/contracts.ts` has no imports at all and can be named with an explicit
 * `.ts` from outside. Anything with intra-app imports cannot, which is every
 * module `scripts/rbac-probe.mts` and `scripts/ai-probe.mjs` need to test.
 *
 * The alternatives were worse: adding `allowImportingTsExtensions` means editing
 * `apps/web/tsconfig.json`, which W0-A owns; writing `./contracts.ts` in the
 * source means a compile error under the current config; and installing `tsx`
 * means `pnpm install`, which only W0-A may run.
 *
 * Registered via `scripts/register-ts-resolve.mjs`:
 *
 *   node --experimental-strip-types \
 *        --import ./scripts/register-ts-resolve.mjs \
 *        scripts/rbac-probe.mts
 *
 * Scope: **test harnesses only.** Nothing in `apps/web` runs through this — Next
 * resolves these specifiers itself. If a module loads here but not under `next
 * build`, the build is right and this file is irrelevant to the fix.
 */

/** Specifiers that already carry an extension Node can resolve unaided. */
const HAS_KNOWN_EXTENSION = /\.(m|c)?(j|t)sx?$|\.json$|\.node$/

/** Tried in order for an extensionless relative specifier. */
const CANDIDATE_SUFFIXES = [".ts", ".tsx", ".mts", "/index.ts", "/index.tsx"]

export async function resolve(specifier, context, nextResolve) {
  const relative = specifier.startsWith("./") || specifier.startsWith("../")
  if (!relative || HAS_KNOWN_EXTENSION.test(specifier)) {
    return nextResolve(specifier, context)
  }

  for (const suffix of CANDIDATE_SUFFIXES) {
    try {
      return await nextResolve(`${specifier}${suffix}`, context)
    } catch {
      // Try the next candidate. The original error is re-raised below if none
      // of them resolve, so a genuinely missing module still reports the
      // specifier the source actually wrote.
    }
  }

  return nextResolve(specifier, context)
}
