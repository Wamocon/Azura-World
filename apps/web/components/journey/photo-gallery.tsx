"use client"

import { ChevronLeft, ChevronRight, Maximize2, X } from "lucide-react"
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"

import { cn } from "@/lib/cn"
import {
  fallbackSrc,
  srcSet,
  type JourneyImage,
} from "@/lib/journey-media"

import { ActMedia } from "./act-media"

/**
 * PhotoGallery — a captioned, sourced lightbox.                Owner: W-NIGHT
 *
 * ## Why a lightbox is allowed here at all
 *
 * The photography is Cebeci Group's copyrighted marketing work, published as
 * `internal_only`, on a public repo (skill §7). The rule that governs it is not
 * "never large" but "captioned, sourced, as evidence — not full-bleed
 * decoration". So every frame in this gallery, thumbnail AND lightbox, carries
 * its publisher, and a render carries the "developer visualisation, not a
 * photograph" mark. The lightbox is the affordance to inspect the sourced
 * evidence closely, not a hero backdrop pretending the work is ours.
 *
 * ## The a11y contract this keeps
 *
 *  - Thumbnails are real buttons; each says which frame it opens.
 *  - Open moves focus into the dialog; Escape and the backdrop close it; focus
 *    returns to the thumbnail that opened it. Tab is trapped inside.
 *  - Arrow keys surf; the counter says where you are. `role="dialog"` +
 *    `aria-modal`, so a screen reader treats the rest of the page as inert.
 *  - Under reduced motion nothing animates — the dialog simply appears. The grid
 *    is a complete, static set of links to the same images with no JS, because
 *    the thumbnails render the real `<picture>` server-side; the lightbox is the
 *    only part that needs the client, and it is purely additive.
 */

export interface PhotoGalleryLabels {
  /** Chip on a developer render, e.g. "Visualisierung des Bauträgers". */
  render: string
  floorplan: string
  siteplan: string
  /** Credit prefix, e.g. "Aufnahme". */
  credit: string
  /** Stale-listing note, e.g. "aus einem veralteten Inserat". */
  stale: string
  close: string
  prev: string
  next: string
  /** "{index} von {total}" — replaced literally. */
  counter: string
  /** aria-label for a thumbnail button, "{index}" replaced. */
  open: string
  /** Generic alt when a frame has none of its own. */
  alt: string
}

function kindLabelFor(
  image: JourneyImage,
  labels: PhotoGalleryLabels
): string | null {
  switch (image.category) {
    case "render":
      return labels.render
    case "floorplan":
      return labels.floorplan
    case "siteplan":
      return labels.siteplan
    default:
      return null
  }
}

/** The provenance line under a frame: publisher, what it is, staleness. */
function Caption({
  image,
  labels,
  className,
}: {
  image: JourneyImage
  labels: PhotoGalleryLabels
  className?: string
}): ReactNode {
  const kind = kindLabelFor(image, labels)
  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] leading-relaxed tracking-[0.04em] uppercase",
        className
      )}
    >
      <span className="font-semibold">
        {labels.credit}: {image.publisher}
      </span>
      {kind !== null ? (
        <span className="text-current/70 normal-case">{kind}</span>
      ) : null}
      {image.fromStaleListing ? (
        <span className="text-quality-stale normal-case">{labels.stale}</span>
      ) : null}
    </p>
  )
}

