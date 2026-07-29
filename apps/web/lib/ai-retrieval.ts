/**
 * Retrieval over the evidence dataset.
 *
 * Everything the concierge is allowed to say passes through here. There is no
 * other path to a fact: the deterministic answer builder reads this module's
 * output, and so does the model's context. If a claim is not in a
 * `RetrievedFact`, it is not grounded, and `lib/ai-concierge.ts` refuses.
 *
 * ## No scoring, deliberately
 *
 * Selection is intent → a declared fact set, plus keyword targeting inside that
 * set. No embeddings, no similarity, no ranking. The dataset is 33 project and
 * hotel facts, 24 findings, 47 portal listings and 656 units — a scale where a
 * declared mapping is exhaustively reviewable and a similarity score is not.
 * When the evidence layer grows past what one table can hold, that is the point
 * to revisit; it is not this build.
 *
 * ## Provenance is carried, never summarised away
 *
 * Every `RetrievedFact` keeps its `SourceRef[]` and its `conflictsWith[]`. The
 * conflicts in particular are the product: the 1+1 entry price runs 112,000 to
 * 310,000 EUR across three publishers, a factor of 2.8 **within EUR**, with a
 * separate USD pair from a fourth. That is the most valuable thing in this
 * dataset, and an assistant that picked one number and moved on would have
 * destroyed it. (This paragraph used to quote "a 2.1x spread across four
 * publishers", which was the cross-currency division M-003 records and a
 * publisher count M-010 records as wrong. The figures above are the ones
 * `compose_f002_message()` computes.) The
 * grounded text renders every competing value with its publisher, so the model
 * physically cannot see a single tidy price to repeat.
 *
 * ## The generated dataset is narrowed at runtime, not by its own types
 *
 * `azura-world-data.ts` types `project`, `hotel`, `reviews`, `portalListings`,
 * `blocks` and `amenities` as `Record<string, unknown>` — W0-B's generator never
 * emitted the `AzuraProject` / `AzuraHotel` / `ReviewSource` / `PortalListing`
 * interfaces that CONTRACTS §2 specifies, and because the file ends in
 * `satisfies AzuraWorldDataset`, those subtrees get no contextual type at all
 * (`tier` widens to `number`, `confidence` to `string`). Reported in
 * HANDOFF/W2-C.md as a request to W0-B.
 *
 * The fix here is not a cast. Every fact is pulled through `factAt()`, which
 * walks a dotted path and runs `isSourcedFact()` — the runtime guard W0-A shipped
 * in `lib/contracts.ts` for exactly this — before the value is allowed into the
 * registry. A malformed fact is **dropped**, not rendered, and counted in
 * `datasetIntegrity`. That converts a lost compile-time convenience into a
 * runtime provenance check, which for a system whose entire premise is
 * `SourcedFact<T>` is the better half of the trade.
 */

import { azuraWorldDataset } from "./azura-world-data"
import {
  neutraliseRetrievedContent,
  normalizeForMatch,
  type AiIntent,
} from "./ai-guardrails"
import { isSourcedFact } from "./contracts"
import type {
  Confidence,
  Finding,
  Locale,
  Money,
  SourceRef,
  SourcedFact,
} from "./contracts"

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** One fact, with everything needed to state it honestly. */
export interface RetrievedFact {
  /** Dotted path into the dataset, e.g. `"project.totalUnits"`. */
  key: string
  label: string
  value: unknown
  confidence: Confidence
  sources: SourceRef[]
  conflicts: Array<{ value: unknown; source: SourceRef }>
  note: string | null
  /** Rendering suffix — `"m²"`, `"km"`, `"m"`, `"%"`. */
  unit: string | null
}

/**
 * A brand that only `saleObservation()` in this module can apply.
 *
 * M-004: a monthly rent of EUR 2,100 for 70 m² was listed by the concierge among
 * 1+1 **asking prices**, and a EUR 1,000 lower bound appeared for an 80 m²
 * apartment — EUR 12.50/m². W0-B flagged the source `priceKind: "rent"` at
 * harvest and wrote the rule down in `azura-world-data.ts`:
 *
 *   > A monthly rent must never enter the sale-price series — see F-002.
 *
 * The rule existed, the flag existed, and the projection below dropped the
 * column. So a filter alone is not the fix: the next projection would drop it
 * again. The brand makes a rent **structurally** unable to reach a price series
 * — `PriceObservation` cannot be constructed by an object literal anywhere,
 * including in this file, because `unique symbol` keys are not writable from
 * outside the module that declares them. Every observation in a price series has
 * therefore passed `saleObservation()`, which is the only place the check lives.
 */
