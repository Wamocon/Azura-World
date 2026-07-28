/**
 * `pnpm test:contract` — the API contract gate.              Owner: W2-B
 *
 * A bootstrap, not the gate itself. The checks live in
 * `scripts/openapi-contract-check.mjs`, which imports the TypeScript route
 * manifest and therefore needs flags a bare `node` invocation does not have.
 * See `scripts/ts-bootstrap.mjs` for why the flags cannot simply be added to the
 * `package.json` script.
 *
 * The dynamic import is load-bearing: a static one would be hoisted and would
 * fail before the relaunch could happen.
 */

import { ensureTypeStripping } from "./ts-bootstrap.mjs";

const relaunchedExitCode = await ensureTypeStripping(import.meta.url);
if (relaunchedExitCode !== null) process.exit(relaunchedExitCode);

await import("./openapi-contract-check.mjs");
