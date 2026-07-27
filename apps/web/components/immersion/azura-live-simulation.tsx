"use client"

import { AnimatePresence, motion } from "framer-motion"
import {
  Brain,
  CreditCard,
  DatabaseZap,
  Radio,
  TicketCheck,
  WifiOff,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { cn } from "@/lib/cn"
import { cubic, duration, staggerDelay } from "@/lib/motion"
import {
  createRng,
  createSimulationClock,
  formatSimulationTime,
  hashSeed,
  pick,
  simulationTime,
} from "@/lib/simulation-clock"

import { useReducedMotion } from "@/components/providers/motion-preference-provider"
import { Badge } from "@/components/ui/badge"

import {
  SimulationBanner,
  SimulationChip,
  type SimulationLabelStrings,
} from "./simulation-label"

/**
 * AzuraLiveSimulation — the centrepiece, and the most dangerous component here.
 *                                                          Owner: W3-I
 *
 * A ticker of plausible operational activity for a 656-unit, 188-room complex:
 * tickets opening and closing, payments posting, reservations confirming, an AI
 * action logged, a sync badge flipping between realtime and polling.
 *
 * THE HONESTY RULES, and how each is actually enforced rather than intended:
 *
 * 1. **Driven by the real seed dataset, never invented figures.** Every event
 *    names a real block code and a real unit id from the generated dataset. The
 *    clock chooses *which* record and *when*; it never authors a value. There
 *    is no money in this feed at all — a simulated euro amount is a fabricated
 *    number, and no amount of labelling makes one safe to show next to a
 *    project whose real prices are a live conflict (F-002).
 * 2. **Labelled "Simulation" in every locale, at all times.** A banner above
 *    the feed and a chip in the header, both from `simulation-label.tsx`, both
 *    plain text in normal flow so they survive a screenshot and a print.
 * 3. **Never styled like a live-data surface.** The whole card is tinted with
 *    `--surface-simulation` and bordered in `--simulation`, a colour used
 *    nowhere else. The sync badge is deliberately NOT the real one from W2-D.
 * 4. **A simulated ticket is not reachable from a real ticket route.** Nothing
 *    here is a link. Ids are rendered as text, never as an href.
 *
 * DETERMINISM: seeded, never `Math.random()`. Same seed and tick produce the
 * same frame on every machine and every load, so Playwright can snapshot it and
 * SSR agrees with hydration. This also matches the reference, which contains no
 * `Math.random()` in any displayed value.
 */

export type SimulationEventKind =
  | "ticket_opened"
  | "ticket_closed"
  | "payment_posted"
  | "reservation_confirmed"
  | "ai_action"
  | "sync"

export interface SimulationEventStrings {
  ticket_opened: string
  ticket_closed: string
  payment_posted: string
  reservation_confirmed: string
  ai_action: string
  sync: string
}

export interface LiveSimulationLabels {
  heading: string
  simulation: SimulationLabelStrings
  events: SimulationEventStrings
  /** Sync state labels. Never the word "offline" — state the fallback in effect. */
  sync: { realtime: string; polling: string }
  /** Screen-reader summary of the feed, so the motion can be aria-hidden. */
  feedSummary: string
  emptyPending: string
}

const ICONS: Record<SimulationEventKind, LucideIcon> = {
  ticket_opened: TicketCheck,
  ticket_closed: TicketCheck,
  payment_posted: CreditCard,
  reservation_confirmed: Radio,
  ai_action: Brain,
  sync: DatabaseZap,
}

const KINDS: readonly SimulationEventKind[] = [
  "ticket_opened",
  "payment_posted",
  "reservation_confirmed",
  "ticket_closed",
  "ai_action",
  "sync",
]

/** A real unit from the dataset: its id and the block it actually belongs to. */
export interface SimulationUnitRef {
  id: string
  blockCode: string
}

interface FeedEvent {
  id: string
  kind: SimulationEventKind
  /** The unit's OWN block. Never picked independently — see `eventForTick`. */
  blockCode: string
  /** A real unit id from the dataset. Rendered as text, never a link. */
  unitId: string
  at: Date
}

const MAX_EVENTS = 6
const TICK_MS = 3200

/**
 * Builds the event for tick `n`. A pure function of the tick, so frame N is
 * reproducible without replaying frames 0..N-1.
 */
function eventForTick(
  tick: number,
  seed: number,
  units: readonly SimulationUnitRef[]
): FeedEvent {
  const rng = createRng(seed + tick * 2654435761)
  const kind = pick(KINDS, rng())
  // The block comes from the unit, NOT from an independent draw. Picking both
  // separately produced rows like "B03 · AZW-B01-0056" — a unit shown against a
  // block its own id contradicts. The events are simulated; that is disclosed.
  // Being internally incoherent is a different thing, and it reads as a bug in
  // the data rather than as a deliberate demonstration.
  const unit = pick(units, rng())
  return {
    id: `sim-${tick}`,
    kind,
    blockCode: unit.blockCode,
    unitId: unit.id,
    at: simulationTime(tick, TICK_MS),
  }
}

export function AzuraLiveSimulation({
  units,
  labels,
  locale,
  seedKey = "azura-live",
  className,
}: {
  /** Real units from the dataset — id and the block each one belongs to. */
  units: readonly SimulationUnitRef[]
  labels: LiveSimulationLabels
  locale: string
  seedKey?: string
  className?: string
}): ReactNode {
  const reducedMotion = useReducedMotion()
  const seed = useMemo(() => hashSeed(seedKey), [seedKey])

  /**
   * The first frame is the SAME on the server and the client, and under
   * reduced motion it is also the LAST frame — a full feed, not an empty box
   * that never fills. W3-I's edge case: simulations render their complete
   * final state, not a paused first frame.
   */
  const initialEvents = useMemo(
    () =>
      Array.from({ length: MAX_EVENTS }, (_, index) =>
        eventForTick(MAX_EVENTS - index, seed, units)
      ),
    [seed, units]
  )

  const [events, setEvents] = useState<FeedEvent[]>(initialEvents)
  const [syncRealtime, setSyncRealtime] = useState(true)
  const tickRef = useRef(MAX_EVENTS)

  useEffect(() => {
    if (reducedMotion) return
    if (units.length === 0) return

    const clock = createSimulationClock({
      intervalMs: TICK_MS,
      seed,
      onTick: () => {
        tickRef.current += 1
        const next = eventForTick(tickRef.current, seed, units)
        setEvents((current) => [next, ...current].slice(0, MAX_EVENTS))
        // The sync badge flips on a fixed cadence, not randomly — a degraded
        // state that appears at random is indistinguishable from a real
        // intermittent fault when someone is looking at a screenshot.
        setSyncRealtime(tickRef.current % 7 !== 0)
      },
    })

    clock.start()
    return () => clock.stop()
  }, [reducedMotion, seed, units])

  return (
    <section
      data-slot="live-simulation"
      className={cn(
        // Never styled like a live surface. This tint is the simulation's own.
        "flex min-w-0 flex-col gap-4 rounded-xl border-2 border-simulation/40 bg-surface-simulation/40 p-4",
        className
      )}
      aria-labelledby="azura-sim-heading"
    >
      <SimulationBanner strings={labels.simulation} />

      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3
          id="azura-sim-heading"
          className="font-display text-lg font-semibold"
        >
          {labels.heading}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <SimulationChip strings={labels.simulation} />
          {/* Deliberately NOT W2-D's SyncBadge. A simulated surface must not
              borrow a live surface's freshness vocabulary. */}
          <Badge variant={syncRealtime ? "confirmed" : "muted"}>
            {syncRealtime ? (
              <Radio aria-hidden="true" />
            ) : (
              <WifiOff aria-hidden="true" />
            )}
            {syncRealtime ? labels.sync.realtime : labels.sync.polling}
          </Badge>
        </div>
      </header>

      {/* The moving feed is decorative and hidden from assistive tech — a
          ticker that announces every update is unusable. The same information
          is the text summary below it. */}
      <ul
        aria-hidden="true"
        data-testid="simulation-feed"
        className="flex min-w-0 flex-col gap-2"
      >
        {reducedMotion ? (
          events.map((event) => (
            <li key={event.id}>
              <EventRow event={event} labels={labels} locale={locale} />
            </li>
          ))
        ) : (
          <AnimatePresence initial={false} mode="popLayout">
            {events.map((event, index) => (
              <motion.li
                key={event.id}
                initial={{ opacity: 0, transform: "translateY(-8px)" }}
                animate={{
                  opacity: 1,
                  transform: "translateY(0px)",
                  transition: {
                    duration: duration.base,
                    delay: staggerDelay(index, 0.03),
                    ease: cubic.out,
                  },
                }}
                exit={{
                  opacity: 0,
                  transform: "translateY(8px)",
                  transition: { duration: duration.fast, ease: cubic.out },
                }}
              >
                <EventRow event={event} labels={labels} locale={locale} />
              </motion.li>
            ))}
          </AnimatePresence>
        )}
      </ul>

      <p className="sr-only">{labels.feedSummary}</p>
    </section>
  )
}

function EventRow({
  event,
  labels,
  locale,
}: {
  event: FeedEvent
  labels: LiveSimulationLabels
  locale: string
}): ReactNode {
  const Icon = ICONS[event.kind]
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
      <Icon className="size-4 shrink-0 text-simulation" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">{labels.events[event.kind]}</span>
        {/* Ids are text. A simulated ticket must not be reachable from a real
            ticket route, so nothing here is a link. */}
        <span className="truncate text-xs text-muted-foreground">
          {event.blockCode} · {event.unitId}
        </span>
      </div>
      <time
        dateTime={event.at.toISOString()}
        data-numeric
        className="shrink-0 text-xs tabular-nums text-muted-foreground"
      >
        {formatSimulationTime(event.at, locale)}
      </time>
    </div>
  )
}
