/**
 * Installs `./ts-resolve-hooks.mjs`.
 *
 * A separate file because `module.register()` loads hooks onto their own thread
 * and therefore needs a module *specifier*, not a function — and because static
 * imports in the entry module are hoisted above any `register()` call placed
 * inside it, so the hooks would be installed too late to matter.
 *
 * `module.registerHooks()` (same thread, single file, no `--import` needed)
 * landed in Node 22.15; this repository pins 22.14 in `.nvmrc`, so the
 * two-file form is the one that works here.
 *
 * Used as:
 *
 *   node --experimental-strip-types \
 *        --import ./scripts/register-ts-resolve.mjs \
 *        scripts/rbac-probe.mts
 */

import { register } from "node:module";

register("./ts-resolve-hooks.mjs", import.meta.url);
