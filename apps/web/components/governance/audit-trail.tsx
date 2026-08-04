import type { ReactNode } from "react"

import { Link } from "@/app/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { GovernanceTableFrame } from "@/components/governance/governance-table"
import { cn } from "@/lib/cn"
import type { Locale } from "@/lib/contracts"
import { formatDateTime } from "@/lib/format"
import type { AuditEventRecord } from "@/lib/governance-data"

/**
 * The audit-event browser.                                      Owner: W3-F
 *
 * ## Server-side paging, and no client component at all
 *
 * `tasks/W3-F` edge case: *"Audit browser with 100k events → server-side
 * pagination and filtering, never client-side."* This component receives **one
 * page** of rows and renders it. It cannot do otherwise: there is no state, no
 * effect and no fetch here, so there is no way for a later edit to quietly start
 * loading the whole table and filtering it in the browser.
 *
 * Paging is `<Link>`s carrying `?auditPage=`, which also means the browser's
 * back button works, a page of the log is a URL somebody can send, and the whole
 * surface functions with JavaScript disabled. Same choice, same reasons, as
 * W3-C's 656-row units table.
 *
 * ## There is no edit control and no delete control
 *
 * Not disabled ones. Absent ones. `audit_events` is append-only: `authenticated`
 * holds no `update` or `delete` grant, and `reject_append_only_mutation()` is a
 * `BEFORE UPDATE OR DELETE` trigger that raises `42501` regardless. A row action
 * here would be a button that can only ever produce an error, which teaches a
 * user that errors are normal.
 *
 * ## Payload rendering
 *
 * `before_data` / `after_data` are shown as compact key/value pairs rather than
 * raw JSON, and only for the keys the writer chose to record. The migration's
 * own comment is the rule: *"Store the changed columns, not the whole payload."*
 */

export interface AuditTrailLabels {
  caption: string
  emptyTitle: string
  emptyBody: string
  appendOnlyNotice: string
  columns: {
    when: string
    action: string
    entity: string
    actor: string
    change: string
  }
  unknownActor: string
  noChange: string
  previous: string
  next: string
  page: string
}

/** `users.role_change.refused.last_admin` → an amber row. */
function isRefusal(action: string): boolean {
  return action.includes(".refused.")
}

function renderPayload(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  fallback: string
): ReactNode {
  const keys = Array.from(
    new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  )
  if (keys.length === 0)
    return <span className="text-muted-foreground">{fallback}</span>

  return (
    <span className="flex flex-col gap-0.5">
      {keys.map((key) => (
        <span key={key} className="font-mono text-xs">
          <span className="text-muted-foreground">{key}: </span>
          {String(before?.[key] ?? "")}
          {" → "}
          {String(after?.[key] ?? "")}
        </span>
      ))}
    </span>
  )
}

export function AuditTrail({
  events,
  locale,
  labels,
  page,
  hasNextPage,
  hrefForPage,
  actorNames,
  className,
}: {
  /** ONE page. Never the whole table. */
  events: readonly AuditEventRecord[]
  /**
   * `profiles.id` → the person's name, resolved server-side.
   *
   * The actor column rendered `actorProfileId` directly and printed four raw
   * uuids on `/dashboard/admin` — the last text defect in a 119-page sweep, and
   * the worst place for one: this is the table whose entire purpose is
   * answering "who did this", and it answered with a row id.
   *
   * Optional, and absent means "nothing was resolved", never "resolve it here":
   * a client component cannot ask the directory. An unresolved id falls through
   * to the stated `unknownActor` label rather than back to the uuid.
   */
  actorNames?: Readonly<Record<string, string>>
  locale: Locale
  labels: AuditTrailLabels
  /** 1-based. */
  page: number
  hasNextPage: boolean
  hrefForPage: (page: number) => string
  className?: string
}): ReactNode {
  if (events.length === 0) {
    return (
      <div className={cn("flex min-w-0 flex-col gap-3", className)}>
        <EmptyState title={labels.emptyTitle} description={labels.emptyBody} />
      </div>
    )
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      <GovernanceTableFrame>
        <Table>
          <TableCaption>{labels.caption}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{labels.columns.when}</TableHead>
              <TableHead>{labels.columns.action}</TableHead>
              <TableHead>{labels.columns.entity}</TableHead>
              <TableHead>{labels.columns.actor}</TableHead>
              <TableHead>{labels.columns.change}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.id} data-refusal={isRefusal(event.action)}>
                <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                  {formatDateTime(event.createdAt, locale)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={isRefusal(event.action) ? "conflicted" : "muted"}
                  >
                    <span className="font-mono">{event.action}</span>
                  </Badge>
                </TableCell>
                {/* What was changed, in terms a reader recognises.

                    This printed `entityTable · entityId`, and for a `profiles`
                    row that is a person's uuid — so an audit line about a role
                    change named neither the actor nor the subject. Resolved
                    through the same directory the actor column uses.

                    Everything else shortens to `#` plus eight characters: a
                    ticket or document id is not a name and cannot be resolved
                    here, but a full uuid in a table cell is the database
                    showing through, and eight characters is enough to match a
                    row against the register it came from. Same reference form
                    the compliance register settled on. */}
                <TableCell className="font-mono text-xs">
                  {event.entityTable}
                  {event.entityId === null
                    ? ""
                    : ` · ${
                        (event.entityTable === "profiles"
                          ? actorNames?.[event.entityId]
                          : undefined) ?? `#${event.entityId.slice(0, 8)}`
                      }`}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {event.actorProfileId === null
                    ? labels.unknownActor
                    : (actorNames?.[event.actorProfileId] ??
                      labels.unknownActor)}
                </TableCell>
                <TableCell>
                  {renderPayload(
                    event.beforeData,
                    event.afterData,
                    labels.noChange
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </GovernanceTableFrame>

      <div className="flex flex-wrap items-center gap-3">
        {page > 1 ? (
          <Button
            variant="outline"
            size="sm"
            render={<Link href={hrefForPage(page - 1)} locale={locale} />}
          >
            {labels.previous}
          </Button>
        ) : null}
        <span className="text-xs text-muted-foreground tabular-nums">
          {labels.page} {page}
        </span>
        {hasNextPage ? (
          <Button
            variant="outline"
            size="sm"
            render={<Link href={hrefForPage(page + 1)} locale={locale} />}
          >
            {labels.next}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
