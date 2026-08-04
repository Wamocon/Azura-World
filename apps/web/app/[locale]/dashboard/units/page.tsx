import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"

import { Home } from "lucide-react"

import { Link, redirect } from "@/app/navigation"
import { DashboardPageHeader } from "@/components/dashboard/section"
import { EmptyState } from "@/components/ui/empty-state"
import { InventorySplitSummary } from "@/components/inventory/inventory-split-summary"
import type { UnitProvenanceLabels } from "@/components/inventory/unit-provenance-badge"
import {
  UnitsMatrix,
  type MatrixBlock,
  type MatrixUnit,
  type UnitsMatrixLabels,
} from "@/components/inventory/units-matrix"
import { getUserProfile } from "@/lib/auth"
import { getGlossary } from "@/lib/glossary"
import { hasPermission } from "@/lib/rbac"
import { scopeKindForRole } from "@/lib/inventory-repository"
import type { Locale } from "@/lib/contracts"
import {
  getAvailabilityRollup,
  getUnits,
  type InventoryUnit,
} from "@/lib/inventory-repository"

/**
 * /[locale]/dashboard/units — the inventory as a block matrix.  Owner: W3-C
 *
 * ## From list to plan
 *
 * This was a 656-row paginated table. It is now the plan a manager actually
 * thinks in: seven blocks, each unit a coloured cell, availability at a glance,
 * click a cell for its full record in an in-page popup. The three honesty
 * channels the list carried are all kept — the header split (25 real / 631
 * modelled), a provenance filter, and a per-cell provenance in the popup.
 *
 * ## Colour is the real status, never an invented one
 *
 * A cell is green only when a source states the unit is `available` (the 25 B01
 * listings); every modelled unit, whose availability no source publishes, is a
 * neutral "not stated" cell. Amber (`reserved`) and rose (`sold`) render only if
 * such data ever arrives. Painting the modelled 631 as available or reserved
 * would be the fabrication this module exists to prevent (SYSTEM-PROMPT §2.3).
 *
 * ## Rendering
 *
 * Server Component: it fetches every scoped unit once and hands the matrix a
 * slim per-unit shape (no `SourcedFact` sources cross the wire). The matrix
 * itself is the one client island, for the cell clicks and the popup. No
 * `export const dynamic` — the root layout already forces dynamic (W-INT §4).
 */

/**
 * The browser tab, in the reader's language. This was a German literal, so a
 * Turkish page carried a German tab; the heading beside it was already
 * translated, which made the mismatch worse rather than invisible.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.units" })
  return {
    title: t("title"),
    robots: { index: false, follow: false },
  }
}

/** Fetch every scoped unit, paging past the repository's per-call clamp. */
async function fetchAllUnits(
  scope: Omit<Parameters<typeof getUnits>[0], "limit" | "offset" | "dataQuality">
): Promise<{ units: InventoryUnit[]; degraded: boolean }> {
  const PAGE = 500
  const units: InventoryUnit[] = []
  let degraded = false
  for (let offset = 0; offset < 4000; offset += PAGE) {
    const result = await getUnits({ ...scope, limit: PAGE, offset })
    if (result.source === "local-seed") degraded = true
    units.push(...result.data)
    if (result.data.length < PAGE) break
  }
  return { units, degraded }
}

function toMatrixUnit(unit: InventoryUnit): MatrixUnit {
  return {
    id: unit.id,
    unitNo: unit.unitNo || unit.id,
    blockCode: unit.blockCode,
    blockName: unit.blockName,
    layout: unit.layout,
    interiorM2: unit.interiorM2,
    outdoorM2: unit.outdoorM2,
    floorLevel: unit.floorLevel,
    price: unit.askingPrice?.value ?? null,
    saleStatus: unit.saleStatus?.value ?? null,
    dataQuality: unit.dataQuality,
  }
}

