"use client"

import { CalendarPlus } from "lucide-react"
import { useCallback, useId, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/cn"
import type { ApiResponse } from "@/lib/contracts"

/**
 * Put something on the site calendar.                          Owner: W-NIGHT
 *
 * ## Why this exists
 *
 * `POST /api/site-management/activities` was built, granted, permissioned,
 * rate-limited, audited and published in `docs/api/openapi.yaml`, and **no
 * screen in the product could reach it**. `activities` has held its INSERT grant
 * since migration 21 and `activities_manager_write` has always admitted admin
 * and manager. An endpoint nobody can reach is a feature that does not exist.
 *
 * ## Who sees it
 *
 * `activities:create` — which, after the same pass that added this form, is held
 * by exactly the roles `activities_manager_write` admits. It used to be held by
 * staff, owner, tenant and service_provider too, all of whom Postgres refuses,
 * so this control would have appeared for four roles and 403'd for every one of
 * them.
 *
 * ## Times are local, and stored as instants
 *
 * `<input type="datetime-local">` gives a wall-clock string with no zone —
 * "2026-08-12T18:00" — because that is what somebody scheduling a yoga class
 * means. `new Date(...).toISOString()` interprets it in the browser's zone,
 * which for this site is the reader's own, and sends an instant. The schema
 * takes `isoInstant`; the database column is `timestamptz`. Nothing guesses a
 * zone on the server, where the guess would be wrong.
 *
 * The end time is validated here AND in `createActivitySchema` AND in
 * `createActivity()`. Three checks is not redundancy: the first is courtesy, the
 * second is the contract, the third is the only one that survives a caller who
 * skips this form.
 */

export interface NewActivityLabels {
  trigger: string
  heading: string
  lead: string
  title: string
  category: string
  description: string
  startsAt: string
  endsAt: string
  submit: string
  submitting: string
  cancel: string
  titleRequired: string
  timesRequired: string
  endBeforeStart: string
  failed: string
  /** Category enum value → the reader's word for it. */
  categories: Readonly<Record<string, string>>
}

const ACTIVITIES_ENDPOINT = "/api/site-management/activities"

export function NewActivityForm({
  categories,
  labels,
  className,
}: {
  /** `activityCategories`, in the order the enum declares them. */
  categories: readonly string[]
  labels: NewActivityLabels
  className?: string
}) {
  const router = useRouter()
  const ids = useId()
  const [open, setOpen] = useState(false)
  const [, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState("")
  const [category, setCategory] = useState<string>(categories[0] ?? "social")
  const [description, setDescription] = useState("")
  const [startsAt, setStartsAt] = useState("")
  const [endsAt, setEndsAt] = useState("")

  const reset = useCallback(() => {
    setTitle("")
    setCategory(categories[0] ?? "social")
    setDescription("")
    setStartsAt("")
    setEndsAt("")
    setError(null)
  }, [categories])

  const submit = useCallback(async () => {
    const trimmedTitle = title.trim()
    if (trimmedTitle === "") {
      setError(labels.titleRequired)
      return
    }
    if (startsAt === "" || endsAt === "") {
      setError(labels.timesRequired)
      return
    }
    // Local wall-clock in, instant out. See the header.
    const startInstant = new Date(startsAt)
    const endInstant = new Date(endsAt)
    if (
      Number.isNaN(startInstant.getTime()) ||
      Number.isNaN(endInstant.getTime())
    ) {
      setError(labels.timesRequired)
      return
    }
    if (endInstant.getTime() <= startInstant.getTime()) {
      setError(labels.endBeforeStart)
      return
    }

    setBusy(true)
    setError(null)
    try {
      const trimmedDescription = description.trim()
      const response = await fetch(ACTIVITIES_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: trimmedTitle,
          category,
          startsAt: startInstant.toISOString(),
          endsAt: endInstant.toISOString(),
          ...(trimmedDescription === ""
            ? {}
            : { description: trimmedDescription }),
        }),
      })
      const body = (await response.json()) as ApiResponse<unknown>
      if (!response.ok || body.ok !== true) {
        // The API's own message when it has one — it knows why far better than
        // this component can guess, and a generic failure string would hide a
        // 409 or a validation detail the person can act on.
        const message =
          body.ok === false && typeof body.error?.message === "string"
            ? body.error.message
            : labels.failed
        setError(message)
        return
      }
      reset()
      setOpen(false)
      // The list is server-rendered; `refresh` re-reads it under the same
      // policies rather than splicing a row this component only half knows.
      startTransition(() => router.refresh())
    } catch {
      setError(labels.failed)
    } finally {
      setBusy(false)
    }
  }, [
    title,
    category,
    description,
    startsAt,
    endsAt,
    labels,
    reset,
    router,
    startTransition,
  ])

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn("w-fit", className)}
        onClick={() => setOpen(true)}
      >
        <CalendarPlus aria-hidden="true" className="size-4" />
        {labels.trigger}
      </Button>
    )
  }

  return (
    <form
      className={cn(
        "flex flex-col gap-4 rounded-xl border border-input bg-card p-5",
        className
      )}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-base font-semibold text-foreground">
          {labels.heading}
        </h3>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          {labels.lead}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${ids}-title`} label={labels.title}>
          <input
            id={`${ids}-title`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            maxLength={200}
            className={INPUT}
          />
        </Field>

        <Field id={`${ids}-category`} label={labels.category}>
          <select
            id={`${ids}-category`}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className={INPUT}
          >
            {categories.map((value) => (
              <option key={value} value={value}>
                {labels.categories[value] ?? value}
              </option>
            ))}
          </select>
        </Field>

        <Field id={`${ids}-starts`} label={labels.startsAt}>
          <input
            id={`${ids}-starts`}
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
            required
            className={INPUT}
          />
        </Field>

        <Field id={`${ids}-ends`} label={labels.endsAt}>
          <input
            id={`${ids}-ends`}
            type="datetime-local"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
            required
            className={INPUT}
          />
        </Field>
      </div>

      <Field id={`${ids}-description`} label={labels.description}>
        <textarea
          id={`${ids}-description`}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          maxLength={2000}
          className={cn(INPUT, "resize-y")}
        />
      </Field>

      {error === null ? null : (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-foreground"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? labels.submitting : labels.submit}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            reset()
            setOpen(false)
          }}
        >
          {labels.cancel}
        </Button>
      </div>
    </form>
  )
}

const INPUT =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"

function Field({
  id,
  label,
  children,
}: {
  id: string
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase"
      >
        {label}
      </label>
      {children}
    </div>
  )
}
