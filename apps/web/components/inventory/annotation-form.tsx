"use client"

import { useActionState } from "react"

import {
  annotateFinding,
  type AnnotationState,
} from "@/app/[locale]/dashboard/evidence/actions"
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
  /** Shown BEFORE the click when there is no store to write to. */
  unavailable: string
}

const INITIAL: AnnotationState = { status: "idle" }

export function AnnotationForm({
  findingId,
  labels,
  available = false,
  className,
}: {
  findingId: string
  labels: AnnotationLabels
  /**
   * Whether a store exists to write to. **Defaults to false**, because today it
   * does not: `annotateFinding` returns `unavailable` on both branches and
   * `status: "saved"` is unreachable (`finding_annotations` is W1-A's, unbuilt).
   *
   * Until that lands the control is disabled and says so UP FRONT. It used to
   * look entirely operable, so the reader learned the note was discarded only
   * after typing it and pressing the button — and `useActionState` resets the
   * form, so the text was destroyed in the process. Every other write gap in
   * this dashboard announces itself before the click (`readOnlyNotice` on leads
   * and buyer-pipeline); this one was the exception, and it was the worst place
   * to make it, because the whole screen is an argument about honesty.
   *
   * Flip to `true` the same day the table exists.
   */
  available?: boolean
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
      className={cn(
        "flex flex-col gap-3 border-t border-border pt-6",
        className
      )}
    >
      <input type="hidden" name="findingId" value={findingId} />

      <div className="flex flex-col gap-1">
        <label
          htmlFor="annotation-note"
          className="font-mono text-[0.6875rem] tracking-[0.18em] text-muted-foreground uppercase"
        >
          {labels.heading}
        </label>
        <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
          {labels.hint}
        </p>
      </div>

      {/* The gap, stated before anything is typed rather than after. */}
      {available ? null : (
        <p
          role="status"
          className="max-w-prose rounded-md border border-confidence-gap/30 bg-confidence-gap/10 px-3 py-2 text-xs leading-relaxed text-foreground"
        >
          {labels.unavailable}
        </p>
      )}

      <textarea
        id="annotation-note"
        name="note"
        rows={3}
        maxLength={4000}
        placeholder={labels.placeholder}
        disabled={!available}
        aria-describedby={available ? undefined : "annotation-unavailable"}
        className={cn(
          "w-full resize-y rounded-md border border-border bg-background p-3 text-sm",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          "disabled:cursor-not-allowed disabled:opacity-60"
        )}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending || !available}>
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
