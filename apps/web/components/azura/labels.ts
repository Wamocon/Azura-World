/**
 * Label assembly for the landing surface.                            Owner: W3-A
 *
 * `ProvenanceValue` and its family take their strings as props rather than
 * calling a translator, because they are client components and their callers
 * are Server Components. That is the right shape — but it means somebody has to
 * build the object, and doing it inline in six sections would be six chances to
 * pass a slightly different set.
 *
 * The strings live under `landing.provenance.*` rather than being read from the
 * `evidence.*` namespace. `evidence.*` is W1-C's and covers the evidence
 * cockpit's own vocabulary; it does not carry `conflict.trigger`,
 * `source.tier.*` or `more`, so a half-mapping would break the moment either
 * namespace moved. Filed as a consolidation request in HANDOFF/W3-A.md.
 */

import { getTranslations } from "next-intl/server"

import type { ProvenanceLabels } from "@/components/evidence/provenance-value"

export async function getProvenanceLabels(
  locale: string
): Promise<ProvenanceLabels> {
  const t = await getTranslations({ locale, namespace: "landing" })
  // One `raw` read of a whole authored object beats twenty keyed reads that
  // could each drift from the interface. `check-i18n` proves the four locales
  // carry identical key sets, so the shape is guaranteed across all of them.
  return t.raw("provenance") as ProvenanceLabels
}

/**
 * `snapshotBasePath` for every `SourceChip` on this page.
 *
 * A dead source still cites: 15 of 60 harvest attempts failed content
 * validation, and for those the chip drops the outbound link and offers the
 * stored snapshot instead (DESIGN.md §6). The path is centralised so a section
 * cannot ship a chip that silently has no fallback.
 */
export const SNAPSHOT_BASE_PATH = "/api/evidence/snapshot"
