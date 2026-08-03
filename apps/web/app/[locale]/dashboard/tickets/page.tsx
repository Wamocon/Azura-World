import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"

import { Link } from "@/app/navigation"
import {
  TicketPriorityBadge,
  TicketStatusBadge,
} from "@/components/operations/ticket-status-badge"
import { SlaIndicator } from "@/components/operations/sla-indicator"
import {
  slaLabels,
  ticketCategoryLabels,
  ticketPriorityLabels,
  ticketStatusLabels,
} from "@/components/operations/labels"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScrollArea,
} from "@/components/ui/table"
import { getUserProfile } from "@/lib/auth"
import { cn } from "@/lib/cn"
import type { Locale } from "@/lib/contracts"
import { formatDateTime } from "@/lib/format"
import { getGlossary } from "@/lib/glossary"
import { NewRequestForm } from "@/components/operations/new-request-form"
import {
  getOperationsSummary,
  getOwnUnitIds,
  getTickets,
  type ServiceTicket,
} from "@/lib/operations-repository"
import {
  ticketCategories,
  ticketPriorities,
  ticketStatuses,
  type TicketStatus,
} from "@/lib/operations-data"
import { hasPermission } from "@/lib/rbac"
import { assessSla, closedOutStatuses } from "@/lib/ticket-workflow"

