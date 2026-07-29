/**
 * What the system does.                                        Owner: W-CINEMA
 *
 * The section PIVOT.md created and the original W-CINEMA brief did not have.
 *
 * Every other section on this page shows Azura World their building. This one
 * shows them the thing they are actually being asked to buy: the system that
 * runs it. Without it the page is a beautiful brochure for a property its
 * audience already owns, which is the one thing it must not be.
 *
 * ## Six groups, because six is what the roles already are
 *
 * These are not marketing pillars invented to fill a grid. Each maps to modules
 * that exist and to roles in `lib/rbac.ts`:
 *
 *   residents    -> tenant, owner, guest and the three child_* roles
 *   management   -> manager, staff, service_provider
 *   tickets      -> service_tickets, activities, calendar, communications
 *   finance      -> finance, wallet, vendor_invoices
 *   documents    -> documents, compliance, reports
 *   admin        -> users, settings, the audit trail
 *
 * The numbers in the copy are the client's own inventory, not claims about
 * their business: 656 units, 7 blocks, 188 hotel rooms, 11 roles, 4 languages.
 *
 * ## What is deliberately NOT here
 *
 * No source chips, no "n Quellen", no confidence badges. PIVOT §4: everything
 * that presents this as research about them rather than a system for them is
 * gone from the public page, and this section is the newest surface, so it is
 * the easiest place to reintroduce it by habit. It does not.
 *
 * No integration logos and no uptime figure either. An integration shown as
 * healthy when it is not wired is the one honesty rule PIVOT §2 keeps without
 * qualification.
 */

import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"

import { Reveal } from "@/components/anim/reveal"
import { Section } from "@/components/azura/section"

/** The six groups, in the order a working day touches them. */
const GROUPS = [
  "residents",
  "management",
  "tickets",
  "finance",
  "documents",
  "admin",
] as const

export async function SystemSection({
  locale,
}: {
  locale: string
}): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing" })

  return (
    <Section
      id="system"
      designation={t("designation.system")}
      title={t("system.title")}
      lead={t("system.lead")}
    >
      {/* One column at 320px, two from `sm`, three from `lg`. German is the
          longest of the four locales and 320px is the narrowest target, so the
          single column is the case that actually has to hold; the wider ones
          are the easy direction. */}
      <ul className="grid list-none grid-cols-1 gap-px border border-border/60 bg-border/60 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {GROUPS.map((group, index) => (
          <li key={group} className="bg-background">
            {/* Stagger is index-based and capped: six cards revealing in
                sequence reads as choreography, but a 6 x 60ms tail on the last
                card is 360ms of a visitor waiting for a heading. */}
            <Reveal delay={Math.min(index, 3) * 0.04}>
              <div className="flex h-full flex-col gap-2.5 p-5 sm:p-6">
                <h3 className="font-display text-[1.0625rem] leading-[1.3] tracking-[-0.01em] text-foreground">
                  {t(`system.groups.${group}.title`)}
                </h3>
                <p className="text-[0.9375rem] leading-[1.6] text-muted-foreground">
                  {t(`system.groups.${group}.body`)}
                </p>
                <p className="mt-auto pt-2 text-[0.8125rem] leading-[1.5] text-muted-foreground/80">
                  {t(`system.groups.${group}.detail`)}
                </p>
              </div>
            </Reveal>
          </li>
        ))}
      </ul>

      {/* The closing line carries the demo-data disclosure. PIVOT §2 changed
          "never invent a number" to "seed a realistic operating year", and kept
          one half of it without qualification: demo data is labelled demo data,
          everywhere, always. This is the public surface of that label. */}
      <p className="mt-8 max-w-[62ch] text-[0.9375rem] leading-[1.6] text-muted-foreground">
        {t("system.demoNote")}
      </p>
    </Section>
  )
}
