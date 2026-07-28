import { ExternalLink } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/cn"
import type { SourceRef, SourcedFact } from "@/lib/contracts"

/**
 * Which portal says what about the project.                  Owner: W3-C / N1
 *
 * ## The question this answers
 *
 * The listings tell you what each portal charges. This tells you what each
 * portal **claims about the building** — how many blocks, how many apartments,
 * whether it is finished — so a reader can see that the cheapest price on the
 * page comes from the one publisher who still thinks the project is a building
 * site.
 *
 * ## Where the data comes from, and the gap that forced it
 *
 * `PortalListing` carries `claimedBlockCount`, `claimedTotalUnits` and
 * `claimedBuildStatus`. **All three are `null` on all 47 rows.** The columns
 * exist in migration 05 and W0-B's parser never populates them; that is a
 * harvest gap, recorded in the W2-A handoff, and it is not a licence to invent a
 * claim. The page states the gap in words rather than rendering three empty
 * columns and letting a reader assume nobody claimed anything.
 *
 * What the dataset *does* hold is the same information one level up: every
 * structural figure is a `SourcedFact` whose `sources[]` name the publishers
 * that asserted the displayed value and whose `conflictsWith[]` keeps the
 * publishers that asserted something else, with their URLs and fetch dates
 * (SYSTEM-PROMPT §2.2 — the losing value stays). Pivoting those by publisher
 * answers "who says what" from evidence that actually exists.
 *
 * ## A cell is one publisher's claim, never a consensus
 *
 * The matrix never shows the resolved value in a publisher's row. If Haspo says
 * "under construction" and the display value is "completed", Haspo's cell says
 * under construction. Showing the winner in every row would erase the
 * disagreement the matrix exists to expose.
 */

/** One structural field the matrix has a column for. */
export interface ClaimColumn {
  /** Dotted field path, e.g. `"project.residenceBlockCount"`. */
  path: string
  /** Column heading, already translated. */
  header: string
}

/** What one publisher asserted for one field. */
export interface PublisherClaim {
  /** The raw value that publisher stated. Formatted by the caller. */
  value: unknown
  /** Every citation of that publisher for that value. Never empty. */
  sources: SourceRef[]
  /** True when the publisher's value is not the one the dataset displays. */
  dissenting: boolean
}

/** One row: a publisher and its claim per column, `null` where it said nothing. */
export interface ClaimRow {
  publisher: string
  /** The best (lowest) tier this publisher holds anywhere in the matrix. */
  tier: number
  claims: Record<string, PublisherClaim | null>
}

/**
 * Pivot a set of facts into one row per publisher.
 *
 * Both halves of every fact are read: `sources[]` (publishers backing the
 * displayed value) and `conflictsWith[]` (publishers backing a different one).
 * A publisher appearing in neither simply has no row, which is different from a
 * publisher with a row and an empty cell — the first never discussed the
 * project's structure at all, the second discussed it but not this field.
 */
export function buildClaimRows(
  facts: Readonly<Record<string, SourcedFact<unknown>>>,
  columns: readonly ClaimColumn[]
): ClaimRow[] {
  const rows = new Map<string, ClaimRow>()

  const put = (
    publisher: string,
    path: string,
    value: unknown,
    source: SourceRef,
    dissenting: boolean
  ) => {
    const row = rows.get(publisher) ?? {
      publisher,
      tier: source.tier,
      claims: Object.fromEntries(columns.map((column) => [column.path, null])),
    }
    // A publisher can be cited at more than one tier across fields; keep the
    // strongest, since tier is a property of the publisher's standing.
    if (source.tier < row.tier) row.tier = source.tier

    const existing = row.claims[path]
    if (existing === null || existing === undefined) {
      row.claims[path] = { value, sources: [source], dissenting }
    } else if (!existing.sources.some((ref) => ref.url === source.url)) {
      // Same publisher, same field, another URL — a second locale of the same
      // page, usually. Both citations are kept: an assertion repeated on four
      // language editions is not four independent assertions, but dropping
      // three of them would hide that the publisher is one voice.
      existing.sources.push(source)
    }
    rows.set(publisher, row)
  }

  for (const column of columns) {
    const fact = facts[column.path]
    if (fact === undefined) continue

    // `gap` facts carry no value by contract; a row asserting `null` would read
    // as "this publisher says nothing is known", which nobody said.
    if (fact.confidence !== "gap") {
      for (const source of fact.sources) {
        put(source.publisher, column.path, fact.value, source, false)
      }
    }
    for (const entry of fact.conflictsWith ?? []) {
      put(entry.source.publisher, column.path, entry.value, entry.source, true)
    }
  }

  return [...rows.values()].sort(
    (a, b) =>
      // Strongest source tier first — a developer's own site outranks a portal,
      // and the ordering is the one CONTRACTS §1 already uses to pick a display
      // value, so the table reads in the same direction as the data model.
      a.tier - b.tier || a.publisher.localeCompare(b.publisher)
  )
}

