import { Lock, FileClock } from "lucide-react"
import type { ReactNode } from "react"

import { Link } from "@/app/navigation"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScrollArea,
} from "@/components/ui/table"
import { cn } from "@/lib/cn"
import type { Locale } from "@/lib/contracts"
import { formatDate } from "@/lib/format"
import type {
  LedgerEntry,
  LedgerEntryStatus,
  LedgerEntryType,
} from "@/lib/finance-repository"

import { MoneyCell } from "./currency-total-list"
import { toMinor } from "./money"

/**
 * The ledger, and the rule that governs it.                    Owner: W3-D
 *
 * ## The affordance rule, stated where it is implemented
 *
 * `prevent_posted_ledger_mutation` (W1-A, migration 07) rejects UPDATE **and**
 * DELETE on a posted row with SQLSTATE 23514 for every role including the
 * service key. So the edit control on a posted row is not merely hidden here,
 * it is rendered **disabled with its reason attached** — the brief's wording is
 * "a disabled control that explains itself beats an enabled one that 409s", and
 * an absent control would leave a reader wondering whether they lack a
 * permission or the row is frozen. Those are different facts.
 *
 * The reason is **visible page text**, not a `title` tooltip. A tooltip is
 * invisible to touch and to a screen reader (azura-ui-ux §5.3), and this is the
 * single most consequential thing on the page. It lives once, in the panel
 * above the table, and every locked control points at it with
 * `aria-describedby`. One sentence, associated with twelve controls, rather
 * than twelve copies of it in the DOM.
 *
 * ## Posted rows are distinct while SCANNING, not only while reading
 *
 * A posted row carries a left accent and a lock glyph; a draft carries an amber
 * accent and a stated "draft, not yet posted" — never an edit control, because
 * there is no edit path and there is not going to be one:
 * `finance-repository.ts` has no `updateLedgerEntry()`, since a posted entry is
 * corrected by a reversal. This column used to render a pencil and the words
 * "Edit draft" beside "Posted, locked" and "Void, locked", so two rows stated a
 * state and the third offered an action that led nowhere.
 *
 * Colour is never the only channel: the status
 * column states it in words, and the disabled control is disabled whatever the
 * theme. That mirrors what W3-C did for modelled units, deliberately, because
 * a second visual language for "this row is different" would be a third thing
 * to learn.
 *
 * ## No client JavaScript
 *
 * A Server Component throughout. Filtering and paging happen through
 * `searchParams` on the page, so this table works with JavaScript disabled and
 * cannot be broken by the CSP class of failure that cost a night (S-009).
 */

export interface LedgerTableLabels {
  caption: string
  columns: {
    date: string
    entryType: string
    description: string
    unit: string
    reference: string
    debit: string
    credit: string
    currency: string
    status: string
    actions: string
  }
  status: Record<LedgerEntryStatus, string>
  entryType: Record<LedgerEntryType, string>
  locked: string
  voidLocked: string
  draftOpen: string
  /** Id of the element carrying the full explanation. */
  reasonElementId: string
  gapLabel: string
  reversalOf: (id: string) => string
}

export function LedgerTable({
  entries,
  locale,
  labels,
  statementHrefFor,
  height = 560,
}: {
  entries: readonly LedgerEntry[]
  locale: Locale
  labels: LedgerTableLabels
  /** Drill-through to a unit statement. Omitted when the caller may not link. */
  statementHrefFor?: (unitId: string) => string
  height?: number
}): ReactNode {
  return (
    <TableScrollArea height={height}>
      <Table>
        <TableCaption>{labels.caption}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{labels.columns.date}</TableHead>
            <TableHead>{labels.columns.entryType}</TableHead>
            <TableHead>{labels.columns.description}</TableHead>
            <TableHead>{labels.columns.unit}</TableHead>
            <TableHead>{labels.columns.reference}</TableHead>
            <TableHead className="text-right">{labels.columns.debit}</TableHead>
            <TableHead className="text-right">
              {labels.columns.credit}
            </TableHead>
            <TableHead>{labels.columns.currency}</TableHead>
            <TableHead>{labels.columns.status}</TableHead>
            <TableHead>{labels.columns.actions}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <LedgerRow
              key={entry.id}
              entry={entry}
              locale={locale}
              labels={labels}
              {...(statementHrefFor === undefined
                ? {}
                : { statementHrefFor })}
            />
          ))}
        </TableBody>
      </Table>
    </TableScrollArea>
  )
}

