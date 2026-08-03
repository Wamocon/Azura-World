import {
  ClipboardCheck,
  Download,
  FileChartColumn,
  Layers,
  ScrollText,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { Link } from "@/app/navigation"
import {
  DashboardPageHeader,
  DashboardSection,
} from "@/components/dashboard/section"
import { AccessRefusal } from "@/components/governance/access-refusal"
import { GovernanceNotice } from "@/components/governance/governance-notice"
import { ReportCard } from "@/components/reports/report-card"
import { REPORT_FILE_COLUMNS } from "@/components/reports/report-file"
import { Button } from "@/components/ui/button"
import { getUserProfile } from "@/lib/auth"
import type { Locale } from "@/lib/contracts"
import { getGlossary } from "@/lib/glossary"
import { hasPermission } from "@/lib/rbac"
import { REPORT_DEFINITIONS, type ReportId } from "@/lib/report-artifacts"

/**
 * /[locale]/dashboard/reports — the report catalogue.           Owner: W3-F
 *                                                       Redesigned by W-NIGHT
 *
 * Each report is listed with its own permission, and the ones the caller cannot
 * export are shown as locked rather than hidden. That is a deliberate departure
 * from the sidebar's rule of withholding what a role cannot use: the nav
 * answers "what can I do", and this page answers "what does this system
 * produce", which a manager needs to know in order to ask somebody else for it.
 * No data leaks, because a locked card names the report and the right it needs
 * and nothing else.
 *
 * ## What the redesign changed, and why
 *
 * The page used to end with two sections that were build status, not product.
 * "Formate" listed CSV as available and XLSX and PDF as unavailable, each with
 * a sentence blaming a missing software library and naming an internal task
 * id; "Geplante Berichte" rendered a 503 with the name of a database table. All
 * of that is true and none of it is the reader's problem. It is now one
 * sentence at the foot of the page saying what is not possible yet, which is
 * the only part of it a property manager can act on.
 *
 * The format also stopped being a section: it belongs to the report, so it is a
 * badge on the card beside the list of columns the file will contain. Those
 * column names are read from `REPORT_FILE_COLUMNS`, the same constant the
 * export route writes the header row from, so the page cannot promise a column
 * the file does not have.
 *
 * Downloads are `<Link>`s to `./export`, so they work with JavaScript off and
 * this page ships no client component of its own beyond the glossary popover.
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
  const t = await getTranslations({ locale, namespace: "dashboard.reports" })
  return {
    title: t("title"),
    robots: { index: false, follow: false },
  }
}

/**
 * One icon per report. Held here rather than in `lib/report-artifacts.ts`
 * because an icon is a property of the surface, not of the artefact, and that
 * module is imported by the route handler where a React icon has no business.
 */
const REPORT_ICONS: Readonly<Record<ReportId, LucideIcon>> = Object.freeze({
  evidence_coverage: FileChartColumn,
  source_register: ScrollText,
  inventory_split: Layers,
  compliance_gaps: ClipboardCheck,
})

/** `"evidence:export"` becomes `"permissionName.evidence_export"`. */
function permissionMessageKey(permission: string): string {
  return `permissionName.${permission.replace(/:/gu, "_")}`
}

export default async function ReportsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.reports" })
  const profile = await getUserProfile()

  const mayView =
    profile.authenticated && hasPermission(profile.role, "reports:view")

  if (!mayView) {
    return (
      <AccessRefusal
        title={t("forbidden.title")}
        message={t("forbidden.message")}
        detailLabel={t("forbidden.permissionLabel")}
        detail="reports:view"
      />
    )
  }

  const glossary = await getGlossary(locale)

  const available = REPORT_DEFINITIONS.filter((report) => report.available)
  const planned = REPORT_DEFINITIONS.filter((report) => !report.available)

  /**
   * The right a locked report needs, in words. The raw `evidence:export` is
   * kept out of the sentence: it is our identifier, and a manager asking an
   * administrator for access says "exporting evidence", not a colon-separated
   * token. The identifier survives in the DOM as `data-permission` for the
   * access probes.
   */
  const permissionName = (permission: string): string => {
    const key = permissionMessageKey(permission)
    return t.has(key) ? t(key) : permission
  }

  return (
    <div className="flex min-w-0 flex-col gap-10">
      <DashboardPageHeader title={t("title")} description={t("lead")} />

      <DashboardSection
        title={t("availableTitle")}
        description={t("availableLead")}
      >
        {available.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <div className="grid min-w-0 [grid-template-columns:repeat(auto-fit,minmax(min(100%,21rem),1fr))] gap-4">
            {available.map((report) => {
              const mayExport = hasPermission(profile.role, report.permission)
              const columns = REPORT_FILE_COLUMNS[report.id] ?? []

              return (
                <ReportCard
                  key={report.id}
                  id={report.id}
                  state={mayExport ? "ready" : "locked"}
                  permitted={mayExport}
                  icon={REPORT_ICONS[report.id]}
                  title={t(`reports.${report.id}.title`)}
                  description={t(`reports.${report.id}.lead`)}
                  formatLabel={t("csvFormat")}
                  {...(report.carriesSourcedFacts
                    ? {
                        provenanceLabel: t("carriesProvenance"),
                        provenanceExplain: glossary.provenance,
                      }
                    : {})}
                  columnsLabel={t("containsLabel")}
                  columns={columns.map((column) => t(column.labelKey))}
                  lockedMessage={t("notPermittedLead", {
                    permission: permissionName(report.permission),
                  })}
                  action={
                    <Button
                      block
                      render={
                        <Link
                          href={`/dashboard/reports/export?report=${report.id}&format=csv`}
                          locale={locale}
                          data-permission={report.permission}
                          // A download, not a navigation. `prefetch` would
                          // fetch the whole CSV on hover.
                          prefetch={false}
                        />
                      }
                    >
                      <Download aria-hidden="true" />
                      {t("downloadCsv")}
                    </Button>
                  }
                />
              )
            })}
          </div>
        )}
      </DashboardSection>

      {planned.length === 0 ? null : (
        <DashboardSection
          title={t("plannedTitle")}
          description={t("plannedLead")}
        >
          <div className="grid min-w-0 [grid-template-columns:repeat(auto-fit,minmax(min(100%,21rem),1fr))] gap-4">
            {planned.map((report) => (
              <ReportCard
                key={report.id}
                id={report.id}
                state="planned"
                permitted={hasPermission(profile.role, report.permission)}
                icon={REPORT_ICONS[report.id]}
                title={t(`reports.${report.id}.title`)}
                description={t(`reports.${report.id}.lead`)}
                plannedLabel={t(
                  `unavailableReason.${report.unavailableReasonKey ?? "not_built"}`
                )}
              />
            ))}
          </div>
        </DashboardSection>
      )}

      {/* Everything the two removed sections used to say, minus the parts that
          were addressed to whoever builds this. */}
      <GovernanceNotice tone="info">{t("limits")}</GovernanceNotice>
    </div>
  )
}
