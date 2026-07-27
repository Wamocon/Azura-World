"use client"

import { AnimatePresence, motion } from "framer-motion"
import type { ReactNode } from "react"

import { cn } from "@/lib/cn"
import { cubic, duration, staggerDelay } from "@/lib/motion"

import { useReducedMotion } from "@/components/providers/motion-preference-provider"

/**
 * Stagger — entrance and exit for lists whose CONTENTS change.
 *                                                          Owner: W1-D
 *
 * Division of labour, per DESIGN-RESEARCH §1:
 *   `reveal.tsx`  GSAP + IntersectionObserver — fires once, on scroll
 *   this file     Framer Motion — fires whenever items are added or removed
 *
 * They are not interchangeable. A filtered unit list re-staggers on every
 * keystroke and needs interruptible enter/exit; a section heading enters once
 * and never again. Using the scroll reveal for a live list would replay the
 * entrance on every filter change, and using this for a static section would
 * ship Framer Motion to render something that never moves.
 *
 * EXIT IS FASTER THAN ENTER (0.2s vs 0.32s). An element leaving is a decision
 * the user already made; making them wait for it feels like lag. An element
 * arriving is new information and can afford the extra 120ms.
 *
 * Under reduced motion this renders a plain list with no motion wrapper at
 * all — not a zero-duration animation. Framer Motion bakes its `initial` state
 * into SSR output, so a suppressed-but-still-mounted animation is how elements
 * end up permanently invisible.
 */

/**
 * Enter and exit transitions for one item at `index`.
 *
 * Exit is `duration.fast` where enter is `duration.base` — the asymmetry the
 * header describes, expressed rather than merely claimed.
 */
function transitionsFor(index: number, step?: number) {
  return {
    enter: {
      duration: duration.base,
      delay: staggerDelay(index, step),
      ease: cubic.out,
    },
    exit: {
      duration: duration.fast,
      ease: cubic.out,
    },
  }
}

export function StaggerList<T>({
  items,
  getKey,
  renderItem,
  step,
  className,
  itemClassName,
}: {
  items: readonly T[]
  getKey: (item: T, index: number) => string
  renderItem: (item: T, index: number) => ReactNode
  step?: number
  className?: string
  itemClassName?: string
}): ReactNode {
  const reducedMotion = useReducedMotion()

  if (reducedMotion) {
    return (
      <div className={cn("flex min-w-0 flex-col", className)}>
        {items.map((item, index) => (
          <div key={getKey(item, index)} className={itemClassName}>
            {renderItem(item, index)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      {/* `initial={false}` so the first paint after hydration is not an
          entrance for items that were already in the SSR markup. */}
      <AnimatePresence initial={false} mode="popLayout">
        {items.map((item, index) => {
          const transitions = transitionsFor(index, step)
          return (
            <motion.div
              key={getKey(item, index)}
              className={itemClassName}
              initial={{ opacity: 0, transform: "translateY(8px)" }}
              animate={{
                opacity: 1,
                transform: "translateY(0px)",
                transition: transitions.enter,
              }}
              exit={{
                opacity: 0,
                transform: "translateY(-8px)",
                transition: transitions.exit,
              }}
            >
              {renderItem(item, index)}
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

/**
 * A single item's entrance, for use inside an existing `AnimatePresence`.
 *
 * `transform` is written as a full string rather than Framer's `x`/`y`
 * shorthands on purpose: the shorthands are driven by `requestAnimationFrame`
 * on the main thread and drop frames while the browser is busy, whereas a
 * `transform` string is handed to the compositor. On a page that is
 * simultaneously loading images and hydrating, that is the difference between
 * smooth and visibly stuttering.
 */
export function StaggerItem({
  index = 0,
  step,
  children,
  className,
}: {
  index?: number
  step?: number
  children: ReactNode
  className?: string
}): ReactNode {
  const reducedMotion = useReducedMotion()

  if (reducedMotion) {
    return <div className={className}>{children}</div>
  }

  const transitions = transitionsFor(index, step)

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, transform: "translateY(8px)" }}
      animate={{
        opacity: 1,
        transform: "translateY(0px)",
        transition: transitions.enter,
      }}
      exit={{
        opacity: 0,
        transform: "translateY(-8px)",
        transition: transitions.exit,
      }}
    >
      {children}
    </motion.div>
  )
}
