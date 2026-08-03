import type { ReactNode } from "react"

import { Explain, type ExplainLabels } from "@/components/ui/explain"
import { cn } from "@/lib/cn"

/**
 * A quiet note: something the reader has to know, said once.
 *
 * Two of the three things this page can state about occupancy and about the
 * hotel/residence split are absences, and absences were being argued rather
 * than stated — two dense paragraphs explaining at length why a number is not
 * shown. The length was itself the problem: a wall of justification reads as
 * defensiveness, and it buries the one sentence that matters.
 *
 * So a note is deliberately small: an icon, a label, one or two sentences, and
 * the glossary term beside it for the reader who wants to know what "not
 * stated" means here. It is visible at all times and never behind a hover,
 * because the gaps are the product.
 *
 * The dashed border is the same one the room-mix absence uses. Across this page
 * a dashed edge means "nothing was published here", and it never means anything
 * else.
 */

export function HotelOpsNote({
  icon,
  heading,
  body,
  explain,
  slot,
  testId,
  className,
}: {
  /** A lucide icon element, already `aria-hidden` and sized by this component. */
  icon: ReactNode
  heading: string
  body: string
  /** The glossary term this note turns on. `null` when it needs no gloss. */
  explain: ExplainLabels | null
  /** `data-slot`, kept stable for the verification script. */
  slot: string
  testId: string | null
  className?: string
}): ReactNode {
  return (
    <section
      data-slot={slot}
      {...(testId === null ? {} : { "data-testid": testId })}
      className={cn(
        "flex min-w-0 gap-3 rounded-xl border border-dashed border-border bg-muted/25 px-4 py-4 sm:px-5",
        className
      )}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4"
      >
        {icon}
      </span>

      <div className="flex min-w-0 flex-col gap-1.5">
        <h2 className="font-mono text-[0.6875rem] tracking-[0.18em] text-muted-foreground uppercase">
          {heading}
        </h2>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          {body}
          {explain === null ? null : (
            <span className="ml-1.5 inline-block align-middle">
              <Explain iconOnly labels={explain} />
            </span>
          )}
        </p>
      </div>
    </section>
  )
}
