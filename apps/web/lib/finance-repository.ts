/**
 * # Finance repository — ledger, wallets, vendor invoices, payments
 *
 * Owned by **W2-A**. Every read goes through `withRepository()`; nothing in this
 * file calls Supabase directly and nothing writes its own fallback logic.
 *
 * ## Three schema facts that shape this whole file
 *
 * **1. A posted ledger entry is immutable.** `prevent_posted_ledger_mutation`
 * rejects UPDATE *and* DELETE on a posted row with SQLSTATE 23514 — a
 * check_violation, not insufficient_privilege, precisely so that no role and no
 * key can lift it. There is therefore no `updateLedgerEntry()` here and there
 * never will be. The sanctioned correction is `reverseLedgerEntry()`: a NEW row
 * whose `reversal_of` points at the entry it cancels, leaving the original
 * posted forever.
 *
 * **2. The ledger has no settlement status.** `status` is only
 * draft / posted / void. There is no `overdue`, no `paid`, and looking for one
 * is the mistake this comment exists to prevent — a mutable settlement column on
 * an immutable table cannot exist. "What is still open" is DERIVED, from
 * `vendor_invoices.paid_amount` and `payment_transactions`, in
 * `getFinanceSummary()`.
 *
 * **3. A transaction group must balance per currency.** A deferred constraint
 * trigger checks `sum(debit) = sum(credit)` per `(transaction_group_id,
 * currency)` at COMMIT. Both legs of a pair therefore go in ONE `.insert([…])`
 * call; two separate calls in two transactions would fail the first commit.
 *
 * ## Currency
 *
 * CONVENTIONS §5: `sum(EUR) + sum(USD)` is meaningless. Every total this file
 * returns is keyed by currency (`totalsByCurrency` from repository-base). There
 * is no FX leg anywhere in the schema and no implicit conversion anywhere here.
 *
 * ## Role scoping, and why it is duplicated
 *
 * RLS is the boundary that must hold. The scoping below repeats it deliberately:
 * it is defence in depth against a mis-written policy, and it is the only thing
 * that works in local-seed mode, where there is no database and therefore no RLS
 * at all. The two must agree; migration `00000000000007_finance.sql` is the
 * reference, and `financeScope()` is a line-by-line mirror of its helpers.
 *
 * **An absent `role` fails closed.** Omitting it is not a way to see everything.
 */

import type { ApiError, Money, RepositoryResult, Role } from "@/lib/contracts"
import { roleLevel } from "@/lib/contracts"
import {
  asBoolean,
  asNullableNumber,
  asNullableString,
  asRecord,
  asString,
  clampLimit,
  clampOffset,
  nowIso,
  RepositoryError,
  totalsByCurrency,
  unwrap,
  withRepository,
  type RepositoryClient,
} from "@/lib/repository-base"
import {
  currencyCodes,
  ledgerEntryStatuses,
  ledgerEntryTypes,
  paymentDirections,
  paymentStatuses,
  seedGuardianships,
  seedLedgerEntries,
  seedPaymentTransactions,
  seedUnitResidency,
  seedVendorInvoices,
  seedWallets,
  vendorInvoiceStatuses,
  walletKinds,
  walletStatuses,
  type CurrencyCode,
  type LedgerEntry,
  type LedgerEntryStatus,
  type LedgerEntryType,
  type PaymentDirection,
  type PaymentStatus,
  type PaymentTransaction,
  type VendorInvoice,
  type VendorInvoiceStatus,
  type Wallet,
} from "@/lib/finance-data"

export type {
  CurrencyCode,
  LedgerEntry,
  LedgerEntryStatus,
  LedgerEntryType,
  PaymentDirection,
  PaymentStatus,
  PaymentTransaction,
  VendorInvoice,
  VendorInvoiceStatus,
  Wallet,
}
export {
  ledgerCredit,
  ledgerDebit,
  ledgerSigned,
  paymentMoney,
  vendorInvoiceOutstanding,
  walletBalance,
} from "@/lib/finance-data"

// ---------------------------------------------------------------------------
// Table names — one place to fix a typo, and greppable when W1-A renames one.
// ---------------------------------------------------------------------------

const T_LEDGER = "finance_ledger_entries"
const T_WALLETS = "wallets"
const T_VENDOR_INVOICES = "vendor_invoices"
const T_PAYMENTS = "payment_transactions"
const T_UNIT_RESIDENTS = "unit_residents"

const LEDGER_COLUMNS =
  "id, company_id, site_id, unit_id, resident_id, transaction_group_id, entry_type, status, period, due_date, posted_at, debit_amount, credit_amount, currency, signed_amount, description, reference, idempotency_key, reversal_of, created_by, metadata, created_at, updated_at"

const WALLET_COLUMNS =
  "id, company_id, owner_profile_id, kind, currency, balance_amount, allows_overdraft, overdraft_limit_amount, low_balance_threshold_amount, status, version, created_at, updated_at"

const VENDOR_INVOICE_COLUMNS =
  "id, company_id, site_id, vendor_profile_id, vendor_name, invoice_no, status, total_amount, tax_amount, paid_amount, currency, issued_on, due_on, ledger_entry_id, document_path, notes, version, created_at, updated_at"

const PAYMENT_COLUMNS =
  "id, company_id, ledger_entry_id, vendor_invoice_id, wallet_id, unit_id, resident_id, provider, provider_reference, direction, status, amount, currency, paid_at, failure_reason, idempotency_key, provider_payload, created_by, created_at, updated_at"

// ---------------------------------------------------------------------------
// The resident projection
//
// RLS is row-level: a policy decides whether an owner may read a payment row,
// never which of its columns they get. `payment_transactions_select_own_unit`
// therefore hands an owner the WHOLE row, `provider_payload` included — and
// `createPayment()` writes the operator's own note into that column. Measured on
// 2026-08-03 against the live database: owner@azura.local received 29 payment
// rows, all 29 carrying a non-empty `provider_payload`, plus 65 ledger rows all
// carrying non-empty `metadata`. Nothing in the product renders any of those
// columns; they simply travelled.
//
// So the projection is narrowed HERE, by role. An accountant reconciling a
// gateway response legitimately needs the payload, the idempotency key and the
// clerk who entered the row; a resident reading their own statement needs the
// amount, the currency, the date and what it was for. `scope.companyWide` is
// already the accountant-and-above gate, so it is the gate used.
//
// The narrowing is a SECOND lock, not the only one. RLS still decides which
// rows exist for this caller; this decides how much of each row leaves the
// repository.
// ---------------------------------------------------------------------------

/** Ledger columns minus the three a resident statement has no use for. */
const LEDGER_COLUMNS_SCOPED =
  "id, company_id, site_id, unit_id, resident_id, transaction_group_id, entry_type, status, period, due_date, posted_at, debit_amount, credit_amount, currency, signed_amount, description, reference, reversal_of, created_at, updated_at"

/**
 * Payment columns minus the gateway payload and two internal ids.
 *
 * **`ledger_entry_id` stays, and removing it was a real regression** caught in
 * review. `reconcilePayments()` in `components/finance/ledger-analysis.ts` reads
 * it to decide whether a payment is matched to a ledger entry, and the finance
 * page renders the unmatched set as a red list under "belonging to no ledger
 * entry and no invoice". Withholding the column does not hide the link — it
 * makes the application blind to a link that exists, so every one of an owner's
 * 29 settled payments moved into that red list. A fabricated finding shown to a
 * real user is the exact failure this project's honesty rule exists to prevent,
 * and it is worse than the disclosure it was meant to fix.
 *
 * It discloses nothing in any case: it is a foreign key to `finance_ledger_entries`
 * rows the same caller is already granted by that table's own RLS.
 *
 * What is genuinely withheld from a resident-scoped caller is the gateway's raw
 * `provider_payload`, the `idempotency_key` and `created_by` — see
 * `withheldPaymentFields`.
 */
const PAYMENT_COLUMNS_SCOPED =
  "id, company_id, ledger_entry_id, vendor_invoice_id, wallet_id, unit_id, resident_id, provider, provider_reference, direction, status, amount, currency, paid_at, failure_reason, created_at, updated_at"

/**
 * The fields a narrowed projection withholds. Exported so a surface can state
 * "withheld" rather than rendering the `null` this repository substitutes — the
 * two are different facts and CONVENTIONS §5 forbids conflating them.
 */
export const withheldLedgerFields = [
  "idempotencyKey",
  "createdBy",
  "metadata",
] as const

export const withheldPaymentFields = [
  "idempotencyKey",
  "providerPayload",
  "createdBy",
] as const

/**
 * True when this caller's ledger and payment rows arrive narrowed, i.e. when
 * `withheldLedgerFields` / `withheldPaymentFields` are `null` because they were
 * withheld and NOT because the column was empty.
 *
 * Mirrors `canReadCompanyFinance()` so a caller can ask the question without
 * constructing a scope.
 */
export function financeProjectionIsNarrowed(role: Role | undefined): boolean {
  return !(role !== undefined && canReadCompanyFinance(role))
}

// ---------------------------------------------------------------------------
// Coercion local to this file
// ---------------------------------------------------------------------------

/**
 * A NOT NULL SQL enum whose value the TS union does not contain means the
 * database schema is ahead of the code — a deployment error, not bad data.
 * `persistence_unavailable` (503) is the honest answer: retrying after a deploy
 * genuinely fixes it, and guessing a default would silently mis-state a
 * financial status.
 */
function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  column: string
): T {
  const match = allowed.find((candidate) => candidate === value)
  if (match === undefined) {
    const apiError: ApiError = {
      code: "persistence_unavailable",
      message: "The data service is temporarily unavailable.",
      details: { column },
      retryable: true,
    }
    throw new RepositoryError(
      apiError,
      new Error(`Unrecognised value for ${column}`)
    )
  }
  return match
}

