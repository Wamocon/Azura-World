import type { ReactNode } from "react"

import { Donut, StackedBar } from "@/components/charts"
import type { ChartPoint } from "@/components/charts"
import type { DashboardSnapshot } from "@/lib/dashboard-data"
import type { Locale } from "@/lib/contracts"
import { intlLocaleTag } from "@/lib/format"

/**
 * The charts row on the dashboard home.                       Owner: W-NIGHT
 *
 * ## Why this exists
 *
 * The home was twelve KPI number-boxes and nothing else — the exact "no charts
 * anywhere" the redesign was asked to fix, and the reason the 1,700-line chart
 * library sat unused. This is the first real consumer of it: two charts built
 * from the SAME `DashboardSnapshot` the KPI cards already read, so no new query
 * and no new claim.
 *
 * ## Honesty carries over from the KPIs
 *
 *  - It renders a panel ONLY when the role may see it. `getDashboardSnapshot`
 *    nulls `operations`/`inventory` for a role without the permission, so a
 *    tenant never sees the tickets chart. RBAC is enforced upstream; this just
 *    respects the null.
 *  - Every figure is a real count from the snapshot. The tickets chart is the
 *    same `byStatus` the operations KPIs come from; the provenance chart is the
 *    same real-vs-modelled split the units page shows. Nothing is synthesised.
 *  - Each chart states its basis and carries a screen-reader table, because
 *    that is the contract every chart in this codebase keeps.
 *
 * A Server Component: it holds no state and ships no JavaScript, like the charts
 * it composes.
 */

export interface DashboardChartsLabels {
  title: string
  ticketsTitle: string
  ticketsBasis: string
  ticketsTotal: string
  qualityTitle: string
  qualityBasis: string
  empty: string
  tableCategory: string
  tableCount: string
  qualityReal: string
  qualityModelled: string
  qualityOfficial: string
  qualityGap: string
  /** Resolves a ticket status key to its localised label. */
  statusLabel: (status: string) => string
}

/** Fixed status order, so the donut and its legend do not reshuffle. */
const STATUS_ORDER = [
  "open",
  "assigned",
  "in_progress",
  "blocked",
  "resolved",
  "closed",
  "cancelled",
  "draft",
] as const

export function DashboardCharts({
  snapshot,
  labels,
  locale,
}: {
  snapshot: DashboardSnapshot
  labels: DashboardChartsLabels
  locale: Locale
}): ReactNode {
  const nf = new Intl.NumberFormat(intlLocaleTag(locale))
  const tableLabels = { category: labels.tableCategory, value: labels.tableCount }

  // ---- Tickets by status (operations panel) --------------------------------
  let ticketsChart: ReactNode = null
  if (snapshot.operations !== null) {
    const byStatus = snapshot.operations.byStatus
    const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0)
    const segments: ChartPoint[] = STATUS_ORDER.filter(
      (status) => (byStatus[status] ?? 0) > 0
    ).map((status) => {
      const value = byStatus[status] ?? 0
      return {
        label: labels.statusLabel(status),
        value,
        formattedValue: nf.format(value),
      }
    })
    ticketsChart = (
      <ChartCard title={labels.ticketsTitle}>
        <Donut
          segments={segments}
          ariaLabel={labels.ticketsTitle}
          basis={labels.ticketsBasis}
          emptyLabel={labels.empty}
          tableLabels={tableLabels}
          centerValue={nf.format(total)}
          centerLabel={labels.ticketsTotal}
        />
      </ChartCard>
    )
  }

  // ---- Inventory by origin (inventory panel) -------------------------------
  let qualityChart: ReactNode = null
  if (snapshot.inventory !== null) {
    const inv = snapshot.inventory
    // Real-first, so the eye lands on the small true segment, matching the units
    // page. Each is a real count off the snapshot.
    const real = inv.portalListingUnits
    const modelled = inv.modelledUnits
    const official = inv.byDataQuality["official"] ?? 0
    const gap = inv.byDataQuality["source_missing"] ?? 0
    const raw: Array<{ label: string; value: number; tone: ChartPoint["tone"] }> = [
      { label: labels.qualityReal, value: real, tone: 3 },
      { label: labels.qualityOfficial, value: official, tone: 2 },
      { label: labels.qualityModelled, value: modelled, tone: 5 },
      { label: labels.qualityGap, value: gap, tone: 1 },
    ]
    const segments: ChartPoint[] = raw
      .filter((s) => s.value > 0)
      .map((s) => ({
        label: s.label,
        value: s.value,
        formattedValue: nf.format(s.value),
        ...(s.tone === undefined ? {} : { tone: s.tone }),
      }))
    qualityChart = (
      <ChartCard title={labels.qualityTitle}>
        <StackedBar
          segments={segments}
          ariaLabel={labels.qualityTitle}
          basis={labels.qualityBasis}
          emptyLabel={labels.empty}
          tableLabels={tableLabels}
        />
      </ChartCard>
    )
  }

  // Nothing this role can chart: render nothing rather than an empty heading.
  if (ticketsChart === null && qualityChart === null) return null

  return (
    <section aria-labelledby="dashboard-charts-heading" className="flex flex-col gap-4">
      <h2
        id="dashboard-charts-heading"
        className="text-sm font-semibold text-foreground"
      >
        {labels.title}
      </h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {ticketsChart}
        {qualityChart}
      </div>
    </section>
  )
}

function ChartCard({
  title,
  children,
}: {
  title: string
  children: ReactNode
}): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      {children}
    </div>
  )
}
