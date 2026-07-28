import type { Finding, UnitLayout } from "../contracts"
import type { CurrencyCode } from "../finance-data"
import type { SaleStatus, UnitDataQuality } from "../inventory-data"

/**
 * Closed vocabularies for query-string filters.               Owner: W2-B
 *
 * Most enumerations in this codebase already exist as exported const arrays
 * (`ticketStatuses`, `leadSources`, …) and `lib/validation/*` imports those
 * directly. A few are declared only as inline unions in `contracts.ts` and
 * `inventory-data.ts`, and a query-string reader needs a runtime array.
 *
 * Writing that array by hand creates the drift this file exists to prevent, so
 * each one is proved against its type in two directions:
 *
 * - `satisfies readonly T[]` — nothing here is a value the type does not allow.
 *   A typo is a compile error.
 * - `Exhaustive<...>` — nothing the type allows is missing here. Adding a
 *   currency to `contracts.ts` and forgetting this file is a compile error too.
 *
 * One direction alone is not enough. `satisfies` on its own would let a filter
 * silently stop accepting a value that the rest of the app started using, and
 * the symptom would be a filter that quietly returns nothing.
 */

/** Compile-time proof that `Members` covers every member of `Union`. */
type Exhaustive<Union extends string, Members extends readonly Union[]> = [
  Exclude<Union, Members[number]>,
] extends [never]
  ? Members
  : ["missing from the list:", Exclude<Union, Members[number]>]

export const currencies = [
  "EUR",
  "USD",
  "TRY",
  "GBP",
] as const satisfies readonly CurrencyCode[]
export type _CurrenciesComplete = Exhaustive<CurrencyCode, typeof currencies>

export const findingSeverities = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
] as const satisfies readonly Finding["severity"][]
export type _SeveritiesComplete = Exhaustive<
  Finding["severity"],
  typeof findingSeverities
>

/**
 * Note `portal_listing` and `official` where a reader might expect "real".
 *
 * 25 of 656 units are harvested portal listings and 631 are modelled. This
 * vocabulary is the API-side half of the honesty control W3-C renders in the
 * unit list, so it uses the dataset's own four terms rather than collapsing them
 * to a real/fake pair the data does not support.
 */
export const unitDataQualities = [
  "portal_listing",
  "official",
  "modelled",
  "source_missing",
] as const satisfies readonly UnitDataQuality[]
export type _DataQualitiesComplete = Exhaustive<
  UnitDataQuality,
  typeof unitDataQualities
>

export const saleStatuses = [
  "available",
  "reserved",
  "sold",
  "unknown",
] as const satisfies readonly SaleStatus[]
export type _SaleStatusesComplete = Exhaustive<SaleStatus, typeof saleStatuses>

export const unitLayouts = [
  "1+1",
  "2+1",
  "3+1",
  "4+1",
  "5+1",
  "6+1",
  "penthouse",
  "townhouse",
  "villa",
  "president_villa",
] as const satisfies readonly UnitLayout[]
export type _LayoutsComplete = Exhaustive<UnitLayout, typeof unitLayouts>
