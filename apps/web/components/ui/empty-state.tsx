import type { LucideIcon } from "lucide-react"
import { AlertTriangle, Inbox, RotateCw } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/cn"

import { Button } from "./button"
import { Skeleton } from "./skeleton"

/**
 * The four states, as one contract.                        Owner: W1-D
 *
 * CONVENTIONS §5 requires every data surface to handle empty, loading, error
 * and partial — "four states, not one". W1-D's brief §5 restates it: a
 * component that only has the populated state is sent back in review.
 *
 * `DataSurface` makes the four states a type rather than a discipline. A
 * caller cannot render a list without having said what happens when it is
 * empty, because `empty` is a required prop.
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

/** Which of the four a surface is currently in. */
export type SurfaceState = "loading" | "error" | "empty" | "ready"

/**
 * Renders exactly one of the four states.
 *
 * `empty` and `error` are required props, not optional slots — that is the
 * whole point. If a surface has no sensible empty state, that is a design
 * question to answer before shipping it, not a prop to omit.
 */
function DataSurface({
  state,
  loading,
  error,
  empty,
  children,
}: {
  state: SurfaceState
  loading: ReactNode
  error: ReactNode
  empty: ReactNode
  children: ReactNode
}): ReactNode {
  switch (state) {
    case "loading":
      return loading
    case "error":
      return error
    case "empty":
      return empty
    case "ready":
      return children
  }
}

export { EmptyState, ErrorState, LoadingState, DataSurface }
