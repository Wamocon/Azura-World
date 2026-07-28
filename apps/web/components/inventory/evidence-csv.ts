import type { PriceObservation } from "./price-conflict-ladder"
import type { Finding, SourceRef } from "@/lib/contracts"

/**
 * The evidence export.                                            Owner: W3-C
 *
 * ## The rule this file exists to enforce
 *
 * `tasks/W3-C`: *"When it lands it must carry provenance columns; an export
 * that strips sources recreates the problem this system exists to solve."*
 *
 * That is not a nice-to-have. A CSV of prices with no source column is exactly
 * the artefact this whole project is an argument against: four numbers that
 * disagree, in a spreadsheet, with nothing to say which portal published which
 * or when anybody looked. It would be forwarded, pasted into a deck, and quoted
 * six months later as "the Azura numbers".
 *
 * So provenance is **structural** here, the same way it is in `SourcedFact<T>`:
 * `COLUMNS` is the single definition of the file's shape, every row is built
 * from it by key, and `PROVENANCE_COLUMNS` names the subset that may never be
 * absent. `assertProvenanceColumns()` throws if any of them is missing. A future
 * edit that trims the export to "just the prices" fails a test rather than
 * shipping.
 *
 * ## What is deliberately NOT in this file
 *
 * - **No total, no average, no midpoint.** F-002 is deliberately unresolved and
 *   `qa:evidence` fails the build if anyone sets `resolvedTo`. A spreadsheet
 *   that ships a SUM row invents the number the product refuses to state.
 * - **No converted currency.** `price_amount` and `price_currency` are adjacent
 *   columns and there is no third "price in EUR". No source in this dataset
 *   publishes a rate or a rate date (CONVENTIONS §5), so a converted column
 *   would be a figure with no provenance in a file whose whole point is that
 *   every figure has one.
 * - **No inferred layout.** A listing that stated a price without a layout
 *   exports an empty `layout` cell, not `1+1` guessed from the area.
 */

export interface EvidenceCsvRow {
  finding_id: string
  publisher: string
  layout: string
  interior_area_m2: string
  price_amount: string
  price_currency: string
  is_stale: string
  observed_at: string
  parser_note: string
  source_url: string
  source_publisher: string
  source_tier: string
  source_fetched_at: string
  snapshot_hash: string
}

/** The file's shape, in order. The only place column names are written. */
export const COLUMNS = [
  "finding_id",
  "publisher",
  "layout",
  "interior_area_m2",
  "price_amount",
  "price_currency",
  "is_stale",
  "observed_at",
  "parser_note",
  "source_url",
  "source_publisher",
  "source_tier",
  "source_fetched_at",
  "snapshot_hash",
] as const satisfies readonly (keyof EvidenceCsvRow)[]

/**
 * The columns that make a row citable.
 *
 * `source_url` answers "who published this", `source_fetched_at` answers "when
 * did we look", and `snapshot_hash` answers "can I re-open exactly what we
 * saw" — CONTRACTS §1 invariant 6, because a citation you cannot re-open is not
 * a citation. Losing any one of the three turns a row back into an unsourced
 * number.
 */
export const PROVENANCE_COLUMNS = [
  "source_url",
  "source_publisher",
  "source_fetched_at",
  "snapshot_hash",
] as const satisfies readonly (keyof EvidenceCsvRow)[]

export class MissingProvenanceColumnError extends Error {
  constructor(missing: readonly string[]) {
    super(
      `The evidence export is missing provenance column(s): ${missing.join(", ")}. ` +
        "An export that strips sources recreates the problem this system exists to solve."
    )
    this.name = "MissingProvenanceColumnError"
  }
}

/** Throws unless every provenance column is present in the header. */
export function assertProvenanceColumns(columns: readonly string[]): void {
  const present = new Set(columns)
  const missing = PROVENANCE_COLUMNS.filter((column) => !present.has(column))
  if (missing.length > 0) throw new MissingProvenanceColumnError(missing)
}

/**
 * RFC 4180 quoting, plus one hardening step.
 *
 * A cell beginning `=`, `+`, `-` or `@` is executed as a formula by Excel and
 * Sheets when the file is opened. The dataset carries verbatim publisher notes
 * — free text this project did not write — so that is a live injection path
 * into whatever the reader opens the export in. Such cells are prefixed with a
 * single quote, which spreadsheets treat as "this is text".
 *
 * The value is otherwise unchanged: truncating or stripping a parser's caveat
 * to make it safe would be editing evidence.
 */
function escapeCell(value: string): string {
  const neutralised = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  if (/[",\n\r]/.test(neutralised))
    return `"${neutralised.replace(/"/g, '""')}"`
  return neutralised
}

function cell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return ""
  return String(value)
}

/**
 * One row per observation.
 *
 * `sourcesByUrl` is the source register keyed by URL. Where a listing's URL is
 * registered, its tier and snapshot hash travel with the row; where it is not,
 * those cells are **empty rather than invented**. W3-C's handoff §8.4 records
 * that `PortalListing` carries no `snapshotHash` of its own and that ten of
 * twenty-one rows fall back to a live URL only — an empty cell says that
 * honestly, a fabricated hash would not.
 */
export function toCsvRows(
  findingId: string,
  observations: readonly PriceObservation[],
  sourcesByUrl: ReadonlyMap<string, SourceRef>
): EvidenceCsvRow[] {
  return observations.map((observation) => {
    const source = sourcesByUrl.get(observation.url)
    return {
      finding_id: findingId,
      publisher: observation.publisher,
      layout: cell(observation.layout),
      interior_area_m2: cell(observation.interiorM2),
      price_amount: String(observation.money.amount),
      price_currency: observation.money.currency,
      is_stale: observation.stale ? "true" : "false",
      observed_at: observation.fetchedAt,
      parser_note: cell(observation.note),
      source_url: observation.url,
      source_publisher: cell(source?.publisher ?? observation.publisher),
      source_tier: cell(source?.tier),
      source_fetched_at: cell(source?.fetchedAt ?? observation.fetchedAt),
      snapshot_hash: cell(source?.snapshotHash),
    }
  })
}

/**
 * Serialises to CSV.
 *
 * CRLF line endings per RFC 4180 — Excel on Windows is the overwhelmingly
 * likely destination and it is the strictest reader in practice.
 */
export function toCsv(rows: readonly EvidenceCsvRow[]): string {
  assertProvenanceColumns(COLUMNS)
  const header = COLUMNS.join(",")
  const body = rows.map((row) =>
    COLUMNS.map((column) => escapeCell(row[column])).join(",")
  )
  return [header, ...body].join("\r\n") + "\r\n"
}

/**
 * The whole export, from a finding and its observations.
 *
 * The finding's own narrative is NOT flattened into the rows: it is prose about
 * the disagreement, and repeating it on fourteen columns × twenty-one rows
 * would be noise. The `finding_id` column is the join back to it.
 */
export function buildEvidenceCsv(
  finding: Pick<Finding, "id">,
  observations: readonly PriceObservation[],
  sourcesByUrl: ReadonlyMap<string, SourceRef>
): string {
  return toCsv(toCsvRows(finding.id, observations, sourcesByUrl))
}

/** `azura-evidence-F-002-2026-07-28.csv` — sortable, and it names its subject. */
export function csvFilename(findingId: string, isoDate: string): string {
  return `azura-evidence-${findingId}-${isoDate.slice(0, 10)}.csv`
}