export function PhotoGallery({
  images,
  labels,
  className,
}: {
  images: readonly JourneyImage[]
  labels: PhotoGalleryLabels
  className?: string
}): ReactNode {
  const [open, setOpen] = useState<number | null>(null)
  const triggerRefs = useRef<Array<HTMLButtonElement | null>>([])
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const total = images.length

  const close = useCallback(() => {
    const returnTo = open
    setOpen(null)
    // Restore focus to the thumbnail that opened the lightbox.
    if (returnTo !== null) triggerRefs.current[returnTo]?.focus()
  }, [open])

  const step = useCallback(
    (delta: number) => {
      setOpen((current) =>
        current === null ? null : (current + delta + total) % total
      )
    },
    [total]
  )

  // Keyboard: Escape closes, arrows surf, Tab is trapped in the dialog.
  useEffect(() => {
    if (open === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        close()
      } else if (event.key === "ArrowRight") {
        event.preventDefault()
        step(1)
      } else if (event.key === "ArrowLeft") {
        event.preventDefault()
        step(-1)
      } else if (event.key === "Tab") {
        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled])"
        )
        if (focusables === undefined || focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (first === undefined || last === undefined) return
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, close, step])

  // Lock the page behind the dialog and move focus into it on open.
  useEffect(() => {
    if (open === null) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    dialogRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  if (total === 0) return null

  const current = open === null ? null : images[open]

  // When every frame is the same non-photo kind (e.g. all developer renders),
  // a chip on each thumbnail is furniture the reader stops seeing — the section
  // states it once instead. The lightbox caption still names it per frame.
  const first = images[0]
  const uniformKind =
    total > 1 &&
    first !== undefined &&
    first.category !== "photo" &&
    images.every((image) => image.category === first.category)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* A uniform gallery grid: every frame the same size, so a partial last
          row simply left-aligns instead of leaving an interior hole. Each tile
          is a button into the lightbox at its own index. */}
      <ul className="grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-4">
        {images.map((image, index) => {
          const kind = kindLabelFor(image, labels)
          return (
            <li key={image.id} className="min-w-0">
              <button
                type="button"
                ref={(node) => {
                  triggerRefs.current[index] = node
                }}
                onClick={() => setOpen(index)}
                aria-label={labels.open.replace("{index}", String(index + 1))}
                className={cn(
                  "group relative block aspect-[4/3] w-full overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--foreground)_12%,transparent)] bg-[#02090e]",
                  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                )}
              >
                <ActMedia
                  image={image}
                  alt={labels.alt}
                  layout="tile"
                  className="h-full [&_img]:h-full [&_img]:object-cover [&_img]:brightness-[0.92] [&_img]:contrast-[1.06] [&_img]:saturate-[1.08] motion-safe:[&_img]:transition-transform motion-safe:[&_img]:duration-500 motion-safe:group-hover:[&_img]:scale-[1.04]"
                />
                {/* A quiet scrim so the chip and hover cue stay legible. */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(2,9,14,0.55)_0%,transparent_45%)] opacity-70"
                />
                {kind !== null && !uniformKind ? (
                  <span className="azura-label pointer-events-none absolute top-3 left-3 inline-flex max-w-[calc(100%-1.5rem)] items-center rounded-full border border-white/25 bg-black/55 px-2.5 py-1 text-white/90 backdrop-blur-sm">
                    {kind}
                  </span>
                ) : null}
                {/* Hover/focus zoom cue, bottom-right. */}
                <span className="pointer-events-none absolute right-3 bottom-3 inline-flex size-8 items-center justify-center rounded-full bg-black/55 text-white/90 opacity-0 backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
                  <Maximize2 className="size-4" aria-hidden="true" />
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {/* The lightbox. Rendered only when open, so the closed state ships no
          overlay and the page behind it is untouched. */}
      {current !== undefined && current !== null && open !== null ? (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={labels.counter
            .replace("{index}", String(open + 1))
            .replace("{total}", String(total))}
          tabIndex={-1}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/92 p-4 outline-none backdrop-blur-sm sm:p-8 motion-safe:animate-[azura-fade-in_180ms_ease-out]"
          onClick={(event) => {
            // Backdrop click closes; clicks on the figure do not bubble here.
            if (event.target === event.currentTarget) close()
          }}
        >
          {/* Close, top-right. */}
          <button
            type="button"
            onClick={close}
            aria-label={labels.close}
            className="absolute top-4 right-4 z-[2] inline-flex size-11 items-center justify-center rounded-full bg-white/10 text-white outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <X className="size-5" aria-hidden="true" />
          </button>

          {/* Prev / next, vertically centred on the sides. */}
          {total > 1 ? (
            <>
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label={labels.prev}
                className="absolute top-1/2 left-3 z-[2] inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/70 sm:left-6"
              >
                <ChevronLeft className="size-6" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label={labels.next}
                className="absolute top-1/2 right-3 z-[2] inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/70 sm:right-6"
              >
                <ChevronRight className="size-6" aria-hidden="true" />
              </button>
            </>
          ) : null}

          <figure className="m-0 flex max-h-full max-w-5xl flex-col items-center gap-4">
            <picture className="flex min-h-0 flex-1 items-center justify-center">
              <source
                type="image/avif"
                srcSet={srcSet(current.id, "avif")}
                sizes="92vw"
              />
              <source
                type="image/webp"
                srcSet={srcSet(current.id, "webp")}
                sizes="92vw"
              />
              <img
                src={fallbackSrc(current.id)}
                alt={labels.alt}
                width={current.width}
                height={current.height}
                className="max-h-[78vh] w-auto rounded-lg object-contain"
                style={{ aspectRatio: `${current.width} / ${current.height}` }}
              />
            </picture>
            <figcaption className="flex w-full flex-wrap items-center justify-between gap-3 text-white/85">
              <Caption image={current} labels={labels} />
              <span
                data-numeric
                className="text-[0.6875rem] tracking-[0.08em] text-white/55 tabular-nums"
              >
                {labels.counter
                  .replace("{index}", String(open + 1))
                  .replace("{total}", String(total))}
              </span>
            </figcaption>
          </figure>
        </div>
      ) : null}
    </div>
  )
}
