import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { AccessRefusal } from "@/components/governance/access-refusal"
import {
  ComplianceChecksTable,
  type ComplianceDetailLabels,
  type ComplianceRow,
} from "@/components/governance/compliance-detail"
import { GovernanceNotice } from "@/components/governance/governance-notice"
import {
  DashboardKpiGrid,
  DashboardPageHeader,
  DashboardSection,
} from "@/components/dashboard/section"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { getUserProfile } from "@/lib/auth"
import type { Locale } from "@/lib/contracts"
import { getDocuments } from "@/lib/document-repository"
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
} from "@/lib/format"
import { getGlossary } from "@/lib/glossary"
import {
  getComplianceChecks,
  getProfiles,
} from "@/lib/governance-repository"
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
 *
 * The table shows six columns; the repository reads eighteen. Clicking a row
 * opens the rest in a popup — `components/governance/compliance-detail.tsx` —
 * and the field that most needed rescuing is `rationale`, the recorded human
 * justification the schema makes mandatory the moment a check leaves `pending`.
 * It is read-only there and must stay so: `compliance_checks` grants
 * `authenticated` SELECT only.
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
  const t = await getTranslations({ locale, namespace: "dashboard.compliance" })
  return {
    title: t("title"),
    robots: { index: false, follow: false },
  }
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

/**
 * `compliance_checks.risk_level` → badge treatment, escalating.
 *
 * Read through `?? "muted"`: the column is CHECK-constrained to four values, but
 * a value this map does not know must degrade to the quietest badge rather than
 * crash a page, and the label beside it still says whatever the database said.
 */
const RISK_VARIANT: Readonly<
  Record<string, "muted" | "single" | "stale" | "destructive">
> = Object.freeze({
  low: "muted",
  medium: "single",
  high: "stale",
  critical: "destructive",
})

/**
 * `metadata` jsonb → printable pairs.
 *
 * Values are stringified rather than interpreted. This column holds whatever the
 * writer put in it, and a renderer that guessed at a shape would either hide
 * keys it did not recognise or invent a presentation for them. `JSON.stringify`
 * returns `undefined` for a function or an `undefined` value, which is why the
 * fallback exists — an empty cell would read as "recorded and blank".
 */
/**
 * Bookkeeping the seed writes into every row, which is not "extra data" about
 * the compliance check and must not be shown as if it were.
 *
 * Every seeded row carries `{"demo": true, "demo_seed": "W-DEMO"}`, so the
 * popup's "Extra data" section rendered `demo true` / `demo_seed W-DEMO` to a
 * compliance officer on every single check — internal provenance for the
 * fixture, presented under a heading that promises information about the
 * building. Filtered here rather than in the component: the component's job is
 * to render whatever it is handed, and deciding what belongs to the reader is
 * the page's.
 */
const INTERNAL_METADATA_KEYS = new Set(["demo", "demo_seed"])

function metadataEntries(
  metadata: Record<string, unknown>
): { key: string; value: string }[] {
  return Object.entries(metadata)
    .filter(([key]) => !INTERNAL_METADATA_KEYS.has(key))
    .map(([key, value]) => ({
      key,
      value:
        typeof value === "string" ? value : (JSON.stringify(value) ?? "null"),
    }))
}

