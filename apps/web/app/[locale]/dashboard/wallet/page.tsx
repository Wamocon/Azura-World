import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"
import type { ReactNode } from "react"

import { AccessRefused } from "@/components/finance/access-refused"
import {
  CurrencyTotalCard,
  MoneyCell,
  type CurrencyTotalLabels,
} from "@/components/finance/currency-total-list"
import { resolveFinanceScope } from "@/components/finance/finance-scope"
import { formatMinor, toMinor, totalRows } from "@/components/finance/money"
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
import {
  getPaymentTransactions,
  getWallets,
  type PaymentTransaction,
  type Wallet,
} from "@/lib/finance-repository"

/**
 * /[locale]/dashboard/wallet — balances and movements.         Owner: W3-D
 *
 * ## Overdraft is a database rule, and this page reports it rather than
 * ## implements it
 *
 * Migration 07 carries three CHECK constraints on `wallets`:
 * `wallets_no_unflagged_overdraft`, `wallets_overdraft_limit_requires_flag` and
 * `wallets_overdraft_within_limit`. A balance below zero is legal **only** when
 * `allows_overdraft` is true and the limit covers it, and the database refuses
 * anything else for every caller.
 *
 * So the overdraft column here is not a warning this page decided to show, it
 * is the flag the constraint reads, displayed beside the balance it authorises.
 * A wallet sitting at -180,00 EUR with the flag set is **not an alarm** and is
 * not styled as one; a wallet below zero without the flag would be a database
 * invariant violation, which is why it is styled as a conflict and called out.
 * As of this writing no such row exists, and the panel says so rather than
 * rendering an empty scary box.
 *
 * ## One wallet per holder PER CURRENCY
 *
 * `unique (owner_profile_id, currency)` means a holder may have several
 * wallets. `getWalletForProfile()` returns an array for exactly that reason,
 * and CONVENTIONS §5 forbids adding them up. The summary at the top is
 * therefore per currency, like everything else in this module, and a holder
 * with a EUR wallet and a USD wallet appears twice in the table, deliberately.
 *
 * ## Scope
 *
 * `wallet:view` is held by nine of the eleven roles, but the repository shows a
 * non-company reader only its OWN wallets (`can_read_own_wallet()`, mirrored in
 * `financeScope`). The page states which of the two it is showing, because a
 * `tenant` seeing one row and a `manager` seeing five is a difference in
 * authority, and an unexplained one-row table reads as broken data.
 */

export const metadata: Metadata = {
  title: "Wallet",
  robots: { index: false, follow: false },
}

const WALLET_LIMIT = 200
const MOVEMENT_LIMIT = 200

