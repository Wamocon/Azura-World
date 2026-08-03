import { ChevronRight, Scale } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"

import {
  ReviewsQuoteCard,
  type ReviewsQuote,
  type ReviewsQuoteCardLabels,
} from "@/components/hotel/reviews-quote-card"
import {
  groupReviewSourcesByProducer,
  ReviewsScoreCard,
  type ReviewsScoreCardLabels,
} from "@/components/hotel/reviews-score-card"
import {
  ReviewsSourceTable,
  type ReviewsSourceTableLabels,
} from "@/components/hotel/reviews-source-table"
import { getUserProfile } from "@/lib/auth"
import type { Locale } from "@/lib/contracts"
import { getGlossary } from "@/lib/glossary"
import type { ReviewQuoteRecord, ReviewSourceRecord } from "@/lib/hotel-data"
import { getReviewQuotes, getReviewSources } from "@/lib/hotel-repository"
import { hasPermission } from "@/lib/rbac"

/**
 * /[locale]/dashboard/reviews — scores, each on its own scale. Owner: W3-G
 *
 * ## The one rule
 *
 * `tasks/W3-G`: **never average across platforms.** A 4.0/5 and an 8.2/10 are
 * not commensurable and combining them invents a number. So this page has no
 * total, no mean, no normalised column and no "overall rating" — and the
 * absence is stated on the page, in a note that is never behind a disclosure,
 * because a reader looking at two scores side by side will try to combine them
 * unless told why they cannot.
 *
 * **The repository offers a mean and this page refuses it.**
 * `getReviewSummary()` returns `meanNormalisedScore`, computed by rescaling
 * 6.7/10 to 3.35/5 and averaging one entry per platform. It is careful about
 * F-016 double-counting and it is still the forbidden operation. This page
 * calls `getReviewSources()` instead, which returns rows carrying `score` and
 * `scoreScale` together and no combined figure at all. See `HANDOFF/W3-G.md`
 * §"The averaging question" — it is a request to W2-A, not a defect here.
 *
 * ## What the redesign changed, and what it deliberately did not
 *
 * The page was a six-column table followed by two full review bodies, one of
 * them fifteen paragraphs long. It read as a spreadsheet with an essay stapled
 * to it, and the essay won.
 *
 * - The rows are now **one card per producing platform**, each score at the
 *   size of a headline beside the scale it was published on, with the review
 *   count, the platform's own ranking, the fetch date and — where the platform
 *   published one — its own rating distribution.
 * - The **meter under each score has one segment per scale point**, five for
 *   Tripadvisor and ten for Booking, so the two rulers are visibly different.
 *   A single bar filled to a percentage would have re-introduced the
 *   comparison the whole module refuses, in pixels instead of in arithmetic.
 * - **No distribution is invented.** Tripadvisor publishes 269/43/19/8/11;
 *   Booking publishes nothing, and its card says so rather than drawing an
 *   empty bar, which would read as "nobody complained".
 * - The two verbatim reviews are still here in full and still untranslated.
 *   Only the *layout* changed: the opening stays on screen and the rest sits
 *   behind a "read the full review" disclosure. Nothing is summarised and
 *   nothing is cut — see `splitQuoteText()`.
 * - Every captured row, including the syndicated one, is still listed one per
 *   line in the source table at the foot of the page.
 *
 * ## Two [GAP]s that are recorded, not closed
 *
 * **Review language** and **review titles** are both absent from the dataset.
 * Neither is guessed:
 *
 * - `lib/language-detection.ts` exists and is a heuristic built for chat
 *   routing. Labelling a real person's review with a guessed language is the
 *   same class of error as translating it.
 * - The harvest recovered review *bodies* only. `tasks/W3-G` quotes a title as
 *   the negative extreme; it is not in the data, and reconstructing one from the
 *   body would be writing words and attributing them to a guest.
 *
 * Both need W0-B to re-harvest with the attributes captured. Until then the page
 * says the field is not available rather than showing an empty column that reads
 * as "this review has no title".
 */

/**
 * The browser tab, in the reader's language. This was a German literal, so a
 * Turkish page carried a German tab; the heading beside it was already
 * translated, which made the mismatch worse rather than invisible.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.reviews" })
  return {
    title: t("title"),
    robots: { index: false, follow: false },
  }
}

/** A rated quote — `rating` narrowed so the extremes need no cast. */
type RatedQuote = ReviewQuoteRecord & { rating: number }

