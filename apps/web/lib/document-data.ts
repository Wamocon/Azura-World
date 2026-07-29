/**
 * Seed documents — the `local-seed` half of `lib/document-repository.ts`.
 *
 * Every record here is structurally identical to a row of `public.documents`
 * (migration `00000000000008_documents_compliance.sql`) after mapping, so
 * swapping `source` from `"local-seed"` to `"supabase"` changes nothing
 * downstream.
 *
 * ## Deterministic, by rule
 *
 * No `Math.random()`, no `Date.now()`, no bare `new Date()`. Every timestamp is
 * `seedIso(dayOffset)` off the fixed `SEED_ANCHOR_ISO`, so two calls produce
 * byte-identical JSON and a Playwright snapshot of a seeded surface stays
 * meaningful (W2-A brief, deliverable 2).
 *
 * The exports are **builder functions**, not module-level arrays: a caller that
 * sorts or splices the result must not be able to poison the next caller's data.
 *
 * ## The bytes are not here
 *
 * A `DocumentRecord` is metadata. The file itself lives in one of two **private**
 * buckets and is reachable only through a short-TTL signed URL
 * (CONVENTIONS §4) — see `getSignedDocumentUrl()`. There is deliberately no
 * `url` or `publicUrl` field on this type, in seed mode or any other, because a
 * field that exists is a field something will eventually render.
 *
 * ## Shared demo identifiers
 *
 * `SEED_COMPANY_ID` and friends are declared here and imported by
 * `communications-data.ts` and `lead-data.ts` so the three seeds describe one
 * coherent company rather than three unrelated ones. When W2-A's `seed-data.ts`
 * lands they belong there instead — requested in the handoff.
 */

import { seedIso } from "@/lib/repository-base"
import {
  at,
  DEMO_MARK,
  DEMO_PROFILE_IDS,
  demoId,
  inPeriod,
  monthStarts,
  occupancy,
  stream,
} from "@/lib/demo-operations"

// ---------------------------------------------------------------------------
// Column domains — the CHECK constraints of public.documents, in TypeScript
// ---------------------------------------------------------------------------

/** `documents.category` CHECK, in schema order. */
export const documentCategories = [
  "title_deed",
  "contract",
  "invoice",
  "identity",
  "permit",
  "insurance",
  "handover",
  "inspection",
  "correspondence",
  "marketing",
  "evidence",
  "general",
] as const

export type DocumentCategory = (typeof documentCategories)[number]

/**
 * `documents.visibility` CHECK. `"unit"` is the only value a resident can read
 * through, and only together with `review_status = 'approved'`.
 */
export const documentVisibilities = ["private", "company", "unit"] as const

export type DocumentVisibility = (typeof documentVisibilities)[number]

/** `documents.review_status` CHECK. */
export const documentReviewStatuses = [
  "pending_review",
  "approved",
  "rejected",
] as const

export type DocumentReviewStatus = (typeof documentReviewStatuses)[number]

/** `documents.retention_class` CHECK. */
export const documentRetentionClasses = [
  "identity",
  "legal",
  "finance",
  "service",
  "guest",
  "general",
] as const

export type DocumentRetentionClass = (typeof documentRetentionClasses)[number]

/**
 * `documents_bucket_is_private` CHECK. **Both buckets are private.** The
 * constraint exists so no migration and no application path can relocate a
 * document into a world-readable bucket; this union is its TypeScript mirror.
 */
export const documentBuckets = ["azura-documents", "azura-evidence"] as const

export type DocumentBucket = (typeof documentBuckets)[number]

/** Compliance-bearing categories — the filter behind `getComplianceDocuments()`. */
export const complianceDocumentCategories = [
  "title_deed",
  "contract",
  "identity",
  "permit",
  "insurance",
  "inspection",
] as const satisfies readonly DocumentCategory[]

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/**
 * One row of `public.documents`, camel-cased.
 *
 * `unitId` is a **string**, not a uuid: `units.id` is the business code
 * `"AZW-B03-0412"` (CONTRACTS §2), and `documents.unit_id` is `text` to match.
 */
