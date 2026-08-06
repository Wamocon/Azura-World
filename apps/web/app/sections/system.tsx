/**
 * What the system does — one record, many flows.              Owner: W-CINEMA
 *
 * The section PIVOT.md created: the page's audience already owns the building,
 * so this shows the thing they are actually being asked to buy — the system
 * that runs it.
 *
 * ## The shape is the argument
 *
 * It used to be six equal cards in a flat grid. It is now the hub-and-spoke
 * 1Çatı's New Level landing uses: one core in the middle — the shared record,
 * with the client's real inventory on it — and the six operating groups around
 * it. The layout says what the copy says: every group reads and writes the same
 * record. Six separate cards said six separate products.
 *
 * ## The shape assembles, because a still layout cannot say what came first
 *
 * Hub-and-spoke drawn all at once is six cards that happen to sit around a
 * seventh. `landing-choreography.tsx` lands the core first and then moves each
 * card outward away from it, alternating sides, so the order of arrival says
 * what the layout can only imply: the groups come out of the record, not the
 * other way round.
 *
 * As with the ledger and the lifecycle track, the server renders the assembled
 * hub and the choreography rewinds it. No-JS and reduced-motion readers get the
 * core and all six cards; the worst case is a hub that does not move.
 *
 * ## Six groups, because six is what the roles already are
 *
 * Each maps to modules that exist and to roles in `lib/rbac.ts`:
 * residents, management, tickets, finance, documents, admin. The numbers on the
 * core are the client's own inventory (656 units, 7 blocks, 188 hotel rooms),
 * not claims about their business.
 *
 * ## What is deliberately NOT here
 *
 * No source chips, no confidence badges (PIVOT §4: this is a system for them,
 * not research about them). No integration logos, no uptime figure. And the
 * demo-data disclosure stays, at body size, never a footnote.
 */

