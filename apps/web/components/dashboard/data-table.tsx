"use client"

import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Download,
  Settings2,
} from "lucide-react"
import {
  useCallback,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"

import { cn } from "@/lib/cn"
import type { Permission, SourcedFact } from "@/lib/contracts"

import {
  ProvenanceValue,
  type ProvenanceLabels,
} from "@/components/evidence/provenance-value"
import type { ProvenanceFormat } from "@/components/evidence/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DataSurface,
  EmptyState,
  ErrorState,
} from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScrollArea,
  useTableScrollRef,
  VirtualTableBody,
} from "@/components/ui/table"
import { intlLocaleTag } from "@/lib/format"

/**
 * DataTable — the workhorse six modules share.             Owner: W3-B
 *
 * Built once, properly, because W3-C (656 units), W3-D (ledger), W3-E
 * (tickets), W3-F (documents), W3-G (hotel) and W3-H all render tabular data
 * and six near-identical tables is six places for provenance to be dropped.
 *
 * FOUR PROPERTIES THAT ARE NOT NEGOTIABLE, and why each is here:
 *
 * 1. **`SourcedFact` cells render through `ProvenanceValue`.** This is how
 *    provenance reaches every table in the app. A column declares
 *    `kind: "fact"` and the cell is rendered by W1-D's component — so a `gap`
 *    shows "—" and never `0`, a conflict shows its amber badge in the row, and
 *    no module can accidentally print `fact.value` and lose the sourcing.
 *    CONTRACTS §8 lists "a number in JSX with no source" as a review rejection;
 *    this makes complying the path of least resistance.
 * 2. **Virtualised above `VIRTUALISE_ABOVE` rows.** 656 units is the real load.
 * 3. **Four states, and `empty`/`error` are required props.** A table that only
 *    handles `populated` gets sent back in review, so the type makes it
 *    impossible to write one.
 * 4. **Server-side pagination, sort and filter.** The props carry state and
 *    emit intent; this component never fetches and never sorts a full dataset
 *    in the browser. Loading 656 rows to filter client-side is the thing
 *    W3-B's brief forbids by name.
 *
 * WHAT THIS COMPONENT DELIBERATELY DOES NOT DO: fetch. It takes `rows` and
 * calls back with intent. The module owns its `useLiveSnapshot` and therefore
 * owns its sync badge, its channel list and its polling — none of which this
 * component can choose correctly on a module's behalf.
 */

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

/** Sort direction. `null` means "not sorted by this column". */
export type SortDirection = "asc" | "desc"

export interface DataTableSort {
  columnId: string
  direction: SortDirection
}

/**
 * A column.
 *
 * `kind` decides how the cell renders and is the mechanism behind property 1
 * above. `"fact"` is the important one: it takes a `SourcedFact` and hands it
 * to `ProvenanceValue`, so provenance is structural rather than remembered.
 */
export type DataTableColumn<TRow> =
  | {
      kind: "text"
      id: string
      /** i18n-resolved header. Never a key — the module translates. */
      header: string
      /** Extracted value. Return `null` for absent; the cell renders "—". */
      value: (row: TRow) => string | null
      sortable?: boolean
      /** Hidden by default; the user can switch it on. */
      hiddenByDefault?: boolean
      /** Fixed width, e.g. "12rem". Omit to size from content. */
      width?: string
      align?: "start" | "end"
    }
  | {
      kind: "number"
      id: string
      header: string
      value: (row: TRow) => number | null
      /** Locale-aware options. Serialisable — this is a client component. */
      formatOptions?: Intl.NumberFormatOptions
      sortable?: boolean
      hiddenByDefault?: boolean
      width?: string
    }
  | {
      /**
       * A `SourcedFact` cell. THE REASON THIS TABLE EXISTS.
       *
       * The module supplies the fact; W1-D's `ProvenanceValue` decides the
       * treatment per confidence level. The module cannot accidentally render
       * a bare number here, because the extractor's return type is the fact,
       * not its value.
       */
      kind: "fact"
      id: string
      header: string
      fact: (row: TRow) => SourcedFact<unknown> | null
      format?: ProvenanceFormat
      sortable?: boolean
      hiddenByDefault?: boolean
      width?: string
    }
  | {
      /** Anything else: badges, links, actions. Escape hatch, used sparingly. */
      kind: "custom"
      id: string
      header: string
      render: (row: TRow) => ReactNode
      sortable?: boolean
      hiddenByDefault?: boolean
      width?: string
      align?: "start" | "end"
    }

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Bulk action offered when rows are selected. Permission-gated. */
export interface DataTableBulkAction<TRow> {
  id: string
  label: string
  /** Withheld entirely when the role lacks it — not shown disabled. */
  permission?: Permission
  onRun: (rows: readonly TRow[]) => void
  variant?: "default" | "destructive"
}

