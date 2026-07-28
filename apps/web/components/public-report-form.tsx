"use client"

import { useActionState } from "react"

import { submitReport } from "@/app/[locale]/report/actions"
import {
  initialReportFormState,
  type ReportFormState,
} from "@/app/[locale]/report/form-state"
import { Button } from "@/components/ui/button"
import { Field, Input, fieldDescriptionId } from "@/components/ui/input"

/**
 * The public damage-report form.                              Owner: W3-H
 *
 * ## It works without JavaScript
 *
 * `<form action={formAction}>` bound to a server action is submitted by the
 * browser as an ordinary form POST when the JS bundle has not loaded, and React
 * upgrades it in place once it has. `tasks/W3-H`'s final edge case asks for
 * exactly this rather than a dead button, and the user it is written for —
 * somebody standing in front of a burst pipe on a bad connection — is the one
 * most likely to be on the un-upgraded path.
 *
 * The consequence is that nothing here may depend on client state to be
 * correct. The idempotency key is minted on the **server**, during render, and
 * carried in a hidden field; a `crypto.randomUUID()` in an effect would produce
 * a form that silently loses its replay protection with JS off.
 *
 * ## Why the reference is announced, loudly, and only when it exists
 *
 * `status === "stored"` is the only branch that renders a reference, because it
 * is the only branch where one exists. Every failure path renders the failure.
 * The 503 case says the report was **not** recorded and to try again — the one
 * thing it must never do is offer a number, because a reference the system
 * cannot look up later is worse than an honest failure: the reporter stops
 * worrying about a hazard nobody has a record of.
 */
export interface ReportFormLabels {
  location: string
  locationHint: string
  description: string
  descriptionHint: string
  contact: string
  contactHint: string
  submit: string
  submitting: string
  storedTitle: string
  storedBody: string
  referenceLabel: string
  unavailableTitle: string
  unavailableBody: string
  throttledTitle: string
  conflictTitle: string
  invalidTitle: string
  errorTitle: string
  retryAfter: string
  trackCta: string
}

export function PublicReportForm({
  idempotencyKey,
  trackHref,
  labels,
}: {
  /** Minted on the server during render. See the note above. */
  idempotencyKey: string
  trackHref: string
  labels: ReportFormLabels
}): React.JSX.Element {
  const [state, formAction, pending] = useActionState<ReportFormState, FormData>(
    submitReport,
    initialReportFormState
  )

  if (state.status === "stored" && state.reference !== null) {
    return (
      <section
        // `role="status"` rather than `alert`: this is the successful outcome,
        // and an assertive interruption is for things going wrong.
        role="status"
        aria-live="polite"
        className="flex flex-col gap-4 rounded-xl border border-primary/40 bg-primary/5 p-5"
      >
        <h2 className="font-display text-xl text-foreground">
          {labels.storedTitle}
        </h2>
        <p className="text-sm text-muted-foreground">{labels.storedBody}</p>
        <p className="flex flex-col gap-1">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {labels.referenceLabel}
          </span>
          {/*
            `select-all` so a reference can be copied in one gesture on a phone,
            which is where most of these are read. Rendered as text, never as a
            link with the reference in the URL: it is a bearer credential and a
            URL ends up in history, in a referrer and in a server log.
          */}
          <code className="text-lg font-semibold tracking-wider text-foreground select-all">
            {state.reference}
          </code>
        </p>
        <a
          href={trackHref}
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {labels.trackCta}
        </a>
      </section>
    )
  }

  const notice = describeFailure(state, labels)

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      {notice === null ? null : (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
        >
          <span className="block font-semibold">{notice.title}</span>
          {notice.body === null ? null : (
            <span className="block font-normal">{notice.body}</span>
          )}
        </p>
      )}

      <Field
        htmlFor="location"
        label={labels.location}
        hint={labels.locationHint}
        {...(state.fieldErrors.location === undefined
          ? {}
          : { error: state.fieldErrors.location })}
      >
        <Input
          id="location"
          name="location"
          required
          // Mirrors `shortText` in W2-B's schema. A client ceiling is a courtesy,
          // never the control: the server rejects independently.
          maxLength={200}
          defaultValue={state.values.location}
          aria-invalid={
            state.fieldErrors.location === undefined ? undefined : true
          }
          aria-describedby={fieldDescriptionId(
            "location",
            state.fieldErrors.location !== undefined
          )}
        />
      </Field>

      <Field
        htmlFor="description"
        label={labels.description}
        hint={labels.descriptionHint}
        {...(state.fieldErrors.description === undefined
          ? {}
          : { error: state.fieldErrors.description })}
      >
        <textarea
          id="description"
          name="description"
          required
          rows={6}
          maxLength={4000}
          defaultValue={state.values.description}
          aria-invalid={
            state.fieldErrors.description === undefined ? undefined : true
          }
          aria-describedby={fieldDescriptionId(
            "description",
            state.fieldErrors.description !== undefined
          )}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground shadow-sm transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
        />
      </Field>

      <Field
        htmlFor="contact"
        label={labels.contact}
        hint={labels.contactHint}
        {...(state.fieldErrors.contact === undefined
          ? {}
          : { error: state.fieldErrors.contact })}
      >
        <Input
          id="contact"
          name="contact"
          maxLength={200}
          autoComplete="email"
          defaultValue={state.values.contact}
        />
      </Field>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? labels.submitting : labels.submit}
      </Button>
    </form>
  )
}

/**
 * Maps a failed state to its heading and body.
 *
 * Split out so the branch list is readable as a list. Note that there is no
 * default that invents a reference, and no branch that treats 503 as success.
 */
function describeFailure(
  state: ReportFormState,
  labels: ReportFormLabels
): { title: string; body: string | null } | null {
  switch (state.status) {
    case "idle":
    case "stored":
      return null
    case "unavailable":
      return { title: labels.unavailableTitle, body: labels.unavailableBody }
    case "throttled":
      return {
        title: labels.throttledTitle,
        body:
          state.retryAfterSeconds === null
            ? null
            : labels.retryAfter.replace(
                "{seconds}",
                String(state.retryAfterSeconds)
              ),
      }
    case "conflict":
      return { title: labels.conflictTitle, body: state.message }
    case "invalid":
      return { title: labels.invalidTitle, body: state.message }
    case "error":
      return { title: labels.errorTitle, body: state.message }
  }
}
