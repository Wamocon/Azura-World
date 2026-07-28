"use client"

/**
 * The badge that tells the truth about which data mode is running.
 *
 * **`static` is the one that must never be missable.** A demo showing seed data
 * that reads as live production data is the kind of thing that gets promised to
 * a client by mistake, so that mode gets the loudest treatment on the page: a
 * filled amber chip, a border, and the words "Demo-Daten" — not a subtle dot.
 *
 * Colour is never the only signal. Every mode carries an icon **and** a word,
 * because roughly one man in twelve cannot distinguish the green from the amber,
 * and because a screenshot in a status report loses the tooltip.
 *
 * Self-contained on purpose: no import from `components/ui/*` (W1-D). This badge
 * has to render correctly in a `static` deployment with no design system loaded,
 * which is exactly the situation where mislabelling the data mode would matter
 * most.
 */

import { Circle, CloudOff, Database, RefreshCw } from "lucide-react"
import { relativeAge, type LiveMode } from "@/lib/realtime"
import type { Locale } from "@/lib/contracts"

export interface SyncBadgeProps {
  mode: LiveMode
  lastUpdated: string | null
  locale?: Locale
  pollIntervalMs?: number
  className?: string
}

type Phrase = Record<Locale, string>

const LABEL: Record<LiveMode, Phrase> = {
  realtime: { de: "Live", en: "Live", tr: "Canlı", ru: "В реальном времени" },
  polling: {
    de: "Aktualisiert alle",
    en: "Updates every",
    tr: "Şu aralıkla güncellenir:",
    ru: "Обновляется каждые",
  },
  static: {
    de: "Demo-Daten",
    en: "Demo data",
    tr: "Demo verisi",
    ru: "Демо-данные",
  },
  offline: { de: "Offline", en: "Offline", tr: "Çevrimdışı", ru: "Не в сети" },
}

const AGO: Phrase = { de: "vor", en: "", tr: "önce", ru: "" }

function ago(locale: Locale, age: string): string {
  // German and Turkish put the marker on opposite sides of the value; English
  // and Russian use a trailing word. Four short branches beat a message
  // catalogue this component would otherwise have to depend on (W1-C owns those,
  // and this must render before they exist).
  switch (locale) {
    case "de":
      return `${AGO.de} ${age}`
    case "tr":
      return `${age} ${AGO.tr}`
    case "ru":
      return `${age} назад`
    default:
      return `${age} ago`
  }
}

/**
 * Tailwind classes rather than design tokens, so this renders identically
 * whether or not W1-D's `globals.css` is loaded.
 */
const TONE: Record<LiveMode, string> = {
  realtime:
    "border-emerald-600/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  polling: "border-sky-600/30 bg-sky-500/10 text-sky-800 dark:text-sky-300",
  static:
    "border-amber-600/60 bg-amber-500/20 font-semibold text-amber-900 dark:text-amber-200",
  offline: "border-zinc-600/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
}

export function SyncBadge({
  mode,
  lastUpdated,
  locale = "de",
  pollIntervalMs = 30_000,
  className = "",
}: SyncBadgeProps) {
  const age = relativeAge(lastUpdated)
  const seconds = Math.round(pollIntervalMs / 1000)

  let text: string
  switch (mode) {
    case "realtime":
      text = LABEL.realtime[locale]
      break
    case "polling":
      text = `${LABEL.polling[locale]} ${seconds} s${age === null ? "" : ` · ${ago(locale, age)}`}`
      break
    case "static":
      text = LABEL.static[locale]
      break
    case "offline":
      text = `${LABEL.offline[locale]}${age === null ? "" : ` · ${ago(locale, age)}`}`
      break
  }

  const Icon =
    mode === "realtime"
      ? Circle
      : mode === "polling"
        ? RefreshCw
        : mode === "static"
          ? Database
          : CloudOff

  return (
    <span
      // `status` rather than `alert`: this updates routinely and an assertive
      // live region would interrupt a screen-reader user every 30 seconds.
      role="status"
      aria-live="polite"
      data-mode={mode}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${TONE[mode]} ${className}`}
    >
      <Icon
        aria-hidden="true"
        className={
          mode === "realtime"
            ? // CONVENTIONS §5: `prefers-reduced-motion` degrades to static, not
              // to "less". `motion-safe:` emits the animation only when the user
              // has not asked for reduced motion, so the pulse is absent rather
              // than slowed.
              "size-3 fill-current motion-safe:animate-pulse"
            : "size-3"
        }
      />
      {text}
    </span>
  )
}
