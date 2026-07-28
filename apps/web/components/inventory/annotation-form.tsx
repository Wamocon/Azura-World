"use client"

import { useActionState } from "react"

import { annotateFinding, type AnnotationState } from "@/app/[locale]/dashboard/evidence/actions"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/cn"

/**
 * The annotation control.                                         Owner: W3-C
 *
 * Rendered only for a role holding `evidence:manage` — the server decides that,
 * not this component, and `annotateFinding` re-checks it regardless. Hiding a
 * control is a courtesy; the action refusing is the boundary.
 *
 * ## Restraint
 *
 * azura-ui-ux §1: on this screen restraint IS the credibility. So this is a
 * label, a textarea and a button, in the panel's own spacing — no card, no
 * accent colour, no motion. The one thing it does emphatically is report what
 * happened, because the failure it will report today is "nothing was saved" and
 * that has to be impossible to misread as success.
 */

export interface AnnotationLabels {
  heading: string
  hint: string
  placeholder: string
  submit: string
  pending: string
  forbidden: string
  saved: string
}

const INITIAL: AnnotationState = { status: "idle" }

export function AnnotationForm({
  findingId,
  labels,
  className,
}: {
  findingId: string
  labels: AnnotationLabels
  className?: string
}) {
  const [state, action, pending] = useActionState(annotateFinding, INITIAL)

  // `unavailable` and `invalid` carry a server-authored message; the rest map to
  // a translated label. Never a generic "something went wrong": the whole point
  // of the unavailable branch is that the reader learns their note was not kept.
  const message =
    state.status === "unavailable" || state.status === "invalid"
      ? state.message
      : state.status === "forbidden"
        ? labels.forbidden
        : state.status === "saved"
          ? labels.saved
          : null

  const tone =
    state.status === "saved"
      ? "text-confidence-confirmed"
      : state.status === "idle"
        ? "text-muted-foreground"
        : "text-confidence-conflicted"

  return (
    <form
      action={action}
      data-slot="annotation-form"
      className={cn("flex flex-col gap-3 border-t border-border pt-6", className)}
    >
      <input type="hidden" name="findingId" value={findingId} />

      <div className="flex flex-col gap-1">
        <label
          htmlFor="annotation-note"
          className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted-foreground"
        >
          {labels.heading}
        </label>
        <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">{labels.hint}</p>
      </div>

      <textarea
        id="annotation-note"
        name="note"
        rows={3}
        maxLength={4000}
        placeholder={labels.placeholder}
        className={cn(
          "w-full resize-y rounded-md border border-border bg-background p-3 text-sm",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        )}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? labels.pending : labels.submit}
        </Button>
        {message === null ? null : (
          <p
            role="status"
            aria-live="polite"
            data-annotation-status={state.status}
            className={cn("text-xs leading-relaxed", tone)}
          >
            {message}
          </p>
        )}
      </div>
    </form>
  )
}
