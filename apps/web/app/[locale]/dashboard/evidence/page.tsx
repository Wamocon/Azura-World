import { Download } from "lucide-react"
import { getTranslations } from "next-intl/server"

import { dataNoteLabels } from "@/components/evidence/data-note"
import type { Metadata } from "next"
import type { ReactNode } from "react"

import {
  EvidenceConflictPanel,
  type EvidenceConflictExplain,
  type EvidenceConflictLabels,
} from "@/components/evidence/evidence-conflict-panel"
import type { PriceObservation } from "@/components/inventory/price-conflict-ladder"
import { AnnotationForm } from "@/components/inventory/annotation-form"
import { getUserProfile } from "@/lib/auth"
import { hasPermission } from "@/lib/rbac"
import { cn } from "@/lib/cn"
import { getFinding } from "@/lib/evidence-repository"
import { getGlossary } from "@/lib/glossary"
import { getPortalListings } from "@/lib/portal-repository"
import { getSources } from "@/lib/evidence-repository"
import type { Finding, Locale, SourceRef } from "@/lib/contracts"

/**
 * /[locale]/dashboard/evidence — sources and evidence.      Owner: W3-C
 *
 * The screen that justifies the project, built F-002 first because the W3-C
 * brief says so and because it is the hardest thing here: four portals quoting
 * a 2.1× range for the same apartment type, in two currencies, one of them
 * stale by two years. If that renders clearly and honestly, the other three
 * views follow the same pattern.
 *
 * ## Redesigned after client review
 *
 * The first version failed the only test that matters for a graphic: a reader
 * could not say what it showed. Thirteen unlabelled ticks on a shared rail,
 * colliding end labels, two paragraphs of English analyst prose above them, and
 * a six-column table that scrolled sideways on anything smaller than a laptop
 * while repeating an "internal wording" disclosure under every row.
 *
 * What replaced it is in `components/evidence/`: one bar per portal, sorted,
 * with the portal's name at one end and its price at the other; one translated
 * sentence in place of the prose, with the recorded original kept behind a
 * disclosure; and a record table grouped by portal so nothing is stated twice.
 * Every honesty control survived the rewrite unchanged — the two currencies
 * still never share a scale, the conflict is still unresolved, every quote is
 * still on the page with its source, and stale listings are still marked in the
 * same glance as the price.
 *
 * ## Rendering mode
 *
 * No `export const dynamic`. W-INT §4 made the root layout read `headers()`,
 * which opts every route beneath it out of static generation, so the default is
 * already correct — and adding `force-static` here would ship a page whose
 * every script is CSP-blocked while still *looking* right (S-009). `pnpm qa:csp`
 * is the gate that keeps that from coming back.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.evidence" })
  // Translated rather than the hardcoded German "Beleg-Cockpit" this carried
  // before: the tab title is a user-visible string like any other, and "Cockpit"
  // is exactly the internal jargon azura-ui-ux §7b rules out.
  return { title: t("title"), robots: { index: false, follow: false } }
}

/**
 * The listings that bear on the 1+1 entry price.
 *
 * Sale only — a rental at €1,000/month is not a competing claim about a
 * purchase price, and mixing the two would manufacture a 310× spread out of
 * nothing. `priceKind: null` is excluded for the same reason W2-A excludes it
 * from the spread: a page that did not say is not evidence that it is a sale.
 */
const F002_LAYOUT = "1+1"

function toObservation(listing: {
  publisher: string
  url: string
  fetchedAt: string
  layout: string | null
  interiorM2: number | null
  price: { amount: number; currency: "EUR" | "USD" | "TRY" | "GBP" } | null
  isStale: boolean
  note: string | null
}): PriceObservation | null {
  if (listing.price === null) return null
  return {
    money: listing.price,
    publisher: listing.publisher,
    layout: listing.layout,
    interiorM2: listing.interiorM2,
    stale: listing.isStale,
    url: listing.url,
    fetchedAt: listing.fetchedAt,
    note: listing.note,
  }
}

