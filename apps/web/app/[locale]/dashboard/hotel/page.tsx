import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"

import { RoomBreakdown } from "@/components/hotel/room-breakdown"
import { getUserProfile } from "@/lib/auth"
import type { Locale } from "@/lib/contracts"
import { getHotel, getHotelRooms } from "@/lib/hotel-repository"
import { hasPermission } from "@/lib/rbac"

/**
 * /[locale]/dashboard/hotel — the hotel operations surface.  Owner: W3-G
 *
 * `tasks/W3-G` §3 asks for three things here: the 188 rooms, occupancy, and the
 * hotel↔residence relationship. Two of them are mostly **gaps**, and this page
 * is built around saying so rather than around filling them.
 *
 * ## What is actually known
 *
 * - **188 rooms**, corroborated — but no source publishes a room-type split, so
 *   the breakdown is an explicit absence (`RoomBreakdown`), not an empty table.
 * - **Occupancy: nothing is published.** No source states an occupancy rate,
 *   and there is no booking system behind this to compute one. The panel says
 *   that. A plausible "78 %" would be the single most damaging number this
 *   product could invent, because it is exactly what a competitor analysis is
 *   read for.
 * - **The relationship** — 188 hotel rooms beside 656 residence units, sharing
 *   a site, with two different distances to two different bits of water. That
 *   is the part this page can state confidently, and it is the part that
 *   actually explains the property.
 *
 * ## Rendering mode and landmarks
 *
 * No `export const dynamic` — the root layout's `headers()` read already opts
 * every route out of static generation (S-009), and `pnpm qa:csp` fails the
 * build if that changes. No `<main>`: `dashboard/layout.tsx` renders it, and
 * WCAG 2.2 allows exactly one per document.
 */

export const metadata: Metadata = {
  title: "Hotelbetrieb",
  robots: { index: false, follow: false },
}

