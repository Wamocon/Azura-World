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
import { cookies, headers } from "next/headers"
import { hasLocale } from "next-intl"
import { getTranslations, setRequestLocale } from "next-intl/server"
import type { ReactNode } from "react"

import { generatedAt, project } from "@/components/azura/landing-data"
import { HeroSection } from "@/app/sections/hero"
import { Footer, Navbar } from "@/app/sections/chrome"
import {
  AmenitiesSection,
  DesireSection,
  WhySection,
} from "@/app/sections/body"
import { CinemaSection } from "@/app/sections/cinema"
import { SystemSection } from "@/app/sections/system"
import { SystemFlowSection } from "@/app/sections/system-flow"
import { ResidencesSection } from "@/app/sections/residences-section"
import { SiteModelSection } from "@/components/azura/site-model-section"
import { ConciergeDock } from "@/components/azura/concierge-dock"
import { ActionSection } from "@/app/sections/close"
import { LandingChoreography } from "@/components/anim/landing-choreography"
import { LenisProvider } from "@/components/providers/lenis-provider"
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
}: {
  params: Promise<{ locale: string }>
}): Promise<ReactNode> {
  const { locale } = await params
  setRequestLocale(locale)

  // `locale` arrives as a route param and is therefore a plain string. The
  // concierge takes the narrowed union, so it is validated here rather than
  // cast away at the call site.
  const conciergeLocale = hasLocale(locales, locale) ? locale : defaultLocale

  // The light/dark surface preference, read server-side so the first paint
  // already matches the user's last choice and there is no theme flash. The
  // toggle (`SurfaceToggle`) writes this cookie; night is the default.
  const surface =
    (await cookies()).get("azura-surface")?.value === "day" ? "day" : "night"

  const t = await getTranslations({ locale, namespace: "landing" })

  // The nonce the proxy minted for THIS request. Next stamps its own scripts
  // from the request header; anything we add inline has to carry it explicitly
  // or `strict-dynamic` blocks it.
  //
  // Reading `headers()` is also what keeps this route out of static generation,
  // which `app/layout.tsx` explains at length is the whole reason the
  // per-request nonce works at all.
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
    name: `${t("hero.title")} · ${t("topBar.notice")}`,
    // `evidenceBand.lead` stood here and that namespace has not existed since
    // PIVOT.md removed the evidence band. next-intl throws `MISSING_MESSAGE`
    // rather than returning a placeholder, so every render of this route logged
    // a server error and the structured data was emitted with the key name
    // where the description should be. `hero.subtitle` is the same string the
    // `<meta name="description">` already uses, which is what a `Dataset`
    // description should agree with anyway.
    description: t("hero.subtitle"),
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

      {/* ═══════════════════════════════════════════════════════════════
          The night surface.

          `data-surface="night"` re-declares the token set inside this subtree
          and nowhere else (globals.css §"NIGHT SURFACE"). Everything below
          keeps reading `var(--foreground)` and comes out correct without
          knowing it moved, and `/dashboard` keeps the daylight theme a
          property manager actually reads a hundred rows in.

          Lenis wraps the surface rather than the app: smooth scroll is a
          marketing-surface behaviour, and it declines to mount at all under
          reduced motion, at which point the browser's native scroll is the
          correct answer. `LandingChoreography` renders nothing — it is the
          single GSAP context for the whole route.
          ═══════════════════════════════════════════════════════════════ */}
      <LenisProvider>
        <div
          id="landing-surface"
          data-surface={surface}
          className="relative min-h-dvh"
        >
          {/* Reading progress. Fixed, hairline, and `aria-hidden`: it is a
              second rendering of the scrollbar, which every assistive
              technology already exposes. Sits behind the chrome's z-40. */}
          <div
            aria-hidden="true"
            className="pointer-events-none fixed top-0 left-0 z-30 hidden h-dvh w-px bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)] lg:block"
          >
            <span
              data-rail
              className="block h-full w-full origin-top scale-y-0 bg-[linear-gradient(to_bottom,var(--primary),var(--accent))]"
            />
          </div>

          <Navbar locale={locale} surface={surface} />

          <main id="main">
            {/* Hero and walk-through are full-bleed and own their own width.
                Everything after them shares the 72rem measure. */}
            <HeroSection locale={locale} />
            <CinemaSection locale={locale} />

            <div className="mx-auto w-full max-w-[72rem] px-5 sm:px-8">
              <WhySection locale={locale} />
              {/* The site plan is shown once, alive: the 3D drawing with a day
                  of operations running across it. The old flat block grid that
                  sat here was a weaker second masterplan; its location facts now
                  live in WhySection, where the figures belong. */}
              <SiteModelSection locale={locale} />
              {/* The offer by shape: five layouts, how many of each, the typical
                  home in each, and a gallery of the residence interiors. The
                  searchable 656-row table that sat here moved off the sales
                  landing to the dashboard, where a manager actually works. */}
              <ResidencesSection locale={locale} />
              <AmenitiesSection locale={locale} />
              <DesireSection locale={locale} />
              {/* The complex, then the system that runs it, then the way in.
                  PIVOT.md added the system section and removed four: the
                  evidence band, and the three closers that framed the page as a
                  research report. */}
              <SystemSection locale={locale} />
              {/* The system shown working: counted figures, then the ticket
                  lifecycle as one track. The 1Çatı-style operating showcase. */}
              <SystemFlowSection locale={locale} />
            </div>

            {/* The close is full-bleed for the same reason the hero is: the
                page opens and ends on a photograph, and the ask sits on it. */}
            <ActionSection locale={locale} />
          </main>

          <Footer locale={locale} />

          {/* The assistant. It has worked since W3-H against a live gateway and
              was reachable from one unlinked URL, which is why it read as
              missing. Mounted last so it docks above everything without
              entering the page's flow. */}
          <ConciergeDock locale={conciergeLocale} />
          <LandingChoreography />
        </div>
      </LenisProvider>

      {/* `suppressHydrationWarning` is load-bearing, and the reason is subtle.
       *
       * Without it this element logged on every single load of the route:
       * server HTML said `nonce="58zrQ2fEXG…"`, the client DOM said `nonce=""`,
       * and React reported "a tree hydrated but some attributes of the server
       * rendered HTML didn't match" and stopped patching the subtree. Read off
       * the Next.js dev overlay, which pointed straight at this tag.
       *
       * The cause is *nonce hiding*, a browser security feature rather than a
       * bug: once the document is parsed the browser clears the `nonce` content
       * attribute and keeps the value only on the `.nonce` IDL property, so a
       * script cannot exfiltrate the nonce by reading the DOM. React hydrates
       * against the content attribute, which is by then empty, so ANY
       * server-rendered `nonce` mismatches by construction.
       *
       * The obvious fix — drop the nonce, since `application/ld+json` is a data
       * block that the HTML spec never executes and `script-src` never governs —
       * is wrong here for a concrete reason: `scripts/csp-probe.mjs` asserts
       * that EVERY script tag on the page carries the response nonce, because
       * one unnonced script is the signature of S-009, the bug that shipped
       * pages with zero working JavaScript for a night. Weakening a gate that
       * catches a real outage, to silence a warning, is a bad trade.
       *
       * So the nonce stays and React is told not to diff this one element.
       * That is exactly what `suppressHydrationWarning` is for: an attribute the
       * browser itself is known to rewrite after parse. */}
      <script
        type="application/ld+json"
        suppressHydrationWarning
        {...(nonce === null ? {} : { nonce })}
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  )
}
