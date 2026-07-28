"use client"

import { useActionState, useId } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/input"
import { cn } from "@/lib/cn"
import type { Locale, Role } from "@/lib/contracts"
import type { UserAdminState } from "@/app/[locale]/dashboard/users/actions"

/**
 * The role-assignment control.                                  Owner: W3-F
 *
 * A client component because it needs `useActionState`, and nothing more. It
 * holds **no** authorisation logic: the page decides whether to render it at
 * all, and the action decides again server-side. Hiding this panel from a
 * `manager` is a courtesy; `decideRoleChange` is the boundary.
 *
 * ## The subject list never contains the current user
 *
 * `decideRoleChange` refuses a self change regardless (`self_elevation` /
 * `self_role_change`), so this is not the control — it is the UI agreeing with
 * the control instead of offering an action that will always fail. Both halves
 * matter: an interface that offers a forbidden option teaches users that
 * refusals are arbitrary.
 *
 * ## Every outcome is rendered, including the awkward one
 *
 * `incomplete` means the role changed and the log entry did not. It gets its own
 * visible treatment rather than being folded into success or failure, because
 * that is precisely the state an operator needs to act on.
 */

/**
 * NOTE: the initial state is NOT exported from the `"use server"` module.
 * Next 16 refuses a server-action file that exports anything other than an
 * async function ("A \"use server\" file can only export async functions,
 * found object"), and it is a build error rather than a warning. The TYPE is
 * still imported from there, because `import type` is erased.
 */
const INITIAL_STATE: UserAdminState = { status: "idle" }

export interface RoleOption {
  value: Role
  label: string
}

export interface DirectoryOption {
  id: string
  label: string
  role: Role | null
  isActive: boolean
}

export interface RoleAssignmentLabels {
  person: string
  role: string
  submit: string
  submitting: string
  noCandidates: string
  elevationWarning: string
  statusHeading: string
}

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

export function RoleAssignmentPanel({
  action,
  locale,
  candidates,
  roleOptions,
  labels,
  className,
}: {
  action: (
    previous: UserAdminState,
    formData: FormData
  ) => Promise<UserAdminState>
  locale: Locale
  candidates: readonly DirectoryOption[]
  roleOptions: readonly RoleOption[]
  labels: RoleAssignmentLabels
  className?: string
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE)
  const personId = useId()
  const roleId = useId()

  if (candidates.length === 0) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        {labels.noCandidates}
      </p>
    )
  }

  return (
    <form
      action={formAction}
      className={cn("flex min-w-0 flex-col gap-4", className)}
    >
      <input type="hidden" name="locale" value={locale} />

      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor={personId}>{labels.person}</Label>
          <select
            id={personId}
            name="subjectId"
            required
            className="h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor={roleId}>{labels.role}</Label>
          <select
            id={roleId}
            name="role"
            required
            className="h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {roleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit" disabled={pending} className="shrink-0">
          {pending ? labels.submitting : labels.submit}
        </Button>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {labels.elevationWarning}
      </p>

      {state.status === "idle" ? null : (
        <div
          role="status"
          data-testid="role-assignment-result"
          data-status={state.status}
          className={cn(
            "flex min-w-0 flex-col gap-1 rounded-lg border px-3 py-2 text-sm",
            STATE_TONE[state.status]
          )}
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{labels.statusHeading}</span>
            {state.status === "refused" ? (
              // The HTTP status an equivalent request would have received. It
              // makes the refusal citable in a bug report, and it is what
              // `tasks/W3-F`'s definition of done asks to see.
              <Badge variant="destructive">{state.httpStatus}</Badge>
            ) : null}
          </span>
          <span>{state.message}</span>
        </div>
      )}
    </form>
  )
}
