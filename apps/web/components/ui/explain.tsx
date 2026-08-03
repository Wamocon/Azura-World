"use client"

import { Popover } from "@base-ui/react/popover"
import { HelpCircle } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/cn"

/**
 * Explain — a word the reader is allowed not to know.          Owner: W-NIGHT
 *
 * The dashboard is full of terms that are precise to us and opaque to the
 * property manager it is for: *modelled*, *not stated*, *real listing*,
 * *conflicted*, *SLA*. They were rendered as bare badges, so the honesty control
 * the whole product is built on was only legible to whoever wrote it. This is
 * the fix: every such term carries its own plain-language explanation.
 *
 * ## Why a popover and not a tooltip
 *
 * `components/ui/tooltip.tsx` says it in its own header — a tooltip is
 * unreachable on touch and hostile to screen readers, so it may never be the
 * only carrier of information (DESIGN-RESEARCH §4.6). A glossary that a phone
 * user cannot open is not an accessibility feature, it is decoration. So this is
 * a real `<button>` trigger with a focus ring and a 24px target: tap, click,
 * Enter and Space all open it, Escape closes it, and the popup is announced.
 *
 * ## The explanation is plain language, in four locales
 *
 * `messages/*.json → glossary.*`. Written for someone who manages a building,
 * not someone who models data: "no source states this" beats "confidence: gap",
 * and the rule from the skill holds — plain language must make a limitation
 * MORE obvious, never less.
 */

export interface ExplainLabels {
  /** The term as shown, e.g. "Modelled". */
  term: string
  /** One or two sentences of plain language. */
  body: string
  /** Accessible name for the trigger, e.g. "What does {term} mean?". */
  ariaLabel: string
}

export function Explain({
  labels,
  children,
  className,
  iconOnly = false,
}: {
  labels: ExplainLabels
  /** What the reader sees. Defaults to the term itself. */
  children?: ReactNode
  className?: string
  /** Render only the question mark, for use beside an existing badge. */
  iconOnly?: boolean
}): ReactNode {
  return (
    <Popover.Root>
      <Popover.Trigger
        data-slot="explain-trigger"
        aria-label={labels.ariaLabel}
        className={cn(
          // A control, not a hint: 24px floor and a real focus ring.
          "inline-flex min-h-6 cursor-help items-center gap-1 rounded-md text-left align-middle",
          "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          iconOnly
            ? "justify-center text-muted-foreground hover:text-foreground"
            : "underline decoration-dotted decoration-from-font underline-offset-4 hover:decoration-solid",
          className
        )}
      >
        {iconOnly ? null : (children ?? labels.term)}
        <HelpCircle className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="start">
          <Popover.Popup
            data-slot="explain-popover"
            className={cn(
              "z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-1.5 rounded-xl border border-border",
              "bg-popover p-3.5 text-popover-foreground shadow-2xl",
              "origin-[var(--transform-origin)]",
              "transition-[transform,opacity] duration-200 ease-[var(--ease-out)]",
              "data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0",
              "data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0",
              "motion-reduce:transition-opacity motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100"
            )}
          >
            <Popover.Title className="font-display text-sm font-semibold">
              {labels.term}
            </Popover.Title>
            <Popover.Description className="text-xs leading-relaxed text-muted-foreground">
              {labels.body}
            </Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
