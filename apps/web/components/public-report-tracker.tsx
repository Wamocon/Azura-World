"use client"

import { useActionState } from "react"

import { lookupReport } from "@/app/[locale]/report/actions"
import {
  initialReportLookupState,
  type ReportLookupState,
} from "@/app/[locale]/report/form-state"
import { Button } from "@/components/ui/button"
import { Field, Input, fieldDescriptionId } from "@/components/ui/input"

/**
 * Report tracker — look up a report by reference.             Owner: W3-H
 *
 * ## One answer for "does not exist" and "not yours"
 *
 * The reference is the only key to a report, so "does this reference exist" is
 * the single question worth asking an enumeration script's worth of times. Both
 * outcomes therefore render the **same** copy from the **same** branch, and the
 * merge happens on the server (`ReportLookupStatus` has no `not_found` distinct
 * from `unauthorised`) so the distinction is not even present in the payload the
 * browser receives.
 *
 * A malformed reference is reported separately, and that is not a leak: it is a
 * statement about the string the user typed, decidable without touching
 * storage. Refusing to distinguish "you mistyped this" from "no such report"
 * would make the tracker unusable to the people it is for while telling an
 * attacker nothing extra.
 *
 * ## Timing
 *
 * There is no branch here that takes materially longer than another — the
 * lookup returns before any storage call today, and when W2-A's repository
 * lands, the "found" and "no result" paths must both perform the query. A
 * tracker that returns instantly for unknown references and slowly for real
 * ones is an enumeration oracle with extra steps.
 */
export interface ReportTrackerLabels {
  reference: string
  referenceHint: string
  submit: string
  submitting: string
  noResultTitle: string
  noResultBody: string
  invalidTitle: string
  throttledTitle: string
  retryAfter: string
  errorTitle: string
  foundTitle: string
  statusLabel: string
  submittedLabel: string
  locationLabel: string
  descriptionLabel: string
}

export function PublicReportTracker({
  labels,
}: {
  labels: ReportTrackerLabels
}): React.JSX.Element {
  const [state, formAction, pending] = useActionState<
    ReportLookupState,
    FormData
  >(lookupReport, initialReportLookupState)

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-5" noValidate>
        <Field
          htmlFor="reference"
          label={labels.reference}
          hint={labels.referenceHint}
          {...(state.status === "invalid"
            ? { error: labels.invalidTitle }
            : {})}
        >
          <Input
            id="reference"
            name="reference"
            required
            maxLength={128}
            autoComplete="off"
            spellCheck={false}
            // The reference is case-insensitive on the server; uppercasing the
            // field just makes it match what the user is copying from.
            className="uppercase"
            defaultValue={state.reference}
            aria-invalid={state.status === "invalid" ? true : undefined}
            aria-describedby={fieldDescriptionId(
              "reference",
              state.status === "invalid"
            )}
          />
        </Field>

        <Button type="submit" disabled={pending} className="w-full">
          {pending ? labels.submitting : labels.submit}
        </Button>
      </form>

      <div aria-live="polite">
        {state.status === "no_result" ? (
          <section className="rounded-lg border border-border bg-card px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">
              {labels.noResultTitle}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {labels.noResultBody}
            </p>
          </section>
        ) : null}

        {state.status === "throttled" ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
          >
            <span className="block font-semibold">{labels.throttledTitle}</span>
            {state.retryAfterSeconds === null ? null : (
              <span className="block font-normal">
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
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
          >
            {labels.errorTitle}
          </p>
        ) : null}

        {state.status === "found" && state.report !== null ? (
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
            <h2 className="font-display text-lg text-foreground">
              {labels.foundTitle}
            </h2>
            <dl className="grid gap-3 text-sm">
              <Row label={labels.statusLabel} value={state.report.status} />
              <Row
                label={labels.submittedLabel}
                value={state.report.submittedAt}
              />
              <Row
                label={labels.locationLabel}
                value={state.report.location}
              />
              <Row
                label={labels.descriptionLabel}
                value={state.report.description}
              />
            </dl>
          </section>
        ) : null}
      </div>
    </div>
  )
}

/**
 * One row of the found-report view.
 *
 * `{value}` is a JSX text child, so React escapes it. That is the whole XSS
 * defence for this surface and it is deliberately not supplemented with manual
 * escaping — `dangerouslySetInnerHTML` is banned repo-wide (CONVENTIONS §4), and
 * a hand-rolled escaper next to React's would be the thing that eventually gets
 * it wrong. `whitespace-pre-wrap` preserves the reporter's line breaks without
 * interpreting anything.
 */
function Row({
  label,
  value,
}: {
  label: string
  value: string
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="whitespace-pre-wrap text-foreground">{value}</dd>
    </div>
  )
}
