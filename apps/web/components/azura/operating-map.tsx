"use client"

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { Building2, Home, KeyRound, ShieldCheck, type LucideIcon } from "lucide-react"
import { ActMedia } from "@/components/journey/act-media"
import { imagesForAct, type JourneyAct, type JourneyImage } from "@/lib/journey-media"
import { cn } from "@/lib/cn"
import type { Locale } from "@/lib/contracts"

/**
 * The operating map: aerial site, then blocks, then one apartment, then the
 * system that runs all three. Modelled on 1Çatı's isometric-erp-world — the
 * ground plane is a CSS `skewY` plate under a `perspective`, not WebGL, so it
 * costs nothing and never needs a fallback.
 *
 * Photography is real Azura World material, one image per step, so the descent
 * from site to room is shown rather than diagrammed.
 */

interface Step {
  readonly act: JourneyAct
  readonly icon: LucideIcon
  readonly stat: string
}

const STEPS: readonly Step[] = [
  { act: "approach", icon: Building2, stat: "76.000" },
  { act: "complex", icon: Home, stat: "7" },
  { act: "room", icon: KeyRound, stat: "656" },
  { act: "grounds", icon: ShieldCheck, stat: "188" },
]

type Copy = {
  eyebrow: string
  title: string
  intro: string
  plate: string
  unitRecord: string
  steps: ReadonlyArray<{ label: string; title: string; text: string; statLabel: string }>
  chips: readonly string[]
}

const COPY: Record<Locale, Copy> = {
  de: {
    eyebrow: "Betriebsübersicht",
    title: "Vom Gelände zum Block, von der Wohnung zur Entscheidung",
    intro:
      "Anlage, Block, Wohnung und Verwaltung liegen in einem Modell. Jeder Punkt steht für einen echten Vorgang: eine Meldung, eine Buchung, ein Dokument, eine Freigabe.",
    plate: "Anlage Türkler",
    unitRecord: "Wohnungsakte",
    steps: [
      {
        label: "Gelände",
        title: "Die Anlage als ein Bestand",
        text: "Blöcke, Wege, Außenanlagen, Hotel und Gemeinschaftsflächen hängen an einem Datensatz.",
        statLabel: "m² Grundstück",
      },
      {
        label: "Block und Etage",
        title: "Jeder Block liegt im Bestand",
        text: "Etage, Wohnungstyp, Status, Eigentümer und offene Vorgänge stehen in derselben Übersicht.",
        statLabel: "Blöcke",
      },
      {
        label: "Wohnung",
        title: "Die Wohnung führt ihre eigene Akte",
        text: "Übergabe, Wartung, Zahlungen, Dokumente und Fotonachweise bleiben an der Einheit.",
        statLabel: "Wohnungen",
      },
      {
        label: "Verwaltung",
        title: "Hotel und Wohnanlage in einem System",
        text: "Buchhaltung, Technik, Dokumente und Rollen greifen auf denselben Bestand zu.",
        statLabel: "Hotelzimmer",
      },
    ],
    chips: ["Meldung", "Dokument", "Zahlung", "Zugang"],
  },
  en: {
    eyebrow: "Operating map",
    title: "From the site to a block, from an apartment to a decision",
    intro:
      "The complex, the block, the apartment and the back office share one model. Every point is a real piece of work: a report, a posting, a document, an approval.",
    plate: "Türkler site",
    unitRecord: "unit record",
    steps: [
      {
        label: "The site",
        title: "The complex as one inventory",
        text: "Blocks, roads, grounds, the hotel and shared areas all hang off a single record.",
        statLabel: "m² of land",
      },
      {
        label: "Block and floor",
        title: "Every block sits in the inventory",
        text: "Floor, layout, status, owner and open work all read from the same view.",
        statLabel: "blocks",
      },
      {
        label: "The apartment",
        title: "Each apartment keeps its own file",
        text: "Handover, maintenance, payments, documents and photo evidence stay with the unit.",
        statLabel: "apartments",
      },
      {
        label: "Back office",
        title: "Hotel and residence in one system",
        text: "Accounting, maintenance, documents and roles all read the same inventory.",
        statLabel: "hotel rooms",
      },
    ],
    chips: ["report", "document", "payment", "access"],
  },
  tr: {
    eyebrow: "İşletim haritası",
    title: "Araziden bloğa, daireden karara",
    intro:
      "Site, blok, daire ve yönetim tek modelde birleşir. Her nokta gerçek bir işi temsil eder: bir bildirim, bir kayıt, bir belge, bir onay.",
    plate: "Türkler sitesi",
    unitRecord: "daire kaydı",
    steps: [
      {
        label: "Arazi",
        title: "Site tek bir envanter",
        text: "Bloklar, yollar, dış alanlar, otel ve ortak alanlar tek kayda bağlıdır.",
        statLabel: "m² arsa",
      },
      {
        label: "Blok ve kat",
        title: "Her blok envanterde durur",
        text: "Kat, daire tipi, durum, malik ve açık işler aynı ekranda okunur.",
        statLabel: "blok",
      },
      {
        label: "Daire",
        title: "Her daire kendi dosyasını tutar",
        text: "Teslim, bakım, ödeme, belge ve fotoğraf kanıtı dairede kalır.",
        statLabel: "daire",
      },
      {
        label: "Yönetim",
        title: "Otel ve konut tek sistemde",
        text: "Muhasebe, teknik, belge ve roller aynı envanteri okur.",
        statLabel: "otel odası",
      },
    ],
    chips: ["bildirim", "belge", "ödeme", "erişim"],
  },
  ru: {
    eyebrow: "Карта эксплуатации",
    title: "От участка к блоку, от квартиры к решению",
    intro:
      "Комплекс, блок, квартира и управление находятся в одной модели. Каждая точка — это реальная работа: заявка, проводка, документ, согласование.",
    plate: "Участок Тюрклер",
    unitRecord: "карточка квартиры",
    steps: [
      {
        label: "Участок",
        title: "Комплекс как единый фонд",
        text: "Блоки, дороги, территория, отель и общие зоны связаны одной записью.",
        statLabel: "м² участка",
      },
      {
        label: "Блок и этаж",
        title: "Каждый блок стоит в фонде",
        text: "Этаж, планировка, статус, собственник и открытые работы видны в одном списке.",
        statLabel: "блоков",
      },
      {
        label: "Квартира",
        title: "У каждой квартиры своя карточка",
        text: "Передача, обслуживание, платежи, документы и фотоотчёты остаются за квартирой.",
        statLabel: "квартир",
      },
      {
        label: "Управление",
        title: "Отель и жильё в одной системе",
        text: "Бухгалтерия, техника, документы и роли читают один и тот же фонд.",
        statLabel: "номеров",
      },
    ],
    chips: ["заявка", "документ", "платёж", "доступ"],
  },
}

