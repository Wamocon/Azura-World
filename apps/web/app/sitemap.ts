/**
 * sitemap.xml.                                                       Owner: W3-A
 *
 * One entry per locale, each carrying the full `alternates.languages` map so
 * the four translations are declared as translations of one another rather than
 * as four unrelated pages. This is the same correctness the page's `hreflang`
 * block asserts; a sitemap that disagreed with the head would leave a crawler
 * to pick one, and it would pick the wrong one.
 *
 * `lastModified` is the dataset's own `generatedAt`, not the deploy time — the
 * page changes when the evidence changes, and claiming otherwise trains a
 * crawler to ignore the field.
 */

import type { MetadataRoute } from "next"

import { generatedAt } from "@/components/azura/landing-data"
import { defaultLocale, locales } from "@/lib/contracts"
import { publicEnv } from "@/lib/env"

const SITE_URL = publicEnv.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3200"

export default function sitemap(): MetadataRoute.Sitemap {
  const languages: Record<string, string> = {}
  for (const locale of locales) languages[locale] = `${SITE_URL}/${locale}`
  languages["x-default"] = `${SITE_URL}/${defaultLocale}`

  return locales.map((locale) => ({
    url: `${SITE_URL}/${locale}`,
    lastModified: new Date(generatedAt),
    changeFrequency: "monthly" as const,
    priority: locale === defaultLocale ? 1 : 0.8,
    alternates: { languages },
  }))
}