export default async function HotelDashboardPage({
  params,
}: {
  params: Promise<{ locale: Locale }>
}): Promise<ReactNode> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.hotel" })
  const tCommon = await getTranslations({ locale, namespace: "common" })

  // Re-checked here, before any repository call. The nav hides the entry and
  // the client guard renders a panel, but neither is a boundary: a Server
  // Component's output is in the RSC payload before the guard decides, which is
  // exactly how SEC-003 shipped on the evidence cockpit.
  const profile = await getUserProfile()
  if (!profile.authenticated || !hasPermission(profile.role, "hotel:view")) {
    return (
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t("title")}</h1>
        <p role="alert" data-testid="hotel-forbidden" className="max-w-prose text-sm text-muted-foreground">
          {tCommon("errors.forbidden")}
        </p>
      </section>
    )
  }

  const [hotelResult, roomsResult] = await Promise.all([getHotel(), getHotelRooms()])
  const hotel = hotelResult.data
  const seeded = hotelResult.source === "local-seed" || roomsResult.source === "local-seed"

  const number = (value: number | null): string =>
    value === null ? "—" : new Intl.NumberFormat(locale).format(value)

  /**
   * A metre distance, presented as km once it passes 1000.
   *
   * `HANDOFF/W3-G.md` §10 recorded that the public page renders "1.000 m" while
   * its own prose says "1 km" — both correct, both sourced, and jarring beside
   * each other. Unlike a currency conversion this is exact and universal: 1000 m
   * IS 1 km, there is no rate and no rate date, so presenting it in the unit the
   * prose uses changes nothing about the evidence. The metre value stays in the
   * title attribute so the stored figure is one hover away.
   */
  const distance = (metres: number | null): { text: string; exact: string } | null => {
    if (metres === null) return null
    const exact = `${new Intl.NumberFormat(locale).format(metres)} m`
    if (metres < 1000) return { text: exact, exact }
    return {
      text: `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(metres / 1000)} km`,
      exact,
    }
  }

  const beach = distance(hotel?.distanceToBeachM ?? null)

  const facts: Array<{ label: string; value: string; title?: string }> = hotel === null
    ? []
    : [
        { label: t("facts.rooms"), value: number(hotel.roomCount) },
        { label: t("facts.stars"), value: hotel.stars === null ? "—" : `${number(hotel.stars)} ★` },
        { label: t("facts.floors"), value: number(hotel.floors) },
        { label: t("facts.opened"), value: hotel.openedYear === null ? "—" : String(hotel.openedYear) },
        { label: t("facts.board"), value: hotel.board ?? "—" },
        { label: t("facts.aquapark"), value: number(hotel.aquaparkSlides) },
        { label: t("facts.checkIn"), value: hotel.checkIn?.slice(0, 5) ?? "—" },
        { label: t("facts.checkOut"), value: hotel.checkOut?.slice(0, 5) ?? "—" },
        ...(beach === null
          ? [{ label: t("facts.beach"), value: "—" }]
          : [{ label: t("facts.beach"), value: beach.text, title: beach.exact }]),
      ]

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t("title")}</h1>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{t("lead")}</p>
        {seeded ? (
          <p
            role="status"
            data-testid="hotel-seed-notice"
            className="mt-1 rounded-lg border border-quality-modelled/40 bg-quality-modelled/10 px-3 py-2 text-xs leading-relaxed text-quality-modelled"
          >
            {t("seedNotice")}
          </p>
        ) : null}
      </header>

      {hotel === null ? (
        <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <>
          {/* The name, and the former one — F-007. Never shown as a rebrand
              rumour: the former name is labelled as former and nothing here
              claims a current chain affiliation, because no 2026 source states
              one (F-018). */}
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted-foreground">
              {t("facts.name")}
            </span>
            <span className="font-display text-xl text-foreground">{hotel.name}</span>
            {hotel.formerName === null ? null : (
              <span className="text-sm text-muted-foreground">
                {t("facts.formerName")}: {hotel.formerName}
              </span>
            )}
            <span className="text-sm text-muted-foreground">
              {t("facts.brand")}:{" "}
              {hotel.brandAffiliation ?? t("facts.brandNotStated")}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
            {facts.map((fact) => (
              <div key={fact.label} className="flex flex-col gap-1">
                <dt className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted-foreground">
                  {fact.label}
                </dt>
                <dd
                  className="font-display text-2xl text-foreground tabular-nums"
                  {...(fact.title === undefined ? {} : { title: fact.title })}
                >
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>

          <RoomBreakdown
            breakdown={roomsResult.data}
            hotelRoomCount={hotel.roomCount}
            locale={locale}
            labels={{
              heading: t("roomTable.heading"),
              totalLabel: t("roomTable.totalLabel"),
              publishedSumLabel: t("roomTable.publishedSumLabel"),
              code: t("roomTable.code"),
              type: t("roomTable.type"),
              rooms: t("roomTable.rooms"),
              area: t("roomTable.area"),
              occupancy: t("roomTable.occupancy"),
              seaView: t("roomTable.seaView"),
              yes: t("roomTable.yes"),
              no: t("roomTable.no"),
              noBreakdownHeading: t("roomTable.noBreakdownHeading"),
              mismatch: t("roomTable.mismatch"),
            }}
          />

          {/* Occupancy. An explicit gap, not an empty chart. */}
          <section className="flex flex-col gap-2" data-slot="occupancy">
            <h2 className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted-foreground">
              {t("occupancyPanel.heading")}
            </h2>
            <div
              data-testid="occupancy-gap"
              className="flex flex-col gap-2 rounded-xl border border-dashed border-border bg-muted/30 p-6"
            >
              <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
                {t("occupancyPanel.gap")}
              </p>
            </div>
          </section>

          {/* The relationship. This is the part the page can state plainly, and
              it is what actually explains the property to a reader who has seen
              the residence numbers elsewhere in the dashboard. */}
          <section className="flex flex-col gap-2" data-slot="hotel-residence">
            <h2 className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted-foreground">
              {t("relationship.heading")}
            </h2>
            <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
              {t("relationship.body")}
            </p>
          </section>
        </>
      )}
    </section>
  )
}
