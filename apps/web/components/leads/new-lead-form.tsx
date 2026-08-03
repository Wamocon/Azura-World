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
import { cn } from "@/lib/cn"
import type { ApiResponse } from "@/lib/contracts"

/**
 * "New enquiry" — the way an enquiry gets into the CRM.
 *
 * ## The gap this closes
 *
 * The leads page could show every enquiry ever collected and could not accept
 * the next one: `POST /api/site-management/leads` answered 503 because no
 * repository write path existed. A manager who took a phone call had nowhere to
 * put it, so it went into a notebook and the CRM described a smaller pipeline
 * than the business had.
 *
 * ## Why the form asks for so little, and why it cannot ask for more
 *
 * Six fields, two of them required. There is no "assign to", no status and no
 * score, and that is not a UI decision that a future version could relax:
 * `createLeadSchema` is a strict object with no such key, so a payload carrying
 * one is rejected before it reaches a handler. A lead arrives `new` and unowned.
 * The obvious abuse — a salesperson capturing an enquiry straight into their own
 * name — is closed at the schema rather than by convention.
 *
 * The apartment is free text because it is a business code (`AZW-B03-0412`),
 * not a picker: this page does not read the inventory, and offering a list built
 * from something other than `units.id` would produce a foreign-key error on
 * submit that reads to the user as a broken button. Left empty, the enquiry is
 * simply about no particular apartment, which is the common case at a trade
 * fair.
 *
 * ## Rendering, and the one rule about success
 *
 * A dialog rather than a route, so the reader keeps their place in the list, and
 * the list behind it refreshes via `router.refresh()`. The fields are cleared
 * and the dialog closed **only after a 200** — a 409, a 503 or a validation
 * failure leaves everything typed exactly where it was, because re-typing a
 * customer's details is the one thing this form must never ask for twice.
 */

const LEADS_ENDPOINT = "/api/site-management/leads"

/** `shortText` caps at 200; `longText`, and therefore the message, at 4 000. */
const SHORT_MAX = 200
const EMAIL_MAX = 254
const MESSAGE_MAX = 4000
/** `identifier` — a unit code is machine-generated and never longer than this. */
const UNIT_MAX = 64

export interface NewLeadLabels {
  trigger: string
  heading: string
  lead: string
  nameLabel: string
  namePlaceholder: string
  emailLabel: string
  emailPlaceholder: string
  phoneLabel: string
  phonePlaceholder: string
  sourceLabel: string
  unitLabel: string
  unitPlaceholder: string
  unitHint: string
  messageLabel: string
  messagePlaceholder: string
  /** What the record will look like once saved. Sets the expectation once. */
  afterNote: string
  submit: string
  busy: string
  cancel: string
  close: string
  nameRequired: string
  emailRequired: string
  genericError: string
  unavailable: string
  /** Channel labels keyed by `LeadSource`. */
  sources: Readonly<Record<string, string>>
}

