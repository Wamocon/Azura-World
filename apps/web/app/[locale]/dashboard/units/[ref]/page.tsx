import { FileText, Receipt, Wrench } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import type { ReactNode } from "react"

import { Link } from "@/app/navigation"
import {
  DashboardKpiGrid,
  DashboardPageHeader,
  DashboardSection,
} from "@/components/dashboard/section"
import {
  UnitProvenanceBadge,
  type UnitProvenanceLabels,
} from "@/components/inventory/unit-provenance-badge"
import {
  ticketPriorityLabels,
  ticketStatusLabels,
} from "@/components/operations/labels"
import {
  TicketPriorityBadge,
  TicketStatusBadge,
} from "@/components/operations/ticket-status-badge"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { getUserProfile } from "@/lib/auth"
import type { Locale } from "@/lib/contracts"
import { getDocuments } from "@/lib/document-repository"
import { getLedgerEntries } from "@/lib/finance-repository"
import { formatDate, formatMoney, formatNumber } from "@/lib/format"
import { getUnit } from "@/lib/inventory-repository"
import { getTickets } from "@/lib/operations-repository"
import { encodePublicId } from "@/lib/public-id"
import { hasPermission } from "@/lib/rbac"

/**
 * /[locale]/dashboard/units/[ref] — one apartment, and everything about it.
 *                                                             Owner: W-NIGHT
 *
 * ## Why this route had to exist
 *
 * The inventory page renders 656 units as a matrix and opens a popup with the
 * unit's own columns — layout, area, price, sale status, provenance. That is a
 * catalogue. What it could not answer is any question that crosses a module:
 * *does this apartment have anything open? what does it owe? what paperwork is
 * on file?* Each of those lives on a different page, filtered by nothing, and a
 * unit page that does not show the unit's open tickets is not an ERP — it is a
 * spreadsheet with a navigation bar.
 *
 * So this is the hub. Every section is one scoped read of an existing
 * repository, and every row links onward.
 *
 * ## Each section is present only if the reader may have it
 *
 * Not "empty for them" — **absent**, and not read either. A tenant standing in
 * their own apartment sees their open requests and their documents; they do not
 * see a Finance heading with a permission notice under it, because the heading
 * itself would tell them a ledger exists for this unit. The reads are behind
 * the same conditionals as the sections, so nothing is fetched for a caller who
 * cannot see it — the W3-C measurement (a `tenant` receiving evidence data in
 * the RSC payload while the visible page showed a 403) is the reason that
 * distinction is enforced at the fetch and not at the render.
 *
 * ## Scope is the repository's business
 *
 * `getUnit(id, scope)` returns `null` for a unit outside the caller's scope,
 * and this page 404s — the same answer as a unit that does not exist. The
 * ticket, ledger and document reads are all scoped the same way, so a tenant
 * asking for a neighbour's apartment gets a 404 rather than a page with empty
 * sections, which would confirm the unit exists.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.units" })
  return {
    title: t("title"),
    robots: { index: false, follow: false },
  }
}

/** Enough to see the shape of the workload without becoming a second queue. */
const TICKET_LIMIT = 12
const DOCUMENT_LIMIT = 12
const LEDGER_LIMIT = 200

