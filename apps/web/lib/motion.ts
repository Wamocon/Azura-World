/**
 * Motion constants and the reduced-motion contract.        Owner: W1-D
 *
 * Nobody hardcodes a duration or an easing in a component. If a value is not
 * in this file, it is not in the design system, and a one-off `0.42s` in some
 * card is how a build stops feeling like one product.
 *
 * Three tools, three jobs, no overlap (DESIGN-RESEARCH §1):
 *   GSAP + ScrollTrigger  scroll choreography
 *   Framer Motion         component-level state
 *   Lenis                 scroll feel
 * A fourth animation library is a bundle regression, not a new capability.
 *
 * The numbers here mirror the `--duration-*` / `--ease-*` custom properties in
 * `app/globals.css`. They must agree: CSS transitions and JS tweens on the
 * same element with different curves produce a visible seam.
 */

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

/**
 * Seconds — GSAP and Framer Motion both take seconds.
 *
 * Ceiling for anything a user triggers is `base` (320ms). `slow` is for
 * surfaces large enough that the eye needs to track them (a sheet, a drawer);
 * `hero` is for the once-per-visit entrance and nothing else. A dropdown at
 * 400ms does not feel considered, it feels broken.
 */
export const duration = {
  instant: 0.12,
  fast: 0.2,
  base: 0.32,
  slow: 0.5,
  hero: 0.8,
} as const

/** Milliseconds, for `setTimeout`, WAAPI and inline `transitionDuration`. */
export const durationMs = {
  instant: 120,
  fast: 200,
  base: 320,
  slow: 500,
  hero: 800,
} as const

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

/**
 * GSAP easing names.
 *
 * There is deliberately no `in` entry. `ease-in` starts slow, which delays the
 * first frame — the exact moment the user is watching hardest — so a 300ms
 * ease-in *feels* slower than a 300ms ease-out. It is never the right choice
 * for UI.
 */
export const ease = {
  /** Entering, exiting, and anything the user just triggered. */
  out: "power3.out",
  /** Movement on screen that starts and ends at rest. */
  inOut: "power2.inOut",
  /** Constant motion: marquees, progress, scrub-linked scroll. */
  linear: "none",
} as const

/**
 * cubic-bezier control points, for Framer Motion's `ease` and for inline CSS.
 *
 * The built-in CSS keywords are too weak to read as intentional; these are the
 * stronger custom variants and they match `--ease-*` in `globals.css`
 * one-for-one.
 */
export const cubic = {
  out: [0.23, 1, 0.32, 1],
  inOut: [0.77, 0, 0.175, 1],
  /** The house curve. Long tail — water settling, not a UI snapping shut. */
  coastal: [0.16, 1, 0.3, 1],
} as const

// ---------------------------------------------------------------------------
// Springs
// ---------------------------------------------------------------------------

/**
 * Apple's two-parameter model (damping ratio + response) rather than the
 * mass/stiffness/damping triplet, expressed in Framer Motion's `bounce` +
 * `duration` form, which maps to it directly.
 *
 * `bounce: 0` (critically damped) is the default for everything. Overshoot is
 * only correct when the *gesture itself* carried momentum — a flick, a drag
 * release. A menu that merely faded in has no momentum to express, and
 * bouncing it looks like a decoration bolted on afterwards.
 */
export const spring = {
  /** Default. No overshoot. */
  default: { type: "spring", bounce: 0, duration: 0.4 },
  /** Momentum only — after a flick or a drag release. */
  momentum: { type: "spring", bounce: 0.2, duration: 0.4 },
  /** Sheets and drawers. */
  sheet: { type: "spring", bounce: 0.16, duration: 0.45 },
} as const

// ---------------------------------------------------------------------------
// Stagger
// ---------------------------------------------------------------------------

/**
 * Seconds between siblings in a staggered entrance.
 *
 * Kept short on purpose: past ~80ms a list stops feeling choreographed and
 * starts feeling slow. Stagger is decorative and must never gate interaction —
 * a row is clickable the moment it exists, not when its delay elapses.
 */
export const stagger = {
  tight: 0.03,
  base: 0.05,
  loose: 0.08,
} as const

/** Beyond this many items, stagger reads as lag. Later items share the last delay. */
export const STAGGER_CAP = 12

/** Delay for item `index`, capped so long lists do not accumulate seconds. */
export function staggerDelay(
  index: number,
  step: number = stagger.base
): number {
  return Math.min(index, STAGGER_CAP) * step
}

// ---------------------------------------------------------------------------
// Reduced motion
// ---------------------------------------------------------------------------

/** The media query, in one place so no component retypes it slightly wrong. */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"

