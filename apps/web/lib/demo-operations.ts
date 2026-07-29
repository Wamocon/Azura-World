/**
 * # A believable operating year for Azura World.            Owner: P1
 *
 * `PIVOT.md` §6: twenty dashboard modules render empty states, and *"a property
 * management system that has never managed anything demonstrates nothing"*.
 * This module is the operating history the demo runs on: who lives where, what
 * broke, who paid, what was inspected, who talked to whom.
 *
 * ## The rule that changed, and the one that did not
 *
 * W2-A drafted fixtures for these tables and **deleted them**, correctly, under
 * the old framing: this was competitor intelligence and inventing a number was
 * fraud. `PIVOT.md` §2 reverses that for operational data — *"seeded operational
 * data is the whole point"* — and leaves the other half standing: **it must be
 * visibly demo data**.
 *
 * So every record generated here carries `metadata.demo === true` and
 * `metadata.generator === "demo-operations"`. The sync badge already says
 * "Demo-Daten" because every repository reports `source: "local-seed"`; this is
 * the second, per-record channel, so a row is identifiable as demo even when it
 * has been exported to CSV, pasted into a mail, or read straight out of the API
 * with no page chrome around it.
 *
 * **What is still not invented:** nothing here makes a claim about Azura World's
 * real business. No revenue, no occupancy rate, no vendor is presented as
 * theirs. The buildings, the 656 units and the 188 rooms are real and harvested;
 * the operations on top of them are a demonstration and say so.
 *
 * ## Determinism
 *
 * No `Math.random()`, no `Date.now()`, no bare `new Date()`. Playwright
 * snapshots and the `repository-contract` byte-stability test both depend on two
 * calls producing identical JSON.
 *
 * Randomness is a seeded PRNG, and **each generator draws from its own named
 * stream**. That is not decoration: with one shared stream, adding a ticket
 * shifts every subsequent draw and the ledger, the documents and the resident
 * roster all change. Named streams mean a change to one surface leaves the
 * others byte-identical, which is what makes a snapshot diff readable.
 *
 * Every instant is `seedIso(dayOffset)` from `SEED_ANCHOR_ISO` (2026-07-27), so
 * the demo does not age: it is always "the last twelve months" relative to the
 * anchor, whatever today is.
 *
 * ## Why the volumes stop where they do
 *
 * `MAX_PAGE_SIZE` is 500 and `getFinanceSummary()` / `getOperationsSummary()`
 * aggregate over **one page**. Neither surfaces a `truncated` flag in this
 * revision, so a table over 500 rows would make the dashboard's headline totals
 * quietly wrong — the worst failure available on a money screen. Every
 * summarised table is therefore sized under that ceiling, and the ceiling is
 * recorded in `HANDOFF/P1.md` as the reason the ledger is a quarterly book
 * rather than a monthly one.
 */

import type { Locale, Money } from "@/lib/contracts"
import { seedIso } from "@/lib/repository-base"

/**
 * Units per block, restated rather than imported from `inventory-data`.
 *
 * `inventory-data` imports THIS module for its resident population, so pulling
 * `SEED_BLOCK_UNIT_COUNTS` back the other way makes a value-level import cycle.
 * ESM would survive it — both uses are inside functions — but a cycle between
 * two seed modules is the kind of thing that works until someone moves a call
 * to module scope and then fails at import time with an empty array rather than
 * an error.
 *
 * `demo-operations.test.ts` asserts these seven pairs are identical to
 * `SEED_BLOCK_UNIT_COUNTS` and that they still total 656, so the duplication
 * cannot drift without a test failing.
 */
const BLOCK_UNIT_COUNTS: ReadonlyArray<readonly [string, number]> =
  Object.freeze([
    ["B01", 94], ["B02", 94], ["B03", 94], ["B04", 94],
    ["B05", 94], ["B06", 93], ["B07", 93],
  ] as ReadonlyArray<readonly [string, number]>)

// ---------------------------------------------------------------------------
// Identity — the constants every generated row hangs off
// ---------------------------------------------------------------------------

export const DEMO_COMPANY_ID = "11111111-1111-4111-8111-111111111111"
export const DEMO_SITE_ID = "22222222-2222-4222-8222-222222222222"

