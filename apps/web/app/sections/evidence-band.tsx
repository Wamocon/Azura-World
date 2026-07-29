/**
 * The evidence band — Trust.                                         Owner: W3-A
 *
 * The section that makes this project what it is. Any competitor page can list
 * amenities; one that publishes its own uncertainty is making a verifiable
 * claim about its rigour.
 *
 * Two things are shown that a marketing page never shows: how much of the
 * research failed, and the disagreement in full. The four competing 1+1 prices
 * are printed **on the front page**, in their own currencies, each against the
 * publisher that quoted it — not behind a hover, not in a footnote, not
 * averaged into a number that would be a fabrication with a citation stapled
 * to it.
 *
 * The counts are computed from the same fact objects the page renders
 * (`renderedFacts` in `landing-data.ts`), so "23 figures on this page" cannot
 * drift from the page describing itself.
 */

import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"

import { Link } from "@/app/navigation"
import { Reveal } from "@/components/anim/reveal"
import { Plate, Sounding } from "@/components/azura/chart"
import { Container, Section } from "@/components/azura/section"
import { SNAPSHOT_BASE_PATH } from "@/components/azura/labels"
import { ConfidenceBadge } from "@/components/evidence/confidence-badge"
import { formatMoney } from "@/components/evidence/format"
import { ProvenanceValue } from "@/components/evidence/provenance-value"
import type { ProvenanceLabels } from "@/components/evidence/provenance-value"
import { SourceChip } from "@/components/evidence/source-chip"
import type { SourceChipLabels } from "@/components/evidence/source-chip"
import type { Confidence } from "@/lib/contracts"
import {
  coverage,
  distinctPublishers,
  entryPriceFact,
  factsByConfidence,
  findingsTotal,
  headlinePrices,
  priceSpan,
  renderedFacts,
  unitSplit,
} from "@/components/azura/landing-data"
import { intlLocaleTag } from "@/lib/format"

/** Only the levels that actually occur on this page get a row. */
const CONFIDENCE_ORDER: readonly Confidence[] = [
  "confirmed",
  "official",
  "single_source",
  "conflicted",
  "inferred",
  "gap",
]

