/**
 * Documents — metadata reads and the only sanctioned path to the bytes.
 *
 * Every exported read goes through `withRepository()`: unconfigured Supabase
 * falls back to the local seed and labels itself, a **configured** Supabase that
 * fails throws, and an empty table is `source: "supabase"` with an empty array —
 * never a seed substitution (CONTRACTS §4, `lib/repository-base.ts`).
 *
 * ## The bytes are private. Always.
 *
 * `documents.storage_bucket` is CHECK-pinned to `('azura-documents',
 * 'azura-evidence')` and **both buckets are private**. There is no public URL to
 * construct, so this module never constructs one: `getSignedDocumentUrl()` mints
 * a short-TTL signed URL through `storage.createSignedUrl()` and nothing else in
 * this file — or anywhere downstream — may call `getPublicUrl()` or build a
 * storage path into a URL by hand (CONVENTIONS §4).
 *
 * A signed URL carries an access token in its query string. It is returned to
 * the caller and never logged, never persisted, never put in a `degradedReason`
 * and never cached.
 *
 * ## A resident sees approved documents only
 *
 * The RLS resident paths (`documents_select_own_unit`,
 * `documents_select_own_resident`) both require `review_status = 'approved'`,
 * and the unit path additionally requires `visibility = 'unit'`. An unreviewed
 * document is not shown to the person it is about. The scoping below mirrors
 * that predicate exactly.
 *
 * **This duplicates RLS deliberately.** RLS is the boundary that must hold;
 * repository scoping is defence in depth, and it is the only thing that works in
 * local-seed mode, where there is no Postgres and therefore no RLS at all.
 */

import type { RepositoryResult, Role } from "@/lib/contracts"
import { roleLevel } from "@/lib/contracts"
import {
  complianceDocumentCategories,
  documentBuckets,
  documentCategories,
  documentRetentionClasses,
  documentReviewStatuses,
  documentVisibilities,
  seedDocuments,
  type DocumentBucket,
  type DocumentCategory,
  type DocumentRecord,
  type DocumentRetentionClass,
  type DocumentReviewStatus,
  type DocumentVisibility,
} from "@/lib/document-data"
import { hasPermission } from "@/lib/rbac"
import {
  asNullableNumber,
  asNullableString,
  asRecord,
  asString,
  clampLimit,
  clampOffset,
  degraded,
  MAX_PAGE_SIZE,
  nowIso,
  unwrap,
  withRepository,
  type RepositoryClient,
} from "@/lib/repository-base"

export type {
  DocumentBucket,
  DocumentCategory,
  DocumentRecord,
  DocumentRetentionClass,
  DocumentReviewStatus,
  DocumentVisibility,
}

// ---------------------------------------------------------------------------
// Query surface
// ---------------------------------------------------------------------------

/**
 * Filters for `getDocuments()`.
 *
 * `role` is optional. Supplied, it narrows the result to what that role may see
 * (below). Omitted, this module applies **no** narrowing and RLS is the only
 * filter — which is correct for a server caller that has already authorised, and
 * wrong for anything reachable from a request. Pass it.
 */
export interface DocumentQueryOptions {
  role?: Role
  /** `units.id`, e.g. "AZW-B03-0412". TEXT, not a uuid. */
  unitId?: string
  residentId?: string
  siteId?: string
  category?: DocumentCategory | readonly DocumentCategory[]
  reviewStatus?: DocumentReviewStatus
  visibility?: DocumentVisibility
  storageBucket?: DocumentBucket
  /** Default 50, hard ceiling 500. Never unbounded. */
  limit?: number
  offset?: number
}

/** How `expiresAt` compares to `asOf`. `"none"` means the document never expires. */
export type DocumentExpiryState = "none" | "valid" | "expiring_soon" | "expired"

/** A document plus its expiry classification, for the compliance surface. */
export interface ComplianceDocument extends DocumentRecord {
  expiryState: DocumentExpiryState
  /** Whole days from `asOf` to `expiresAt`; negative once expired, `null` if no expiry. */
  daysUntilExpiry: number | null
}

