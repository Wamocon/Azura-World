import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"

import { InventorySplitSummary } from "@/components/inventory/inventory-split-summary"
import {
  UnitProvenanceBadge,
  type UnitProvenanceLabels,
} from "@/components/inventory/unit-provenance-badge"
import { Link } from "@/app/navigation"
import { getUserProfile } from "@/lib/auth"
import { hasPermission } from "@/lib/rbac"
import { cn } from "@/lib/cn"
import type { Locale } from "@/lib/contracts"
import { formatArea, formatMoney } from "@/lib/format"
import {
  getAvailabilityRollup,
  getUnits,
  type InventoryUnit,
} from "@/lib/inventory-repository"
import type { UnitDataQuality } from "@/lib/inventory-data"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScrollArea,
} from "@/components/ui/table"

/**
 * /[locale]/dashboard/units — the inventory list.            Owner: W3-C
 *
 * ## Why this page exists at all
 *
 * `HANDOFF/W3-C.md` §9 carried this as the gap that mattered most: *"the
 * `modelled` vs `portal_listing` split is NOT rendered anywhere yet"*. 631 of
 * 656 units are synthesised to fill an inventory whose real composition nobody
 * published, and 25 came from an actual portal listing. Until this page
 * existed, nothing in the product showed that — the honesty control for the
 * whole module was a number in a handoff.
 *
 * It is rendered three ways here, because one way is a thing a reader can miss:
 *
 *   1. the header — counts, percentages and a proportion bar (3.8% is real);
 *   2. a `Herkunft` COLUMN, so every row states its own provenance;
 *   3. a row treatment — modelled rows are recessed and carry a left accent, so
 *      the 25 real listings stand out while SCANNING, before anything is read.
 *
 * ## Pagination, not virtualisation
 *
 * CONVENTIONS §5 requires one or the other for 656 rows. Server-side paging via
 * `searchParams` was chosen over `useVirtualWindow` because it needs **no
 * client component at all**: this page ships zero JavaScript of its own, so it
 * cannot be broken by the S-009 class of CSP failure, and it works with JS off.
 * The virtual window stays available in `components/ui/table.tsx` if a future
 * pass wants one long scroll.
 *
 * ## Rendering mode
 *
 * No `export const dynamic`. W-INT §4 made the root layout read `headers()`,
 * so every route beneath it is already dynamic; adding `force-static` here
 * would ship a CSP-dead page that looks correct in dev (S-009).
 */

export const metadata: Metadata = {
  title: "Wohnungen",
  robots: { index: false, follow: false },
}

const PAGE_SIZE = 50

const DATA_QUALITIES: UnitDataQuality[] = [
  "portal_listing",
  "official",
  "modelled",
  "source_missing",
]

function isDataQuality(value: string | undefined): value is UnitDataQuality {
  return value !== undefined && (DATA_QUALITIES as string[]).includes(value)
}

