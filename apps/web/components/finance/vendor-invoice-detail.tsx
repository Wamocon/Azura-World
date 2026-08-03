"use client"

import { AlertTriangle, Clock } from "lucide-react"
import { useState, type ReactNode } from "react"

import { MoneyCell } from "@/components/finance/currency-total-list"
import type { Minor } from "@/components/finance/money"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
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
import type { CurrencyCode } from "@/lib/finance-repository"
import { formatDate, formatDateTime } from "@/lib/format"

/**
 * The vendor-invoice list, with the whole record one click away.  Owner: W-NIGHT
 *
 * ## Why this island exists
 *
 * `getVendorInvoices` reads eighteen columns and the table has room for nine.
 * The nine it shows are the ones a person scans — vendor, number, status, dates,
 * the three amounts, the currency. The nine it drops are the ones a person needs
 * exactly once, on exactly one row, at the moment they stop scanning and start
 * asking a question about a single invoice: **the tax component**, the free-text
 * **note**, which site and vendor profile the row belongs to, which ledger entry
 * it posted against, whether a document was ever attached, and the row's
 * version and timestamps.
 *
 * Before this, none of those had a surface anywhere in the product. `taxAmount`
 * and `notes` in particular were read out of Postgres on every request, mapped,
 * typed, and then thrown away at render — which is worse than not reading them,
 * because it looks like the data does not exist.
 *
 * ## What it deliberately does not do
 *
 * - **It computes nothing.** Not net-of-tax, not "total minus paid", not a
 *   percentage settled. `outstandingAmount` is the one derived figure and the
 *   repository derives it (`mapVendorInvoice`), in one place, for both seed and
 *   Supabase mode. A second derivation here would be a second answer.
 * - **It never sums across currencies**, and it cannot: each amount is rendered
 *   by `MoneyCell` beside the invoice's own `currency`, and there is no
 *   accumulator in this file at all. A single invoice carries a single currency,
 *   so the popup shows four amounts and one currency — never a mixed subtotal.
 * - **It adds no settle control.** Settlement lives where it already lives; a
 *   second entry point to the same write is how a payment gets recorded twice.
 * - It omits `id` and `companyId`. Both are tenancy plumbing; the invoice number
 *   is the identifier a reader can act on, and a UUID beside it is noise that
 *   makes the useful fields harder to find.
 *
 * ## Nulls
 *
 * Every one of these columns is nullable and every null is rendered as a stated
 * label — "Not stated", "No document", "No note" — never as `0`, never as a
 * blank cell, never as an em dash that could be read as either. A `taxAmount` of
 * `null` means nobody recorded a tax component; a `taxAmount` of `0` means
 * somebody recorded that there is none. Those are different facts and the popup
 * shows them differently (SYSTEM-PROMPT §2.3).
 *
 * ## The click target is a real button
 *
 * The opener sits inside the vendor cell rather than on the `<tr>`. A `<tr>` with
 * an `onClick` is reachable by mouse only; `role="link"` plus `tabIndex` on a row
 * is the workaround, and it announces nine cells of content as one link name. A
 * `<button>` in the first cell keeps the table a table — header association, row
 * navigation and `caption` all keep working — and carries its own `aria-label`
 * naming the vendor and the invoice number, so a screen-reader user knows which
 * invoice they are about to open.
 */

/**
 * One table row, flattened and already localised.
 *
 * Amounts arrive as `Minor` because `lib/format` money rules say the decimal →
 * integer conversion happens once, at the top of the page, before anything is
 * rendered. Strings that need a placeholder (`{days}` overdue, the button's
 * accessible name) are resolved server-side too: this is a client island and
 * `useTranslations` is not available to it, nor may a function prop cross the
 * boundary.
 */
export interface VendorInvoiceRow {
  id: string
  vendorName: string
  invoiceNo: string
  /** Already resolved from `dashboard.vendorInvoices.status.*`. */
  statusLabel: string
  issuedOn: string
  dueOn: string | null
  totalMinor: Minor | null
  taxMinor: Minor | null
  paidMinor: Minor | null
  outstandingMinor: Minor | null
  currency: CurrencyCode | null
  notes: string | null
  documentPath: string | null
  ledgerEntryId: string | null
  siteId: string | null
  vendorProfileId: string | null
  version: number
  createdAt: string
  updatedAt: string
  isDuplicate: boolean
  /** Open, past its due date, measured against the repository's `fetchedAt`. */
  isOverdue: boolean
  /** "12 days overdue" / "Not yet due" / "No due date", already localised. */
  dueStatusLabel: string
  /** Accessible name for this row's opener, naming vendor and invoice number. */
  openLabel: string
}

