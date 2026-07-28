/**
 * Uploading a document: what is allowed, what it is really called, and what
 * actually happened.                                            Owner: W3-F
 *
 * Everything in the first two thirds of this file is **pure**. `sniffContent`,
 * `sanitiseFilename`, `validateUpload` and `storagePathFor` take bytes and
 * strings and return decisions, so `scripts/governance-probe.mts` executes them
 * rather than reading them. The I/O lives in `storeDocument` at the bottom and
 * is a thin shell over that decision.
 *
 * ## The filename is a claim, not a fact
 *
 * `tasks/W3-F`: *"A `.pdf` that is actually HTML. Validate content type by
 * sniffing bytes, not by trusting the name."* So the order here is:
 *
 *   1. read the leading bytes and decide what the file **is**
 *   2. reject outright anything that sniffs as markup or script, whatever it
 *      claims to be
 *   3. reject when what it is disagrees with what it says it is
 *   4. only then look at the name, and only to derive a safe storage key
 *
 * Step 2 is separate from step 3 on purpose. A `.html` uploaded honestly as
 * `text/html` would pass step 3 — the claim and the content agree — and it is
 * still the file we least want in a bucket whose contents are handed back
 * through signed URLs. An HTML document served from our own storage origin is a
 * stored-XSS primitive, so it is refused for being HTML, not for lying.
 *
 * ## The bucket is named once
 *
 * `DOCUMENT_BUCKET`. `documents.storage_bucket` is CHECK-pinned to
 * `('azura-documents', 'azura-evidence')` and both are private, so there is no
 * public URL to construct and this module never constructs one. Reads go
 * through `getSignedDocumentUrl()` in `lib/document-repository.ts` — the only
 * sanctioned path to the bytes, with a 60 second default TTL.
 *
 * ## Without storage, this returns 503
 *
 * Never a fake success. OVERNIGHT-2 §4.6 and `tasks/W2-B` both state it:
 * *"Reads may serve seed; writes may not."*
 */

import { createHash, randomUUID } from "node:crypto"

import { isSupabaseConfigured } from "@/lib/env"
import type { DocumentCategory } from "@/lib/document-data"
import type { AuditOutcome } from "@/lib/governance-audit"

/**
 * `lib/supabase/server.ts` and `lib/governance-audit.ts` are imported
 * DYNAMICALLY, inside `storeDocument`, and the type-only import above is
 * deliberate.
 *
 * Both reach `next/headers` transitively, which plain Node cannot resolve. A
 * static import here would therefore make this whole module unloadable by
 * `scripts/governance-probe.mts` — and the probe is the only thing that
 * actually executes `sniffContent`, `sanitiseFilename` and `validateUpload`
 * rather than reading them. W1-B split `lib/auth-resolution.ts` out of
 * `lib/auth.ts` for exactly this reason; deferring two imports achieves the
 * same separation without splitting the file the brief names.
 *
 * Next resolves a dynamic import identically for bundling, so nothing about the
 * application build changes. `import type` is erased entirely
 * (`verbatimModuleSyntax`), so it costs nothing at runtime.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The canonical bucket. Named once, here, and imported everywhere else.
 *
 * `azura-evidence` is the other CHECK-permitted value and belongs to the
 * evidence harvest, not to user uploads. A user-facing upload path that could
 * choose its own bucket is a way to get a document into the wrong ACL.
 */
export const DOCUMENT_BUCKET = "azura-documents" as const

/** 25 MB. Enforced server-side, before the write, on the real byte length. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

/** Below this a file cannot carry a magic number, so it cannot be identified. */
const MIN_UPLOAD_BYTES = 8

/** How many leading bytes the sniffer reads. Every signature below fits. */
const SNIFF_WINDOW = 512

/** Storage keys are bounded; Supabase Storage caps a path at 1024 characters. */
const MAX_SAFE_NAME = 96

// ---------------------------------------------------------------------------
// Content sniffing
// ---------------------------------------------------------------------------

