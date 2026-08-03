"use client"

import { useActionState, useId, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/input"
import { cn } from "@/lib/cn"
import type { Locale } from "@/lib/contracts"
import type { DirectoryOption } from "@/components/governance/role-assignment-panel"
import type { UserAdminState } from "@/app/[locale]/dashboard/users/actions"

/**
 * Blocking and unblocking an account.
 *
 * `setActivation` has existed in `users/actions.ts` since W3-F and had no caller.
 * Migration 21 records the deactivate control on this page as one of the two
 * things "shipped, documented, and broken" — it was worse than broken: the
 * server action was correct and complete, and there was nothing on the page to
 * invoke it. This is that control.
 *
 * ## Why it is not part of the role panel
 *
 * They are two different sentences about a person. Folding activation into the
 * role form would make one submit button mean "and also change whether they can
 * sign in", which is exactly the kind of compound authority change that has to
 * be deliberate. `decideActivationChange` is a separate decision in
 * `role-policy.ts`; the UI keeps the same seam.
 *
 * ## The button offers the change that is possible, not both
 *
 * `decideActivationChange` refuses `no_change` — setting a blocked account to
 * blocked writes nothing and returns a refusal. So the target state is derived
 * from the selected person rather than picked, and the button says what it will
 * do. An interface that offers an option which can only fail teaches its users
 * that refusals are arbitrary; `RoleAssignmentPanel` omits the current user from
 * its list for the same reason.
 *
 * It holds no authorisation logic. The page decides whether to render it and the
 * action decides again, server-side, against RLS and two triggers.
 */

/**
 * NOTE: not exported from the `"use server"` module. Next 16 refuses a server
 * action file that exports anything but async functions, and it is a build
 * error. The TYPE crosses that boundary because `import type` is erased.
 */
const INITIAL_STATE: UserAdminState = { status: "idle" }

/**
 * Duplicated from `role-assignment-panel.tsx`, which does not export it. The two
 * panels report the same `UserAdminState` and must not disagree about which
 * outcome looks like success — if this map is ever edited, edit both.
 */
const STATE_TONE: Readonly<Record<UserAdminState["status"], string>> =
  Object.freeze({
    idle: "",
    saved:
      "border-confidence-confirmed/40 bg-confidence-confirmed/10 text-confidence-confirmed",
    incomplete:
      "border-confidence-conflicted/45 bg-surface-conflict text-confidence-conflicted",
    refused: "border-destructive/40 bg-destructive/5 text-destructive",
    invalid: "border-destructive/40 bg-destructive/5 text-destructive",
    unavailable:
      "border-quality-stale/40 bg-quality-stale/10 text-quality-stale",
  })

export interface UserActivationLabels {
  person: string
  currentStatus: string
  active: string
  inactive: string
  block: string
  unblock: string
  submitting: string
  noCandidates: string
  note: string
  statusHeading: string
}

export function UserActivationPanel({
  action,
  locale,
  candidates,
  labels,
  className,
}: {
  action: (
    previous: UserAdminState,
    formData: FormData
  ) => Promise<UserAdminState>
  locale: Locale
  candidates: readonly DirectoryOption[]
  labels: UserActivationLabels
  className?: string
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE)
  const personId = useId()
  const first = candidates[0]
  const [subjectId, setSubjectId] = useState<string>(first?.id ?? "")

  // `noUncheckedIndexedAccess` is on, and the selection can also be stale for one
  // render after the directory revalidates, so the lookup is allowed to miss.
  const selected =
    candidates.find((candidate) => candidate.id === subjectId) ?? first ?? null

  if (selected === null) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        {labels.noCandidates}
      </p>
    )
  }

  const willActivate = !selected.isActive

  return (
    <form
      action={formAction}
      className={cn("flex min-w-0 flex-col gap-4", className)}
    >
      <input type="hidden" name="locale" value={locale} />
      {/* The target state, derived from the stored one. The server derives it
          again from the row it reads, so a stale value here loses the version
          guard rather than writing the wrong thing. */}
      <input
        type="hidden"
        name="activate"
        value={willActivate ? "true" : "false"}
      />

      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor={personId}>{labels.person}</Label>
          <select
            id={personId}
            name="subjectId"
            required
            value={selected.id}
            onChange={(event) => setSubjectId(event.target.value)}
            className="h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex shrink-0 flex-col gap-1.5">
          <span className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
            {labels.currentStatus}
          </span>
          <span className="flex h-9 items-center">
            <Badge variant={selected.isActive ? "confirmed" : "destructive"}>
              {selected.isActive ? labels.active : labels.inactive}
            </Badge>
          </span>
        </div>

        <Button
          type="submit"
          disabled={pending}
          variant={willActivate ? "default" : "destructive"}
          className="shrink-0"
        >
          {pending
            ? labels.submitting
            : willActivate
              ? labels.unblock
              : labels.block}
        </Button>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {labels.note}
      </p>

      {state.status === "idle" ? null : (
        <div
          role="status"
          data-testid="user-activation-result"
          data-status={state.status}
          className={cn(
            "flex min-w-0 flex-col gap-1 rounded-lg border px-3 py-2 text-sm",
            STATE_TONE[state.status]
          )}
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{labels.statusHeading}</span>
            {state.status === "refused" ? (
              <Badge variant="destructive">{state.httpStatus}</Badge>
            ) : null}
          </span>
          <span>{state.message}</span>
        </div>
      )}
    </form>
  )
}
