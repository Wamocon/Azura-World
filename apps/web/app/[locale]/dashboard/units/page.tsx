import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"

import { Link } from "@/app/navigation"
import { getUserProfile } from "@/lib/auth"
import { hasPermission } from "@/lib/rbac"
import type { Locale } from "@/lib/contracts"
import { formatArea, formatMoney } from "@/lib/format"
import {
  getAvailabilityRollup,
  getUnits,
  type InventoryUnit,
} from "@/lib/inventory-repository"
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
 * ## What this page is, after the pivot
 *
 * The client's apartment inventory: 656 rows, paged, sorted, filterable by the
 * things a property manager cares about.
 *
 * It used to be the honesty control for the whole module — it rendered the
 * `modelled` vs `portal_listing` split three ways, in a header, a `Herkunft`
 * column and a row accent. `PIVOT.md` §4 removes all three: *"for a pitch, all
 * 656 units are simply the client's inventory."* `dataQuality` still arrives on
 * every row from the repository and is no longer read here. Pass 2 decides
 * whether it stays in the model at all.
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

/** `?page=` is 1-based for humans; the repository takes a 0-based offset. */
function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value
  const n = Number.parseInt(raw ?? "1", 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
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

  const page = parsePage(query["page"])
  const offset = (page - 1) * PAGE_SIZE

  const [rollupResult, unitsResult] = await Promise.all([
    getAvailabilityRollup(scope),
    getUnits({
      ...scope,
      limit: PAGE_SIZE,
      offset,
    }),
  ])

  const rollup = rollupResult.data
  const units = unitsResult.data
  const degraded =
    rollupResult.source === "local-seed" || unitsResult.source === "local-seed"

  const total = rollup.totalUnits

  const filteredTotal = total
  const pageCount = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE))
  const from = filteredTotal === 0 ? 0 : offset + 1
  const to = Math.min(offset + units.length, filteredTotal)

  const hrefFor = (next: { page?: number }) => {
    const sp = new URLSearchParams()
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

      {/* PIVOT P2 §4: the inventory split summary and the provenance filter are
          gone. All 656 units are the client's inventory here; `dataQuality` is
          untouched in the database and in the repository, it is simply not a
          thing this screen talks about any more. */}

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
              </TableRow>
            </TableHeader>
            <TableBody>
              {units.map((unit) => (
                <UnitRow
                  key={unit.id}
                  unit={unit}
                  locale={locale}
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
 * PIVOT P2 §4: the provenance column, the `data-modelled` attribute and the row
 * accent are gone. Every row is one of the client's apartments and is drawn the
 * same way. `unit.dataQuality` still arrives on the object and is simply not
 * read here.
 *
 * A missing area or price still renders "Keine Angabe" rather than a blank or a
 * zero. That is not a provenance affordance, it is not inventing a number, and
 * the pivot does not touch it.
 */
function UnitRow({
  unit,
  locale,
  statusLabel,
  noPrice,
}: {
  unit: InventoryUnit
  locale: Locale
  statusLabel: string
  noPrice: string
}) {
  const price = unit.askingPrice?.value ?? null

  return (
    <TableRow>
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
          formatMoney(price, locale)
        )}
      </TableCell>
      <TableCell>{statusLabel}</TableCell>
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