export default async function EvidencePage({
  params,
}: {
  params: Promise<{ locale: Locale }>
}): Promise<ReactNode> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.evidence" })
  // Root namespace: `dataNote.*` is shared by every surface that renders a
  // dataset note, so it is not nested under this page.
  const tRoot = await getTranslations({ locale })

  /**
   * The permission is re-checked HERE, before a single repository call.
   *
   * `DashboardRouteGuard` is a client component: by the time it decides, this
   * Server Component has already rendered and its output is in the RSC flight
   * payload. W4-C (SEC-003) and W4-A independently measured the consequence — a
   * `tenant` received `Housearch`, `239.171` and `F-002` in the response body
   * of this route while the visible page showed a correct 403. Nine of eleven
   * roles hold `dashboard:view` without `evidence:view`.
   *
   * Refusing before the reads is what matters: an early return after fetching
   * would still put the evidence in this function's scope and, worse, would
   * invite a later edit to "just render the header" with the data already in
   * hand. Nothing is fetched for a caller who may not see it.
   */
  const profile = await getUserProfile()
  const mayView =
    profile.authenticated && hasPermission(profile.role, "evidence:view")
  const mayExport =
    profile.authenticated && hasPermission(profile.role, "evidence:export")
  const mayAnnotate =
    profile.authenticated && hasPermission(profile.role, "evidence:manage")

  if (!mayView) {
    // Rendered server-side rather than left to the client guard, so it holds
    // with JavaScript disabled and so the payload carries the refusal instead
    // of the evidence.
    return (
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-10 sm:px-6">
        <h1 className="font-display text-2xl font-semibold sm:text-3xl">
          {t("title")}
        </h1>
        <p
          role="alert"
          data-testid="evidence-forbidden"
          className="max-w-prose text-sm text-muted-foreground"
        >
          {t("forbidden")}
        </p>
      </section>
    )
  }

  const [
    findingResult,
    listingsResult,
    allSaleResult,
    sourcesResult,
    glossary,
  ] = await Promise.all([
    getFinding("F-002"),
    getPortalListings({ layout: F002_LAYOUT, priceKind: "sale", limit: 200 }),
    getPortalListings({ priceKind: "sale", limit: 400 }),
    getSources(),
    getGlossary(locale),
  ])

  const observations = listingsResult.data
    .map(toObservation)
    .filter(
      (observation): observation is PriceObservation => observation !== null
    )

  // The listings whose portal stated a price but no layout. Kept separate from
  // the chart rather than dropped: Alanya-Home's €220,000 is one of the four
  // figures F-002's message names, and it would otherwise vanish from a panel
  // that is supposed to be about exactly that disagreement.
  const unstatedLayoutObservations = allSaleResult.data
    .filter((listing) => listing.layout === null)
    .map(toObservation)
    .filter(
      (observation): observation is PriceObservation => observation !== null
    )

  // A citation upgrade, not a fabrication: where a listing's URL is in the
  // source register we can link its stored snapshot, and where it is not the
  // row still renders with its live URL. Inventing a hash to make every row
  // look uniform would defeat invariant 6.
  const sourcesByUrl = new Map<string, SourceRef>(
    sourcesResult.data.map((source) => [source.url, source])
  )

  const finding: Finding | null = findingResult.data
  const degraded =
    findingResult.source === "local-seed" ||
    listingsResult.source === "local-seed"

  /**
   * Templates go through `t.raw`, not `t`.
   *
   * A label with an ICU placeholder that these components substitute themselves
   * has to be fetched raw: next-intl's `t()` resolves placeholders eagerly and
   * **throws** when the values are not supplied — `FORMATTING_ERROR: The intl
   * string context variable "count" was not provided`. `t()` stays correct for
   * every label with no placeholder.
   */
  const template = (key: string): string => String(t.raw(key))

  const labels: EvidenceConflictLabels = {
    headline: t("finding.headline"),
    findingId: template("finding.id"),
    severity: {
      critical: t("finding.severity.critical"),
      high: t("finding.severity.high"),
      medium: t("finding.severity.medium"),
      low: t("finding.severity.low"),
      info: t("finding.severity.info"),
    },
    area: {
      structure: t("finding.area.structure"),
      pricing: t("finding.area.pricing"),
      timeline: t("finding.area.timeline"),
      geography: t("finding.area.geography"),
      branding: t("finding.area.branding"),
      availability: t("finding.area.availability"),
      harvest: t("finding.area.harvest"),
    },
    summary: template("plain.summary"),
    noPick: t("plain.noPick"),
    originalLabel: t("plain.originalLabel"),
    originalHint: t("plain.originalHint"),
    originalFinding: t("plain.originalFinding"),
    originalResolution: t("plain.originalResolution"),
    recordHeading: t("record.heading"),
    recordLead: t("record.lead"),
    unstatedHeading: t("unstatedHeading"),
    unstatedLead: t("unstatedLead"),
    resolutionHeading: t("finding.resolutionHeading"),
    resolvedHeading: t("finding.resolvedHeading"),
    unresolved: t("finding.unresolved"),
    unresolvedNote: t("finding.unresolvedNote"),
    bars: {
      heading: t("chart.heading"),
      groupHeading: template("chart.groupHeading"),
      groupMeta: template("chart.groupMeta"),
      groupMetaSingle: template("chart.groupMetaSingle"),
      listings: template("chart.listings"),
      oneListing: t("chart.oneListing"),
      upTo: template("chart.upTo"),
      stale: t("chart.stale"),
      staleSome: template("chart.staleSome"),
      staleNote: t("chart.staleNote"),
      entryNote: t("chart.entryNote"),
      rangeNote: t("chart.rangeNote"),
      scaleNote: t("chart.scaleNote"),
      notComparable: t("chart.notComparable"),
      spread: template("chart.spread"),
      singleSourceNote: t("chart.singleSourceNote"),
    },
    record: {
      caption: t("table.caption"),
      price: t("table.price"),
      size: t("table.area"),
      collected: t("table.observed"),
      source: t("table.evidence"),
      openListing: t("record.openListing"),
      openListingLabel: template("record.openListingLabel"),
      snapshotLabel: template("record.snapshotLabel"),
      stale: t("table.stale"),
      staleSome: template("chart.staleSome"),
      sizeUnstated: t("table.areaUnstated"),
      listings: template("chart.listings"),
      oneListing: t("chart.oneListing"),
      originalsLabel: t("record.originalsLabel"),
      originalsHint: t("record.originalsHint"),
      notComparable: t("chart.notComparable"),
      // `dataNote.*` lives in its own top-level namespace, not under this
      // page's, because the same eighteen sentences are needed anywhere a
      // dataset note is rendered. `tRoot` reads it.
      dataNote: dataNoteLabels(tRoot),
    },
  }

  // Four terms this page shows that a property manager is not obliged to know.
  // Each one carries its own plain-language explanation, opened by keyboard or
  // touch, never by hover alone.
  const explain: EvidenceConflictExplain = {
    conflicted: glossary.conflicted,
    singleSource: glossary.singleSource,
    gap: glossary.gap,
    provenance: glossary.provenance,
  }

  return (
    // `<section>`, not `<main>`: `dashboard/layout.tsx` already renders
    // `<main id="main">` and WCAG 2.2 allows exactly one `main` landmark per
    // document. W4-A measured two here — a screen-reader user got two "main"
    // regions and no way to tell which held the content.
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-semibold sm:text-3xl">
          {t("title")}
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {t("lead")}
        </p>
        {degraded ? (
          // CONTRACTS §4: `local-seed` is a labelled state, never a silent one.
          // A demo that reads as the full harvest is the exact failure this
          // project exists to prevent.
          <p
            role="status"
            className="mt-1 rounded-lg border border-quality-modelled/40 bg-quality-modelled/10 px-3 py-2 text-xs leading-relaxed text-quality-modelled"
          >
            {t("seedNotice")}
          </p>
        ) : null}

        {/*
          The export is a plain anchor to a route handler, not a button running
          a client fetch: it works with JavaScript disabled, it is a URL a
          reviewer can paste into a ticket, and the browser handles the download
          without this page holding the file in memory. `download` is advisory —
          `Content-Disposition` on the route is what actually decides.
        */}
        {mayExport ? (
          <p className="mt-1">
            <a
              href={`/${locale}/dashboard/evidence/export`}
              download
              data-testid="evidence-export"
              className={cn(
                "inline-flex min-h-6 items-center gap-1.5 rounded-sm text-sm font-medium",
                "text-primary underline underline-offset-4",
                "transition-transform duration-150 ease-out active:scale-[0.97]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              )}
            >
              <Download className="size-4 shrink-0" aria-hidden="true" />
              {t("export.link")}
            </a>
            <span className="ml-2 text-xs text-muted-foreground">
              {t("export.note")}
            </span>
          </p>
        ) : null}
      </header>

      {finding === null || observations.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <EvidenceConflictPanel
          finding={finding}
          observations={observations}
          unstatedLayoutObservations={unstatedLayoutObservations}
          layout={F002_LAYOUT}
          locale={locale}
          labels={labels}
          explain={explain}
          sourcesByUrl={sourcesByUrl}
          snapshotBasePath="/api/evidence/snapshot"
        />
      )}

      {/*
        `evidence:manage`, which only `admin` holds. The form is hidden from
        everyone else and `annotateFinding` refuses them regardless — hiding a
        control is a courtesy, the action refusing is the boundary.
      */}
      {mayAnnotate && finding !== null ? (
        <AnnotationForm
          findingId={finding.id}
          labels={{
            heading: t("annotation.heading"),
            hint: t("annotation.hint"),
            placeholder: t("annotation.placeholder"),
            submit: t("annotation.submit"),
            pending: t("annotation.pending"),
            forbidden: t("annotation.forbidden"),
            saved: t("annotation.saved"),
            unavailable: t("annotation.unavailable"),
          }}
        />
      ) : null}
    </section>
  )
}
