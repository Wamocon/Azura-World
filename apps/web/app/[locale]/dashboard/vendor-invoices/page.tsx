import { AlertTriangle, Download } from "lucide-react"
import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"
import type { ReactNode } from "react"

import { Link } from "@/app/navigation"
import { AccessRefused } from "@/components/finance/access-refused"
import {
  CurrencyTotalCard,
  type CurrencyTotalLabels,
} from "@/components/finance/currency-total-list"
import { anyRefused, readFinance } from "@/components/finance/finance-read"
import { resolveFinanceScope } from "@/components/finance/finance-scope"
import {
  daysOverdue,
  duplicateInvoiceIds,
  findDuplicateInvoices,
  isOpenInvoice,
} from "@/components/finance/ledger-analysis"
import { toMinor, totalRows } from "@/components/finance/money"
import {
  VendorInvoiceTable,
  type VendorInvoiceRow,
  type VendorInvoiceTableLabels,
} from "@/components/finance/vendor-invoice-detail"
import { cn } from "@/lib/cn"
import type { Locale } from "@/lib/contracts"
import { vendorInvoiceStatuses } from "@/lib/finance-data"
import {
  currencyCodes,
  getVendorInvoices,
  type CurrencyCode,
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
 *
 * ## Nine columns on screen, the whole record one click away
 *
 * The table is `components/finance/vendor-invoice-detail.tsx`, a client island,
 * because a row has to be clickable and a Server Component cannot hold the
 * selection. This page keeps the shape the pattern requires of it: it flattens
 * each `VendorInvoice` into a slim serialisable row, converts every decimal to
 * `Minor` **here, once**, and resolves every string — including the two that
 * carry placeholders, `overdue.days` and `detail.open` — before anything crosses
 * the boundary. No rich domain object and no function prop goes over.
 *
 * The nine columns are unchanged; the popup is where `taxAmount`, `notes`,
 * `ledgerEntryId`, `version` and the two timestamps become readable for the
 * first time. Widening the table instead was the alternative and it is worse:
 * at nine columns this list already scrolls sideways on a phone.
 *
 * `siteId` and `vendorProfileId` are **not** in that list and are not sent at
 * all. `vendor_invoices:view` is held by `service_provider` — an outside
 * contractor — and both are uuids naming rows this surface never reads, so
 * neither could render as anything but noise. Removing them from the popup
 * alone would have changed nothing that matters: the row object is serialised
 * into the RSC payload, so they were still in the response. `documentPath` is
 * reduced to its last segment for the same reason — the directories above the
 * file are our storage layout, and the second of them is the tenancy uuid.
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
  const t = await getTranslations({ locale, namespace: "dashboard.vendorInvoices" })
  return {
    title: t("title"),
    robots: { index: false, follow: false },
  }
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

  // Every read goes through `readFinance`, so a repository refusal renders the
  // refusal panel instead of throwing into the error boundary. CONTRACTS §5:
  // never 500 for a handled condition. See `components/finance/finance-read.ts`.
  const ctx = {
    surface: "vendor_invoices",
    role: scope.role,
    profileId: scope.profileId,
  } as const
  const [allRead, filteredRead] = await Promise.all([
    // The unfiltered set, so duplicate detection sees the whole visible list.
    // A duplicate pair split by a status filter would otherwise go unflagged,
    // which is the case that matters most: a draft duplicating a paid invoice.
    readFinance(
      () => getVendorInvoices({ ...scope.access, limit: INVOICE_LIMIT }),
      { ...ctx, target: "vendor_invoices (all)" }
    ),
    readFinance(
      () =>
        getVendorInvoices({
          ...scope.access,
          limit: INVOICE_LIMIT,
          ...(activeStatus === undefined ? {} : { status: activeStatus }),
          ...(activeCurrency === undefined ? {} : { currency: activeCurrency }),
        }),
      { ...ctx, target: "vendor_invoices (filtered)" }
    ),
  ])

  if (anyRefused([allRead, filteredRead])) {
    return (
      <AccessRefused
        title={t("title")}
        message={t("forbidden")}
        hint={t("forbiddenHint")}
      />
    )
  }
  if (!allRead.ok || !filteredRead.ok) {
    return (
      <AccessRefused
        title={t("title")}
        message={tCommon("errors.serverError")}
        hint={tCommon("errors.tryAgain")}
      />
    )
  }

  const allResult = allRead.value
  const filteredResult = filteredRead.value

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
      next.currency === undefined
        ? activeCurrency
        : (next.currency ?? undefined)
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

  // The decimal → integer boundary, crossed once for the whole page, exactly
  // where `components/finance/money.ts` says it belongs. Nothing downstream of
  // this map sees a `number` that is money.
  const rows: VendorInvoiceRow[] = invoices.map((invoice) => {
    const days = daysOverdue(invoice.dueOn, asOf)
    const overdue = isOpenInvoice(invoice) && days !== null && days > 0
    return {
      id: invoice.id,
      vendorName: invoice.vendorName,
      invoiceNo: invoice.invoiceNo,
      statusLabel: statusLabels[invoice.status],
      issuedOn: invoice.issuedOn,
      dueOn: invoice.dueOn,
      totalMinor: toMinor(invoice.totalAmount),
      taxMinor: toMinor(invoice.taxAmount),
      paidMinor: toMinor(invoice.paidAmount),
      outstandingMinor: toMinor(invoice.outstandingAmount),
      currency: invoice.currency,
      notes: invoice.notes,
      // Only the filename crosses. `document_path` is a key into private
      // storage and the directories above the file are our storage layout, not
      // the contractor's business — and this object is serialised into the RSC
      // payload, so trimming it in the popup would have left the whole key on
      // the wire.
      documentPath: lastPathSegment(invoice.documentPath),
      ledgerEntryId: invoice.ledgerEntryId,
      // `siteId` and `vendorProfileId` are GONE, not merely unrendered.
      //
      // The popup stopped painting them and its own comment said they "are
      // gone" — true of the DOM and false of the response. Measured on the
      // running server as `service_provider@azura.local`, an outside
      // contractor: `/tr/dashboard/vendor-invoices` still returned
      // `vendorProfileId":"b0000000-…-000000000008"` and the site uuid in the
      // payload. `profiles.id` is precisely the key that role cannot obtain any
      // other way, since `getProfiles` refuses it the directory.
      version: invoice.version,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
      isDuplicate: duplicateIds.has(invoice.id),
      isOverdue: overdue,
      // Resolved here rather than in the island: `overdue.days` carries a
      // `{days}` placeholder, the island has no `useTranslations`, and a
      // formatter function cannot cross the server/client boundary.
      dueStatusLabel:
        invoice.dueOn === null
          ? t("overdue.noDueDate")
          : overdue && days !== null
            ? t("overdue.days", { days })
            : t("overdue.notDue"),
      openLabel: t("detail.open", {
        vendor: invoice.vendorName,
        invoiceNo: invoice.invoiceNo,
      }),
    }
  })

  const tableLabels: VendorInvoiceTableLabels = {
    caption: tCommon("pagination.showing", {
      from: 1,
      to: invoices.length,
      total: allInvoices.length,
    }),
    columns: {
      vendor: t("columns.vendor"),
      invoiceNo: t("columns.invoiceNo"),
      status: t("columns.status"),
      issued: t("columns.issued"),
      due: t("columns.due"),
      total: t("columns.total"),
      tax: t("columns.tax"),
      paid: t("columns.paid"),
      outstanding: t("columns.outstanding"),
      currency: t("columns.currency"),
    },
    fields: {
      site: t("detail.site"),
      vendorProfile: t("detail.vendorProfile"),
      ledgerEntry: t("detail.ledgerEntry"),
      document: t("detail.document"),
      version: t("detail.version"),
      created: t("detail.created"),
      updated: t("detail.updated"),
      notes: t("detail.notes"),
    },
    notStated: gapLabel,
    notLinked: t("detail.notLinked"),
    noDocument: t("detail.noDocument"),
    noNotes: t("detail.noNotes"),
    duplicate: t("duplicates.heading"),
    detailLead: t("detail.lead"),
    close: tCommon("actions.close"),
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
          <>
            <VendorInvoiceTable
              rows={rows}
              labels={tableLabels}
              locale={locale}
            />
            {/* The affordance has to be said, not implied. A dotted underline
                that only appears on hover is invisible to anyone who has not
                already found it, and to every touch user. */}
            <p className="text-xs text-muted-foreground">{t("detail.hint")}</p>
          </>
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

/**
 * The file name out of a private storage key.
 *
 * `document_path` is `company/<uuid>/<category>/<id>-<name>.<ext>` — the
 * directories above the file are our storage layout and the second segment is
 * the tenancy uuid every RLS policy partitions on. "Is a document attached and
 * which one" is answered by the last segment alone, and it is the only part
 * that leaves the server.
 */
function lastPathSegment(path: string | null): string | null {
  if (path === null) return null
  const parts = path.split("/").filter(Boolean)
  return parts.at(-1) ?? null
}
