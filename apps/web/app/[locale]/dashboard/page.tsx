import { setRequestLocale } from "next-intl/server"
import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"

import { getUserProfile } from "@/lib/auth"
import type { Locale, Role } from "@/lib/contracts"
import { getDashboardSnapshot } from "@/lib/dashboard-repository"
import type { DashboardSnapshot } from "@/lib/dashboard-data"
import { fill, shellCopy } from "@/lib/dashboard-home-copy"
import { navGroupsForRole } from "@/lib/dashboard-routing"

import { DashboardHomeLive } from "@/components/dashboard/home-live"
import { KpiCard, type KpiCardLabels, type KpiState } from "@/components/dashboard/kpi-card"
import {
  DashboardKpiGrid,
  DashboardPageHeader,
  DashboardSection,
} from "@/components/dashboard/section"
import { EmptyState } from "@/components/ui/empty-state"

/**
 * The role-aware home.                                     Owner: W3-B
 *
 * A Server Component. `getDashboardSnapshot()` is a W2-A repository and
 * therefore server-only; the freshness badge and the poll live in
 * `DashboardHomeLive`, which explains why in its own header.
 *
 * NO RENDERING-MODE EXPORT — W-INT §4. The root layout's `headers()` read
 * already makes this dynamic.
 *
 * WHICH CARDS A ROLE SEES IS AN EXHAUSTIVE `Record<Role, …>`, NOT AN IF-CHAIN.
 * The 1Çatı reference branches every less-privileged role out above a default
 * that falls through to the admin surface — so a role added to the matrix and
 * forgotten here lands on the *most* privileged screen. That fails open. A
 * `Record<Role, …>` makes the same omission a compile error, and the eleven
 * roles are frozen in CONTRACTS §3 so the map can be complete.
 *
 * The data is the same snapshot for everyone; `getDashboardSnapshot()` already
 * scopes it by role and reports what it withheld in `restrictedPanels`. This
 * map decides *which cards to offer*, and a card whose panel was restricted
 * renders its restricted state rather than vanishing — an absent card is
 * indistinguishable from a broken one.
 */

/** The KPI cards this role is offered, in order. */
type KpiId =
  | "unitsTotal"
  | "unitsModelled"
  | "unitsPortal"
  | "openTickets"
  | "overdueTickets"
  | "findings"
  | "criticalFindings"
  | "factGaps"
  | "sourcesValidated"
  | "hotelRooms"
  | "reviewSources"
  | "ledgerEntries"

/**
 * Exhaustive. Adding a twelfth role to CONTRACTS §3 breaks this line, which is
 * the point — the alternative is a new role silently inheriting whatever the
 * fallback happens to be.
 */
const KPIS_BY_ROLE: Record<Role, readonly KpiId[]> = {
  // Everything. The evidence figures first: system health for this product is
  // the state of its evidence, not its uptime.
  admin: [
    "findings",
    "criticalFindings",
    "factGaps",
    "sourcesValidated",
    "unitsTotal",
    "unitsModelled",
    "unitsPortal",
    "openTickets",
    "overdueTickets",
    "ledgerEntries",
    "hotelRooms",
    "reviewSources",
  ],
  // Site KPIs, availability, open tickets, conflicts needing review.
  manager: [
    "unitsTotal",
    "unitsModelled",
    "openTickets",
    "overdueTickets",
    "findings",
    "criticalFindings",
    "hotelRooms",
  ],
  // Ledger first. No evidence access — `accountant` is level 60, below the
  // manager's 70, so `evidence:view` is not theirs (W1-B's matrix).
  accountant: ["ledgerEntries", "unitsTotal", "hotelRooms"],
  // Today's work.
  staff: ["openTickets", "overdueTickets", "unitsTotal", "hotelRooms"],
  // The public showcase plus what an owner can see of the inventory.
  owner: ["unitsTotal", "openTickets", "hotelRooms", "reviewSources"],
  tenant: ["openTickets", "hotelRooms", "reviewSources"],
  // Assigned work only. `service_provider ⊆ staff`, so never more than staff.
  service_provider: ["openTickets", "hotelRooms"],
  // Public information only.
  guest: ["hotelRooms", "reviewSources"],
  // A read-only subset of the guardian's view, per CONTRACTS §3's
  // additive-authority rule. Never a superset of the parent.
  child_owner: ["hotelRooms", "reviewSources"],
  child_tenant: ["hotelRooms", "reviewSources"],
  child_guest: ["hotelRooms"],
}

