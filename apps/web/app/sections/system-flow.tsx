import {
  ArrowRight,
  ClipboardCheck,
  MessageSquarePlus,
  ReceiptText,
  UserCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"

import { Counter } from "@/components/anim/counter"
import { coverage, unitSplit } from "@/components/azura/landing-data"
import { Container, Panel, Section } from "@/components/azura/section"
import { WorkspacePreview } from "@/components/azura/workspace-preview"
import { Donut, StackedBar } from "@/components/charts"
import type { ChartPoint } from "@/components/charts"
import type { Locale } from "@/lib/contracts"
import { intlLocaleTag } from "@/lib/format"

/**
 * The operating showcase: the system in numbers, and how a case flows.
 *                                                            Owner: W-NIGHT
 *
 * ## Why this section exists
 *
 * The landing said what the system IS (the six cards) but never showed it
 * WORKING. 1Çatı's landing closes on a live operating picture with real KPIs,
 * and the client asked for the same here. This is that: a band of counted
 * figures the system actually holds, then the ticket lifecycle as one connected
 * track, so a reader sees the product move rather than only reading a feature
 * list.
 *
 * ## The numbers are real and counted, not decoration
 *
 * 656 units, 47 watched portal listings, 56 verified sources, 24 findings — all
 * from the dataset (`landing-data`, and the harvest the evidence cockpit reads).
 * 11 roles and 4 languages are constants of the build. Nothing here is invented;
 * a landing that shows a KPI it cannot back is the exact failure this product
 * exists to avoid. The count-up is `Counter`, which renders the final value
 * under reduced motion and never a partial frame.
 *
 * ## The flow is the ticket lifecycle, which actually exists
 *
 * Report to settlement is the real `service_tickets` path (status enum:
 * open -> assigned -> in_progress -> resolved, plus the finance-ledger entry).
 * It is drawn as a track rather than claimed in prose because a workflow is a
 * shape, and the shape is the argument.
 */

const STEP_ICONS: Record<string, LucideIcon> = {
  report: MessageSquarePlus,
  assign: UserCheck,
  work: Wrench,
  review: ClipboardCheck,
  settle: ReceiptText,
}

const STEPS = ["report", "assign", "work", "review", "settle"] as const

/** The counted figures. `value` is the real number; `suffix` is rare. */
const STATS: ReadonlyArray<{ key: string; value: number; suffix?: string }> = [
  { key: "units", value: 656 },
  { key: "listings", value: 47 },
  { key: "sources", value: 56 },
  { key: "findings", value: 24 },
  { key: "roles", value: 11 },
  { key: "languages", value: 4 },
]

export async function SystemFlowSection({
  locale,
}: {
  locale: string
}): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing.flow" })

  // ---- Chart data, all counted from the dataset ----------------------------
  // The numbers are real: `unitSplit` is the portal-listing/modelled split the
  // units page shows, and `projectFactsByConfidence` is the coverage the
  // evidence cockpit reads. Nothing here is synthesised. Tones carry meaning —
  // confirmed reads green, conflicted amber — and every figure is repeated as
  // text in each chart's screen-reader table, so colour is never the only signal.
  const nf = new Intl.NumberFormat(intlLocaleTag(locale))
  const tableLabels = {
    category: t("charts.tableCategory"),
    value: t("charts.tableCount"),
  }

  const originSegments: ChartPoint[] = [
    {
      label: t("charts.originReal"),
      value: unitSplit.portalListing,
      formattedValue: nf.format(unitSplit.portalListing),
      tone: 1,
    },
    {
      label: t("charts.originModelled"),
      value: unitSplit.modelled,
      formattedValue: nf.format(unitSplit.modelled),
      tone: 5,
    },
  ]

  const conf = coverage.projectFactsByConfidence
  const confidenceSegments: ChartPoint[] = (
    [
      { label: t("charts.confConfirmed"), value: conf.confirmed ?? 0, tone: 3 },
      { label: t("charts.confConflicted"), value: conf.conflicted ?? 0, tone: 4 },
      { label: t("charts.confSingle"), value: conf.single_source ?? 0, tone: 2 },
    ] as const
  )
    .filter((s) => s.value > 0)
    .map((s) => ({
      label: s.label,
      value: s.value,
      formattedValue: nf.format(s.value),
      tone: s.tone,
    }))

  return (
    <Section
      id="operations"
      designation={t("designation")}
      title={t("title")}
      lead={t("lead")}
    >
      <Container className="flex flex-col gap-12 px-0 sm:px-0">
        {/* ---- The workspace, in a browser frame ----------------------- */}
        <WorkspacePreview locale={locale} />

        {/* ---- The counted figures ------------------------------------- */}
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-xl)] border border-[color-mix(in_srgb,var(--foreground)_10%,transparent)] bg-[color-mix(in_srgb,var(--foreground)_10%,transparent)] sm:grid-cols-3">
          {STATS.map((stat) => (
            <div
              key={stat.key}
              className="flex flex-col gap-1.5 bg-[var(--card)] p-6 sm:p-7"
            >
              <dd
                data-numeric
                className="font-display text-[clamp(1.9rem,4vw,2.75rem)] leading-none tracking-[-0.03em] text-foreground"
              >
                <Counter
                  value={stat.value}
                  locale={locale as Locale}
                  {...(stat.suffix === undefined ? {} : { suffix: stat.suffix })}
                />
              </dd>
              <dt className="azura-label text-muted-foreground">
                {t(`stats.${stat.key}`)}
              </dt>
            </div>
          ))}
        </dl>

        {/* ---- The inventory, measured (charts) ------------------------ */}
        <div className="flex flex-col gap-6">
          <h3 className="font-display text-[1.375rem] leading-[1.2] tracking-[-0.02em] text-foreground">
            {t("charts.chartsTitle")}
          </h3>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel className="p-6 sm:p-7" sheen={false}>
              <div className="flex h-full flex-col gap-4">
                <h4 className="azura-label text-muted-foreground">
                  {t("charts.originTitle")}
                </h4>
                <div className="flex flex-1 flex-col justify-center">
                  <Donut
                    segments={originSegments}
                    ariaLabel={t("charts.originTitle")}
                    basis={t("charts.originBasis")}
                    emptyLabel={t("charts.empty")}
                    tableLabels={tableLabels}
                    centerValue={nf.format(unitSplit.total)}
                    centerLabel={t("charts.unitsTotal")}
                  />
                </div>
              </div>
            </Panel>
            <Panel className="p-6 sm:p-7" sheen={false}>
              <div className="flex h-full flex-col gap-4">
                <h4 className="azura-label text-muted-foreground">
                  {t("charts.confidenceTitle")}
                </h4>
                <div className="flex flex-1 flex-col justify-center">
                  <StackedBar
                    segments={confidenceSegments}
                    ariaLabel={t("charts.confidenceTitle")}
                    basis={t("charts.confidenceBasis")}
                    emptyLabel={t("charts.empty")}
                    tableLabels={tableLabels}
                  />
                </div>
              </div>
            </Panel>
          </div>
        </div>

        {/* ---- The workflow track -------------------------------------- */}
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h3 className="font-display text-[1.375rem] leading-[1.2] tracking-[-0.02em] text-foreground">
              {t("flowTitle")}
            </h3>
            <p className="max-w-[62ch] text-[0.9375rem] leading-[1.6] text-muted-foreground">
              {t("flowLead")}
            </p>
          </div>

          {/* One track: five nodes, an arrow between each. It stacks vertically
              on small screens and becomes a horizontal row from `lg`; the arrows
              rotate to point down when stacked so the reading order stays a
              sequence. Each `li` is `contents`, so the node and its arrow are
              direct flex children of the track. */}
          <ol className="flex list-none flex-col gap-2 p-0 lg:flex-row lg:items-stretch lg:gap-1">
            {STEPS.map((step, index) => {
              const Icon = STEP_ICONS[step] ?? MessageSquarePlus
              return (
                <li key={step} className="contents">
                  <Panel className="h-full p-5 lg:flex-1" sheen={false}>
                    <div className="flex h-full flex-col gap-3">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--primary)_16%,transparent)] text-primary">
                          <Icon className="size-[1.15rem]" aria-hidden="true" />
                        </span>
                        <span
                          data-numeric
                          className="azura-label text-muted-foreground"
                        >
                          {String(index + 1).padStart(2, "0")}
                        </span>
                      </div>
                      <h4 className="font-display text-[1.0625rem] leading-[1.25] tracking-[-0.01em] text-foreground">
                        {t(`steps.${step}.title`)}
                      </h4>
                      <p className="text-[0.8125rem] leading-[1.5] text-muted-foreground">
                        {t(`steps.${step}.body`)}
                      </p>
                    </div>
                  </Panel>

                  {/* The connector. Hidden after the last node, and rotated to
                      point down in the stacked layout. Decorative, so aria-hidden. */}
                  {index < STEPS.length - 1 ? (
                    <span
                      aria-hidden="true"
                      className="flex items-center justify-center py-1 text-muted-foreground/50 lg:px-1 lg:py-0"
                    >
                      <ArrowRight className="size-5 rotate-90 lg:rotate-0" />
                    </span>
                  ) : null}
                </li>
              )
            })}
          </ol>
        </div>
      </Container>
    </Section>
  )
}
