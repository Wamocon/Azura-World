"use client"

import { useActionState, useId } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input, Label } from "@/components/ui/input"
import { cn } from "@/lib/cn"
import type { Locale } from "@/lib/contracts"
import type { SettingsState } from "@/app/[locale]/dashboard/settings/actions"

/**
 * Your own profile preferences.                                 Owner: W3-F
 *
 * There is no "user" field and there is no id in this form. The action resolves
 * the subject from the session, so this component could not target somebody else
 * even if it tried.
 *
 * On success it shows **the locale that is now stored**, which is the same value
 * it submitted in the ordinary case and a different one when a second tab won a
 * concurrent save. `tasks/W3-F` accepts last-write-wins here and asks that the
 * result show what was saved rather than what was sent.
 */

/**
 * NOTE: the initial state is NOT exported from the `"use server"` module.
 * Next 16 refuses a server-action file that exports anything other than an
 * async function ("A \"use server\" file can only export async functions,
 * found object"), and it is a build error rather than a warning. The TYPE is
 * still imported from there, because `import type` is erased.
 */
const INITIAL_STATE: SettingsState = { status: "idle" }

export interface PreferencesLabels {
  fullName: string
  phone: string
  language: string
  languageHint: string
  submit: string
  submitting: string
  resultHeading: string
  savedAs: string
  forbidden: string
  localeNames: Record<Locale, string>
}

const STATE_TONE: Readonly<Record<SettingsState["status"], string>> =
  Object.freeze({
    idle: "",
    saved:
      "border-confidence-confirmed/40 bg-confidence-confirmed/10 text-confidence-confirmed",
    incomplete:
      "border-confidence-conflicted/45 bg-surface-conflict text-confidence-conflicted",
    forbidden: "border-destructive/40 bg-destructive/5 text-destructive",
    invalid: "border-destructive/40 bg-destructive/5 text-destructive",
    unavailable:
      "border-quality-stale/40 bg-quality-stale/10 text-quality-stale",
  })

export function PreferencesForm({
  action,
  formLocale,
  availableLocales,
  initialLocale,
  initialFullName,
  initialPhone,
  labels,
  className,
}: {
  action: (
    previous: SettingsState,
    formData: FormData
  ) => Promise<SettingsState>
  formLocale: Locale
  availableLocales: readonly Locale[]
  initialLocale: Locale
  initialFullName: string
  initialPhone: string
  labels: PreferencesLabels
  className?: string
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE)
  const nameId = useId()
  const phoneId = useId()
  const localeId = useId()

  return (
    <form
      action={formAction}
      className={cn("flex min-w-0 flex-col gap-4", className)}
    >
      <input type="hidden" name="formLocale" value={formLocale} />

      <div className="grid [grid-template-columns:repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={nameId}>{labels.fullName}</Label>
          <Input
            id={nameId}
            name="fullName"
            defaultValue={initialFullName}
            maxLength={160}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={phoneId}>{labels.phone}</Label>
          <Input
            id={phoneId}
            name="phone"
            type="tel"
            defaultValue={initialPhone}
            maxLength={40}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={localeId}>{labels.language}</Label>
          <select
            id={localeId}
            name="preferredLocale"
            defaultValue={initialLocale}
            className="h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {availableLocales.map((candidate) => (
              <option key={candidate} value={candidate}>
                {labels.localeNames[candidate]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {labels.languageHint}
      </p>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? labels.submitting : labels.submit}
        </Button>
      </div>

      {state.status === "idle" ? null : (
        <div
          role="status"
          data-testid="preferences-result"
          data-status={state.status}
          className={cn(
            "flex min-w-0 flex-col gap-1 rounded-lg border px-3 py-2 text-sm",
            STATE_TONE[state.status]
          )}
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{labels.resultHeading}</span>
            {state.status === "unavailable" ? (
              <Badge variant="destructive">{state.httpStatus}</Badge>
            ) : null}
          </span>
          <span>
            {state.status === "forbidden" ? labels.forbidden : state.message}
          </span>
          {state.status === "saved" || state.status === "incomplete" ? (
            <span className="text-xs">
              {labels.savedAs} {labels.localeNames[state.savedLocale]}
            </span>
          ) : null}
        </div>
      )}
    </form>
  )
}
