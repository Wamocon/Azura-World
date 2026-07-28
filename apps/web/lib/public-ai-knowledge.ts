/**
 * The data-blind public surface.
 *
 * The public concierge answers evidence questions by running the **same**
 * pipeline as the dashboard one, with role `guest` — so a visitor gets real
 * sourced facts about the project, and the permission matrix (not a second
 * codebase) decides what is out of reach. `guest` holds `units:view`,
 * `listings:view`, `hotel:view` and `reviews:view` but **not** `evidence:view`,
 * so the conflict cockpit is gated exactly as CONTRACTS §3 requires while the
 * price conflict still surfaces inside a pricing answer, where it belongs.
 *
 * What this module adds is the small set of questions that are about the
 * *deliverable* rather than about Azura World: what this thing is, where the
 * numbers come from, whether personal data is involved. Those have no dataset
 * behind them, so they are answered from a table here.
 *
 * **Nothing in this file reads the dataset**, deliberately, and it must stay
 * that way: it is imported by the anonymous route, and an import of
 * `azura-world-data.ts` would put the whole evidence corpus into a bundle served
 * to unauthenticated visitors.
 */

import { normalizeForMatch } from "./ai-guardrails"
import type { Locale } from "./contracts"

export type PublicTopic =
  | "what-is-this"
  | "where-do-numbers-come-from"
  | "privacy"
  | "who-are-you"
  | "contact-human"

type Phrase = Record<Locale, string>

const answers: Record<PublicTopic, Phrase> = {
  "what-is-this": {
    de: "Dies ist eine belegte Wettbewerbsanalyse zu Azura World Residence & Hotel in Türkler bei Alanya. Jede Zahl, die Sie hier sehen, trägt die Quelle, aus der sie stammt — und wo sich Quellen widersprechen, zeigen wir den Widerspruch, statt still einen Wert zu wählen.",
    en: "This is a sourced competitive analysis of Azura World Residence & Hotel in Türkler near Alanya. Every figure you see carries the source it came from — and where sources disagree, we show the disagreement instead of silently picking a value.",
    tr: "Bu, Alanya yakınlarındaki Türkler'de bulunan Azura World Residence & Hotel için kaynaklı bir rekabet analizidir. Gördüğünüz her rakam kaynağını taşır; kaynaklar çeliştiğinde sessizce bir değer seçmek yerine çelişkiyi gösteririz.",
    ru: "Это конкурентный анализ Azura World Residence & Hotel в Тюрклере под Аланией, основанный на источниках. Каждая цифра здесь снабжена источником, а при расхождении источников мы показываем расхождение, а не выбираем значение молча.",
  },
  "where-do-numbers-come-from": {
    de: "Aus einem Harvest öffentlich zugänglicher Seiten: der Projektseite, der Bauträgerseite, der Hotelseite, sieben Immobilienportalen und drei Bewertungsplattformen. Jede Seite wurde als Rohdatei gespeichert; jede Zahl verweist auf diese Momentaufnahme. Was keine Quelle nennt, bleibt „nicht belegt“ — es wird nicht geschätzt.",
    en: "From a harvest of publicly reachable pages: the project site, the developer site, the hotel site, seven property portals and three review platforms. Every page was stored as a raw snapshot; every figure points back to that snapshot. Anything no source states stays \"not established\" — it is not estimated.",
    tr: "Kamuya açık sayfaların toplanmasından: proje sitesi, geliştirici sitesi, otel sitesi, yedi emlak portalı ve üç değerlendirme platformu. Her sayfa ham anlık görüntü olarak saklandı; her rakam o görüntüye işaret eder. Hiçbir kaynağın söylemediği şey “belgelenmemiş” kalır — tahmin edilmez.",
    ru: "Из сбора общедоступных страниц: сайт проекта, сайт застройщика, сайт отеля, семь порталов недвижимости и три площадки отзывов. Каждая страница сохранена как снимок; каждая цифра ссылается на этот снимок. То, чего не говорит ни один источник, остаётся «не подтверждено» — оценок нет.",
  },
  privacy: {
    de: "Ich habe keinen Zugriff auf personenbezogene Daten und gebe keine heraus. Es gibt hier keine Kundendaten, keine Salden und keine Namen von Käufern — nur öffentlich veröffentlichte Projektinformationen mit Quellenangabe.",
    en: "I have no access to personal data and disclose none. There are no customer records here, no balances and no buyer names — only publicly published project information, with sources.",
    tr: "Kişisel verilere erişimim yok ve hiçbirini paylaşmam. Burada müşteri kaydı, bakiye veya alıcı adı yoktur — yalnızca kaynaklarıyla birlikte kamuya açık proje bilgisi vardır.",
    ru: "У меня нет доступа к персональным данным и я их не раскрываю. Здесь нет клиентских записей, балансов и имён покупателей — только публично опубликованная информация о проекте со ссылками на источники.",
  },
  "who-are-you": {
    de: "Ich bin der Evidenz-Concierge dieser Analyse. Ich sage nur, was in den erhobenen Quellen steht, nenne zu jeder Zahl die Quelle und sage „nicht belegt“, wenn nichts belegt ist. Beraten tue ich nicht.",
    en: "I am the evidence concierge for this analysis. I say only what the harvested sources state, name the source for every figure, and say \"not established\" when nothing is. I do not advise.",
    tr: "Bu analizin kanıt danışmanıyım. Yalnızca toplanan kaynakların söylediğini aktarır, her rakamın kaynağını belirtir ve belgelenmemişse “belgelenmemiş” derim. Danışmanlık vermem.",
    ru: "Я консьерж по доказательствам этого анализа. Излагаю только то, что говорят собранные источники, называю источник для каждой цифры и говорю «не подтверждено», если подтверждения нет. Консультаций не даю.",
  },
  "contact-human": {
    de: "Für alles Kaufmännische — Preisverhandlung, Reservierung, Besichtigung, Zahlungsplan — ist ein Mensch zuständig. Sagen Sie Bescheid, dann leite ich Ihre Anfrage weiter.",
    en: "Anything commercial — price negotiation, reservation, viewing, payment plan — belongs with a person. Say the word and I will pass your request on.",
    tr: "Ticari her konu — fiyat pazarlığı, rezervasyon, yerinde görme, ödeme planı — bir kişiye aittir. Söyleyin, talebinizi ileteyim.",
    ru: "Все коммерческие вопросы — торг по цене, бронирование, просмотр, план оплаты — за человеком. Скажите, и я передам вашу заявку.",
  },
}

