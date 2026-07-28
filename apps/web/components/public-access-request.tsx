"use client"

import { useActionState } from "react"

import { requestAccess } from "@/app/[locale]/signup/actions"
import {
  initialAccessRequestState,
  type AccessRequestState,
} from "@/app/[locale]/signup/form-state"
import { Button } from "@/components/ui/button"
import { Field, Input, fieldDescriptionId } from "@/components/ui/input"

/**
 * The access-request form.                                    Owner: W3-H
 *
 * There is no password field, and that is the design rather than an omission.
 * This form does not create an account; it asks an administrator to. A password
 * collected here would have to be stored somewhere before an account existed to
 * attach it to, which is the worst possible place for one — and the user would
 * reasonably assume they had registered.
 *
 * There is also no role selector. `tasks/W3-H` §2 requires elevation to be an
 * admin action and never self-service, and the cheapest way to guarantee that
 * is to never accept a role as input at any layer.
 *
 * Two independent things stop a hand-crafted POST carrying `role: "admin"`,
 * and it is worth being precise about which does what:
 *
 *  1. `requestAccess` reads **exactly four named fields** off the `FormData`
 *     and builds its own object from them. An injected `role` field is never
 *     read, so it does not reach the schema at all. Verified by submitting this
 *     form with `role`, `roles`, `is_active` and `company_id` appended: the
 *     outcome was unchanged and no cookie, session or account appeared.
 *  2. The schema is a `strictObject`, so if that construction were ever
 *     refactored into a pass-through, an unknown key would become a validation
 *     failure rather than a silently accepted field.
 *
 * The first is what holds today; the second is what stops a future edit from
 * quietly removing it.
 */
export interface AccessRequestLabels {
  fullName: string
  fullNameHint: string
  email: string
  emailHint: string
  company: string
  companyHint: string
  reason: string
  reasonHint: string
  submit: string
  submitting: string
  receivedTitle: string
  receivedBody: string
  unavailableTitle: string
  unavailableBody: string
  throttledTitle: string
  retryAfter: string
  invalidTitle: string
  errorTitle: string
}

export function PublicAccessRequest({
  labels,
}: {
  labels: AccessRequestLabels
}): React.JSX.Element {
  const [state, formAction, pending] = useActionState<
    AccessRequestState,
    FormData
  >(requestAccess, initialAccessRequestState)

  if (state.status === "received") {
    return (
      <section
        role="status"
        aria-live="polite"
        className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-primary/5 p-5"
      >
        <h2 className="font-display text-xl text-foreground">
          {labels.receivedTitle}
        </h2>
        <p className="text-sm text-muted-foreground">{labels.receivedBody}</p>
      </section>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state.status === "unavailable" ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <span className="block font-semibold">
            {labels.unavailableTitle}
          </span>
          <span className="block">{labels.unavailableBody}</span>
        </p>
      ) : null}

      {state.status === "throttled" ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <span className="block font-semibold">{labels.throttledTitle}</span>
          {state.retryAfterSeconds === null ? null : (
            <span className="block">
              {labels.retryAfter.replace(
                "{seconds}",
                String(state.retryAfterSeconds)
              )}
            </span>
          )}
        </p>
      ) : null}

      {state.status === "error" ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive"
        >
          {labels.errorTitle}
        </p>
      ) : null}

      <Field
        htmlFor="fullName"
        label={labels.fullName}
        hint={labels.fullNameHint}
        {...(state.fieldErrors.fullName === undefined
          ? {}
          : { error: state.fieldErrors.fullName })}
      >
        <Input
          id="fullName"
          name="fullName"
          required
          maxLength={200}
          autoComplete="name"
          defaultValue={state.values.fullName}
          aria-invalid={
            state.fieldErrors.fullName === undefined ? undefined : true
          }
          aria-describedby={fieldDescriptionId(
            "fullName",
            state.fieldErrors.fullName !== undefined
          )}
        />
      </Field>

      <Field
        htmlFor="email"
        label={labels.email}
        hint={labels.emailHint}
        {...(state.fieldErrors.email === undefined
          ? {}
          : { error: state.fieldErrors.email })}
      >
        <Input
          id="email"
          name="email"
          type="email"
          required
          maxLength={320}
          autoComplete="email"
          inputMode="email"
          defaultValue={state.values.email}
          aria-invalid={state.fieldErrors.email === undefined ? undefined : true}
          aria-describedby={fieldDescriptionId(
            "email",
            state.fieldErrors.email !== undefined
          )}
        />
      </Field>

      <Field
        htmlFor="company"
        label={labels.company}
        hint={labels.companyHint}
        {...(state.fieldErrors.company === undefined
          ? {}
          : { error: state.fieldErrors.company })}
      >
        <Input
          id="company"
          name="company"
          maxLength={200}
          autoComplete="organization"
          defaultValue={state.values.company}
        />
      </Field>

      <Field
        htmlFor="reason"
        label={labels.reason}
        hint={labels.reasonHint}
        {...(state.fieldErrors.reason === undefined
          ? {}
          : { error: state.fieldErrors.reason })}
      >
        <textarea
          id="reason"
          name="reason"
          required
          rows={5}
          maxLength={2000}
          defaultValue={state.values.reason}
          aria-invalid={
            state.fieldErrors.reason === undefined ? undefined : true
          }
          aria-describedby={fieldDescriptionId(
            "reason",
            state.fieldErrors.reason !== undefined
          )}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground shadow-sm transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
        />
      </Field>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? labels.submitting : labels.submit}
      </Button>
    </form>
  )
}
