/**
 * Deterministic answers and refusal copy.
 *
 * This module is the concierge's floor. It is computed **before** the gateway is
 * consulted and it is what gets sent whenever the gateway is absent, slow,
 * broken, or produces something the grounding check rejects. Three consequences
 * follow, and all three are the point:
 *
 *  - The endpoint cannot 5xx for lack of a model.
 *  - The e2e path is identical with and without a gateway configured.
 *  - A model reply is only ever an *improvement in phrasing* over an answer that
 *    was already correct and already cited.
 *
 * Every sentence built here is assembled from `RetrievedFact` values and their
 * `SourceRef`s. Nothing is written from knowledge; there is no branch that can
 * emit a number this module did not read out of the dataset.
 *
 * ## Conflicts are the product
 *
 * The 1+1 entry price spans 112.000 € (Haspo) to 239.171 USD (Housearch) — a
 * factor of 2.1 across four publishers, one of which still lists the project as
 * under construction two years after a corroborated completion date. An
 * assistant that answered "ab 112.000 €" would be technically sourced and
 * completely useless. `describePriceSpread` therefore has no single-value path:
 * when more than one observation exists it always renders the range, the
 * publishers and the staleness warning.
 */

import type { PriceObservation, RetrievalResult } from "./ai-retrieval"
import type { RefusalKind } from "./ai-guardrails"
import type { Finding, Locale, SourceRef } from "./contracts"

// ---------------------------------------------------------------------------
// Small localisation helpers
// ---------------------------------------------------------------------------

type Phrase = Record<Locale, string>

const NOT_ESTABLISHED: Phrase = {
  de: "nicht belegt",
  en: "not established",
  tr: "belgelenmemiş",
  ru: "не подтверждено",
}

const SOURCES_WORD: Phrase = {
  de: "Quellen",
  en: "sources",
  tr: "kaynak",
  ru: "источник(ов)",
}

const SOURCE_WORD: Phrase = {
  de: "Quelle",
  en: "source",
  tr: "kaynak",
  ru: "источник",
}

const CONFLICT_LEAD: Phrase = {
  de: "Die Quellen widersprechen sich.",
  en: "The sources disagree.",
  tr: "Kaynaklar birbiriyle çelişiyor.",
  ru: "Источники противоречат друг другу.",
}

const HANDOFF: Phrase = {
  de: "Für alles Kaufmännische — Preis, Reservierung, Zahlungsplan, Besichtigung — vermittle ich gern an einen Menschen.",
  en: "For anything commercial — price, reservation, payment plan, viewing — I can hand you over to a person.",
  tr: "Ticari her konuda — fiyat, rezervasyon, ödeme planı, yerinde görme — sizi bir kişiye yönlendirebilirim.",
  ru: "По любым коммерческим вопросам — цена, бронирование, план оплаты, просмотр — могу передать вас человеку.",
}

function numberFormat(locale: Locale): Intl.NumberFormat {
  const tag = locale === "de" ? "de-DE" : locale === "tr" ? "tr-TR" : locale === "ru" ? "ru-RU" : "en-GB"
  return new Intl.NumberFormat(tag)
}

/**
 * Publisher names in parentheses. Not localised on purpose: a publisher is a
 * proper noun, and "Haspo Realty" is the same citation in all four languages.
 * Translating it would break the link between what the reader sees and what the
 * source register (SOURCES.md) calls the same host.
 */
function citeInline(sources: readonly SourceRef[]): string {
  if (sources.length === 0) return ""
  const names = Array.from(new Set(sources.map((s) => s.publisher)))
  return ` (${names.join(", ")})`
}

function countSources(sources: readonly SourceRef[], locale: Locale): string {
  const distinct = new Set(sources.map((s) => s.publisher)).size
  const word = distinct === 1 ? SOURCE_WORD[locale] : SOURCES_WORD[locale]
  return `[${distinct} ${word}]`
}

// ---------------------------------------------------------------------------
// Fact sentences
// ---------------------------------------------------------------------------

