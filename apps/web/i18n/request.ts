/**
 * next-intl request configuration — wired in through the plugin in
 * `next.config.ts` (`createNextIntlPlugin("./i18n/request.ts")`).
 *
 * Runs once per request on the server and decides which message catalogue the
 * render sees.
 *
 * ## Why an unknown locale is NOT silently coerced to German
 *
 * `requestLocale` is a catch-all: Next hands this function whatever sat in the
 * `[locale]` segment, including `/xx/dashboard` and `/robots.txt`. next-intl
 * requires a *valid* locale back — throwing here produces a 500, not a 404 — so
 * this function does fall back to `defaultLocale` when the segment is unknown.
 *
 * The 404 is produced one layer up, in `app/[locale]/layout.tsx`, which calls
 * `notFound()` for an unknown segment (W1-C brief, "Locale in the 404 path": an
 * unknown locale must 404 cleanly, not fall through to `de` silently — otherwise
 * a typo'd link is invisible). This file's fallback only exists so that the 404
 * page itself has messages to render with.
 */

import { getRequestConfig } from "next-intl/server"
import { hasLocale } from "next-intl"
import { defaultLocale, type Locale } from "@/lib/contracts"
import { routing } from "./routing"

/**
 * Loads one locale's catalogue. Kept as an explicit switch rather than a
 * template-literal `import(\`./messages/${locale}.json\`)`: the template form
 * makes every catalogue a dynamic dependency of every route, and webpack cannot
 * see that only four values are possible. `locale` has already been narrowed to
 * `Locale` by the caller, so there is no unreachable-default problem.
 */
async function loadMessages(locale: Locale) {
  switch (locale) {
    case "de":
      return (await import("../messages/de.json")).default
    case "en":
      return (await import("../messages/en.json")).default
    case "tr":
      return (await import("../messages/tr.json")).default
    case "ru":
      return (await import("../messages/ru.json")).default
  }
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale
  const locale: Locale = hasLocale(routing.locales, requested)
    ? requested
    : defaultLocale

  return {
    locale,
    messages: await loadMessages(locale),
    /**
     * Fixed to the project's own timezone, not the server's. Antalya is
     * UTC+03:00 year-round (Türkiye abolished DST in 2016), so every date a
     * dashboard shows is the date the site actually experienced. Leaving this
     * unset makes formatted dates depend on which machine rendered them, which
     * is a hydration mismatch waiting to happen.
     */
    timeZone: "Europe/Istanbul",
  }
})
