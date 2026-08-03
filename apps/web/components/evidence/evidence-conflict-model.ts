import type { Money } from "@/lib/contracts"

import type { PriceObservation } from "@/components/inventory/price-conflict-ladder"

/**
 * The shape of the price disagreement, computed once.       Owner: W-EVIDENCE
 *
 * Both the bar chart and the record table below it read the same grouping, so
 * it lives here rather than being derived twice. Two derivations of "how many
 * portals are there" that disagree by one is exactly the class of bug this
 * product cannot afford.
 *
 * ## The grouping is currency first, publisher second
 *
 * Currency is the outer key because a euro figure and a dollar figure are not
 * two points on one scale, they are two different claims measured in two
 * different units. CONVENTIONS §5 forbids converting, no source supplies a rate
 * or a rate date, so the incommensurability has to survive into the layout: two
 * groups, two scales, never one axis.
 *
 * Publisher is the inner key because the reader's question is "what does each
 * portal say", not "what does listing number nine say". Thirteen euro
 * observations from three portals were previously drawn as thirteen ticks on
 * one rail, and thirteen marks cannot be read as three positions.
 *
 * ## Nothing here averages
 *
 * A group carries its lowest and its highest observed figure and the ratio
 * between them. There is no mean, no median and no "typical" value, because
 * F-002's `resolvedTo` is `null` by design and `pnpm qa:evidence` fails the
 * build if anyone sets it. `low` and `high` are both real observations that a
 * named portal actually published.
 */

/**
 * Below this ratio a group is treated as having no meaningful disagreement.
 *
 * Housearch's two dollar figures are 0.09 % apart. Drawn on a scale normalised
 * to the group they would look like a span; they are one price quoted twice.
 */
export const NEGLIGIBLE_SPREAD = 1.05

/** Everything one portal published, in one currency. */
export interface PublisherGroup {
  publisher: string
  currency: Money["currency"]
  /** Ascending by amount. Never deduplicated: two identical quotes are two. */
  observations: PriceObservation[]
  /** The cheapest figure this portal published. A real observation. */
  low: number
  /** The dearest figure this portal published. A real observation. */
  high: number
  /** How many of `observations` the harvester marked stale. */
  staleCount: number
}

/** Every portal that quoted in one currency. */
export interface CurrencyGroup {
  currency: Money["currency"]
  /** Ascending by the portal's own cheapest figure. */
  publishers: PublisherGroup[]
  low: number
  high: number
  /** Observations, not portals. */
  count: number
  /** `high / low`. Exactly 1 when there is nothing to disagree about. */
  spread: number
}

function ratio(low: number, high: number): number {
  return low > 0 ? high / low : 1
}

/**
 * Groups observations by currency, then by portal.
 *
 * Both levels sort by the cheapest figure rather than alphabetically: price
 * order is a reading order a person can infer, and an alphabetical one puts USD
 * above EUR for a reason nobody can see.
 */
export function groupByCurrency(
  observations: readonly PriceObservation[]
): CurrencyGroup[] {
  const byCurrency = new Map<Money["currency"], Map<string, PublisherGroup>>()

  for (const observation of observations) {
    const currency = observation.money.currency
    let publishers = byCurrency.get(currency)
    if (publishers === undefined) {
      publishers = new Map<string, PublisherGroup>()
      byCurrency.set(currency, publishers)
    }

    const existing = publishers.get(observation.publisher)
    if (existing === undefined) {
      publishers.set(observation.publisher, {
        publisher: observation.publisher,
        currency,
        observations: [observation],
        low: observation.money.amount,
        high: observation.money.amount,
        staleCount: observation.stale ? 1 : 0,
      })
      continue
    }

    existing.observations.push(observation)
    existing.low = Math.min(existing.low, observation.money.amount)
    existing.high = Math.max(existing.high, observation.money.amount)
    if (observation.stale) existing.staleCount += 1
  }

  const groups: CurrencyGroup[] = []

  for (const [currency, publisherMap] of byCurrency) {
    const publishers = [...publisherMap.values()]
      .map((group) => ({
        ...group,
        observations: [...group.observations].sort(
          (a, b) => a.money.amount - b.money.amount
        ),
      }))
      .sort((a, b) => a.low - b.low || a.publisher.localeCompare(b.publisher))

    let low = Number.POSITIVE_INFINITY
    let high = 0
    let count = 0
    for (const publisher of publishers) {
      low = Math.min(low, publisher.low)
      high = Math.max(high, publisher.high)
      count += publisher.observations.length
    }
    // Defensive: a currency key only exists because an observation created it,
    // so `low` is always finite here. Kept explicit rather than asserted.
    if (!Number.isFinite(low)) low = 0

    groups.push({
      currency,
      publishers,
      low,
      high,
      count,
      spread: ratio(low, high),
    })
  }

  return groups.sort((a, b) => a.low - b.low)
}

/**
 * Is there anything in this block for a bar to be compared against?
 *
 * Two callers need this answer and they must not compute it separately: the
 * currency block decides whether to draw tracks at all, and the key below the
 * chart decides whether to describe them. When those two derivations drifted,
 * the key explained a solid segment and a striped extension on a block that
 * drew neither — a legend for marks that are not on screen.
 *
 * False means one portal quoting one figure (or two a rounding apart). A bar
 * drawn against a scale whose maximum is its own value is always full width,
 * which says nothing and reads as "the biggest number on the page" beside a
 * block in another currency.
 */
export function isComparable(group: CurrencyGroup): boolean {
  return group.publishers.length > 1 || group.spread >= NEGLIGIBLE_SPREAD
}

/** Distinct portal names across every currency. The headline count. */
export function publisherNames(
  observations: readonly PriceObservation[]
): string[] {
  return Array.from(
    new Set(observations.map((observation) => observation.publisher))
  ).sort((a, b) => a.localeCompare(b))
}
