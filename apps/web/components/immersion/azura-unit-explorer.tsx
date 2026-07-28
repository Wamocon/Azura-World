"use client"

import { Search, Wifi, WifiOff } from "lucide-react"
import { useDeferredValue, useMemo, useState, type ReactNode } from "react"

import { cn } from "@/lib/cn"
import { collatorFor } from "@/lib/utils"

import { DataQualityMark } from "@/components/evidence/provenance-value"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Input, Label } from "@/components/ui/input"
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

/**
 * AzuraUnitExplorer — filter and search 656 units, live.   Owner: W3-I
 *
 * Mirrors `phase4-live-operations.tsx`: four independent predicates in one
 * `useMemo` with early returns, `"all"` as the sentinel rather than `null`,
 * native controls rather than a component library, and a connection chip that
 * is separate from the provenance marker. Two badges, not one — freshness and
 * provenance are different questions and merging them is how a stale figure
 * ends up wearing a "live" tick.
 *
 * TWO THINGS THE REFERENCE GETS WRONG THAT ARE NOT COPIED:
 *
 * 1. Its connection chip never says "offline" — good — but its search
 *    lower-cases with `toLocaleLowerCase("tr-TR")` unconditionally. On a German
 *    page that maps `I` to the dotless `ı`, so searching "Wohnung" against
 *    "WOHNUNG" fails. Here the locale comes from the caller.
 * 2. It renders every row. 656 DOM rows is what CONVENTIONS §5 forbids, so this
 *    goes through the windowed table primitive.
 *
 * `modelled` units stay visually distinct here exactly as in W3-C — 631 of 656
 * are modelled, so a list that does not mark them is presenting a synthesised
 * inventory as a real one.
 */

export interface UnitExplorerLabels {
  heading: string
  searchLabel: string
  searchPlaceholder: string
  searchHint: string
  allBlocks: string
  allLayouts: string
  /** e.g. "{visible} von {total} Einheiten" */
  count: string
  /** Connection state. Never the word "offline" — name the fallback in effect. */
  connection: { live: string; polling: string }
  columns: {
    unit: string
    block: string
    layout: string
    area: string
    quality: string
  }
  quality: {
    portal_listing: string
    official: string
    modelled: string
    source_missing: string
  }
  empty: { title: string; description: string; reset: string }
}

export interface ExplorerUnit {
  id: string
  blockCode: string
  layout: string
  interiorM2: number | null
  dataQuality: "portal_listing" | "official" | "modelled" | "source_missing"
}

const ROW_HEIGHT = 44