/**
 * /[locale]/dashboard/tickets — the ticket queue.             Owner: W3-E
 *
 * A Server Component with no JavaScript of its own: filters and paging are
 * links, exactly as `dashboard/units` does it, so the page works with scripts
 * blocked and cannot be broken by the CSP class of failure that cost a night
 * earlier in this project. The one client island in this module is the
 * transition bar on the detail page, where interactivity is unavoidable.
 *
 * **`service_provider` scoping is the repository's, not this page's.**
 * `getTickets({ role, profileId })` mirrors the SELECT policies of migration 06;
 * a contractor receives only tickets reachable from their assigned tasks. The
 * counts in the header come from `getOperationsSummary()` under the **same
 * scope**, which is the part that is easy to get wrong: a total computed from an
 * unscoped query would tell a contractor how many tickets exist that they cannot
 * see, and that is a disclosure even though no row is rendered.
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

const PAGE_SIZE = 50

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function parsePage(value: string | string[] | undefined): number {
  const raw = first(value)
  const parsed = Number.parseInt(raw ?? "1", 10)
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1
}

function isTicketStatus(value: string | undefined): value is TicketStatus {
  return (
    value !== undefined && (ticketStatuses as readonly string[]).includes(value)
  )
}

export default async function TicketsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale } = await params
  const query = await searchParams

  const t = await getTranslations({ locale, namespace: "dashboard.tickets" })
  const tCommon = await getTranslations({ locale, namespace: "common" })
  const profile = await getUserProfile()

  // Re-checked here even though the nav hides the entry and the shell guard has
  // already run. CONVENTIONS §2: assume the URL was typed.
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

  const statusFilter = first(query["status"])
  const activeStatus = isTicketStatus(statusFilter) ? statusFilter : undefined
  const breachedOnly = first(query["sla"]) === "breached"
  const page = parsePage(query["page"])
  const offset = (page - 1) * PAGE_SIZE

  const [summaryResult, ticketsResult] = await Promise.all([
    getOperationsSummary(scope),
    getTickets({
      ...scope,
      limit: PAGE_SIZE,
      offset,
      ...(activeStatus === undefined ? {} : { status: activeStatus }),
      ...(breachedOnly ? { slaBreachedOnly: true } : {}),
    }),
  ])

  const summary = summaryResult.data
  const tickets = ticketsResult.data
  const degraded =
    summaryResult.source === "local-seed" ||
    ticketsResult.source === "local-seed"

  const statusLabels = ticketStatusLabels(t)
  const priorityLabels = ticketPriorityLabels(t)
  const categoryLabels = ticketCategoryLabels(t)
  const sla = slaLabels(t)

  // The "report a problem" control. `tickets:create` is held by owner, tenant,
  // manager, staff and admin — not by `guest`, and not by the `child_*` roles,
  // which is the RBAC layer being deliberately stricter than the row policy
  // (which admits level >= 8). Narrower is safe; wider would not be.
  //
  // The picker offers the homes the reader HOLDS. `getUnits` would return homes
  // they can merely see — part of the inventory is public for the sales side —
  // and every one of those would be refused on submit.
  const canCreate = hasPermission(profile.role, "tickets:create")
  const ownUnitIds = canCreate
    ? (await getOwnUnitIds(profile.id)).data
    : []
  const glossary = await getGlossary(locale)

  // One instant for the whole page. Reading the clock per row makes a long list
  // disagree with itself about what "overdue" means between the first row and
  // the last.
  const asOf = summary.asOf

  const filteredTotal = activeStatus
    ? summary.ticketsByStatus[activeStatus]
    : breachedOnly
      ? summary.slaBreachedTickets
      : Object.values(summary.ticketsByStatus).reduce((a, b) => a + b, 0)
  const pageCount = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE))
  const from = filteredTotal === 0 ? 0 : offset + 1
  const to = Math.min(offset + tickets.length, filteredTotal)

  const hrefFor = (next: {
    status?: TicketStatus | null
    sla?: "breached" | null
    page?: number
  }) => {
    const sp = new URLSearchParams()
    const status =
      next.status === undefined ? activeStatus : (next.status ?? undefined)
    if (status) sp.set("status", status)
    const slaValue =
      next.sla === undefined
        ? breachedOnly
          ? "breached"
          : undefined
        : (next.sla ?? undefined)
    if (slaValue) sp.set("sla", slaValue)
    const p = next.page ?? 1
    if (p > 1) sp.set("page", String(p))
    const search = sp.toString()
    return `/dashboard/tickets${search ? `?${search}` : ""}`
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t("title")}
          </h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            {t("lead")}
          </p>
        </div>
        {canCreate ? (
          <NewRequestForm
            unitIds={ownUnitIds}
            categories={ticketCategories}
            priorities={ticketPriorities}
            labels={{
              trigger: t("create.trigger"),
              heading: t("create.heading"),
              lead: t("create.lead"),
              titleLabel: t("create.titleLabel"),
              titlePlaceholder: t("create.titlePlaceholder"),
              whereLabel: t("create.whereLabel"),
              whereCommon: t("create.whereCommon"),
              categoryLabel: t("create.categoryLabel"),
              priorityLabel: t("create.priorityLabel"),
              descriptionLabel: t("create.descriptionLabel"),
              descriptionPlaceholder: t("create.descriptionPlaceholder"),
              submit: t("create.submit"),
              busy: t("create.busy"),
              cancel: tCommon("actions.cancel"),
              close: tCommon("actions.close"),
              titleRequired: t("create.titleRequired"),
              genericError: t("create.genericError"),
              unavailable: t("create.unavailable"),
              afterNote: t("create.afterNote"),
              categories: categoryLabels,
              priorities: priorityLabels,
              priorityExplain: glossary.priority,
            }}
          />
        ) : null}
      </header>

      {degraded ? (
        <p
          role="status"
          className="rounded-lg border border-confidence-gap/30 bg-confidence-gap/10 px-3 py-2 text-sm text-foreground"
        >
          {t("seedNotice")}
        </p>
      ) : null}

      {/* The response targets are this window's assumption, not a published
          figure. Said once, plainly, above the column that uses them. */}
      <p className="max-w-prose text-xs text-muted-foreground">
        {t("slaAssumption")}
      </p>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t("stats.open")} value={summary.openTickets} />
        <Stat
          label={t("stats.breached")}
          value={summary.slaBreachedTickets}
          emphasis={summary.slaBreachedTickets > 0}
        />
        <Stat
          label={t("stats.unassigned")}
          value={summary.unassignedOpenTickets}
        />
        <Stat
          label={t("stats.awaitingApproval")}
          value={summary.ticketsAwaitingFinanceApproval}
        />
      </dl>

      <nav
        aria-label={t("filterLabel")}
        className="flex flex-wrap items-center gap-2"
      >
        <FilterChip
          href={hrefFor({ status: null, sla: null })}
          active={activeStatus === undefined && !breachedOnly}
        >
          {t("filterAll")}
        </FilterChip>
        {ticketStatuses
          .filter((status) => summary.ticketsByStatus[status] > 0)
          .map((status) => (
            <FilterChip
              key={status}
              href={hrefFor({ status, sla: null })}
              active={activeStatus === status}
            >
              {statusLabels[status]}
              <span className="ml-1.5 tabular-nums opacity-70">
                {summary.ticketsByStatus[status]}
              </span>
            </FilterChip>
          ))}
        <FilterChip
          href={hrefFor({ status: null, sla: "breached" })}
          active={breachedOnly}
        >
          {sla.breached}
          <span className="ml-1.5 tabular-nums opacity-70">
            {summary.slaBreachedTickets}
          </span>
        </FilterChip>
      </nav>

      {tickets.length === 0 ? (
        <p className="rounded-lg border border-border bg-background/50 p-6 text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <TableScrollArea height={640}>
          <Table>
            <TableCaption>
              {tCommon("pagination.showing", {
                from,
                to,
                total: filteredTotal,
              })}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.reference")}</TableHead>
                <TableHead>{t("columns.subject")}</TableHead>
                <TableHead>{t("columns.category")}</TableHead>
                <TableHead>{t("columns.unit")}</TableHead>
                <TableHead>{t("columns.priority")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead>{t("columns.sla")}</TableHead>
                <TableHead>{t("columns.reportedAt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickets.map((ticket) => (
                <TicketRow
                  key={ticket.id}
                  ticket={ticket}
                  locale={locale}
                  asOf={asOf}
                  statusLabels={statusLabels}
                  priorityLabels={priorityLabels}
                  categoryLabels={categoryLabels}
                  slaLabelSet={sla}
                  noValue={t("noValue")}
                  ageLabel={(age) => t("age", { age })}
                  hourUnit={t("hourUnit")}
                  dayUnit={t("dayUnit")}
                />
              ))}
            </TableBody>
          </Table>
        </TableScrollArea>
      )}

      {pageCount > 1 ? (
        <nav
          aria-label={tCommon("pagination.page")}
          className="flex items-center gap-3"
        >
          {page > 1 ? (
            <PageLink href={hrefFor({ page: page - 1 })}>
              {tCommon("pagination.first")}
            </PageLink>
          ) : null}
          <span className="text-sm text-muted-foreground tabular-nums">
            {tCommon("pagination.pageOf", { page, total: pageCount })}
          </span>
          {page < pageCount ? (
            <PageLink href={hrefFor({ page: page + 1 })}>
              {tCommon("pagination.last")}
            </PageLink>
          ) : null}
        </nav>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------

function TicketRow({
  ticket,
  locale,
  asOf,
  statusLabels,
  priorityLabels,
  categoryLabels,
  slaLabelSet,
  noValue,
  ageLabel,
  hourUnit,
  dayUnit,
}: {
  ticket: ServiceTicket
  locale: Locale
  asOf: string
  statusLabels: Record<TicketStatus, string>
  priorityLabels: Parameters<typeof TicketPriorityBadge>[0]["labels"]
  categoryLabels: Record<string, string>
  slaLabelSet: Parameters<typeof SlaIndicator>[0]["labels"]
  noValue: string
  ageLabel: (age: string) => string
  hourUnit: string
  dayUnit: string
}) {
  const assessment = assessSla(ticket, asOf)
  const settled = closedOutStatuses.includes(ticket.status)

  return (
    <TableRow
      className={cn(
        "border-l-2",
        assessment.state === "breached"
          ? "border-l-destructive"
          : settled
            ? "border-l-transparent bg-muted/20"
            : "border-l-transparent"
      )}
    >
      <TableCell className="font-medium tabular-nums">
        <Link
          href={`/dashboard/tickets/${ticket.id}`}
          className="rounded text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {ticket.ticketNo}
        </Link>
      </TableCell>
      <TableCell className="max-w-72">
        <span className="block truncate">{ticket.title}</span>
      </TableCell>
      <TableCell>
        {categoryLabels[ticket.category] ?? ticket.category}
      </TableCell>
      <TableCell className="tabular-nums">
        {ticket.unitId === null ? (
          <span className="text-muted-foreground">{noValue}</span>
        ) : (
          ticket.unitId
        )}
      </TableCell>
      <TableCell>
        <TicketPriorityBadge
          priority={ticket.priority}
          labels={priorityLabels}
        />
      </TableCell>
      <TableCell>
        <TicketStatusBadge status={ticket.status} labels={statusLabels} />
      </TableCell>
      <TableCell>
        <SlaIndicator
          assessment={assessment}
          labels={slaLabelSet}
          ageLabel={ageLabel}
          hourUnit={hourUnit}
          dayUnit={dayUnit}
        />
      </TableCell>
      <TableCell className="text-xs text-muted-foreground tabular-nums">
        {formatDateTime(ticket.reportedAt, locale)}
      </TableCell>
    </TableRow>
  )
}

function Stat({
  label,
  value,
  emphasis,
}: {
  label: string
  value: number
  emphasis?: boolean
}) {
  return (
    <div className="rounded-lg border border-border bg-background/50 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-xl tabular-nums",
          emphasis ? "font-semibold text-destructive" : "text-foreground"
        )}
      >
        {value}
      </dd>
    </div>
  )
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex min-h-6 items-center rounded-full border px-3 py-1 text-sm transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:border-primary hover:text-foreground"
      )}
    >
      {children}
    </Link>
  )
}

function PageLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {children}
    </Link>
  )
}
