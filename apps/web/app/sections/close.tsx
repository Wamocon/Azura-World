/**
 * The close: Action.                                                 Owner: W3-A
 *
 * ## Why this file lost three of its four sections
 *
 * It exported `ActionSection`, `AfterSection`, `ShareSection` and
 * `LoveSection`. Only the first has been imported since PIVOT.md reframed the
 * page, and the other three read `after.*`, `share.*`, `love.*` and
 * `designation.loyalty|share|love` out of `messages/*` — namespaces that the
 * same pivot deleted. They did not merely go unused: rendering any one of them
 * would have thrown `MISSING_MESSAGE` at request time. Dead code that cannot
 * run is a trap for whoever imports it next expecting it to work, so it is
 * gone rather than left compiling.
 *
 * ## The close is a viewport, not a paragraph
 *
 * What stood here was a heading, a lead, and two links on the page ground —
 * the same shape as the six sections above it, so the page simply stopped
 * rather than arriving anywhere. The ask on this page is a request for access,
 * which is the single thing it exists to collect, and it was rendering as the
 * least emphatic block on the route.
 *
 * It is now a full-bleed frame with the type over it: the same photographic
 * register the hero opens on, so the page closes where it started. The
 * secondary link stays a link. Two buttons of equal weight is two decisions,
 * and the reader has already been asked to make one.
 */

import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"

import { Link } from "@/app/navigation"
import { Container } from "@/components/azura/section"
import { ActCredit, ActMedia, MediaKind, mediaKindKey } from "@/components/journey/act-media"
import { cast } from "@/components/journey/cast"

export async function ActionSection({
  locale,
}: {
  locale: string
}): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing" })

  // A balcony over the sea. The page opens on water and closes on it, without
  // repeating a single frame.
  const closing = cast.close
  const closingKind = closing === null ? null : mediaKindKey(closing)

  return (
    <section
      id="access"
      // Always night: the closing frame is a dark-scrimmed photograph with the
      // access CTA over it, light text in both themes.
      data-surface="night"
      className="azura-grain relative isolate scroll-mt-28 overflow-hidden"
    >
      <div aria-hidden="true" className="absolute inset-0 -z-10">
        {closing !== null ? (
          <div
            data-parallax
            data-parallax-strength="6"
            className="absolute inset-[-14%] will-change-transform"
          >
            <ActMedia
              image={closing}
              alt=""
              layout="bleed"
              className="h-full [&_img]:h-full [&_img]:object-cover [&_img]:contrast-[1.06] [&_img]:saturate-[1.08] [&_img]:brightness-[0.72]"
            />
          </div>
        ) : (
          <div className="h-full w-full bg-[linear-gradient(180deg,#02121c,#050d13)]" />
        )}
        {/* Heavier than the hero's scrim on purpose. The hero carries four
            short figures over its frame; this carries a paragraph and a
            button, and a button that is hard to find is a button that is not
            pressed. */}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(5,13,19,0.94)_0%,rgba(5,13,19,0.82)_45%,rgba(5,13,19,0.5)_100%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[linear-gradient(to_bottom,#050d13,transparent)]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-[linear-gradient(to_top,#050d13,transparent)]" />
      </div>

      <Container className="flex flex-col gap-8 py-24 sm:py-36">
        <div className="flex max-w-[34rem] flex-col gap-6">
          <span className="azura-label text-primary">
            {t("designation.action")}
          </span>
          <h2 className="azura-mask font-display text-[clamp(2rem,5.4vw,3.75rem)] leading-[1.04] tracking-[-0.035em] text-balance">
            <span data-rise className="block">
              {t("action.title")}
            </span>
          </h2>
          <p className="max-w-[46ch] text-[1.0625rem] leading-[1.65] text-muted-foreground">
            {t("action.lead")}
          </p>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-2">
            <Link
              href="/login"
              className="azura-tap inline-flex items-center rounded-full bg-accent px-7 text-[0.9375rem] font-semibold text-accent-foreground transition-transform duration-[var(--duration-instant)] ease-[var(--ease-out)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] active:scale-[0.97]"
            >
              {t("action.cta")}
            </Link>
            <Link
              href="/#system"
              className="azura-tap inline-flex items-center text-[0.9375rem] font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              {t("action.secondary")}
            </Link>
          </div>
        </div>

        {closing !== null ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <ActCredit
              images={[closing]}
              label={t("hero.creditLabel")}
              staleLabel={t("hero.creditStale")}
            />
            <MediaKind
              image={closing}
              label={closingKind === null ? null : t(`mediaKind.${closingKind}`)}
            />
          </div>
        ) : null}
      </Container>
    </section>
  )
}
