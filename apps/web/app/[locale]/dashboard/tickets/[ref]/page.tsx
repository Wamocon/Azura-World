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
import { TicketCommentForm } from "@/components/operations/ticket-comment-form"
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
import { getProfiles } from "@/lib/governance-repository"
import { decodePublicId } from "@/lib/public-id"
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
  const t = await getTranslations({ locale, namespace: "dashboard.tickets" })
  return {
    title: t("title"),
    robots: { index: false, follow: false },
  }
}

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ locale: Locale; ref: string }>
}) {
  const { locale, ref } = await params

  // The URL carries an opaque token, not the row's primary key. A token that
  // does not decode is the same answer as a ticket that does not exist —
  // distinguishing them would turn this page into an oracle for which tokens
  // are well-formed. See `lib/public-id.ts`.
  const id = decodePublicId("ticket", ref)
  if (id === null) notFound()

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

  const [eventsResult, reportsResult, unitResult, assigneeResult] =
    await Promise.all([
      getTicketEvents(id, scope, { limit: 200 }),
      getMediaReports({ ...scope, ticketId: id, limit: 50 }),
      ticket.unitId === null
        ? Promise.resolve(null)
        : getUnit(ticket.unitId, scope),
      // Who this job can be handed to. Only fetched for a caller who may
      // actually assign; `getProfiles` refuses a role that cannot read the
      // directory, and an empty list makes the action explain itself rather
      // than offer an empty menu.
      hasPermission(profile.role, "tickets:assign")
        ? getProfiles({ role: profile.role, isActive: true, limit: 200 })
        : Promise.resolve(null),
    ])

  /**
   * The people who actually do the work: staff and contractors. A resident is
   * in the directory too and must never appear here — assigning a lift repair
   * to the tenant who reported it is not a thing this product should offer.
   */
  const assignees = (assigneeResult?.data ?? [])
    .filter(
      (person) => person.role === "staff" || person.role === "service_provider"
    )
    .map((person) => ({
      id: person.id,
      name: person.fullName ?? person.email ?? person.id,
    }))

  /** Every readable profile, so the assignee renders as a person not an id. */
  const assigneeNames = new Map(
    (assigneeResult?.data ?? []).map((person) => [
      person.id,
      person.fullName ?? person.email ?? person.id,
    ])
  )

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
        <Field label={t("columns.unit")}>{ticket.unitId ?? t("noValue")}</Field>
        <Field label={t("columns.assignee")}>
          {/* A name, not a UUID. `b0000000-0000-4000-8000-000000000004` is not
              an answer to "who is dealing with this". Falls back to the id only
              when the directory is unreadable for this caller. */}
          {ticket.assigneeProfileId === null
            ? t("unassigned")
            : (assigneeNames.get(ticket.assigneeProfileId) ??
              t("unknownActor"))}
        </Field>
        <Field label={t("columns.reportedAt")}>
          {formatDateTime(ticket.reportedAt, locale)}
        </Field>
        <Field label={t("columns.dueAt")}>
          {ticket.slaDueAt === null
            ? t("noValue")
            : formatDateTime(ticket.slaDueAt, locale)}
        </Field>
        <Field label={t("columns.estimatedCost")}>
          {/* A missing estimate is a gap, never 0. `asMoney` already refuses to
              build a Money without both an amount and a currency. */}
          {ticket.estimatedCost === null
            ? t("noValue")
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
            assignees={assignees}
            labels={{
              actions,
              heading: t("actionsHeading"),
              noActions: t("noActions"),
              noteLabel: t("noteLabel"),
              notePlaceholder: t("notePlaceholder"),
              noteRequired: t("noteRequired"),
              assigneeLabel: t("assigneeLabel"),
              assigneePlaceholder: t("assigneePlaceholder"),
              assigneeRequired: t("assigneeRequired"),
              assigneeUnavailable: t("assigneeUnavailable"),
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
          actorFallback={t("unknownActor")}
          actorNames={assigneeNames}
          selfProfileId={profile.id}
          selfLabel={t("selfActor")}
          emptyLabel={t("historyEmpty")}
          transitionLabel={(from, to) => t("transitionSummary", { from, to })}
        />

        {/* The reply box sits UNDER the history, where a conversation goes.
            Anyone who can read this ticket can add to it: the requester chasing
            an update, the contractor reporting what they found. */}
        <TicketCommentForm
          ticketId={ticket.id}
          companyId={ticket.companyId}
          labels={{
            heading: t("commentHeading"),
            placeholder: t("commentPlaceholder"),
            submit: t("commentSubmit"),
            busy: t("commentBusy"),
            empty: t("commentEmpty"),
            genericError: tCommon("errors.generic"),
            unavailable: t("commentUnavailable"),
          }}
          className="mt-6"
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