/** Filters for `getComplianceDocuments()`. */
export interface ComplianceDocumentQueryOptions extends Omit<
  DocumentQueryOptions,
  "category"
> {
  /** Defaults to `complianceDocumentCategories`. */
  category?: DocumentCategory | readonly DocumentCategory[]
  /** Only documents expiring within this many days of `asOf`. */
  expiringWithinDays?: number
  /**
   * The instant expiry is measured against. Defaults to `nowIso()`. Pass it to
   * keep a snapshot test deterministic — the default is the wall clock.
   */
  asOf?: string
  /** Days before expiry at which a document counts as `"expiring_soon"`. Default 30. */
  expiringSoonDays?: number
}

/**
 * A minted, short-lived, token-bearing URL. Hand it to the browser and forget
 * it: do not log it, store it, or put it in a cache key.
 */
export interface SignedDocumentUrl {
  documentId: string
  bucket: DocumentBucket
  path: string
  url: string
  ttlSeconds: number
  issuedAt: string
  expiresAt: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DOCUMENT_COLUMNS =
  "id, company_id, site_id, unit_id, resident_id, title, category, storage_bucket, storage_path, original_filename, mime_type, size_bytes, checksum_sha256, visibility, review_status, retention_class, expires_at, uploaded_by, reviewed_by, reviewed_at, metadata, version, created_at, updated_at"

/** CONVENTIONS §4: "Signed URLs for documents, short TTL." */
export const DEFAULT_SIGNED_URL_TTL_SECONDS = 60
const MIN_SIGNED_URL_TTL_SECONDS = 15
const MAX_SIGNED_URL_TTL_SECONDS = 300

const DEFAULT_EXPIRING_SOON_DAYS = 30
const MS_PER_DAY = 86_400_000

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

/**
 * Narrow an unknown column value to one of the CHECK constraint's literals.
 * Returns the literal **from `allowed`**, so no cast is involved. The fallbacks
 * chosen at each call site are fail-closed: a `visibility` that does not parse
 * becomes `"private"` and a `review_status` becomes `"pending_review"`, so
 * schema drift hides a document rather than exposing one.
 */
function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  if (typeof value === "string") {
    for (const candidate of allowed) {
      if (candidate === value) return candidate
    }
  }
  return fallback
}

function mapDocument(row: unknown): DocumentRecord {
  const record = asRecord(row)
  return {
    id: asString(record["id"]),
    companyId: asString(record["company_id"]),
    siteId: asNullableString(record["site_id"]),
    unitId: asNullableString(record["unit_id"]),
    residentId: asNullableString(record["resident_id"]),
    title: asString(record["title"]),
    category: oneOf(record["category"], documentCategories, "general"),
    storageBucket: oneOf(
      record["storage_bucket"],
      documentBuckets,
      "azura-documents"
    ),
    storagePath: asString(record["storage_path"]),
    originalFilename: asNullableString(record["original_filename"]),
    mimeType: asNullableString(record["mime_type"]),
    // bigint. `null` means "never recorded" and stays null — a 0-byte document
    // and an unmeasured one are different facts.
    sizeBytes: asNullableNumber(record["size_bytes"]),
    checksumSha256: asNullableString(record["checksum_sha256"]),
    visibility: oneOf(record["visibility"], documentVisibilities, "private"),
    reviewStatus: oneOf(
      record["review_status"],
      documentReviewStatuses,
      "pending_review"
    ),
    retentionClass: oneOf(
      record["retention_class"],
      documentRetentionClasses,
      "general"
    ),
    expiresAt: asNullableString(record["expires_at"]),
    uploadedBy: asNullableString(record["uploaded_by"]),
    reviewedBy: asNullableString(record["reviewed_by"]),
    reviewedAt: asNullableString(record["reviewed_at"]),
    metadata: asRecord(record["metadata"]),
    // 0 is not a legal version: the column defaults to 1 and only increases. A
    // row that arrives without one therefore fails an optimistic-concurrency
    // check instead of silently winning it.
    version: asNullableNumber(record["version"]) ?? 0,
    createdAt: asString(record["created_at"]),
    updatedAt: asString(record["updated_at"]),
  }
}