function renderScalar(
  value: unknown,
  unit: string | null,
  locale: Locale
): string {
  if (value === null || value === undefined) return NOT_ESTABLISHED[locale]
  if (typeof value === "number") {
    const formatted = numberFormat(locale).format(value)
    return unit === null ? formatted : `${formatted} ${unit}`
  }
  if (typeof value === "object") {
    const money = value as { amount?: unknown; currency?: unknown }
    if (typeof money.amount === "number" && typeof money.currency === "string") {
      return `${numberFormat(locale).format(money.amount)} ${money.currency}`
    }
    return JSON.stringify(value)
  }
  const text = String(value)
  return unit === null ? text : `${text} ${unit}`
}

/**
 * One fact as a sentence, with its sources and — when it is conflicted — every
 * competing value and who published it. There is deliberately no code path that
 * renders a conflicted fact as a single number.
 */
function describeFact(
  fact: RetrievalResult["facts"][number],
  locale: Locale
): string {
  const value = renderScalar(fact.value, fact.unit, locale)

  if (fact.confidence === "gap") {
    const why = fact.note === null ? "" : ` ${fact.note}`
    return `${fact.label}: ${NOT_ESTABLISHED[locale]}.${why}`
  }

  if (fact.confidence === "conflicted" && fact.conflicts.length > 0) {
    const competing = fact.conflicts
      .slice(0, 5)
      .map(
        (c) =>
          `${renderScalar(c.value, fact.unit, locale)} (${c.source.publisher})`
      )
      .join(" · ")
    const more =
      fact.conflicts.length > 5 ? ` +${fact.conflicts.length - 5}` : ""
    return `${fact.label}: ${value}${citeInline(fact.sources)}. ${CONFLICT_LEAD[locale]} ${competing}${more}. ${countSources(fact.sources, locale)}`
  }

  return `${fact.label}: ${value}${citeInline(fact.sources)}. ${countSources(fact.sources, locale)}`
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

const PRICE_LEAD: Phrase = {
  de: "Beobachtete Angebotspreise verschiedener Portale für dasselbe Projekt",
  en: "Asking prices observed on different portals for the same project",
  tr: "Aynı proje için farklı portallarda gözlenen satış fiyatları",
  ru: "Запрашиваемые цены, наблюдаемые на разных порталах для одного и того же проекта",
}

const PRICE_NO_CONVERT: Phrase = {
  de: "Die Beträge stehen in unterschiedlichen Währungen und werden nicht umgerechnet; ein Mittelwert wäre eine erfundene Zahl.",
  en: "The amounts are in different currencies and are not converted; an average would be an invented number.",
  tr: "Tutarlar farklı para birimlerindedir ve dönüştürülmez; ortalama uydurma bir sayı olurdu.",
  ru: "Суммы указаны в разных валютах и не пересчитываются; среднее было бы выдуманной цифрой.",
}

const PRICE_STALE: Phrase = {
  de: "Mit „veraltet?“ markierte Inserate widersprechen einer Quelle höherer Stufe (siehe F-006).",
  en: 'Listings marked "stale?" contradict a higher-tier source (see F-006).',
  tr: "“eskimiş?” olarak işaretlenen ilanlar daha üst kademe bir kaynakla çelişiyor (bkz. F-006).",
  ru: "Объявления с пометкой «устарело?» противоречат источнику более высокого уровня (см. F-006).",
}

const PRICE_SPREAD: Phrase = {
  de: "Spanne",
  en: "Spread",
  tr: "Aralık",
  ru: "Разброс",
}

const SPREAD_FACTOR: Phrase = {
  de: "Faktor",
  en: "factor",
  tr: "kat",
  ru: "во",
}

/** Names the derivation, so a computed figure is never mistaken for a sourced one. */
const SPREAD_DERIVED: Phrase = {
  de: "(errechnet aus diesen beiden Beobachtungen, nicht von einer Quelle genannt)",
  en: "(computed from these two observations; no source states it)",
  tr: "(bu iki gözlemden hesaplandı; hiçbir kaynak belirtmiyor)",
  ru: "(рассчитано по этим двум наблюдениям; ни один источник его не приводит)",
}

const LISTING_COUNT: Phrase = {
  de: "Inserate",
  en: "listings",
  tr: "ilan",
  ru: "объявлений",
}

/**
 * One line per publisher, showing that publisher's full observed range.
 *
 * Not one line per listing. Haspo Realty publishes nine 1+1 listings and
 * Seaside two; listing them flat makes the answer read as "Haspo says nine
 * different things and two other portals exist", which is a true sentence that
 * leaves the wrong impression. Grouping puts each publisher on equal footing,
 * which is the comparison a reader actually wants, and it keeps every
 * observation — including the EUR 1,000 row that is obviously a placeholder —
 * visible inside its publisher's range rather than quietly dropped.
 */
export function describePriceSpread(
  prices: readonly PriceObservation[],
  locale: Locale
): string {
  if (prices.length === 0) return ""
  const format = numberFormat(locale)

  const staleWord =
    locale === "de"
      ? " — veraltet?"
      : locale === "tr"
        ? " — eskimiş?"
        : locale === "ru"
          ? " — устарело?"
          : " — stale?"

  const byPublisher = new Map<string, PriceObservation[]>()
  for (const price of prices) {
    const existing = byPublisher.get(price.publisher)
    if (existing === undefined) byPublisher.set(price.publisher, [price])
    else existing.push(price)
  }

  const lines: string[] = []
  for (const [publisher, group] of byPublisher) {
    const sorted = [...group].sort((a, b) => a.money.amount - b.money.amount)
    const low = sorted[0]
    const high = sorted[sorted.length - 1]
    if (low === undefined || high === undefined) continue

    const sizes = sorted
      .map((p) => p.interiorM2)
      .filter((m): m is number => m !== null)
    const sizeRange =
      sizes.length === 0
        ? ""
        : sizes[0] === sizes[sizes.length - 1]
          ? `, ${sizes[0]} m²`
          : `, ${Math.min(...sizes)}–${Math.max(...sizes)} m²`

    const amount =
      low.money.amount === high.money.amount &&
      low.money.currency === high.money.currency
        ? `${format.format(low.money.amount)} ${low.money.currency}`
        : `${format.format(low.money.amount)}–${format.format(high.money.amount)} ${low.money.currency}`

    const count =
      group.length > 1 ? ` (${group.length} ${LISTING_COUNT[locale]})` : ""
    const stale = group.some((p) => p.isStale) ? staleWord : ""
    lines.push(`${publisher}: ${amount}${sizeRange}${count}${stale}`)
  }

  // The spread is only stated when every observation shares one currency —
  // otherwise the ratio would be a silent conversion, which CONVENTIONS §5
  // forbids outright.
  //
  // And when it IS stated, it is stated **with the two endpoints it was computed
  // from**. A bare "spread: 210×" is a derived figure with no visible
  // derivation — CONTRACTS §1 calls that `inferred` and requires a note
  // explaining the computation. It also hides the interesting part: a 210×
  // ratio in this dataset comes from one portal publishing a EUR 1,000
  // placeholder, and a reader who can see both endpoints spots that instantly
  // while a reader given only the ratio concludes something false about the
  // market.
  const currencies = new Set(prices.map((p) => p.money.currency))
  let ratio = ""
  const first = prices[0]
  const last = prices[prices.length - 1]
  if (
    currencies.size === 1 &&
    prices.length > 1 &&
    first !== undefined &&
    last !== undefined &&
    first.money.amount > 0
  ) {
    const factor = (last.money.amount / first.money.amount).toFixed(1)
    ratio =
      ` ${PRICE_SPREAD[locale]}: ${format.format(first.money.amount)} ${first.money.currency} (${first.publisher})` +
      ` – ${format.format(last.money.amount)} ${last.money.currency} (${last.publisher}), ${SPREAD_FACTOR[locale]} ${factor}×` +
      ` ${SPREAD_DERIVED[locale]}.`
  }

  const staleNote = prices.some((p) => p.isStale) ? ` ${PRICE_STALE[locale]}` : ""

  // Two publishers quoting different numbers for the same project IS a
  // disagreement, and it is named as one before the list is read. Leading with
  // the cheapest figure and letting the reader notice the spread later is how a
  // sourced answer still ends up misleading.
  const publishers = new Set(prices.map((p) => p.publisher)).size
  const lead = publishers >= 2 ? `${CONFLICT_LEAD[locale]} ` : ""

  return `${lead}${PRICE_LEAD[locale]}: ${lines.join(" · ")}.${ratio} ${PRICE_NO_CONVERT[locale]}${staleNote}`
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

const UNIT_MODELLED: Phrase = {
  de: "Diese Einheit ist MODELLIERT und kein reales Inserat. Kein Quelle veröffentlicht ein Verzeichnis Wohnung für Wohnung; die 656 Einheiten sind belegt, die Aufteilung auf Blöcke und Etagen nicht. Der Preis ist aus beobachteten €/m² desselben Grundrisses abgeleitet und darf nicht als Angebot behandelt werden.",
  en: "This unit is MODELLED and not a real listing. No source publishes a unit-by-unit inventory; the 656 total is corroborated, the per-block and per-floor breakdown is not. The price is derived from observed €/m² for the same layout and must not be treated as an offer.",
  tr: "Bu daire MODELLENMİŞtir, gerçek bir ilan değildir. Hiçbir kaynak daire daire envanter yayımlamıyor; 656 toplam doğrulanmış, blok ve kat dağılımı doğrulanmamıştır. Fiyat, aynı tipteki gözlenen €/m²'den türetilmiştir ve teklif sayılamaz.",
  ru: "Эта квартира СМОДЕЛИРОВАНА и не является реальным объявлением. Ни один источник не публикует поквартирный перечень; всего 656 — подтверждено, распределение по блокам и этажам — нет. Цена выведена из наблюдаемых €/м² того же типа и не может считаться предложением.",
}

const UNIT_NOT_FOUND: Phrase = {
  de: "Diese Wohnungsnummer gibt es im Bestand nicht. Die IDs laufen von AZW-B01-0001 bis AZW-B07-0093 über 7 Blöcke. Sie sind ein internes Adressierungsschema, keine Wohnungsnummern des Bauträgers — keine Quelle veröffentlicht solche (F-011).",
  en: "That unit number does not exist in the inventory. Ids run from AZW-B01-0001 to AZW-B07-0093 across 7 blocks. They are an internal addressing key, not developer unit numbers — no source publishes those (F-011).",
  tr: "Bu daire numarası envanterde yok. Kimlikler 7 blok boyunca AZW-B01-0001 ile AZW-B07-0093 arasındadır. Bunlar dâhilî bir adresleme anahtarıdır, geliştiricinin daire numaraları değildir — hiçbir kaynak onları yayımlamıyor (F-011).",
  ru: "Такого номера квартиры в перечне нет. Идентификаторы идут от AZW-B01-0001 до AZW-B07-0093 по 7 блокам. Это внутренний ключ адресации, а не номера застройщика — их не публикует ни один источник (F-011).",
}

const UNIT_REAL_LISTING: Phrase = {
  de: "Diese Einheit stammt aus einem echten Portalinserat.",
  en: "This unit comes from a real portal listing.",
  tr: "Bu daire gerçek bir portal ilanından geliyor.",
  ru: "Эта квартира взята из реального объявления на портале.",
}

function describeUnit(
  unit: NonNullable<RetrievalResult["unit"]>,
  locale: Locale
): string {
  if (!unit.found) return `${unit.id}: ${UNIT_NOT_FOUND[locale]}`

  const format = numberFormat(locale)
  const price =
    unit.price === null
      ? NOT_ESTABLISHED[locale]
      : `${format.format(unit.price.amount)} ${unit.price.currency}`
  const size = unit.interiorM2 === null ? "" : `, ${unit.interiorM2} m²`
  const head = `${unit.id} (${unit.layout ?? "?"}${size}): ${price}${citeInline(unit.sources)}.`

  if (unit.dataQuality === "modelled") return `${head} ${UNIT_MODELLED[locale]}`
  if (unit.dataQuality === "portal_listing") {
    return `${head} ${UNIT_REAL_LISTING[locale]}`
  }
  return head
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

const FINDINGS_LEAD: Phrase = {
  de: "Erfasste Widersprüche",
  en: "Recorded conflicts",
  tr: "Kayıtlı çelişkiler",
  ru: "Зафиксированные противоречия",
}

function describeFindings(findings: readonly Finding[], locale: Locale): string {
  if (findings.length === 0) return ""
  const items = findings.map((f) => {
    const head = `${f.id} (${f.severity}): ${f.message.split(". ")[0] ?? f.message}`
    return f.resolvedTo === null
      ? `${head}. ${locale === "de" ? "Bewusst offen gelassen." : locale === "tr" ? "Bilinçli olarak açık bırakıldı." : locale === "ru" ? "Оставлено намеренно нерешённым." : "Deliberately left unresolved."}`
      : head
  })
  return `${FINDINGS_LEAD[locale]}: ${items.join(" · ")}`
}

// ---------------------------------------------------------------------------
// The deterministic answer
// ---------------------------------------------------------------------------

const NO_ANSWER: Phrase = {
  de: "Dazu liegt mir kein Beleg vor. Ich sage lieber „nicht belegt“, als eine plausible Zahl zu erfinden.",
  en: 'I have no evidence for that. I would rather say "not established" than invent a plausible number.',
  tr: "Buna dair elimde kanıt yok. Makul bir sayı uydurmaktansa “belgelenmemiş” demeyi tercih ederim.",
  ru: "У меня нет подтверждения для этого. Лучше сказать «не подтверждено», чем выдумать правдоподобную цифру.",
}

/**
 * The answer sent when there is no gateway, and the answer a gateway reply must
 * beat. Assembled purely from the retrieval result.
 */
export function buildDeterministicAnswer(
  retrieval: RetrievalResult,
  locale: Locale
): string {
  const parts: string[] = []

  if (retrieval.unit !== null) parts.push(describeUnit(retrieval.unit, locale))

  const factSentences = retrieval.facts
    .filter((f) => f.confidence !== "gap" || f.note !== null)
    .slice(0, 6)
    .map((f) => describeFact(f, locale))
  if (factSentences.length > 0) parts.push(factSentences.join(" "))

  if (retrieval.prices.length > 0) {
    parts.push(describePriceSpread(retrieval.prices, locale))
  }

  const findings = describeFindings(retrieval.findings, locale)
  if (findings.length > 0) parts.push(findings)

  if (parts.length === 0) return NO_ANSWER[locale]

  const citationCount = new Set(retrieval.citations.map((c) => c.publisher)).size
  parts.push(
    `[${citationCount} ${citationCount === 1 ? SOURCE_WORD[locale] : SOURCES_WORD[locale]}]`
  )
  return parts.join(" ")
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

const refusalCopy: Record<RefusalKind, Phrase> = {
  rbac_denied: {
    de: "Diese Frage betrifft einen Bereich, für den Ihre Rolle keine Freigabe hat. Ich habe dazu nichts abgerufen und auch keine Anfrage an ein Sprachmodell gestellt. Wenden Sie sich an die Objektleitung, wenn Sie diesen Zugriff brauchen.",
    en: "That question touches an area your role is not cleared for. I retrieved nothing and made no request to a language model. Ask site management if you need this access.",
    tr: "Bu soru, rolünüzün yetkili olmadığı bir alanı ilgilendiriyor. Hiçbir veri getirmedim ve bir dil modeline istek göndermedim. Bu erişime ihtiyacınız varsa yönetime başvurun.",
    ru: "Этот вопрос относится к области, к которой у вашей роли нет доступа. Я ничего не запрашивал и не обращался к языковой модели. Обратитесь к управляющему, если доступ нужен.",
  },
  prompt_injection: {
    de: "Ich folge keinen Anweisungen, die in eine Anfrage eingebettet sind. Zu Azura World Residence & Hotel helfe ich gern weiter — mit Quellenangabe.",
    en: "I do not follow instructions embedded in a request. I am glad to help with Azura World Residence & Hotel — with sources.",
    tr: "Bir isteğin içine gömülü talimatları uygulamam. Azura World Residence & Hotel hakkında kaynaklarıyla birlikte yardımcı olabilirim.",
    ru: "Я не выполняю инструкции, встроенные в запрос. С удовольствием помогу по Azura World Residence & Hotel — со ссылками на источники.",
  },
  prompt_exfiltration: {
    de: "Meine Anweisungen gebe ich nicht wieder. Was ich sagen kann, sage ich mit Quelle — fragen Sie mich zum Projekt, zum Hotel, zu Preisen oder zu den Widersprüchen in den Quellen.",
    en: "I do not reproduce my instructions. What I can say, I say with a source — ask me about the project, the hotel, prices, or the conflicts between sources.",
    tr: "Talimatlarımı aktarmam. Söyleyebildiklerimi kaynağıyla söylerim — proje, otel, fiyatlar veya kaynaklar arasındaki çelişkiler hakkında sorabilirsiniz.",
    ru: "Свои инструкции я не воспроизвожу. То, что могу сказать, говорю со ссылкой — спросите о проекте, отеле, ценах или противоречиях между источниками.",
  },
  foreign_project: {
    de: "Dazu habe ich keine Belege. Ich bin ausschließlich für Azura World Residence & Hotel in Türkler/Alanya zuständig; über andere Projekte oder Systeme sage ich nichts.",
    en: "I have no evidence on that. I cover only Azura World Residence & Hotel in Türkler/Alanya; I say nothing about other projects or systems.",
    tr: "Bu konuda kanıtım yok. Yalnızca Türkler/Alanya'daki Azura World Residence & Hotel kapsamındayım; başka projeler veya sistemler hakkında konuşmam.",
    ru: "По этому у меня нет данных. Я отвечаю только за Azura World Residence & Hotel в Тюрклере/Алании; о других проектах и системах не говорю.",
  },
  advice_requested: {
    de: "Eine Kauf- oder Anlageempfehlung gebe ich nicht — dafür bin ich nicht die richtige Instanz und die Belege tragen sie nicht. Ich kann Ihnen die belegten Zahlen und die Widersprüche zwischen den Quellen zeigen, damit Sie selbst entscheiden.",
    en: "I do not give a purchase or investment recommendation — I am not the right authority for it and the evidence does not support one. I can show you the sourced figures and the conflicts between sources so you can decide yourself.",
    tr: "Satın alma veya yatırım tavsiyesi vermem — bunun için doğru merci değilim ve kanıtlar bunu desteklemiyor. Kaynaklı rakamları ve kaynaklar arasındaki çelişkileri gösterebilirim; kararı siz verirsiniz.",
    ru: "Я не даю рекомендаций о покупке или инвестициях — это не моя роль, и доказательства этого не подтверждают. Могу показать подтверждённые цифры и противоречия между источниками, чтобы вы решили сами.",
  },
  legal_tax_advice: {
    de: "Zu Recht, Steuern oder Aufenthalt sage ich nichts. Das gehört zu einer qualifizierten Person mit Kenntnis Ihres Falls; ich vermittle Ihnen gern den Kontakt.",
    en: "I say nothing about legal, tax or residency matters. That belongs with a qualified person who knows your case; I can put you in touch.",
    tr: "Hukuk, vergi veya oturum konularında konuşmam. Bu, durumunuzu bilen yetkin bir kişiye aittir; sizi yönlendirebilirim.",
    ru: "О юридических, налоговых и миграционных вопросах я не говорю. Это к квалифицированному специалисту, знающему ваш случай; могу связать вас.",
  },
  action_requested: {
    de: "Ausführen kann ich das nicht — weder eine Reservierung noch eine Zahlung, eine Freigabe oder eine Rechteänderung. Ich empfehle; entscheiden und freigeben muss ein Mensch. Ich leite Ihre Anfrage gern weiter.",
    en: "I cannot execute that — not a reservation, a payment, an approval or a permission change. I recommend; a human decides and approves. I can pass your request on.",
    tr: "Bunu gerçekleştiremem — ne rezervasyon, ne ödeme, ne onay, ne de yetki değişikliği. Ben öneririm; kararı ve onayı bir insan verir. Talebinizi iletebilirim.",
    ru: "Я не могу это выполнить — ни бронирование, ни платёж, ни одобрение, ни изменение прав. Я рекомендую; решает и утверждает человек. Могу передать вашу заявку.",
  },
  conduct_judgement: {
    de: "Über das Verhalten, die Seriosität oder die Finanzlage der Cebeci Group sage ich nichts — dafür gibt es in den erhobenen Quellen keinen Beleg, und dies ist eine Wettbewerbsanalyse, keine Bewertung. Was belegt ist: Gründungsjahr, Projekt, Fertigstellung — danach können Sie mich fragen.",
    en: "I say nothing about Cebeci Group's conduct, reputation or finances — the harvested sources carry no evidence for it, and this is competitive research, not a rating. What is sourced: founding year, project, completion — ask me about those.",
    tr: "Cebeci Group'un davranışı, itibarı veya mali durumu hakkında konuşmam — toplanan kaynaklarda buna dair kanıt yok ve bu bir rekabet araştırması, derecelendirme değil. Kaynaklı olan: kuruluş yılı, proje, teslim — bunları sorabilirsiniz.",
    ru: "О поведении, репутации и финансах Cebeci Group я не говорю — в собранных источниках нет подтверждений, и это конкурентное исследование, а не рейтинг. Подтверждено: год основания, проект, сдача — об этом спрашивайте.",
  },
  no_grounding: {
    de: "Dazu liegt mir kein Beleg vor — die Quellen dieses Projekts sagen dazu nichts. Ich erfinde keine Zahl. Belegt sind unter anderem Gesamteinheiten, Blöcke, Fertigstellung, Entfernungen und die beobachteten Angebotspreise.",
    en: "I have no evidence for that — this project's sources say nothing about it. I do not invent a number. What is sourced includes total units, blocks, completion, distances and the observed asking prices.",
    tr: "Buna dair kanıtım yok — bu projenin kaynakları bu konuda bir şey söylemiyor. Sayı uydurmam. Kaynaklı olanlar: toplam daire, bloklar, teslim, mesafeler ve gözlenen satış fiyatları.",
    ru: "Подтверждения нет — источники этого проекта об этом не говорят. Цифры я не выдумываю. Подтверждено: всего квартир, блоки, сдача, расстояния и наблюдаемые цены предложения.",
  },
  ungrounded_output: {
    de: "Ich habe meine erste Formulierung verworfen, weil sie eine Angabe enthielt, die nicht in den Quellen steht. Was belegt ist:",
    en: "I discarded my first phrasing because it contained a figure the sources do not carry. What is sourced:",
    tr: "İlk ifademi, kaynaklarda bulunmayan bir veri içerdiği için attım. Kaynaklı olan:",
    ru: "Я отбросил первую формулировку: в ней была цифра, которой нет в источниках. Подтверждено:",
  },
  input_too_long: {
    de: "Diese Nachricht ist zu lang. Bitte auf höchstens 2000 Zeichen kürzen.",
    en: "That message is too long. Please keep it to 2000 characters or fewer.",
    tr: "Bu mesaj çok uzun. Lütfen en fazla 2000 karakter kullanın.",
    ru: "Сообщение слишком длинное. Не более 2000 символов, пожалуйста.",
  },
}

/**
 * The refusal text. Refusals that concern a commercial subject also offer the
 * human path — a refusal that ends the conversation is a worse product than one
 * that redirects it, and the brief requires the hand-off explicitly for actions
 * and advice.
 */
export function buildRefusal(kind: RefusalKind, locale: Locale): string {
  const base = refusalCopy[kind][locale]
  const offersHandoff =
    kind === "action_requested" ||
    kind === "advice_requested" ||
    kind === "legal_tax_advice"
  return offersHandoff ? `${base} ${HANDOFF[locale]}` : base
}

/** The `ungrounded_output` case prefixes the deterministic answer. */
export function buildUngroundedFallback(
  deterministic: string,
  locale: Locale
): string {
  return `${refusalCopy.ungrounded_output[locale]} ${deterministic}`
}
