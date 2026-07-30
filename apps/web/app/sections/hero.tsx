/**
 * Hero — arrival.                              Owner: W3-A / W-CINEMA / W-NIGHT
 *
 * **Rebuilt on the night surface, 29 July 2026.**
 *
 * What stood here: a cream page, a black sans headline, then a photograph in a
 * band below it with the four figures in a bordered box under that. Three
 * stacked rectangles, each politely waiting its turn, and the strongest asset
 * in an 889-image harvest reduced to an illustration of the sentence above it.
 * Measured by screenshotting it.
 *
 * What stands here now: the photograph IS the viewport. Type sits in it, the
 * figures sit on it, and the whole frame sinks and pushes in as the reader
 * leaves. The four figures are still DOM, still `InventoryValue`, still the
 * client's own inventory — the register changed, the honesty did not.
 *
 * ## What did NOT change, and why it is listed
 *
 * - The credit. MEDIA-LICENSE.md is about rights, not framing. A visible
 *   per-asset credit is required whoever is reading and whatever the surface
 *   looks like, so it is still here and still not behind a hover.
 * - `hero.title` is still the `h1` and still the whole sentence. Splitting it
 *   to put "Azura World" on its own metallic line would have needed the rest of
 *   it re-translated into four locales to still parse as a sentence, which is
 *   a copy change wearing a layout change's clothes.
 * - One scramble on the page, on this heading. Two would be a gimmick.
 *
 * ## The layer stack, bottom to top
 *
 *   photograph (Ken Burns, graded)
 *   vignette          radial, clear centre to dark edge
 *   floor             linear, so the type at the bottom always has ground
 *   departure veil    opacity 0, driven to 1 by the scroll choreography
 *   grain             breaks the banding the two gradients would otherwise show
 *   content
 *
 * Everything above the photograph is `pointer-events: none` and `aria-hidden`.
 * A scrim that eats a click on the primary action is the classic version of
 * this bug.
 */

import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"

import { ScrambleText } from "@/components/anim/scramble-text"
import { Container } from "@/components/azura/section"
import { InventoryValue } from "@/components/azura/inventory-value"
import { ActMedia, ActCredit } from "@/components/journey/act-media"
import { cast } from "@/components/journey/cast"
import { Link } from "@/app/navigation"
import { hotel, project } from "@/components/azura/landing-data"
import type { SourcedFact } from "@/lib/contracts"

