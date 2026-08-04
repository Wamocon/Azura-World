"use client"

import { FileDown, ShieldAlert } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"

import type { SignedUrlState } from "@/app/[locale]/dashboard/documents/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/cn"
import type { Locale } from "@/lib/contracts"
import { formatDate, formatDateTime, formatNumber } from "@/lib/format"

/**
 * The document register, with the full record behind each row.
 *
 * The table used to show six of a document's twenty-eight columns and there was
 * nowhere to see the rest: the mime type the sniffer decided on, the SHA-256 the
 * upload path computed, who uploaded it, who reviewed it, and the storage key the
 * bytes actually live under. Those are exactly the fields an operator needs when a
 * document is disputed, so the row is now a real `<button>` that opens the whole
 * record in one controlled Dialog.
 *
 * ## The download control is a REQUEST, and it says so
 *
 * `documents.storage_bucket` is CHECK-pinned to two **private** buckets, so there
 * is no URL to render — the bytes are reachable only through a short-TTL signed
 * URL minted by `requestSignedUrl`. This component therefore never renders a
 * "Download" link that points at anything until a link has actually been issued.
 * The control asks; the answer is either a real link or a stated reason there is
 * none.
 *
 * Three honesty rules are structural here rather than conventional:
 *
 * 1. **A rejected request can never crash the page.** `requestSignedUrl` reaches
 *    `getSignedDocumentUrl`, which reaches `withRepository` — and a *configured*
 *    Supabase that fails **throws** by design (`lib/repository-base.ts` rule 2).
 *    That is the live state of this deployment. `DOCUMENT_STORAGE_MODE=supabase`
 *    and the two buckets now exist and are private — but they hold **zero
 *    objects**, because nothing in this product has ever uploaded one. Measured
 *    rather than assumed: `createSignedUrl("does/not/exist.pdf")` against
 *    `azura-documents` answers `Object not found`, so the action still rejects.
 *    Creating the buckets moved the failure from `NoSuchBucket` to `NoSuchKey`
 *    and changed nothing a reader experiences; a document row still points at a
 *    file that is not there. Driving that through `useActionState` would re-throw
 *    the rejection into the nearest error boundary and take the whole register
 *    down.
 *    So the action is called imperatively inside a `try`/`catch` and a rejection
 *    becomes the named `failed` state below.
 *
 * 2. **A failure disables the control and explains itself.** After `failed`,
 *    `unavailable` or `forbidden` the button is disabled with the reason beside
 *    it, so the affordance stops inviting a press that cannot succeed. Only
 *    `expired` re-enables it — which is the re-request path the 60 second TTL
 *    exists for.
 *
 * 3. **An expired link is removed, not left lying there.** The issued URL is
 *    dropped from state the moment its own `expiresAt` passes, because a link
 *    that has quietly expired is a broken download wearing a working label. An
 *    `expiresAt` that will not parse is treated as already expired — fail closed,
 *    never show a link this component cannot bound.
 *
 * What it deliberately does not do: it never logs, persists or displays the
 * signed URL as text. The URL carries an access token in its query string
 * (`lib/document-repository.ts`), so it exists only as an `href` on one anchor
 * for the length of its TTL.
 *
 * ## Who is actually reading this popup
 *
 * `documents:view` is held by `owner`, `tenant`, `guest` and
 * `service_provider`, not only by internal staff. That is the fact the record
 * block was written without, and three fields were wrong because of it.
 *
 * 1. **`uploadedBy` and `reviewedBy` were profile uuids under "Uploaded by" and
 *    "Reviewed by".** The old comment defended them — `getDocuments()` never
 *    joins `profiles`, so a name here would be an invention — and it was right
 *    about the invention and wrong about the conclusion. The compliance popup
 *    hit the same wall and answered it properly: the page resolves the ids
 *    through `getProfiles`, which refuses a caller who may not read the
 *    directory, and an unresolvable id falls back to a stated gap rather than
 *    to the uuid. This component now takes the same resolved names through
 *    `actorNames` and **never renders the id**. Until the register supplies the
 *    map the two fields read as a stated gap, which is true — the name is not
 *    something this record states — and it is the correct default, because a
 *    tenant cannot obtain a staff `profiles.id` by any other route.
 * 2. **`storagePath` was printed whole.** `storagePathFor` builds
 *    `company/<companyId>/<category>/<uuid>-<name>.<ext>`, so the second
 *    segment is the tenancy uuid every RLS policy in the schema partitions on,
 *    and it was being handed to guests. The segment is elided; the rest of the
 *    key stays, because reconciling a disputed object is what the block is for
 *    and the category, object id and filename are what locate it.
 * 3. **`siteId` was a uuid under "Site".** It named a row this component never
 *    reads, so it could not be recognised by anybody, and it is gone.
 *
 * The document's own id stays, in the reference block, in full: it already
 * crosses to the browser as `DownloadControl`'s argument — the signed-URL
 * request is keyed by it — so printing it discloses nothing that withholding it
 * would prevent, and it is the reference a support conversation runs on.
 */

