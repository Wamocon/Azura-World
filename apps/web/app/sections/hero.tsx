/**
 * Hero — Attention.                                                  Owner: W3-A
 *
 * The thesis viewport. Four figures on one plate: three the sources agree on
 * and one they do not, printed in the same type, at the same size, in the same
 * place. A visitor who leaves after this viewport should be able to say a day
 * later that "it showed me a number it trusted and a number it didn't, next to
 * each other" — that is the memory test, and it is the whole product in one
 * frame.
 *
 * The 3D coast maquette is decoration in the strict sense: every fact in this
 * section is DOM, and the canvas can fail entirely without the viewport losing
 * a single number. It carries W1-D's guards — lazy behind an IntersectionObserver,
 * poster on no-WebGL, reduced motion or a low device tier, DPR capped, disposed
 * on unmount — so "no WebGL yields a poster" is inherited rather than reimplemented.
 */

import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"

import { ScrambleText } from "@/components/anim/scramble-text"
import { Sounding } from "@/components/azura/chart"
import { Container } from "@/components/azura/section"
import { SNAPSHOT_BASE_PATH } from "@/components/azura/labels"
import { ProvenanceValue } from "@/components/evidence/provenance-value"
import type { ProvenanceLabels } from "@/components/evidence/provenance-value"
import { ActMedia, ActCredit } from "@/components/journey/act-media"
import { imagesForAct } from "@/lib/journey-media"
import { Link } from "@/app/navigation"
import { entryPriceFact, project } from "@/components/azura/landing-data"

