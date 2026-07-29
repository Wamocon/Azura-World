"use client"

/**
 * The tick that makes the drawing move, and the feed it writes.
 *                                                            Owner: W-SITEMODEL
 *
 * ## Two lanes, and only one of them is React
 *
 * The feed is discrete: rows arrive, and each arrival is a render. That is
 * roughly 0.4 dispatches a second, which React handles without complaint.
 *
 * The pulse is continuous, and putting it through React would mean a render per
 * frame per block. So the ticker holds refs to the block elements the server
 * already painted and writes `--sim-pulse` straight onto them with
 * `style.setProperty`. The glow is a CSS transition on that value, so it runs
 * on the compositor and React never learns it happened. Nothing animates width,
 * height, top, box-shadow or filter.
 *
 * ## There is no second animation frame loop
 *
 * `gsap.ticker` already drives Lenis. A `requestAnimationFrame` here would be a
 * second loop competing for the same frame, which is how scroll jitter starts.
 * The callback registers on the existing ticker, accumulates, and early-returns
 * until a real 250 ms has passed.
 *
 * ## Why it starts from the server's frame rather than from zero
 *
 * The server renders `TICK_FINAL`, a full two simulated days, and hands the
 * result over as `initialEvents`. Hydration therefore matches exactly, and the
 * three states that never animate are all the same complete picture: no
 * JavaScript, reduced motion, and Save-Data each keep the server's feed instead
 * of an empty box or a list paused at frame one.
 *
 * ## The clock is arithmetic, not Intl
 *
 * `toLocaleTimeString` resolves against the runtime's timezone, which is not
 * the same on a server and in a browser, so it would tear on hydration. The
 * time of day is computed from the tick with integer maths and is identical
 * everywhere. It is a time and never a date, so nobody checks it against today.
 */

import { useEffect, useReducer, useRef } from "react"
import {
  AlertTriangle,
  ArrowRightLeft,
  Banknote,
  FlaskConical,
  MessageSquare,
  Wrench,
} from "lucide-react"

import { gsap, registerGsap } from "@/components/anim/gsap"
import { cn } from "@/lib/cn"
import {
  emptyState,
  simulationStateAt,
  stepSimulation,
  SIM_MINUTES_PER_TICK,
  TICKS_PER_SIM_DAY,
  TICK_MS,
  type SimEvent,
  type SimEventKind,
  type SimGroup,
  type SimState,
} from "@/lib/site-simulation"

export interface SiteModelLabels {
  readonly rowPrefix: string
  readonly openReports: string
  readonly wholeSite: string
  readonly blockRef: string
  readonly reportRef: string
  readonly accounts: string
  readonly groups: Readonly<Record<SimGroup, string>>
  readonly events: Readonly<Record<SimEventKind, string>>
  readonly cadence: Readonly<Record<"daily" | "monthly" | "sixWeekly", string>>
}

/** Colour is never the only carrier: every group has its own glyph too. */
const GROUP_ICON = {
  intake: MessageSquare,
  work: Wrench,
  money: Banknote,
  exception: AlertTriangle,
  milestone: ArrowRightLeft,
} as const

const GROUP_TONE: Record<SimGroup, string> = {
  intake: "text-[var(--chart-2)]",
  work: "text-[var(--chart-3)]",
  money: "text-[var(--chart-1)]",
  exception: "text-[var(--destructive)]",
  milestone: "text-[var(--primary)]",
}

