"use client"

import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, fieldDescriptionId } from "@/components/ui/input"
import { signIn } from "./actions"
import { initialLoginFormState } from "./form-state"

/**
 * The credential form.                                        Owner: W3-H
 *
 * A client component only because `useActionState` needs one. There is no
 * client-side Supabase call and no client-side session handling: the action runs
 * on the server and the session cookie is written there, which is what keeps the
 * access token out of reach of page script.
 *
 * ## Why the error is one string and never the provider's
 *
 * `actions.ts` discards Supabase's message deliberately, because it distinguishes
 * "Invalid login credentials" from "Email not confirmed" and that difference is a
 * user-enumeration oracle. This form must not undo that by rendering anything
 * more specific, so it renders `state.message` verbatim and has no branch on the
 * kind of failure.
 *
 * ## The email survives a failure
 *
 * `defaultValue={state.email}` — the action echoes it back. Clearing a typed
 * field on a wrong password is a small thing that feels like being punished, and
 * CONVENTIONS §5 names discarding typed data as a real bug.
 */
export function LoginForm({
  locale,
  next,
  labels,
}: {
  locale: string
  next: string
  labels: {
    email: string
    password: string
    submit: string
    submitting: string
  }
}): React.JSX.Element {
  const [state, formAction, pending] = useActionState(
    signIn,
    initialLoginFormState
  )
  const hasError = state.status === "error" && state.message !== null

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {/*
        Carried in the body rather than read from the URL inside the action.
        The action re-validates both through `safeNextPath()` regardless, so a
        tampered field buys nothing; sending them explicitly just means the
        action never has to guess which request it is completing.
      */}
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="next" value={next} />

      <Field htmlFor="email" label={labels.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          maxLength={320}
          defaultValue={state.email}
          aria-invalid={hasError ? true : undefined}
          aria-describedby={
            hasError ? fieldDescriptionId("email", true) : undefined
          }
        />
      </Field>

      <Field htmlFor="password" label={labels.password}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={200}
          aria-invalid={hasError ? true : undefined}
        />
      </Field>

      {/*
        One error region for the whole form, tied to the email field by id.
        `role="alert"` announces it once when it appears; putting the same text
        under both fields would announce it twice and imply the email is at
        fault when the password may be.
      */}
      {hasError ? (
        <p
          id={fieldDescriptionId("email", true)}
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
        >
          {state.message}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? labels.submitting : labels.submit}
      </Button>
    </form>
  )
}
