import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { AccessRefusal } from "@/components/governance/access-refusal"
import { AuditTrail } from "@/components/governance/audit-trail"
import { GovernanceNotice } from "@/components/governance/governance-notice"
import { IntegrationPanel } from "@/components/governance/integration-panel"
import {
  DashboardPageHeader,
  DashboardSection,
} from "@/components/dashboard/section"
import { Badge } from "@/components/ui/badge"
import { getUserProfile } from "@/lib/auth"
import { CONTRACT_VERSION, locales, type Locale } from "@/lib/contracts"
import { accessProfilesEnabled } from "@/lib/env"
import { getAccessEvents, getAuditEvents } from "@/lib/governance-repository"
import { hasPermission } from "@/lib/rbac"

import { checkIntegration } from "./actions"
import { integrationStatuses, noIntegrationsConfigured } from "./integrations"

/**
 * /[locale]/dashboard/admin — system state, integrations, and the ledger.
 *                                                              Owner: W3-F
 *
 * ## This route is not in the sidebar, and that is a reported gap, not a bug
 *
 * `lib/dashboard-routing.ts` (W3-B's file) has no `/dashboard/admin` record, and
 * `CONTRACTS.md` §3 has no `admin` resource — the frozen list of 21 does not
 * contain one. Adding a route record is a change to another window's file that
 * also shifts `routeForPath` matching and W3-B's 231-cell probe, so it is
 * **requested in HANDOFF/W3-F.md** with the exact record, not made here.
 *
 * The consequence is worth stating plainly: `decideDashboardAccess` answers
 * `unknown_route` for this path, and `DashboardRouteGuard` deliberately passes
 * an unknown route through to its children. **So the server-side check below is
 * the only gate on this page.** It is `settings:manage`, which the frozen matrix
 * gives to `admin` alone, and it runs before any repository call.
 *
 * `/dashboard/settings` links here for the roles that hold it, so the page is
 * reachable without the nav entry.
 *
 * ## Paging is in the URL
 *
 * `?auditPage=` and `?accessPage=`. Server-side, no client component, works with
 * JavaScript off, and a page of the log is a link somebody can send. The
 * repository ceiling is 500 rows per read; this asks for 25.
 */

export const metadata: Metadata = {
  title: "Administration",
  robots: { index: false, follow: false },
}

const AUDIT_PAGE_SIZE = 25

/** 1-based, clamped. A hostile `?auditPage=-1` resolves to page 1, not an error. */
function pageFrom(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = Number.parseInt(raw ?? "1", 10)
  if (!Number.isFinite(parsed) || parsed < 1) return 1
  // Ceiling as well as floor: `?auditPage=1e9` would ask the repository for an
  // offset it will clamp anyway, and an unbounded number in a URL is an
  // invitation to find out what breaks.
  return Math.min(parsed, 10_000)
}

