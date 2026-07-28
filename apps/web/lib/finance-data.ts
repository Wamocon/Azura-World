/**
 * # Finance seed data — deterministic, schema-shaped
 *
 * Owned by **W2-A**. Consumed by `lib/finance-repository.ts` as the `fallback()`
 * of every `withRepository()` call, and by nothing else.
 *
 * ## Deterministic, without exception
 *
 * No `Math.random()`, no `Date.now()`, no bare `new Date()`. Every instant is
 * `seedIso(dayOffset)` from `SEED_ANCHOR_ISO`, every date is `seedDate()` on top
 * of it. A seeded dashboard that renders differently on two runs makes Playwright
 * snapshots worthless, and the seed is the demo surface, so the drift would ship.
 *
 * ## Structurally identical to the Supabase shape
 *
 * Every builder returns exactly what `lib/finance-repository.ts` produces from a
 * PostgREST row, so flipping `source` from `"local-seed"` to `"supabase"` changes
 * nothing downstream. That is the whole point of the envelope in CONTRACTS §4 —
 * if the two shapes diverge, the fallback stops being a fallback and becomes a
 * second, untested code path.
 *
 * ## Money is nullable on purpose
 *
 * `numeric` arrives from PostgREST as a **string** (`"112000.00"`), and a column
 * the parser could not read is `null`, never `0`. CONVENTIONS §5: "a price of 0
 * is a bug; a price of null is an honest gap." The seed always fills these in;
 * the types stay nullable because the Supabase path cannot promise that.
 */

import type { Money } from "@/lib/contracts"
import { seedIso } from "@/lib/repository-base"

// ---------------------------------------------------------------------------
// Shared identifiers
//
// [V] SEED_COMPANY_ID, SEED_SITE_ID, the unit ids and the four profile ids
//     marked below are copied from `supabase/seed.sql`, so seed mode and a
//     locally-seeded database agree on who owns what.
// [I] The remaining profile ids follow the CONTRACTS §3 role order. They are
//     referenced only by rows in this file, so nothing depends on them matching
//     a database that does not yet contain them.
// ---------------------------------------------------------------------------

export const SEED_COMPANY_ID = "11111111-1111-4111-8111-111111111111"
export const SEED_SITE_ID = "22222222-2222-4222-8222-222222222222"

export const SEED_PROFILE_IDS = {
  admin: "b0000000-0000-4000-8000-000000000001",
  manager: "b0000000-0000-4000-8000-000000000002",
  accountant: "b0000000-0000-4000-8000-000000000003",
  staff: "b0000000-0000-4000-8000-000000000004",
  /** [V] supabase/seed.sql — resident "Owner One", holds AZW-B01-0001. */
  owner: "b0000000-0000-4000-8000-000000000005",
  /** [V] supabase/seed.sql — resident "Tenant One", holds AZW-B01-0003. */
  tenant: "b0000000-0000-4000-8000-000000000006",
  guest: "b0000000-0000-4000-8000-000000000007",
  serviceProvider: "b0000000-0000-4000-8000-000000000008",
  /** [V] supabase/seed.sql — guardian is `owner`. */
  childOwner: "b0000000-0000-4000-8000-000000000009",
  /** [V] supabase/seed.sql — guardian is `tenant`. */
  childTenant: "b0000000-0000-4000-8000-000000000010",
  childGuest: "b0000000-0000-4000-8000-000000000011",
} as const

export const SEED_RESIDENT_IDS = {
  ownerOne: "d0000000-0000-4000-8000-000000000001",
  ownerTwo: "d0000000-0000-4000-8000-000000000002",
  tenantOne: "d0000000-0000-4000-8000-000000000003",
} as const

/** Deterministic `YYYY-MM-DD`, derived from the same anchor as `seedIso`. */
export function seedDate(dayOffset: number): string {
  return seedIso(dayOffset).slice(0, 10)
}

// ---------------------------------------------------------------------------
// Residency
//
// The owner/tenant → unit edge, mirroring `public.unit_residents` and the three
// fixtures in `supabase/seed.sql`. It lives here, in finance, because it is the
// predicate BOTH finance and operations scope on, and a security predicate that
// exists twice is a security predicate that will eventually disagree with
// itself. `lib/operations-data.ts` re-exports it rather than restating it.
// ---------------------------------------------------------------------------

export const unitResidentRelations = ["owner", "tenant", "guest"] as const
export type UnitResidentRelation = (typeof unitResidentRelations)[number]

