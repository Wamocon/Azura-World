import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { AccessRefusal } from "@/components/governance/access-refusal"
import { GovernanceNotice } from "@/components/governance/governance-notice"
import { GovernanceTableFrame } from "@/components/governance/governance-table"
import {
  DashboardKpiGrid,
  DashboardPageHeader,
  DashboardSection,
} from "@/components/dashboard/section"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getUserProfile } from "@/lib/auth"
import type { Locale } from "@/lib/contracts"
import { getDocuments } from "@/lib/document-repository"
import { formatDate, formatPercent } from "@/lib/format"
import { getComplianceChecks } from "@/lib/governance-repository"
import { hasPermission } from "@/lib/rbac"

import {
  coverageSummary,
  currentAsOfMs,
  evaluateChecks,
  provableShare,
  STATE_VARIANT,
  type EvidenceState,
} from "./compliance-model"

/**
 * /[locale]/dashboard/compliance — the compliance cockpit.      Owner: W3-F
 *
 * The headline is deliberately **two numbers, not one**: how many checks are
 * provable, and how many claim a pass they cannot demonstrate. A single
 * "compliance score" would average those together, and the averaging is the
 * dishonesty — the same objection this product raises to F-002's `2.1x`, which
 * SEC-007 records as a High because it divides across two currencies.
 *
 * See `./compliance-model.ts` for why `not_evidenced` is derived rather than
 * stored, and why that is the stronger design.
 */

export const metadata: Metadata = {
  title: "Compliance",
  robots: { index: false, follow: false },
}

const PAGE_SIZE = 200

const STATE_ORDER: readonly EvidenceState[] = [
  "not_evidenced",
  "evidence_expired",
  "evidence_unreviewed",
  "failed",
  "open",
  "proven",
]

export default async function CompliancePage({
  params,
}: {
  params: Promise<{ locale: Locale }>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.compliance" })
  const profile = await getUserProfile()

  const mayView =
    profile.authenticated && hasPermission(profile.role, "compliance:view")

  if (!mayView) {
    return (
      <AccessRefusal
        title={t("forbidden.title")}
        message={t("forbidden.message")}
        detailLabel={t("forbidden.permissionLabel")}
        detail="compliance:view"
      />
    )
  }

  const [checksResult, documentsResult] = await Promise.all([
    getComplianceChecks({ role: profile.role, limit: PAGE_SIZE }),
    // The evidence side of the join. Scoped by the same role, so a check whose
    // evidence the caller may not read resolves to `not_evidenced` for them
    // rather than to a document they cannot open. That is the honest answer:
    // from where they stand, it genuinely is not evidenced.
    getDocuments({ role: profile.role, limit: 500 }),
  ])

  // One clock reading for the whole page. See `currentAsOfMs`.
  const asOfMs = currentAsOfMs()

  const evaluated = evaluateChecks({
    checks: checksResult.data,
    documents: documentsResult.data,
    asOfMs,
  })

  const summary = coverageSummary(evaluated)
  const share = provableShare(summary)

  // Worst first. A cockpit sorted by creation date buries the thing you opened
  // it to find.
  const ordered = [...evaluated].sort(
    (a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state)
  )

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <DashboardPageHeader title={t("title")} description={t("lead")} />

      {checksResult.source === "local-seed" ? (
        <GovernanceNotice tone="seed">{t("seedNotice")}</GovernanceNotice>
      ) : null}

      {summary.overclaimed > 0 ? (
        <GovernanceNotice tone="warning">
          {t("overclaimNotice", { count: summary.overclaimed })}
        </GovernanceNotice>
      ) : null}

      <DashboardKpiGrid>
        <CoverageCard
          label={t("kpi.provable")}
          value={
            share === null ? t("kpi.noChecks") : formatPercent(share, locale)
          }
          hint={t("kpi.provableHint", {
            proven: summary.proven,
            total: summary.total,
          })}
        />
        <CoverageCard
          label={t("kpi.overclaimed")}
          value={String(summary.overclaimed)}
          hint={t("kpi.overclaimedHint")}
          alarming={summary.overclaimed > 0}
        />
        <CoverageCard
          label={t("kpi.unproven")}
          value={String(summary.unproven)}
          hint={t("kpi.unprovenHint")}
        />
        <CoverageCard
          label={t("kpi.overdue")}
          value={String(summary.overdue)}
          hint={t("kpi.overdueHint")}
          alarming={summary.overdue > 0}
        />
      </DashboardKpiGrid>

      <DashboardSection title={t("checks")} description={t("checksLead")}>
        {ordered.length === 0 ? (
          <EmptyState title={t("empty")} description={t("emptyLead")} />
        ) : (
          <GovernanceTableFrame>
            <Table>
              <TableCaption>{t("checksCaption")}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.check")}</TableHead>
                  <TableHead>{t("columns.subject")}</TableHead>
                  <TableHead>{t("columns.state")}</TableHead>
                  <TableHead>{t("columns.recorded")}</TableHead>
                  <TableHead>{t("columns.evidence")}</TableHead>
                  <TableHead>{t("columns.due")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordered.map((row) => (
                  <TableRow key={row.check.id} data-state={row.state}>
                    <TableCell className="font-medium">
                      {t(`checkTypes.${row.check.checkType}`)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {row.check.subjectType}
                      {" · "}
                      {row.check.subjectId}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATE_VARIANT[row.state]}>
                        {t(`states.${row.state}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {/* What the DATABASE says, beside what we can prove. Both
                          are shown because the disagreement between them is the
                          finding, and hiding either would resolve it silently. */}
                      <Badge variant="outline">
                        {t(`recorded.${row.check.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.evidence === null ? (
                        <span className="text-confidence-gap">
                          {t("noEvidence")}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {row.evidence.title}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {row.check.dueAt === null ? (
                        t("noDueDate")
                      ) : (
                        <span
                          className={
                            row.daysUntilDue !== null && row.daysUntilDue < 0
                              ? "text-confidence-conflicted"
                              : undefined
                          }
                        >
                          {formatDate(row.check.dueAt, locale)}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </GovernanceTableFrame>
        )}
      </DashboardSection>

      <DashboardSection title={t("method")} description={t("methodLead")}>
        <dl className="flex min-w-0 flex-col gap-2">
          {STATE_ORDER.map((state) => (
            <div
              key={state}
              className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-input px-3 py-2"
            >
              <dt className="shrink-0">
                <Badge variant={STATE_VARIANT[state]}>
                  {t(`states.${state}`)}
                </Badge>
              </dt>
              <dd className="min-w-0 text-xs leading-relaxed text-muted-foreground">
                {t(`stateExplained.${state}`)}
              </dd>
            </div>
          ))}
        </dl>
      </DashboardSection>
    </div>
  )
}

function CoverageCard({
  label,
  value,
  hint,
  alarming = false,
}: {
  label: string
  value: string
  hint: string
  alarming?: boolean
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 pt-6">
        <span className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {label}
        </span>
        <span
          className={
            alarming
              ? "font-display text-2xl font-semibold text-confidence-conflicted"
              : "font-display text-2xl font-semibold"
          }
        >
          {value}
        </span>
        <span className="text-xs leading-relaxed text-muted-foreground">
          {hint}
        </span>
      </CardContent>
    </Card>
  )
}
