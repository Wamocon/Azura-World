"use client"

import { useCallback, useId, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Explain, type ExplainLabels } from "@/components/ui/explain"
import { cn } from "@/lib/cn"
import type { ApiResponse } from "@/lib/contracts"

/**
 * "Report a problem" — the resident's way in.                  Owner: W-NIGHT
 *
 * ## The gap this closes
 *
 * Until now a resident could read every ticket about their own home and had no
 * way to open one. The only route was to telephone the office and have a manager
 * type it for them, which is precisely the errand a property ERP exists to
 * remove — and it meant the audit trail recorded the manager as the reporter,
 * so "who said the boiler was broken, and when" was answerable only by asking
 * around.
 *
 * ## Why the form asks for so little
 *
 * Five fields, and three of them have a sensible default. Everything else a
 * ticket carries — who it is assigned to, what it will cost, whether finance
 * must approve it, what state it is in — is triage, and triage belongs to staff.
 * `createTicketSchema` has no field for any of them and
 * `service_tickets_insert_requester` refuses a row that sets them, so this is
 * not a UI convention that a future form could quietly break.
 *
 * The "where" list is the homes the reader HOLDS, resolved server-side by
 * `getOwnUnitIds()`, plus the common areas. It is deliberately not the list of
 * homes they can see: offering a flat the database will refuse turns a
 * permission rule into what looks like a broken button.
 *
 * ## Rendering
 *
 * A dialog rather than a route, so a resident who is looking at the queue does
 * not lose their place, and the queue behind it refreshes in place on success.
 */

const TICKETS_ENDPOINT = "/api/site-management/tickets"

/** The DB caps title at 200 and description at 8 000. */
const TITLE_MAX = 200
const DESCRIPTION_MAX = 4000

export interface NewRequestLabels {
  trigger: string
  heading: string
  lead: string
  titleLabel: string
  titlePlaceholder: string
  whereLabel: string
  whereCommon: string
  categoryLabel: string
  priorityLabel: string
  descriptionLabel: string
  descriptionPlaceholder: string
  submit: string
  busy: string
  cancel: string
  close: string
  titleRequired: string
  genericError: string
  unavailable: string
  /** What happens after they press send. Sets the expectation once, honestly. */
  afterNote: string
  categories: Readonly<Record<string, string>>
  priorities: Readonly<Record<string, string>>
  /** Plain-language help for "priority", which people read as "how annoyed am I". */
  priorityExplain?: ExplainLabels
}

