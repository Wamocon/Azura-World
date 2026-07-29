/**
 * The body: what it is, the site, the grounds, the hotel.            Owner: W3-A
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
 *
 * ## What the night rebuild changed
 *
 * Nothing about the data and everything about the arrangement. Two of these
 * four sections were a heading, a lead, and then two columns of dot-leader rows
 * running to the bottom of the viewport with no other element in them — twelve
 * rows of grey label and black figure, twice, on a cream ground. It scanned as
 * a specification sheet because it was one.
 *
 * The rows are unchanged. What is around them is not: figures now sit in a
 * panel with a photograph beside them at a different scroll rate, so the eye
 * has somewhere to rest between reading a number and reading the next one. The
 * amenity grid, which was six equal thumbnails, became an editorial set with
 * one dominant frame — six things the same size is a contact sheet, and a
 * contact sheet is what you send a client before you have made a decision.
 */

import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"

import { Masterplan } from "@/components/azura/masterplan"
import type { MasterplanLabels } from "@/components/azura/masterplan"
import { Container, FactRow, Panel, Section } from "@/components/azura/section"
import { InventoryValue } from "@/components/azura/inventory-value"
import { ActCredit, mediaKindKey } from "@/components/journey/act-media"
import { cast } from "@/components/journey/cast"
import { Plate } from "@/components/journey/plate"
import type { JourneyImage } from "@/lib/journey-media"
import { blocks, hotel, project } from "@/components/azura/landing-data"

type SectionProps = { locale: string }

type Translator = Awaited<ReturnType<typeof getTranslations>>

/**
 * The visible "this is a render / this is a floor plan" chip, resolved.
 *
 * Six of the twenty-two published assets are the developer's marketing
 * visualisations. Showing one as a photograph of the finished building is a
 * claim about the building, so every `Plate` gets this and photographs get
 * `null`, which renders nothing.
 */
function kindLabel(t: Translator, image: JourneyImage): string | null {
  const key = mediaKindKey(image)
  return key === null ? null : t(`mediaKind.${key}`)
}

// ---------------------------------------------------------------------------
// Interest — what Azura World is
// ---------------------------------------------------------------------------

export async function WhySection({ locale }: SectionProps): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing" })
  const gapLabel = t("provenance.gap")

  const plateImage = cast.whyPlate

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
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-12">
          {/* One grid, not two hand-balanced columns, and no panel around it.
              The tiles carry their own edges, so the halves that used to keep
              the dot-leader rows apart were splitting one set of facts into two
              stacks that had to be filled evenly by hand — and a bordered panel
              full of bordered tiles is a box in a box. */}
          <div className="grid gap-3 sm:grid-cols-2">
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
                  value={value(
                    // "completed" is a database enum. A property manager reads
                    // "Fertiggestellt". Translate the value and keep the fact
                    // wrapper, so the row renders like every other one.
                    {
                      ...project.buildStatus,
                      value:
                        typeof project.buildStatus.value === "string"
                          ? t(`why.status.${project.buildStatus.value}`)
                          : project.buildStatus.value,
                    },
                    "text",
                  )}
                />
                <FactRow
                  label={t("why.downPaymentLabel")}
                  value={value(project.downPaymentPercent, "percent")}
                />
          </div>

          {/* The photograph is a column, not a banner. A portrait frame beside
              a table is what stops the table from being the only shape on the
              screen; a full-width band above it would just be a lid. */}
          {plateImage !== null ? (
            <figure className="m-0 flex min-h-[22rem] flex-col gap-3 lg:min-h-[34rem]">
              <Plate
                image={plateImage}
                alt={t("hero.posterAlt")}
                className="flex-1"
                strength={7}
                kindLabel={kindLabel(t, plateImage)}
              />
              <figcaption>
                <ActCredit
                  images={[plateImage]}
                  label={t("hero.creditLabel")}
                  staleLabel={t("hero.creditStale")}
                  className="text-muted-foreground"
                />
              </figcaption>
            </figure>
          ) : null}
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
        <div className="grid min-w-0 items-start gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-12">
          <Panel className="min-w-0 self-start p-4 sm:p-6" sheen={false}>
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
          </Panel>

          {/* The distances sit next to the plan because that is where a reader
              looks for them: how far to the sea, the beach, Alanya, the
              airport.

              No `Panel` around them. `FactRow` carries its own edge now, and a
              bordered panel full of bordered tiles is a box in a box — the
              nesting that makes a dark UI read as cluttered rather than
              layered. The masterplan keeps its panel because it is one object;
              these are five. */}
          <div className="flex flex-col gap-3">
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
            {/* This row read `Standort · 100 km` — `why.locationLabel` is the
                word "Standort", and the value under it is the distance to
                Antalya airport. A label that does not describe its own value is
                worse than a missing row, so the string is now its own key. */}
            <FactRow
              label={t("why.antalyaAirportLabel")}
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
// Search — the grounds
// ---------------------------------------------------------------------------