export interface DocumentRecord {
  id: string
  companyId: string
  siteId: string | null
  /** `units.id` — the business code, e.g. "AZW-B03-0412". TEXT, never a uuid. */
  unitId: string | null
  residentId: string | null
  title: string
  category: DocumentCategory
  storageBucket: DocumentBucket
  /** Path inside the private bucket. Never a URL, and never rendered directly. */
  storagePath: string
  originalFilename: string | null
  mimeType: string | null
  /** `bigint`. `null` when the size was never recorded — never 0 as a stand-in. */
  sizeBytes: number | null
  checksumSha256: string | null
  visibility: DocumentVisibility
  reviewStatus: DocumentReviewStatus
  retentionClass: DocumentRetentionClass
  expiresAt: string | null
  uploadedBy: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  metadata: Record<string, unknown>
  /** Optimistic concurrency. A stale write must return `conflict`, never win. */
  version: number
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Shared demo identifiers
// ---------------------------------------------------------------------------

/** The one demo company every seed in this repository belongs to. */
export const SEED_COMPANY_ID = "0a1b2c3d-0000-4000-8000-000000000001"

/** The Azura World site. */
export const SEED_SITE_ID = "0a1b2c3d-0000-4000-8000-000000000002"

/**
 * Unit ids follow `AZW-B{block:02}-{seq:04}` (CONVENTIONS §6).
 *
 * **These were `AZW-B03-0412` and `AZW-B07-0118`, and neither unit exists.**
 * Every block holds 94 units at most (`SEED_BLOCK_UNIT_COUNTS`), so sequence
 * 412 and sequence 118 were never generated by `seedUnitRows()`. Four documents
 * and two communication threads pointed at them, and every drill-through from
 * those rows to its unit was a 404.
 *
 * The ids predate the 94-per-block plan and survived because nothing joined the
 * two seed modules until this branch populated both. Found by P1's referential
 * integrity check, not by reading. Repointed at units that exist; the literal
 * still appears as a prose EXAMPLE in a dozen comments and in five probe
 * fixtures, which pass it directly and do not read these constants.
 */
export const SEED_UNIT_ID_OWNER = "AZW-B03-0042"
export const SEED_UNIT_ID_TENANT = "AZW-B07-0018"

/** Profiles. `PROFILE_RESIDENT` is the owner of `SEED_UNIT_ID_OWNER`. */
export const SEED_PROFILE_ID_MANAGER = "0a1b2c3d-0001-4000-8000-000000000001"
export const SEED_PROFILE_ID_STAFF = "0a1b2c3d-0001-4000-8000-000000000002"
export const SEED_PROFILE_ID_RESIDENT = "0a1b2c3d-0001-4000-8000-000000000003"
export const SEED_PROFILE_ID_TENANT = "0a1b2c3d-0001-4000-8000-000000000004"

/** `residents.id` for the profile above — documents attach to the resident row. */
export const SEED_RESIDENT_ID = "0a1b2c3d-0002-4000-8000-000000000001"

/** Stable ids so other seeds (message attachments) can reference a real document. */
export const SEED_DOCUMENT_IDS = {
  titleDeed: "0a1b2c3d-0003-4000-8000-000000000001",
  purchaseContract: "0a1b2c3d-0003-4000-8000-000000000002",
  identityCopy: "0a1b2c3d-0003-4000-8000-000000000003",
  managementInvoice: "0a1b2c3d-0003-4000-8000-000000000004",
  occupancyPermit: "0a1b2c3d-0003-4000-8000-000000000005",
  buildingInsurance: "0a1b2c3d-0003-4000-8000-000000000006",
  facadeInspection: "0a1b2c3d-0003-4000-8000-000000000007",
  handoverProtocol: "0a1b2c3d-0003-4000-8000-000000000008",
  portalSnapshot: "0a1b2c3d-0003-4000-8000-000000000009",
  brochure: "0a1b2c3d-0003-4000-8000-00000000000a",
} as const

/**
 * A 64-lower-case-hex checksum, the shape `documents.checksum_sha256` requires.
 * Built from a 16-character chunk so a hand-written literal cannot silently be
 * the wrong length — a truncated digest disables the byte comparison
 * CONVENTIONS §5 exists to demand.
 */
function seedChecksum(chunk16: string): string {
  return chunk16.repeat(4)
}

// ---------------------------------------------------------------------------
// The seed
// ---------------------------------------------------------------------------

/**
 * Ten documents spanning every state the repository has to distinguish:
 *
 * - both private buckets;
 * - all three review states, including a `rejected` one that carries its
 *   reviewer (the `documents_review_decision_recorded` CHECK requires it);
 * - all three visibilities, including a `unit` document still in
 *   `pending_review` — the resident it is about must NOT see that one;
 * - an already-expired permit and an insurance policy expiring shortly after
 *   the anchor, so `getComplianceDocuments()` has something to classify.
 */
function anchorDocuments(): DocumentRecord[] {
  return [
    {
      id: SEED_DOCUMENT_IDS.titleDeed,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: SEED_UNIT_ID_OWNER,
      residentId: SEED_RESIDENT_ID,
      title: "Tapu — AZW-B03-0042",
      category: "title_deed",
      storageBucket: "azura-documents",
      storagePath: "company/azura/units/AZW-B03-0042/title-deed-2026.pdf",
      originalFilename: "tapu-azw-b03-0412.pdf",
      mimeType: "application/pdf",
      sizeBytes: 482113,
      checksumSha256: seedChecksum("3b1f0c7a9d2e4568"),
      visibility: "unit",
      reviewStatus: "approved",
      retentionClass: "legal",
      expiresAt: null,
      uploadedBy: SEED_PROFILE_ID_STAFF,
      reviewedBy: SEED_PROFILE_ID_MANAGER,
      reviewedAt: seedIso(-180, 11),
      metadata: { landRegistryOffice: "Alanya", parcel: "1284/7" },
      version: 3,
      createdAt: seedIso(-182, 9),
      updatedAt: seedIso(-180, 11),
    },
    {
      id: SEED_DOCUMENT_IDS.purchaseContract,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: SEED_UNIT_ID_OWNER,
      residentId: SEED_RESIDENT_ID,
      title: "Kaufvertrag — AZW-B03-0042",
      category: "contract",
      storageBucket: "azura-documents",
      storagePath: "company/azura/units/AZW-B03-0042/purchase-contract.pdf",
      originalFilename: "kaufvertrag-azw-b03-0412.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1284560,
      checksumSha256: seedChecksum("7c4e91a2b5d80f36"),
      visibility: "unit",
      reviewStatus: "approved",
      retentionClass: "legal",
      expiresAt: null,
      uploadedBy: SEED_PROFILE_ID_STAFF,
      reviewedBy: SEED_PROFILE_ID_MANAGER,
      reviewedAt: seedIso(-179, 14),
      metadata: { language: "de", signedPages: 18 },
      version: 2,
      createdAt: seedIso(-181, 10),
      updatedAt: seedIso(-179, 14),
    },
    {
      // Identity copy, still unreviewed. Visibility "private": an identity
      // document is on the staff review path only, never on a unit feed.
      id: SEED_DOCUMENT_IDS.identityCopy,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: null,
      residentId: SEED_RESIDENT_ID,
      title: "Pass-Kopie — Eigentümer B03-0412",
      category: "identity",
      storageBucket: "azura-documents",
      storagePath: "company/azura/residents/0a1b2c3d-0002/passport-copy.pdf",
      originalFilename: "passport.pdf",
      mimeType: "application/pdf",
      sizeBytes: 214887,
      checksumSha256: seedChecksum("d0a53e8c19b7f462"),
      visibility: "private",
      reviewStatus: "pending_review",
      retentionClass: "identity",
      expiresAt: seedIso(900, 12),
      uploadedBy: SEED_PROFILE_ID_RESIDENT,
      reviewedBy: null,
      reviewedAt: null,
      metadata: { kycCase: "KYC-2026-0114" },
      version: 1,
      createdAt: seedIso(-9, 8),
      updatedAt: seedIso(-9, 8),
    },
    {
      id: SEED_DOCUMENT_IDS.managementInvoice,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: SEED_UNIT_ID_TENANT,
      residentId: null,
      title: "Betriebskostenabrechnung Q2 2026",
      category: "invoice",
      storageBucket: "azura-documents",
      storagePath: "company/azura/finance/2026-q2/service-charge.pdf",
      originalFilename: "betriebskosten-2026-q2.pdf",
      mimeType: "application/pdf",
      sizeBytes: 96421,
      checksumSha256: seedChecksum("5e2b8f01c4a6d397"),
      visibility: "company",
      reviewStatus: "approved",
      retentionClass: "finance",
      expiresAt: null,
      uploadedBy: SEED_PROFILE_ID_STAFF,
      reviewedBy: SEED_PROFILE_ID_MANAGER,
      reviewedAt: seedIso(-24, 15),
      metadata: { period: "2026-Q2" },
      version: 1,
      createdAt: seedIso(-26, 9),
      updatedAt: seedIso(-24, 15),
    },
    {
      // Already expired at the anchor. getComplianceDocuments() must classify
      // this "expired" rather than quietly listing it as current.
      id: SEED_DOCUMENT_IDS.occupancyPermit,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: null,
      residentId: null,
      title: "İskan — Blok B03",
      category: "permit",
      storageBucket: "azura-documents",
      storagePath: "company/azura/site/permits/occupancy-b03.pdf",
      originalFilename: "iskan-b03.pdf",
      mimeType: "application/pdf",
      sizeBytes: 331002,
      checksumSha256: seedChecksum("a94f3d06e81b25c7"),
      visibility: "company",
      reviewStatus: "approved",
      retentionClass: "legal",
      expiresAt: seedIso(-30, 12),
      uploadedBy: SEED_PROFILE_ID_STAFF,
      reviewedBy: SEED_PROFILE_ID_MANAGER,
      reviewedAt: seedIso(-198, 10),
      metadata: { block: "B03", authority: "Alanya Belediyesi" },
      version: 1,
      createdAt: seedIso(-200, 9),
      updatedAt: seedIso(-198, 10),
    },
    {
      // Expires 14 days after the anchor — the "expiring soon" case.
      id: SEED_DOCUMENT_IDS.buildingInsurance,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: null,
      residentId: null,
      title: "DASK-Police — Azura World Residence",
      category: "insurance",
      storageBucket: "azura-documents",
      storagePath: "company/azura/site/insurance/dask-2025-2026.pdf",
      originalFilename: "dask-police.pdf",
      mimeType: "application/pdf",
      sizeBytes: 154900,
      checksumSha256: seedChecksum("6f1c07b3e5a2948d"),
      visibility: "company",
      reviewStatus: "approved",
      retentionClass: "legal",
      expiresAt: seedIso(14, 12),
      uploadedBy: SEED_PROFILE_ID_STAFF,
      reviewedBy: SEED_PROFILE_ID_MANAGER,
      reviewedAt: seedIso(-118, 13),
      metadata: { policyNumber: "DASK-2025-88214" },
      version: 4,
      createdAt: seedIso(-120, 9),
      updatedAt: seedIso(-118, 13),
    },
    {
      // Rejected — and therefore carries its reviewer, as the
      // documents_review_decision_recorded CHECK requires.
      id: SEED_DOCUMENT_IDS.facadeInspection,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: null,
      residentId: null,
      title: "Fassadenprüfung — Rohbericht",
      category: "inspection",
      storageBucket: "azura-documents",
      storagePath: "company/azura/site/inspections/facade-draft.pdf",
      originalFilename: "fassade-rohbericht.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2210554,
      checksumSha256: seedChecksum("28d6b4f9013ace57"),
      visibility: "private",
      reviewStatus: "rejected",
      retentionClass: "service",
      expiresAt: null,
      uploadedBy: SEED_PROFILE_ID_STAFF,
      reviewedBy: SEED_PROFILE_ID_MANAGER,
      reviewedAt: seedIso(-11, 16),
      metadata: { rejectionReason: "scan_illegible", pages: 42 },
      version: 2,
      createdAt: seedIso(-13, 11),
      updatedAt: seedIso(-11, 16),
    },
    {
      // visibility "unit" but still pending_review. The resident it is about
      // must not see it — that pairing is the whole point of this row.
      id: SEED_DOCUMENT_IDS.handoverProtocol,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: SEED_UNIT_ID_TENANT,
      residentId: null,
      title: "Übergabeprotokoll — AZW-B07-0018",
      category: "handover",
      storageBucket: "azura-documents",
      storagePath: "company/azura/units/AZW-B07-0018/handover-protocol.pdf",
      originalFilename: "uebergabeprotokoll.pdf",
      mimeType: "application/pdf",
      sizeBytes: 78221,
      checksumSha256: seedChecksum("b3e07a5c2f14d968"),
      visibility: "unit",
      reviewStatus: "pending_review",
      retentionClass: "service",
      expiresAt: null,
      uploadedBy: SEED_PROFILE_ID_STAFF,
      reviewedBy: null,
      reviewedAt: null,
      metadata: { defectsOpen: 3 },
      version: 1,
      createdAt: seedIso(-4, 10),
      updatedAt: seedIso(-4, 10),
    },
    {
      // The evidence bucket: a stored competitor snapshot, not a customer file.
      id: SEED_DOCUMENT_IDS.portalSnapshot,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: null,
      residentId: null,
      title: "Snapshot — seasidealanya.com Listing",
      category: "evidence",
      storageBucket: "azura-evidence",
      storagePath: "raw/2026-07-20/seasidealanya-com-azura-world.html",
      originalFilename: "seasidealanya.html",
      mimeType: "text/html",
      sizeBytes: 418733,
      checksumSha256: seedChecksum("04c9e2b7a3f581d6"),
      visibility: "company",
      reviewStatus: "approved",
      retentionClass: "general",
      expiresAt: null,
      uploadedBy: SEED_PROFILE_ID_MANAGER,
      reviewedBy: SEED_PROFILE_ID_MANAGER,
      reviewedAt: seedIso(-7, 9),
      metadata: { publisher: "Seaside Alanya", tier: 4 },
      version: 1,
      createdAt: seedIso(-7, 9),
      updatedAt: seedIso(-7, 9),
    },
    {
      id: SEED_DOCUMENT_IDS.brochure,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: null,
      residentId: null,
      title: "Projektbroschüre 2026 (DE)",
      category: "marketing",
      storageBucket: "azura-documents",
      storagePath: "company/azura/marketing/brochure-2026-de.pdf",
      originalFilename: "azura-world-broschuere-de.pdf",
      mimeType: "application/pdf",
      sizeBytes: 8421990,
      checksumSha256: seedChecksum("f172a08d6b3e5c94"),
      visibility: "company",
      reviewStatus: "approved",
      retentionClass: "general",
      expiresAt: null,
      uploadedBy: SEED_PROFILE_ID_MANAGER,
      reviewedBy: SEED_PROFILE_ID_MANAGER,
      reviewedAt: seedIso(-40, 9),
      metadata: { locale: "de", pages: 36 },
      version: 1,
      createdAt: seedIso(-40, 9),
      updatedAt: seedIso(-40, 9),
    },
  ]
}

// ---------------------------------------------------------------------------
// The generated operating year
//
// The paperwork a 656-unit complex accumulates: a title deed and a purchase
// contract per owned unit, the handover protocol, the annual inspection
// certificates, and the vendor invoices as filed documents.
//
// ## No file exists behind any of these
//
// `storagePath` points into a bucket that has not been created — W0-A's
// `setup-supabase.mjs` has only ever been dry-run, so `azura-documents` does
// not exist. `getSignedDocumentUrl()` already returns `null` with a reason
// rather than a dead link, which is the honest behaviour and stays. These rows
// demonstrate the REGISTER: what the system tracks, who may see it, what is
// awaiting review. A demo that also served a working PDF would be claiming a
// storage integration this build does not have.
// ---------------------------------------------------------------------------

function generatedDocuments(): DocumentRecord[] {
  const rng = stream("documents")
  const out: DocumentRecord[] = []
  let index = 0

  const push = (
    unitId: string | null,
    title: string,
    category: DocumentCategory,
    visibility: DocumentVisibility,
    retention: DocumentRetentionClass,
    offset: number
  ) => {
    index += 1
    const review = rng.weighted<DocumentReviewStatus>([
      ["approved", 78],
      ["pending_review", 18],
      ["rejected", 4],
    ])
    const reviewed = review !== "pending_review"
    out.push({
      id: demoId("doc", index),
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId,
      residentId: null,
      title,
      category,
      storageBucket: "azura-documents",
      storagePath:
        "demo/" + String(index).padStart(4, "0") + "-" + category + ".pdf",
      originalFilename: null,
      mimeType: "application/pdf",
      sizeBytes: rng.int(48_000, 3_400_000),
      // No checksum: there is no file to have hashed. A plausible-looking
      // sha256 here would be the one field in this row that looks like proof.
      checksumSha256: null,
      visibility,
      reviewStatus: review,
      retentionClass: retention,
      expiresAt: null,
      uploadedBy: DEMO_PROFILE_IDS.staff,
      reviewedBy: reviewed ? DEMO_PROFILE_IDS.manager : null,
      reviewedAt: reviewed ? at(offset + 3, 11) : null,
      metadata: { ...DEMO_MARK },
      version: 1,
      createdAt: at(offset, 9),
      updatedAt: at(reviewed ? offset + 3 : offset, 9),
    })
  }

  // Ownership paperwork for a slice of the owned units.
  const owned = occupancy().filter((entry) => entry.relation === "owner")
  for (const entry of owned) {
    if (!rng.chance(0.16)) continue
    push(
      entry.unit.unitId,
      "Grundbuchauszug " + entry.unit.unitId,
      "title_deed",
      "unit",
      "legal",
      entry.startedOffset
    )
    push(
      entry.unit.unitId,
      "Kaufvertrag " + entry.unit.unitId,
      "contract",
      "unit",
      "legal",
      entry.startedOffset
    )
    if (rng.chance(0.5)) {
      push(
        entry.unit.unitId,
        "Übergabeprotokoll " + entry.unit.unitId,
        "handover",
        "unit",
        "legal",
        entry.startedOffset + 7
      )
    }
  }

  // Site-level certificates, one per month of the operating year.
  const CERTIFICATES: ReadonlyArray<readonly [string, DocumentCategory]> = [
    ["Aufzugsprüfung", "inspection"],
    ["Brandschutzprotokoll", "inspection"],
    ["Legionellenprüfung", "inspection"],
    ["Versicherungspolice Gebäude", "insurance"],
    ["Betriebsgenehmigung Pool", "permit"],
  ]
  for (const month of monthStarts()) {
    const certificate = rng.pick(CERTIFICATES)
    push(
      null,
      certificate[0] + " " + inPeriod(month),
      certificate[1],
      "company",
      "legal",
      month + 8
    )
  }

  return out
}

export function seedDocuments(): DocumentRecord[] {
  return [...anchorDocuments(), ...generatedDocuments()]
}
