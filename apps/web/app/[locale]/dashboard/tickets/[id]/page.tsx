import { getTranslations } from "next-intl/server"
import { notFound } from "next/navigation"
import type { Metadata } from "next"

import { Link } from "@/app/navigation"
import {
  UnitProvenanceBadge,
  type UnitProvenanceLabels,
} from "@/components/inventory/unit-provenance-badge"
import {
  slaLabels,
  ticketCategoryLabels,
  ticketEventKindLabels,
  ticketPriorityLabels,
  ticketSeverityLabels,
  ticketStatusLabels,
  transitionLabels,
} from "@/components/operations/labels"
import { SlaIndicator } from "@/components/operations/sla-indicator"
import {
  TicketPriorityBadge,
  TicketStatusBadge,
} from "@/components/operations/ticket-status-badge"
import { TicketTimeline } from "@/components/operations/ticket-timeline"
import { TicketTransitions } from "@/components/operations/ticket-transitions"
import { Badge } from "@/components/ui/badge"
import { getUserProfile } from "@/lib/auth"
import type { Locale } from "@/lib/contracts"
import { formatDateTime, formatMoney } from "@/lib/format"
import { getUnit } from "@/lib/inventory-repository"
import {
  getMediaReports,
  getTicket,
  getTicketEvents,
} from "@/lib/operations-repository"
import { hasPermission } from "@/lib/rbac"
import { routeTicket } from "@/lib/ticket-routing"
import { allowedTransitions, assessSla } from "@/lib/ticket-workflow"

/**
 * /[locale]/dashboard/tickets/[id] — one ticket.              Owner: W3-E
 *
 * ## Not found and not permitted are the same page, on purpose
 *
 * `getTicket()` returns `null` both when the id does not exist and when the
 * caller's scope excludes it, and this page 404s either way. Telling a tenant
 * that ticket X exists but belongs to another unit is itself the disclosure;
 * the repository's own comment makes the same point, and this is the surface
 * where it either holds or does not.
 *
 * ## Where the action buttons come from
 *
 * Nowhere on this page. `<TicketTransitions>` asks
 * `allowedTransitions(ticket.status, role)` and renders what comes back. This
 * page does not know what a ticket can do next and must not learn.
 */