/**
 * Whether the user asked for reduced motion. SSR-safe: returns `false` on the
 * server, because the server cannot know and a static-by-default render would
 * make the *unreduced* case the broken one.
 *
 * This is a snapshot, not a subscription. Components that must react to the
 * setting changing mid-session use `useReducedMotion()` from
 * `components/providers/motion-preference-provider`, which subscribes.
 *
 * THE CONTRACT (SYSTEM-PROMPT §2 / CONVENTIONS §5 / DESIGN-RESEARCH §4.1):
 * reduced motion yields a page that is COMPLETE and STATIC, not one that is
 * merely faster. Concretely, for every animated surface:
 *
 *   - Never hide first and reveal later. A reveal helper must bail *before*
 *     it applies `opacity: 0`, so content that is never animated is never
 *     hidden. Shortening the reveal is not a fix; the content is still
 *     invisible until a scroll that may never happen.
 *   - Simulations render their FINAL state, not a paused first frame.
 *   - Counters render the final number, with no count-up.
 *   - WebGL renders on demand, or shows its poster.
 *   - Lenis does not intercept scrolling at all.
 *
 * The test is mechanical: turn the flag on, and no information may be missing.
 */
export function prefersReducedMotion(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

// ---------------------------------------------------------------------------
// Device capability
// ---------------------------------------------------------------------------

/**
 * Motion tier. Simulation-heavy surfaces scale their work to this rather than
 * running the same load everywhere (W3-I "low-end mobile" edge case).
 *
 *   `full`    everything, including WebGL
 *   `reduced` DOM/CSS motion only; no WebGL, longer intervals, fewer particles
 *   `static`  no motion at all — the reduced-motion contract above
 */
export type MotionTier = "full" | "reduced" | "static"

/** Below this many logical cores, do not start a WebGL scene. */
export const WEBGL_MIN_HARDWARE_CONCURRENCY = 4

/**
 * Best-effort tier for the current device. Conservative by design: an unknown
 * device gets `reduced`, because the cost of withholding a maquette from a
 * capable phone is a slightly plainer page, and the cost of running one on an
 * incapable phone is a hot device and a janked scroll.
 */
export function motionTier(): MotionTier {
  if (prefersReducedMotion()) return "static"
  if (typeof navigator === "undefined") return "reduced"

  const cores = navigator.hardwareConcurrency
  if (typeof cores === "number" && cores < WEBGL_MIN_HARDWARE_CONCURRENCY) {
    return "reduced"
  }

  // `connection` is Chromium-only and not in the DOM lib types.
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection
  if (connection?.saveData === true) return "reduced"

  return "full"
}

/**
 * Whether WebGL can actually be created — asked once, cached, never assumed.
 *
 * CONVENTIONS §5 requires a poster fallback rather than a blank box when WebGL
 * is unavailable, and "unavailable" is not only "old device": headless CI,
 * a blocklisted driver, and a GPU-process crash all present as a `getContext`
 * that returns `null` on a perfectly modern browser. The NLP reference has no
 * such probe at all — its canvas simply renders nothing — which is the failure
 * mode this exists to prevent.
 */
let webglSupportCache: boolean | null = null

export function isWebGLAvailable(): boolean {
  if (webglSupportCache !== null) return webglSupportCache
  if (typeof document === "undefined") return false

  try {
    const canvas = document.createElement("canvas")
    const gl =
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl")
    webglSupportCache = gl !== null
    // Release the probe context immediately; browsers cap live WebGL contexts
    // (~16) and a leaked probe costs one of them for the life of the page.
    if (gl !== null && "getExtension" in gl) {
      const lose = (gl as WebGLRenderingContext).getExtension(
        "WEBGL_lose_context"
      )
      lose?.loseContext()
    }
  } catch {
    // A throwing getContext is itself the answer.
    webglSupportCache = false
  }

  return webglSupportCache
}

/** Test seam — resets the memoised probe. Not for production paths. */
export function resetWebGLSupportCache(): void {
  webglSupportCache = null
}

// ---------------------------------------------------------------------------
// Viewport
// ---------------------------------------------------------------------------

/**
 * Default IntersectionObserver options for scroll reveals.
 *
 * The negative bottom margin means an element reveals slightly *after* it
 * technically enters the viewport, so the motion happens where the eye already
 * is rather than at the very edge of the screen.
 */
export const revealViewport = {
  rootMargin: "0px 0px -10% 0px",
  threshold: 0.01,
} as const

/**
 * Fail-safe window for a scroll reveal, in ms.
 *
 * If an element is at or above the fold but its observer never fired — a
 * zero-height parent, a display:none ancestor at observe time, a bfcache
 * restore — it is revealed anyway. Borrowed from the NLP reference, and the
 * reason is worth restating: content stuck invisible is a far worse failure
 * than content that appears without its animation.
 */
export const REVEAL_FAILSAFE_MS = 1500