declare const SALE_KIND: unique symbol

/**
 * One observed **sale** price for a layout, kept verbatim with its publisher.
 *
 * Constructible only by `saleObservation()`. A rent cannot be widened into this
 * type and cannot be written as a literal.
 */
export interface PriceObservation {
  layout: string | null
  interiorM2: number | null
  money: Money
  publisher: string
  url: string
  isStale: boolean
  /** Proof of the sale check. Never read; it exists so it cannot be forged. */
  readonly [SALE_KIND]: true
}

/**
 * What a listing claims its price means.
 *
 * `"unknown"` is a real third state and it is **not** treated as a sale. A
 * dataset regenerated without the column would produce an empty price series —
 * loud, and reported by `excludedNonSale` below — rather than silently
 * readmitting the rents. Fail closed: the cost of a missing price is a visible
 * gap, and the cost of a wrong one is this finding.
 */
export type ListingPriceKind = "sale" | "rent" | "unknown"

/**
 * The only constructor for a `PriceObservation`.
 *
 * Returns `null` for anything that is not a proven sale. The cast is the single
 * point where the brand is applied, and it is unreachable for a non-sale row
 * because of the guard directly above it.
 */
function saleObservation(
  row: ListingRow,
  money: Money
): PriceObservation | null {
  if (row.priceKind !== "sale") return null
  return {
    layout: row.layout,
    interiorM2: row.interiorM2,
    money,
    publisher: row.publisher,
    url: row.url,
    isStale: row.isStale,
  } as PriceObservation
}

export interface RetrievalResult {
  intent: AiIntent
  facts: RetrievedFact[]
  findings: Finding[]
  prices: PriceObservation[]
  /**
   * Sale-price rows withheld from `prices`, by reason. M-004: two rental
   * listings were being answered as asking prices. The counts are surfaced in
   * the answer rather than dropped quietly.
   */
  excludedNonSale: { rent: number; unknown: number }
  /** Populated only when the message named a unit. */
  unit: {
    id: string
    found: boolean
    layout: string | null
    interiorM2: number | null
    price: Money | null
    dataQuality: string | null
    note: string | null
    sources: SourceRef[]
  } | null
  citations: SourceRef[]
  /** False ⟹ the concierge must refuse with `no_grounding`. */
  grounded: boolean
  /** Fenced, injection-neutralised text. Safe to place in a model context. */
  groundedContext: string
}

// ---------------------------------------------------------------------------
// Fact registry
// ---------------------------------------------------------------------------

type LabelSet = Record<Locale, string>

interface RegistryEntry {
  key: string
  labels: LabelSet
  intents: readonly AiIntent[]
  terms: readonly string[]
  unit: string | null
  fact: SourcedFact<unknown>
}

/** Counts of what the dataset offered and what survived validation. */
const integrity = { requested: 0, accepted: 0, rejected: [] as string[] }

/**
 * Resolves a dotted path into a validated `SourcedFact`.
 *
 * Returns `null` — never a partially-trusted object — when the path is missing
 * or the value does not satisfy `isSourcedFact`. The caller drops the entry, so
 * a malformed regeneration loses a fact rather than rendering an unsourced one.
 */
