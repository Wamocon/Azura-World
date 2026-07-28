/**
 * Chat-language detection for the AI concierge.
 *
 * Mirrors `D:\Real Estate CRM\Cati\apps\web\lib\language-detection.ts`, with the
 * default flipped to German (CONTRACTS §7) and the brand tokens changed.
 *
 * **This is not page-locale detection.** The page locale comes from the URL
 * segment and nothing else — `i18n/routing.ts` sets `localeDetection: false` on
 * purpose, so a shared link renders the same for everyone. What this module
 * answers is a different question: *the visitor is on `/de` but just typed a
 * question in Russian — which language should the answer be in?*
 *
 * The bias is deliberately conservative. Returning `null` means "no clear
 * signal, stay in the UI language", and that is the right answer far more often
 * than a confident guess from four words.
 */

import { defaultLocale, locales, type Locale } from "./contracts"

/** The concierge answers in the same four languages the UI supports. */
export type ChatLanguage = Locale

/**
 * A bare greeting carries no language signal worth acting on — "hi" appears in
 * German, Turkish and Russian conversations alike. Matched before scoring so
 * that a one-word opener never flips the answer language.
 */
const greetingOnlyPattern =
  /^(?:hi+|hello+|hey+|hallo+|servus|moin|guten\s+(?:tag|morgen|abend)|merhaba+|selam+|привет+|здравствуй(?:те)?|добрый\s+(?:день|вечер|утро))[!?.\s,-]*$/iu

/**
 * Brand tokens are stripped before scoring. "Azura World" is English-looking
 * text that appears in every question regardless of language, and leaving it in
 * pushes every short message towards `en`.
 */
const brandTokenPattern =
  /azura(?:\s*world)?|cebeci(?:\s*group)?|wyndham|türkler|turkler/giu

function stripBrandTokens(message: string): string {
  return message.replace(brandTokenPattern, " ")
}

/** Narrows an arbitrary string to a supported chat language, or falls back. */
export function resolveChatUiLocale(
  locale: string | null | undefined,
  fallback: ChatLanguage = defaultLocale
): ChatLanguage {
  return (locales as readonly string[]).includes(locale ?? "")
    ? (locale as ChatLanguage)
    : fallback
}

/**
 * Detects the language a message was written in, or `null` when the signal is
 * ambiguous.
 *
 * Cyrillic is decisive on its own — no other supported language uses it. The
 * remaining three are scored on diacritics plus function words, and a tie
 * returns `null` rather than picking the first alphabetically.
 */
export function detectExplicitChatLanguage(
  message: string
): ChatLanguage | null {
  const text = stripBrandTokens(message).trim()
  if (text.length === 0 || greetingOnlyPattern.test(text)) return null

  // Cyrillic is unambiguous among de/en/tr/ru.
  if (/[\u0400-\u04ff]/u.test(text)) return "ru"

  const scores: Record<Exclude<ChatLanguage, "ru">, number> = {
    de: 0,
    en: 0,
    tr: 0,
  }

  // Diacritics are strong evidence but not decisive: a German keyboard produces
  // "ö" and "ü" too, which is why Turkish's weight comes mostly from ı/ğ/ş.
  if (/[ıİğĞşŞ]/u.test(text)) scores.tr += 3
  if (/[äÄßẞ]/u.test(text)) scores.de += 3

  // Folded with the Turkish locale on purpose — this is display-side text
  // analysis, not identifier comparison, so "I" must fold to "ı" for the
  // Turkish word list to match (CONVENTIONS §5).
  const lower = text.toLocaleLowerCase("tr-TR")

  function addScore(
    language: Exclude<ChatLanguage, "ru">,
    pattern: RegExp,
    weight = 1
  ): void {
    const matches = lower.match(pattern)
    if (matches !== null) scores[language] += matches.length * weight
  }

  addScore(
    "de",
    /\b(ich|du|sie|wir|was|wie|warum|wieso|welche|welcher|welches|kann|können|bitte|danke|nicht|mit|für|über|wohnung|einheit|preis|quelle|beleg|bauträger|hotel|zimmer|lage|strand|kaufen|mieten|verwaltung|nebenkosten|unterlagen|deutsch)\b/giu
  )
  addScore(
    "tr",
    /\b(ben|sen|siz|biz|nedir|nasıl|nasil|neden|hangi|lütfen|lutfen|teşekkür|tesekkur|daire|konut|fiyat|kaynak|belge|müteahhit|muteahhit|otel|oda|konum|plaj|satın|satin|kiralama|yönetim|yonetim|aidat|türkçe|turkce)\b/giu
  )
  addScore(
    "en",
    /\b(i|you|we|what|how|why|which|who|can|could|please|thanks|thank|not|with|for|about|unit|apartment|price|source|evidence|developer|hotel|room|location|beach|buy|rent|management|fees|documents|english)\b/giu
  )

  const ranked = (
    Object.entries(scores) as Array<[Exclude<ChatLanguage, "ru">, number]>
  ).sort((a, b) => b[1] - a[1])

  const top = ranked[0]
  const second = ranked[1]
  if (top === undefined || second === undefined) return null
  if (top[1] <= 0 || top[1] === second[1]) return null

  return top[0]
}

/**
 * The function the concierge route actually calls: detect from the message, and
 * fall back to the page locale when the message gives no clear signal.
 */
export function resolveChatLanguageFromMessage(
  message: string,
  fallbackLocale: string | null | undefined
): ChatLanguage {
  return (
    detectExplicitChatLanguage(message) ?? resolveChatUiLocale(fallbackLocale)
  )
}
