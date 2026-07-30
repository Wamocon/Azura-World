"use client"

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"

import { cn } from "@/lib/cn"

/**
 * Table, with windowing for large row sets.                Owner: W1-D
 *
 * The dataset has 656 units and CONVENTIONS §5 is explicit: never render 656
 * DOM rows. `VirtualTableBody` renders only the visible window plus a small
 * overscan, and pads the rest with two spacer rows so the scrollbar still
 * describes the true length of the list.
 *
 * Written against the DOM rather than pulling in a virtualisation library:
 * none is in the pinned stack (CONVENTIONS §1) and adding one to window a
 * fixed-height list is a dependency for about forty lines of arithmetic.
 *
 * ACCESSIBILITY — the spacers are `<tr><td>` inside the real `<tbody>`, so
 * this stays a genuine `<table>`: header association, row/column navigation
 * and `caption` all keep working. The common alternative — divs with
 * `role="row"` — loses all of that the moment one ARIA attribute is wrong.
 * `aria-rowcount` / `aria-rowindex` report the FULL list, not the window, so
 * a screen reader says "row 40 of 656" rather than "row 4 of 12".
 *
 * ---------------------------------------------------------------------------
 * ## The four decisions in the visual layer
 *
 * **1. Hairline rows, never zebra striping.** Rows carry `border-b` at
 * `border-border/70` — slightly softer than the container's own border, so the
 * frame reads as the outer edge and the rules read as internal structure. A
 * striped background is deliberately refused: this product tints whole rows by
 * provenance (`data-modelled` recedes to `bg-muted/20`, a breached SLA takes a
 * `border-l-destructive`, `data-[selected]` takes `bg-secondary`, and
 * `quality-stale` rows take a rust wash). A zebra underneath any of those turns
 * a meaningful tint into a stripe the reader must first decode, which is the one
 * failure mode a provenance product cannot afford.
 *
 * **2. Tighter rows, wider gutters.** Vertical padding is `py-2` (was 2.5) and
 * horizontal is `px-3 sm:px-4` (was a flat 3). More rows fit on a screen while
 * each column gets more air between it and its neighbour — density comes from
 * the vertical axis, legibility from the horizontal one, and doing both at once
 * is what separates a dense table from a cramped one.
 *
 * **3. Sticky header — and exactly where it engages.** `TableHead` is
 * `position: sticky`, not `TableHeader`: `<th>` is the element every engine
 * sticks reliably, and a sticky `<thead>` is still uneven across Safari
 * versions. Sticky resolves against the nearest **scroll container**, which is
 * why `Table` drops its own horizontal scroller when it is inside a
 * `TableScrollArea` (see the context below) — otherwise the header would stick
 * to a wrapper that never scrolls vertically and would sail away with the rows.
 * A table with no bounded scroll container (the governance frames, which are
 * server-paged at 25–50 rows on a page that scrolls) gets a no-op, which costs
 * nothing and starts working by itself the day that frame gains a height.
 *
 * The header hairline is an `inset` box-shadow on the `<th>`, not a border.
 * With `border-collapse: collapse` a collapsed border belongs to the table grid
 * rather than the cell, so it stays behind while a sticky cell moves — the
 * header would scroll down and leave its own underline at the top of the list.
 *
 * **4. Numeric columns are a prop, not a convention.** `numeric` right-aligns
 * and stamps `data-numeric`, which `globals.css` turns into `tabular-nums` +
 * `"tnum" 1`. Aligning a money column by remembering to type two classes is a
 * rule; `<TableCell numeric>` is a type. Both spellings still work — a caller's
 * `className="text-right"` wins over anything here, because `cn` merges by
 * precedence.
 *
 * ## Compatibility
 *
 * Every prop added here is optional and every export is unchanged. The one
 * signature change is that `align` on `TableHead` / `TableCell` now means the
 * logical `"start" | "end" | "center"` rather than the deprecated HTML
 * presentational attribute, which nothing in this repository passes.
 */

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

/** Logical cell alignment. Logical, not physical, so RTL stays free. */
export type TableCellAlign = "start" | "end" | "center"

export type TableSortDirection = "asc" | "desc"

const ALIGN_CLASS: Record<TableCellAlign, string> = {
  start: "text-start",
  end: "text-end",
  center: "text-center",
}

