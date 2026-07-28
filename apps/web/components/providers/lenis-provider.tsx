"use client"

/**
 * Lenis smooth scroll, driven by GSAP's ticker.            Owner: W1-D
 *
 * One rAF loop for both libraries: `autoRaf: false` on the Lenis side, then
 * `gsap.ticker.add(...)` calls `lenis.raf()`. Two independent rAF loops
 * animating the same page is the classic source of the jitter that makes
 * scroll-linked animation look cheap — GSAP resolves a ScrollTrigger against a
 * scroll position Lenis is about to change again in the same frame.
 * `lenis.on("scroll", ScrollTrigger.update)` closes the other half of the loop.
 *
 * DIVERGENCE FROM THE NLP REFERENCE, deliberate: that provider runs Lenis
 * unconditionally, including for users who asked for reduced motion. Smooth
 * scroll is scroll *hijacking* — it decouples the page from the input device
 * and adds momentum the user did not ask for — and it is one of the most
 * common triggers for vestibular discomfort. It is also invisible to the
 * blanket `@media (prefers-reduced-motion: reduce)` CSS rule, because it is
 * JS intercepting wheel events, not a CSS animation. So here it does not mount
 * at all under reduced motion, and the browser's native scrolling is used.
 * That is the correct degradation: native scroll is complete and correct, it
 * is simply not smoothed.
 */

import { ReactLenis, type LenisRef } from "lenis/react"
import { useEffect, useRef, type ReactNode } from "react"

import { gsap, ScrollTrigger, registerGsap } from "@/components/anim/gsap"

import { useReducedMotion } from "./motion-preference-provider"

export function LenisProvider({
  children,
}: {
  children: ReactNode
}): ReactNode {
  const reducedMotion = useReducedMotion()

  if (reducedMotion) {
    return <>{children}</>
  }

  return <SmoothScroll>{children}</SmoothScroll>
}

/**
 * Split out so the effect below only ever exists while Lenis is actually
 * mounted. Putting the effect in `LenisProvider` and early-returning around it
 * would be a conditional hook.
 */
function SmoothScroll({ children }: { children: ReactNode }): ReactNode {
  const lenisRef = useRef<LenisRef>(null)

  useEffect(() => {
    registerGsap()

    // GSAP ticker time is seconds; Lenis wants milliseconds.
    const update = (time: number) => {
      lenisRef.current?.lenis?.raf(time * 1000)
    }

    gsap.ticker.add(update)
    // Lenis interpolates its own position; letting GSAP also compensate for a
    // dropped frame makes the two disagree about where the page is.
    gsap.ticker.lagSmoothing(0)

    const lenis = lenisRef.current?.lenis
    const onScroll = () => ScrollTrigger.update()
    lenis?.on("scroll", onScroll)

    // ScrollTriggers created before Lenis took over measured against the
    // pre-smooth scroll height and will be off by whatever the layout shifted.
    ScrollTrigger.refresh()

    return () => {
      gsap.ticker.remove(update)
      // GSAP's documented defaults. `lagSmoothing()` is a setter only — there
      // is no getter to read the previous value back — so restoring means
      // re-stating them. Leaving it at 0 would be a global mutation that
      // outlives this component, which is the bug the NLP reference ships.
      gsap.ticker.lagSmoothing(500, 33)
      lenis?.off("scroll", onScroll)
    }
  }, [])

  return (
    <ReactLenis
      root
      ref={lenisRef}
      options={{
        autoRaf: false,
        // Slightly gentler than the NLP reference's 0.14. Azura's landing page
        // is long and image-heavy; a lower lerp keeps momentum readable
        // without the page feeling like it is sliding away from the wheel.
        lerp: 0.12,
        smoothWheel: true,
        syncTouch: false,
        wheelMultiplier: 0.95,
        touchMultiplier: 1.2,
      }}
    >
      {children}
    </ReactLenis>
  )
}
