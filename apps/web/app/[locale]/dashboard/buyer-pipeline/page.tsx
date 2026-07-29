import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"

import { formatMoney } from "@/components/evidence/format"
import { CurrencyTotals } from "@/components/inventory/currency-totals"
import { getUserProfile } from "@/lib/auth"
import { cn } from "@/lib/cn"
import type { Locale } from "@/lib/contracts"
import { pipelineStages, type PipelineStage } from "@/lib/lead-data"
import {
  getBuyerPipeline,
  getPipelineSummary,
  type PipelineEntryRecord,
  type PipelineStageSummary,
} from "@/lib/lead-repository"
import { hasPermission } from "@/lib/rbac"
import { intlLocaleTag } from "@/lib/format"

/**
 * /[locale]/dashboard/buyer-pipeline — the funnel.           Owner: W3-C / N1
 *
 * ## Every stage is rendered, including the empty ones
 *
 * Nine stages, zero-filled, in funnel order. Three of them hold nothing today.
 * A board that omits empty stages tells a reader the funnel has six steps, and
 * "nobody is at title deed" is a fact about the business, not a row to drop.
 * `getPipelineSummary()` already reports all nine for the same reason; this
 * page renders what it reports.
 *
 * ## No stage-transition control, and that is a decision rather than an omission
 *
 * `PATCH /api/site-management/buyer-pipeline` is a **declared write gap**: it
 * authenticates, authorises, validates, and then answers 503 naming W2-A,
 * because no repository write path exists. There is no `buyer_pipeline` write
 * in `lead-repository.ts` and no audit table behind it.
 *
 * So a "move to next stage" control here could only do one of two things: fake a
 * success, which OVERNIGHT-2 §4.6 forbids outright, or fail on every press. The
 * third option — the one taken — is to state once, in words, that stage changes
 * are not yet possible and name what is missing. The audit trail that *does*
 * exist is rendered instead: each entry's previous stage, the date it entered
 * the current one, and how long it has been there.
 *
 * ## Money, again, per currency only
 *
 * Six entries carry deals in EUR, USD and GBP, and two carry none. `sum` across
 * those is a number with no meaning. Entries without a deal amount are
 * **counted** next to the totals, never folded in as zero — and a probability of
 * 0 ("this is lost") is not the same as `null` ("nobody has estimated"), so the
 * two render differently.
 */

export const metadata: Metadata = {
  title: "Käufer-Pipeline",
  robots: { index: false, follow: false },
}

const PAGE_LIMIT = 200

/** Milliseconds in a day, for "how long has this sat here". */
const DAY_MS = 86_400_000

