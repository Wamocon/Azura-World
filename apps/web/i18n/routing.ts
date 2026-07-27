/**
 * Locale routing configuration — the single source of truth for next-intl.
 *
 * `locales` and `defaultLocale` are NOT declared here. They are declared once in
 * `lib/contracts.ts` (the executable form of CONTRACTS §7) and imported, because
 * `proxy.ts` already imports them from there. Two declarations would eventually
 * disagree and the disagreement would show up as a routing bug, not a type error.
 *
 * `localePrefix: "always"` — every URL carries its locale. There is no bare
 * `/dashboard`; `/` redirects to `/de`.
 */

import { defineRouting } from "next-intl/routing"
import { defaultLocale, locales } from "@/lib/contracts"

/** Every URL carries its locale. CONTRACTS §7. */
export const localePrefix = "always" as const

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix,
  /**
   * The proxy sets the locale from the URL segment only. No cookie, no
   * `Accept-Language` sniffing: a shared link must render the same page for
   * everyone, and a locale that silently follows the browser makes a bug report
   * ("the German page showed English") unreproducible.
   *
   * `lib/language-detection.ts` still exists — it detects the language of a
   * *chat message* for the concierge, which is a different question from which
   * page locale to serve.
   */
  localeDetection: false,
})

export { locales, defaultLocale }
export type { Locale } from "@/lib/contracts"
