/**
 * The masterplan, with a day of the system running across it.
 *                                                            Owner: W-SITEMODEL
 *
 * The one surface that answers "what does your software actually do on my
 * site?" without a screenshot of a dashboard. The buildings are Azura World's
 * own, fitted to the plan the developer published; everything moving over them
 * is sample activity and is labelled as such in five separate places, because a
 * viewer who mistakes it for their live data is the only way this section can
 * fail badly.
 *
 * Server Component. It renders the plate and the complete feed at `TICK_FINAL`,
 * so the page is whole before any JavaScript arrives, and the client layer
 * continues from exactly that frame rather than replacing it.
 */

import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"

import { Container, Section } from "@/components/azura/section"
import { SiteModelPlate } from "@/components/azura/site-model-plate"
import { SiteModelLive } from "@/components/azura/site-model-live"
import type { SiteModelLabels } from "@/components/azura/site-model-live"
import { SimulationBanner } from "@/components/immersion/simulation-label"
import { siteBlocks } from "@/lib/site-geometry"
import { simulationStateAt, TICK_FINAL } from "@/lib/site-simulation"
import type { SimEventKind, SimGroup } from "@/lib/site-simulation"

const SEED = "azura-site"

/** Only masses the developer's own plan letters get a letter here. */
const LABELLED = siteBlocks
  .filter((b) => !b.key.startsWith("UNREAD") && b.key !== "GATEHOUSE")
  .map((b) => b.key)

const EVENT_KINDS: readonly SimEventKind[] = [
  "report_opened",
  "resident_message",
  "payment_received",
  "payment_overdue",
  "finance_approval_requested",
  "document_filed",
  "activity_opened",
  "vendor_invoice_approved",
  "report_assigned",
  "report_resolved",
  "report_overdue",
  "hotel_check_in",
  "hotel_check_out",
  "lift_fault",
  "service_charge_run_posted",
  "unit_handover",
]

const GROUPS: readonly SimGroup[] = [
  "intake",
  "work",
  "money",
  "exception",
  "milestone",
]

export async function SiteModelSection({
  locale,
  selectedBlock = null,
}: {
  locale: string
  selectedBlock?: string | null
}): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "siteModel" })

  const labels: SiteModelLabels = {
    rowPrefix: t("rowPrefix"),
    openReports: t("openReports"),
    wholeSite: t("wholeSite"),
    blockRef: t("blockRef", { key: "{key}" }),
    reportRef: t("reportRef", { n: "{n}" }),
    accounts: t("accounts", { count: "{count}" }),
    groups: Object.fromEntries(
      GROUPS.map((g) => [g, t(`groups.${g}`)]),
    ) as SiteModelLabels["groups"],
    events: Object.fromEntries(
      EVENT_KINDS.map((k) => [k, t(`events.${k}`)]),
    ) as SiteModelLabels["events"],
    cadence: {
      daily: t("cadence.daily"),
      monthly: t("cadence.monthly"),
      sixWeekly: t("cadence.sixWeekly"),
    },
  }

  const seeded = simulationStateAt(TICK_FINAL, SEED)

  return (
    <Section id="site-model" title={t("heading")} lead={t("lead")}>
      {/* The marker lives on a wrapper rather than on Section, which takes a
          fixed prop list and does not spread arbitrary attributes. */}
      <Container data-site-section className="flex flex-col gap-6">
        {/* In normal document flow, above the drawing. Not overlaid, not
            sticky, not croppable off the top. */}
        <SimulationBanner
          strings={{
            short: t("bannerShort"),
            title: t("bannerTitle"),
            body: t("bannerBody"),
          }}
        />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
          <figure className="m-0 flex flex-col gap-2">
            <SiteModelPlate
              labelledBlocks={LABELLED}
              selectedBlock={selectedBlock}
            />
            {/* A crop that keeps the drawing keeps this line. */}
            <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-[0.6875rem] leading-[1.5] text-muted-foreground">
              <span>{t("schematic")}</span>
              <span>{t("identifiers")}</span>
            </figcaption>
          </figure>

          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="azura-label text-primary">{t("feedHeading")}</h3>
              <span className="text-[0.6875rem] text-muted-foreground tabular-nums">
                {labels.openReports}: {seeded.openReports}
              </span>
            </div>

            <SiteModelLive
              seedKey={SEED}
              startTick={TICK_FINAL}
              labels={labels}
            />

            <p className="text-[0.6875rem] leading-[1.5] text-muted-foreground">
              {t("compression")}
            </p>
          </div>
        </div>
      </Container>
    </Section>
  )
}
