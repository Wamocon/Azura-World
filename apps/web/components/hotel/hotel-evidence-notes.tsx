import { SourceChipList } from "@/components/evidence/source-chip"
import type { SourceChipLabels } from "@/components/evidence/source-chip"
import { cn } from "@/lib/cn"
import type { AzuraSourcedFact } from "@/lib/azura-world-data"

import { formatFetchedDate, type PlatformReachability } from "./select"

/**
 * Two notes about the evidence itself.                            Owner: W3-G
 *
 * Both exist because a reader who is not told these things will draw a wrong
 * conclusion from an otherwise accurate page.
 */

// ---------------------------------------------------------------------------
// The rebrand
// ---------------------------------------------------------------------------

export interface RebrandLabels {
  heading: string
  /** Template with `{formerName}`. */
  body: string
  currentNameLabel: string
  formerNameLabel: string
  findingRef: string
  source: SourceChipLabels
  /** Template with a `{count}` placeholder, e.g. "+{count} weitere". */
  more: string
}

/**
 * "Azura World Hotel" was "Wyndham Alanya" (F-007).
 *
 * The rule from tasks/W3-G is precise: "any UI still saying 'Wyndham' must be
 * traceable to `formerName`, never to `name`." So this component takes the two
 * facts as separate `SourcedFact`s and renders them in separate, labelled
 * slots. The current name is the heading; the former name appears only inside
 * a block that says it is the former name.
 *
 * That matters beyond tidiness. Booking.com still indexes the property under
 * its pre-rebrand slug `/hotel/tr/wyndham-alanya.html`, and the ticket's own
 * Booking URL points at a *different property entirely* (F-014). A reader who
 * does not know the hotel was renamed cannot make sense of either fact.
 *
 * `brandAffiliation` is deliberately not rendered as a value here. It is
 * `null` with confidence `conflicted` — the researched answer is that there is
 * no current chain affiliation, and the sources disagree about it. Its own
 * ProvenanceValue lives in the fact grid, where the amber badge and the
 * competing value are visible. Repeating it as prose here would state as
 * settled something the dataset records as open.
 */
export function RebrandNotice({
  name,
  formerName,
  labels,
  locale,
  className,
}: {
  name: AzuraSourcedFact<string>
  formerName: AzuraSourcedFact<string>
  labels: RebrandLabels
  locale: string
  className?: string
}) {
  const former = formerName.value
  if (former === null) return null

  return (
    <aside
      aria-labelledby="rebrand-heading"
      className={cn(
        "flex flex-col gap-4 rounded-lg border-l-4 border-l-accent border-y border-r border-border bg-card p-6",
        className,
      )}
    >
      <h2 id="rebrand-heading" className="font-display text-lg text-balance">
        {labels.heading}
      </h2>

      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <dt className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted-foreground">
            {labels.currentNameLabel}
          </dt>
          <dd className="font-display text-lg text-foreground">{name.value}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted-foreground">
            {labels.formerNameLabel}
          </dt>
          {/* The ONLY place "Wyndham Alanya" is rendered, and it is rendered
              from `formerName`, under a label that says so. */}
          <dd className="font-display text-lg text-muted-foreground">{former}</dd>
        </div>
      </dl>

      <p className="max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
        {labels.body.replace("{formerName}", former)}
      </p>

      <SourceChipList
        sources={formerName.sources}
        labels={labels.source}
        locale={locale}
        moreLabel={labels.more}
      />

      <p className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted-foreground">
        {labels.findingRef}
      </p>
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Platforms the harvest could not recover
// ---------------------------------------------------------------------------

export interface UnrecoveredLabels {
  heading: string
  intro: string
  statusLabel: string
  attemptedLabel: string
  /** Status vocabulary the harvester emits. */
  status: Record<string, string>
}

/**
 * Booking.com and Agoda, shown as attempted-and-not-recovered.
 *
 * tasks/W3-G: "if W0-B's harvest did not recover them, render them as
 * unreachable with their snapshot status, not as missing." The distinction is
 * the whole point — a blank space says nobody looked, and this page must not
 * say that, because somebody did look and was turned away.
 *
 * The statuses are real: Booking.com returned `expect_missing` on all three
 * attempted URLs and Agoda `redirected`. One of those Booking URLs is itself a
 * finding — the ticket's `/hotel/tr/azura-world.html` is a different property
 * near Alanya centre, not this hotel (F-014).
 */
export function UnrecoveredSources({
  sources,
  labels,
  locale,
  className,
}: {
  sources: readonly PlatformReachability[]
  labels: UnrecoveredLabels
  locale: string
  className?: string
}) {
  if (sources.length === 0) return null

  return (
    <section
      aria-labelledby="unrecovered-heading"
      className={cn("flex flex-col gap-4", className)}
    >
      <h3 id="unrecovered-heading" className="font-display text-xl text-balance">
        {labels.heading}
      </h3>
      <p className="max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
        {labels.intro}
      </p>

      <ul className="flex flex-col gap-2">
        {sources.map((source) => (
          <li
            key={source.url}
            className="flex flex-col gap-1 rounded-md border border-dashed border-border p-4"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-medium text-foreground">{source.publisher}</span>
              <span className="rounded-sm bg-confidence-gap/15 px-2 py-0.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-confidence-gap">
                {labels.status[source.status] ?? source.status}
              </span>
            </div>
            <span className="break-all font-mono text-xs text-muted-foreground">
              {source.url}
            </span>
            <span className="text-xs text-muted-foreground">
              {labels.attemptedLabel} {formatFetchedDate(source.fetchedAt, locale)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