export default async function CompliancePage({
  params,
}: {
  params: Promise<{ locale: Locale }>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.compliance" })
  const tCommon = await getTranslations({ locale, namespace: "common" })
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

  // Who signed off each check, by name. Read once for the whole page rather
  // than per row, and only when the reader may see the directory at all —
  // `getProfiles` refuses anyone who may not, and an id that does not resolve
  // renders as the stated "not recorded" rather than falling back to a uuid.
  const directory = hasPermission(profile.role, "users:view")
    ? await getProfiles({ role: profile.role, isActive: true, limit: 200 })
    : null
  const deciderNames = new Map(
    (directory?.data ?? []).map((entry) => [
      entry.id,
      entry.fullName ?? entry.email ?? entry.id,
    ])
  )

  // The evidence document's own vocabulary belongs to the documents module and
  // is already translated there. Re-cutting "approved" and "permit" under a
  // compliance namespace would give the same word two spellings that could
  // drift apart, and a reader who meets the document in both places would be
  // reading two different products.
  const tDoc = await getTranslations({
    locale,
    namespace: "dashboard.documents",
  })
  const glossary = await getGlossary(locale)

  const labels: ComplianceDetailLabels = {
    close: tCommon("actions.close"),
    caption: t("checksCaption"),
    hint: t("detail.hint"),
    detailLead: t("detail.lead"),
    readOnly: t("detail.readOnly"),
    columns: {
      check: t("columns.check"),
      subject: t("columns.subject"),
      state: t("columns.state"),
      recorded: t("columns.recorded"),
      evidence: t("columns.evidence"),
      due: t("columns.due"),
    },
    statesNote: t("detail.statesNote"),
    overclaimed: t("detail.overclaimed"),
    overdue: t("overdue"),
    subjectType: t("detail.subjectType"),
    subjectId: t("detail.subjectId"),
    riskLevel: t("detail.riskLevel"),
    rationale: t("detail.rationale"),
    noRationale: t("detail.noRationale"),
    decidedBy: t("detail.decidedBy"),
    decidedAt: t("detail.decidedAt"),
    notDecided: t("detail.notDecided"),
    humanDecision: t("detail.humanDecision"),
    humanRequired: t("detail.humanRequired"),
    humanNotRequired: t("detail.humanNotRequired"),
    evidenceHeading: t("detail.evidenceHeading"),
    evidenceTitle: tDoc("columns.name"),
    evidenceCategory: tDoc("columns.category"),
    evidenceReview: tDoc("columns.review"),
    evidenceExpires: tDoc("columns.expires"),
    noExpiry: tDoc("noExpiry"),
    evidenceId: t("detail.evidenceId"),
    evidenceUnreadable: t("detail.evidenceUnreadable"),
    noEvidence: t("noEvidence"),
    noDueDate: t("noDueDate"),
    checkId: t("detail.checkId"),
    company: t("detail.company"),
    site: t("detail.site"),
    noSite: t("detail.noSite"),
    version: t("detail.version"),
    createdAt: t("detail.createdAt"),
    updatedAt: t("detail.updatedAt"),
    metadata: t("detail.metadata"),
    noMetadata: t("detail.noMetadata"),
    // "Due" is the one word in this table that means something specific and
    // unstated: a promised time, not a wish. The glossary already says so.
    explainDue: glossary.sla,
  }

  const rows: ComplianceRow[] = ordered.map((row): ComplianceRow => {
    const checkType = t(`checkTypes.${row.check.checkType}`)
    const stateLabel = t(`states.${row.state}`)

    return {
      id: row.check.id,
      state: row.state,
      checkType,
      subjectType: row.check.subjectType,
      subjectId: row.check.subjectId,
      stateLabel,
      stateVariant: STATE_VARIANT[row.state],
      // The legend under the table already explains every state in plain
      // language. The popup carries the same sentence rather than a second
      // wording of it — one explanation, two places it can be read.
      stateExplain: {
        term: stateLabel,
        body: t(`stateExplained.${row.state}`),
        ariaLabel: t("detail.explainState", { term: stateLabel }),
      },
      recordedLabel: t(`recorded.${row.check.status}`),
      overclaimed: row.overclaimed,
      riskLabel: t(`detail.risk.${row.check.riskLevel}`),
      riskVariant: RISK_VARIANT[row.check.riskLevel] ?? "muted",
      rationale: row.check.rationale,
      // A person, so a person's name. This rendered `decided_by` verbatim and
      // put "b0000000-0000-4000-8000-000000000001" under the heading "Decided
      // by" — unreadable, and on a compliance record the one field whose whole
      // purpose is accountability. `getProfiles` refuses a caller who cannot
      // read the directory, so an unresolvable id falls back to the stated
      // "not recorded" rather than to the uuid.
      decidedBy:
        row.check.decidedBy === null
          ? null
          : (deciderNames.get(row.check.decidedBy) ?? null),
      decidedAt:
        row.check.decidedAt === null
          ? null
          : formatDateTime(row.check.decidedAt, locale),
      humanDecisionRequired: row.check.humanDecisionRequired,
      dueAt:
        row.check.dueAt === null ? null : formatDate(row.check.dueAt, locale),
      overdue: row.daysUntilDue !== null && row.daysUntilDue < 0,
      evidenceDocumentId: row.check.evidenceDocumentId,
      evidence:
        row.evidence === null
          ? null
          : {
              title: row.evidence.title,
              category: tDoc(`categories.${row.evidence.category}`),
              review: tDoc(`review.${row.evidence.reviewStatus}`),
              expiresAt:
                row.evidence.expiresAt === null
                  ? null
                  : formatDate(row.evidence.expiresAt, locale),
            },
      companyId: row.check.companyId,
      siteId: row.check.siteId,
      version: formatNumber(row.check.version, locale),
      createdAt: formatDateTime(row.check.createdAt, locale),
      updatedAt: formatDateTime(row.check.updatedAt, locale),
      metadata: metadataEntries(row.check.metadata),
      openLabel: t("detail.openRow", { check: checkType }),
    }
  })

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
        {rows.length === 0 ? (
          <EmptyState title={t("empty")} description={t("emptyLead")} />
        ) : (
          // The table itself is a client island now, because a row opens the
          // full record in a popup. Every string it renders was resolved above;
          // nothing but flat, already-translated data crosses the boundary.
          <ComplianceChecksTable rows={rows} labels={labels} />
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
