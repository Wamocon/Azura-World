/**
 * Chart primitives — the visual world of the landing surface.       Owner: W3-A
 *
 * The page is built as a **working chart**, not a brochure. The reference is an
 * Admiralty-style hydrographic chart fused with audit working-paper notation:
 * a bounded plate with a title block, depth tints, contour lines, and figures
 * printed *on* the field as soundings. That grammar is native to the subject
 * (a coastal parcel 300 m from the Mediterranean whose distances-to-water are
 * themselves disputed facts) and, more usefully, it is a 200-year-old visual
 * language for exactly our problem: **a page covered in numbers, each of which
 * is a measurement with a survey date and a reliability.**
 *
 * Nothing here paints a value into a canvas. Every figure is real DOM inside a
 * provenance component (azura-ui-ux §3, §6).
 *
 * No colour is hardcoded. `globals.css` is W1-D's file and is not edited from
 * here, so the chart-specific paint is inline `style` over the existing
 * `--sea-*` / `--sand` tokens rather than new utility classes.
 */

import type { CSSProperties, ReactNode } from "react"

import { cn } from "@/lib/cn"

// ---------------------------------------------------------------------------
// Contour field
// ---------------------------------------------------------------------------

/**
 * Depth contours, drawn with two `repeating-linear-gradient`s rather than an
 * image or an SVG: it costs no request, scales to any box, and re-tints itself
 * in dark mode because it is built from tokens.
 *
 * Deliberately NOT animated. The one authored motion moment on this page is the
 * plate's survey-in (see `Plate`), and a second ambient loop underneath it would
 * be the "scattered effects" failure. It is also `aria-hidden` — a contour is
 * texture, and a screen reader announcing it would be noise.
 */
export function ContourField({
  className,
  /** Distance between contours. Wider reads as deeper water. */
  spacing = 22,
  opacity = 0.5,
}: {
  className?: string
  spacing?: number
  opacity?: number
}): ReactNode {
  const style: CSSProperties = {
    opacity,
    backgroundImage: [
      `repeating-linear-gradient(
         100deg,
         color-mix(in srgb, var(--sea-foam) 34%, transparent) 0px,
         color-mix(in srgb, var(--sea-foam) 34%, transparent) 1px,
         transparent 1px,
         transparent ${spacing}px
       )`,
      `repeating-linear-gradient(
         168deg,
         color-mix(in srgb, var(--sea-shallow) 22%, transparent) 0px,
         color-mix(in srgb, var(--sea-shallow) 22%, transparent) 1px,
         transparent 1px,
         transparent ${spacing * 3}px
       )`,
    ].join(","),
  }

  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0", className)}
      style={style}
    />
  )
}

// ---------------------------------------------------------------------------
// Plate
// ---------------------------------------------------------------------------

/**
 * The bounded chart plate: hairline double rule, a title block in the corner,
 * a depth-tinted field.
 *
 * The double rule is a real chart convention (neat line + border) and it is
 * what makes the surface read as a *plate* rather than as a card — which
 * matters, because a same-size card carrying an icon and a heading is the
 * scaffold this page is refusing.
 */
