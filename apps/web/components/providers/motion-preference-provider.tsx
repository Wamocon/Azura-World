"use client"

/**
 * Reduced-motion and device-tier state.                    Owner: W1-D
 *
 * One `matchMedia` subscription for the whole application, shared through a
 * module-level store rather than a React context. Two reasons:
 *
 *   1. W3-I mounts many simulation components at once. A per-component
 *      listener means N subscriptions to the same query, all firing on the
 *      same change.
 *   2. A store has no "you forgot the Provider" failure mode. `useReducedMotion`
 *      works in isolation — in the kitchen sink, in a test, in a component
 *      someone lifts out later — which a context-only design does not.
 *
 * `useSyncExternalStore` is what makes this hydration-safe: the server
 * snapshot is `false`, so SSR markup always describes the animated case, and
 * React reconciles to the real value on the client without a mismatch warning.
 *
 * The 1Çatı and NLP references both sample `matchMedia(...).matches` once and
 * never subscribe, so toggling the OS setting does nothing until a remount.
 * This does subscribe.
 */

import { useSyncExternalStore, type ReactNode } from "react"

import {
  motionTier,
  REDUCED_MOTION_QUERY,
  type MotionTier,
} from "@/lib/motion"

// ---------------------------------------------------------------------------
// Shared store
// ---------------------------------------------------------------------------

type Listener = () => void

const listeners = new Set<Listener>()
let mediaQuery: MediaQueryList | null = null
let snapshot = false

function ensureSubscribed(): void {
  if (mediaQuery !== null || typeof window === "undefined") return
  if (typeof window.matchMedia !== "function") return

  mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY)
  snapshot = mediaQuery.matches
  mediaQuery.addEventListener("change", (event) => {
    snapshot = event.matches
    for (const listener of listeners) listener()
  })
}

function subscribe(listener: Listener): () => void {
  ensureSubscribed()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): boolean {
  ensureSubscribed()
  return snapshot
}

/**
 * Server snapshot. Always `false`.
 *
 * The server cannot know the preference, and guessing `true` would be the
 * worse guess: it would make the *animated* path the one that hydrates into a
 * mismatch, on every request, for every user.
 */
function getServerSnapshot(): boolean {
  return false
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Whether the user has asked for reduced motion. Re-renders when they change
 * it. `false` during SSR and on the very first client render.
 *
 * Read `lib/motion.ts` → `prefersReducedMotion` for the behavioural contract
 * this is supposed to enforce. The short version: `true` must produce a
 * page that is complete and static, never one that is merely quicker.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * The device's motion tier, recomputed when the reduced-motion preference
 * changes. Simulation surfaces scale their work to this — fewer particles,
 * longer intervals, no WebGL — instead of running one fixed load everywhere.
 */
export function useMotionTier(): MotionTier {
  const reduced = useReducedMotion()
  // `motionTier()` re-reads the preference itself; `reduced` is in the
  // dependency path only so a change re-renders and re-evaluates this.
  return reduced ? "static" : motionTier()
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Publishes the preference to CSS as `data-motion="static" | "reduced" |
 * "full"` on the element it wraps.
 *
 * Optional for the hooks above — they work without it. It exists so a
 * stylesheet can branch on the tier, which a media query alone cannot express
 * (there is no `@media (hardware-concurrency: ...)`).
 */
export function MotionPreferenceProvider({
  children,
}: {
  children: ReactNode
}): ReactNode {
  const tier = useMotionTier()
  return <div data-motion={tier}>{children}</div>
}
