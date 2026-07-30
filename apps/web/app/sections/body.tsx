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

import { Container, FactRow, Section } from "@/components/azura/section"
import { InventoryValue } from "@/components/azura/inventory-value"
import { ActCredit, mediaKindKey } from "@/components/journey/act-media"
import { cast } from "@/components/journey/cast"
import { getGalleryLabels } from "@/components/journey/gallery-labels"
import { PhotoGallery } from "@/components/journey/photo-gallery"
import { Plate } from "@/components/journey/plate"
import type { JourneyImage } from "@/lib/journey-media"
import { hotel, project } from "@/components/azura/landing-data"

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
    format:
      | "number"
      | "area"
      | "text"
      | "date"
      | "percent"
      | "metres"
      | "kilometres"
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

        {/* Location. These used to be the right column of a separate "site
            plan" section whose left column was a flat block grid — a second
            masterplan that duplicated the 3D drawing two sections down. The
            grid is gone; the location figures belong here with the rest of
            "what it is", under their own label so distance reads as distance. */}
        <div className="mt-10 flex flex-col gap-4">
          <h3 className="azura-label text-primary">
            {t("why.locationHeading")}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <FactRow
              label={t("why.seaLabel")}
              value={value(project.distanceToSeaM, "metres")}
            />
            <FactRow
              label={t("desire.beachLabel")}
              value={value(hotel.distanceToBeachM, "metres")}
            />
            <FactRow
              label={t("why.centreLabel")}
              value={value(project.distanceToAlanyaCentreKm, "kilometres")}
            />
            <FactRow
              label={t("why.airportLabel")}
              value={value(project.distanceToGazipasaAirportKm, "kilometres")}
            />
            <FactRow
              label={t("why.antalyaAirportLabel")}
              value={value(project.distanceToAntalyaAirportKm, "kilometres")}
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

  const galleryLabels = await getGalleryLabels(locale)

  /**
   * Every frame here is one of the developer's visualisations, so the label is
   * said ONCE under the lead. The gallery suppresses the per-thumbnail chip when
   * the whole set is one kind (exactly this case), and restores it in the
   * lightbox caption where a single frame is in focus.
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
        <PhotoGallery images={grounds} labels={galleryLabels} />

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
  const galleryLabels = await getGalleryLabels(locale)

  // The hotel's OWN spaces — bar, restaurant, pool terrace, from
  // azuraworldhotel.com. Photographs, not renders, so no visualisation chip;
  // shown as a browsable gallery with the credit on every lightbox frame.
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
        {/* A bare tile grid, NOT tiles inside a Panel. `FactRow` already carries
            its own edge, so wrapping the grid in a filled Panel was the exact
            box-in-box this file bans elsewhere (and the flat-blue block the
            light theme exposed). This now matches WhySection's grammar. */}
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

        {interiors.length > 0 ? (
          <div className="flex flex-col gap-3">
            <PhotoGallery images={interiors} labels={galleryLabels} />
            <ActCredit
              images={interiors}
              label={t("hero.creditLabel")}
              staleLabel={t("hero.creditStale")}
              className="text-muted-foreground"
            />
          </div>
        ) : null}
      </Container>
    </Section>
  )
}