export default async function AdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>
  // Next 16: `searchParams` is a Promise too.
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.admin" })
  const profile = await getUserProfile()

  const mayView =
    profile.authenticated && hasPermission(profile.role, "settings:manage")

  // Before any read. SEC-003: a Server Component that fetches and then refuses
  // has already put the data in the RSC payload.
  if (!mayView) {
    return (
      <AccessRefusal
        title={t("forbidden.title")}
        message={t("forbidden.message")}
        detailLabel={t("forbidden.permissionLabel")}
        detail="settings:manage"
      />
    )
  }

  const query = await searchParams
  const auditPage = pageFrom(query["auditPage"])
  const accessPage = pageFrom(query["accessPage"])

  const [auditResult, accessResult] = await Promise.all([
    getAuditEvents({
      role: profile.role,
      limit: AUDIT_PAGE_SIZE + 1,
      offset: (auditPage - 1) * AUDIT_PAGE_SIZE,
    }),
    getAccessEvents({
      role: profile.role,
      limit: AUDIT_PAGE_SIZE + 1,
      offset: (accessPage - 1) * AUDIT_PAGE_SIZE,
    }),
  ])

  // One extra row is requested and then dropped: it answers "is there a next
  // page" without a second count query, and without ever claiming a total the
  // repository did not return.
  const auditEvents = auditResult.data.slice(0, AUDIT_PAGE_SIZE)
  const auditHasNext = auditResult.data.length > AUDIT_PAGE_SIZE
  const accessEvents = accessResult.data.slice(0, AUDIT_PAGE_SIZE)
  const accessHasNext = accessResult.data.length > AUDIT_PAGE_SIZE

  const statuses = integrationStatuses()

  const auditLabels = {
    caption: t("audit.caption"),
    emptyTitle: t("audit.emptyTitle"),
    emptyBody: t("audit.emptyBody"),
    appendOnlyNotice: t("audit.appendOnly"),
    columns: {
      when: t("audit.columns.when"),
      action: t("audit.columns.action"),
      entity: t("audit.columns.entity"),
      actor: t("audit.columns.actor"),
      change: t("audit.columns.change"),
    },
    unknownActor: t("audit.unknownActor"),
    noChange: t("audit.noChange"),
    previous: t("audit.previous"),
    next: t("audit.next"),
    page: t("audit.page"),
  }

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <DashboardPageHeader title={t("title")} description={t("lead")} />

      {profile.degradedReason === null ? null : (
        <GovernanceNotice tone="warning">
          {t("profileDegraded")}
        </GovernanceNotice>
      )}

      <DashboardSection
        title={t("integrations.title")}
        description={t("integrations.lead")}
      >
        {noIntegrationsConfigured(statuses) ? (
          <GovernanceNotice tone="warning">
            {t("integrations.noneConfigured")}
          </GovernanceNotice>
        ) : null}

        <IntegrationPanel
          statuses={statuses}
          action={checkIntegration}
          locale={locale}
          labels={{
            heading: t("integrations.title"),
            none: t("integrations.noneConfigured"),
            wiredFalse: t("integrations.wiredFalse"),
            readFrom: t("integrations.readFrom"),
            check: t("integrations.check"),
            checking: t("integrations.checking"),
            forbidden: t("integrations.forbidden"),
            invalid: t("integrations.invalid"),
            latency: t("integrations.latency"),
            state: {
              not_configured: t("integrationState.not_configured"),
              configured_unverified: t(
                "integrationState.configured_unverified"
              ),
              reachable: t("integrationState.reachable"),
              unreachable: t("integrationState.unreachable"),
            },
            name: {
              supabase: t("integrations.name.supabase"),
              storage: t("integrations.name.storage"),
              aiGateway: t("integrations.name.aiGateway"),
              jira: t("integrations.name.jira"),
            },
            note: {
              supabase: t("integrations.note.supabase"),
              storage: t("integrations.note.storage"),
              aiGateway: t("integrations.note.aiGateway"),
              jira: t("integrations.note.jira"),
            },
          }}
        />
      </DashboardSection>

      <DashboardSection
        title={t("system.title")}
        description={t("system.lead")}
      >
        <dl className="grid [grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3">
          <SystemFact
            label={t("system.contractVersion")}
            value={String(CONTRACT_VERSION)}
          />
          <SystemFact label={t("system.locales")} value={locales.join(", ")} />
          <SystemFact
            label={t("system.accessProfiles")}
            value={
              accessProfilesEnabled()
                ? t("system.accessProfilesOn")
                : t("system.accessProfilesOff")
            }
          />
          <SystemFact
            label={t("system.migrations")}
            value={t("system.migrationsUnknown")}
          />
        </dl>

        <GovernanceNotice tone="info">{t("system.notice")}</GovernanceNotice>
      </DashboardSection>

      <DashboardSection title={t("audit.title")} description={t("audit.lead")}>
        <GovernanceNotice tone="info">{t("audit.appendOnly")}</GovernanceNotice>

        {auditResult.source === "local-seed" ? (
          <GovernanceNotice tone="seed">
            {t("audit.seedNotice")}
          </GovernanceNotice>
        ) : null}

        <AuditTrail
          events={auditEvents}
          locale={locale}
          labels={auditLabels}
          page={auditPage}
          hasNextPage={auditHasNext}
          hrefForPage={(next) =>
            `/dashboard/admin?auditPage=${next}&accessPage=${accessPage}`
          }
        />
      </DashboardSection>

      <DashboardSection
        title={t("access.title")}
        description={t("access.lead")}
      >
        {/* `access_events` is the same append-only shape with a different
            payload: a decision rather than a mutation. Rendered through the same
            component by mapping its two extra columns into the `change` cell,
            so there is one audit table in this product and not two that drift. */}
        <AuditTrail
          events={accessEvents.map((event) => ({
            id: event.id,
            companyId: event.companyId,
            actorProfileId: event.actorProfileId,
            action: `${event.eventType}.${event.decision}`,
            entityTable: "access_events",
            entityId: event.resource,
            beforeData: null,
            afterData: event.reason === null ? null : { reason: event.reason },
            ipAddress: null,
            userAgent: null,
            requestId: event.requestId,
            createdAt: event.createdAt,
          }))}
          locale={locale}
          labels={{ ...auditLabels, caption: t("access.caption") }}
          page={accessPage}
          hasNextPage={accessHasNext}
          hrefForPage={(next) =>
            `/dashboard/admin?auditPage=${auditPage}&accessPage=${next}`
          }
        />
      </DashboardSection>
    </div>
  )
}

function SystemFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-input px-3 py-2.5">
      <dt className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="min-w-0">
        <Badge variant="outline">
          <span className="font-mono">{value}</span>
        </Badge>
      </dd>
    </div>
  )
}