export interface ClaimMatrixLabels {
  /** Row-header column, e.g. "Portal". */
  publisher: string
  /** Cell content when this publisher never stated this field. */
  notStated: string
  /** Marks a value that differs from the one the dataset displays. */
  dissenting: string
  /** e.g. "Quelle öffnen" */
  openSource: string
  /** Screen-reader caption for the table. */
  caption: string
  /** Tier names keyed by tier number as a string. */
  tier: Record<string, string>
}

export function PortalClaimMatrix({
  rows,
  columns,
  labels,
  locale,
  /** Renders one publisher's raw value for one field, already translated. */
  formatValue,
  className,
}: {
  rows: readonly ClaimRow[]
  columns: readonly ClaimColumn[]
  labels: ClaimMatrixLabels
  locale: string
  formatValue: (path: string, value: unknown) => string
  className?: string
}): ReactNode {
  if (rows.length === 0) return null

  return (
    // `relative` is load-bearing, not decoration: every `sr-only` element is
    // absolutely positioned, and an absolutely-positioned descendant is only
    // clipped by an ancestor that is itself a containing block. Without it the
    // screen-reader-only spans in these cells escape the scroll box and drag the
    // PAGE wider than the viewport at 320px — horizontal scroll caused by
    // content nobody can see. Measured on the evidence cockpit before it was
    // fixed there (HANDOFF/W3-C.md §5.1).
    <div className={cn("relative max-w-full min-w-0", className)}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-card to-transparent lg:hidden"
      />
      <div className="azura-scrollbar-slim relative max-w-full min-w-0 overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <caption className="sr-only">{labels.caption}</caption>
          <thead>
            <tr className="border-b border-border text-left">
              <th
                scope="col"
                className="py-2 pr-4 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase"
              >
                {labels.publisher}
              </th>
              {columns.map((column) => (
                <th
                  key={column.path}
                  scope="col"
                  className="py-2 pr-4 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase last:pr-0"
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.publisher}
                data-slot="claim-row"
                data-publisher={row.publisher}
                className={cn(
                  "border-b border-border/60 align-top",
                  "transition-colors duration-150 ease-[var(--ease-out)]",
                  "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/40"
                )}
              >
                <th
                  scope="row"
                  className="py-2.5 pr-4 text-left font-medium text-foreground"
                >
                  {row.publisher}
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                    {labels.tier[String(row.tier)] ?? ""}
                  </span>
                </th>
                {columns.map((column) => (
                  <ClaimCell
                    key={column.path}
                    claim={row.claims[column.path] ?? null}
                    path={column.path}
                    labels={labels}
                    locale={locale}
                    formatValue={formatValue}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ClaimCell({
  claim,
  path,
  labels,
  locale,
  formatValue,
}: {
  claim: PublisherClaim | null
  path: string
  labels: ClaimMatrixLabels
  locale: string
  formatValue: (path: string, value: unknown) => string
}): ReactNode {
  if (claim === null) {
    return (
      <td className="py-2.5 pr-4 text-muted-foreground last:pr-0">
        {/* "Keine Angabe", never blank and never an em dash. A blank cell in a
            matrix of claims reads as an oversight in the harvest rather than as
            a publisher who did not say. */}
        {labels.notStated}
      </td>
    )
  }

  const first = claim.sources[0]

  return (
    <td className="py-2.5 pr-4 last:pr-0">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          data-numeric
          className={cn(
            "font-medium tabular-nums",
            claim.dissenting ? "text-confidence-conflicted" : "text-foreground"
          )}
        >
          {formatValue(path, claim.value)}
        </span>
        {claim.dissenting ? (
          // Always in the document, never behind a hover: a disagreement a touch
          // user cannot reach is not surfaced (azura-ui-ux §5.3).
          <span className="inline-flex min-h-6 items-center rounded-md border border-confidence-conflicted/45 bg-confidence-conflicted/10 px-1.5 text-[0.6875rem] font-semibold tracking-[0.06em] text-confidence-conflicted uppercase">
            {labels.dissenting}
          </span>
        ) : null}
      </span>
      {first !== undefined ? (
        <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <a
            href={first.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`${labels.openSource}: ${first.url}`}
            className={cn(
              "inline-flex min-h-6 items-center gap-1 rounded-sm",
              "transition-transform duration-100 ease-[var(--ease-out)] active:scale-[0.97] motion-reduce:active:scale-100",
              "outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            )}
          >
            <time dateTime={first.fetchedAt} className="tabular-nums">
              {formatCollectedAt(first.fetchedAt, locale)}
            </time>
            <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
          </a>
          {claim.sources.length > 1 ? (
            <span className="tabular-nums">+{claim.sources.length - 1}</span>
          ) : null}
        </span>
      ) : null}
    </td>
  )
}

/**
 * Collection date in the active locale.
 *
 * Not imported from `components/evidence/source-chip.tsx`, which exports an
 * identical helper: that module is `"use client"` and calling into it from a
 * Server Component fails at render. Same fail-visible rule — an unparseable
 * timestamp renders raw rather than as "Invalid Date".
 */
function formatCollectedAt(iso: string, locale: string): string {
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return iso
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(parsed))
}
