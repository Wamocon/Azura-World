/**
 * The survey body: what it is, the site, the amenity gap, the hotel.  Owner: W3-A
 *
 * Interest → Search → Search → Desire in the AISDALSLove ordering. Four
 * sections in one file: they share the same row grammar and the same imports,
 * and four files of six lines each would be filing rather than structure.
 *
 * Every figure below is an `InventoryValue`: the client's own inventory,
 * formatted and nothing else.
 *
 * It used to be a `ProvenanceValue` with an `n Quellen` caption under each one,
 * and the rule in this comment was that a digit outside a provenance component
 * would be a fact without a source. That rule was right for a competitor
 * dossier and PIVOT.md, 29 July, retired it: the reader is now Azura World's
 * own management, and a source chip under "656 Wohnungen" answers a question
 * they are not asking about a building they own.
 *
 * The facts are still `SourcedFact`s and the sources are still in the data.
 * PIVOT §5 is deliberate about that — pass one removes what the client sees and
 * leaves the types compiling; pass two unwraps them after the pitch.
 */

import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"

import { Masterplan } from "@/components/azura/masterplan"
import type { MasterplanLabels } from "@/components/azura/masterplan"
import { Container, FactRow, Section } from "@/components/azura/section"
import { InventoryValue } from "@/components/azura/inventory-value"
import { Reveal } from "@/components/anim/reveal"
import { ActCredit, ActMedia } from "@/components/journey/act-media"
import { imagesForAct } from "@/lib/journey-media"
import { cn } from "@/lib/cn"
import { blocks, hotel, project } from "@/components/azura/landing-data"

type SectionProps = { locale: string }

// ---------------------------------------------------------------------------
// Interest — what Azura World is
// ---------------------------------------------------------------------------

