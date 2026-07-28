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
import { Plate, RecordLine, Sounding } from "@/components/azura/chart"
import { Container } from "@/components/azura/section"
import { SNAPSHOT_BASE_PATH } from "@/components/azura/labels"
import { ProvenanceValue } from "@/components/evidence/provenance-value"
import type { ProvenanceLabels } from "@/components/evidence/provenance-value"
import { CoastMaquette } from "@/components/three/coast-maquette"
import { Link } from "@/app/navigation"
import {
  entryPriceFact,
  generatedAt,
  project,
} from "@/components/azura/landing-data"

export async function HeroSection({
  locale,
  provenance,
}: {
  locale: string
  provenance: ProvenanceLabels
}): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing" })
  const dataDate = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(generatedAt))

  const sourceCount = (n: number): string => t("sourceCount", { count: n })

  return (
    <section id="top" className="pt-6 pb-14 sm:pt-10 sm:pb-20">
      <Container className="flex flex-col gap-8">
        <RecordLine
          items={[
            { label: t("record.idLabel"), value: project.code },
            { label: t("record.placeLabel"), value: t("hero.eyebrow") },
            { label: t("record.dataLabel"), value: dataDate },
            { label: t("record.sheetLabel"), value: t("record.sheetValue") },
          ]}
        />

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

        <Plate
          title={t("hero.plateTitle")}
          meta={`${t("record.dataLabel")} ${dataDate}`}
        >
          {/* Height is capped, not left to the component's own 400/260. The
              four soundings under it ARE the first viewport's argument; a
              maquette that pushes them below the fold turns the thesis into
              decoration and the page into the brochure it refuses to be. */}
          <CoastMaquette
            posterLabel={t("hero.posterAlt")}
            className="aspect-auto h-[190px] border-0 sm:h-[240px] lg:h-[290px]"
          />

          {/* The soundings. Four figures over the water, the way a chart prints
              depths — and the fourth is enclosed because its survey is not to
              be relied upon. */}
          <div className="relative grid grid-cols-2 border-t border-[color-mix(in_srgb,var(--sea-mid)_24%,transparent)] lg:grid-cols-4">
            <Sounding
              label={t("hero.figures.area")}
              note={sourceCount(project.plotAreaSqm.sources.length)}
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
              note={sourceCount(project.residenceBlockCount.sources.length)}
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
              note={sourceCount(project.totalUnits.sources.length)}
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
        </Plate>

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
