import { ExternalLink, ImageOff } from "lucide-react"
import type { ReactNode } from "react"

import { Link } from "@/app/navigation"
import { formatMoney } from "@/components/evidence/format"
import { ActMedia, mediaKindKey } from "@/components/journey/act-media"
import type { ExplainLabels } from "@/components/ui/explain"
import { Explain } from "@/components/ui/explain"
import { cn } from "@/lib/cn"
import { intlLocaleTag } from "@/lib/format"

import { ListingStaleBadge } from "./listing-stale-badge"
import { fillTemplate, type PortalSummary } from "./listings-portal-summary"

/**
 * One portal, as a card.                                       Owner: W-NIGHT
 *
 * The register below this on the page answers "what does every row say". This
 * answers the question a property manager actually asks first: *who is
 * advertising our apartments, at what, and is it current?* Seven cards, one per
 * portal, and each one is readable on its own without the tables underneath.
 *
 * ## The picture is evidence, not decoration
 *
 * MEDIA-LICENSE.md and the UI standard agree on the line: a competitor's
 * photography may appear **small, captioned and sourced**, never as full-bleed
 * ornament. So the frame is a thumbnail inside the card, it carries the link to
 * the page it was taken from, a render is labelled a render, a floor plan is
 * labelled a floor plan, and a picture that came off an out-of-date listing says
 * so. A portal we collected no picture from gets a line saying that, not a
 * borrowed image from another portal.
 *
 * ## Prices stay in their own currency, and rent stays out
 *
 * One block per currency. Housearch's dollars never share a row with anyone's
 * euros, because the conversion would need a rate and a rate date no portal
 * publishes. Monthly rents are counted in a sentence of their own, because a
 * €1 000 rent inside a sale range would make it the cheapest apartment on the
 * page by two orders of magnitude.
 *
 * ## Nothing here is behind a hover
 *
 * The out-of-date badge, the currency, the collection date and the plain-language
 * explanation are all in the document. A warning a touch user cannot reach is not
 * a warning.
 */

/**
 * ## Why the counted labels are functions and the rest are strings
 *
 * A label that counts nouns cannot be a template with `{count}` in it. Filling
 * one by string substitution produces "1 Inserate" in German and "2 объявлений"
 * in Russian, which needs three forms and not two. The caller passes
 * `(count) => t(key, { count })` instead, so ICU picks the plural category for
 * the locale it is actually rendering.
 *
 * That is only legal because this is a **Server Component**: a function prop may
 * not cross a `"use client"` boundary, and none is crossed here — `<Explain>` is
 * the one client island in this file and it takes a plain object. Adding
 * `"use client"` to this file would break these props at runtime, not at build.
 *
 * Everything whose placeholder is not a quantity — a currency code, a list of
 * layouts, a publisher name — stays a string the component substitutes itself.
 */
export interface PortalCardLabels {
  /** Rows this portal published, pluralised by the caller. */
  listingCount: (count: number) => string
  /** Distinct pages behind them, pluralised by the caller. */
  pageCount: (count: number) => string
  /** Template with `{currency}`, e.g. "Prices in {currency}". */
  pricesIn: string
  /** Rows behind one currency block, pluralised by the caller. */
  fromListings: (count: number) => string
  /** Between the two ends of a range, e.g. "up to". */
  upTo: string
  /** Shown instead of a range when a portal names one figure. */
  singlePrice: string
  /** Shown when a portal names no sale price at all. Never "0". */
  noSalePrice: string
  /** Monthly rents, kept out of the range. Pluralised by the caller. */
  rentNote: (count: number) => string
  /** Sale rows that named no price. Pluralised by the caller. */
  withoutPrice: (count: number) => string
  /** Template with `{layouts}` — the layouts this portal names. */
  layouts: string
  /** Template with `{count}` — rows with no layout named. */
  layoutsUnstated: string
  /** Shown when a portal names no layout on any row. */
  layoutsNone: string
  /** The badge word, e.g. "Out of date". */
  stale: string
  /** Why it is out of date, read out next to the badge. */
  staleReason: string
  /** Every row of this portal is out of date. */
  allOutdated: string
  /** Some rows are out of date. Pluralised by the caller. */
  someOutdated: (count: number) => string
  /** e.g. "Last collected". */
  lastCollected: string
  /** Filters the register below to this portal. */
  showListings: string
  /** Clears that filter again. */
  showAll: string
  /** Opens the portal's own page in a new tab. */
  openPage: string
  /** Credit line under the thumbnail. */
  pictureCredit: string
  /** Link to the page the picture was taken from. */
  pictureSource: string
  /** Marker when the picture came off an out-of-date listing. */
  pictureStale: string
  /** Shown when no picture from this portal was collected. */
  pictureNone: string
  /** What the frame IS, when it is not a photograph. */
  kind: { render: string; floorplan: string; siteplan: string }
  /** Alt text per category. Templates with `{publisher}`. */
  alt: { photo: string; render: string; floorplan: string; siteplan: string }
  /** Plain language for "out of date". */
  explainStale: ExplainLabels
  /** Plain language for "not stated". */
  explainNotStated: ExplainLabels
}

