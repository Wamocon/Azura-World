/**
 * # Evidence repository — sources, snapshots, sourced facts, findings, search
 *
 * Owned by **W2-A**. The only path to the provenance store. Route handlers and
 * Server Components call these functions; nothing else touches
 * `public.sources`, `public.sourced_facts`, `public.findings` or the search
 * projection.
 *
 * Everything here goes through `withRepository()` (lib/repository-base.ts),
 * which is what makes the three rules below true by construction rather than
 * by discipline:
 *
 *  1. **Every function returns `RepositoryResult<T>` with a `source` field.**
 *     CONTRACTS §4. Check `source` before you suspect Postgres.
 *  2. **Unconfigured Supabase falls back and labels itself. Configured-but-
 *     failing THROWS.** No function in this file catches a Postgres error to
 *     serve seed data instead — that would hide an outage behind plausible
 *     numbers, which is the exact failure CONVENTIONS §2 was written against.
 *  3. **An empty result is `source: "supabase"` with empty data.** Zero rows is
 *     a fact about the database. Substituting the seed there is how a demo
 *     lies, and it is the first bug the W2-A brief names.
 *
 * ## What the RLS split means for the caller
 *
 * From migration `00000000000003_evidence.sql`:
 *
 *  - `sources`, `source_snapshots`, `sourced_facts`, `fact_sources`,
 *    `fact_conflicts` are readable by **anon**. They have to be: SYSTEM-PROMPT
 *    §2.1 requires every displayed fact to carry its source URL, including on
 *    the public landing page.
 *  - `findings` and `finding_values` are **manager+ only** (role level 70).
 *    A lower role legitimately receives **zero rows**, and that is not an
 *    error — `getFindings()` returns `[]` with `source: "supabase"` and
 *    `getEvidenceCoverage()` reports zero findings. Do not read that as an
 *    empty register, and do not fall back to the seed on the strength of it.
 *  - `operational_search_documents` is revoked from `authenticated` outright.
 *    `searchOperationalRecords()` calls the `search_operational_records` RPC,
 *    which is the only sanctioned read path.
 *
 * ## Query budget
 *
 * Nothing here is N+1. `loadSourceIndex()` reads the source register and its
 * snapshots **once** (2 bounded queries) and every citation resolves against
 * that map, so a findings page with 24 findings and 120 competing values still
 * costs 3 queries.
 */

import type {
  Confidence,
  Finding,
  RepositoryResult,
  SourceRef,
  SourceTier,
  SourcedFact,
} from "@/lib/contracts"
import {
  asBoolean,
  asNullableNumber,
  asNullableString,
  asNumber,
  asRecord,
  asString,
  clampLimit,
  degraded,
  MAX_PAGE_SIZE,
  nowIso,
  RepositoryError,
  withRepository,
  type RepositoryClient,
} from "@/lib/repository-base"
import {
  seedFactEntries,
  seedFactsForEntity,
  seedFindings,
  seedSearchDocuments,
  seedSourceRecords,
  seedSources,
} from "@/lib/evidence-data"

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/** Filter for `getFindings()`. `resolved` tests `resolvedTo !== null`. */
export interface FindingFilter {
  severity?: Finding["severity"]
  area?: Finding["area"]
  /** `true` = only findings with a resolved value; `false` = only open ones. */
  resolved?: boolean
}

/** One row of the source-health board. */
export interface SourceHealthEntry {
  source: SourceRef
  /**
   * `http_status` of the newest snapshot — a numeric string like `"200"`, or a
   * transport label like `"robots_disallowed"` / `"expect_missing"`. The
   * sentinel {@link NEVER_FETCHED} means there is no snapshot at all, which is
   * a different claim from a failed fetch and is stored as one.
   */
  lastStatus: string
  /** ISO time of the newest snapshot whose BYTES validated, else `null`. */
  lastOk: string | null
}

/** Sentinel `lastStatus` for a source with no snapshot rows at all. */
export const NEVER_FETCHED = "never_fetched"

/** One hit from `search_operational_records`. */
export interface SearchHit {
  entityTable: string
  entityId: string
  title: string
  summary: string | null
  /** The RPC's combined full-text + trigram rank. `0` is a legitimate value. */
  rank: number
  metadata: Record<string, unknown>
}

/**
 * The dataset's self-assessment.
 *
 * Deliberately unflattering. Nothing here is rounded, bucketed or smoothed:
 * `declaredGaps` is meant to be large, `established` is meant to look small
 * beside it, and `neverFetched` is meant to name the sources nobody was allowed
 * to read. A coverage report that is comfortable to read has been edited.
 */