function factAt(path: string): SourcedFact<unknown> | null {
  integrity.requested += 1
  let cursor: unknown = azuraWorldDataset
  for (const segment of path.split(".")) {
    if (typeof cursor !== "object" || cursor === null) return null
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  if (!isSourcedFact<unknown>(cursor)) {
    integrity.rejected.push(path)
    return null
  }
  integrity.accepted += 1
  return cursor
}

function entry(
  key: string,
  labels: LabelSet,
  intents: readonly AiIntent[],
  terms: readonly string[],
  unit: string | null = null
): RegistryEntry | null {
  const fact = factAt(key)
  return fact === null ? null : { key, labels, fact, intents, terms, unit }
}

const l = (de: string, en: string, tr: string, ru: string): LabelSet => ({
  de,
  en,
  tr,
  ru,
})

const registryCandidates: ReadonlyArray<RegistryEntry | null> = [
  entry(
    "project.totalUnits",
    l("Wohnungen gesamt", "Total units", "Toplam daire", "Всего квартир"),
    ["inventory", "project"],
    [
      "wohnung",
      "einheit",
      "unit",
      "apartment",
      "daire",
      "квартир",
      "viele",
      "many",
      "kac",
      "сколько",
    ]
  ),
  entry(
    "project.residenceBlockCount",
    l("Wohnblöcke", "Residence blocks", "Konut bloğu", "Жилых блоков"),
    ["inventory", "project"],
    ["block", "blocke", "blok", "блок"]
  ),
  entry(
    "project.buildingCount",
    l("Gebäude", "Buildings", "Bina", "Зданий"),
    ["inventory", "project"],
    ["gebaude", "building", "bina", "здани", "block", "blok"]
  ),
  entry(
    "project.floorsPerBuilding",
    l(
      "Etagen je Gebäude",
      "Floors per building",
      "Bina başına kat",
      "Этажей в здании"
    ),
    ["project", "inventory"],
    ["etage", "stock", "floor", "kat", "этаж"]
  ),
  entry(
    "project.plotAreaSqm",
    l("Grundstücksfläche", "Plot area", "Arsa alanı", "Площадь участка"),
    ["project"],
    ["grundstuck", "flache", "plot", "area", "arsa", "участок", "площад"],
    "m²"
  ),
  entry(
    "project.greenAreaSqm",
    l("Grünfläche", "Green area", "Yeşil alan", "Зелёная зона"),
    ["project"],
    ["grun", "green", "yesil", "зелен"],
    "m²"
  ),
  entry(
    "project.buildingFootprintSqm",
    l(
      "Bebaute Fläche",
      "Building footprint",
      "Yapı taban alanı",
      "Площадь застройки"
    ),
    ["project"],
    ["bebaut", "footprint", "taban", "застройк"],
    "m²"
  ),
  entry(
    "project.outdoorFacilityAreaSqm",
    l(
      "Außenanlagen",
      "Outdoor facilities",
      "Açık alan tesisleri",
      "Открытые зоны"
    ),
    ["project"],
    ["aussenanlage", "outdoor", "acik alan", "открыт"],
    "m²"
  ),
  entry(
    "project.constructionStart",
    l(
      "Baubeginn",
      "Construction start",
      "İnşaat başlangıcı",
      "Начало строительства"
    ),
    ["project"],
    ["baubeginn", "construction", "insaat", "строительств", "begonnen"]
  ),
  entry(
    "project.completionDate",
    l("Fertigstellung", "Completion", "Teslim", "Сдача"),
    ["project", "inventory"],
    ["fertig", "completion", "teslim", "сдач", "wann"]
  ),
  entry(
    "project.buildStatus",
    l("Bauzustand", "Build status", "Yapım durumu", "Статус строительства"),
    ["project", "inventory"],
    ["bauzustand", "status", "fertig", "im bau", "durum", "готов", "построен"]
  ),
  entry(
    "project.distanceToSeaM",
    l(
      "Entfernung zum Meer",
      "Distance to sea",
      "Denize mesafe",
      "Расстояние до моря"
    ),
    ["project"],
    ["meer", "strand", "sea", "beach", "deniz", "море", "пляж"],
    "m"
  ),
  entry(
    "project.distanceToAlanyaCentreKm",
    l(
      "Entfernung Alanya Zentrum",
      "Distance to Alanya centre",
      "Alanya merkeze mesafe",
      "До центра Алании"
    ),
    ["project"],
    ["zentrum", "centre", "center", "merkez", "центр"],
    "km"
  ),
  entry(
    "project.distanceToGazipasaAirportKm",
    l(
      "Entfernung Flughafen Gazipaşa",
      "Distance to Gazipaşa airport",
      "Gazipaşa havalimanına mesafe",
      "До аэропорта Газипаша"
    ),
    ["project"],
    ["gazipasa", "flughafen", "airport", "havalimani", "аэропорт"],
    "km"
  ),
  entry(
    "project.distanceToAntalyaAirportKm",
    l(
      "Entfernung Flughafen Antalya",
      "Distance to Antalya airport",
      "Antalya havalimanına mesafe",
      "До аэропорта Анталья"
    ),
    ["project"],
    ["antalya", "flughafen", "airport", "havalimani", "аэропорт"],
    "km"
  ),
  entry(
    "project.downPaymentPercent",
    l("Anzahlung", "Down payment", "Peşinat", "Первый взнос"),
    ["pricing", "finance"],
    ["anzahlung", "down payment", "pesinat", "взнос", "rate"],
    "%"
  ),
  entry(
    "project.developer",
    l("Bauträger", "Developer", "Geliştirici", "Застройщик"),
    ["developer", "project"],
    [
      "bautrager",
      "entwickler",
      "developer",
      "cebeci",
      "gelistirici",
      "застройщик",
    ]
  ),
  entry(
    "project.developerFoundedYear",
    l(
      "Bauträger gegründet",
      "Developer founded",
      "Kuruluş yılı",
      "Год основания"
    ),
    ["developer"],
    [
      "gegrundet",
      "founded",
      "erfahrung",
      "experience",
      "kurulus",
      "основан",
      "лет",
    ]
  ),
  entry(
    "project.contact.phone",
    l("Telefon", "Phone", "Telefon", "Телефон"),
    ["contact"],
    ["telefon", "phone", "anrufen", "call", "ara", "телефон"]
  ),
  entry(
    "project.contact.email",
    l("E-Mail", "Email", "E-posta", "Эл. почта"),
    ["contact"],
    ["email", "e mail", "mail", "posta", "почт"]
  ),
  entry(
    "project.contact.address",
    l("Adresse", "Address", "Adres", "Адрес"),
    ["contact"],
    ["adresse", "address", "adres", "адрес", "buro", "office"]
  ),
  entry(
    "hotel.name",
    l("Hotelname", "Hotel name", "Otel adı", "Название отеля"),
    ["hotel"],
    ["hotel", "otel", "отель", "name"]
  ),
  entry(
    "hotel.formerName",
    l(
      "Früherer Hotelname",
      "Former hotel name",
      "Önceki otel adı",
      "Прежнее название"
    ),
    ["hotel", "reviews"],
    [
      "wyndham",
      "fruher",
      "former",
      "ex",
      "umbenannt",
      "rebrand",
      "eski",
      "прежн",
      "бывш",
    ]
  ),
  entry(
    "hotel.brandAffiliation",
    l(
      "Markenbindung",
      "Brand affiliation",
      "Marka bağlantısı",
      "Принадлежность к бренду"
    ),
    ["hotel"],
    ["wyndham", "marke", "brand", "kette", "chain", "marka", "бренд", "сеть"]
  ),
  entry(
    "hotel.stars",
    l("Sterne", "Stars", "Yıldız", "Звёзд"),
    ["hotel"],
    ["stern", "star", "yildiz", "звезд"]
  ),
  entry(
    "hotel.roomCount",
    l("Hotelzimmer", "Hotel rooms", "Otel odası", "Номеров"),
    ["hotel"],
    ["zimmer", "room", "oda", "номер"]
  ),
  entry(
    "hotel.floors",
    l("Hoteletagen", "Hotel floors", "Otel katı", "Этажей отеля"),
    ["hotel"],
    ["etage", "floor", "kat", "этаж"]
  ),
  entry(
    "hotel.openedYear",
    l("Hoteleröffnung", "Hotel opened", "Otel açılışı", "Год открытия"),
    ["hotel"],
    ["eroffnet", "opened", "acilis", "открыт"]
  ),
  entry(
    "hotel.board",
    l("Verpflegung", "Board", "Pansiyon", "Питание"),
    ["hotel"],
    ["verpflegung", "all inclusive", "board", "pansiyon", "питание"]
  ),
  entry(
    "hotel.aquaparkSlides",
    l(
      "Rutschen im Aquapark",
      "Aquapark slides",
      "Aquapark kaydırağı",
      "Горок в аквапарке"
    ),
    ["hotel"],
    ["rutsch", "slide", "aquapark", "kaydirak", "горк", "аквапарк"]
  ),
  entry(
    "hotel.distanceToBeachM",
    l(
      "Hotel zum Strand",
      "Hotel to beach",
      "Otelden plaja",
      "От отеля до пляжа"
    ),
    ["hotel", "project"],
    ["strand", "beach", "plaj", "пляж"],
    "m"
  ),
  entry(
    "hotel.checkIn",
    l("Check-in", "Check-in", "Giriş", "Заезд"),
    ["hotel"],
    ["check in", "anreise", "giris", "заезд"]
  ),
  entry(
    "hotel.checkOut",
    l("Check-out", "Check-out", "Çıkış", "Выезд"),
    ["hotel"],
    ["check out", "abreise", "cikis", "выезд"]
  ),
]

/** Entries whose fact failed `isSourcedFact` are dropped, never rendered. */
const registry: readonly RegistryEntry[] = registryCandidates.filter(
  (candidate): candidate is RegistryEntry => candidate !== null
)

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** How many facts may enter one context. Enough to answer; short enough to read. */
const MAX_FACTS = 10
const MAX_FINDINGS = 4
/** Generous: `describePriceSpread` groups these by publisher before display. */
const MAX_PRICES = 24

function matchScore(entry: RegistryEntry, text: string): number {
  let score = 0
  for (const term of entry.terms) {
    if (text.includes(term)) score += 1
  }
  return score
}

function selectFacts(intent: AiIntent, text: string): RegistryEntry[] {
  const inIntent = registry.filter((e) => e.intents.includes(intent))
  const pool = inIntent.length > 0 ? inIntent : registry

  const scored = pool
    .map((e) => ({ e, score: matchScore(e, text) }))
    .sort((a, b) => b.score - a.score)

  // A keyword must land. There is deliberately no "return the intent's whole
  // declared set" fallback: with one, "Wie ist die Rendite?" classifies as
  // `finance`, finds `project.downPaymentPercent` sitting in that intent, and
  // answers a question about yield with an unrelated fact about the deposit —
  // grounded in the letter and misleading in substance. No keyword hit means no
  // facts, which means `grounded === false`, which means the concierge refuses.
  // That is the correct answer to a question the evidence cannot address.
  return scored
    .filter((s) => s.score > 0)
    .map((s) => s.e)
    .slice(0, MAX_FACTS)
}

const LAYOUT_RE = /\b([1-6])\s*\+\s*1\b/
const UNIT_ID_RE = /\b(?:azw-)?b\s*-?\s*(\d{1,2})\s*-\s*(\d{1,4})\b/i

/** `"B3-0412"`, `"azw b03 0412"`, `"AZW-B03-0412"` → `"AZW-B03-0412"`. */
export function normaliseUnitId(message: string): string | null {
  const match = UNIT_ID_RE.exec(message)
  if (match === null) return null
  const block = match[1]
  const sequence = match[2]
  if (block === undefined || sequence === undefined) return null
  return `AZW-B${block.padStart(2, "0")}-${sequence.padStart(4, "0")}`
}

function detectLayout(message: string): string | null {
  const match = LAYOUT_RE.exec(message)
  return match?.[1] !== undefined ? `${match[1]}+1` : null
}

/**
 * The fields this module needs from a portal listing.
 *
 * A local shape rather than `PortalListing` from CONTRACTS §2, because the
 * generated dataset types `portalListings` as `Record<string, unknown>[]` (see
 * the module header) and there is nothing to import it *from*. Every row is
 * narrowed by `narrowListing` before use, so an added or renamed column in a
 * regenerated dataset drops the row instead of producing `undefined` inside a
 * price sentence.
 */
interface ListingRow {
  publisher: string
  url: string
  fetchedAt: string
  layout: string | null
  interiorM2: number | null
  price: Money | null
  isStale: boolean
  /**
   * M-004: this field was missing, and that omission is where the sale/rent
   * distinction was lost. The dataset carries `priceKind` on every portal
   * listing (`scripts/sources.config.json` sets it per source and
   * `build-azura-dataset.py` emits it); `narrowListing` simply did not read it,
   * so `selectPrices` had nothing to filter on and two rental listings entered
   * the asking-price answer.
   */
  priceKind: ListingPriceKind
}

function narrowMoney(value: unknown): Money | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as { amount?: unknown; currency?: unknown }
  if (typeof record.amount !== "number") return null
  const currency = record.currency
  if (
    currency !== "EUR" &&
    currency !== "USD" &&
    currency !== "TRY" &&
    currency !== "GBP"
  ) {
    return null
  }
  return { amount: record.amount, currency }
}

