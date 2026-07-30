import type { ReactNode } from "react"

import { cn } from "@/lib/cn"
import type { JourneyImage } from "@/lib/journey-media"

import { ActMedia, MediaKind } from "./act-media"

/**
 * A framed photograph with depth.                              Owner: W-NIGHT
 *
 * The page had twenty-two photographs and one way of showing them: an `<img>`
 * in a bordered box. This is the other way — a clipped frame with the image
 * oversized inside it, so the choreography can slide it against the scroll and
 * the frame stays exactly where the grid put it.
 *
 * ## The overscan is the whole mechanism
 *
 * `inset-[-14%]` on the moving layer. Parallax translates the image, and an
 * image translated inside a frame it exactly fills shows the frame's own
 * background at the trailing edge — a dark band that grows as you scroll,
 * which is the single most common way this effect is shipped broken. The
 * overscan is sized to the travel: `data-parallax-strength` is a percentage of
 * the element's height, so 14% of overscan covers a strength of up to 7 in
 * either direction. Raising one without the other reintroduces the band.
 *
 * ## Everything is a Server Component and ships no JavaScript
 *
 * `data-parallax` is read by `components/anim/landing-choreography.tsx`. With
 * no JavaScript, with reduced motion, or before hydration, the markup is a
 * correctly-sized `<picture>` in a frame — the image is simply still. That is
 * the reduced-motion contract satisfied by construction: nothing here is hidden
 * and nothing waits for a scroll event.
 */
export function Plate({
  image,
  alt,
  className,
  /** Percent of the frame height the image travels, each way. Keep ≤ 7. */
  strength = 6,
  /** Layout hint passed through to `sizes`. */
  layout = "tile",
  priority = false,
  overlay,
  kindLabel = null,
}: {
  image: JourneyImage
  alt: string
  className?: string
  strength?: number
  layout?: "bleed" | "tile"
  priority?: boolean
  /** Rendered above the image and its scrim: a caption, a label, a figure. */
  overlay?: ReactNode
  /**
   * Resolved by the caller from `mediaKindKey(image)` and
   * `landing.mediaKind.*`. Passing the string rather than calling
   * `getTranslations` here keeps this a plain synchronous component that both a
   * page and a client island can render.
   *
   * A `render` or a `floorplan` with this left at `null` renders unlabelled,
   * which is the exact failure the chip exists to prevent — so treat a missing
   * label on a non-photo as a bug, not a style choice.
   */
  kindLabel?: string | null
}): ReactNode {
  return (
    <div
      className={cn(
        "relative isolate overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--foreground)_10%,transparent)] bg-[#02090e]",
        className
      )}
    >
      <div
        data-parallax
        data-parallax-strength={strength}
        className="absolute inset-[-14%] will-change-transform"
      >
        <ActMedia
          image={image}
          alt={alt}
          layout={layout}
          priority={priority}
          // The house grade. Twenty-two frames from a dozen hosts at a dozen
          // white balances read as one property only if they are corrected to
          // one, and the correction has to match the ground they sit on.
          className="h-full [&_img]:h-full [&_img]:object-cover [&_img]:contrast-[1.08] [&_img]:saturate-[1.1] [&_img]:brightness-[0.9]"
        />
      </div>

      {overlay !== undefined ? (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(2,9,14,0.9)_0%,rgba(2,9,14,0.35)_45%,transparent_78%)]"
          />
          <div className="relative flex h-full flex-col justify-end p-5 sm:p-6">
            {overlay}
          </div>
        </>
      ) : null}

      {/* Top-left, above everything, and outside the `overlay` branch: a render
          is labelled whether or not the caller asked for a caption. */}
      <MediaKind
        image={image}
        label={kindLabel}
        className="absolute top-3 left-3 z-[2]"
      />
    </div>
  )
}
