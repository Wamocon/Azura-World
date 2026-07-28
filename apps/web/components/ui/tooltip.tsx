"use client"

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import type { ComponentProps, ReactNode } from "react"

import { cn } from "@/lib/cn"

/**
 * Tooltip.                                                 Owner: W1-D
 *
 * Origin-aware: `transform-origin: var(--transform-origin)` makes the popup
 * scale out of its trigger rather than out of its own centre. Base UI computes
 * that variable from the resolved side and alignment, so it stays correct when
 * the tooltip flips to avoid a viewport edge. Whether any single user notices
 * is not the point — in aggregate, unseen correctness is what reads as care.
 *
 * Entry is `scale(0.97)`, never `scale(0)`: nothing in the physical world
 * appears out of nothing, and a zero-scale entrance reads as a glitch.
 *
 * `TooltipProvider` gives the whole app one shared delay timer, which is what
 * makes the second tooltip in a toolbar open instantly. The delay exists to
 * stop an accidental hover firing one tooltip; once the user has demonstrably
 * committed to reading them, re-paying it on every neighbour just feels slow.
 *
 * IMPORTANT — a tooltip is never the only carrier of information. It is
 * unreachable on touch and hostile to screen readers, so provenance and
 * conflict state are never behind one (DESIGN-RESEARCH §4.6). See
 * `components/evidence/*`, which use a popover with a real focusable trigger.
 */

function TooltipProvider({
  delay = 500,
  closeDelay = 100,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      delay={delay}
      closeDelay={closeDelay}
      {...props}
    />
  )
}

function Tooltip(props: ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root {...props} />
}

function TooltipTrigger(
  props: ComponentProps<typeof TooltipPrimitive.Trigger>
) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 8,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Popup> & {
  sideOffset?: number
}): ReactNode {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner sideOffset={sideOffset}>
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 max-w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-border bg-popover px-2.5 py-1.5",
            "text-xs leading-relaxed text-popover-foreground shadow-lg",
            "origin-[var(--transform-origin)]",
            "transition-[transform,opacity] duration-[125ms] ease-[var(--ease-out)]",
            "data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0",
            "data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0",
            // Once one tooltip is open, its neighbours skip both the delay and
            // the animation. Base UI sets `data-instant` for exactly this.
            "data-[instant]:duration-0",
            "motion-reduce:transition-opacity motion-reduce:data-[starting-style]:scale-100 motion-reduce:data-[ending-style]:scale-100",
            className
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
