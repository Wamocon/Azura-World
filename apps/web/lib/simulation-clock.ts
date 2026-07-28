/**
 * Deterministic simulation clock.                          Owner: W3-I
 *
 * One clock drives every simulated surface. It is **seeded, never
 * `Math.random()`** — W3-I's brief is explicit about why, and there are three
 * independent reasons:
 *
 *   1. Playwright snapshots must be stable. A simulation that differs per load
 *      cannot be tested, only eyeballed.
 *   2. SSR and hydration must agree. `Math.random()` on the server produces a
 *      different first frame than the client, which React reports as a
 *      hydration mismatch and then silently patches — so the page visibly
 *      changes under the reader a beat after it loads.
 *   3. A bug in a simulated feed is only reproducible if the feed is.
 *
 * The 1Çatı reference reaches the same conclusion by a different route: it has
 * no PRNG at all and derives every variation arithmetically from the real
 * record set (`Math.random()` appears only in id fallbacks). That is the house
 * pattern and this file preserves it — the PRNG below exists to *order* and
 * *space* real records, never to invent a displayed value.
 *
 * NOTHING IN HERE PRODUCES A NUMBER A USER READS AS A FACT. Every figure in a
 * simulation comes from the generated dataset and renders through
 * `ProvenanceValue`. This module decides *when* things appear, not *what they
 * say*.
 */

// ---------------------------------------------------------------------------
// PRNG
// ---------------------------------------------------------------------------

/**
 * mulberry32 — 32-bit, seedable, no dependencies, uniform enough for choosing
 * which of eleven event templates fires next.
 *
 * Deliberately not `crypto.getRandomValues`: unpredictability is the opposite
 * of what is wanted here.
 */
export function createRng(seed: number): () => number {
  let state = seed >>> 0
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Stable 32-bit hash of a string, for deriving a seed from a component id. */
export function hashSeed(input: string): number {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** Deterministic pick from a non-empty array. */
export function pick<T>(items: readonly T[], random: number): T {
  // `noUncheckedIndexedAccess` is on, so the fallback is required rather than
  // decorative — and an empty array here is a programming error, not a state.
  const index = Math.floor(random * items.length)
  const value = items[Math.min(index, items.length - 1)]
  if (value === undefined) {
    throw new Error("simulation-clock: pick() called with an empty array")
  }
  return value
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

/** Fixed simulation epoch. Never `Date.now()` — see the header. */
export const SIMULATION_EPOCH = Date.parse("2026-07-27T09:00:00.000Z")

export interface SimulationClockOptions {
  /** Milliseconds between ticks. */
  intervalMs?: number
  /** Seed. Same seed + same tick ⟹ identical frame, on every machine. */
  seed?: number
  /** Called on every tick with the monotonically increasing tick index. */
  onTick: (tick: number) => void
}

export interface SimulationClock {
  start: () => void
  stop: () => void
  /** Advance one tick synchronously. For tests and for the reduced-motion path. */
  step: () => void
  readonly tick: number
}

/**
 * A tab-aware interval.
 *
 * Two behaviours the 1Çatı reference does not have, both required by W3-I's
 * edge cases:
 *
 * - **Pauses when the tab is hidden.** The reference's 4200ms and 3200ms
 *   intervals keep firing in a background tab forever; a ticker left open in a
 *   background tab for an hour is a battery bug.
 * - **Does not fast-forward on resume.** When the tab comes back the clock
 *   continues from the tick it paused on rather than replaying the elapsed
 *   time, so a reader who switches away for ten minutes does not return to a
 *   feed scrolling past at speed.
 */
export function createSimulationClock({
  intervalMs = 3200,
  seed = 0x415a5552, // "AZUR"
  onTick,
}: SimulationClockOptions): SimulationClock {
  let handle: number | null = null
  let tick = 0
  let running = false
  const random = createRng(seed)

  const fire = () => {
    tick += 1
    // The RNG is advanced once per tick whether or not anyone reads it, so the
    // sequence depends only on the tick index — not on how many consumers are
    // mounted. Otherwise adding a second component would change the first
    // component's output.
    random()
    onTick(tick)
  }

  const clear = () => {
    if (handle !== null) {
      window.clearInterval(handle)
      handle = null
    }
  }

  const resume = () => {
    if (!running || handle !== null) return
    handle = window.setInterval(fire, intervalMs)
  }

  const onVisibilityChange = () => {
    if (document.hidden) {
      clear()
    } else {
      resume()
    }
  }

  return {
    start() {
      if (typeof window === "undefined") return
      running = true
      document.addEventListener("visibilitychange", onVisibilityChange)
      if (!document.hidden) resume()
    },
    stop() {
      running = false
      clear()
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange)
      }
    },
    step() {
      fire()
    },
    get tick() {
      return tick
    },
  }
}

/**
 * The timestamp for tick `n`, as a fixed offset from the epoch.
 *
 * Simulated events carry simulated times. Stamping them with the real wall
 * clock would make a synthetic feed look like it is describing this minute,
 * which is precisely the confusion W3-I's honesty rules exist to prevent.
 */
export function simulationTime(tick: number, intervalMs = 3200): Date {
  return new Date(SIMULATION_EPOCH + tick * intervalMs)
}

/**
 * Formats a simulated timestamp. Time only — a simulated date would invite the
 * reader to check it against today's.
 */
export function formatSimulationTime(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
  }).format(date)
}
