"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { cn } from "@/lib/cn"
import { cubic, duration, staggerDelay } from "@/lib/motion"

import { useReducedMotion } from "@/components/providers/motion-preference-provider"

/**
 * Immersion primitives.                                    Owner: W3-I
 *
 * `TiltCard`, `KineticHeadline`, `AnimatedCounter`, `AuroraBackground`.
 *
 * NOTE ON THE REFERENCE: 1Çatı's `3d-card.tsx` is named like a tilt card and is
 * not one — 32 lines, a server component, no pointer handlers, no transform.
 * The "3D" is a shadow-and-border hover treatment. Its `AnimatedCounter` is
 * likewise not animated: it takes a `duration` prop, ignores it, and hardcodes
 * `toLocaleString("tr-TR")`. So there is no house implementation of either to
 * mirror; both are built here, and the reference's names are not evidence of
 * behaviour.
 */

// ---------------------------------------------------------------------------
// TiltCard
// ---------------------------------------------------------------------------

/**
 * Pointer-tracking tilt.
 *
 * Written against `transform` on a ref rather than React state: a `setState`
 * per `pointermove` re-renders faster than the browser paints, which turns a
 * decorative flourish into a scroll-jank source.
 *
 * The tilt is spring-damped toward the pointer rather than pinned to it. Tying
 * a visual directly to pointer position feels artificial because it has no
 * momentum; interpolating gives it weight. This is decorative motion and it is
 * allowed to be — but only because it carries no information. A functional
 * chart would be better with none.
 *
 * Gated on `event.pointerType === "mouse"` rather than a `(hover: hover)` media
 * query, because a hybrid laptop matches that query and still gets tapped: the
 * check has to be per-event, not per-device. On touch the card never tilts, so
 * it cannot tilt on tap and stay tilted.
 */
export function TiltCard({
  children,
  className,
  /** Maximum rotation in degrees. Past ~8 it stops reading as depth. */
  maxTilt = 6,
}: {
  children: ReactNode
  className?: string
  maxTilt?: number
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()

  /**
   * The whole interaction lives in one effect, with native listeners.
   *
   * Not `useCallback` + JSX handlers: the rAF loop has to re-request itself,
   * and a `useCallback` that references its own binding is both a lint error
   * (`react-hooks/immutability`) and a genuine footgun, because the identity it
   * closes over is not guaranteed to be the one that runs. A plain function
   * inside an effect has neither problem, allocates once per mount instead of
   * once per render, and keeps every listener and frame handle in the same
   * scope as the cleanup that has to release them.
   */
  useEffect(() => {
    if (reducedMotion) return
    const element = ref.current
    if (element === null) return

    let frame = 0
    let targetX = 0
    let targetY = 0
    let currentX = 0
    let currentY = 0

    const animate = () => {
      frame = 0

      // Critically damped approach — no overshoot, settles quickly.
      currentX += (targetX - currentX) * 0.12
      currentY += (targetY - currentY) * 0.12

      element.style.transform = `perspective(900px) rotateX(${currentY.toFixed(3)}deg) rotateY(${currentX.toFixed(3)}deg)`

      const settled =
        Math.abs(targetX - currentX) < 0.01 && Math.abs(targetY - currentY) < 0.01
      if (!settled) frame = window.requestAnimationFrame(animate)
    }

    const request = () => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(animate)
    }

    const onPointerMove = (event: PointerEvent) => {
      // Touch and pen produce a pointermove on contact; only a real cursor
      // should tilt, or the card tilts on tap and stays tilted.
      if (event.pointerType !== "mouse") return
      const rect = element.getBoundingClientRect()
      targetX = ((event.clientX - rect.left) / rect.width - 0.5) * maxTilt * 2
      targetY = -((event.clientY - rect.top) / rect.height - 0.5) * maxTilt * 2
      request()
    }

    const onPointerLeave = () => {
      targetX = 0
      targetY = 0
      request()
    }

    element.addEventListener("pointermove", onPointerMove)
    element.addEventListener("pointerleave", onPointerLeave)

    return () => {
      element.removeEventListener("pointermove", onPointerMove)
      element.removeEventListener("pointerleave", onPointerLeave)
      if (frame !== 0) window.cancelAnimationFrame(frame)
      element.style.transform = ""
    }
  }, [maxTilt, reducedMotion])

  if (reducedMotion) {
    return <div className={className}>{children}</div>
  }

  return (
    <div
      ref={ref}
      className={cn(
        "[transform-style:preserve-3d] will-change-transform",
        className
      )}
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// KineticHeadline
// ---------------------------------------------------------------------------

/**
 * Word-by-word headline entrance.
 *
 * Splits on whitespace, never on characters. Per-character splitting destroys
 * the word for a screen reader, breaks text selection, and — the reason that
 * matters here — makes German compounds wrap mid-word, because each character
 * becomes its own inline-block box.
 *
 * The whole string stays in the accessible tree as one label; the animated
 * words are `aria-hidden`.
 *
 * Under reduced motion this returns plain text with no motion wrapper at all.
 * Framer Motion bakes `initial` into SSR output, so a suppressed-but-mounted
 * entrance is exactly how a headline ends up permanently invisible.
 */
export function KineticHeadline({
  text,
  className,
  as: Tag = "h2",
  step = 0.045,
}: {
  text: string
  className?: string
  as?: "h1" | "h2" | "h3" | "p"
  step?: number
}): ReactNode {
  const reducedMotion = useReducedMotion()
  const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text])

  if (reducedMotion) {
    return <Tag className={className}>{text}</Tag>
  }

  return (
    <Tag className={className} data-reveal="">
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {words.map((word, index) => (
          <span
            key={`${word}-${index}`}
            // `inline-block` so the transform applies; the trailing space is a
            // separate text node so words still break normally.
            className="inline-block will-change-transform"
            style={{
              animation: `azura-word-in ${duration.slow}s cubic-bezier(${cubic.out.join(",")}) both`,
              animationDelay: `${staggerDelay(index, step)}s`,
            }}
          >
            {word}
            {index < words.length - 1 ? " " : ""}
          </span>
        ))}
      </span>
    </Tag>
  )
}

