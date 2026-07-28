import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { hasLocale } from "next-intl"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { Link } from "@/app/navigation"
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
    <main className="mx-auto flex w-full max-w-md flex-col gap-8 px-5 py-16 sm:py-24">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl tracking-[-0.01em] text-foreground">
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("lead")}</p>
        <p className="text-sm text-muted-foreground">{t("roleNotice")}</p>
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
          retryAfter: t("retryAfter"),
          invalidTitle: t("invalidTitle"),
          errorTitle: t("errorTitle"),
        }}
      />

      <p className="text-sm text-muted-foreground">
        {t("hasAccount")}{" "}
        <Link
          href="/login"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {t("signIn")}
        </Link>
      </p>
    </main>
  )
}
