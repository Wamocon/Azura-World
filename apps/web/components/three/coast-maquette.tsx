"use client"

import dynamic from "next/dynamic"
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"

import { cn } from "@/lib/cn"
import { isWebGLAvailable, motionTier } from "@/lib/motion"

import { useReducedMotion } from "@/components/providers/motion-preference-provider"

import { CoastPoster } from "./coast-poster"

/**
 * CoastMaquette — the guarded entry point.                 Owner: W1-D
 *
 * The scene is behind FOUR gates, and every one of them falls back to the
 * poster rather than to a blank box or a spinner that never resolves:
 *
 *   1. reduced motion            → poster. Static and complete.
 *   2. motion tier below "full"  → poster. Fewer than 4 logical cores, or
 *                                  Save-Data on.
 *   3. WebGL unavailable         → poster. Probed with a real getContext, not
 *                                  assumed from a user-agent string.
 *   4. not yet on screen         → poster. The three/drei chunk is not even
 *                                  requested until the section is close.
 *
 * Gate 4 is what keeps the LCP budget: the hero paints, and only then does
 * the WebGL chunk load. `dynamic(..., { ssr: false })` keeps three out of the
 * server bundle entirely.
 *
 * The poster stays mounted UNDER the canvas rather than being swapped out.
 * There is no frame in which the box is empty — no flash between "poster gone"
 * and "first GL frame drawn", and if the context is lost later the poster is
 * still there behind it.
 */

const CoastMaquetteScene = dynamic(() => import("./coast-maquette-scene"), {
  ssr: false,
  // The poster is already painted underneath; a second loading indicator on
  // top of it would be a spinner over a finished picture.
  loading: () => null,
})

/** No external source to subscribe to — capability does not change at runtime. */
function subscribeNever(): () => void {
  return () => {}
}

let capabilityCache: boolean | null = null

function getCapabilitySnapshot(): boolean {
  if (capabilityCache === null) {
    capabilityCache = motionTier() === "full" && isWebGLAvailable()
  }
  return capabilityCache
}

/** The server cannot probe a GPU. Always the poster. */
function getServerCapability(): boolean {
  return false
}

export function CoastMaquette({
  posterLabel,
  className,
  /** Start loading this far before the section enters the viewport. */
  rootMargin = "300px",
}: {
  posterLabel: string
  className?: string
  rootMargin?: string
}): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  /**
   * Capability, resolved on the client only.
   *
   * `useSyncExternalStore` rather than `useState` + `useEffect`: the server
   * snapshot is `false`, the client snapshot probes once and memoises, and
   * there is no cascading render. Deciding during render would make the server
   * and client disagree about what to render; setting state in an effect
   * would do it in two paints instead of one.
   */
  const capable = useSyncExternalStore(
    subscribeNever,
    getCapabilitySnapshot,
    getServerCapability
  )

  const [inView, setInView] = useState(
    // No IntersectionObserver (a very old browser, some test runners): show the
    // scene rather than never showing it. Computed as the initial value, not
    // assigned from an effect. The other three gates still apply.
    () => typeof IntersectionObserver === "undefined"
  )

  useEffect(() => {
    const element = containerRef.current
    if (element === null) return
    if (typeof IntersectionObserver === "undefined") return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true)
          // Once loaded, stay loaded. Tearing the context down and rebuilding
          // it on every scroll past costs far more than keeping it.
          observer.disconnect()
        }
      },
      { rootMargin }
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [rootMargin])

  const showScene = capable && !reducedMotion && inView

  return (
    <div
      ref={containerRef}
      data-slot="coast-maquette"
      data-webgl={showScene}
      className={cn(
        "relative isolate aspect-[400/260] w-full overflow-hidden rounded-xl",
        className
      )}
    >
      {/* Always present. Never removed. */}
      <div
        aria-hidden={showScene}
        className={cn(
          "absolute inset-0 transition-opacity duration-500 ease-[var(--ease-out)]",
          showScene ? "opacity-0" : "opacity-100",
          "motion-reduce:transition-none"
        )}
      >
        <CoastPoster label={posterLabel} />
      </div>

      {showScene ? (
        <div className="absolute inset-0" aria-hidden="true">
          <CoastMaquetteScene reduced={reducedMotion} />
        </div>
      ) : null}
    </div>
  )
}