function LedgerRow({
  entry,
  locale,
  labels,
  statementHrefFor,
}: {
  entry: LedgerEntry
  locale: Locale
  labels: LedgerTableLabels
  statementHrefFor?: (unitId: string) => string
}): ReactNode {
  const frozen = entry.status !== "draft"
  const postedOn = entry.postedAt ?? entry.dueDate

  return (
    <TableRow
      data-status={entry.status}
      className={cn(
        "border-l-2",
        entry.status === "posted" && "border-l-confidence-confirmed",
        entry.status === "draft" &&
          "border-l-confidence-conflicted bg-confidence-conflicted/5",
        entry.status === "void" &&
          "border-l-muted-foreground/30 text-muted-foreground"
      )}
    >
      <TableCell className="tabular-nums whitespace-nowrap">
        {postedOn === null ? (
          <span className="text-confidence-gap">{labels.gapLabel}</span>
        ) : (
          formatDate(postedOn, locale)
        )}
      </TableCell>

      <TableCell className="whitespace-nowrap">
        {labels.entryType[entry.entryType]}
      </TableCell>

      <TableCell className="max-w-[22rem]">
        <span className="block truncate">
          {entry.description ?? (
            <span className="text-confidence-gap">{labels.gapLabel}</span>
          )}
        </span>
        {entry.reversalOf === null ? null : (
          // A correction says what it corrects, in the row, not only in a
          // detail view. That link is the whole reason reversal exists.
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {labels.reversalOf(entry.reversalOf)}
          </span>
        )}
      </TableCell>

      <TableCell className="tabular-nums whitespace-nowrap">
        {entry.unitId === null ? (
          <span className="text-muted-foreground">{labels.gapLabel}</span>
        ) : statementHrefFor === undefined ? (
          entry.unitId
        ) : (
          <Link
            href={statementHrefFor(entry.unitId)}
            className="underline decoration-dotted underline-offset-4 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {entry.unitId}
          </Link>
        )}
      </TableCell>

      <TableCell className="max-w-[12rem] truncate whitespace-nowrap">
        {entry.reference ?? (
          <span className="text-muted-foreground">{labels.gapLabel}</span>
        )}
      </TableCell>

      <TableCell className="text-right">
        <MoneyCell
          minor={toMinor(entry.debitAmount)}
          currency={entry.currency}
          locale={locale}
          gapLabel={labels.gapLabel}
        />
      </TableCell>

      <TableCell className="text-right">
        <MoneyCell
          minor={toMinor(entry.creditAmount)}
          currency={entry.currency}
          locale={locale}
          gapLabel={labels.gapLabel}
        />
      </TableCell>

      {/* The currency is its OWN column, at the same weight as the amount. A
          currency worn as a symbol inside a right-aligned number column is
          easy to skim past, and skimming past it is exactly how somebody adds
          EUR to TRY. */}
      <TableCell className="font-mono text-[0.6875rem] tracking-[0.14em] uppercase">
        {entry.currency ?? (
          <span className="text-confidence-gap">{labels.gapLabel}</span>
        )}
      </TableCell>

      <TableCell className="whitespace-nowrap">
        {labels.status[entry.status]}
      </TableCell>

      <TableCell>
        {frozen ? (
          <LockedControl
            label={
              entry.status === "void" ? labels.voidLocked : labels.locked
            }
            describedBy={labels.reasonElementId}
          />
        ) : (
          /* A status, not an affordance.

             This rendered a pencil icon and the words "Edit draft", in a column
             whose other two values are "Posted, locked" and "Void, locked" — so
             two rows stated a state and the third offered an action. It was a
             plain `<span>`: not a button, not a link, and there is nothing for
             it to have been. `finance-repository.ts` says so in its own header:
             there is no `updateLedgerEntry()` and there will not be one, because
             a posted entry is corrected by a reversal and never by an edit.

             An accountant looking for the edit control this promised would have
             looked until they gave up. The row now says what is true — the entry
             is a draft and has not been posted — in the same grammar as its
             neighbours. */
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <FileClock className="size-3.5" aria-hidden="true" />
            {labels.draftOpen}
          </span>
        )}
      </TableCell>
    </TableRow>
  )
}

/**
 * A control that is present, obviously unavailable, and says why.
 *
 * `disabled` rather than absent, and a real `<button>` rather than a styled
 * `<span>`, because the three states a reader has to tell apart are "you may do
 * this", "this cannot be done to this row" and "you lack the permission". An
 * absent control collapses the last two into one.
 *
 * `aria-describedby` points at the explanation panel above the table, so the
 * reason reaches a screen reader without repeating a paragraph in every row.
 * A disabled button is not focusable, so the description is announced when the
 * row is read rather than on focus, which is why the panel is also visible
 * text and not only an `aria-describedby` target.
 */
function LockedControl({
  label,
  describedBy,
}: {
  label: string
  describedBy: string
}): ReactNode {
  return (
    <button
      type="button"
      disabled
      aria-describedby={describedBy}
      className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground"
    >
      <Lock className="size-3" aria-hidden="true" />
      {label}
    </button>
  )
}

/**
 * The explanation the locked controls point at. Rendered once per page, above
 * the table, as ordinary visible prose.
 */
export function ImmutabilityNotice({
  id,
  heading,
  body,
  className,
}: {
  id: string
  heading: string
  body: string
  className?: string
}): ReactNode {
  return (
    <div
      id={id}
      className={cn(
        "flex flex-col gap-1.5 rounded-xl border border-confidence-confirmed/30 bg-confidence-confirmed/5 px-4 py-3",
        className
      )}
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Lock className="size-3.5" aria-hidden="true" />
        {heading}
      </p>
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  )
}
