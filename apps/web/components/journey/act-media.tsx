import type { ReactNode } from "react"

import { cn } from "@/lib/cn"
import {
  fallbackSrc,
  srcSet,
  type JourneyImage,
} from "@/lib/journey-media"

/**
 * One frame of the journey.                                   Owner: W-CINEMA
 *
 * ## Why this is a Server Component with a plain `<picture>`
 *
 * The landing route's budget is JavaScript, and this ships none. Every image is
 * in the server-rendered HTML, so it is crawlable, it survives a blocked
 * script, and it costs the bundle nothing. The scroll choreography is a
 * separate client island that only adds parallax on top of markup that is
 * already correct without it — which is also the reduced-motion contract and
 * the no-JS contract, satisfied by construction rather than by a fallback path.
 *
 * `next/image` is deliberately not used. It would work, but it pulls a client
 * runtime for behaviour we already have: the derivatives are pre-encoded at
 * fixed rungs by W0-D, so there is nothing to optimise at request time, and
 * `<picture>` with an explicit `srcset` is both smaller and more honest about
 * what is being served.
 *
 * ## The LQIP is a background, not a second `<img>`
 *
 * The base64 WebP from the manifest paints as the element's own background.
 * A second image element would double the request count and the layout work for
 * a 200-byte placeholder. `aspect-ratio` from the real dimensions holds the box
 * before anything loads, which is the CLS contract.
 *
 * ## Grade
 *
 * Harvested photography comes from a dozen hosts at a dozen white balances.
 * `saturate(1.06) contrast(1.04)` plus a vignette is what makes twenty-two
 * frames read as one property rather than a scrapbook. It is deliberately
 * lighter than the brief's suggested `sepia(0.15)`: this identity is cool
 * Mediterranean water, not warm sand, and sepia fights it.
 */

export interface ActMediaProps {
  image: JourneyImage
  /** The one frame per act that may load eagerly. Everything else is lazy. */
  priority?: boolean
  /** Layout hint for `sizes`. Full-bleed acts differ from grid tiles. */
  layout?: "bleed" | "tile"
  className?: string
  /** Alt text. Never empty for a meaningful image, never "image". */
  alt: string
}

export function ActMedia({
  image,
  priority = false,
  layout = "bleed",
  className,
  alt,
}: ActMediaProps): ReactNode {
  const sizes =
    layout === "bleed"
      ? "100vw"
      : "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"

  return (
    <picture
      data-slot="act-media"
      data-act={image.act}
      className={cn("block h-full w-full", className)}
    >
      <source type="image/avif" srcSet={srcSet(image.id, "avif")} sizes={sizes} />
      <source type="image/webp" srcSet={srcSet(image.id, "webp")} sizes={sizes} />
      <img
        src={fallbackSrc(image.id)}
        alt={alt}
        width={image.width}
        height={image.height}
        // `eager` + `high` only for the one frame above the fold. Everything
        // else waits for the viewport, which is what keeps LCP off the journey.
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
        className="h-full w-full object-cover"
        style={{
          // The placeholder paints instantly and is replaced in place.
          backgroundImage: `url(${image.lqip})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          aspectRatio: `${image.width} / ${image.height}`,
        }}
      />
    </picture>
  )
}

/**
 * The credit line. One per act, not one per frame.
 *
 * MEDIA-LICENSE.md: every displayed asset carries a visible source. Visible,
 * not hover-only — the same rule the conflict badge lives by. A stale-listing
 * asset says so here rather than in a footnote, because a photograph from a
 * listing that still calls the project unfinished is exactly the kind of thing
 * this product exists to label.
 */
export function ActCredit({
  images,
  label,
  staleLabel,
  className,
}: {
  images: readonly JourneyImage[]
  /** e.g. "Aufnahmen" */
  label: string
  /** e.g. "aus einem veralteten Inserat" */
  staleLabel: string
  className?: string
}): ReactNode {
  const publishers = [...new Set(images.map((i) => i.publisher))]
  const anyStale = images.some((i) => i.fromStaleListing)
  if (publishers.length === 0) return null

  return (
    <p
      data-slot="act-credit"
      className={cn(
        "text-[0.6875rem] leading-relaxed tracking-[0.06em] text-white/45 uppercase",
        className
      )}
    >
      {label}: {publishers.join(" · ")}
      {anyStale ? (
        <span className="ml-2 text-quality-stale/80 normal-case">
          {staleLabel}
        </span>
      ) : null}
    </p>
  )
}
