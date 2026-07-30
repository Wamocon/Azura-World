"use client"

import { useActionState, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, fieldDescriptionId } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { Link } from "@/app/navigation"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/cn"
import { signIn } from "./actions"
import { initialLoginFormState } from "./form-state"

/**
 * The sign-in form.                                    Owner: W3-H / W-NIGHT
 *
 * Three ways in, in one component:
 *
 *   1. Email + password  — the SERVER ACTION path, unchanged and still primary.
 *      The action runs on the server and writes the session cookie there, which
 *      is what keeps the access token out of page script. The redesign did not
 *      move this to the client, deliberately.
 *   2. Phone (SMS one-time code) — client-side Supabase OTP.
 *   3. Google — client-side Supabase OAuth.
 *
 * ## The honesty rule on 2 and 3
 *
 * Google and phone are provider features that must be enabled in the Supabase
 * project (Google also needs a Google Cloud OAuth client; phone needs an SMS
 * provider with real per-message cost). At the time this was written both are
 * DISABLED in the project — checked against `/auth/v1/settings`, which reports
 * `google:false, phone:false, email:true`.
 *
 * So these buttons are REAL — they call the real Supabase methods — but when a
 * provider is off, Supabase returns "provider is not enabled" and this form
 * shows a plain, honest notice ("wird in Kürze aktiviert") rather than a cryptic
 * failure or, worse, a fake success. A button that lies about working is the one
 * thing this project's rules forbid (PIVOT §2). The moment a provider is enabled
 * in Supabase, the same button works with no code change.
 *
 * ## Why the email error text is never Supabase's
 *
 * `actions.ts` discards the provider message on purpose: it distinguishes
 * "Invalid login credentials" from "Email not confirmed", which is a
 * user-enumeration oracle. This form renders `state.message` verbatim and never
 * branches on the failure kind, preserving that.
 */

export interface LoginLabels {
  email: string
  password: string
  submit: string
  submitting: string
  showPassword: string
  hidePassword: string
  forgot: string
  methodEmail: string
  methodPhone: string
  orContinue: string
  google: string
  phoneNumber: string
  phonePlaceholder: string
  sendCode: string
  sendingCode: string
  code: string
  codePlaceholder: string
  verifyCode: string
  verifying: string
  codeSent: string
  changeNumber: string
  googlePending: string
  phonePending: string
  socialFailed: string
}

type Method = "email" | "phone"

/** A Supabase error whose message names a disabled provider, not a real fault. */
function isProviderDisabled(message: string | undefined): boolean {
  if (message === undefined) return false
  const m = message.toLowerCase()
  return (
    m.includes("not enabled") ||
    m.includes("unsupported provider") ||
    m.includes("provider is not enabled") ||
    m.includes("signups not allowed") ||
    m.includes("phone provider")
  )
}