export interface UnitResidency {
  unitId: string
  residentId: string
  /** The profile behind the resident, or `null` for a resident with no login. */
  profileId: string | null
  relation: UnitResidentRelation
  sharePercent: number | null
  startDate: string
  endDate: string | null
  isPrimary: boolean
}

/**
 * Mirrors `supabase/seed.sql`: two different owners each holding one unit, plus
 * a tenant. Two owners is the minimum that makes "owner A cannot read owner B's
 * unit" a real assertion rather than a vacuous one.
 */
export function seedUnitResidency(): UnitResidency[] {
  return [
    {
      unitId: "AZW-B01-0001",
      residentId: SEED_RESIDENT_IDS.ownerOne,
      profileId: SEED_PROFILE_IDS.owner,
      relation: "owner",
      sharePercent: 100,
      startDate: seedDate(-365),
      endDate: null,
      isPrimary: true,
    },
    {
      unitId: "AZW-B01-0002",
      residentId: SEED_RESIDENT_IDS.ownerTwo,
      // No profile: "Owner Two" exists so that a denial has something to deny.
      profileId: null,
      relation: "owner",
      sharePercent: 100,
      startDate: seedDate(-300),
      endDate: null,
      isPrimary: true,
    },
    {
      unitId: "AZW-B01-0003",
      residentId: SEED_RESIDENT_IDS.tenantOne,
      profileId: SEED_PROFILE_IDS.tenant,
      relation: "tenant",
      sharePercent: null,
      startDate: seedDate(-120),
      endDate: null,
      isPrimary: true,
    },
  ]
}

/**
 * Guardian resolution for the `child_*` roles, mirroring `public.guardianships`
 * and `current_user_scope_profile_id()`. A child resolves to its guardian's
 * profile and therefore to the guardian's units — a strict subset, never a
 * different horizon (CONTRACTS §3, additive-authority rule).
 */
export function seedGuardianships(): Array<{ childProfileId: string; guardianProfileId: string }> {
  return [
    { childProfileId: SEED_PROFILE_IDS.childOwner, guardianProfileId: SEED_PROFILE_IDS.owner },
    { childProfileId: SEED_PROFILE_IDS.childTenant, guardianProfileId: SEED_PROFILE_IDS.tenant },
  ]
}

// ---------------------------------------------------------------------------
// Domain enums — the TS union and the SQL enum are the same list in the same
// order (migration 00000000000007_finance.sql).
// ---------------------------------------------------------------------------

export const currencyCodes = ["EUR", "USD", "TRY", "GBP"] as const
export type CurrencyCode = Money["currency"]

export const ledgerEntryTypes = [
  "dues",
  "service_charge",
  "utility",
  "deposit",
  "refund",
  "penalty",
  "adjustment",
  "payment",
  "vendor_bill",
  "reversal",
] as const
export type LedgerEntryType = (typeof ledgerEntryTypes)[number]

export const ledgerEntryStatuses = ["draft", "posted", "void"] as const
export type LedgerEntryStatus = (typeof ledgerEntryStatuses)[number]

export const paymentStatuses = [
  "pending",
  "authorized",
  "captured",
  "failed",
  "refunded",
  "cancelled",
] as const
export type PaymentStatus = (typeof paymentStatuses)[number]

export const paymentDirections = ["inbound", "outbound"] as const
export type PaymentDirection = (typeof paymentDirections)[number]

export const walletKinds = ["resident", "vendor", "company"] as const
export type WalletKind = (typeof walletKinds)[number]

export const walletStatuses = ["active", "frozen", "closed"] as const
export type WalletStatus = (typeof walletStatuses)[number]

export const vendorInvoiceStatuses = [
  "draft",
  "open",
  "partially_paid",
  "paid",
  "disputed",
  "void",
] as const
export type VendorInvoiceStatus = (typeof vendorInvoiceStatuses)[number]

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

/**
 * One leg of a double-entry transaction.
 *
 * There is deliberately **no settlement status**: `status` is only
 * draft → posted (or void, for a draft abandoned before posting). A posted row
 * is frozen by trigger, so "paid" could never be written onto it. What is still
 * open is derived from `vendor_invoices.paid_amount` and `payment_transactions`
 * — see `getFinanceSummary()`.
 */