/**
 * True when a `TableScrollArea` is already providing the scrollport.
 *
 * `Table` normally wraps itself in its own `overflow-x-auto` div so a wide
 * table can never widen the page. Inside a `TableScrollArea` that wrapper is
 * actively harmful: `overflow-x: auto` computes `overflow-y` to `auto` as well,
 * so the wrapper becomes the nearest scrollport for the sticky header — and
 * since it has no height of its own it never scrolls, so the header never
 * sticks. Dropping the wrapper leaves ONE scroll container owning both axes,
 * which is also what puts the horizontal scrollbar at the bottom of the visible
 * frame instead of 656 rows below the fold where nobody can reach it.
 */
const InsideScrollArea = createContext(false)

// ---------------------------------------------------------------------------
// Static parts
// ---------------------------------------------------------------------------

function Table({ className, ...props }: ComponentProps<"table">) {
  const insideScrollArea = useContext(InsideScrollArea)

  const table = (
    <table
      data-slot="table"
      className={cn("w-full caption-bottom border-collapse text-sm", className)}
      {...props}
    />
  )

  if (insideScrollArea) return table

  return (
    // The wrapper is what scrolls horizontally. Without it a wide table widens
    // the page itself and the whole document scrolls sideways — the 320px
    // German failure. `relative` is load-bearing too: `sr-only` is
    // `position: absolute`, and an sr-only caption with no positioned ancestor
    // escapes the scroll box and drags the page width with it.
    <div
      data-slot="table-container"
      className="azura-scrollbar-slim relative w-full max-w-full min-w-0 overflow-x-auto"
    >
      {table}
    </div>
  )
}

function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        // The header row's own border is suppressed: the hairline under a
        // sticky header has to be painted by the cell (see the file header), and
        // two hairlines 1px apart is a seam, not a rule.
        "[&_tr]:border-b-0",
        // A header row is not a data row. Without this it would light up under
        // `TableRow`'s hover, which reads as "this is selectable" on the one row
        // that is not.
        "[&_tr:hover]:bg-transparent",
        className
      )}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={className} {...props} />
}

function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        // Hairline separation. Softer than the frame around it on purpose.
        "border-b border-border/70",
        "transition-colors duration-[var(--duration-instant)] ease-[var(--ease-out)]",
        // Hover is gated on a real pointer. On touch, `:hover` sticks to the
        // last row tapped and reads as a selection that cannot be cleared.
        //
        // The `:not([data-selected])` is not decoration and must not be
        // "simplified" away. `.hover\:bg-muted\/50:hover` and
        // `.data-\[selected\]\:bg-secondary[data-selected]` are BOTH
        // specificity (0,2,0), so the winner is whichever Tailwind emits last —
        // and Tailwind emits arbitrary variants after named ones, which puts
        // this hover rule after the selected rule. Without the exclusion, a
        // selected row loses its selection colour the moment the pointer lands
        // on it, which is exactly when the user is reading it. Selection is a
        // state the user set; hover is where the mouse happens to be. State
        // wins, and saying so in the selector is safer than relying on the
        // order two unrelated rules happen to be printed in.
        "[@media(hover:hover)_and_(pointer:fine)]:[&:hover:not([data-selected])]:bg-muted/50",
        "data-[selected]:bg-secondary",
        className
      )}
      {...props}
    />
  )
}