export default async function ReviewsDashboardPage({
  params,
}: {
  params: Promise<{ locale: Locale }>
}): Promise<ReactNode> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.reviews" })
  const tCommon = await getTranslations({ locale, namespace: "common" })

  const profile = await getUserProfile()
  if (!profile.authenticated || !hasPermission(profile.role, "reviews:view")) {
    return (
      <section className="flex flex-col gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
          {t("title")}
        </h1>
        <p
          role="alert"
          data-testid="reviews-forbidden"
          className="max-w-prose text-sm text-muted-foreground"
        >
          {tCommon("errors.forbidden")}
        </p>
      </section>
    )
  }

  const glossary = await getGlossary(locale)

  const [sourcesResult, quotesResult] = await Promise.all([
    getReviewSources({ limit: 50 }),
    getReviewQuotes(undefined, { limit: 50 }),
  ])
  const seeded =
    sourcesResult.source === "local-seed" ||
    quotesResult.source === "local-seed"

  // Brand names, read once. A platform key with no entry falls back to the key
  // itself rather than rendering an empty heading.
  const rawPlatformNames: unknown = t.raw("platformName")
  const platformNames: Record<string, unknown> =
    typeof rawPlatformNames === "object" && rawPlatformNames !== null
      ? (rawPlatformNames as Record<string, unknown>)
      : {}
  const platformName = (key: string): string => {
    const value = platformNames[key]
    return typeof value === "string" ? value : key
  }

  // One card per PRODUCING platform. Two cards for the same producer would read
  // as two sites agreeing, which under CONTRACTS §1 invariant 3 is what
  // promotes a fact to "confirmed" — see F-016 in the card's header.
  const groups = groupReviewSourcesByProducer(sourcesResult.data)

  const sourceById = new Map<string, ReviewSourceRecord>(
    sourcesResult.data.map((source) => [source.id, source])
  )

  // Worst and best from the SAME list, derived here rather than taken from an
  // input ordering. A filter default or a sort order that yielded two positive
  // quotes would be a one-line regression no test would catch, because the page
  // would still render quotes.
  const rated = quotesResult.data.filter(
    (quote): quote is RatedQuote => quote.rating !== null
  )
  const byRating = [...rated].sort(
    (a, b) => a.rating - b.rating || a.url.localeCompare(b.url)
  )
  const worst = byRating[0] ?? null
  const best = byRating[byRating.length - 1] ?? null
  const extremes = [worst, best].filter((q): q is RatedQuote => q !== null)
  const distinct =
    extremes.length === 2 && worst !== best ? extremes : extremes.slice(0, 1)

  const toQuote = (quote: RatedQuote): ReviewsQuote => {
    const source = sourceById.get(quote.reviewSourceId)
    return {
      url: quote.url,
      quoteText: quote.quoteText,
      rating: quote.rating,
      quotedAtLabel: quote.quotedAtLabel,
      // The scale comes from the review's own source row, never assumed to be
      // five: a quote under a ten-point platform is rated out of ten.
      scale: source?.scoreScale ?? null,
      platformName: source === undefined ? null : platformName(source.platform),
    }
  }

  const scoreLabels: ReviewsScoreCardLabels = {
    scoreLabel: t("table.score"),
    scaleCaption: t.raw("scores.scaleCaption") as string,
    scaleUnknown: t("table.scaleUnknown"),
    reviewsLabel: t("table.reviews"),
    rankingLabel: t("scores.rankingLabel"),
    fetchedLabel: t("table.fetchedAt"),
    open: t.raw("scores.open") as string,
    notStated: tCommon("notAvailable"),
    syndicatedHeading: t("scores.syndicatedHeading"),
    syndicatedNote: t("scores.syndicatedNote"),
    syndicatedBy: t.raw("scores.syndicatedBy") as string,
    distribution: {
      heading: t("scores.distribution.heading"),
      totalOf: t.raw("scores.distribution.totalOf") as string,
      none: t("scores.distribution.none"),
      bucket: {
        excellent: t("scores.distribution.bucket.excellent"),
        good: t("scores.distribution.bucket.good"),
        average: t("scores.distribution.bucket.average"),
        poor: t("scores.distribution.bucket.poor"),
        terrible: t("scores.distribution.bucket.terrible"),
        positive: t("scores.distribution.bucket.positive"),
        mixed: t("scores.distribution.bucket.mixed"),
        negative: t("scores.distribution.bucket.negative"),
      },
    },
    explain: {
      gap: glossary.gap,
      singleSource: glossary.singleSource,
      provenance: glossary.provenance,
    },
  }

  const quoteLabels: ReviewsQuoteCardLabels = {
    lowest: t("verdict.lowest"),
    highest: t("verdict.highest"),
    onPlatform: t.raw("quotes.onPlatform") as string,
    publishedLabel: t.raw("quotes.publishedLabel") as string,
    scaleUnknown: t("table.scaleUnknown"),
    readFull: t("quotes.readFull"),
    collapse: t("quotes.collapse"),
    notTranslated: t("verdict.notTranslated"),
    missingHeading: t("quotes.missingHeading"),
    languageGap: t("verdict.languageGap"),
    titleGap: t("verdict.titleGap"),
    open: t("verdict.open"),
    explain: { gap: glossary.gap },
  }

  const tableLabels: ReviewsSourceTableLabels = {
    caption: t("table.caption"),
    platform: t("table.platform"),
    publisher: t("table.publisher"),
    score: t("table.score"),
    reviews: t("table.reviews"),
    ranking: t("table.ranking"),
    fetchedAt: t("table.fetchedAt"),
    open: t("table.open"),
    scaleUnknown: t("table.scaleUnknown"),
    syndicated: t("table.syndicated"),
    notStated: tCommon("notAvailable"),
  }

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
          {t("title")}
        </h1>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          {t("lead")}
        </p>
        {seeded ? (
          <p
            role="status"
            data-testid="reviews-seed-notice"
            className="mt-1 rounded-lg border border-quality-modelled/40 bg-quality-modelled/10 px-3 py-2 text-xs leading-relaxed text-quality-modelled"
          >
            {t("seedNotice")}
          </p>
        ) : null}
      </header>

      <section className="flex flex-col gap-5" data-slot="reviews-scores">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-lg font-semibold tracking-[-0.015em] text-foreground">
            {t("scores.heading")}
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {t("scores.description")}
          </p>
        </div>

        {/*
          Read before the numbers, never behind a disclosure and never a
          tooltip. A reader looking at two scores side by side will try to
          combine them unless this sentence stops them.
        */}
        <div className="flex gap-3 rounded-xl border border-l-2 border-border border-l-primary bg-muted/30 p-4 sm:p-5">
          <Scale
            className="mt-0.5 size-4 shrink-0 text-primary"
            aria-hidden="true"
          />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold text-foreground">
              {t("scores.noAverageHeading")}
            </p>
            <p
              data-slot="no-average-note"
              className="max-w-prose text-sm leading-relaxed text-muted-foreground"
            >
              {t("noAverageNote")}
            </p>
          </div>
        </div>

        {groups.length === 0 ? (
          <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
            {t("table.none")}
          </p>
        ) : (
          <div className="grid [grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr))] gap-4">
            {groups.map((group) => (
              <ReviewsScoreCard
                // Keyed on the capture, not the platform: a platform whose
                // captures disagree on the figure yields more than one card,
                // and two cards keyed "tripadvisor" would collide.
                key={group.primary.url}
                group={group}
                platformName={platformName(group.platform)}
                labels={scoreLabels}
                locale={locale}
              />
            ))}
          </div>
        )}
      </section>

      {/* Both ends of the scale, equal width, criticism first in a
          left-to-right locale. A view that shows only the good ones is not
          reachable from this shape. */}
      <section className="flex flex-col gap-5" data-slot="verdict">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-lg font-semibold tracking-[-0.015em] text-foreground">
            {t("verdict.heading")}
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {t("quotes.lead")}
          </p>
        </div>

        {distinct.length === 0 ? (
          <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
            {t("verdict.none")}
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {distinct.map((quote, index) => (
              <ReviewsQuoteCard
                key={quote.url}
                quote={toQuote(quote)}
                tone={index === 0 ? "negative" : "positive"}
                labels={quoteLabels}
                locale={locale}
              />
            ))}
          </div>
        )}
      </section>

      {sourcesResult.data.length === 0 ? null : (
        <section className="flex flex-col gap-4" data-slot="reviews-sources">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-lg font-semibold tracking-[-0.015em] text-foreground">
              {t("sources.heading")}
            </h2>
            <p className="max-w-prose text-sm text-muted-foreground">
              {t("sources.description")}
            </p>
          </div>

          <details className="group">
            <summary
              className={
                "azura-tap-compact inline-flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md " +
                "text-sm font-medium text-primary underline underline-offset-4 " +
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring " +
                "[&::-webkit-details-marker]:hidden"
              }
            >
              <ChevronRight
                aria-hidden="true"
                className={
                  "size-4 shrink-0 transition-transform duration-[var(--duration-fast)] " +
                  "ease-[var(--ease-out)] group-open:rotate-90 motion-reduce:transition-none"
                }
              />
              <span className="group-open:hidden">{t("sources.show")}</span>
              <span className="hidden group-open:inline">
                {t("sources.hide")}
              </span>
            </summary>

            <div className="mt-4">
              <ReviewsSourceTable
                sources={sourcesResult.data}
                platformName={platformName}
                labels={tableLabels}
                locale={locale}
              />
            </div>
          </details>
        </section>
      )}
    </div>
  )
}
