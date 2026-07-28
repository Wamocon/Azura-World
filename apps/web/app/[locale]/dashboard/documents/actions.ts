"use server"

import { getTranslations } from "next-intl/server"
import { z } from "zod"

import { getUserProfile } from "@/lib/auth"
import { locales, type Locale } from "@/lib/contracts"
import { documentCategories } from "@/lib/document-data"
import {
  MAX_UPLOAD_BYTES,
  storeDocument,
  type UploadOutcome,
} from "@/lib/document-storage"
import { getSignedDocumentUrl } from "@/lib/document-repository"
import { hasPermission } from "@/lib/rbac"

/**
 * Uploading a document, and re-minting an expired link.         Owner: W3-F
 *
 * ## The order
 *
 *   1. authenticate
 *   2. authorise (`documents:create`)
 *   3. validate the *form*
 *   4. bound the size **before reading the file into memory**
 *   5. hand the bytes to `lib/document-storage.ts`, which sniffs and decides
 *
 * Step 4 is not a duplicate of the ceiling inside `validateUpload`. That one
 * checks the real byte length and is the control; this one refuses on the
 * declared `File.size` first so a 2 GB upload is rejected without being
 * buffered. A ceiling that only applies after the allocation is a ceiling that
 * can be used to exhaust the process.
 *
 * ## No storage, no success
 *
 * `storeDocument` answers `unavailable` with `httpStatus: 503` when Supabase is
 * unconfigured, and this action passes that straight through. It never reports a
 * stored document that is not stored.
 */

export type DocumentUploadState =
  | { status: "idle" }
  | { status: "forbidden" }
  | { status: "invalid"; message: string }
  /** Refused by content sniffing or the size ceiling. */
  | { status: "rejected"; message: string; sniffed: string }
  /** 503. No storage configured. */
  | { status: "unavailable"; httpStatus: 503; message: string }
  /** Stored **and** recorded. */
  | { status: "stored"; message: string; storedFilename: string }
  /**
   * Stored, not recorded. Retryable, and deliberately not `stored`:
   * `tasks/W3-F` requires this to be surfaced as incomplete.
   */
  | {
      status: "incomplete"
      message: string
      storagePath: string
      storedFilename: string
    }
  | { status: "failed"; message: string }

const uploadSchema = z.strictObject({
  locale: z.enum(locales),
  title: z
    .string()
    .trim()
    .min(1, "A title is required.")
    // `documents.title` is CHECK-constrained to 1..200 characters.
    .max(200, "A title must be 200 characters or fewer."),
  category: z.enum(documentCategories),
})

async function message(locale: Locale, key: string): Promise<string> {
  const t = await getTranslations({ locale, namespace: "dashboard.documents" })
  return t(key)
}

export async function uploadDocument(
  _previous: DocumentUploadState,
  formData: FormData
): Promise<DocumentUploadState> {
  const profile = await getUserProfile()

  // Authorise first. A caller who may not upload must not learn the field names
  // by watching which ones the validator complains about.
  if (
    !profile.authenticated ||
    !hasPermission(profile.role, "documents:create")
  ) {
    return { status: "forbidden" }
  }

  const parsed = uploadSchema.safeParse({
    locale: formData.get("locale"),
    title: formData.get("title"),
    category: formData.get("category"),
  })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      status: "invalid",
      message: issue?.message ?? "That request is not valid.",
    }
  }

  const { locale, title, category } = parsed.data
  const file = formData.get("file")

  if (!(file instanceof File) || file.size === 0) {
    return { status: "invalid", message: await message(locale, "noFile") }
  }

  // Before the allocation, on the declared size.
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      status: "rejected",
      message: await message(locale, "rejection.too_large"),
      sniffed: "unknown",
    }
  }

  const bytes = new Uint8Array(await file.arrayBuffer())

  const outcome: UploadOutcome = await storeDocument({
    bytes,
    // The browser's claim. `validateUpload` proves it against the bytes; it is
    // never trusted on its own.
    declaredMimeType: file.type,
    filename: file.name,
    title,
    category,
    companyId: profile.companyId ?? "",
    actorProfileId: profile.id,
  })

  switch (outcome.status) {
    case "rejected":
      return {
        status: "rejected",
        message: await message(locale, `rejection.${outcome.rejection}`),
        sniffed: outcome.sniffed,
      }

    case "unavailable":
      return {
        status: "unavailable",
        httpStatus: 503,
        message: await message(locale, "storageUnavailable"),
      }

    case "failed":
      return {
        status: "failed",
        message: await message(locale, `failed.${outcome.stage}`),
      }

    case "stored_unaudited": {
      const t = await getTranslations({
        locale,
        namespace: "dashboard.documents",
      })
      const admin = await getTranslations({
        locale,
        namespace: "dashboard.admin",
      })
      return {
        status: "incomplete",
        // Both halves, in one sentence: the file is there, the record of it is
        // not, and it can be retried.
        message: `${t("storedUnaudited")} ${admin(`auditReason.${outcome.auditReason}`)}`,
        storagePath: outcome.storagePath,
        storedFilename: outcome.storedFilename,
      }
    }

    case "stored":
      return {
        status: "stored",
        message: await message(locale, "stored"),
        storedFilename: outcome.storedFilename,
      }
  }
}

// ---------------------------------------------------------------------------
// Signed URLs
// ---------------------------------------------------------------------------

export type SignedUrlState =
  | { status: "idle" }
  | { status: "forbidden" }
  | { status: "invalid" }
  | { status: "unavailable"; message: string }
  | { status: "issued"; url: string; expiresAt: string; ttlSeconds: number }

const signedUrlSchema = z.strictObject({
  locale: z.enum(locales),
  documentId: z.string().trim().uuid(),
})

/**
 * Mint a fresh signed URL for a document.
 *
 * This is the **re-request path** the brief's expired-URL edge case asks for. A
 * signed URL has a 60 second TTL by default, so a link that sat in a tab is
 * expected to expire; the answer is a button that asks for another one, not a
 * longer TTL and not a broken image.
 *
 * The URL is returned to the caller and goes nowhere else. It carries an access
 * token in its query string, so it is never logged, never persisted, never put
 * in an audit payload and never cached. The **request** is audited; the URL is
 * not in the payload.
 */
export async function requestSignedUrl(
  _previous: SignedUrlState,
  formData: FormData
): Promise<SignedUrlState> {
  const profile = await getUserProfile()

  if (
    !profile.authenticated ||
    !hasPermission(profile.role, "documents:view")
  ) {
    return { status: "forbidden" }
  }

  const parsed = signedUrlSchema.safeParse({
    locale: formData.get("locale"),
    documentId: formData.get("documentId"),
  })
  if (!parsed.success) return { status: "invalid" }

  // Read through the caller's client, so RLS decides whether a URL may be minted
  // at all: a caller who cannot read the metadata cannot obtain the bytes.
  const result = await getSignedDocumentUrl(parsed.data.documentId)

  if (result.data === null) {
    return {
      status: "unavailable",
      message: await message(parsed.data.locale, "signedUrlUnavailable"),
    }
  }

  return {
    status: "issued",
    url: result.data.url,
    expiresAt: result.data.expiresAt,
    ttlSeconds: result.data.ttlSeconds,
  }
}