export interface DataTableLabels {
  /** Screen-reader caption for the table. Required — a table needs a name. */
  caption: string
  /** "{visible} von {total}" */
  countTemplate: string
  columnsButton: string
  exportButton: string
  selectRow: string
  selectAll: string
  /** "{count} ausgewählt" */
  selectedTemplate: string
  sortAscending: string
  sortDescending: string
  clearSort: string
  loadingLabel: string
  /** Shown in a cell whose extractor returned null. Never "0". */
  noValue: string
}

export interface DataTableProps<TRow> {
  /** The current page of rows. Never the whole dataset. */
  rows: readonly TRow[]
  columns: ReadonlyArray<DataTableColumn<TRow>>
  /** Stable identity. Used for React keys, selection and virtualisation. */
  getRowId: (row: TRow) => string
  labels: DataTableLabels
  locale: string
  /** Provenance strings, for `kind: "fact"` columns. */
  provenanceLabels: ProvenanceLabels

  /** Which of the four states to render. */
  state: "loading" | "error" | "empty" | "ready"
  /** Required — see property 3. */
  empty: ReactNode
  /** Required — see property 3. */
  error: ReactNode

  /**
   * Exact total across every page, for the count and the scrollbar. `null`
   * when the backend could not produce one — the count then reports the loaded
   * rows and says so, rather than presenting a page size as a total.
   */
  totalRows: number | null

  sort?: DataTableSort | null
  onSortChange?: (sort: DataTableSort | null) => void

  selectedIds?: ReadonlySet<string>
  onSelectionChange?: (ids: ReadonlySet<string>) => void
  bulkActions?: ReadonlyArray<DataTableBulkAction<TRow>>

  /** Gate for bulk actions and export. Pass `can` from `useUser()`. */
  can?: (permission: Permission) => boolean

  /** Enables the export control. Receives the CURRENT filter, not all rows. */
  onExportCsv?: () => void
  exportPermission?: Permission

  /**
   * localStorage key for column visibility. Omit to disable persistence —
   * which is correct for a table whose columns vary per render.
   */
  columnVisibilityKey?: string

  /** Row height in px. Fixed, because the window arithmetic needs it. */
  rowHeight?: number
  /** Scroll-area height in px. */
  height?: number

  onRowActivate?: (row: TRow) => void
  className?: string
}

/**
 * Below this many rows the body renders plainly.
 *
 * Windowing costs a scroll listener, a resize observer and two spacer rows. On
 * a 20-row ticket list that is pure overhead; at 656 it is the difference
 * between a responsive page and a locked one.
 */
export const VIRTUALISE_ABOVE = 100

const DEFAULT_ROW_HEIGHT = 44
const DEFAULT_HEIGHT = 520

// ---------------------------------------------------------------------------

