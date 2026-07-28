import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"

import { PlatformScoreTable } from "@/components/hotel/platform-score-table"
import { getUserProfile } from "@/lib/auth"
import type { Locale } from "@/lib/contracts"
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
 * absence is stated on the page, because a reader looking at two scores side by
 * side will try to combine them unless told why they cannot.
 *
 * **The repository offers a mean and this page refuses it.**
 * `getReviewSummary()` returns `meanNormalisedScore`, computed by rescaling
 * 6.7/10 to 3.35/5 and averaging one entry per platform. It is careful about
 * F-016 double-counting and it is still the forbidden operation. This page
 * calls `getReviewSources()` instead, which returns rows carrying `score` and
 * `scoreScale` together and no combined figure at all. See `HANDOFF/W3-G.md`
 * §"The averaging question" — it is a request to W2-A, not a defect here.
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

export const metadata: Metadata = {
  title: "Bewertungen",
  robots: { index: false, follow: false },
}

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
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t("title")}</h1>
        <p role="alert" data-testid="reviews-forbidden" className="max-w-prose text-sm text-muted-foreground">
          {tCommon("errors.forbidden")}
        </p>
      </section>
    )
  }

  const [sourcesResult, quotesResult] = await Promise.all([
    getReviewSources({ limit: 50 }),
    getReviewQuotes(undefined, { limit: 50 }),
  ])
  const seeded =
    sourcesResult.source === "local-seed" || quotesResult.source === "local-seed"

  // Worst and best from the SAME list, derived here rather than taken from an
  // input ordering. A filter default or a sort order that yielded two positive
  // quotes would be a one-line regression no test would catch, because the page
  // would still render quotes.
  const rated = quotesResult.data.filter((quote) => quote.rating !== null)
  const byRating = [...rated].sort(
    (a, b) => (a.rating as number) - (b.rating as number) || a.url.localeCompare(b.url),
  )
  const worst = byRating[0] ?? null
  const best = byRating[byRating.length - 1] ?? null
  const extremes = [worst, best].filter((q): q is NonNullable<typeof q> => q !== null)
  const distinct = extremes.length === 2 && worst !== best ? extremes : extremes.slice(0, 1)

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t("title")}</h1>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{t("lead")}</p>
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

      <PlatformScoreTable
        sources={sourcesResult.data}
        locale={locale}
        labels={{
          caption: t("table.caption"),
          platform: t("table.platform"),
          publisher: t("table.publisher"),
          score: t("table.score"),
          scale: t("table.scale"),
          reviews: t("table.reviews"),
          ranking: t("table.ranking"),
          fetchedAt: t("table.fetchedAt"),
          open: t("table.open"),
          scaleUnknown: t("table.scaleUnknown"),
          syndicated: t("table.syndicated"),
          noAverageNote: t("noAverageNote"),
          none: t("table.none"),
        }}
      />

      {/* Both ends of the scale, equal width, criticism first in a
          left-to-right locale. A view that shows only the good ones is not
          reachable from this shape. */}
      <section className="flex flex-col gap-3" data-slot="verdict">
        <h2 className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted-foreground">
          {t("verdict.heading")}
        </h2>
        {distinct.length === 0 ? (
          <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
            {t("verdict.none")}
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {distinct.map((quote, index) => (
              <article
                key={quote.url}
                data-slot="verdict-card"
                data-tone={index === 0 ? "negative" : "positive"}
                className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5"
              >
                <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-display text-lg text-foreground tabular-nums">
                    {quote.rating}/5
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {index === 0 ? t("verdict.lowest") : t("verdict.highest")}
                  </span>
                </header>

                {/* Text child of a blockquote: React escapes it, and nothing
                    here uses dangerouslySetInnerHTML. `pre-line` keeps the
                    author's paragraph breaks and nothing else of their markup. */}
                <blockquote className="whitespace-pre-line text-sm leading-relaxed text-foreground">
                  {quote.quoteText}
                </blockquote>

                <footer className="flex flex-col gap-1 text-xs text-muted-foreground">
                  <span>{t("verdict.notTranslated")}</span>
                  {/* The two recorded gaps, stated per card rather than once at
                      the bottom, so a reader cannot take a card out of context
                      and assume the fields were simply blank. */}
                  <span data-testid="quote-language-gap">{t("verdict.languageGap")}</span>
                  <span data-testid="quote-title-gap">{t("verdict.titleGap")}</span>
                  <a
                    href={quote.url}
                    target="_blank"
                    rel="noreferrer noopener nofollow"
                    className="inline-flex min-h-6 w-fit items-center rounded-sm text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {t("verdict.open")}
                  </a>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  )
}
