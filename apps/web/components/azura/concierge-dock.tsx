/**
 * The assistant, docked wherever it is mounted.               Owner: W-SITEMODEL
 *
 * `components/site-concierge.tsx` has existed and worked since W3-H, backed by
 * a live gateway, and it was reachable from exactly one URL that nothing linked
 * to. Its own page header says so: it belongs on the landing page, W3-H could
 * not write there, and it asked W3-A for a two-line embed that never landed. So
 * the product's headline differentiator shipped invisible.
 *
 * This is that embed. It assembles the same labels the standalone page does and
 * puts the widget in a dock that opens over the page, so every public surface
 * can mount it with one line instead of duplicating forty label lookups.
 *
 * Server Component. The strings are resolved here and handed down as data,
 * which is how `SiteConcierge` was designed to be used and what lets it work on
 * a surface that has no `NextIntlClientProvider` above it.
 */

import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"

import { ConciergeLauncher } from "@/components/azura/concierge-launcher"
import { publicSuggestions } from "@/lib/public-ai-knowledge"
import type { Locale } from "@/lib/contracts"

export async function ConciergeDock({
  locale,
}: {
  locale: Locale
}): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "concierge" })

  return (
    <ConciergeLauncher
      locale={locale}
      suggestions={publicSuggestions[locale]}
      openLabel={t("title")}
      closeLabel={t("clear")}
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
  )
}