export const metadata: Metadata = {
  title: "Ticket",
  robots: { index: false, follow: false },
}

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ locale: Locale; id: string }>
}) {
  const { locale, id } = await params

  const t = await getTranslations({ locale, namespace: "dashboard.tickets" })
  const tUnits = await getTranslations({ locale, namespace: "dashboard.units" })
  const tCommon = await getTranslations({ locale, namespace: "common" })
  const profile = await getUserProfile()

  if (!hasPermission(profile.role, "tickets:view")) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <p role="alert" className="max-w-prose text-sm text-muted-foreground">
          {tCommon("errors.forbidden")}
        </p>
      </div>
    )
  }

  const scope = {
    role: profile.role,
    ...(profile.id === null ? {} : { profileId: profile.id }),
  }

  const ticketResult = await getTicket(id, scope)
  const ticket = ticketResult.data
  if (ticket === null) notFound()

  const [eventsResult, reportsResult, unitResult] = await Promise.all([
    getTicketEvents(id, scope, { limit: 200 }),
    getMediaReports({ ...scope, ticketId: id, limit: 50 }),
    ticket.unitId === null
      ? Promise.resolve(null)
      : getUnit(ticket.unitId, scope),
  ])

  const statusLabels = ticketStatusLabels(t)
  const priorityLabels = ticketPriorityLabels(t)
  const severityLabels = ticketSeverityLabels(t)
  const categoryLabels = ticketCategoryLabels(t)
  const kindLabels = ticketEventKindLabels(t)
  const sla = slaLabels(t)
  const actions = transitionLabels(t)

  // `asOf` is the repository's clock, taken once, so the SLA badge here and the
  // one on the list page cannot disagree by the length of a page load.
  const asOf = ticketResult.fetchedAt
  const assessment = assessSla(ticket, asOf)
  const routing = routeTicket({
    category: ticket.category,
    priority: ticket.priority,
    severity: ticket.severity,
    siteId: ticket.siteId,
  })

  const unit = unitResult?.data ?? null
  const unitLabels: UnitProvenanceLabels = {
    portal_listing: tUnits("provenance.portal_listing"),
    official: tUnits("provenance.official"),
    modelled: tUnits("provenance.modelled"),
    source_missing: tUnits("provenance.source_missing"),
  }

  return (
    <div className="flex flex-col gap-6">
      <nav className="text-sm">
        <Link
          href="/dashboard/tickets"
          className="rounded text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {tCommon("actions.back")}
        </Link>
      </nav>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground tabular-nums">
            {ticket.ticketNo}
          </span>
          <TicketStatusBadge status={ticket.status} labels={statusLabels} />
          <TicketPriorityBadge
            priority={ticket.priority}
            labels={priorityLabels}
          />
          <Badge variant="muted">{severityLabels[ticket.severity]}</Badge>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {ticket.title}
        </h1>
        {ticket.description === null ? null : (
          <p className="max-w-prose text-sm whitespace-pre-wrap text-muted-foreground">
            {ticket.description}
          </p>
        )}
        <SlaIndicator
          assessment={assessment}
          labels={sla}
          ageLabel={(age) => t("age", { age })}
          hourUnit={t("hourUnit")}
          dayUnit={t("dayUnit")}
        />
      </header>

      {/* A ticket raised against a synthesised unit is legitimate and must not
          be mistaken for a real work order on a real flat. 631 of 656 units are
          modelled, so this is the common case rather than the exception. */}
      {unit !== null && unit.dataQuality === "modelled" ? (
        <div className="rounded-lg border border-quality-modelled/40 bg-quality-modelled/10 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <UnitProvenanceBadge
              dataQuality={unit.dataQuality}
              labels={unitLabels}
            />
            <p className="text-sm text-foreground">{t("modelledUnitNotice")}</p>
          </div>
        </div>
      ) : null}

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t("columns.category")}>
          {categoryLabels[ticket.category]}
        </Field>
        <Field label={t("columns.unit")}>
          {ticket.unitId ?? tCommon("notAvailable")}
        </Field>
        <Field label={t("columns.assignee")}>
          {ticket.assigneeProfileId ?? t("unassigned")}
        </Field>
        <Field label={t("columns.reportedAt")}>
          {formatDateTime(ticket.reportedAt, locale)}
        </Field>
        <Field label={t("columns.dueAt")}>
          {ticket.slaDueAt === null
            ? tCommon("notAvailable")
            : formatDateTime(ticket.slaDueAt, locale)}
        </Field>
        <Field label={t("columns.estimatedCost")}>
          {/* A missing estimate is a gap, never 0. `asMoney` already refuses to
              build a Money without both an amount and a currency. */}
          {ticket.estimatedCost === null
            ? tCommon("notAvailable")
            : formatMoney(ticket.estimatedCost, locale)}
        </Field>
      </dl>

      <section className="flex flex-col gap-2 rounded-lg border border-border p-4">
        <h2 className="text-base font-semibold text-foreground">
          {t("routing.heading")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("routing.explanation", {
            team: t(`routing.teams.${routing.team}`),
            category: categoryLabels[routing.matchedCategory],
          })}
        </p>
        {routing.escalate && routing.escalationReason !== null ? (
          <p className="text-sm text-foreground">
            <Badge variant="stale">{t("routing.escalated")}</Badge>{" "}
            {t(`routing.escalationReasons.${routing.escalationReason}`)}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("routing.advisory")}</p>
      </section>

      {hasPermission(profile.role, "tickets:update") ||
      hasPermission(profile.role, "tickets:approve") ||
      hasPermission(profile.role, "tickets:assign") ||
      hasPermission(profile.role, "tickets:delete") ? (
        <section className="rounded-lg border border-border p-4">
          <TicketTransitions
            ticket={{
              id: ticket.id,
              status: ticket.status,
              version: ticket.version,
            }}
            // The derivation, on the server. The action bar renders exactly what
            // the transition table permits this role from this status and knows
            // nothing else about the lifecycle.
            available={allowedTransitions(ticket.status, profile.role)}
            labels={{
              actions,
              heading: t("actionsHeading"),
              noActions: t("noActions"),
              noteLabel: t("noteLabel"),
              notePlaceholder: t("notePlaceholder"),
              noteRequired: t("noteRequired"),
              submit: tCommon("actions.confirm"),
              cancel: tCommon("actions.cancel"),
              busy: tCommon("states.saving"),
              conflict: t("conflict"),
              genericError: tCommon("errors.generic"),
              unavailable: t("writeUnavailable"),
            }}
          />
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-foreground">
          {t("historyHeading")}
        </h2>
        <TicketTimeline
          events={eventsResult.data}
          locale={locale}
          kindLabels={kindLabels}
          statusLabels={statusLabels}
          actorFallback={t("systemActor")}
          emptyLabel={t("historyEmpty")}
          transitionLabel={(from, to) => t("transitionSummary", { from, to })}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-foreground">
          {t("evidenceHeading")}
        </h2>
        {reportsResult.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("evidenceEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {reportsResult.data.map((report) => (
              <li
                key={report.id}
                className="rounded-lg border border-border p-3 text-sm"
              >
                <p className="text-foreground">{report.description}</p>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {formatDateTime(report.createdAt, locale)} ·{" "}
                  {t("evidenceFileCount", { count: report.mediaPaths.length })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  )
}
