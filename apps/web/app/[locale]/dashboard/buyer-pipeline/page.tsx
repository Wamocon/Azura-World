import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"

import { CurrencyTotals } from "@/components/inventory/currency-totals"
import {
  PipelineBoard,
  type BoardEntry,
  type BoardStage,
  type PipelineBoardLabels,
  type PipelineMoveLabels,
} from "@/components/dashboard/pipeline-board"
import { getUserProfile } from "@/lib/auth"
import type { Locale } from "@/lib/contracts"
import { pipelineStages, type PipelineStage } from "@/lib/lead-data"
import {
  getBuyerPipeline,
  getPipelineSummary,
  type PipelineEntryRecord,
} from "@/lib/lead-repository"
import { hasPermission } from "@/lib/rbac"
import { intlLocaleTag } from "@/lib/format"

/**
 * /[locale]/dashboard/buyer-pipeline — the funnel, as a board.  Owner: W3-C / N1
 *
 * ## From dense list to a board
 *
 * This was a stack of rows. It is now a funnel strip plus a card per lead with a
 * probability bar, and a click opens the full record in a popup (`PipelineBoard`
 * is the one client island). The honesty rules are unchanged: every stage is
 * shown including the empty ones, a missing lead is named, a `null` probability
 * reads "no estimate" and never 0%, and deals stay in their own currency, never
 * summed across currencies.
 *
 * ## No longer read-only
 *
 * `PATCH /api/site-management/buyer-pipeline` used to be a declared write gap —
 * 503, naming its owner — so this page carried a sentence saying an entry could
 * not be moved. Migration 21 restored the UPDATE grant and
 * `updatePipelineEntryStage()` exists, so that sentence has been removed: it was
 * true when written and is false now, and a stale honesty notice is just a lie
 * with good intentions. The stage-change control lives inside the board's
 * existing popup and is gated on `buyer_pipeline:update`.
 *
 * `buyer_pipeline:update` is held by `admin` and `manager`, which is exactly the
 * set `buyer_pipeline_staff_write` admits (`is_admin() or (has_role_level(70)
 * and own company)`). Nobody is offered a control the database will refuse.
 *
 * `entered_stage_at` and `previous_stage` — the two fields "days at this stage"
 * and "previous stage" are read from — are written by the
 * `track_pipeline_stage_change` trigger, never by the application. After a move
 * the board re-reads through `router.refresh()`, so both figures come from the
 * row Postgres actually wrote.
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
  const t = await getTranslations({ locale, namespace: "dashboard.pipeline" })
  return {
    title: t("title"),
    robots: { index: false, follow: false },
  }
}

const PAGE_LIMIT = 200
const DAY_MS = 86_400_000

function toBoardEntry(entry: PipelineEntryRecord, asOf: number): BoardEntry {
  const entered = Date.parse(entry.enteredStageAt)
  const daysInStage = Number.isNaN(entered)
    ? null
    : Math.max(0, Math.floor((asOf - entered) / DAY_MS))
  return {
    id: entry.id,
    stage: entry.stage,
    name: entry.lead?.fullName ?? null,
    reference: entry.lead?.reference ?? entry.leadId,
    deal: entry.deal,
    probability: entry.probability,
    unitId: entry.unitId,
    expectedClose: entry.expectedClose,
    daysInStage,
    enteredStageAt: entry.enteredStageAt,
    previousStage: entry.previousStage,
    blocker: entry.blocker,
    // Carried to the client so a move can be optimistically locked. It is a
    // counter, not data about anybody, and without it every move would be a
    // last-writer-wins overwrite.
    version: entry.version,
  }
}

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

  const asOf = Date.parse(summary.asOf)

  const stageLabel = (stage: PipelineStage): string =>
    t(`stage.${stage}` as "stage.enquiry")

  const byStage = new Map<PipelineStage, PipelineEntryRecord[]>()
  for (const stage of pipelineStages) byStage.set(stage, [])
  for (const entry of entries) byStage.get(entry.stage)?.push(entry)

  const boardStages: BoardStage[] = pipelineStages.map((stage) => {
    const stageEntries = byStage.get(stage) ?? []
    const count =
      summary.stages.find((s) => s.stage === stage)?.count ??
      stageEntries.length
    return {
      stage,
      label: stageLabel(stage),
      count,
      entries: stageEntries.map((entry) => toBoardEntry(entry, asOf)),
    }
  })

  const boardLabels: PipelineBoardLabels = {
    // A template with `{value}` — `t.raw` so next-intl does not try to
    // interpolate the placeholder the board substitutes itself.
    probability: t.raw("card.probability") as string,
    probabilityUnset: t("card.probabilityUnset"),
    probabilityLabel: t("card.probabilityLabel"),
    expectedClose: t("card.expectedClose"),
    noExpectedClose: t("card.noExpectedClose"),
    unit: t("card.unit"),
    noUnit: t("card.noUnit"),
    inStage: t("card.inStage"),
    firstStage: t("card.firstStage"),
    blocker: t("card.blocker"),
    missingLead: t("card.missingLead"),
    noDeal: t("card.noDeal"),
    stageEmpty: t("board.stageEmpty"),
    close: t("close"),
    stageLabel: t("card.stageLabel"),
    previousStage: t("card.previousStage"),
    detailLead: t("card.detailLead"),
  }

  // Absent, not disabled: a reader without `buyer_pipeline:update` gets a popup
  // with no control at all rather than a button that explains itself by
  // refusing. The API re-checks the permission regardless, and RLS decides what
  // actually lands.
  const canMove = hasPermission(profile.role, "buyer_pipeline:update")
  const moveLabels: PipelineMoveLabels = {
    heading: t("move.heading"),
    stageLabel: t("move.stageLabel"),
    stagePlaceholder: t("move.stagePlaceholder"),
    reasonLabel: t("move.reasonLabel"),
    reasonPlaceholder: t("move.reasonPlaceholder"),
    reasonRequired: t("move.reasonRequired"),
    reasonNotStored: t("move.reasonNotStored"),
    submit: t("move.submit"),
    busy: t("move.busy"),
    conflict: t("move.conflict"),
    genericError: t("move.genericError"),
    unavailable: t("move.unavailable"),
  }

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

      {/* ---- the funnel at a glance ------------------------------------- */}
      <section aria-labelledby="pipeline-summary" className="flex flex-col gap-3">
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
              {new Intl.NumberFormat(intlLocaleTag(locale)).format(
                summary.totalEntries
              )}
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
                missingLabel={t("summary.withoutDeal", {
                  count: summary.entriesWithoutDealAmount,
                })}
                emptyLabel={t("summary.noDeals")}
              />
            </dd>
          </div>
        </dl>
        <p className="max-w-prose text-sm text-muted-foreground">
          {t("summary.currencyNote")}
        </p>
      </section>

      {/* ---- the board -------------------------------------------------- */}
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

        <PipelineBoard
          stages={boardStages}
          labels={boardLabels}
          locale={locale}
          {...(canMove ? { move: moveLabels } : {})}
        />
      </section>
    </div>
  )
}
