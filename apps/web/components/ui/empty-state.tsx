import type { LucideIcon } from "lucide-react"
import { AlertTriangle, FilterX, Inbox, RotateCw } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/cn"

import { Button } from "./button"
import { Skeleton } from "./skeleton"

/**
 * The states of a data surface, as one contract.           Owner: W1-D
 *
 * CONVENTIONS §5 requires every data surface to handle empty, loading, error
 * and partial — "four states, not one". W1-D's brief §5 restates it: a
 * component that only has the populated state is sent back in review.
 *
 * `DataSurface` makes the states a type rather than a discipline. A caller
 * cannot render a list without having said what happens when it is empty,
 * because `empty` is a required prop.
 *
 * "Empty" is then split in two, because it is two different claims: nothing
 * exists (`EmptyState`) versus nothing survived the filter
 * (`FilteredEmptyState`). Only the second one can be resolved by the user, so
 * only the second one is required to offer the resolution.
 *
 * Deliberately NOT a spinner-in-the-middle. A skeleton in the shape of the
 * real content preserves the layout, and a spinner that resolves into a
 * different-sized thing is the CLS bug the skeleton exists to prevent.
 */

// ---------------------------------------------------------------------------
// Empty
// ---------------------------------------------------------------------------

/**
 * Empty state. `description` is required on purpose — "No results" alone tells
 * a user nothing about whether they filtered too hard, the data has not
 * arrived, or none exists. An empty state that does not explain itself is a
 * dead end.
 */
function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon
  title: string
  description: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex min-w-0 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-input px-6 py-12 text-center",
        className
      )}
    >
      <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
      <div className="flex max-w-prose flex-col gap-1.5">
        <p className="font-display text-base font-semibold text-foreground">
          {title}
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Filtered-empty
// ---------------------------------------------------------------------------

/**
 * The empty state that is NOT a data problem.
 *
 * A user who narrowed a filter until nothing matched, and is then shown the
 * ordinary "no data" panel, concludes the system is broken — or worse, that
 * the records were deleted. This is the state everyone forgets, and on an
 * evidence product it is the expensive one to get wrong: "no units match" and
 * "we hold no units" are opposite claims about the world.
 *
 * So it is a separate component rather than an `EmptyState` with a different
 * string, and it differs on three axes at once, not just wording:
 *
 *   - a different icon (`FilterX`, not `Inbox`) — WCAG 1.4.1, the distinction
 *     survives greyscale and does not rest on copy alone;
 *   - `role="status"`, a polite live region rather than a silent swap. Do not
 *     over-read it: a live region inserted into the DOM together with its own
 *     text is announced inconsistently (NVDA and JAWS routinely miss it). It
 *     is dependable only where the surface keeps the region mounted across the
 *     change, and that is the caller's layout, not this component's. It is
 *     still the correct role and never worse than the silent alternative, but
 *     it is not on its own a guarantee that the collapse is heard;
 *   - `onClear` + `clearLabel` are REQUIRED. The state names its own exit.
 *     That mirrors `ErrorState`'s required `onRetry`: a dead end is a bug.
 *
 * Same client-boundary caveat as `ErrorState` — `onClear` is a function, so a
 * caller of this is necessarily a Client Component. For a filter held in the
 * URL, pass a router push (or clear the search params) from a client wrapper;
 * `EmptyState` remains the server-safe one.
 *
 * Every user-visible string is a prop. Nothing here is hardcoded, because
 * these surfaces are rendered under next-intl in de/en/tr.
 */
function FilteredEmptyState({
  icon: Icon = FilterX,
  title,
  description,
  clearLabel,
  onClear,
  action,
  className,
}: {
  icon?: LucideIcon
  title: string
  /** Say what was filtered out, not just that nothing matched. */
  description: string
  clearLabel: string
  onClear: () => void
  /** Optional second affordance, e.g. "edit filters" beside "clear filters". */
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="filtered-empty-state"
      role="status"
      className={cn(
        "flex min-w-0 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-input px-6 py-12 text-center",
        className
      )}
    >
      <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
      <div className="flex max-w-prose flex-col gap-1.5">
        <p className="font-display text-base font-semibold text-foreground">
          {title}
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="outline" size="sm" onClick={onClear}>
          <FilterX aria-hidden="true" />
          {clearLabel}
        </Button>
        {action}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/**
 * Error state. Recoverable by construction: `onRetry` is required, because an
 * error a user can only stare at is a dead end too.
 *
 * `message` must already be display-safe. CONVENTIONS §4.7 forbids letting a
 * Postgres or upstream message reach the client — route handlers map to
 * `ApiError.message` first, and that is what belongs here.
 */
function ErrorState({
  title,
  message,
  retryLabel,
  onRetry,
  className,
}: {
  title: string
  message: string
  retryLabel: string
  onRetry: () => void
  className?: string
}) {
  return (
    <div
      data-slot="error-state"
      role="alert"
      className={cn(
        "flex min-w-0 flex-col items-center justify-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-6 py-12 text-center",
        className
      )}
    >
      <AlertTriangle className="size-6 text-destructive" aria-hidden="true" />
      <div className="flex max-w-prose flex-col gap-1.5">
        <p className="font-display text-base font-semibold text-foreground">
          {title}
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {message}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCw aria-hidden="true" />
        {retryLabel}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** Skeleton stack shaped like the rows it stands in for. */
function LoadingState({
  rows = 4,
  label,
  className,
}: {
  rows?: number
  /** Announced to assistive tech. The skeletons themselves are aria-hidden. */
  label: string
  className?: string
}) {
  return (
    <div
      data-slot="loading-state"
      aria-busy="true"
      aria-live="polite"
      className={cn("flex min-w-0 flex-col gap-3", className)}
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} preset="control" />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The switch
// ---------------------------------------------------------------------------

/**
 * Which state a surface is currently in.
 *
 * `"filtered-empty"` is distinct from `"empty"` on purpose — see
 * `FilteredEmptyState`. "Nothing matches your filter" and "we hold no records"
 * are different claims, and collapsing them is how a working system gets
 * reported as broken.
 */
export type SurfaceState =
  "loading" | "error" | "empty" | "filtered-empty" | "ready"

interface DataSurfaceSlots {
  loading: ReactNode
  error: ReactNode
  empty: ReactNode
  children: ReactNode
}

/**
 * `filteredEmpty` is required exactly when it can be reached.
 *
 * A caller whose `state` cannot be `"filtered-empty"` — every caller that
 * existed before this union did — is unaffected and may omit the slot. A
 * caller that CAN reach the state must supply the node, the same way `empty`
 * and `error` have always been required. That is the point of the file: the
 * states are a type, not a discipline someone has to remember.
 */
type DataSurfaceProps =
  | (DataSurfaceSlots & {
      state: Exclude<SurfaceState, "filtered-empty">
      filteredEmpty?: ReactNode
    })
  | (DataSurfaceSlots & {
      state: "filtered-empty"
      filteredEmpty: ReactNode
    })

/**
 * Renders exactly one state.
 *
 * `empty` and `error` are required props, not optional slots — that is the
 * whole point. If a surface has no sensible empty state, that is a design
 * question to answer before shipping it, not a prop to omit.
 */
function DataSurface(props: DataSurfaceProps): ReactNode {
  switch (props.state) {
    case "loading":
      return props.loading
    case "error":
      return props.error
    case "empty":
      return props.empty
    case "filtered-empty":
      return props.filteredEmpty
    case "ready":
      return props.children
  }
}

export type { DataSurfaceProps }
export { EmptyState, FilteredEmptyState, ErrorState, LoadingState, DataSurface }
