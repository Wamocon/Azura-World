import type { ReactNode } from "react"

import type { SourceRef } from "@/lib/contracts"

/**
 * Source citation chips. **Render nothing since P2.**       Owner: W1-D · PIVOT P2
 *
 * `PIVOT.md` §4 removes source chips from every surface. §5 says to do it in two
 * passes, and this is pass 1: the components become no-ops so the roughly thirty
 * call sites across the dashboard, the hotel pages and the landing sections keep
 * compiling untouched. Pass 2, after the pitch, deletes the call sites and the
 * types together.
 *
 * `SourceChipLabels` and {@link formatFetchedAt} are kept whole because they are
 * imported beyond this module — `components/hotel/select.ts` and
 * `components/inventory/price-observation-table.tsx` both read them, and neither
 * is a file this pass needs to touch.
 *
 * `"use client"` is gone with the popover state this file used to hold. Nothing
 * here is interactive any more.
 */

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
 * Kept because two modules outside this one format a fetch date with it. It is a
 * date formatter, not a provenance affordance, so nothing about the pivot makes
 * it wrong.
 */
export function formatFetchedAt(iso: string, locale: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date)
}

export function SourceChip(props: {
  source: SourceRef
  locale: string
  labels: SourceChipLabels
  reachable?: boolean
  snapshotBasePath?: string
  className?: string
}): ReactNode {
  void props
  return null
}

export function SourceChipList(props: {
  sources: readonly SourceRef[]
  locale: string
  labels: SourceChipLabels
  max?: number
  /** Template with a `{count}` placeholder, e.g. "+{count} weitere". */
  moreLabel: string
  snapshotBasePath?: string
  className?: string
}): ReactNode {
  void props
  return null
}