/** `?page=` is 1-based for humans; the repository takes a 0-based offset. */
function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value
  const n = Number.parseInt(raw ?? "1", 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function UnitsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale } = await params
  const query = await searchParams

  const t = await getTranslations({ locale, namespace: "dashboard.units" })
  const tCommon = await getTranslations({ locale, namespace: "common" })

  // The viewer's real scope. WITHOUT this the repository resolves to the
  // PUBLIC scope — `is_publicly_listed = true`, which is 22 units, all of them
  // portal listings — and the split summary would cheerfully report "22 of 22
  // units come from a real listing". That is not a rounding error, it is the
  // honesty control inverted: the 631 modelled rows this page exists to mark
  // would simply be absent. Measured before it was fixed.
  const profile = await getUserProfile()
  const scope = {
    role: profile.role,
    ...(profile.id === null ? {} : { profileId: profile.id }),
  }

  // RBAC is re-checked here even though the nav already hides the entry and the
  // guard already ran: CONVENTIONS §2 — assume the user typed the URL.
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

  const qualityFilter = first(query["quality"])
  const activeQuality = isDataQuality(qualityFilter) ? qualityFilter : undefined
  const page = parsePage(query["page"])
  const offset = (page - 1) * PAGE_SIZE

  const [rollupResult, unitsResult] = await Promise.all([
    getAvailabilityRollup(scope),
    getUnits({
      ...scope,
      limit: PAGE_SIZE,
      offset,
      ...(activeQuality ? { dataQuality: activeQuality } : {}),
    }),
  ])

  const rollup = rollupResult.data
  const units = unitsResult.data
  const degraded =
    rollupResult.source === "local-seed" || unitsResult.source === "local-seed"

  const labels: UnitProvenanceLabels = {
    portal_listing: t("provenance.portal_listing"),
    official: t("provenance.official"),
    modelled: t("provenance.modelled"),
    source_missing: t("provenance.source_missing"),
  }
  const meanings: Record<UnitDataQuality, string> = {
    portal_listing: t("provenance.portalMeaning"),
    official: t("provenance.portalMeaning"),
    modelled: t("provenance.modelledMeaning"),
    source_missing: t("provenance.modelledMeaning"),
  }

  const portalCount = rollup.byDataQuality.portal_listing ?? 0
  const modelledCount = rollup.byDataQuality.modelled ?? 0
  const total = rollup.totalUnits

  // The filtered count drives paging; the rollup total never changes with the
  // filter, so the header keeps telling the truth about the whole inventory
  // even while the list below shows one slice of it.
  const filteredTotal = activeQuality
    ? (rollup.byDataQuality[activeQuality] ?? 0)
    : total
  const pageCount = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE))
  const from = filteredTotal === 0 ? 0 : offset + 1
  const to = Math.min(offset + units.length, filteredTotal)

  const hrefFor = (next: {
    quality?: UnitDataQuality | null
    page?: number
  }) => {
    const sp = new URLSearchParams()
    const q =
      next.quality === undefined ? activeQuality : (next.quality ?? undefined)
    if (q) sp.set("quality", q)
    const p = next.page ?? 1
    if (p > 1) sp.set("page", String(p))
    const s = sp.toString()
    return `/dashboard/units${s ? `?${s}` : ""}`
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <p className="max-w-prose text-sm text-muted-foreground">{t("lead")}</p>
      </header>

      {degraded ? (
        // CONTRACTS §4: `local-seed` is a labelled state, never a silent one.
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
        labels={labels}
        heading={t("split.heading")}
        caption={t("split.caption", {
          portal: portalCount,
          modelled: modelledCount,
          total,
        })}
        countLabel={(count) => t("count", { count })}
      />

      {/* Filter by provenance. Plain links, so this works with no JavaScript —
          the same reason the page pages on the server. */}
      <nav
        aria-label={t("provenance.filterLabel")}
        className="flex flex-wrap items-center gap-2"
      >
        <FilterChip
          href={hrefFor({ quality: null })}
          active={activeQuality === undefined}
        >
          {t("provenance.filterAll")}
        </FilterChip>
        {DATA_QUALITIES.filter((q) => (rollup.byDataQuality[q] ?? 0) > 0).map(
          (quality) => (
            <FilterChip
              key={quality}
              href={hrefFor({ quality })}
              active={activeQuality === quality}
            >
              {labels[quality]}
              <span className="ml-1.5 tabular-nums opacity-70">
                {rollup.byDataQuality[quality] ?? 0}
              </span>
            </FilterChip>
          )
        )}
      </nav>

      {units.length === 0 ? (
        <p className="rounded-lg border border-border bg-background/50 p-6 text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <TableScrollArea height={640}>
          <Table>
            <TableCaption>
              {tCommon("pagination.showing", {
                from,
                to,
                total: filteredTotal,
              })}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.id")}</TableHead>
                <TableHead>{t("columns.block")}</TableHead>
                <TableHead>{t("columns.layout")}</TableHead>
                <TableHead className="text-right">
                  {t("columns.area")}
                </TableHead>
                <TableHead className="text-right">
                  {t("columns.price")}
                </TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                {/* The honesty column. Deliberately not last-and-forgotten on
                    wide screens — it sits next to the price it qualifies. */}
                <TableHead>{t("provenance.label")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {units.map((unit) => (
                <UnitRow
                  key={unit.id}
                  unit={unit}
                  locale={locale}
                  labels={labels}
                  meanings={meanings}
                  rowNote={t("split.rowNote")}
                  statusLabel={statusLabelFor(unit, t)}
                  noPrice={tCommon("notAvailable")}
                />
              ))}
            </TableBody>
          </Table>
        </TableScrollArea>
      )}

      {pageCount > 1 ? (
        <nav
          aria-label={tCommon("pagination.page")}
          className="flex items-center gap-3"
        >
          {page > 1 ? (
            <PageLink href={hrefFor({ page: page - 1 })}>
              {tCommon("pagination.first")}
            </PageLink>
          ) : null}
          <span className="text-sm text-muted-foreground tabular-nums">
            {tCommon("pagination.pageOf", { page, total: pageCount })}
          </span>
          {page < pageCount ? (
            <PageLink href={hrefFor({ page: page + 1 })}>
              {tCommon("pagination.last")}
            </PageLink>
          ) : null}
        </nav>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * One row.
 *
 * `data-modelled` plus the left accent are what make the split visible while
 * SCANNING rather than only while reading. The treatment is a recession, not an
 * alarm: a modelled unit is legitimate data doing a legitimate job, it simply
 * must never be mistaken for an offer. Colour is not carrying the meaning on
 * its own — the badge in the last column states it in words, and the accent is
 * a second, redundant channel.
 */
function UnitRow({
  unit,
  locale,
  labels,
  meanings,
  rowNote,
  statusLabel,
  noPrice,
}: {
  unit: InventoryUnit
  locale: Locale
  labels: UnitProvenanceLabels
  meanings: Record<UnitDataQuality, string>
  rowNote: string
  statusLabel: string
  noPrice: string
}) {
  const isModelled = unit.dataQuality === "modelled"
  const price = unit.askingPrice?.value ?? null

  return (
    <TableRow
      data-modelled={isModelled ? "" : undefined}
      className={cn(
        "border-l-2",
        isModelled
          ? "border-l-muted-foreground/30 bg-muted/20"
          : "border-l-confidence-confirmed"
      )}
    >
      <TableCell className="font-medium tabular-nums">
        {unit.unitNo || unit.id}
      </TableCell>
      <TableCell>{unit.blockName ?? unit.blockCode}</TableCell>
      <TableCell className="tabular-nums">{unit.layout}</TableCell>
      <TableCell className="text-right tabular-nums">
        {unit.interiorM2 === null ? (
          <span className="text-muted-foreground">{noPrice}</span>
        ) : (
          formatArea(unit.interiorM2, locale)
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {price === null ? (
          // A missing price is honest; a plausible-looking invented one is not
          // (SYSTEM-PROMPT §2.3). Never coerce to 0.
          <span className="text-muted-foreground">{noPrice}</span>
        ) : (
          // Rendered in its own currency, never converted (CONVENTIONS §5).
          <span className={cn(isModelled && "text-muted-foreground")}>
            {formatMoney(price, locale)}
          </span>
        )}
      </TableCell>
      <TableCell>{statusLabel}</TableCell>
      <TableCell>
        <UnitProvenanceBadge
          dataQuality={unit.dataQuality}
          labels={labels}
          {...(meanings[unit.dataQuality] !== undefined
            ? { description: meanings[unit.dataQuality] as string }
            : {})}
        />
        {isModelled ? <span className="sr-only"> — {rowNote}</span> : null}
      </TableCell>
    </TableRow>
  )
}

function statusLabelFor(
  unit: InventoryUnit,
  t: Awaited<ReturnType<typeof getTranslations>>
): string {
  const status = unit.saleStatus?.value ?? null
  if (status === "available") return t("status.available")
  if (status === "reserved") return t("status.reserved")
  if (status === "sold") return t("status.sold")
  return t("status.blocked")
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-sm transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:border-primary hover:text-foreground"
      )}
    >
      {children}
    </Link>
  )
}

function PageLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {children}
    </Link>
  )
}
