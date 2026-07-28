/**
 * Seed leads and buyer-pipeline entries — the `local-seed` half of
 * `lib/lead-repository.ts`.
 *
 * Structurally identical to `public.leads` / `public.buyer_pipeline_entries`
 * (migration `00000000000014_leads_buyer_pipeline.sql`) after mapping, and
 * deterministic: `seedIso(dayOffset)` for every timestamp, builder functions
 * returning fresh arrays, no wall clock anywhere.
 *
 * ## Money is `Money`, never a bare number
 *
 * `budget_amount` and `deal_amount` are `numeric(14,2)` and arrive from
 * PostgREST as **strings**; both tables also carry a CHECK that an amount and a
 * currency appear together or not at all. Both are therefore modelled as
 * `Money | null` (CONTRACTS §2) — `null` is an honest "no budget stated", and
 * `0` would be a lie the pipeline totals would then quietly add up.
 *
 * The seed deliberately mixes EUR, USD, GBP and TRY so `getPipelineSummary()`
 * cannot pass while summing across currencies.
 *
 * ## Constraints the seed has to respect
 *
 * - `leads_contactable` — every lead has an email or a phone number.
 * - `leads_lost_needs_reason` — the `lost` lead carries a `lostReason`.
 * - `leads_budget_needs_currency` / `buyer_pipeline_deal_needs_currency` —
 *   amount and currency are both present or both absent.
 * - `buyer_pipeline_entries.lead_id` is UNIQUE — at most one entry per lead.
 */

import type { Money, UnitLayout } from "@/lib/contracts"
import {
  SEED_COMPANY_ID,
  SEED_PROFILE_ID_MANAGER,
  SEED_PROFILE_ID_STAFF,
  SEED_SITE_ID,
  SEED_UNIT_ID_OWNER,
  SEED_UNIT_ID_TENANT,
} from "@/lib/document-data"
import { seedIso } from "@/lib/repository-base"

export { SEED_COMPANY_ID, SEED_PROFILE_ID_MANAGER, SEED_PROFILE_ID_STAFF }

// ---------------------------------------------------------------------------
// Enums — the Postgres types, in declaration order
// ---------------------------------------------------------------------------

/** `public.lead_status`. */
export const leadStatuses = [
  "new",
  "contacted",
  "qualified",
  "viewing_booked",
  "offer_made",
  "negotiating",
  "won",
  "lost",
  "dormant",
] as const

export type LeadStatus = (typeof leadStatuses)[number]

/** `public.lead_source`. */
export const leadSources = [
  "website",
  "portal",
  "referral",
  "walk_in",
  "phone",
  "email",
  "social",
  "exhibition",
  "partner_agent",
  "unknown",
] as const

export type LeadSource = (typeof leadSources)[number]

/**
 * `public.pipeline_stage`, in funnel order. `getPipelineSummary()` reports every
 * stage in this order, zero-filled — a stage nobody is in is a fact about the
 * funnel, not a row to omit.
 */
export const pipelineStages = [
  "enquiry",
  "qualification",
  "viewing",
  "reservation",
  "contract",
  "payment",
  "title_deed",
  "handover",
  "closed",
] as const

export type PipelineStage = (typeof pipelineStages)[number]

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** One row of `public.leads`. Personal data — staff (40)+ only, by RLS. */
export interface LeadRecord {
  id: string
  companyId: string
  siteId: string | null
  /** `units.id` — TEXT business code, e.g. "AZW-B03-0412". */
  unitId: string | null
  reference: string
  fullName: string
  email: string | null
  phone: string | null
  locale: string
  nationality: string | null
  status: LeadStatus
  source: LeadSource
  sourceDetail: string | null
  /** `null` when no budget was stated. Never `{ amount: 0 }`. */
  budget: Money | null
  desiredLayout: UnitLayout | null
  assignedTo: string | null
  score: number | null
  notes: string | null
  lastContactedAt: string | null
  nextActionAt: string | null
  /** Required by CHECK when `status === "lost"`. */
  lostReason: string | null
  /** Defaults to false in the schema: an opt-in that defaults to true is not one. */
  consentMarketing: boolean
  metadata: Record<string, unknown>
  version: number
  createdAt: string
  updatedAt: string
}

/** The lead fields joined onto a pipeline entry, so a board is not an N+1. */
export interface PipelineLeadSummary {
  id: string
  reference: string
  fullName: string
  status: LeadStatus
  locale: string
}

