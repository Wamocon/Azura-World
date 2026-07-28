import { Download } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { Link } from "@/app/navigation"
import { AccessRefusal } from "@/components/governance/access-refusal"
import { GovernanceNotice } from "@/components/governance/governance-notice"
import {
  DashboardPageHeader,
  DashboardSection,
} from "@/components/dashboard/section"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { getUserProfile } from "@/lib/auth"
import type { Locale } from "@/lib/contracts"
import { hasPermission } from "@/lib/rbac"
import {
  enqueueReportJob,
  REPORT_DEFINITIONS,
  REPORT_FORMATS,
} from "@/lib/report-artifacts"

/**
 * /[locale]/dashboard/reports — the report catalogue.           Owner: W3-F
 *
 * Each report is listed with **its own** permission, and the ones the caller
 * cannot export are shown as locked rather than hidden. That is a deliberate
 * departure from the sidebar's rule of withholding what a role cannot use: the
 * nav answers "what can I do", and this page answers "what does this system
 * produce", which a manager needs to know in order to ask somebody else for it.
 * No data leaks — a locked row shows a report's name and the permission it
 * needs, both of which are in `CONTRACTS.md`.
 *
 * Downloads are `<Link>`s to `./export`, so they work with JavaScript off and
 * this page ships no client component of its own.
 */

export const metadata: Metadata = {
  title: "Berichte",
  robots: { index: false, follow: false },
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

  const job = enqueueReportJob()

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <DashboardPageHeader title={t("title")} description={t("lead")} />

      <DashboardSection title={t("catalogue")} description={t("catalogueLead")}>
        <ul className="flex min-w-0 flex-col gap-3">
          {REPORT_DEFINITIONS.map((report) => {
            const mayExport = hasPermission(profile.role, report.permission)

            return (
              <li
                key={report.id}
                data-testid={`report-${report.id}`}
                data-permitted={mayExport}
                className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-xl border border-input px-4 py-3"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {t(`reports.${report.id}.title`)}
                    </span>
                    {report.carriesSourcedFacts ? (
                      <Badge variant="confirmed">
                        {t("carriesProvenance")}
                      </Badge>
                    ) : null}
                  </span>
                  <span className="max-w-prose text-xs leading-relaxed text-muted-foreground">
                    {t(`reports.${report.id}.lead`)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("requiresPermission")}{" "}
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
                      {report.permission}
                    </code>
                  </span>
                </div>

                {/* Three outcomes, and the middle one is the honest addition:
                    not built yet is different from not permitted, and a reader
                    needs to tell them apart to know whether to ask a colleague
                    or wait for the feature. */}
                {!report.available ? (
                  <Badge variant="single">
                    {t(
                      `unavailableReason.${report.unavailableReasonKey ?? "not_built"}`
                    )}
                  </Badge>
                ) : mayExport ? (
                  <Button
                    size="sm"
                    variant="outline"
                    render={
                      <Link
                        href={`/dashboard/reports/export?report=${report.id}&format=csv`}
                        locale={locale}
                        // A download, not a navigation. `prefetch` would fetch
                        // the whole CSV on hover.
                        prefetch={false}
                      />
                    }
                  >
                    <Download aria-hidden="true" />
                    {t("downloadCsv")}
                  </Button>
                ) : (
                  <Badge variant="gap">{t("notPermitted")}</Badge>
                )}
              </li>
            )
          })}
        </ul>
      </DashboardSection>

      <DashboardSection title={t("formats")} description={t("formatsLead")}>
        <ul className="flex flex-wrap gap-2">
          {REPORT_FORMATS.map((capability) => (
            <li
              key={capability.format}
              data-testid={`format-${capability.format}`}
              data-available={capability.available}
              className="flex min-w-0 flex-col gap-1 rounded-lg border border-input px-3 py-2"
            >
              <span className="flex items-center gap-2">
                <span className="font-mono text-sm uppercase">
                  {capability.format}
                </span>
                <Badge variant={capability.available ? "confirmed" : "gap"}>
                  {capability.available ? t("available") : t("unavailable")}
                </Badge>
              </span>
              <span className="text-xs text-muted-foreground">
                {t(`formatReason.${capability.reasonKey}`)}
              </span>
            </li>
          ))}
        </ul>
      </DashboardSection>

      <DashboardSection title={t("scheduled")} description={t("scheduledLead")}>
        {/* The job model exists in `lib/report-artifacts.ts` and nothing runs
            through it, because there is no table to queue into. Saying so beats
            a "Generate" button that answers 503 after the user has waited. */}
        {job.status === "unavailable" ? (
          <GovernanceNotice tone="warning">
            {t("jobsUnavailable", {
              status: job.httpStatus,
              table: job.missingTable,
              owner: job.owner,
            })}
          </GovernanceNotice>
        ) : null}
      </DashboardSection>
    </div>
  )
}
