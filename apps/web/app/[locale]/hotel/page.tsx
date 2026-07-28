import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { hasLocale } from "next-intl"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { HotelFactGrid, DistanceDivergence } from "@/components/hotel/hotel-facts"
import {
  RebrandNotice,
  UnrecoveredSources,
} from "@/components/hotel/hotel-evidence-notes"
import { PlatformScoreCard } from "@/components/hotel/platform-score-card"
import { buildProvenanceLabels } from "@/components/hotel/provenance-labels"
import { ReviewQuoteCard } from "@/components/hotel/review-quote-card"
import {
  groupByProducer,
  orderQuotes,
  totalQuotes,
  unrecoveredBookingSources,
} from "@/components/hotel/select"
import { SplitVerdict } from "@/components/hotel/split-verdict"
import { azuraWorldDataset } from "@/lib/azura-world-data"
import { locales } from "@/lib/contracts"

/**
 * `/[locale]/hotel` — the public hotel & review page.             Owner: W3-G
 *
 * **This page is acceptance criterion 4** — *"Bewertungen und
 * Hotel-Buchungsquellen einbeziehen"* — and tasks/W3-G is blunt about the
 * failure mode: "it fails if it turns into marketing."
 *
 * So the page is ordered against that. A brochure opens with the 5 stars and
 * the aquapark and puts the complaints, if anywhere, at the bottom behind a
 * filter. This one opens with the rebrand — the fact a reader most needs and
 * is least likely to have — and its review section leads with the worst review
 * recovered, beside the best, at equal width. See `split-verdict.tsx` for why
 * that is enforced structurally rather than by ordering.
 *
 * ## Rendering mode: nothing declared, deliberately
 *
 * There is no `export const dynamic`, no `revalidate`, no
 * `generateStaticParams` here. HANDOFF/W-INT.md §4: `app/layout.tsx` reads
 * `headers()`, which opts every route beneath it out of static generation, and
 * that is what makes the per-request CSP nonce work. Declaring a rendering
 * mode here would at best duplicate that and at worst fight it — and
 * `pnpm qa:csp` fails the build if any route prerenders. W-INT's own guidance
 * to wave 3: "W3-A can write an ordinary `page.tsx` with no rendering-mode
 * incantation." This is that.
 *
 * ## No imagery
 *
 * The 833 harvested media assets are Cebeci Group's copyrighted marketing work
 * carrying `usage: internal_only`, and this repository is public. azura-ui-ux
 * §7 permits their photography "small, captioned, sourced, as evidence" and
 * refuses it as "full-bleed hero decoration". A hero image here would be the
 * second thing. The page's visual weight comes from type and structure
 * instead, which is also the more honest register for an intelligence product.
 *
 * ## Data source
 *
 * Read directly from the generated dataset rather than through
 * `hotel-repository.ts` (W2-A). The repository maps rows to domain records and
 * drops the `SourcedFact` wrapper; this page needs the wrapper, because every
 * figure has to render through `ProvenanceValue` with its real sources and
 * snapshot hashes attached. The repository is the right dependency for the
 * dashboard surfaces, which need role scoping and a database. A public
 * evidence page needs the evidence.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  if (!hasLocale(locales, locale)) return {}
  const t = await getTranslations({ locale, namespace: "hotel" })
  return {
    title: t("meta.title"),
    description: t("meta.description"),
  }
}

export default async function HotelPage({
  params,
}: {
  // Next 16: `params` is a Promise (CONVENTIONS §1).
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!hasLocale(locales, locale)) notFound()
  setRequestLocale(locale)

  const t = await getTranslations({ locale, namespace: "hotel" })
  const tEvidence = await getTranslations({ locale, namespace: "evidence" })
  const provenance = buildProvenanceLabels(tEvidence, t)

  const { hotel, project, reviews, harvest } = azuraWorldDataset

  const platforms = groupByProducer(reviews)
  const unrecovered = unrecoveredBookingSources(harvest)

  // The quote pool is every quote from every platform. `SplitVerdict` derives
  // both extremes from it; nothing pre-filters it to a positive subset.
  const allQuotes = reviews.flatMap((review) => review.notableQuotes)
  const ordered = orderQuotes(allQuotes)
  const quoteScale = platforms[0]?.scale ?? 5

  const quoteLabels = {
    ratingOf: t("quote.ratingOf"),
    ratingUnknown: t("quote.ratingUnknown"),
    notTranslated: t("quote.notTranslated"),
    expand: t("quote.expand"),
    collapse: t("quote.collapse"),
    openReview: t("quote.openReview"),
    published: t("quote.published"),
  }

  const sentimentLabels = {
    heading: t("sentiment.heading"),
    bucket: {
      excellent: t("sentiment.bucket.excellent"),
      good: t("sentiment.bucket.good"),
      average: t("sentiment.bucket.average"),
      poor: t("sentiment.bucket.poor"),
      terrible: t("sentiment.bucket.terrible"),
    },
    countOf: t("sentiment.countOf"),
    distributionOf: t("sentiment.distributionOf"),
    foldOnly: t("sentiment.foldOnly"),
    positive: t("sentiment.positive"),
    mixed: t("sentiment.mixed"),
    negative: t("sentiment.negative"),
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-20 px-5 py-16 sm:px-8 lg:py-24">
      {/* ---- Identity ---------------------------------------------------- */}
      <header className="flex flex-col gap-6">
        <p className="font-mono text-[0.6875rem] uppercase tracking-[0.22em] text-muted-foreground">
          {t("eyebrow")}
        </p>
        <h1 className="max-w-3xl text-balance font-display text-4xl leading-[1.05] tracking-[-0.02em] sm:text-5xl lg:text-6xl">
          {hotel.name.value}
        </h1>
        <p className="max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
          {t("lead")}
        </p>
      </header>

      {/*
        The rebrand comes first, before the facts. A reader who does not know
        this hotel was called something else last year cannot interpret the
        review platforms below — Booking.com still indexes it under the old
        slug, and the ticket's own Booking link points at a different property.
      */}
      <RebrandNotice
        name={hotel.name}
        formerName={hotel.formerName}
        locale={locale}
        labels={{
          heading: t("rebrand.heading"),
          body: t("rebrand.body"),
          currentNameLabel: t("rebrand.currentName"),
          formerNameLabel: t("rebrand.formerName"),
          findingRef: t("rebrand.finding"),
          more: t("provenance.more"),
          source: provenance.source,
        }}
      />

      {/* ---- Operating facts --------------------------------------------- */}
      <section aria-labelledby="facts-heading" className="flex flex-col gap-6">
        <h2 id="facts-heading" className="font-display text-3xl text-balance">
          {t("facts.heading")}
        </h2>
        <p className="max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
          {t("facts.intro")}
        </p>
        <HotelFactGrid
          hotel={hotel}
          locale={locale}
          provenance={provenance}
          labels={{
            stars: t("stars"),
            rooms: t("rooms"),
            floors: t("floors"),
            openedYear: t("openedYear"),
            board: t("board"),
            aquapark: t("aquapark"),
            checkIn: t("checkIn"),
            checkOut: t("checkOut"),
            beachDistance: t("beachDistance"),
          }}
        />
      </section>

      {/* ---- The two distances ------------------------------------------- */}
      <DistanceDivergence
        residenceDistance={project.distanceToSeaM}
        hotelDistance={hotel.distanceToBeachM}
        locale={locale}
        provenance={provenance}
        labels={{
          heading: t("distance.heading"),
          explanation: t("distance.explanation"),
          residenceLabel: t("distance.residence"),
          hotelLabel: t("distance.hotel"),
          findingRef: t("distance.finding"),
        }}
      />

      {/* ---- Review intelligence ------------------------------------------ */}
      <section aria-labelledby="reviews-heading" className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <h2 id="reviews-heading" className="font-display text-3xl text-balance">
            {t("reviewsTitle")}
          </h2>
          <p className="max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
            {t("reviews.intro")}
          </p>
          {/*
            Stated on the page, not only in a code comment. A reader looking at
            two scores side by side will try to combine them unless told why
            they cannot be.
          */}
          <p className="max-w-2xl text-pretty text-sm leading-relaxed text-foreground/80">
            {t("reviews.noAverageNote")}
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {platforms.map((group) => (
            <PlatformScoreCard
              key={group.platform}
              group={group}
              locale={locale}
              provenance={provenance}
              labels={{
                platform: {
                  tripadvisor: t("platform.tripadvisor"),
                  booking: t("platform.booking"),
                  agoda: t("platform.agoda"),
                  onthebeach: t("platform.onthebeach"),
                  google: t("platform.google"),
                },
                score: t("platform.score"),
                reviewCount: t("platform.reviewCount"),
                ranking: t("platform.ranking"),
                fetchedAt: t("platform.fetchedAt"),
                openPlatform: t("platform.open"),
                syndicatedBy: t("platform.syndicatedBy"),
                syndicatedNote: t("platform.syndicatedNote"),
                noReviews: t("platform.noReviews"),
                sentiment: sentimentLabels,
              }}
            />
          ))}
        </div>
      </section>

      {/* ---- The split verdict — the page's central claim ------------------ */}
      <SplitVerdict
        quotes={allQuotes}
        scale={quoteScale}
        labels={{
          heading: t("verdict.heading"),
          intro: t("verdict.intro"),
          bestEyebrow: t("verdict.best"),
          worstEyebrow: t("verdict.worst"),
          degenerate: t("verdict.degenerate"),
          noRatings: t("verdict.noRatings"),
          unrated: t("verdict.unrated"),
          quote: quoteLabels,
        }}
      />

      {/* ---- Every recovered quote ---------------------------------------- */}
      <section aria-labelledby="quotes-heading" className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h2 id="quotes-heading" className="font-display text-3xl text-balance">
            {t("quotes.heading")}
          </h2>
          <p className="max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
            {t("quotes.intro").replace("{count}", String(totalQuotes(reviews)))}
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {ordered.map((quote) => (
            <ReviewQuoteCard
              key={quote.url}
              quote={quote}
              scale={quoteScale}
              labels={quoteLabels}
            />
          ))}
        </div>
      </section>

      {/* ---- Platforms that were attempted and not recovered --------------- */}
      <UnrecoveredSources
        sources={unrecovered}
        locale={locale}
        labels={{
          heading: t("unrecovered.heading"),
          intro: t("unrecovered.intro"),
          statusLabel: t("unrecovered.status"),
          attemptedLabel: t("unrecovered.attempted"),
          status: {
            expect_missing: t("unrecovered.statusValue.expect_missing"),
            redirected: t("unrecovered.statusValue.redirected"),
            blocked_403: t("unrecovered.statusValue.blocked_403"),
            dns_timeout: t("unrecovered.statusValue.dns_timeout"),
            soft_404: t("unrecovered.statusValue.soft_404"),
            robots_disallowed: t("unrecovered.statusValue.robots_disallowed"),
          },
        }}
      />
    </main>
  )
}
