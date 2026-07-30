/**
 * The walk-through.                                          Owner: W-NIGHT
 *
 * Five frames of the property, cross-dissolving under a sticky stage as the
 * reader scrolls, each carrying one figure from the dataset.
 *
 * ## Why this earns its 440svh
 *
 * The harvest published twenty-two photographs and the page was spending them
 * as a six-up grid of thumbnails, which is how you show a reader that you have
 * pictures rather than showing them the place. A resort is bought on the
 * feeling of standing in it. This is the one section allowed to just be that,
 * and it is the reason the sections below it can go back to figures without the
 * page feeling cold.
 *
 * ## The cast is by ID, and it was chosen by looking
 *
 * Not `imagesForAct(act)[0]`. The acts are buckets, not an edit: `cut` is three
 * TERRA floor plans, and an earlier version of this file took `cut[0]` for the
 * hotel frame and cross-dissolved a lobby into an architectural drawing with
 * "Das Hotel · 188 Zimmer" set over it. An index into a bucket is a guess about
 * content; a named ID with a note saying what it depicts is a decision.
 *
 * Each entry says what the frame shows and why it is that act. If an ID ever
 * leaves the published set the frame is dropped rather than silently replaced
 * by whatever sorted into its place.
 *
 * ## Renders are labelled, photographs are not
 *
 * Four of the five frames are photographs. The second is one of the developer's
 * marketing visualisations and carries a `MediaKind` chip saying so, because a
 * render of a completed building shown as a photograph of that building is a
 * claim about the building. Labelling all five would make the chip furniture
 * and the one that matters would stop being read.
 *
 * ## It is not decoration, because every frame carries a number
 *
 * Each act shows one real figure from `landing-data`, formatted by the same
 * `InventoryValue` as the rest of the page, with a label that already existed
 * in `messages/*`. No new claim is made here and no number is written into a
 * translated string, which is the trap: a caption reading "76.000 m²" is a
 * datum that stops tracking the dataset the moment either one changes.
 *
 * ## The static contract lives in CSS, not here
 *
 * `globals.css` §"cinema stage" turns this exact markup into a plain vertical
 * gallery outside `(scripting: enabled) and (prefers-reduced-motion:
 * no-preference)`. Nothing in this file branches on capability, and nothing
 * needs to: no JavaScript and reduced motion are the DEFAULT rendering, and the
 * stage is the enhancement.
 */

import { getTranslations } from "next-intl/server"
import type { CSSProperties, ReactNode } from "react"

import { Container } from "@/components/azura/section"
import { InventoryValue } from "@/components/azura/inventory-value"
import { ActCredit, ActMedia, MediaKind } from "@/components/journey/act-media"
import { journeyImages } from "@/lib/journey-media"
import { hotel, project } from "@/components/azura/landing-data"
import type { SourcedFact } from "@/lib/contracts"
import type { ProvenanceFormat } from "@/components/evidence/format"

/**
 * The running order, the frame, and the figure each act is responsible for.
 *
 * `titleKey` is NOT the harvest act. It was, and because the cast is chosen by
 * content rather than by bucket, the opening aerial — cast to answer "where is
 * this" — rendered `cinema.acts.complex`, "Die Gebäude", above "Entfernung zum
 * Meer · 300 m". Two different things had been named by one field. They are two
 * fields now, and `titleKey` is the one the reader sees.
 */
const ACTS: ReadonlyArray<{
  /** What the caption says. Keyed on content, never on the harvest bucket. */
  titleKey: string
  /** What it depicts, so the next reader does not have to open the file. */
  id: string
  fact: SourcedFact<unknown>
  format: ProvenanceFormat
  labelKey: string
}> = [
  {
    // Exterior aerial at dusk, the coastline behind it. The frame that answers
    // "where is this" in one look.
    titleKey: "location",
    id: "azw-hasporealty-com-7c4bb03ab1c2",
    fact: project.distanceToSeaM,
    format: "metres",
    labelKey: "why.seaLabel",
  },
  {
    // The developer's frontal visualisation. Labelled: it is a render.
    titleKey: "buildings",
    id: "azw-housearch-com-989bab955ff8",
    fact: project.residenceBlockCount,
    format: "number",
    labelKey: "hero.figures.blocks",
  },
  {
    // The beach, shot from above. A real photograph, and the best one here.
    titleKey: "grounds",
    id: "azw-azuraworldhotel-com-19d34904ddb7",
    fact: project.outdoorFacilityAreaSqm,
    format: "area",
    labelKey: "why.outdoorLabel",
  },
  {
    // The hotel's own lobby bar. Interior, warm, unmistakably a 5-star house.
    titleKey: "hotel",
    id: "azw-azuraworldhotel-com-4d29956b9d38",
    fact: hotel.roomCount,
    format: "number",
    labelKey: "desire.roomsLabel",
  },
  {
    // A finished living room. The act that has to land is "these are homes".
    titleKey: "apartments",
    id: "azw-cebecigroup-com-f8f351f7f676",
    fact: project.totalUnits,
    format: "number",
    labelKey: "hero.figures.units",
  },
]

