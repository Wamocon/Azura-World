import type { ReportColumn, ReportTable } from "@/lib/report-artifacts"

/**
 * What a downloaded report actually looks like as a file.      Owner: W-NIGHT
 *
 * `lib/report-artifacts.ts` builds each report as a `ReportTable` of raw
 * values: the metric column holds `facts.byConfidence.conflicted`, the basis
 * column holds `getEvidenceCoverage().totals.sources`, the source register's
 * status column holds `expect_missing`, and the whole file announces its origin
 * as `local-seed`. Every one of those is correct as a value and unreadable as a
 * cell. A property manager opening the CSV in Excel is the person the file is
 * for, and none of those strings mean anything to them.
 *
 * So this module is the presentation layer for the file, exactly as the page is
 * the presentation layer for the screen: it keeps the machine-readable value
 * AND adds the plain-language one beside it, in the reader's language. Nothing
 * is dropped and nothing is invented. Where a translation is missing the raw
 * value is carried through verbatim rather than replaced with a guess, so a
 * metric added upstream still appears in the file with its real name.
 *
 * ## Why this lives beside the card and not in `lib/`
 *
 * The page prints the column headers a report will contain ("Spalten in der
 * Datei") and the route writes them. If those two lists were declared
 * separately they would drift, and the page would promise a column the file
 * does not have. They are declared once, here, and both read them.
 *
 * ## The absence rules still hold
 *
 * `csvField` turns `null` into an empty field, never `0` and never a dash. A
 * source that was never fetched has no retrieval time, so this maps its empty
 * string to `null` rather than letting an empty-looking-but-present value
 * through. An absence in the file has to look like an absence.
 */

// ---------------------------------------------------------------------------
// The translator this module needs
// ---------------------------------------------------------------------------

/**
 * The subset of `next-intl`'s translator used here, structurally typed so that
 * this module never imports the i18n runtime. `has` matters as much as the call
 * itself: it is what lets an unknown key fall back to the raw value instead of
 * rendering a key path into a spreadsheet cell.
 */
export interface ReportText {
  (key: string, values?: Record<string, string | number>): string
  has(key: string): boolean
}

// ---------------------------------------------------------------------------
// Column sets, as they appear in the file
// ---------------------------------------------------------------------------

/**
 * Evidence coverage.
 *
 * Four columns rather than three. `label` is the plain-language name of the
 * measure and leads, because that is the column a person reads; `metric` keeps
 * the stable identifier and trails, because that is the column a script reads
 * and a stable key is worth more than its position. `basis` stays the
 * provenance column and now says where a number comes from in words instead of
 * naming a function call.
 */
export const COVERAGE_FILE_COLUMNS: readonly ReportColumn[] = Object.freeze([
  { key: "label", labelKey: "columns.metric" },
  { key: "value", labelKey: "columns.value" },
  { key: "basis", labelKey: "columns.basis", provenance: true },
  { key: "metric", labelKey: "columns.metricKey" },
])

/**
 * Source register.
 *
 * `tierName` is added beside `tier` for the same reason: `4` sorts, "property
 * portal" explains. `snapshotHash` moves last because a 64-character checksum
 * in column five pushes every readable column off the first screen of a
 * spreadsheet, and `lastOk` moves up beside the status it qualifies.
 */
export const REGISTER_FILE_COLUMNS: readonly ReportColumn[] = Object.freeze([
  { key: "publisher", labelKey: "columns.publisher", provenance: true },
  { key: "url", labelKey: "columns.url", provenance: true },
  { key: "tier", labelKey: "columns.tier", provenance: true },
  { key: "tierName", labelKey: "columns.tierName", provenance: true },
  { key: "fetchedAt", labelKey: "columns.fetchedAt", provenance: true },
  { key: "lastStatus", labelKey: "columns.lastStatus" },
  { key: "lastOk", labelKey: "columns.lastOk" },
  { key: "snapshotHash", labelKey: "columns.snapshotHash", provenance: true },
])

/**
 * The column set each downloadable report ships with, so the catalogue page can
 * list them without knowing how they are built. A report that is not built yet
 * has no entry, which is the same absence its missing download button is.
 */
export const REPORT_FILE_COLUMNS: Readonly<
  Record<string, readonly ReportColumn[] | undefined>
> = Object.freeze({
  evidence_coverage: COVERAGE_FILE_COLUMNS,
  source_register: REGISTER_FILE_COLUMNS,
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** `"facts.byConfidence.gap"` becomes `"facts_byConfidence_gap"`. */
function messageSuffix(metric: string): string {
  return metric.replace(/\./gu, "_")
}

/** An empty or whitespace-only value is an absence, and is stored as one. */
function blankToNull(
  value: string | number | null | undefined
): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === "string" && value.trim() === "") return null
  return value
}