/** What the bytes actually are. `unknown` and `markup` are both refusals. */
export type SniffedType =
  | "pdf"
  | "png"
  | "jpeg"
  | "webp"
  | "zip_office"
  /** HTML, XML, SVG or anything else that a browser would execute or render. */
  | "markup"
  | "unknown"

/** The MIME types a caller may claim, and what each must sniff as. */
export const ALLOWED_UPLOAD_TYPES: Readonly<Record<string, SniffedType>> =
  Object.freeze({
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpeg",
    "image/webp": "webp",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "zip_office",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      "zip_office",
  })

/** Extension each sniffed type is stored with. The claim never picks this. */
const EXTENSION_FOR: Readonly<Record<string, string>> = Object.freeze({
  pdf: "pdf",
  png: "png",
  jpeg: "jpg",
  webp: "webp",
  zip_office: "zip",
})

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false
  return signature.every((byte, index) => bytes[index] === byte)
}

/**
 * Identify a file from its leading bytes.
 *
 * Markup detection is deliberately generous: leading whitespace and a BOM are
 * skipped, and the test is case-insensitive, because `  <!DOCTYPE html>` and
 * `<HTML>` are exactly as executable as `<!doctype html>`. A sniffer that can be
 * defeated by two spaces is decoration.
 */
export function sniffContent(bytes: Uint8Array): SniffedType {
  const window = bytes.subarray(0, SNIFF_WINDOW)

  // %PDF-
  if (startsWith(window, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"
  // \x89PNG\r\n\x1a\n
  if (startsWith(window, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "png"
  }
  // JPEG SOI + marker
  if (startsWith(window, [0xff, 0xd8, 0xff])) return "jpeg"
  // RIFF ???? WEBP
  if (
    startsWith(window, [0x52, 0x49, 0x46, 0x46]) &&
    window.length >= 12 &&
    window[8] === 0x57 &&
    window[9] === 0x45 &&
    window[10] === 0x42 &&
    window[11] === 0x50
  ) {
    return "webp"
  }

  // Markup is checked BEFORE the zip signature, because both are text-ish and a
  // misidentification in this direction is the expensive one.
  let text = new TextDecoder("utf-8", { fatal: false }).decode(window)
  // A UTF-8 BOM, then any leading whitespace. Both are invisible to a reader and
  // neither stops a browser parsing what follows as HTML.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const head = text.trimStart().slice(0, 120).toLowerCase()
  if (
    head.startsWith("<!doctype") ||
    head.startsWith("<html") ||
    head.startsWith("<?xml") ||
    head.startsWith("<svg") ||
    head.startsWith("<script") ||
    head.startsWith("<body")
  ) {
    return "markup"
  }

  // PK\x03\x04 — docx and xlsx are zip containers.
  if (startsWith(window, [0x50, 0x4b, 0x03, 0x04])) return "zip_office"

  return "unknown"
}

// ---------------------------------------------------------------------------
// Filenames
// ---------------------------------------------------------------------------

/**
 * Turkish letters that have no ASCII identity mapping.
 *
 * `İ`.toLowerCase() is `i̇` (i plus a combining dot) in a non-Turkish locale, and
 * `I`.toLowerCase() is `ı` in a Turkish one. Neither belongs in a storage key,
 * so the fold is explicit and locale-independent rather than left to
 * `toLowerCase()`. CONVENTIONS §5 makes the same point about `Intl.Collator`.
 */
const TRANSLITERATE: Readonly<Record<string, string>> = Object.freeze({
  ç: "c",
  Ç: "C",
  ğ: "g",
  Ğ: "G",
  ı: "i",
  İ: "I",
  ö: "o",
  Ö: "O",
  ş: "s",
  Ş: "S",
  ü: "u",
  Ü: "U",
  ä: "a",
  Ä: "A",
  ß: "ss",
  é: "e",
  É: "E",
})

/** Windows reserved device names. A file called `CON.pdf` is a support ticket. */
const RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
])

export interface SanitisedFilename {
  /** What goes in the storage key. ASCII, bounded, never empty. */
  safe: string
  /** Exactly what the user sent, kept as display metadata only. */
  original: string
  /** True when `safe` differs from `original` beyond the extension. */
  changed: boolean
}

/**
 * Reduce a user-supplied filename to something safe to put in a storage key.
 *
 * Path traversal is handled by **taking the basename**, not by removing `..`:
 * a blocklist that strips `../` turns `....//` into `../`, which is the classic
 * way that particular filter fails. Splitting on both separators and keeping the
 * last non-empty segment cannot be defeated that way, and then every character
 * outside `[A-Za-z0-9._-]` is replaced regardless.
 *
 * The extension is **not** taken from the name. `storagePathFor` appends the one
 * that matches the sniffed type, so `evil.pdf` containing HTML never gets stored
 * with a `.pdf` on the end even in the branch where it is somehow allowed.
 */
export function sanitiseFilename(raw: string): SanitisedFilename {
  const original = raw

  // Basename, across both separators. `../../etc/passwd` → `passwd`.
  const segments = raw.split(/[/\\]/u).filter((segment) => segment.length > 0)
  let name = segments[segments.length - 1] ?? ""

  // NUL and every other C0 control. A NUL in a filename truncates the name in
  // some consumers and hides the rest — SEC-008 is the same class of bug at the
  // secret-scanner layer.
  name = name.replace(/[\u0000-\u001f\u007f-\u009f]/gu, "")

  name = name.normalize("NFC")
  name = Array.from(name)
    .map((character) => TRANSLITERATE[character] ?? character)
    .join("")

  // Drop the claimed extension. The real one is appended later.
  const lastDot = name.lastIndexOf(".")
  if (lastDot > 0) name = name.slice(0, lastDot)

  name = name.replace(/[^A-Za-z0-9._-]/gu, "-").replace(/-{2,}/gu, "-")
  // No leading dot (a hidden file), no leading or trailing separator noise.
  name = name.replace(/^[.\-_]+/u, "").replace(/[.\-_]+$/u, "")
  name = name.slice(0, MAX_SAFE_NAME)

  if (name.length === 0 || RESERVED_NAMES.has(name.toLowerCase())) {
    name = "dokument"
  }

  return { safe: name, original, changed: name !== original }
}

/**
 * The storage key.
 *
 * A `randomUUID` prefix means two uploads of `rechnung.pdf` cannot collide, and
 * `documents` has `unique (storage_bucket, storage_path)` — two rows pointing at
 * one object means one of them carries the wrong ACL and there is no way to tell
 * which. The extension comes from the **sniffed** type.
 */
export function storagePathFor(input: {
  companyId: string
  category: DocumentCategory
  safeName: string
  sniffed: SniffedType
}): string {
  const extension = EXTENSION_FOR[input.sniffed] ?? "bin"
  const company = input.companyId.replace(/[^A-Za-z0-9-]/gu, "")
  return `company/${company}/${input.category}/${randomUUID()}-${input.safeName}.${extension}`
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Why an upload was refused. A key; the prose is in `messages/*`. */
export type UploadRejection =
  | "empty"
  | "too_large"
  | "too_small"
  | "type_not_allowed"
  | "content_is_markup"
  | "content_mismatch"
  | "content_unrecognised"

export type UploadValidation =
  | {
      ok: true
      sniffed: SniffedType
      filename: SanitisedFilename
      sizeBytes: number
      checksumSha256: string
    }
  | { ok: false; rejection: UploadRejection; sniffed: SniffedType }

/**
 * Decide whether these bytes may be stored. Pure.
 *
 * The size ceiling is checked against `bytes.length` — the real length — and
 * before anything else touches the buffer. A declared `Content-Length` is
 * another claim, and a zip bomb is refused here on its compressed size because
 * nothing in this path ever decompresses it: the bytes are stored opaque and
 * handed back through a signed URL, so the expansion never happens on our side.
 */
export function validateUpload(input: {
  bytes: Uint8Array
  declaredMimeType: string
  filename: string
}): UploadValidation {
  const { bytes, declaredMimeType, filename } = input

  if (bytes.length === 0) {
    return { ok: false, rejection: "empty", sniffed: "unknown" }
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return { ok: false, rejection: "too_large", sniffed: "unknown" }
  }
  if (bytes.length < MIN_UPLOAD_BYTES) {
    return { ok: false, rejection: "too_small", sniffed: "unknown" }
  }

  const sniffed = sniffContent(bytes)

  // Refused for being markup, before the claim is even considered. An honest
  // `text/html` upload is still an XSS primitive served from our own origin.
  if (sniffed === "markup") {
    return { ok: false, rejection: "content_is_markup", sniffed }
  }
  if (sniffed === "unknown") {
    return { ok: false, rejection: "content_unrecognised", sniffed }
  }

  // `Object.hasOwn`, not `in`: `ALLOWED_UPLOAD_TYPES["constructor"]` is truthy
  // through the prototype chain, and a claim of `constructor` should not pass.
  const claimed = Object.hasOwn(ALLOWED_UPLOAD_TYPES, declaredMimeType)
    ? ALLOWED_UPLOAD_TYPES[declaredMimeType]
    : undefined

  if (claimed === undefined) {
    return { ok: false, rejection: "type_not_allowed", sniffed }
  }
  if (claimed !== sniffed) {
    return { ok: false, rejection: "content_mismatch", sniffed }
  }

  return {
    ok: true,
    sniffed,
    filename: sanitiseFilename(filename),
    sizeBytes: bytes.length,
    // The column is CHECK-constrained to `^[0-9a-f]{64}$`.
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
  }
}

// ---------------------------------------------------------------------------
// The write
// ---------------------------------------------------------------------------

/**
 * What happened to an upload.
 *
 * `stored_unaudited` is the state `tasks/W3-F` requires to be modelled rather
 * than assumed away: *"if the file lands but the audit write fails, that is a
 * retryable incomplete state, not a success."* It is neither `stored` nor
 * `failed`, and collapsing it into either loses the only information an operator
 * can act on. The object is named so it can be reconciled or removed, and the
 * document row is left in `pending_review` so nothing downstream treats it as
 * usable.
 */
export type UploadOutcome =
  | {
      status: "stored"
      documentId: string
      storagePath: string
      storedFilename: string
      originalFilename: string
    }
  | {
      status: "stored_unaudited"
      documentId: string | null
      storagePath: string
      storedFilename: string
      originalFilename: string
      auditReason: string
      retryable: true
    }
  | { status: "rejected"; rejection: UploadRejection; sniffed: SniffedType }
  /** No storage configured. The HTTP equivalent is **503**, never 200. */
  | { status: "unavailable"; httpStatus: 503 }
  | { status: "failed"; stage: "object" | "row" }

export interface StoreDocumentInput {
  bytes: Uint8Array
  declaredMimeType: string
  filename: string
  title: string
  category: DocumentCategory
  companyId: string
  actorProfileId: string | null
  unitId?: string | null
}

/**
 * Validate, store the object, write the row, record the event.
 *
 * The order matters and it is the reason `stored_unaudited` can exist at all:
 * the object goes in first, then the metadata row, then the ledger entry. A
 * failure at each step is reported as itself. There is no branch that reports
 * success for a step that did not happen.
 *
 * The row is written with the **caller's** client, so `documents_staff_insert`
 * decides again in Postgres. Only the audit entry uses the service-role client,
 * because `authenticated` holds no INSERT on `audit_events`.
 */
export async function storeDocument(
  input: StoreDocumentInput
): Promise<UploadOutcome> {
  const validation = validateUpload({
    bytes: input.bytes,
    declaredMimeType: input.declaredMimeType,
    filename: input.filename,
  })

  // Validation first, so a refused upload never reaches storage and a caller
  // cannot use this endpoint to probe whether storage exists.
  if (!validation.ok) {
    return {
      status: "rejected",
      rejection: validation.rejection,
      sniffed: validation.sniffed,
    }
  }

  if (!isSupabaseConfigured()) {
    return { status: "unavailable", httpStatus: 503 }
  }

  // Deferred, so the pure half of this module stays loadable outside Next.
  const { createClient } = await import("@/lib/supabase/server")
  const { writeAuditEvent } = await import("@/lib/governance-audit")

  const client = await createClient()
  if (client === null) return { status: "unavailable", httpStatus: 503 }

  const storagePath = storagePathFor({
    companyId: input.companyId,
    category: input.category,
    safeName: validation.filename.safe,
    sniffed: validation.sniffed,
  })

  const upload = await client.storage
    .from(DOCUMENT_BUCKET)
    .upload(storagePath, bytesToBlob(input.bytes, input.declaredMimeType), {
      // Never overwrite. With a uuid in the key a collision means something is
      // badly wrong, and silently replacing somebody else's object is the worst
      // available response to that.
      upsert: false,
      contentType: input.declaredMimeType,
    })

  if (upload.error !== null) return { status: "failed", stage: "object" }

  // Same cast, same reason, as `lib/governance-audit.ts`: no generated
  // `Database` types exist yet, so the untyped client infers `never`. The row
  // object itself is checked by `tsc`.
  const row: DocumentInsertRow = {
    company_id: input.companyId,
    unit_id: input.unitId ?? null,
    title: input.title,
    category: input.category,
    storage_bucket: DOCUMENT_BUCKET,
    storage_path: storagePath,
    original_filename: validation.filename.original,
    mime_type: input.declaredMimeType,
    size_bytes: validation.sizeBytes,
    checksum_sha256: validation.checksumSha256,
    // Both fail-closed. An upload is not visible to a resident and not usable as
    // compliance evidence until a human has reviewed it.
    visibility: "private",
    review_status: "pending_review",
    uploaded_by: input.actorProfileId,
  }

  const inserted = await client
    .from("documents")
    .insert(row as unknown as never)
    .select("id")
    .maybeSingle()

  if (inserted.error !== null) return { status: "failed", stage: "row" }

  const documentId =
    typeof inserted.data === "object" &&
    inserted.data !== null &&
    "id" in inserted.data &&
    typeof inserted.data.id === "string"
      ? inserted.data.id
      : null

  const audit: AuditOutcome = await writeAuditEvent({
    action: "documents.uploaded",
    entityTable: "documents",
    entityId: documentId,
    actorProfileId: input.actorProfileId,
    companyId: input.companyId,
    afterData: {
      storage_path: storagePath,
      size_bytes: validation.sizeBytes,
      checksum_sha256: validation.checksumSha256,
      review_status: "pending_review",
    },
  })

  if (audit.status !== "recorded") {
    return {
      status: "stored_unaudited",
      documentId,
      storagePath,
      storedFilename: validation.filename.safe,
      originalFilename: validation.filename.original,
      auditReason: audit.reason,
      retryable: true,
    }
  }

  return {
    status: "stored",
    documentId: documentId ?? "",
    storagePath,
    storedFilename: validation.filename.safe,
    originalFilename: validation.filename.original,
  }
}

/** Column-for-column against `…0008_documents_compliance.sql` §3. */
interface DocumentInsertRow {
  company_id: string
  unit_id: string | null
  title: string
  category: DocumentCategory
  storage_bucket: typeof DOCUMENT_BUCKET
  storage_path: string
  original_filename: string
  mime_type: string
  size_bytes: number
  checksum_sha256: string
  visibility: "private"
  review_status: "pending_review"
  uploaded_by: string | null
}

/**
 * `Uint8Array` → `Blob`, because `supabase-js` uploads a `Blob` or a `File`.
 *
 * The declared MIME type is used for the blob and is also written to
 * `documents.mime_type`. It has already been proved to agree with the sniffed
 * content, so this is not trusting the claim — it is recording a claim that was
 * checked.
 */
function bytesToBlob(bytes: Uint8Array, mimeType: string): Blob {
  // `Uint8Array` is a valid `BlobPart`; the copy keeps the blob independent of
  // any later reuse of the caller's buffer.
  return new Blob([new Uint8Array(bytes)], { type: mimeType })
}
