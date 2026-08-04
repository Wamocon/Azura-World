"use client"

import { ArrowRight } from "lucide-react"
import { useMemo, useState, type ReactNode } from "react"

import { Link } from "@/app/navigation"

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  UnitProvenanceBadge,
  type UnitProvenanceLabels,
} from "@/components/inventory/unit-provenance-badge"
import { Explain, type ExplainLabels } from "@/components/ui/explain"
import { cn } from "@/lib/cn"
import type { Locale, Money } from "@/lib/contracts"
import { formatArea, formatMoney } from "@/lib/format"
import type { UnitDataQuality } from "@/lib/inventory-data"

/**
 * UnitsMatrix — the inventory as a plan, not a list.          Owner: W-NIGHT
 *
 * A block-by-block grid of every unit as a coloured cell, the way a manager
 * thinks about a site. Colour is the REAL sale status, never an invented one:
 * `available` is green, `reserved` amber, `sold` rose, and anything the data
 * does not state (every modelled unit) is a neutral "not stated" cell — because
 * no source publishes unit-level availability for the modelled 631, and a
 * green/amber guess there would be exactly the fabrication this product refuses
 * (SYSTEM-PROMPT §2.3). Amber and rose therefore appear only if such data ever
 * arrives; today the honest picture is 25 green (the real B01 listings) and the
 * rest neutral.
 *
 * Clicking a cell opens the unit's detail in an in-page Dialog — no navigation,
 * the plan stays on screen behind it. The provenance filter dims rather than
 * removes, so the spatial completeness of the plan is never broken.
 */

export type MatrixSaleStatus =
  | "available"
  | "reserved"
  | "sold"
  | "unknown"
  | null

export interface MatrixUnit {
  id: string
  unitNo: string
  blockCode: string
  blockName: string | null
  layout: string
  interiorM2: number | null
  outdoorM2: number | null
  floorLevel: number | null
  price: Money | null
  saleStatus: MatrixSaleStatus
  dataQuality: UnitDataQuality
}

export interface MatrixBlock {
  code: string
  name: string | null
  units: MatrixUnit[]
}

export interface UnitsMatrixLabels {
  provenance: UnitProvenanceLabels
  provenanceLabel: string
  filterAll: string
  status: {
    available: string
    reserved: string
    sold: string
    notStated: string
  }
  columns: {
    layout: string
    area: string
    price: string
    status: string
  }
  legend: string
  /** "Open apartment" — the way out of this popup, into the unit's own page. */
  openUnit: string
  close: string
  floor: string
  outdoor: string
  /** Template with `{available}`. */
  availableCount: string
  detailLead: string
  blockLabel: string
  hint: string
  notAvailable: string
  /**
   * Plain-language explanations, keyed by glossary term. Every jargon word this
   * matrix shows a reader — "Modelled", "Not stated" — carries one, because the
   * honesty control is worthless if only its author can read it.
   */
  explain: Record<string, ExplainLabels>
}

type StatusKey = "available" | "reserved" | "sold" | "unknown"

function statusKey(status: MatrixSaleStatus): StatusKey {
  return status === "available" || status === "reserved" || status === "sold"
    ? status
    : "unknown"
}

const CELL_TONE: Record<StatusKey, string> = {
  available:
    "bg-emerald-500/70 hover:bg-emerald-500 focus-visible:bg-emerald-500 text-emerald-950",
  reserved:
    "bg-amber-500/70 hover:bg-amber-500 focus-visible:bg-amber-500 text-amber-950",
  sold: "bg-rose-500/70 hover:bg-rose-500 focus-visible:bg-rose-500 text-rose-950",
  unknown:
    "bg-muted-foreground/15 hover:bg-muted-foreground/30 focus-visible:bg-muted-foreground/30 text-muted-foreground",
}

/** Badge value -> glossary term. Kept beside the tones they label. */
const QUALITY_TERM: Record<UnitDataQuality, string> = {
  portal_listing: "realListing",
  official: "official",
  modelled: "modelled",
  source_missing: "sourceMissing",
}

