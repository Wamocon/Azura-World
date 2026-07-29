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

import type { ReactNode } from "react"

import { Link } from "@/app/navigation"
import { ActMedia } from "@/components/journey/act-media"
import { imagesForAct } from "@/lib/journey-media"
import type { JourneyAct } from "@/lib/journey-media"

export function AuthSplit({
  act,
  plateTitle,
  plateLead,
  children,
}: {
  /** Which act supplies the plate. `room` reads as "you are inside", `complex`
   *  as "you are arriving" — match it to what the page is actually asking. */
  act: JourneyAct
  plateTitle: string
  plateLead: string
  children: ReactNode
}): ReactNode {
  const [plate] = imagesForAct(act)

  return (
    <main className="grid min-h-[100svh] lg:grid-cols-[1.05fr_minmax(0,1fr)]">
      <div
        aria-hidden
        className="relative isolate hidden overflow-hidden bg-[#0a1216] lg:block"
      >
        {plate !== undefined ? (
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
          <Link
            href="/"
            className="inline-flex items-center gap-3 self-start focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ring)]"
          >
            {/* One asset, not a dark/light pair: the theme is light-only, so a
                second <img> would be a request for a file that never renders. */}
            <img
              src="/brand/azura-world-wordmark-dark.svg"
              alt="Azura World"
              width={875}
              height={263}
              className="h-7 w-auto"
            />
            <span aria-hidden className="h-5 w-px bg-border" />
            <span className="font-display text-[0.9375rem] leading-none tracking-[0.06em] text-muted-foreground">
              CATI
            </span>
          </Link>

          {children}
        </div>
      </div>
    </main>
  )
}
