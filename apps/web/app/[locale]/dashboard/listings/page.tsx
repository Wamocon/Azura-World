import { getTranslations } from "next-intl/server"

import { ChevronDown, Info } from "lucide-react"
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
  ListingsPortalCard,
  type PortalCardLabels,
} from "@/components/inventory/listings-portal-card"
import { buildPortalSummaries } from "@/components/inventory/listings-portal-summary"
import {
  buildClaimRows,
  PortalClaimMatrix,
  type ClaimColumn,
} from "@/components/inventory/portal-claim-matrix"
import { PublisherListingGroup } from "@/components/inventory/publisher-listing-group"
import { Explain, type ExplainLabels } from "@/components/ui/explain"
import { getUserProfile } from "@/lib/auth"
import { cn } from "@/lib/cn"
import type { Locale, UnitLayout } from "@/lib/contracts"
import { getFactsForEntity } from "@/lib/evidence-repository"
import { getGlossary } from "@/lib/glossary"
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
 *   0. what this page is, in two sentences a property manager can read;
 *   1. the seven portals, one card each — count, price range, currency, age;
 *   2. the same apartment across portals, side by side, prices as published;
 *   3. what each portal claims about the building itself;
 *   4. every row, grouped by who published it.
 *
 * The portal cards come first because "who is advertising our apartments, at
 * what, and is it current" is the question the reader actually arrives with. The
 * comparison still sits above the register: a reader who meets the 47 rows first
 * reads them as a price list; a reader who meets the disagreement first reads
 * them as evidence.
 *
 * ## Rewritten for a reader, not for an analyst           Owner: W-NIGHT
 *
 * The page used to open on four large counts, a layout filter and two currency
 * columns. Every number on it was right and the page still read as a worksheet.
 * What changed: an information panel that says in plain words what portals are
 * and why their prices differ, seven publisher cards carrying the picture each
 * portal itself published, and the long "no layout stated" band folded into a
 * disclosure so it stops separating the comparison from the register. What did
 * NOT change: currencies stay apart, rents stay out of sale ranges, missing
 * prices stay missing, and every out-of-date row is still marked as one.
 *
 * ## One fetch, several sections
 *
 * The whole register is 47 rows, so the page fetches it once and derives every
 * section from that array in memory. A query per section would let two sections
 * disagree with each other if a harvest landed mid-render, and the counts on this
 * page are the point of it.
 *
 * ## Almost no client JavaScript
 *
 * Filters are links and the page reads `searchParams`, exactly as
 * `dashboard/units` does. The disclosure is a native `<details>`. The only
 * client islands are the `<Explain>` popovers, which are additive: every
 * sentence they explain is already in the document. It cannot be broken by the
 * S-009 CSP class, it works with JS off, and there is no hydration boundary
 * between a price and its caveat. No `export const dynamic`: W-INT §4 made the
 * root layout read `headers()`, so every route beneath it is already dynamic,
 * and adding `force-static` here would ship a page with zero working JavaScript.
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
  const t = await getTranslations({ locale, namespace: "dashboard.listings" })
  return {
    title: t("title"),
    robots: { index: false, follow: false },
  }
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