export function ListingsPortalCard({
  summary,
  locale,
  labels,
  listingsHref,
  active = false,
  className,
}: {
  summary: PortalSummary
  locale: string
  labels: PortalCardLabels
  /** Where "show its listings" goes. Already carries the register anchor. */
  listingsHref: string
  /** The register below is currently filtered to this portal. */
  active?: boolean
  className?: string
}): ReactNode {
  const tag = intlLocaleTag(locale)
  const headingId = `portal-${slug(summary.publisher)}`
  const image = summary.image
  const kindKey = image === null ? null : mediaKindKey(image)
  const isDrawing = kindKey === "floorplan" || kindKey === "siteplan"

  return (
    <article
      data-slot="portal-card"
      data-publisher={summary.publisher}
      aria-labelledby={headingId}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card",
        // Two shadows: a hairline contact edge plus a wide, very soft ambient
        // one, so a card reads as thicker than a chip and thinner than a modal.
        "shadow-[0_1px_0_0_var(--color-border),0_12px_32px_-24px_rgb(0_0_0/0.35)]",
        "transition-colors duration-150 ease-[var(--ease-out)]",
        active ? "border-primary" : "border-border",
        className
      )}
    >
      {image === null ? (
        <p className="flex items-center gap-2 border-b border-border bg-background/40 px-4 py-2.5 text-xs text-muted-foreground">
          <ImageOff className="size-3.5 shrink-0" aria-hidden="true" />
          {labels.pictureNone}
        </p>
      ) : (
        <figure className="m-0 flex flex-col">
          <div className="relative aspect-[16/9] w-full overflow-hidden bg-background">
            <ActMedia
              image={image}
              alt={fillTemplate(altFor(kindKey, labels), {
                publisher: summary.publisher,
              })}
              layout="tile"
              className={cn(
                "h-full",
                // A drawing is letterboxed rather than cropped: the middle
                // third of a floor plan is not a floor plan.
                isDrawing
                  ? "[&_img]:object-contain [&_img]:p-2"
                  : "[&_img]:object-cover"
              )}
            />
            {kindKey === null ? null : (
              <span className="azura-label pointer-events-none absolute top-2.5 left-2.5 inline-flex max-w-[calc(100%-1.25rem)] items-center rounded-full border border-white/25 bg-black/60 px-2.5 py-1 text-white/90 backdrop-blur-sm">
                {labels.kind[kindKey]}
              </span>
            )}
          </div>
          <figcaption className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-4 py-2 text-xs text-muted-foreground">
            <span>{labels.pictureCredit}</span>
            {image.fromStaleListing ? (
              <span className="text-quality-stale">{labels.pictureStale}</span>
            ) : null}
            {image.sourceUrl === null ? null : (
              <a
                href={image.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={`${labels.pictureSource}: ${image.sourceUrl}`}
                className={cn(
                  "inline-flex min-h-6 items-center gap-1 rounded-sm font-medium",
                  "outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                )}
              >
                {labels.pictureSource}
                <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
              </a>
            )}
          </figcaption>
        </figure>
      )}

      <header className="flex flex-col gap-1.5 px-4 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <h3
            id={headingId}
            className="font-display text-base font-semibold tracking-[-0.012em] text-foreground"
          >
            {summary.publisher}
          </h3>
          {summary.staleCount > 0 ? (
            <span className="flex items-center gap-1">
              <ListingStaleBadge
                label={labels.stale}
                reason={labels.staleReason}
              />
              <Explain labels={labels.explainStale} iconOnly />
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {labels.listingCount(summary.listingCount)}
          {" · "}
          {labels.pageCount(summary.pageCount)}
        </p>
      </header>

      <div className="flex flex-1 flex-col gap-3 px-4 pt-3 pb-4">
        {summary.saleBands.length === 0 ? (
          <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            {labels.noSalePrice}
            <Explain labels={labels.explainNotStated} iconOnly />
          </p>
        ) : (
          <dl className="flex flex-col gap-2">
            {summary.saleBands.map((band) => (
              <div
                key={band.currency}
                className="rounded-lg border border-border bg-background/50 px-3 py-2.5"
              >
                <dt className="azura-label text-muted-foreground">
                  {fillTemplate(labels.pricesIn, { currency: band.currency })}
                </dt>
                <dd className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span
                    data-numeric
                    className="font-display text-lg font-semibold tracking-[-0.014em] text-foreground tabular-nums"
                  >
                    {/* The portal's own currency. Never converted. */}
                    {formatMoney(
                      { amount: band.min, currency: band.currency },
                      tag
                    )}
                  </span>
                  {band.max > band.min ? (
                    <>
                      <span className="text-xs text-muted-foreground">
                        {labels.upTo}
                      </span>
                      <span
                        data-numeric
                        className="font-display text-lg font-semibold tracking-[-0.014em] text-foreground tabular-nums"
                      >
                        {formatMoney(
                          { amount: band.max, currency: band.currency },
                          tag
                        )}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {labels.singlePrice}
                    </span>
                  )}
                </dd>
                {/* A second `<dd>`, not a `<p>`: a `<div>` inside a `<dl>` may
                    hold only `dt`/`dd`, and a paragraph there is invalid HTML
                    that an assistive tree has to guess at. */}
                <dd className="mt-0.5 text-xs text-muted-foreground">
                  {labels.fromListings(band.count)}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <ul className="flex list-none flex-col gap-1 p-0 text-xs text-muted-foreground">
          <li>
            {summary.layouts.length === 0
              ? labels.layoutsNone
              : fillTemplate(labels.layouts, {
                  layouts: summary.layouts.join(", "),
                })}
            {summary.layouts.length > 0 && summary.layoutUnstatedCount > 0
              ? ` · ${fillTemplate(labels.layoutsUnstated, {
                  count: String(summary.layoutUnstatedCount),
                })}`
              : ""}
          </li>
          {summary.rentCount > 0 ? (
            <li>{labels.rentNote(summary.rentCount)}</li>
          ) : null}
          {summary.saleWithoutPrice > 0 ? (
            <li>{labels.withoutPrice(summary.saleWithoutPrice)}</li>
          ) : null}
          {summary.staleCount > 0 ? (
            <li className="text-quality-stale">
              {summary.allStale
                ? labels.allOutdated
                : labels.someOutdated(summary.staleCount)}
            </li>
          ) : null}
        </ul>
      </div>

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-4 py-3">
        {summary.lastFetchedAt.length > 0 ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {labels.lastCollected}{" "}
            <time dateTime={summary.lastFetchedAt}>
              {formatDay(summary.lastFetchedAt, tag)}
            </time>
          </span>
        ) : (
          <span />
        )}
        <span className="flex flex-wrap items-center gap-2">
          <Link
            href={listingsHref}
            aria-current={active ? "true" : undefined}
            className={cn(
              "inline-flex min-h-8 items-center rounded-lg border px-3 text-xs font-medium",
              "transition-colors duration-150 ease-[var(--ease-out)]",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-foreground hover:border-primary"
            )}
          >
            {active ? labels.showAll : labels.showListings}
          </Link>
          {summary.primaryUrl === null ? null : (
            <a
              href={summary.primaryUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={`${labels.openPage}: ${summary.primaryUrl}`}
              className={cn(
                "inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground",
                "transition-colors duration-150 ease-[var(--ease-out)] hover:border-primary",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              )}
            >
              {labels.openPage}
              <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
            </a>
          )}
        </span>
      </footer>
    </article>
  )
}

function altFor(
  kind: "render" | "floorplan" | "siteplan" | null,
  labels: PortalCardLabels
): string {
  if (kind === null) return labels.alt.photo
  return labels.alt[kind]
}

/** ASCII slug for an element id. Every publisher in the register is ASCII. */
function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-")
}

function formatDay(iso: string, tag: string): string {
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return iso
  return new Intl.DateTimeFormat(tag, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(parsed))
}