export async function HeroSection({
  locale,
}: {
  locale: string
}): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing" })
  const gapLabel = t("provenance.gap")

  // The dusk pool reflection. It is the one eagerly-loaded image on the route;
  // every other frame waits for its own viewport, which is what keeps them off
  // the LCP path.
  const heroImage = cast.hero

  const figures: Array<{ label: string; fact: SourcedFact<unknown>; format: "area" | "number" }> = [
    { label: t("hero.figures.area"), fact: project.plotAreaSqm, format: "area" },
    { label: t("hero.figures.blocks"), fact: project.residenceBlockCount, format: "number" },
    { label: t("hero.figures.units"), fact: project.totalUnits, format: "number" },
    { label: t("hero.figures.hotelRooms"), fact: hotel.roomCount, format: "number" },
  ]

  return (
    <section
      id="top"
      data-cine-hero
      // Always night, even when the page toggle is on the light surface. This
      // section's type sits on a dark-scrimmed photograph, so its text must stay
      // light in BOTH themes; letting the light surface flip `--foreground` to
      // near-black here would paint dark text onto a dark photo. Only the
      // reading sections below the fold follow the toggle.
      data-surface="night"
      className="azura-grain relative isolate overflow-hidden"
    >
      {/* ---------------------------------------------------------------
          The frame.
          --------------------------------------------------------------- */}
      <div aria-hidden="true" className="absolute inset-0 -z-10">
        <div
          data-cine-hero-media
          // `will-change` on the wrapper, not on the `img`: the Ken Burns
          // animation already promotes the image, and promoting both creates
          // two layers where one would do.
          className="absolute inset-[-8%] will-change-transform"
        >
          {heroImage !== null ? (
            <ActMedia
              image={heroImage}
              priority
              alt={t("hero.posterAlt")}
              // Grade: a touch of contrast and saturation, and the blue-hour
              // cast pulled a little colder so the frame and the surface it
              // sits on are lit by the same evening.
              className="azura-kenburns h-full [&_img]:h-full [&_img]:object-cover [&_img]:contrast-[1.08] [&_img]:saturate-[1.12] [&_img]:brightness-[0.92]"
            />
          ) : (
            // No published frame is a data state, not a crash. The gradient
            // ground is the poster, and every figure below still renders.
            <div className="h-full w-full bg-[linear-gradient(180deg,#0a2233,#050d13)]" />
          )}
        </div>

        {/* Vignette. Clear centre, dark edge, so type holds contrast wherever
            the photograph happens to be bright. */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(115%_80%_at_50%_22%,transparent_30%,rgba(5,13,19,0.42)_66%,rgba(5,13,19,0.86)_100%)]" />
        {/* Floor. The bottom two thirds resolve to the page ground, which is
            what makes the section end without a seam. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[72%] bg-[linear-gradient(to_top,#050d13_6%,rgba(5,13,19,0.86)_38%,rgba(5,13,19,0.32)_72%,transparent_100%)]" />
        {/* Copy ground. The floor gradient alone left the headline sitting on
            open sky at 1440px, where the frame is brightest and the type is
            largest — the eyebrow measured under 3:1 against it. This is a
            left-weighted wash under the copy column only, so the right two
            thirds of the photograph stay open. It is unconditional, not a
            scroll effect: a re-cast hero must not be able to break the
            headline's contrast. */}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(5,13,19,0.82)_0%,rgba(5,13,19,0.6)_34%,rgba(5,13,19,0.18)_62%,transparent_86%)]" />
        {/* Departure veil. Static at 0 without JS, driven to 1 on the way out. */}
        <div
          data-cine-hero-veil
          className="pointer-events-none absolute inset-0 bg-[#050d13] opacity-0"
        />
      </div>

      {/* ---------------------------------------------------------------
          The content.
          ---------------------------------------------------------------
          `100svh` rather than `100vh`: on iOS the URL bar collapsing changes
          `vh` mid-scroll and the hero grows under the reader. `min-h` rather
          than `h` so German at 320px, which is the longest of the four locales
          at the narrowest target, is allowed to push the section taller instead
          of overflowing it. */}
      <div className="relative flex min-h-[100svh] flex-col justify-end pt-28 pb-0 sm:pt-32">
        <Container>
          <div data-cine-hero-copy className="max-w-[52rem]">
            <div data-cine-intro className="flex flex-col gap-6 sm:gap-7">
              <span className="azura-mask">
                <span
                  data-intro-item
                  className="azura-label flex items-center gap-3 text-primary"
                >
                  {t("hero.eyebrow")}
                </span>
              </span>

              {/* `hyphens-none`: `globals.css` sets `hyphens: auto` on every
                  heading so a German compound can break rather than overflow a
                  narrow column, which is right at 320px and wrong at 5rem —
                  the first build hyphenated the headline as "Azura World
                  Resi-dence" across two lines at 1440px. The measure is widened
                  to 52rem for the same reason: at 46rem the line had nowhere to
                  break except mid-word. */}
              <h1 className="azura-mask font-display text-[clamp(2.2rem,6.4vw,4.5rem)] leading-[1.03] tracking-[-0.035em] text-balance hyphens-none">
                {/* The metallic treatment is on a span inside the heading, not
                    on the heading itself. `color: transparent` is invisible to
                    an automated contrast check and to `forced-colors`, so the
                    fallback below restores a real colour in both cases and the
                    accessible name is unaffected either way. */}
                <span
                  data-intro-item
                  className="azura-metal block [@media(forced-colors:active)]:!bg-none [@media(forced-colors:active)]:!text-[CanvasText]"
                >
                  <ScrambleText text={t("hero.title")} />
                </span>
              </h1>

              <span className="azura-mask">
                <span
                  data-intro-item
                  className="block max-w-[46ch] text-[1.0625rem] leading-[1.62] text-muted-foreground sm:text-[1.1875rem]"
                >
                  {t("hero.subtitle")}
                </span>
              </span>

              <span className="azura-mask">
                <span
                  data-intro-item
                  className="flex flex-wrap items-center gap-x-4 gap-y-3 pt-1"
                >
                  <Link
                    href="/#system"
                    className="azura-tap group inline-flex items-center gap-2 rounded-full bg-accent px-7 text-[0.9375rem] font-semibold text-accent-foreground transition-transform duration-[var(--duration-instant)] ease-[var(--ease-out)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] active:scale-[0.97]"
                  >
                    {t("hero.ctaPrimary")}
                  </Link>
                  <Link
                    href="/#site"
                    className="azura-tap inline-flex items-center rounded-full border border-[color-mix(in_srgb,var(--foreground)_22%,transparent)] px-7 text-[0.9375rem] font-medium text-foreground transition-colors duration-[var(--duration-fast)] hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                  >
                    {t("hero.ctaSecondary")}
                  </Link>
                </span>
              </span>
            </div>
          </div>
        </Container>

        {/* -------------------------------------------------------------
            The figures, on the photograph.
            -------------------------------------------------------------
            Four columns at `sm`, two at 320px. The row above the figures
            carries the credit and the scroll cue, so the bottom edge of the
            viewport is one composed strip rather than three things that
            happened to end up near each other. */}
        <div className="relative mt-14 border-t border-[color-mix(in_srgb,var(--foreground)_12%,transparent)] sm:mt-20">
          <Container className="flex flex-col gap-0">
            <div className="flex items-end justify-between gap-6 py-3">
              {heroImage !== null ? (
                <ActCredit
                  images={[heroImage]}
                  label={t("hero.creditLabel")}
                  staleLabel={t("hero.creditStale")}
                />
              ) : (
                <span />
              )}
              {/* Decorative: the accessible page already says what is below via
                  the nav and the skip link, so the cue carries an sr-only word
                  rather than being announced as an interactive control. */}
              <span className="hidden items-center gap-3 sm:flex">
                <span className="azura-label text-muted-foreground">
                  {t("hero.scrollHint")}
                </span>
                <span aria-hidden="true" className="azura-cue">
                  <span />
                </span>
              </span>
            </div>

            <dl className="grid grid-cols-2 gap-px border-t border-[color-mix(in_srgb,var(--foreground)_10%,transparent)] sm:grid-cols-4">
              {figures.map((figure) => (
                <div
                  key={figure.label}
                  className="flex flex-col gap-1.5 py-6 pr-4 sm:py-8"
                >
                  <dt className="azura-label text-muted-foreground">
                    {figure.label}
                  </dt>
                  <dd
                    data-numeric
                    className="font-display text-[clamp(1.75rem,4.2vw,2.75rem)] leading-none tracking-[-0.03em] text-foreground"
                  >
                    <InventoryValue
                      fact={figure.fact}
                      format={figure.format}
                      locale={locale}
                      gapLabel={gapLabel}
                    />
                  </dd>
                </div>
              ))}
            </dl>
          </Container>
        </div>
      </div>
    </section>
  )
}
