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

      // ----------------------------------------------------------------
      // 8. The ledger. A fact being retracted, in the order it happened.
      // ----------------------------------------------------------------
      //
      // `app/sections/ledger.tsx` renders every stage and every strike-through
      // in its FINAL state, on the server. This does not build the section, it
      // rewinds it and plays it forward.
      //
      // That ordering is deliberate and is the opposite of the usual one.
      // Animating up from a hidden initial state means a reader with no
      // JavaScript, or a crawler, or anyone who hits the `reduced` return
      // above, gets an empty column where the argument should be. Starting
      // from the finished state means the worst case is a page that does not
      // move, which azura-ui-ux §5.1 asks for in as many words.
      //
      // So every `set` below is a rewind, and every tween returns the element
      // to where the server already put it.
      const ledger = document.querySelector("[data-cine-ledger]")
      if (ledger !== null) {
        const stages = ledger.querySelectorAll("[data-cine-ledger-stage]")
        // The first stage is the premise and stays put. Rewinding it would
        // leave the column empty on arrival, with nothing to explain the gap.
        for (const stage of Array.from(stages).slice(1)) {
          gsap.set(stage, { opacity: 0, y: 26 })
          gsap.to(stage, {
            opacity: 1,
            y: 0,
            duration: duration.slow,
            ease: ease.out,
            scrollTrigger: { trigger: stage, start: "top 82%", once: true },
          })
        }

        // The retraction itself. A hairline scaling from its left edge, so it
        // reads as a pen drawn across the line rather than a style toggling.
        // Transform only: §4 forbids animating a width, and a text decoration
        // cannot be animated at all, which is why this is a separate element.
        for (const strike of ledger.querySelectorAll(
          "[data-cine-ledger-strike]"
        )) {
          gsap.set(strike, { scaleX: 0 })
          gsap.to(strike, {
            scaleX: 1,
            duration: duration.slow,
            ease: ease.out,
            // Late enough that the superseded line has been read before it is
            // struck. A retraction nobody saw arrive is just a grey line.
            delay: 0.45,
            scrollTrigger: {
              trigger: strike.closest("[data-cine-ledger-stage]") ?? strike,
              start: "top 72%",
              once: true,
            },
          })
        }
      }

      // ----------------------------------------------------------------
      // 9. The ticket lifecycle. A case travelling its track.
      // ----------------------------------------------------------------
      //
      // Same contract as the ledger above: `app/sections/system-flow.tsx`
      // renders the finished track, and this rewinds it and plays it forward.
      //
      // ONE trigger on the track, not one per node. From `lg` the five nodes
      // are a horizontal row, so they all cross any given scroll line in the
      // same frame; five individual triggers would fire together and the
      // sequence would collapse into a flash. The stagger is what carries the
      // order, so the order has to come from a timeline rather than from
      // geometry.
      //
      // Nodes and arrows are interleaved into one timeline so each arrow
      // arrives between the two nodes it joins. An arrow that lands before its
      // destination points at nothing.
      const flow = document.querySelector("[data-cine-flow]")
      if (flow !== null) {
        const nodes = Array.from(flow.querySelectorAll("[data-cine-flow-node]"))
        const links = Array.from(flow.querySelectorAll("[data-cine-flow-link]"))

        // Rewind. Transform and opacity only, per azura-ui-ux §4.
        gsap.set(nodes, { opacity: 0, y: 18 })
        gsap.set(links, { opacity: 0, scale: 0.55 })

        const tl = gsap.timeline({
          scrollTrigger: { trigger: flow, start: "top 78%", once: true },
        })
        // Step, arrow, step, arrow … The arrow overlaps the node it follows so
        // the track feels continuous rather than metronomic.
        for (const [i, node] of nodes.entries()) {
          tl.to(
            node,
            { opacity: 1, y: 0, duration: duration.base, ease: ease.out },
            i === 0 ? 0 : "<0.28"
          )
          const link = links[i]
          if (link !== undefined) {
            tl.to(
              link,
              { opacity: 1, scale: 1, duration: duration.fast, ease: ease.out },
              "<0.16"
            )
          }
        }
      }

      // ----------------------------------------------------------------
      // 10. The hub. Six capabilities drawn out of one shared record.
      // ----------------------------------------------------------------
      //
      // `app/sections/system.tsx` calls the centre panel "the source the
      // spokes draw from rather than a seventh card". On a static page that is
      // an assertion made by layout alone, and layout alone does not say which
      // came first. So the core arrives, and only then do the six cards move
      // outward away from it, alternating sides.
      //
      // The direction carries the meaning and is therefore signed off the
      // card's own side: a left card starts to its RIGHT (nearer the core) and
      // travels out to rest, a right card starts to its left. Everything
      // radiates from the centre because everything comes from the record.
      //
      // Same contract as 8 and 9: the server renders the assembled hub, this
      // rewinds it. A reader who never runs it sees all six cards and the core.
      const hub = document.querySelector("[data-cine-hub]")
      if (hub !== null) {
        const core = hub.querySelector("[data-cine-hub-core]")
        const spokes = Array.from(hub.querySelectorAll("[data-cine-hub-spoke]"))

        if (core !== null) gsap.set(core, { opacity: 0, scale: 0.965 })
        for (const spoke of spokes) {
          const fromCore =
            spoke.getAttribute("data-cine-hub-side") === "left" ? 26 : -26
          gsap.set(spoke, { opacity: 0, x: fromCore })
        }

        const tl = gsap.timeline({
          scrollTrigger: { trigger: hub, start: "top 72%", once: true },
        })
        if (core !== null) {
          tl.to(core, {
            opacity: 1,
            scale: 1,
            duration: duration.slow,
            ease: ease.out,
          })
        }
        // Alternating sides rather than left-then-right, so the hub grows
        // evenly instead of listing to one side and catching up.
        const ordered = [
          ...spokes.filter((s) => s.getAttribute("data-cine-hub-side") === "left"),
        ].flatMap((left, i) => {
          const right = spokes.filter(
            (s) => s.getAttribute("data-cine-hub-side") === "right"
          )[i]
          return right === undefined ? [left] : [left, right]
        })
        for (const [i, spoke] of ordered.entries()) {
          tl.to(
            spoke,
            { opacity: 1, x: 0, duration: duration.base, ease: ease.out },
            i === 0 ? "-=0.18" : "<0.11"
          )
        }
      }
    })

    // ------------------------------------------------------------------
    // 11. Pointer-tracked sheen. Outside the context: it is a listener, not a
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
