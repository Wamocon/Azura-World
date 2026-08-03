import { Download } from "lucide-react"
import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"
import type { ReactNode } from "react"

import { Link } from "@/app/navigation"
import { AccessRefused } from "@/components/finance/access-refused"
import {
  CurrencyTotalCard,
  CurrencyTotalList,
  MoneyCell,
  type CurrencyTotalLabels,
} from "@/components/finance/currency-total-list"
import { newIdempotencyKey } from "@/app/[locale]/dashboard/finance/actions"
import { approvalThresholdFor } from "@/components/finance/approval-threshold"
import {
  ageingByBucket,
  AGEING_BUCKETS,
  checkBalances,
  debtorsByUnit,
  reconcilePayments,
  type AgeingBucket,
} from "@/components/finance/ledger-analysis"
import {
  ImmutabilityNotice,
  LedgerTable,
  type LedgerTableLabels,
} from "@/components/finance/ledger-table"
import {
  formatMinor,
  toMinor,
  totalRows,
  type Minor,
} from "@/components/finance/money"
import {
  PaymentConsole,
  type AllocationOption,
} from "@/components/finance/payment-console"
import {
  anyRefused,
  anyUnavailable,
  readFinance,
} from "@/components/finance/finance-read"
import { resolveFinanceScope } from "@/components/finance/finance-scope"
import { cn } from "@/lib/cn"
import type { Locale } from "@/lib/contracts"
import { formatDateTime } from "@/lib/format"
import {
  currencyCodes,
  getFinanceSummary,
  getLedgerEntries,
  getPaymentTransactions,
  getVendorInvoices,
  type CurrencyCode,
  type LedgerEntryStatus,
} from "@/lib/finance-repository"
// The enum ARRAYS live in W2-A's data module; `finance-repository` re-exports
// the types and `currencyCodes` but not this one. Imported from the source
// rather than restated as a local literal, so a status added to the schema
// cannot go missing from this page's filter without a compile error.
import { ledgerEntryStatuses } from "@/lib/finance-data"

/**
 * /[locale]/dashboard/finance — the ledger.                    Owner: W3-D
 *
 * ## The two rules this page exists to hold
 *
 * **1. Posted entries are immutable**, enforced by `prevent_posted_ledger_mutation`
 * (migration 07), which rejects UPDATE and DELETE on a posted row for every
 * role including the service key. Nothing here offers an edit the database will
 * refuse: a posted row carries a **disabled** control with a visible reason
 * beside it, not an enabled one that would 409.
 *
 * **2. Nothing is summed across currencies.** Every total on this page is a
 * `CurrencyTotals`, which has no method that returns one combined number. The
 * seed holds EUR, USD and TRY simultaneously, so a page that got this wrong
 * would be visibly wrong rather than quietly wrong.
 *
 * ## Rendering mode and JavaScript
 *
 * No `export const dynamic`: the root layout reads `headers()`, so every route
 * beneath it is already dynamic, and adding `force-static` ships a page whose
 * scripts are all CSP-blocked while looking correct in dev (S-009).
 *
 * Filtering and paging are `searchParams` and plain links, so the whole ledger
 * reads with JavaScript disabled. The one client component is the payment
 * console, which genuinely needs form state, and it is the only thing on the
 * page that stops working without JS.
 *
 * ## Refuse before you fetch
 *
 * `resolveFinanceScope()` runs before the first repository call. W3-C measured
 * why: a client guard decides after the Server Component has rendered, so its
 * data is already in the RSC flight payload. Nothing is read for a caller who
 * may not see it.
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
  const t = await getTranslations({ locale, namespace: "dashboard.finance" })
  return {
    title: t("title"),
    robots: { index: false, follow: false },
  }
}

const PAGE_SIZE = 50
/** One page of context for the panels that summarise rather than list. */
const ANALYSIS_LIMIT = 500

const PAYMENT_METHODS = ["bank_transfer", "iyzico", "cash"] as const

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function isStatus(value: string | undefined): value is LedgerEntryStatus {
  return (
    value !== undefined &&
    (ledgerEntryStatuses as readonly string[]).includes(value)
  )
}

