/**
 * The survey body: what it is, the site, the amenity gap, the hotel.  Owner: W3-A
 *
 * Interest → Search → Search → Desire in the AISDALSLove ordering. Four
 * sections in one file: they share the same row grammar and the same imports,
 * and four files of six lines each would be filing rather than structure.
 *
 * Every figure below is a `ProvenanceValue`. There is no formatted number in
 * this file — a digit outside a provenance component would be a fact without a
 * source, which is the one defect this project treats as disqualifying.
 */

import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"

import { Masterplan } from "@/components/azura/masterplan"
import type { MasterplanLabels } from "@/components/azura/masterplan"
import { Container, FactRow, Section } from "@/components/azura/section"
import { SNAPSHOT_BASE_PATH } from "@/components/azura/labels"
import { ProvenanceValue } from "@/components/evidence/provenance-value"
import type { ProvenanceLabels } from "@/components/evidence/provenance-value"
import { Reveal } from "@/components/anim/reveal"
import {
  amenitiesAvailable,
  blocks,
  hotel,
  project,
} from "@/components/azura/landing-data"

type SectionProps = { locale: string; provenance: ProvenanceLabels }

// ---------------------------------------------------------------------------
// Interest — what Azura World is
// ---------------------------------------------------------------------------

export async function WhySection({
  locale,
  provenance,
}: SectionProps): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing" })
  const sourceCount = (n: number): string => t("sourceCount", { count: n })

  const value = (
    fact: Parameters<typeof ProvenanceValue>[0]["fact"],
    format: "number" | "area" | "text" | "date" | "percent"
  ): ReactNode => (
    <ProvenanceValue
      fact={fact}
      format={format}
      locale={locale}
      labels={provenance}
      snapshotBasePath={SNAPSHOT_BASE_PATH}
    />
  )

  return (
    <Section
      id="what"
      designation={t("designation.interest")}
      title={t("why.title")}
      lead={t("why.lead", { developer: "Cebeci Group", district: "Türkler" })}
    >
      <Container className="px-0 sm:px-0">
        <div className="grid gap-x-14 gap-y-0 lg:grid-cols-2">
          <div className="min-w-0">
            <FactRow
              label={t("why.developerLabel")}
              value={value(project.developer, "text")}
              note={sourceCount(project.developer.sources.length)}
            />
            <FactRow
              label={t("why.plotLabel")}
              value={value(project.plotAreaSqm, "area")}
              note={sourceCount(project.plotAreaSqm.sources.length)}
            />
            <FactRow
              label={t("why.greenLabel")}
              value={value(project.greenAreaSqm, "area")}
              note={sourceCount(project.greenAreaSqm.sources.length)}
            />
            <FactRow
              label={t("why.footprintLabel")}
              value={value(project.buildingFootprintSqm, "area")}
              note={sourceCount(project.buildingFootprintSqm.sources.length)}
            />
            <FactRow
              label={t("why.outdoorLabel")}
              value={value(project.outdoorFacilityAreaSqm, "area")}
              note={sourceCount(project.outdoorFacilityAreaSqm.sources.length)}
            />
            <FactRow
              label={t("why.blocksLabel")}
              value={value(project.residenceBlockCount, "number")}
              note={sourceCount(project.residenceBlockCount.sources.length)}
            />
          </div>
          <div>
            <FactRow
              label={t("why.buildingsLabel")}
              value={value(project.buildingCount, "number")}
              note={sourceCount(project.buildingCount.sources.length)}
            />
            <FactRow
              label={t("why.floorsLabel")}
              value={value(project.floorsPerBuilding, "number")}
              note={sourceCount(project.floorsPerBuilding.sources.length)}
            />
            <FactRow
              label={t("why.startLabel")}
              value={value(project.constructionStart, "date")}
              note={sourceCount(project.constructionStart.sources.length)}
            />
            <FactRow
              label={t("why.timelineLabel")}
              value={value(project.completionDate, "date")}
              note={sourceCount(project.completionDate.sources.length)}
            />
            <FactRow
              label={t("why.statusLabel")}
              value={value(project.buildStatus, "text")}
              note={sourceCount(project.buildStatus.sources.length)}
            />
            <FactRow
              label={t("why.downPaymentLabel")}
              value={value(project.downPaymentPercent, "percent")}
              note={sourceCount(project.downPaymentPercent.sources.length)}
            />
          </div>
        </div>
      </Container>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Search — the site
// ---------------------------------------------------------------------------

export async function SiteSection({
  locale,
  provenance,
  initialBlock,
}: SectionProps & { initialBlock: string | null }): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing" })
  const sourceCount = (n: number): string => t("sourceCount", { count: n })

  const masterplanLabels: MasterplanLabels = {
    blockLabel: t("masterplan.blockLabel"),
    unitsLabel: t("masterplan.unitsLabel"),
    hotelLabel: t("masterplan.hotelLabel"),
    seaLabel: t("masterplan.seaLabel"),
    selectedLabel: t("masterplan.selectedLabel"),
    schematicNote: t("masterplan.schematicNote"),
    quality: t.raw("masterplan.quality") as MasterplanLabels["quality"],
  }

  return (
    <Section
      id="site"
      designation={t("designation.search")}
      title={t("masterplan.title")}
      lead={t("immersion.lead")}
    >
      <Container className="px-0 sm:px-0">
        <div className="grid min-w-0 gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <Masterplan
            blocks={blocks}
            locale={locale}
            labels={masterplanLabels}
            initialBlock={initialBlock}
            hotelRooms={
              <ProvenanceValue
                fact={hotel.roomCount}
                format="number"
                locale={locale}
                labels={provenance}
                snapshotBasePath={SNAPSHOT_BASE_PATH}
              />
            }
          />

          {/* The distances are the most-disputed facts in the whole dataset —
              four of the five carry a conflict badge. They sit next to the plan
              on purpose: "300 m from the sea" is the single claim this category
              of marketing stretches most, and here it argues with itself. */}
          <div>
            <FactRow
              label={t("why.seaLabel")}
              value={
                <ProvenanceValue
                  fact={project.distanceToSeaM}
                  format="metres"
                  locale={locale}
                  labels={provenance}
                  snapshotBasePath={SNAPSHOT_BASE_PATH}
                />
              }
              note={sourceCount(project.distanceToSeaM.sources.length)}
            />
            <FactRow
              label={t("desire.beachLabel")}
              value={
                <ProvenanceValue
                  fact={hotel.distanceToBeachM}
                  format="metres"
                  locale={locale}
                  labels={provenance}
                  snapshotBasePath={SNAPSHOT_BASE_PATH}
                />
              }
              note={sourceCount(hotel.distanceToBeachM.sources.length)}
            />
            <FactRow
              label={t("why.centreLabel")}
              value={
                <ProvenanceValue
                  fact={project.distanceToAlanyaCentreKm}
                  format="kilometres"
                  locale={locale}
                  labels={provenance}
                  snapshotBasePath={SNAPSHOT_BASE_PATH}
                />
              }
              note={sourceCount(
                project.distanceToAlanyaCentreKm.sources.length
              )}
            />
            <FactRow
              label={t("why.airportLabel")}
              value={
                <ProvenanceValue
                  fact={project.distanceToGazipasaAirportKm}
                  format="kilometres"
                  locale={locale}
                  labels={provenance}
                  snapshotBasePath={SNAPSHOT_BASE_PATH}
                />
              }
              note={sourceCount(
                project.distanceToGazipasaAirportKm.sources.length
              )}
            />
            <FactRow
              label={t("why.locationLabel")}
              value={
                <ProvenanceValue
                  fact={project.distanceToAntalyaAirportKm}
                  format="kilometres"
                  locale={locale}
                  labels={provenance}
                  snapshotBasePath={SNAPSHOT_BASE_PATH}
                />
              }
              note={sourceCount(
                project.distanceToAntalyaAirportKm.sources.length
              )}
            />
          </div>
        </div>
      </Container>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Search — the amenity gap
// ---------------------------------------------------------------------------

/**
 * The section the brief asks for is "an amenity grid from the dataset, each
 * item attributed to the source that lists it". **The dataset carries zero
 * amenities** — the generator emits `AzuraAmenity = never` precisely to record
 * that nothing reaches it.
 *
 * So this renders the empty state, and the empty state is the content. Writing
 * a plausible grid of pools and a fitness suite would take five minutes and
 * would be the exact failure this whole product is built to make visible.
 */
export async function AmenitiesSection({
  locale,
}: {
  locale: string
}): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing" })
  if (amenitiesAvailable) return null

  return (
    <Section
      id="amenities"
      designation={t("designation.search")}
      title={t("amenities.title")}
      lead={t("amenities.lead")}
    >
      <Container className="px-0 sm:px-0">
        <Reveal>
          <div
            className="flex max-w-[62ch] flex-col gap-3 rounded-[var(--radius-sm)] border border-dashed border-[color-mix(in_srgb,var(--confidence-gap)_50%,transparent)] px-5 py-6"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--muted) 55%, transparent)",
            }}
          >
            <p className="font-display text-[1.125rem] leading-[1.3] tracking-[-0.01em]">
              {t("amenities.gapTitle")}
            </p>
            <p className="text-[0.9375rem] leading-[1.6] text-muted-foreground">
              {t("amenities.gapBody")}
            </p>
            <p className="text-[0.8125rem] leading-[1.5] text-[var(--confidence-gap)]">
              {t("amenities.empty")}
            </p>
          </div>
        </Reveal>
      </Container>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Desire — the hotel