/**
 * The brief for this section asked for "an amenity grid from the dataset, each
 * item attributed to the source that lists it". **The dataset carries zero
 * amenities** — the generator emits `AzuraAmenity = never` precisely to record
 * that nothing reaches it. So there is no list to render, and inventing a
 * plausible one would be the exact failure this product exists to make visible.
 *
 * What there is instead is photography, and PIVOT §4 settled that the pools and
 * the aquapark are not a claim needing a citation: they are pictures of a place
 * the client owns.
 *
 * Two things changed. The frames now come from `cast.grounds` rather than from
 * `imagesForAct("grounds")`, because that bucket is one beach and four hotel
 * INTERIORS — this section was rendering a wine bar and a restaurant under a
 * heading reading "Die Außenanlagen". And the arrangement is an edit rather
 * than a contact sheet: six equal thumbnails says nobody chose; one dominant
 * frame with the rest reading around it says somebody did.
 */
export async function AmenitiesSection({
  locale,
}: {
  locale: string
}): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing" })
  const grounds = cast.grounds
  if (grounds.length === 0) return null

  const [lead, ...rest] = grounds

  /**
   * Every frame here is one of the developer's visualisations, so the label is
   * said ONCE under the lead instead of as a chip on each of the four.
   *
   * The first build put a chip on all four and it was exactly the failure the
   * chip's own comment warns about: "VISUALISIERUNG DES BAUTRÄGERS" four times
   * in one viewport is furniture, and furniture stops being read. One sentence
   * in the reading flow is both quieter and clearer. The moment a photograph
   * joins this set the group is mixed, this collapses to `false`, and the chips
   * come back per frame — which is the case they are for.
   */
  const allRenders = grounds.every((image) => image.category === "render")

  return (
    <Section
      id="amenities"
      designation={t("designation.search")}
      title={t("amenities.title")}
      lead={
        <>
          {t("amenities.lead")}
          {allRenders ? (
            <span className="mt-3 block text-[0.9375rem] text-muted-foreground/85">
              {t("mediaKind.allRenders")}
            </span>
          ) : null}
        </>
      }
    >
      <Container className="px-0 sm:px-0">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          {lead !== undefined ? (
            <Plate
              image={lead}
              alt={t("amenities.imageAlt")}
              className="min-h-[18rem] lg:min-h-[32rem]"
              strength={5}
              kindLabel={allRenders ? null : kindLabel(t, lead)}
            />
          ) : null}

          {/* The remainder, stacked. Two at 320px so the column never becomes a
              single tall strip of thumbnails on a phone. */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
            {rest.slice(0, 4).map((image, index) => (
              <Plate
                key={image.id}
                image={image}
                alt={t("amenities.imageAlt")}
                className="min-h-[8rem] lg:min-h-[9.5rem]"
                // Alternating strengths so the stack does not move as one
                // block, which would read as a single image cut into pieces.
                strength={index % 2 === 0 ? 4 : 7}
                kindLabel={allRenders ? null : kindLabel(t, image)}
              />
            ))}
          </div>
        </div>

        <ActCredit
          images={grounds}
          label={t("hero.creditLabel")}
          staleLabel={t("hero.creditStale")}
          className="mt-4 text-muted-foreground"
        />
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

  // The hotel's OWN rooms — its bar, its restaurant, its function room, from
  // azuraworldhotel.com and ENS Pride. This section used to render
  // `imagesForAct("room")`, which is six apartment interiors published by the
  // developer: a residence, not a hotel room, under a heading about the hotel.
  const interiors = cast.hotel

  const value = (
    fact: Parameters<typeof InventoryValue>[0]["fact"],
    format: "number" | "text" | "date" | "stars" | "year"
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
      <Container className="flex flex-col gap-8 px-0 sm:px-0">
        <Panel className="p-6 sm:p-9">
          <div className="grid gap-3 sm:grid-cols-2">
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
              <FactRow
                label={t("desire.floorsLabel")}
                value={value(hotel.floors, "number")}
              />
              <FactRow
                label={t("desire.openedLabel")}
                value={value(hotel.openedYear, "year")}
              />
              <FactRow
                label={t("desire.formerLabel")}
                value={value(hotel.formerName, "text")}
              />
              {/* `brandAffiliation` is a `gap`: the value is null and it renders
                  as "Keine Angabe". A 5-star hotel that used to be a Wyndham and
                  no longer states a chain is exactly the kind of absence this
                  page shows rather than tidies away. */}
              <FactRow
                label={t("desire.brandLabel")}
                value={value(hotel.brandAffiliation, "text")}
              />
          </div>
        </Panel>

        {interiors.length > 0 ? (
          <figure className="m-0 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {interiors.map((image, index) => (
                <Plate
                  key={image.id}
                  image={image}
                  alt={t("desire.title")}
                  className="min-h-[11rem] sm:min-h-[15rem]"
                  strength={index === 1 ? 7 : 4}
                  kindLabel={kindLabel(t, image)}
                />
              ))}
            </div>
            <figcaption>
              <ActCredit
                images={interiors}
                label={t("hero.creditLabel")}
                staleLabel={t("hero.creditStale")}
                className="text-muted-foreground"
              />
            </figcaption>
          </figure>
        ) : null}
      </Container>
    </Section>
  )
}