// ---------------------------------------------------------------------------
// Wire shape
// ---------------------------------------------------------------------------

/**
 * One document, flattened to primitives.
 *
 * Every nullable column stays nullable. `sizeBytes: null` means the size was
 * never recorded and renders as a stated label, never as 0 — a zero-byte
 * document and an unmeasured one are different facts.
 */
export interface DocumentRow {
  id: string
  title: string
  category: string
  reviewStatus: string
  visibility: string
  retentionClass: string
  storageBucket: string
  storagePath: string
  originalFilename: string | null
  mimeType: string | null
  sizeBytes: number | null
  checksumSha256: string | null
  /**
   * The uploader **as a label**, resolved server-side. Never an id: this used
   * to be a `profiles.id` that the component refused to render and still
   * received, which put staff uuids in the RSC payload of every resident's
   * documents page. `resolved` is false when the reader may not look the
   * person up, which is what greys the value.
   */
  uploadedBy: { text: string; resolved: boolean }
  /** The reviewer, same shape and same reason. */
  reviewedBy: { text: string; resolved: boolean }
  reviewedAt: string | null
  /** `AZW-B01-0003` — the building's own designation, not a uuid. */
  unitId: string | null
  // `siteId` is GONE, not merely unrendered. It was kept here "for the owning
  // page's row literal", and the cost of that convenience was that the page
  // kept sending it: this object is serialised into the RSC payload, so a
  // tenant reading view-source still received the uuid on every document long
  // after the popup stopped painting it. A field a role must not have is a
  // field the server must not send, which makes the type the right place to
  // remove it.
  expiresAt: string | null
  createdAt: string
}

export interface DocumentRegisterLabels {
  caption: string
  hint: string
  /** Template with `{title}`. Substituted here, so the page must use `t.raw`. */
  rowAction: string
  detailLead: string
  close: string
  columns: {
    name: string
    category: string
    review: string
    size: string
    expires: string
    uploadedAt: string
  }
  categories: Record<string, string>
  review: Record<string, string>
  visibility: Record<string, string>
  retention: Record<string, string>
  fields: {
    documentId: string
    mimeType: string
    checksum: string
    storagePath: string
    bucket: string
    uploadedBy: string
    reviewedBy: string
    reviewedAt: string
    retention: string
    unit: string
    /**
     * The document names a person and this reader may not look them up.
     *
     * Distinct from `notStated`, which means the record names nobody. The
     * component can tell the two apart — `profileId === null` versus a miss in
     * `actorNames` — and so must the reader, or the popup reports an absence
     * that is not there.
     */
    actorNotVisible: string
    /**
     * The object key exists and is withheld from this role, as opposed to a
     * document that has none. Rendered instead of the empty string the
     * repository substitutes, which printed as a blank cell.
     */
    storagePathWithheld: string
    /** Retained for the owning page's object literal; nothing renders it. */
    site: string
  }
  /** The explicit stated label for every absent value. Never blank, never 0. */
  notStated: string
  noReviewer: string
  noExpiry: string
  sizeUnknown: string
  fileSection: string
  download: DownloadLabels
}

