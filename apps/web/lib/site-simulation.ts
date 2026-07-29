/**
 * A day of operations on the site, as pure arithmetic.       Owner: W-SITEMODEL
 *
 * This module returns event **kinds and parameters**. It contains no copy, no
 * React and no DOM, so the same function produces the server's first frame and
 * the browser's tenth minute, and a Node gate can replay five thousand ticks of
 * it without a renderer.
 *
 * ## Why it is not fourteen independent random streams
 *
 * The obvious way to build this is to sample every event type on its own timer.
 * It looks busy and it demonstrates nothing: it dispatches and resolves reports
 * that were never opened. The one thing an operations system does that a
 * spreadsheet cannot is **link records over time**.
 *
 * So only *intake* is sampled. Everything else is a scheduled consequence of a
 * specific simulated report, carrying that report's number and that report's
 * block. A viewer can watch one record open, wait, get assigned, and later
 * close. That is the entire argument, and it is why `SimReport` exists.
 *
 * ## Determinism is a requirement, not a nicety
 *
 * `Math.random()` and `Date.now()` are banned here. The server frame must equal
 * the first client frame or React tears the tree down and rebuilds it;
 * Playwright cannot assert against a feed that differs every run; and a bug in
 * a simulation is only reproducible if the simulation is. Every draw comes from
 * `createRng(hashSeed(seedKey + ":" + tick))`, so any tick can be reproduced in
 * isolation without replaying the ones before it.
 *
 * ## What it deliberately does not model
 *
 * No money, anywhere. No apartment identifiers: F-011 records that the block
 * and sequence codes in this system are internal addressing keys rather than
 * the developer's unit numbers, so printing one invites somebody to look up an
 * apartment that does not exist under that number. No hotel room numbers, room
 * types, occupancy or stay lengths: `public.hotel_rooms` ships empty on purpose
 * and a plausible room mix is exactly the fabrication the project forbids. No
 * per-block unit counts, because no source publishes how 656 apartments divide
 * across the blocks.
 */

import { createRng, hashSeed } from "@/lib/simulation-clock"
import { siteBlocks } from "@/lib/site-geometry"

// ---------------------------------------------------------------------------
// Clocks
// ---------------------------------------------------------------------------

/** A twelve-hour operating day. Every rate below divides this. */
export const OPERATING_MINUTES_PER_DAY = 720

/** 150x. Printed on screen in words rather than inflating the rates. */
export const SIM_MINUTES_PER_REAL_SECOND = 2.5

export const TICK_MS = 250
export const SIM_MINUTES_PER_TICK =
  (SIM_MINUTES_PER_REAL_SECOND * TICK_MS) / 1000 // 0.625

export const TICKS_PER_SIM_DAY = Math.round(
  OPERATING_MINUTES_PER_DAY / SIM_MINUTES_PER_TICK,
) // 1152

/** Two real minutes. Every milestone appears at least once inside one. */
export const MILESTONE_LOOP_TICKS = 480

/** Two simulated days: the frame reduced motion and no-JS both render. */
export const TICK_FINAL = 2304

/** The feed never grows without bound. */
export const FEED_MAX = 8

/** A backlog that neither drains nor grows. See `stepSimulation`. */
export const INITIAL_OPEN_REPORTS = 6

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export type SimGroup = "intake" | "work" | "money" | "exception" | "milestone"

export type SimEventKind =
  // sampled intake
  | "report_opened"
  | "resident_message"
  | "payment_received"
  | "payment_overdue"
  | "finance_approval_requested"
  | "document_filed"
  | "activity_opened"
  | "vendor_invoice_approved"
  // scheduled consequences of a specific report
  | "report_assigned"
  | "report_resolved"
  | "report_overdue"
  // scripted milestones
  | "hotel_check_in"
  | "hotel_check_out"
  | "lift_fault"
  | "service_charge_run_posted"
  | "unit_handover"

export interface SimEvent {
  /** Stable across a replay, so React keys never collide. */
  readonly id: string
  readonly kind: SimEventKind
  readonly group: SimGroup
  /** Block letter, or null where the event belongs to the whole site. */
  readonly block: string | null
  /** The report this row belongs to, for the three lifecycle rows. */
  readonly reportN: number | null
  /** Shared asset rather than an apartment: a lift, a pool, the grounds. */
  readonly shared: boolean
  /** Tick it fired on. The renderer turns this into a time of day. */
  readonly tick: number
  /** Milestones print how often they really happen. Others do not. */
  readonly cadence: "daily" | "monthly" | "six-weekly" | null
  /** Accounts touched by the charge run. Never an amount. */
  readonly accounts: number | null
}

