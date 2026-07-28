"use client"

import {
  useCallback,
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
 */

// ---------------------------------------------------------------------------
// Static parts
// ---------------------------------------------------------------------------

function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    // The wrapper is what scrolls horizontally. Without it a wide table
    // widens the page itself and the whole document scrolls sideways.
    <div className="azura-scrollbar-slim w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn("w-full caption-bottom border-collapse text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b [&_tr]:border-border", className)}
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
        "border-b border-border transition-colors duration-150 hover:bg-muted/60 data-[selected]:bg-secondary",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      scope="col"
      className={cn(
        // `whitespace-normal` and a min-width, not `nowrap`: German column
        // headings are long and truncating a heading loses the only label the
        // column has.
        "min-w-24 px-3 py-2.5 text-left align-bottom text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn("px-3 py-2.5 align-middle", className)}
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
 * arithmetic has something bounded to measure against.
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
        "azura-scrollbar-slim relative overflow-auto rounded-xl border border-border",
        className
      )}
      style={{ height }}
      {...props}
    >
      {children}
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
