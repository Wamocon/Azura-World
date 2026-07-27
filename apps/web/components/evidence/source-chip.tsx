"use client"

import { ExternalLink, FileWarning, Archive } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/cn"
import type { SourceRef, SourceTier } from "@/lib/contracts"

/**
 * SourceChip — one citation, rendered.                     Owner: W1-D
 *
 * "Seaside Alanya · 27.07.2026", linking to the live URL and, separately, to
 * the stored snapshot.
 *
 * Both links matter, and the second one is the point. CONTRACTS §1 invariant 6
 * exists because a citation you cannot re-open is not a citation: 15 of the 60
 * harvest attempts already failed validation at probe time, and portal
 * listings are edited and deleted continuously. When the live URL is gone, the
 * chip still renders, still cites, and links to the snapshot that proved the
 * number when it was collected.
 *
 * `rel="noopener noreferrer"` on every outbound link: these are competitor
 * pages, i.e. untrusted destinations, and `window.opener` is a real handle.
 */

/** Tier labels, per CONTRACTS §1. Lower number wins the display value. */
const TIER_KEYS: Record<SourceTier, string> = {
  1: "official",
  2: "developer",
  3: "hotel",
  4: "portal",
  5: "review",
  6: "press",
}

/**
 * Tier tint. Deliberately quiet — a tier is context, not a verdict, and a row
 * of loud chips would compete with the conflict badge, which IS a verdict.
 */
const TIER_CLASS: Record<SourceTier, string> = {
  1: "border-confidence-official/40 text-confidence-official",
  2: "border-confidence-official/30 text-confidence-official",
  3: "border-confidence-confirmed/30 text-confidence-confirmed",
  4: "border-input text-muted-foreground",
  5: "border-input text-muted-foreground",
  6: "border-input text-muted-foreground",
}

export interface SourceChipLabels {
  /** e.g. "Quelle öffnen" */
  openSource: string
  /** e.g. "Lokaler Snapshot" */
  snapshot: string
  /** e.g. "Quelle nicht erreichbar" */
  unreachable: string
  /** Tier names, keyed as in `TIER_KEYS`. */
  tier: Record<string, string>
}

/**
 * Formats an ISO timestamp as a date in the active locale.
 *
 * Fails visible, not silent: an unparseable date renders the raw string rather
 * than "Invalid Date" or an empty span. A citation with a broken date is still
 * a citation, and hiding the breakage would hide a parser bug.
 */
export function formatFetchedAt(iso: string, locale: string): string {
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return iso
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(parsed))
}

export function SourceChip({
  source,
  locale,
  labels,
  /** From `HarvestEntry.contentValidated` — false ⟹ a bot wall or soft-404. */
  reachable = true,
  /** Route that serves the stored snapshot for a hash. */
  snapshotHref,
  className,
}: {
  source: SourceRef
  locale: string
  labels: SourceChipLabels
  reachable?: boolean
  snapshotHref?: (snapshotHash: string) => string
  className?: string
}): ReactNode {
  const tierKey = TIER_KEYS[source.tier]
  const tierLabel = labels.tier[tierKey] ?? tierKey
  const date = formatFetchedAt(source.fetchedAt, locale)

  return (
    <span
      data-slot="source-chip"
      data-tier={source.tier}
      data-reachable={reachable}
      className={cn(
        "inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-md border bg-background px-2 py-0.5",
        "text-xs text-muted-foreground",
        TIER_CLASS[source.tier],
        className
      )}
    >
      {reachable ? (
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          title={`${labels.openSource}: ${source.url}`}
          className={cn(
            "inline-flex min-w-0 items-center gap-1 rounded-sm font-medium",
            "outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          )}
        >
          <span className="truncate">{source.publisher}</span>
          <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
        </a>
      ) : (
        // Dead source: no outbound link at all. Offering one would send the
        // user to a 404 and imply the citation is verifiable when it is not.
        <span
          className="inline-flex min-w-0 items-center gap-1 font-medium"
          title={labels.unreachable}
        >
          <span className="truncate">{source.publisher}</span>
          <FileWarning
            className="size-3 shrink-0 text-quality-stale"
            aria-hidden="true"
          />
          <span className="sr-only">{labels.unreachable}</span>
        </span>
      )}

      <span aria-hidden="true" className="text-muted-foreground/60">
        ·
      </span>

      <time dateTime={source.fetchedAt} className="shrink-0 tabular-nums">
        {date}
      </time>

      <span className="sr-only">{tierLabel}</span>

      {snapshotHref !== undefined ? (
        <a
          href={snapshotHref(source.snapshotHash)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${labels.snapshot} — ${source.publisher}`}
          title={labels.snapshot}
          className={cn(
            "inline-flex size-5 shrink-0 items-center justify-center rounded-sm",
            "outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          )}
        >
          <Archive className="size-3" aria-hidden="true" />
        </a>
      ) : null}
    </span>
  )
}

/**
 * A list of chips that never grows past `max`. Six competing sources is a real
 * case (F-002 has nineteen), and an unbounded chip list pushes the value it is
 * supposed to be annotating off the screen.
 */
export function SourceChipList({
  sources,
  locale,
  labels,
  max = 3,
  moreLabel,
  snapshotHref,
  className,
}: {
  sources: readonly SourceRef[]
  locale: string
  labels: SourceChipLabels
  max?: number
  /** e.g. (n) => `+${n} weitere` */
  moreLabel: (remaining: number) => string
  snapshotHref?: (snapshotHash: string) => string
  className?: string
}): ReactNode {
  const shown = sources.slice(0, max)
  const remaining = sources.length - shown.length

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      {shown.map((source) => (
        <SourceChip
          key={`${source.url}-${source.snapshotHash}`}
          source={source}
          locale={locale}
          labels={labels}
          {...(snapshotHref !== undefined ? { snapshotHref } : {})}
        />
      ))}
      {remaining > 0 ? (
        <span className="text-xs text-muted-foreground">
          {moreLabel(remaining)}
        </span>
      ) : null}
    </span>
  )
}
