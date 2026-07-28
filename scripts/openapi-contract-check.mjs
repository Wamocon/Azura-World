/**
 * The API contract gate.                                     Owner: W2-B
 *
 *   pnpm test:contract
 *
 * Seven checks. Three prove the spec, the manifest and the filesystem describe
 * the same API; two are security properties that have nothing to do with
 * documentation; two keep the spec honest about what it cannot do.
 *
 * ## Why parity is structural here, not merely checked
 *
 * `docs/api/openapi.yaml` is generated from `apps/web/lib/api-routes.ts`. This
 * script regenerates it and compares byte for byte, so "the spec matches the
 * manifest" is not a property that can drift and then be detected — it is a
 * property that cannot become false without the gate failing on the next run.
 *
 * The genuinely interesting check is therefore #2: does the **filesystem** match
 * the manifest, in both directions? A route file with no manifest entry is a
 * shadow endpoint — reachable, undocumented, and outside every check in this
 * script. A manifest entry with no route file is a spec advertising an attack
 * surface that answers 404. Both fail here.
 *
 * ## Reporting
 *
 * Every failure is collected and printed together. A gate that stops at the
 * first problem turns one fix-and-rerun cycle into six, and the sixth failure is
 * usually the one that explains the other five.
 */

import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  apiRoutes,
  apiTags,
  isMutatingMethod,
} from "../apps/web/lib/api-routes.ts";
import { buildSpec, toYaml } from "./openapi-build.mjs";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const specPath = path.join(rootDir, "docs", "api", "openapi.yaml");
const apiRoot = path.join(rootDir, "apps", "web", "app", "api");
const outDir = path.join(rootDir, "quality", "results", "openapi-contract");

const SPEC_VERSION = "2026.07.28";

const failures = [];
const checks = [];
const exemptions = [];

function check(name, passed, detail) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
  if (!passed)
    failures.push(detail === undefined ? name : `${name}: ${detail}`);
}

/**
 * Record a property this gate did NOT verify, and why.
 *
 * Exemptions are printed, counted and written into the report. A check that
 * silently skips what it cannot reach reports "11 pass · 0 fail" and means
 * something weaker than it appears to — which is the failure mode this whole
 * script is built against.
 */
function exempt(property, target, owner, note) {
  exemptions.push({ property, target, owner, note });
}

// ---------------------------------------------------------------------------
// Filesystem discovery
// ---------------------------------------------------------------------------

async function walkRoutes(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkRoutes(absolute)));
    else if (entry.isFile() && entry.name === "route.ts") files.push(absolute);
  }
  return files;
}

/**
 * Which HTTP methods a route file exports.
 *
 * Regex over source text rather than an AST, matching the reference project's
 * approach. The fragile joint is that `export { handler as GET }` is invisible
 * to it — so a route written that way would vanish from the parity check, which
 * is the exact hole this script exists to close. Every route in this API uses
 * `export const GET = createManifestHandler(...)`, which the `const` branch
 * matches, and check 7 proves that is still true rather than assuming it.
 */
