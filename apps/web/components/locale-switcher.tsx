"use client"

/**
 * Locale switcher.
 *
 * ## The bug this file exists to avoid
 *
 * The naive implementation prefixes the new locale onto the current URL, which
 * turns `/en/dashboard` into `/en/en/dashboard`. 1Çatı carries an explicit
 * comment about it and the W1-C brief repeats it, so it has clearly been
 * shipped at least once.
 *
 * The fix is to **replace the locale segment**, and the way to do that without
 * writing any path arithmetic is `usePathname()` from `@/app/navigation`: it
 * returns the path with the locale prefix already stripped (`/dashboard/units`,
 * never `/en/dashboard/units`), and `router.replace(href, { locale })` puts the
 * new one back. No `split("/")`, no `startsWith`, nothing to get wrong.
 *
 * Query string and hash are carried across explicitly — `usePathname` drops
 * both, and a language switch that silently discards `?q=test#top` loses the
 * user's place.
 *
 * ## Why there is no `cn()` and no `<Button>`
 *
 * `lib/cn.ts` and `components/ui/*` are W1-D's and do not exist yet
 * (ORCHESTRATION §4). Importing them would fail the build, and stubbing them
 * would hand W1-D a file to delete. The class strings below are plain Tailwind
 * against W1-D's token names, so they start rendering correctly the moment
 * `globals.css` lands, and W1-D can swap in the real primitives afterwards
 * without touching the switching logic. This is listed in HANDOFF/W1-C.md
 * under "Requests for other windows".
 */

import { useTransition } from "react"
import { useSearchParams } from "next/navigation"
import { useLocale } from "next-intl"
import { ChevronDown, Globe2 } from "lucide-react"
import { locales, usePathname, useRouter } from "@/app/navigation"
import type { Locale } from "@/lib/contracts"

/**
 * Language names are written in their own language — a Russian speaker looking
 * for their language scans for "Русский", not for "Russisch". This is the one
 * label set that must NOT come from the message catalogue, because the whole
 * point is that it does not change with the active locale.
 */
const LABELS: Readonly<Record<Locale, string>> = {
  de: "DE — Deutsch",
  en: "EN — English",
  tr: "TR — Türkçe",
  ru: "RU — Русский",
}

/** The accessible name of the control, in the locale currently active. */
const ARIA_LABEL: Readonly<Record<Locale, string>> = {
  de: "Sprachauswahl",
  en: "Language selection",
  tr: "Dil seçimi",
  ru: "Выбор языка",
}

/** `<option>` needs `lang` so a screen reader pronounces "Türkçe" as Turkish. */
const BCP47: Readonly<Record<Locale, string>> = {
  de: "de",
  en: "en",
  tr: "tr",
  ru: "ru",
}

function classes(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(" ")
}

export interface LocaleSwitcherProps {
  className?: string
  /** Two-letter form for a crowded top bar. */
  compact?: boolean
}

export function LocaleSwitcher({
  className,
  compact = false,
}: LocaleSwitcherProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const activeLocale = useLocale() as Locale
  const [isPending, startTransition] = useTransition()

  function onSelect(next: Locale): void {
    if (next === activeLocale) return
    startTransition(() => {
      const query = searchParams.toString()
      // `window` is safe here: this only runs from an onChange handler, which
      // is client-side by definition. `usePathname` does not expose the hash.
      const hash = typeof window === "undefined" ? "" : window.location.hash
      const destination = `${pathname}${query.length > 0 ? `?${query}` : ""}${hash}`
      router.replace(destination, { locale: next })
    })
  }

  return (
    <div className={classes("relative flex shrink-0 items-center", className)}>
      <Globe2
        aria-hidden="true"
        className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground"
      />
      <select
        data-testid="locale-switcher"
        value={activeLocale}
        onChange={(event) => onSelect(event.target.value as Locale)}
        disabled={isPending}
        aria-busy={isPending}
        aria-label={ARIA_LABEL[activeLocale]}
        title={ARIA_LABEL[activeLocale]}
        className={classes(
          // CONVENTIONS §7: tap target >= 24px. h-9 is 36px.
          "h-9 appearance-none rounded-lg border border-border bg-card pl-7 text-xs font-semibold text-foreground shadow-sm transition-colors hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none disabled:cursor-wait disabled:opacity-70",
          // Russian is the widest label; the non-compact width is sized for it.
          compact
            ? "w-[68px] max-w-[68px] truncate pr-5 text-[11px]"
            : "w-[150px] pr-7"
        )}
      >
        {locales.map((locale) => (
          <option key={locale} value={locale} lang={BCP47[locale]}>
            {compact ? locale.toUpperCase() : LABELS[locale]}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-1.5 h-3.5 w-3.5 text-muted-foreground"
      />
    </div>
  )
}

export default LocaleSwitcher
