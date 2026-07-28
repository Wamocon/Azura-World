import { randomUUID } from "node:crypto"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { hasLocale } from "next-intl"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { Link } from "@/app/navigation"
import { PublicReportForm } from "@/components/public-report-form"
import { locales } from "@/lib/contracts"

/**
 * `/[locale]/report` — anonymous damage report.               Owner: W3-H
 *
 * One of the app's two unauthenticated write paths, and the higher-risk of the
 * two because it persists free text that other people later read in a triage
 * view.
 *
 * ## `force-dynamic`, and why it is not a performance decision
 *
 * The idempotency key below is minted per render. A statically cached page
 * would hand **every visitor the same key**, and the second person to report
 * anything would have their report rejected as a replay of the first — or, if
 * the bodies differed, receive a 409 for a report they had never submitted. A
 * cached nonce is not a nonce.
 *
 * ## Why the key is minted here rather than in the component
 *
 * The form must work with JavaScript disabled (`tasks/W3-H` edge cases), so the
 * key cannot come from an effect or an event handler. Rendering it into a hidden
 * field on the server is the only place that survives a plain form POST. It also
 * gives the retry semantics you want for free: pressing the browser's reload and
 * re-submitting reuses the same key, so a double submission is collapsed by
 * `createManifestHandler`'s replay check instead of filing two reports.
 */
export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  if (!hasLocale(locales, locale)) return {}
  const t = await getTranslations({ locale, namespace: "report.intake" })
  return {
    title: t("title"),
    description: t("lead"),
    // An intake form has nothing an index should carry, and an indexed one
    // attracts exactly the automated traffic the rate limiter exists to absorb.
    robots: { index: false, follow: false },
  }
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<React.JSX.Element> {
  const { locale } = await params
  if (!hasLocale(locales, locale)) notFound()
  setRequestLocale(locale)

  const t = await getTranslations({ locale, namespace: "report.intake" })

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 py-16 sm:py-24">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl tracking-[-0.01em] text-foreground">
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("lead")}</p>
        <p className="text-sm text-muted-foreground">{t("privacy")}</p>
      </header>

      <PublicReportForm
        idempotencyKey={randomUUID()}
        trackHref={`/${locale}/report/track`}
        labels={{
          location: t("location"),
          locationHint: t("locationHint"),
          description: t("description"),
          descriptionHint: t("descriptionHint"),
          contact: t("contact"),
          contactHint: t("contactHint"),
          submit: t("submit"),
          submitting: t("submitting"),
          storedTitle: t("storedTitle"),
          storedBody: t("storedBody"),
          referenceLabel: t("referenceLabel"),
          unavailableTitle: t("unavailableTitle"),
          unavailableBody: t("unavailableBody"),
          throttledTitle: t("throttledTitle"),
          conflictTitle: t("conflictTitle"),
          invalidTitle: t("invalidTitle"),
          errorTitle: t("errorTitle"),
          retryAfter: t("retryAfter"),
          trackCta: t("trackCta"),
        }}
      />

      <p className="text-sm text-muted-foreground">
        {t("haveReference")}{" "}
        <Link
          href="/report/track"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {t("trackCta")}
        </Link>
      </p>
    </main>
  )
}
