import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { hasLocale } from "next-intl"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { Link } from "@/app/navigation"
import { isAccessProfileEnabled } from "@/lib/auth"
import { publicEnv } from "@/lib/env"
import { locales } from "@/lib/contracts"
import { AccessProfilePicker } from "./access-profile-picker"
import { LoginForm } from "./login-form"
import { safeNextPath } from "./next-path"
import { AuthSplit } from "@/components/auth/auth-split"
import { cast } from "@/components/journey/cast"

/**
 * `/[locale]/login`.                                          Owner: W3-H
 *
 * ## This page was the blocker
 *
 * `actions.ts` has existed since W1-B and is complete. The page never was, so
 * `/de/login` returned 404 and `proxy.ts` redirected every unauthenticated
 * `/dashboard` request into it. The entire authenticated surface was unreachable
 * in a production build, and W4-A recorded it as its single blocking finding
 * (`HANDOFF/W4-A.md` §4.1), with a passing test asserting the 404 so the gap
 * could not be forgotten. That test now needs updating; the request is in
 * `HANDOFF/W3-H.md`.
 *
 * ## `next` is validated here as well as in the action
 *
 * `safeNextPath()` runs twice: once here, so the hidden field never carries a
 * hostile value into the rendered HTML, and again inside `signIn` before the
 * redirect. The second one is the one that matters — a form field is client
 * input and re-validating it is not optional — but rendering an unvalidated
 * `?next=` into the DOM would be its own problem, because the value lands in an
 * attribute a page script could read.
 *
 * The allowlist is a shape rule, not a list of paths: same-origin, single-slash,
 * absolute, no backslashes, no control characters. Anything else becomes
 * `/dashboard`. Every bypass tested is in `HANDOFF/W3-H.md` §"The next allowlist".
 *
 * ## Rendering mode
 *
 * `force-dynamic`. Two reasons, and the first alone is sufficient: the page
 * reads `searchParams`, so it cannot be prerendered anyway. The second is that
 * `isAccessProfileEnabled()` reads the environment, and a login page cached from
 * a build where the QA picker was enabled would keep offering it afterwards.
 */
export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  if (!hasLocale(locales, locale)) return {}
  const t = await getTranslations({ locale, namespace: "auth.login" })
  return {
    title: t("title"),
    description: t("lead"),
    // A sign-in page has no business in an index, and an indexed one invites
    // credential-stuffing traffic that never reaches a real user.
    robots: { index: false, follow: false },
  }
}

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): Promise<React.JSX.Element> {
  const { locale } = await params
  if (!hasLocale(locales, locale)) notFound()
  setRequestLocale(locale)

  const query = await searchParams
  const rawNext = query["next"]
  const next = safeNextPath(Array.isArray(rawNext) ? rawNext[0] : rawNext)

  const t = await getTranslations({ locale, namespace: "auth.login" })
  const tq = await getTranslations({ locale, namespace: "auth.qaMode" })

  // Read on the server, so the picker's code is not even sent to the browser
  // when it is off. A client-side check would ship the component and rely on it
  // not rendering, which is a weaker guarantee for the same effort.
  const qaModeAvailable = isAccessProfileEnabled()

  return (
    <AuthSplit
      plate={cast.signIn}
      plateTitle={t("plateTitle")}
      plateLead={t("plateLead")}
      backToHome={t("backToHome")}
    >
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-[2rem] leading-[1.1] tracking-[-0.02em] text-foreground">
          {t("title")}
        </h1>
        <p className="text-[0.9375rem] leading-[1.6] text-muted-foreground">
          {t("lead")}
        </p>
      </header>

      <LoginForm
        locale={locale}
        next={next}
        googleLive={publicEnv.NEXT_PUBLIC_AUTH_GOOGLE === "1"}
        phoneLive={publicEnv.NEXT_PUBLIC_AUTH_PHONE === "1"}
        labels={{
          email: t("email"),
          password: t("password"),
          submit: t("submit"),
          submitting: t("submitting"),
          showPassword: t("showPassword"),
          hidePassword: t("hidePassword"),
          forgot: t("forgot"),
          methodEmail: t("methodEmail"),
          methodPhone: t("methodPhone"),
          orContinue: t("orContinue"),
          google: t("google"),
          phoneNumber: t("phoneNumber"),
          phonePlaceholder: t("phonePlaceholder"),
          sendCode: t("sendCode"),
          sendingCode: t("sendingCode"),
          code: t("code"),
          codePlaceholder: t("codePlaceholder"),
          verifyCode: t("verifyCode"),
          verifying: t("verifying"),
          codeSent: t("codeSent"),
          changeNumber: t("changeNumber"),
          googlePending: t("googlePending"),
          phonePending: t("phonePending"),
          socialFailed: t("socialFailed"),
        }}
      />

      <p className="text-[0.875rem] text-muted-foreground">
        {t("noAccount")}{" "}
        <Link
          href="/signup"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {t("requestAccess")}
        </Link>
      </p>

      {qaModeAvailable ? (
        <AccessProfilePicker
          locale={locale}
          labels={{
            heading: tq("heading"),
            warning: tq("warning"),
            apply: tq("apply"),
            applying: tq("applying"),
            failed: tq("failed"),
          }}
        />
      ) : null}
    </AuthSplit>
  )
}