export default async function WalletPage({
  params,
}: {
  params: Promise<{ locale: Locale }>
}): Promise<ReactNode> {
  const { locale } = await params

  const t = await getTranslations({ locale, namespace: "dashboard.wallet" })
  const tPay = await getTranslations({ locale, namespace: "dashboard.payments" })
  const tEvidence = await getTranslations({ locale, namespace: "evidence" })
  const tCommon = await getTranslations({ locale, namespace: "common" })

  const scope = await resolveFinanceScope("wallet")
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

  const [walletsResult, paymentsResult] = await Promise.all([
    getWallets({ ...scope.access, limit: WALLET_LIMIT }),
    getPaymentTransactions({ ...scope.access, limit: MOVEMENT_LIMIT }),
  ])

  const wallets = walletsResult.data
  const payments = paymentsResult.data
  const seedMode =
    walletsResult.source === "local-seed" ||
    paymentsResult.source === "local-seed"

  const gapLabel = tEvidence("confidence.gap")

  const totalLabels: CurrencyTotalLabels = {
    empty: t("emptyHint"),
    multiCurrencyNote: t("intro"),
    unreadableNote: (count) => tCommon("states.degraded") + ` (${count})`,
    overflowNote: () => tCommon("errors.generic"),
  }

  const balances = totalRows(
    wallets,
    (wallet) => wallet.balanceAmount,
    (wallet) => wallet.currency
  )

  const belowThreshold = wallets.filter(
    (wallet) =>
      wallet.balanceAmount !== null &&
      wallet.lowBalanceThresholdAmount !== null &&
      wallet.balanceAmount < wallet.lowBalanceThresholdAmount
  )
  const inOverdraft = wallets.filter(
    (wallet) => wallet.balanceAmount !== null && wallet.balanceAmount < 0
  )
  // A row below zero WITHOUT the flag would mean a CHECK constraint had been
  // bypassed. Computed rather than assumed impossible, so that if it ever
  // happens the page says so instead of rendering it as ordinary.
  const unflaggedOverdraft = inOverdraft.filter(
    (wallet) => !wallet.allowsOverdraft
  )

  const movementsByWallet = new Map<string, PaymentTransaction[]>()
  for (const payment of payments) {
    if (payment.walletId === null) continue
    const list = movementsByWallet.get(payment.walletId) ?? []
    list.push(payment)
    movementsByWallet.set(payment.walletId, list)
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

      {/* Which horizon the reader is on. A one-row table with no explanation
          reads as missing data rather than as a scoped view. */}
      <p className="max-w-prose rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        <strong className="font-semibold text-foreground">
          {scope.internal ? t("scope.company") : t("scope.own")}
        </strong>{" "}
        {scope.internal ? t("scope.companyHint") : t("scope.ownHint")}
      </p>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <CurrencyTotalCard
          label={t("columns.balance")}
          totals={balances}
          locale={locale}
          labels={totalLabels}
          tone="signed"
          hint={t("intro")}
        />
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
          <p className="font-mono text-[0.6875rem] tracking-[0.18em] text-muted-foreground uppercase">
            {t("lowBalance.label")}
          </p>
          <p className="text-2xl font-semibold tabular-nums text-foreground">
            {belowThreshold.length}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("lowBalance.hint", { count: belowThreshold.length })}
          </p>
        </div>
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
          <p className="font-mono text-[0.6875rem] tracking-[0.18em] text-muted-foreground uppercase">
            {t("overdraft.inOverdraft")}
          </p>
          <p className="text-2xl font-semibold tabular-nums text-foreground">
            {inOverdraft.length}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("overdraft.description")}
          </p>
        </div>
      </section>

      {unflaggedOverdraft.length > 0 ? (
        <p
          role="alert"
          className="rounded-xl border border-confidence-conflicted/40 bg-confidence-conflicted/5 px-4 py-3 text-sm text-foreground"
        >
          {t("overdraft.rejected")}
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">
            {t("overdraft.heading")}
          </h2>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            {t("overdraft.description")}
          </p>
        </div>

        {wallets.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-input px-6 py-10 text-center">
            <p className="font-display text-base font-semibold text-foreground">
              {t("empty")}
            </p>
            <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
              {t("emptyHint")}
            </p>
          </div>
        ) : (
          <TableScrollArea height={480}>
            <Table>
              <TableCaption>
                {tCommon("pagination.showing", {
                  from: wallets.length === 0 ? 0 : 1,
                  to: wallets.length,
                  total: wallets.length,
                })}
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.holder")}</TableHead>
                  <TableHead>{t("columns.kind")}</TableHead>
                  <TableHead>{t("columns.currency")}</TableHead>
                  <TableHead className="text-right">
                    {t("columns.balance")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("columns.threshold")}
                  </TableHead>
                  <TableHead>{t("columns.overdraft")}</TableHead>
                  <TableHead>{t("columns.status")}</TableHead>
                  <TableHead>{t("columns.updated")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wallets.map((wallet) => (
                  <WalletRow
                    key={wallet.id}
                    wallet={wallet}
                    locale={locale}
                    gapLabel={gapLabel}
                    labels={{
                      noHolder: t("noHolder"),
                      kind: {
                        resident: t("kind.resident"),
                        vendor: t("kind.vendor"),
                        company: t("kind.company"),
                      },
                      status: {
                        active: t("status.active"),
                        frozen: t("status.frozen"),
                        closed: t("status.closed"),
                      },
                      overdraftAllowed: (limit) =>
                        t("overdraft.allowed", { limit }),
                      overdraftNotAllowed: t("overdraft.notAllowed"),
                    }}
                  />
                ))}
              </TableBody>
            </Table>
          </TableScrollArea>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">
            {t("history.heading")}
          </h2>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            {t("history.description")}
          </p>
        </div>

        {wallets.length === 0 || movementsByWallet.size === 0 ? (
          <p className="rounded-xl border border-dashed border-input px-6 py-8 text-center text-sm text-muted-foreground">
            {t("history.empty")}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {wallets
              .filter((wallet) => (movementsByWallet.get(wallet.id) ?? []).length > 0)
              .map((wallet) => (
                <div key={wallet.id} className="flex flex-col gap-2">
                  <h3 className="font-mono text-[0.6875rem] tracking-[0.18em] text-muted-foreground uppercase">
                    {wallet.owningProfileId ?? t("noHolder")}
                    {" · "}
                    {wallet.currency ?? gapLabel}
                  </h3>
                  <TableScrollArea height={220}>
                    <Table>
                      <TableCaption>{t("history.description")}</TableCaption>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{tPay("columns.date")}</TableHead>
                          <TableHead>{tPay("columns.direction")}</TableHead>
                          <TableHead>{tPay("columns.provider")}</TableHead>
                          <TableHead>{tPay("columns.reference")}</TableHead>
                          <TableHead className="text-right">
                            {tPay("columns.amount")}
                          </TableHead>
                          <TableHead>{tPay("columns.status")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(movementsByWallet.get(wallet.id) ?? []).map(
                          (payment) => (
                            <TableRow key={payment.id}>
                              <TableCell className="tabular-nums whitespace-nowrap">
                                {payment.paidAt === null ? (
                                  <span className="text-confidence-gap">
                                    {gapLabel}
                                  </span>
                                ) : (
                                  formatDate(payment.paidAt, locale)
                                )}
                              </TableCell>
                              <TableCell>
                                {payment.direction === "inbound"
                                  ? tPay("direction.inbound")
                                  : tPay("direction.outbound")}
                              </TableCell>
                              <TableCell>{payment.provider}</TableCell>
                              <TableCell className="max-w-[12rem] truncate">
                                {payment.providerReference ?? (
                                  <span className="text-muted-foreground">
                                    {gapLabel}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <MoneyCell
                                  minor={toMinor(payment.amount)}
                                  currency={payment.currency}
                                  locale={locale}
                                  gapLabel={gapLabel}
                                />
                              </TableCell>
                              <TableCell>
                                {tPay(
                                  `status.${payment.status}` as PaymentStatusKey
                                )}
                                {payment.failureReason === null ? null : (
                                  <span className="mt-0.5 block text-xs text-confidence-conflicted">
                                    {payment.failureReason}
                                  </span>
                                )}
                              </TableCell>
                            </TableRow>
                          )
                        )}
                      </TableBody>
                    </Table>
                  </TableScrollArea>
                </div>
              ))}
          </div>
        )}
      </section>
    </div>
  )
}

type PaymentStatusKey =
  | "status.pending"
  | "status.authorized"
  | "status.captured"
  | "status.failed"
  | "status.refunded"
  | "status.cancelled"

interface WalletRowLabels {
  noHolder: string
  kind: Record<Wallet["kind"], string>
  status: Record<Wallet["status"], string>
  overdraftAllowed: (limit: string) => string
  overdraftNotAllowed: string
}

function WalletRow({
  wallet,
  locale,
  gapLabel,
  labels,
}: {
  wallet: Wallet
  locale: Locale
  gapLabel: string
  labels: WalletRowLabels
}): ReactNode {
  const balance = toMinor(wallet.balanceAmount)
  const threshold = toMinor(wallet.lowBalanceThresholdAmount)
  const limit = toMinor(wallet.overdraftLimitAmount)
  const negative = balance !== null && balance < 0
  // Below zero without the flag means a CHECK constraint was bypassed. Marked
  // as a conflict rather than rendered as an ordinary negative number.
  const invariantBroken = negative && !wallet.allowsOverdraft

  return (
    <TableRow
      className={cn(
        "border-l-2",
        invariantBroken
          ? "border-l-confidence-conflicted bg-confidence-conflicted/10"
          : negative
            ? "border-l-confidence-inferred"
            : "border-l-transparent",
        wallet.status !== "active" && "text-muted-foreground"
      )}
    >
      <TableCell className="max-w-[16rem] truncate font-mono text-xs">
        {wallet.owningProfileId ?? labels.noHolder}
      </TableCell>
      <TableCell>{labels.kind[wallet.kind]}</TableCell>
      <TableCell className="font-mono text-[0.6875rem] tracking-[0.14em] uppercase">
        {wallet.currency ?? <span className="text-confidence-gap">{gapLabel}</span>}
      </TableCell>
      <TableCell className="text-right">
        <MoneyCell
          minor={balance}
          currency={wallet.currency}
          locale={locale}
          gapLabel={gapLabel}
          className={cn("font-semibold", negative && "text-confidence-conflicted")}
        />
      </TableCell>
      <TableCell className="text-right">
        <MoneyCell
          minor={threshold}
          currency={wallet.currency}
          locale={locale}
          gapLabel={gapLabel}
        />
      </TableCell>
      <TableCell className="text-sm">
        {wallet.allowsOverdraft && limit !== null && wallet.currency !== null ? (
          // `formatMinor`, not a locally constructed `Intl.NumberFormat`. A
          // second formatter would be a second locale-mapping table to keep in
          // step with `lib/format.ts`, and `limit / 100` here would be the one
          // float division this module spent a file avoiding.
          labels.overdraftAllowed(
            formatMinor(limit, wallet.currency, locale)
          )
        ) : (
          <span className="text-muted-foreground">
            {labels.overdraftNotAllowed}
          </span>
        )}
      </TableCell>
      <TableCell>{labels.status[wallet.status]}</TableCell>
      <TableCell className="tabular-nums whitespace-nowrap">
        {formatDate(wallet.updatedAt, locale)}
      </TableCell>
    </TableRow>
  )
}