export default async function UnitDetailPage({
  params,
}: {
  params: Promise<{ locale: Locale; ref: string }>
}) {
  const { locale, ref } = await params

  /**
   * The segment IS the apartment number, and that is correct here.
   *
   * Everywhere else in this product a URL carries an opaque token, because the
   * alternative is a database primary key on screen. `units.id` is not one: it
   * is `AZW-B01-0003`, the building's own designation, printed beside the door
   * and published on the landing page. Wrapping it in a cipher would hide
   * nothing and would make a link nobody could read or type.
   *
   * The shape is still checked before it reaches a query. Not for safety — the
   * client is parameterised and RLS decides the rest — but so that a crawler
   * asking for `/dashboard/units/wp-admin` gets a 404 from this line instead of
   * a database round trip.
   */
  const id = decodeURIComponent(ref).toUpperCase()
  if (!/^AZW-B\d{2}-\d{4}$/u.test(id)) notFound()

  const t = await getTranslations({ locale, namespace: "dashboard.units" })
  const tTickets = await getTranslations({
    locale,
    namespace: "dashboard.tickets",
  })
  const tCommon = await getTranslations({ locale, namespace: "common" })
  const profile = await getUserProfile()

  if (!profile.authenticated || !hasPermission(profile.role, "units:view")) {
    notFound()
  }

  const scope = {
    role: profile.role,
    ...(profile.id === null ? {} : { profileId: profile.id }),
  }

  const unitResult = await getUnit(id, scope)
  const unit = unitResult.data
  if (unit === null) notFound()

  const mayReadTickets = hasPermission(profile.role, "tickets:view")
  const mayReadDocuments = hasPermission(profile.role, "documents:view")
  const mayReadFinance = hasPermission(profile.role, "finance:view")

  const [ticketResult, documentResult, ledgerResult] = await Promise.all([
    mayReadTickets
      ? getTickets({ ...scope, unitId: id, limit: TICKET_LIMIT })
      : Promise.resolve(null),
    mayReadDocuments
      ? getDocuments({ ...scope, unitId: id, limit: DOCUMENT_LIMIT })
      : Promise.resolve(null),
    mayReadFinance
      ? getLedgerEntries({ ...scope, unitId: id, limit: LEDGER_LIMIT })
      : Promise.resolve(null),
  ])

  const tickets = ticketResult?.data ?? []
  const documents = documentResult?.data ?? []
  const ledger = ledgerResult?.data ?? []

  const openTickets = tickets.filter(
    (ticket) =>
      ticket.status !== "resolved" &&
      ticket.status !== "closed" &&
      ticket.status !== "cancelled"
  )

  /**
   * What this apartment owes, per currency.
   *
   * Kept apart by currency and never summed across them — CONVENTIONS §5, and
   * the same rule the finance page applies. A single "balance" number here
   * would be adding euros to lira, which is the F-002 defect this product was
   * built to point at.
   */
  const balances = new Map<string, number>()
  for (const entry of ledger) {
    // `signedAmount` is the generated `debit_amount - credit_amount`, so a
    // positive total is owed TO the building. Summing it rather than choosing a
    // side keeps this arithmetic identical to the finance page's, which is the
    // only way the two can be made to agree. `null` means unreadable and is
    // skipped, never counted as zero.
    if (entry.currency === null || entry.signedAmount === null) continue
    balances.set(
      entry.currency,
      (balances.get(entry.currency) ?? 0) + entry.signedAmount
    )
  }

  const statusLabels = ticketStatusLabels(tTickets)
  const priorityLabels = ticketPriorityLabels(tTickets)
  const provenanceLabels: UnitProvenanceLabels = {
    portal_listing: t("provenance.portal_listing"),
    official: t("provenance.official"),
    modelled: t("provenance.modelled"),
    source_missing: t("provenance.source_missing"),
  }

  const saleStatus = unit.saleStatus.value
  const price = unit.askingPrice.value

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <nav className="text-sm">
        <Link
          href="/dashboard/units"
          className="rounded text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {tCommon("actions.back")}
        </Link>
      </nav>

      <DashboardPageHeader
        title={unit.id}
        description={t("detail.lead", {
          layout: unit.layout,
          block: unit.blockName ?? unit.blockCode,
        })}
      />

      <div className="flex flex-wrap items-center gap-2">
        <UnitProvenanceBadge
          dataQuality={unit.dataQuality}
          labels={provenanceLabels}
        />
        <Badge variant={saleStatus === "available" ? "single" : "muted"}>
          {saleStatus === null
            ? t("status.notStated")
            : t(`status.${saleStatus}`)}
        </Badge>
      </div>

      {/* The apartment's own columns. Every absence is stated: an area nobody
          published is "not stated", never 0 m². */}
      <DashboardSection title={t("detail.facts")}>
        <dl className="grid [grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3">
          <Fact
            label={t("columns.floor")}
            value={
              unit.floorLevel === null
                ? t("detail.notStated")
                : String(unit.floorLevel)
            }
          />
          <Fact
            label={t("columns.area")}
            value={
              unit.interiorM2 === null
                ? t("detail.notStated")
                : `${formatNumber(unit.interiorM2, locale)} m²`
            }
          />
          <Fact
            label={t("columns.outdoor")}
            value={
              unit.outdoorM2 === null
                ? t("detail.notStated")
                : `${formatNumber(unit.outdoorM2, locale)} m²`
            }
          />
          <Fact
            label={t("columns.price")}
            value={
              price === null
                ? t("detail.notStated")
                : formatMoney(price, locale)
            }
          />
        </dl>
      </DashboardSection>

      {/* ------------------------------------------------------------------ */}
      {ticketResult === null ? null : (
        <DashboardSection
          title={t("detail.requests")}
          description={t("detail.requestsLead")}
        >
          <DashboardKpiGrid>
            <Kpi
              label={t("detail.openRequests")}
              value={formatNumber(openTickets.length, locale)}
            />
            <Kpi
              label={t("detail.allRequests")}
              value={formatNumber(tickets.length, locale)}
            />
          </DashboardKpiGrid>

          {tickets.length === 0 ? (
            <EmptyState
              icon={Wrench}
              title={t("detail.noRequests")}
              description={t("detail.noRequestsLead")}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {tickets.map((ticket) => (
                <li key={ticket.id}>
                  <Link
                    href={`/dashboard/tickets/${encodePublicId("ticket", ticket.id)}`}
                    locale={locale}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-input px-3 py-2.5 transition-colors duration-150 ease-[var(--ease-out)] hover:border-foreground/25 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <span className="font-mono text-sm tabular-nums text-muted-foreground">
                      {ticket.ticketNo}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {ticket.title}
                    </span>
                    <TicketPriorityBadge
                      priority={ticket.priority}
                      labels={priorityLabels}
                    />
                    <TicketStatusBadge
                      status={ticket.status}
                      labels={statusLabels}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </DashboardSection>
      )}

      {/* ------------------------------------------------------------------ */}
      {ledgerResult === null ? null : (
        <DashboardSection
          title={t("detail.money")}
          description={t("detail.moneyLead")}
        >
          {balances.size === 0 ? (
            <EmptyState
              icon={Receipt}
              title={t("detail.noMoney")}
              description={t("detail.noMoneyLead")}
            />
          ) : (
            <>
              <DashboardKpiGrid>
                {[...balances.entries()].map(([currency, amount]) => (
                  <Kpi
                    key={currency}
                    label={t("detail.outstandingIn", { currency })}
                    value={formatMoney(
                      {
                        amount,
                        currency: currency as "EUR" | "USD" | "TRY" | "GBP",
                      },
                      locale
                    )}
                  />
                ))}
              </DashboardKpiGrid>
              <p className="text-xs text-muted-foreground">
                {t("detail.moneyNote", { count: ledger.length })}
              </p>
              <div>
                <Link
                  // The statement for THIS apartment, not the finance module.
                  // A link that lands on a company-wide ledger, from a page
                  // about one flat, makes the reader find their own row again.
                  href={`/dashboard/finance/statement/${encodeURIComponent(unit.id)}`}
                  locale={locale}
                  className="rounded text-sm underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {t("detail.openFinance")}
                </Link>
              </div>
            </>
          )}
        </DashboardSection>
      )}

      {/* ------------------------------------------------------------------ */}
      {documentResult === null ? null : (
        <DashboardSection
          title={t("detail.documents")}
          description={t("detail.documentsLead")}
        >
          {documents.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={t("detail.noDocuments")}
              description={t("detail.noDocumentsLead")}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {documents.map((document) => (
                <li
                  key={document.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-input px-3 py-2.5"
                >
                  <FileText
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {document.title}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatDate(document.createdAt, locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div>
            <Link
              href="/dashboard/documents"
              locale={locale}
              className="rounded text-sm underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {t("detail.openDocuments")}
            </Link>
          </div>
        </DashboardSection>
      )}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-input px-3 py-2.5">
      <dt className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="min-w-0 truncate text-sm tabular-nums">{value}</dd>
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border p-4">
      <span className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
    </div>
  )
}