export function NewRequestForm({
  unitIds,
  categories,
  priorities,
  labels,
  className,
}: {
  /** Homes the reader holds. Empty is fine — they can still report a common area. */
  unitIds: readonly string[]
  categories: readonly string[]
  priorities: readonly string[]
  labels: NewRequestLabels
  className?: string
}) {
  const router = useRouter()
  const ids = useId()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState("")
  const [where, setWhere] = useState<string>(unitIds[0] ?? "")
  const [category, setCategory] = useState<string>(categories[0] ?? "other")
  const [priority, setPriority] = useState<string>("normal")
  const [description, setDescription] = useState("")

  const reset = useCallback(() => {
    setTitle("")
    setWhere(unitIds[0] ?? "")
    setCategory(categories[0] ?? "other")
    setPriority("normal")
    setDescription("")
    setError(null)
  }, [unitIds, categories])

  const submit = useCallback(async () => {
    const trimmedTitle = title.trim()
    if (trimmedTitle === "") {
      setError(labels.titleRequired)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(TICKETS_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: trimmedTitle,
          description: description.trim(),
          category,
          priority,
          // "" is the common areas — no unit, which the column allows and the
          // policy explicitly permits. Sending `unitId: ""` would be a lookup
          // for a home that does not exist.
          ...(where === "" ? {} : { unitId: where }),
        }),
      })
      const payload = (await response.json()) as ApiResponse<unknown>

      if (response.ok && payload.ok) {
        reset()
        setOpen(false)
        startTransition(() => router.refresh())
        return
      }
      const code = payload.ok ? null : payload.error.code
      if (code === "persistence_unavailable") {
        setError(labels.unavailable)
        return
      }
      setError(payload.ok ? labels.genericError : payload.error.message)
    } catch {
      setError(labels.genericError)
    } finally {
      setBusy(false)
    }
  }, [
    title,
    description,
    category,
    priority,
    where,
    labels,
    reset,
    router,
  ])

  const working = busy || pending
  const field =
    "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
  const legend =
    "text-sm font-medium text-foreground"

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" className={cn(className)}>
            {labels.trigger}
          </Button>
        }
      />
      <DialogContent closeLabel={labels.close}>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <div className="flex flex-col gap-1.5">
              <DialogTitle>{labels.heading}</DialogTitle>
              <DialogDescription>{labels.lead}</DialogDescription>
            </div>

            {/* --- what is wrong ------------------------------------------ */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${ids}-title`} className={legend}>
                {labels.titleLabel}
              </label>
              <input
                id={`${ids}-title`}
                type="text"
                required
                maxLength={TITLE_MAX}
                value={title}
                disabled={working}
                placeholder={labels.titlePlaceholder}
                onChange={(event) => setTitle(event.target.value)}
                className={field}
              />
            </div>

            {/* --- where -------------------------------------------------- */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${ids}-where`} className={legend}>
                {labels.whereLabel}
              </label>
              <select
                id={`${ids}-where`}
                value={where}
                disabled={working}
                onChange={(event) => setWhere(event.target.value)}
                className={field}
              >
                {unitIds.map((unitId) => (
                  <option key={unitId} value={unitId}>
                    {unitId}
                  </option>
                ))}
                <option value="">{labels.whereCommon}</option>
              </select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* --- what kind -------------------------------------------- */}
              <div className="flex flex-col gap-1.5">
                {/* Same wrapper as the priority label beside it, icon or no
                    icon: without it the two labels differ in height and the two
                    selects sit on different baselines. */}
                <span className="flex min-h-6 items-center gap-1.5">
                  <label htmlFor={`${ids}-category`} className={legend}>
                    {labels.categoryLabel}
                  </label>
                </span>
                <select
                  id={`${ids}-category`}
                  value={category}
                  disabled={working}
                  onChange={(event) => setCategory(event.target.value)}
                  className={field}
                >
                  {categories.map((value) => (
                    <option key={value} value={value}>
                      {labels.categories[value] ?? value}
                    </option>
                  ))}
                </select>
              </div>

              {/* --- how urgent ------------------------------------------- */}
              <div className="flex flex-col gap-1.5">
                <span className="flex min-h-6 items-center gap-1.5">
                  <label htmlFor={`${ids}-priority`} className={legend}>
                    {labels.priorityLabel}
                  </label>
                  {labels.priorityExplain === undefined ? null : (
                    <Explain labels={labels.priorityExplain} iconOnly />
                  )}
                </span>
                <select
                  id={`${ids}-priority`}
                  value={priority}
                  disabled={working}
                  onChange={(event) => setPriority(event.target.value)}
                  className={field}
                >
                  {priorities.map((value) => (
                    <option key={value} value={value}>
                      {labels.priorities[value] ?? value}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* --- detail ------------------------------------------------- */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${ids}-description`} className={legend}>
                {labels.descriptionLabel}
              </label>
              <textarea
                id={`${ids}-description`}
                rows={4}
                maxLength={DESCRIPTION_MAX}
                value={description}
                disabled={working}
                placeholder={labels.descriptionPlaceholder}
                onChange={(event) => setDescription(event.target.value)}
                className={cn(field, "resize-y")}
              />
            </div>

            <p className="text-xs text-muted-foreground">{labels.afterNote}</p>

            {error === null ? null : (
              <p role="alert" className="text-sm text-confidence-conflicted">
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-3">
              <DialogClose
                render={
                  <Button type="button" variant="ghost" size="sm">
                    {labels.cancel}
                  </Button>
                }
              />
              <Button type="submit" size="sm" disabled={working}>
                {working ? labels.busy : labels.submit}
              </Button>
            </div>
          </form>
      </DialogContent>
    </Dialog>
  )
}