export function AzuraUnitExplorer({
  units,
  labels,
  locale,
  /** Whether the backing surface has a realtime channel. Supplied by W2-D. */
  realtime = false,
  className,
}: {
  units: readonly ExplorerUnit[]
  labels: UnitExplorerLabels
  locale: string
  realtime?: boolean
  className?: string
}): ReactNode {
  const [query, setQuery] = useState("")
  const [block, setBlock] = useState("all")
  const [layout, setLayout] = useState("all")
  const scrollRef = useTableScrollRef()

  // Keep typing responsive: filtering 656 rows on every keystroke blocks the
  // input, and the input is the thing the user is looking at.
  const deferredQuery = useDeferredValue(query)

  const blocks = useMemo(() => {
    const collator = collatorFor(locale)
    return Array.from(new Set(units.map((unit) => unit.blockCode))).sort(
      (a, b) => collator.compare(a, b)
    )
  }, [units, locale])

  const layouts = useMemo(() => {
    const collator = collatorFor(locale)
    return Array.from(new Set(units.map((unit) => unit.layout))).sort((a, b) =>
      collator.compare(a, b)
    )
  }, [units, locale])

  const visible = useMemo(() => {
    // Locale-aware lower-casing. `"I".toLowerCase()` is `"i"` everywhere except
    // Turkish, where the dotless `ı` is a different letter (CONVENTIONS §5).
    const needle = deferredQuery.trim().toLocaleLowerCase(locale)

    return units.filter((unit) => {
      if (block !== "all" && unit.blockCode !== block) return false
      if (layout !== "all" && unit.layout !== layout) return false
      if (needle === "") return true
      const haystack =
        `${unit.id} ${unit.blockCode} ${unit.layout}`.toLocaleLowerCase(locale)
      return haystack.includes(needle)
    })
  }, [units, deferredQuery, block, layout, locale])

  const reset = () => {
    setQuery("")
    setBlock("all")
    setLayout("all")
  }

  const selectClass = cn(
    "h-11 min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground",
    "outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
  )

  return (
    <section
      data-slot="unit-explorer"
      className={cn("flex min-w-0 flex-col gap-4", className)}
      aria-labelledby="azura-explorer-heading"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3
          id="azura-explorer-heading"
          className="font-display text-xl font-semibold"
        >
          {labels.heading}
        </h3>
        {/* Connection state. Separate from the per-row provenance marker. */}
        <Badge
          variant={realtime ? "confirmed" : "muted"}
          data-testid="explorer-connection"
        >
          {realtime ? (
            <Wifi aria-hidden="true" />
          ) : (
            <WifiOff aria-hidden="true" />
          )}
          {realtime ? labels.connection.live : labels.connection.polling}
        </Badge>
      </header>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor="explorer-search">{labels.searchLabel}</Label>
          <div className="relative min-w-0">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="explorer-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={labels.searchPlaceholder}
              aria-describedby="explorer-search-hint"
              className="pl-9"
              data-testid="explorer-search"
            />
          </div>
          <p
            id="explorer-search-hint"
            className="text-xs text-muted-foreground"
          >
            {labels.searchHint}
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor="explorer-block">{labels.columns.block}</Label>
          <select
            id="explorer-block"
            className={selectClass}
            value={block}
            onChange={(event) => setBlock(event.target.value)}
            data-testid="explorer-block"
          >
            <option value="all">{labels.allBlocks}</option>
            {blocks.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor="explorer-layout">{labels.columns.layout}</Label>
          <select
            id="explorer-layout"
            className={selectClass}
            value={layout}
            onChange={(event) => setLayout(event.target.value)}
            data-testid="explorer-layout"
          >
            <option value="all">{labels.allLayouts}</option>
            {layouts.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p
        className="text-sm text-muted-foreground"
        aria-live="polite"
        data-testid="explorer-count"
      >
        {labels.count
          .replace(
            "{visible}",
            new Intl.NumberFormat(locale).format(visible.length)
          )
          .replace(
            "{total}",
            new Intl.NumberFormat(locale).format(units.length)
          )}
      </p>

      {visible.length === 0 ? (
        <EmptyState
          title={labels.empty.title}
          description={labels.empty.description}
          action={
            <Button variant="outline" size="sm" onClick={reset}>
              {labels.empty.reset}
            </Button>
          }
        />
      ) : (
        <TableScrollArea height={420} ref={scrollRef}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{labels.columns.unit}</TableHead>
                <TableHead>{labels.columns.block}</TableHead>
                <TableHead>{labels.columns.layout}</TableHead>
                <TableHead>{labels.columns.area}</TableHead>
                <TableHead>{labels.columns.quality}</TableHead>
              </TableRow>
            </TableHeader>
            <VirtualTableBody
              rows={visible}
              rowHeight={ROW_HEIGHT}
              columnCount={5}
              scrollRef={scrollRef}
              renderRow={(unit) => (
                <TableRow key={unit.id} style={{ height: ROW_HEIGHT }}>
                  <TableCell className="font-medium">{unit.id}</TableCell>
                  <TableCell>{unit.blockCode}</TableCell>
                  <TableCell>{unit.layout}</TableCell>
                  <TableCell data-numeric>
                    {/* A null area is an em dash, never 0 — same rule as a
                        gap fact. `0 m²` would be a claim. */}
                    {unit.interiorM2 === null
                      ? "—"
                      : `${new Intl.NumberFormat(locale).format(unit.interiorM2)} m²`}
                  </TableCell>
                  <TableCell>
                    <DataQualityMark
                      dataQuality={unit.dataQuality}
                      labels={labels.quality}
                    />
                  </TableCell>
                </TableRow>
              )}
            />
          </Table>
        </TableScrollArea>
      )}
    </section>
  )
}
