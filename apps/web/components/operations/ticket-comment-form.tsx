"use client"

import { useCallback, useId, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/cn"
import type { ApiResponse } from "@/lib/contracts"

/**
 * The reply box on a ticket.                                  Owner: W-NIGHT
 *
 * ## Why this is the most important control in the operations module
 *
 * A resident reports a leak and then hears nothing. That is the complaint every
 * property manager gets, and until now this product guaranteed it: the ticket
 * carried a full history, and there was no way for anyone to add a line to it.
 * The server path existed (`appendTicketEvent`), the database policy existed
 * (`ticket_events_insert_comment`, which lets a resident append `kind='comment'`
 * to a ticket they can see) — and nothing in the interface called either.
 *
 * ## What it is allowed to write, and what stops it being more
 *
 * Exactly one thing: a comment, authored by the signed-in user, on a ticket they
 * can already read. Three separate things hold that line, and none of them is
 * this component:
 *
 *  - `permissionForCommand()` grants a comment `tickets:view` rather than
 *    `tickets:update`, so writing one never implies moving the ticket;
 *  - the row policy pins `actor_profile_id` to `auth.uid()` and requires both
 *    status fields to be NULL, so a status change cannot be posted as a comment;
 *  - `ticket_events` has no UPDATE or DELETE grant at any level, so what is said
 *    stays said. A correction is a further comment.
 *
 * The textarea is optimistically cleared only AFTER a 200. A composer that
 * empties itself on submit and then fails has eaten what the person wrote.
 */

const ACTIONS_ENDPOINT = "/api/site-management/actions"

export interface TicketCommentLabels {
  heading: string
  placeholder: string
  submit: string
  busy: string
  empty: string
  genericError: string
  unavailable: string
}

export function TicketCommentForm({
  ticketId,
  companyId,
  labels,
  className,
}: {
  ticketId: string
  companyId: string
  labels: TicketCommentLabels
  className?: string
}) {
  const router = useRouter()
  const fieldId = useId()
  const [pending, startTransition] = useTransition()
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(async () => {
    const body = note.trim()
    if (body === "") {
      setError(labels.empty)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(ACTIONS_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          command: "ticket.appendEvent",
          ticketId,
          companyId,
          kind: "comment",
          note: body,
        }),
      })
      const payload = (await response.json()) as ApiResponse<unknown>

      if (response.ok && payload.ok) {
        setNote("")
        // The history is server-rendered, so re-read rather than splicing a
        // local copy that could disagree with what was actually stored.
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
  }, [note, ticketId, companyId, labels, router])

  const working = busy || pending

  return (
    <form
      data-slot="ticket-comment-form"
      className={cn("flex flex-col gap-2", className)}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <label htmlFor={fieldId} className="text-sm font-medium text-foreground">
        {labels.heading}
      </label>
      <textarea
        id={fieldId}
        rows={3}
        maxLength={4000}
        value={note}
        disabled={working}
        onChange={(event) => setNote(event.target.value)}
        placeholder={labels.placeholder}
        className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={working}>
          {working ? labels.busy : labels.submit}
        </Button>
        {error === null ? null : (
          <p
            role="alert"
            className="text-sm text-confidence-conflicted"
          >
            {error}
          </p>
        )}
      </div>
    </form>
  )
}