/**
 * `null` for anything that is not one of the four currency codes. Never guesses
 * EUR: an amount whose currency did not survive the round trip is unreadable,
 * and CONVENTIONS §5 makes inventing one the exact bug to avoid.
 */
function asCurrency(value: unknown): CurrencyCode | null {
  const match = currencyCodes.find((candidate) => candidate === value)
  return match ?? null
}

// ---------------------------------------------------------------------------
// Mappers — PostgREST row → domain row
//
// `numeric(14,2)` arrives as a STRING ("112000.00"). `asNullableNumber` parses it
// and returns null for anything unparseable. Never `?? 0`: CONVENTIONS §5, a
// price of 0 is a bug and a price of null is an honest gap.
// ---------------------------------------------------------------------------

function mapLedgerEntry(value: unknown): LedgerEntry {
  const row = asRecord(value)
  return {
    id: asString(row["id"]),
    companyId: asString(row["company_id"]),
    siteId: asNullableString(row["site_id"]),
    unitId: asNullableString(row["unit_id"]),
    residentId: asNullableString(row["resident_id"]),
    transactionGroupId: asNullableString(row["transaction_group_id"]),
    entryType: requireEnum(row["entry_type"], ledgerEntryTypes, "entry_type"),
    status: requireEnum(row["status"], ledgerEntryStatuses, "status"),
    period: asNullableString(row["period"]),
    dueDate: asNullableString(row["due_date"]),
    postedAt: asNullableString(row["posted_at"]),
    debitAmount: asNullableNumber(row["debit_amount"]),
    creditAmount: asNullableNumber(row["credit_amount"]),
    currency: asCurrency(row["currency"]),
    signedAmount: asNullableNumber(row["signed_amount"]),
    description: asNullableString(row["description"]),
    reference: asNullableString(row["reference"]),
    idempotencyKey: asNullableString(row["idempotency_key"]),
    reversalOf: asNullableString(row["reversal_of"]),
    createdBy: asNullableString(row["created_by"]),
    metadata: asRecord(row["metadata"]),
    createdAt: asString(row["created_at"]),
    updatedAt: asString(row["updated_at"]),
  }
}

function mapWallet(value: unknown): Wallet {
  const row = asRecord(value)
  return {
    id: asString(row["id"]),
    companyId: asString(row["company_id"]),
    owningProfileId: asNullableString(row["owner_profile_id"]),
    kind: requireEnum(row["kind"], walletKinds, "kind"),
    currency: asCurrency(row["currency"]),
    balanceAmount: asNullableNumber(row["balance_amount"]),
    allowsOverdraft: asBoolean(row["allows_overdraft"]),
    overdraftLimitAmount: asNullableNumber(row["overdraft_limit_amount"]),
    lowBalanceThresholdAmount: asNullableNumber(
      row["low_balance_threshold_amount"]
    ),
    status: requireEnum(row["status"], walletStatuses, "status"),
    version: asNullableNumber(row["version"]) ?? 1,
    createdAt: asString(row["created_at"]),
    updatedAt: asString(row["updated_at"]),
  }
}

function mapVendorInvoice(value: unknown): VendorInvoice {
  const row = asRecord(value)
  const totalAmount = asNullableNumber(row["total_amount"])
  const paidAmount = asNullableNumber(row["paid_amount"])
  return {
    id: asString(row["id"]),
    companyId: asString(row["company_id"]),
    siteId: asNullableString(row["site_id"]),
    vendorProfileId: asNullableString(row["vendor_profile_id"]),
    vendorName: asString(row["vendor_name"]),
    invoiceNo: asString(row["invoice_no"]),
    status: requireEnum(row["status"], vendorInvoiceStatuses, "status"),
    totalAmount,
    taxAmount: asNullableNumber(row["tax_amount"]),
    paidAmount,
    // Derived here rather than in SQL so seed mode and Supabase mode compute it
    // identically. Unreadable on either side ⟹ unreadable outstanding, not 0.
    outstandingAmount:
      totalAmount === null || paidAmount === null
        ? null
        : totalAmount - paidAmount,
    currency: asCurrency(row["currency"]),
    issuedOn: asString(row["issued_on"]),
    dueOn: asNullableString(row["due_on"]),
    ledgerEntryId: asNullableString(row["ledger_entry_id"]),
    documentPath: asNullableString(row["document_path"]),
    notes: asNullableString(row["notes"]),
    version: asNullableNumber(row["version"]) ?? 1,
    createdAt: asString(row["created_at"]),
    updatedAt: asString(row["updated_at"]),
  }
}