/**
 * The eleven seeded logins, by role. Restated here rather than imported from
 * `finance-data` because that module imports THIS one for its ledger, and a
 * value-level cycle between the two is a real runtime hazard. The values are
 * asserted identical by `demo-operations.test.ts`, so the duplication cannot
 * drift silently.
 */
export const DEMO_PROFILE_IDS = {
  admin: "b0000000-0000-4000-8000-000000000001",
  manager: "b0000000-0000-4000-8000-000000000002",
  accountant: "b0000000-0000-4000-8000-000000000003",
  staff: "b0000000-0000-4000-8000-000000000004",
  owner: "b0000000-0000-4000-8000-000000000005",
  tenant: "b0000000-0000-4000-8000-000000000006",
  guest: "b0000000-0000-4000-8000-000000000007",
  serviceProvider: "b0000000-0000-4000-8000-000000000008",
  childOwner: "b0000000-0000-4000-8000-000000000009",
  childTenant: "b0000000-0000-4000-8000-000000000010",
  childGuest: "b0000000-0000-4000-8000-000000000011",
} as const

/**
 * The three units the existing fixtures pin to real logins.
 *
 * **Generated data never touches these.** `repository-contract.test.ts` proves
 * "owner A cannot read owner B's unit" and "a child role sees a strict subset of
 * its guardian" against exactly these three, and W1-A's `04-rls-negative.sql`
 * mirrors them in SQL. A generator that reassigned `AZW-B01-0002` would turn a
 * real security assertion vacuous while leaving it green.
 */
export const RESERVED_UNIT_IDS: readonly string[] = Object.freeze([
  "AZW-B01-0001",
  "AZW-B01-0002",
  "AZW-B01-0003",
])

/** Stamped on every generated record that has somewhere to put it. */
export const DEMO_MARK = Object.freeze({
  demo: true,
  generator: "demo-operations",
})

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

/**
 * mulberry32 — 32 bits of state, uniform enough for demo data, and identical on
 * every platform because it is integer arithmetic with no float accumulation.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a over the stream name, so a stream's seed depends only on its name. */