/** One row of `public.buyer_pipeline_entries`, with its lead joined. */
export interface PipelineEntryRecord {
  id: string
  companyId: string
  leadId: string
  unitId: string | null
  stage: PipelineStage
  previousStage: PipelineStage | null
  enteredStageAt: string
  /** A `date` column — "YYYY-MM-DD", not a timestamp. */
  expectedClose: string | null
  /** `null` when no deal value is agreed yet. Never 0. */
  deal: Money | null
  /** 0–100, or `null` when nobody has estimated it. 0 and null differ. */
  probability: number | null
  ownerProfileId: string | null
  blocker: string | null
  metadata: Record<string, unknown>
  version: number
  createdAt: string
  updatedAt: string
  /** `null` when the join returned nothing — never a fabricated placeholder. */
  lead: PipelineLeadSummary | null
}

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

export const SEED_LEAD_IDS = {
  muller: "0a1b2c3d-0007-4000-8000-000000000001",
  ivanov: "0a1b2c3d-0007-4000-8000-000000000002",
  yilmaz: "0a1b2c3d-0007-4000-8000-000000000003",
  schneider: "0a1b2c3d-0007-4000-8000-000000000004",
  novak: "0a1b2c3d-0007-4000-8000-000000000005",
  haddad: "0a1b2c3d-0007-4000-8000-000000000006",
  petrova: "0a1b2c3d-0007-4000-8000-000000000007",
} as const

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

/**
 * Seven leads, newest first, spanning six of the nine statuses — including the
 * `lost` one, which carries the `lostReason` its CHECK constraint demands, and
 * one with **no budget at all** so a caller cannot assume `budget` is present.
 */
export function seedLeads(): LeadRecord[] {
  return [
    {
      id: SEED_LEAD_IDS.haddad,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: null,
      reference: "AZW-L-2026-0007",
      fullName: "Karim Haddad",
      email: null,
      phone: "+971 50 555 0132",
      locale: "en",
      nationality: "AE",
      status: "new",
      source: "exhibition",
      sourceDetail: "Cityscape Dubai 2026",
      // No budget stated. The pipeline totals must not invent one.
      budget: null,
      desiredLayout: null,
      assignedTo: null,
      score: null,
      notes: "Visitenkarte am Stand abgegeben, kein Budget genannt.",
      lastContactedAt: null,
      nextActionAt: seedIso(2, 10),
      lostReason: null,
      consentMarketing: false,
      metadata: { standNumber: "H4-118" },
      version: 1,
      createdAt: seedIso(-1, 12),
      updatedAt: seedIso(-1, 12),
    },
    {
      id: SEED_LEAD_IDS.ivanov,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: SEED_UNIT_ID_TENANT,
      reference: "AZW-L-2026-0002",
      fullName: "Dmitri Ivanov",
      email: "d.ivanov@example.ru",
      phone: "+7 921 555 0114",
      locale: "ru",
      nationality: "RU",
      status: "negotiating",
      source: "portal",
      sourceDetail: "housearch.com",
      // Quoted in USD by the portal that produced the lead. Stored as USD, and
      // never silently converted to EUR (CONVENTIONS §5).
      budget: { amount: 310000, currency: "USD" },
      desiredLayout: "3+1",
      assignedTo: SEED_PROFILE_ID_MANAGER,
      score: 82,
      notes: "Preisverhandlung läuft; Zahlungsplan über 24 Monate gewünscht.",
      lastContactedAt: seedIso(-2, 14),
      nextActionAt: seedIso(1, 9),
      lostReason: null,
      consentMarketing: true,
      metadata: { portalListingId: "HS-88213" },
      version: 6,
      createdAt: seedIso(-34, 10),
      updatedAt: seedIso(-2, 14),
    },
    {
      id: SEED_LEAD_IDS.schneider,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: null,
      reference: "AZW-L-2026-0004",
      fullName: "Anja Schneider",
      email: "anja.schneider@example.de",
      phone: "+49 171 5550198",
      locale: "de",
      nationality: "DE",
      status: "viewing_booked",
      source: "social",
      sourceDetail: "Instagram Kampagne Juli",
      budget: { amount: 180000, currency: "EUR" },
      desiredLayout: "2+1",
      assignedTo: SEED_PROFILE_ID_STAFF,
      score: 61,
      notes: "Besichtigung am 14.08. um 10:00, Flughafentransfer zugesagt.",
      lastContactedAt: seedIso(-2, 9),
      nextActionAt: seedIso(18, 8),
      lostReason: null,
      consentMarketing: true,
      metadata: { campaign: "ig-2026-07" },
      version: 3,
      createdAt: seedIso(-21, 11),
      updatedAt: seedIso(-2, 9),
    },
    {
      id: SEED_LEAD_IDS.yilmaz,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: null,
      reference: "AZW-L-2026-0003",
      fullName: "Elif Yılmaz",
      email: "elif.yilmaz@example.com.tr",
      phone: "+90 532 555 0177",
      locale: "tr",
      nationality: "TR",
      status: "qualified",
      source: "referral",
      sourceDetail: "Empfehlung Eigentümer B03-0412",
      budget: { amount: 9500000, currency: "TRY" },
      desiredLayout: "1+1",
      assignedTo: SEED_PROFILE_ID_STAFF,
      score: 54,
      notes: "Finanzierung über Ziraat Bankası in Prüfung.",
      lastContactedAt: seedIso(-8, 15),
      nextActionAt: seedIso(4, 11),
      lostReason: null,
      consentMarketing: false,
      metadata: { referredBy: SEED_UNIT_ID_OWNER },
      version: 4,
      createdAt: seedIso(-48, 9),
      updatedAt: seedIso(-8, 15),
    },
    {
      id: SEED_LEAD_IDS.petrova,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: null,
      reference: "AZW-L-2026-0006",
      fullName: "Olga Petrova",
      email: "o.petrova@example.co.uk",
      phone: null,
      locale: "en",
      nationality: "GB",
      status: "dormant",
      source: "website",
      sourceDetail: "azuraworld.com/kontakt",
      budget: { amount: 220000, currency: "GBP" },
      desiredLayout: "2+1",
      assignedTo: SEED_PROFILE_ID_STAFF,
      score: 22,
      notes: "Seit sechs Wochen keine Reaktion auf Follow-ups.",
      lastContactedAt: seedIso(-44, 10),
      nextActionAt: null,
      lostReason: null,
      consentMarketing: true,
      metadata: {},
      version: 2,
      createdAt: seedIso(-92, 13),
      updatedAt: seedIso(-44, 10),
    },
    {
      id: SEED_LEAD_IDS.novak,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: null,
      reference: "AZW-L-2026-0005",
      fullName: "Petr Novák",
      email: "petr.novak@example.cz",
      phone: "+420 601 555 0143",
      locale: "en",
      nationality: "CZ",
      status: "lost",
      source: "partner_agent",
      sourceDetail: "Kalinka Real Estate",
      budget: { amount: 145000, currency: "EUR" },
      desiredLayout: "1+1",
      assignedTo: SEED_PROFILE_ID_STAFF,
      score: 18,
      notes: null,
      lastContactedAt: seedIso(-60, 11),
      nextActionAt: null,
      // leads_lost_needs_reason: a lost lead without a reason teaches nothing.
      lostReason: "Hat in einem Nachbarprojekt mit früherem Fertigstellungstermin gekauft.",
      consentMarketing: false,
      metadata: { competitor: "Nachbarprojekt Türkler" },
      version: 5,
      createdAt: seedIso(-110, 9),
      updatedAt: seedIso(-60, 11),
    },
    {
      id: SEED_LEAD_IDS.muller,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: SEED_UNIT_ID_OWNER,
      reference: "AZW-L-2026-0001",
      fullName: "Thomas Müller",
      email: "t.mueller@example.de",
      phone: "+49 160 5550121",
      locale: "de",
      nationality: "DE",
      status: "won",
      source: "website",
      sourceDetail: "azuraworld.com/de",
      budget: { amount: 265000, currency: "EUR" },
      desiredLayout: "3+1",
      assignedTo: SEED_PROFILE_ID_MANAGER,
      score: 95,
      notes: "Kaufvertrag unterzeichnet, Tapu-Übertragung abgeschlossen.",
      lastContactedAt: seedIso(-179, 14),
      nextActionAt: null,
      lostReason: null,
      consentMarketing: true,
      metadata: { unitId: SEED_UNIT_ID_OWNER },
      version: 9,
      createdAt: seedIso(-240, 10),
      updatedAt: seedIso(-179, 14),
    },
  ]
}