export interface CoverageReport {
  generatedAt: string
  totals: {
    sources: number
    snapshots: number
    facts: number
    /** Rows in `fact_sources`: one citation, one fact, one snapshot. */
    citations: number
    /** Zero for a caller below manager — RLS, not an empty register. */
    findings: number
  }
  facts: {
    byConfidence: Record<Confidence, number>
    /** `confirmed` + `official`. The only two that mean "established". */
    established: number
    /** `single_source` + `conflicted` + `inferred`. Carried, not established. */
    provisional: number
    /** `gap`. A declared absence is honesty; a large number is not a failure. */
    declaredGaps: number
    /** Citations storing no snapshot hash: a URL with no bytes behind it. */
    citationsWithoutSnapshot: number
  }
  sources: {
    byTier: Record<SourceTier, number>
    byReachability: {
      /** At least one snapshot whose body was validated. */
      validated: number
      /** Fetched, but no snapshot validated — bot wall, soft-404, redirect. */
      fetchedNotValidated: number
      /** No snapshot at all: robots.txt refused, or never attempted. */
      neverFetched: number
    }
    /** Invariant 3 counts corroboration in HOSTS, so the register does too. */
    distinctHosts: number
    /** Tier 1-3: official, developer, hotel operator. */
    authoritative: number
  }
  findings: {
    bySeverity: Record<Finding["severity"], number>
    byArea: Record<Finding["area"], number>
    /** `resolvedTo === null` — deliberately open. */
    unresolved: number
  }
  /** True when a page ceiling was hit: every number above is a lower bound. */
  truncated: boolean
}

// ---------------------------------------------------------------------------
// Counting templates
//
// Each is an exhaustive object literal, so widening one of the frozen unions in
// CONTRACTS.md breaks compilation here rather than silently dropping a bucket.
// ---------------------------------------------------------------------------

function emptyConfidenceCounts(): Record<Confidence, number> {
  return {
    confirmed: 0,
    official: 0,
    single_source: 0,
    conflicted: 0,
    inferred: 0,
    gap: 0,
  }
}

/** Kept in step with `emptyConfidenceCounts()` — the compiler checks that one. */
const CONFIDENCE_VALUES: Confidence[] = [
  "confirmed",
  "official",
  "single_source",
  "conflicted",
  "inferred",
  "gap",
]

const SEVERITY_VALUES: Array<Finding["severity"]> = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
]

const AREA_VALUES: Array<Finding["area"]> = [
  "structure",
  "pricing",
  "timeline",
  "geography",
  "branding",
  "availability",
  "harvest",
]

function emptySeverityCounts(): Record<Finding["severity"], number> {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
}

function emptyAreaCounts(): Record<Finding["area"], number> {
  return {
    structure: 0,
    pricing: 0,
    timeline: 0,
    geography: 0,
    branding: 0,
    availability: 0,
    harvest: 0,
  }
}

function emptyTierCounts(): Record<SourceTier, number> {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }
}

function isConfidence(value: unknown): value is Confidence {
  return CONFIDENCE_VALUES.some((candidate) => candidate === value)
}

function isSeverity(value: unknown): value is Finding["severity"] {
  return SEVERITY_VALUES.some((candidate) => candidate === value)
}

function isArea(value: unknown): value is Finding["area"] {
  return AREA_VALUES.some((candidate) => candidate === value)
}

/**
 * Narrow `sources.tier` to the frozen union.
 *
 * A value outside 1-6 cannot exist while the CHECK constraint stands. If one
 * ever does it is clamped to **6** — the lowest authority — because tier
 * decides which source wins the displayed value, and a corrupt tier must never
 * be able to promote a press blog above the developer's own site.
 */
function toSourceTier(value: unknown): SourceTier {
  const parsed = asNullableNumber(value)
  if (
    parsed === 1 ||
    parsed === 2 ||
    parsed === 3 ||
    parsed === 4 ||
    parsed === 5 ||
    parsed === 6
  ) {
    return parsed
  }
  return 6
}

function asRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.map((row) => asRecord(row))
}

// ---------------------------------------------------------------------------
// The source index
//
// `SourceRef` (CONTRACTS §1) is a JOIN: url/publisher/tier come from
// `public.sources`, fetchedAt/snapshotHash from `public.source_snapshots`.
// Resolving that per citation would be N+1 across a findings page, so the two
// tables are read once and every citation is looked up in memory.
// ---------------------------------------------------------------------------

interface SourceRegisterRow {
  id: string
  publisher: string
  tier: SourceTier
  url: string
  host: string
  kind: string
}

interface SnapshotRow {
  sourceId: string
  fetchedAt: string
  httpStatus: string
  snapshotHash: string | null
  bytes: number
  contentValidated: boolean
}

interface SourceIndex {
  /** Register rows in id order. */
  all: SourceRegisterRow[]
  byId: Map<string, SourceRegisterRow>
  snapshotByHash: Map<string, SnapshotRow>
  latestBySourceId: Map<string, SnapshotRow>
  latestValidatedBySourceId: Map<string, SnapshotRow>
  /** A page ceiling was reached: the index is a partial view. */
  truncated: boolean
}

const SOURCE_SELECT = "id, publisher, tier, url, host, kind"
const SNAPSHOT_SELECT =
  "source_id, fetched_at, http_status, snapshot_sha256, bytes, content_validated"

const TRUNCATION_NOTE =
  `The source register or its snapshots exceeded the ${MAX_PAGE_SIZE}-row page ` +
  `ceiling; citations naming a source outside that page resolve without a ` +
  `retrieval time, and any count below is a lower bound.`

