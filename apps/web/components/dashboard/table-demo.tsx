"use client"

import { useMemo, useState, type ReactNode } from "react"

import type { Locale, SourcedFact } from "@/lib/contracts"
import { shellCopy } from "@/lib/dashboard-home-copy"
import type { ProvenanceLabels } from "@/components/evidence/provenance-value"
import { Button } from "@/components/ui/button"
import { EmptyState, ErrorState } from "@/components/ui/empty-state"

import {
  DataTable,
  VIRTUALISE_ABOVE,
  type DataTableColumn,
  type DataTableSort,
} from "./data-table"

/**
 * DEV-ONLY harness for `<DataTable>`.                      Owner: W3-B
 *
 * Reached at `/{locale}/dashboard?w3b=table-demo`, and only when
 * `NODE_ENV !== "production"` — the page that mounts it checks.
 *
 * IT EXISTS BECAUSE THE ACCEPTANCE CRITERIA CANNOT OTHERWISE BE MET YET. W3-B's
 * definition of done requires a 656-row table with a measured DOM node count
 * and all four states screenshotted, and every module that will own a real
 * table (W3-C, W3-D, W3-E …) is being built in parallel and does not exist. A
 * harness inside a file this task already owns is the smallest way to make the
 * table's behaviour verifiable now rather than asserted.
 *
 * The rows are synthetic and say so on screen. 656 is the real inventory size
 * and the split mirrors the real 25 portal / 631 modelled — not to imply the
 * data is real, but because a virtualisation measurement taken against 20 rows
 * proves nothing about the load that matters.
 *
 * A module window should delete this import, not copy it.
 */

interface DemoRow {
  id: string
  block: string
  layout: string
  area: number | null
  price: SourcedFact<{ amount: number; currency: string }>
}

const LAYOUTS = ["1+1", "2+1", "3+1", "4+1", "penthouse"] as const

/** Deterministic, so a screenshot and a node count are reproducible. */
function demoRows(): DemoRow[] {
  const source = {
    url: "https://hasporealty.com/",
    publisher: "Haspo Realty",
    fetchedAt: "2026-07-27T14:47:11.080Z",
    snapshotHash: "a".repeat(64),
    tier: 4 as const,
  }

  return Array.from({ length: 656 }, (_, index) => {
    const block = `B0${(index % 7) + 1}`
    const modelled = index % 26 !== 0
    return {
      id: `AZW-${block}-${String(index + 1).padStart(4, "0")}`,
      block,
      layout: LAYOUTS[index % LAYOUTS.length] ?? "1+1",
      // Every 40th row has no area, so the "—" path is on screen rather than
      // only in a unit test.
      area: index % 40 === 0 ? null : 68 + (index % 9) * 17,
      price: modelled
        ? {
            value: null,
            confidence: "gap",
            sources: [],
            note: "Modelliert, kein Inserat — keine Quelle nennt einen Preis für diese Einheit.",
          }
        : {
            value: { amount: 112000 + (index % 7) * 19000, currency: "EUR" },
            confidence: "single_source",
            sources: [source],
          },
    }
  })
}

export function TableDemo({
  locale,
  provenanceLabels,
}: {
  locale: Locale
  provenanceLabels: ProvenanceLabels
}): ReactNode {
  const copy = shellCopy(locale)
  const rows = useMemo(() => demoRows(), [])
  const [state, setState] = useState<"loading" | "error" | "empty" | "ready">("ready")
  const [sort, setSort] = useState<DataTableSort | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())

  const columns: ReadonlyArray<DataTableColumn<DemoRow>> = [
    { kind: "text", id: "id", header: "Einheit", value: (r) => r.id, sortable: true, width: "12rem" },
    { kind: "text", id: "block", header: "Block", value: (r) => r.block, sortable: true },
    { kind: "text", id: "layout", header: "Grundriss", value: (r) => r.layout },
    {
      kind: "number",
      id: "area",
      header: "Innenfläche",
      value: (r) => r.area,
      formatOptions: { maximumFractionDigits: 0 },
    },
    // The column that matters: a SourcedFact rendered by W1-D, so 631 of the
    // 656 rows show "—" plus "Nicht belegt" rather than a fabricated price.
    { kind: "fact", id: "price", header: "Preis", fact: (r) => r.price, format: "money" },
  ]

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="table-demo">
      <div className="flex flex-wrap items-center gap-2">
        {(["ready", "loading", "empty", "error"] as const).map((candidate) => (
          <Button
            key={candidate}
            size="sm"
            variant={state === candidate ? "default" : "outline"}
            aria-pressed={state === candidate}
            onClick={() => setState(candidate)}
            data-testid={`table-state-${candidate}`}
          >
            {candidate}
          </Button>
        ))}
        <span className="text-xs text-muted-foreground">
          {rows.length} synthetische Zeilen · virtualisiert ab {VIRTUALISE_ABOVE}
        </span>
      </div>

      <DataTable
        rows={state === "empty" ? [] : rows}
        columns={columns}
        getRowId={(row) => row.id}
        locale={locale}
        provenanceLabels={provenanceLabels}
        state={state}
        totalRows={state === "empty" ? 0 : rows.length}
        sort={sort}
        onSortChange={setSort}
        selectedIds={selected}
        onSelectionChange={setSelected}
        columnVisibilityKey="azura.w3b.table-demo.columns"
        onExportCsv={() => undefined}
        labels={{
          caption: copy.tableCaption,
          countTemplate: copy.tableCount,
          columnsButton: copy.tableColumns,
          exportButton: copy.tableExport,
          selectRow: copy.tableSelectRow,
          selectAll: copy.tableSelectAll,
          selectedTemplate: copy.tableSelected,
          sortAscending: copy.tableSortAsc,
          sortDescending: copy.tableSortDesc,
          clearSort: copy.tableSortClear,
          loadingLabel: copy.tableLoading,
          noValue: copy.tableNoValue,
        }}
        empty={
          <EmptyState title={copy.tableEmptyTitle} description={copy.tableEmptyBody} />
        }
        error={
          <ErrorState
            title={copy.tableErrorTitle}
            message={copy.tableErrorBody}
            retryLabel={copy.retry}
            onRetry={() => setState("ready")}
          />
        }
      />
    </div>
  )
}
