import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { hasLocale } from "next-intl"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { Link } from "@/app/navigation"
import { AuthSplit } from "@/components/auth/auth-split"
import { PublicAccessRequest } from "@/components/public-access-request"
import { locales } from "@/lib/contracts"

/**
 * `/[locale]/signup` — request access.                        Owner: W3-H
 *
 * The login page already links here (`auth.login.requestAccess`), so this route
 * has been a 404 behind a visible link since login shipped. That is the same
 * class of gap login itself was: a link nobody can follow.
 *
 * ## What "signup" means here
 *
 * Not self-service registration. `tasks/W3-H` §2 requires the default role to be
 * `guest` and elevation to be an administrator's decision, and the copy has said
 * so since W1-C wrote it — `auth.signup.lead` is *"Zugänge werden geprüft und
 * manuell freigegeben"*. So this collects a request and grants nothing;
 * `actions.ts` records why calling `supabase.auth.signUp()` here would actually
 * be a privilege-escalation path rather than a shortcut.
 */
export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  if (!hasLocale(locales, locale)) return {}
  const t = await getTranslations({ locale, namespace: "auth.signup" })
  return {
    title: t("title"),
    description: t("lead"),
    robots: { index: false, follow: false },
  }
}

export default async function SignupPage({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<React.JSX.Element> {
  const { locale } = await params
  if (!hasLocale(locales, locale)) notFound()
  setRequestLocale(locale)

  const t = await getTranslations({ locale, namespace: "auth.signup" })

  return (
    <AuthSplit
      act="complex"
      plateTitle={t("plateTitle")}
      plateLead={t("plateLead")}
    >
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-[2rem] leading-[1.1] tracking-[-0.02em] text-foreground">
          {t("title")}
        </h1>
        <p className="text-[0.9375rem] leading-[1.6] text-muted-foreground">
          {t("lead")}
        </p>
        <p className="text-[0.9375rem] leading-[1.6] text-muted-foreground">
          {t("roleNotice")}
        </p>
      </header>

      <PublicAccessRequest
        labels={{
          fullName: t("name"),
          fullNameHint: t("nameHint"),
          email: t("email"),
          emailHint: t("emailHint"),
          company: t("company"),
          companyHint: t("companyHint"),
          reason: t("reason"),
          reasonHint: t("reasonHint"),
          submit: t("submit"),
          submitting: t("submitting"),
          receivedTitle: t("receivedTitle"),
          receivedBody: t("success"),
          unavailableTitle: t("unavailableTitle"),
          unavailableBody: t("unavailableBody"),
          throttledTitle: t("throttledTitle"),
          // `t.raw` and not `t`: the client does its own {seconds} substitution
          // once the throttle response actually names a number, so the
          // placeholder has to survive the server render. `t()` validates ICU
          // arguments and throws FORMATTING_ERROR when it finds one unfilled,
          // which took down every render of this page rather than just the
          // throttled one.
          retryAfter: t.raw("retryAfter"),
          invalidTitle: t("invalidTitle"),
          errorTitle: t("errorTitle"),
        }}
      />

      <p className="text-[0.875rem] text-muted-foreground">
        {t("hasAccount")}{" "}
        <Link
          href="/login"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {t("signIn")}
        </Link>
      </p>
    </AuthSplit>
  )
}