async function loadSourceIndex(client: RepositoryClient): Promise<SourceIndex> {
  const ceiling = clampLimit(MAX_PAGE_SIZE)

  // Two bounded queries, run together. Never `select()` unbounded — W2-A brief.
  const [sourceResponse, snapshotResponse] = await Promise.all([
    client.from("sources").select(SOURCE_SELECT).order("id").limit(ceiling),
    client
      .from("source_snapshots")
      .select(SNAPSHOT_SELECT)
      .order("fetched_at", { ascending: false })
      .limit(ceiling),
  ])

  if (sourceResponse.error) throw sourceResponse.error
  if (snapshotResponse.error) throw snapshotResponse.error

  const sourceRows = asRows(sourceResponse.data)
  const snapshotRows = asRows(snapshotResponse.data)

  const all: SourceRegisterRow[] = []
  const byId = new Map<string, SourceRegisterRow>()
  for (const row of sourceRows) {
    const id = asString(row["id"])
    if (id === "") continue
    const register: SourceRegisterRow = {
      id,
      publisher: asString(row["publisher"]),
      tier: toSourceTier(row["tier"]),
      url: asString(row["url"]),
      host: asString(row["host"]),
      kind: asString(row["kind"]),
    }
    all.push(register)
    byId.set(id, register)
  }

  const snapshotByHash = new Map<string, SnapshotRow>()
  const latestBySourceId = new Map<string, SnapshotRow>()
  const latestValidatedBySourceId = new Map<string, SnapshotRow>()

  for (const row of snapshotRows) {
    const sourceId = asString(row["source_id"])
    if (sourceId === "") continue

    const snapshot: SnapshotRow = {
      sourceId,
      fetchedAt: asString(row["fetched_at"]),
      httpStatus: asString(row["http_status"]),
      snapshotHash: asNullableString(row["snapshot_sha256"]),
      bytes: asNumber(row["bytes"], 0),
      contentValidated: asBoolean(row["content_validated"]),
    }

    if (snapshot.snapshotHash !== null) {
      snapshotByHash.set(snapshot.snapshotHash, snapshot)
    }

    const currentLatest = latestBySourceId.get(sourceId)
    if (
      currentLatest === undefined ||
      snapshot.fetchedAt > currentLatest.fetchedAt
    ) {
      latestBySourceId.set(sourceId, snapshot)
    }

    if (snapshot.contentValidated) {
      const currentOk = latestValidatedBySourceId.get(sourceId)
      if (currentOk === undefined || snapshot.fetchedAt > currentOk.fetchedAt) {
        latestValidatedBySourceId.set(sourceId, snapshot)
      }
    }
  }

  return {
    all,
    byId,
    snapshotByHash,
    latestBySourceId,
    latestValidatedBySourceId,
    truncated: sourceRows.length >= ceiling || snapshotRows.length >= ceiling,
  }
}

/**
 * The `SourceRef` a citation points at: the named source, at the exact snapshot
 * it was read from.
 *
 * Returns `null` when the source is not in the register — a citation naming a
 * source that does not exist is not a citation, and passing it on would put an
 * unopenable URL beside a number.
 *
 * When `snapshotHash` is null (the column is nullable) or names a snapshot
 * outside the loaded page, `fetchedAt` stays `""`. It is never back-filled from
 * the source's newest snapshot: that would attach a fact to bytes it was not
 * read from, which is worse than admitting the retrieval time is unknown.
 */
function citationRef(
  index: SourceIndex,
  sourceId: string,
  snapshotHash: string | null
): SourceRef | null {
  const register = index.byId.get(sourceId)
  if (register === undefined) return null

  const hash = snapshotHash ?? ""
  const snapshot = hash === "" ? undefined : index.snapshotByHash.get(hash)

  return {
    url: register.url,
    publisher: register.publisher,
    fetchedAt: snapshot?.fetchedAt ?? "",
    snapshotHash: hash,
    tier: register.tier,
  }
}

/**
 * The `SourceRef` for the register itself — the newest snapshot of a source.
 *
 * A source that was never fetched carries `fetchedAt: ""` and
 * `snapshotHash: ""`. That is the honest record of "we were not allowed to
 * look" (F-015, Facebook's `Disallow: /`), and it is deliberately
 * distinguishable from a fetch that failed. Such a ref must never be attached
 * to a `SourcedFact` — it would fail CONTRACTS §1 invariant 6 — and it is not:
 * facts cite through `citationRef()`, which starts from a stored snapshot.
 */
function registerRef(index: SourceIndex, row: SourceRegisterRow): SourceRef {
  const latest = index.latestBySourceId.get(row.id)
  return {
    url: row.url,
    publisher: row.publisher,
    fetchedAt: latest?.fetchedAt ?? "",
    snapshotHash: latest?.snapshotHash ?? "",
    tier: row.tier,
  }
}

// ---------------------------------------------------------------------------
// Input validation — CONVENTIONS §4.3, at the boundary
// ---------------------------------------------------------------------------

const MAX_ENTITY_TYPE_LENGTH = 64
const MAX_ENTITY_ID_LENGTH = 128
/** `public.search_operational_records` raises SQLSTATE 22023 above this. */
const MAX_SEARCH_QUERY_LENGTH = 120
/** Migration 10 hard-caps the RPC at 50 rows. Asking for more is a lie. */
const SEARCH_DEFAULT_LIMIT = 20
const SEARCH_MAX_LIMIT = 50
/** `public.findings.id` — the CHECK constraint's own pattern. */
const FINDING_ID_PATTERN = /^F-\d{3}$/

