"use client"

import { useCallback, useId, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/cn"
import type { ApiResponse } from "@/lib/contracts"
import type { ServiceTicket, TicketStatus } from "@/lib/operations-data"
// TYPE-ONLY, and it has to stay that way. `lib/ticket-workflow.ts` imports the
// status enum from `lib/operations-data.ts`, which imports `lib/repository-base.ts`,
// which imports `lib/supabase/server.ts` — and that reaches `next/headers`.
// A value import here drags the whole server chain into the browser bundle and
// fails the production build. Measured: `next build` refused it with
// "You're importing a module that depends on next/headers".
// The transitions are therefore DERIVED ON THE SERVER by the page calling
// `allowedTransitions()`, and arrive here as a prop. Nothing is hardcoded
// either way; this just keeps the workflow out of the client bundle entirely.
import type { TicketTransition, TransitionIntent } from "@/lib/ticket-workflow"

/**
 * The ticket's action bar.                                    Owner: W3-E
 *
 * **Every button here is derived, none is written.** The component is handed a
 * status and a role and asks `allowedTransitions()`; it contains no list of
 * buttons, no `if (status === "open")`, and no knowledge of what the lifecycle
 * is. Adding an edge to `lib/ticket-workflow.ts` makes a button appear here;
 * removing one makes it disappear. There is no second place to update, which is
 * the entire point of keeping the machine in one table.
 *
 * A move the role may not make is **absent**, not disabled. A disabled button
 * advertises an operation and refuses it in the same breath, and the person
 * reading it cannot tell whether they lack the permission or the ticket is in
 * the wrong state.
 *
 * ## Why this is a client component when the rest of the module is not
 *
 * It needs three things a Server Component cannot do: a note field whose
 * contents gate the submit, an in-flight state, and the 409 path. `"use client"`
 * is scoped to the action bar, so the ticket page around it still ships as
 * server-rendered HTML.
 *
 * ## The 409
 *
 * Optimistic concurrency is real here: `expectedVersion` goes with the request
 * and the repository's UPDATE carries `.eq("version", …)`. When another manager
 * moved the ticket first, the API answers 409 and this **re-renders against the
 * truth** rather than retrying: `router.refresh()` re-runs the Server Component,
 * the status and version come back current, and the buttons recompute from the
 * table. Retrying silently would apply this operator's intent to a ticket that
 * is no longer the one they read.
 */

const TICKETS_ENDPOINT = "/api/site-management/tickets"

export interface TicketTransitionLabels {
  /** Keyed by `TransitionId`. */
  actions: Record<string, string>
  noteLabel: string
  notePlaceholder: string
  noteRequired: string
  assigneeLabel: string
  assigneePlaceholder: string
  assigneeRequired: string
  assigneeUnavailable: string
  submit: string
  cancel: string
  busy: string
  conflict: string
  genericError: string
  unavailable: string
  heading: string
  noActions: string
}

/**
 * Destructive intents get the outline treatment and sit after a separator, so
 * "Vorgang abbrechen" is never adjacent to the primary forward move. The
 * ordinary advance is the only filled button on the row.
 */
function variantFor(
  intent: TransitionIntent
): "default" | "outline" | "secondary" {
  if (intent === "advance") return "default"
  if (intent === "reject" || intent === "cancel") return "outline"
  return "secondary"
}

export function TicketTransitions({
  ticket,
  available,
  assignees = [],
  labels,
  className,
}: {
  ticket: Pick<ServiceTicket, "id" | "status" | "version">
  /**
   * `allowedTransitions(ticket.status, role)`, evaluated by the server page.
   * Plain data: strings and booleans, so it crosses the boundary unchanged.
   */
  available: readonly TicketTransition[]
  /**
   * Who this job can be handed to. Empty when the caller may not read the
   * directory, in which case the assign action explains itself instead of
   * offering an empty menu.
   */
  assignees?: readonly { id: string; name: string }[]
  labels: TicketTransitionLabels
  className?: string
}) {
  const router = useRouter()
  const noteFieldId = useId()
  const assigneeFieldId = useId()
  const [pending, startTransition] = useTransition()
  const [selected, setSelected] = useState<TicketTransition | null>(null)
  const [note, setNote] = useState("")
  const [assignee, setAssignee] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reset = useCallback(() => {
    setSelected(null)
    setNote("")
    setAssignee("")
    setError(null)
  }, [])

  const submit = useCallback(
    async (
      transition: TicketTransition,
      submittedNote: string,
      submittedAssignee: string
    ) => {
      setBusy(true)
      setError(null)
      try {
        const response = await fetch(TICKETS_ENDPOINT, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ticketId: ticket.id,
            expectedVersion: ticket.version,
            toStatus: transition.to satisfies TicketStatus,
            ...(submittedNote.trim() === ""
              ? {}
              : { note: submittedNote.trim() }),
            // Travels with the status. The repository refuses `assigned`
            // without it, so this is the field that stops a job being assigned
            // to nobody.
            ...(submittedAssignee === ""
              ? {}
              : { assigneeProfileId: submittedAssignee }),
          }),
        })
        const payload = (await response.json()) as ApiResponse<unknown>

        if (response.ok && payload.ok) {
          reset()
          // Re-read rather than patching local state: the server owns the new
          // version, and a stale version here would 409 the NEXT move.
          startTransition(() => router.refresh())
          return
        }

        const code = payload.ok ? null : payload.error.code
        if (response.status === 409 || code === "conflict") {
          setError(labels.conflict)
          startTransition(() => router.refresh())
          return
        }
        if (code === "persistence_unavailable") {
          // 503. The write did NOT happen, and the UI says exactly that rather
          // than closing the dialog as though it had.
          setError(labels.unavailable)
          return
        }
        setError(payload.ok ? labels.genericError : payload.error.message)
      } catch {
        setError(labels.genericError)
      } finally {
        setBusy(false)
      }
    },
    [ticket.id, ticket.version, labels, reset, router]
  )

  if (available.length === 0) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        {labels.noActions}
      </p>
    )
  }

  const working = busy || pending

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <h3 className="text-sm font-medium text-foreground">{labels.heading}</h3>

      <div className="flex flex-wrap gap-2">
        {available.map((transition) => (
          <Button
            key={`${transition.id}:${transition.from}:${transition.to}`}
            type="button"
            size="sm"
            variant={variantFor(transition.intent)}
            disabled={working}
            aria-expanded={selected?.id === transition.id}
            onClick={() => {
              setError(null)
              setNote("")
              // A move needing no reason is one click. Adding a confirmation
              // step to "Arbeit beginnen" is friction on the action people
              // perform most.
              setAssignee("")
              // A move needing a reason OR a person opens the panel. Assignment
              // is the second case: it used to be one click and it silently
              // assigned nobody.
              if (transition.requiresNote || transition.to === "assigned") {
                setSelected(transition)
              } else void submit(transition, "", "")
            }}
          >
            {labels.actions[transition.id] ?? transition.id}
          </Button>
        ))}
      </div>

      {selected === null ? null : (
        <form
          className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (selected.requiresNote && note.trim() === "") {
              setError(labels.noteRequired)
              return
            }
            if (selected.to === "assigned" && assignee === "") {
              setError(labels.assigneeRequired)
              return
            }
            void submit(selected, note, assignee)
          }}
        >
          {/* Who takes the job. Only on the assign move, and required there. */}
          {selected.to === "assigned" ? (
            <>
              <label
                htmlFor={assigneeFieldId}
                className="text-sm font-medium text-foreground"
              >
                {labels.assigneeLabel}
              </label>
              {assignees.length === 0 ? (
                <p className="rounded-md border border-confidence-gap/30 bg-confidence-gap/10 px-3 py-2 text-sm text-foreground">
                  {labels.assigneeUnavailable}
                </p>
              ) : (
                <select
                  id={assigneeFieldId}
                  required
                  value={assignee}
                  onChange={(event) => setAssignee(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <option value="">{labels.assigneePlaceholder}</option>
                  {assignees.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              )}
            </>
          ) : null}

          {selected.requiresNote ? (
            <>
              <label
                htmlFor={noteFieldId}
                className="text-sm font-medium text-foreground"
              >
                {labels.noteLabel}
              </label>
              <textarea
                id={noteFieldId}
                required
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={labels.notePlaceholder}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              />
            </>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={working}>
              {working ? labels.busy : labels.submit}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={working}
              onClick={reset}
            >
              {labels.cancel}
            </Button>
          </div>
        </form>
      )}

      {error === null ? null : (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground"
        >
          {error}
        </p>
      )}
    </div>
  )
}