export function LoginForm({
  locale,
  next,
  labels,
  googleLive,
  phoneLive,
}: {
  locale: string
  next: string
  labels: LoginLabels
  /** Google is actually enabled in Supabase. When false, the button shows an
   *  honest notice rather than navigating the user to a raw provider error. */
  googleLive: boolean
  phoneLive: boolean
}): React.JSX.Element {
  const [method, setMethod] = useState<Method>("email")

  return (
    <div className="flex flex-col gap-6">
      {/* Method switch. Two segments, `role="tablist"` so it is announced as a
          choice rather than two loose buttons. The email panel is the default
          and the one that actually authenticates today. */}
      <div
        role="tablist"
        aria-label={labels.methodEmail + " / " + labels.methodPhone}
        className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-secondary/50 p-1"
      >
        {(["email", "phone"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={method === m}
            onClick={() => setMethod(m)}
            className={cn(
              "azura-tap-compact rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-[var(--duration-fast)]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
              method === m
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {m === "email" ? labels.methodEmail : labels.methodPhone}
          </button>
        ))}
      </div>

      {method === "email" ? (
        <EmailPanel locale={locale} next={next} labels={labels} />
      ) : (
        <PhonePanel
          locale={locale}
          next={next}
          labels={labels}
          live={phoneLive}
        />
      )}

      {/* Divider */}
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs tracking-[0.08em] text-muted-foreground uppercase">
          {labels.orContinue}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <GoogleButton
        locale={locale}
        next={next}
        labels={labels}
        live={googleLive}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Email — the server-action path
// ---------------------------------------------------------------------------

function EmailPanel({
  locale,
  next,
  labels,
}: {
  locale: string
  next: string
  labels: LoginLabels
}): React.JSX.Element {
  const [state, formAction, pending] = useActionState(
    signIn,
    initialLoginFormState
  )
  const hasError = state.status === "error" && state.message !== null

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
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

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <label
            htmlFor="password"
            className="text-sm leading-none font-medium text-foreground"
          >
            {labels.password}
          </label>
          <Link
            href="/login"
            className="azura-tap-compact text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            {labels.forgot}
          </Link>
        </div>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          maxLength={200}
          showLabel={labels.showPassword}
          hideLabel={labels.hidePassword}
          aria-invalid={hasError ? true : undefined}
        />
      </div>

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

// ---------------------------------------------------------------------------
// Phone — client-side OTP
// ---------------------------------------------------------------------------

function PhonePanel({
  locale,
  next,
  labels,
  live,
}: {
  locale: string
  next: string
  labels: LoginLabels
  live: boolean
}): React.JSX.Element {
  const [phone, setPhone] = useState("")
  const [code, setCode] = useState("")
  const [stage, setStage] = useState<"enter-phone" | "enter-code">("enter-phone")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  async function sendCode(event: React.FormEvent) {
    event.preventDefault()
    // Provider off: never call Supabase. `signInWithOtp` against a disabled
    // phone provider would still round-trip and could surface a raw error;
    // showing the honest notice up front is both truthful and calmer.
    if (!live) {
      setNotice(labels.phonePending)
      return
    }
    setBusy(true)
    setNotice(null)
    const supabase = createClient()
    if (supabase === null) {
      setNotice(labels.socialFailed)
      setBusy(false)
      return
    }
    const { error } = await supabase.auth.signInWithOtp({ phone })
    setBusy(false)
    if (error !== null) {
      // Honest, not cryptic: a disabled provider is "coming soon", anything
      // else is a generic retry.
      setNotice(
        isProviderDisabled(error.message) ? labels.phonePending : labels.socialFailed
      )
      return
    }
    setStage("enter-code")
    setNotice(labels.codeSent)
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setNotice(null)
    const supabase = createClient()
    if (supabase === null) {
      setNotice(labels.socialFailed)
      setBusy(false)
      return
    }
    const { error } = await supabase.auth.verifyOtp({
      phone,
      token: code,
      type: "sms",
    })
    if (error !== null) {
      setBusy(false)
      setNotice(labels.socialFailed)
      return
    }
    // The browser client wrote the session cookie; a full navigation lets the
    // server pick it up. `next` is a validated same-origin path; the locale is
    // always prefixed (CONTRACTS §7 — a bare /dashboard is not a route).
    window.location.assign(`/${locale}${next}`)
  }

  return (
    <form
      onSubmit={stage === "enter-phone" ? sendCode : verify}
      className="flex flex-col gap-5"
      noValidate
    >
      <Field htmlFor="phone" label={labels.phoneNumber}>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder={labels.phonePlaceholder}
          required
          disabled={stage === "enter-code"}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </Field>

      {stage === "enter-code" ? (
        <Field htmlFor="code" label={labels.code}>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder={labels.codePlaceholder}
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
      ) : null}

      {notice !== null ? (
        <p
          role="status"
          className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground"
        >
          {notice}
        </p>
      ) : null}

      <Button type="submit" disabled={busy} className="w-full">
        {stage === "enter-phone"
          ? busy
            ? labels.sendingCode
            : labels.sendCode
          : busy
            ? labels.verifying
            : labels.verifyCode}
      </Button>

      {stage === "enter-code" ? (
        <button
          type="button"
          onClick={() => {
            setStage("enter-phone")
            setCode("")
            setNotice(null)
          }}
          className="azura-tap-compact self-start text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          {labels.changeNumber}
        </button>
      ) : null}
    </form>
  )
}

// ---------------------------------------------------------------------------
// Google — client-side OAuth
// ---------------------------------------------------------------------------

function GoogleButton({
  locale,
  next,
  labels,
  live,
}: {
  locale: string
  next: string
  labels: LoginLabels
  live: boolean
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  async function signInWithGoogle() {
    // The important guard. `signInWithOAuth` redirects the browser to the
    // authorize endpoint BEFORE returning, so on a project where Google is off
    // the user would land on a raw "provider is not enabled" JSON page. When it
    // is not live we never start that navigation and say so plainly instead.
    if (!live) {
      setNotice(labels.googlePending)
      return
    }
    setBusy(true)
    setNotice(null)
    const supabase = createClient()
    if (supabase === null) {
      setNotice(labels.socialFailed)
      setBusy(false)
      return
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // Where Google returns to. Requires an /auth/callback code-exchange
        // route, which does not exist yet (documented in the handover) — but a
        // disabled provider errors before the redirect anyway, so this is the
        // value that matters only once Google is enabled.
        redirectTo: `${window.location.origin}/${locale}${next}`,
      },
    })
    // A success does a full-page redirect to Google, so reaching here means it
    // did not start.
    setBusy(false)
    setNotice(
      isProviderDisabled(error?.message) ? labels.googlePending : labels.socialFailed
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        variant="outline"
        onClick={signInWithGoogle}
        disabled={busy}
        className="w-full gap-3"
      >
        <GoogleMark />
        {labels.google}
      </Button>
      {notice !== null ? (
        <p
          role="status"
          className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground"
        >
          {notice}
        </p>
      ) : null}
    </div>
  )
}

/** The Google G. Inline so it needs no network request and no icon dependency. */
function GoogleMark(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-[1.15rem] shrink-0"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  )
}