// ---------------------------------------------------------------------------
// Role scoping — a mirror of the RLS predicates, for local-seed mode
// ---------------------------------------------------------------------------

type DocumentScope =
  /** Company-wide: `is_admin()` or `has_role_level(40)`. */
  | { kind: "company" }
  /** The two resident policies: approved unit documents and own resident docs. */
  | { kind: "resident" }
  /** No read path at all. */
  | { kind: "none" }

function documentScopeFor(role: Role | undefined): DocumentScope {
  // No role supplied: no repository-side narrowing. RLS still applies in
  // Supabase mode; in seed mode there is no real data to leak.
  if (role === undefined) return { kind: "company" }
  // A role that is not offered the surface at all gets nothing. `guest` and the
  // `child_*` roles hold no `documents:view`.
  if (!hasPermission(role, "documents:view")) return { kind: "none" }
  if (roleLevel[role] >= roleLevel.staff) return { kind: "company" }
  return { kind: "resident" }
}

/**
 * PostgREST filter strings are a grammar, and `,` `(` `)` `.` are its
 * operators. Values interpolated into `.or()` are therefore validated first —
 * the same rule as "no user input concatenated into SQL" (CONVENTIONS §4).
 * `.eq()` / `.in()` need no guard: the client encodes those for us.
 *
 * Unit ids ("AZW-B03-0412") and uuids both match; anything else is rejected and
 * the caller treats the filter as unsatisfiable rather than interpolating it.
 */
function isSafeFilterToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value)
}

/** The `.or()` clauses expressing the resident read path, or `null` if unsafe. */
function residentOrClauses(opts: DocumentQueryOptions): string[] | null {
  const clauses: string[] = []

  const unitId = opts.unitId
  if (unitId === undefined) {
    clauses.push("visibility.eq.unit")
  } else {
    if (!isSafeFilterToken(unitId)) return null
    clauses.push(`and(visibility.eq.unit,unit_id.eq.${unitId})`)
  }

  const residentId = opts.residentId
  if (residentId !== undefined) {
    if (!isSafeFilterToken(residentId)) return null
    clauses.push(`resident_id.eq.${residentId}`)
  }

  return clauses
}