export function DataTable<TRow>({
  rows,
  columns,
  getRowId,
  labels,
  locale,
  provenanceLabels,
  state,
  empty,
  error,
  totalRows,
  sort = null,
  onSortChange,
  selectedIds,
  onSelectionChange,
  bulkActions,
  can,
  onExportCsv,
  exportPermission,
  columnVisibilityKey,
  rowHeight = DEFAULT_ROW_HEIGHT,
  height = DEFAULT_HEIGHT,
  onRowActivate,
  className,
}: DataTableProps<TRow>): ReactNode {
  const scrollRef = useTableScrollRef()
  const captionId = useId()
  const [columnMenuOpen, setColumnMenuOpen] = useState(false)

  /**
   * Column visibility, read from localStorage through `useSyncExternalStore`.
   *
   * NOT `useState` + a restore effect. localStorage is an external store, and
   * writing it into state from an effect is a cascading render on every mount
   * — the table paints with the default columns and then re-paints with the
   * saved ones, which is a visible flicker on a wide table. The store's
   * server snapshot is the declared default, so SSR and the first client
   * render agree and there is no hydration mismatch either.
   *
   * Subscribing to `storage` is a genuine bonus: hiding a column in one tab
   * now updates the others, which a restore-once effect could never do.
   */
  const defaultHidden = useMemo(
    () => columns.filter((c) => c.hiddenByDefault === true).map((c) => c.id),
    [columns]
  )

  const hiddenColumns = useHiddenColumns(columnVisibilityKey, defaultHidden)

  const persistHidden = useCallback(
    (next: ReadonlySet<string>) => {
      if (columnVisibilityKey === undefined) return
      try {
        window.localStorage.setItem(
          columnVisibilityKey,
          JSON.stringify([...next])
        )
        // `storage` does not fire in the tab that wrote it, so the store is
        // nudged directly. Without this the checkbox would not move.
        window.dispatchEvent(new Event(COLUMN_STORE_EVENT))
      } catch {
        // Private mode, quota, storage disabled. The table still works; the
        // preference simply does not persist.
      }
    },
    [columnVisibilityKey]
  )

  const visibleColumns = useMemo(
    () => columns.filter((column) => !hiddenColumns.has(column.id)),
    [columns, hiddenColumns]
  )

  const selectable = onSelectionChange !== undefined
  const selected = selectedIds ?? EMPTY_SELECTION
  const columnCount = visibleColumns.length + (selectable ? 1 : 0)

  const permittedBulkActions = useMemo(
    () =>
      (bulkActions ?? []).filter(
        (action) =>
          action.permission === undefined ||
          can === undefined ||
          can(action.permission)
      ),
    [bulkActions, can]
  )

  const exportAllowed =
    onExportCsv !== undefined &&
    (exportPermission === undefined ||
      can === undefined ||
      can(exportPermission))

  const toggleSort = useCallback(
    (columnId: string) => {
      if (onSortChange === undefined) return
      if (sort === null || sort.columnId !== columnId) {
        onSortChange({ columnId, direction: "asc" })
        return
      }
      // asc → desc → unsorted. The third press restoring the natural order is
      // what makes sorting feel reversible rather than sticky.
      onSortChange(
        sort.direction === "asc" ? { columnId, direction: "desc" } : null
      )
    },
    [onSortChange, sort]
  )

  const toggleRow = useCallback(
    (id: string) => {
      if (onSelectionChange === undefined) return
      const next = new Set(selected)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      onSelectionChange(next)
    },
    [onSelectionChange, selected]
  )

  const allOnPageSelected =
    rows.length > 0 && rows.every((row) => selected.has(getRowId(row)))

  const toggleAllOnPage = useCallback(() => {
    if (onSelectionChange === undefined) return
    const next = new Set(selected)
    if (allOnPageSelected) for (const row of rows) next.delete(getRowId(row))
    else for (const row of rows) next.add(getRowId(row))
    onSelectionChange(next)
  }, [allOnPageSelected, getRowId, onSelectionChange, rows, selected])

  const virtualise = rows.length > VIRTUALISE_ABOVE

  const renderRow = useCallback(
    (row: TRow) => {
      const id = getRowId(row)
      return (
        <TableRow
          key={id}
          style={{ height: rowHeight }}
          data-selected={selected.has(id) ? "" : undefined}
          {...(onRowActivate === undefined
            ? {}
            : {
                tabIndex: 0,
                role: "link",
                onClick: () => onRowActivate(row),
                onKeyDown: (event: React.KeyboardEvent) => {
                  if (event.key === "Enter") onRowActivate(row)
                },
                className: "cursor-pointer",
              })}
        >
          {selectable ? (
            <TableCell className="w-10">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={selected.has(id)}
                onChange={() => toggleRow(id)}
                onClick={(event) => event.stopPropagation()}
                aria-label={`${labels.selectRow} ${id}`}
              />
            </TableCell>
          ) : null}
          {visibleColumns.map((column) => (
            <TableCell
              key={column.id}
              style={
                column.width === undefined ? undefined : { width: column.width }
              }
            >
              <Cell
                column={column}
                row={row}
                locale={locale}
                labels={labels}
                provenanceLabels={provenanceLabels}
              />
            </TableCell>
          ))}
        </TableRow>
      )
    },
    [
      getRowId,
      labels,
      locale,
      onRowActivate,
      provenanceLabels,
      rowHeight,
      selectable,
      selected,
      toggleRow,
      visibleColumns,
    ]
  )

  const header = (
    <TableHeader>
      <TableRow>
        {selectable ? (
          <TableHead className="w-10">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={allOnPageSelected}
              onChange={toggleAllOnPage}
              aria-label={labels.selectAll}
            />
          </TableHead>
        ) : null}
        {visibleColumns.map((column) => {
          const active = sort?.columnId === column.id
          const sortable =
            column.sortable === true && onSortChange !== undefined
          return (
            <TableHead
              key={column.id}
              style={
                column.width === undefined ? undefined : { width: column.width }
              }
              // `aria-sort` is what a screen reader announces. Without it the
              // arrow icon is the only signal, and an icon is not an
              // announcement.
              aria-sort={
                active
                  ? sort.direction === "asc"
                    ? "ascending"
                    : "descending"
                  : undefined
              }
            >
              {sortable ? (
                <button
                  type="button"
                  onClick={() => toggleSort(column.id)}
                  className={cn(
                    "inline-flex min-h-6 items-center gap-1 rounded-sm text-left",
                    "outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                    active && "text-foreground"
                  )}
                  title={
                    active
                      ? sort.direction === "asc"
                        ? labels.sortDescending
                        : labels.clearSort
                      : labels.sortAscending
                  }
                >
                  {column.header}
                  {active ? (
                    sort.direction === "asc" ? (
                      <ArrowUp className="size-3" aria-hidden="true" />
                    ) : (
                      <ArrowDown className="size-3" aria-hidden="true" />
                    )
                  ) : (
                    <ChevronsUpDown
                      className="size-3 opacity-40"
                      aria-hidden="true"
                    />
                  )}
                </button>
              ) : (
                column.header
              )}
            </TableHead>
          )
        })}
      </TableRow>
    </TableHeader>
  )

  return (
    <div
      data-slot="data-table"
      className={cn("flex min-w-0 flex-col gap-3", className)}
    >
      {/* Toolbar. Quiet by default: the controls that do nothing for this
          table are absent rather than disabled. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className="text-sm text-muted-foreground"
          data-testid="data-table-count"
        >
          {formatCount(labels.countTemplate, rows.length, totalRows, locale)}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {selected.size > 0 ? (
            <>
              <Badge variant="secondary">
                {labels.selectedTemplate.replace(
                  "{count}",
                  String(selected.size)
                )}
              </Badge>
              {permittedBulkActions.map((action) => (
                <Button
                  key={action.id}
                  size="sm"
                  variant={
                    action.variant === "destructive" ? "destructive" : "outline"
                  }
                  onClick={() =>
                    action.onRun(
                      rows.filter((row) => selected.has(getRowId(row)))
                    )
                  }
                >
                  {action.label}
                </Button>
              ))}
            </>
          ) : null}

          {columnVisibilityKey === undefined ? null : (
            <div className="relative">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setColumnMenuOpen((open) => !open)}
                aria-expanded={columnMenuOpen}
                data-testid="data-table-columns"
              >
                <Settings2 aria-hidden="true" />
                {labels.columnsButton}
              </Button>
              {columnMenuOpen ? (
                <div
                  className={cn(
                    "absolute top-full right-0 z-20 mt-1 flex w-56 flex-col gap-1 rounded-lg border border-border",
                    "bg-popover p-2 shadow-lg"
                  )}
                >
                  {columns.map((column) => (
                    <label
                      key={column.id}
                      className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-muted"
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--primary)]"
                        checked={!hiddenColumns.has(column.id)}
                        onChange={() => {
                          const next = new Set(hiddenColumns)
                          if (next.has(column.id)) next.delete(column.id)
                          else next.add(column.id)
                          persistHidden(next)
                        }}
                      />
                      <span className="truncate">{column.header}</span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {exportAllowed ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onExportCsv}
              data-testid="data-table-export"
            >
              <Download aria-hidden="true" />
              {labels.exportButton}
            </Button>
          ) : null}
        </div>
      </div>

      <DataSurface
        state={state}
        loading={
          <div
            className="flex flex-col gap-2"
            aria-busy="true"
            data-testid="data-table-loading"
          >
            <span className="sr-only">{labels.loadingLabel}</span>
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} preset="control" />
            ))}
          </div>
        }
        empty={empty}
        error={error}
      >
        <TableScrollArea height={height} ref={scrollRef}>
          <Table aria-describedby={captionId}>
            <caption id={captionId} className="sr-only">
              {labels.caption}
            </caption>
            {header}
            {virtualise ? (
              <VirtualTableBody
                rows={rows}
                rowHeight={rowHeight}
                columnCount={columnCount}
                scrollRef={scrollRef}
                renderRow={renderRow}
              />
            ) : (
              <tbody data-slot="table-body">
                {rows.map((row) => renderRow(row))}
              </tbody>
            )}
          </Table>
        </TableScrollArea>
      </DataSurface>
    </div>
  )
}

const EMPTY_SELECTION: ReadonlySet<string> = new Set<string>()

/** Same-tab notification: `storage` only fires in OTHER tabs. */
const COLUMN_STORE_EVENT = "azura:column-visibility"

/**
 * Hidden-column ids, as an external store.
 *
 * `getSnapshot` must return a referentially STABLE value or React re-renders
 * forever, so the parsed set is cached against the raw string it came from and
 * only rebuilt when that string actually changes.
 */
function useHiddenColumns(
  storageKey: string | undefined,
  defaults: readonly string[]
): ReadonlySet<string> {
  const defaultsKey = defaults.join(",")

  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener("storage", onChange)
    window.addEventListener(COLUMN_STORE_EVENT, onChange)
    return () => {
      window.removeEventListener("storage", onChange)
      window.removeEventListener(COLUMN_STORE_EVENT, onChange)
    }
  }, [])

  const getSnapshot = useCallback(() => {
    if (storageKey === undefined) return null
    try {
      return window.localStorage.getItem(storageKey)
    } catch {
      return null
    }
  }, [storageKey])

  // The server has no localStorage; `null` means "use the declared defaults".
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => null)

  return useMemo(() => {
    if (raw === null)
      return new Set(defaultsKey === "" ? [] : defaultsKey.split(","))
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) throw new Error("not an array")
      return new Set(
        parsed.filter((value): value is string => typeof value === "string")
      )
    } catch {
      // A corrupt entry falls back to the defaults rather than throwing. A
      // table that will not render because a preference is malformed is a
      // worse outcome than a table with its default columns.
      return new Set(defaultsKey === "" ? [] : defaultsKey.split(","))
    }
  }, [raw, defaultsKey])
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