// ---------------------------------------------------------------------------

export async function DesireSection({
  locale,
  provenance,
}: SectionProps): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing" })
  const sourceCount = (n: number): string => t("sourceCount", { count: n })

  const value = (
    fact: Parameters<typeof ProvenanceValue>[0]["fact"],
    format: "number" | "text" | "date" | "stars"
  ): ReactNode => (
    <ProvenanceValue
      fact={fact}
      format={format}
      locale={locale}
      labels={provenance}
      snapshotBasePath={SNAPSHOT_BASE_PATH}
    />
  )

  return (
    <Section
      id="hotel"
      designation={t("designation.desire")}
      title={t("desire.title")}
      lead={t("desire.lead")}
    >
      <Container className="px-0 sm:px-0">
        <div className="grid gap-x-14 gap-y-0 lg:grid-cols-2">
          <div className="min-w-0">
            <FactRow
              label={t("desire.starsLabel")}
              value={value(hotel.stars, "stars")}
              note={sourceCount(hotel.stars.sources.length)}
            />
            <FactRow
              label={t("desire.roomsLabel")}
              value={value(hotel.roomCount, "number")}
              note={sourceCount(hotel.roomCount.sources.length)}
            />
            <FactRow
              label={t("desire.boardLabel")}
              value={value(hotel.board, "text")}
              note={sourceCount(hotel.board.sources.length)}
            />
            <FactRow
              label={t("desire.aquaparkLabel")}
              value={value(hotel.aquaparkSlides, "number")}
              note={sourceCount(hotel.aquaparkSlides.sources.length)}
            />
          </div>
          <div>
            <FactRow
              label={t("desire.floorsLabel")}
              value={value(hotel.floors, "number")}
              note={sourceCount(hotel.floors.sources.length)}
            />
            <FactRow
              label={t("desire.openedLabel")}
              value={value(hotel.openedYear, "number")}
              note={sourceCount(hotel.openedYear.sources.length)}
            />
            <FactRow
              label={t("desire.formerLabel")}
              value={value(hotel.formerName, "text")}
              note={sourceCount(hotel.formerName.sources.length)}
            />
            {/* `brandAffiliation` is a `gap`: the value is null and it renders
                as an em dash with "not established". A 5★ hotel that used to be
                a Wyndham and no longer states a chain is exactly the kind of
                absence this page exists to show rather than tidy away. */}
            <FactRow
              label={t("desire.brandLabel")}
              value={value(hotel.brandAffiliation, "text")}
              note={sourceCount(hotel.brandAffiliation.sources.length)}
            />
          </div>
        </div>
      </Container>
    </Section>
  )
}
