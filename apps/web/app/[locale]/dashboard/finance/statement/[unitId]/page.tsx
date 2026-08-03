import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"
import type { ReactNode } from "react"

import { Link } from "@/app/navigation"
import { AccessRefused } from "@/components/finance/access-refused"
import {
  CurrencyTotalList,
  type CurrencyTotalLabels,
} from "@/components/finance/currency-total-list"
import {
  logDeniedFinanceAccess,
  resolveFinanceScope,
} from "@/components/finance/finance-scope"
import { statementFor } from "@/components/finance/ledger-analysis"
import {
  ImmutabilityNotice,
  LedgerTable,
  type LedgerTableLabels,
} from "@/components/finance/ledger-table"
import type { Locale } from "@/lib/contracts"
import { getLedgerEntries } from "@/lib/finance-repository"

/**
 * /[locale]/dashboard/finance/statement/[unitId]              Owner: W3-D
 *
 * **The worst possible failure in this module is one owner reading another
 * owner's statement.** The brief says so, and this route is the deep link that
 * would do it, so the refusal is built here first and the rendering second.
 *
 * ## Three independent things have to fail before owner A sees owner B
 *
 * 1. **RLS.** `finance_ledger_entries` admits a residency role only for units
 *    resolved through `current_user_unit_ids()` (migration 07). This is the
 *    boundary that must hold, and it holds even if everything below is wrong.
 * 2. **The repository.** `financeScope()` in `lib/finance-repository.ts`
 *    mirrors that predicate in TypeScript, which is the only boundary that
 *    exists at all in local-seed mode, where no database and therefore no RLS
 *    is involved.
 * 3. **This page.** The unit id is checked against the entries the repository
 *    actually returned, before anything is rendered.
 *
 * ## Why the check is "did any visible row mention this unit" and not a
 * ## separate ownership lookup
 *
 * A second lookup would be a second predicate, and a security predicate that
 * exists twice is one that will eventually disagree with itself — W2-A's
 * comment on `resolveScopedUnitIds` makes exactly this point. Asking the
 * already-scoped result set is definitionally consistent with the scope: if the
 * repository would not show the caller a single row for this unit, the caller
 * has no business reading a statement for it.
 *
 * ## Absent versus forbidden
 *
 * A unit outside the caller's scope and a unit with no entries are **the same
 * response** for a residency role: a 403 with the same wording. Distinguishing
 * them would leak whether unit AZW-B01-0002 exists and has activity, which is
 * the disclosure the whole route is guarding. An internal reader
 * (admin · manager · accountant) does get the "no entries" answer, because for
 * them the existence of a unit is not a secret.
 *
 * The refusal is also **logged** as an access event. See
 * `logDeniedFinanceAccess` for what that does today and what it cannot do yet.
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

const STATEMENT_LIMIT = 500

export default async function StatementPage({
  params,
}: {
  params: Promise<{ locale: Locale; unitId: string }>
}): Promise<ReactNode> {
  const { locale, unitId: rawUnitId } = await params
  const unitId = decodeURIComponent(rawUnitId)

  const t = await getTranslations({ locale, namespace: "dashboard.finance" })
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

  // Scoped by the repository. A residency role gets only its own units back,
  // in both Supabase mode (RLS plus the mirrored predicate) and seed mode.
  const entriesResult = await getLedgerEntries({
    ...scope.access,
    unitId,
    limit: STATEMENT_LIMIT,
  })
  const statement = statementFor(unitId, entriesResult.data)

  if (statement.entries.length === 0) {
    // For an internal reader this is genuinely "nothing here". For a residency
    // role it is indistinguishable from "not yours", and it is rendered as the
    // refusal so that the two cannot be told apart from outside.
    if (scope.internal) {
      return (
        <div className="flex flex-col gap-4">
          <StatementHeader
            title={t("statement.title", { unit: unitId })}
            lead={t("statement.lead")}
            backLabel={t("statement.back")}
          />
          <p className="max-w-prose rounded-xl border border-dashed border-input px-6 py-10 text-center text-sm text-muted-foreground">
            {t("statement.notFound")}
          </p>
        </div>
      )
    }

    logDeniedFinanceAccess({
      surface: "finance",
      role: scope.role,
      profileId: scope.profileId,
      target: unitId,
      reason: "out_of_scope",
    })

    return (
      <AccessRefused
        title={t("statement.title", { unit: unitId })}
        message={t("statement.forbidden")}
        hint={t("statement.forbiddenHint")}
      />
    )
  }

  const seedMode = entriesResult.source === "local-seed"
  const gapLabel = tEvidence("confidence.gap")

  const totalLabels: CurrencyTotalLabels = {
    empty: t("totals.noneYet"),
    multiCurrencyNote: t("totals.description"),
    unreadableNote: (count) => t("unreadableNote", { count }),
    overflowNote: (currency) => t("overflowNote", { currency }),
  }

  const ledgerLabels: LedgerTableLabels = {
    caption: t("ledger.rowsShown", {
      shown: statement.entries.length,
      total: statement.entries.length,
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
    reasonElementId: "statement-immutability-notice",
    gapLabel,
    reversalOf: (id) => `${t("entryType.reversal")}: ${id.slice(0, 8)}`,
  }

  return (
    <div className="flex flex-col gap-6">
      <StatementHeader
        title={t("statement.title", { unit: unitId })}
        lead={t("statement.lead")}
        backLabel={t("statement.back")}
      />

      {seedMode ? (
        <p
          role="status"
          className="rounded-lg border border-confidence-gap/30 bg-confidence-gap/10 px-3 py-2 text-sm text-foreground"
        >
          {t("seedNotice")}
        </p>
      ) : null}

      <section className="flex max-w-md flex-col gap-2 rounded-xl border border-border bg-card p-4">
        <p className="font-mono text-[0.6875rem] tracking-[0.18em] text-muted-foreground uppercase">
          {t("statement.openBalance")}
        </p>
        {/* Per currency, exactly like every other total in this module. A unit
            charged in EUR and refunded in USD has two balances, not one. */}
        <CurrencyTotalList
          totals={statement.balance}
          locale={locale}
          labels={totalLabels}
          tone="signed"
        />
      </section>

      <ImmutabilityNotice
        id="statement-immutability-notice"
        heading={t("immutable.heading")}
        body={t("immutable.body")}
      />

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">
          {t("statement.entries")}
        </h2>
        <LedgerTable
          entries={statement.entries}
          locale={locale}
          labels={ledgerLabels}
          height={520}
        />
      </section>
    </div>
  )
}

function StatementHeader({
  title,
  lead,
  backLabel,
}: {
  title: string
  lead: string
  backLabel: string
}): ReactNode {
  return (
    <header className="flex flex-col gap-2">
      <Link
        href="/dashboard/finance"
        className="w-fit text-sm text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {backLabel}
      </Link>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
        {title}
      </h1>
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        {lead}
      </p>
    </header>
  )
}