export async function EvidenceBandSection({
  locale,
  provenance,
}: {
  locale: string
  provenance: ProvenanceLabels
}): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing" })
  const number = new Intl.NumberFormat(intlLocaleTag(locale))
  const factTotal = renderedFacts.length + (entryPriceFact === null ? 0 : 1)
  const sourceLabels = provenance.source as SourceChipLabels

  return (
    <Section
      id="evidence"
      designation={t("evidenceBand.designation")}
      title={t("evidenceBand.title")}
      lead={t("evidenceBand.lead")}
    >
      <Container className="flex flex-col gap-10 px-0 sm:px-0">
        {/* What the research actually reached. The failed 15 are stated as
            plainly as the successful 45 — a harvest that reports only its
            successes is a harvest you cannot audit. */}
        <Reveal>
          <Plate contours={false}>
            <div className="grid grid-cols-2 lg:grid-cols-4">
              <Sounding
                label={t("evidenceBand.sourcesAttempted")}
                className="border-r border-b border-[color-mix(in_srgb,var(--sea-mid)_18%,transparent)] lg:border-b-0"
              >
                {number.format(coverage.sourcesTotal)}
              </Sounding>
              <Sounding
                label={t("evidenceBand.sourcesReachable")}
                className="border-b border-[color-mix(in_srgb,var(--sea-mid)_18%,transparent)] lg:border-r lg:border-b-0"
              >
                {number.format(coverage.sourcesValidated)}
              </Sounding>
              <Sounding
                label={t("evidenceBand.publishersLabel")}
                className="border-r border-[color-mix(in_srgb,var(--sea-mid)_18%,transparent)]"
              >
                {number.format(distinctPublishers)}
              </Sounding>
              <Sounding label={t("evidenceBand.findingsLabel")}>
                {number.format(findingsTotal)}
              </Sounding>
            </div>
          </Plate>
        </Reveal>

        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          {/* Facts by confidence. The badges carry shape as well as colour, so
              the breakdown survives greyscale and a monochrome print. */}
          <Reveal className="min-w-0">
            <h3 className="mb-4 text-[0.6875rem] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              {t("evidenceBand.confidenceHeading")}
            </h3>
            <ul className="flex flex-col">
              {CONFIDENCE_ORDER.filter(
                (level) => factsByConfidence[level] > 0
              ).map((level) => (
                <li
                  key={level}
                  className="flex items-center justify-between gap-4 border-b border-border/50 py-3 last:border-b-0"
                >
                  <ConfidenceBadge
                    confidence={level}
                    labels={provenance.confidence}
                  />
                  <span data-numeric className="text-[1rem] tabular-nums">
                    {number.format(factsByConfidence[level])}
                  </span>
                </li>
              ))}
              <li className="flex items-center justify-between gap-4 border-t border-border pt-3">
                <span className="text-[0.8125rem] tracking-[0.02em] text-muted-foreground uppercase">
                  {t("evidenceBand.factsLabel")}
                </span>
                <span
                  data-numeric
                  className="text-[1rem] font-semibold tabular-nums"
                >
                  {number.format(factTotal)}
                </span>
              </li>
              <li className="flex items-center justify-between gap-4 border-t border-border/50 pt-3">
                <span className="text-[0.8125rem] tracking-[0.02em] text-muted-foreground uppercase">
                  {t("evidenceBand.unitSplitLabel")}
                </span>
                <span
                  data-numeric
                  className="text-right text-[0.8125rem] text-muted-foreground"
                >
                  {t("evidenceBand.unitSplitValue", {
                    listing: number.format(unitSplit.portalListing),
                    modelled: number.format(unitSplit.modelled),
                    total: number.format(unitSplit.total),
                  })}
                </span>
              </li>
            </ul>
          </Reveal>

          {/* F-002, in the open. */}
          <Reveal className="min-w-0">
            <h3 className="mb-3 font-display text-[1.25rem] leading-[1.2] tracking-[-0.02em]">
              {t("evidenceBand.priceHeading")}
            </h3>
            {priceSpan !== null ? (
              <p className="mb-5 max-w-[62ch] text-[0.9375rem] leading-[1.6] text-muted-foreground">
                {t("evidenceBand.priceIntro", {
                  factor: Number.isNaN(priceSpan.factor)
                    ? "—"
                    : new Intl.NumberFormat(intlLocaleTag(locale), {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      }).format(priceSpan.factor),
                })}
              </p>
            ) : null}

            {entryPriceFact !== null ? (
              <div className="mb-5">
                <ProvenanceValue
                  fact={entryPriceFact}
                  format="money"
                  locale={locale}
                  labels={provenance}
                  snapshotBasePath={SNAPSHOT_BASE_PATH}
                />
              </div>
            ) : null}

            {/* A real table, because this is tabular data and a screen reader
                needs the column headers to make sense of a price next to an
                area next to a publisher. */}
            <div className="azura-scrollbar-slim -mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[34rem] border-collapse text-left">
                <caption className="sr-only">
                  {t("evidenceBand.priceHeading")}
                </caption>
                <thead>
                  <tr className="border-b border-border">
                    {[
                      t("evidenceBand.colPublisher"),
                      t("evidenceBand.colPrice"),
                      t("evidenceBand.colArea"),
                      t("evidenceBand.colNote"),
                    ].map((head) => (
                      <th
                        key={head}
                        scope="col"
                        className="pb-2 text-[0.6875rem] font-semibold tracking-[0.06em] text-muted-foreground uppercase"
                      >
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {headlinePrices.map((price) => (
                    <tr
                      key={`${price.source.publisher}-${price.money.amount}`}
                      className="border-b border-border/50 align-top"
                    >
                      <td className="py-3 pr-4">
                        <SourceChip
                          source={price.source}
                          locale={locale}
                          labels={sourceLabels}
                          snapshotBasePath={SNAPSHOT_BASE_PATH}
                        />
                      </td>
                      {/* Currency is never converted: each figure stands in the
                          unit its publisher quoted. */}
                      <td
                        data-numeric
                        className="py-3 pr-4 text-[1rem] font-medium tabular-nums"
                      >
                        {formatMoney(price.money, locale)}
                      </td>
                      <td
                        data-numeric
                        className="py-3 pr-4 text-[0.875rem] text-muted-foreground tabular-nums"
                      >
                        {price.interiorM2 === null
                          ? provenance.gap
                          : `${number.format(price.interiorM2)} m²`}
                      </td>
                      <td className="py-3 text-[0.8125rem] leading-[1.45] text-muted-foreground">
                        {price.isStale ? (
                          <span className="text-[var(--quality-stale)]">
                            {t("evidenceBand.staleNote")}
                          </span>
                        ) : null}
                        {price.layout !== null ? (
                          <span className="ml-1">{price.layout}</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>
        </div>

        <Reveal>
          <Link
            href="/#access"
            className="azura-tap inline-flex items-center rounded-full border border-primary px-6 text-[0.9375rem] font-medium text-primary transition-transform duration-[var(--duration-instant)] ease-[var(--ease-out)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] active:scale-[0.97]"
          >
            {t("evidenceBand.cta")}
          </Link>
        </Reveal>
      </Container>
    </Section>
  )
}