export interface SimReport {
  readonly n: number
  readonly block: string
  readonly shared: boolean
  readonly openedTick: number
  /**
   * Which row announces this record's arrival. A report raised against a lift
   * or a pool reads as a fault; a clean scheduled by a departure reads as
   * ordinary work. Carried on the record rather than derived at render time,
   * because the opening row and the lifecycle rows that follow it must agree
   * and they are emitted hundreds of ticks apart.
   */
  readonly openKind: SimEventKind
  readonly openGroup: SimGroup
  /** Milestone-scheduled records print their true cadence on the opening row. */
  readonly openCadence: SimEvent["cadence"]
  readonly assignTick: number | null
  readonly resolveTick: number | null
  readonly slaTick: number
  readonly missesSla: boolean
}

export interface SimState {
  readonly tick: number
  readonly reports: readonly SimReport[]
  readonly nextReportN: number
  /** Newest first, capped at FEED_MAX. */
  readonly events: readonly SimEvent[]
  readonly openReports: number
  readonly milestoneLoop: number
}

// ---------------------------------------------------------------------------
// Rates, per simulated operating minute
// ---------------------------------------------------------------------------

interface IntakeRate {
  readonly kind: SimEventKind
  readonly group: SimGroup
  readonly perSimMinute: number
  readonly target: "block" | "site"
}

/**
 * Sampled total 0.114/sim-min. With consequences that lands near 0.16, or one
 * row roughly every two and a half real seconds, which is readable rather than
 * a scroll. Each rate is chosen against the real stock: 656 apartments
 * completed in May 2024, plus pools, lifts, a water park and the grounds.
 */
export const INTAKE_RATES: readonly IntakeRate[] = Object.freeze([
  // ~0.8 reports per apartment per month.
  { kind: "report_opened", group: "intake", perSimMinute: 0.025, target: "block" },
  // ~1 message per apartment per 26 days, across four languages.
  { kind: "resident_message", group: "intake", perSimMinute: 0.035, target: "block" },
  { kind: "payment_received", group: "money", perSimMinute: 0.03, target: "site" },
  // The single most useful thing this software does for a manager.
  { kind: "payment_overdue", group: "exception", perSimMinute: 0.004, target: "block" },
  { kind: "finance_approval_requested", group: "money", perSimMinute: 0.003, target: "block" },
  { kind: "document_filed", group: "work", perSimMinute: 0.012, target: "block" },
  { kind: "activity_opened", group: "work", perSimMinute: 0.003, target: "block" },
  { kind: "vendor_invoice_approved", group: "money", perSimMinute: 0.002, target: "site" },
])

/** Two percent of reports concern a lift, a pool or the grounds. */
const SHARED_ASSET_SHARE = 0.02
/** The rest are rejected, which is a real transition in the workflow. */
const ASSIGN_SHARE = 0.88
/** Well below the seed fixture's 2-in-9, which exists to exercise states. */
const SLA_MISS_SHARE = 0.08

const SLA_SIM_MINUTES = 240

interface Milestone {
  readonly offset: number
  readonly kind: SimEventKind
  readonly group: SimGroup
  readonly cadence: SimEvent["cadence"]
}

/**
 * Scripted rather than sampled, so all five appear inside a two-minute viewing.
 * Each row prints its true cadence, which is what stops its on-screen frequency
 * from becoming a claim about the building.
 */
export const MILESTONES: readonly Milestone[] = Object.freeze([
  { offset: 48, kind: "hotel_check_in", group: "milestone", cadence: "daily" },
  { offset: 136, kind: "lift_fault", group: "exception", cadence: "six-weekly" },
  { offset: 232, kind: "hotel_check_out", group: "milestone", cadence: "daily" },
  { offset: 344, kind: "service_charge_run_posted", group: "money", cadence: "monthly" },
  { offset: 440, kind: "unit_handover", group: "milestone", cadence: "monthly" },
])

/** Rotating the schedule keeps it from being metronomic, deterministically. */
const MILESTONE_ROTATION = 37

/** 656 apartments settle a monthly charge. Count only, never an amount. */
const CHARGE_RUN_ACCOUNTS = 656

/** Only the blocks a resident actually lives in can raise a report. */
const RESIDENTIAL_KEYS: readonly string[] = Object.freeze(
  siteBlocks.filter((b) => b.role === "residence").map((b) => b.key),
)

// ---------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------

function drawBlock(random: number): string {
  const i = Math.min(
    RESIDENTIAL_KEYS.length - 1,
    Math.floor(random * RESIDENTIAL_KEYS.length),
  )
  return RESIDENTIAL_KEYS[i] ?? "A"
}

function simMinutesToTicks(minutes: number): number {
  return Math.round(minutes / SIM_MINUTES_PER_TICK)
}