export default async function UnitsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>
}) {
  const { locale } = await params

  const t = await getTranslations({ locale, namespace: "dashboard.units" })
  const tCommon = await getTranslations({ locale, namespace: "common" })

  const profile = await getUserProfile()
  const scope = {
    role: profile.role,
    ...(profile.id === null ? {} : { profileId: profile.id }),
  }

  if (!hasPermission(profile.role, "units:view")) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <p role="alert" className="max-w-prose text-sm text-muted-foreground">
          {tCommon("errors.forbidden")}
        </p>
      </div>
    )
  }

  /**
   * A resident opening "Units" wants their apartment, not the sales matrix.
   *
   * Measured on 2026-08-04: a `tenant` on this page saw the 656-unit inventory
   * screen shrunk to a single cell — an availability legend, a provenance
   * filter, and the sentence "1 of the 1 apartments come from a real listing on
   * a property portal" — about their own home. Every one of those controls
   * answers a question a seller asks. None answers one a resident has.
   *
   * So for a resident-scoped caller the route goes to the apartment itself.
   * With exactly one holding that is a redirect, and their nav item lands on
   * the page that shows what is open on their flat, what it owes and what
   * paperwork is on file. With several — an owner with more than one — it is a
   * list of them, below. Staff and above are unaffected and still get the
   * matrix; `scopeKindForRole` is the same function the repository uses to
   * decide what to return, so the two cannot disagree.
   */
  const residentScoped = scopeKindForRole(profile.role) === "resident"
  if (residentScoped) {
    const own = await fetchAllUnits(scope)
    if (own.units.length === 1 && own.units[0] !== undefined) {
      redirect({ href: `/dashboard/units/${own.units[0].id}`, locale })
    }
    return (
      <div className="flex min-w-0 flex-col gap-6">
        <DashboardPageHeader
          title={t("mine.title")}
          description={t("mine.lead")}
        />
        {own.units.length === 0 ? (
          <EmptyState
            icon={Home}
            title={t("mine.empty")}
            description={t("mine.emptyLead")}
          />
        ) : (
          <ul className="grid [grid-template-columns:repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-3">
            {own.units.map((unit) => (
              <li key={unit.id}>
                <Link
                  href={`/dashboard/units/${unit.id}`}
                  locale={locale}
                  className="flex min-w-0 flex-col gap-1 rounded-lg border border-input px-4 py-3 transition-colors duration-150 ease-[var(--ease-out)] hover:border-foreground/25 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <span className="font-mono text-sm tabular-nums">
                    {unit.id}
                  </span>
                  {/* `blockName` is null by design — see `seedBlockRows` — so
                      the fallback is the ordinary path, not the exception. It
                      composes the reader's own word for "block" with the code
                      rather than dropping to a bare "B01". */}
                  <span className="text-sm text-muted-foreground">
                    {unit.layout} ·{" "}
                    {unit.blockName ??
                      `${t("matrix.blockLabel")} ${unit.blockCode}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  const glossary = await getGlossary(locale)

  const [rollupResult, all] = await Promise.all([
    getAvailabilityRollup(scope),
    fetchAllUnits(scope),
  ])
  const rollup = rollupResult.data
  const degraded = rollupResult.source === "local-seed" || all.degraded

  const provLabels: UnitProvenanceLabels = {
    portal_listing: t("provenance.portal_listing"),
    official: t("provenance.official"),
    modelled: t("provenance.modelled"),
    source_missing: t("provenance.source_missing"),
  }

  // Group the units into blocks, in block-code order.
  const byBlock = new Map<string, MatrixUnit[]>()
  for (const unit of all.units) {
    const cell = toMatrixUnit(unit)
    const list = byBlock.get(unit.blockCode)
    if (list === undefined) byBlock.set(unit.blockCode, [cell])
    else list.push(cell)
  }
  const blocks: MatrixBlock[] = [...byBlock.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((code) => {
      const units = byBlock.get(code) ?? []
      return { code, name: units[0]?.blockName ?? null, units }
    })

  const matrixLabels: UnitsMatrixLabels = {
    provenance: provLabels,
    provenanceLabel: t("provenance.filterLabel"),
    filterAll: t("provenance.filterAll"),
    status: {
      available: t("status.available"),
      reserved: t("status.reserved"),
      sold: t("status.sold"),
      notStated: t("matrix.notStated"),
    },
    columns: {
      layout: t("columns.layout"),
      area: t("columns.area"),
      price: t("columns.price"),
      status: t("columns.status"),
    },
    legend: t("matrix.legend"),
    openUnit: t("matrix.openUnit"),
    close: t("matrix.close"),
    floor: t("matrix.floor"),
    outdoor: t("matrix.outdoor"),
    availableCount: t.raw("matrix.availableCount") as string,
    detailLead: t("matrix.detailLead"),
    blockLabel: t("matrix.blockLabel"),
    hint: t("matrix.hint"),
    notAvailable: tCommon("notAvailable"),
    explain: glossary,
  }

  const total = rollup.totalUnits
  const portalCount = rollup.byDataQuality.portal_listing ?? 0
  const modelledCount = rollup.byDataQuality.modelled ?? 0

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <p className="max-w-prose text-sm text-muted-foreground">{t("lead")}</p>
      </header>

      {degraded ? (
        <p
          role="status"
          className="rounded-lg border border-confidence-gap/30 bg-confidence-gap/10 px-3 py-2 text-sm text-foreground"
        >
          {tCommon("dataSource.localSeedHint")}
        </p>
      ) : null}

      <InventorySplitSummary
        byDataQuality={rollup.byDataQuality}
        total={total}
        labels={provLabels}
        heading={t("split.heading")}
        caption={t("split.caption", {
          portal: portalCount,
          modelled: modelledCount,
          total,
        })}
        countLabel={(count) => t("count", { count })}
        explain={{
          portal_listing: glossary.realListing,
          official: glossary.official,
          modelled: glossary.modelled,
          source_missing: glossary.sourceMissing,
        }}
      />

      {blocks.length === 0 ? (
        <p className="rounded-lg border border-border bg-background/50 p-6 text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <UnitsMatrix blocks={blocks} labels={matrixLabels} locale={locale} />
      )}
    </div>
  )
}