function narrowListing(value: unknown): ListingRow | null {
  if (typeof value !== "object" || value === null) return null
  const row = value as Record<string, unknown>
  if (typeof row["publisher"] !== "string" || typeof row["url"] !== "string") {
    return null
  }
  return {
    publisher: row["publisher"],
    url: row["url"],
    fetchedAt: typeof row["fetchedAt"] === "string" ? row["fetchedAt"] : "",
    layout: typeof row["layout"] === "string" ? row["layout"] : null,
    interiorM2:
      typeof row["interiorM2"] === "number" ? row["interiorM2"] : null,
    price: narrowMoney(row["price"]),
    isStale: row["isStale"] === true,
    // Anything that is not literally "sale" or "rent" is "unknown", and
    // "unknown" is not a sale. A renamed or dropped column therefore empties the
    // price series instead of quietly refilling it with rents.
    priceKind:
      row["priceKind"] === "sale"
        ? "sale"
        : row["priceKind"] === "rent"
          ? "rent"
          : "unknown",
  }
}

/** Every validated listing row. Computed once; the dataset is a frozen const. */
const listingRows: readonly ListingRow[] = azuraWorldDataset.portalListings
  .map(narrowListing)
  .filter((row): row is ListingRow => row !== null)

/** A price series, and what was kept out of it. */
export interface PriceSelection {
  observations: PriceObservation[]
  /**
   * Rows excluded for not being a sale, by kind. **Reported, never silent** —
   * the project's rule is that a value is dropped only with a reason a reader
   * can see, and "we removed two rentals" is a fact about the market's data
   * quality, not housekeeping.
   */
  excludedNonSale: { rent: number; unknown: number }
}

