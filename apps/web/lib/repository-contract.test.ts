/**
 * W2-A contract tests ACROSS every repository.
 *
 * `repository-base.test.ts` proves the envelope behaves correctly. This file
 * proves every repository actually uses it — enumerated programmatically, so a
 * new function cannot be added without a `source` field and quietly pass review.
 * That is required test 1 in the W2-A brief, and enumeration is the reason it
 * says "enumerate them programmatically and assert".
 *
 * Supabase is deliberately left UNCONFIGURED here, so every call takes the
 * local-seed path. That is what makes it possible to call ~70 exported functions
 * without a database — and it is simultaneously required test 2.
 *
 * Run (needs an alias/extension resolver — see HANDOFF/W2-A.md):
 *   node --experimental-strip-types --import <hook> --test apps/web/lib/repository-contract.test.ts
 */

import assert from "node:assert/strict"
import test from "node:test"

// Must happen BEFORE the repository modules are imported: `isSupabaseConfigured()`
// reads a module-level snapshot of the environment, so clearing these afterwards
// would have no effect.
delete process.env.NEXT_PUBLIC_SUPABASE_URL
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

import type { RepositoryResult } from "./contracts"

import * as communications from "./communications-repository"
import * as dashboard from "./dashboard-repository"
import * as documents from "./document-repository"
import * as evidence from "./evidence-repository"
import * as finance from "./finance-repository"
import * as governance from "./governance-repository"
import * as hotel from "./hotel-repository"
import * as inventory from "./inventory-repository"
import * as leads from "./lead-repository"
import * as operations from "./operations-repository"
import * as portal from "./portal-repository"
import * as search from "./search-repository"

const MODULES: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["communications", communications],
  ["dashboard", dashboard],
  ["documents", documents],
  ["evidence", evidence],
  ["finance", finance],
  ["governance", governance],
  ["hotel", hotel],
  ["inventory", inventory],
  ["leads", leads],
  ["operations", operations],
  ["portal", portal],
  ["search", search],
]

/**
 * A read is an exported async function whose name starts with `get`, `list` or
 * `search`. Mutations (`create*`, `update*`, `reverse*`, `settle*`, `append*`)
 * are excluded on purpose: calling them against a seed would assert nothing, and
 * against a configured database would write.
 */
function readFunctionsOf(mod: Record<string, unknown>): Array<[string, (...a: unknown[]) => unknown]> {
  return Object.entries(mod)
    .filter(([name, value]) =>
      typeof value === "function" && /^(get|list|search)[A-Z]/.test(name))
    .map(([name, value]) => [name, value as (...a: unknown[]) => unknown])
}

function isRepositoryResult(value: unknown): value is RepositoryResult<unknown> {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return (
    "data" in record &&
    "source" in record &&
    "fetchedAt" in record &&
    (record.source === "supabase" || record.source === "local-seed")
  )
}

/**
 * Reads take heterogeneous first arguments — an options object, an id, a
 * profile id. Passing a plausible value for each shape means "not callable
 * without arguments" never gets mistaken for "does not return a source".
 */