/** The simulated hour of day, 0..23, for the milestones that are time-bound. */
export function simHourAt(tick: number): number {
  const minutesIntoDay = (tick % TICKS_PER_SIM_DAY) * SIM_MINUTES_PER_TICK
  // The operating day runs 08:00 to 20:00, so a 720-minute span starts at 8.
  return 8 + Math.floor(minutesIntoDay / 60)
}

export function emptyState(): SimState {
  const reports: SimReport[] = []
  // A standing backlog, so the feed shows work already in progress without
  // implying the site is deteriorating. These never resolve on screen; they
  // exist so `openReports` starts somewhere honest.
  for (let i = 0; i < INITIAL_OPEN_REPORTS; i++) {
    reports.push({
      n: i + 1,
      block: RESIDENTIAL_KEYS[i % RESIDENTIAL_KEYS.length] ?? "A",
      shared: false,
      // Never equal to a real tick, so these are never announced. They exist so
      // the open count starts somewhere honest rather than at zero.
      openedTick: -1,
      openKind: "report_opened",
      openGroup: "intake",
      openCadence: null,
      assignTick: null,
      resolveTick: null,
      slaTick: Number.MAX_SAFE_INTEGER,
      missesSla: false,
    })
  }
  return {
    tick: 0,
    reports,
    nextReportN: INITIAL_OPEN_REPORTS + 1,
    events: [],
    openReports: INITIAL_OPEN_REPORTS,
    milestoneLoop: 0,
  }
}

/**
 * One tick. Pure: same `(prev, tick, seedKey)` always yields the same state.
 *
 * Order matters. Consequences are emitted before new intake so that a report
 * cannot open and be assigned inside the same tick, which would read as the
 * system doing something impossible.
 */