function methodsFromSource(source) {
  const methods = new Set();
  const pattern =
    /export\s+(?:(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(|const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=)/g;
  for (const match of source.matchAll(pattern)) {
    methods.add(match[1] ?? match[2]);
  }
  return [...methods];
}

function routePathFromFile(filePath) {
  const relative = path.relative(apiRoot, filePath).replace(/\\/g, "/");
  const route = relative.replace(/\/route\.ts$/, "");
  return `/api/${route.replace(/\[([^\]]+)\]/g, "{$1}")}`;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

let apiRootExists = true;
try {
  await access(apiRoot);
} catch {
  apiRootExists = false;
}

// A missing route tree is a legitimate early-wave state, and the reference's
// validator throws an uncaught error on it. Reporting it as a clean failure that
// names the owner keeps CLAUDE.md §5's rule intact: a failing script that says
// who owns the gap is information.
check(
  "apps/web/app/api exists",
  apiRootExists,
  apiRootExists
    ? undefined
    : "no route directory — W2-B has not written any routes",
);

const routeFiles = apiRootExists ? await walkRoutes(apiRoot) : [];
const implemented = new Set();
const routeSources = new Map();
for (const file of routeFiles) {
  const source = await readFile(file, "utf8");
  routeSources.set(file, source);
  const routePath = routePathFromFile(file);
  for (const method of methodsFromSource(source)) {
    implemented.add(`${method} ${routePath}`);
  }
}

const declared = new Set();
const operationIds = new Map();
for (const route of apiRoutes) {
  for (const operation of route.operations) {
    declared.add(`${operation.method} ${route.path}`);
    operationIds.set(
      operation.operationId,
      (operationIds.get(operation.operationId) ?? 0) + 1,
    );
  }
}

// -- 1. The spec on disk IS the manifest ------------------------------------

const expectedYaml = toYaml(buildSpec(apiRoutes, apiTags, SPEC_VERSION));
let actualYaml = null;
try {
  actualYaml = await readFile(specPath, "utf8");
} catch {
  actualYaml = null;
}

if (actualYaml === null) {
  check(
    "spec exists",
    false,
    "docs/api/openapi.yaml is missing — run pnpm openapi:generate",
  );
} else {
  const identical = actualYaml === expectedYaml;
  let detail;
  if (!identical) {
    const expectedLines = expectedYaml.split("\n");
    const actualLines = actualYaml.split("\n");
    const at = expectedLines.findIndex(
      (line, index) => line !== actualLines[index],
    );
    detail = `docs/api/openapi.yaml differs from the manifest at line ${at + 1} (expected ${JSON.stringify(expectedLines[at] ?? "")}, found ${JSON.stringify(actualLines[at] ?? "")}). Run pnpm openapi:generate.`;
  }
  check("spec matches the route manifest byte for byte", identical, detail);
}

// -- 2. Manifest ↔ filesystem, both directions ------------------------------

const undocumented = [...implemented]
  .filter((key) => !declared.has(key))
  .sort();
check(
  "no route file is missing from the manifest",
  undocumented.length === 0,
  undocumented.length === 0
    ? undefined
    : `shadow endpoints, reachable but undocumented and unchecked: ${undocumented.join(", ")}`,
);

const unimplemented = [...declared]
  .filter((key) => !implemented.has(key))
  .sort();
check(
  "no manifest entry is missing a route file",
  unimplemented.length === 0,
  unimplemented.length === 0
    ? undefined
    : `documented but not implemented, so the spec advertises a 404: ${unimplemented.join(", ")}`,
);

// -- 3. operationId is unique -----------------------------------------------

const duplicates = [...operationIds.entries()].filter(([, count]) => count > 1);
check(
  "every operationId is unique",
  duplicates.length === 0,
  duplicates.length === 0
    ? undefined
    : `duplicated: ${duplicates.map(([id]) => id).join(", ")}`,
);

// -- 4. SECURITY: no public route without a rate limit ----------------------

const unlimitedPublic = [];
const unjustifiedPublic = [];
for (const route of apiRoutes) {
  for (const operation of route.operations) {
    if (operation.permission !== null) continue;
    const target = `${operation.method} ${route.path}`;
    if (operation.external !== undefined) {
      exempt(
        "public route has a rate limit",
        target,
        operation.external.owner,
        operation.external.note,
      );
      if (
        operation.publicJustification === undefined ||
        operation.publicJustification.trim().length < 40
      ) {
        unjustifiedPublic.push(target);
      }
      continue;
    }
    if (operation.rateLimit === undefined) {
      unlimitedPublic.push(`${operation.method} ${route.path}`);
    }
    if (
      operation.publicJustification === undefined ||
      operation.publicJustification.trim().length < 40
    ) {
      unjustifiedPublic.push(`${operation.method} ${route.path}`);
    }
  }
}
check(
  "SECURITY — every public route has a rate limit",
  unlimitedPublic.length === 0,
  unlimitedPublic.length === 0
    ? undefined
    : `unauthenticated and unthrottled, which is a free amplifier: ${unlimitedPublic.join(", ")}`,
);
check(
  "SECURITY — every public route states why it is public",
  unjustifiedPublic.length === 0,
  unjustifiedPublic.length === 0
    ? undefined
    : `no written justification, so nobody can review the decision: ${unjustifiedPublic.join(", ")}`,
);

// -- 5. SECURITY: no mutating route without an audit write ------------------

const unaudited = [];
const unguarded = [];
for (const route of apiRoutes) {
  for (const operation of route.operations) {
    if (!isMutatingMethod(operation.method)) continue;
    const target = `${operation.method} ${route.path}`;
    if (operation.external !== undefined) {
      exempt(
        "mutating route writes an audit row",
        target,
        operation.external.owner,
        operation.external.note,
      );
      exempt(
        "mutating route is persistence-guarded",
        target,
        operation.external.owner,
        operation.external.note,
      );
      continue;
    }
    if (operation.audit === undefined) unaudited.push(target);
    if (operation.requiresPersistence !== true) unguarded.push(target);
  }
}
check(
  "SECURITY — every mutating route writes an audit row",
  unaudited.length === 0,
  unaudited.length === 0
    ? undefined
    : `an unaudited mutation is indistinguishable from one that never happened: ${unaudited.join(", ")}`,
);
check(
  "SECURITY — every mutating route is persistence-guarded",
  unguarded.length === 0,
  unguarded.length === 0
    ? undefined
    : `would return 200 against seed data, which is a fake success: ${unguarded.join(", ")}`,
);

// -- 6. HONESTY: a declared write gap must document 503 and no 2xx ----------

const dishonestGaps = [];
const missingSuccess = [];
for (const route of apiRoutes) {
  for (const operation of route.operations) {
    if (operation.external !== undefined) continue;
    const has2xx = operation.responses.some(
      (status) => status >= 200 && status < 300,
    );
    if (operation.writeGap !== undefined) {
      if (!operation.responses.includes(503) || has2xx) {
        dishonestGaps.push(`${operation.method} ${route.path}`);
      }
    } else if (!has2xx) {
      missingSuccess.push(`${operation.method} ${route.path}`);
    }
  }
}
check(
  "HONESTY — a write gap documents 503 and never a success",
  dishonestGaps.length === 0,
  dishonestGaps.length === 0
    ? undefined
    : `the spec would promise a success the endpoint cannot deliver: ${dishonestGaps.join(", ")}`,
);
check(
  "every operation declares a successful outcome or an explicit gap",
  missingSuccess.length === 0,
  missingSuccess.length === 0
    ? undefined
    : `no 2xx and no declared gap: ${missingSuccess.join(", ")}`,
);

// -- 7. Every route goes through createHandler ------------------------------

const externalDirs = new Set(
  apiRoutes
    .filter((route) =>
      route.operations.some((operation) => operation.external !== undefined),
    )
    .map((route) => route.dir),
);

const handRolled = [];
for (const [file, source] of routeSources) {
  const relative = path.relative(rootDir, file).replace(/\\/g, "/");
  const dir = path.relative(apiRoot, path.dirname(file)).replace(/\\/g, "/");
  if (externalDirs.has(dir)) {
    const owner =
      apiRoutes.find((route) => route.dir === dir)?.operations[0]?.external
        ?.owner ?? "unknown";
    exempt(
      "route is built by createManifestHandler",
      relative,
      owner,
      "file is owned by another task",
    );
    continue;
  }
  if (!source.includes("createManifestHandler")) handRolled.push(relative);
}
check(
  "SECURITY — every route is built by createManifestHandler",
  handRolled.length === 0,
  handRolled.length === 0
    ? undefined
    : `hand-rolled route handlers bypass the auth, rate-limit and audit sequence: ${handRolled.join(", ")}`,
);

// A route that exports its methods in a form the regex above cannot see would
// silently disappear from check 2. Catching the pattern directly is cheaper than
// discovering it after a shadow endpoint ships.
const reExported = [];
for (const [file, source] of routeSources) {
  if (/export\s*\{[^}]*\bas\s+(GET|POST|PATCH|DELETE)\b/.test(source)) {
    reExported.push(path.relative(rootDir, file).replace(/\\/g, "/"));
  }
}
check(
  "no route exports a method via a re-export",
  reExported.length === 0,
  reExported.length === 0
    ? undefined
    : `invisible to method discovery, so parity would silently pass: ${reExported.join(", ")}`,
);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const operationCount = apiRoutes.reduce(
  (total, route) => total + route.operations.length,
  0,
);
const mutating = apiRoutes.reduce(
  (total, route) =>
    total +
    route.operations.filter((operation) => isMutatingMethod(operation.method))
      .length,
  0,
);
const gaps = apiRoutes.reduce(
  (total, route) =>
    total +
    route.operations.filter((operation) => operation.writeGap !== undefined)
      .length,
  0,
);

const result = {
  generatedAt: new Date().toISOString(),
  spec: path.relative(rootDir, specPath).replace(/\\/g, "/"),
  openapi: "3.1.0",
  pathCount: apiRoutes.length,
  operationCount,
  routeFileCount: routeFiles.length,
  implementedOperations: implemented.size,
  mutatingOperations: mutating,
  declaredWriteGaps: gaps,
  publicOperations: apiRoutes.reduce(
    (total, route) =>
      total +
      route.operations.filter((operation) => operation.permission === null)
        .length,
    0,
  ),
  externalOperations: apiRoutes.reduce(
    (total, route) =>
      total +
      route.operations.filter((operation) => operation.external !== undefined)
        .length,
    0,
  ),
  checks,
  exemptions,
  passed: failures.length === 0,
  failures,
};

await mkdir(outDir, { recursive: true });
await writeFile(
  path.join(outDir, "openapi-contract-report.json"),
  `${JSON.stringify(result, null, 2)}\n`,
  "utf8",
);

for (const entry of checks) {
  console.log(`${entry.passed ? "pass" : "FAIL"}  ${entry.name}`);
  if (!entry.passed && entry.detail !== undefined)
    console.log(`      ${entry.detail}`);
}
if (exemptions.length > 0) {
  console.log(`\nNot verified by this gate (${exemptions.length}):`);
  for (const entry of exemptions) {
    console.log(
      `  ~     ${entry.property} — ${entry.target} (${entry.owner}: ${entry.note})`,
    );
  }
}

console.log(
  `\n${apiRoutes.length} paths · ${operationCount} operations · ${mutating} mutating · ${gaps} declared write gaps · ${result.publicOperations} public · ${result.externalOperations} externally owned`,
);
console.log(
  `${checks.filter((entry) => entry.passed).length} pass · ${failures.length} fail · ${exemptions.length} exempt`,
);

if (!result.passed) process.exit(1);