export default async function DashboardHomePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const profile = await getUserProfile()
  const copy = shellCopy(locale)
  const t = await getTranslations({ locale, namespace: "dashboard" })

  const result = await getDashboardSnapshot({
    role: profile.role,
    ...(profile.id === null ? {} : { profileId: profile.id }),
  })
  const snapshot = result.data

  const kpiLabels: KpiCardLabels = {
    restricted: copy.panelRestricted,
    restrictedHint: copy.panelRestrictedHint,
    failed: copy.panelFailed,
    failedHint: copy.panelFailedHint,
    truncated: copy.panelTruncated,
    retry: copy.retry,
  }

  const cards = KPIS_BY_ROLE[profile.role]
  const groups = navGroupsForRole(profile.role)

  return (
    <>
      <DashboardPageHeader
        title={t("shell.title")}
        description={fill(copy.homeSubtitleByRole, { role: profile.role })}
        meta={
          <DashboardHomeLive
            source={result.source}
            fetchedAt={result.fetchedAt}
            locale={locale as Locale}
            refreshLabel={copy.refresh}
          />
        }
      />

      {/* A role with nothing at all is a supported state, not a bug. No role in
          the current matrix reaches it — `child_guest` holds seven resources —
          but a matrix edit could, and a blank page would read as a crash. */}
      {groups.length === 0 ? (
        <EmptyState title={copy.noAccessTitle} description={copy.noAccessBody} />
      ) : (
        <div className="flex min-w-0 flex-col gap-8">
          <DashboardSection title={t("kpi.title")}>
            <DashboardKpiGrid>
              {cards.map((id) => (
                <Kpi
                  key={id}
                  id={id}
                  snapshot={snapshot}
                  labels={kpiLabels}
                  copy={copy}
                  locale={locale as Locale}
                />
              ))}
            </DashboardKpiGrid>
          </DashboardSection>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------

/** Which snapshot panel each card reads, so restricted/failed can be resolved. */
const PANEL_FOR_KPI: Record<KpiId, keyof Pick<
  DashboardSnapshot,
  "inventory" | "operations" | "finance" | "evidence" | "hotel"
>> = {
  unitsTotal: "inventory",
  unitsModelled: "inventory",
  unitsPortal: "inventory",
  openTickets: "operations",
  overdueTickets: "operations",
  findings: "evidence",
  criticalFindings: "evidence",
  factGaps: "evidence",
  sourcesValidated: "evidence",
  hotelRooms: "hotel",
  reviewSources: "hotel",
  ledgerEntries: "finance",
}

function Kpi({
  id,
  snapshot,
  labels,
  copy,
  locale,
}: {
  id: KpiId
  snapshot: DashboardSnapshot
  labels: KpiCardLabels
  copy: ReturnType<typeof shellCopy>
  locale: Locale
}): ReactNode {
  const panel = PANEL_FOR_KPI[id]

  /**
   * The three ways a panel can be absent, kept apart.
   *
   * `restrictedPanels` first: a role that may not see finance should read
   * "not available for your role", not "did not load". Telling someone a
   * deliberate scoping decision was a failure invites a support ticket for a
   * system working exactly as designed.
   */
  const state: KpiState = snapshot.restrictedPanels.includes(panel)
    ? "restricted"
    : snapshot.failedPanels.includes(panel)
      ? "failed"
      : "ready"

  const truncated = snapshot.truncatedPanels.includes(panel)

  const { label, value, hint } = resolveKpi(id, snapshot, copy, locale)

  return (
    <KpiCard
      kind="count"
      label={label}
      state={state}
      value={value}
      labels={labels}
      locale={locale}
      truncated={truncated}
      {...(hint === undefined ? {} : { hint })}
    />
  )
}

/**
 * Reads one figure out of the snapshot.
 *
 * Every arm returns `null` rather than `0` when the panel is absent.
 * `unitsTotal` of `null` means "not counted"; `0` would mean "there are no
 * units", and those are different claims. `KpiCard` renders `null` as "—".
 *
 * These are `kind: "count"` rather than `kind: "fact"` on purpose: how many
 * findings the dataset contains is a property of the dataset, not a sourced
 * claim about the world, and dressing it in provenance it does not have would
 * be the same category error in the other direction.
 */
function resolveKpi(
  id: KpiId,
  snapshot: DashboardSnapshot,
  copy: ReturnType<typeof shellCopy>,
  locale: Locale,
): { label: string; value: number | null; hint?: string } {
  const number = (value: number) => new Intl.NumberFormat(locale).format(value)

  switch (id) {
    case "unitsTotal":
      return { label: copy.kpiUnitsTotal, value: snapshot.inventory?.totalUnits ?? null }

    case "unitsModelled": {
      const inventory = snapshot.inventory
      return {
        label: copy.kpiUnitsModelled,
        value: inventory?.modelledUnits ?? null,
        // 631 of 656 are modelled. Naming the denominator beside the number is
        // what stops it reading as a small exception.
        ...(inventory === null || inventory === undefined || inventory.totalUnits === null
          ? {}
          : { hint: `${number(inventory.modelledUnits)} / ${number(inventory.totalUnits)}` }),
      }
    }

    case "unitsPortal":
      return {
        label: copy.kpiUnitsPortal,
        value: snapshot.inventory?.portalListingUnits ?? null,
      }

    case "openTickets":
      return { label: copy.kpiOpenTickets, value: snapshot.operations?.totalTickets ?? null }

    case "overdueTickets":
      return {
        label: copy.kpiOverdueTickets,
        value: snapshot.operations?.overdueTickets ?? null,
      }

    case "findings":
      return { label: copy.kpiFindings, value: snapshot.evidence?.totalFindings ?? null }

    case "criticalFindings":
      return {
        label: copy.kpiCriticalFindings,
        value: snapshot.evidence?.findingsBySeverity["critical"] ?? null,
      }

    case "factGaps":
      return {
        label: copy.kpiFactGaps,
        value: snapshot.evidence?.factsByConfidence["gap"] ?? null,
        ...(snapshot.evidence?.totalFacts == null
          ? {}
          : { hint: `/ ${number(snapshot.evidence.totalFacts)}` }),
      }

    case "sourcesValidated":
      return { label: copy.kpiSourcesValidated, value: snapshot.evidence?.totalSources ?? null }

    case "hotelRooms":
      return { label: copy.kpiHotelRooms, value: snapshot.hotel?.roomCount ?? null }

    case "reviewSources":
      return {
        label: copy.kpiReviewSources,
        value: snapshot.hotel?.reviewSourceCount ?? null,
      }

    case "ledgerEntries":
      return { label: copy.kpiLedgerEntries, value: snapshot.finance?.totalEntries ?? null }
  }
}
