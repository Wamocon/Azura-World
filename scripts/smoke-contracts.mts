#!/usr/bin/env node
/**
 * Smoke test for the frozen provenance contract in CONTRACTS.md §1.
 *
 * Proves `assertFactInvariants` actually REJECTS each of the six invariant
 * violations — a validator that never rejects is not a validator — and that it
 * ACCEPTS well-formed facts, because one that rejects everything is equally
 * broken. Both directions, or neither claim is worth anything.
 *
 *   node --experimental-strip-types scripts/smoke-contracts.mts
 *   NO_COLOR=1 node --disable-warning=ExperimentalWarning \
 *     --experimental-strip-types scripts/smoke-contracts.mts
 *
 * Verified on Node 22.14.0: type stripping resolves the explicit `.ts`
 * specifier across the apps/web package boundary. Strip-only mode means
 * contracts.ts must contain no `enum`, no `namespace`, and no constructor
 * parameter properties — those are not erasable and fail to load.
 *
 * What this script will never do:
 *   · use a test framework or any npm dependency — plain Node only
 *   · assert merely that "something threw". Every rejection case checks the
 *     error TYPE, the invariant NUMBER, and that the dotted path is cited in
 *     the message, because a wrong-invariant throw is a silent false pass.
 *   · touch the network, the filesystem, or Supabase. Invariant 6 is exercised
 *     through the injected `snapshotExists` hook, never a real file read.
 *
 * Exit code is 0 only when every case passed, so this works as a gate.
 */

import {
  CONTRACT_VERSION,
  FactInvariantError,
  assertFactInvariants,
  displayValue,
  isSourcedFact,
  tierWins,
} from "../apps/web/lib/contracts.ts"
import type {
  AssertFactOptions,
  SourceRef,
  SourceTier,
  SourcedFact,
} from "../apps/web/lib/contracts.ts"

// ── colour ──────────────────────────────────────────────────────────────────
// Honour NO_COLOR and a non-TTY stdout, so redirected output pastes cleanly
// into a handoff document instead of carrying escape sequences.
const useColor =
  process.env["NO_COLOR"] === undefined && process.stdout.isTTY === true
const c = (code: string, text: string): string =>
  useColor ? `\x1b[${code}m${text}\x1b[0m` : text
const bold = (text: string): string => c("1", text)

// ── reporting ───────────────────────────────────────────────────────────────
let passes = 0
let failures = 0

function pass(label: string, detail: string): void {
  passes += 1
  console.log(`  ${c("32", "PASS")}  ${label}${detail ? ` — ${detail}` : ""}`)
}

function fail(label: string, detail: string): void {
  failures += 1
  console.log(`  ${c("31", "FAIL")}  ${label}${detail ? ` — ${detail}` : ""}`)
}

const show = (v: unknown): string => {
  if (v !== null && typeof v === "object" && "tier" in v) {
    const s = v as SourceRef
    return `${s.publisher} (tier ${s.tier})`
  }
  return JSON.stringify(v) ?? String(v)
}

// ── fixtures ────────────────────────────────────────────────────────────────
const hash = (ch: string): string => ch.repeat(64)

const src = (
  url: string,
  publisher: string,
  tier: SourceTier,
  snapshotHash: string,
  fetchedAt = "2026-07-27T09:00:00.000Z"
): SourceRef => ({ url, publisher, fetchedAt, snapshotHash, tier })

