"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

import { durationMs } from "@/lib/motion"

/**
 * ScrambleText — text that decodes into place.             Owner: W1-D
 *
 * HAND-ROLLED, not GSAP's ScrambleTextPlugin, for one concrete reason: the
 * plugin shuffles characters with `Math.random()`, and W3-I requires every
 * animation frame in this build to be reproducible so Playwright snapshots do
 * not flake (`lib/simulation-clock.ts`). A snapshot test against a randomised
 * scramble is a flake generator.
 *
 * Determinism here needs no seeded PRNG and no state at all: the filler glyph
 * is a pure function of (character index, frame index). Two loads produce
 * byte-identical frames, and a frame can be reproduced in isolation without
 * replaying the ones before it.
 *
 * The real text is in the SSR markup and is what a crawler, a no-JS visitor
 * and a reduced-motion user get. The scramble only ever replaces already-
 * rendered text on the client.
 *
 * `aria-live` is deliberately absent. A live region on decoding text would
 * announce every intermediate frame — dozens of nonsense strings per word.
 * The animation is decorative; the accessible name never changes.
 */

/** Latin + a little Cyrillic, so `ru` decodes into a plausible alphabet. */
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZабвгдежзиклмнопрстуфхцч0123456789"

/**
 * Deterministic filler for character `index` at frame `frame`.
 *
 * A cheap integer hash, not a PRNG: no state to seed, no sequence to replay,
 * and identical output for identical inputs on every machine.
 */
function glyphAt(index: number, frame: number): string {
  const hash = (index * 2654435761 + frame * 40503) >>> 0
  return GLYPHS[hash % GLYPHS.length] ?? "A"
}

export function ScrambleText({
  text,
  className,
  /** Total decode time. */
  durationMsProp = durationMs.hero,
  /** Frame interval. 16ms is a wasted render; 45ms still reads as a flicker. */
  frameMs = 45,
}: {
  text: string
  className?: string
  durationMsProp?: number
  frameMs?: number
}): ReactNode {
  const [display, setDisplay] = useState(text)
  const startedRef = useRef(false)

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches

    // Reduced motion, or a second run: leave the real text alone. It is
    // already rendered — this is the "complete and static" contract, and it
    // costs nothing because the correct value was never removed.
    if (reduced || startedRef.current) {
      setDisplay(text)
      return
    }
    startedRef.current = true

    const totalFrames = Math.max(1, Math.ceil(durationMsProp / frameMs))
    const characters = Array.from(text)
    let frame = 0

    const interval = window.setInterval(() => {
      frame += 1

      // Left-to-right lock-in: a character is settled once the wavefront has
      // passed it. Progress is linear in frames, so the reveal is even.
      const settled = (characters.length * frame) / totalFrames

      setDisplay(
        characters
          .map((character, index) => {
            if (index < settled) return character
            // Whitespace never scrambles — shuffling spaces destroys the word
            // shape and the line re-wraps on every frame.
            if (character.trim() === "") return character
            return glyphAt(index, frame)
          })
          .join("")
      )

      if (frame >= totalFrames) {
        window.clearInterval(interval)
        setDisplay(text)
      }
    }, frameMs)

    return () => {
      window.clearInterval(interval)
      // Unmounting mid-decode must not leave a half-scrambled string behind in
      // a cached tree.
      setDisplay(text)
    }
  }, [text, durationMsProp, frameMs])

  return (
    // ONE text node, not two.
    //
    // This previously rendered the string twice — `<span aria-hidden>{display}</span>`
    // beside `<span class="sr-only">{text}</span>` — so that a screen reader got
    // the real word while the glyphs decoded. The accessible name was right and
    // the DOM was wrong: `textContent` concatenated both copies, and the page's
    // only `<h1>` read "Azura World Residence & HotelAzura World Residence & Hotel"
    // to every crawler, every text extractor and every automated check. Measured
    // on the production build before this fix.
    //
    // `aria-label` gives the same guarantee with one node: the accessible name is
    // always the settled text, whatever the glyphs are doing, and there is
    // nothing to double. `role="text"` is deliberately NOT used — it is
    // non-standard and Safari-only.
    <span className={className} aria-label={text}>
      <span aria-hidden="true">{display}</span>
    </span>
  )
}