export function stepSimulation(
  prev: SimState,
  tick: number,
  seedKey: string,
): SimState {
  const rng = createRng(hashSeed(`${seedKey}:${tick}`))
  const fired: SimEvent[] = []
  const reports = [...prev.reports]
  let nextReportN = prev.nextReportN
  let openReports = prev.openReports

  const push = (
    kind: SimEventKind,
    group: SimGroup,
    opts: {
      block?: string | null
      reportN?: number | null
      shared?: boolean
      cadence?: SimEvent["cadence"]
      accounts?: number | null
    } = {},
  ): void => {
    fired.push({
      id: `${tick}:${kind}:${opts.reportN ?? fired.length}`,
      kind,
      group,
      block: opts.block ?? null,
      reportN: opts.reportN ?? null,
      shared: opts.shared ?? false,
      tick,
      cadence: opts.cadence ?? null,
      accounts: opts.accounts ?? null,
    })
  }

  // --- 1. consequences of records that already exist ------------------------
  for (let i = 0; i < reports.length; i++) {
    const r = reports[i]
    if (r === undefined) continue
    // A record scheduled by an earlier event opens here. Without this, a
    // departure's cleaning job was assigned and resolved on screen while the
    // row that opened it never appeared, so the feed showed lifecycle rows for
    // a report nobody could see being raised.
    if (r.openedTick === tick) {
      push(r.openKind, r.openGroup, {
        block: r.block,
        reportN: r.n,
        shared: r.shared,
        cadence: r.openCadence,
      })
      openReports += 1
    }
    if (r.assignTick === tick) {
      push("report_assigned", "work", {
        block: r.block,
        reportN: r.n,
        shared: r.shared,
      })
    }
    if (r.resolveTick === tick) {
      push("report_resolved", "work", {
        block: r.block,
        reportN: r.n,
        shared: r.shared,
      })
      openReports = Math.max(0, openReports - 1)
    }
    if (r.missesSla && r.slaTick === tick && r.resolveTick !== null && r.resolveTick > tick) {
      push("report_overdue", "exception", {
        block: r.block,
        reportN: r.n,
        shared: r.shared,
      })
    }
  }

  // --- 2. scripted milestones ----------------------------------------------
  const loop = Math.floor(tick / MILESTONE_LOOP_TICKS)
  const withinLoop = tick % MILESTONE_LOOP_TICKS
  const rotation = (loop * MILESTONE_ROTATION) % MILESTONE_LOOP_TICKS
  for (const m of MILESTONES) {
    const at = (m.offset + rotation) % MILESTONE_LOOP_TICKS
    if (at !== withinLoop) continue
    const hour = simHourAt(tick)
    // The shape of the day is real: check-in from 14:00, check-out before
    // 12:00, both confirmed by two sources. Nothing else about a stay is.
    if (m.kind === "hotel_check_in" && hour < 14) continue
    if (m.kind === "hotel_check_out" && hour >= 12) continue

    if (m.kind === "service_charge_run_posted") {
      push(m.kind, m.group, { cadence: m.cadence, accounts: CHARGE_RUN_ACCOUNTS })
      continue
    }
    if (m.kind === "lift_fault") {
      // Scheduled so it reliably appears in a two-minute viewing, but opened as
      // a real record with a lifecycle rather than a bare row. A lift fault is
      // a service ticket in this schema like any other, so a separate stream
      // would double-count intake against the sampled shared-asset draw.
      const n = nextReportN++
      const assignIn = simMinutesToTicks(4 + rng() * 36)
      const faultBlock = drawBlock(rng())
      reports.push({
        n,
        block: faultBlock,
        shared: true,
        openedTick: tick,
        openKind: "lift_fault",
        openGroup: "exception",
        openCadence: m.cadence,
        assignTick: tick + assignIn,
        resolveTick: tick + assignIn + simMinutesToTicks(90 + rng() * 510),
        slaTick: tick + simMinutesToTicks(SLA_SIM_MINUTES),
        missesSla: false,
      })
      openReports += 1
      // Announced here, not left to the consequences loop. That loop has
      // already run for this tick, so a record appended now would be assigned
      // and resolved on screen without ever having been opened.
      push("lift_fault", "exception", {
        block: faultBlock,
        reportN: n,
        shared: true,
        cadence: m.cadence,
      })
      continue
    }
    if (m.kind === "hotel_check_out") {
      push(m.kind, m.group, { cadence: m.cadence })
      // One event visibly producing another: a departure schedules a clean.
      // It opens twenty simulated minutes later, through the same path as any
      // other record, so its opening row appears before its lifecycle rows.
      const n = nextReportN++
      const opensAt = tick + simMinutesToTicks(20)
      const assignIn = simMinutesToTicks(4 + rng() * 36)
      reports.push({
        n,
        block: "C2",
        shared: true,
        openedTick: opensAt,
        openKind: "report_opened",
        openGroup: "work",
        openCadence: null,
        assignTick: opensAt + assignIn,
        resolveTick: opensAt + assignIn + simMinutesToTicks(90 + rng() * 510),
        slaTick: opensAt + simMinutesToTicks(SLA_SIM_MINUTES),
        missesSla: false,
      })
      continue
    }
    push(m.kind, m.group, {
      block: m.kind === "hotel_check_in" ? "C2" : drawBlock(rng()),
      cadence: m.cadence,
    })
  }

  // --- 3. sampled intake ----------------------------------------------------
  for (const rate of INTAKE_RATES) {
    if (rng() >= rate.perSimMinute * SIM_MINUTES_PER_TICK) continue
    const block = rate.target === "site" ? null : drawBlock(rng())

    if (rate.kind !== "report_opened") {
      push(rate.kind, rate.group, { block })
      continue
    }

    // A report is a record, not a row. It gets a number, a block that never
    // changes, and a schedule.
    const shared = rng() < SHARED_ASSET_SHARE
    const n = nextReportN++
    const assigned = rng() < ASSIGN_SHARE
    const assignIn = simMinutesToTicks(4 + rng() * 36)
    const resolveIn = simMinutesToTicks(90 + rng() * 510)
    const missesSla = assigned && rng() < SLA_MISS_SHARE
    // A report raised against a lift, a pool or the grounds reads as a fault
    // rather than an apartment complaint. Same record, same lifecycle.
    const openKind: SimEventKind = shared ? "lift_fault" : "report_opened"
    const openGroup: SimGroup = shared ? "exception" : "intake"
    reports.push({
      n,
      block: block ?? drawBlock(rng()),
      shared,
      // Opened this tick and announced immediately below. The consequences loop
      // has already run, so this record cannot be announced twice.
      openedTick: tick,
      openKind,
      openGroup,
      openCadence: null,
      assignTick: assigned ? tick + assignIn : null,
      resolveTick: assigned ? tick + assignIn + resolveIn : null,
      slaTick: tick + simMinutesToTicks(SLA_SIM_MINUTES),
      missesSla,
    })
    openReports += 1
    push(openKind, openGroup, { block, reportN: n, shared })
  }

  // Records that can no longer produce anything are dropped, so replaying to
  // TICK_FINAL stays bounded rather than accumulating two simulated days.
  const live = reports.filter(
    (r) => r.resolveTick === null || r.resolveTick >= tick,
  )

  return {
    tick,
    reports: live,
    nextReportN,
    events: fired.length
      ? [...fired.reverse(), ...prev.events].slice(0, FEED_MAX)
      : prev.events,
    openReports,
    milestoneLoop: loop,
  }
}

/**
 * The state at an absolute tick, replayed from zero.
 *
 * Replay rather than cache: the server renders tick 0, reduced motion renders
 * `TICK_FINAL`, and a gate replays five thousand. All three must agree, and the
 * only way to guarantee that is for there to be exactly one code path.
 */
export function simulationStateAt(tick: number, seedKey: string): SimState {
  let state = emptyState()
  for (let t = 1; t <= tick; t++) {
    state = stepSimulation(state, t, seedKey)
  }
  return state
}
