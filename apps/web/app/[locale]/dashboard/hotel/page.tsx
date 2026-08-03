import { Building2, Info } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"

import { toneAt } from "@/components/charts"
import type { ChartPoint } from "@/components/charts"
import { HotelOpsIdentityBand } from "@/components/hotel/hotelops-identity-band"
import { HotelOpsNote } from "@/components/hotel/hotelops-note"
import {
  HotelOpsRoomMix,
  type HotelOpsRoomTypeCard,
} from "@/components/hotel/hotelops-room-mix"
import {
  HotelOpsStat,
  type HotelOpsStatItem,
} from "@/components/hotel/hotelops-stat"
import { getUserProfile } from "@/lib/auth"
import type { Locale } from "@/lib/contracts"
import {
  formatArea,
  formatDistance,
  formatNumber,
  formatPercent,
} from "@/lib/format"
import { getGlossary } from "@/lib/glossary"
import { getHotel, getHotelRooms } from "@/lib/hotel-repository"
import { hasPermission } from "@/lib/rbac"

/**
 * /[locale]/dashboard/hotel — the hotel operations surface.  Owner: W3-G
 *
 * `tasks/W3-G` §3 asks for three things here: the 188 rooms, occupancy, and the
 * hotel↔residence relationship. Two of them are mostly **gaps**, and this page
 * is built around saying so rather than around filling them.
 *
 * ## What changed, and why
 *
 * The first version was correct and unreadable: nine label/value pairs in one
 * flat run, an internal total-versus-sum reconciliation printed for the reader
 * to audit, and two paragraphs of prose arguing why occupancy is absent. Every
 * fact carried the same weight, so none of them landed.
 *
 * It now reads top to bottom as one argument:
 *
 * 1. **Who this property is** — name, former name, category, and the four
 *    figures that size it. One band, four numbers, nothing competing.
 * 2. **How the rooms divide** — the mix as a composition bar plus a card per
 *    room type. The total check runs as before and is stated as a conclusion
 *    ("they add up") rather than as two numbers to compare.
 * 3. **What nobody published** — occupancy, in one sentence.
 * 4. **The operational detail** — arrival, departure, board, opened. Real, but
 *    not headline material.
 * 5. **How the hotel relates to the residence.**
 *
 * ## What is actually known
 *
 * - **188 rooms**, corroborated. Where a room-type split is published it is
 *   charted; where it is not, the absence is a designed state, never an empty
 *   table and never a plausible invented split.
 * - **Occupancy: nothing is published.** No source states an occupancy rate,
 *   and there is no booking system behind this to compute one. A plausible
 *   "78 %" would be the single most damaging number this product could invent,
 *   because it is exactly what a competitor analysis is read for.
 * - **The relationship** — 188 hotel rooms beside 656 residence units, sharing
 *   a site, with two different distances to two different bits of water.
 *
 * ## Rendering mode and landmarks
 *
 * No `export const dynamic` — the root layout's `headers()` read already opts
 * every route out of static generation (S-009), and `pnpm qa:csp` fails the
 * build if that changes. No `<main>`: `dashboard/layout.tsx` renders it, and
 * WCAG 2.2 allows exactly one per document.
 */