function validationError(message: string, field: string): RepositoryError {
  return new RepositoryError({
    code: "validation_failed",
    message,
    details: { field },
    retryable: false,
  })
}

// ---------------------------------------------------------------------------
// getSources
// ---------------------------------------------------------------------------

/**
 * The source register, in id order, one `SourceRef` per source.
 *
 * Bounded at {@link MAX_PAGE_SIZE}. An empty register comes back as an empty
 * array with `source: "supabase"` — never as the seed.
 */
export async function getSources(): Promise<RepositoryResult<SourceRef[]>> {
  let truncated = false

  const result = await withRepository(
    async (client) => {
      const index = await loadSourceIndex(client)
      truncated = index.truncated
      return index.all.map((row) => registerRef(index, row))
    },
    () => seedSources(),
    "evidence.getSources"
  )

  return truncated ? degraded(result, TRUNCATION_NOTE) : result
}

// ---------------------------------------------------------------------------
// getSourceHealth
// ---------------------------------------------------------------------------

function seedSourceHealth(): SourceHealthEntry[] {
  return seedSourceRecords().map((record) => {
    let newest: (typeof record.snapshots)[number] | null = null
    let lastOk: string | null = null

    for (const snapshot of record.snapshots) {
      if (newest === null || snapshot.fetchedAt > newest.fetchedAt) {
        newest = snapshot
      }
      if (snapshot.contentValidated) {
        if (lastOk === null || snapshot.fetchedAt > lastOk) {
          lastOk = snapshot.fetchedAt
        }
      }
    }

    return {
      source: {
        url: record.url,
        publisher: record.publisher,
        fetchedAt: newest?.fetchedAt ?? "",
        snapshotHash: newest?.snapshotSha256 ?? "",
        tier: record.tier,
      },
      lastStatus: newest?.httpStatus ?? NEVER_FETCHED,
      lastOk,
    }
  })
}

/**
 * Reachability of every source: what the last fetch returned, and when the last
 * one that actually carried usable bytes happened.
 *
 * `lastOk` is the newest snapshot whose **body** validated — CONVENTIONS §5:
 * validate the bytes, not the status line. A source can therefore report
 * `lastStatus: "200"` with `lastOk: null`, which is exactly what a bot wall
 * wearing a 200 looks like, and exactly what Ataberg shipped 51 times.
 */
export async function getSourceHealth(): Promise<
  RepositoryResult<SourceHealthEntry[]>