export default async function BuyerPipelinePage({
  params,
}: {
  params: Promise<{ locale: Locale }>
}) {
  const { locale } = await params

  const t = await getTranslations({ locale, namespace: "dashboard.pipeline" })
  const tCommon = await getTranslations({ locale, namespace: "common" })

  const profile = await getUserProfile()

  if (!hasPermission(profile.role, "buyer_pipeline:view")) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.018em] text-foreground">
          {t("title")}
        </h1>
        <p role="alert" className="max-w-prose text-sm text-muted-foreground">
          {tCommon("errors.forbidden")}
        </p>
      </div>
    )
  }

  const scope = { role: profile.role, limit: PAGE_LIMIT }
  const [summaryResult, entriesResult] = await Promise.all([
    getPipelineSummary(scope),
    getBuyerPipeline(scope),
  ])

  const summary = summaryResult.data
  const entries = entriesResult.data
  const degraded =
    summaryResult.source === "local-seed" ||
    entriesResult.source === "local-seed"

  const byStage = new Map<PipelineStage, PipelineEntryRecord[]>()
  for (const stage of pipelineStages) byStage.set(stage, [])
  for (const entry of entries) byStage.get(entry.stage)?.push(entry)

  const stageLabel = (stage: PipelineStage): string =>
    t(`stage.${stage}` as "stage.enquiry")

  // `asOf` is the repository's own timestamp, not a fresh clock: the ages below
  // must be measured against the moment the figures were taken, or a slow render
  // silently ages every entry by the render time.
  const asOf = Date.parse(summary.asOf)

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.018em] text-foreground">
          {t("title")}
        </h1>
        <p className="max-w-prose text-sm text-muted-foreground">{t("lead")}</p>
      </header>

      {degraded ? (
        <p
          role="status"
          className="rounded-lg border border-confidence-gap/30 bg-confidence-gap/10 px-3 py-2 text-sm text-foreground"
        >
          {t("seedNotice")}
        </p>
      ) : null}

      {/* The summary was computed from a bounded page. A partial figure that
          says so beats a wrong one that does not. */}
      {summary.truncated ? (
        <p
          role="status"
          className="max-w-prose rounded-lg border border-confidence-conflicted/40 bg-confidence-conflicted/10 px-3 py-2 text-sm text-foreground"
        >
          {t("truncatedNotice", {
            summarised: summary.summarisedEntries,
            total: summary.totalEntries,
          })}
        </p>
      ) : null}

      <p
        role="status"
        className="max-w-prose rounded-lg border border-confidence-gap/30 bg-background/50 px-3 py-2 text-sm text-muted-foreground"
      >
        {t("readOnlyNotice")}
      </p>

      {/* ---- the funnel at a glance -------------------------------------- */}
      <section
        aria-labelledby="pipeline-summary"
        className="flex flex-col gap-3"
      >
        <h2
          id="pipeline-summary"
          className="font-display text-lg font-semibold tracking-[-0.012em] text-foreground"
        >
          {t("summary.heading")}
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2.5">
            <dt className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              {t("summary.entries")}
            </dt>
            <dd
              data-numeric
              className="font-display text-2xl font-semibold tracking-[-0.018em] text-foreground tabular-nums"
            >
              {new Intl.NumberFormat(intlLocaleTag(locale)).format(summary.totalEntries)}
            </dd>
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2.5">
            <dt className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              {t("summary.dealTotals")}
            </dt>
            <dd className="text-base">
              <CurrencyTotals
                totals={summary.dealTotalsByCurrency}
                locale={locale}
                missing={summary.entriesWithoutDealAmount}
                missingLabel={t("summary.withoutDeal")}
                emptyLabel={t("summary.noDeals")}
              />
            </dd>
          </div>
        </dl>
        <p className="max-w-prose text-sm text-muted-foreground">
          {t("summary.currencyNote")}
        </p>
      </section>

      {/* ---- the board --------------------------------------------------- */}
      <section aria-labelledby="pipeline-board" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h2
            id="pipeline-board"
            className="font-display text-lg font-semibold tracking-[-0.012em] text-foreground"
          >
            {t("board.heading")}
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {t("board.lead")}
          </p>
        </div>

        <ol className="flex flex-col gap-4">
          {pipelineStages.map((stage, index) => (
            <StageBlock
              key={stage}
              stage={stage}
              index={index}
              label={stageLabel(stage)}
              summary={
                summary.stages.find((entry) => entry.stage === stage) ?? null
              }
              entries={byStage.get(stage) ?? []}
              locale={locale}
              asOf={asOf}
              stageLabelOf={stageLabel}
              labels={{
                empty: t("board.stageEmpty"),
                withoutDeal: t("summary.withoutDeal"),
                noDeals: t("summary.noDeals"),
                averageProbability: t("board.averageProbability"),
                noProbability: t("board.noProbability"),
                deal: t("card.deal"),
                noDeal: t("card.noDeal"),
                probability: t("card.probability"),
                probabilityUnset: t("card.probabilityUnset"),
                expectedClose: t("card.expectedClose"),
                noExpectedClose: t("card.noExpectedClose"),
                unit: t("card.unit"),
                noUnit: t("card.noUnit"),
                inStage: t("card.inStage"),
                cameFrom: t("card.cameFrom"),
                firstStage: t("card.firstStage"),
                blocker: t("card.blocker"),
                missingLead: t("card.missingLead"),
              }}
            />
          ))}
        </ol>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------

interface StageLabels {
  empty: string
  withoutDeal: string
  noDeals: string
  averageProbability: string
  noProbability: string
  deal: string
  noDeal: string
  probability: string
  probabilityUnset: string
  expectedClose: string
  noExpectedClose: string
  unit: string
  noUnit: string
  inStage: string
  cameFrom: string
  firstStage: string
  blocker: string
  missingLead: string
}

/**
 * One stage of the funnel, with its entries.
 *
 * An empty stage renders its heading, a zero, and a sentence saying nobody is
 * there. It is deliberately not collapsed away: the shape of the funnel is the
 * information, and a gap in the middle of it is the most interesting shape it
 * can have.
 */
