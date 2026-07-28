import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { AccessRefusal } from "@/components/governance/access-refusal"
import { DocumentUploadForm } from "@/components/governance/document-upload-form"
import { GovernanceNotice } from "@/components/governance/governance-notice"
import { GovernanceTableFrame } from "@/components/governance/governance-table"
import {
  DashboardPageHeader,
  DashboardSection,
} from "@/components/dashboard/section"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getUserProfile } from "@/lib/auth"
import type { Locale } from "@/lib/contracts"
import { documentCategories } from "@/lib/document-data"
import { getDocuments } from "@/lib/document-repository"
import { DEFAULT_SIGNED_URL_TTL_SECONDS } from "@/lib/document-repository"
import { DOCUMENT_BUCKET, MAX_UPLOAD_BYTES } from "@/lib/document-storage"
import { isSupabaseConfigured } from "@/lib/env"
import { formatDate } from "@/lib/format"
import { hasPermission } from "@/lib/rbac"

import { uploadDocument } from "./actions"

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
 */

export const metadata: Metadata = {
  title: "Dokumente",
  robots: { index: false, follow: false },
}

const PAGE_SIZE = 50

export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.documents" })
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

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <DashboardPageHeader title={t("title")} description={t("lead")} />

      {documents.source === "local-seed" ? (
        <GovernanceNotice tone="seed">{t("seedNotice")}</GovernanceNotice>
      ) : null}

      <GovernanceNotice tone="info">
        {t("signedUrlNotice", { seconds: DEFAULT_SIGNED_URL_TTL_SECONDS })}
      </GovernanceNotice>

      <DashboardSection
        title={t("register")}
        description={t("registerLead", { count: documents.data.length })}
      >
        {documents.data.length === 0 ? (
          <EmptyState title={t("empty")} description={t("emptyLead")} />
        ) : (
          <GovernanceTableFrame>
            <Table>
              <TableCaption>{t("registerCaption")}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.name")}</TableHead>
                  <TableHead>{t("columns.category")}</TableHead>
                  <TableHead>{t("columns.review")}</TableHead>
                  <TableHead>{t("columns.size")}</TableHead>
                  <TableHead>{t("columns.expires")}</TableHead>
                  <TableHead>{t("columns.uploadedAt")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.data.map((document) => (
                  <TableRow key={document.id}>
                    <TableCell className="font-medium">
                      {document.title}
                      {/* The name the user sent, kept only as display metadata.
                          The storage key is a sanitised ASCII name under a
                          uuid, so the two genuinely differ. */}
                      {document.originalFilename === null ? null : (
                        <span className="block font-mono text-xs text-muted-foreground">
                          {document.originalFilename}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="muted">
                        {t(`categories.${document.category}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          document.reviewStatus === "approved"
                            ? "confirmed"
                            : document.reviewStatus === "rejected"
                              ? "destructive"
                              : "single"
                        }
                      >
                        {t(`review.${document.reviewStatus}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {/* A null size is "never measured", not zero. Rendering it
                          as 0 would be the gap-as-zero failure the whole product
                          exists to avoid. */}
                      {document.sizeBytes === null
                        ? t("sizeUnknown")
                        : `${Math.ceil(document.sizeBytes / 1024)} kB`}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {document.expiresAt === null
                        ? t("noExpiry")
                        : formatDate(document.expiresAt, locale)}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {formatDate(document.createdAt, locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