/** The register's own anchor, so a portal card can send a reader to it. */
const REGISTER_ANCHOR = "listings-register"

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
  // Root namespace: `dataNote.*`, `glossary.*` and `landing.mediaKind.*` are
  // shared, not page-scoped.
  const tRoot = await getTranslations({ locale })
  const glossary = await getGlossary(locale)

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

  // ---- the portal cards --------------------------------------------------
  // Built from the WHOLE register, never from `filtered`. The cards are the
  // page's overview: a reader who filters the register to one portal must still
  // be able to see that six others exist and what they say.
  const portals = buildPortalSummaries(all)

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
  // the one view built to show it. Folded into a disclosure since W-NIGHT — it
  // is a footnote to the comparison, and at full height it used to read as a
  // second, competing comparison.
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
    anchor?: string
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
    const hash = next.anchor === undefined ? "" : `#${next.anchor}`
    return `/dashboard/listings${s ? `?${s}` : ""}${hash}`
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

  // ---- plain-language explanations ---------------------------------------
  // `glossary.*` covers the sixteen shared terms. Two words this page uses are
  // not among them and are explained here in the same shape: "out of date",
  // which on this dataset means one specific thing, and "not stated", which the
  // glossary defines for a unit's availability rather than for a price.
  const ariaTemplate = tRoot.raw("glossary.ariaLabel") as string
  const explainLabel = (term: string, body: string): ExplainLabels => ({
    term,
    body,
    ariaLabel: ariaTemplate.replace("{term}", term),
  })
  const explainOutdated = explainLabel(
    t("explain.outdated.term"),
    t("explain.outdated.body")
  )
  const explainNotStated = explainLabel(
    t("explain.notStated.term"),
    t("explain.notStated.body")
  )

  const comparisonLabels = {
    publisher: t("columns.portal"),
    price: t("columns.price"),
    count: t("compare.countHeader"),
    notComparable: t("compare.notComparable"),
    // `t.raw`, not `t`: these two carry `{ratio}`/`{currency}` and `{count}`
    // placeholders that `ListingPriceComparison` substitutes itself with `fill`.
    // Calling `t()` here makes next-intl try to interpolate arguments that are
    // not supplied, which throws FORMATTING_ERROR and renders the raw key path
    // ("dashboard.listings.compare.spread") on screen. Measured on the page.
    spread: t.raw("compare.spread") as string,
    singlePrice: t("compare.singlePrice"),
    stale: t("stale.badge"),
    staleReason: t("stale.reason"),
    listingCount: t.raw("compare.listingCount") as string,
    upTo: t("compare.upTo"),
    openListing: t("openListing"),
    caption: t("compare.caption"),
  }

  const portalLabels: PortalCardLabels = {
    // Two shapes here, and the difference is deliberate.
    //
    // A **counted** label is a function, because "1 Inserate" and "2 объявлений"
    // are wrong and only ICU knows the difference: German needs one/other,
    // Russian needs one/few/many, Turkish needs neither. `t(key, { count })`
    // asks next-intl to decide per locale. Handing the raw template to the card
    // and substituting `{count}` with a string could never get Russian right.
    // This is legal because `ListingsPortalCard` is a Server Component: a
    // function may not cross into a `"use client"` component, and nothing here
    // does — `<Explain>` is the only client island and it takes plain objects.
    //
    // A **plain** template stays a string and the card substitutes it, because
    // its placeholder is a currency code or a list, not a quantity.
    listingCount: (count) => t("group.listingCount", { count }),
    pageCount: (count) => t("group.pageCount", { count }),
    pricesIn: t.raw("portals.pricesIn") as string,
    fromListings: (count) => t("portals.fromListings", { count }),
    upTo: t("compare.upTo"),
    singlePrice: t("compare.singlePrice"),
    noSalePrice: t("portals.noSalePrice"),
    rentNote: (count) => t("portals.rentNote", { count }),
    withoutPrice: (count) => t("portals.withoutPrice", { count }),
    layouts: t.raw("portals.layouts") as string,
    layoutsUnstated: t.raw("portals.layoutsUnstated") as string,
    layoutsNone: t("portals.layoutsNone"),
    stale: t("stale.badge"),
    staleReason: t("stale.reason"),
    allOutdated: t("portals.allOutdated"),
    someOutdated: (count) => t("portals.someOutdated", { count }),
    lastCollected: t("group.lastFetched"),
    showListings: t("portals.showListings"),
    showAll: t("portals.showAll"),
    openPage: t("portals.openPage"),
    pictureCredit: t("portals.pictureCredit"),
    pictureSource: t("portals.pictureSource"),
    pictureStale: t("portals.pictureStale"),
    pictureNone: t("portals.pictureNone"),
    // The shared labels the landing journey already uses for the same assets.
    // A render is called a render in exactly one place in this product.
    kind: {
      render: tRoot("landing.mediaKind.render"),
      floorplan: tRoot("landing.mediaKind.floorplan"),
      siteplan: tRoot("landing.mediaKind.siteplan"),
    },
    alt: {
      photo: t.raw("portals.altPhoto") as string,
      render: t.raw("portals.altRender") as string,
      floorplan: t.raw("portals.altFloorplan") as string,
      siteplan: t.raw("portals.altSiteplan") as string,
    },
    explainStale: explainOutdated,
    explainNotStated: explainNotStated,
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
    // `t.raw` for the same reason as `compare.spread` above: these three carry
    // `{publisher}`/`{count}` placeholders that `PublisherListingGroup`
    // substitutes with `fill()`. `t()` would throw FORMATTING_ERROR and print
    // the key path on screen.
    caption: t.raw("group.caption") as string,
    // The two that count nouns are functions instead, so ICU picks the plural
    // form — see the note on `portalLabels` above. `staleCount` and `rentCount`
    // stay templates: "1 veraltet" and "1 zur Miete" are adjectival and read
    // correctly at every count, so an ICU form would be ceremony.
    listingCount: (count: number) => t("group.listingCount", { count }),
    pageCount: (count: number) => t("group.pageCount", { count }),
    staleCount: t.raw("group.staleCount") as string,
    rentCount: t.raw("group.rentCount") as string,
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

      {/* ---- 0. what this page is ---------------------------------------- */}
      {/* Two sentences before any number. The reader this dashboard is for
          manages a building, not a dataset, and "portal" is our word. */}
      <section
        aria-labelledby="listings-info"
        className="flex flex-col gap-4 rounded-2xl border border-primary/25 bg-primary/[0.04] p-4 sm:p-5"
      >
        <div className="flex flex-col gap-2">
          <h2
            id="listings-info"
            className="flex items-center gap-2 font-display text-lg font-semibold tracking-[-0.012em] text-foreground"
          >
            <Info className="size-4 shrink-0 text-primary" aria-hidden="true" />
            {t("info.heading")}
          </h2>
          <p className="max-w-prose text-sm leading-relaxed text-foreground">
            {t("info.body")}
          </p>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            {t("info.body2")}
          </p>
        </div>

        {/* The glossary strip: every word on this page a reader is allowed not
            to know, opened by tap, click or Enter. Not a hover. */}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
          <span>{t("info.termsLead")}</span>
          <Explain labels={glossary.realListing} className="text-foreground" />
          <Explain labels={glossary.conflicted} className="text-foreground" />
          <Explain labels={explainOutdated} className="text-foreground" />
          <Explain labels={explainNotStated} className="text-foreground" />
        </p>

        <div className="flex flex-col gap-2 border-t border-primary/15 pt-4">
          <h3 className="azura-label text-muted-foreground">
            {t("overview.heading")}
          </h3>
          <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
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
          <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
            {t("overview.caveat")}
          </p>
          {withoutPrice > 0 ? (
            <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
              {t("overview.withoutPrice", { count: withoutPrice })}
            </p>
          ) : null}
        </div>
      </section>

      {/* ---- 1. the portals ----------------------------------------------- */}
      <section
        aria-labelledby="listings-portals"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1.5">
          <h2
            id="listings-portals"
            className="font-display text-lg font-semibold tracking-[-0.012em] text-foreground"
          >
            {t("portals.heading")}
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {t("portals.lead")}
          </p>
        </div>

        {portals.length === 0 ? (
          <p className="rounded-xl border border-border bg-background/50 p-6 text-sm text-muted-foreground">
            {t("empty")}
          </p>
        ) : (
          <ul className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {portals.map((portal) => (
              <li key={portal.publisher} className="flex min-w-0">
                <ListingsPortalCard
                  summary={portal}
                  locale={locale}
                  labels={portalLabels}
                  active={activePublisher === portal.publisher}
                  listingsHref={hrefFor({
                    publisher:
                      activePublisher === portal.publisher
                        ? null
                        : portal.publisher,
                    anchor: REGISTER_ANCHOR,
                  })}
                  className="w-full"
                />
              </li>
            ))}
          </ul>
        )}
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
          // A native disclosure: it opens with no JavaScript, it is keyboard
          // reachable, and its contents are in the document for a screen reader
          // and for search. Closed by default because these rows are a caveat to
          // the comparison above, not a second comparison.
          <details className="group rounded-xl border border-border bg-background/40">
            <summary
              className={cn(
                "flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5",
                "text-sm font-medium text-foreground",
                "[&::-webkit-details-marker]:hidden",
                "outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
            >
              <span>
                {t("compare.unstatedToggle", {
                  count: unstatedLayoutRows.length,
                })}
              </span>
              <ChevronDown
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-[var(--ease-out)] group-open:rotate-180 motion-reduce:transition-none"
              />
            </summary>
            <div className="flex flex-col gap-3 border-t border-border px-4 py-4">
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
          </details>
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
          <p className="flex max-w-prose flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            {t("claims.lead")}
            <Explain labels={explainNotStated} iconOnly />
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
        id={REGISTER_ANCHOR}
        aria-labelledby="listings-register-heading"
        className="flex scroll-mt-24 flex-col gap-4"
      >
        <div className="flex flex-col gap-1.5">
          <h2
            id="listings-register-heading"
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
 *
 * Smaller since W-NIGHT. These four used to be the first thing on the page at
 * `text-2xl`, which made a count of collected rows the loudest object on a
 * screen about seven portals. They are context now, and they sit inside the
 * paragraph that qualifies them.
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
        "flex flex-col gap-0.5 rounded-lg border px-3 py-2",
        tone === "stale"
          ? "border-quality-stale/30 bg-quality-stale/[0.06]"
          : "border-border bg-card"
      )}
    >
      <dt className="text-[0.6875rem] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        data-numeric
        className={cn(
          "font-display text-xl font-semibold tracking-[-0.014em] tabular-nums",
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
