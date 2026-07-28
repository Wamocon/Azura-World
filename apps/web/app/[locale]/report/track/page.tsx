import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { hasLocale } from "next-intl"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { Link } from "@/app/navigation"
import { PublicReportTracker } from "@/components/public-report-tracker"
import { locales } from "@/lib/contracts"

/**
 * `/[locale]/report/track` — look up a report by reference.   Owner: W3-H
 *
 * The reference is **not** accepted from the query string, only from the form
 * body. A `?reference=` would put a bearer credential into browser history, into
 * the `Referer` sent to any third-party asset on the page, and into every access
 * log between here and the origin. A POST body does none of those.
 *
 * That costs the shareable-link affordance, which is the right trade: a link
 * that anyone who sees it can use to read somebody's damage report is not a
 * feature.
 */
export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  if (!hasLocale(locales, locale)) return {}
  const t = await getTranslations({ locale, namespace: "report.track" })
  return {
    title: t("title"),
    description: t("lead"),
    robots: { index: false, follow: false },
  }
}

export default async function ReportTrackPage({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<React.JSX.Element> {
  const { locale } = await params
  if (!hasLocale(locales, locale)) notFound()
  setRequestLocale(locale)

  const t = await getTranslations({ locale, namespace: "report.track" })

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 py-16 sm:py-24">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl tracking-[-0.01em] text-foreground">
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("lead")}</p>
      </header>

      <PublicReportTracker
        labels={{
          reference: t("reference"),
          referenceHint: t("referenceHint"),
          submit: t("submit"),
          submitting: t("submitting"),
          noResultTitle: t("noResultTitle"),
          noResultBody: t("noResultBody"),
          invalidTitle: t("invalidTitle"),
          throttledTitle: t("throttledTitle"),
          retryAfter: t("retryAfter"),
          errorTitle: t("errorTitle"),
          foundTitle: t("foundTitle"),
          statusLabel: t("statusLabel"),
          submittedLabel: t("submittedLabel"),
          locationLabel: t("locationLabel"),
          descriptionLabel: t("descriptionLabel"),
        }}
      />

      <p className="text-sm text-muted-foreground">
        {t("newReport")}{" "}
        <Link
          href="/report"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {t("newReportCta")}
        </Link>
      </p>
    </main>
  )
}