export interface VendorInvoiceTableLabels {
  caption: string
  columns: {
    vendor: string
    invoiceNo: string
    status: string
    issued: string
    due: string
    total: string
    tax: string
    paid: string
    outstanding: string
    currency: string
  }
  fields: {
    site: string
    vendorProfile: string
    ledgerEntry: string
    document: string
    version: string
    created: string
    updated: string
    notes: string
  }
  /** Stated labels for the absences. None of these may render as blank. */
  notStated: string
  notLinked: string
  noDocument: string
  noNotes: string
  duplicate: string
  detailLead: string
  close: string
}

export function VendorInvoiceTable({
  rows,
  labels,
  locale,
}: {
  rows: readonly VendorInvoiceRow[]
  labels: VendorInvoiceTableLabels
  locale: Locale
}): ReactNode {
  const [selected, setSelected] = useState<VendorInvoiceRow | null>(null)

  return (
    <>
      <TableScrollArea height={520}>
        <Table>
          <TableCaption>{labels.caption}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{labels.columns.vendor}</TableHead>
              <TableHead>{labels.columns.invoiceNo}</TableHead>
              <TableHead>{labels.columns.status}</TableHead>
              <TableHead>{labels.columns.issued}</TableHead>
              <TableHead>{labels.columns.due}</TableHead>
              <TableHead className="text-right">
                {labels.columns.total}
              </TableHead>
              <TableHead className="text-right">{labels.columns.paid}</TableHead>
              <TableHead className="text-right">
                {labels.columns.outstanding}
              </TableHead>
              <TableHead>{labels.columns.currency}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                data-duplicate={row.isDuplicate ? "" : undefined}
                className={cn(
                  "border-l-2",
                  row.isDuplicate
                    ? "border-l-confidence-conflicted bg-confidence-conflicted/5"
                    : row.isOverdue
                      ? "border-l-confidence-inferred"
                      : "border-l-transparent"
                )}
              >
                <TableCell className="max-w-[14rem]">
                  {/* The duplicate marker is a SIBLING of the button, not a
                      child of it. Inside, it was swallowed: `aria-label`
                      replaces an element's content as its accessible name, so a
                      screen reader heard `openLabel` and never the word
                      "duplicate" — while the comment beside it claimed the
                      marker "reaches a reader". As cell content it is announced
                      with the row, and the button's name stays the one thing
                      the button does. */}
                  <div className="flex w-full items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelected(row)}
                      aria-label={row.openLabel}
                      className={cn(
                        "flex min-w-0 items-center gap-2 rounded-md text-left font-medium",
                        "underline decoration-dotted underline-offset-4 decoration-transparent",
                        "transition-colors duration-[var(--duration-instant)]",
                        "hover:text-primary hover:decoration-current",
                        "outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      )}
                    >
                      <span className="truncate">{row.vendorName}</span>
                    </button>
                    {row.isDuplicate ? (
                      // Visible marker, not colour alone. The row tint is the
                      // fast signal while scanning; this survives a greyscale
                      // screenshot and is now actually announced.
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-confidence-conflicted/50 px-2 py-0.5 text-[0.6875rem] font-normal text-confidence-conflicted">
                        <AlertTriangle className="size-3" aria-hidden="true" />
                        {labels.duplicate}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs whitespace-nowrap">
                  {row.invoiceNo}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {row.statusLabel}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {formatDate(row.issuedOn, locale)}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {row.dueOn === null ? (
                    <span className="text-muted-foreground">
                      {row.dueStatusLabel}
                    </span>
                  ) : (
                    <>
                      {formatDate(row.dueOn, locale)}
                      <span
                        className={cn(
                          "mt-0.5 block text-xs",
                          row.isOverdue
                            ? "text-confidence-conflicted"
                            : "text-muted-foreground"
                        )}
                      >
                        {row.dueStatusLabel}
                      </span>
                    </>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <MoneyCell
                    minor={row.totalMinor}
                    currency={row.currency}
                    locale={locale}
                    gapLabel={labels.notStated}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <MoneyCell
                    minor={row.paidMinor}
                    currency={row.currency}
                    locale={locale}
                    gapLabel={labels.notStated}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <MoneyCell
                    minor={row.outstandingMinor}
                    currency={row.currency}
                    locale={locale}
                    gapLabel={labels.notStated}
                    className="font-semibold"
                  />
                </TableCell>
                <TableCell className="font-mono text-[0.6875rem] tracking-[0.14em] uppercase">
                  {row.currency ?? (
                    <span className="text-confidence-gap">
                      {labels.notStated}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScrollArea>

      {/* One controlled dialog for the whole table, rendered outside the loop.
          One per row would mount 500 portals to show at most one of them. */}
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        {selected !== null ? (
          <DialogContent closeLabel={labels.close}>
            <div className="flex flex-col gap-1 pr-8">
              <span className="azura-label text-muted-foreground">
                {labels.detailLead}
              </span>
              <DialogTitle>{selected.vendorName}</DialogTitle>
              <DialogDescription className="font-mono text-xs tracking-[0.06em]">
                {selected.invoiceNo}
              </DialogDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Pill>{selected.statusLabel}</Pill>
              {selected.isOverdue ? (
                <Pill tone="alert" icon={Clock}>
                  {selected.dueStatusLabel}
                </Pill>
              ) : null}
              {selected.isDuplicate ? (
                <Pill tone="alert" icon={AlertTriangle}>
                  {labels.duplicate}
                </Pill>
              ) : null}
              <Pill mono>
                {selected.currency ?? labels.notStated}
              </Pill>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {/* Four amounts, each beside the invoice's own currency. The tax
                  component is here and nowhere else in the product. */}
              <MoneyField
                label={labels.columns.total}
                minor={selected.totalMinor}
                currency={selected.currency}
                locale={locale}
                gapLabel={labels.notStated}
              />
              <MoneyField
                label={labels.columns.tax}
                minor={selected.taxMinor}
                currency={selected.currency}
                locale={locale}
                gapLabel={labels.notStated}
              />
              <MoneyField
                label={labels.columns.paid}
                minor={selected.paidMinor}
                currency={selected.currency}
                locale={locale}
                gapLabel={labels.notStated}
              />
              <MoneyField
                label={labels.columns.outstanding}
                minor={selected.outstandingMinor}
                currency={selected.currency}
                locale={locale}
                gapLabel={labels.notStated}
                strong
              />

              <Field
                label={labels.columns.issued}
                value={formatDate(selected.issuedOn, locale)}
              />
              <Field
                label={labels.columns.due}
                value={
                  selected.dueOn === null
                    ? selected.dueStatusLabel
                    : formatDate(selected.dueOn, locale)
                }
                muted={selected.dueOn === null}
              />

              <Field
                label={labels.fields.site}
                value={selected.siteId ?? labels.notStated}
                muted={selected.siteId === null}
              />
              <Field
                label={labels.fields.vendorProfile}
                value={selected.vendorProfileId ?? labels.notStated}
                muted={selected.vendorProfileId === null}
              />
              <Field
                label={labels.fields.ledgerEntry}
                value={selected.ledgerEntryId ?? labels.notLinked}
                muted={selected.ledgerEntryId === null}
              />
              <Field
                label={labels.fields.document}
                value={selected.documentPath ?? labels.noDocument}
                muted={selected.documentPath === null}
              />
              <Field
                label={labels.fields.version}
                value={String(selected.version)}
              />
              <Field
                label={labels.fields.created}
                value={formatDateTime(selected.createdAt, locale)}
              />
              <Field
                label={labels.fields.updated}
                value={formatDateTime(selected.updatedAt, locale)}
              />
            </dl>

            {/* The note is free text a person typed, so it keeps its own line
                breaks and is never truncated here — this popup is the only place
                it is readable at all. An absent note is stated, not blank. */}
            <div className="flex flex-col gap-1">
              <span className="azura-label text-muted-foreground">
                {labels.fields.notes}
              </span>
              {selected.notes === null || selected.notes.trim().length === 0 ? (
                <p className="text-sm text-confidence-gap">{labels.noNotes}</p>
              ) : (
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
                  {selected.notes}
                </p>
              )}
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  )
}

/**
 * One `<dt>`/`<dd>` pair. `muted` is how a stated absence is distinguished from
 * a value at a glance without removing it from the list.
 */
function Field({
  label,
  value,
  muted = false,
}: {
  label: string
  value: string
  muted?: boolean
}): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[0.6875rem] tracking-[0.04em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "font-medium break-words tabular-nums",
          muted ? "text-confidence-gap" : "text-foreground"
        )}
      >
        {value}
      </dd>
    </div>
  )
}

/**
 * An amount field. Delegates to `MoneyCell` so the null case and the currency
 * pairing are decided in exactly one place for the table and the popup alike —
 * a second money renderer is a second chance to print a bare number.
 */
function MoneyField({
  label,
  minor,
  currency,
  locale,
  gapLabel,
  strong = false,
}: {
  label: string
  minor: Minor | null
  currency: CurrencyCode | null
  locale: Locale
  gapLabel: string
  strong?: boolean
}): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[0.6875rem] tracking-[0.04em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className={cn("font-medium", strong && "font-semibold")}>
        <MoneyCell
          minor={minor}
          currency={currency}
          locale={locale}
          gapLabel={gapLabel}
        />
      </dd>
    </div>
  )
}

function Pill({
  children,
  tone = "default",
  mono = false,
  icon: Icon,
}: {
  children: ReactNode
  tone?: "default" | "alert"
  mono?: boolean
  icon?: typeof Clock
}): ReactNode {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
        tone === "alert"
          ? "border-confidence-conflicted/50 text-confidence-conflicted"
          : "border-border text-foreground",
        mono && "font-mono tracking-[0.14em] uppercase"
      )}
    >
      {Icon === undefined ? null : (
        <Icon className="size-3 shrink-0" aria-hidden="true" />
      )}
      {children}
    </span>
  )
}