const OFFICIAL = src(
  "https://azuraworld.com/en/project",
  "Azura World",
  1,
  hash("a")
)
const DEVELOPER = src(
  "https://cebecigroup.com/projeler/azura-world",
  "Cebeci Group",
  2,
  hash("b")
)
// Two URLs on ONE host — the subtle case. Two sources is not two sources.
const SEASIDE_1 = src(
  "https://www.seaside-alanya.com/azura-world/1-1",
  "Seaside Alanya",
  4,
  hash("c")
)
const SEASIDE_2 = src(
  "https://www.seaside-alanya.com/azura-world/2-1",
  "Seaside Alanya",
  4,
  hash("d")
)
const TERRA = src("https://terra-property.com/azura-world", "Terra", 4, hash("e"))
// Same tier as TERRA, fetched a day later — exercises the documented
// "equal tier ⟹ more recent fetchedAt wins" tie-break.
const TERRA_FRESHER = src(
  "https://terra-property.com/azura-world?v=2",
  "Terra",
  4,
  hash("f"),
  "2026-07-28T09:00:00.000Z"
)

/** Snapshots all resolve. Passed to every case EXCEPT the invariant-6 case, so
 *  invariant 6 can never fire early and mask the invariant under test. */
const RESOLVES: AssertFactOptions = { snapshotExists: () => true }
/** Snapshots resolve to nothing — the only way invariant 6 is exercised here. */
const RESOLVES_NOT: AssertFactOptions = { snapshotExists: () => false }

// ── helpers ─────────────────────────────────────────────────────────────────
function expectReject(
  invariant: number,
  label: string,
  path: string,
  fact: SourcedFact<unknown>,
  options: AssertFactOptions
): void {
  const name = `[inv ${invariant}] ${label}`
  let caught: unknown = null
  try {
    assertFactInvariants(fact, path, options)
  } catch (err) {
    caught = err
  }

  if (caught === null) {
    return fail(name, "did NOT throw — this violation would reach a user")
  }
  if (!(caught instanceof FactInvariantError)) {
    const got = caught instanceof Error ? caught.constructor.name : typeof caught
    return fail(name, `threw ${got}, expected FactInvariantError`)
  }
  if (caught.invariant !== invariant) {
    return fail(
      name,
      `threw invariant=${caught.invariant}, expected ${invariant} — wrong rule fired`
    )
  }
  if (caught.path !== path) {
    return fail(name, `err.path="${caught.path}", expected "${path}"`)
  }
  if (!caught.message.includes(path)) {
    return fail(name, `message omits the dotted path: "${caught.message}"`)
  }
  return pass(
    name,
    `FactInvariantError(invariant=${caught.invariant}) cites "${path}"`
  )
}

function expectAccept(
  label: string,
  path: string,
  fact: SourcedFact<unknown>,
  options: AssertFactOptions
): void {
  try {
    assertFactInvariants(fact, path, options)
    return pass(label, `accepted "${path}" (confidence: ${fact.confidence})`)
  } catch (err) {
    const detail =
      err instanceof FactInvariantError
        ? `FactInvariantError(invariant=${err.invariant}) — ${err.message}`
        : String(err)
    return fail(label, `threw on a WELL-FORMED fact — ${detail}`)
  }
}

function expectEqual(label: string, actual: unknown, expected: unknown): void {
  if (Object.is(actual, expected)) return pass(label, `= ${show(expected)}`)
  return fail(label, `got ${show(actual)}, expected ${show(expected)}`)
}

// ── run ─────────────────────────────────────────────────────────────────────
console.log(`\n${bold("Azura World — contract invariant smoke test")}`)
console.log(
  "Module under test: apps/web/lib/contracts.ts  (CONTRACTS.md §1, six invariants)"
)

console.log(`\n${bold("0. Contract version")}`)
expectEqual("CONTRACT_VERSION is 1", CONTRACT_VERSION, 1)

console.log(`\n${bold("1. Rejection cases — assertFactInvariants MUST throw")}`)

// 1 — gap ⟹ value === null AND note non-empty
expectReject(
  1,
  "gap carrying a non-null value (an invented number)",
  "project.totalUnits",
  {
    value: 656,
    sources: [],
    confidence: "gap",
    note: "no source states a unit count",
  },
  RESOLVES
)
expectReject(
  1,
  "gap with an empty note (an unexplained absence)",
  "project.plotAreaSqm",
  { value: null, sources: [], confidence: "gap", note: "" },
  RESOLVES
)