export async function HeroSection({
  locale,
  provenance,
}: {
  locale: string
  provenance: ProvenanceLabels
}): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing" })
  // The establishing frame. `approach[0]` is the dusk pool reflection, cast by
  // hand in `scripts/publish-journey-media.mjs` after looking at the contact
  // sheet rather than by a width sort.
  const approach = imagesForAct("approach")
  const heroImage = approach[0]

  return (
    <section id="top" className="pt-6 pb-14 sm:pt-10 sm:pb-20">
      <Container className="flex flex-col gap-8">
        {/* The record line that stood here - Objekt AZW-TRK, Blatt 1 von 1,
            Datenstand - has been removed. It framed a public marketing surface
            as an internal survey document, and it was the first thing a visitor
            read. The data date now belongs to the evidence section, which is
            where a reader who wants provenance goes looking; the dashboard
            cockpit carries the rest. Nothing was lost, it moved. */}

        <div className="flex flex-col gap-5">
          {/* The one scramble on the page. Under reduced motion the component
              renders the final string and never a partial frame. */}
          <h1 className="font-display text-[clamp(2.2rem,7vw,4.5rem)] leading-[1.04] tracking-[-0.03em] text-balance">
            <ScrambleText text={t("hero.title")} />
          </h1>
          <p className="max-w-[52ch] text-[1.0625rem] leading-[1.6] text-muted-foreground sm:text-[1.125rem]">
            {t("hero.subtitle")}
          </p>
        </div>

        {/* The plate title and its "Datenstand ." meta are gone with the record
            line: a titled plate with a data date is document furniture, and the
            brief is explicit that the evidence belongs in ONE section rather
            than stamped above the fold.

            What replaces it is the thing the page was missing entirely - a
            photograph. This frame is the complex mirrored in its own pool at
            dusk, and it is the strongest asset in a 889-image harvest. It is
            the ONLY eagerly-loaded image on the route; every other act waits
            for its viewport, which is what keeps it off the LCP path.
 */}
        {/* The frame is its OWN band, not a backdrop for content designed
            against a light page. The first composition layered the four
            soundings and the maquette over the photograph and both became
            unreadable: dark type on a dusk photograph, and procedural teal
            geometry sitting on top of a real building like a glitch. Measured
            by looking at it.

            So the photograph gets the full width and nothing sits on it except
            its own credit, over a gradient sized to guarantee contrast. The
            soundings return to the page background below, where they were
            legible, and the maquette moves out of the frame entirely - it
            belongs to the site section, where the camera has room to move. */}
        <figure className="relative isolate m-0 overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--sea-mid)_22%,transparent)] bg-[#0a1216]">
          <div className="relative aspect-[21/9] w-full">
            {heroImage !== undefined ? (
              <ActMedia
                image={heroImage}
                priority
                alt={t("hero.posterAlt")}
                className="[&_img]:scale-[1.03] [&_img]:saturate-[1.06] [&_img]:contrast-[1.04]"
              />
            ) : null}
            {/* Vignette and base gradient. Clear centre to dark edges, so the
                type over it holds contrast wherever the photograph is bright.
                `pointer-events-none` so it never eats a click. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_85%_at_50%_18%,transparent_38%,rgba(6,14,18,0.55)_78%,rgba(6,14,18,0.92)_100%)]"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#060e12] via-[#060e12]/70 to-transparent"
            />
          </div>

          {/* Visible, never hover-only. MEDIA-LICENSE.md: every displayed asset
              carries its source, and a credit behind a mouse hover is invisible
              to touch and to a screen reader. */}
          {heroImage !== undefined ? (
            <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#060e12]/85 to-transparent px-4 pt-10 pb-3">
              <ActCredit
                images={[heroImage]}
                label={t("hero.creditLabel")}
                staleLabel={t("hero.creditStale")}
              />
            </figcaption>
          ) : null}
        </figure>

        {/* The soundings, back on the page background. Four figures, and the
            fourth is enclosed because its survey is not to be relied upon. */}
        <div className="relative grid grid-cols-2 rounded-xl border border-[color-mix(in_srgb,var(--sea-mid)_24%,transparent)] lg:grid-cols-4">
            <Sounding
              label={t("hero.figures.area")}
              className="border-r border-b border-[color-mix(in_srgb,var(--sea-mid)_18%,transparent)] lg:border-b-0"
            >
              <ProvenanceValue
                fact={project.plotAreaSqm}
                format="area"
                locale={locale}
                labels={provenance}
                snapshotBasePath={SNAPSHOT_BASE_PATH}
              />
            </Sounding>

            <Sounding
              label={t("hero.figures.blocks")}
              className="border-b border-[color-mix(in_srgb,var(--sea-mid)_18%,transparent)] lg:border-r lg:border-b-0"
            >
              <ProvenanceValue
                fact={project.residenceBlockCount}
                format="number"
                locale={locale}
                labels={provenance}
                snapshotBasePath={SNAPSHOT_BASE_PATH}
              />
            </Sounding>

            <Sounding
              label={t("hero.figures.units")}
              className="border-r border-[color-mix(in_srgb,var(--sea-mid)_18%,transparent)]"
            >
              <ProvenanceValue
                fact={project.totalUnits}
                format="number"
                locale={locale}
                labels={provenance}
                snapshotBasePath={SNAPSHOT_BASE_PATH}
              />
            </Sounding>

            {entryPriceFact !== null ? (
              <Sounding
                label={t("hero.figures.entryPrice")}
                emphasis="conflict"
                note={t("hero.entryPriceNote")}
              >
                <ProvenanceValue
                  fact={entryPriceFact}
                  format="money"
                  locale={locale}
                  labels={provenance}
                  snapshotBasePath={SNAPSHOT_BASE_PATH}
                />
              </Sounding>
            ) : null}
          </div>

        <p className="max-w-[60ch] text-[0.9375rem] leading-[1.6] text-muted-foreground">
          {t("hero.conflictCallout")}
        </p>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Link
            href="/#evidence"
            className="azura-tap inline-flex items-center rounded-full bg-accent px-6 text-[0.9375rem] font-semibold text-accent-foreground transition-transform duration-[var(--duration-instant)] ease-[var(--ease-out)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] active:scale-[0.97]"
          >
            {t("hero.ctaPrimary")}
          </Link>
          <Link
            href="/#site"
            className="azura-tap inline-flex items-center text-[0.9375rem] font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            {t("hero.ctaSecondary")}
          </Link>
        </div>
      </Container>
    </section>
  )
}
