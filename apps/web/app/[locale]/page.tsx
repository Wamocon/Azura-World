/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DIRECTION CONTRACT — W3-A landing surface. Re-read before every edit.
 *
 * THESIS: a dated survey of a resort, not a brochure for one. This page refuses
 *   the luxury-property arrangement (full-bleed render, thin serif over a
 *   photograph, gold rule, amenity grid) and equally refuses its predictable
 *   opposite, the bare data table. It owns one idea: the same page shows you a
 *   number it trusts and a number it does not, in the same type, at the same
 *   size, in the same viewport.
 *
 * OWN-WORLD: an Admiralty-style hydrographic chart fused with audit
 *   working-paper notation. Bounded plates with a neat line and a title block;
 *   bathymetric tints running shoal-to-deep down every field; contour hatching
 *   as texture; dot leaders binding label to value; tabular figures throughout;
 *   uppercase tracked designations at 0.6875rem/+0.06em. Playfair Display for
 *   plate titles and headings, Manrope for everything else. One warm accent,
 *   used only on a primary action, in a palette that is otherwise cold water.
 *
 * STORY: the analyst arrives, reads a record header rather than a slogan, sees
 *   three corroborated measurements beside one disputed price, understands
 *   within seconds that this page's job is to say which numbers hold, walks the
 *   survey, reaches the evidence band where the disagreement is printed in
 *   full, and requests access.
 *
 * FIRST VIEWPORT: record line (subject · location · data date · sheet), then
 *   the wordmark decoding once, then the plate — coast maquette above four
 *   soundings, the fourth enclosed in a dashed amber field because its survey
 *   is not to be relied on. Primary action sits below the plate, left.
 *
 * FORM: chart plate, first of seven candidate systems from the audience's own
 *   world (chart · cadastral extract · audit working paper · scientific plate ·
 *   terminal · drawing set · broadsheet-as-rut). Chosen without a concept-seed
 *   roll: the brief pins the tension to resolve, the palette, and the type
 *   stack, and a pinned brief beats the roll.
 *
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 *   finish review, the verdict, and DESIGN.md.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## Rendering mode — read HANDOFF/W-INT.md §4 before changing anything here
 *
 * There is deliberately **no `export const dynamic`** in this file. `proxy.ts`
 * emits a per-request `'nonce-…' 'strict-dynamic'` CSP, and a statically
 * prerendered document has no request to take a nonce from, so every script on
 * it is blocked and the page ships rendering correctly with zero working
 * JavaScript. `app/layout.tsx` reads `headers()`, which opts this route out of
 * static generation by default — that is the fix, and it works precisely
 * because nothing here overrides it. Adding `force-static`, `revalidate`, or a
 * `generateStaticParams` that is expected to emit HTML will fail `pnpm qa:csp`.
 */

import type { Metadata } from "next"
import { headers } from "next/headers"
import { getTranslations, setRequestLocale } from "next-intl/server"
import type { ReactNode } from "react"

import { generatedAt, project } from "@/components/azura/landing-data"
import { HeroSection } from "@/app/sections/hero"
import { Footer, Navbar, TopBar } from "@/app/sections/chrome"
import {
  AmenitiesSection,
  DesireSection,
  SiteSection,
  WhySection,
} from "@/app/sections/body"
import { SystemSection } from "@/app/sections/system"
import { ActionSection } from "@/app/sections/close"
import { defaultLocale, locales } from "@/lib/contracts"
import { publicEnv } from "@/lib/env"

const SITE_URL = publicEnv.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3200"

/**
 * `hreflang` correctness, deliberately.
 *
 * Ataberg's audit found the reference competitor de-indexing its own English
 * homepage with a canonical pointing at a different domain, and called it the
 * single highest-ROI fix in that project. The two rules that prevent it:
 * **the canonical is self-referencing** — `/en` declares `/en`, never `/de` —
 * and **every locale appears in `languages`, including the one being rendered**,
 * plus an `x-default` pointing at the default locale.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "landing" })

  const languages: Record<string, string> = {}
  for (const l of locales) languages[l] = `${SITE_URL}/${l}`
  languages["x-default"] = `${SITE_URL}/${defaultLocale}`

  const title = t("hero.title")
  const description = t("hero.subtitle")

  return {
    title,
    description,
    metadataBase: new URL(SITE_URL),
    alternates: { canonical: `${SITE_URL}/${locale}`, languages },
    openGraph: {
      type: "website",
      url: `${SITE_URL}/${locale}`,
      siteName: "Azura World CATI",
      title,
      description,
      locale,
    },
    twitter: { card: "summary_large_image", title, description },
    // A competitor analysis of a live business: indexable, but it must never be
    // mistaken for the subject's own site, which is what `robots.ts` and the
    // footer's rights line handle together.
    robots: { index: true, follow: true },
  }
}

export default async function LandingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  // Next 16: both are Promises (CONVENTIONS §1).
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): Promise<ReactNode> {
  const { locale } = await params
  setRequestLocale(locale)

  // The masterplan deep link, resolved server-side so `?block=B03` renders
  // selected in the HTML and works with JavaScript disabled.
  const blockParam = (await searchParams)["block"]
  const initialBlock = typeof blockParam === "string" ? blockParam : null

  const t = await getTranslations({ locale, namespace: "landing" })

  // The nonce the proxy minted for THIS request. Next stamps its own scripts
  // from the request header; anything we add inline has to carry it explicitly
  // or `strict-dynamic` blocks it.
  const nonce = (await headers()).get("x-nonce")

  /**
   * JSON-LD describes the *analysis*, not the property.
   *
   * Marking this page up as a `Residence` or an `Offer` would tell a search
   * engine that we are selling apartments in Türkler — which is false, and
   * which is exactly the impersonation the media-rights line forbids. It is a
   * `Dataset`: what it covers, when it was gathered, and who published it.
   */
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `${t("hero.title")} — ${t("topBar.notice")}`,
    description: t("evidenceBand.lead"),
    url: `${SITE_URL}/${locale}`,
    inLanguage: locale,
    dateModified: generatedAt,
    isAccessibleForFree: true,
    creator: { "@type": "Organization", name: "Azura World CATI" },
    about: {
      "@type": "Place",
      name: project.name,
      address: {
        "@type": "PostalAddress",
        addressLocality: project.city,
        addressRegion: project.province,
        addressCountry: "TR",
      },
    },
  }

  return (
    <>
      {/* Skip link first in the tab order — the page is long and the nav is
          sticky, so a keyboard user without one pays for every section. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-primary focus:px-5 focus:py-3 focus:text-primary-foreground"
      >
        {t("skipToContent")}
      </a>

      <TopBar locale={locale} />
      <Navbar locale={locale} />

      <main id="main">
        <HeroSection locale={locale} />
        <div className="mx-auto w-full max-w-[72rem] px-5 sm:px-8">
          <WhySection locale={locale} />
          <SiteSection locale={locale} initialBlock={initialBlock} />
          <AmenitiesSection locale={locale} />
          <DesireSection locale={locale} />
          {/* The complex, then the system that runs it, then the way in.
              PIVOT.md added this section and removed four: the evidence band,
              and the three closers that framed the page as a research report
              ("Der öffentliche Report enthält dieselben Zahlen mit denselben
              Quellen", "Eine Zahl ohne Quelle ist eine Behauptung"). */}
          <SystemSection locale={locale} />
          <ActionSection locale={locale} />
        </div>
      </main>

      <Footer locale={locale} />

      <script
        type="application/ld+json"
        {...(nonce === null ? {} : { nonce })}
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  )
}
