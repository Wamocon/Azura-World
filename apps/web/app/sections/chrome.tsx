/**
 * Page chrome: notice strip, navigation, footer.                     Owner: W3-A
 *
 * Three sections in one file because they are one thing — the frame around the
 * document — and splitting them would put three near-identical import blocks in
 * the tree without making anything easier to find.
 *
 * **The wordmark is typographic and it is ours.** Cebeci Group's marks are in
 * the harvest and they stay there: their logo in our header would imply
 * endorsement, which is the one use LANDING-CRAFT §2 rules out. Their name
 * appears as the subject of the analysis, attributed, which is nominative use.
 */

import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"

import { Link } from "@/app/navigation"
import { Container } from "@/components/azura/section"
import { LocaleSwitcher } from "@/components/locale-switcher"
import { InventoryValue } from "@/components/azura/inventory-value"
import { project } from "@/components/azura/landing-data"

export async function TopBar({
  locale,
}: {
  locale: string
}): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing" })
  return (
    <div className="border-b border-border/60 bg-secondary/60">
      <Container className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-2">
        <p className="text-[0.75rem] leading-[1.5] tracking-[0.01em] text-secondary-foreground">
          {t("topBar.notice")}
        </p>
        <Link
          href="/#system"
          className="azura-tap-compact inline-flex items-center text-[0.75rem] font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          {t("topBar.cta")}
        </Link>
      </Container>
    </div>
  )
}

/**
 * Sticky, translucent, with the content scrolling under it rather than a solid
 * strip consuming a fixed band (apple-design §12). `azura-glass` carries the
 * blur and drops it under `prefers-reduced-transparency`.
 */
export async function Navbar({
  locale,
}: {
  locale: string
}): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing" })
  const items = [
    { href: "/#what", label: t("nav.project") },
    { href: "/#site", label: t("nav.site") },
    { href: "/#hotel", label: t("nav.hotel") },
    { href: "/#system", label: t("nav.system") },
  ] as const

  return (
    <header className="azura-glass sticky top-0 z-40 border-b border-border/60">
      <Container className="flex items-center justify-between gap-4 py-3">
        <Link
          href="/#top"
          className="azura-tap-compact inline-flex items-center font-display text-[1.0625rem] leading-none tracking-[-0.01em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          Azura&nbsp;World&nbsp;
          <span className="text-muted-foreground">CATI</span>
        </Link>

        <nav aria-label={t("nav.project")} className="hidden md:block">
          <ul className="flex items-center gap-6">
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="azura-tap-compact inline-flex items-center text-[0.875rem] text-muted-foreground transition-colors duration-[var(--duration-instant)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-3">
          <LocaleSwitcher compact />
          <Link
            href="/#access"
            className="azura-tap-compact hidden rounded-full border border-primary px-4 text-[0.875rem] font-medium text-primary transition-transform duration-[var(--duration-instant)] ease-[var(--ease-out)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] active:scale-[0.97] sm:inline-flex"
          >
            {t("nav.access")}
          </Link>
        </div>
      </Container>
    </header>
  )
}

export async function Footer({
  locale,
}: {
  locale: string
}): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing" })
  const gapLabel = t("provenance.gap")

  return (
    <footer className="border-t border-border pt-14 pb-12">
      <Container className="flex flex-col gap-10">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-3">
            <h2 className="text-[0.6875rem] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              {t("footer.contactHeading")}
            </h2>
            <p className="text-[0.9375rem] leading-[1.6]">
              <InventoryValue
                fact={project.contact.phone}
                format="text"
                locale={locale}
                gapLabel={gapLabel}
              />
            </p>
            <p className="text-[0.9375rem] leading-[1.6]">
              <InventoryValue
                fact={project.contact.email}
                format="text"
                locale={locale}
                gapLabel={gapLabel}
              />
            </p>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <h2 className="text-[0.6875rem] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              {t("footer.aboutHeading")}
            </h2>
            <p className="max-w-[42ch] text-[0.875rem] leading-[1.6] text-muted-foreground">
              {t("footer.rights")}
            </p>
          </div>
        </div>

        {/* "Datenstand {date}" stood here, and it was the last surviving piece
            of the record line the hero dropped. A data-as-of stamp in a footer
            tells a reader they are looking at a snapshot of a dataset. They are
            looking at a system that runs their building, and a system does not
            have a data date. PIVOT §4 lists `DATA AS OF` by name. */}
      </Container>
    </footer>
  )
}