async function callRead(name: string, fn: (...a: unknown[]) => unknown): Promise<unknown> {
  const attempts: unknown[][] = [
    [],
    [{}],
    ["AZW-B01-0001"],
    ["b0000000-0000-4000-8000-000000000005"],
    ["F-001"],
    ["azura", 5],
    ["project", "AZW-TRK"],
  ]
  let lastError: unknown
  for (const args of attempts) {
    try {
      return await fn(...args)
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(
    `${name} could not be called with any known argument shape: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  )
}

// ---------------------------------------------------------------------------
// Required tests 1 and 2 — enumerated, not spot-checked
// ---------------------------------------------------------------------------

test("every repository exposes at least one read function", () => {
  for (const [label, mod] of MODULES) {
    assert.ok(
      readFunctionsOf(mod).length > 0,
      `${label} exports no get*/list*/search* function — the module is empty or misnamed`,
    )
  }
})

test("EVERY repository read returns a RepositoryResult carrying `source` — enumerated, so a new function cannot skip it", async () => {
  const checked: string[] = []

  for (const [label, mod] of MODULES) {
    for (const [name, fn] of readFunctionsOf(mod)) {
      const result = await callRead(`${label}.${name}`, fn)
      assert.ok(
        isRepositoryResult(result),
        `${label}.${name} did not return a RepositoryResult with data/source/fetchedAt`,
      )
      assert.doesNotThrow(
        () => new Date((result as RepositoryResult<unknown>).fetchedAt).toISOString(),
        `${label}.${name} returned an unparseable fetchedAt`,
      )
      checked.push(`${label}.${name}`)
    }
  }

  // Guards against the enumeration silently matching nothing and the whole
  // suite passing vacuously.
  assert.ok(checked.length >= 40,
    `expected the repository layer to expose at least 40 reads, enumerated only ${checked.length}`)
  console.log(`      enumerated ${checked.length} repository reads across ${MODULES.length} modules`)
})

test("with Supabase unconfigured, EVERY repository read reports source local-seed and explains the fallback", async () => {
  for (const [label, mod] of MODULES) {
    for (const [name, fn] of readFunctionsOf(mod)) {
      const result = (await callRead(`${label}.${name}`, fn)) as RepositoryResult<unknown>
      assert.equal(result.source, "local-seed",
        `${label}.${name} reported "${result.source}" with no Supabase configured`)
      assert.ok(result.degradedReason,
        `${label}.${name} fell back to seed data without saying why`)
    }
  }
})

test("no repository read returns null or undefined data", async () => {
  for (const [label, mod] of MODULES) {
    for (const [name, fn] of readFunctionsOf(mod)) {
      const result = (await callRead(`${label}.${name}`, fn)) as RepositoryResult<unknown>
      // `null` is a legitimate payload for a getX(id) miss; `undefined` never is.
      assert.notEqual(result.data, undefined,
        `${label}.${name} returned undefined data — a miss is null, an empty list is []`)
    }
  }
})

// ---------------------------------------------------------------------------
// Required test 7 — seed determinism
// ---------------------------------------------------------------------------

test("every seed builder is deterministic: two calls produce byte-identical JSON", async () => {
  const dataModules = await Promise.all([
    import("./evidence-data"),
    import("./inventory-data"),
    import("./portal-data"),
    import("./hotel-data"),
    import("./finance-data"),
    import("./operations-data"),
    import("./document-data"),
    import("./communications-data"),
    import("./governance-data"),
    import("./lead-data"),
    import("./dashboard-data"),
  ])

  let builders = 0

  for (const mod of dataModules) {
    for (const [name, value] of Object.entries(mod as Record<string, unknown>)) {
      if (typeof value !== "function" || !/^seed[A-Z]/.test(name)) continue
      let first: unknown
      try {
        first = (value as () => unknown)()
      } catch {
        continue // a builder that needs arguments; covered by its own repository
      }
      if (first === undefined) continue
      const second = (value as () => unknown)()
      assert.equal(
        JSON.stringify(first),
        JSON.stringify(second),
        `${name}() is not deterministic — two calls differ, which breaks Playwright snapshots`,
      )
      builders++
    }
  }

  assert.ok(builders >= 20,
    `expected at least 20 zero-argument seed builders, exercised only ${builders}`)
  console.log(`      verified ${builders} seed builders are byte-stable`)
})

test("seed builders return fresh arrays — a caller cannot poison the seed for the next call", async () => {
  const { seedFindings } = await import("./evidence-data")
  const first = seedFindings()
  assert.ok(Array.isArray(first) && first.length > 0, "seedFindings() returns a non-empty array")
  first.length = 0
  const second = seedFindings()
  assert.ok(second.length > 0, "truncating the returned array did not damage the next call")
})

// ---------------------------------------------------------------------------
// Required tests 5 and 6 — role scoping in seed mode
//
// The Supabase half of these is proved by pgTAP (04-rls-negative.sql, against a
// real database and real policies). These are the seed-mode half, which is the
// mode where RLS does not exist and repository scoping is the ONLY boundary.
// ---------------------------------------------------------------------------

test("an owner cannot retrieve another owner's unit in seed mode", async () => {
  const units = await inventory.getUnits({ role: "owner", profileId: OWNER_ID, limit: 500 })
  const ids = (units.data as Array<{ id: string }>).map((u) => u.id)

  assert.ok(ids.includes(OWNER_UNIT),
    "the owner does reach its own unit — otherwise the denial below would be vacuous")
  assert.ok(!ids.includes(OTHER_OWNER_UNIT),
    "AN OWNER CANNOT REACH ANOTHER OWNER'S UNIT IN SEED MODE")
})

test("a child_owner retrieves a strict subset of its guardian in seed mode", async () => {
  const guardian = await inventory.getUnits({ role: "owner", profileId: OWNER_ID, limit: 500 })
  const child = await inventory.getUnits({ role: "child_owner", profileId: CHILD_OWNER_ID, limit: 500 })

  const guardianIds = new Set((guardian.data as Array<{ id: string }>).map((u) => u.id))
  const childIds = (child.data as Array<{ id: string }>).map((u) => u.id)

  for (const id of childIds) {
    assert.ok(guardianIds.has(id),
      `child_owner reached ${id}, which its guardian cannot — a child may never widen its guardian`)
  }
  assert.ok(!childIds.includes(OTHER_OWNER_UNIT),
    "a child_owner cannot reach the other owner's unit")
})

test("a guest reaches no privately held unit in seed mode", async () => {
  const guest = await inventory.getUnits({ role: "guest", limit: 500 })
  const ids = (guest.data as Array<{ id: string }>).map((u) => u.id)
  assert.ok(!ids.includes(OWNER_UNIT), "a guest cannot reach an owner's unit")
  assert.ok(!ids.includes(OTHER_OWNER_UNIT), "a guest cannot reach the other owner's unit")
})

const OWNER_ID = "b0000000-0000-4000-8000-000000000005"
const CHILD_OWNER_ID = "b0000000-0000-4000-8000-000000000009"
const OWNER_UNIT = "AZW-B01-0001"
const OTHER_OWNER_UNIT = "AZW-B01-0002"

// ---------------------------------------------------------------------------
// Required test 8 — coverage totals reconcile against the seed's own counts
// ---------------------------------------------------------------------------

test("getEvidenceCoverage() totals match the seed's own counts rather than being reported independently", async () => {
  const coverage = await evidence.getEvidenceCoverage()
  const report = coverage.data as {
    totals: { sources: number; facts: number; findings: number }
    facts: { byConfidence: Record<string, number> }
    findings: { bySeverity: Record<string, number> }
  }

  const { seedSources, seedFindings, seedFactEntries } = await import("./evidence-data")

  assert.equal(report.totals.sources, seedSources().length,
    "the reported source count matches the seed")
  assert.equal(report.totals.findings, seedFindings().length,
    "the reported finding count matches the seed")

  const confidenceTotal = Object.values(report.facts.byConfidence).reduce((a, b) => a + b, 0)
  assert.equal(confidenceTotal, report.totals.facts,
    "the per-confidence breakdown sums to the reported fact total — a bucket cannot go missing")
  assert.equal(report.totals.facts, seedFactEntries().length,
    "the reported fact total matches the seed")

  const severityTotal = Object.values(report.findings.bySeverity).reduce((a, b) => a + b, 0)
  assert.equal(severityTotal, report.totals.findings,
    "the per-severity breakdown sums to the reported finding total")

  assert.ok(report.facts.byConfidence.gap !== undefined,
    "coverage reports declared gaps — an evidence cockpit that hides its gaps is useless")
})