/** The seed-mode twin of `residentOrClauses`. Same predicate, no SQL. */
function matchesResidentScope(
  document: DocumentRecord,
  opts: DocumentQueryOptions
): boolean {
  if (document.reviewStatus !== "approved") return false

  const unitId = opts.unitId
  const byUnit =
    document.visibility === "unit" &&
    (unitId === undefined || document.unitId === unitId)

  const residentId = opts.residentId
  const byResident =
    residentId !== undefined && document.residentId === residentId

  return byUnit || byResident
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function requestedCategories(
  category: DocumentQueryOptions["category"]
): readonly DocumentCategory[] | null {
  if (category === undefined) return null
  return typeof category === "string" ? [category] : category
}

/** Seed-mode filtering, ordered `created_at desc` to match the Supabase query. */
function filterSeedDocuments(
  documents: readonly DocumentRecord[],
  opts: DocumentQueryOptions,
  scope: DocumentScope
): DocumentRecord[] {
  if (scope.kind === "none") return []

  const categories = requestedCategories(opts.category)
  const limit = clampLimit(opts.limit)
  const offset = clampOffset(opts.offset)

  const matched = documents.filter((document) => {
    if (scope.kind === "resident" && !matchesResidentScope(document, opts)) {
      return false
    }
    if (scope.kind === "company") {
      if (opts.unitId !== undefined && document.unitId !== opts.unitId)
        return false
      if (
        opts.residentId !== undefined &&
        document.residentId !== opts.residentId
      ) {
        return false
      }
    }
    if (opts.siteId !== undefined && document.siteId !== opts.siteId)
      return false
    if (categories !== null && !categories.includes(document.category))
      return false
    if (
      opts.reviewStatus !== undefined &&
      document.reviewStatus !== opts.reviewStatus
    ) {
      return false
    }
    if (
      opts.visibility !== undefined &&
      document.visibility !== opts.visibility
    ) {
      return false
    }
    if (
      opts.storageBucket !== undefined &&
      document.storageBucket !== opts.storageBucket
    ) {
      return false
    }
    return true
  })

  matched.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return matched.slice(offset, offset + limit)
}

async function queryDocuments(
  client: RepositoryClient,
  opts: DocumentQueryOptions,
  scope: DocumentScope
): Promise<DocumentRecord[]> {
  if (scope.kind === "none") return []

  const limit = clampLimit(opts.limit)
  const offset = clampOffset(opts.offset)

  let query = client.from("documents").select(DOCUMENT_COLUMNS)

  if (scope.kind === "resident") {
    const clauses = residentOrClauses(opts)
    // A malformed identifier cannot match a real row, so it resolves to the
    // empty set rather than being interpolated into the filter grammar.
    if (clauses === null) return []
    query = query.eq("review_status", "approved").or(clauses.join(","))
  } else {
    if (opts.unitId !== undefined) query = query.eq("unit_id", opts.unitId)
    if (opts.residentId !== undefined) {
      query = query.eq("resident_id", opts.residentId)
    }
    if (opts.reviewStatus !== undefined) {
      query = query.eq("review_status", opts.reviewStatus)
    }
    if (opts.visibility !== undefined) {
      query = query.eq("visibility", opts.visibility)
    }
  }

  if (opts.siteId !== undefined) query = query.eq("site_id", opts.siteId)
  if (opts.storageBucket !== undefined) {
    query = query.eq("storage_bucket", opts.storageBucket)
  }

  const categories = requestedCategories(opts.category)
  if (categories !== null) query = query.in("category", [...categories])

  const rows = unwrap<unknown[]>(
    await query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1),
    []
  )
  return rows.map(mapDocument)
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Document metadata, newest first. Bounded: default 50 rows, ceiling 500.
 *
 * An empty array from a configured Supabase is `source: "supabase"` — a company
 * with no documents is a fact, not a failure, and substituting seed data there
 * is how a demo lies about what is in the database.
 */
export async function getDocuments(
  opts: DocumentQueryOptions = {}
): Promise<RepositoryResult<DocumentRecord[]>> {
  const scope = documentScopeFor(opts.role)
  return withRepository(
    (client) => queryDocuments(client, opts, scope),
    () => filterSeedDocuments(seedDocuments(), opts, scope),
    "documents.list"
  )
}

/**
 * One document by id, or `null` when it does not exist **or the caller may not
 * see it** — the two are deliberately indistinguishable, so a 404 never doubles
 * as an existence oracle.
 */
export async function getDocument(
  id: string,
  opts: { role?: Role } = {}
): Promise<RepositoryResult<DocumentRecord | null>> {
  const scope = documentScopeFor(opts.role)

  return withRepository<DocumentRecord | null>(
    async (client) => {
      if (scope.kind === "none") return null
      const row = unwrap<unknown>(
        await client
          .from("documents")
          .select(DOCUMENT_COLUMNS)
          .eq("id", id)
          .maybeSingle(),
        null
      )
      if (row === null) return null
      const document = mapDocument(row)
      // RLS has already refused a row the caller may not read; this repeats the
      // resident predicate for local-seed parity and defence in depth.
      if (scope.kind === "resident" && !matchesResidentScope(document, {})) {
        return null
      }
      return document
    },
    () => {
      if (scope.kind === "none") return null
      const document = seedDocuments().find((candidate) => candidate.id === id)
      if (document === undefined) return null
      if (scope.kind === "resident" && !matchesResidentScope(document, {})) {
        return null
      }
      return document
    },
    "documents.get"
  )
}

/**
 * Mint a short-TTL signed URL for a document's bytes.
 *
 * **This is the only read path to a document's contents in the entire codebase.**
 * Both buckets are private; `getPublicUrl()` is never called here and must never
 * be called anywhere. The returned URL embeds an access token — return it to the
 * browser, and never log, persist or cache it.
 *
 * The document row is read through the **caller's** client first, so RLS decides
 * whether a URL may be minted at all: a caller who cannot read the metadata
 * cannot obtain a URL for the bytes.
 *
 * In local-seed mode there is no storage and therefore no URL. The result is
 * `null` with a `degradedReason` saying so — a fabricated link would be worse
 * than an honest absence.
 */
export async function getSignedDocumentUrl(
  id: string,
  ttlSeconds: number = DEFAULT_SIGNED_URL_TTL_SECONDS
): Promise<RepositoryResult<SignedDocumentUrl | null>> {
  const ttl = Math.min(
    Math.max(Math.trunc(ttlSeconds), MIN_SIGNED_URL_TTL_SECONDS),
    MAX_SIGNED_URL_TTL_SECONDS
  )

  const result = await withRepository<SignedDocumentUrl | null>(
    async (client) => {
      const row = unwrap<unknown>(
        await client
          .from("documents")
          .select("id, storage_bucket, storage_path")
          .eq("id", id)
          .maybeSingle(),
        null
      )
      if (row === null) return null

      const record = asRecord(row)
      const bucket = oneOf(
        record["storage_bucket"],
        documentBuckets,
        "azura-documents"
      )
      const path = asString(record["storage_path"])
      if (path.length === 0) return null

      const signed = await client.storage
        .from(bucket)
        .createSignedUrl(path, ttl)
      // Thrown, not swallowed: a configured Supabase that fails is an outage,
      // and `withRepository` maps and logs it server-side.
      if (signed.error !== null) throw signed.error

      const url = asString(asRecord(signed.data)["signedUrl"])
      if (url.length === 0) return null

      const issuedAt = nowIso()
      return {
        documentId: asString(record["id"]),
        bucket,
        path,
        url,
        ttlSeconds: ttl,
        issuedAt,
        expiresAt: new Date(
          new Date(issuedAt).getTime() + ttl * 1000
        ).toISOString(),
      }
    },
    () => null,
    "documents.signedUrl"
  )

  if (result.source === "local-seed") {
    return degraded(
      result,
      "Document bytes live in private Supabase Storage; no signed URL can be minted in local-seed mode."
    )
  }
  return result
}

/**
 * Documents attached to one unit. `unitId` is the business code
 * ("AZW-B03-0412"), because `documents.unit_id` is TEXT.
 */
export async function getDocumentsForUnit(
  unitId: string,
  opts: DocumentQueryOptions = {}
): Promise<RepositoryResult<DocumentRecord[]>> {
  return getDocuments({ ...opts, unitId })
}

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

function classifyExpiry(
  document: DocumentRecord,
  asOfMs: number,
  expiringSoonDays: number
): ComplianceDocument {
  const expiresAt = document.expiresAt
  if (expiresAt === null) {
    return { ...document, expiryState: "none", daysUntilExpiry: null }
  }

  const expiresMs = Date.parse(expiresAt)
  if (Number.isNaN(expiresMs)) {
    // An unparseable timestamp is not "valid" — say nothing rather than
    // asserting a state the data does not support.
    return { ...document, expiryState: "none", daysUntilExpiry: null }
  }

  const daysUntilExpiry = Math.floor((expiresMs - asOfMs) / MS_PER_DAY)
  const expiryState: DocumentExpiryState =
    expiresMs <= asOfMs
      ? "expired"
      : daysUntilExpiry <= expiringSoonDays
        ? "expiring_soon"
        : "valid"

  return { ...document, expiryState, daysUntilExpiry }
}

/**
 * The compliance-bearing documents — title deeds, contracts, identity papers,
 * permits, insurance and inspections — classified by expiry and ordered by
 * `expires_at` ascending, so the thing about to lapse is first.
 *
 * Scoping is the same as `getDocuments()`: this mirrors the `documents` RLS
 * predicate, nothing more. The compliance **cockpit** is a separate RBAC gate —
 * a route rendering it must still check `hasPermission(role, "compliance:view")`,
 * which `staff` does not hold.
 */
export async function getComplianceDocuments(
  opts: ComplianceDocumentQueryOptions = {}
): Promise<RepositoryResult<ComplianceDocument[]>> {
  const scope = documentScopeFor(opts.role)
  const asOf = opts.asOf ?? nowIso()
  const asOfMs = Date.parse(asOf)
  const expiringSoonDays = opts.expiringSoonDays ?? DEFAULT_EXPIRING_SOON_DAYS
  // Normalised to an array first: spreading a bare string would produce one
  // filter value per character.
  const categories =
    requestedCategories(opts.category) ?? complianceDocumentCategories

  const cutoffIso =
    opts.expiringWithinDays === undefined || Number.isNaN(asOfMs)
      ? null
      : new Date(asOfMs + opts.expiringWithinDays * MS_PER_DAY).toISOString()

  // Date.parse failing would silently classify everything as "none"; an
  // unparseable `asOf` is a caller bug, so fall back to the wall clock rather
  // than reporting a fleet of documents as having no expiry.
  const effectiveAsOfMs = Number.isNaN(asOfMs) ? Date.parse(nowIso()) : asOfMs

  const documentOpts: DocumentQueryOptions = { ...opts, category: categories }

  return withRepository<ComplianceDocument[]>(
    async (client) => {
      if (scope.kind === "none") return []

      const limit = clampLimit(opts.limit)
      const offset = clampOffset(opts.offset)

      let query = client
        .from("documents")
        .select(DOCUMENT_COLUMNS)
        .in("category", [...categories])

      if (scope.kind === "resident") {
        const clauses = residentOrClauses(documentOpts)
        if (clauses === null) return []
        query = query.eq("review_status", "approved").or(clauses.join(","))
      } else {
        if (opts.unitId !== undefined) query = query.eq("unit_id", opts.unitId)
        if (opts.residentId !== undefined) {
          query = query.eq("resident_id", opts.residentId)
        }
        if (opts.reviewStatus !== undefined) {
          query = query.eq("review_status", opts.reviewStatus)
        }
        if (opts.visibility !== undefined) {
          query = query.eq("visibility", opts.visibility)
        }
      }

      if (opts.siteId !== undefined) query = query.eq("site_id", opts.siteId)
      if (cutoffIso !== null) {
        query = query.not("expires_at", "is", null).lte("expires_at", cutoffIso)
      }

      const rows = unwrap<unknown[]>(
        await query
          .order("expires_at", { ascending: true, nullsFirst: false })
          .range(offset, offset + limit - 1),
        []
      )
      return rows.map((row) =>
        classifyExpiry(mapDocument(row), effectiveAsOfMs, expiringSoonDays)
      )
    },
    () => {
      if (scope.kind === "none") return []

      const limit = clampLimit(opts.limit)
      const offset = clampOffset(opts.offset)

      const matched = filterSeedDocuments(
        seedDocuments(),
        // Pagination is applied after the expiry filter below, so the shared
        // filter runs at the ceiling here rather than at the caller's page size.
        { ...documentOpts, limit: MAX_PAGE_SIZE, offset: 0 },
        scope
      ).filter((document) => {
        if (cutoffIso === null) return true
        return document.expiresAt !== null && document.expiresAt <= cutoffIso
      })

      // `expires_at asc nulls last`, matching the Supabase ordering.
      matched.sort((a, b) => {
        if (a.expiresAt === b.expiresAt)
          return a.createdAt.localeCompare(b.createdAt)
        if (a.expiresAt === null) return 1
        if (b.expiresAt === null) return -1
        return a.expiresAt.localeCompare(b.expiresAt)
      })

      return matched
        .slice(offset, offset + limit)
        .map((document) =>
          classifyExpiry(document, effectiveAsOfMs, expiringSoonDays)
        )
    },
    "documents.compliance"
  )
}
