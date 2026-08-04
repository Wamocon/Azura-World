import { FileText } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { DocumentRegister } from "@/components/documents/document-detail"
import type { DocumentRow } from "@/components/documents/document-detail"
import { AccessRefusal } from "@/components/governance/access-refusal"
import { DocumentUploadForm } from "@/components/governance/document-upload-form"
import { GovernanceNotice } from "@/components/governance/governance-notice"
import { GovernanceTableFrame } from "@/components/governance/governance-table"
import {
  DashboardPageHeader,
  DashboardSection,
} from "@/components/dashboard/section"
import { EmptyState } from "@/components/ui/empty-state"
import { getUserProfile } from "@/lib/auth"
import type { Locale } from "@/lib/contracts"
import {
  documentCategories,
  documentRetentionClasses,
  documentVisibilities,
} from "@/lib/document-data"
import { getDocuments } from "@/lib/document-repository"
import { DEFAULT_SIGNED_URL_TTL_SECONDS } from "@/lib/document-repository"
import { getProfiles } from "@/lib/governance-repository"
import { DOCUMENT_BUCKET, MAX_UPLOAD_BYTES } from "@/lib/document-storage"
import { isSupabaseConfigured } from "@/lib/env"
import { hasPermission } from "@/lib/rbac"

import { requestSignedUrl, uploadDocument } from "./actions"