function subscribeToReducedMotion(onChange: () => void): () => void {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
  mq.addEventListener("change", onChange)
  return () => mq.removeEventListener("change", onChange)
}

/**
 * `useSyncExternalStore` rather than an effect: setting state synchronously
 * inside an effect triggers a cascading render, and the server snapshot has to
 * be `false` so the markup matches before hydration.
 */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  )
}

export function OperatingMap({ locale }: { locale: string }) {
  const copy = COPY[locale as Locale] ?? COPY.de
  const reduced = usePrefersReducedMotion()
  const [active, setActive] = useState(0)
  const root = useRef<HTMLElement>(null)

  // One image per step, taken from that act's pool.
  const images = useMemo(
    () =>
      STEPS.map((step): JourneyImage | undefined => {
        const pool = imagesForAct(step.act)
        return pool[0]
      }),
    [],
  )

  // Scroll drives the step. Under reduced motion every step is already open,
  // so the observer is never armed and nothing depends on movement.
  useEffect(() => {
    if (reduced) return
    const el = root.current
    if (!el) return
    const onScroll = () => {
      const rect = el.getBoundingClientRect()
      const span = rect.height - window.innerHeight
      if (span <= 0) return
      const progress = Math.min(Math.max(-rect.top / span, 0), 0.999)
      setActive(Math.floor(progress * STEPS.length))
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [reduced])

  const shown = reduced ? STEPS.length - 1 : active

  return (
    <section
      ref={root}
      aria-labelledby="operating-map-title"
      className="relative border-t border-border/60 bg-secondary/30"
    >
      <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {copy.eyebrow}
        </p>
        <h2
          id="operating-map-title"
          className="mt-4 max-w-3xl font-[family-name:var(--font-display)] text-4xl leading-[1.08] text-foreground sm:text-5xl"
        >
          {copy.title}
        </h2>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">{copy.intro}</p>

        <div className="mt-16 grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start lg:gap-16">
          {/* Steps. Buttons, so the whole thing works from the keyboard. */}
          <ol className="space-y-3">
            {copy.steps.map((step, index) => {
              const Icon = STEPS[index]!.icon
              const isActive = index === shown
              return (
                <li key={step.label}>
                  <button
                    type="button"
                    onClick={() => setActive(index)}
                    aria-current={isActive ? "step" : undefined}
                    className={cn(
                      "w-full rounded-2xl border p-5 text-left transition-colors duration-200",
                      isActive
                        ? "border-primary/40 bg-card shadow-sm"
                        : "border-border/50 bg-transparent hover:border-border",
                    )}
                  >
                    <div className="flex items-start gap-4">
                      <span
                        className={cn(
                          "mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-colors",
                          isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                        )}
                      >
                        <Icon className="h-5 w-5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          {step.label}
                        </span>
                        <span className="mt-1 block text-base font-semibold text-foreground">
                          {step.title}
                        </span>
                        <span
                          className={cn(
                            "mt-2 block text-sm leading-relaxed text-muted-foreground transition-opacity duration-200",
                            isActive ? "opacity-100" : "opacity-0 lg:opacity-70",
                          )}
                        >
                          {step.text}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-[family-name:var(--font-display)] text-2xl text-foreground">
                          {STEPS[index]!.stat}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {step.statLabel}
                        </span>
                      </span>
                    </div>
                  </button>
                </li>
              )
            })}
          </ol>

          {/* The plate. CSS perspective, no canvas, so there is nothing to fall back to. */}
          <div className="lg:sticky lg:top-28">
            <div className="relative aspect-[4/3] w-full [perspective:1200px]">
              <div
                className="absolute inset-x-6 bottom-8 top-16 rounded-[2rem] border border-border/70 bg-card/80 shadow-[0_38px_80px_rgba(14,107,140,0.12)]"
                style={{ transform: "skewY(-9deg) rotate(-1deg)" }}
                aria-hidden
              >
                <div className="absolute inset-4 rounded-[1.5rem] border border-border/50 bg-secondary/40" />
                <div className="absolute left-[10%] top-[16%] h-[16%] w-[70%] rounded-full border border-dashed border-border" />
                <div className="absolute bottom-[16%] right-[9%] h-[20%] w-[36%] rounded-full border border-dashed border-border" />
                <div className="grid h-full grid-cols-4 gap-2 p-8">
                  {Array.from({ length: 8 }).map((_, index) => (
                    <div
                      key={index}
                      className={cn(
                        "rounded-md transition-colors duration-500",
                        index === 3
                          ? "bg-accent/70"
                          : shown >= 1
                            ? "bg-primary/45"
                            : "bg-primary/15",
                      )}
                    />
                  ))}
                </div>
                <span className="absolute -bottom-7 left-3 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold text-muted-foreground">
                  {copy.plate}
                </span>
              </div>

              {/* The photograph for the active step, floating over the plate. */}
              {images.map((image, index) =>
                image === undefined ? null : (
                  <div
                    key={image.id}
                    className={cn(
                      "absolute inset-x-10 top-6 overflow-hidden rounded-2xl border border-border/70 shadow-[0_28px_60px_rgba(10,22,32,0.22)] transition-all duration-500 ease-out motion-reduce:transition-none",
                      index === shown
                        ? "translate-y-0 opacity-100"
                        : "pointer-events-none translate-y-3 opacity-0",
                      reduced && index !== shown ? "hidden" : undefined,
                    )}
                  >
                    <ActMedia
                      image={image}
                      alt={copy.steps[index]?.title ?? copy.title}
                      layout="tile"
                      priority={index === 0}
                    />
                  </div>
                ),
              )}

              {/* Unit record card, from the apartment step onward. */}
              <div
                className={cn(
                  "absolute bottom-2 right-2 w-48 rounded-2xl border border-border bg-card p-4 shadow-lg transition-all duration-500 motion-reduce:transition-none",
                  shown >= 2 ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
                )}
              >
                <p className="font-[family-name:var(--font-display)] text-sm text-foreground">
                  AZW-B03-0412
                </p>
                <p className="text-[11px] text-muted-foreground">{copy.unitRecord}</p>
                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  {copy.chips.map((chip) => (
                    <span
                      key={chip}
                      className="rounded-md bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