/**
 * The browser tab, in the reader's language. This was a German literal, so a
 * Turkish page carried a German tab; the heading beside it was already
 * translated, which made the mismatch worse rather than invisible.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.hotel" })
  return {
    title: t("title"),
    robots: { index: false, follow: false },
  }
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
        <h1 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
          {t("title")}
        </h1>
        <p
          role="alert"
          data-testid="hotel-forbidden"
          className="max-w-prose text-sm text-muted-foreground"
        >
          {tCommon("errors.forbidden")}
        </p>
      </section>
    )
  }

  const [hotelResult, roomsResult, glossary] = await Promise.all([
    getHotel(),
    getHotelRooms(),
    getGlossary(locale),
  ])
  const hotel = hotelResult.data
  const seeded =
    hotelResult.source === "local-seed" || roomsResult.source === "local-seed"

  /** The one wording for "no source states this". Never `0`, never a dash. */
  const gapText = tCommon("notAvailable")

  const header = (
    <header className="flex min-w-0 flex-col gap-2">
      <h1 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
        {t("title")}
      </h1>
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        {t("lead")}
      </p>
      {seeded ? (
        <p
          role="status"
          data-testid="hotel-seed-notice"
          className="mt-1 w-fit rounded-lg border border-quality-modelled/40 bg-quality-modelled/10 px-3 py-2 text-xs leading-relaxed text-quality-modelled"
        >
          {t("seedNotice")}
        </p>
      ) : null}
    </header>
  )

  if (hotel === null) {
    return (
      <div className="flex min-w-0 flex-col gap-8">
        {header}
        <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          {t("empty")}
        </p>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // The four headline figures.
  //
  // The beach distance is stored in metres and read in kilometres. That is not
  // a conversion in the sense this project forbids: there is no rate and no
  // rate date, 1000 m IS 1 km, and the public source's own prose says "1 km".
  // The stored metre value stays in the `title` so the exact figure is one
  // hover away, and `HANDOFF/W3-G.md` §10 records why both forms exist.
  // ---------------------------------------------------------------------------

  const metres = hotel.distanceToBeachM
  const headlineFigures: HotelOpsStatItem[] = [
    {
      key: "rooms",
      label: t("facts.rooms"),
      value: hotel.roomCount === null ? gapText : formatNumber(hotel.roomCount, locale),
      gap: hotel.roomCount === null,
      title: null,
    },
    {
      key: "floors",
      label: t("facts.floors"),
      value: hotel.floors === null ? gapText : formatNumber(hotel.floors, locale),
      gap: hotel.floors === null,
      title: null,
    },
    {
      key: "aquapark",
      label: t("facts.aquapark"),
      value:
        hotel.aquaparkSlides === null
          ? gapText
          : formatNumber(hotel.aquaparkSlides, locale),
      gap: hotel.aquaparkSlides === null,
      title: null,
    },
    {
      key: "beach",
      label: t("facts.beach"),
      value: metres === null ? gapText : formatDistance(metres, locale),
      gap: metres === null,
      title:
        metres === null
          ? null
          : `${formatNumber(metres, locale)} ${tCommon("units.m")}`,
    },
  ]

  // ---------------------------------------------------------------------------
  // The room mix.
  //
  // Nothing is inferred: a row without a count is charted nowhere and reads
  // "not stated" on its card, and a room type nobody published simply does not
  // exist here. The tone is assigned once, per row, and handed to both the bar
  // segment and the card so the swatch and the segment can never drift apart.
  // ---------------------------------------------------------------------------

  const publishedTotal = roomsResult.data.publishedRoomTotal

  const roomRows = roomsResult.data.rooms.map((room, index) => {
    const count = room.roomCount
    return {
      key: room.id,
      code: room.code,
      // The published name first: "Standardzimmer" is what a reader recognises,
      // "standard" is the machine's word for it.
      name: room.name ?? room.roomType ?? room.code,
      count,
      countText: count === null ? gapText : formatNumber(count, locale),
      countIsGap: count === null,
      shareText:
        count === null || publishedTotal === null || publishedTotal <= 0
          ? null
          : formatPercent(count / publishedTotal, locale, 1),
      area: {
        text:
          room.interiorM2 === null
            ? gapText
            : formatArea(room.interiorM2, locale),
        gap: room.interiorM2 === null,
      },
      guests: {
        text:
          room.maxOccupancy === null
            ? gapText
            : formatNumber(room.maxOccupancy, locale),
        gap: room.maxOccupancy === null,
      },
      seaView: {
        text:
          room.hasSeaView === null
            ? gapText
            : room.hasSeaView
              ? tCommon("boolean.yes")
              : tCommon("boolean.no"),
        gap: room.hasSeaView === null,
      },
      tone: toneAt(index),
    }
  })

  // Listed field by field rather than spread: `count` is geometry for the bar
  // and must not reach a card, where it would be a second, unformatted copy of
  // a number the card already renders as text.
  const roomCards: HotelOpsRoomTypeCard[] = roomRows.map((row) => ({
    key: row.key,
    code: row.code,
    name: row.name,
    countText: row.countText,
    countIsGap: row.countIsGap,
    shareText: row.shareText,
    area: row.area,
    guests: row.guests,
    seaView: row.seaView,
    tone: row.tone,
  }))

  const roomSegments: ChartPoint[] = roomRows.flatMap((row) =>
    row.count === null || row.count <= 0
      ? []
      : [
          {
            label: row.name,
            value: row.count,
            formattedValue: row.countText,
            tone: row.tone,
          },
        ]
  )

  /**
   * The total check, stated as its own conclusion.
   *
   * `publishedRoomTotal` sums only the rows that state a count, and it is
   * compared with the hotel's own `roomCount` rather than replacing it. Two
   * figures that disagree is a finding, not a rounding error, so that case
   * names both numbers and adjusts neither. The agreeing case is one quiet
   * sentence: the reader is told the check passed, not asked to run it.
   */
  const roomTotal = hotel.roomCount
  const reconciliation =
    publishedTotal === null || roomTotal === null
      ? null
      : publishedTotal === roomTotal
        ? {
            kind: "match" as const,
            text: t("roomMix.reconciled", { total: roomTotal }),
          }
        : {
            kind: "mismatch" as const,
            text: t("roomMix.mismatch", {
              published: publishedTotal,
              total: roomTotal,
            }),
          }

  const stayFigures: HotelOpsStatItem[] = [
    {
      key: "checkIn",
      label: t("facts.checkIn"),
      // A TIME column arrives as "14:00:00". Trimmed to the hour and minute,
      // never parsed into a Date: it is a wall-clock time, not an instant.
      value: hotel.checkIn === null ? gapText : hotel.checkIn.slice(0, 5),
      gap: hotel.checkIn === null,
      title: null,
    },
    {
      key: "checkOut",
      label: t("facts.checkOut"),
      value: hotel.checkOut === null ? gapText : hotel.checkOut.slice(0, 5),
      gap: hotel.checkOut === null,
      title: null,
    },
    {
      key: "board",
      label: t("facts.board"),
      value: hotel.board ?? gapText,
      gap: hotel.board === null,
      title: null,
    },
    {
      key: "opened",
      // A year is never thousands-separated: "2.025" is not a year.
      label: t("facts.opened"),
      value: hotel.openedYear === null ? gapText : String(hotel.openedYear),
      gap: hotel.openedYear === null,
      title: null,
    },
  ]

  return (
    <div className="flex min-w-0 flex-col gap-8 lg:gap-10">
      {header}

      <HotelOpsIdentityBand
        eyebrow={t("identity.eyebrow")}
        name={hotel.name}
        formerLabel={t("identity.formerly")}
        formerName={hotel.formerName}
        category={
          hotel.stars === null
            ? { label: t("identity.starsNotStated"), gap: true }
            : { label: t("identity.stars", { count: hotel.stars }), gap: false }
        }
        chainNote={
          hotel.brandAffiliation === null
            ? t("identity.chainNotStated")
            : t("identity.chain", { name: hotel.brandAffiliation })
        }
        figures={headlineFigures}
        explainGap={glossary.gap}
      />

      <HotelOpsRoomMix
        labels={{
          heading: t("roomMix.heading"),
          detailHeading: t("roomMix.detailHeading"),
          rooms: t("roomMix.rooms"),
          area: t("roomMix.area"),
          guests: t("roomMix.guests"),
          seaView: t("roomMix.seaView"),
          chartAriaLabel: t("roomMix.chartAriaLabel"),
          chartBasis: t("roomMix.chartBasis"),
          chartEmpty: t("roomMix.chartEmpty"),
          tableCategory: t("roomMix.tableCategory"),
          tableValue: t("roomMix.tableValue"),
          noBreakdownHeading: t("roomMix.noBreakdownHeading"),
          noBreakdown: t("roomMix.noBreakdown"),
        }}
        segments={roomSegments}
        cards={roomCards}
        reconciliation={reconciliation}
        explainGap={glossary.gap}
      />

      {/* Occupancy. An explicit gap, said once. */}
      <HotelOpsNote
        icon={<Info />}
        heading={t("occupancyPanel.heading")}
        body={t("occupancyPanel.note")}
        explain={glossary.gap}
        slot="occupancy"
        testId="occupancy-gap"
      />

      <section
        data-slot="hotelops-stay"
        className="flex min-w-0 flex-col gap-4"
      >
        <h2 className="font-display text-lg font-semibold tracking-[-0.015em] text-foreground">
          {t("stay.heading")}
        </h2>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-6 rounded-2xl border border-border bg-card p-5 sm:grid-cols-4 sm:p-6">
          {stayFigures.map((figure) => (
            <HotelOpsStat
              key={figure.key}
              item={figure}
              size="sm"
              explainGap={glossary.gap}
            />
          ))}
        </dl>
      </section>

      {/* The relationship. This is the part the page can state plainly, and it
          is what actually explains the property to a reader who has seen the
          residence numbers elsewhere in the dashboard. */}
      <HotelOpsNote
        icon={<Building2 />}
        heading={t("relationship.heading")}
        body={t("relationship.body")}
        explain={null}
        slot="hotel-residence"
        testId={null}
      />
    </div>
  )
}
