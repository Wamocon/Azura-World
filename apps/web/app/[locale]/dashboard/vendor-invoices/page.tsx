import { AlertTriangle, Download } from "lucide-react"
import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"
import type { ReactNode } from "react"

import { Link } from "@/app/navigation"
import { AccessRefused } from "@/components/finance/access-refused"
import {
  CurrencyTotalCard,
  MoneyCell,
  type CurrencyTotalLabels,
} from "@/components/finance/currency-total-list"
import { resolveFinanceScope } from "@/components/finance/finance-scope"
import {
  daysOverdue,
  duplicateInvoiceIds,
  findDuplicateInvoices,
  isOpenInvoice,
} from "@/components/finance/ledger-analysis"
import { toMinor, totalRows } from "@/components/finance/money"
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
import { cn } from "@/lib/cn"
import type { Locale } from "@/lib/contracts"
import { formatDate } from "@/lib/format"
import { vendorInvoiceStatuses } from "@/lib/finance-data"
import {
  currencyCodes,
  getVendorInvoices,
  type CurrencyCode,
  type VendorInvoice,
  type VendorInvoiceStatus,
} from "@/lib/finance-repository"

/**
 * /[locale]/dashboard/vendor-invoices                          Owner: W3-D
 *
 * ## "Open" is derived, because the ledger has no settlement status
 *
 * W1-A's decision 3 is the thing to understand before reading this page:
 * `ledger_entry_status` is `draft | posted | void` and nothing else, because
 * `open / partially_paid / paid / overdue` **cannot coexist with immutability**
 * — marking a posted row "paid" *is* an update of a posted row, which the
 * trigger rejects. Settlement therefore lives on `vendor_invoices.paid_amount`,
 * and "what is still owed" is computed from it here and in the repository, never
 * read from a status column that does not exist.
 *
 * The status column that DOES exist on this table is a workflow label
 * (`disputed`, `void`), not a settlement fact, and the database keeps the two
 * honest with `vendor_invoices_paid_status_agrees`: a row cannot claim `paid`
 * unless `paid_amount = total_amount`.
 *
 * ## Duplicate detection flags, it does not merge
 *
 * Vendor **and** invoice number **and** amount, all three, matched
 * case-insensitively on the first two and in integer minor units on the third.
 * Any one of them alone produces noise: numbers restart at 001 for every
 * contractor, and amounts repeat every month by design.
 *
 * Both rows in a pair are marked, and neither is hidden or reconciled away. Two
 * invoices that genuinely repeat a number and an amount do occur, and deciding
 * which one is real is a person's job, not a heuristic's.
 *
 * ## Overdue is measured against a server timestamp
 *
 * `result.fetchedAt` from the repository, not a browser clock. A device an hour
 * out would otherwise move an invoice across a month boundary into a different
 * ageing bucket with nothing on screen to explain the change.
 */

export const metadata: Metadata = {
  title: "Lieferantenrechnungen",
  robots: { index: false, follow: false },
}

