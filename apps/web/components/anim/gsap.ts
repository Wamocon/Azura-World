"use client"

/**
 * GSAP runtime — one registration point.                   Owner: W1-D
 *
 * Nothing in this app imports `gsap` directly. Everything imports
 * `{ gsap, ScrollTrigger, registerGsap }` from here and calls `registerGsap()`
 * as the first statement inside its effect, after the early returns. Mirrors
 * the NLP reference's `lib/gsap.ts`.
 *
 * It lives under `components/anim/` rather than `lib/` on purpose:
 * `lib/motion.ts` is the constants module and must stay import-light, because
 * everything reads a duration from it. Pulling GSAP in there would drag the
 * whole library into any bundle that wanted the number `0.32`.
 *
 * PLUGINS: ScrollTrigger only. `ScrambleTextPlugin` is deliberately not
 * registered even though it ships in the package — `components/anim/
 * scramble-text.tsx` is hand-rolled instead, because the plugin's character
 * shuffle is `Math.random()`-driven and W3-I requires every animation frame to
 * be reproducible for Playwright (`lib/simulation-clock.ts`). A snapshot test
 * against a randomised scramble is a flake generator.
 */

import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"

let registered = false

/** Register GSAP plugins exactly once, on the client. Idempotent and SSR-safe. */
export function registerGsap(): void {
  if (registered || typeof window === "undefined") return
  gsap.registerPlugin(ScrollTrigger)
  registered = true
}

export { gsap, ScrollTrigger }
