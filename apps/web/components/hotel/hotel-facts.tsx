import {
  ProvenanceValue,
  type ProvenanceLabels,
} from "@/components/evidence/provenance-value"
import { cn } from "@/lib/cn"
import type { AzuraHotel, AzuraSourcedFact } from "@/lib/azura-world-data"

/**
 * The hotel's operating facts, and the distance divergence.       Owner: W3-G
 *
 * Every figure goes through `ProvenanceValue`. There is not one bare numeric
 * literal in this file — CONTRACTS §8 lists "a number in JSX with no source"
 * as a review rejection, and azura-ui-ux §6 says to grep your own output
 * before finishing. The grep result is in HANDOFF/W3-G.md.
 *
 * ## The brief's confidence table is out of date, and the data wins
 *
 * tasks/W3-G lists Rooms as `confirmed`. The deep harvest recorded
 * `roomCount` as **conflicted**: 188 from the hotel's own site, 112 from
 * Tripadvisor (F-023). Same for `aquaparkSlides` — 13 against 16 from two
 * other hosts (F-024).
 *
 * Nothing here hardcodes a confidence. Each field renders whatever the dataset
 * carries, so both conflicts surface as amber badges with the competing value
 * one interaction away. Rendering them as "confirmed" because a brief written
 * before the harvest said so would be exactly the failure this module exists
 * to prevent.
 */

export interface HotelFactLabels {
  stars: string
  rooms: string
  floors: string
  openedYear: string
  board: string
  aquapark: string
  checkIn: string
  checkOut: string
  beachDistance: string
}

function FactRow<T>({
  label,
  fact,
  format,
  locale,
  provenance,
}: {
  label: string
  fact: AzuraSourcedFact<T>
  format: "text" | "number" | "metres" | "stars"
  locale: string
  provenance: ProvenanceLabels
}) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-border/60 py-4">
      <dt className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </dt>
      <dd className="text-lg">
        <ProvenanceValue
          fact={fact}
          format={format}
          locale={locale}
          labels={provenance}
          showSources
        />
      </dd>
    </div>
  )
}

export function HotelFactGrid({
  hotel,
  labels,
  provenance,
  locale,
  className,
}: {
  hotel: AzuraHotel
  labels: HotelFactLabels
  provenance: ProvenanceLabels
  locale: string
  className?: string
}) {
  return (
    <dl
      className={cn(
        "grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
    >
      <FactRow
        label={labels.stars}
        fact={hotel.stars}
        format="stars"
        locale={locale}
        provenance={provenance}
      />
      <FactRow
        label={labels.rooms}
        fact={hotel.roomCount}
        format="number"
        locale={locale}
        provenance={provenance}
      />
      <FactRow
        label={labels.floors}
        fact={hotel.floors}
        format="number"
        locale={locale}
        provenance={provenance}
      />
      <FactRow
        label={labels.openedYear}
        fact={hotel.openedYear}
        format="number"
        locale={locale}
        provenance={provenance}
      />
      <FactRow
        label={labels.board}
        fact={hotel.board}
        format="text"
        locale={locale}
        provenance={provenance}
      />
      <FactRow
        label={labels.aquapark}
        fact={hotel.aquaparkSlides}
        format="number"
        locale={locale}
        provenance={provenance}
      />
      <FactRow
        label={labels.checkIn}
        fact={hotel.checkIn}
        format="text"
        locale={locale}
        provenance={provenance}
      />
      <FactRow
        label={labels.checkOut}
        fact={hotel.checkOut}
        format="text"
        locale={locale}
        provenance={provenance}
      />
      <FactRow
        label={labels.beachDistance}
        fact={hotel.distanceToBeachM}
        format="metres"
        locale={locale}
        provenance={provenance}
      />
    </dl>
  )
}

// ---------------------------------------------------------------------------
// The two distances
// ---------------------------------------------------------------------------

export interface DistanceLabels {
  heading: string
  explanation: string
  residenceLabel: string
  hotelLabel: string
  findingRef: string
}

/**
 * The residence is 300 m from the sea. The hotel is 1 km from the beach.
 *
 * A reader who meets those two numbers on the same page without an explanation
 * concludes that one of them is wrong, and the more careful the reader, the
 * faster they get there. They are different measurements of different things —
 * `project.distanceToSeaM` is the residence to the shoreline,
 * `hotel.distanceToBeachM` is the hotel to the public beach it shuttles guests
 * to (F-003).
 *
 * tasks/W3-G: the divergence "is not a contradiction — different reference
 * points — and the page should say so rather than leaving a reader to spot an
 * apparent inconsistency."
 *
 * The two facts are kept in **separate fields all the way down**. This
 * component takes both as `SourcedFact`s and never combines, averages or
 * reconciles them; each keeps its own provenance and its own confidence
 * (`distanceToSeaM` is itself conflicted across five sources, and says so).
 */
export function DistanceDivergence({
  residenceDistance,
  hotelDistance,
  labels,
  provenance,
  locale,
  className,
}: {
  residenceDistance: AzuraSourcedFact<number>
  hotelDistance: AzuraSourcedFact<number>
  labels: DistanceLabels
  provenance: ProvenanceLabels
  locale: string
  className?: string
}) {
  return (
    <section
      aria-labelledby="distance-divergence-heading"
      className={cn(
        "flex flex-col gap-5 rounded-lg border border-border bg-muted/30 p-6",
        className,
      )}
    >
      <h3
        id="distance-divergence-heading"
        className="font-display text-xl text-balance"
      >
        {labels.heading}
      </h3>

      <dl className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <dt className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted-foreground">
            {labels.residenceLabel}
          </dt>
          <dd className="text-2xl">
            <ProvenanceValue
              fact={residenceDistance}
              format="metres"
              locale={locale}
              labels={provenance}
              showSources
            />
          </dd>
        </div>
        <div className="flex flex-col gap-1.5">
          <dt className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted-foreground">
            {labels.hotelLabel}
          </dt>
          <dd className="text-2xl">
            <ProvenanceValue
              fact={hotelDistance}
              format="metres"
              locale={locale}
              labels={provenance}
              showSources
            />
          </dd>
        </div>
      </dl>

      <p className="max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
        {labels.explanation}
      </p>
      <p className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted-foreground">
        {labels.findingRef}
      </p>
    </section>
  )
}
