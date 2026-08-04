/**
 * Reports: what can be generated, in what format, and what carries its sources.
 *                                                              Owner: W3-F
 *
 * ## An export that strips provenance recreates the problem
 *
 * `tasks/W3-F`: *"Every export carries provenance columns where it contains
 * sourced facts — an export that strips sources recreates the problem this
 * system exists to solve."* A spreadsheet of prices with no URLs is exactly the
 * artefact that let four portals quote a 2.1x range for the same flat without
 * anyone noticing. So every row builder here emits its citation columns beside
 * the value, and `ReportColumn` marks which columns those are, so a reviewer can
 * check the pairing without reading the whole file.
 *
 * ## What actually works today, stated honestly
 *
 * | capability                      | state                                            |
 * |---------------------------------|--------------------------------------------------|
 * | CSV, generated on request       | **works.** Synchronous, bounded, RBAC-scoped     |
 * | XLSX                            | **unavailable.** No library in the pinned stack  |
 * | PDF                             | **unavailable.** Same reason                     |
 * | Stored artefact + retention     | **unavailable.** No `report_artifacts` table     |
 * | Background job + poll           | **unavailable.** No `report_jobs` table          |
 *
 * The last three are not oversights and they are not stubbed. `CONVENTIONS.md`
 * §1 pins the dependency list and only W0-A may run `pnpm install`; the
 * migrations are W1-A's and there are fifteen of them, none about reports.
 * `tasks/W3-F` is explicit that a missing target must fail and name its owner
 * rather than be stubbed: *"a stub is a lie the next window builds on."*
 *
 * `REPORT_FORMATS` therefore carries an `available` flag that the UI reads, so
 * an unavailable format is visibly unavailable rather than a button that
 * produces an empty file. `enqueueReportJob()` returns 503 with the table it
 * would need.
 *
 * ## Why CSV is synchronous and that is not a violation of "job + poll"
 *
 * The brief requires a job for **long-running** generation. The evidence
 * coverage report is one repository call over a bounded dataset — 24 findings,
 * a few hundred facts — and answers in milliseconds. Queueing it would add a
 * table, a poll loop and a failure mode to something that does not need any of
 * them. The job model exists (below) for the reports that will need it; it is
 * not invoked for the ones that do not.
 */

import type { Permission } from "@/lib/contracts"
import type {
  CoverageReport,
  SourceHealthEntry,
} from "@/lib/evidence-repository"

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export type ReportId =
  | "evidence_coverage"
  | "source_register"
  | "inventory_split"
  | "compliance_gaps"

export type ReportFormat = "csv" | "xlsx" | "pdf"

export interface ReportFormatCapability {
  format: ReportFormat
  available: boolean
  /** Message key under `dashboard.reports.formatReason.*`. Never prose. */
  reasonKey: string
}

/**
 * Format availability, in one place.
 *
 * `xlsx` and `pdf` are listed rather than omitted **on purpose**. Omitting them
 * would let a reader conclude the product does not do exports at all; listing
 * them as unavailable says what is missing and implies what would fix it. That
 * is the same reasoning `integrations.ts` uses for `wired: false`.
 */
export const REPORT_FORMATS: readonly ReportFormatCapability[] = Object.freeze([
  { format: "csv", available: true, reasonKey: "csv_ready" },
  { format: "xlsx", available: false, reasonKey: "no_library" },
  { format: "pdf", available: false, reasonKey: "no_library" },
])

export interface ReportDefinition {
  id: ReportId
  /** Checked with `hasPermission` before anything is read. */
  permission: Permission
  /**
   * True when the report contains `SourcedFact` values and therefore MUST carry
   * provenance columns. `assertProvenanceColumns` enforces it.
   */
  carriesSourcedFacts: boolean
  /** False when the underlying data or table does not exist yet. */
  available: boolean
  /** Message key under `dashboard.reports.unavailableReason.*`. */
  unavailableReasonKey?: string
}