function Cell<TRow>({
  column,
  row,
  locale,
  labels,
  provenanceLabels,
}: {
  column: DataTableColumn<TRow>
  row: TRow
  locale: string
  labels: DataTableLabels
  provenanceLabels: ProvenanceLabels
}): ReactNode {
  switch (column.kind) {
    case "text": {
      const value = column.value(row)
      // An absent string is an em dash, never an empty cell. A blank cell is
      // indistinguishable from a rendering bug.
      if (value === null || value === "") {
        return <span className="text-confidence-gap">{labels.noValue}</span>
      }
      return (
        <span
          className={column.align === "end" ? "block text-right" : undefined}
        >
          {value}
        </span>
      )
    }

    case "number": {
      const value = column.value(row)
      if (value === null) {
        // Never `0`. A missing number and a zero are different facts, and this
        // is the single most damaging confusion this app can ship.
        return <span className="text-confidence-gap">{labels.noValue}</span>
      }
      return (
        <span data-numeric className="block text-right">
          {new Intl.NumberFormat(locale, column.formatOptions).format(value)}
        </span>
      )
    }

    case "fact": {
      const fact = column.fact(row)
      if (fact === null) {
        return <span className="text-confidence-gap">{labels.noValue}</span>
      }
      // The whole reason this component exists. W1-D decides the treatment;
      // the module cannot bypass it, because the extractor returns the fact
      // rather than its value.
      return (
        <ProvenanceValue
          fact={fact}
          {...(column.format === undefined ? {} : { format: column.format })}
          locale={locale}
          labels={provenanceLabels}
        />
      )
    }

    case "custom":
      return <>{column.render(row)}</>
  }
}

// ---------------------------------------------------------------------------

/**
 * "{visible} von {total}".
 *
 * When `totalRows` is null the template is filled with the loaded count on
 * both sides — a page size presented as a total would be a quietly wrong
 * number, and this table's whole job is not producing those.
 */
function formatCount(
  template: string,
  visible: number,
  total: number | null,
  locale: string
): string {
  const format = new Intl.NumberFormat(intlLocaleTag(locale))
  return template
    .replace("{visible}", format.format(visible))
    .replace("{total}", format.format(total ?? visible))
}

export { EmptyState, ErrorState }