const INVOICE_LIMIT = 500

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function VendorInvoicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): Promise<ReactNode> {
  const { locale } = await params
  const query = await searchParams

  const t = await getTranslations({
    locale,
    namespace: "dashboard.vendorInvoices",
  })
  const tEvidence = await getTranslations({ locale, namespace: "evidence" })
  const tCommon = await getTranslations({ locale, namespace: "common" })

  const scope = await resolveFinanceScope("vendor_invoices")
  if (!scope.allowed) {
    return (
      <AccessRefused
        title={t("title")}
        message={
          scope.reason === "unauthenticated"
            ? tCommon("errors.unauthorized")
            : t("forbidden")
        }
        hint={t("forbiddenHint")}
      />
    )
  }

  const rawStatus = first(query["status"])
  const activeStatus = (vendorInvoiceStatuses as readonly string[]).includes(
    rawStatus ?? ""
  )
    ? (rawStatus as VendorInvoiceStatus)
    : undefined
  const rawCurrency = first(query["currency"])
  const activeCurrency = (currencyCodes as readonly string[]).includes(
    rawCurrency ?? ""
  )
    ? (rawCurrency as CurrencyCode)
    : undefined

  const [allResult, filteredResult] = await Promise.all([
    // The unfiltered set, so duplicate detection sees the whole visible list.
    // A duplicate pair split by a status filter would otherwise go unflagged,
    // which is the case that matters most: a draft duplicating a paid invoice.
    getVendorInvoices({ ...scope.access, limit: INVOICE_LIMIT }),
    getVendorInvoices({
      ...scope.access,
      limit: INVOICE_LIMIT,
      ...(activeStatus === undefined ? {} : { status: activeStatus }),
      ...(activeCurrency === undefined ? {} : { currency: activeCurrency }),
    }),
  ])

  const allInvoices = allResult.data
  const invoices = filteredResult.data
  const seedMode =
    allResult.source === "local-seed" || filteredResult.source === "local-seed"
  const asOf = filteredResult.fetchedAt

  const duplicateGroups = findDuplicateInvoices(allInvoices)
  const duplicateIds = duplicateInvoiceIds(duplicateGroups)

  const gapLabel = tEvidence("confidence.gap")

  const totalLabels: CurrencyTotalLabels = {
    empty: t("emptyHint"),
    multiCurrencyNote: t("intro"),
    unreadableNote: (count) => `${tCommon("states.degraded")} (${count})`,
    overflowNote: () => tCommon("errors.generic"),
  }

  const openInvoices = allInvoices.filter(isOpenInvoice)
  const openTotals = totalRows(
    openInvoices,
    (invoice) => invoice.outstandingAmount,
    (invoice) => invoice.currency
  )
  const settledTotals = totalRows(
    allInvoices.filter(
      (invoice) => invoice.status !== "draft" && invoice.status !== "void"
    ),
    (invoice) => invoice.paidAmount,
    (invoice) => invoice.currency
  )
  const overdueTotals = totalRows(
    openInvoices.filter((invoice) => {
      const days = daysOverdue(invoice.dueOn, asOf)
      return days !== null && days > 0
    }),
    (invoice) => invoice.outstandingAmount,
    (invoice) => invoice.currency
  )

  const mayApprove = scope.can("vendor_invoices:approve")
  const mayExport = scope.can("vendor_invoices:export")

  const hrefFor = (next: {
    status?: VendorInvoiceStatus | null
    currency?: CurrencyCode | null
  }) => {
    const sp = new URLSearchParams()
    const status =
      next.status === undefined ? activeStatus : (next.status ?? undefined)
    const currency =
      next.currency === undefined ? activeCurrency : (next.currency ?? undefined)
    if (status !== undefined) sp.set("status", status)
    if (currency !== undefined) sp.set("currency", currency)
    const s = sp.toString()
    return `/dashboard/vendor-invoices${s ? `?${s}` : ""}`
  }

  const exportHref = (() => {
    const sp = new URLSearchParams()
    if (activeStatus !== undefined) sp.set("status", activeStatus)
    if (activeCurrency !== undefined) sp.set("currency", activeCurrency)
    const s = sp.toString()
    return `/dashboard/vendor-invoices/export${s ? `?${s}` : ""}`
  })()

  const statusLabels: Record<VendorInvoiceStatus, string> = {
    draft: t("status.draft"),
    open: t("status.open"),
    partially_paid: t("status.partially_paid"),
    paid: t("status.paid"),
    disputed: t("status.disputed"),
    void: t("status.void"),
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          {t("lead")}
        </p>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          {t("intro")}
        </p>
      </header>

      {seedMode ? (
        <p
          role="status"
          className="rounded-lg border border-confidence-gap/30 bg-confidence-gap/10 px-3 py-2 text-sm text-foreground"
        >
          {t("seedNotice")}
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        {/* The heading was missing until the acceptance run looked for it. Three
            labelled cards read as three unrelated numbers without it, and this
            is the section where "per currency" has to be said out loud. */}
        <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">
          {t("totals.heading")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <CurrencyTotalCard
          label={t("totals.open")}
          totals={openTotals}
          locale={locale}
          labels={totalLabels}
        />
        <CurrencyTotalCard
          label={t("totals.settled")}
          totals={settledTotals}
          locale={locale}
          labels={totalLabels}
        />
        <CurrencyTotalCard
          label={t("totals.overdue")}
          totals={overdueTotals}
          locale={locale}
          labels={totalLabels}
          hint={t("overdue.label")}
        />
        </div>
      </section>

      {/* ---------------- Duplicates ---------------------------------------- */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">
            {t("duplicates.heading")}
          </h2>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            {t("duplicates.description")}
          </p>
        </div>
        {duplicateGroups.length === 0 ? (
          <p className="rounded-xl border border-confidence-confirmed/30 bg-confidence-confirmed/5 px-4 py-3 text-sm text-foreground">
            {t("duplicates.none")}{" "}
            <span className="text-muted-foreground">
              {t("duplicates.matchOn")}
            </span>
          </p>
        ) : (
          <>
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <AlertTriangle className="size-4" aria-hidden="true" />
              {t("duplicates.flagged", { count: duplicateGroups.length })}
            </p>
            <ul className="flex flex-col gap-2">
              {duplicateGroups.map((group) => (
                <li
                  key={`${group.vendorName}|${group.invoiceNo}`}
                  className="rounded-xl border border-confidence-conflicted/40 bg-confidence-conflicted/5 px-4 py-3 text-sm"
                >
                  <span className="font-semibold text-foreground">
                    {group.vendorName} {group.invoiceNo}
                  </span>
                  <span className="ml-2 text-muted-foreground">
                    {group.invoiceIds.length}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              {t("duplicates.matchOn")}
            </p>
          </>
        )}
      </section>

      {/* ---------------- Filters ------------------------------------------- */}
      <nav
        aria-label={t("title")}
        className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip
            href={hrefFor({ status: null })}
            active={activeStatus === undefined}
          >
            {tCommon("filters.none")}
          </FilterChip>
          {vendorInvoiceStatuses.map((status) => (
            <FilterChip
              key={status}
              href={hrefFor({ status })}
              active={activeStatus === status}
            >
              {statusLabels[status]}
            </FilterChip>
          ))}
        </div>
        {mayExport ? (
          <a
            href={exportHref}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:ml-auto"
          >
            <Download className="size-3.5" aria-hidden="true" />
            {t("export.csv")}
          </a>
        ) : null}
      </nav>

      {/* ---------------- The list ------------------------------------------ */}
      <section className="flex flex-col gap-3">
        {invoices.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-input px-6 py-10 text-center">
            <p className="font-display text-base font-semibold text-foreground">
              {t("empty")}
            </p>
            <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
              {t("emptyHint")}
            </p>
          </div>
        ) : (
          <TableScrollArea height={520}>
            <Table>
              <TableCaption>
                {tCommon("pagination.showing", {
                  from: 1,
                  to: invoices.length,
                  total: allInvoices.length,
                })}
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.vendor")}</TableHead>
                  <TableHead>{t("columns.invoiceNo")}</TableHead>
                  <TableHead>{t("columns.status")}</TableHead>
                  <TableHead>{t("columns.issued")}</TableHead>
                  <TableHead>{t("columns.due")}</TableHead>
                  <TableHead className="text-right">
                    {t("columns.total")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("columns.paid")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("columns.outstanding")}
                  </TableHead>
                  <TableHead>{t("columns.currency")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => (
                  <InvoiceRow
                    key={invoice.id}
                    invoice={invoice}
                    locale={locale}
                    asOf={asOf}
                    gapLabel={gapLabel}
                    isDuplicate={duplicateIds.has(invoice.id)}
                    statusLabel={statusLabels[invoice.status]}
                    labels={{
                      overdueDays: (days) => t("overdue.days", { days }),
                      notDue: t("overdue.notDue"),
                      noDueDate: t("overdue.noDueDate"),
                      duplicate: t("duplicates.heading"),
                    }}
                  />
                ))}
              </TableBody>
            </Table>
          </TableScrollArea>
        )}
        {mayExport ? (
          <p className="text-xs text-muted-foreground">{t("export.hint")}</p>
        ) : null}
      </section>

      {/* ---------------- Approval ------------------------------------------ */}
      <section className="flex flex-col gap-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">
          {t("approval.heading")}
        </h2>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          {mayApprove ? t("approval.canApprove") : t("approval.cannotApprove")}
        </p>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          {t("approval.settleHint")}
        </p>
        <p className="max-w-prose text-sm">
          <Link
            href="/dashboard/finance"
            className="underline decoration-dotted underline-offset-4 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t("approval.settle")}
          </Link>
        </p>
      </section>
    </div>
  )
}

interface InvoiceRowLabels {
  overdueDays: (days: number) => string
  notDue: string
  noDueDate: string
  duplicate: string
}

function InvoiceRow({
  invoice,
  locale,
  asOf,
  gapLabel,
  isDuplicate,
  statusLabel,
  labels,
}: {
  invoice: VendorInvoice
  locale: Locale
  asOf: string
  gapLabel: string
  isDuplicate: boolean
  statusLabel: string
  labels: InvoiceRowLabels
}): ReactNode {
  const days = daysOverdue(invoice.dueOn, asOf)
  const overdue = isOpenInvoice(invoice) && days !== null && days > 0

  return (
    <TableRow
      data-duplicate={isDuplicate ? "" : undefined}
      className={cn(
        "border-l-2",
        isDuplicate
          ? "border-l-confidence-conflicted bg-confidence-conflicted/5"
          : overdue
            ? "border-l-confidence-inferred"
            : "border-l-transparent"
      )}
    >
      <TableCell className="max-w-[14rem] truncate font-medium">
        {invoice.vendorName}
        {isDuplicate ? (
          // Visible marker, not colour alone. The row tint is the fast signal
          // while scanning; this is the one that survives a screenshot in
          // greyscale and reaches a screen reader.
          <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-confidence-conflicted/50 px-2 py-0.5 text-[0.6875rem] text-confidence-conflicted">
            <AlertTriangle className="size-3" aria-hidden="true" />
            {labels.duplicate}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="font-mono text-xs whitespace-nowrap">
        {invoice.invoiceNo}
      </TableCell>
      <TableCell className="whitespace-nowrap">{statusLabel}</TableCell>
      <TableCell className="tabular-nums whitespace-nowrap">
        {formatDate(invoice.issuedOn, locale)}
      </TableCell>
      <TableCell className="tabular-nums whitespace-nowrap">
        {invoice.dueOn === null ? (
          <span className="text-muted-foreground">{labels.noDueDate}</span>
        ) : (
          <>
            {formatDate(invoice.dueOn, locale)}
            <span
              className={cn(
                "mt-0.5 block text-xs",
                overdue ? "text-confidence-conflicted" : "text-muted-foreground"
              )}
            >
              {overdue && days !== null
                ? labels.overdueDays(days)
                : labels.notDue}
            </span>
          </>
        )}
      </TableCell>
      <TableCell className="text-right">
        <MoneyCell
          minor={toMinor(invoice.totalAmount)}
          currency={invoice.currency}
          locale={locale}
          gapLabel={gapLabel}
        />
      </TableCell>
      <TableCell className="text-right">
        <MoneyCell
          minor={toMinor(invoice.paidAmount)}
          currency={invoice.currency}
          locale={locale}
          gapLabel={gapLabel}
        />
      </TableCell>
      <TableCell className="text-right">
        <MoneyCell
          minor={toMinor(invoice.outstandingAmount)}
          currency={invoice.currency}
          locale={locale}
          gapLabel={gapLabel}
          className="font-semibold"
        />
      </TableCell>
      <TableCell className="font-mono text-[0.6875rem] tracking-[0.14em] uppercase">
        {invoice.currency ?? (
          <span className="text-confidence-gap">{gapLabel}</span>
        )}
      </TableCell>
    </TableRow>
  )
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: ReactNode
}): ReactNode {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-sm transition-colors",
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