export const REPORT_DEFINITIONS: readonly ReportDefinition[] = Object.freeze([
  {
    id: "evidence_coverage",
    // The flagship. `evidence:export` is admin + manager.
    permission: "evidence:export",
    carriesSourcedFacts: true,
    available: true,
  },
  {
    id: "source_register",
    permission: "evidence:export",
    carriesSourcedFacts: true,
    available: true,
  },
  // The next two are declared and NOT built. `available: false` is load-bearing
  // in both directions: `/dashboard/reports/export` answers 404 for them, and
  // the catalogue page renders the reason instead of a download button that
  // would 404. A definition whose `available` disagreed with its route would be
  // exactly the "declared as live" failure this file's header refuses.
  {
    id: "inventory_split",
    permission: "units:export",
    carriesSourcedFacts: true,
    available: false,
    unavailableReasonKey: "not_built",
  },
  {
    id: "compliance_gaps",
    permission: "compliance:export",
    carriesSourcedFacts: false,
    available: false,
    unavailableReasonKey: "not_built",
  },
])

export function reportDefinition(id: string): ReportDefinition | null {
  return REPORT_DEFINITIONS.find((report) => report.id === id) ?? null
}

/**
 * The permissions that unlock a report somebody can actually download.
 *
 * Derived from the catalogue rather than written down, because the navigation
 * entry for `/dashboard/reports` was gated on `reports:view` — a permission
 * eight roles hold — while both built reports are gated on `evidence:export`,
 * which two hold. Six roles were given a top-level destination on which every
 * single item was either forbidden or not built. They arrived at a page that
 * listed four things and offered none.
 *
 * `available: false` entries are excluded deliberately. A declared-but-unbuilt
 * report is worth showing to somebody who has other reports to download — it
 * tells them what is coming — and is not worth a nav entry on its own.
 *
 * Reading this instead of a literal means the day `inventory_split` is built,
 * the roles holding `units:export` get the entry without anybody remembering to
 * add it, and if the last available report were withdrawn the entry would
 * disappear rather than becoming the next dead link.
 */
export const REPORT_UNLOCKING_PERMISSIONS: readonly string[] = Object.freeze([
  ...new Set(
    REPORT_DEFINITIONS.filter((report) => report.available).map(
      (report) => report.permission
    )
  ),
])

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * A column. `provenance: true` marks a citation column.
 *
 * The flag is not decoration: `assertProvenanceColumns` refuses to serialise a
 * report declared as carrying sourced facts unless at least one column claims
 * it. A builder that forgets its citations fails loudly instead of producing a
 * plausible file.
 */
export interface ReportColumn {
  key: string
  /** Message key under `dashboard.reports.columns.*`. */
  labelKey: string
  provenance?: boolean
}

export interface ReportTable {
  id: ReportId
  columns: readonly ReportColumn[]
  rows: readonly Record<string, string | number | null>[]
  generatedAt: string
  /** `"supabase"` or `"local-seed"`, carried into the file itself. */
  source: string
}

/**
 * One CSV field.
 *
 * Two things beyond the RFC. A `null` becomes the **empty field**, never `0`
 * and never a dash — a spreadsheet reader sorts a dash as text and averages a
 * zero, and both misrepresent an absence (OVERNIGHT-2 §4.3).
 *
 * And a field whose first character is `=`, `+`, `-`, `@`, tab or CR is
 * prefixed with a single quote. That is CSV injection: Excel and Google Sheets
 * evaluate such a field as a formula, and a harvested title we do not control is
 * exactly the kind of string that can start with one. The quote is visible in
 * the cell, which is the correct trade — a visibly odd string beats a silently
 * executed one.
 */