const STATUS_TERM: Record<StatusKey, string> = {
  available: "available",
  reserved: "reserved",
  sold: "sold",
  unknown: "notStated",
}

const LEGEND_DOT: Record<StatusKey, string> = {
  available: "bg-emerald-500",
  reserved: "bg-amber-500",
  sold: "bg-rose-500",
  unknown: "bg-muted-foreground/40",
}

export function UnitsMatrix({
  blocks,
  labels,
  locale,
}: {
  blocks: readonly MatrixBlock[]
  labels: UnitsMatrixLabels
  locale: Locale
}): ReactNode {
  const [selected, setSelected] = useState<MatrixUnit | null>(null)
  const [filter, setFilter] = useState<UnitDataQuality | "all">("all")

  const statusLabel = (status: MatrixSaleStatus): string => {
    switch (statusKey(status)) {
      case "available":
        return labels.status.available
      case "reserved":
        return labels.status.reserved
      case "sold":
        return labels.status.sold
      default:
        return labels.status.notStated
    }
  }

  // Which provenance kinds actually occur, so the filter shows only real chips.
  const presentQualities = useMemo(() => {
    const set = new Set<UnitDataQuality>()
    for (const block of blocks) for (const u of block.units) set.add(u.dataQuality)
    return set
  }, [blocks])

  const legendKeys: StatusKey[] = ["available", "reserved", "sold", "unknown"]

  return (
    <div className="flex flex-col gap-5">
      {/* Legend + provenance filter. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="azura-label text-muted-foreground">
            {labels.legend}
          </span>
          {legendKeys.map((key) => {
            // The legend is where a reader first meets these four words, so it
            // is where the explanation belongs.
            const term = key === "unknown" ? "notStated" : key
            const explain = labels.explain[term]
            return (
              <span
                key={key}
                className="inline-flex items-center gap-1.5 text-xs"
              >
                <span
                  className={cn("size-2.5 rounded-[3px]", LEGEND_DOT[key])}
                  aria-hidden="true"
                />
                {explain === undefined ? (
                  <span className="text-muted-foreground">
                    {statusLabel(key === "unknown" ? null : key)}
                  </span>
                ) : (
                  <Explain labels={explain} className="text-muted-foreground">
                    {statusLabel(key === "unknown" ? null : key)}
                  </Explain>
                )}
              </span>
            )
          })}
        </div>

        {presentQualities.size > 1 ? (
          <div
            role="group"
            aria-label={labels.provenanceLabel}
            className="flex flex-wrap items-center gap-1.5"
          >
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
              {labels.filterAll}
            </FilterChip>
            {(["portal_listing", "official", "modelled", "source_missing"] as const)
              .filter((q) => presentQualities.has(q))
              .map((q) => (
                <FilterChip
                  key={q}
                  active={filter === q}
                  onClick={() => setFilter(q)}
                >
                  {labels.provenance[q]}
                </FilterChip>
              ))}
          </div>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">{labels.hint}</p>

      {/* Block cards. */}
      <div className="grid gap-4 lg:grid-cols-2">
        {blocks.map((block) => {
          if (block.units.length === 0) return null
          const availableInBlock = block.units.filter(
            (u) => u.saleStatus === "available"
          ).length
          return (
            <section
              key={block.code}
              aria-label={block.name ?? `${labels.blockLabel} ${block.code}`}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
            >
              <header className="flex items-baseline justify-between gap-3">
                <h3 className="font-display text-[0.9375rem] text-foreground">
                  {block.name ?? `${labels.blockLabel} ${block.code}`}
                </h3>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {labels.availableCount.replace(
                    "{available}",
                    String(availableInBlock)
                  )}{" "}
                  · {block.units.length}
                </span>
              </header>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(2rem,1fr))] gap-1">
                {block.units.map((unit) => {
                  const dimmed = filter !== "all" && unit.dataQuality !== filter
                  return (
                    <button
                      key={unit.id}
                      type="button"
                      onClick={() => setSelected(unit)}
                      title={`${unit.unitNo} · ${unit.layout} · ${statusLabel(unit.saleStatus)}`}
                      aria-label={`${unit.unitNo} · ${statusLabel(unit.saleStatus)}`}
                      className={cn(
                        "flex aspect-square min-w-0 items-center justify-center rounded-[4px] border text-[0.625rem] font-medium tabular-nums transition-all duration-150",
                        "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                        CELL_TONE[statusKey(unit.saleStatus)],
                        dimmed && "opacity-20"
                      )}
                    >
                      {unit.unitNo}
                    </button>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      {/* The unit-detail popup. Controlled: opens when a cell is clicked. */}
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        {selected !== null ? (
          <DialogContent closeLabel={labels.close}>
            <div className="flex flex-col gap-1">
              <span className="azura-label text-muted-foreground">
                {labels.detailLead}
              </span>
              <DialogTitle className="tabular-nums">
                {selected.unitNo || selected.id}
              </DialogTitle>
            </div>

            {/* Both badges are jargon, and this popup is where a reader stops
                to read. Each carries its own plain-language explanation. */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1">
                <UnitProvenanceBadge
                  dataQuality={selected.dataQuality}
                  labels={labels.provenance}
                />
                {labels.explain[QUALITY_TERM[selected.dataQuality]] ===
                undefined ? null : (
                  <Explain
                    iconOnly
                    labels={
                      labels.explain[
                        QUALITY_TERM[selected.dataQuality]
                      ] as ExplainLabels
                    }
                  />
                )}
              </span>
              <span className="inline-flex items-center gap-1">
                <StatusPill
                  status={selected.saleStatus}
                  label={statusLabel(selected.saleStatus)}
                />
                {labels.explain[STATUS_TERM[statusKey(selected.saleStatus)]] ===
                undefined ? null : (
                  <Explain
                    iconOnly
                    labels={
                      labels.explain[
                        STATUS_TERM[statusKey(selected.saleStatus)]
                      ] as ExplainLabels
                    }
                  />
                )}
              </span>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Field label={labels.blockLabel} value={selected.blockName ?? selected.blockCode} />
              {selected.floorLevel !== null ? (
                <Field label={labels.floor} value={String(selected.floorLevel)} />
              ) : null}
              <Field label={labels.columns.layout} value={selected.layout} />
              <Field
                label={labels.columns.area}
                value={
                  selected.interiorM2 === null
                    ? labels.notAvailable
                    : formatArea(selected.interiorM2, locale)
                }
              />
              {selected.outdoorM2 !== null ? (
                <Field
                  label={labels.outdoor}
                  value={formatArea(selected.outdoorM2, locale)}
                />
              ) : null}
              <Field
                label={labels.columns.price}
                value={
                  selected.price === null
                    ? labels.notAvailable
                    : formatMoney(selected.price, locale)
                }
                muted={selected.dataQuality === "modelled"}
              />
            </dl>

            {/* The way out.

                This popup shows the apartment's own columns and nothing else,
                which is the whole catalogue and none of the operation. What a
                reader actually wants next — is anything open on it, what does
                it owe, what paperwork is on file — is three other modules, and
                until this link existed there was no way to ask any of them
                about one apartment. `/dashboard/units/<code>` reads all three,
                each behind its own permission. */}
            <div>
              <Link
                href={`/dashboard/units/${selected.id}`}
                locale={locale}
                className="inline-flex w-fit items-center gap-1.5 rounded text-sm font-medium underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <ArrowRight aria-hidden="true" className="size-3.5" />
                {labels.openUnit}
              </Link>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  )
}

function Field({
  label,
  value,
  muted = false,
}: {
  label: string
  value: string
  muted?: boolean
}): ReactNode {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[0.6875rem] tracking-[0.04em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "font-medium tabular-nums text-foreground",
          muted && "text-muted-foreground"
        )}
      >
        {value}
      </dd>
    </div>
  )
}

function StatusPill({
  status,
  label,
}: {
  status: MatrixSaleStatus
  label: string
}): ReactNode {
  const key = statusKey(status)
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs">
      <span className={cn("size-2 rounded-full", LEGEND_DOT[key])} aria-hidden="true" />
      {label}
    </span>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs transition-colors",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:border-primary hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}