function StageBlock({
  stage,
  index,
  label,
  summary,
  entries,
  locale,
  asOf,
  stageLabelOf,
  labels,
}: {
  stage: PipelineStage
  index: number
  label: string
  summary: PipelineStageSummary | null
  entries: readonly PipelineEntryRecord[]
  locale: string
  asOf: number
  stageLabelOf: (stage: PipelineStage) => string
  labels: StageLabels
}) {
  const count = summary?.count ?? entries.length
  const isEmpty = count === 0

  return (
    <li
      data-slot="pipeline-stage"
      data-stage={stage}
      data-stage-count={count}
      className={cn(
        "rounded-xl border bg-card",
        isEmpty
          ? "border-dashed border-border bg-transparent"
          : "border-border shadow-[0_1px_0_0_var(--color-border),0_12px_32px_-24px_rgb(0_0_0/0.35)]"
      )}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
        <h3 className="flex items-baseline gap-2 font-display text-base font-semibold tracking-[-0.012em] text-foreground">
          <span
            aria-hidden="true"
            className="text-xs font-normal text-muted-foreground tabular-nums"
          >
            {index + 1}
          </span>
          {label}
          {/* The count is a bare number. It had a `{count}` message key, which
              check-i18n correctly flagged as identical across all four locales -
              a placeholder with no words around it is not a translation. */}
          <span
            data-numeric
            className="text-sm font-normal text-muted-foreground tabular-nums"
          >
            {new Intl.NumberFormat(intlLocaleTag(locale)).format(count)}
          </span>
        </h3>
        {summary !== null && !isEmpty ? (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
            <CurrencyTotals
              totals={summary.dealTotalsByCurrency}
              locale={locale}
              missing={summary.entriesWithoutDealAmount}
              missingLabel={labels.withoutDeal}
              emptyLabel={labels.noDeals}
            />
            <span className="text-xs text-muted-foreground tabular-nums">
              {summary.averageProbability === null
                ? labels.noProbability
                : labels.averageProbability.replace(
                    "{value}",
                    new Intl.NumberFormat(intlLocaleTag(locale), {
                      maximumFractionDigits: 1,
                    }).format(summary.averageProbability)
                  )}
            </span>
          </div>
        ) : null}
      </header>

      {isEmpty ? (
        <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">
          {labels.empty}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60">
          {entries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              locale={locale}
              asOf={asOf}
              stageLabelOf={stageLabelOf}
              labels={labels}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function EntryRow({
  entry,
  locale,
  asOf,
  stageLabelOf,
  labels,
}: {
  entry: PipelineEntryRecord
  locale: string
  asOf: number
  stageLabelOf: (stage: PipelineStage) => string
  labels: StageLabels
}) {
  const entered = Date.parse(entry.enteredStageAt)
  const daysInStage = Number.isNaN(entered)
    ? null
    : Math.max(0, Math.floor((asOf - entered) / DAY_MS))

  return (
    <li
      data-slot="pipeline-entry"
      data-entry-stage={entry.stage}
      className="flex flex-col gap-2.5 px-4 py-3.5 sm:px-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="font-medium text-foreground">
            {/* The embed returns nothing when the join produced no row, and the
                repository returns `null` rather than a placeholder. Printing an
                invented name on a board is exactly the failure that guard
                exists to prevent, so the absence is stated. */}
            {entry.lead?.fullName ?? (
              <span className="text-muted-foreground italic">
                {labels.missingLead}
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {entry.lead?.reference ?? entry.leadId}
          </p>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-sm">
            {entry.deal === null ? (
              <span className="text-muted-foreground">{labels.noDeal}</span>
            ) : (
              <span
                data-numeric
                data-currency={entry.deal.currency}
                className="font-display font-semibold tracking-[-0.01em] text-foreground tabular-nums"
              >
                {formatMoney(entry.deal, locale)}
              </span>
            )}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {/* 0 % is an estimate ("this is lost"); null is "nobody estimated".
                Rendering null as 0 % would invent a judgement nobody made. */}
            {entry.probability === null
              ? labels.probabilityUnset
              : labels.probability.replace(
                  "{value}",
                  new Intl.NumberFormat(intlLocaleTag(locale)).format(entry.probability)
                )}
          </span>
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2 lg:grid-cols-3">
        <MetaField label={labels.unit}>
          {entry.unitId ?? (
            <span className="text-muted-foreground">{labels.noUnit}</span>
          )}
        </MetaField>
        <MetaField label={labels.expectedClose}>
          {entry.expectedClose === null ? (
            <span className="text-muted-foreground">
              {labels.noExpectedClose}
            </span>
          ) : (
            <time dateTime={entry.expectedClose} className="tabular-nums">
              {formatDay(entry.expectedClose, locale)}
            </time>
          )}
        </MetaField>
        <MetaField label={labels.inStage}>
          <span className="tabular-nums">
            {daysInStage === null
              ? formatDay(entry.enteredStageAt, locale)
              : new Intl.NumberFormat(intlLocaleTag(locale)).format(daysInStage)}
          </span>
          {/* The audit trail this page CAN show: where the entry came from and
              when. There is no write path, so this is history, not a control. */}
          <span className="ml-2 text-muted-foreground">
            {entry.previousStage === null
              ? labels.firstStage
              : // The translated stage name, never the raw enum member. A board
                // reading "kam aus reservation" is the product showing a reader
                // its database column names.
                labels.cameFrom.replace(
                  "{stage}",
                  stageLabelOf(entry.previousStage)
                )}
          </span>
        </MetaField>
      </dl>

      {entry.blocker !== null && entry.blocker.length > 0 ? (
        <p className="max-w-prose rounded-md border border-quality-stale/30 bg-quality-stale/[0.06] px-2.5 py-1.5 text-sm text-foreground">
          <span className="font-semibold">{labels.blocker}: </span>
          {entry.blocker}
        </p>
      ) : null}
    </li>
  )
}

function MetaField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="text-foreground">{children}</dd>
    </div>
  )
}

function formatDay(iso: string, locale: string): string {
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return iso
  return new Intl.DateTimeFormat(intlLocaleTag(locale), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(parsed))
}