function TableHead({
  className,
  align,
  numeric,
  sortDirection,
  onSort,
  sortLabel,
  children,
  ...props
}: Omit<ComponentProps<"th">, "align"> & {
  /** Logical alignment. Overrides the alignment `numeric` would have chosen. */
  align?: TableCellAlign
  /** Right-align to sit over a `numeric` column of cells. */
  numeric?: boolean
  /** Current sort of THIS column. `null`/omitted = sortable but not sorted. */
  sortDirection?: TableSortDirection | null
  /**
   * Presence of this handler is what makes the column sortable. The affordance
   * is a real `<button>` — a `<th>` with an onClick is a click target that no
   * keyboard reaches and no screen reader announces.
   */
  onSort?: () => void
  /** e.g. "absteigend sortieren". Becomes the button's accessible name suffix. */
  sortLabel?: string
}) {
  const alignment = align ?? (numeric === true ? "end" : undefined)
  const sortable = onSort !== undefined

  // ARIA: a sortable column that is not currently sorted announces "none".
  // Omitting it entirely tells a screen reader the column cannot be sorted.
  const ariaSort = !sortable
    ? undefined
    : sortDirection === "asc"
      ? "ascending"
      : sortDirection === "desc"
        ? "descending"
        : "none"

  return (
    <th
      data-slot="table-head"
      scope="col"
      // Computed BEFORE the spread, so a caller that manages `aria-sort` itself
      // (as `dashboard/data-table.tsx` does) still wins.
      aria-sort={ariaSort}
      data-sortable={sortable ? "" : undefined}
      className={cn(
        // Sticky lives on the cell, not the row group. See the file header.
        "sticky top-0 z-10 bg-muted",
        // A collapsed border would be left behind by a sticky cell; an inset
        // shadow is painted by the cell and travels with it.
        "shadow-[inset_0_-1px_0_0_var(--color-border)]",
        // `whitespace-normal` and a min-width, not `nowrap`: German column
        // headings are long and truncating a heading loses the only label the
        // column has.
        "min-w-24 px-3 py-2.5 text-start align-bottom text-xs font-semibold tracking-[0.04em] text-muted-foreground uppercase sm:px-4",
        alignment === undefined ? undefined : ALIGN_CLASS[alignment],
        className
      )}
      {...props}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onSort}
          title={sortLabel}
          className={cn(
            // 24px floor — the dense-table tap target from the house scale.
            "azura-tap-compact inline-flex max-w-full items-center gap-1.5 rounded-sm text-start",
            "font-semibold tracking-[inherit] text-inherit uppercase",
            "transition-colors duration-[var(--duration-instant)] ease-[var(--ease-out)]",
            "[@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground",
            // An active sort darkens the label, so the sorted column is legible
            // without decoding a 12px arrow.
            sortDirection === undefined || sortDirection === null
              ? undefined
              : "text-foreground"
          )}
        >
          <span className="min-w-0">{children}</span>
          {sortLabel === undefined ? null : (
            <span className="sr-only">{sortLabel}</span>
          )}
          {sortDirection === "asc" ? (
            <ArrowUp className="size-3 shrink-0" aria-hidden="true" />
          ) : sortDirection === "desc" ? (
            <ArrowDown className="size-3 shrink-0" aria-hidden="true" />
          ) : (
            // Present but quiet: the column announces that it CAN be sorted
            // without competing with the column that is.
            <ChevronsUpDown
              className="size-3 shrink-0 opacity-40"
              aria-hidden="true"
            />
          )}
        </button>
      ) : (
        children
      )}
    </th>
  )
}

function TableCell({
  className,
  align,
  numeric,
  ...props
}: Omit<ComponentProps<"td">, "align"> & {
  /** Logical alignment. Overrides the alignment `numeric` would have chosen. */
  align?: TableCellAlign
  /**
   * A compared figure. Right-aligns and stamps `data-numeric`, which
   * `globals.css` turns into tabular figures — proportional digits make a
   * column of money illegible.
   */
  numeric?: boolean
}) {
  const alignment = align ?? (numeric === true ? "end" : undefined)

  return (
    <td
      data-slot="table-cell"
      data-numeric={numeric === true ? "" : undefined}
      className={cn(
        "px-3 py-2 align-middle sm:px-4",
        alignment === undefined ? undefined : ALIGN_CLASS[alignment],
        className
      )}
      {...props}
    />
  )
}

