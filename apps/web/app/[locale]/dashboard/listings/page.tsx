import { getTranslations } from "next-intl/server"

import { dataNoteLabels } from "@/components/evidence/data-note"
import type { Metadata } from "next"

import { Link } from "@/app/navigation"
import {
  applyFilter,
  bandsByCurrency,
  blamedFilter,
  buildComparison,
  groupByPublisher,
  type ListingFilter,
} from "@/components/inventory/listing-analysis"
import { ListingPriceComparison } from "@/components/inventory/listing-price-comparison"
import {
  buildClaimRows,
  PortalClaimMatrix,
  type ClaimColumn,
} from "@/components/inventory/portal-claim-matrix"
import { PublisherListingGroup } from "@/components/inventory/publisher-listing-group"
import { getUserProfile } from "@/lib/auth"
import { cn } from "@/lib/cn"
import type { Locale, UnitLayout } from "@/lib/contracts"
import { getFactsForEntity } from "@/lib/evidence-repository"
import { getPortalListings } from "@/lib/portal-repository"
import { hasPermission } from "@/lib/rbac"
import { intlLocaleTag } from "@/lib/format"

/**
 * /[locale]/dashboard/listings — the portal register.        Owner: W3-C / N1
 *
 * ## Why this page carries an acceptance criterion
 *
 * INTERNAL-107 acceptance criterion 3 is *"Informationen aus Immobilien-Portalen
 * einbeziehen"*. This is that screen. Everything else in the inventory module
 * describes the building; this describes **what other people publish about it**,
 * and the whole value of the exercise is that they do not agree.
 *
 * ## The order of the sections is the argument
 *
 *   1. what was collected — 47 rows, 7 publishers, 2 currencies, 18 stale;
 *   2. the same apartment across publishers, side by side, prices as published;
 *   3. what each publisher claims about the building itself;
 *   4. every row, grouped by who published it.
 *
 * The comparison sits above the register on purpose. A reader who meets the
 * 47 rows first reads them as a price list; a reader who meets the disagreement
 * first reads them as evidence.
 *
 * ## One fetch, several sections
 *
 * The whole register is 47 rows, so the page fetches it once and derives every
 * section from that array in memory. A query per section would let two sections
 * disagree with each other if a harvest landed mid-render, and the counts on this
 * page are the point of it.
 *
 * ## No client component, no JavaScript of its own
 *
 * Filters are links and the page reads `searchParams`, exactly as
 * `dashboard/units` does. It cannot be broken by the S-009 CSP class, it works
 * with JS off, and there is no hydration boundary between a price and its
 * caveat. No `export const dynamic`: W-INT §4 made the root layout read
 * `headers()`, so every route beneath it is already dynamic, and adding
 * `force-static` here would ship a page with zero working JavaScript.
 */

export const metadata: Metadata = {
  title: "Portal-Inserate",
  robots: { index: false, follow: false },
}

/** The project entity the structural facts hang off. */
const PROJECT_ENTITY_ID = "AZW-TRK"

/**
 * Layouts offered in the comparison switcher.
 *
 * Not every member of `UnitLayout` — only the ones some publisher actually
 * quotes. A chip for `president_villa` that always lands on an empty state
 * teaches a reader that the page is broken rather than that nobody lists one.
 */
const COMPARABLE_LAYOUTS: readonly UnitLayout[] = [
  "1+1",
  "2+1",
  "3+1",
  "4+1",
  "5+1",
]

/**
 * The layout the comparison opens on.
 *
 * 1+1 because that is F-002: four publishers, four prices, one of them in
 * dollars. It is the cheapest layout and therefore the one a reader is most
 * likely to quote, which makes it the one that most needs its caveats attached.
 */
const DEFAULT_LAYOUT: UnitLayout = "1+1"

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function isLayout(value: string | undefined): value is UnitLayout {
  return value !== undefined && (COMPARABLE_LAYOUTS as string[]).includes(value)
}

