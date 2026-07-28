import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/cn"

/**
 * What actually happened to an outgoing message.              Owner: W3-E
 *
 * ## The rule this component exists to enforce
 *
 * `tasks/W3-E-modules-operations.md`: *"If outbound email/SMS is not wired
 * here, the UI must say 'nicht versendet, Anbieter nicht konfiguriert' rather
 * than showing a green 'Sent'. A false delivery confirmation is worse than no
 * send at all."*
 *
 * It is worse because of what people do with it. A green tick tells the
 * property manager the resident has been told about the water shut-off, so the
 * manager stops. Nobody was told. The absence of the message is discovered by
 * the resident, at the worst possible moment, and the audit trail says it was
 * delivered.
 *
 * ## What is wired, as shipped tonight
 *
 * **Nothing.** There is no outbound email, SMS, WhatsApp or push provider
 * configured in this repository. `messages` rows persist and are readable in
 * the app; nothing leaves the building. Every message therefore renders
 * `not_configured`, and the copy names the reason rather than saying "pending",
 * which would imply a queue that will eventually drain.
 *
 * `sent` and `delivered` exist in this union because the states are real and a
 * provider will one day set them. They are unreachable today, and
 * `deliveryStateFor()` is the single place that decides, so a future provider
 * turns them on in one file rather than eleven call sites.
 */

export type DeliveryState =
  /** Stored in the product. Nothing was transmitted, because nothing can be. */
  | "not_configured"
  /** Handed to a provider, not yet acknowledged. */
  | "queued"
  | "sent"
  | "delivered"
  | "failed"
  /** An internal note. Never had a recipient outside the building. */
  | "internal_note"

export type DeliveryLabels = Record<DeliveryState, string>

const treatment: Record<
  DeliveryState,
  { variant: "gap" | "muted" | "outline" | "confirmed" | "destructive" }
> = {
  // `gap`, the same variant an unsourced value gets. Not `destructive`: nothing
  // is broken. The capability is absent, which is a different fact from a
  // failure, and conflating them would send someone to look for an outage.
  not_configured: { variant: "gap" },
  queued: { variant: "outline" },
  sent: { variant: "outline" },
  delivered: { variant: "confirmed" },
  failed: { variant: "destructive" },
  internal_note: { variant: "muted" },
}

/**
 * Whether any outbound channel is configured.
 *
 * A constant, and deliberately not an environment lookup: there is no provider
 * variable to read, and inventing one (`OUTBOUND_EMAIL_URL ?? …`) would make the
 * UI's honesty depend on a variable nobody sets, which is how a false green
 * appears the first time somebody exports an unrelated key.
 */
export const OUTBOUND_PROVIDER_CONFIGURED = false

export function deliveryStateFor(message: {
  isInternalNote?: boolean
}): DeliveryState {
  if (message.isInternalNote === true) return "internal_note"
  return OUTBOUND_PROVIDER_CONFIGURED ? "queued" : "not_configured"
}

export function DeliveryBadge({
  state,
  labels,
}: {
  state: DeliveryState
  labels: DeliveryLabels
}) {
  return <Badge variant={treatment[state].variant}>{labels[state]}</Badge>
}

/**
 * The page-level statement, rendered once above a thread rather than once per
 * message.
 *
 * Per-row badges answer "what happened to this one"; a reader scanning them can
 * still come away thinking one particular message failed. This says the thing
 * once, in a sentence, about the whole surface.
 */
export function DeliveryNotice({
  title,
  body,
  className,
}: {
  title: string
  body: string
  className?: string
}) {
  return (
    <div
      role="status"
      className={cn(
        "rounded-lg border border-confidence-gap/30 bg-confidence-gap/10 px-4 py-3",
        className
      )}
    >
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">{body}</p>
    </div>
  )
}
