import type { ReactNode } from "react"

import { cn } from "@/lib/cn"

/**
 * CoastPoster — the fallback that is never a blank box.    Owner: W1-D
 *
 * Rendered whenever the maquette cannot or should not run: no WebGL, reduced
 * motion, a low motion tier, or before the lazy chunk arrives. CONVENTIONS §5
 * requires a poster, not a spinner and not an empty frame.
 *
 * IT IS INLINE SVG, NOT A PHOTOGRAPH, AND THAT IS A RIGHTS DECISION AS MUCH AS
 * A PERFORMANCE ONE. Every one of the 31 harvested media assets is
 * `usage: "internal_only"` (MEDIA-LICENSE.md) — they are a competitor's
 * marketing renders, collected for internal analysis. Putting one on a public
 * landing page would be a rights breach. `apps/web/public/media` is empty for
 * exactly this reason. A drawn abstraction owes nobody anything, costs about
 * 2KB gzipped, needs no decode, and cannot 404.
 *
 * Themed entirely through CSS custom properties — no hex anywhere — so it
 * follows light/dark with one set of markup. Depth comes from opacity steps
 * rather than distinct colours, which is what makes that possible.
 *
 * The geometry is the same massing the WebGL scene renders: seven residence
 * blocks plus the taller hotel, a sea plane, a sun. So the fallback is not a
 * different picture — it is the same picture, drawn flat.
 */

/** Seven residence blocks + the hotel. x, width and height in viewBox units. */
const BLOCKS: ReadonlyArray<{
  x: number
  w: number
  h: number
  hotel?: boolean
}> = [
  { x: 46, w: 30, h: 54 },
  { x: 84, w: 30, h: 68 },
  { x: 122, w: 30, h: 46 },
  { x: 160, w: 34, h: 92, hotel: true },
  { x: 202, w: 30, h: 58 },
  { x: 240, w: 30, h: 72 },
  { x: 278, w: 30, h: 50 },
  { x: 316, w: 30, h: 62 },
]

export function CoastPoster({
  className,
  /** Accessible description. Localised by the caller. */
  label,
}: {
  className?: string
  label: string
}): ReactNode {
  return (
    <svg
      viewBox="0 0 400 260"
      role="img"
      aria-label={label}
      preserveAspectRatio="xMidYMid meet"
      className={cn("h-full w-full", className)}
      data-slot="coast-poster"
    >
      <defs>
        <linearGradient id="azura-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--sea-shallow)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--background)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="azura-sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--sea-shallow)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--sea-deep)" stopOpacity="0.75" />
        </linearGradient>
      </defs>

      <rect x="0" y="0" width="400" height="260" fill="url(#azura-sky)" />

      {/* Sun, low and to the west. */}
      <circle cx="330" cy="52" r="18" fill="var(--accent)" opacity="0.32" />
      <circle cx="330" cy="52" r="9" fill="var(--accent)" opacity="0.55" />

      {/* Sea plane. The project is 300 m from it — the one distance every
          source agrees on closely enough to display (F-003). */}
      <rect x="0" y="186" width="400" height="74" fill="url(#azura-sea)" />
      {[196, 208, 220, 232, 244].map((y, index) => (
        <rect
          key={y}
          x={12 + index * 9}
          y={y}
          width={376 - index * 18}
          height="1.5"
          rx="0.75"
          fill="var(--sea-foam)"
          opacity={0.34 - index * 0.05}
        />
      ))}

      {/* Beach. */}
      <rect
        x="0"
        y="178"
        width="400"
        height="10"
        fill="var(--sand)"
        opacity="0.5"
      />

      {/* Massing. The hotel is taller and warmer; the seven residence blocks
          are the corroborated count (F-001 resolved to 7). */}
      {BLOCKS.map((block) => (
        <g key={block.x}>
          <rect
            x={block.x}
            y={178 - block.h}
            width={block.w}
            height={block.h}
            rx="2"
            fill={block.hotel === true ? "var(--accent)" : "var(--primary)"}
            opacity={block.hotel === true ? 0.5 : 0.38}
          />
          {/* Lit face, so the blocks read as volumes rather than bars. */}
          <rect
            x={block.x}
            y={178 - block.h}
            width={block.w * 0.34}
            height={block.h}
            rx="2"
            fill="var(--foreground)"
            opacity="0.07"
          />
          {/* Six floors — the display value for floorsPerBuilding, itself a
              conflicted fact (F-021). Drawn as a rhythm, not a claim. */}
          {Array.from({ length: 6 }, (_, floor) => {
            const y = 172 - block.h + floor * (block.h / 7)
            return y > 178 - block.h ? (
              <rect
                key={floor}
                x={block.x + 3}
                y={y}
                width={block.w - 6}
                height="1"
                fill="var(--sea-foam)"
                opacity="0.28"
              />
            ) : null
          })}
        </g>
      ))}

      {/* Ground line. */}
      <rect
        x="0"
        y="177"
        width="400"
        height="1.5"
        fill="var(--foreground)"
        opacity="0.12"
      />
    </svg>
  )
}