// ---------------------------------------------------------------------------
// AnimatedCounter
// ---------------------------------------------------------------------------

/**
 * Counts up when it enters the viewport.
 *
 * The final value is the initial state, so SSR, no-JS, a failed hydration and
 * reduced motion all render the correct number with no branching in the caller.
 * Under reduced motion the count-up never starts — W3-I's brief: *"respects
 * reduced motion — no count-up, just the final value"*.
 *
 * Locale and `Intl.NumberFormatOptions` rather than a formatter function: this
 * is a client component whose callers are Server Components, and React cannot
 * serialise a function across that boundary.
 *
 * This is not `components/anim/counter.tsx`. That one is GSAP+ScrollTrigger and
 * belongs to the design system; this one is dependency-free rAF, because the
 * immersion layer already runs a lot of GSAP and a counter does not need a
 * ScrollTrigger to justify itself.
 */
export function AnimatedCounter({
  value,
  locale,
  formatOptions,
  suffix = "",
  className,
  durationMs = 1100,
}: {
  value: number
  locale: string
  formatOptions?: Intl.NumberFormatOptions
  suffix?: string
  className?: string
  durationMs?: number
}): ReactNode {
  const reducedMotion = useReducedMotion()
  const ref = useRef<HTMLSpanElement>(null)
  const [display, setDisplay] = useState(value)

  const optionsKey = JSON.stringify(formatOptions ?? {})
  const format = useMemo(() => {
    const formatter = new Intl.NumberFormat(
      locale,
      JSON.parse(optionsKey) as Intl.NumberFormatOptions
    )
    return (input: number) => `${formatter.format(input)}${suffix}`
  }, [locale, optionsKey, suffix])

  useEffect(() => {
    // Reduced motion never starts the count. `display` is not touched here —
    // the render below reads `value` directly in that case, so there is no
    // state write in this effect and no cascading render.
    if (reducedMotion) return
    const element = ref.current
    if (element === null) return

    let frame = 0
    let start = 0
    let cancelled = false

    const tick = (now: number) => {
      if (cancelled) return
      if (start === 0) start = now
      const progress = Math.min(1, (now - start) / durationMs)
      // ease-out cubic — fast first, settling. Matches --ease-out's character.
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(value * eased))
      if (progress < 1) frame = window.requestAnimationFrame(tick)
      else setDisplay(value)
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect()
          frame = window.requestAnimationFrame(tick)
        }
      },
      { threshold: 0.2 }
    )
    observer.observe(element)

    return () => {
      cancelled = true
      observer.disconnect()
      if (frame !== 0) window.cancelAnimationFrame(frame)
      // Never unmount mid-count leaving a partial number behind in a cached
      // tree — a half-counted figure reads as a real, wrong value.
      setDisplay(value)
    }
  }, [value, durationMs, reducedMotion])

  return (
    <span ref={ref} data-numeric className={className}>
      {format(reducedMotion ? value : display)}
    </span>
  )
}

// ---------------------------------------------------------------------------
// AuroraBackground
// ---------------------------------------------------------------------------

/**
 * Coastal light. CSS only — no canvas, no image, no bytes.
 *
 * `.azura-aurora` is defined in `globals.css` and carries its own
 * reduced-motion branch: the drifting layer is opted IN under
 * `(prefers-reduced-motion: no-preference)`, so it never starts rather than
 * being cancelled. The static gradient remains either way, which means the
 * section still has its background rather than going flat white.
 */
export function AuroraBackground({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}): ReactNode {
  return (
    <div className={cn("azura-aurora", className)} data-slot="aurora">
      {children}
    </div>
  )
}
