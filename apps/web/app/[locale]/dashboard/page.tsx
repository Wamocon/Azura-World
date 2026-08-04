import { setRequestLocale } from "next-intl/server"
import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"

import { getUserProfile } from "@/lib/auth"
import type { Locale, Role } from "@/lib/contracts"
import { getDashboardSnapshot } from "@/lib/dashboard-repository"
import type { DashboardSnapshot } from "@/lib/dashboard-data"
import { fill, shellCopy } from "@/lib/dashboard-home-copy"
import { AttentionList } from "@/components/dashboard/attention-list"
import { getAttentionItems } from "@/lib/attention-repository"
import { navGroupsForRole, routesForRole } from "@/lib/dashboard-routing"
import { WelcomePanel } from "@/components/dashboard/welcome-panel"

/**
 * Roles whose home is a welcome rather than a metric grid. See `WelcomePanel`
 * for why. Kept as a Set beside the KPI table so the two stay visibly adjacent:
 * adding a role here without removing its KPI row is harmless, but the reverse
 * — a role in neither — is the blank page this file already guards against.
 */
const WELCOME_ROLES: ReadonlySet<Role> = new Set<Role>([
  "guest",
  "child_owner",
  "child_tenant",
  "child_guest",
])

import { DashboardCharts } from "@/components/dashboard/dashboard-charts"
import { DashboardHomeLive } from "@/components/dashboard/home-live"
import {
  KpiCard,
  type KpiCardLabels,
  type KpiState,
} from "@/components/dashboard/kpi-card"
import {
  DashboardKpiGrid,
  DashboardPageHeader,
  DashboardSection,
} from "@/components/dashboard/section"
import { EmptyState } from "@/components/ui/empty-state"
import { intlLocaleTag } from "@/lib/format"

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
  // The manager's own working day, in the order they meet it: what is open,
  // what has missed its deadline, then the estate and the money.
  //
  // This used to lead with `unitsModelled` and carry `findings` and
  // `criticalFindings` — dataset-quality metrics that belong to whoever curates
  // the evidence, not to the person running the building. A manager opening
  // their home screen to "24 findings" learns nothing they can act on. The
  // analyst KPIs are still on the admin view, which is whose job they are.
  manager: [
    "openTickets",
    "overdueTickets",
    "unitsTotal",
    "ledgerEntries",
    "hotelRooms",
    "reviewSources",
  ],
  // Ledger first. No evidence access — `accountant` is level 60, below the
  // manager's 70, so `evidence:view` is not theirs (W1-B's matrix).
  accountant: ["ledgerEntries", "unitsTotal", "hotelRooms"],
  // Today's work.
  staff: ["openTickets", "overdueTickets", "unitsTotal", "hotelRooms"],
  //
  // ---- the resident and vendor views --------------------------------------
  //
  // Every list below used to end in `hotelRooms` and `reviewSources`, and for
  // the residents that was the whole card set. A tenant opened their home to
  // "Hotel rooms 188" and "Review platforms 3" — two facts about a hotel they
  // do not run and a set of review sites they will never read — beside a
  // greyed-out "Open tickets" that said their own maintenance requests were
  // "outside your role". None of the three helped anybody live in a flat.
  //
  // These now carry what the person actually came for. A site-wide unit count
  // is deliberately NOT among them: RLS narrows it to the public listings plus
  // the resident's own, which reads as "I have 23 apartments". Giving a resident
  // their own unit needs a scoped query, and that is the next build rather than
  // a number guessed at here.
  owner: ["openTickets", "ledgerEntries"],
  tenant: ["openTickets"],
  // Assigned work and what has run late on it. `service_provider ⊆ staff`, so
  // never more than staff. `hotelRooms` is gone: a contractor fixing a lift has
  // no use for the hotel's room count.
  service_provider: ["openTickets", "overdueTickets"],
  // A guest genuinely is a hotel guest, so the hotel figures are the ones that
  // belong to them. Thin by nature rather than by accident — the home page adds
  // a proper welcome for these roles instead of leaving white space.
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

  // What needs this person now. Read under the caller's own scope, so an item
  // can never appear here that its own page would refuse to show.
  const attention = await getAttentionItems({
    role: profile.role,
    id: profile.id,
  })

  const cards = KPIS_BY_ROLE[profile.role]
  const groups = navGroupsForRole(profile.role)

  // Four roles get a door rather than a dashboard. They hold no operational
  // metric of their own, so the KPI grid could only ever show them the two
  // panels they may read — "Hotel rooms 64", "Review sources 5" — which is a
  // true and useless answer to a question a hotel guest never asked.
  //
  // The cards are built from the routes this role actually holds, so the
  // welcome cannot advertise a page that would then refuse them.
  if (WELCOME_ROLES.has(profile.role)) {
    const welcomeCards = routesForRole(profile.role)
      .filter((route) => route.href !== "/dashboard")
      .map((route) => {
        const slug = route.href.replace("/dashboard/", "")
        return {
          href: route.href,
          slug,
          title: t.has(route.labelKey.replace("dashboard.", "") as "units.title")
            ? t(route.labelKey.replace("dashboard.", "") as "units.title")
            : slug,
          body: t(`welcome.cards.${slug}` as "welcome.cards.units"),
        }
      })

    return (
      <>
        <DashboardPageHeader
          title={t("shell.title")}
          description={fill(copy.homeSubtitleByRole, { role: profile.role })}
        />
        <WelcomePanel
          greeting={
            profile.fullName === null
              ? t("welcome.greetingAnonymous")
              : t("welcome.greeting", { name: profile.fullName })
          }
          lead={t(`welcome.lead.${profile.role}` as "welcome.lead.guest")}
          sectionTitle={t("welcome.sectionTitle")}
          cards={welcomeCards}
        />
      </>
    )
  }

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
        <EmptyState
          title={copy.noAccessTitle}
          description={copy.noAccessBody}
        />
      ) : (
        <div className="flex min-w-0 flex-col gap-8">
          {/* First, above the numbers. The counts below say how big things are;
              this says what to do about them, which is what somebody actually
              opens their home page for. See `lib/attention-repository.ts`. */}
          <AttentionList
            rows={attention.items.map((item) => ({
              key: item.key,
              tone: item.tone,
              message: t(
                `attention.items.${item.messageKey}` as "attention.items.slaBreached",
                item.values
              ),
              href: item.href,
              linkLabel: t("attention.open"),
            }))}
            labels={{
              heading: t("attention.heading"),
              empty: t("attention.empty"),
              emptyHint: t("attention.emptyHint"),
              degraded: t("attention.degraded"),
            }}
            degraded={attention.degraded}
          />

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

          {/* Charts from the SAME snapshot the KPIs read. Each renders only when
              the role may see its panel (the snapshot nulls the rest), so a
              tenant never sees the tickets chart. First real consumer of the
              chart library. */}
          <DashboardCharts
            snapshot={snapshot}
            locale={locale as Locale}
            labels={{
              title: t("charts.title"),
              ticketsTitle: t("charts.ticketsTitle"),
              ticketsBasis: t("charts.ticketsBasis"),
              ticketsTotal: t("charts.ticketsTotal"),
              qualityTitle: t("charts.qualityTitle"),
              qualityBasis: t("charts.qualityBasis"),
              empty: t("charts.empty"),
              tableCategory: t("charts.tableCategory"),
              tableCount: t("charts.tableCount"),
              qualityReal: t("charts.qualityReal"),
              qualityModelled: t("charts.qualityModelled"),
              qualityOfficial: t("charts.qualityOfficial"),
              qualityGap: t("charts.qualityGap"),
              statusLabel: (status: string) =>
                t(`tickets.status.${status}`),
            }}
          />
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------

/** Which snapshot panel each card reads, so restricted/failed can be resolved. */
const PANEL_FOR_KPI: Record<
  KpiId,
  keyof Pick<
    DashboardSnapshot,
    "inventory" | "operations" | "finance" | "evidence" | "hotel"
  >
> = {
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
  locale: Locale
): { label: string; value: number | null; hint?: string } {
  const number = (value: number) => new Intl.NumberFormat(intlLocaleTag(locale)).format(value)

  switch (id) {
    case "unitsTotal":
      return {
        label: copy.kpiUnitsTotal,
        value: snapshot.inventory?.totalUnits ?? null,
      }

    case "unitsModelled": {
      const inventory = snapshot.inventory
      return {
        label: copy.kpiUnitsModelled,
        value: inventory?.modelledUnits ?? null,
        // 631 of 656 are modelled. Naming the denominator beside the number is
        // what stops it reading as a small exception.
        ...(inventory === null ||
        inventory === undefined ||
        inventory.totalUnits === null
          ? {}
          : {
              hint: `${number(inventory.modelledUnits)} / ${number(inventory.totalUnits)}`,
            }),
      }
    }

    case "unitsPortal":
      return {
        label: copy.kpiUnitsPortal,
        value: snapshot.inventory?.portalListingUnits ?? null,
      }

    case "openTickets":
      return {
        label: copy.kpiOpenTickets,
        value: snapshot.operations?.openTickets ?? null,
      }

    case "overdueTickets":
      return {
        label: copy.kpiOverdueTickets,
        value: snapshot.operations?.overdueTickets ?? null,
      }

    case "findings":
      return {
        label: copy.kpiFindings,
        value: snapshot.evidence?.totalFindings ?? null,
      }

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
      return {
        label: copy.kpiSourcesValidated,
        value: snapshot.evidence?.totalSources ?? null,
      }

    case "hotelRooms":
      return {
        label: copy.kpiHotelRooms,
        value: snapshot.hotel?.roomCount ?? null,
      }

    case "reviewSources":
      return {
        label: copy.kpiReviewSources,
        value: snapshot.hotel?.reviewSourceCount ?? null,
      }

    case "ledgerEntries":
      return {
        label: copy.kpiLedgerEntries,
        value: snapshot.finance?.totalEntries ?? null,
      }
  }
}
