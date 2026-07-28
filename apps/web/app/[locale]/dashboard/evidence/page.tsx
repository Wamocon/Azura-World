import { Download } from "lucide-react"
import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"
import type { ReactNode } from "react"

import { PriceConflictPanel } from "@/components/inventory/price-conflict-panel"
import type { PriceObservation } from "@/components/inventory/price-conflict-ladder"
import { AnnotationForm } from "@/components/inventory/annotation-form"
import { getUserProfile } from "@/lib/auth"
import { hasPermission } from "@/lib/rbac"
import { cn } from "@/lib/cn"
import { getFinding } from "@/lib/evidence-repository"
import { getPortalListings } from "@/lib/portal-repository"
import { getSources } from "@/lib/evidence-repository"
import type { Finding, Locale, SourceRef } from "@/lib/contracts"

/**
 * /[locale]/dashboard/evidence — the evidence cockpit.      Owner: W3-C
 *
 * The screen that justifies the project, built F-002 first because the W3-C
 * brief says so and because it is the hardest thing here: four portals quoting
 * a 2.1× range for the same apartment type, in two currencies, one of them
 * stale by two years. If that renders clearly and honestly, the other three
 * views follow the same pattern.
 *
 * ## Rendering mode
 *
 * No `export const dynamic`. W-INT §4 made the root layout read `headers()`,
 * which opts every route beneath it out of static generation, so the default is
 * already correct — and adding `force-static` here would ship a page whose
 * every script is CSP-blocked while still *looking* right (S-009). `pnpm qa:csp`
 * is the gate that keeps that from coming back.
 *
 * ## No dashboard shell yet
 *
 * W3-B owns `dashboard/layout.tsx` and has not published its module contract
 * (`HANDOFF/W3-B.md` does not exist at the time of writing), so this page
 * carries its own heading and spacing and uses no table primitive from that
 * contract. When the shell lands, the `<header>` here is the part to delete;
 * everything below it is shell-independent by construction.
 */

export const metadata: Metadata = {
  title: "Beleg-Cockpit",
  robots: { index: false, follow: false },
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
  const tEvidence = await getTranslations({ locale, namespace: "evidence" })

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
   * The guard's own header predicted it: *"If this component is the only thing
   * between a `tenant` and the finance ledger, the ledger is public — the user
   * can disable JavaScript, or read the RSC payload."* It was the only thing.
   *
   * Refusing before the reads is what matters: an early return after fetching
   * would still put the evidence in this function's scope and, worse, would
   * invite a later edit to "just render the header" with the data already in
   * hand. Nothing is fetched for a caller who may not see it.
   */
  const profile = await getUserProfile()
  const mayView = profile.authenticated && hasPermission(profile.role, "evidence:view")
  const mayExport = profile.authenticated && hasPermission(profile.role, "evidence:export")
  const mayAnnotate = profile.authenticated && hasPermission(profile.role, "evidence:manage")

  if (!mayView) {
    // Rendered server-side rather than left to the client guard, so it holds
    // with JavaScript disabled and so the payload carries the refusal instead
    // of the evidence.
    return (
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-10 sm:px-6">
        <h1 className="font-display text-2xl font-semibold sm:text-3xl">{t("title")}</h1>
        <p role="alert" data-testid="evidence-forbidden" className="max-w-prose text-sm text-muted-foreground">
          {t("forbidden")}
        </p>
      </section>
    )
  }

  const [findingResult, listingsResult, allSaleResult, sourcesResult] =
    await Promise.all([
      getFinding("F-002"),
      getPortalListings({ layout: F002_LAYOUT, priceKind: "sale", limit: 200 }),
      getPortalListings({ priceKind: "sale", limit: 400 }),
      getSources(),
    ])

  const observations = listingsResult.data
    .map(toObservation)
    .filter(
      (observation): observation is PriceObservation => observation !== null
    )

  // The listings whose publisher stated a price but no layout. Kept separate
  // from the ladder rather than dropped: Alanya-Home's €220,000 is one of the
  // four figures F-002's message names, and it would otherwise vanish from a
  // panel that is supposed to be about exactly that disagreement.
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
   * W1-D's provenance components take a STRING WITH `{placeholders}` and
   * interpolate it themselves (their labels cross a Server → Client boundary,
   * where a formatter function cannot be serialised). next-intl's `t()` resolves
   * placeholders eagerly and **throws** when the values are not supplied —
   * `FORMATTING_ERROR: The intl string context variable "count" was not
   * provided` — so a label destined for one of those components has to be
   * fetched raw. `t()` is still correct for every label with no placeholder.
   */
  const template = (key: string): string => String(t.raw(key))

  const labels = {
    headline: t("finding.headline"),
    recordLabel: t("finding.recordLabel"),
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
    resolutionHeading: t("finding.resolutionHeading"),
    resolvedHeading: t("finding.resolvedHeading"),
    unresolved: t("finding.unresolved"),
    unresolvedNote: t("finding.unresolvedNote"),
    observationSummary: template("finding.observationSummary"),
    unstatedHeading: t("unstatedHeading"),
    unstatedLead: t("unstatedLead"),
    ladder: {
      railSummary: template("ladder.railSummary"),
      notComparable: t("ladder.notComparable"),
      spread: template("ladder.spread"),
      stale: t("ladder.stale"),
      lowest: t("ladder.lowest"),
      highest: t("ladder.highest"),
      singleObservation: t("ladder.singleObservation"),
      negligible: template("ladder.negligible"),
    },
    table: {
      caption: t("table.caption"),
      price: t("table.price"),
      layout: t("table.layout"),
      area: t("table.area"),
      publisher: t("table.publisher"),
      observed: t("table.observed"),
      evidence: t("table.evidence"),
      stale: t("table.stale"),
      note: t("table.note"),
      layoutUnstated: t("table.layoutUnstated"),
      areaUnstated: t("table.areaUnstated"),
      source: {
        // Reused from W1-C's own `evidence.*` namespace rather than duplicated
        // into this one: two copies of "Quelle öffnen" in four locales would
        // drift, and these already exist.
        openSource: tEvidence("label.openSource"),
        snapshot: tEvidence("label.snapshot"),
        unreachable: tEvidence("sourceUnreachable"),
        tier: {
          official: t("source.tier.official"),
          developer: t("source.tier.developer"),
          hotel: t("source.tier.hotel"),
          portal: t("source.tier.portal"),
          review: t("source.tier.review"),
          press: t("source.tier.press"),
        },
      },
    },
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
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              )}
            >
              <Download className="size-4 shrink-0" aria-hidden="true" />
              {t("export.link")}
            </a>
            <span className="ml-2 text-xs text-muted-foreground">{t("export.note")}</span>
          </p>
        ) : null}
      </header>

      {finding === null || observations.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <PriceConflictPanel
          finding={finding}
          observations={observations}
          unstatedLayoutObservations={unstatedLayoutObservations}
          locale={locale}
          labels={labels}
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
          }}
        />
      ) : null}
    </section>
  )
}