function mapPaymentTransaction(value: unknown): PaymentTransaction {
  const row = asRecord(value)
  return {
    id: asString(row["id"]),
    companyId: asString(row["company_id"]),
    ledgerEntryId: asNullableString(row["ledger_entry_id"]),
    vendorInvoiceId: asNullableString(row["vendor_invoice_id"]),
    walletId: asNullableString(row["wallet_id"]),
    unitId: asNullableString(row["unit_id"]),
    residentId: asNullableString(row["resident_id"]),
    provider: asString(row["provider"]),
    providerReference: asNullableString(row["provider_reference"]),
    direction: requireEnum(row["direction"], paymentDirections, "direction"),
    status: requireEnum(row["status"], paymentStatuses, "status"),
    amount: asNullableNumber(row["amount"]),
    currency: asCurrency(row["currency"]),
    paidAt: asNullableString(row["paid_at"]),
    failureReason: asNullableString(row["failure_reason"]),
    idempotencyKey: asNullableString(row["idempotency_key"]),
    providerPayload: asRecord(row["provider_payload"]),
    createdBy: asNullableString(row["created_by"]),
    createdAt: asString(row["created_at"]),
    updatedAt: asString(row["updated_at"]),
  }
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

/**
 * Who is asking. `role` drives every predicate below; `profileId` resolves
 * wallets, vendor invoices and residency.
 *
 * `unitIds` is an optimisation: pass it when the caller has already resolved the
 * units the profile holds and the repository will skip the `unit_residents`
 * lookup. Passing units the caller does not hold does not widen anything in
 * Supabase mode — RLS still refuses them — but it would in seed mode, so treat
 * it as trusted input from the route handler, never from a request body.
 */
export interface FinanceAccess {
  role?: Role
  profileId?: string | null
  unitIds?: readonly string[]
}

interface FinanceScope {
  /** admin / manager / accountant: the whole company's books. */
  companyWide: boolean
  /** Units the caller holds. Empty for everyone who is not a resident role. */
  unitIds: readonly string[]
  /** The profile whose own wallet and own invoices the caller may read. */
  selfProfileId: string | null
  /** service_provider: vendor invoices where they are the vendor, nothing else. */
  isVendor: boolean
  /** guest, child_guest, anon, or no role at all: finance is invisible. */
  denied: boolean
}

const DENIED_SCOPE: FinanceScope = {
  companyWide: false,
  unitIds: [],
  selfProfileId: null,
  isVendor: false,
  denied: true,
}

/**
 * Mirrors `is_finance_visible_role()`: FALSE for anon, `guest` and `child_guest`.
 * Finance has no public surface — `anon` holds no grant on any of the four
 * tables — and an absent role is treated as anon here.
 */
function isFinanceVisibleRole(role: Role | undefined): role is Role {
  return role !== undefined && role !== "guest" && role !== "child_guest"
}

/** Mirrors `can_read_unit_finance()`: the four residency roles, and only those. */
function isResidencyRole(role: Role): boolean {
  return (
    role === "owner" ||
    role === "tenant" ||
    role === "child_owner" ||
    role === "child_tenant"
  )
}

/**
 * Mirrors `can_read_company_finance()`: manager (70) and above read across
 * companies; accountant (60) is confined to its own company.
 *
 * The company confinement is enforced by RLS, not here: this repository is not
 * told which company the caller belongs to. Callers that need it pass
 * `companyId` on the query, and Supabase mode refuses anything else regardless.
 */
function canReadCompanyFinance(role: Role): boolean {
  return isFinanceVisibleRole(role) && roleLevel[role] >= roleLevel.accountant
}

function financeScope(
  access: FinanceAccess,
  resolvedUnitIds: readonly string[]
): FinanceScope {
  const { role } = access
  if (!isFinanceVisibleRole(role)) return DENIED_SCOPE

  const selfProfileId = access.profileId ?? null

  return {
    companyWide: canReadCompanyFinance(role),
    unitIds: isResidencyRole(role) ? resolvedUnitIds : [],
    selfProfileId,
    isVendor: role === "service_provider",
    denied: false,
  }
}

// ---------------------------------------------------------------------------
// Applying the narrowed projection
//
// Two halves that must agree: the column list sent to PostgREST, and the
// blanking applied to seed rows (where there is no SQL to narrow). A row that
// arrived without the column already maps to `null` / `{}`; blanking the seed
// twin is what keeps the two modes indistinguishable to a caller.
// ---------------------------------------------------------------------------

function ledgerColumnsFor(scope: FinanceScope): string {
  return scope.companyWide ? LEDGER_COLUMNS : LEDGER_COLUMNS_SCOPED
}

function paymentColumnsFor(scope: FinanceScope): string {
  return scope.companyWide ? PAYMENT_COLUMNS : PAYMENT_COLUMNS_SCOPED
}

/** `null` here means WITHHELD. `financeProjectionIsNarrowed()` tells them apart. */
function narrowLedgerEntry(entry: LedgerEntry): LedgerEntry {
  return { ...entry, idempotencyKey: null, createdBy: null, metadata: {} }
}

function narrowPayment(payment: PaymentTransaction): PaymentTransaction {
  return {
    ...payment,
    idempotencyKey: null,
    providerPayload: {},
    createdBy: null,
  }
}

function applyLedgerProjection(
  entries: readonly LedgerEntry[],
  scope: FinanceScope
): LedgerEntry[] {
  if (scope.companyWide) return [...entries]
  return entries.map(narrowLedgerEntry)
}

function applyPaymentProjection(
  payments: readonly PaymentTransaction[],
  scope: FinanceScope
): PaymentTransaction[] {
  if (scope.companyWide) return [...payments]
  return payments.map(narrowPayment)
}

/**
 * The guardian a `child_*` role resolves to, mirroring
 * `current_user_scope_profile_id()`. A child reaches exactly its guardian's
 * units and never more — that is what "a child role inherits a strict subset"
 * has to mean to be testable (CONTRACTS §3, additive-authority rule).
 */
function seedScopeProfileId(profileId: string | null): string | null {
  if (profileId === null) return null
  const guardianship = seedGuardianships().find(
    (row) => row.childProfileId === profileId
  )
  return guardianship?.guardianProfileId ?? profileId
}

/**
 * Units the profile holds, from the seed residency fixture. Used in local-seed
 * mode, where `current_user_unit_ids()` does not exist.
 */
export function seedUnitIdsForProfile(profileId: string | null): string[] {
  const scopeProfileId = seedScopeProfileId(profileId)
  if (scopeProfileId === null) return []
  return seedUnitResidency()
    .filter((row) => row.profileId === scopeProfileId && row.endDate === null)
    .map((row) => row.unitId)
}

/**
 * Units the profile holds, from `unit_residents` joined through `residents`.
 * One query, not one per unit — a per-unit lookup is the N+1 the brief calls out.
 *
 * Exported because `lib/operations-repository.ts` scopes on exactly the same
 * predicate. A security predicate that exists twice is a security predicate that
 * will eventually disagree with itself.
 */
export async function resolveScopedUnitIds(
  client: RepositoryClient,
  profileId: string | null
): Promise<string[]> {
  if (profileId === null) return []
  const response = await client
    .from(T_UNIT_RESIDENTS)
    .select("unit_id, relation, residents!inner(profile_id)")
    .eq("residents.profile_id", profileId)
    .is("end_date", null)
    .limit(500)
  const rows = unwrap<unknown[]>(response, [])
  const unitIds = rows
    .map((row) => asNullableString(asRecord(row)["unit_id"]))
    .filter((unitId): unitId is string => unitId !== null)
  return [...new Set(unitIds)]
}

async function scopeFor(
  client: RepositoryClient | null,
  access: FinanceAccess
): Promise<FinanceScope> {
  if (!isFinanceVisibleRole(access.role)) return DENIED_SCOPE
  if (access.unitIds !== undefined) return financeScope(access, access.unitIds)
  if (!isResidencyRole(access.role)) return financeScope(access, [])

  const profileId = access.profileId ?? null
  const unitIds =
    client === null
      ? seedUnitIdsForProfile(profileId)
      : await resolveScopedUnitIds(client, profileId)
  return financeScope(access, unitIds)
}

// ---------------------------------------------------------------------------
// Query options
// ---------------------------------------------------------------------------

export interface PageOptions {
  /** Clamped to [1, 500]; defaults to 50. Never unbounded. */
  limit?: number
  offset?: number
}

export interface LedgerEntryQuery extends FinanceAccess, PageOptions {
  companyId?: string
  siteId?: string
  unitId?: string
  residentId?: string
  transactionGroupId?: string
  entryType?: LedgerEntryType
  status?: LedgerEntryStatus
  /** `YYYY-MM`. */
  period?: string
  currency?: CurrencyCode
  /** Inclusive bounds on `due_date`, as `YYYY-MM-DD`. */
  dueFrom?: string
  dueTo?: string
  /** `true` keeps only reversal rows; `false` excludes them. */
  isReversal?: boolean
}

export interface WalletQuery extends FinanceAccess, PageOptions {
  companyId?: string
  kind?: Wallet["kind"]
  status?: Wallet["status"]
  currency?: CurrencyCode
  /** Only wallets whose balance is below `low_balance_threshold_amount`. */
  lowBalanceOnly?: boolean
}

export interface VendorInvoiceQuery extends FinanceAccess, PageOptions {
  companyId?: string
  siteId?: string
  vendorProfileId?: string
  status?: VendorInvoiceStatus
  currency?: CurrencyCode
  /**
   * Derived, not stored: invoices with a remaining balance and a `due_on` in the
   * past relative to `asOf`. There is no `overdue` status to filter on.
   */
  overdueOnly?: boolean
  /** Reference instant for `overdueOnly`. Defaults to the repository clock. */
  asOf?: string
}

export interface PaymentTransactionQuery extends FinanceAccess, PageOptions {
  companyId?: string
  unitId?: string
  residentId?: string
  walletId?: string
  vendorInvoiceId?: string
  ledgerEntryId?: string
  direction?: PaymentDirection
  status?: PaymentStatus
  currency?: CurrencyCode
  provider?: string
}

export interface FinanceSummaryQuery extends FinanceAccess {
  companyId?: string
  siteId?: string
  /**
   * The instant ageing is measured against. Defaults to now. Pass
   * `SEED_ANCHOR_ISO` when a snapshot must be byte-stable across runs.
   */
  asOf?: string
}

// ---------------------------------------------------------------------------
// Summary shapes
// ---------------------------------------------------------------------------

/** Days past `due_on`. `current` also holds everything with no due date. */
export interface AgeingBuckets {
  current: number
  days1To30: number
  days31To60: number
  days61To90: number
  days90Plus: number
}

export interface FinanceSummary {
  /** Reference instant for the ageing buckets. */
  asOf: string
  /**
   * Signed ledger totals per currency (debit positive, credit negative), for
   * POSTED rows only. Never summed across currencies — CONVENTIONS §5.
   */
  postedSignedByCurrency: Record<string, number>
  postedDebitByCurrency: Record<string, number>
  postedCreditByCurrency: Record<string, number>
  /** Drafts are not part of the books yet; kept separate, never merged in. */
  draftSignedByCurrency: Record<string, number>
  /**
   * DERIVED "open": the unpaid remainder of vendor invoices that are neither
   * paid, void nor draft. The ledger has no settlement status to read this from.
   */
  openVendorInvoiceByCurrency: Record<string, number>
  settledVendorInvoiceByCurrency: Record<string, number>
  /** Ageing of that same unpaid remainder, per currency. */
  ageingByCurrency: Record<string, AgeingBuckets>
  capturedInboundByCurrency: Record<string, number>
  capturedOutboundByCurrency: Record<string, number>
  walletBalanceByCurrency: Record<string, number>
  counts: {
    ledgerEntries: number
    postedEntries: number
    draftEntries: number
    voidEntries: number
    reversalEntries: number
    vendorInvoices: number
    openVendorInvoices: number
    overdueVendorInvoices: number
    payments: number
    capturedPayments: number
    failedPayments: number
    wallets: number
    walletsInOverdraft: number
    walletsBelowThreshold: number
  }
  /**
   * Rows whose `numeric` column could not be parsed and were therefore left OUT
   * of every total above. Surfaced rather than zeroed: a total that silently
   * dropped rows is worse than a total that admits it did.
   */
  unreadableAmounts: number
}

// ---------------------------------------------------------------------------
// Seed-side filtering
//
// The JS twin of the PostgREST filters below. Duplication between SQL and JS is
// inherent; keeping the two adjacent is what makes a divergence visible.
// ---------------------------------------------------------------------------

function ledgerVisible(entry: LedgerEntry, scope: FinanceScope): boolean {
  if (scope.denied) return false
  if (scope.companyWide) return true
  // can_read_unit_finance(): residency only, and only for units actually held.
  if (entry.unitId !== null && scope.unitIds.includes(entry.unitId)) return true
  return false
}

function walletVisible(wallet: Wallet, scope: FinanceScope): boolean {
  if (scope.denied) return false
  if (scope.companyWide) return true
  // can_read_own_wallet(): the holder, and nobody else below manager.
  return (
    scope.selfProfileId !== null &&
    wallet.owningProfileId === scope.selfProfileId
  )
}

function vendorInvoiceVisible(
  invoice: VendorInvoice,
  scope: FinanceScope
): boolean {
  if (scope.denied) return false
  if (scope.companyWide) return true
  // is_invoice_vendor(): restricted to the service_provider role itself, so an
  // owner named as a vendor does not gain a second read path.
  return (
    scope.isVendor &&
    scope.selfProfileId !== null &&
    invoice.vendorProfileId === scope.selfProfileId
  )
}

function paymentVisible(
  payment: PaymentTransaction,
  scope: FinanceScope,
  ownWalletIds: readonly string[]
): boolean {
  if (scope.denied) return false
  if (scope.companyWide) return true
  if (payment.unitId !== null && scope.unitIds.includes(payment.unitId))
    return true
  if (payment.walletId !== null && ownWalletIds.includes(payment.walletId))
    return true
  return false
}

function compareDesc(a: string | null, b: string | null): number {
  // Nulls last, matching `.order(…, { nullsFirst: false })`.
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a < b ? 1 : -1
}

function paginate<T>(rows: readonly T[], options: PageOptions): T[] {
  const limit = clampLimit(options.limit)
  const offset = clampOffset(options.offset)
  return rows.slice(offset, offset + limit)
}

// ---------------------------------------------------------------------------
// Ageing
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000

/**
 * Whole days between `due_on` and `asOf`, positive when overdue. Pure arithmetic
 * on ISO strings — no shell date math, no locale, no DST surprises
 * (SYSTEM-PROMPT §2.17).
 */
function daysOverdue(dueOn: string | null, asOfIso: string): number | null {
  if (dueOn === null) return null
  const due = Date.parse(`${dueOn}T00:00:00.000Z`)
  const asOf = Date.parse(asOfIso)
  if (!Number.isFinite(due) || !Number.isFinite(asOf)) return null
  return Math.floor((asOf - due) / MS_PER_DAY)
}

function emptyAgeing(): AgeingBuckets {
  return {
    current: 0,
    days1To30: 0,
    days31To60: 0,
    days61To90: 0,
    days90Plus: 0,
  }
}

function ageingBucketFor(days: number | null): keyof AgeingBuckets {
  if (days === null || days <= 0) return "current"
  if (days <= 30) return "days1To30"
  if (days <= 60) return "days31To60"
  if (days <= 90) return "days61To90"
  return "days90Plus"
}

/** An invoice still owes money when it is neither draft, void nor fully paid. */
function isOpenInvoice(invoice: VendorInvoice): boolean {
  if (invoice.status === "draft" || invoice.status === "void") return false
  if (invoice.outstandingAmount === null) return false
  return invoice.outstandingAmount > 0
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

function seedLedgerFiltered(
  query: LedgerEntryQuery,
  scope: FinanceScope
): LedgerEntry[] {
  const rows = seedLedgerEntries()
    .filter((entry) => ledgerVisible(entry, scope))
    .filter(
      (entry) =>
        query.companyId === undefined || entry.companyId === query.companyId
    )
    .filter(
      (entry) => query.siteId === undefined || entry.siteId === query.siteId
    )
    .filter(
      (entry) => query.unitId === undefined || entry.unitId === query.unitId
    )
    .filter(
      (entry) =>
        query.residentId === undefined || entry.residentId === query.residentId
    )
    .filter(
      (entry) =>
        query.transactionGroupId === undefined ||
        entry.transactionGroupId === query.transactionGroupId
    )
    .filter(
      (entry) =>
        query.entryType === undefined || entry.entryType === query.entryType
    )
    .filter(
      (entry) => query.status === undefined || entry.status === query.status
    )
    .filter(
      (entry) => query.period === undefined || entry.period === query.period
    )
    .filter(
      (entry) =>
        query.currency === undefined || entry.currency === query.currency
    )
    .filter(
      (entry) =>
        query.dueFrom === undefined ||
        (entry.dueDate !== null && entry.dueDate >= query.dueFrom)
    )
    .filter(
      (entry) =>
        query.dueTo === undefined ||
        (entry.dueDate !== null && entry.dueDate <= query.dueTo)
    )
    .filter(
      (entry) =>
        query.isReversal === undefined ||
        (query.isReversal
          ? entry.reversalOf !== null
          : entry.reversalOf === null)
    )
    .sort(
      (a, b) =>
        compareDesc(a.postedAt, b.postedAt) ||
        compareDesc(a.createdAt, b.createdAt)
    )
  return applyLedgerProjection(paginate(rows, query), scope)
}

async function fetchLedgerRows(
  client: RepositoryClient,
  query: LedgerEntryQuery,
  scope: FinanceScope,
  page: PageOptions
): Promise<LedgerEntry[]> {
  if (scope.denied) return []
  // Not company-wide and holding no unit ⟹ nothing is visible. Returning early
  // is still `source: "supabase"`: an empty result is a fact about the caller's
  // scope, never a reason to substitute seed data.
  if (!scope.companyWide && scope.unitIds.length === 0) return []

  // Narrowed for anyone below accountant: the withheld columns are not selected
  // at all, so they never cross the wire and never reach a log or a cache.
  let builder = client.from(T_LEDGER).select(ledgerColumnsFor(scope))

  if (!scope.companyWide) builder = builder.in("unit_id", [...scope.unitIds])
  if (query.companyId !== undefined)
    builder = builder.eq("company_id", query.companyId)
  if (query.siteId !== undefined) builder = builder.eq("site_id", query.siteId)
  if (query.unitId !== undefined) builder = builder.eq("unit_id", query.unitId)
  if (query.residentId !== undefined)
    builder = builder.eq("resident_id", query.residentId)
  if (query.transactionGroupId !== undefined) {
    builder = builder.eq("transaction_group_id", query.transactionGroupId)
  }
  if (query.entryType !== undefined)
    builder = builder.eq("entry_type", query.entryType)
  if (query.status !== undefined) builder = builder.eq("status", query.status)
  if (query.period !== undefined) builder = builder.eq("period", query.period)
  if (query.currency !== undefined)
    builder = builder.eq("currency", query.currency)
  if (query.dueFrom !== undefined)
    builder = builder.gte("due_date", query.dueFrom)
  if (query.dueTo !== undefined) builder = builder.lte("due_date", query.dueTo)
  if (query.isReversal === true)
    builder = builder.not("reversal_of", "is", null)
  if (query.isReversal === false) builder = builder.is("reversal_of", null)

  const limit = clampLimit(page.limit)
  const offset = clampOffset(page.offset)
  const response = await builder
    .order("posted_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  return unwrap<unknown[]>(response, []).map(mapLedgerEntry)
}

/**
 * Ledger entries, newest posting first. Drafts sort last because they have no
 * `posted_at`, which is the ordering an accountant expects.
 */
export async function getLedgerEntries(
  query: LedgerEntryQuery = {}
): Promise<RepositoryResult<LedgerEntry[]>> {
  return withRepository(
    async (client) => {
      const scope = await scopeFor(client, query)
      return fetchLedgerRows(client, query, scope, query)
    },
    () => seedLedgerFiltered(query, financeScope(query, seedScopeUnits(query))),
    "finance.getLedgerEntries"
  )
}

/** Resolve the seed-mode unit scope without a client. */
function seedScopeUnits(access: FinanceAccess): readonly string[] {
  if (access.unitIds !== undefined) return access.unitIds
  if (access.role === undefined || !isResidencyRole(access.role)) return []
  return seedUnitIdsForProfile(access.profileId ?? null)
}

/**
 * One entry, or `null` when it does not exist or the caller's scope excludes it.
 *
 * `null` rather than a throw for both cases on purpose: telling an owner that
 * entry X exists but belongs to somebody else is itself a disclosure. The route
 * handler maps `null` to 404.
 */
export async function getLedgerEntry(
  id: string,
  access: FinanceAccess = {}
): Promise<RepositoryResult<LedgerEntry | null>> {
  return withRepository(
    async (client) => {
      const scope = await scopeFor(client, access)
      if (scope.denied) return null
      const response = await client
        .from(T_LEDGER)
        .select(ledgerColumnsFor(scope))
        .eq("id", id)
        .maybeSingle()
      const row = unwrap<unknown>(response, null)
      if (row === null) return null
      const entry = mapLedgerEntry(row)
      if (!ledgerVisible(entry, scope)) return null
      return applyLedgerProjection([entry], scope)[0] ?? null
    },
    () => {
      const scope = financeScope(access, seedScopeUnits(access))
      const entry = seedLedgerEntries().find((candidate) => candidate.id === id)
      if (entry === undefined) return null
      if (!ledgerVisible(entry, scope)) return null
      return applyLedgerProjection([entry], scope)[0] ?? null
    },
    "finance.getLedgerEntry"
  )
}

// ---------------------------------------------------------------------------
// Wallets
// ---------------------------------------------------------------------------

function seedWalletsFiltered(
  query: WalletQuery,
  scope: FinanceScope
): Wallet[] {
  const rows = seedWallets()
    .filter((wallet) => walletVisible(wallet, scope))
    .filter(
      (wallet) =>
        query.companyId === undefined || wallet.companyId === query.companyId
    )
    .filter((wallet) => query.kind === undefined || wallet.kind === query.kind)
    .filter(
      (wallet) => query.status === undefined || wallet.status === query.status
    )
    .filter(
      (wallet) =>
        query.currency === undefined || wallet.currency === query.currency
    )
    .filter((wallet) => {
      if (query.lowBalanceOnly !== true) return true
      if (
        wallet.balanceAmount === null ||
        wallet.lowBalanceThresholdAmount === null
      )
        return false
      return wallet.balanceAmount < wallet.lowBalanceThresholdAmount
    })
    .sort((a, b) => compareDesc(a.updatedAt, b.updatedAt))
  return paginate(rows, query)
}

async function fetchWalletRows(
  client: RepositoryClient,
  query: WalletQuery,
  scope: FinanceScope,
  page: PageOptions
): Promise<Wallet[]> {
  if (scope.denied) return []
  if (!scope.companyWide && scope.selfProfileId === null) return []

  let builder = client.from(T_WALLETS).select(WALLET_COLUMNS)
  if (!scope.companyWide && scope.selfProfileId !== null) {
    builder = builder.eq("owner_profile_id", scope.selfProfileId)
  }
  if (query.companyId !== undefined)
    builder = builder.eq("company_id", query.companyId)
  if (query.kind !== undefined) builder = builder.eq("kind", query.kind)
  if (query.status !== undefined) builder = builder.eq("status", query.status)
  if (query.currency !== undefined)
    builder = builder.eq("currency", query.currency)

  const limit = clampLimit(page.limit)
  const offset = clampOffset(page.offset)
  const response = await builder
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1)

  const wallets = unwrap<unknown[]>(response, []).map(mapWallet)
  if (query.lowBalanceOnly !== true) return wallets
  // Column-to-column comparison is not expressible in a PostgREST filter, so it
  // is applied here. The page is already bounded, so this cannot scan the table.
  return wallets.filter(
    (wallet) =>
      wallet.balanceAmount !== null &&
      wallet.lowBalanceThresholdAmount !== null &&
      wallet.balanceAmount < wallet.lowBalanceThresholdAmount
  )
}

export async function getWallets(
  query: WalletQuery = {}
): Promise<RepositoryResult<Wallet[]>> {
  return withRepository(
    async (client) => {
      const scope = await scopeFor(client, query)
      return fetchWalletRows(client, query, scope, query)
    },
    () =>
      seedWalletsFiltered(query, financeScope(query, seedScopeUnits(query))),
    "finance.getWallets"
  )
}

/**
 * Every wallet a profile holds.
 *
 * An array, not one wallet: `unique (owner_profile_id, currency)` means a holder
 * may have one wallet per currency, and collapsing that to a single row would
 * silently hide the second one. CONVENTIONS §5 forbids adding them together.
 */
export async function getWalletForProfile(
  profileId: string,
  access: FinanceAccess = {}
): Promise<RepositoryResult<Wallet[]>> {
  return withRepository(
    async (client) => {
      const scope = await scopeFor(client, access)
      if (scope.denied) return []
      // A caller who is neither company-wide nor this profile may not read it,
      // even though RLS would also refuse.
      if (!scope.companyWide && scope.selfProfileId !== profileId) return []
      const response = await client
        .from(T_WALLETS)
        .select(WALLET_COLUMNS)
        .eq("owner_profile_id", profileId)
        .order("currency", { ascending: true })
        .limit(clampLimit())
      return unwrap<unknown[]>(response, []).map(mapWallet)
    },
    () => {
      const scope = financeScope(access, seedScopeUnits(access))
      if (scope.denied) return []
      if (!scope.companyWide && scope.selfProfileId !== profileId) return []
      return seedWallets()
        .filter((wallet) => wallet.owningProfileId === profileId)
        .sort((a, b) => (a.currency ?? "").localeCompare(b.currency ?? ""))
    },
    "finance.getWalletForProfile"
  )
}

// ---------------------------------------------------------------------------
// Vendor invoices
// ---------------------------------------------------------------------------

function seedVendorInvoicesFiltered(
  query: VendorInvoiceQuery,
  scope: FinanceScope,
  asOf: string
): VendorInvoice[] {
  const rows = seedVendorInvoices()
    .filter((invoice) => vendorInvoiceVisible(invoice, scope))
    .filter(
      (invoice) =>
        query.companyId === undefined || invoice.companyId === query.companyId
    )
    .filter(
      (invoice) => query.siteId === undefined || invoice.siteId === query.siteId
    )
    .filter(
      (invoice) =>
        query.vendorProfileId === undefined ||
        invoice.vendorProfileId === query.vendorProfileId
    )
    .filter(
      (invoice) => query.status === undefined || invoice.status === query.status
    )
    .filter(
      (invoice) =>
        query.currency === undefined || invoice.currency === query.currency
    )
    .filter((invoice) => {
      if (query.overdueOnly !== true) return true
      const days = daysOverdue(invoice.dueOn, asOf)
      return isOpenInvoice(invoice) && days !== null && days > 0
    })
    .sort(
      (a, b) =>
        compareDesc(a.dueOn, b.dueOn) || compareDesc(a.issuedOn, b.issuedOn)
    )
  return paginate(rows, query)
}

async function fetchVendorInvoiceRows(
  client: RepositoryClient,
  query: VendorInvoiceQuery,
  scope: FinanceScope,
  page: PageOptions,
  asOf: string
): Promise<VendorInvoice[]> {
  if (scope.denied) return []
  if (!scope.companyWide && !(scope.isVendor && scope.selfProfileId !== null))
    return []

  let builder = client.from(T_VENDOR_INVOICES).select(VENDOR_INVOICE_COLUMNS)
  if (!scope.companyWide && scope.selfProfileId !== null) {
    builder = builder.eq("vendor_profile_id", scope.selfProfileId)
  }
  if (query.companyId !== undefined)
    builder = builder.eq("company_id", query.companyId)
  if (query.siteId !== undefined) builder = builder.eq("site_id", query.siteId)
  if (query.vendorProfileId !== undefined) {
    builder = builder.eq("vendor_profile_id", query.vendorProfileId)
  }
  if (query.status !== undefined) builder = builder.eq("status", query.status)
  if (query.currency !== undefined)
    builder = builder.eq("currency", query.currency)
  if (query.overdueOnly === true) {
    // "Overdue" is derived. `status in (open, partially_paid)` plus a past due
    // date is the SQL half; the unpaid-remainder half is applied after mapping,
    // because `paid_amount < total_amount` compares two columns.
    builder = builder
      .in("status", ["open", "partially_paid"])
      .lt("due_on", asOf.slice(0, 10))
  }

  const limit = clampLimit(page.limit)
  const offset = clampOffset(page.offset)
  const response = await builder
    .order("due_on", { ascending: false, nullsFirst: false })
    .order("issued_on", { ascending: false })
    .range(offset, offset + limit - 1)

  const invoices = unwrap<unknown[]>(response, []).map(mapVendorInvoice)
  if (query.overdueOnly !== true) return invoices
  return invoices.filter(isOpenInvoice)
}

export async function getVendorInvoices(
  query: VendorInvoiceQuery = {}
): Promise<RepositoryResult<VendorInvoice[]>> {
  const asOf = query.asOf ?? nowIso()
  return withRepository(
    async (client) => {
      const scope = await scopeFor(client, query)
      return fetchVendorInvoiceRows(client, query, scope, query, asOf)
    },
    () =>
      seedVendorInvoicesFiltered(
        query,
        financeScope(query, seedScopeUnits(query)),
        asOf
      ),
    "finance.getVendorInvoices"
  )
}

export async function getVendorInvoice(
  id: string,
  access: FinanceAccess = {}
): Promise<RepositoryResult<VendorInvoice | null>> {
  return withRepository(
    async (client) => {
      const scope = await scopeFor(client, access)
      if (scope.denied) return null
      const response = await client
        .from(T_VENDOR_INVOICES)
        .select(VENDOR_INVOICE_COLUMNS)
        .eq("id", id)
        .maybeSingle()
      const row = unwrap<unknown>(response, null)
      if (row === null) return null
      const invoice = mapVendorInvoice(row)
      return vendorInvoiceVisible(invoice, scope) ? invoice : null
    },
    () => {
      const scope = financeScope(access, seedScopeUnits(access))
      const invoice = seedVendorInvoices().find(
        (candidate) => candidate.id === id
      )
      if (invoice === undefined) return null
      return vendorInvoiceVisible(invoice, scope) ? invoice : null
    },
    "finance.getVendorInvoice"
  )
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

function seedOwnWalletIds(scope: FinanceScope): string[] {
  if (scope.selfProfileId === null) return []
  return seedWallets()
    .filter((wallet) => wallet.owningProfileId === scope.selfProfileId)
    .map((wallet) => wallet.id)
}

async function fetchOwnWalletIds(
  client: RepositoryClient,
  scope: FinanceScope
): Promise<string[]> {
  if (scope.selfProfileId === null) return []
  const response = await client
    .from(T_WALLETS)
    .select("id")
    .eq("owner_profile_id", scope.selfProfileId)
    .limit(50)
  return unwrap<unknown[]>(response, [])
    .map((row) => asNullableString(asRecord(row)["id"]))
    .filter((id): id is string => id !== null)
}

function seedPaymentsFiltered(
  query: PaymentTransactionQuery,
  scope: FinanceScope
): PaymentTransaction[] {
  const ownWalletIds = seedOwnWalletIds(scope)
  const rows = seedPaymentTransactions()
    .filter((payment) => paymentVisible(payment, scope, ownWalletIds))
    .filter(
      (payment) =>
        query.companyId === undefined || payment.companyId === query.companyId
    )
    .filter(
      (payment) => query.unitId === undefined || payment.unitId === query.unitId
    )
    .filter(
      (payment) =>
        query.residentId === undefined ||
        payment.residentId === query.residentId
    )
    .filter(
      (payment) =>
        query.walletId === undefined || payment.walletId === query.walletId
    )
    .filter(
      (payment) =>
        query.vendorInvoiceId === undefined ||
        payment.vendorInvoiceId === query.vendorInvoiceId
    )
    .filter(
      (payment) =>
        query.ledgerEntryId === undefined ||
        payment.ledgerEntryId === query.ledgerEntryId
    )
    .filter(
      (payment) =>
        query.direction === undefined || payment.direction === query.direction
    )
    .filter(
      (payment) => query.status === undefined || payment.status === query.status
    )
    .filter(
      (payment) =>
        query.currency === undefined || payment.currency === query.currency
    )
    .filter(
      (payment) =>
        query.provider === undefined || payment.provider === query.provider
    )
    .sort(
      (a, b) =>
        compareDesc(a.paidAt, b.paidAt) || compareDesc(a.createdAt, b.createdAt)
    )
  return applyPaymentProjection(paginate(rows, query), scope)
}

async function fetchPaymentRows(
  client: RepositoryClient,
  query: PaymentTransactionQuery,
  scope: FinanceScope,
  page: PageOptions
): Promise<PaymentTransaction[]> {
  if (scope.denied) return []

  // Narrowed for anyone below accountant. `provider_payload` is the column that
  // matters here: `createPayment()` writes the operator's own note into it, and
  // a gateway integration would write its raw response there.
  let builder = client.from(T_PAYMENTS).select(paymentColumnsFor(scope))

  if (!scope.companyWide) {
    const ownWalletIds = await fetchOwnWalletIds(client, scope)
    const clauses: string[] = []
    if (scope.unitIds.length > 0)
      clauses.push(`unit_id.in.(${scope.unitIds.join(",")})`)
    if (ownWalletIds.length > 0)
      clauses.push(`wallet_id.in.(${ownWalletIds.join(",")})`)
    // No unit and no wallet ⟹ nothing visible. Still `source: "supabase"`.
    if (clauses.length === 0) return []
    builder = builder.or(clauses.join(","))
  }

  if (query.companyId !== undefined)
    builder = builder.eq("company_id", query.companyId)
  if (query.unitId !== undefined) builder = builder.eq("unit_id", query.unitId)
  if (query.residentId !== undefined)
    builder = builder.eq("resident_id", query.residentId)
  if (query.walletId !== undefined)
    builder = builder.eq("wallet_id", query.walletId)
  if (query.vendorInvoiceId !== undefined) {
    builder = builder.eq("vendor_invoice_id", query.vendorInvoiceId)
  }
  if (query.ledgerEntryId !== undefined) {
    builder = builder.eq("ledger_entry_id", query.ledgerEntryId)
  }
  if (query.direction !== undefined)
    builder = builder.eq("direction", query.direction)
  if (query.status !== undefined) builder = builder.eq("status", query.status)
  if (query.currency !== undefined)
    builder = builder.eq("currency", query.currency)
  if (query.provider !== undefined)
    builder = builder.eq("provider", query.provider)

  const limit = clampLimit(page.limit)
  const offset = clampOffset(page.offset)
  const response = await builder
    .order("paid_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  return applyPaymentProjection(
    unwrap<unknown[]>(response, []).map(mapPaymentTransaction),
    scope
  )
}

export async function getPaymentTransactions(
  query: PaymentTransactionQuery = {}
): Promise<RepositoryResult<PaymentTransaction[]>> {
  return withRepository(
    async (client) => {
      const scope = await scopeFor(client, query)
      return fetchPaymentRows(client, query, scope, query)
    },
    () =>
      seedPaymentsFiltered(query, financeScope(query, seedScopeUnits(query))),
    "finance.getPaymentTransactions"
  )
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const SUMMARY_PAGE: PageOptions = { limit: 500 }

function buildSummary(
  entries: readonly LedgerEntry[],
  invoices: readonly VendorInvoice[],
  payments: readonly PaymentTransaction[],
  wallets: readonly Wallet[],
  asOf: string
): FinanceSummary {
  let unreadableAmounts = 0

  const readable = <T>(
    rows: readonly T[],
    amountOf: (row: T) => number | null,
    currencyOf: (row: T) => CurrencyCode | null
  ): Array<{ amount: number; currency: string }> => {
    const out: Array<{ amount: number; currency: string }> = []
    for (const row of rows) {
      const amount = amountOf(row)
      const currency = currencyOf(row)
      if (amount === null || currency === null) {
        unreadableAmounts += 1
        continue
      }
      out.push({ amount, currency })
    }
    return out
  }

  const posted = entries.filter((entry) => entry.status === "posted")
  const drafts = entries.filter((entry) => entry.status === "draft")

  const postedSignedByCurrency = totalsByCurrency(
    readable(
      posted,
      (entry) => entry.signedAmount,
      (entry) => entry.currency
    )
  )
  const postedDebitByCurrency = totalsByCurrency(
    readable(
      posted,
      (entry) => entry.debitAmount,
      (entry) => entry.currency
    )
  )
  const postedCreditByCurrency = totalsByCurrency(
    readable(
      posted,
      (entry) => entry.creditAmount,
      (entry) => entry.currency
    )
  )
  const draftSignedByCurrency = totalsByCurrency(
    readable(
      drafts,
      (entry) => entry.signedAmount,
      (entry) => entry.currency
    )
  )

  const openInvoices = invoices.filter(isOpenInvoice)
  const openVendorInvoiceByCurrency = totalsByCurrency(
    readable(
      openInvoices,
      (invoice) => invoice.outstandingAmount,
      (invoice) => invoice.currency
    )
  )
  const settledVendorInvoiceByCurrency = totalsByCurrency(
    readable(
      invoices.filter(
        (invoice) => invoice.status !== "draft" && invoice.status !== "void"
      ),
      (invoice) => invoice.paidAmount,
      (invoice) => invoice.currency
    )
  )

  const ageingByCurrency: Record<string, AgeingBuckets> = {}
  let overdueVendorInvoices = 0
  for (const invoice of openInvoices) {
    const amount = invoice.outstandingAmount
    const currency = invoice.currency
    if (amount === null || currency === null) continue
    const days = daysOverdue(invoice.dueOn, asOf)
    if (days !== null && days > 0) overdueVendorInvoices += 1
    const bucket = ageingBucketFor(days)
    const buckets = ageingByCurrency[currency] ?? emptyAgeing()
    buckets[bucket] += amount
    ageingByCurrency[currency] = buckets
  }

  const captured = payments.filter((payment) => payment.status === "captured")
  const capturedInboundByCurrency = totalsByCurrency(
    readable(
      captured.filter((payment) => payment.direction === "inbound"),
      (payment) => payment.amount,
      (payment) => payment.currency
    )
  )
  const capturedOutboundByCurrency = totalsByCurrency(
    readable(
      captured.filter((payment) => payment.direction === "outbound"),
      (payment) => payment.amount,
      (payment) => payment.currency
    )
  )

  const walletBalanceByCurrency = totalsByCurrency(
    readable(
      wallets,
      (wallet) => wallet.balanceAmount,
      (wallet) => wallet.currency
    )
  )

  return {
    asOf,
    postedSignedByCurrency,
    postedDebitByCurrency,
    postedCreditByCurrency,
    draftSignedByCurrency,
    openVendorInvoiceByCurrency,
    settledVendorInvoiceByCurrency,
    ageingByCurrency,
    capturedInboundByCurrency,
    capturedOutboundByCurrency,
    walletBalanceByCurrency,
    counts: {
      ledgerEntries: entries.length,
      postedEntries: posted.length,
      draftEntries: drafts.length,
      voidEntries: entries.filter((entry) => entry.status === "void").length,
      reversalEntries: entries.filter((entry) => entry.reversalOf !== null)
        .length,
      vendorInvoices: invoices.length,
      openVendorInvoices: openInvoices.length,
      overdueVendorInvoices,
      payments: payments.length,
      capturedPayments: captured.length,
      failedPayments: payments.filter((payment) => payment.status === "failed")
        .length,
      wallets: wallets.length,
      walletsInOverdraft: wallets.filter(
        (wallet) => wallet.balanceAmount !== null && wallet.balanceAmount < 0
      ).length,
      walletsBelowThreshold: wallets.filter(
        (wallet) =>
          wallet.balanceAmount !== null &&
          wallet.lowBalanceThresholdAmount !== null &&
          wallet.balanceAmount < wallet.lowBalanceThresholdAmount
      ).length,
    },
    unreadableAmounts,
  }
}

/**
 * Per-currency totals, open-versus-posted, and ageing buckets.
 *
 * "Open" is DERIVED from `vendor_invoices.paid_amount`, not read from a status
 * column — the ledger has none and cannot have one. Nothing here is summed
 * across currencies; every figure is keyed by its currency code.
 *
 * One page (500 rows) per table. A company with more than 500 ledger rows in
 * scope needs a SQL-side aggregate, which is a request for W1-A rather than a
 * bigger fetch here — see HANDOFF.
 */
export async function getFinanceSummary(
  query: FinanceSummaryQuery = {}
): Promise<RepositoryResult<FinanceSummary>> {
  const asOf = query.asOf ?? nowIso()
  const base: FinanceAccess = { ...query }
  const scoped: LedgerEntryQuery &
    VendorInvoiceQuery &
    PaymentTransactionQuery = {
    ...base,
    ...SUMMARY_PAGE,
    ...(query.companyId === undefined ? {} : { companyId: query.companyId }),
    ...(query.siteId === undefined ? {} : { siteId: query.siteId }),
  }

  return withRepository(
    async (client) => {
      const scope = await scopeFor(client, base)
      // Sequential rather than parallel: `Promise.all` would leave the losing
      // queries running after the first rejection, and a throwing query is the
      // signal this repository must not swallow.
      const entries = await fetchLedgerRows(client, scoped, scope, SUMMARY_PAGE)
      const invoices = await fetchVendorInvoiceRows(
        client,
        scoped,
        scope,
        SUMMARY_PAGE,
        asOf
      )
      const payments = await fetchPaymentRows(
        client,
        scoped,
        scope,
        SUMMARY_PAGE
      )
      const wallets = await fetchWalletRows(client, scoped, scope, SUMMARY_PAGE)
      return buildSummary(entries, invoices, payments, wallets, asOf)
    },
    () => {
      const scope = financeScope(base, seedScopeUnits(base))
      return buildSummary(
        seedLedgerFiltered(scoped, scope),
        seedVendorInvoicesFiltered(scoped, scope, asOf),
        seedPaymentsFiltered(scoped, scope),
        seedWalletsFiltered(scoped, scope),
        asOf
      )
    },
    "finance.getFinanceSummary"
  )
}

// ---------------------------------------------------------------------------
// Writes
//
// Both functions below issue their statement through the CALLER's client, so RLS
// applies. Note the grant model in migration 07: `authenticated` holds SELECT
// only on all four finance tables, and INSERT/UPDATE/DELETE are revoked —
// mutation is expected to arrive through service-role RPCs. Until W1-A ships
// those, these calls surface `forbidden` (42501) rather than silently
// succeeding, which is the correct failure. Recorded in HANDOFF as a request.
// ---------------------------------------------------------------------------

export interface ReverseLedgerEntryInput extends FinanceAccess {
  /** The posted entry to cancel. */
  entryId: string
  /** Why. Stored on the reversal row; a correction with no reason is not one. */
  reason: string
  actorProfileId?: string | null
  /**
   * Supply to make the reversal a balanced pair rather than a single-sided row.
   * Both legs are then written in ONE insert, because the balance trigger is
   * deferred to COMMIT and checks the group as a whole.
   */
  balancedGroupId?: string
  /** Entry type of the counter leg. Defaults to `adjustment`. */
  counterEntryType?: LedgerEntryType
}

export interface LedgerReversalResult {
  /** The reversal row, and its counter leg when a balanced group was requested. */
  entries: LedgerEntry[]
  reversedEntryId: string
}

function reversalRowsFor(
  original: LedgerEntry,
  input: ReverseLedgerEntryInput,
  nowIsoValue: string
): LedgerEntry[] {
  // Deterministic, uuid-shaped and obviously synthetic. The database generates
  // the real ids; this only has to be stable for seed mode.
  const reversalId = `a1ffffff-0000-4000-8000-${original.id.slice(-12)}`
  const counterId = `a1eeeeee-0000-4000-8000-${original.id.slice(-12)}`

  const reversal: LedgerEntry = {
    ...original,
    id: reversalId,
    entryType: "reversal",
    status: "posted",
    postedAt: nowIsoValue,
    // The mirror image: what was debited is credited back.
    debitAmount: original.creditAmount,
    creditAmount: original.debitAmount,
    signedAmount:
      original.signedAmount === null ? null : -original.signedAmount,
    description: input.reason,
    reference: original.reference,
    idempotencyKey: null,
    reversalOf: original.id,
    createdBy: input.actorProfileId ?? null,
    transactionGroupId: input.balancedGroupId ?? null,
    metadata: { ...original.metadata, reversal_reason: input.reason },
    createdAt: nowIsoValue,
    updatedAt: nowIsoValue,
  }

  if (input.balancedGroupId === undefined) return [reversal]

  const counter: LedgerEntry = {
    ...reversal,
    id: counterId,
    entryType: input.counterEntryType ?? "adjustment",
    debitAmount: reversal.creditAmount,
    creditAmount: reversal.debitAmount,
    signedAmount:
      reversal.signedAmount === null ? null : -reversal.signedAmount,
    reversalOf: null,
    description: `Gegenbuchung: ${input.reason}`,
  }
  return [reversal, counter]
}

function ledgerInsertPayload(entry: LedgerEntry): Record<string, unknown> {
  return {
    company_id: entry.companyId,
    site_id: entry.siteId,
    unit_id: entry.unitId,
    resident_id: entry.residentId,
    transaction_group_id: entry.transactionGroupId,
    entry_type: entry.entryType,
    status: entry.status,
    period: entry.period,
    due_date: entry.dueDate,
    posted_at: entry.postedAt,
    debit_amount: entry.debitAmount,
    credit_amount: entry.creditAmount,
    currency: entry.currency,
    description: entry.description,
    reference: entry.reference,
    reversal_of: entry.reversalOf,
    created_by: entry.createdBy,
    metadata: entry.metadata,
  }
}

/**
 * The **only** correction path for a posted ledger entry.
 *
 * A posted row cannot be edited or deleted: `prevent_posted_ledger_mutation`
 * raises 23514 on both, for every role including the service key. So there is no
 * `updateLedgerEntry()` anywhere in this repository, and adding one would not
 * work if there were. Correction means a new row carrying `reversal_of`.
 *
 * Only a `posted` entry can be reversed. A draft is edited or voided instead,
 * and asking to reverse one is a `validation_failed`, not a silent no-op.
 */
export async function reverseLedgerEntry(
  input: ReverseLedgerEntryInput
): Promise<RepositoryResult<LedgerReversalResult>> {
  const nowIsoValue = nowIso()

  const guard = (original: LedgerEntry | null): LedgerEntry => {
    if (original === null) {
      throw new RepositoryError({
        code: "not_found",
        message: "That record was not found.",
        retryable: false,
      })
    }
    if (original.status !== "posted") {
      throw new RepositoryError({
        code: "validation_failed",
        message:
          "Only a posted entry can be reversed. Edit or void the draft instead.",
        retryable: false,
      })
    }
    return original
  }

  return withRepository(
    async (client) => {
      const scope = await scopeFor(client, input)
      const response = await client
        .from(T_LEDGER)
        .select(LEDGER_COLUMNS)
        .eq("id", input.entryId)
        .maybeSingle()
      const row = unwrap<unknown>(response, null)
      const original = guard(row === null ? null : mapLedgerEntry(row))
      if (!ledgerVisible(original, scope)) {
        throw new RepositoryError({
          code: "not_found",
          message: "That record was not found.",
          retryable: false,
        })
      }

      const rows = reversalRowsFor(original, input, nowIsoValue)
      // ONE insert for both legs. The per-(group, currency) balance check is a
      // DEFERRED constraint trigger: two separate statements in two transactions
      // would fail at the first commit, because the group would be half-written.
      const inserted = await client
        .from(T_LEDGER)
        .insert(rows.map(ledgerInsertPayload))
        .select(LEDGER_COLUMNS)
      // The READ above deliberately keeps every column — a reversal copies the
      // original's metadata onto the correction row, so it cannot be built from
      // a narrowed row. What LEAVES the function is narrowed like every other
      // read, so this path is not a way around the resident projection.
      return {
        entries: applyLedgerProjection(
          unwrap<unknown[]>(inserted, []).map(mapLedgerEntry),
          scope
        ),
        reversedEntryId: original.id,
      }
    },
    () => {
      const scope = financeScope(input, seedScopeUnits(input))
      const found =
        seedLedgerEntries().find((entry) => entry.id === input.entryId) ?? null
      const original = guard(found)
      if (!ledgerVisible(original, scope)) {
        throw new RepositoryError({
          code: "not_found",
          message: "That record was not found.",
          retryable: false,
        })
      }
      // Seed mode SIMULATES: the rows are returned but nothing is stored, because
      // the seed builders are pure functions and must stay deterministic.
      return {
        entries: applyLedgerProjection(
          reversalRowsFor(original, input, nowIsoValue),
          scope
        ),
        reversedEntryId: original.id,
      }
    },
    "finance.reverseLedgerEntry"
  )
}

export interface SettleVendorInvoiceInput extends FinanceAccess {
  invoiceId: string
  /** The version the caller read. A mismatch is a 409, never a silent overwrite. */
  expectedVersion: number
  /** New cumulative settlement. Bounded to [0, total_amount] by CHECK. */
  paidAmount: number
  status?: VendorInvoiceStatus
}

/**
 * Optimistic concurrency, written out because it is the rule that gets skipped.
 *
 * The UPDATE carries `.eq("version", expectedVersion)`. Two clerks who both read
 * version 4 cannot both win: the second one matches zero rows and gets
 * `conflict` (409). `bump_vendor_invoices_version` increments the column, so the
 * guard is real and not merely advisory. Last-write-wins is a bug
 * (CONVENTIONS §5).
 */
export async function settleVendorInvoice(
  input: SettleVendorInvoiceInput
): Promise<RepositoryResult<VendorInvoice>> {
  const conflict = (): never => {
    throw new RepositoryError({
      code: "conflict",
      message:
        "The record changed while you were editing it. Reload and try again.",
      retryable: true,
    })
  }
  const notFound = (): never => {
    throw new RepositoryError({
      code: "not_found",
      message: "That record was not found.",
      retryable: false,
    })
  }

  return withRepository(
    async (client) => {
      const payload: Record<string, unknown> = { paid_amount: input.paidAmount }
      if (input.status !== undefined) payload["status"] = input.status

      const response = await client
        .from(T_VENDOR_INVOICES)
        .update(payload)
        .eq("id", input.invoiceId)
        .eq("version", input.expectedVersion)
        .select(VENDOR_INVOICE_COLUMNS)
      const rows = unwrap<unknown[]>(response, [])
      const updated = rows[0]
      // Zero rows means either the invoice is gone or somebody else moved the
      // version on. Both are conflicts from the caller's point of view; only a
      // fresh read can tell them apart, and it is the caller who must do it.
      if (updated === undefined) return conflict()
      return mapVendorInvoice(updated)
    },
    () => {
      const invoice = seedVendorInvoices().find(
        (candidate) => candidate.id === input.invoiceId
      )
      if (invoice === undefined) return notFound()
      if (invoice.version !== input.expectedVersion) return conflict()
      const paidAmount = input.paidAmount
      const totalAmount = invoice.totalAmount
      return {
        ...invoice,
        paidAmount,
        outstandingAmount:
          totalAmount === null ? null : totalAmount - paidAmount,
        ...(input.status === undefined ? {} : { status: input.status }),
        version: invoice.version + 1,
      }
    },
    "finance.settleVendorInvoice"
  )
}

// ---------------------------------------------------------------------------
// Registering a vendor invoice
// ---------------------------------------------------------------------------

export interface CreateVendorInvoiceInput extends FinanceAccess {
  companyId: string
  vendorProfileId: string
  siteId?: string
  /** Major units. */
  totalAmount: number
  currency: CurrencyCode
  issuedOn: string
  dueOn: string
  /** The vendor's own invoice number. Stored as `invoice_no`. */
  reference: string
  description?: string
}

/**
 * Register a supplier invoice, unpaid.
 *
 * ## What it fixes
 *
 * `POST /api/site-management/vendor-invoices` was a declared gap. As with every
 * other one in this repository the policy was already correct
 * (`vendor_invoices_insert_finance`, `can_write_company_finance()`) and the
 * table GRANT had been revoked; migration 21 restored it.
 *
 * ## The invoice starts owing its whole value
 *
 * `paid_amount` is left at its column default of 0 and is never accepted as
 * input. An invoice that could be registered as already part-paid would let the
 * money trail begin halfway through, with no payment row anywhere to account for
 * the difference. Settling is `settleVendorInvoice()`, which is optimistically
 * concurrent and writes an auditable change.
 *
 * `status` is likewise not an input: the column default is `draft`.
 *
 * ## vendor_name is denormalised on purpose, and this fills it
 *
 * The column is NOT NULL while the schema only carries `vendorProfileId`, so the
 * name is read from the profile at registration time and stored beside the id.
 * That is deliberate in the schema, not an oversight to route around: an invoice
 * must still say who issued it years later, after the supplier's profile has
 * been renamed or deactivated. The lookup runs on the caller's client, so a
 * vendor id the caller cannot read resolves to nothing and is refused as
 * `not_found` rather than confirming that the id exists.
 */
export async function createVendorInvoice(
  input: CreateVendorInvoiceInput
): Promise<RepositoryResult<VendorInvoice>> {
  if (!(input.totalAmount > 0)) {
    throw new RepositoryError({
      code: "validation_failed",
      message: "An invoice must be greater than zero.",
      retryable: false,
    })
  }
  if (Date.parse(input.dueOn) < Date.parse(input.issuedOn)) {
    throw new RepositoryError({
      code: "validation_failed",
      message: "An invoice cannot fall due before it was issued.",
      retryable: false,
    })
  }

  return withRepository(
    async (client) => {
      const vendorRow = unwrap<unknown>(
        await client
          .from("profiles")
          .select("id, full_name, email")
          .eq("id", input.vendorProfileId)
          .maybeSingle(),
        null
      )
      if (vendorRow === null) {
        throw new RepositoryError({
          code: "not_found",
          message: "That supplier was not found.",
          retryable: false,
        })
      }
      const vendor = asRecord(vendorRow)
      const vendorName =
        asNullableString(vendor["full_name"]) ??
        asNullableString(vendor["email"]) ??
        input.vendorProfileId

      const response = await client
        .from(T_VENDOR_INVOICES)
        .insert({
          company_id: input.companyId,
          vendor_profile_id: input.vendorProfileId,
          vendor_name: vendorName,
          invoice_no: input.reference,
          total_amount: input.totalAmount,
          currency: input.currency,
          issued_on: input.issuedOn,
          due_on: input.dueOn,
          // Left to the column defaults, and not accepted as input. See above.
          //   status       -> 'draft'
          //   paid_amount  -> 0
          //   tax_amount   -> 0
          ...(input.siteId === undefined ? {} : { site_id: input.siteId }),
          ...(input.description === undefined ||
          input.description.trim() === ""
            ? {}
            : { notes: input.description.trim() }),
        })
        .select(VENDOR_INVOICE_COLUMNS)
        .maybeSingle()

      const error: { code?: unknown } | null = response.error ?? null
      if (error !== null && error.code === "23505") {
        throw new RepositoryError({
          code: "conflict",
          message: "That invoice number is already registered.",
          retryable: false,
        })
      }

      const row = unwrap<unknown>(response, null)
      if (row === null) {
        throw new RepositoryError({
          code: "persistence_unavailable",
          message: "The invoice could not be saved.",
          retryable: true,
        })
      }
      return mapVendorInvoice(row)
    },
    () => {
      // Seed mode SIMULATES: returned, stored nowhere, because the seed
      // builders are pure and must stay deterministic across runs.
      const invoice: VendorInvoice = {
        id: `f2ffffff-0000-4000-8000-${input.reference.slice(-12).padStart(12, "0")}`,
        companyId: input.companyId,
        siteId: input.siteId ?? null,
        vendorProfileId: input.vendorProfileId,
        vendorName: input.vendorProfileId,
        invoiceNo: input.reference,
        status: "draft",
        totalAmount: input.totalAmount,
        taxAmount: 0,
        paidAmount: 0,
        outstandingAmount: input.totalAmount,
        currency: input.currency,
        issuedOn: input.issuedOn,
        dueOn: input.dueOn,
        ledgerEntryId: null,
        documentPath: null,
        notes: input.description ?? null,
        version: 1,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }
      return invoice
    },
    "finance.createVendorInvoice"
  )
}

// ---------------------------------------------------------------------------
// Recording a payment
// ---------------------------------------------------------------------------

export interface CreatePaymentInput extends FinanceAccess {
  companyId: string
  /** Major units. The caller parses the operator's own locale before this. */
  amount: number
  currency: CurrencyCode
  direction: PaymentDirection
  /** How the money arrived — `bank_transfer`, `cash`, … Stored as `provider`. */
  method: string
  /** The operator's own reference. Unique per provider where present. */
  reference: string
  /** When the money was actually received, not when this row was written. */
  receivedAt: string
  vendorInvoiceId?: string
  unitId?: string
  residentId?: string
  walletId?: string
  /** Replay guard, unique per company. A repeat is a `duplicate`, not a second payment. */
  idempotencyKey?: string
  createdBy?: string | null
  note?: string
}

/**
 * Record one payment.
 *
 * ## The branch this replaces
 *
 * `dashboard/finance/actions.ts → recordPayment()` did every hard part already —
 * authorisation, parsing the amount in the writer's own locale, the per-currency
 * approval threshold, allocation against an invoice the caller can actually
 * read, and the over-payment check — and then stopped at step 7 with a comment
 * naming exactly what was missing:
 *
 *     Supabase IS configured and `authenticated` still holds no INSERT on
 *     `payment_transactions` (migration 07 revokes it) … Reporting success here
 *     would be the fake write the honesty audit grades HIGH, so it stays a 503
 *     until the RPC lands. When it does, this branch calls it and maps 23505 to
 *     `{ status: "duplicate" }` — the unique index, not this function, is what
 *     makes that true.
 *
 * Migration 21 restored that INSERT. This is the function that comment was
 * waiting for, and it keeps the contract the comment specified: 23505 is
 * reported as a duplicate and is not retried.
 *
 * ## What it does NOT do, deliberately
 *
 * It does not post to the ledger. `payment_transactions.ledger_entry_id` is
 * nullable precisely so a receipt can be recorded before it is journalled, and
 * journalling is a different operation with a different rule —
 * `assert_ledger_group_balanced` requires balanced legs per currency within one
 * `transaction_group_id`, so a payment cannot become a single ledger row. A
 * function that quietly wrote one unbalanced leg would either fail at COMMIT or,
 * worse, teach the next reader that it is allowed.
 *
 * It also does not touch a wallet balance or an invoice's `paid_amount`.
 * Settling an invoice is `settleVendorInvoice()`, which is optimistically
 * concurrent; doing it as a side effect here would bypass that guard.
 *
 * So the honest claim on success is "the payment is recorded", and the caller
 * must not render it as "allocated" or "posted".
 *
 * ## Status
 *
 * `captured`, with `paid_at` set to when the money actually arrived. The row is
 * a record of something that already happened at a bank, not a request to a
 * gateway — `pending` would describe a capture this product never performs, and
 * `payment_transactions_captured_has_time` requires the timestamp, which is why
 * `receivedAt` is not optional.
 */
export async function createPayment(
  input: CreatePaymentInput
): Promise<RepositoryResult<PaymentTransaction>> {
  if (!(input.amount > 0)) {
    throw new RepositoryError({
      code: "validation_failed",
      message: "A payment must be greater than zero.",
      retryable: false,
    })
  }

  const payload: Record<string, unknown> = {
    company_id: input.companyId,
    provider: input.method,
    provider_reference: input.reference,
    direction: input.direction,
    status: "captured",
    amount: input.amount,
    currency: input.currency,
    paid_at: input.receivedAt,
    // Never set from here. See the doc comment.
    ledger_entry_id: null,
    ...(input.vendorInvoiceId === undefined
      ? {}
      : { vendor_invoice_id: input.vendorInvoiceId }),
    ...(input.unitId === undefined ? {} : { unit_id: input.unitId }),
    ...(input.residentId === undefined
      ? {}
      : { resident_id: input.residentId }),
    ...(input.walletId === undefined ? {} : { wallet_id: input.walletId }),
    ...(input.idempotencyKey === undefined
      ? {}
      : { idempotency_key: input.idempotencyKey }),
    ...(input.createdBy === undefined || input.createdBy === null
      ? {}
      : { created_by: input.createdBy }),
    ...(input.note === undefined || input.note.trim() === ""
      ? {}
      : { provider_payload: { note: input.note.trim() } }),
  }

  return withRepository(
    async (client) => {
      const response = await client
        .from(T_PAYMENTS)
        .insert(payload)
        .select(PAYMENT_COLUMNS)
        .maybeSingle()

      // Two unique indexes can raise 23505 here — `ux_payment_transactions_
      // idempotency` on (company_id, idempotency_key) and `ux_payment_
      // transactions_provider_reference` on (provider, provider_reference).
      // Both mean the same thing to an operator: this money has already been
      // entered. Reporting it as a duplicate rather than an error is what stops
      // a double-click from becoming two receipts.
      const error: { code?: unknown; message?: unknown } | null =
        response.error ?? null
      if (error !== null && error.code === "23505") {
        throw new RepositoryError({
          code: "conflict",
          message: "That payment has already been recorded.",
          retryable: false,
        })
      }

      const row = unwrap<unknown>(response, null)
      if (row === null) {
        throw new RepositoryError({
          code: "persistence_unavailable",
          message: "The payment could not be recorded.",
          retryable: true,
        })
      }
      return mapPaymentTransaction(row)
    },
    () => {
      // Seed mode SIMULATES: returned so the console can be exercised, stored
      // nowhere, because the seed builders are pure and must stay deterministic.
      const payment: PaymentTransaction = {
        id: `f1ffffff-0000-4000-8000-${input.reference.slice(-12).padStart(12, "0")}`,
        companyId: input.companyId,
        ledgerEntryId: null,
        vendorInvoiceId: input.vendorInvoiceId ?? null,
        walletId: input.walletId ?? null,
        unitId: input.unitId ?? null,
        residentId: input.residentId ?? null,
        provider: input.method,
        providerReference: input.reference,
        direction: input.direction,
        status: "captured",
        amount: input.amount,
        currency: input.currency,
        paidAt: input.receivedAt,
        failureReason: null,
        idempotencyKey: input.idempotencyKey ?? null,
        providerPayload: input.note === undefined ? {} : { note: input.note },
        createdBy: input.createdBy ?? null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }
      return payment
    },
    "finance.createPayment"
  )
}

// ---------------------------------------------------------------------------
// Re-exports used by callers that need the currency list or a Money value
// ---------------------------------------------------------------------------

export type { Money }
export { currencyCodes }