export function Plate({
  children,
  className,
  fieldClassName,
  /** Rendered in the plate's title block, upper-left. Real content only. */
  title,
  /** Right-hand side of the title block — scale, sheet number, data date. */
  meta,
  contours = true,
}: {
  children: ReactNode
  className?: string
  fieldClassName?: string
  title?: ReactNode
  meta?: ReactNode
  contours?: boolean
}): ReactNode {
  return (
    <div
      className={cn(
        // Outer neat line, then a 3px gutter, then the border proper.
        "relative rounded-[var(--radius-sm)] p-[3px]",
        "ring-1 ring-[color-mix(in_srgb,var(--sea-mid)_28%,transparent)]",
        className
      )}
    >
      <div
        className={cn(
          "relative overflow-hidden rounded-[calc(var(--radius-sm)-2px)]",
          "border border-[color-mix(in_srgb,var(--sea-mid)_38%,transparent)]",
          fieldClassName
        )}
        style={{
          // Chart depth tints: shoal at the top edge, deep water below. A
          // gradient here is a bathymetric convention, not decoration.
          backgroundImage: `linear-gradient(
            176deg,
            color-mix(in srgb, var(--sea-foam) 16%, var(--card)) 0%,
            color-mix(in srgb, var(--sea-shallow) 10%, var(--card)) 38%,
            color-mix(in srgb, var(--sea-deep) 9%, var(--card)) 100%
          )`,
        }}
      >
        {contours ? <ContourField /> : null}

        {title !== undefined || meta !== undefined ? (
          <div
            className={cn(
              "relative flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1",
              "border-b border-[color-mix(in_srgb,var(--sea-mid)_24%,transparent)]",
              "px-4 py-2.5 sm:px-6"
            )}
          >
            {title !== undefined ? (
              <span className="text-[0.6875rem] font-semibold tracking-[0.06em] text-foreground/80 uppercase">
                {title}
              </span>
            ) : null}
            {meta !== undefined ? (
              <span
                data-numeric
                className="text-[0.6875rem] tracking-[0.06em] text-muted-foreground uppercase"
              >
                {meta}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="relative">{children}</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Leader
// ---------------------------------------------------------------------------

/**
 * The dot leader between a label and its value — the device a chart legend and
 * an audit schedule both use to bind two ends of a line across a gap. It is
 * `aria-hidden`: it carries no information a screen reader needs, and the
 * label/value relationship is already expressed by the markup.
 *
 * Rendered as a bottom border on a flexible spacer rather than a run of `.`
 * characters, so it never wraps, never gets selected, and never gets read out.
 */
export function Leader({ className }: { className?: string }): ReactNode {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mx-2 hidden min-w-4 flex-1 translate-y-[-0.28em] self-center sm:block",
        "border-b border-dotted border-[color-mix(in_srgb,var(--foreground)_26%,transparent)]",
        className
      )}
    />
  )
}

// ---------------------------------------------------------------------------
// Sounding
// ---------------------------------------------------------------------------

/**
 * One measurement, printed the way a chart prints a sounding: the figure large
 * and plain, its label small and tracked above it, its reliability stated
 * beneath it rather than implied.
 *
 * `children` is always a `ProvenanceValue`. This component never formats a
 * number itself — that is the whole point of the provenance layer, and a figure
 * formatted here would be a figure without a source.
 *
 * `emphasis="conflict"` is the page's signature state: a dashed enclosure over
 * the conflict surface, which is the chart's own convention for an area whose
 * survey is not to be relied upon. It is never the only signal — the badge
 * inside `ProvenanceValue` carries shape and colour too (DESIGN.md §6).
 */
export function Sounding({
  label,
  children,
  note,
  emphasis = "plain",
  className,
}: {
  label: string
  children: ReactNode
  /** Source count or a short qualifier. Optional, small, muted. */
  note?: ReactNode
  emphasis?: "plain" | "conflict"
  className?: string
}): ReactNode {
  const conflict = emphasis === "conflict"

  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-col gap-1.5 px-4 py-4 sm:px-5 sm:py-5",
        conflict && "rounded-[var(--radius-sm)]",
        className
      )}
      style={
        conflict
          ? {
              backgroundColor: "var(--surface-conflict)",
              outline:
                "1px dashed color-mix(in srgb, var(--confidence-conflicted) 62%, transparent)",
              outlineOffset: "-4px",
            }
          : undefined
      }
    >
      <span className="text-[0.6875rem] font-medium tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </span>
      <span
        data-numeric
        className="font-display text-[clamp(1.5rem,4.2vw,2.25rem)] leading-[1.1] tracking-[-0.02em] text-foreground"
      >
        {children}
      </span>
      {note !== undefined ? (
        <span className="text-[0.75rem] leading-[1.4] tracking-[0.01em] text-muted-foreground">
          {note}
        </span>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Record line
// ---------------------------------------------------------------------------

/**
 * The dateline. **Not an eyebrow** — the distinction is real and it is why this
 * component exists rather than a styled `<p>` above the `<h1>`.
 *
 * An eyebrow is a decorative label that restates the heading. This is a record
 * header: identifier, place, and the date the data was gathered, in the order a
 * filed document carries them. It answers "which record am I reading, and how
 * old is it" — a question this audience asks first and the heading cannot
 * answer. It is placed as a strip above the plate, not as a caption on the
 * title.
 */
export function RecordLine({
  items,
  className,
}: {
  items: ReadonlyArray<{ label: string; value: ReactNode }>
  className?: string
}): ReactNode {
  return (
    <dl
      className={cn(
        "flex flex-wrap items-baseline gap-x-5 gap-y-1.5",
        "text-[0.6875rem] tracking-[0.06em] uppercase",
        className
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 items-baseline gap-1.5">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd data-numeric className="min-w-0 font-medium text-foreground/85">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
