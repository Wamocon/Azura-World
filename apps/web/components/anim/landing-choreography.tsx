"use client"

import { useEffect, type ReactNode } from "react"

import { duration, ease } from "@/lib/motion"

import { gsap, ScrollTrigger, registerGsap } from "./gsap"

/**
 * Landing choreography — one island, one context, one teardown.
 *                                                        Owner: W-CINEMA-2
 *
 * ## Why one component instead of a hook per section
 *
 * The page has six scroll behaviours. Six components each opening their own
 * `gsap.context` and their own `ScrollTrigger`s is six teardowns that have to
 * all be correct, and the failure mode is silent: one leaked trigger and scroll
 * breaks on the *second* client-side navigation to this route, which no first
 * load ever catches. One island means one `ctx.revert()` and one place to read.
 *
 * It also means the sections stay Server Components. Nothing below ships an
 * event handler or a hook — the markup is complete and correct in the SSR
 * HTML, and this file only decorates what is already there. That is the no-JS
 * contract and the crawler contract satisfied by construction rather than by a
 * fallback path.
 *
 * ## The contract with the markup
 *
 * Everything is driven by data attributes, so a section can opt in by adding
 * one and opt out by deleting it:
 *
 *   [data-cine-hero]        the opening viewport
 *     [data-cine-hero-media]  photograph, parallaxes and scales as it leaves
 *     [data-cine-hero-veil]   scrim, deepens so the copy below stays legible
 *     [data-cine-hero-copy]   headline block, lifts out ahead of the frame
 *     [data-cine-intro]       staggered entrance on load, not on scroll
 *   [data-cine-stage]       the pinned cross-dissolve sequence
 *     [data-cine-frame]       stacked frames, index order is scroll order
 *     [data-cine-caption]     one caption per frame, same index order
 *   [data-parallax]         any element; strength in `data-parallax-strength`
 *   [data-rise]             mask-reveal on scroll-in, for headings and rows
 *   [data-rail]             the reading-progress rail, scaleY 0 → 1
 *   [data-sheen]            pointer-tracked highlight, writes --mx / --my
 *
 * ## Reduced motion
 *
 * The effect returns before it sets a single property. That ordering is the
 * mechanism, not the `[data-reveal]` safety net in globals.css — nothing here
 * has hidden anything, so there is nothing to un-hide. The cross-dissolve is
 * the one case that needs markup help: frame 0 is opaque in the HTML and the
 * rest carry their own `opacity` inline, so a static reader gets the opening
 * frame plus every caption stacked and readable rather than a blank stage.
 * `app/sections/cinema.tsx` owns that half of the contract.
 *
 * ## Only transform and opacity
 *
 * No `width`, no `height`, no `top`, no `box-shadow`, no `filter` on a scrub.
 * Every tween below stays on the compositor, which is what the INP floor is.
 */

/** Elements already on screen at setup must not be hidden and re-revealed. */
function isAboveTheFold(el: Element): boolean {
  return el.getBoundingClientRect().top < window.innerHeight * 0.92
}

