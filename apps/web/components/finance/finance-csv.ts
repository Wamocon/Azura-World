import type {
  LedgerEntry,
  VendorInvoice,
} from "@/lib/finance-repository"

import { minorToDecimalString, toMinor } from "./money"

/**
 * CSV export for the finance surfaces.                         Owner: W3-D
 *
 * ## The filter travels with the file
 *
 * The brief: *"Export while filtered → exports the filter, and the file names
 * the filter."* Both halves matter. A file that silently exported everything
 * while the screen showed one status would be wrong; a correctly-filtered file
 * called `ledger.csv` is a file that will be forwarded, opened next week and
 * mistaken for the whole ledger. So the active filter is encoded in the
 * filename **and** repeated in a header comment inside the file, because a
 * filename does not survive being pasted into a spreadsheet.
 *
 * ## Amounts are written as plain decimals, not as formatted money
 *
 * `1.234,56 €` in a CSV cell is a string in every spreadsheet on earth. The
 * amount column holds `1234.56` with a dot, produced from integer minor units
 * by `minorToDecimalString`, and the **currency is its own column**. That is the
 * same anti-mixing rule as the screen: a reader who sorts this file by amount
 * gets a number, and a reader who sums it without grouping by the currency
 * column gets an obviously suspicious result rather than a plausible one.
 *
 * ## Injection
 *
 * A cell beginning `=`, `+`, `-` or `@` is executed as a formula by Excel and
 * LibreOffice when the file is opened. Vendor names and descriptions come from
 * a database that a vendor can influence, so every field goes through
 * `csvCell`, which quotes always and prefixes a leading formula character with
 * a single quote. Cheap, and the alternative is a spreadsheet that runs
 * somebody else's text.
 */

const BOM = "﻿"

/**
 * One cell, quoted unconditionally.
 *
 * Always quoting rather than only-when-needed removes a whole class of question
 * about whether a German description containing a semicolon or a comma was
 * escaped. The formula guard is applied inside the quotes, where it survives.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""'
  const text = String(value)
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return `"${guarded.replace(/"/g, '""')}"`
}

function csvRow(cells: readonly (string | number | null)[]): string {
  return cells.map(csvCell).join(",")
}

export interface ExportFilter {
  /** Human-readable `key=value` pairs, already localised or already raw ids. */
  readonly pairs: ReadonlyArray<readonly [string, string]>
  /** `"supabase"` or `"local-seed"`. Travels into the filename. */
  readonly dataSource: "supabase" | "local-seed"
  /** Server timestamp the export was taken at. */
  readonly generatedAt: string
}

/**
 * Filename carrying the filter and the data source.
 *
 * `local-seed` in the name is not decoration: a CSV cannot hold a banner, and a
 * seed export forwarded as if it were live is the exact "seed presented as
 * live" failure the honesty audit grades HIGH. W3-C's evidence export made the
 * same call for the same reason.
 */
export function financeCsvFilename(
  base: string,
  filter: ExportFilter
): string {
  const parts = [base]
  for (const [key, value] of filter.pairs) {
    parts.push(`${slug(key)}-${slug(value)}`)
  }
  parts.push(filter.dataSource === "local-seed" ? "demo-data" : "live")
  parts.push(filter.generatedAt.slice(0, 10))
  return `${parts.join("_")}.csv`
}

function slug(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLocaleLowerCase("en-US")
      .slice(0, 40) || "all"
  )
}

/**
 * The comment block every export opens with.
 *
 * `#` lines, so a spreadsheet shows them as text rows rather than choking, and
 * so a `grep` over a folder of exports can tell what each one was.
 */
function header(filter: ExportFilter, rowCount: number): string[] {
  const lines = [
    csvRow(["# Azura World CATI"]),
    csvRow([`# generated_at=${filter.generatedAt}`]),
    csvRow([`# data_source=${filter.dataSource}`]),
    csvRow([`# rows=${rowCount}`]),
  ]
  lines.push(
    csvRow([
      `# filter=${
        filter.pairs.length === 0
          ? "none"
          : filter.pairs.map(([key, value]) => `${key}:${value}`).join(" ")
      }`,
    ])
  )
  if (filter.dataSource === "local-seed") {
    lines.push(
      csvRow([
        "# NOTE: demo data from the local dataset. These are not live records.",
      ])
    )
  }
  // Stated in the file itself, because the file outlives the page that produced
  // it and the person who opens it will not have read this module.
  lines.push(
    csvRow([
      "# Amounts are plain decimals in the currency named in the currency column. Do not sum across currencies.",
    ])
  )
  return lines
}

// ---------------------------------------------------------------------------

const LEDGER_COLUMNS = [
  "entry_id",
  "posted_at",
  "due_date",
  "period",
  "entry_type",
  "status",
  "unit_id",
  "transaction_group_id",
  "reference",
  "description",
  "debit",
  "credit",
  "signed",
  "currency",
  "reversal_of",
] as const

export function buildLedgerCsv(
  entries: readonly LedgerEntry[],
  filter: ExportFilter
): string {
  const lines = [
    ...header(filter, entries.length),
    csvRow([...LEDGER_COLUMNS]),
  ]

  for (const entry of entries) {
    const debit = toMinor(entry.debitAmount)
    const credit = toMinor(entry.creditAmount)
    const signed = toMinor(entry.signedAmount)
    lines.push(
      csvRow([
        entry.id,
        entry.postedAt,
        entry.dueDate,
        entry.period,
        entry.entryType,
        entry.status,
        entry.unitId,
        entry.transactionGroupId,
        entry.reference,
        entry.description,
        // An unreadable amount exports as an EMPTY cell, never as 0. A zero
        // here would be indistinguishable from a real zero once the file has
        // left the building.
        debit === null ? null : minorToDecimalString(debit),
        credit === null ? null : minorToDecimalString(credit),
        signed === null ? null : minorToDecimalString(signed),
        entry.currency,
        entry.reversalOf,
      ])
    )
  }

  return BOM + lines.join("\r\n") + "\r\n"
}

const INVOICE_COLUMNS = [
  "invoice_id",
  "vendor_name",
  "invoice_no",
  "status",
  "issued_on",
  "due_on",
  "total",
  "tax",
  "paid",
  "outstanding",
  "currency",
  "possible_duplicate",
  "ledger_entry_id",
] as const

export function buildVendorInvoiceCsv(
  invoices: readonly VendorInvoice[],
  duplicateIds: ReadonlySet<string>,
  filter: ExportFilter
): string {
  const lines = [
    ...header(filter, invoices.length),
    csvRow([...INVOICE_COLUMNS]),
  ]

  for (const invoice of invoices) {
    const total = toMinor(invoice.totalAmount)
    const tax = toMinor(invoice.taxAmount)
    const paid = toMinor(invoice.paidAmount)
    const outstanding = toMinor(invoice.outstandingAmount)
    lines.push(
      csvRow([
        invoice.id,
        invoice.vendorName,
        invoice.invoiceNo,
        invoice.status,
        invoice.issuedOn,
        invoice.dueOn,
        total === null ? null : minorToDecimalString(total),
        tax === null ? null : minorToDecimalString(tax),
        paid === null ? null : minorToDecimalString(paid),
        outstanding === null ? null : minorToDecimalString(outstanding),
        invoice.currency,
        duplicateIds.has(invoice.id) ? "yes" : "no",
        invoice.ledgerEntryId,
      ])
    )
  }

  return BOM + lines.join("\r\n") + "\r\n"
}