/** Ordered: the first match wins, so the more specific patterns come first. */
const topicMatchers: ReadonlyArray<readonly [PublicTopic, RegExp]> = [
  [
    "privacy",
    /(datenschutz|personenbezogen|dsgvo|kvkk|privacy|personal data|gdpr|kisisel veri|gizlilik|персональн|конфиденциальн)/,
  ],
  [
    "where-do-numbers-come-from",
    /(woher (kommen|stammen)|welche quellen|wie belegt|methodik|where do (the )?(numbers|figures|data) come|what sources|methodology|kaynaklar nereden|yontem|откуда (данные|цифры)|какие источники|методолог)/,
  ],
  [
    "who-are-you",
    /(wer bist du|was bist du|wer sind sie|who are you|what are you|kimsin|nesin|кто (ты|вы)|что ты такое)/,
  ],
  [
    "contact-human",
    /(mit einem menschen|ansprechpartner|berater sprechen|talk to (a )?(human|person|someone)|speak to someone|insanla gorusmek|bir yetkiliyle|с человеком|с менеджером)/,
  ],
  [
    "what-is-this",
    /(was ist das|worum geht|was macht diese seite|what is this|what does this site|bu nedir|bu site ne|что это|о чем это)/,
  ],
]

/** `null` ⟹ not one of these; the caller runs the normal evidence pipeline. */
export function classifyPublicTopic(message: string): PublicTopic | null {
  const text = normalizeForMatch(message)
  for (const [topic, pattern] of topicMatchers) {
    if (pattern.test(text)) return topic
  }
  return null
}

export function answerPublicTopic(topic: PublicTopic, locale: Locale): string {
  return answers[topic][locale]
}

/** Starter chips for the landing-page widget (W3-H renders them). */
export const publicSuggestions: Record<Locale, readonly string[]> = {
  de: [
    "Was kostet eine 1+1 Wohnung?",
    "Wie viele Wohnungen und Blöcke gibt es?",
    "Ist das Hotel ein Wyndham?",
    "Woher stammen die Zahlen?",
  ],
  en: [
    "What does a 1+1 apartment cost?",
    "How many units and blocks are there?",
    "Is the hotel a Wyndham?",
    "Where do the numbers come from?",
  ],
  tr: [
    "1+1 daire ne kadar?",
    "Kaç daire ve kaç blok var?",
    "Otel bir Wyndham mı?",
    "Rakamlar nereden geliyor?",
  ],
  ru: [
    "Сколько стоит квартира 1+1?",
    "Сколько квартир и блоков?",
    "Отель — это Wyndham?",
    "Откуда взяты цифры?",
  ],
}
