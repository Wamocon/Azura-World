import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"

import { Container, Section } from "@/components/azura/section"
import { ActCredit } from "@/components/journey/act-media"
import { cast } from "@/components/journey/cast"
import { getGalleryLabels } from "@/components/journey/gallery-labels"
import { PhotoGallery } from "@/components/journey/photo-gallery"
import { azuraWorldUnits } from "@/lib/azura-world-data"
import { intlLocaleTag } from "@/lib/format"

/**
 * The residences, by layout.                                  Owner: W-NIGHT
 *
 * ## Why this replaced the unit table
 *
 * A searchable 656-row table sat here first, and it was the wrong instrument on
 * a sales landing: 631 of 656 rows are modelled with repeating values, so it
 * read as an enterprise export, and 1Çatı's New Level landing has no raw data
 * table anywhere. That table belongs behind the login, where a manager works.
 * What sells on the way in is the shape of the offer, so this is that: the five
 * layouts, how many of each, and the typical home in each.
 *
 * ## The figures are counted, and the softness is labelled
 *
 * Count and typical area are computed from `azuraWorldUnits` at render, so they
 * cannot drift from the dataset. "Typical" is the modal interior area, not the
 * range: the raw range hides a 3 m² parse artefact and a 249 m² outlier that
 * would make the section look broken, and the mode is the honest representative
 * of the 631 modelled records behind it. The note says the areas are typical and
 * mostly modelled, so the softness is stated rather than smoothed over.
 */

interface LayoutStat {
  layout: string
  count: number
  /** Modal interior area in m², or null if no unit in the layout states one. */
  modalArea: number | null
}

/** Count and modal area per layout, sorted by bedroom count. Pure over the
 *  dataset, so it is computed once at module load. */
const LAYOUT_STATS: LayoutStat[] = (() => {
  const byLayout = new Map<
    string,
    { count: number; areas: Map<number, number> }
  >()
  for (const unit of azuraWorldUnits) {
    let entry = byLayout.get(unit.layout)
    if (entry === undefined) {
      entry = { count: 0, areas: new Map() }
      byLayout.set(unit.layout, entry)
    }
    entry.count += 1
    if (unit.interiorM2 !== null) {
      entry.areas.set(unit.interiorM2, (entry.areas.get(unit.interiorM2) ?? 0) + 1)
    }
  }
  const out: LayoutStat[] = []
  for (const [layout, entry] of byLayout) {
    let modalArea: number | null = null
    let best = 0
    for (const [area, freq] of entry.areas) {
      if (freq > best) {
        best = freq
        modalArea = area
      }
    }
    out.push({ layout, count: entry.count, modalArea })
  }
  // "1+1" → 1, so the cards read compact-to-largest.
  out.sort((a, b) => Number.parseInt(a.layout, 10) - Number.parseInt(b.layout, 10))
  return out
})()

export async function ResidencesSection({
  locale,
}: {
  locale: string
}): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing" })
  const galleryLabels = await getGalleryLabels(locale)
  const nf = new Intl.NumberFormat(intlLocaleTag(locale))
  const interiors = cast.residences

  return (
    <Section
      id="residences"
      designation={t("residences.designation")}
      title={t("residences.title")}
      lead={t("residences.lead")}
    >
      <Container className="flex flex-col gap-8 px-0 sm:px-0">
        <div>
          <ul className="grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-5">
            {LAYOUT_STATS.map((stat) => (
              <li
                key={stat.layout}
                className="flex flex-col gap-6 rounded-[var(--radius-xl)] border border-[color-mix(in_srgb,var(--foreground)_12%,transparent)] bg-[var(--card)] p-5 sm:p-6"
              >
                <span className="font-display text-[2rem] leading-none tracking-[-0.02em] text-foreground">
                  {stat.layout}
                </span>
                <div className="mt-auto flex flex-col gap-1">
                  <span
                    data-numeric
                    className="font-display text-[1.5rem] leading-none tracking-[-0.02em] text-foreground"
                  >
                    {nf.format(stat.count)}
                  </span>
                  <span className="azura-label text-muted-foreground">
                    {t("residences.unitsLabel")}
                  </span>
                  {stat.modalArea !== null ? (
                    <span
                      data-numeric
                      className="mt-1 text-[0.8125rem] text-muted-foreground"
                    >
                      {t("residences.areaPrefix")} {nf.format(stat.modalArea)} m²
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[0.6875rem] leading-relaxed text-muted-foreground">
            {t("residences.note")}
          </p>
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