/** The operating day runs from 08:00, so a 720-minute span starts there. */
function clockAt(tick: number): string {
  const minutes = (tick % TICKS_PER_SIM_DAY) * SIM_MINUTES_PER_TICK
  const h = (8 + Math.floor(minutes / 60)) % 24
  const m = Math.floor(minutes % 60)
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

function reducer(_state: SimState, next: SimState): SimState {
  return next
}

function Row({
  event,
  labels,
}: {
  event: SimEvent
  labels: SiteModelLabels
}): React.ReactNode {
  const Icon = GROUP_ICON[event.group]
  const cadence =
    event.cadence === null
      ? null
      : labels.cadence[event.cadence === "six-weekly" ? "sixWeekly" : event.cadence]

  return (
    <li className="flex flex-col gap-1 border-b border-[color-mix(in_srgb,var(--foreground)_9%,transparent)] py-2.5 last:border-b-0">
      <div className="flex items-baseline gap-2 text-[0.8125rem] leading-[1.5]">
        {/* The disclosure comes first and is always this glyph plus this word,
            so a single row cropped out of a screenshot still reads as sample
            data in greyscale. The category icon sits at the end. */}
        <FlaskConical
          aria-hidden
          className="size-3 shrink-0 translate-y-[0.15em] text-[var(--simulation)]"
        />
        <span className="shrink-0 font-mono text-[0.6875rem] tracking-[0.08em] text-[var(--simulation)] uppercase">
          {labels.rowPrefix}
        </span>
        <span className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground tabular-nums">
          {clockAt(event.tick)}
        </span>
        <span className="min-w-0 flex-1 text-foreground">
          {labels.events[event.kind]}
        </span>
        <Icon
          aria-hidden
          className={cn("size-3.5 shrink-0 translate-y-[0.15em]", GROUP_TONE[event.group])}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-5 text-[0.6875rem] text-muted-foreground">
        <span>
          {event.block === null
            ? labels.wholeSite
            : labels.blockRef.replace("{key}", event.block)}
        </span>
        {event.reportN !== null ? (
          <span>{labels.reportRef.replace("{n}", String(event.reportN))}</span>
        ) : null}
        {event.accounts !== null ? (
          <span>{labels.accounts.replace("{count}", String(event.accounts))}</span>
        ) : null}
        <span className={GROUP_TONE[event.group]}>{labels.groups[event.group]}</span>
        {/* A scheduled row prints how often it really happens, which is what
            stops its frequency on screen from becoming a claim. */}
        {cadence !== null ? <span className="italic">{cadence}</span> : null}
      </div>
    </li>
  )
}

export function SiteModelLive({
  seedKey,
  startTick,
  labels,
}: {
  seedKey: string
  /** The tick the server rendered. Hydration starts from exactly this state. */
  startTick: number
  labels: SiteModelLabels
}): React.ReactNode {
  const [state, commit] = useReducer(reducer, null, () =>
    simulationStateAt(startTick, seedKey),
  )
  const stateRef = useRef<SimState>(state)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const conn = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection
    if (conn?.saveData === true) return

    // First statement after the early returns, per the module contract.
    registerGsap()

    const scope =
      rootRef.current?.closest("[data-site-section]") ?? document.body
    const blocks = new Map<string, HTMLElement>()
    for (const el of scope.querySelectorAll<HTMLElement>("[data-site-block]")) {
      const key = el.dataset["siteBlock"]
      if (key !== undefined) blocks.set(key, el)
    }

    const pulse = new Map<string, number>()
    let acc = 0
    let last = 0
    let tick = startTick

    const decay = (deltaMs: number): void => {
      for (const [key, value] of pulse) {
        const next = Math.max(0, value - deltaMs / 900)
        if (next <= 0) {
          pulse.delete(key)
          blocks.get(key)?.style.setProperty("--sim-pulse", "0")
        } else {
          pulse.set(key, next)
          blocks.get(key)?.style.setProperty("--sim-pulse", next.toFixed(3))
        }
      }
    }

    const step = (time: number): void => {
      if (last === 0) {
        last = time
        return
      }
      // gsap.ticker reports seconds.
      const deltaMs = (time - last) * 1000
      last = time
      // A hidden tab pauses rather than fast-forwarding the minutes nobody saw.
      if (document.hidden) return

      acc += deltaMs
      if (acc < TICK_MS) {
        decay(deltaMs)
        return
      }
      acc = 0
      tick += 1

      const next = stepSimulation(stateRef.current, tick, seedKey)
      stateRef.current = next
      let arrived = false
      for (const e of next.events) {
        if (e.tick !== tick) continue
        arrived = true
        if (e.block !== null) pulse.set(e.block, 1)
      }
      // A tick that produced nothing must not cost a render.
      if (arrived) commit(next)
      decay(deltaMs)
    }

    gsap.ticker.add(step)
    return () => {
      gsap.ticker.remove(step)
      for (const el of blocks.values()) el.style.removeProperty("--sim-pulse")
    }
  }, [seedKey, startTick])

  return (
    <div ref={rootRef} className="flex flex-col gap-3">
      <ul className="flex list-none flex-col p-0" aria-hidden="true">
        {state.events.map((e) => (
          <Row key={e.id} event={e} labels={labels} />
        ))}
      </ul>

      {/* The animated list is decorative for assistive tech: announcing every
          beat would be unusable. A quiet mirror carries the same rows without
          a live region, so they are reachable on demand rather than shouted. */}
      <ul className="sr-only">
        {state.events.map((e) => (
          <li key={`a11y-${e.id}`}>
            {`${labels.rowPrefix}. ${clockAt(e.tick)}. ${
              e.block === null
                ? labels.wholeSite
                : labels.blockRef.replace("{key}", e.block)
            }. ${labels.events[e.kind]}.`}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Re-exported so the server can render the same frame the client starts from. */
export { emptyState }
