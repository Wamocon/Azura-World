"use client"

import { useActionState, useId } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input, Label } from "@/components/ui/input"
import { cn } from "@/lib/cn"
import type { Locale } from "@/lib/contracts"
import type { DocumentUploadState } from "@/app/[locale]/dashboard/documents/actions"

/**
 * The upload form.                                              Owner: W3-F
 *
 * ## The `accept` attribute is a courtesy, not a control
 *
 * It filters the file picker. It does not stop anyone: the same request can be
 * made with `curl`, and a renamed file passes it trivially. The control is
 * `validateUpload()` in `lib/document-storage.ts`, which reads the leading bytes
 * server-side and refuses anything whose content disagrees with its claim, or
 * that sniffs as markup at all. `tasks/W3-F` says it plainly: *"Client
 * validation is a courtesy, not a control."*
 *
 * ## Five outcomes, five treatments
 *
 * `stored` is the only affirmative one. `incomplete` — the file landed and its
 * log entry did not — gets the amber conflict treatment rather than the green,
 * because an operator has something to do about it. `unavailable` shows the
 * literal **503**: a reader who has been told a hundred times that "something
 * went wrong" learns nothing, and the status code is the thing that tells them
 * this is a configuration problem and not their file.
 */

/**
 * NOTE: the initial state is NOT exported from the `"use server"` module.
 * Next 16 refuses a server-action file that exports anything other than an
 * async function ("A \"use server\" file can only export async functions,
 * found object"), and it is a build error rather than a warning. The TYPE is
 * still imported from there, because `import type` is erased.
 */
const INITIAL_STATE: DocumentUploadState = { status: "idle" }

export interface UploadLabels {
  title: string
  category: string
  file: string
  fileHint: string
  submit: string
  submitting: string
  resultHeading: string
  storedAs: string
  forbidden: string
  categories: Record<string, string>
}

const STATE_TONE: Readonly<Record<DocumentUploadState["status"], string>> =
  Object.freeze({
    idle: "",
    stored:
      "border-confidence-confirmed/40 bg-confidence-confirmed/10 text-confidence-confirmed",
    incomplete:
      "border-confidence-conflicted/45 bg-surface-conflict text-confidence-conflicted",
    rejected: "border-destructive/40 bg-destructive/5 text-destructive",
    forbidden: "border-destructive/40 bg-destructive/5 text-destructive",
    invalid: "border-destructive/40 bg-destructive/5 text-destructive",
    failed: "border-destructive/40 bg-destructive/5 text-destructive",
    unavailable:
      "border-quality-stale/40 bg-quality-stale/10 text-quality-stale",
  })

/** Mirrors `ALLOWED_UPLOAD_TYPES`. Kept in sync by hand and by the server. */
const ACCEPT = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
].join(",")

export function DocumentUploadForm({
  action,
  locale,
  categories,
  labels,
  className,
}: {
  action: (
    previous: DocumentUploadState,
    formData: FormData
  ) => Promise<DocumentUploadState>
  locale: Locale
  categories: readonly string[]
  labels: UploadLabels
  className?: string
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE)
  const titleId = useId()
  const categoryId = useId()
  const fileId = useId()

  return (
    <form
      action={formAction}
      className={cn("flex min-w-0 flex-col gap-4", className)}
    >
      <input type="hidden" name="locale" value={locale} />

      <div className="grid [grid-template-columns:repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={titleId}>{labels.title}</Label>
          <Input id={titleId} name="title" required maxLength={200} />
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={categoryId}>{labels.category}</Label>
          <select
            id={categoryId}
            name="category"
            required
            defaultValue="general"
            className="h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {categories.map((category) => (
              <option key={category} value={category}>
                {labels.categories[category] ?? category}
              </option>
            ))}
          </select>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={fileId}>{labels.file}</Label>
          <input
            id={fileId}
            name="file"
            type="file"
            required
            accept={ACCEPT}
            className="h-9 min-w-0 rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs file:text-secondary-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {labels.fileHint}
      </p>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? labels.submitting : labels.submit}
        </Button>
      </div>

      {state.status === "idle" ? null : (
        <div
          role="status"
          data-testid="document-upload-result"
          data-status={state.status}
          className={cn(
            "flex min-w-0 flex-col gap-1 rounded-lg border px-3 py-2 text-sm",
            STATE_TONE[state.status]
          )}
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{labels.resultHeading}</span>
            {state.status === "unavailable" ? (
              <Badge variant="destructive">{state.httpStatus}</Badge>
            ) : null}
            {state.status === "rejected" ? (
              <Badge variant="conflicted">
                <span className="font-mono">{state.sniffed}</span>
              </Badge>
            ) : null}
          </span>

          <span>
            {state.status === "forbidden" ? labels.forbidden : state.message}
          </span>

          {/* The stored name, whenever it exists. `../../evil.txt` becomes
              `evil.pdf` under a uuid, and showing the result is how a user finds
              their own document again. */}
          {state.status === "stored" || state.status === "incomplete" ? (
            <span className="text-xs">
              {labels.storedAs}{" "}
              <code className="font-mono">{state.storedFilename}</code>
            </span>
          ) : null}
        </div>
      )}
    </form>
  )
}