function isCurrency(value: string | undefined): value is CurrencyCode {
  return (
    value !== undefined && (currencyCodes as readonly string[]).includes(value)
  )
}

function parsePage(value: string | undefined): number {
  const n = Number.parseInt(value ?? "1", 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
}

export default async function FinancePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): Promise<ReactNode> {
  const { locale } = await params
  const query = await searchParams

  const t = await getTranslations({ locale, namespace: "dashboard.finance" })
  const tPay = await getTranslations({
    locale,
    namespace: "dashboard.payments",
  })
  const tEvidence = await getTranslations({ locale, namespace: "evidence" })
  const tCommon = await getTranslations({ locale, namespace: "common" })

  const scope = await resolveFinanceScope("finance")
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

  const activeStatus = isStatus(first(query["status"]))
    ? (first(query["status"]) as LedgerEntryStatus)
    : undefined
  const activeCurrency = isCurrency(first(query["currency"]))
    ? (first(query["currency"]) as CurrencyCode)
    : undefined
  const page = parsePage(first(query["page"]))
  const offset = (page - 1) * PAGE_SIZE

  const filterFor = <T,>(value: T | undefined, key: string) =>
    value === undefined ? {} : { [key]: value }

  // Every read goes through `readFinance`, so a repository refusal renders the
  // refusal panel instead of throwing into the error boundary. CONTRACTS §5:
  // never 500 for a handled condition. See `components/finance/finance-read.ts`.
  const ctx = {
    surface: "finance",
    role: scope.role,
    profileId: scope.profileId,
  } as const
  const [entriesRead, analysisRead, summaryRead, invoicesRead, paymentsRead] =
    await Promise.all([
      readFinance(
        () =>
          getLedgerEntries({
            ...scope.access,
            limit: PAGE_SIZE,
            offset,
            ...filterFor(activeStatus, "status"),
            ...filterFor(activeCurrency, "currency"),
          }),
        { ...ctx, target: "finance_ledger_entries" }
      ),
      // A second, wider read for the panels that must reason over the whole
      // visible set rather than over one page. Bounded at 500 by the repository;
      // the panels say so when they are looking at a truncated view.
      readFinance(
        () => getLedgerEntries({ ...scope.access, limit: ANALYSIS_LIMIT }),
        { ...ctx, target: "finance_ledger_entries (analysis)" }
      ),
      readFinance(() => getFinanceSummary(scope.access), {
        ...ctx,
        target: "finance summary",
      }),
      readFinance(
        () => getVendorInvoices({ ...scope.access, limit: ANALYSIS_LIMIT }),
        { ...ctx, target: "vendor_invoices" }
      ),
      readFinance(
        () =>
          getPaymentTransactions({ ...scope.access, limit: ANALYSIS_LIMIT }),
        { ...ctx, target: "payment_transactions" }
      ),
    ])

  const financeReads = [
    entriesRead,
    analysisRead,
    summaryRead,
    invoicesRead,
    paymentsRead,
  ]
  if (anyRefused(financeReads)) {
    return (
      <AccessRefused
        title={t("title")}
        message={t("forbidden")}
        hint={t("forbiddenHint")}
      />
    )
  }
  if (
    anyUnavailable(financeReads) ||
    !entriesRead.ok ||
    !analysisRead.ok ||
    !summaryRead.ok ||
    !invoicesRead.ok ||
    !paymentsRead.ok
  ) {
    return (
      <AccessRefused
        title={t("title")}
        message={tCommon("errors.serverError")}
        hint={tCommon("errors.tryAgain")}
      />
    )
  }

  const entriesResult = entriesRead.value
  const analysisResult = analysisRead.value
  const summaryResult = summaryRead.value
  const invoicesResult = invoicesRead.value
  const paymentsResult = paymentsRead.value

  const entries = entriesResult.data
  const allEntries = analysisResult.data
  const summary = summaryResult.data
  const invoices = invoicesResult.data
  const payments = paymentsResult.data

  const seedMode = [
    entriesResult,
    analysisResult,
    summaryResult,
    invoicesResult,
    paymentsResult,
  ].some((result) => result.source === "local-seed")

  // The ageing clock. `summary.asOf` is the repository's server timestamp, not
  // a browser clock: the brief requires ageing across a month boundary to be
  // computed server-side, and a device an hour out would otherwise move an
  // invoice between buckets with nothing on screen to explain it.
  const asOf = summary.asOf

  const totalLabels: CurrencyTotalLabels = {
    empty: t("totals.noneYet"),
    multiCurrencyNote: t("totals.description"),
    unreadableNote: (count) => t("unreadableNote", { count }),
    overflowNote: (currency) => t("overflowNote", { currency }),
  }

  const postedEntries = allEntries.filter((entry) => entry.status === "posted")
  const draftEntries = allEntries.filter((entry) => entry.status === "draft")

  const postedDebit = totalRows(
    postedEntries,
    (entry) => entry.debitAmount,
    (entry) => entry.currency
  )
  const postedCredit = totalRows(
    postedEntries,
    (entry) => entry.creditAmount,
    (entry) => entry.currency
  )
  const postedNet = totalRows(
    postedEntries,
    (entry) => entry.signedAmount,
    (entry) => entry.currency
  )
  const draftNet = totalRows(
    draftEntries,
    (entry) => entry.signedAmount,
    (entry) => entry.currency
  )

  const balances = checkBalances(allEntries)
  const debtors = debtorsByUnit(allEntries)
  const reconciliation = reconcilePayments(payments, allEntries, invoices)
  const ageing = ageingByBucket(invoices, asOf)

  const gapLabel = tEvidence("confidence.gap")

  const ledgerLabels: LedgerTableLabels = {
    caption: t("ledger.rowsShown", {
      shown: entries.length,
      total: summary.counts.ledgerEntries,
    }),
    columns: {
      date: t("columns.date"),
      entryType: t("columns.entryType"),
      description: t("columns.description"),
      unit: t("columns.unit"),
      reference: t("columns.reference"),
      debit: t("columns.debit"),
      credit: t("columns.credit"),
      currency: t("columns.currency"),
      status: t("columns.status"),
      actions: t("columns.actions"),
    },
    status: {
      draft: t("status.draft"),
      posted: t("status.posted"),
      void: t("status.void"),
    },
    entryType: {
      dues: t("entryType.dues"),
      service_charge: t("entryType.service_charge"),
      utility: t("entryType.utility"),
      deposit: t("entryType.deposit"),
      refund: t("entryType.refund"),
      penalty: t("entryType.penalty"),
      adjustment: t("entryType.adjustment"),
      payment: t("entryType.payment"),
      vendor_bill: t("entryType.vendor_bill"),
      reversal: t("entryType.reversal"),
    },
    locked: t("immutable.locked"),
    voidLocked: t("immutable.voidLocked"),
    editDraft: t("immutable.editDraft"),
    reasonElementId: "finance-immutability-notice",
    gapLabel,
    reversalOf: (id) => `${t("entryType.reversal")}: ${id.slice(0, 8)}`,
  }

  const hrefFor = (next: {
    status?: LedgerEntryStatus | null
    currency?: CurrencyCode | null
    page?: number
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
    const p = next.page ?? 1
    if (p > 1) sp.set("page", String(p))
    const s = sp.toString()
    return `/dashboard/finance${s ? `?${s}` : ""}`
  }

  const exportHref = (() => {
    const sp = new URLSearchParams()
    if (activeStatus !== undefined) sp.set("status", activeStatus)
    if (activeCurrency !== undefined) sp.set("currency", activeCurrency)
    const s = sp.toString()
    return `/dashboard/finance/export${s ? `?${s}` : ""}`
  })()

  const mayPost = scope.can("finance:create")
  const mayExport = scope.can("finance:export")

  const allocations: readonly AllocationOption[] = [
    ...invoices
      .filter((invoice) => invoice.currency !== null)
      .slice(0, 25)
      .map((invoice) => ({
        value: `invoice:${invoice.id}`,
        label: tPay("console.allocationInvoice", {
          invoiceNo: invoice.invoiceNo,
        }),
        currency: invoice.currency as CurrencyCode,
      })),
    ...[...new Set(allEntries.map((entry) => entry.unitId))]
      .filter((unitId): unitId is string => unitId !== null)
      .slice(0, 25)
      .map((unitId) => ({
        value: `unit:${unitId}`,
        label: tPay("console.allocationUnit", { unit: unitId }),
        currency: "EUR" as CurrencyCode,
      })),
  ]

  const idempotencyKey = mayPost ? await newIdempotencyKey() : null
  const threshold = approvalThresholdFor("EUR")

  const pageCount = Math.max(
    1,
    Math.ceil(summary.counts.ledgerEntries / PAGE_SIZE)
  )

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          {t("lead")}
        </p>
        {/* The anti-mixing rule, in words, at the top. A reader who scrolls
            past two stacked totals should already have been told why they are
            not added up. */}
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

      {scope.internal ? null : (
        // An owner sees its own units and nothing else. Saying so beats an
        // unexplained short list, which reads as missing data.
        <p className="max-w-prose rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          {t("statement.lead")}
        </p>
      )}

      {/* ---------------- Totals, per currency, never combined -------------- */}
      <section className="flex flex-col gap-3">
        <SectionHeading
          title={t("totals.heading")}
          description={t("totals.description")}
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <CurrencyTotalCard
            label={t("totals.postedDebit")}
            totals={postedDebit}
            locale={locale}
            labels={totalLabels}
          />
          <CurrencyTotalCard
            label={t("totals.postedCredit")}
            totals={postedCredit}
            locale={locale}
            labels={totalLabels}
          />
          <CurrencyTotalCard
            label={t("totals.postedNet")}
            totals={postedNet}
            locale={locale}
            labels={totalLabels}
            tone="signed"
          />
          <CurrencyTotalCard
            label={t("totals.draftNet")}
            totals={draftNet}
            locale={locale}
            labels={totalLabels}
            tone="signed"
            hint={t("ledger.description")}
          />
        </div>
      </section>

      {/* ---------------- Immutability ------------------------------------- */}
      <ImmutabilityNotice
        id="finance-immutability-notice"
        heading={t("immutable.heading")}
        body={t("immutable.body")}
      />

      {/* ---------------- Filters ------------------------------------------ */}
      <nav
        aria-label={t("filters.heading")}
        className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip
            href={hrefFor({ status: null, page: 1 })}
            active={activeStatus === undefined}
          >
            {t("filters.allStatuses")}
          </FilterChip>
          {ledgerEntryStatuses.map((status) => (
            <FilterChip
              key={status}
              href={hrefFor({ status, page: 1 })}
              active={activeStatus === status}
            >
              {ledgerLabels.status[status]}
            </FilterChip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip
            href={hrefFor({ currency: null, page: 1 })}
            active={activeCurrency === undefined}
          >
            {t("filters.allCurrencies")}
          </FilterChip>
          {[...new Set(allEntries.map((entry) => entry.currency))]
            .filter((currency): currency is CurrencyCode => currency !== null)
            .sort()
            .map((currency) => (
              <FilterChip
                key={currency}
                href={hrefFor({ currency, page: 1 })}
                active={activeCurrency === currency}
              >
                {currency}
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

      {/* ---------------- Ledger ------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <SectionHeading
          title={t("ledger.heading")}
          description={t("ledger.description")}
        />
        {entries.length === 0 ? (
          <EmptyPanel title={t("ledger.empty")} body={t("ledger.emptyHint")} />
        ) : (
          <LedgerTable
            entries={entries}
            locale={locale}
            labels={ledgerLabels}
            statementHrefFor={(unitId) =>
              `/dashboard/finance/statement/${encodeURIComponent(unitId)}`
            }
          />
        )}
        {mayExport ? (
          <p className="text-xs text-muted-foreground">{t("export.hint")}</p>
        ) : null}
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
      </section>

      {/* ---------------- Double-entry integrity ---------------------------- */}
      <section className="flex flex-col gap-3">
        <SectionHeading
          title={t("balanceCheck.heading")}
          description={t("balanceCheck.description")}
        />
        {balances.groups.length === 0 ? (
          <EmptyPanel
            title={t("balanceCheck.empty")}
            body={t("balanceCheck.singleSidedHint")}
          />
        ) : balances.unbalanced.length === 0 ? (
          <p className="rounded-xl border border-confidence-confirmed/30 bg-confidence-confirmed/5 px-4 py-3 text-sm text-foreground">
            {t("balanceCheck.allBalanced", { count: balances.groups.length })}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {balances.unbalanced.map((group) => (
              <li
                key={`${group.groupId}|${group.currency}`}
                className="flex flex-wrap items-baseline justify-between gap-3 rounded-xl border border-confidence-conflicted/40 bg-confidence-conflicted/5 px-4 py-3"
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {t("balanceCheck.group")} {group.groupId.slice(0, 8)}
                </span>
                <span className="text-sm text-foreground">
                  {t("balanceCheck.difference")}{" "}
                  <MoneyCell
                    minor={group.difference}
                    currency={group.currency}
                    locale={locale}
                    gapLabel={gapLabel}
                    className="font-semibold"
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
        {balances.singleSidedCount > 0 ? (
          <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
            {t("balanceCheck.singleSided")}: {balances.singleSidedCount}.{" "}
            {t("balanceCheck.singleSidedHint")}
          </p>
        ) : null}
      </section>

      {/* ---------------- Debtors ------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <SectionHeading
          title={t("debtors.heading")}
          description={t("debtors.description")}
        />
        {debtors.length === 0 ? (
          <EmptyPanel
            title={t("debtors.empty")}
            body={t("debtors.description")}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {debtors.map((row) => (
              <div
                key={row.unitId ?? "none"}
                className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4"
              >
                <p className="font-mono text-[0.6875rem] tracking-[0.18em] text-muted-foreground uppercase">
                  {row.unitId === null ? (
                    t("debtors.noUnit")
                  ) : (
                    <Link
                      href={`/dashboard/finance/statement/${encodeURIComponent(row.unitId)}`}
                      className="underline decoration-dotted underline-offset-4 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {row.unitId}
                    </Link>
                  )}
                </p>
                <CurrencyTotalList
                  totals={row.totals}
                  locale={locale}
                  labels={totalLabels}
                  tone="signed"
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------------- Ageing -------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <SectionHeading
          title={t("ageing.heading")}
          description={t("ageing.description")}
        />
        <p className="text-xs text-muted-foreground">
          {t("ageing.asOf", { date: formatDateTime(asOf, locale) })}
        </p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {AGEING_BUCKETS.map((bucket) => (
            <CurrencyTotalCard
              key={bucket}
              label={t(`ageing.${bucket}` as AgeingLabelKey)}
              totals={ageing[bucket]}
              locale={locale}
              labels={totalLabels}
            />
          ))}
        </div>
      </section>

      {/* ---------------- Reconciliation ------------------------------------ */}
      <section className="flex flex-col gap-3">
        <SectionHeading
          title={t("reconciliation.heading")}
          description={t("reconciliation.description")}
        />
        {reconciliation.unmatched.length === 0 ? (
          <p className="rounded-xl border border-confidence-confirmed/30 bg-confidence-confirmed/5 px-4 py-3 text-sm text-foreground">
            {t("reconciliation.empty")}
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {t("reconciliation.unmatchedHint")}
            </p>
            <ul className="flex flex-col gap-2">
              {reconciliation.unmatched.map((payment) => (
                <li
                  key={payment.id}
                  className="flex flex-wrap items-baseline justify-between gap-3 rounded-xl border border-confidence-conflicted/40 bg-confidence-conflicted/5 px-4 py-3"
                >
                  <span className="text-sm text-foreground">
                    {tPay(`direction.${payment.direction}` as DirectionKey)}
                    {" · "}
                    {payment.provider}
                    {payment.providerReference === null
                      ? ""
                      : ` · ${payment.providerReference}`}
                  </span>
                  <MoneyCell
                    minor={toMinor(payment.amount)}
                    currency={payment.currency}
                    locale={locale}
                    gapLabel={gapLabel}
                    className="font-semibold"
                  />
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="text-xs text-muted-foreground">
          {t("reconciliation.matched", { count: reconciliation.matchedCount })}
        </p>
      </section>

      {/* ---------------- Payment console ----------------------------------- */}
      {mayPost && idempotencyKey !== null ? (
        <section className="flex flex-col gap-3">
          <PaymentConsole
            locale={locale}
            idempotencyKey={idempotencyKey}
            allocations={allocations}
            currencies={currencyCodes}
            methods={PAYMENT_METHODS}
            labels={{
              heading: tPay("console.heading"),
              description: tPay("console.description"),
              amount: tPay("console.amount"),
              amountHint: tPay.raw("console.amountHint") as string,
              currency: tPay("console.currency"),
              method: tPay("console.method"),
              reference: tPay("console.reference"),
              referenceHint: tPay("console.referenceHint"),
              allocation: tPay("console.allocation"),
              allocationNone: tPay("console.allocationNone"),
              submit: tPay("console.submit"),
              submitting: tPay("console.submitting"),
              doubleClickSafe: tPay("console.doubleClickSafe"),
              // `.raw()` for every template carrying a placeholder. Passing a
              // closure that calls `tPay(...)` looks natural and is a runtime
              // 500: React cannot serialise a function into a Client
              // Component's props. `tsc` and `next build` both accept it; only
              // loading the page does not.
              result: {
                posted: tPay("result.posted"),
                duplicate: tPay("result.duplicate"),
                unavailable: tPay("result.unavailable"),
                notImplemented: tPay("result.notImplemented"),
                forbidden: tPay("result.forbidden"),
                conflict: tPay("result.conflict"),
                exceedsInvoice: tPay.raw("result.exceedsInvoice") as string,
                unknownAllocation: tPay("result.unknownAllocation"),
                parsed: tPay.raw("result.parsed") as string,
              },
              errors: {
                empty: tPay("errors.empty"),
                unexpected_character: tPay.raw(
                  "errors.unexpected_character"
                ) as string,
                malformed_grouping: tPay.raw(
                  "errors.malformed_grouping"
                ) as string,
                too_many_decimals: tPay("errors.too_many_decimals"),
                too_large: tPay("errors.too_large"),
                zero: tPay("errors.zero"),
                negative: tPay("errors.negative"),
              },
              approval: {
                threshold: tPay.raw("approval.threshold") as string,
                required: tPay("approval.required"),
              },
            }}
          />
          <p className="text-xs text-muted-foreground">
            {tPay("approval.threshold", {
              amount: formatMinor(
                threshold.thresholdMinor as Minor,
                "EUR",
                locale
              ),
            })}{" "}
            {scope.can("finance:approve")
              ? tPay("approval.canApprove")
              : tPay("approval.cannotApprove")}
          </p>
        </section>
      ) : null}
    </div>
  )
}

type AgeingLabelKey = `ageing.${AgeingBucket}`
type DirectionKey = "direction.inbound" | "direction.outbound"

// ---------------------------------------------------------------------------

function SectionHeading({
  title,
  description,
}: {
  title: string
  description: string
}): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  )
}

function EmptyPanel({
  title,
  body,
}: {
  title: string
  body: string
}): ReactNode {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-input px-6 py-10 text-center">
      <p className="font-display text-base font-semibold text-foreground">
        {title}
      </p>
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        {body}
      </p>
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

function PageLink({
  href,
  children,
}: {
  href: string
  children: ReactNode
}): ReactNode {
  return (
    <Link
      href={href}
      className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {children}
    </Link>
  )
}