export interface LedgerEntry {
  id: string
  companyId: string
  siteId: string | null
  unitId: string | null
  residentId: string | null
  /** Groups the legs of one transaction. `null` for single-sided entries. */
  transactionGroupId: string | null
  entryType: LedgerEntryType
  status: LedgerEntryStatus
  /** `YYYY-MM` or null. */
  period: string | null
  dueDate: string | null
  postedAt: string | null
  /** `numeric(14,2)`. `null` means unreadable, never zero. */
  debitAmount: number | null
  creditAmount: number | null
  currency: CurrencyCode | null
  /** Generated column: `debit_amount - credit_amount`. */
  signedAmount: number | null
  description: string | null
  reference: string | null
  idempotencyKey: string | null
  /** Set on a correction row; points at the posted entry it cancels. */
  reversalOf: string | null
  createdBy: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface Wallet {
  id: string
  companyId: string
  owningProfileId: string | null
  kind: WalletKind
  currency: CurrencyCode | null
  balanceAmount: number | null
  allowsOverdraft: boolean
  overdraftLimitAmount: number | null
  lowBalanceThresholdAmount: number | null
  status: WalletStatus
  /** Optimistic concurrency. A stale write is a 409, never last-write-wins. */
  version: number
  createdAt: string
  updatedAt: string
}

export interface VendorInvoice {
  id: string
  companyId: string
  siteId: string | null
  vendorProfileId: string | null
  vendorName: string
  invoiceNo: string
  status: VendorInvoiceStatus
  totalAmount: number | null
  taxAmount: number | null
  paidAmount: number | null
  /**
   * DERIVED: `totalAmount - paidAmount`, `null` when either side is unreadable.
   * The ledger has no "open" status, so this column is where "still owed" lives.
   */
  outstandingAmount: number | null
  currency: CurrencyCode | null
  issuedOn: string
  dueOn: string | null
  ledgerEntryId: string | null
  documentPath: string | null
  notes: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface PaymentTransaction {
  id: string
  companyId: string
  ledgerEntryId: string | null
  vendorInvoiceId: string | null
  walletId: string | null
  unitId: string | null
  residentId: string | null
  provider: string
  providerReference: string | null
  direction: PaymentDirection
  status: PaymentStatus
  /** Always positive; the sign lives in `direction`. */
  amount: number | null
  currency: CurrencyCode | null
  paidAt: string | null
  failureReason: string | null
  idempotencyKey: string | null
  /** Provider metadata only — never a card number, IBAN or full request body. */
  providerPayload: Record<string, unknown>
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Money helpers
//
// Exported so that no surface hand-rolls `{ amount, currency }` out of a row and
// quietly invents a currency when one is missing.
// ---------------------------------------------------------------------------

function money(amount: number | null, currency: CurrencyCode | null): Money | null {
  if (amount === null || currency === null) return null
  return { amount, currency }
}

/** The debit side as `Money`, or `null` when either half is unreadable. */
export function ledgerDebit(entry: LedgerEntry): Money | null {
  return money(entry.debitAmount, entry.currency)
}

export function ledgerCredit(entry: LedgerEntry): Money | null {
  return money(entry.creditAmount, entry.currency)
}

/** Debit-positive, credit-negative. A balanced group sums to 0 per currency. */
export function ledgerSigned(entry: LedgerEntry): Money | null {
  return money(entry.signedAmount, entry.currency)
}

export function walletBalance(wallet: Wallet): Money | null {
  return money(wallet.balanceAmount, wallet.currency)
}

export function vendorInvoiceOutstanding(invoice: VendorInvoice): Money | null {
  return money(invoice.outstandingAmount, invoice.currency)
}

export function paymentMoney(payment: PaymentTransaction): Money | null {
  return money(payment.amount, payment.currency)
}

// ---------------------------------------------------------------------------
// Builders
//
// Functions, not consts: each call returns a fresh array so a caller that sorts
// or splices in place cannot corrupt the next caller's data.
// ---------------------------------------------------------------------------

const GROUP_DUES_JULY = "a2000000-0000-4000-8000-000000000001"
const GROUP_VENDOR_BILL = "a2000000-0000-4000-8000-000000000002"
const GROUP_UTILITY_TRY = "a2000000-0000-4000-8000-000000000003"

/**
 * Eleven entries covering every state a surface has to render:
 * three balanced transaction groups (two EUR, one TRY), a draft, a void draft,
 * a single-sided reversal, and three currencies so that any aggregate which
 * forgets to group by currency is visibly wrong rather than quietly wrong.
 */
export function seedLedgerEntries(): LedgerEntry[] {
  return [
    // --- Balanced group 1: July dues on AZW-B01-0001, EUR 450.00 -------------
    {
      id: "a1000000-0000-4000-8000-000000000001",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: "AZW-B01-0001",
      residentId: SEED_RESIDENT_IDS.ownerOne,
      transactionGroupId: GROUP_DUES_JULY,
      entryType: "dues",
      status: "posted",
      period: "2026-07",
      dueDate: seedDate(-22),
      postedAt: seedIso(-25, 8),
      debitAmount: 450,
      creditAmount: 0,
      currency: "EUR",
      signedAmount: 450,
      description: "Monatliche Hausgeld-Vorauszahlung 07/2026",
      reference: "DUES-2026-07-B01-0001",
      idempotencyKey: "dues-2026-07-AZW-B01-0001",
      reversalOf: null,
      createdBy: SEED_PROFILE_IDS.accountant,
      metadata: { channel: "recurring_billing" },
      createdAt: seedIso(-25, 8),
      updatedAt: seedIso(-25, 8),
    },
    {
      id: "a1000000-0000-4000-8000-000000000002",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: "AZW-B01-0001",
      residentId: SEED_RESIDENT_IDS.ownerOne,
      transactionGroupId: GROUP_DUES_JULY,
      entryType: "payment",
      status: "posted",
      period: "2026-07",
      dueDate: null,
      postedAt: seedIso(-20, 8),
      debitAmount: 0,
      creditAmount: 450,
      currency: "EUR",
      signedAmount: -450,
      description: "Zahlungseingang Hausgeld 07/2026",
      reference: "DUES-2026-07-B01-0001",
      idempotencyKey: null,
      reversalOf: null,
      createdBy: SEED_PROFILE_IDS.accountant,
      metadata: { channel: "recurring_billing" },
      createdAt: seedIso(-20, 8),
      updatedAt: seedIso(-20, 8),
    },

    // --- Draft, never posted, still fully mutable ----------------------------
    {
      id: "a1000000-0000-4000-8000-000000000003",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: "AZW-B01-0002",
      residentId: SEED_RESIDENT_IDS.ownerTwo,
      transactionGroupId: null,
      entryType: "service_charge",
      status: "draft",
      period: "2026-08",
      dueDate: seedDate(9),
      postedAt: null,
      debitAmount: 120,
      creditAmount: 0,
      currency: "EUR",
      signedAmount: 120,
      description: "Sonderumlage Aufzugswartung — Entwurf",
      reference: null,
      idempotencyKey: null,
      reversalOf: null,
      createdBy: SEED_PROFILE_IDS.accountant,
      metadata: {},
      createdAt: seedIso(-3, 11),
      updatedAt: seedIso(-1, 11),
    },

    // --- Balanced group 2: the vendor bill behind invoice AZW-VI-2026-0001 ---
    {
      id: "a1000000-0000-4000-8000-000000000004",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: null,
      residentId: null,
      transactionGroupId: GROUP_VENDOR_BILL,
      entryType: "vendor_bill",
      status: "posted",
      period: "2026-06",
      dueDate: seedDate(-17),
      postedAt: seedIso(-47, 10),
      debitAmount: 8400,
      creditAmount: 0,
      currency: "EUR",
      signedAmount: 8400,
      description: "Poolanlage — Instandsetzung Umwälzpumpe",
      reference: "AZW-VI-2026-0001",
      idempotencyKey: null,
      reversalOf: null,
      createdBy: SEED_PROFILE_IDS.accountant,
      metadata: { vendor: "Cebeci Teknik Servis" },
      createdAt: seedIso(-47, 10),
      updatedAt: seedIso(-47, 10),
    },
    {
      id: "a1000000-0000-4000-8000-000000000005",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: null,
      residentId: null,
      transactionGroupId: GROUP_VENDOR_BILL,
      entryType: "adjustment",
      status: "posted",
      period: "2026-06",
      dueDate: null,
      postedAt: seedIso(-47, 10),
      debitAmount: 0,
      creditAmount: 8400,
      currency: "EUR",
      signedAmount: -8400,
      description: "Verbindlichkeit Cebeci Teknik Servis",
      reference: "AZW-VI-2026-0001",
      idempotencyKey: null,
      reversalOf: null,
      createdBy: SEED_PROFILE_IDS.accountant,
      metadata: { vendor: "Cebeci Teknik Servis" },
      createdAt: seedIso(-47, 10),
      updatedAt: seedIso(-47, 10),
    },

    // --- Balanced group 3: TRY. A second currency, so per-currency totals are
    //     structurally necessary rather than a stylistic preference.
    {
      id: "a1000000-0000-4000-8000-000000000006",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: null,
      residentId: null,
      transactionGroupId: GROUP_UTILITY_TRY,
      entryType: "utility",
      status: "posted",
      period: "2026-06",
      dueDate: seedDate(-30),
      postedAt: seedIso(-40, 7),
      debitAmount: 12500,
      creditAmount: 0,
      currency: "TRY",
      signedAmount: 12500,
      description: "Elektrik — ortak alanlar 06/2026",
      reference: "UTIL-2026-06",
      idempotencyKey: null,
      reversalOf: null,
      createdBy: SEED_PROFILE_IDS.accountant,
      metadata: { meter: "common_area" },
      createdAt: seedIso(-40, 7),
      updatedAt: seedIso(-40, 7),
    },
    {
      id: "a1000000-0000-4000-8000-000000000007",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: null,
      residentId: null,
      transactionGroupId: GROUP_UTILITY_TRY,
      entryType: "adjustment",
      status: "posted",
      period: "2026-06",
      dueDate: null,
      postedAt: seedIso(-40, 7),
      debitAmount: 0,
      creditAmount: 12500,
      currency: "TRY",
      signedAmount: -12500,
      description: "Gegenbuchung Elektrik 06/2026",
      reference: "UTIL-2026-06",
      idempotencyKey: null,
      reversalOf: null,
      createdBy: SEED_PROFILE_IDS.accountant,
      metadata: { meter: "common_area" },
      createdAt: seedIso(-40, 7),
      updatedAt: seedIso(-40, 7),
    },

    // --- The correction path: a NEW row pointing at the entry it cancels.
    //     Single-sided (no group), which the deferred balance trigger exempts.
    {
      id: "a1000000-0000-4000-8000-000000000008",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: null,
      residentId: null,
      transactionGroupId: null,
      entryType: "reversal",
      status: "posted",
      period: "2026-06",
      dueDate: null,
      postedAt: seedIso(-12, 9),
      debitAmount: 0,
      creditAmount: 12500,
      currency: "TRY",
      signedAmount: -12500,
      description: "Storno: Zählerstand doppelt erfasst",
      reference: "UTIL-2026-06-REV",
      idempotencyKey: null,
      reversalOf: "a1000000-0000-4000-8000-000000000006",
      createdBy: SEED_PROFILE_IDS.accountant,
      metadata: { reason: "duplicate_meter_reading" },
      createdAt: seedIso(-12, 9),
      updatedAt: seedIso(-12, 9),
    },

    // --- A third currency, still a draft ------------------------------------
    {
      id: "a1000000-0000-4000-8000-000000000009",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: "AZW-B01-0003",
      residentId: SEED_RESIDENT_IDS.tenantOne,
      transactionGroupId: null,
      entryType: "deposit",
      status: "draft",
      period: "2026-07",
      dueDate: seedDate(14),
      postedAt: null,
      debitAmount: 300,
      creditAmount: 0,
      currency: "USD",
      signedAmount: 300,
      description: "Kaution — Nachforderung, Entwurf",
      reference: null,
      idempotencyKey: null,
      reversalOf: null,
      createdBy: SEED_PROFILE_IDS.accountant,
      metadata: {},
      createdAt: seedIso(-2, 13),
      updatedAt: seedIso(-2, 13),
    },

    // --- A draft abandoned before posting. `void` is NOT a way to cancel a
    //     posted entry — that is what the reversal above is for.
    {
      id: "a1000000-0000-4000-8000-000000000010",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: "AZW-B01-0002",
      residentId: SEED_RESIDENT_IDS.ownerTwo,
      transactionGroupId: null,
      entryType: "penalty",
      status: "void",
      period: "2026-05",
      dueDate: seedDate(-60),
      postedAt: null,
      debitAmount: 75,
      creditAmount: 0,
      currency: "EUR",
      signedAmount: 75,
      description: "Mahngebühr — verworfen, Zahlung war eingegangen",
      reference: null,
      idempotencyKey: null,
      reversalOf: null,
      createdBy: SEED_PROFILE_IDS.accountant,
      metadata: { voided_reason: "payment_already_received" },
      createdAt: seedIso(-58, 10),
      updatedAt: seedIso(-55, 10),
    },

    // --- An older posted receivable on the tenant's unit ---------------------
    {
      id: "a1000000-0000-4000-8000-000000000011",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: "AZW-B01-0003",
      residentId: SEED_RESIDENT_IDS.tenantOne,
      transactionGroupId: null,
      entryType: "service_charge",
      status: "posted",
      period: "2026-05",
      dueDate: seedDate(-75),
      postedAt: seedIso(-80, 8),
      debitAmount: 260,
      creditAmount: 0,
      currency: "EUR",
      signedAmount: 260,
      description: "Nebenkosten 05/2026",
      reference: "SC-2026-05-B01-0003",
      idempotencyKey: null,
      reversalOf: null,
      createdBy: SEED_PROFILE_IDS.accountant,
      metadata: {},
      createdAt: seedIso(-80, 8),
      updatedAt: seedIso(-80, 8),
    },
  ]
}

/**
 * Five wallets: one plain resident wallet, one **overdraft-enabled** wallet
 * sitting negative within its limit, one vendor wallet, one company-level wallet
 * (no holder, second currency) and one frozen wallet.
 */
export function seedWallets(): Wallet[] {
  return [
    {
      id: "a3000000-0000-4000-8000-000000000001",
      companyId: SEED_COMPANY_ID,
      owningProfileId: SEED_PROFILE_IDS.owner,
      kind: "resident",
      currency: "EUR",
      balanceAmount: 1250,
      allowsOverdraft: false,
      overdraftLimitAmount: 0,
      lowBalanceThresholdAmount: 200,
      status: "active",
      version: 3,
      createdAt: seedIso(-365, 8),
      updatedAt: seedIso(-20, 8),
    },
    {
      // The overdraft case. `balance_amount < 0` is legal here and ONLY here,
      // because `allows_overdraft` is true and the balance stays inside the
      // limit — both enforced by CHECK constraints, not by application code.
      id: "a3000000-0000-4000-8000-000000000002",
      companyId: SEED_COMPANY_ID,
      owningProfileId: SEED_PROFILE_IDS.tenant,
      kind: "resident",
      currency: "EUR",
      balanceAmount: -180,
      allowsOverdraft: true,
      overdraftLimitAmount: 500,
      lowBalanceThresholdAmount: 100,
      status: "active",
      version: 5,
      createdAt: seedIso(-120, 8),
      updatedAt: seedIso(-5, 8),
    },
    {
      id: "a3000000-0000-4000-8000-000000000003",
      companyId: SEED_COMPANY_ID,
      owningProfileId: SEED_PROFILE_IDS.serviceProvider,
      kind: "vendor",
      currency: "EUR",
      balanceAmount: 5000,
      allowsOverdraft: false,
      overdraftLimitAmount: 0,
      lowBalanceThresholdAmount: 0,
      status: "active",
      version: 2,
      createdAt: seedIso(-200, 8),
      updatedAt: seedIso(-15, 8),
    },
    {
      // kind = 'company' ⟹ no holder. The CHECK constraint enforces the pair.
      id: "a3000000-0000-4000-8000-000000000004",
      companyId: SEED_COMPANY_ID,
      owningProfileId: null,
      kind: "company",
      currency: "TRY",
      balanceAmount: 84200,
      allowsOverdraft: false,
      overdraftLimitAmount: 0,
      lowBalanceThresholdAmount: 10000,
      status: "active",
      version: 7,
      createdAt: seedIso(-400, 8),
      updatedAt: seedIso(-12, 8),
    },
    {
      id: "a3000000-0000-4000-8000-000000000005",
      companyId: SEED_COMPANY_ID,
      owningProfileId: SEED_PROFILE_IDS.guest,
      kind: "resident",
      currency: "USD",
      balanceAmount: 0,
      allowsOverdraft: false,
      overdraftLimitAmount: 0,
      lowBalanceThresholdAmount: 0,
      status: "frozen",
      version: 1,
      createdAt: seedIso(-90, 8),
      updatedAt: seedIso(-30, 8),
    },
  ]
}

function withOutstanding(
  invoice: Omit<VendorInvoice, "outstandingAmount">
): VendorInvoice {
  const { totalAmount, paidAmount } = invoice
  return {
    ...invoice,
    outstandingAmount:
      totalAmount === null || paidAmount === null ? null : totalAmount - paidAmount,
  }
}

/**
 * Six invoices spanning every status, two currencies and four ageing buckets.
 * `AZW-VI-2026-0001` is the **partially paid** one the brief requires; its
 * remainder is what makes "open" a derived quantity rather than a stored flag.
 */
export function seedVendorInvoices(): VendorInvoice[] {
  return [
    withOutstanding({
      id: "a4000000-0000-4000-8000-000000000001",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      vendorProfileId: SEED_PROFILE_IDS.serviceProvider,
      vendorName: "Cebeci Teknik Servis",
      invoiceNo: "AZW-VI-2026-0001",
      status: "partially_paid",
      totalAmount: 8400,
      taxAmount: 1400,
      paidAmount: 3400,
      currency: "EUR",
      issuedOn: seedDate(-47),
      dueOn: seedDate(-17),
      ledgerEntryId: "a1000000-0000-4000-8000-000000000004",
      documentPath: "vendor-invoices/2026/AZW-VI-2026-0001.pdf",
      notes: "Teilzahlung nach Abnahme der Umwälzpumpe.",
      version: 4,
      createdAt: seedIso(-47, 10),
      updatedAt: seedIso(-16, 10),
    }),
    withOutstanding({
      id: "a4000000-0000-4000-8000-000000000002",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      vendorProfileId: SEED_PROFILE_IDS.serviceProvider,
      vendorName: "Alanya Peyzaj Ltd.",
      invoiceNo: "AZW-VI-2026-0002",
      status: "open",
      totalAmount: 2400,
      taxAmount: 400,
      paidAmount: 0,
      currency: "EUR",
      issuedOn: seedDate(-7),
      dueOn: seedDate(23),
      ledgerEntryId: null,
      documentPath: "vendor-invoices/2026/AZW-VI-2026-0002.pdf",
      notes: null,
      version: 1,
      createdAt: seedIso(-7, 9),
      updatedAt: seedIso(-7, 9),
    }),
    withOutstanding({
      id: "a4000000-0000-4000-8000-000000000003",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      vendorProfileId: null,
      vendorName: "Türkler Güvenlik A.Ş.",
      invoiceNo: "AZW-VI-2026-0003",
      status: "paid",
      totalAmount: 1200,
      taxAmount: 200,
      paidAmount: 1200,
      currency: "EUR",
      issuedOn: seedDate(-116),
      dueOn: seedDate(-86),
      ledgerEntryId: null,
      documentPath: null,
      notes: null,
      version: 3,
      createdAt: seedIso(-116, 9),
      updatedAt: seedIso(-88, 9),
    }),
    withOutstanding({
      id: "a4000000-0000-4000-8000-000000000004",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      vendorProfileId: null,
      vendorName: "Anadolu Asansör",
      invoiceNo: "AZW-VI-2026-0004",
      status: "open",
      totalAmount: 45000,
      taxAmount: 7500,
      paidAmount: 0,
      currency: "TRY",
      issuedOn: seedDate(-148),
      dueOn: seedDate(-118),
      ledgerEntryId: null,
      documentPath: null,
      notes: "Wartungsvertrag Q1 — Zahlung strittig beim Betreiber.",
      version: 2,
      createdAt: seedIso(-148, 9),
      updatedAt: seedIso(-100, 9),
    }),
    withOutstanding({
      id: "a4000000-0000-4000-8000-000000000005",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      vendorProfileId: null,
      vendorName: "Mavi Havuz Kimya",
      invoiceNo: "AZW-VI-2026-0005",
      status: "disputed",
      totalAmount: 3200,
      taxAmount: 533.33,
      paidAmount: 0,
      currency: "EUR",
      issuedOn: seedDate(-72),
      dueOn: seedDate(-42),
      ledgerEntryId: null,
      documentPath: null,
      notes: "Menge weicht vom Lieferschein ab — in Klärung.",
      version: 2,
      createdAt: seedIso(-72, 9),
      updatedAt: seedIso(-38, 9),
    }),
    withOutstanding({
      id: "a4000000-0000-4000-8000-000000000006",
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      vendorProfileId: null,
      vendorName: "Azura Temizlik",
      invoiceNo: "AZW-VI-2026-0006",
      status: "draft",
      totalAmount: 980,
      taxAmount: 163.33,
      paidAmount: 0,
      currency: "EUR",
      issuedOn: seedDate(-1),
      dueOn: null,
      ledgerEntryId: null,
      documentPath: null,
      notes: null,
      version: 1,
      createdAt: seedIso(-1, 9),
      updatedAt: seedIso(-1, 9),
    }),
  ]
}

/** Six provider-side movements: captured, pending, failed and refunded, in and out. */
export function seedPaymentTransactions(): PaymentTransaction[] {
  return [
    {
      id: "a5000000-0000-4000-8000-000000000001",
      companyId: SEED_COMPANY_ID,
      ledgerEntryId: "a1000000-0000-4000-8000-000000000002",
      vendorInvoiceId: null,
      walletId: "a3000000-0000-4000-8000-000000000001",
      unitId: "AZW-B01-0001",
      residentId: SEED_RESIDENT_IDS.ownerOne,
      provider: "iyzico",
      providerReference: "iyz-2026-07-000451",
      direction: "inbound",
      status: "captured",
      amount: 450,
      currency: "EUR",
      paidAt: seedIso(-20, 8),
      failureReason: null,
      idempotencyKey: "pay-dues-2026-07-AZW-B01-0001",
      providerPayload: { method: "card", last4_masked: true },
      createdBy: SEED_PROFILE_IDS.accountant,
      createdAt: seedIso(-20, 8),
      updatedAt: seedIso(-20, 8),
    },
    {
      id: "a5000000-0000-4000-8000-000000000002",
      companyId: SEED_COMPANY_ID,
      ledgerEntryId: null,
      vendorInvoiceId: "a4000000-0000-4000-8000-000000000001",
      walletId: null,
      unitId: null,
      residentId: null,
      provider: "bank_transfer",
      providerReference: "TR-SEPA-2026-06-0338",
      direction: "outbound",
      status: "captured",
      amount: 3400,
      currency: "EUR",
      paidAt: seedIso(-16, 10),
      failureReason: null,
      idempotencyKey: null,
      providerPayload: { instrument: "sepa_credit_transfer" },
      createdBy: SEED_PROFILE_IDS.accountant,
      createdAt: seedIso(-16, 10),
      updatedAt: seedIso(-16, 10),
    },
    {
      id: "a5000000-0000-4000-8000-000000000003",
      companyId: SEED_COMPANY_ID,
      ledgerEntryId: null,
      vendorInvoiceId: null,
      walletId: "a3000000-0000-4000-8000-000000000002",
      unitId: "AZW-B01-0003",
      residentId: SEED_RESIDENT_IDS.tenantOne,
      provider: "iyzico",
      providerReference: null,
      direction: "inbound",
      status: "pending",
      amount: 120,
      currency: "EUR",
      paidAt: null,
      failureReason: null,
      idempotencyKey: null,
      providerPayload: {},
      createdBy: null,
      createdAt: seedIso(-1, 15),
      updatedAt: seedIso(-1, 15),
    },
    {
      id: "a5000000-0000-4000-8000-000000000004",
      companyId: SEED_COMPANY_ID,
      ledgerEntryId: "a1000000-0000-4000-8000-000000000011",
      vendorInvoiceId: null,
      walletId: "a3000000-0000-4000-8000-000000000002",
      unitId: "AZW-B01-0003",
      residentId: SEED_RESIDENT_IDS.tenantOne,
      provider: "iyzico",
      providerReference: "iyz-2026-06-000118",
      direction: "inbound",
      status: "failed",
      amount: 260,
      currency: "EUR",
      paidAt: null,
      // NOT NULL whenever status is 'failed' — a CHECK constraint, so a failure
      // that cannot say why is refused at the storage layer.
      failureReason: "issuer_declined",
      idempotencyKey: null,
      providerPayload: { attempt: 1 },
      createdBy: null,
      createdAt: seedIso(-74, 12),
      updatedAt: seedIso(-74, 12),
    },
    {
      id: "a5000000-0000-4000-8000-000000000005",
      companyId: SEED_COMPANY_ID,
      ledgerEntryId: null,
      vendorInvoiceId: null,
      walletId: "a3000000-0000-4000-8000-000000000001",
      unitId: "AZW-B01-0001",
      residentId: SEED_RESIDENT_IDS.ownerOne,
      provider: "iyzico",
      providerReference: "iyz-2026-05-000902",
      direction: "inbound",
      status: "refunded",
      amount: 75,
      currency: "EUR",
      paidAt: seedIso(-58, 10),
      failureReason: null,
      idempotencyKey: null,
      providerPayload: { refunded_at_label: "2026-05-30" },
      createdBy: SEED_PROFILE_IDS.accountant,
      createdAt: seedIso(-60, 10),
      updatedAt: seedIso(-55, 10),
    },
    {
      id: "a5000000-0000-4000-8000-000000000006",
      companyId: SEED_COMPANY_ID,
      ledgerEntryId: "a1000000-0000-4000-8000-000000000006",
      vendorInvoiceId: null,
      walletId: "a3000000-0000-4000-8000-000000000004",
      unitId: null,
      residentId: null,
      provider: "bank_transfer",
      providerReference: "TR-EFT-2026-06-1174",
      direction: "outbound",
      status: "captured",
      amount: 12500,
      currency: "TRY",
      paidAt: seedIso(-38, 11),
      failureReason: null,
      idempotencyKey: null,
      providerPayload: { instrument: "eft" },
      createdBy: SEED_PROFILE_IDS.accountant,
      createdAt: seedIso(-38, 11),
      updatedAt: seedIso(-38, 11),
    },
  ]
}
