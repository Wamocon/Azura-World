"use client"

import { useCallback, useId, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/cn"
import type { ApiResponse } from "@/lib/contracts"

/**
 * The reply box on a conversation.                             Owner: W-NIGHT
 *
 * ## What was here before
 *
 * A sentence explaining why there was no reply box: "no message could leave the
 * building". That was the right call at the time — a compose field with nothing
 * behind it teaches people to type into a void — but it conflated two different
 * things. Sending an *email* still needs a provider nobody has configured.
 * Answering inside the portal never did; it needed an INSERT on `messages`,
 * which `authenticated` did not hold and no policy admitted a resident to.
 * Migration 17 fixes the second, so the box can exist for the first time.
 *
 * The delivery notice above this component is unchanged and still true: what is
 * written here is stored and readable in the portal, and nothing is emailed or
 * sent over WhatsApp. Those are separate claims and the interface makes both.
 *
 * ## What it can write
 *
 * One message, into one thread the reader can already open, authored by the
 * signed-in user. The endpoint takes no sender — `createMessageSchema` has no
 * such field — and `messages_insert_participant` independently pins
 * `sender_profile_id` to `auth.uid()`, refuses `sender_kind = 'system'`, and
 * refuses `is_internal_note` below staff. So the three ways this could be abused
 * are each closed twice, and neither time by this component.
 *
 * The textarea clears only after a 200. A composer that empties on submit and
 * then fails has eaten what the person wrote — and on a complaint thread, that
 * is the message they were least willing to type twice.
 */

const COMMUNICATIONS_ENDPOINT = "/api/site-management/communications"

/** The column caps at 10 000; stopping at 4 000 keeps the box a message, not a document. */
const BODY_MAX = 4000

export interface MessageComposerLabels {
  heading: string
  placeholder: string
  submit: string
  busy: string
  empty: string
  genericError: string
  unavailable: string
  /** Sits under the button: says where this goes, and where it does not. */
  scopeNote: string
}

export function MessageComposer({
  threadId,
  labels,
  className,
}: {
  threadId: string
  labels: MessageComposerLabels
  className?: string
}) {
  const router = useRouter()
  const fieldId = useId()
  const [pending, startTransition] = useTransition()
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(async () => {
    const trimmed = body.trim()
    if (trimmed === "") {
      setError(labels.empty)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(COMMUNICATIONS_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId, body: trimmed }),
      })
      const payload = (await response.json()) as ApiResponse<unknown>

      if (response.ok && payload.ok) {
        setBody("")
        // The transcript is server-rendered. Re-read it rather than splicing in
        // a local copy that could disagree with what was actually stored.
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
  }, [body, threadId, labels, router])

  const working = busy || pending

  return (
    <form
      data-slot="message-composer"
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-border bg-card p-4",
        className
      )}
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
        maxLength={BODY_MAX}
        value={body}
        disabled={working}
        onChange={(event) => setBody(event.target.value)}
        placeholder={labels.placeholder}
        className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={working}>
          {working ? labels.busy : labels.submit}
        </Button>
        {error === null ? (
          <p className="text-xs text-muted-foreground">{labels.scopeNote}</p>
        ) : (
          <p role="alert" className="text-sm text-confidence-conflicted">
            {error}
          </p>
        )}
      </div>
    </form>
  )
}