// ---------------------------------------------------------------------------
// Buyer pipeline
// ---------------------------------------------------------------------------

/**
 * The lead summary a pipeline entry carries. Built from `seedLeads()` so the
 * two seeds cannot disagree about a lead's name or status — the same guarantee
 * the PostgREST embed gives in Supabase mode.
 */
function leadSummary(
  leads: readonly LeadRecord[],
  leadId: string
): PipelineLeadSummary | null {
  for (const lead of leads) {
    if (lead.id !== leadId) continue
    return {
      id: lead.id,
      reference: lead.reference,
      fullName: lead.fullName,
      status: lead.status,
      locale: lead.locale,
    }
  }
  return null
}

/**
 * Six entries across six of the nine stages, ordered newest-movement-first.
 *
 * Three properties the summary depends on are baked in deliberately:
 * three different currencies, two entries with **no** deal amount, and three
 * stages with no entry at all. A summary that sums across currencies, treats a
 * missing amount as zero, or silently drops empty stages will disagree with
 * this seed.
 *
 * `AZW-L-2026-0007` (Haddad) has no entry: a brand-new lead is not yet in the
 * funnel, and `leads.length === entries.length` is not an invariant.
 */
export function seedPipelineEntries(): PipelineEntryRecord[] {
  const leads = seedLeads()

  return [
    {
      id: "0a1b2c3d-0008-4000-8000-000000000002",
      companyId: SEED_COMPANY_ID,
      leadId: SEED_LEAD_IDS.ivanov,
      unitId: SEED_UNIT_ID_TENANT,
      stage: "contract",
      previousStage: "reservation",
      enteredStageAt: seedIso(-2, 14),
      expectedClose: "2026-09-15",
      deal: { amount: 305000, currency: "USD" },
      probability: 65,
      ownerProfileId: SEED_PROFILE_ID_MANAGER,
      blocker: "Vertragsübersetzung RU steht aus.",
      metadata: { paymentPlanMonths: 24 },
      version: 7,
      createdAt: seedIso(-34, 10),
      updatedAt: seedIso(-2, 14),
      lead: leadSummary(leads, SEED_LEAD_IDS.ivanov),
    },
    {
      id: "0a1b2c3d-0008-4000-8000-000000000004",
      companyId: SEED_COMPANY_ID,
      leadId: SEED_LEAD_IDS.schneider,
      unitId: null,
      stage: "viewing",
      previousStage: "qualification",
      enteredStageAt: seedIso(-2, 9),
      expectedClose: "2026-10-30",
      deal: { amount: 176000, currency: "EUR" },
      probability: 45,
      ownerProfileId: SEED_PROFILE_ID_STAFF,
      blocker: null,
      metadata: { viewingSlot: "2026-08-14T10:00:00+03:00" },
      version: 3,
      createdAt: seedIso(-21, 11),
      updatedAt: seedIso(-2, 9),
      lead: leadSummary(leads, SEED_LEAD_IDS.schneider),
    },
    {
      id: "0a1b2c3d-0008-4000-8000-000000000003",
      companyId: SEED_COMPANY_ID,
      leadId: SEED_LEAD_IDS.yilmaz,
      unitId: null,
      stage: "qualification",
      previousStage: "enquiry",
      enteredStageAt: seedIso(-8, 15),
      expectedClose: null,
      // Financing unresolved, so no deal value exists yet. Not zero.
      deal: null,
      probability: 30,
      ownerProfileId: SEED_PROFILE_ID_STAFF,
      blocker: "Kreditzusage Ziraat Bankası ausstehend.",
      metadata: {},
      version: 2,
      createdAt: seedIso(-48, 9),
      updatedAt: seedIso(-8, 15),
      lead: leadSummary(leads, SEED_LEAD_IDS.yilmaz),
    },
    {
      id: "0a1b2c3d-0008-4000-8000-000000000006",
      companyId: SEED_COMPANY_ID,
      leadId: SEED_LEAD_IDS.petrova,
      unitId: null,
      stage: "enquiry",
      previousStage: null,
      enteredStageAt: seedIso(-92, 13),
      expectedClose: null,
      deal: { amount: 215000, currency: "GBP" },
      probability: 10,
      ownerProfileId: SEED_PROFILE_ID_STAFF,
      blocker: "Keine Reaktion auf Follow-ups.",
      metadata: {},
      version: 1,
      createdAt: seedIso(-92, 13),
      updatedAt: seedIso(-44, 10),
      lead: leadSummary(leads, SEED_LEAD_IDS.petrova),
    },
    {
      id: "0a1b2c3d-0008-4000-8000-000000000005",
      companyId: SEED_COMPANY_ID,
      leadId: SEED_LEAD_IDS.novak,
      unitId: null,
      stage: "closed",
      previousStage: "viewing",
      enteredStageAt: seedIso(-60, 11),
      expectedClose: null,
      deal: null,
      // 0 here is a real estimate — this deal is lost — and is not the same
      // thing as the `null` on the qualification entry above.
      probability: 0,
      ownerProfileId: SEED_PROFILE_ID_STAFF,
      blocker: null,
      metadata: { outcome: "lost" },
      version: 4,
      createdAt: seedIso(-110, 9),
      updatedAt: seedIso(-60, 11),
      lead: leadSummary(leads, SEED_LEAD_IDS.novak),
    },
    {
      id: "0a1b2c3d-0008-4000-8000-000000000001",
      companyId: SEED_COMPANY_ID,
      leadId: SEED_LEAD_IDS.muller,
      unitId: SEED_UNIT_ID_OWNER,
      stage: "handover",
      previousStage: "title_deed",
      enteredStageAt: seedIso(-179, 14),
      expectedClose: "2026-02-28",
      deal: { amount: 258000, currency: "EUR" },
      probability: 100,
      ownerProfileId: SEED_PROFILE_ID_MANAGER,
      blocker: null,
      metadata: { tapuTransferred: true },
      version: 11,
      createdAt: seedIso(-240, 10),
      updatedAt: seedIso(-179, 14),
      lead: leadSummary(leads, SEED_LEAD_IDS.muller),
    },
  ]
}
