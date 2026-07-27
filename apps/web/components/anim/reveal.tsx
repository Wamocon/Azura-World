"use client"

import { useEffect, useRef, type ReactNode } from "react"

import {
  REVEAL_FAILSAFE_MS,
  duration,
  ease,
  revealViewport,
  stagger as staggerTokens,
} from "@/lib/motion"

import { gsap, registerGsap } from "./gsap"

/**
 * Reveal — scroll-triggered entrance.                      Owner: W1-D
 *
 * THE ORDER OF OPERATIONS IS THE WHOLE POINT. Under reduced motion this
 * returns BEFORE it hides anything:
 *
 *     if (prefersReducedMotion) return          ← nothing was hidden
 *     gsap.set(targets, { y, opacity: 0 })      ← only reached when animating
 *
 * The tempting alternative — hide, then shorten the animation, or hide, then
 * clamp it in CSS — leaves the element at `opacity: 0` for exactly the user
 * who asked for less motion. DESIGN-RESEARCH §4.1 rules that out: reduced
 * motion must produce a COMPLETE, static page, not a faster one. The 1Çatı
 * reference hit this bug with Framer Motion and patched it per component
 * afterwards, which is why `globals.css` also carries a `[data-reveal]` safety
 * net. The net is a backstop; this ordering is the mechanism.
 *
 * Content is never hidden in the SSR markup either, only after JS runs — so
 * crawlers, no-JS visitors and a failed hydration all see everything.
 *
 * IntersectionObserver rather than ScrollTrigger, deliberately. Under Lenis,
 * ScrollTrigger resolves against a scroll position Lenis is still
 * interpolating, and a reveal near the top of the page can fire a frame late
 * or not at all. IO is driven by the compositor and does not care.
 */

/**
 * The element to render.
 *
 * A closed union of intrinsic tags rather than `ElementType`. The NLP
 * reference reaches for `createElement` with a `Record<string, unknown>` cast
 * to dodge TypeScript's "props resolve to never" on a generic polymorphic
 * `as` + `ref`; that cast also hides the ref from React's lint rules, which
 * then read `ref` in the props object as a ref access during render.
 *
 * Naming the tags costs flexibility nothing has needed and buys real typing.
 */
export type RevealTag =
  | "div"
  | "section"
  | "article"
  | "aside"
  | "header"
  | "footer"
  | "ul"
  | "ol"
  | "li"

interface RevealProps {
  children: ReactNode
  as?: RevealTag
  className?: string
  /** Travel in px. Small on purpose: 34px reads as arrival, 100px as a slide. */
  y?: number
  delay?: number
  duration?: number
  /** Stagger the element's direct children instead of the element itself. */
  stagger?: number
}

export function Reveal({
  children,
  as: Tag = "div",
  className,
  y = 24,
  delay = 0,
  duration: durationProp = duration.slow,
  stagger,
}: RevealProps): ReactNode {
  // `HTMLElement`, assigned through a callback ref. A plain
  // `useRef<HTMLDivElement>` will not satisfy the `ref` prop of a UNION of
  // intrinsic tags — TS requires a ref valid for every member — and a callback
  // taking the shared base type is assignable to all of them.
  const ref = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (el === null) return

    // Read the preference at effect time rather than through the subscribing
    // hook: a mid-session change must not re-run the entrance, which would
    // replay motion at the user right after they asked for less of it.
    const reduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches

    // ↓ Everything below this line is the animated path only. Nothing above it
    //   has touched opacity, and nothing below runs when `reduced`.
    if (reduced) return

    registerGsap()

    const targets: Element[] =
      stagger !== undefined ? Array.from(el.children) : [el]
    if (targets.length === 0) return

    const ctx = gsap.context(() => {
      gsap.set(targets, { y, opacity: 0 })
    }, el)

    let revealed = false
    const reveal = () => {
      if (revealed) return
      revealed = true
      gsap.to(targets, {
        y: 0,
        opacity: 1,
        duration: durationProp,
        delay,
        ease: ease.out,
        stagger: stagger ?? 0,
        overwrite: "auto",
        // Drop the inline transform once settled so the element does not sit
        // in its own stacking context forever, which breaks `position: sticky`
        // in any descendant.
        clearProps: "transform,opacity",
      })
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        reveal()
        observer.disconnect()
      }
    }, revealViewport)
    observer.observe(el)

    // Fail-safe. If the element is at or above the fold but the observer never
    // fired — a zero-height parent at observe time, a display:none ancestor, a
    // bfcache restore — reveal it anyway. Content stuck invisible is a far
    // worse failure than content that appears without its animation.
    const safety = window.setTimeout(() => {
      if (!revealed && el.getBoundingClientRect().top < window.innerHeight) {
        reveal()
      }
    }, REVEAL_FAILSAFE_MS)

    // Print reveals everything, scrolled-to or not.
    //
    // A printed page has no viewport and no scrolling, so an element that is
    // still waiting for its IntersectionObserver prints as a blank space. The
    // report poster has to come off A4 complete (W1-D brief, "Edge cases"),
    // and this is the same class of bug as the reduced-motion one: content
    // that exists but cannot be seen.
    //
    // `gsap.set` rather than `reveal()` — a print dialog is not the moment for
    // a 500ms fade, and `matchMedia("print")` fires synchronously during the
    // browser's print layout.
    const showForPrint = () => {
      revealed = true
      gsap.set(targets, { y: 0, opacity: 1, clearProps: "transform,opacity" })
    }
    window.addEventListener("beforeprint", showForPrint)

    return () => {
      observer.disconnect()
      window.clearTimeout(safety)
      window.removeEventListener("beforeprint", showForPrint)
      ctx.revert()
    }
  }, [y, delay, durationProp, stagger])

  // `data-reveal` marks the element for the reduced-motion safety net in
  // globals.css, and for the print rule.
  return (
    <Tag
      ref={(node: HTMLElement | null) => {
        ref.current = node
      }}
      className={className}
      data-reveal=""
    >
      {children}
    </Tag>
  )
}

/** Reveal a list, staggering its direct children. */
export function StaggerReveal({
  children,
  step = staggerTokens.base,
  ...props
}: Omit<RevealProps, "stagger"> & { step?: number }): ReactNode {
  return (
    <Reveal {...props} stagger={step}>
      {children}
    </Reveal>
  )
}