export async function CinemaSection({
  locale,
}: {
  locale: string
}): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing" })
  const gapLabel = t("provenance.gap")

  // An act whose frame is no longer published is dropped rather than rendered
  // as an empty box or backfilled with a different picture.
  const frames = ACTS.map((entry) => {
    const image = journeyImages.find((candidate) => candidate.id === entry.id)
    return image === undefined ? null : { ...entry, image }
  }).filter((frame) => frame !== null)

  if (frames.length < 2) return null

  return (
    <section
      id="walk"
      aria-labelledby="walk-heading"
      // Always night: the frames are dark-scrimmed photographs and their
      // captions must stay light whichever surface the page toggle is on.
      data-surface="night"
      className="azura-cine-stage scroll-mt-28"
      data-cine-stage
      style={{ "--acts": frames.length } as CSSProperties}
    >
      <div className="azura-cine-pin azura-grain bg-[#02090e]">
        {frames.map((frame, index) => (
          <figure
            key={frame.image.id}
            data-cine-frame
            // NO positioning classes here. `azura-frame` is `position:
            // relative` and only the stage media query makes it absolute — see
            // globals.css §"cinema stage". Putting `absolute` back on this
            // element is how the reduced-motion rendering broke the first time.
            className="azura-frame m-0 rounded-2xl will-change-[opacity,transform]"
          >
            <div className="azura-frame-media">
              <ActMedia
                image={frame.image}
                // Never eager. The hero owns LCP and this stage begins one full
                // viewport below it.
                alt={t(`cinema.acts.${frame.titleKey}`)}
                className="[&_img]:contrast-[1.08] [&_img]:saturate-[1.1] [&_img]:brightness-[0.9]"
              />
              {/* One scrim per frame rather than one over the stage: the frames
                  cross-fade, and a shared scrim would sit at full strength over
                  a frame that is only half arrived. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(2,9,14,0.94)_0%,rgba(2,9,14,0.55)_34%,rgba(2,9,14,0.12)_62%,transparent_100%)]"
              />
            </div>

            <figcaption data-cine-caption className="pt-5 pb-2">
              <Container className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
                <div className="flex min-w-0 flex-col items-start gap-3">
                  <span className="flex flex-wrap items-center gap-3">
                    <span className="azura-label text-primary">
                      {/* An index, not a translated word. "01 / 05" needs no
                          locale and reads as a running order in all four. */}
                      {String(index + 1).padStart(2, "0")} /{" "}
                      {String(frames.length).padStart(2, "0")}
                    </span>
                    <MediaKind
                      image={frame.image}
                      label={
                        frame.image.category === "render"
                          ? t("mediaKind.render")
                          : frame.image.category === "floorplan"
                            ? t("mediaKind.floorplan")
                            : null
                      }
                    />
                  </span>
                  <h3 className="font-display text-[clamp(1.75rem,5vw,3.25rem)] leading-[1.05] tracking-[-0.03em] text-balance text-foreground">
                    {t(`cinema.acts.${frame.titleKey}`)}
                  </h3>
                </div>

                <div className="flex shrink-0 flex-col items-start gap-1.5 border-l border-[color-mix(in_srgb,var(--foreground)_18%,transparent)] pl-5">
                  <span className="azura-label text-muted-foreground">
                    {t(frame.labelKey)}
                  </span>
                  <span
                    data-numeric
                    className="font-display text-[clamp(1.5rem,3.4vw,2.25rem)] leading-none tracking-[-0.03em] text-foreground"
                  >
                    <InventoryValue
                      fact={frame.fact}
                      format={frame.format}
                      locale={locale}
                      gapLabel={gapLabel}
                    />
                  </span>
                </div>
              </Container>
            </figcaption>
          </figure>
        ))}
      </div>

      {/* The heading and the credit sit BELOW the stage, in normal flow.
          Putting the heading inside a sticky, cross-dissolving container would
          mean the section's accessible name fades in and out with a frame; a
          screen reader would meet the section before any of that has happened
          and find nothing. The credit is here for the same reason it is
          everywhere else: visible, not hover-only. */}
      <Container className="flex flex-col gap-3 pt-8 sm:flex-row sm:items-baseline sm:justify-between sm:gap-10">
        <h2 id="walk-heading" className="azura-label text-muted-foreground">
          {t("cinema.title")}
        </h2>
        <ActCredit
          images={frames.map((frame) => frame.image)}
          label={t("hero.creditLabel")}
          staleLabel={t("hero.creditStale")}
          className="sm:text-right"
        />
      </Container>
    </section>
  )
}