/**
 * Every observed **sale** price for a layout.
 *
 * Retrieval's job is completeness; readability is the answer builder's problem
 * (`describePriceSpread` groups these by publisher). Pruning at this layer was
 * tried and was wrong in two different ways: taking the twelve cheapest returned
 * eight Haspo Realty rows and dropped Housearch's USD listing entirely, so the
 * answer surveyed one portal while looking like a survey of the market; taking
 * each publisher's cheapest and dearest dropped Haspo's EUR 112,000 entry price,
 * which is the figure the conflict register (F-002) is actually about.
 *
 * Both failures share a cause: deciding which observation matters is a judgement,
 * and this project's whole premise is that we do not make that judgement
 * silently. So the model sees all of them, and the reader sees them grouped.
 *
 * **The one exclusion is not a judgement.** A monthly rent is not a cheap asking
 * price, it is a different quantity, and mixing the two is the error M-004
 * records. It happens in `saleObservation()`, is counted, and is stated in the
 * answer.
 */
function selectPrices(layout: string | null): PriceSelection {
  const priced = listingRows.filter((item) => item.price !== null)
  const matching =
    layout === null ? priced : priced.filter((item) => item.layout === layout)
  // A layout with no observations falls back to the whole priced set rather than
  // to nothing: "was kostet eine 6+1" should show what IS published, not refuse.
  const source = matching.length > 0 ? matching : priced

  const observations: PriceObservation[] = []
  const excludedNonSale = { rent: 0, unknown: 0 }

  for (const item of source) {
    const money = item.price
    if (money === null) continue
    const observation = saleObservation(item, money)
    if (observation === null) {
      // The rent/unknown split is kept apart: a rental listing is a real
      // publication about this project, and an unlabelled row is a gap in our
      // own pipeline. They are different problems for different people.
      if (item.priceKind === "rent") excludedNonSale.rent += 1
      else excludedNonSale.unknown += 1
      continue
    }
    observations.push(observation)
  }

  // Cheapest first, so the spread reads as a range rather than a list.
  observations.sort((a, b) => a.money.amount - b.money.amount)
  return { observations: observations.slice(0, MAX_PRICES), excludedNonSale }
}