export function LandingChoreography(): ReactNode {
  useEffect(() => {
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches

    // ↓ Nothing above this line touched a style. Nothing below it runs when the
    //   user asked for less motion.
    if (reduced) return

    registerGsap()

    const ctx = gsap.context(() => {
      // ----------------------------------------------------------------
      // 1. The opening. An entrance, not a scroll effect.
      // ----------------------------------------------------------------
      //
      // Runs on load rather than on intersection: this block IS the fold, so
      // an IntersectionObserver would fire in the same frame anyway and the
      // indirection would only add a chance of a flash.
      // `[data-intro-item]` rather than `> *`: every item sits inside its own
      // `.azura-mask` clipping wrapper, and animating the wrapper would move
      // the clip along with the glyph, which is the same as no mask at all.
      // The marker names the layer that actually travels.
      const intro = gsap.utils.toArray<HTMLElement>(
        "[data-cine-intro] [data-intro-item]"
      )
      if (intro.length > 0) {
        gsap.set(intro, { yPercent: 105 })
        gsap.to(intro, {
          yPercent: 0,
          duration: 1.05,
          ease: ease.coastal,
          stagger: 0.075,
          delay: 0.12,
          clearProps: "transform",
        })
      }

      // ----------------------------------------------------------------
      // 2. Hero departure.
      // ----------------------------------------------------------------
      //
      // The photograph slows down and sinks while the copy leaves at scroll
      // speed. Two rates over the same distance is the whole illusion of depth;
      // one rate is a background image scrolling.
      const hero = document.querySelector<HTMLElement>("[data-cine-hero]")
      if (hero !== null) {
        const media = hero.querySelector<HTMLElement>("[data-cine-hero-media]")
        const veil = hero.querySelector<HTMLElement>("[data-cine-hero-veil]")
        const copy = hero.querySelector<HTMLElement>("[data-cine-hero-copy]")

        const departure = gsap.timeline({
          scrollTrigger: {
            trigger: hero,
            start: "top top",
            end: "bottom top",
            scrub: 0.5,
          },
        })

        if (media !== null) {
          // Scale UP on the way out, not down. Scaling down reveals the page
          // behind the frame at its edges; scaling up cannot, and reads as the
          // camera pushing in as you leave.
          departure.to(media, { yPercent: 14, scale: 1.14, ease: "none" }, 0)
        }
        if (veil !== null) {
          departure.to(veil, { opacity: 1, ease: "none" }, 0)
        }
        if (copy !== null) {
          departure.to(
            copy,
            { yPercent: -26, opacity: 0, ease: "power1.in" },
            0
          )
        }
      }

      // ----------------------------------------------------------------
      // 3. The cross-dissolve stage.
      // ----------------------------------------------------------------
      //
      // `position: sticky` on the stage rather than ScrollTrigger's `pin`.
      // Under Lenis a pinned element is transformed by GSAP while Lenis is
      // transforming the page, and the pin-spacer's measured height stops
      // agreeing with the smoothed scroll position — the symptom is a one-frame
      // jump entering and leaving the pin. Sticky is the browser's own
      // implementation and Lenis never touches it, so the trigger below only
      // has to drive opacity.
      const stages = gsap.utils.toArray<HTMLElement>("[data-cine-stage]")
      for (const stage of stages) {
        const frames = gsap.utils.toArray<HTMLElement>(
          "[data-cine-frame]",
          stage
        )
        const captions = gsap.utils.toArray<HTMLElement>(
          "[data-cine-caption]",
          stage
        )
        if (frames.length < 2) continue

        // Frames are stacked back-to-front. Every frame above the first starts
        // hidden and slightly larger, then settles as it fades in, so a
        // dissolve carries a push rather than being a straight opacity ramp.
        gsap.set(frames.slice(1), { opacity: 0, scale: 1.07 })
        gsap.set(frames[0] ?? [], { opacity: 1, scale: 1 })
        gsap.set(captions.slice(1), { opacity: 0, yPercent: 30 })

        const steps = frames.length - 1
        const dissolve = gsap.timeline({
          scrollTrigger: {
            trigger: stage,
            start: "top top",
            end: "bottom bottom",
            scrub: 0.55,
          },
        })

        for (let i = 1; i <= steps; i++) {
          const frame = frames[i]
          const previous = captions[i - 1]
          const caption = captions[i]
          const at = i - 1

          if (frame !== undefined) {
            dissolve.to(
              frame,
              { opacity: 1, scale: 1, ease: "none", duration: 1 },
              at
            )
          }
          // The outgoing caption clears before the incoming one arrives.
          // Overlapping them puts two sentences on top of each other for a
          // third of a second, which is unreadable rather than cinematic.
          if (previous !== undefined) {
            dissolve.to(
              previous,
              { opacity: 0, yPercent: -22, ease: "none", duration: 0.4 },
              at
            )
          }
          if (caption !== undefined) {
            dissolve.to(
              caption,
              { opacity: 1, yPercent: 0, ease: "none", duration: 0.45 },
              at + 0.45
            )
          }
        }
      }

      // ----------------------------------------------------------------
      // 4. Generic parallax.
      // ----------------------------------------------------------------
      const floats = gsap.utils.toArray<HTMLElement>("[data-parallax]")
      for (const el of floats) {
        const strength = Number(el.dataset["parallaxStrength"] ?? "12")
        gsap.fromTo(
          el,
          { yPercent: strength },
          {
            yPercent: -strength,
            ease: "none",
            scrollTrigger: {
              trigger: el.parentElement ?? el,
              start: "top bottom",
              end: "bottom top",
              scrub: 0.6,
            },
          }
        )
      }

      // ----------------------------------------------------------------
      // 5. Mask rise.
      // ----------------------------------------------------------------
      //
      // The element travels inside a clipping wrapper (`.azura-mask`), so the
      // glyph moves and the box never does. Anything already on screen at setup
      // is left alone: hiding it now would be a flash for the one reader who is
      // already looking at it.
      const risers = gsap
        .utils.toArray<HTMLElement>("[data-rise]")
        .filter((el) => !isAboveTheFold(el))
      for (const el of risers) {
        gsap.fromTo(
          el,
          { yPercent: 108, opacity: 0 },
          {
            yPercent: 0,
            opacity: 1,
            duration: duration.slow,
            ease: ease.coastal,
            clearProps: "transform,opacity",
            scrollTrigger: { trigger: el, start: "top 92%", once: true },
          }
        )
      }

      // ----------------------------------------------------------------
      // 6. Chrome state.
      // ----------------------------------------------------------------
      //
      // The header is legible over the hero WITHOUT this — `chrome.tsx` paints
      // an unconditional gradient scrim behind it, which is the contract. This
      // only swaps that scrim for a solid blur once the photograph has left,
      // because a gradient fading into a dark page below the fold reads as a
      // smudge. Reduced motion keeps the scrim, which is complete and correct.
      const nav = document.querySelector<HTMLElement>("[data-nav]")
      if (nav !== null) {
        ScrollTrigger.create({
          start: "top -68%",
          end: 99999,
          onToggle: (self) => {
            if (self.isActive) nav.setAttribute("data-nav-solid", "")
            else nav.removeAttribute("data-nav-solid")
          },
        })
      }

      // ----------------------------------------------------------------
      // 7. Reading-progress rail.
      // ----------------------------------------------------------------
      const rail = document.querySelector<HTMLElement>("[data-rail]")
      if (rail !== null) {
        gsap.fromTo(
          rail,
          { scaleY: 0 },
          {
            scaleY: 1,
            ease: "none",
            transformOrigin: "top center",
            scrollTrigger: {
              trigger: document.documentElement,
              start: "top top",
              end: "bottom bottom",
              scrub: 0.3,
            },
          }
        )
      }
    })

    // ------------------------------------------------------------------
    // 8. Pointer-tracked sheen. Outside the context: it is a listener, not a
    //    tween, and `ctx.revert()` does not know about it.
    // ------------------------------------------------------------------
    //
    // One delegated listener on the document rather than one per panel. The
    // page carries a dozen sheen surfaces and twelve `mousemove` handlers is
    // twelve closures competing for the same frames.
    const onPointerMove = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      const panel = target.closest<HTMLElement>("[data-sheen]")
      if (panel === null) return
      const box = panel.getBoundingClientRect()
      panel.style.setProperty(
        "--mx",
        `${((event.clientX - box.left) / box.width) * 100}%`
      )
      panel.style.setProperty(
        "--my",
        `${((event.clientY - box.top) / box.height) * 100}%`
      )
    }
    // `pointermove` covers mouse, pen and touch-drag in one event, and a
    // coarse pointer simply never fires it while scrolling.
    document.addEventListener("pointermove", onPointerMove, { passive: true })

    // Images below the fold load lazily and each one that lands changes the
    // document height, which every scrubbed trigger has measured against.
    // Without this the parallax on the last section is offset by the sum of
    // everything that loaded after it was created.
    const onLoad = (): void => ScrollTrigger.refresh()
    window.addEventListener("load", onLoad)

    return () => {
      document.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("load", onLoad)
      // Reverts every tween AND kills every ScrollTrigger created inside the
      // context, which is the leak that breaks scroll on a second visit.
      ctx.revert()
    }
  }, [])

  return null
}