// 2 — conflicted ⟹ conflictsWith.length >= 1
expectReject(
  2,
  "conflicted with no conflictsWith",
  "project.residenceBlockCount",
  { value: 12, sources: [OFFICIAL, SEASIDE_1], confidence: "conflicted" },
  RESOLVES
)
expectReject(
  2,
  "conflicted with an empty conflictsWith",
  "project.buildingCount",
  {
    value: 12,
    sources: [OFFICIAL, SEASIDE_1],
    confidence: "conflicted",
    conflictsWith: [],
  },
  RESOLVES
)

// 3 — confirmed ⟹ >= 2 sources with DISTINCT hosts
expectReject(
  3,
  "confirmed by two URLs on the SAME host (two pages is not two sources)",
  "hotel.roomCount",
  { value: 402, sources: [SEASIDE_1, SEASIDE_2], confidence: "confirmed" },
  RESOLVES
)
expectReject(
  3,
  "confirmed by a single source",
  "project.floorsPerBuilding",
  { value: 12, sources: [OFFICIAL], confidence: "confirmed" },
  RESOLVES
)

// 4 — inferred ⟹ note explains the computation
expectReject(
  4,
  "inferred with no note explaining the derivation",
  "project.buildingFootprintSqm",
  { value: 18400, sources: [OFFICIAL, DEVELOPER], confidence: "inferred" },
  RESOLVES
)

// 5 — sources.length === 0 is legal only for gap
expectReject(
  5,
  "zero sources with confidence other than gap",
  "units[0].askingPrice",
  {
    value: { amount: 189000, currency: "EUR" },
    sources: [],
    confidence: "single_source",
  },
  RESOLVES
)

// 6 — every snapshotHash resolves to a real file under sources/raw/
expectReject(
  6,
  "snapshotHash that does not resolve (a citation you cannot re-open)",
  "hotel.stars",
  { value: 5, sources: [TERRA], confidence: "single_source" },
  RESOLVES_NOT
)
expectReject(
  6,
  "snapshotHash that is not 64 hex characters",
  "hotel.floors",
  {
    value: 12,
    sources: [src("https://terra-property.com/x", "Terra", 4, "not-a-hash")],
    confidence: "single_source",
  },
  RESOLVES
)

console.log(
  `\n${bold("2. Acceptance cases — assertFactInvariants MUST NOT throw")}`
)

const officialFact: SourcedFact<unknown> = {
  value: "Cebeci Group",
  sources: [OFFICIAL],
  confidence: "official",
}
const confirmedFact: SourcedFact<unknown> = {
  value: 656,
  sources: [OFFICIAL, DEVELOPER],
  confidence: "confirmed",
}
const gapFact: SourcedFact<unknown> = {
  value: null,
  sources: [],
  confidence: "gap",
  note: "no fetched source states a completion date; not inferred from marketing copy",
}

expectAccept(
  "well-formed official fact, one tier-1 source",
  "project.developer",
  officialFact,
  RESOLVES
)
expectAccept(
  "well-formed confirmed fact, two DISTINCT hosts",
  "project.totalUnits",
  confirmedFact,
  RESOLVES
)
expectAccept(
  "well-formed gap — null value with a note",
  "project.completionDate",
  gapFact,
  RESOLVES
)
expectAccept(
  "well-formed conflicted fact with conflictsWith populated",
  "project.residenceBlockCount",
  {
    value: 12,
    sources: [OFFICIAL, SEASIDE_1],
    confidence: "conflicted",
    conflictsWith: [{ value: 9, source: SEASIDE_1 }],
  },
  RESOLVES
)
expectAccept(
  "well-formed inferred fact with a note explaining the computation",
  "project.buildingFootprintSqm",
  {
    value: 18400,
    sources: [OFFICIAL, DEVELOPER],
    confidence: "inferred",
    note: "plotAreaSqm 42000 minus greenAreaSqm 23600, both confirmed",
  },
  RESOLVES
)
expectAccept(
  "single_source whose snapshotHash DOES resolve (inv 6, passing direction)",
  "hotel.stars",
  { value: 5, sources: [TERRA], confidence: "single_source" },
  RESOLVES
)