function selectFindings(
  intent: AiIntent,
  factKeys: readonly string[]
): Finding[] {
  const findings: readonly Finding[] = azuraWorldDataset.findings
  const areaByIntent: Partial<Record<AiIntent, Finding["area"][]>> = {
    pricing: ["pricing"],
    inventory: ["structure", "availability"],
    project: ["structure", "timeline", "geography", "availability"],
    hotel: ["branding"],
    reviews: ["branding"],
    developer: ["structure", "branding"],
    evidence: [
      "harvest",
      "structure",
      "pricing",
      "branding",
      "geography",
      "availability",
      "timeline",
    ],
    finance: ["pricing"],
  }

  const wanted = new Set(areaByIntent[intent] ?? [])
  const byField = findings.filter((f) =>
    factKeys.some((key) => f.field === key || f.field.startsWith(`${key}.`))
  )
  const byArea = findings.filter((f) => wanted.has(f.area))

  const seen = new Set<string>()
  const merged: Finding[] = []
  for (const finding of [...byField, ...byArea]) {
    if (seen.has(finding.id)) continue
    seen.add(finding.id)
    merged.push(finding)
  }
  const severityRank: Record<Finding["severity"], number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  }
  merged.sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
  return merged.slice(0, MAX_FINDINGS)
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderValue(value: unknown, unit: string | null): string {
  if (value === null || value === undefined)
    return "nicht belegt / not established"
  if (typeof value === "object") {
    const money = value as Partial<Money>
    if (
      typeof money.amount === "number" &&
      typeof money.currency === "string"
    ) {
      return `${money.amount.toLocaleString("de-DE")} ${money.currency}`
    }
    return JSON.stringify(value)
  }
  const base =
    typeof value === "number" ? value.toLocaleString("de-DE") : String(value)
  return unit === null ? base : `${base} ${unit}`
}

function renderSource(source: SourceRef): string {
  return `${source.publisher} (tier ${source.tier}, ${source.url})`
}

/**
 * The text the model sees.
 *
 * Every line carries the value, the confidence, and the publisher of every
 * source — including the losing values of a conflict. Rendering the conflicts
 * inline is what makes "present the conflict" the model's easiest path rather
 * than an instruction it has to remember: there is no single tidy number in the
 * context to repeat.
 */