function streamSeed(name: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export interface Stream {
  /** [0, 1). */
  next(): number
  /** Inclusive on both ends. */
  int(min: number, max: number): number
  pick<T>(items: readonly T[]): T
  /** `[value, weight]` pairs. Weights are relative and need not sum to 1. */
  weighted<T>(table: ReadonlyArray<readonly [T, number]>): T
  /** True with probability `p`. */
  chance(p: number): boolean
}

/**
 * A named, independent random stream.
 *
 * Call it once per generator, at the top. Two generators sharing a stream are
 * coupled: adding a row to one silently rewrites the other, and a snapshot diff
 * that should have been three lines becomes three hundred.
 */
export function stream(name: string): Stream {
  const next = mulberry32(streamSeed(name))
  const int = (min: number, max: number) =>
    min + Math.floor(next() * (max - min + 1))
  return {
    next,
    int,
    pick: <T>(items: readonly T[]): T => {
      // `noUncheckedIndexedAccess` is on. An empty array is a programming error
      // here, not a data condition, so it throws rather than returning a
      // silently-wrong element.
      const item = items[int(0, items.length - 1)]
      if (item === undefined) throw new Error("pick() from an empty array")
      return item
    },
    weighted: <T>(table: ReadonlyArray<readonly [T, number]>): T => {
      const total = table.reduce((sum, [, weight]) => sum + weight, 0)
      let roll = next() * total
      for (const [value, weight] of table) {
        roll -= weight
        if (roll <= 0) return value
      }
      const last = table[table.length - 1]
      if (last === undefined) throw new Error("weighted() over an empty table")
      return last[0]
    },
    chance: (p: number) => next() < p,
  }
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** The operating year: 365 days back from the anchor, to the anchor. */
export const YEAR_START_OFFSET = -365

/** `SEED_ANCHOR_ISO` shifted by whole days. Re-exported so callers need one import. */
export function at(dayOffset: number, hour = 9): string {
  return seedIso(dayOffset, hour)
}

/** `YYYY-MM-DD` at a day offset. */
export function onDate(dayOffset: number): string {
  return seedIso(dayOffset).slice(0, 10)
}

/** `YYYY-MM` at a day offset, for a ledger period. */
export function inPeriod(dayOffset: number): string {
  return seedIso(dayOffset).slice(0, 7)
}

/**
 * The day offset of the first of each of the last twelve months, oldest first.
 *
 * Derived by walking calendar months back from the anchor rather than by
 * subtracting 30 days twelve times, so "March" is March and the quarterly
 * billing lands on real quarter boundaries.
 */
export function monthStarts(): readonly number[] {
  const anchor = new Date(seedIso(0))
  const offsets: number[] = []
  for (let back = 11; back >= 0; back -= 1) {
    const month = new Date(
      Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - back, 1)
    )
    const days = Math.round(
      (month.getTime() - new Date(seedIso(0)).getTime()) / 86_400_000
    )
    offsets.push(days)
  }
  return offsets
}

// ---------------------------------------------------------------------------
// Deterministic identifiers
// ---------------------------------------------------------------------------

/**
 * A uuid-shaped, obviously synthetic id built from a prefix and an index.
 *
 * Shaped like a uuid because the columns are `uuid` and PostgREST would refuse
 * anything else, but the body spells out what it is, so an id seen in a log or
 * a CSV reads as demo data rather than as a real record: the `dem0` group is
 * there to be noticed.
 */
export function demoId(prefix: string, index: number): string {
  const head = prefix.padEnd(8, "0").slice(0, 8)
  const tail = String(index).padStart(12, "0")
  return `${head}-dem0-4000-8000-${tail}`
}

// ---------------------------------------------------------------------------
// The building
// ---------------------------------------------------------------------------

export interface DemoUnitRef {
  unitId: string
  blockCode: string
  sequence: number
  /** 0 is ground. Six floors per building (`SEED_FLOORS_PER_BUILDING`). */
  floorLevel: number
}

/**
 * Every unit id, derived from the same block/sequence scheme
 * `inventory-data.planUnits()` uses. Cheap, and it keeps this module off the
 * 656-row unit builder for what is really just an id list.
 */
export function allUnits(): readonly DemoUnitRef[] {
  const units: DemoUnitRef[] = []
  for (const [blockCode, unitCount] of BLOCK_UNIT_COUNTS) {
    for (let sequence = 1; sequence <= unitCount; sequence += 1) {
      units.push({
        unitId: `AZW-${blockCode}-${String(sequence).padStart(4, "0")}`,
        blockCode,
        sequence,
        floorLevel: (sequence - 1) % 6,
      })
    }
  }
  return units
}

/** Units a generator may touch: everything except the three RLS fixtures. */
export function assignableUnits(): readonly DemoUnitRef[] {
  return allUnits().filter((unit) => !RESERVED_UNIT_IDS.includes(unit.unitId))
}

// ---------------------------------------------------------------------------
// The population
// ---------------------------------------------------------------------------

export type Tenure = "owner_occupied" | "tenanted" | "vacant"

export interface DemoOccupancy {
  unit: DemoUnitRef
  tenure: Tenure
  residentId: string
  residentName: string
  email: string
  locale: Locale
  /** Owner-occupiers and tenants differ in what they are billed and can see. */
  relation: "owner" | "tenant"
  /** Day offset the residency began. */
  startedOffset: number
}

/**
 * Family names drawn from the four markets this complex actually sells into:
 * Türkiye, Germany, Russia and the UK. A resort in Alanya with 656 German names
 * would look wrong to the person being pitched, and that person is Turkish.
 *
 * These are common surnames, not real customers, and they are attached to
 * records marked `demo: true`.
 */
const FAMILY_NAMES: ReadonlyArray<readonly [string, Locale]> = [
  ["Yılmaz", "tr"], ["Kaya", "tr"], ["Demir", "tr"], ["Şahin", "tr"],
  ["Çelik", "tr"], ["Aydın", "tr"], ["Öztürk", "tr"], ["Arslan", "tr"],
  ["Doğan", "tr"], ["Kılıç", "tr"], ["Aslan", "tr"], ["Korkmaz", "tr"],
  ["Müller", "de"], ["Schmidt", "de"], ["Weber", "de"], ["Fischer", "de"],
  ["Wagner", "de"], ["Becker", "de"], ["Hoffmann", "de"], ["Schäfer", "de"],
  ["Klein", "de"], ["Richter", "de"],
  ["Иванов", "ru"], ["Смирнов", "ru"], ["Кузнецов", "ru"], ["Попов", "ru"],
  ["Соколов", "ru"], ["Новиков", "ru"], ["Морозов", "ru"], ["Волков", "ru"],
  ["Smith", "en"], ["Jones", "en"], ["Taylor", "en"], ["Brown", "en"],
  ["Wilson", "en"], ["Evans", "en"],
]

const GIVEN_NAMES: Readonly<Record<Locale, readonly string[]>> = {
  tr: ["Ahmet", "Mehmet", "Ayşe", "Fatma", "Mustafa", "Zeynep", "Emre", "Elif"],
  de: ["Thomas", "Andrea", "Michael", "Sabine", "Stefan", "Claudia", "Jonas"],
  ru: ["Александр", "Елена", "Дмитрий", "Ольга", "Сергей", "Наталья"],
  en: ["James", "Sarah", "David", "Emma", "Robert", "Laura"],
}

/**
 * Occupancy for the whole complex.
 *
 * **62% occupied, and that is a choice worth stating.** A holiday-resort
 * complex on the Alanya coast is not a city block: a large share of units are
 * second homes that sit empty most of the year, and a demo showing 100%
 * occupancy would be the first thing a property manager disbelieved. Of the
 * occupied units, roughly two thirds are owner-occupied and one third let,
 * which is what produces a mixed debtor list downstream.
 *
 * Blocks are not uniform. B01 and B02 face the sea and fill first; B06 and B07
 * completed later and are still filling. That gradient is what makes the
 * per-block panels look like a real building rather than a loop.
 */
export function occupancy(): readonly DemoOccupancy[] {
  const rng = stream("occupancy")
  const out: DemoOccupancy[] = []

  const occupancyByBlock: Readonly<Record<string, number>> = {
    B01: 0.78, B02: 0.74, B03: 0.66, B04: 0.62,
    B05: 0.58, B06: 0.48, B07: 0.44,
  }

  let index = 0
  for (const unit of assignableUnits()) {
    const rate = occupancyByBlock[unit.blockCode] ?? 0.6
    if (!rng.chance(rate)) continue

    index += 1
    const [family, locale] = rng.pick(FAMILY_NAMES)
    const given = rng.pick(GIVEN_NAMES[locale])
    const relation: "owner" | "tenant" = rng.chance(0.68) ? "owner" : "tenant"

    out.push({
      unit,
      tenure: relation === "owner" ? "owner_occupied" : "tenanted",
      residentId: demoId("res", index),
      residentName: `${given} ${family}`,
      // `.invalid` is reserved by RFC 2606 and can never resolve, so a demo
      // address cannot become a real one by accident.
      email: `${unit.unitId.toLowerCase()}@resident.azura.invalid`,
      locale,
      relation,
      // Owners bought earlier than tenants moved in; both inside two years.
      startedOffset:
        relation === "owner" ? rng.int(-730, -120) : rng.int(-400, -30),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Money helpers
// ---------------------------------------------------------------------------

/**
 * Service charge for a unit, in EUR, derived from its floor and block.
 *
 * A flat fee for every unit would make the debtor list a column of one number.
 * This is the sort of schedule a Hausverwaltung actually runs: a base rate plus
 * a floor premium, rounded to whole euros.
 */
export function quarterlyServiceCharge(unit: DemoUnitRef): Money {
  const base = 300
  const blockPremium = unit.blockCode === "B01" || unit.blockCode === "B02" ? 60 : 0
  const floorPremium = unit.floorLevel * 12
  return { amount: base + blockPremium + floorPremium, currency: "EUR" }
}

/** Two decimal places, as `numeric(14,2)` stores. Never a float sum. */
export function money(amount: number, currency: Money["currency"]): Money {
  return { amount: Math.round(amount * 100) / 100, currency }
}