console.log(`\n${bold("3. displayValue — a gap never leaks a value")}`)

expectEqual("displayValue(well-formed gap) is null", displayValue(gapFact), null)
// Belt and braces: even handed a malformed gap, displayValue must not surface it.
expectEqual(
  "displayValue(malformed gap holding 656) is still null",
  displayValue({
    value: 656,
    sources: [],
    confidence: "gap",
    note: "malformed on purpose",
  }),
  null
)
expectEqual(
  "displayValue(official) returns the value",
  displayValue(officialFact),
  "Cebeci Group"
)

console.log(`\n${bold("4. tierWins — lower tier wins, tie-break is documented")}`)

expectEqual("tier 4 vs tier 1 → tier 1", tierWins(SEASIDE_1, OFFICIAL), OFFICIAL)
expectEqual(
  "tier 1 vs tier 4 → tier 1 (argument order irrelevant)",
  tierWins(OFFICIAL, SEASIDE_1),
  OFFICIAL
)
expectEqual("tier 2 vs tier 4 → tier 2", tierWins(DEVELOPER, TERRA), DEVELOPER)
// Documented tie-break, rule 1: equal tier ⟹ the more recent fetchedAt wins.
expectEqual(
  "equal tier, TERRA_FRESHER newer → TERRA_FRESHER",
  tierWins(TERRA, TERRA_FRESHER),
  TERRA_FRESHER
)
expectEqual(
  "equal tier, reversed → still TERRA_FRESHER (recency, not position)",
  tierWins(TERRA_FRESHER, TERRA),
  TERRA_FRESHER
)
// Documented tie-break, rule 2: equal tier AND equal fetchedAt ⟹ `a` wins.
expectEqual(
  "equal tier and equal fetchedAt → first argument wins",
  tierWins(SEASIDE_1, SEASIDE_2),
  SEASIDE_1
)
expectEqual(
  "equal tier and equal fetchedAt, reversed → first argument wins",
  tierWins(SEASIDE_2, SEASIDE_1),
  SEASIDE_2
)
expectEqual(
  "tie-break is deterministic across calls",
  tierWins(SEASIDE_1, SEASIDE_2),
  tierWins(SEASIDE_1, SEASIDE_2)
)

console.log(`\n${bold("5. isSourcedFact — guards the boundary")}`)

expectEqual("isSourcedFact(well-formed fact)", isSourcedFact(officialFact), true)
expectEqual("isSourcedFact(null)", isSourcedFact(null), false)
expectEqual("isSourcedFact(bare number)", isSourcedFact(189000), false)
expectEqual(
  "isSourcedFact({ value } only — no sources)",
  isSourcedFact({ value: 656 }),
  false
)
expectEqual(
  'isSourcedFact({ confidence: "maybe" }) — not a Confidence',
  isSourcedFact({ value: 1, sources: [], confidence: "maybe" }),
  false
)

// ── summary ─────────────────────────────────────────────────────────────────
console.log(`\n${bold("Summary")}  ${passes} pass · ${failures} fail`)
if (failures > 0) {
  console.log(
    `\n${c("31", "The provenance contract is not enforced as specified. Fix apps/web/lib/contracts.ts —")}`
  )
  console.log(
    `${c("31", "do NOT relax this test, and do NOT amend CONTRACTS.md unilaterally (SYSTEM-PROMPT §6).")}\n`
  )
} else {
  console.log(
    `\n${c("32", "All six invariants reject; well-formed facts are accepted.")}\n`
  )
}

process.exit(failures > 0 ? 1 : 0)
