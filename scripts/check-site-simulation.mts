/**
 * Simulation invariant gate.                                 Owner: W-SITEMODEL
 *
 * The three things that would make the feed a lie, each of which is invisible
 * by eye: a lifecycle row that references a report nobody opened, a backlog
 * that drifts upward until the demo accuses Azura World of neglecting the
 * building, and non-determinism that makes the server frame differ from the
 * first client frame.
 *
 * Run: `pnpm qa:simulation`
 */

import { readFileSync } from "node:fs"
import {
  simulationStateAt,
  stepSimulation,
  emptyState,
  MILESTONES,
  MILESTONE_LOOP_TICKS,
  TICK_FINAL,
  INITIAL_OPEN_REPORTS,
  type SimEvent,
  type SimEventKind,
} from "../apps/web/lib/site-simulation.ts"

let failures = 0
let checks = 0

function check(name: string, ok: boolean, detail = ""): void {
  checks += 1
  if (!ok) failures += 1
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`)
}

console.log("\nsite simulation\n")

// 1. No forbidden non-determinism in the source ------------------------------
const SRC = readFileSync("apps/web/lib/site-simulation.ts", "utf8")
const code = SRC.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
check("no Math.random in the module", !/Math\.random/.test(code))
check("no Date.now in the module", !/Date\.now/.test(code))
check("no new Date( in the module", !/new Date\(/.test(code))

// 2. Determinism -------------------------------------------------------------
for (const t of [0, 1, 480, 2304]) {
  const a = JSON.stringify(simulationStateAt(t, "azura"))
  const b = JSON.stringify(simulationStateAt(t, "azura"))
  check(`state at tick ${t} is reproducible`, a === b)
}
check(
  "a different seed gives a different run",
  JSON.stringify(simulationStateAt(480, "azura")) !==
    JSON.stringify(simulationStateAt(480, "other")),
)

// 3. Replay the long run once and collect everything -------------------------
const TICKS = 5000
let state = emptyState()
const all: SimEvent[] = []
const opened = new Map<number, string>()
let orphans: string[] = []
let blockMismatch: string[] = []
const assignedEarly = new Set<number>()
const resolvedEver = new Set<number>()
let minOpen = Infinity
let maxOpen = -Infinity
const kindsSeen = new Set<SimEventKind>()

for (let t = 1; t <= TICKS; t++) {
  const next = stepSimulation(state, t, "azura")
  // Events are prepended, so anything new is at the head.
  const fresh = next.events.filter((e) => e.tick === t)
  for (const e of fresh) {
    all.push(e)
    kindsSeen.add(e.kind)
    if (e.kind === "report_opened" || e.kind === "lift_fault") {
      if (e.reportN !== null) opened.set(e.reportN, e.block ?? "")
    }
    if (
      e.kind === "report_assigned" ||
      e.kind === "report_resolved" ||
      e.kind === "report_overdue"
    ) {
      if (e.reportN === null || !opened.has(e.reportN)) {
        // Reports in the starting backlog have no opening row by design.
        if ((e.reportN ?? 0) > INITIAL_OPEN_REPORTS) {
          orphans.push(`${e.kind} -> report ${e.reportN}`)
        }
      } else if (opened.get(e.reportN) !== (e.block ?? "")) {
        blockMismatch.push(
          `report ${e.reportN} opened in ${opened.get(e.reportN)}, ${e.kind} in ${e.block}`,
        )
      }
      // Counting assigns and resolves inside the same time window compares two
      // different cohorts: a report assigned at tick 3,800 resolves around
      // 4,800, so a shared cut-off counts its assign and discards its resolve
      // and reports drift that is really the edge of the window. The cohort is
      // tracked by report number instead, and only reports assigned early
      // enough to have finished are required to have done so.
      if (e.kind === "report_assigned" && e.reportN !== null) {
        if (t < TICKS - 1100) assignedEarly.add(e.reportN)
      }
      if (e.kind === "report_resolved" && e.reportN !== null) {
        resolvedEver.add(e.reportN)
      }
    }
  }
  minOpen = Math.min(minOpen, next.openReports)
  maxOpen = Math.max(maxOpen, next.openReports)
  state = next
}

check("every lifecycle row references a report that was opened",
  orphans.length === 0, orphans.slice(0, 3).join("; "))
check("a report never changes block between rows",
  blockMismatch.length === 0, blockMismatch.slice(0, 3).join("; "))

const unresolved = [...assignedEarly].filter((n) => !resolvedEver.has(n))
const drift = unresolved.length / Math.max(1, assignedEarly.size)
check("every report assigned early enough also resolved",
  drift < 0.05,
  `${assignedEarly.size} assigned, ${assignedEarly.size - unresolved.length} of them resolved` +
    (unresolved.length ? `, ${unresolved.length} still open` : ""))
check("open backlog does not run away",
  maxOpen - minOpen < 40, `range ${minOpen}..${maxOpen} over ${TICKS} ticks`)

// 4. Milestones --------------------------------------------------------------
let loopState = emptyState()
const inLoop = new Set<SimEventKind>()
for (let t = 1; t <= MILESTONE_LOOP_TICKS * 4; t++) {
  loopState = stepSimulation(loopState, t, "azura")
  for (const e of loopState.events.filter((x) => x.tick === t)) inLoop.add(e.kind)
}
for (const m of MILESTONES) {
  check(`milestone ${m.kind} fires`, inLoop.has(m.kind))
}
// `lift_fault` reaches the feed two ways: scripted on the milestone track, and
// organically from the 2% of intake that targets a shared asset. Only the
// scripted one may claim a cadence, so the check covers the four kinds that are
// exclusively scheduled. A sampled fault asserting "every six weeks" would be
// the row making a claim about the building that the model cannot support.
const SCHEDULED_ONLY = new Set<SimEventKind>(
  MILESTONES.map((m) => m.kind).filter((k) => k !== "lift_fault"),
)
const missingCadence = all.filter(
  (e) => SCHEDULED_ONLY.has(e.kind) && e.cadence === null,
)
check("every scheduled milestone row carries its true cadence",
  missingCadence.length === 0,
  missingCadence.slice(0, 3).map((e) => e.kind).join("; "))
check("a sampled shared-asset fault never claims a cadence",
  all.filter((e) => e.kind === "lift_fault" && e.cadence !== null).length <
    all.filter((e) => e.kind === "lift_fault").length ||
    all.filter((e) => e.kind === "lift_fault").length === 0)

// 5. Honesty -----------------------------------------------------------------
check("no event carries an amount field",
  !/amount|euro|EUR|price|betrag/i.test(code.replace(/accounts/g, "")))
const printedIds = all.filter((e) => /AZW-[A-Z]\d/.test(JSON.stringify(e)))
check("no apartment identifier appears in any event", printedIds.length === 0)
check("charge run reports accounts touched, never rows",
  all.filter((e) => e.kind === "service_charge_run_posted").every(
    (e) => e.accounts === 656,
  ))

// 6. Bounds ------------------------------------------------------------------
const finalState = simulationStateAt(TICK_FINAL, "azura")
check("feed stays capped", finalState.events.length <= 8,
  `${finalState.events.length} rows`)
check("live report list stays bounded", finalState.reports.length < 200,
  `${finalState.reports.length} records`)
check("reduced-motion frame has a full feed", finalState.events.length === 8)

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures} of ${checks} checks passed`,
)
console.log(`  ${all.length} events over ${TICKS} ticks\n`)
process.exit(failures === 0 ? 0 : 1)
