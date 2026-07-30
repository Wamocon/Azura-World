/**
 * Page chrome: notice strip, navigation, footer.                     Owner: W3-A
 *
 * Three sections in one file because they are one thing — the frame around the
 * document — and splitting them would put three near-identical import blocks in
 * the tree without making anything easier to find.
 *
 * **The wordmark is Azura World's own.** That reverses the earlier rule, and the
 * reversal is the point: this is no longer competitor analysis, it is a proposal
 * we are presenting TO Azura World (PIVOT.md). A client's mark belongs on their
 * own proposal. The endorsement worry only applied while we were an outside
 * party publishing about them.
 *
 * ## The chrome floats over the hero, and the scrim is why that is safe
 *
 * The header is fixed and transparent so the photograph runs to the top of the
 * viewport. Transparent chrome over photography is the single most common way
 * to ship an unreadable navigation: the frame is dark today and a re-cast lands
 * a bright sky behind the same white type tomorrow.
 *
 * So the scrim is NOT a scroll effect. It is a `linear-gradient` painted behind
 * the chrome unconditionally, in the markup, sized to the chrome's own height.
 * Every state — no JavaScript, reduced motion, a re-cast hero, a failed
 * hydration — has the same guaranteed ground under the same type. The glass
 * that arrives on scroll is decoration layered on top of a contract that is
 * already satisfied.
 */

import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"

import { Link } from "@/app/navigation"
import { Container } from "@/components/azura/section"
import { LocaleSwitcher } from "@/components/locale-switcher"
import { SurfaceToggle } from "@/components/azura/surface-toggle"
import { InventoryValue } from "@/components/azura/inventory-value"
import { project } from "@/components/azura/landing-data"

/**
 * Notice strip and navigation in one fixed block.
 *
 * They used to be two siblings in the document flow, which put a solid
 * secondary-coloured band across the top of a full-bleed photograph. One fixed
 * block with one shared scrim is the same information without the seam.
 */
export async function Navbar({
  locale,
  surface,
}: {
  locale: string
  /** The current landing surface, so the toggle's first icon matches SSR. */
  surface: "night" | "day"
}): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing" })
  const items = [
    { href: "/#what", label: t("nav.project") },
    { href: "/#site", label: t("nav.site") },
    { href: "/#hotel", label: t("nav.hotel") },
    { href: "/#system", label: t("nav.system") },
  ] as const

  return (
    <header
      data-nav
      // Always night: the bar floats over the dark-scrimmed hero at the top and
      // gets a dark blur once scrolled, so its text is light in both themes. The
      // surface toggle it CONTAINS still switches the body below.
      data-surface="night"
      className="fixed inset-x-0 top-0 z-40 transition-colors duration-[var(--duration-base)] ease-[var(--ease-out)] data-[nav-solid]:bg-[color-mix(in_srgb,#050d13_82%,transparent)] data-[nav-solid]:backdrop-blur-xl"
    >
      {/* The unconditional scrim. `pointer-events-none` so it never eats a
          click on the nav it sits behind. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[160%] bg-[linear-gradient(to_bottom,rgba(5,13,19,0.88)_0%,rgba(5,13,19,0.55)_45%,transparent_100%)]"
      />

      {/* The top "Verwaltungssystem … Vorführung mit Beispieldaten" strip was
          removed on request: it put a full-width band across the top of the
          hero photograph and read as browser chrome, not part of the page. The
          demo-data disclosure it carried is not lost — the footer's rights line
          ("Eine Vorführung für Azura World …") and the system section's demoNote
          both still state it, which is where a reader looks for it anyway. */}
      <div className="relative">
        <div>
          <Container className="flex items-center justify-between gap-4 py-3">
            <Link
              href="/#top"
              className="azura-tap-compact inline-flex items-center gap-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              {/* Their wordmark, on their own proposal. The light variant is
                  the only one used here: the landing chrome is always on the
                  night surface, so the `dark:` pair the old markup carried was
                  two requests to render one asset. */}
              <img
                src="/brand/azura-world-wordmark-light.svg"
                alt="Azura World"
                width={875}
                height={263}
                className="h-6 w-auto"
              />
              <span aria-hidden className="h-5 w-px shrink-0 bg-[color-mix(in_srgb,var(--foreground)_20%,transparent)]" />
              <span className="azura-label text-muted-foreground">CATI</span>
            </Link>

            <nav aria-label={t("nav.project")} className="hidden md:block">
              <ul className="flex items-center gap-8">
                {items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="azura-tap-compact group relative inline-flex items-center text-[0.875rem] text-muted-foreground transition-colors duration-[var(--duration-fast)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                    >
                      {item.label}
                      {/* The underline grows from the left on hover and focus.
                          `scaleX` on a pseudo-element, so nothing reflows and
                          the item does not shift the ones beside it. */}
                      <span
                        aria-hidden="true"
                        className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 bg-primary transition-transform duration-[var(--duration-base)] ease-[var(--ease-out)] group-hover:scale-x-100 group-focus-visible:scale-x-100"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="flex items-center gap-3">
              <SurfaceToggle
                initial={surface}
                labels={{
                  toLight: t("surface.toLight"),
                  toDark: t("surface.toDark"),
                }}
              />
              <LocaleSwitcher compact />
              <Link
                href="/#access"
                className="azura-tap-compact hidden items-center rounded-full border border-[color-mix(in_srgb,var(--primary)_55%,transparent)] px-4 text-[0.875rem] font-medium text-primary transition-colors duration-[var(--duration-fast)] hover:border-primary hover:bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] sm:inline-flex"
              >
                {t("nav.access")}
              </Link>
            </div>
          </Container>
        </div>
      </div>
    </header>
  )
}