> {
  let truncated = false

  const result = await withRepository(
    async (client) => {
      const index = await loadSourceIndex(client)
      truncated = index.truncated

      return index.all.map((row) => {
        const latest = index.latestBySourceId.get(row.id)
        const validated = index.latestValidatedBySourceId.get(row.id)
        return {
          source: registerRef(index, row),
          lastStatus: latest?.httpStatus ?? NEVER_FETCHED,
          lastOk: validated?.fetchedAt ?? null,
        }
      })
    },
    () => seedSourceHealth(),
    "evidence.getSourceHealth"
  )

  return truncated ? degraded(result, TRUNCATION_NOTE) : result
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

const FINDING_SELECT =
  "id, severity, area, field_path, message, resolution, resolved_to, " +
  "finding_values(value, source_id, snapshot_sha256)"

function mapFinding(
  index: SourceIndex,
  row: Record<string, unknown>
): Finding | null {
  const id = asString(row["id"])
  const severity = row["severity"]
  const area = row["area"]

  // The enums make this unreachable. If it is ever reached the row is corrupt,
  // and a Finding wearing an invented severity would be worse than a missing
  // one: "medium" on a critical pricing defect is a lie the UI renders calmly.
  // The count is surfaced as a `degradedReason` rather than swallowed.
  if (id === "" || !isSeverity(severity) || !isArea(area)) return null

  const competingValues: Finding["competingValues"] = []
  for (const child of asRows(row["finding_values"])) {
    const source = citationRef(
      index,
      asString(child["source_id"]),
      asNullableString(child["snapshot_sha256"])
    )
    if (source === null) continue
    competingValues.push({ value: child["value"] ?? null, source })
  }

  return {
    id,
    severity,
    area,
    field: asString(row["field_path"]),
    message: asString(row["message"]),
    competingValues,
    resolution: asString(row["resolution"]),
    // A SQL NULL and a stored JSON `null` are indistinguishable over PostgREST,
    // and both carry the same documented meaning: deliberately unresolved.
    resolvedTo: row["resolved_to"] ?? null,
  }
}

function matchesFilter(finding: Finding, filter?: FindingFilter): boolean {
  if (filter === undefined) return true
  if (filter.severity !== undefined && finding.severity !== filter.severity) {
    return false
  }
  if (filter.area !== undefined && finding.area !== filter.area) return false
  if (filter.resolved !== undefined) {
    if ((finding.resolvedTo !== null) !== filter.resolved) return false
  }
  return true
}

/**
 * The conflict register, ordered critical-first then by id.
 *
 * **Manager+ only.** `findings` carries `using (has_role_level(70))`, so a
 * staff, owner or anonymous caller receives `[]` with `source: "supabase"`.
 * That is RLS working, not an empty register and not an error.
 */
export async function getFindings(
  filter?: FindingFilter
): Promise<RepositoryResult<Finding[]>> {
  let skipped = 0
  let truncated = false

  const result = await withRepository(
    async (client) => {
      const index = await loadSourceIndex(client)
      truncated = index.truncated

      let query = client
        .from("findings")
        .select(FINDING_SELECT)
        // Postgres orders an enum by declaration order and `finding_severity`
        // is declared critical → info, so ascending is worst-first — the only
        // sane default for a register whose job is to be uncomfortable.
        .order("severity", { ascending: true })
        .order("id", { ascending: true })
        .limit(clampLimit(MAX_PAGE_SIZE))

      if (filter?.severity !== undefined) {
        query = query.eq("severity", filter.severity)
      }
      if (filter?.area !== undefined) {
        query = query.eq("area", filter.area)
      }
      if (filter?.resolved === true) {
        query = query.not("resolved_to", "is", null)
      }
      if (filter?.resolved === false) {
        query = query.is("resolved_to", null)
      }

      const { data, error } = await query
      if (error) throw error

      const findings: Finding[] = []
      for (const row of asRows(data)) {
        const finding = mapFinding(index, row)
        if (finding === null) {
          skipped += 1
          continue
        }
        findings.push(finding)
      }
      return findings
    },
    () => seedFindings().filter((finding) => matchesFilter(finding, filter)),
    "evidence.getFindings"
  )

  const withTruncation = truncated ? degraded(result, TRUNCATION_NOTE) : result
  return skipped === 0
    ? withTruncation
    : degraded(
        withTruncation,
        `${skipped} finding row(s) carried a severity or area outside the frozen contract and were omitted.`
      )
}

/**
 * One finding by id, or `null` when it does not exist — or when the caller is
 * below manager and RLS hides it. Those two are indistinguishable to the client
 * on purpose: "that finding exists but you may not see it" leaks the register's
 * shape.
 *
 * A malformed id answers `null` without a round trip. `public.findings.id` is
 * `CHECK (id ~ '^F-[0-9]{3}$')`, so anything else cannot exist. The short
 * circuit lives *inside* `withRepository` so the `source` label still reports
 * where the answer would have come from.
 */
export async function getFinding(
  id: string
): Promise<RepositoryResult<Finding | null>> {
  const wellFormed = FINDING_ID_PATTERN.test(id)

  return withRepository(
    async (client) => {
      if (!wellFormed) return null

      const index = await loadSourceIndex(client)

      const { data, error } = await client
        .from("findings")
        .select(FINDING_SELECT)
        .eq("id", id)
        .limit(1)

      if (error) throw error

      // `noUncheckedIndexedAccess`: this is `Record<string, unknown> |
      // undefined`. `.single()` is deliberately not used — it raises PGRST116
      // for zero rows, which would turn "not found" into a thrown error when
      // the contract says `null`.
      const row = asRows(data)[0]
      if (row === undefined) return null

      return mapFinding(index, row)
    },
    () =>
      wellFormed
        ? (seedFindings().find((finding) => finding.id === id) ?? null)
        : null,
    "evidence.getFinding"
  )
}

// ---------------------------------------------------------------------------
// Sourced facts
// ---------------------------------------------------------------------------

const FACT_SELECT =
  "entity_type, entity_id, field_path, value, confidence, note, " +
  "fact_sources(source_id, snapshot_sha256), " +
  "fact_conflicts(value, source_id, snapshot_sha256)"

function mapFact(
  index: SourceIndex,
  row: Record<string, unknown>
): { fieldPath: string; fact: SourcedFact<unknown> } | null {
  const fieldPath = asString(row["field_path"])
  const confidence = row["confidence"]
  if (fieldPath === "" || !isConfidence(confidence)) return null

  const sources: SourceRef[] = []
  for (const child of asRows(row["fact_sources"])) {
    const source = citationRef(
      index,
      asString(child["source_id"]),
      asNullableString(child["snapshot_sha256"])
    )
    if (source !== null) sources.push(source)
  }

  const conflictsWith: NonNullable<SourcedFact<unknown>["conflictsWith"]> = []
  for (const child of asRows(row["fact_conflicts"])) {
    const source = citationRef(
      index,
      asString(child["source_id"]),
      asNullableString(child["snapshot_sha256"])
    )
    if (source === null) continue
    conflictsWith.push({ value: child["value"] ?? null, source })
  }

  const note = asNullableString(row["note"])
  const hasNote = note !== null && note.trim() !== ""

  // `exactOptionalPropertyTypes` is on: `conflictsWith: undefined` is not
  // assignable to `conflictsWith?: ...`, so both optional keys are spread in
  // conditionally rather than assigned and then tidied up.
  const fact: SourcedFact<unknown> = {
    // `??` and not `||`: jsonb `false` and jsonb `0` are values, and a
    // truthiness test here would turn either into a null gap.
    value: row["value"] ?? null,
    sources,
    confidence,
    ...(conflictsWith.length > 0 ? { conflictsWith } : {}),
    ...(hasNote ? { note } : {}),
  }

  return { fieldPath, fact }
}

/**
 * Every recorded fact for one entity, keyed by its dotted field path
 * (`"project.residenceBlockCount"`).
 *
 * Readable by anon — these ARE the citations rendered beside public numbers.
 *
 * `assertFactInvariants()` is deliberately **not** run over rows read from
 * Supabase. The same six invariants are enforced there by CHECK constraints and
 * deferred constraint triggers (migration `…0003_evidence.sql`), and re-running
 * them here would convert one bad row into a 503 on a page that could otherwise
 * have rendered the other twenty facts honestly. The seed path does assert,
 * because nothing else guards it.
 */
export async function getFactsForEntity(
  type: string,
  id: string
): Promise<RepositoryResult<Record<string, SourcedFact<unknown>>>> {
  if (type.length > MAX_ENTITY_TYPE_LENGTH) {
    throw validationError("Unknown entity type.", "type")
  }
  if (id.length > MAX_ENTITY_ID_LENGTH) {
    throw validationError("Unknown entity id.", "id")
  }

  let skipped = 0
  let truncated = false

  const result = await withRepository(
    async (client) => {
      const index = await loadSourceIndex(client)
      truncated = index.truncated

      const { data, error } = await client
        .from("sourced_facts")
        .select(FACT_SELECT)
        .eq("entity_type", type)
        .eq("entity_id", id)
        .order("field_path", { ascending: true })
        .limit(clampLimit(MAX_PAGE_SIZE))

      if (error) throw error

      const facts: Record<string, SourcedFact<unknown>> = {}
      for (const row of asRows(data)) {
        const mapped = mapFact(index, row)
        if (mapped === null) {
          skipped += 1
          continue
        }
        facts[mapped.fieldPath] = mapped.fact
      }
      return facts
    },
    () => seedFactsForEntity(type, id),
    "evidence.getFactsForEntity"
  )

  const withTruncation = truncated ? degraded(result, TRUNCATION_NOTE) : result
  return skipped === 0
    ? withTruncation
    : degraded(
        withTruncation,
        `${skipped} fact row(s) carried a confidence outside the frozen contract and were omitted.`
      )
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

interface SourceSummaryInput {
  tier: SourceTier
  host: string
  snapshots: Array<{ contentValidated: boolean }>
}

function summariseSources(
  records: SourceSummaryInput[]
): CoverageReport["sources"] {
  const byTier = emptyTierCounts()
  const hosts = new Set<string>()
  let validated = 0
  let fetchedNotValidated = 0
  let neverFetched = 0
  let authoritative = 0

  for (const record of records) {
    byTier[record.tier] += 1
    if (record.tier <= 3) authoritative += 1
    if (record.host !== "") hosts.add(record.host)

    if (record.snapshots.length === 0) {
      neverFetched += 1
    } else if (record.snapshots.some((snapshot) => snapshot.contentValidated)) {
      validated += 1
    } else {
      fetchedNotValidated += 1
    }
  }

  return {
    byTier,
    byReachability: { validated, fetchedNotValidated, neverFetched },
    distinctHosts: hosts.size,
    authoritative,
  }
}

interface FindingSummaryInput {
  severity: Finding["severity"]
  area: Finding["area"]
  resolvedTo: unknown
}

function summariseFindings(
  findings: FindingSummaryInput[]
): CoverageReport["findings"] {
  const bySeverity = emptySeverityCounts()
  const byArea = emptyAreaCounts()
  let unresolved = 0

  for (const finding of findings) {
    bySeverity[finding.severity] += 1
    byArea[finding.area] += 1
    if (finding.resolvedTo === null) unresolved += 1
  }

  return { bySeverity, byArea, unresolved }
}

function summariseFacts(
  byConfidence: Record<Confidence, number>,
  citationsWithoutSnapshot: number
): CoverageReport["facts"] {
  return {
    byConfidence,
    established: byConfidence.confirmed + byConfidence.official,
    provisional:
      byConfidence.single_source +
      byConfidence.conflicted +
      byConfidence.inferred,
    declaredGaps: byConfidence.gap,
    citationsWithoutSnapshot,
  }
}

/**
 * Coverage over the seed.
 *
 * Counted by walking `seedFactEntries()` rather than a list of entity keys, so
 * a fact added to the seed is counted without anyone remembering to update this
 * function. The Supabase path never needs the walk — it counts with
 * `head: true` server-side.
 */
function seedCoverage(): CoverageReport {
  const records = seedSourceRecords()
  const findings = seedFindings()

  const byConfidence = emptyConfidenceCounts()
  let facts = 0
  let citations = 0
  let citationsWithoutSnapshot = 0
  let snapshots = 0

  for (const record of records) {
    snapshots += record.snapshots.length
  }

  for (const entry of seedFactEntries()) {
    facts += 1
    byConfidence[entry.fact.confidence] += 1
    for (const source of entry.fact.sources) {
      citations += 1
      if (source.snapshotHash === "") citationsWithoutSnapshot += 1
    }
  }

  return {
    generatedAt: nowIso(),
    totals: {
      sources: records.length,
      snapshots,
      facts,
      citations,
      findings: findings.length,
    },
    facts: summariseFacts(byConfidence, citationsWithoutSnapshot),
    sources: summariseSources(
      records.map((record) => ({
        tier: record.tier,
        host: record.host,
        snapshots: record.snapshots,
      }))
    ),
    findings: summariseFindings(findings),
    truncated: false,
  }
}

/**
 * The dataset's honest self-assessment: facts by confidence, sources by
 * reachability, findings by severity, and the totals behind each.
 *
 * Costs a constant 11 bounded queries regardless of dataset size — the fact
 * table is 1354 rows and is counted with `head: true` server-side rather than
 * paged into memory.
 *
 * Two things it deliberately does not do:
 *
 *  - It does not re-derive invariant 5 (a non-`gap` fact with no citation).
 *    A deferred constraint trigger in migration `…0003_evidence.sql` makes such
 *    a row impossible to commit, so a second check here could only ever
 *    disagree with the database.
 *  - It does not distinguish "no findings" from "you may not read findings".
 *    `findings` is manager+ under RLS; a staff caller sees `totals.findings: 0`
 *    and that is correct for what they may know.
 */
export async function getEvidenceCoverage(): Promise<
  RepositoryResult<CoverageReport>
> {
  return withRepository(
    async (client) => {
      const ceiling = clampLimit(MAX_PAGE_SIZE)

      // Two groups so TypeScript keeps the fixed queries as a tuple; a spread
      // inside one array literal would collapse them all to a union.
      const [
        [
          sourceResponse,
          snapshotResponse,
          findingResponse,
          citationResponse,
          citationGapResponse,
        ],
        confidenceResponses,
      ] = await Promise.all([
        Promise.all([
          client.from("sources").select("id, tier, host").limit(ceiling),
          client
            .from("source_snapshots")
            .select("source_id, content_validated")
            .limit(ceiling),
          client
            .from("findings")
            .select("severity, area, resolved_to")
            .limit(ceiling),
          client
            .from("fact_sources")
            .select("id", { count: "exact", head: true }),
          client
            .from("fact_sources")
            .select("id", { count: "exact", head: true })
            .is("snapshot_sha256", null),
        ]),
        Promise.all(
          CONFIDENCE_VALUES.map((confidence) =>
            client
              .from("sourced_facts")
              .select("id", { count: "exact", head: true })
              .eq("confidence", confidence)
          )
        ),
      ])

      if (sourceResponse.error) throw sourceResponse.error
      if (snapshotResponse.error) throw snapshotResponse.error
      if (findingResponse.error) throw findingResponse.error
      if (citationResponse.error) throw citationResponse.error
      if (citationGapResponse.error) throw citationGapResponse.error

      const byConfidence = emptyConfidenceCounts()
      let facts = 0
      for (const [position, confidence] of CONFIDENCE_VALUES.entries()) {
        const response = confidenceResponses[position]
        if (response === undefined) continue
        if (response.error) throw response.error
        // `count` is a number whenever `count: "exact"` is requested; the
        // default exists only so a missing header cannot become NaN.
        const value = asNumber(response.count, 0)
        byConfidence[confidence] = value
        facts += value
      }

      // Snapshots grouped onto their source, so reachability is measured per
      // source rather than per fetch attempt.
      const snapshotsBySource = new Map<
        string,
        Array<{ contentValidated: boolean }>
      >()
      const snapshotRows = asRows(snapshotResponse.data)
      for (const row of snapshotRows) {
        const sourceId = asString(row["source_id"])
        if (sourceId === "") continue
        const bucket = snapshotsBySource.get(sourceId) ?? []
        bucket.push({ contentValidated: asBoolean(row["content_validated"]) })
        snapshotsBySource.set(sourceId, bucket)
      }

      const sourceRows = asRows(sourceResponse.data)
      const findingRows = asRows(findingResponse.data)

      const findings: FindingSummaryInput[] = []
      for (const row of findingRows) {
        const severity = row["severity"]
        const area = row["area"]
        if (!isSeverity(severity) || !isArea(area)) continue
        findings.push({
          severity,
          area,
          resolvedTo: row["resolved_to"] ?? null,
        })
      }

      return {
        generatedAt: nowIso(),
        totals: {
          sources: sourceRows.length,
          snapshots: snapshotRows.length,
          facts,
          citations: asNumber(citationResponse.count, 0),
          findings: findings.length,
        },
        facts: summariseFacts(
          byConfidence,
          asNumber(citationGapResponse.count, 0)
        ),
        sources: summariseSources(
          sourceRows.map((row) => ({
            tier: toSourceTier(row["tier"]),
            host: asString(row["host"]),
            snapshots: snapshotsBySource.get(asString(row["id"])) ?? [],
          }))
        ),
        findings: summariseFindings(findings),
        truncated:
          sourceRows.length >= ceiling ||
          snapshotRows.length >= ceiling ||
          findingRows.length >= ceiling,
      }
    },
    () => seedCoverage(),
    "evidence.getEvidenceCoverage"
  )
}

// ---------------------------------------------------------------------------
// Search
//
// `public.operational_search_documents` is revoked from `authenticated`
// entirely (migration `…0010_search.sql`), so there is no table read here and
// there must never be one. The RPC is SECURITY DEFINER and enforces, in this
// order: role level >= 40, company scope, a per-row `min_role_level` floor, a
// 120-character input ceiling, and a 50-row result ceiling.
// ---------------------------------------------------------------------------

/**
 * Locale-invariant folding, matching the RPC's `'simple'` text configuration.
 *
 * Deliberately **not** `toLocaleLowerCase("tr")`. The corpus is four-language
 * (CONTRACTS §7) and Turkish folding maps `"I"` to `"ı"` — right for one
 * language, wrong for the other three. The RPC makes the same call for the same
 * reason, and seed mode has to behave like the RPC or it is a different feature
 * wearing its name.
 */
function fold(value: string): string {
  return value.toLowerCase()
}

/**
 * Deterministic seed-mode ranking. Not `ts_rank_cd` plus trigram similarity —
 * it approximates the RPC's ORDERING, not its scores, and is stable across runs
 * so Playwright snapshots hold.
 */
function seedRank(
  document: { title: string; summary: string | null },
  needle: string
): number {
  const title = fold(document.title)
  const summary = fold(document.summary ?? "")
  let rank = 0
  if (title.includes(needle)) rank += 2
  if (title.startsWith(needle)) rank += 1
  if (summary.includes(needle)) rank += 1
  return rank
}

/** The authority floor the RPC itself demands of any searcher: staff. */
const SEED_SEARCH_ROLE_LEVEL = 40

function seedSearch(query: string, limit: number): SearchHit[] {
  const needle = fold(query)
  if (needle === "") return []

  return seedSearchDocuments()
    .filter((document) => document.minRoleLevel <= SEED_SEARCH_ROLE_LEVEL)
    .map((document) => ({
      entityTable: document.entityTable,
      entityId: document.entityId,
      title: document.title,
      summary: document.summary,
      rank: seedRank(document, needle),
      metadata: document.metadata,
    }))
    .filter((hit) => hit.rank > 0)
    .sort((a, b) => {
      if (a.rank !== b.rank) return b.rank - a.rank
      if (a.entityTable !== b.entityTable) {
        return a.entityTable < b.entityTable ? -1 : 1
      }
      return a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0
    })
    .slice(0, limit)
}

/**
 * Global operational search, through the only sanctioned read path.
 *
 * The 120-character ceiling is enforced **here as well as** in the RPC, which
 * raises SQLSTATE 22023 for a longer query. Checking client-side turns that
 * into a typed `validation_failed` instead of a wasted round trip returning an
 * unmapped Postgres code — CONVENTIONS §4.3 puts length ceilings at the
 * boundary, and this is the boundary.
 *
 * A role below staff (level 40) makes the RPC raise 42501, which
 * `toApiError()` maps to `forbidden`. That throw is correct: unlike an empty
 * `findings` read, the caller asked for something they may not have, and an
 * empty list would tell them the index is empty.
 *
 * **Seed mode cannot know the caller's role**, so it returns only documents at
 * `minRoleLevel <= 40` — the floor the RPC demands of any searcher. It can
 * under-disclose; it can never over-disclose, which is the safe direction.
 */
export async function searchOperationalRecords(
  query: string,
  limit?: number
): Promise<RepositoryResult<SearchHit[]>> {
  const trimmed = query.trim()

  if (trimmed.length > MAX_SEARCH_QUERY_LENGTH) {
    throw validationError(
      `Search query is too long (maximum ${MAX_SEARCH_QUERY_LENGTH} characters).`,
      "query"
    )
  }

  // The RPC's own ceiling, not `clampLimit`'s 50/500: migration 10 caps the
  // result set at 50, and promising more than the server will return is a lie
  // in the API surface rather than a harmless default.
  const bounded =
    limit === undefined || !Number.isFinite(limit)
      ? SEARCH_DEFAULT_LIMIT
      : Math.min(Math.max(Math.trunc(limit), 1), SEARCH_MAX_LIMIT)

  return withRepository(
    async (client) => {
      // An empty query is not an error and not a full-table scan. The RPC
      // returns nothing for one, so returning nothing without a round trip
      // agrees with it.
      if (trimmed === "") return []

      const { data, error } = await client.rpc("search_operational_records", {
        p_query: trimmed,
        p_limit: bounded,
      })

      if (error) throw error

      return asRows(data).map((row) => ({
        entityTable: asString(row["entity_table"]),
        entityId: asString(row["entity_id"]),
        title: asString(row["title"]),
        summary: asNullableString(row["summary"]),
        // `real`, not `numeric` — PostgREST sends it as a JSON number. `0` is a
        // legitimate rank (the RPC scores a trigram-only match at 0), so the
        // default here is a parse guard, not a business default.
        rank: asNumber(row["rank"], 0),
        metadata: asRecord(row["metadata"]),
      }))
    },
    () => seedSearch(trimmed, bounded),
    "evidence.searchOperationalRecords"
  )
}
