"use client"

/**
 * The page-level banner for a degraded connection.
 *
 * Distinct from `SyncBadge`, which sits beside one data surface and reports that
 * surface's mode. This is the whole-page statement, and it appears in exactly
 * two situations:
 *
 *  - **offline** — nothing on the page is current, and any control that writes
 *    will fail. There is no offline mutation queue (see `lib/pwa.ts`), so this
 *    banner is the only thing standing between a user and a write they think
 *    succeeded.
 *  - **stale** — the data on screen is older than two poll intervals. Something
 *    is failing quietly, which is precisely the case where saying nothing is
 *    worst.
 *
 * `realtime`, `polling` and a fresh `static` render nothing: a banner that is
 * always present is a banner nobody reads.
 */

import { AlertTriangle, CloudOff } from "lucide-react"
import { relativeAge, type LiveMode } from "@/lib/realtime"
import type { Locale } from "@/lib/contracts"

export interface ConnectionBannerProps {
  mode: LiveMode
  isStale: boolean
  lastUpdated: string | null
  locale?: Locale
  onRetry?: () => void
}

type Phrase = Record<Locale, string>

const OFFLINE_TITLE: Phrase = {
  de: "Keine Verbindung",
  en: "No connection",
  tr: "Bağlantı yok",
  ru: "Нет соединения",
}

const OFFLINE_BODY: Phrase = {
  de: "Angezeigt werden die zuletzt geladenen Daten. Änderungen können jetzt nicht gespeichert werden — sie werden auch nicht zwischengespeichert und später gesendet.",
  en: "Showing the last loaded data. Changes cannot be saved right now — and they are not queued to be sent later.",
  tr: "Son yüklenen veriler gösteriliyor. Şu anda değişiklikler kaydedilemez ve daha sonra gönderilmek üzere sıraya da alınmaz.",
  ru: "Показаны последние загруженные данные. Изменения сейчас не сохраняются и не ставятся в очередь на отправку позже.",
}

const STALE_TITLE: Phrase = {
  de: "Daten sind veraltet",
  en: "Data is out of date",
  tr: "Veriler güncel değil",
  ru: "Данные устарели",
}

const RETRY: Phrase = {
  de: "Erneut versuchen",
  en: "Try again",
  tr: "Yeniden dene",
  ru: "Повторить",
}

const AS_OF: Phrase = {
  de: "Stand vor",
  en: "As of",
  tr: "Şu kadar önce",
  ru: "По состоянию на",
}

export function ConnectionBanner({
  mode,
  isStale,
  lastUpdated,
  locale = "de",
  onRetry,
}: ConnectionBannerProps) {
  const offline = mode === "offline"
  // A `static` surface is never "stale" in a meaningful sense — seed data does
  // not go out of date, it was never live.
  const stale = isStale && mode !== "static" && !offline

  if (!offline && !stale) return null

  const age = relativeAge(lastUpdated)
  const title = offline ? OFFLINE_TITLE[locale] : STALE_TITLE[locale]
  const Icon = offline ? CloudOff : AlertTriangle

  return (
    <div
      // `alert` here, unlike the badge: this is an interruption worth making,
      // and it appears rarely.
      role="alert"
      data-mode={mode}
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
        offline
          ? "border-zinc-600/40 bg-zinc-500/10 text-zinc-800 dark:text-zinc-200"
          : "border-amber-600/40 bg-amber-500/10 text-amber-900 dark:text-amber-200"
      }`}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="flex-1">
        <p className="font-medium">{title}</p>
        {offline ? <p className="mt-1">{OFFLINE_BODY[locale]}</p> : null}
        {age === null ? null : (
          <p className="mt-1 opacity-80">
            {AS_OF[locale]} {age}
            {locale === "de" || locale === "tr" ? "" : ""}
          </p>
        )}
      </div>
      {onRetry === undefined ? null : (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-md border border-current/30 px-2.5 py-1 text-xs font-medium hover:bg-current/10"
        >
          {RETRY[locale]}
        </button>
      )}
    </div>
  )
}