function buildGroundedText(
  facts: RetrievedFact[],
  findings: Finding[],
  prices: PriceObservation[],
  unit: RetrievalResult["unit"]
): string {
  const lines: string[] = []

  if (facts.length > 0) {
    lines.push("FACTS")
    for (const fact of facts) {
      lines.push(
        `- ${fact.label} [${fact.key}] = ${renderValue(fact.value, fact.unit)}  (confidence: ${fact.confidence})`
      )
      for (const source of fact.sources) {
        lines.push(`    source: ${renderSource(source)}`)
      }
      for (const conflict of fact.conflicts) {
        lines.push(
          `    COMPETING VALUE: ${renderValue(conflict.value, fact.unit)} — ${renderSource(conflict.source)}`
        )
      }
      if (fact.note !== null && fact.note.length > 0) {
        lines.push(`    note: ${fact.note}`)
      }
    }
  }

  if (prices.length > 0) {
    lines.push("", "OBSERVED PRICES (verbatim portal listings, never averaged)")
    for (const price of prices) {
      const size =
        price.interiorM2 === null ? "size not stated" : `${price.interiorM2} m²`
      const stale = price.isStale
        ? " [listing contradicts a tier<=3 source: treat as possibly stale]"
        : ""
      lines.push(
        `- ${price.layout ?? "layout not stated"}, ${size}: ${price.money.amount.toLocaleString("de-DE")} ${price.money.currency} — ${price.publisher} (${price.url})${stale}`
      )
    }
    lines.push(
      "  NOTE: these are different publishers' asking prices for the same project, in different currencies. Never convert, never average, never present one as THE price."
    )
  }

  if (unit !== null) {
    lines.push("", "UNIT LOOKUP")
    if (!unit.found) {
      lines.push(
        `- ${unit.id}: NOT PRESENT in the inventory. Unit ids run AZW-B01-0001 to AZW-B07-0093 across 7 blocks.`
      )
      lines.push(
        "  No source publishes a unit-by-unit inventory for this project; the ids are an internal addressing key, not developer unit numbers."
      )
    } else {
      lines.push(
        `- ${unit.id}: layout ${unit.layout ?? "unknown"}, ${unit.interiorM2 ?? "unknown"} m², price ${unit.price === null ? "not established" : `${unit.price.amount.toLocaleString("de-DE")} ${unit.price.currency}`}, dataQuality: ${unit.dataQuality ?? "unknown"}`
      )
      if (unit.dataQuality === "modelled") {
        lines.push(
          "  MODELLED, NOT A REAL LISTING. This unit was synthesised to fill the corroborated 656-unit inventory. It must never be presented as a listing a buyer can act on."
        )
      }
      if (unit.note !== null) lines.push(`  note: ${unit.note}`)
      for (const source of unit.sources) {
        lines.push(`    source: ${renderSource(source)}`)
      }
    }
  }

  if (findings.length > 0) {
    lines.push(
      "",
      "RECORDED FINDINGS (disagreements between sources, never silently resolved)"
    )
    for (const finding of findings) {
      lines.push(
        `- ${finding.id} [${finding.severity}/${finding.area}] ${finding.field}: ${finding.message}`
      )
      lines.push(
        `    resolution: ${finding.resolution}  resolvedTo: ${finding.resolvedTo === null ? "deliberately unresolved" : JSON.stringify(finding.resolvedTo)}`
      )
    }
  }

  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function collectCitations(
  facts: readonly RetrievedFact[],
  prices: readonly PriceObservation[],
  unit: RetrievalResult["unit"],
  findings: readonly Finding[]
): SourceRef[] {
  const byUrl = new Map<string, SourceRef>()
  const add = (source: SourceRef): void => {
    if (!byUrl.has(source.url)) byUrl.set(source.url, source)
  }
  for (const fact of facts) {
    for (const source of fact.sources) add(source)
    for (const conflict of fact.conflicts) add(conflict.source)
  }
  if (unit !== null) {
    for (const source of unit.sources) add(source)
  }
  // A finding's competing values carry the sources that disagreed. Without
  // these, an answer built purely from the conflict register would render
  // "[0 Quellen]" while quoting four publishers' numbers.
  for (const finding of findings) {
    for (const competing of finding.competingValues) add(competing.source)
  }
  // Portal observations are cited through the fact/unit sources they came from
  // where possible; where a listing has no matching fact, synthesise the ref
  // from the listing itself so a rendered price is never uncited.
  for (const price of prices) {
    if (byUrl.has(price.url)) continue
    const listing = listingRows.find((item) => item.url === price.url)
    if (listing === undefined) continue
    add({
      url: listing.url,
      publisher: listing.publisher,
      fetchedAt: listing.fetchedAt,
      // Portal listings in the dataset carry no snapshot hash of their own;
      // they are derived rows. The url and fetchedAt are the citation. A
      // zero-hash is used rather than a fabricated one so `verify-evidence.mjs`
      // can tell the difference.
      snapshotHash: "0".repeat(64),
      tier: 4,
    })
  }
  return Array.from(byUrl.values())
}

/**
 * Retrieves everything the concierge may use for one question.
 *
 * `grounded === false` is a first-class outcome, not an error: it is what
 * happens when someone asks about rental yield, and the correct response is a
 * refusal. Callers must not "try the model anyway" — see `lib/ai-concierge.ts`.
 */
export function retrieve(input: {
  intent: AiIntent
  message: string
  locale: Locale
}): RetrievalResult {
  const text = normalizeForMatch(input.message)
  const selected = selectFacts(input.intent, text)

  const facts: RetrievedFact[] = selected.map((e) => ({
    key: e.key,
    label: e.labels[input.locale],
    value: e.fact.value,
    confidence: e.fact.confidence,
    sources: e.fact.sources,
    conflicts: e.fact.conflictsWith ?? [],
    note: e.fact.note ?? null,
    unit: e.unit,
  }))

  const wantsPrices =
    input.intent === "pricing" ||
    (input.intent === "inventory" &&
      /preis|price|fiyat|цена|kostet|cost/.test(text))
  const priceSelection: PriceSelection = wantsPrices
    ? selectPrices(detectLayout(input.message))
    : { observations: [], excludedNonSale: { rent: 0, unknown: 0 } }
  const prices = priceSelection.observations

  const unitId = normaliseUnitId(input.message)
  let unit: RetrievalResult["unit"] = null
  if (unitId !== null) {
    const found = azuraWorldDataset.units.find((u) => u.id === unitId)
    unit =
      found === undefined
        ? {
            id: unitId,
            found: false,
            layout: null,
            interiorM2: null,
            price: null,
            dataQuality: null,
            note: null,
            sources: [],
          }
        : {
            id: found.id,
            found: true,
            layout: found.layout,
            interiorM2: found.interiorM2,
            price: found.askingPrice.value,
            dataQuality: found.dataQuality,
            note: found.askingPrice.note ?? null,
            sources: found.askingPrice.sources,
          }
  }

  const findings = selectFindings(
    input.intent,
    facts.map((f) => f.key)
  )
  const citations = collectCitations(facts, prices, unit, findings)

  // A fact whose confidence is "gap" carries a null value and grounds nothing.
  // Requiring at least one non-gap fact, price or unit is what makes
  // "Wie ist die Rendite?" refuse instead of answering with adjacent trivia.
  //
  // Findings count as grounding for the `evidence` intent only. "Welche
  // Widersprüche gibt es?" IS answered by the conflict register; "Wie ist die
  // Rendite?" is not answered by a pricing conflict that happens to be nearby.
  const substantive =
    facts.some((f) => f.confidence !== "gap" && f.value !== null) ||
    prices.length > 0 ||
    unit !== null ||
    (input.intent === "evidence" && findings.length > 0)

  const groundedContext = buildGroundedText(facts, findings, prices, unit)

  return {
    intent: input.intent,
    facts,
    findings,
    prices,
    excludedNonSale: priceSelection.excludedNonSale,
    unit,
    citations,
    grounded: substantive && groundedContext.length > 0,
    // Neutralised here, at the point untrusted portal bytes enter the pipeline,
    // rather than at the point they leave it.
    groundedContext: neutraliseRetrievedContent(groundedContext),
  }
}

/**
 * How many registry paths resolved to a valid `SourcedFact`.
 *
 * `rejected` being non-empty means a regenerated dataset changed shape and the
 * concierge is now silently missing facts — the probe asserts it is empty, so
 * that regression fails a gate instead of quietly narrowing what the assistant
 * can answer.
 */
export const datasetIntegrity: {
  requested: number
  accepted: number
  rejected: readonly string[]
} = integrity

/** Dataset-level facts the concierge may state without a retrieval hit. */
export const datasetSummary = {
  generatedAt: azuraWorldDataset.generatedAt,
  units: azuraWorldDataset.units.length,
  blocks: azuraWorldDataset.blocks.length,
  findings: azuraWorldDataset.findings.length,
  portalListings: azuraWorldDataset.portalListings.length,
  sourcesTotal: azuraWorldDataset.harvest.length,
  sourcesValidated: azuraWorldDataset.harvest.filter((h) => h.contentValidated)
    .length,
} as const