import {
  Building2,
  FileText,
  ShieldCheck,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"

import { Container, Section } from "@/components/azura/section"
import type { Locale } from "@/lib/contracts"
import { intlLocaleTag } from "@/lib/format"

/** The six groups, each with an icon and a tone drawn from the chart palette so
 *  the colour stays on-brand in both themes. Split 3 / 3 around the core. */
const GROUPS: ReadonlyArray<{ key: string; icon: LucideIcon; color: string }> = [
  { key: "residents", icon: Users, color: "var(--chart-3)" },
  { key: "management", icon: Building2, color: "var(--chart-1)" },
  { key: "tickets", icon: Wrench, color: "var(--chart-4)" },
  { key: "finance", icon: Wallet, color: "var(--chart-2)" },
  { key: "documents", icon: FileText, color: "var(--chart-5)" },
  { key: "admin", icon: ShieldCheck, color: "var(--primary)" },
]

/** The core's counted figures. Plain numbers, like the flow band — this surface
 *  carries no provenance chips by design (see the header note). */
const CORE_STATS: ReadonlyArray<{ key: "units" | "blocks" | "rooms"; value: number }> =
  [
    { key: "units", value: 656 },
    { key: "blocks", value: 7 },
    { key: "rooms", value: 188 },
  ]

function GroupCard({
  group,
  title,
  body,
}: {
  group: (typeof GROUPS)[number]
  title: string
  body: string
}): ReactNode {
  const Icon = group.icon
  return (
    <div className="flex h-full min-w-0 items-start gap-4 rounded-[var(--radius-xl)] border border-[color-mix(in_srgb,var(--foreground)_10%,transparent)] bg-[var(--card)] p-5 transition-transform duration-200 motion-safe:hover:-translate-y-0.5">
      <span
        aria-hidden="true"
        className="grid size-11 shrink-0 place-items-center rounded-xl"
        style={{
          color: group.color,
          backgroundColor: `color-mix(in srgb, ${group.color} 14%, transparent)`,
        }}
      >
        <Icon className="size-[1.35rem]" />
      </span>
      <div className="min-w-0">
        <h3 className="font-display text-[1.0625rem] leading-[1.25] tracking-[-0.01em] text-foreground">
          {title}
        </h3>
        <p className="mt-1.5 text-[0.875rem] leading-[1.55] text-muted-foreground">
          {body}
        </p>
      </div>
    </div>
  )
}

export async function SystemSection({
  locale,
}: {
  locale: string
}): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing" })
  const nf = new Intl.NumberFormat(intlLocaleTag(locale as Locale))

  const left = GROUPS.slice(0, 3)
  const right = GROUPS.slice(3, 6)

  return (
    <Section
      id="system"
      designation={t("designation.system")}
      title={t("system.title")}
      lead={t("system.lead")}
    >
      <Container className="flex flex-col gap-8 px-0 sm:px-0">
        <div
          data-cine-hub
          className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)_minmax(0,1fr)] lg:items-center"
        >
          {/* Left three. On mobile they follow the core; on lg they sit beside
              it, so the whole reads as a hub with spokes. */}
          <div className="order-2 grid gap-4 sm:grid-cols-2 lg:order-1 lg:grid-cols-1">
            {left.map((group) => (
              // The marker sits on a wrapper, not on the card. The card already
              // owns a `transition-transform` for its hover lift, and GSAP
              // writing a transform to that same element every frame would be
              // eased a second time by the CSS transition and arrive late.
              // Two animations, two elements.
              <div
                key={group.key}
                data-cine-hub-spoke
                data-cine-hub-side="left"
                className="h-full"
              >
                <GroupCard
                  group={group}
                  title={t(`system.groups.${group.key}.title`)}
                  body={t(`system.groups.${group.key}.body`)}
                />
              </div>
            ))}
          </div>

          {/* The core: the shared record, with the client's real inventory. */}
          <div data-cine-hub-core className="order-1 lg:order-2">
            <div className="relative flex flex-col items-center gap-5 overflow-hidden rounded-[var(--radius-2xl)] border border-[color-mix(in_srgb,var(--primary)_22%,transparent)] bg-[var(--card)] p-7 text-center sm:p-8">
              {/* A soft azure wash behind the core, so it reads as the source the
                  spokes draw from rather than a seventh card. Decorative. */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(120%_100%_at_50%_0%,color-mix(in_srgb,var(--primary)_16%,transparent),transparent)]"
              />
              <span className="azura-label relative rounded-full border border-[color-mix(in_srgb,var(--primary)_28%,transparent)] bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] px-3 py-1 text-primary">
                {t("system.core.eyebrow")}
              </span>
              <span
                aria-hidden="true"
                className="relative grid size-14 place-items-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-primary"
              >
                <ShieldCheck className="size-7" />
              </span>
              <div className="relative">
                <h3 className="font-display text-[1.5rem] leading-none tracking-[-0.02em] text-foreground">
                  {t("system.core.title")}
                </h3>
                <p className="mt-1.5 text-[0.875rem] text-muted-foreground">
                  {t("system.core.subtitle")}
                </p>
              </div>
              <dl className="relative grid w-full grid-cols-3 gap-2">
                {CORE_STATS.map((stat) => (
                  <div key={stat.key} className="flex flex-col gap-0.5">
                    <dd
                      data-numeric
                      className="font-display text-[1.375rem] leading-none tracking-[-0.02em] text-foreground"
                    >
                      {nf.format(stat.value)}
                    </dd>
                    <dt className="text-[0.6875rem] leading-tight text-muted-foreground">
                      {t(`system.core.${stat.key}`)}
                    </dt>
                  </div>
                ))}
              </dl>
              {/* Two bars reading from the record. Decorative signal, azure then
                  sand, so the core visibly feeds more than one flow. */}
              <div
                aria-hidden="true"
                className="relative flex w-full flex-col gap-2 pt-1"
              >
                <span className="h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)]">
                  <span className="block h-full w-[86%] rounded-full bg-primary/70" />
                </span>
                <span className="h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)]">
                  <span className="block h-full w-[58%] rounded-full bg-accent/70" />
                </span>
              </div>
            </div>
          </div>

          {/* Right three. */}
          <div className="order-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            {right.map((group) => (
              <div
                key={group.key}
                data-cine-hub-spoke
                data-cine-hub-side="right"
                className="h-full"
              >
                <GroupCard
                  group={group}
                  title={t(`system.groups.${group.key}.title`)}
                  body={t(`system.groups.${group.key}.body`)}
                />
              </div>
            ))}
          </div>
        </div>

        {/* The demo-data disclosure. PIVOT §2: demo data is labelled demo data,
            everywhere, always. Body size on the accent rule, never a footnote. */}
        <p className="max-w-[62ch] border-l-2 border-accent/60 pl-5 text-[0.9375rem] leading-[1.65] text-muted-foreground">
          {t("system.demoNote")}
        </p>
      </Container>
    </Section>
  )
}