/**
 * /[locale]/dashboard/documents — the document register.        Owner: W3-F
 *
 * ## Storage state is stated before the upload form, not after a failed upload
 *
 * W0-A ran `setup:supabase --dry-run` only, so **no bucket exists** in this
 * deployment. A form that looks ready and then answers 503 is technically
 * honest and practically a waste of the user's file. The notice above the form
 * says so first, and the 503 remains the control.
 *
 * ## Review status is shown on every row
 *
 * `pending_review` is the default for every upload and it is not decoration: the
 * RLS resident paths (`documents_select_own_unit`,
 * `documents_select_own_resident`) both require `review_status = 'approved'`, so
 * an unreviewed document is genuinely invisible to the person it is about. A
 * register that showed only a filename would hide the difference between a
 * document that is filed and one that is merely uploaded.
 *
 * ## The rest of the record lives in a popup
 *
 * `getDocuments()` reads twenty-eight columns and the table shows six. The mime
 * type the sniffer settled on, the SHA-256 the upload path computed, the two
 * profile ids and the storage key are the fields an operator needs when a
 * document is disputed, and they are one click away in
 * `components/documents/document-detail.tsx` rather than absent. That component
 * also hosts the only download affordance in the product: the bytes live in a
 * private bucket, so there is nothing to link to until `requestSignedUrl` has
 * actually minted a short-TTL URL.
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
  const t = await getTranslations({ locale, namespace: "dashboard.documents" })
  return {
    title: t("title"),
    robots: { index: false, follow: false },
  }
}

const PAGE_SIZE = 50

export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.documents" })
  // The two generic action names — "Close", "Download" — are the shared ones.
  // Re-declaring them under this namespace would be four more strings to keep in
  // step with the rest of the product for no gain.
  const common = await getTranslations({ locale, namespace: "common" })
  const profile = await getUserProfile()

  const mayView =
    profile.authenticated && hasPermission(profile.role, "documents:view")

  if (!mayView) {
    return (
      <AccessRefusal
        title={t("forbidden.title")}
        message={t("forbidden.message")}
        detailLabel={t("forbidden.permissionLabel")}
        detail="documents:view"
      />
    )
  }

  const mayUpload = hasPermission(profile.role, "documents:create")

  const documents = await getDocuments({
    role: profile.role,
    limit: PAGE_SIZE,
  })

  const storageConfigured = isSupabaseConfigured()

  /**
   * The wire shape for the register island.
   *
   * Flattened to primitives on purpose: `DocumentRecord` carries a
   * `metadata: Record<string, unknown>` whose contents are unaudited, and a rich
   * domain object crossing into a client bundle is how unreviewed data reaches a
   * browser without anyone deciding that it should. Every nullable column stays
   * nullable, so the island renders an explicit stated label rather than a zero
   * or a blank.
   */
  // Who uploaded and who reviewed, by name.
  //
  // The popup stopped rendering `uploaded_by` and `reviewed_by` as uuids, which
  // was right, and then had nothing to put in their place — so every document
  // that names an uploader reported "Not stated", to staff as much as to a
  // tenant. Same shape as the compliance register: read once for the page, only
  // for a reader who may see the directory at all, and let an unresolvable id
  // fall through to a label that says the record names somebody this reader
  // cannot look up. Never back to the uuid.
  const directory = hasPermission(profile.role, "users:view")
    ? await getProfiles({ role: profile.role, isActive: true, limit: 200 })
    : null
  const actorNames = new Map(
    (directory?.data ?? []).map((person) => [
      person.id,
      person.fullName ?? person.email ?? person.id,
    ])
  )

  /**
   * A person, or a stated absence. **Never an id, and never on the wire.**
   *
   * The popup already refused to render a uuid. It could not refuse to receive
   * one: `uploadedBy` and `reviewedBy` were serialised raw into the RSC
   * payload on every row, so a tenant reading their own tenancy agreement got
   * the site manager's `profiles.id` in the flight data — the exact identifier
   * `getProfiles` refuses them the directory to obtain.
   *
   * This page had already learned the rule for `siteId` two fields down: "A
   * field a role must not have is a field the server must not send." Resolving
   * here rather than in the component applies it to the other two.
   */
  const actorLabel = (
    profileId: string | null,
    absent: string
  ): { text: string; resolved: boolean } => {
    if (profileId === null) return { text: absent, resolved: false }
    const name = actorNames.get(profileId)
    return name === undefined
      ? { text: t("detail.actorNotVisible"), resolved: false }
      : { text: name, resolved: true }
  }

  const rows: DocumentRow[] = documents.data.map((document) => ({
    id: document.id,
    title: document.title,
    category: document.category,
    reviewStatus: document.reviewStatus,
    visibility: document.visibility,
    retentionClass: document.retentionClass,
    storageBucket: document.storageBucket,
    storagePath: document.storagePath,
    originalFilename: document.originalFilename,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    checksumSha256: document.checksumSha256,
    uploadedBy: actorLabel(document.uploadedBy, t("detail.notStated")),
    reviewedBy: actorLabel(document.reviewedBy, t("detail.noReviewer")),
    reviewedAt: document.reviewedAt,
    unitId: document.unitId,
    // `siteId` is deliberately absent from the wire, not merely unrendered.
    //
    // The popup stopped painting it, which fixed the display and nothing else:
    // this object is serialised into the RSC payload, so a `tenant` opening
    // view-source still received the uuid on every document. Measured on the
    // running server before this line was removed — 28 uuids in one response.
    // A field a role must not have is a field the server must not send.
    expiresAt: document.expiresAt,
    createdAt: document.createdAt,
  }))

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <DashboardPageHeader title={t("title")} description={t("lead")} />

      {documents.source === "local-seed" ? (
        <GovernanceNotice tone="seed">{t("seedNotice")}</GovernanceNotice>
      ) : null}

      <GovernanceNotice tone="info">
        {t("signedUrlNotice", { seconds: DEFAULT_SIGNED_URL_TTL_SECONDS })}
      </GovernanceNotice>

      {/* One statement of the fact, not three.

          An empty register used to say it in triplicate: the section
          description ("0 documents in your view"), the empty-state title ("No
          documents.") and its body ("There are no documents in your view.").
          A contractor's whole documents page was those three sentences.

          The count belongs above a list; above nothing it is noise, so it is
          omitted when there is nothing to count. And the empty state now says
          what would FILL it — which differs by role, because a manager can put
          a document here and a resident has to wait for one. */}
      <DashboardSection
        title={t("register")}
        {...(documents.data.length === 0
          ? {}
          : {
              description: t("registerLead", { count: documents.data.length }),
            })}
      >
        {documents.data.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={t("empty")}
            description={
              mayUpload ? t("emptyLeadUploader") : t("emptyLeadReader")
            }
          />
        ) : (
          <GovernanceTableFrame>
            <DocumentRegister
              rows={rows}
              locale={locale}
              action={requestSignedUrl}
              // `local-seed` is the one state in which a signed URL is
              // impossible by construction rather than by circumstance:
              // `getSignedDocumentUrl`'s fallback is `() => null`. The island
              // disables the control there instead of asking a question whose
              // answer is already in the code.
              storageSource={
                documents.source === "supabase" ? "supabase" : "local-seed"
              }
              labels={{
                caption: t("registerCaption"),
                hint: t("detail.hint"),
                // Carries `{title}`, which the island substitutes per row, so it
                // must be read raw rather than through `t()`.
                rowAction: t.raw("detail.rowAction") as string,
                detailLead: t("detail.lead"),
                close: common("actions.close"),
                columns: {
                  name: t("columns.name"),
                  category: t("columns.category"),
                  review: t("columns.review"),
                  size: t("columns.size"),
                  expires: t("columns.expires"),
                  uploadedAt: t("columns.uploadedAt"),
                },
                categories: Object.fromEntries(
                  documentCategories.map((category) => [
                    category,
                    t(`categories.${category}`),
                  ])
                ),
                review: Object.fromEntries(
                  (["pending_review", "approved", "rejected"] as const).map(
                    (status) => [status, t(`review.${status}`)]
                  )
                ),
                visibility: Object.fromEntries(
                  documentVisibilities.map((value) => [
                    value,
                    t(`detail.visibility.${value}`),
                  ])
                ),
                retention: Object.fromEntries(
                  documentRetentionClasses.map((value) => [
                    value,
                    t(`detail.retention.${value}`),
                  ])
                ),
                fields: {
                  documentId: t("detail.fields.documentId"),
                  mimeType: t("detail.fields.mimeType"),
                  checksum: t("detail.fields.checksum"),
                  storagePath: t("detail.fields.storagePath"),
                  bucket: t("detail.fields.bucket"),
                  uploadedBy: t("detail.fields.uploadedBy"),
                  reviewedBy: t("detail.fields.reviewedBy"),
                  reviewedAt: t("detail.fields.reviewedAt"),
                  retention: t("detail.fields.retention"),
                  unit: t("detail.fields.unit"),
                  actorNotVisible: t("detail.fields.actorNotVisible"),
                  storagePathWithheld: t("detail.fields.storagePathWithheld"),
                  site: t("detail.fields.site"),
                },
                notStated: t("detail.notStated"),
                noReviewer: t("detail.noReviewer"),
                noExpiry: t("noExpiry"),
                sizeUnknown: t("sizeUnknown"),
                fileSection: t("detail.fileSection"),
                download: {
                  hint: t("detail.download.hint"),
                  request: t("detail.download.request"),
                  requesting: t("detail.download.requesting"),
                  ready: t("detail.download.ready"),
                  open: common("actions.download"),
                  // Carries `{time}`, substituted in the island.
                  expires: t.raw("detail.download.expires") as string,
                  expired: t("detail.download.expired"),
                  forbidden: t("detail.download.forbidden"),
                  invalid: t("detail.download.invalid"),
                  failed: t("detail.download.failed"),
                  seed: t("detail.download.seed"),
                },
              }}
            />
          </GovernanceTableFrame>
        )}
      </DashboardSection>

      {mayUpload ? (
        <DashboardSection title={t("upload")} description={t("uploadLead")}>
          {storageConfigured ? null : (
            <GovernanceNotice tone="warning">
              {t("storageNotConfigured")}
            </GovernanceNotice>
          )}

          <DocumentUploadForm
            action={uploadDocument}
            locale={locale}
            categories={documentCategories}
            labels={{
              title: t("columns.name"),
              category: t("columns.category"),
              file: t("fileLabel"),
              fileHint: t("fileHint", {
                megabytes: Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024)),
                bucket: DOCUMENT_BUCKET,
              }),
              submit: t("upload"),
              submitting: t("uploading"),
              resultHeading: t("resultHeading"),
              storedAs: t("storedAs"),
              forbidden: t("forbidden.message"),
              categories: Object.fromEntries(
                documentCategories.map((category) => [
                  category,
                  t(`categories.${category}`),
                ])
              ),
            }}
          />
        </DashboardSection>
      ) : (
        <GovernanceNotice tone="info">{t("readOnlyNotice")}</GovernanceNotice>
      )}
    </div>
  )
}
