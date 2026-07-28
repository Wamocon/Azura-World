import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { hasLocale } from "next-intl"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { SiteConcierge } from "@/components/site-concierge"
import { publicSuggestions } from "@/lib/public-ai-knowledge"
import { locales, type Locale } from "@/lib/contracts"

/**
 * `/[locale]/concierge` — the public assistant, reachable.    Owner: W3-H
 *
 * ## Why this route exists at all
 *
 * `components/site-concierge.tsx` is the widget `tasks/W3-H` §4 asks for, and a
 * component nobody can open repeats exactly the problem it was written to fix:
 * W2-C shipped a guarded AI layer with 152 probe assertions and no way to reach
 * it. A second unreachable artefact on top of the first would be worse than
 * none, because it would look finished.
 *
 * The natural home is the landing page, which belongs to W3-A
 * (`app/[locale]/page.tsx` and `app/sections/*`). ORCHESTRATION §4 forbids
 * writing into another window's files, and there is no mount seam to use, so
 * this page gives the widget a real URL now and `HANDOFF/W3-H.md` asks W3-A for
 * the two-line embed separately. Both can be true: the assistant deserves a page
 * of its own *and* a presence on the landing page.
 *
 * ## Rendering mode
 *
 * Nothing declared. The page is static: the only dynamic thing on it is the
 * widget, which is a client component that fetches on interaction. The starter
 * prompts come from `lib/public-ai-knowledge.ts` at build time, and everything
 * else is message-catalogue text.
 */

export function generateStaticParams(): Array<{ locale: Locale }> {
  return locales.map((locale) => ({ locale }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  if (!hasLocale(locales, locale)) return {}
  const t = await getTranslations({ locale, namespace: "concierge" })
  return { title: t("title"), description: t("subtitle") }
}

export default async function ConciergePage({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<React.JSX.Element> {
  const { locale } = await params
  if (!hasLocale(locales, locale)) notFound()
  setRequestLocale(locale)

  const t = await getTranslations({ locale, namespace: "concierge" })

  /*
   * Labels are assembled here and passed down as a prop.
   *
   * `SiteConcierge` is a client component and could call `useTranslations`
   * itself, but taking strings as data keeps it usable from any surface that
   * wants to embed it — including one outside a `NextIntlClientProvider` — and
   * matches how W1-D's `ProvenanceValue` and `SourceChip` already work.
   */
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-12 sm:py-16">
      <SiteConcierge
        locale={locale}
        suggestions={publicSuggestions[locale]}
        labels={{
          title: t("title"),
          subtitle: t("subtitle"),
          placeholder: t("placeholder"),
          send: t("send"),
          thinking: t("thinking"),
          stop: t("stop"),
          clear: t("clear"),
          empty: t("empty"),
          disclaimer: t("disclaimer"),
          refusalNote: t("refusalNote"),
          notConfigured: t("notConfigured"),
          you: t("you"),
          assistant: t("assistant"),
          sourcesLabel: t("sourcesLabel"),
          errors: {
            unavailable: t("errors.unavailable"),
            rateLimited: t("errors.rateLimited"),
            tooLong: t("errors.tooLong"),
            refused: t("errors.refused"),
          },
          feedback: {
            question: t("feedback.question"),
            helpful: t("feedback.helpful"),
            notHelpful: t("feedback.notHelpful"),
            thanks: t("feedback.thanks"),
          },
          source: {
            openSource: t("openSource"),
            snapshot: t("snapshot"),
            unreachable: t("unreachable"),
            tier: {
              official: t("sourceTier.official"),
              developer: t("sourceTier.developer"),
              hotel: t("sourceTier.hotel"),
              portal: t("sourceTier.portal"),
              review: t("sourceTier.review"),
              press: t("sourceTier.press"),
            },
          },
        }}
      />
    </main>
  )
}
