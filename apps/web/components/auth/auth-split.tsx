/**
 * The frame every signed-out page shares: photograph on the left, the thing you
 * came to do on the right.                                        Owner: W3-H
 *
 * ## Why the photograph is not decoration
 *
 * These pages are the only part of the product a prospective client sees before
 * they have any data in it. An empty centred form says "internal tool"; the
 * building says "this is yours". So the plate carries a real interior or facade
 * from the harvest, never a stock gradient.
 *
 * ## Why it disappears below `lg` rather than stacking
 *
 * The obvious mobile treatment is to stack the photograph above the form. That
 * puts a full-height hero between a user and the password field they opened the
 * page to type into, on the device where scrolling costs the most. A login
 * screen is a door, and you do not put a mural in the doorway. Below `lg` the
 * plate is dropped entirely and the form gets the whole viewport.
 *
 * It is `aria-hidden` with an empty `alt` for the same reason: it is atmosphere,
 * and a screen reader announcing a bedroom before the email field is noise.
 */

import { ChevronLeft } from "lucide-react"
import type { ReactNode } from "react"

import { Link } from "@/app/navigation"
import { LocaleSwitcher } from "@/components/locale-switcher"
import { ActMedia } from "@/components/journey/act-media"
import type { JourneyImage } from "@/lib/journey-media"

export function AuthSplit({
  plate,
  plateTitle,
  plateLead,
  backToHome,
  children,
}: {
  /**
   * The frame, passed in rather than looked up.
   *
   * This took an `act` and rendered `imagesForAct(act)[0]`. The acts are
   * harvest buckets, not an edit: `room` is six apartment interiors, so
   * `/login` opened on a tight shot of one bed and a reader could not tell what
   * building they were signing in to. Callers now name the frame through
   * `components/journey/cast.ts`, where the whole page's photography is
   * decided in one place and each slot says what it depicts.
   */
  plate: JourneyImage | null
  plateTitle: string
  plateLead: string
  /** Accessible name for the logo link back to the landing page. */
  backToHome: string
  children: ReactNode
}): ReactNode {

  return (
    // `data-surface="day"` gives the signed-out pages the SAME premium light
    // tokens and tinted wash the landing's light theme uses, so moving from the
    // landing to the login no longer lands on flat office cream. The two pages
    // now read as one product.
    <main
      data-surface="day"
      className="grid min-h-[100svh] lg:grid-cols-[1.05fr_minmax(0,1fr)]"
    >
      <div
        aria-hidden
        className="relative isolate hidden overflow-hidden bg-[#0a1216] lg:block"
      >
        {plate !== null ? (
          <ActMedia
            image={plate}
            priority
            alt=""
            className="azura-kenburns h-full [&_img]:h-full [&_img]:object-cover [&_img]:contrast-[1.04] [&_img]:saturate-[1.06]"
          />
        ) : null}

        {/* Two scrims, not one. The radial darkens the corners so the frame does
            not fight the form beside it; the linear guarantees the ground under
            the caption regardless of what the photograph does down there. */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_30%_20%,transparent_30%,rgba(6,14,18,0.5)_75%,rgba(6,14,18,0.9)_100%)]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-[linear-gradient(to_top,rgba(6,14,18,0.85)_0%,transparent_100%)]" />

        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-10">
          <p className="font-display text-[1.75rem] leading-[1.15] tracking-[-0.02em] text-white">
            {plateTitle}
          </p>
          <p className="max-w-[38ch] text-[0.9375rem] leading-[1.6] text-white/70">
            {plateLead}
          </p>
        </div>
      </div>

      <div className="flex flex-col justify-center px-6 py-14 sm:px-12 lg:px-16">
        <div className="mx-auto flex w-full max-w-[26rem] flex-col gap-8">
          {/* The logo IS the way back to the landing: the lockup lifts, the
              wordmark brightens, and a back-chevron slides in on hover, so the
              intent is unmistakable rather than relying on the user guessing the
              logo is a link. `group` drives all three from the one anchor.

              It shares this row with the language control, which was missing
              here entirely: a Turkish or Russian visitor who landed on
              `/de/login` had no way out of German short of editing the URL, on
              the one screen where a person is least willing to guess. */}
          <div className="flex items-center justify-between gap-4">
            <Link
              href="/"
              aria-label={backToHome}
              title={backToHome}
              className="group inline-flex items-center gap-3 self-start rounded-md transition-transform duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ring)]"
            >
            <ChevronLeft
              aria-hidden="true"
              className="size-4 -mr-1 text-muted-foreground opacity-0 -translate-x-1 transition-all duration-[var(--duration-fast)] group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:translate-x-0"
            />
            <img
              src="/brand/azura-world-wordmark-dark.svg"
              alt="Azura World"
              width={875}
              height={263}
              className="h-7 w-auto opacity-90 transition-opacity duration-[var(--duration-fast)] group-hover:opacity-100"
            />
            <span aria-hidden className="h-5 w-px bg-border" />
              <span className="font-display text-[0.9375rem] leading-none tracking-[0.06em] text-muted-foreground transition-colors duration-[var(--duration-fast)] group-hover:text-foreground">
                CATI
              </span>
            </Link>

            <LocaleSwitcher compact />
          </div>

          {children}
        </div>
      </div>
    </main>
  )
}