export async function WhySection({ locale }: SectionProps): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing" })
  const gapLabel = t("provenance.gap")

  const value = (
    fact: Parameters<typeof InventoryValue>[0]["fact"],
    format: "number" | "area" | "text" | "date" | "percent"
  ): ReactNode => (
    <InventoryValue
      fact={fact}
      format={format}
      locale={locale}
      gapLabel={gapLabel}
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
            />
            <FactRow
              label={t("why.plotLabel")}
              value={value(project.plotAreaSqm, "area")}
            />
            <FactRow
              label={t("why.greenLabel")}
              value={value(project.greenAreaSqm, "area")}
            />
            <FactRow
              label={t("why.footprintLabel")}
              value={value(project.buildingFootprintSqm, "area")}
            />
            <FactRow
              label={t("why.outdoorLabel")}
              value={value(project.outdoorFacilityAreaSqm, "area")}
            />
            <FactRow
              label={t("why.blocksLabel")}
              value={value(project.residenceBlockCount, "number")}
            />
          </div>
          <div>
            <FactRow
              label={t("why.buildingsLabel")}
              value={value(project.buildingCount, "number")}
            />
            <FactRow
              label={t("why.floorsLabel")}
              value={value(project.floorsPerBuilding, "number")}
            />
            <FactRow
              label={t("why.startLabel")}
              value={value(project.constructionStart, "date")}
            />
            <FactRow
              label={t("why.timelineLabel")}
              value={value(project.completionDate, "date")}
            />
            <FactRow
              label={t("why.statusLabel")}
              value={value(project.buildStatus, "text")}
            />
            <FactRow
              label={t("why.downPaymentLabel")}
              value={value(project.downPaymentPercent, "percent")}
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
  initialBlock,
}: SectionProps & { initialBlock: string | null }): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing" })
  const gapLabel = t("provenance.gap")

  const masterplanLabels: MasterplanLabels = {
    blockLabel: t("masterplan.blockLabel"),
    unitsLabel: t("masterplan.unitsLabel"),
    hotelLabel: t("masterplan.hotelLabel"),
    seaLabel: t("masterplan.seaLabel"),
    selectedLabel: t("masterplan.selectedLabel"),
    schematicNote: t("masterplan.schematicNote"),
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
              <InventoryValue
                fact={hotel.roomCount}
                format="number"
                locale={locale}
                gapLabel={gapLabel}
              />
            }
          />

          {/* The distances sit next to the plan because that is where a reader
              looks for them: how far to the sea, the beach, Alanya, the
              airport.

              This comment used to say four of the five carried a conflict badge
              and that "300 m from the sea" argued with itself on the page. The
              badges are gone with the rest of the evidence layer, so the claim
              is no longer true of what renders and would have become one of
              those comments that describes an older version of the file. */}
          <div>
            <FactRow
              label={t("why.seaLabel")}
              value={
                <InventoryValue
                  fact={project.distanceToSeaM}
                  format="metres"
                  locale={locale}
                  gapLabel={gapLabel}
                />
              }
            />
            <FactRow
              label={t("desire.beachLabel")}
              value={
                <InventoryValue
                  fact={hotel.distanceToBeachM}
                  format="metres"
                  locale={locale}
                  gapLabel={gapLabel}
                />
              }
            />
            <FactRow
              label={t("why.centreLabel")}
              value={
                <InventoryValue
                  fact={project.distanceToAlanyaCentreKm}
                  format="kilometres"
                  locale={locale}
                  gapLabel={gapLabel}
                />
              }
            />
            <FactRow
              label={t("why.airportLabel")}
              value={
                <InventoryValue
                  fact={project.distanceToGazipasaAirportKm}
                  format="kilometres"
                  locale={locale}
                  gapLabel={gapLabel}
                />
              }
            />
            <FactRow
              label={t("why.locationLabel")}
              value={
                <InventoryValue
                  fact={project.distanceToAntalyaAirportKm}
                  format="kilometres"
                  locale={locale}
                  gapLabel={gapLabel}
                />
              }
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
  const grounds = imagesForAct("grounds")
  if (grounds.length === 0) return null

  return (
    <Section
      id="amenities"
      designation={t("designation.search")}
      title={t("amenities.title")}
      lead={t("amenities.lead")}
    >
      <Container className="px-0 sm:px-0">
        <Reveal>
          {/* Six photographs of the grounds. What stood here was a dashed
              panel reading "Keine belegte Ausstattungsliste. Aus 60 abgerufenen
              Quellen liess sich keine Ausstattungsliste gewinnen" - a research
              gap notice, rendered on a page that is meant to sell the client
              their own grounds back to them.

              W-CINEMA §8 filed it as "amenities section renders empty though 35
              amenity images exist", and PIVOT §4 removes the framing that made
              an absent *list* worth a panel at all. The pools and the aquapark
              are not a claim needing a citation. They are photographs of the
              place, and the place is the client's.

              The first image is wide, the rest are a grid. Nothing here is
              eager: the hero owns the LCP and every act below it waits for its
              own viewport. */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            {grounds.map((image, index) => (
              <figure
                key={image.id}
                data-slot="amenity"
                className={cn(
                  "relative m-0 overflow-hidden rounded-xl border border-border/60 bg-[#0a1216]",
                  index === 0 && "col-span-2 lg:col-span-2 lg:row-span-2"
                )}
                style={{ aspectRatio: index === 0 ? "16 / 10" : "4 / 3" }}
              >
                <ActMedia
                  image={image}
                  layout="tile"
                  alt={t("amenities.imageAlt")}
                  className="[&_img]:contrast-[1.04] [&_img]:saturate-[1.06]"
                />
              </figure>
            ))}
          </div>
          <ActCredit
            images={grounds}
            label={t("hero.creditLabel")}
            staleLabel={t("hero.creditStale")}
            className="mt-3 text-muted-foreground"
          />
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
}: SectionProps): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing" })
  const gapLabel = t("provenance.gap")

  const value = (
    fact: Parameters<typeof InventoryValue>[0]["fact"],
    format: "number" | "text" | "date" | "stars"
  ): ReactNode => (
    <InventoryValue
      fact={fact}
      format={format}
      locale={locale}
      gapLabel={gapLabel}
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
            />
            <FactRow
              label={t("desire.roomsLabel")}
              value={value(hotel.roomCount, "number")}
            />
            <FactRow
              label={t("desire.boardLabel")}
              value={value(hotel.board, "text")}
            />
            <FactRow
              label={t("desire.aquaparkLabel")}
              value={value(hotel.aquaparkSlides, "number")}
            />
          </div>
          <div>
            <FactRow
              label={t("desire.floorsLabel")}
              value={value(hotel.floors, "number")}
            />
            <FactRow
              label={t("desire.openedLabel")}
              value={value(hotel.openedYear, "number")}
            />
            <FactRow
              label={t("desire.formerLabel")}
              value={value(hotel.formerName, "text")}
            />
            {/* `brandAffiliation` is a `gap`: the value is null and it renders
                as an em dash with "not established". A 5★ hotel that used to be
                a Wyndham and no longer states a chain is exactly the kind of
                absence this page exists to show rather than tidy away. */}
            <FactRow
              label={t("desire.brandLabel")}
              value={value(hotel.brandAffiliation, "text")}
            />
          </div>
        </div>
      </Container>
    </Section>
  )
}
