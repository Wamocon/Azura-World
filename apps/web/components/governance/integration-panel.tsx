"use client"

import { CircleSlash, HelpCircle, PlugZap, XCircle } from "lucide-react"
import { useActionState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/cn"
import type { Locale } from "@/lib/contracts"
import type {
  IntegrationState,
  IntegrationStatus,
} from "@/app/[locale]/dashboard/admin/integrations"
import type { ProbeState } from "@/app/[locale]/dashboard/admin/actions"

/**
 * Integration status, rendered without overclaiming.            Owner: W3-F
 *
 * ## There is no green tick for "configured"
 *
 * The badge variants are chosen so that the *only* affirmative treatment in this
 * component is `reachable`, and `reachable` is unreachable (in the other sense)
 * without somebody pressing the button. Everything derived from configuration
 * alone renders neutral or amber. That is `tasks/W3-F`'s rule made structural:
 * you cannot render an unconfigured provider as healthy here, because no code
 * path maps `not_configured` to the confirmed variant.
 *
 * | state                   | variant     | reads as                      |
 * |-------------------------|-------------|-------------------------------|
 * | `not_configured`        | `gap`       | absent, and honest about it   |
 * | `configured_unverified` | `single`    | present, unproven             |
 * | `reachable`             | `confirmed` | observed, once, just now      |
 * | `unreachable`           | `conflicted`| observed, and it did not answer |
 *
 * This mirrors the confidence ladder the rest of the product uses for facts,
 * on purpose: "we have a setting for it" is a `single_source` claim about an
 * integration in exactly the way one portal's price is a `single_source` claim
 * about a flat.
 */

/**
 * NOTE: the initial state is NOT exported from the `"use server"` module.
 * Next 16 refuses a server-action file that exports anything other than an
 * async function ("A \"use server\" file can only export async functions,
 * found object"), and it is a build error rather than a warning. The TYPE is
 * still imported from there, because `import type` is erased.
 */
const INITIAL_STATE: ProbeState = { status: "idle" }

export interface IntegrationLabels {
  heading: string
  none: string
  wiredFalse: string
  readFrom: string
  check: string
  checking: string
  forbidden: string
  invalid: string
  latency: string
  /** `not_configured` | `configured_unverified` | `reachable` | `unreachable` */
  state: Record<IntegrationState, string>
  name: Record<string, string>
  note: Record<string, string>
}

const STATE_VARIANT: Readonly<
  Record<IntegrationState, "gap" | "single" | "confirmed" | "conflicted">
> = Object.freeze({
  not_configured: "gap",
  configured_unverified: "single",
  reachable: "confirmed",
  unreachable: "conflicted",
})

const STATE_ICON = Object.freeze({
  not_configured: CircleSlash,
  configured_unverified: HelpCircle,
  reachable: PlugZap,
  unreachable: XCircle,
})

export function IntegrationPanel({
  statuses,
  action,
  locale,
  labels,
  className,
}: {
  statuses: readonly IntegrationStatus[]
  action: (previous: ProbeState, formData: FormData) => Promise<ProbeState>
  locale: Locale
  labels: IntegrationLabels
  className?: string
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE)

  const observedState =
    state.status === "observed" ? state.observation.state : null

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      <ul className="flex min-w-0 flex-col gap-2">
        {statuses.map((status) => {
          // An observation only overrides the provider it was taken for, and
          // only for as long as this form's state survives. It is never written
          // back into `integrationStatuses()`, which stays a pure read of
          // configuration.
          const effective: IntegrationState =
            observedState !== null &&
            state.status === "observed" &&
            state.observation.id === status.id
              ? observedState
              : status.state
          const Icon = STATE_ICON[effective]

          return (
            <li
              key={status.id}
              data-testid={`integration-${status.id}`}
              data-state={effective}
              className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-lg border border-input px-3 py-2.5"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Icon
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="min-w-0 text-sm font-medium">
                  {labels.name[status.id] ?? status.id}
                </span>
              </span>

              <span className="flex flex-wrap items-center gap-2">
                {status.wired ? null : (
                  <Badge variant="muted">{labels.wiredFalse}</Badge>
                )}
                <Badge variant={STATE_VARIANT[effective]}>
                  {labels.state[effective]}
                </Badge>
              </span>

              <span className="w-full text-xs leading-relaxed text-muted-foreground">
                {labels.note[status.id] ?? ""}{" "}
                <span className="whitespace-nowrap">
                  {labels.readFrom}{" "}
                  <code className="font-mono">{status.readFrom}</code>
                </span>
              </span>
            </li>
          )
        })}
      </ul>

      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="provider" value="supabase" />
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? labels.checking : labels.check}
        </Button>

        {state.status === "idle" ? null : (
          <span
            role="status"
            data-testid="integration-probe-result"
            data-status={state.status}
            className="text-xs text-muted-foreground"
          >
            {state.status === "forbidden"
              ? labels.forbidden
              : state.status === "invalid"
                ? labels.invalid
                : state.observation.latencyMs === null
                  ? state.message
                  : `${state.message} · ${labels.latency} ${state.observation.latencyMs} ms`}
          </span>
        )}
      </form>
    </div>
  )
}