export default async function ListingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale } = await params
  const query = await searchParams

  const t = await getTranslations({ locale, namespace: "dashboard.listings" })
  const tCommon = await getTranslations({ locale, namespace: "common" })
  // Root namespace: `dataNote.*` is shared, not page-scoped.
  const tRoot = await getTranslations({ locale })

  const profile = await getUserProfile()

  // Re-checked in the page body even though the nav hides the entry and the
  // client guard already ran. CONVENTIONS §2: assume the user typed the URL.
  // This is also the SEC-003 lesson from the evidence cockpit — the client guard
  // decides after this Server Component has already rendered into the RSC
  // payload, so a refusal that happens only there still ships the data.
  if (!hasPermission(profile.role, "listings:view")) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.018em] text-foreground">
          {t("title")}
        </h1>
        <p role="alert" className="max-w-prose text-sm text-muted-foreground">
          {tCommon("errors.forbidden")}
        </p>
      </div>
    )
  }

  // The whole register in one call. 47 rows today; the ceiling is a guard.
  const [listingsResult, factsResult] = await Promise.all([
    getPortalListings({ limit: 500 }),
    getFactsForEntity("project", PROJECT_ENTITY_ID),
  ])

  const all = listingsResult.data
  const degraded =
    listingsResult.source === "local-seed" ||
    factsResult.source === "local-seed"

  // ---- filter state ------------------------------------------------------
  const publisherParam = first(query["publisher"])
  const layoutParam = first(query["layout"])
  const kindParam = first(query["kind"])
  const staleParam = first(query["stale"])

  const knownPublishers = [...new Set(all.map((row) => row.publisher))].sort(
    (a, b) => a.localeCompare(b)
  )
  const activePublisher =
    publisherParam !== undefined && knownPublishers.includes(publisherParam)
      ? publisherParam
      : undefined
  const activeKind =
    kindParam === "sale" || kindParam === "rent" ? kindParam : undefined
  const staleOnly = staleParam === "1"

  const filter: ListingFilter = {
    ...(activePublisher !== undefined ? { publisher: activePublisher } : {}),
    ...(activeKind !== undefined ? { priceKind: activeKind } : {}),
    ...(staleOnly ? { staleOnly: true } : {}),
  }
  const filtered = applyFilter(all, filter)
  const groups = groupByPublisher(filtered)

  // ---- the comparison ----------------------------------------------------
  // Sale only. A monthly rent of €1 000 inside a sale series is wrong by two
  // orders of magnitude and would make it the cheapest "1+1 for sale" on screen.
  const comparisonLayout = isLayout(layoutParam) ? layoutParam : DEFAULT_LAYOUT
  const saleRows = all.filter((row) => row.priceKind === "sale")
  const comparisonRows = saleRows.filter(
    (row) => row.layout === comparisonLayout
  )
  const comparison = buildComparison(comparisonRows)

  // Rows whose publisher stated a price but no layout at all. Kept as a separate
  // band rather than dropped: Alanya-Home's entry price is one of the four
  // figures F-002 names, and filtering strictly by layout would delete it from
  // the one view built to show it.
  const unstatedLayoutRows = saleRows.filter((row) => row.layout === null)
  const unstatedComparison = buildComparison(unstatedLayoutRows)

  // ---- headline counts ---------------------------------------------------
  // Counts of what THIS harvest collected, not claims about the market. The
  // copy says so; "47 Inserate" with no qualifier would read as "47 apartments
  // are for sale", which is a different and unsupported statement.
  const staleTotal = all.filter((row) => row.isStale).length
  const currencyTotal = new Set(
    all.flatMap((row) => (row.price === null ? [] : [row.price.currency]))
  ).size
  const { withoutPrice } = bandsByCurrency(all)

  // ---- the claim matrix --------------------------------------------------
  const claimColumns: ClaimColumn[] = [
    { path: "project.residenceBlockCount", header: t("claims.blocks") },
    { path: "project.totalUnits", header: t("claims.units") },
    { path: "project.buildStatus", header: t("claims.buildStatus") },
  ]
  const claimRows = buildClaimRows(factsResult.data, claimColumns)

  // A publisher's raw claim, rendered. Anything this does not recognise falls
  // back to "Keine Angabe" rather than printing a raw enum member at a reader:
  // a stored value the UI has no word for is a gap in the UI, and saying so is
  // better than showing `under_construction` to a property manager.
  const formatClaimValue = (path: string, value: unknown): string => {
    if (path === "project.buildStatus") {
      if (value === "completed") return t("buildStatus.completed")
      if (value === "under_construction")
        return t("buildStatus.underConstruction")
      if (value === "planned") return t("buildStatus.planned")
      return t("claims.notStated")
    }
    if (typeof value === "number") {
      return new Intl.NumberFormat(intlLocaleTag(locale)).format(value)
    }
    return typeof value === "string" && value.length > 0
      ? value
      : t("claims.notStated")
  }

  // ---- href helper -------------------------------------------------------
  const hrefFor = (next: {
    publisher?: string | null
    layout?: UnitLayout
    kind?: "sale" | "rent" | null
    stale?: boolean
    clear?: true
  }) => {
    const sp = new URLSearchParams()
    if (next.clear !== true) {
      const publisher =
        next.publisher === undefined
          ? activePublisher
          : (next.publisher ?? undefined)
      if (publisher !== undefined) sp.set("publisher", publisher)

      const kind =
        next.kind === undefined ? activeKind : (next.kind ?? undefined)
      if (kind !== undefined) sp.set("kind", kind)

      const stale = next.stale ?? staleOnly
      if (stale) sp.set("stale", "1")
    }
    const layout = next.layout ?? comparisonLayout
    if (layout !== DEFAULT_LAYOUT) sp.set("layout", layout)

    const s = sp.toString()
    return `/dashboard/listings${s ? `?${s}` : ""}`
  }

  const blamed = filtered.length === 0 ? blamedFilter(all, filter) : null
  // An exhaustive record rather than a template-built key. A `Record` keyed by
  // `keyof ListingFilter` makes a filter added later a compile error here, which
  // is the difference between "the empty state names the wrong filter" being
  // caught at build time and being discovered by a user staring at a blank list.
  const emptyByFilter: Record<
    NonNullable<ReturnType<typeof blamedFilter>>,
    string
  > = {
    publisher: t("register.emptyBy.publisher"),
    priceKind: t("register.emptyBy.priceKind"),
    staleOnly: t("register.emptyBy.staleOnly"),
  }

  const comparisonLabels = {
    publisher: t("columns.portal"),
    price: t("columns.price"),
    count: t("compare.countHeader"),
    notComparable: t("compare.notComparable"),
    spread: t("compare.spread"),
    singlePrice: t("compare.singlePrice"),
    stale: t("stale.badge"),
    staleReason: t("stale.reason"),
    listingCount: t("compare.listingCount"),
    upTo: t("compare.upTo"),
    openListing: t("openListing"),
    caption: t("compare.caption"),
  }

  const groupLabels = {
    // Raw dataset notes are English analyst prose. `DataNote` classifies and
    // translates them; the original stays behind a disclosure.
    dataNote: dataNoteLabels(tRoot),
    price: t("columns.price"),
    layout: t("columns.layout"),
    area: t("columns.area"),
    kind: t("columns.kind"),
    fetchedAt: t("columns.observedAt"),
    source: t("columns.source"),
    layoutUnstated: t("unstated.layout"),
    areaUnstated: t("unstated.area"),
    priceUnstated: t("unstated.price"),
    kindSale: t("kind.sale"),
    kindRent: t("kind.rent"),
    kindUnknown: t("kind.unknown"),
    stale: t("stale.badge"),
    staleReason: t("stale.reason"),
    note: t("group.note"),
    openListing: t("openListing"),
    caption: t("group.caption"),
    listingCount: t("group.listingCount"),
    pageCount: t("group.pageCount"),
    staleCount: t("group.staleCount"),
    rentCount: t("group.rentCount"),
    lastFetched: t("group.lastFetched"),
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.018em] text-foreground">
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
          {t("seedNotice")}
        </p>
      ) : null}

      {/* ---- 1. what was collected --------------------------------------- */}
      <section
        aria-labelledby="listings-overview"
        className="flex flex-col gap-3"
      >
        <h2
          id="listings-overview"
          className="font-display text-lg font-semibold tracking-[-0.012em] text-foreground"
        >
          {t("overview.heading")}
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label={t("overview.listings")}
            value={all.length}
            locale={locale}
          />
          <Stat
            label={t("overview.publishers")}
            value={knownPublishers.length}
            locale={locale}
          />
          <Stat
            label={t("overview.currencies")}
            value={currencyTotal}
            locale={locale}
          />
          <Stat
            label={t("overview.stale")}
            value={staleTotal}
            locale={locale}
            tone="stale"
          />
        </dl>
        <p className="max-w-prose text-sm text-muted-foreground">
          {t("overview.caveat")}
        </p>
        {withoutPrice > 0 ? (
          <p className="max-w-prose text-sm text-muted-foreground">
            {t("overview.withoutPrice", { count: withoutPrice })}
          </p>
        ) : null}
      </section>

      {/* ---- 2. the comparison ------------------------------------------- */}
      <section
        aria-labelledby="listings-compare"
        className="flex flex-col gap-3"
      >
        <div className="flex flex-col gap-1.5">
          <h2
            id="listings-compare"
            className="font-display text-lg font-semibold tracking-[-0.012em] text-foreground"
          >
            {t("compare.heading")}
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {t("compare.lead")}
          </p>
        </div>

        <nav
          aria-label={t("compare.layoutFilterLabel")}
          className="flex flex-wrap items-center gap-2"
        >
          {COMPARABLE_LAYOUTS.map((layout) => (
            <Chip
              key={layout}
              href={hrefFor({ layout })}
              active={layout === comparisonLayout}
            >
              {layout}
            </Chip>
          ))}
        </nav>

        {comparison.length === 0 ? (
          <p className="rounded-lg border border-border bg-background/50 p-6 text-sm text-muted-foreground">
            {t("compare.empty", { layout: comparisonLayout })}
          </p>
        ) : (
          <ListingPriceComparison
            columns={comparison}
            locale={locale}
            labels={comparisonLabels}
          />
        )}

        {unstatedComparison.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              {t("compare.unstatedHeading")}
            </h3>
            <p className="max-w-prose text-sm text-muted-foreground">
              {t("compare.unstatedLead")}
            </p>
            <ListingPriceComparison
              columns={unstatedComparison}
              locale={locale}
              labels={comparisonLabels}
              // No spread here. These rows have no layout for two different
              // reasons - a "from" price for the whole project, and an
              // apartment whose page says "5+ rooms" - so a ratio across them
              // would compare an entry price with a 305 m2 penthouse.
              showSpread={false}
            />
          </div>
        ) : null}

        {/* The finding's own wording, attributed, never recomputed here.
            F-002 used to headline a 2.1x spread that divided a dollar price by
            a euro one, and this note existed to warn the reader about it
            (MANUAL-TEST-REPORT M-003). F2 rewrote the finding to state its
            range per currency and to scope its ratio to EUR, so the note now
            says that instead. A caveat about a claim that no longer exists is
            its own small inaccuracy. */}
        <p className="max-w-prose rounded-lg border border-confidence-conflicted/30 bg-confidence-conflicted/[0.07] px-3 py-2.5 text-sm text-foreground">
          {t("compare.findingNote")}
        </p>
      </section>

      {/* ---- 3. what each publisher claims -------------------------------- */}
      <section
        aria-labelledby="listings-claims"
        className="flex flex-col gap-3"
      >
        <div className="flex flex-col gap-1.5">
          <h2
            id="listings-claims"
            className="font-display text-lg font-semibold tracking-[-0.012em] text-foreground"
          >
            {t("claims.heading")}
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {t("claims.lead")}
          </p>
        </div>

        {claimRows.length === 0 ? (
          <p className="rounded-lg border border-border bg-background/50 p-6 text-sm text-muted-foreground">
            {t("claims.empty")}
          </p>
        ) : (
          <div className="rounded-xl border border-border bg-card px-4 py-3 sm:px-5">
            <PortalClaimMatrix
              rows={claimRows}
              columns={claimColumns}
              locale={locale}
              formatValue={formatClaimValue}
              labels={{
                publisher: t("columns.portal"),
                notStated: t("claims.notStated"),
                dissenting: t("claims.dissenting"),
                openSource: t("openSource"),
                caption: t("claims.caption"),
                tier: {
                  "1": t("tier.official"),
                  "2": t("tier.developer"),
                  "3": t("tier.hotel"),
                  "4": t("tier.portal"),
                  "5": t("tier.review"),
                  "6": t("tier.press"),
                },
              }}
            />
          </div>
        )}

        {/* The harvest gap, stated. Three empty columns would have read as
            "no portal claims anything", which is not what the data says. */}
        <p className="max-w-prose text-sm text-muted-foreground">
          {t("claims.harvestGap")}
        </p>
      </section>

      {/* ---- 4. the register --------------------------------------------- */}
      <section
        aria-labelledby="listings-register"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1.5">
          <h2
            id="listings-register"
            className="font-display text-lg font-semibold tracking-[-0.012em] text-foreground"
          >
            {t("register.heading")}
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {t("register.lead")}
          </p>
        </div>

        <nav
          aria-label={t("register.filterLabel")}
          className="flex flex-wrap items-center gap-2"
        >
          <Chip
            href={hrefFor({ clear: true })}
            active={
              activePublisher === undefined &&
              activeKind === undefined &&
              !staleOnly
            }
          >
            {t("register.filterAll")}
          </Chip>
          {knownPublishers.map((publisher) => (
            <Chip
              key={publisher}
              href={hrefFor({
                publisher: activePublisher === publisher ? null : publisher,
              })}
              active={activePublisher === publisher}
            >
              {publisher}
            </Chip>
          ))}
          <Chip
            href={hrefFor({ kind: activeKind === "sale" ? null : "sale" })}
            active={activeKind === "sale"}
          >
            {t("kind.sale")}
          </Chip>
          <Chip
            href={hrefFor({ kind: activeKind === "rent" ? null : "rent" })}
            active={activeKind === "rent"}
          >
            {t("kind.rent")}
          </Chip>
          <Chip href={hrefFor({ stale: !staleOnly })} active={staleOnly}>
            {t("register.filterStale")}
          </Chip>
        </nav>

        {filtered.length === 0 ? (
          <div
            role="status"
            className="flex flex-col items-start gap-3 rounded-xl border border-border bg-background/50 p-6"
          >
            <p className="max-w-prose text-sm text-foreground">
              {blamed === null
                ? t("register.emptyCombination")
                : emptyByFilter[blamed]}
            </p>
            <Link
              href={hrefFor({ clear: true })}
              className="inline-flex min-h-9 items-center rounded-lg border border-primary bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {t("register.clearFilters")}
            </Link>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground tabular-nums">
              {t("register.showing", {
                shown: filtered.length,
                total: all.length,
              })}
            </p>
            <div className="flex flex-col gap-5">
              {groups.map((group) => (
                <PublisherListingGroup
                  key={group.publisher}
                  group={group}
                  locale={locale}
                  labels={groupLabels}
                />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * One headline count.
 *
 * A count of rows this project collected is not a `SourcedFact` and does not get
 * a provenance chip: its source is the harvest itself, which the section's copy
 * names. What it must never do is read as a claim about the market, which is why
 * `overview.caveat` sits directly beneath the row.
 */
function Stat({
  label,
  value,
  locale,
  tone,
}: {
  label: string
  value: number
  locale: Locale
  tone?: "stale"
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 rounded-lg border px-3 py-2.5",
        tone === "stale"
          ? "border-quality-stale/30 bg-quality-stale/[0.06]"
          : "border-border bg-card"
      )}
    >
      <dt className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        data-numeric
        className={cn(
          "font-display text-2xl font-semibold tracking-[-0.018em] tabular-nums",
          tone === "stale" ? "text-quality-stale" : "text-foreground"
        )}
      >
        {new Intl.NumberFormat(intlLocaleTag(locale)).format(value)}
      </dd>
    </div>
  )
}

function Chip({
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
        // min-h-8 keeps every chip above the 24px tap-target floor with room to
        // spare, which matters most in German at 320px where they wrap to four
        // rows and land under a thumb.
        "inline-flex min-h-8 items-center rounded-full border px-3 text-sm",
        "transition-colors duration-150 ease-[var(--ease-out)]",
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