export interface DownloadLabels {
  hint: string
  request: string
  requesting: string
  ready: string
  /** The anchor's own label, e.g. `common.actions.download`. */
  open: string
  /** Template with `{time}`. Substituted here, so the page must use `t.raw`. */
  expires: string
  expired: string
  forbidden: string
  invalid: string
  failed: string
  seed: string
}

export type SignedUrlAction = (
  previous: SignedUrlState,
  formData: FormData
) => Promise<SignedUrlState>

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

const REVIEW_VARIANT: Readonly<
  Record<string, "confirmed" | "destructive" | "single">
> = Object.freeze({
  approved: "confirmed",
  rejected: "destructive",
  pending_review: "single",
})

export function DocumentRegister({
  rows,
  labels,
  locale,
  action,
  storageSource,
}: {
  rows: readonly DocumentRow[]
  labels: DocumentRegisterLabels
  locale: Locale
  action: SignedUrlAction
  /**
   * Where the rows came from. In `local-seed` there is no storage behind them at
   * all — `getSignedDocumentUrl`'s fallback is literally `() => null` — so the
   * download control is disabled up front rather than asking a question whose
   * answer is already known.
   */
  storageSource: "supabase" | "local-seed"
}): ReactNode {
  const [selected, setSelected] = useState<DocumentRow | null>(null)

  const sizeText = (bytes: number | null): string =>
    bytes === null
      ? labels.sizeUnknown
      : `${formatNumber(Math.ceil(bytes / 1024), locale)} kB`

  /*
   * `actorText` lived here and is gone. It resolved a `profiles.id` against an
   * `actorNames` map, both of which the server had to send for it to work — so
   * a component that correctly refused to RENDER a uuid still received one on
   * every row, for every reader, in the RSC payload. A tenant opening their own
   * tenancy agreement got the site manager's profile id in the flight data.
   *
   * Resolution moved to the page, which is where the directory permission is
   * checked anyway. `uploadedBy` and `reviewedBy` now arrive as
   * `{ text, resolved }` and there is no id on the wire to leak.
   */

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Table>
        <TableCaption>{labels.caption}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{labels.columns.name}</TableHead>
            <TableHead>{labels.columns.category}</TableHead>
            <TableHead>{labels.columns.review}</TableHead>
            <TableHead>{labels.columns.size}</TableHead>
            <TableHead>{labels.columns.expires}</TableHead>
            <TableHead>{labels.columns.uploadedAt}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} data-testid="document-row">
              <TableCell className="font-medium">
                {/* A real button, not a row with an onClick: a div handler is
                    reachable by neither the keyboard nor a screen reader. */}
                <button
                  type="button"
                  onClick={() => setSelected(row)}
                  aria-label={labels.rowAction.replace("{title}", row.title)}
                  className={cn(
                    "flex min-w-0 flex-col items-start gap-0.5 rounded-sm text-start",
                    "transition-colors duration-[var(--duration-instant)] hover:text-primary",
                    "outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  )}
                >
                  <span className="min-w-0">{row.title}</span>
                  {/* The name the user sent, kept only as display metadata.
                      The storage key is a sanitised ASCII name under a uuid,
                      so the two genuinely differ. */}
                  {row.originalFilename === null ? null : (
                    <span className="block font-mono text-xs text-muted-foreground">
                      {row.originalFilename}
                    </span>
                  )}
                </button>
              </TableCell>
              <TableCell>
                <Badge variant="muted">
                  {labels.categories[row.category] ?? row.category}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant={REVIEW_VARIANT[row.reviewStatus] ?? "single"}>
                  {labels.review[row.reviewStatus] ?? row.reviewStatus}
                </Badge>
              </TableCell>
              <TableCell numeric className="text-muted-foreground">
                {sizeText(row.sizeBytes)}
              </TableCell>
              <TableCell numeric className="text-muted-foreground">
                {row.expiresAt === null
                  ? labels.noExpiry
                  : formatDate(row.expiresAt, locale)}
              </TableCell>
              <TableCell numeric className="text-muted-foreground">
                {formatDate(row.createdAt, locale)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <p className="px-3 pb-1 text-xs text-muted-foreground sm:px-4">
        {labels.hint}
      </p>

      {/* One controlled Dialog for the whole table, rendered outside the loop. */}
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        {selected !== null ? (
          <DialogContent closeLabel={labels.close}>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="azura-label text-muted-foreground">
                {labels.detailLead}
              </span>
              <DialogTitle>{selected.title}</DialogTitle>
              {selected.originalFilename === null ? null : (
                <DialogDescription className="font-mono text-xs break-all">
                  {selected.originalFilename}
                </DialogDescription>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="muted">
                {labels.categories[selected.category] ?? selected.category}
              </Badge>
              <Badge
                variant={REVIEW_VARIANT[selected.reviewStatus] ?? "single"}
              >
                {labels.review[selected.reviewStatus] ?? selected.reviewStatus}
              </Badge>
              <Badge variant="outline">
                {labels.visibility[selected.visibility] ?? selected.visibility}
              </Badge>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Field
                label={labels.columns.size}
                value={sizeText(selected.sizeBytes)}
                muted={selected.sizeBytes === null}
              />
              <Field
                label={labels.columns.uploadedAt}
                value={formatDate(selected.createdAt, locale)}
              />
              <Field
                label={labels.columns.expires}
                value={
                  selected.expiresAt === null
                    ? labels.noExpiry
                    : formatDate(selected.expiresAt, locale)
                }
                muted={selected.expiresAt === null}
              />
              <Field
                label={labels.fields.retention}
                value={
                  labels.retention[selected.retentionClass] ??
                  selected.retentionClass
                }
              />
              {/* `AZW-B01-0003`, a designation the reader can recognise —
                  which is exactly why it is here and `siteId` is not. */}
              <Field
                label={labels.fields.unit}
                value={selected.unitId ?? labels.notStated}
                muted={selected.unitId === null}
              />
              {/* People, resolved by the page. Not `mono`: a name is prose, and
                  the monospace was only ever there to make a uuid legible. */}
              <Field
                label={labels.fields.uploadedBy}
                value={selected.uploadedBy.text}
                muted={!selected.uploadedBy.resolved}
              />
              <Field
                label={labels.fields.reviewedBy}
                value={selected.reviewedBy.text}
                muted={!selected.reviewedBy.resolved}
              />
              <Field
                label={labels.fields.reviewedAt}
                value={
                  selected.reviewedAt === null
                    ? labels.noReviewer
                    : formatDateTime(selected.reviewedAt, locale)
                }
                muted={selected.reviewedAt === null}
              />
              <Field
                label={labels.fields.mimeType}
                value={selected.mimeType ?? labels.notStated}
                muted={selected.mimeType === null}
                mono
              />
            </dl>

            {/* The storage facts are wide strings, so they sit outside the
                two-column grid rather than truncating inside it. The path is
                rendered as TEXT and never as an href: both buckets are private
                and no URL may be constructed from a storage key
                (`lib/document-repository.ts`). It is here because it is the key
                an operator reconciles a disputed object by — minus the tenancy
                segment, which no reader reconciles anything by. */}
            <section className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-3">
              <h3 className="azura-label text-muted-foreground">
                {labels.fileSection}
              </h3>

              <dl className="flex min-w-0 flex-col gap-2.5 text-sm">
                <WideField
                  label={labels.fields.bucket}
                  value={selected.storageBucket}
                />
                {/* The repository substitutes an empty string when it withholds
                    the object key from a non-internal role. Rendered raw, that
                    printed a blank cell — which reads as "this document has no
                    key" rather than "you may not see it", and is the worse of
                    the two failures the narrowing was meant to fix. */}
                <WideField
                  label={labels.fields.storagePath}
                  value={
                    selected.storagePath === ""
                      ? labels.fields.storagePathWithheld
                      : withoutTenancySegment(selected.storagePath)
                  }
                  muted={selected.storagePath === ""}
                />
                <WideField
                  label={labels.fields.checksum}
                  value={selected.checksumSha256 ?? labels.notStated}
                  muted={selected.checksumSha256 === null}
                />
                <WideField
                  label={labels.fields.documentId}
                  value={selected.id}
                />
              </dl>

              {/* Keyed by document id so a URL minted for one document can never
                  survive into another's popup. */}
              <DownloadControl
                key={selected.id}
                documentId={selected.id}
                locale={locale}
                action={action}
                labels={labels.download}
                storageSource={storageSource}
              />
            </section>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The download control
// ---------------------------------------------------------------------------

/**
 * What we know about this document's bytes right now.
 *
 * `failed` is the rejected-server-action case and is deliberately its own state
 * rather than being folded into `unavailable`: `unavailable` is a typed answer
 * from the action ("there is no object behind this row"), while `failed` means
 * the request did not complete at all. Collapsing them would report a definite
 * absence we did not establish.
 */
type DownloadState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "issued"; url: string; expiresAt: string }
  | { kind: "expired" }
  | { kind: "unavailable"; message: string }
  | { kind: "forbidden" }
  | { kind: "invalid" }
  | { kind: "failed" }

/** The states in which pressing again cannot help. */
function isTerminal(state: DownloadState): boolean {
  return (
    state.kind === "unavailable" ||
    state.kind === "forbidden" ||
    state.kind === "invalid" ||
    state.kind === "failed"
  )
}

function DownloadControl({
  documentId,
  locale,
  action,
  labels,
  storageSource,
}: {
  documentId: string
  locale: Locale
  action: SignedUrlAction
  labels: DownloadLabels
  storageSource: "supabase" | "local-seed"
}): ReactNode {
  const [state, setState] = useState<DownloadState>({ kind: "idle" })

  // A link is dropped the instant its own TTL runs out. Without this the popup
  // would keep offering an anchor that answers 400 — a broken download wearing
  // a working label, which is the exact failure this product exists to avoid.
  useEffect(() => {
    if (state.kind !== "issued") return
    const expiresMs = Date.parse(state.expiresAt)
    const remaining = Number.isFinite(expiresMs)
      ? Math.max(0, expiresMs - Date.now())
      : 0
    const timer = window.setTimeout(
      () => setState({ kind: "expired" }),
      remaining
    )
    return () => window.clearTimeout(timer)
  }, [state])

  // In seed mode the answer is known without asking, so nothing is asked.
  if (storageSource === "local-seed") {
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <Button type="button" variant="outline" size="sm" disabled>
          <FileDown aria-hidden="true" />
          {labels.request}
        </Button>
        <Explanation tone="warning">{labels.seed}</Explanation>
      </div>
    )
  }

  const request = async (): Promise<void> => {
    setState({ kind: "pending" })

    const formData = new FormData()
    formData.append("locale", locale)
    formData.append("documentId", documentId)

    try {
      const result = await action({ status: "idle" }, formData)
      switch (result.status) {
        case "issued":
          setState({
            kind: "issued",
            url: result.url,
            expiresAt: result.expiresAt,
          })
          return
        case "unavailable":
          setState({ kind: "unavailable", message: result.message })
          return
        case "forbidden":
          setState({ kind: "forbidden" })
          return
        case "invalid":
          setState({ kind: "invalid" })
          return
        case "idle":
          // The action never returns `idle`; treating it as an answer would be
          // reporting a result nobody produced.
          setState({ kind: "failed" })
          return
      }
    } catch {
      // The action rejected. `withRepository` throws rather than falling back
      // when Supabase is configured and the call fails, and a missing storage
      // bucket is exactly that. The error text is generic in production and is
      // not shown: what the reader needs is that no link exists and no file was
      // fetched, which is what `labels.failed` says.
      setState({ kind: "failed" })
    }
  }

  const disabled = state.kind === "pending" || isTerminal(state)

  return (
    <div
      className="flex min-w-0 flex-col gap-2"
      data-testid="document-download"
      data-state={state.kind}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => {
            void request()
          }}
        >
          <FileDown aria-hidden="true" />
          {state.kind === "pending" ? labels.requesting : labels.request}
        </Button>

        {/* The only anchor in this component, and it exists only while a real
            signed URL does. `target="_blank"` keeps the register and this popup
            open behind it; the URL is never rendered as text. */}
        {state.kind === "issued" ? (
          <a
            href={state.url}
            download
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold",
              "text-primary underline underline-offset-4",
              "outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          >
            <FileDown className="size-4" aria-hidden="true" />
            {labels.open}
          </a>
        ) : null}
      </div>

      {state.kind === "idle" || state.kind === "pending" ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {labels.hint}
        </p>
      ) : null}

      {state.kind === "issued" ? (
        <p role="status" className="text-xs text-muted-foreground">
          {labels.ready}{" "}
          <span className="tabular-nums">
            {labels.expires.replace(
              "{time}",
              formatDateTime(state.expiresAt, locale)
            )}
          </span>
        </p>
      ) : null}

      {state.kind === "expired" ? (
        <Explanation tone="warning">{labels.expired}</Explanation>
      ) : null}

      {state.kind === "unavailable" ? (
        <Explanation tone="warning">{state.message}</Explanation>
      ) : null}

      {state.kind === "forbidden" ? (
        <Explanation tone="error">{labels.forbidden}</Explanation>
      ) : null}

      {state.kind === "invalid" ? (
        <Explanation tone="error">{labels.invalid}</Explanation>
      ) : null}

      {state.kind === "failed" ? (
        <Explanation tone="error">{labels.failed}</Explanation>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/**
 * The storage key with the company uuid taken out of it.
 *
 * `storagePathFor` writes `company/<companyId>/<category>/<uuid>-<name>.<ext>`,
 * and that second segment is the value every RLS policy in the schema
 * partitions on. This popup is reachable by `owner`, `tenant`, `guest` and
 * `service_provider`, so printing it handed the tenancy key to people whose
 * whole containment is that they cannot see across it.
 *
 * The segment is replaced rather than dropped, so the key is visibly redacted
 * instead of quietly wrong — an operator copying `company/…/legal/9f3c…pdf` can
 * see that one part was withheld, which is the difference between a redaction
 * and a broken value. Everything that locates the object within the company
 * prefix survives.
 *
 * Any other shape is left alone: this rewrites the one format we write, and
 * inventing structure for a path we did not produce would be guessing. Within
 * that shape it redacts unconditionally rather than only when the segment looks
 * like a uuid — so the local seed, whose second segment is the literal `azura`,
 * loses a harmless word. That is the right way round: a tenancy key that were
 * ever written in some other shape would still be covered.
 */
function withoutTenancySegment(path: string): string {
  const segments = path.split("/")
  if (segments.length < 2 || segments[0] !== "company") return path
  return [segments[0], "…", ...segments.slice(2)].join("/")
}

function Explanation({
  tone,
  children,
}: {
  tone: "warning" | "error"
  children: ReactNode
}): ReactNode {
  return (
    <p
      role="status"
      className={cn(
        "flex items-start gap-1.5 rounded-md border px-2.5 py-1.5 text-xs leading-relaxed",
        tone === "warning"
          ? "border-quality-stale/40 bg-quality-stale/[0.08] text-foreground"
          : "border-destructive/40 bg-destructive/5 text-destructive"
      )}
    >
      <ShieldAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </p>
  )
}

function Field({
  label,
  value,
  muted = false,
  mono = false,
}: {
  label: string
  value: string
  muted?: boolean
  mono?: boolean
}): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[0.6875rem] tracking-[0.04em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "min-w-0 font-medium break-words text-foreground tabular-nums",
          mono && "font-mono text-xs font-normal",
          muted && "text-muted-foreground"
        )}
      >
        {value}
      </dd>
    </div>
  )
}

/** A field whose value is a long opaque string — a path, a hash, a uuid. */
function WideField({
  label,
  value,
  muted = false,
}: {
  label: string
  value: string
  muted?: boolean
}): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[0.6875rem] tracking-[0.04em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "min-w-0 font-mono text-xs break-all",
          muted ? "text-muted-foreground" : "text-foreground"
        )}
      >
        {value}
      </dd>
    </div>
  )
}