function TableCaption({ className, ...props }: ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-3 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

// ---------------------------------------------------------------------------
// Windowing
// ---------------------------------------------------------------------------

/** Rows rendered above and below the viewport so a fast scroll shows content. */
const OVERSCAN = 6

export interface VirtualWindow {
  startIndex: number
  endIndex: number
  paddingTop: number
  paddingBottom: number
}

/**
 * The visible slice for a fixed-row-height list inside a scroll container.
 *
 * Fixed row height is a real constraint, not laziness: measuring variable rows
 * requires a second layout pass per row, and at 656 rows that costs more than
 * the windowing saves. Every column in this design system is single-line at
 * the row heights used, including German.
 */
export function useVirtualWindow(
  scrollRef: React.RefObject<HTMLElement | null>,
  rowCount: number,
  rowHeight: number
): VirtualWindow {
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  const measure = useCallback(() => {
    const element = scrollRef.current
    if (element === null) return
    setScrollTop(element.scrollTop)
    setViewportHeight(element.clientHeight)
  }, [scrollRef])

  useEffect(() => {
    const element = scrollRef.current
    if (element === null) return

    measure()

    // rAF-coalesced: a scroll handler that calls setState on every event
    // re-renders faster than the browser paints, which is how a windowed list
    // ends up slower than the naive one it replaced.
    let frame = 0
    const onScroll = () => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }

    element.addEventListener("scroll", onScroll, { passive: true })
    const observer = new ResizeObserver(measure)
    observer.observe(element)

    return () => {
      element.removeEventListener("scroll", onScroll)
      observer.disconnect()
      if (frame !== 0) window.cancelAnimationFrame(frame)
    }
  }, [measure, scrollRef])

  return useMemo(() => {
    // Before the first measure, render one screen's worth rather than nothing:
    // a zero-height first paint makes the scrollbar jump once it resolves, and
    // leaves an empty table in a screenshot taken too early.
    const effectiveHeight = viewportHeight > 0 ? viewportHeight : rowHeight * 12

    const first = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN)
    const visible = Math.ceil(effectiveHeight / rowHeight) + OVERSCAN * 2
    const last = Math.min(rowCount, first + visible)

    return {
      startIndex: first,
      endIndex: last,
      paddingTop: first * rowHeight,
      paddingBottom: Math.max(0, (rowCount - last) * rowHeight),
    }
  }, [rowCount, rowHeight, scrollTop, viewportHeight])
}

/**
 * A windowed `<tbody>`.
 *
 * `columnCount` is required because the spacer rows need a `colSpan` that
 * matches the header, or the table's column model breaks and every browser
 * recovers from it differently.
 */
function VirtualTableBody<T>({
  rows,
  rowHeight,
  columnCount,
  scrollRef,
  renderRow,
  className,
}: {
  rows: readonly T[]
  rowHeight: number
  columnCount: number
  scrollRef: React.RefObject<HTMLElement | null>
  renderRow: (row: T, index: number) => ReactNode
  className?: string
}) {
  const { startIndex, endIndex, paddingTop, paddingBottom } = useVirtualWindow(
    scrollRef,
    rows.length,
    rowHeight
  )

  const slice = rows.slice(startIndex, endIndex)

  return (
    <tbody data-slot="table-body" className={className}>
      {paddingTop > 0 ? (
        <tr aria-hidden="true" style={{ height: paddingTop }}>
          <td colSpan={columnCount} />
        </tr>
      ) : null}

      {slice.map((row, offset) => renderRow(row, startIndex + offset))}

      {paddingBottom > 0 ? (
        <tr aria-hidden="true" style={{ height: paddingBottom }}>
          <td colSpan={columnCount} />
        </tr>
      ) : null}
    </tbody>
  )
}

/**
 * Scroll container for a windowed table. Owns the height, so the window
 * arithmetic has something bounded to measure against — and, because it is the
 * only scrollport in the subtree, so does the sticky header.
 *
 * `isolate` is not decoration. A `TableScrollArea` nested inside a row of
 * another one (the wallet page expands payments inside a wallet row) would
 * otherwise put its `z-10` header in the same stacking context as the outer
 * table's, and the inner one — later in the DOM — would paint over the outer
 * sticky header mid-scroll.
 */
function TableScrollArea({
  height,
  className,
  children,
  ref,
  ...props
}: ComponentProps<"div"> & { height: number }) {
  return (
    <div
      ref={ref}
      data-slot="table-scroll-area"
      className={cn(
        "azura-scrollbar-slim relative isolate max-w-full min-w-0 overflow-auto rounded-xl border border-border",
        className
      )}
      style={{ height }}
      {...props}
    >
      <InsideScrollArea.Provider value={true}>
        {children}
      </InsideScrollArea.Provider>
    </div>
  )
}

/** Convenience ref for `TableScrollArea` + `VirtualTableBody`. */
export function useTableScrollRef() {
  return useRef<HTMLDivElement>(null)
}

export {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
  TableScrollArea,
  VirtualTableBody,
}