export function NewLeadForm({
  sources,
  labels,
  className,
}: {
  /** `leadSources`, in the order the enum declares them. */
  sources: readonly string[]
  labels: NewLeadLabels
  className?: string
}) {
  const router = useRouter()
  const ids = useId()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [source, setSource] = useState<string>(sources[0] ?? "unknown")
  const [unitId, setUnitId] = useState("")
  const [message, setMessage] = useState("")

  const reset = useCallback(() => {
    setFullName("")
    setEmail("")
    setPhone("")
    setSource(sources[0] ?? "unknown")
    setUnitId("")
    setMessage("")
    setError(null)
  }, [sources])

  const submit = useCallback(async () => {
    const name = fullName.trim()
    if (name === "") {
      setError(labels.nameRequired)
      return
    }
    const trimmedEmail = email.trim()
    if (trimmedEmail === "") {
      setError(labels.emailRequired)
      return
    }

    setBusy(true)
    setError(null)
    try {
      const trimmedPhone = phone.trim()
      const trimmedUnit = unitId.trim()
      const trimmedMessage = message.trim()

      const response = await fetch(LEADS_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: name,
          email: trimmedEmail,
          source,
          // Omitted rather than sent empty: the schema is strict and every
          // optional field is a bounded non-empty string, so `phone: ""` is a
          // validation failure rather than "no phone number".
          ...(trimmedPhone === "" ? {} : { phone: trimmedPhone }),
          ...(trimmedUnit === "" ? {} : { unitId: trimmedUnit }),
          ...(trimmedMessage === "" ? {} : { message: trimmedMessage }),
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
        // 503. The enquiry was NOT saved, the dialog stays open with every
        // field intact, and the message says so rather than implying a retry
        // would be a duplicate.
        setError(labels.unavailable)
        return
      }
      setError(payload.ok ? labels.genericError : payload.error.message)
    } catch {
      setError(labels.genericError)
    } finally {
      setBusy(false)
    }
  }, [fullName, email, phone, source, unitId, message, labels, reset, router])

  const working = busy || pending
  const field =
    "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
  const legend = "text-sm font-medium text-foreground"

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

          {/* --- who ---------------------------------------------------- */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${ids}-name`} className={legend}>
              {labels.nameLabel}
            </label>
            <input
              id={`${ids}-name`}
              type="text"
              required
              maxLength={SHORT_MAX}
              value={fullName}
              disabled={working}
              placeholder={labels.namePlaceholder}
              onChange={(event) => setFullName(event.target.value)}
              className={field}
            />
          </div>

          {/* --- how to reach them -------------------------------------- */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${ids}-email`} className={legend}>
                {labels.emailLabel}
              </label>
              <input
                id={`${ids}-email`}
                type="email"
                required
                maxLength={EMAIL_MAX}
                value={email}
                disabled={working}
                placeholder={labels.emailPlaceholder}
                onChange={(event) => setEmail(event.target.value)}
                className={field}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${ids}-phone`} className={legend}>
                {labels.phoneLabel}
              </label>
              {/* `type="tel"`, and no pattern: numbers across DE/EN/TR/RU take
                  too many shapes for a regex to be anything but a source of
                  false rejections for real people. The schema agrees. */}
              <input
                id={`${ids}-phone`}
                type="tel"
                maxLength={SHORT_MAX}
                value={phone}
                disabled={working}
                placeholder={labels.phonePlaceholder}
                onChange={(event) => setPhone(event.target.value)}
                className={field}
              />
            </div>
          </div>

          {/* --- where it came from, and about what --------------------- */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${ids}-source`} className={legend}>
                {labels.sourceLabel}
              </label>
              <select
                id={`${ids}-source`}
                value={source}
                disabled={working}
                onChange={(event) => setSource(event.target.value)}
                className={field}
              >
                {sources.map((value) => (
                  <option key={value} value={value}>
                    {labels.sources[value] ?? value}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${ids}-unit`} className={legend}>
                {labels.unitLabel}
              </label>
              <input
                id={`${ids}-unit`}
                type="text"
                maxLength={UNIT_MAX}
                value={unitId}
                disabled={working}
                placeholder={labels.unitPlaceholder}
                aria-describedby={`${ids}-unit-hint`}
                onChange={(event) => setUnitId(event.target.value)}
                className={field}
              />
              <p
                id={`${ids}-unit-hint`}
                className="text-xs text-muted-foreground"
              >
                {labels.unitHint}
              </p>
            </div>
          </div>

          {/* --- what they said ----------------------------------------- */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${ids}-message`} className={legend}>
              {labels.messageLabel}
            </label>
            <textarea
              id={`${ids}-message`}
              rows={4}
              maxLength={MESSAGE_MAX}
              value={message}
              disabled={working}
              placeholder={labels.messagePlaceholder}
              onChange={(event) => setMessage(event.target.value)}
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