/**
 * The closing band.
 *
 * It carries the rights line, and the rights line is the reason this page is
 * allowed to show twenty-two of someone else's photographs. It is set at body
 * size against the muted foreground rather than as the 11px legal whisper that
 * every other site puts there.
 */
export async function Footer({
  locale,
}: {
  locale: string
}): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing" })
  const gapLabel = t("provenance.gap")

  return (
    <footer className="azura-caustics relative border-t border-[color-mix(in_srgb,var(--foreground)_10%,transparent)] pt-20 pb-14">
      <Container className="flex flex-col gap-14">
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr]">
          <div className="flex min-w-0 flex-col gap-5">
            <img
              src="/brand/azura-world-wordmark-light.svg"
              alt="Azura World"
              width={875}
              height={263}
              className="h-8 w-auto self-start opacity-80"
            />
            <p className="max-w-[38ch] text-[0.9375rem] leading-[1.65] text-muted-foreground">
              {t("footer.rights")}
            </p>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <h2 className="azura-label text-primary">
              {t("footer.contactHeading")}
            </h2>
            <p className="text-[0.9375rem] leading-[1.7]">
              <InventoryValue
                fact={project.contact.phone}
                format="text"
                locale={locale}
                gapLabel={gapLabel}
              />
            </p>
            <p className="text-[0.9375rem] leading-[1.7] break-words">
              <InventoryValue
                fact={project.contact.email}
                format="text"
                locale={locale}
                gapLabel={gapLabel}
              />
            </p>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <h2 className="azura-label text-primary">
              {t("footer.aboutHeading")}
            </h2>
            <ul className="flex list-none flex-col gap-2 p-0">
              <li>
                <Link
                  href="/#system"
                  className="azura-tap-compact inline-flex text-[0.9375rem] text-muted-foreground underline-offset-4 transition-colors duration-[var(--duration-fast)] hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                >
                  {t("nav.system")}
                </Link>
              </li>
              <li>
                <Link
                  href="/#access"
                  className="azura-tap-compact inline-flex text-[0.9375rem] text-muted-foreground underline-offset-4 transition-colors duration-[var(--duration-fast)] hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                >
                  {t("nav.access")}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <span aria-hidden="true" className="azura-rule" />

        {/* "Datenstand {date}" stood here, and it was the last surviving piece
            of the record line the hero dropped. A data-as-of stamp in a footer
            tells a reader they are looking at a snapshot of a dataset. They are
            looking at a system that runs their building, and a system does not
            have a data date. PIVOT §4 lists `DATA AS OF` by name. */}
      </Container>
    </footer>
  )
}
