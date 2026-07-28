"use client"

import { useEffect, useMemo, useRef, type ReactNode } from "react"

import { ease } from "@/lib/motion"

import { gsap, registerGsap } from "./gsap"

/**
 * Counter — a figure that counts up when it scrolls into view.
 *                                                          Owner: W1-D
 *
 * THE FINAL VALUE IS IN THE SSR MARKUP. The tween only ever overwrites
 * `textContent` on the client, and only when motion is allowed. That single
 * decision covers four cases at once with no branching in the caller: search
 * engines, no-JS, a failed hydration, and reduced motion all render the
 * correct number. W3-I's brief requires exactly this — "AnimatedCounter
 * (respects reduced motion — no count-up, just the final value)".
 *
 * Contrast with the 1Çatı reference's `animated-counter.tsx`, which accepts a
 * `duration` prop, never uses it, does not animate at all, and hardcodes
 * `toLocaleString("tr-TR")` — wrong for a German-default product. Formatting
 * here is the caller's, so a de/en/tr/ru page formats in its own locale.
 *
 * `gsap.matchMedia("(prefers-reduced-motion: no-preference)")` rather than an
 * imperative check: the tween is registered only under that query and
 * `mm.revert()` tears it down if the user turns reduced motion on mid-session,
 * restoring the number to its rendered value.
 */

export function Counter({
  value,
  locale,
  formatOptions,
  suffix = "",
  className,
  duration = 1.2,
  /** Where in the viewport the count starts. */
  start = "top 88%",
}: {
  value: number
  /**
   * Locale and options rather than a formatter function: this is a
   * `"use client"` component and its callers are Server Components, across
   * which React cannot serialise a function. `Intl.NumberFormatOptions` is a
   * plain object and crosses fine.
   */
  locale: string
  formatOptions?: Intl.NumberFormatOptions
  suffix?: string
  className?: string
  duration?: number
  start?: string
}): ReactNode {
  const ref = useRef<HTMLSpanElement>(null)

  // One formatter, reused for every frame. Constructing an Intl.NumberFormat
  // per frame is one of the more expensive things you can do inside a tween.
  //
  // Keyed on the serialised options rather than the object itself: callers
  // write `formatOptions={{ maximumFractionDigits: 0 }}` inline, which is a
  // fresh object every render. Depending on identity would rebuild the
  // formatter, change `format`, re-run the effect below, and restart the
  // count-up on every parent render.
  const optionsKey = JSON.stringify(formatOptions ?? {})
  const format = useMemo(() => {
    const formatter = new Intl.NumberFormat(
      locale,
      JSON.parse(optionsKey) as Intl.NumberFormatOptions
    )
    return (input: number) => `${formatter.format(input)}${suffix}`
  }, [locale, optionsKey, suffix])

  useEffect(() => {
    const el = ref.current
    if (el === null) return

    registerGsap()
    const mm = gsap.matchMedia()

    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const counter = { current: 0 }
      const tween = gsap.to(counter, {
        current: value,
        duration,
        ease: ease.out,
        // Integer steps. Without snapping, a formatter that shows decimals
        // renders a blur of digits nobody can read, and one that does not
        // still costs a formatting pass per frame for a value that did not
        // visibly change.
        snap: { current: 1 },
        scrollTrigger: { trigger: el, start, once: true },
        onUpdate: () => {
          el.textContent = format(Math.round(counter.current))
        },
        onComplete: () => {
          // Land exactly on the real value. Snapping mid-tween can leave the
          // last frame a unit short, and an off-by-one on a sourced figure is
          // a provenance bug, not a rendering one.
          el.textContent = format(value)
        },
      })
      return () => {
        tween.scrollTrigger?.kill()
        tween.kill()
        // Restore the true value if the tween is reverted part-way.
        el.textContent = format(value)
      }
    })

    return () => mm.revert()
  }, [value, format, duration, start])

  return (
    <span ref={ref} data-numeric className={className}>
      {format(value)}
    </span>
  )
}