function asText(value: string | number | null | undefined): string {
  return value === undefined || value === null ? "" : String(value)
}

/**
 * The origin line the file carries in its second row.
 *
 * `"local-seed"` is a token this codebase understands and a reader does not, so
 * it is stated in words. When the underlying read was cut short by a page
 * ceiling the file says so in the same cell: a truncated count is a lower
 * bound, and a lower bound that does not announce itself is a wrong number.
 */
export function fileOrigin(
  rawSource: string,
  incomplete: boolean,
  text: ReportText
): string {
  const key = `csv.origin.${rawSource}`
  const parts = [text.has(key) ? text(key) : rawSource]
  if (incomplete) parts.push(text("csv.incomplete"))
  return parts.join(" ")
}

/** The `sourceStatus.*` messages that carry `{code}` and must never be read bare. */
const CODE_FORM_STATUS_KEYS: ReadonlySet<string> = new Set([
  "sourceStatus.ok",
  "sourceStatus.redirectedCode",
  "sourceStatus.failed",
])

/**
 * `"200"` becomes "retrieved successfully (200)"; `"never_fetched"` becomes
 * "never retrieved". A status this module does not recognise is passed through
 * unchanged rather than described wrongly.
 *
 * The code is substituted as a string on purpose: as a number, ICU would format
 * `1000` with a thousands separator and invent a status code that does not
 * exist.
 *
 * Three numeric bands, not two. A `3xx` is not a failed fetch — the server
 * answered and named somewhere else — and calling it one would be a
 * wrong-but-plausible sentence in a file whose subject is how trustworthy the
 * retrieval was. The harvest records most redirects as the `redirected`
 * transport label rather than a bare code, but the band is reachable and a
 * reachable band that lies is still a lie.
 */
function describeStatus(
  value: string | number | null | undefined,
  text: ReportText
): string | null {
  const raw = asText(value)
  if (raw === "") return null

  if (/^\d{3}$/u.test(raw)) {
    const code = Number(raw)
    if (code >= 200 && code < 300) return text("sourceStatus.ok", { code: raw })
    if (code >= 300 && code < 400) {
      return text("sourceStatus.redirectedCode", { code: raw })
    }
    // 1xx included: a harvest whose final recorded status was informational
    // never received the body it went for, which is the failure this says.
    return text("sourceStatus.failed", { code: raw })
  }

  const key = `sourceStatus.${raw}`
  // The two namespaces share a prefix, so a transport label spelled like one of
  // the code-form keys would be resolved here and formatted without the `{code}`
  // those three carry — which ICU reports as an error string, in a spreadsheet
  // cell. No such label exists today; the guard is what keeps that true when the
  // harvest adds its next one.
  if (CODE_FORM_STATUS_KEYS.has(key)) return raw
  return text.has(key) ? text(key) : raw
}

// ---------------------------------------------------------------------------
// The two reports that can be downloaded today
// ---------------------------------------------------------------------------

export function coverageFileTable(
  base: ReportTable,
  options: { text: ReportText; incomplete: boolean }
): ReportTable {
  const { text, incomplete } = options

  const rows = base.rows.map((row) => {
    const metric = asText(row["metric"])
    const suffix = messageSuffix(metric)
    const labelKey = `coverageMetric.${suffix}`
    const basisKey = `coverageBasis.${suffix}`

    return {
      label: text.has(labelKey) ? text(labelKey) : metric,
      value: blankToNull(row["value"]),
      // The raw basis is the fallback, not a blank: an untranslated derivation
      // is still a derivation, and dropping it would strip the provenance
      // column this report is required to carry.
      basis: text.has(basisKey) ? text(basisKey) : blankToNull(row["basis"]),
      metric,
    }
  })

  return {
    ...base,
    columns: COVERAGE_FILE_COLUMNS,
    rows,
    source: fileOrigin(base.source, incomplete, text),
  }
}

export function registerFileTable(
  base: ReportTable,
  options: { text: ReportText; incomplete: boolean }
): ReportTable {
  const { text, incomplete } = options

  const rows = base.rows.map((row) => {
    const tier = blankToNull(row["tier"])
    const tierKey = `sourceTier.${asText(tier)}`

    return {
      publisher: blankToNull(row["publisher"]),
      url: blankToNull(row["url"]),
      tier,
      tierName: text.has(tierKey) ? text(tierKey) : null,
      fetchedAt: blankToNull(row["fetchedAt"]),
      lastStatus: describeStatus(row["lastStatus"], text),
      lastOk: blankToNull(row["lastOk"]),
      snapshotHash: blankToNull(row["snapshotHash"]),
    }
  })

  return {
    ...base,
    columns: REGISTER_FILE_COLUMNS,
    rows,
    source: fileOrigin(base.source, incomplete, text),
  }
}