export function csvField(value: string | number | null): string {
  if (value === null) return ""
  const raw = String(value)
  const guarded = /^[=+\-@\t\r]/u.test(raw) ? `'${raw}` : raw
  if (/[",\n\r]/u.test(guarded)) return `"${guarded.replace(/"/gu, '""')}"`
  return guarded
}

/** Thrown when a sourced-fact report is serialised without citation columns. */
export class MissingProvenanceColumnsError extends Error {
  constructor(id: ReportId) {
    super(
      `Report "${id}" is declared as carrying sourced facts but has no provenance column. An export that strips sources recreates the problem this system exists to solve.`
    )
    this.name = "MissingProvenanceColumnsError"
  }
}

export function assertProvenanceColumns(table: ReportTable): void {
  const definition = reportDefinition(table.id)
  if (definition === null || !definition.carriesSourcedFacts) return
  if (!table.columns.some((column) => column.provenance === true)) {
    throw new MissingProvenanceColumnsError(table.id)
  }
}

/**
 * Serialise a table to CSV.
 *
 * `\r\n` line endings and a UTF-8 BOM, because the primary consumer is Excel on
 * Windows in German and without the BOM it reads `Größe` as `GrÃ¶ÃŸe`. The
 * header row uses labels the caller has already translated.
 *
 * The first two lines are a provenance preamble: what this file is, when it was
 * produced, and whether it came from the database or the local seed. A file that
 * outlives the screen it was exported from has to carry that itself.
 */
export function toCsv(
  table: ReportTable,
  labels: {
    header: Record<string, string>
    generatedAt: string
    source: string
  }
): string {
  assertProvenanceColumns(table)

  const lines: string[] = [
    [csvField(labels.generatedAt), csvField(table.generatedAt)].join(","),
    [csvField(labels.source), csvField(table.source)].join(","),
    "",
    table.columns
      .map((column) => csvField(labels.header[column.key] ?? column.key))
      .join(","),
  ]

  for (const row of table.rows) {
    lines.push(
      table.columns.map((column) => csvField(row[column.key] ?? null)).join(",")
    )
  }

  return `﻿${lines.join("\r\n")}\r\n`
}

// ---------------------------------------------------------------------------
// The flagship: evidence coverage
// ---------------------------------------------------------------------------

export const EVIDENCE_COVERAGE_COLUMNS: readonly ReportColumn[] = Object.freeze(
  [
    { key: "metric", labelKey: "columns.metric" },
    { key: "value", labelKey: "columns.value" },
    { key: "basis", labelKey: "columns.basis", provenance: true },
  ]
)

/**
 * The evidence coverage report as a table.
 *
 * Every row carries a `basis` naming **where the number came from** — the
 * repository call and the field. That is the provenance column for a report
 * whose subject is provenance itself: a coverage figure with no stated
 * derivation is exactly as unsupported as a price with no URL.
 *
 * Nothing is rounded and nothing is bucketed, matching `CoverageReport`'s own
 * contract: *"A coverage report that is comfortable to read has been edited."*
 */
export function evidenceCoverageTable(input: {
  coverage: CoverageReport
  source: string
}): ReportTable {
  const { coverage } = input
  const rows: Record<string, string | number | null>[] = [
    {
      metric: "sources.total",
      value: coverage.totals.sources,
      basis: "getEvidenceCoverage().totals.sources",
    },
    {
      metric: "snapshots.total",
      value: coverage.totals.snapshots,
      basis: "getEvidenceCoverage().totals.snapshots",
    },
    {
      metric: "facts.total",
      value: coverage.totals.facts,
      basis: "getEvidenceCoverage().totals.facts",
    },
    {
      metric: "citations.total",
      value: coverage.totals.citations,
      basis: "getEvidenceCoverage().totals.citations",
    },
    {
      metric: "findings.total",
      value: coverage.totals.findings,
      basis: "getEvidenceCoverage().totals.findings",
    },
    {
      metric: "facts.established",
      value: coverage.facts.established,
      basis: "confirmed + official",
    },
    {
      metric: "facts.provisional",
      value: coverage.facts.provisional,
      basis: "single_source + conflicted + inferred",
    },
    {
      metric: "facts.declaredGaps",
      value: coverage.facts.declaredGaps,
      basis: "confidence = gap",
    },
    {
      metric: "citations.withoutSnapshot",
      value: coverage.facts.citationsWithoutSnapshot,
      basis: "a URL with no stored bytes behind it",
    },
    {
      metric: "sources.validated",
      value: coverage.sources.byReachability.validated,
      basis: "at least one snapshot whose body validated",
    },
    {
      metric: "sources.fetchedNotValidated",
      value: coverage.sources.byReachability.fetchedNotValidated,
      basis: "fetched, no snapshot validated",
    },
    {
      metric: "sources.neverFetched",
      value: coverage.sources.byReachability.neverFetched,
      basis: "robots.txt refused, or never attempted",
    },
  ]

  for (const [confidence, count] of Object.entries(
    coverage.facts.byConfidence
  )) {
    rows.push({
      metric: `facts.byConfidence.${confidence}`,
      value: count,
      basis: "getEvidenceCoverage().facts.byConfidence",
    })
  }

  return {
    id: "evidence_coverage",
    columns: EVIDENCE_COVERAGE_COLUMNS,
    rows,
    generatedAt: coverage.generatedAt,
    source: input.source,
  }
}

/**
 * `SourceRef` has no id (CONTRACTS §1) — a source IS its URL. So the register's
 * identity column is the URL, and `snapshotHash` is carried beside it: the hash
 * is what makes a citation checkable rather than merely stated, and an export
 * that dropped it would leave the reader with a link that may since have
 * changed.
 */
export const SOURCE_REGISTER_COLUMNS: readonly ReportColumn[] = Object.freeze([
  { key: "publisher", labelKey: "columns.publisher", provenance: true },
  { key: "url", labelKey: "columns.url", provenance: true },
  { key: "tier", labelKey: "columns.tier", provenance: true },
  { key: "fetchedAt", labelKey: "columns.fetchedAt", provenance: true },
  { key: "snapshotHash", labelKey: "columns.snapshotHash", provenance: true },
  { key: "lastStatus", labelKey: "columns.lastStatus" },
  { key: "lastOk", labelKey: "columns.lastOk" },
])

/**
 * The source register with its reachability.
 *
 * `lastOk: null` stays empty rather than becoming a date or a zero. A source
 * that has never validated is a fact this register exists to publish.
 */
export function sourceRegisterTable(input: {
  health: readonly SourceHealthEntry[]
  generatedAt: string
  source: string
}): ReportTable {
  return {
    id: "source_register",
    columns: SOURCE_REGISTER_COLUMNS,
    rows: input.health.map((entry) => ({
      publisher: entry.source.publisher,
      url: entry.source.url,
      tier: entry.source.tier,
      fetchedAt: entry.source.fetchedAt,
      // Empty rather than a placeholder when there are no stored bytes: an
      // absent hash is the finding, not a formatting problem.
      snapshotHash:
        entry.source.snapshotHash.length === 0
          ? null
          : entry.source.snapshotHash,
      lastStatus: entry.lastStatus,
      lastOk: entry.lastOk,
    })),
    generatedAt: input.generatedAt,
    source: input.source,
  }
}

// ---------------------------------------------------------------------------
// Jobs — the model, and why nothing runs through it yet
// ---------------------------------------------------------------------------

export type ReportJobState = "queued" | "running" | "ready" | "failed"

export interface ReportJob {
  id: string
  reportId: ReportId
  state: ReportJobState
  requestedBy: string | null
  requestedAt: string
  /** Set on `ready`. A stored artefact with a retention class and an ACL. */
  artifactPath: string | null
  /** Set on `failed`. A message key, never a raw error. */
  failureReasonKey: string | null
}

export type EnqueueOutcome =
  | { status: "queued"; job: ReportJob }
  /** 503, with the exact missing target named. */
  | {
      status: "unavailable"
      httpStatus: 503
      missingTable: string
      owner: string
    }

/**
 * Queue a background report. Currently always 503.
 *
 * It names the table and the owner rather than pretending, which `tasks/W3-F`
 * asks for by name: *"A failing script that names its owner is information; a
 * stub is a lie the next window builds on."* The `ReportJob` shape above is the
 * contract W1-A's migration should satisfy, published here so the two are
 * designed against each other rather than in sequence.
 */
export function enqueueReportJob(): EnqueueOutcome {
  return {
    status: "unavailable",
    httpStatus: 503,
    missingTable: "report_jobs",
    owner: "W1-A",
  }
}
