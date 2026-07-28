/**
 * layout-audit — 8 widths × 4 locales × 2 themes, over every public route.
 *                                                                Owner: W4-B
 *
 * `pnpm qa:layout`
 *
 * ## Why this one earns its keep
 *
 * The reference project's equivalent found "the header colliding with the hero
 * in Russian, the filter panel shipping permanently open, and tap targets under
 * 24px" — none of which an e2e test notices, because every one of them is a
 * page that still works, just wrongly. German runs ~30% longer than English and
 * Russian ~35% (azura-ui-ux §5.6), so **320px in German and Russian is where
 * this finds things**.
 *
 * ## And why it is not to be trusted on its own
 *
 * That same harness exempted the fixed header and skipped `<select>`/`<svg>`,
 * and a screenshot caught what it missed. An unstated exemption reads as a
 * clean pass. So this script prints `BLIND SPOTS` **before** its results, every
 * run, and writes them into the JSON report — and it deliberately does NOT
 * exempt the header.
 *
 * Output: `quality/layout/<timestamp>/report.json` + a clipped screenshot per
 * violation.
 */

import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { inflateSync } from "node:zlib"

import {
  LOCALES,
  THEMES,
  WIDTHS,
  applyTheme,
  createReporter,
  launchBrowser,
  parseArgs,
  preparePage,
  publicRoutes,
  reportBlindSpots,
  resolveTheme,
  resultDir,
  startServer,
  urlFor,
  writeJson,
} from "./qa-lib.mjs"

const args = parseArgs(process.argv.slice(2))
const PORT = Number(args.values.get("port") ?? 3260)
const HEADED = args.flags.has("headed")
const MAX_SHOTS = Number(args.values.get("max-shots") ?? 40)
const ONLY_WIDTH = args.values.get("width")
const ONLY_LOCALE = args.values.get("locale")
/** Phase 2 samples one width; contrast is a function of colour, not viewport. */
const PIXEL_CONTRAST_WIDTH = Number(args.values.get("contrast-width") ?? 375)
const PIXEL_CONTRAST_LOCALE = args.values.get("contrast-locale") ?? "de"

const BLIND_SPOTS = [
  "Contrast is sampled, not exhaustive: one representative text node per distinct " +
    "(colour, background, font-size) triple per page, and the background is taken from the " +
    "nearest ancestor with a non-transparent background-color.",
  "Contrast against a GRADIENT, an IMAGE or a translucent stack is measured in a second " +
    "pass, from rendered pixels, at ONE width and ONE locale per route × theme. A gradient " +
    "that only fails at another viewport, or behind a longer translation, is unmeasured.",
  "That pixel pass hides the text and takes the WORST pixel in the middle 70% of the box. " +
    "The border is skipped because a neighbouring word's glyph bleeds into it; a background " +
    "that only fails in the outer 15% — where no glyph sits — is therefore not reported.",
  "`<svg>` internals are not descended into. The <svg> element's own box is measured; the " +
    "geometry inside it is not CSS layout and this harness would produce noise, not findings.",
  "`<select>` renders its popup natively, outside the DOM. The closed control's box is " +
    "measured; the open list is invisible to this harness.",
  "The fixed/sticky header is NOT exempt — it is measured like anything else. That is a " +
    "deliberate departure from the reference harness, which exempted it and missed a collision.",
  "Overlap detection compares only interactive elements where neither contains the other. " +
    "Deliberate overlays (a popover above content) are legitimate and will read as findings; " +
    "each is screenshotted so a human can judge.",
  "Tap-target checks exempt inline links inside a text block, per WCAG 2.2 SC 2.5.8's own " +
    "inline exception, and exempt anything inside a larger interactive ancestor.",
  "Authenticated routes (/dashboard, /dashboard/evidence) are NOT audited. Under " +
    "`next start` with NODE_ENV=production the QA access-profile cookie is disabled, so an " +
    "unauthenticated request is redirected to login. Their layout is unmeasured.",
  "Only rendered state is audited: no hover, no focus-within, no open menus, no error or " +
    "loading states. A layout that breaks only while a dropdown is open will pass here.",
  "Animations are forced to zero duration before measuring. A layout that is broken only " +
    "mid-transition will pass here.",
  "A clip is reported only when it cuts a TEXT node, measured with Range rects. A clipped " +
    "ICON, image, chart or border is invisible to this check — `.azura-iso-sea` bleeding out " +
    "of its scene is silent by design, and so would a genuinely half-cut icon be.",
  "An element past the viewport is reported only when NO ancestor clips or scrolls it, " +
    "because only then can it widen the document. Content pushed out of a hidden container " +
    "is judged as clipping instead — and if it is not text, see the line above.",
  "The theme the harness ASKS for is not necessarily the one the app renders. It is read " +
    "back on the first load of each theme and reported as `theme-not-applied` when they " +
    "disagree, because a silently-substituted theme turns an unaudited surface into a pass.",
]

/**
 * The whole audit, executed inside the page.
 *
 * One `page.evaluate` rather than many round trips: 192 navigations × several
 * hundred elements is where a chatty harness becomes a 40-minute harness.
 */
const AUDIT = () => {
  const out = {
    overflow: [],
    clipping: [],
    overlap: [],
    tapTargets: [],
    contrast: [],
    contrastIndeterminate: [],
    truncation: [],
    stats: {},
  }

  const describe = (el) => {
    const id = el.id ? `#${el.id}` : ""
    const cls =
      typeof el.className === "string" && el.className
        ? `.${el.className.trim().split(/\s+/).slice(0, 3).join(".")}`
        : ""
    const slot = el.getAttribute?.("data-slot")
    return `${el.tagName.toLowerCase()}${id}${cls}${slot ? `[data-slot=${slot}]` : ""}`
  }

  const rectOf = (el) => {
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  }

  const isRendered = (el, style) =>
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity) !== 0 &&
    el.getBoundingClientRect().width > 0 &&
    el.getBoundingClientRect().height > 0

  // `sr-only` is a 1px clipped box on purpose; it is content for screen readers
  // and must not be judged as a tap target or an overflow.
  const isScreenReaderOnly = (el, style) =>
    style.position === "absolute" &&
    style.clipPath !== "none" &&
    el.getBoundingClientRect().width <= 2

  /**
   * True when some ancestor constrains the element horizontally — by scrolling
   * it (`auto`/`scroll`) or by cutting it off (`hidden`/`clip`).
   *
   * A wide table inside `overflow-x: auto` is a DELIBERATE pattern — it is how
   * you show 5 columns on a 320px phone — and the document itself never
   * overflows. The first version of this harness reported all 13 descendants of
   * one such table on the landing page as violations, which is precisely the
   * false-positive noise that gets a harness switched off.
   *
   * `hidden`/`clip` was added after the full matrix: `.azura-iso-sea` bleeds
   * 345px inside a 254px `overflow:hidden` scene on purpose, and was reported
   * 56 times across the grid. Measured on the live page, `documentElement`
   * `scrollWidth` equalled `clientWidth` on all 192 loads — nothing clipped by
   * an ancestor can widen the document, so it is not a viewport overflow.
   *
   * It may still be a **clipping** finding, and that is the point of the split:
   * being cut off by a hidden ancestor is judged below, by whether TEXT is
   * actually lost. The Russian `Смоделировано` chip is caught there, where it
   * belongs, with the words it loses; the decorative sea is not caught at all.
   */
  const clippedOrScrolledByAncestor = (el) => {
    let node = el.parentElement
    while (node && node !== document.documentElement) {
      const s = getComputedStyle(node)
      if (s.overflowX !== "visible") return true
      node = node.parentElement
    }
    return false
  }

  /**
   * Text that a clipping box actually cuts off, measured with Range rects
   * against the box rather than inferred from `scrollWidth`.
   *
   * `scrollWidth > clientWidth` only says *something* overflows. On the
   * kitchen-sink that something was a decorative gradient, and the eight block
   * labels it "clipped" were all fully visible — 64 findings, zero lost words.
   * A clip is only a defect when a reader loses text, so that is what gets
   * measured, and the finding carries the text so a human can judge it.
   */
  const cutText = (el, box) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const cut = []
    let node
    while ((node = walker.nextNode()) && cut.length < 6) {
      const value = node.nodeValue
      if (!value || !value.trim()) continue
      const parent = node.parentElement
      if (parent) {
        const ps = getComputedStyle(parent)
        if (!isRendered(parent, ps) || isScreenReaderOnly(parent, ps)) continue
      }
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const r of range.getClientRects()) {
        if (r.width === 0 || r.height === 0) continue
        const right = Math.round(r.right - box.right)
        const bottom = Math.round(r.bottom - box.bottom)
        const left = Math.round(box.left - r.left)
        const by = Math.max(right, bottom, left)
        if (by > 1) {
          cut.push({ text: value.trim().slice(0, 60), by, axis: right >= bottom && right >= left ? "x" : bottom >= left ? "y" : "x" })
          break
        }
      }
    }
    return cut
  }

  // Violating elements are tagged so a single annotated screenshot can show
  // every one of them in place, rather than a clipped crop per finding.
  const tag = (el, kind) => {
    const existing = el.getAttribute("data-qa-violation")
    el.setAttribute("data-qa-violation", existing ? `${existing} ${kind}` : kind)
  }

  const all = [...document.querySelectorAll("*")].filter((el) => !el.closest("svg"))
  out.stats.elements = all.length

  // ---- 1. horizontal overflow ---------------------------------------------
  const docEl = document.documentElement
  if (docEl.scrollWidth > docEl.clientWidth + 1) {
    out.overflow.push({
      selector: "document",
      scrollWidth: docEl.scrollWidth,
      clientWidth: docEl.clientWidth,
      by: docEl.scrollWidth - docEl.clientWidth,
    })
  }
  // The element actually sticking out, so the report names a culprit rather
  // than only the symptom.
  for (const el of all) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.right > docEl.clientWidth + 1) {
      const style = getComputedStyle(el)
      if (!isRendered(el, style) || isScreenReaderOnly(el, style)) continue
      if (style.position === "fixed") continue // fixed elements are positioned, not flowed
      if (clippedOrScrolledByAncestor(el)) continue
      tag(el, "overflow")
      out.overflow.push({
        selector: describe(el),
        rect: rectOf(el),
        overhang: Math.round(r.right - docEl.clientWidth),
        kind: "element-past-viewport",
      })
      if (out.overflow.length > 12) break
    }
  }

  // ---- 2. clipping: content wider/taller than a hidden-overflow box --------
  for (const el of all) {
    const style = getComputedStyle(el)
    if (!isRendered(el, style) || isScreenReaderOnly(el, style)) continue
    const hiddenX = style.overflowX === "hidden" || style.overflowX === "clip"
    const hiddenY = style.overflowY === "hidden" || style.overflowY === "clip"
    if (!hiddenX && !hiddenY) continue
    // A line-clamp or an ellipsis is an intentional clip, and the truncation
    // check below judges whether it has an affordance. Reporting the same
    // element under both kinds doubled every count in the first run — 13
    // .truncate spans became 26 findings — which makes a report read as twice
    // as broken as the page is.
    if (style.webkitLineClamp && style.webkitLineClamp !== "none") continue
    if (style.textOverflow === "ellipsis") continue
    const overX = hiddenX && el.scrollWidth > el.clientWidth + 1
    const overY = hiddenY && el.scrollHeight > el.clientHeight + 1
    if (!overX && !overY) continue
    if ((el.textContent ?? "").trim().length === 0) continue
    // The box overflows — but does a reader lose anything by it?
    const lost = cutText(el, el.getBoundingClientRect())
    if (lost.length === 0) continue
    tag(el, "clipping")
    out.clipping.push({
      selector: describe(el),
      rect: rectOf(el),
      axis: overX ? "x" : "y",
      hiddenBy: overX ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight,
      cutText: lost,
      text: (el.textContent ?? "").trim().slice(0, 80),
    })
    if (out.clipping.length > 12) break
  }

  // ---- 3. tap targets ------------------------------------------------------
  const INTERACTIVE = "a[href], button, input, select, textarea, [role=button], [role=link], [tabindex]:not([tabindex='-1'])"
  const interactive = [...document.querySelectorAll(INTERACTIVE)].filter((el) => !el.closest("svg"))
  out.stats.interactive = interactive.length

  for (const el of interactive) {
    const style = getComputedStyle(el)
    if (!isRendered(el, style) || isScreenReaderOnly(el, style)) continue
    // WCAG 2.2 SC 2.5.8 exempts a link inside a sentence of text.
    const parent = el.parentElement
    const inlineInText =
      el.tagName === "A" &&
      style.display.startsWith("inline") &&
      parent !== null &&
      (parent.textContent ?? "").trim().length > (el.textContent ?? "").trim().length + 12
    if (inlineInText) continue
    // A small control inside a bigger hit area is fine.
    const enclosing = el.parentElement?.closest(INTERACTIVE)
    if (enclosing && enclosing !== el) continue

    const r = el.getBoundingClientRect()
    if (r.width < 24 || r.height < 24) {
      tag(el, "tap-target")
      out.tapTargets.push({
        selector: describe(el),
        rect: rectOf(el),
        text: (el.textContent ?? "").trim().slice(0, 40),
      })
    }
  }

  // ---- 4. overlap between interactive elements ----------------------------
  const boxes = interactive
    .map((el) => ({ el, style: getComputedStyle(el) }))
    .filter(({ el, style }) => isRendered(el, style) && !isScreenReaderOnly(el, style))
    .map(({ el }) => ({ el, r: el.getBoundingClientRect() }))

  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]
      const b = boxes[j]
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue
      const ix = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left)
      const iy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top)
      if (ix <= 1 || iy <= 1) continue
      const area = ix * iy
      const smaller = Math.min(a.r.width * a.r.height, b.r.width * b.r.height)
      if (smaller === 0 || area / smaller < 0.25) continue
      tag(a.el, "overlap"); tag(b.el, "overlap")
      out.overlap.push({
        a: describe(a.el),
        b: describe(b.el),
        rect: {
          x: Math.round(Math.max(a.r.left, b.r.left)),
          y: Math.round(Math.max(a.r.top, b.r.top)),
          w: Math.round(ix),
          h: Math.round(iy),
        },
        share: Number((area / smaller).toFixed(2)),
      })
      if (out.overlap.length > 12) break
    }
    if (out.overlap.length > 12) break
  }

  // ---- 5. truncation without an affordance --------------------------------
  for (const el of all) {
    const style = getComputedStyle(el)
    if (!isRendered(el, style)) continue
    const clamped = style.webkitLineClamp && style.webkitLineClamp !== "none"
    const ellipsis = style.textOverflow === "ellipsis"
    if (!clamped && !ellipsis) continue
    const truncated = clamped
      ? el.scrollHeight > el.clientHeight + 1
      : el.scrollWidth > el.clientWidth + 1
    if (!truncated) continue
    // An affordance is a title, or an expand control that points at this box.
    const hasTitle = el.hasAttribute("title")
    const id = el.id
    const controlled =
      id !== "" && document.querySelector(`[aria-controls="${CSS.escape(id)}"]`) !== null
    const siblingButton = el.parentElement?.querySelector("button[aria-expanded]") !== null &&
      el.parentElement?.querySelector("button[aria-expanded]") !== undefined
    if (hasTitle || controlled || siblingButton) continue
    tag(el, "truncation")
    out.truncation.push({
      selector: describe(el),
      rect: rectOf(el),
      mode: clamped ? "line-clamp" : "ellipsis",
      text: (el.textContent ?? "").trim().slice(0, 80),
    })
    if (out.truncation.length > 12) break
  }

  // ---- 6. contrast (sampled) ----------------------------------------------
  const parseRgb = (value) => {
    const m = /rgba?\(([^)]+)\)/.exec(value)
    if (!m) return null
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    if (parts.length < 3 || parts.some(Number.isNaN)) return null
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }
  }
  const luminance = ({ r, g, b }) => {
    const f = (c) => {
      const s = c / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const ratio = (fg, bg) => {
    const l1 = luminance(fg)
    const l2 = luminance(bg)
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
    return (hi + 0.05) / (lo + 0.05)
  }

  const seen = new Set()
  for (const el of all) {
    // Only elements whose own text is a direct child.
    const own = [...el.childNodes].some(
      (n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 1,
    )
    if (!own) continue
    const style = getComputedStyle(el)
    if (!isRendered(el, style) || isScreenReaderOnly(el, style)) continue

    const fg = parseRgb(style.color)
    if (fg === null) continue
    const size = parseFloat(style.fontSize)
    const weight = Number(style.fontWeight) || 400
    // WCAG large text: ≥24px, or ≥18.66px bold.
    const large = size >= 24 || (size >= 18.66 && weight >= 700)
    const required = large ? 3 : 4.5

    let node = el
    let bg = null
    let indeterminate = false
    while (node && node !== document.documentElement.parentElement) {
      const s = getComputedStyle(node)
      if (s.backgroundImage && s.backgroundImage !== "none") {
        indeterminate = true
        break
      }
      const candidate = parseRgb(s.backgroundColor)
      if (candidate && candidate.a === 1) {
        bg = candidate
        break
      }
      if (candidate && candidate.a > 0 && candidate.a < 1) {
        indeterminate = true
        break
      }
      node = node.parentElement
    }

    const key = `${style.color}|${bg ? `${bg.r},${bg.g},${bg.b}` : indeterminate ? "img" : "none"}|${Math.round(size)}|${weight}`
    if (seen.has(key)) continue
    seen.add(key)

    if (indeterminate) {
      out.contrastIndeterminate.push({
        selector: describe(el),
        rect: rectOf(el),
        colour: style.color,
        reason: "background is a gradient, image or semi-transparent layer",
      })
      continue
    }
    if (bg === null) {
      bg = { r: 255, g: 255, b: 255, a: 1 }
    }
    const value = ratio(fg, bg)
    if (value + 0.01 < required) {
      tag(el, "contrast")
      out.contrast.push({
        selector: describe(el),
        rect: rectOf(el),
        ratio: Number(value.toFixed(2)),
        required,
        colour: style.color,
        background: `rgb(${bg.r}, ${bg.g}, ${bg.b})`,
        fontSize: Math.round(size),
        text: (el.textContent ?? "").trim().slice(0, 60),
      })
    }
  }
  out.stats.contrastSamples = seen.size

  return out
}

// ---------------------------------------------------------------------------
// Phase 2 — contrast against gradients, measured from rendered pixels
// ---------------------------------------------------------------------------

/**
 * Minimal PNG reader: IHDR + concatenated IDAT + unfilter. 8-bit RGB/RGBA only,
 * which is what Chromium emits for a screenshot.
 *
 * Written out rather than pulled in because adding a dependency means
 * `pnpm install`, which is W0-A's to run and must not run concurrently.
 */
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG")
  let offset = 8
  let width = 0
  let height = 0
  let channels = 0
  const idat = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString("ascii", offset + 4, offset + 8)
    const body = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === "IHDR") {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      const depth = body[8]
      const colourType = body[9]
      if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`)
      if (colourType === 2) channels = 3
      else if (colourType === 6) channels = 4
      else throw new Error(`unsupported colour type ${colourType}`)
    } else if (type === "IDAT") {
      idat.push(body)
    } else if (type === "IEND") {
      break
    }
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = Buffer.alloc(height * stride)
  let pos = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos]
    pos += 1
    const line = raw.subarray(pos, pos + stride)
    pos += stride
    const target = pixels.subarray(y * stride, (y + 1) * stride)
    const prior = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? target[x - channels] : 0
      const b = prior ? prior[x] : 0
      const c = prior && x >= channels ? prior[x - channels] : 0
      let value = line[x]
      if (filter === 1) value += a
      else if (filter === 2) value += b
      else if (filter === 3) value += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      } else if (filter !== 0) {
        throw new Error(`unsupported filter ${filter}`)
      }
      target[x] = value & 0xff
    }
  }
  return { width, height, channels, pixels }
}

const relativeLuminance = (r, g, b) => {
  const f = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

const contrastOf = (l1, l2) => {
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Contrast where the background is a gradient, an image or a translucent stack.
 *
 * The sampled pass above can only reason about a solid `background-color`, so
 * on the landing page — the one built out of `.azura-aurora` gradients — it
 * measured nothing at all and emitted 1216 `contrast-indeterminate` records.
 * That reads as coverage and is not: azura-ui-ux §5.5 asks for contrast
 * "measured, not eyeballed", and a page-sized shrug fails that.
 *
 * So: hide the text, screenshot the box it occupied, and take the WORST pixel
 * behind it — the one whose luminance is closest to the text's. A gradient that
 * passes at one end and fails at the other is a failure, and this finds it.
 *
 * Deliberately narrow: one width per route × theme. Contrast is a function of
 * colour, and colour rarely varies with viewport; the cost of being wrong about
 * that is stated in BLIND_SPOTS rather than paid 8× over.
 */
const FIND_INDETERMINATE = () => {
  const parseRgb = (value) => {
    const m = /rgba?\(([^)]+)\)/.exec(value)
    if (!m) return null
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    if (parts.length < 3 || parts.some(Number.isNaN)) return null
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }
  }
  const found = []
  const seen = new Set()
  for (const el of document.querySelectorAll("*")) {
    if (el.closest("svg")) continue
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 1)
    if (!own) continue
    const style = getComputedStyle(el)
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue
    const rect = el.getBoundingClientRect()
    if (rect.width < 4 || rect.height < 4) continue
    const fg = parseRgb(style.color)
    if (fg === null) continue

    let node = el
    let indeterminate = false
    while (node && node !== document.documentElement.parentElement) {
      const s = getComputedStyle(node)
      if (s.backgroundImage && s.backgroundImage !== "none") { indeterminate = true; break }
      const candidate = parseRgb(s.backgroundColor)
      if (candidate && candidate.a === 1) break
      if (candidate && candidate.a > 0 && candidate.a < 1) { indeterminate = true; break }
      node = node.parentElement
    }
    if (!indeterminate) continue

    const size = parseFloat(style.fontSize)
    const weight = Number(style.fontWeight) || 400
    const key = `${style.color}|${Math.round(size)}|${weight}|${el.tagName}`
    if (seen.has(key)) continue
    seen.add(key)

    const id = `qa-contrast-${found.length}`
    el.setAttribute("data-qa-contrast", String(found.length))
    found.push({
      id,
      index: found.length,
      selector:
        el.tagName.toLowerCase() +
        (typeof el.className === "string" && el.className
          ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".")
          : ""),
      colour: style.color,
      fg,
      fontSize: Math.round(size),
      large: size >= 24 || (size >= 18.66 && weight >= 700),
      text: (el.textContent ?? "").trim().slice(0, 50),
      page: {
        x: Math.round(rect.x + window.scrollX),
        y: Math.round(rect.y + window.scrollY),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
    })
  }
  return found
}

async function measurePixelContrast(page, reporter) {
  const targets = await page.evaluate(FIND_INDETERMINATE)
  const results = []

  for (const target of targets) {
    // Hide only this element's own text, leaving every layer behind it intact.
    await page.evaluate((index) => {
      const el = document.querySelector(`[data-qa-contrast="${index}"]`)
      if (!el) return
      el.dataset.qaPrevColor = el.style.color
      el.style.setProperty("color", "transparent", "important")
      el.style.setProperty("text-shadow", "none", "important")
    }, target.index)

    let shot = null
    try {
      // An ELEMENT screenshot, not a clipped page screenshot. `clip` on a
      // viewport screenshot is measured against the viewport, so every target
      // below the fold came back "clipped area outside the resulting image" —
      // 30 of 34 samples silently skipped. The locator scrolls the element in
      // and captures its own box, which is the box we want anyway.
      shot = await page.locator(`[data-qa-contrast="${target.index}"]`).screenshot({ animations: "disabled", timeout: 10_000 })
    } catch (error) {
      reporter.note(`contrast sample skipped (${target.selector}): ${String(error).split("\n")[0].slice(0, 100)}`)
    }

    await page.evaluate((index) => {
      const el = document.querySelector(`[data-qa-contrast="${index}"]`)
      if (!el) return
      el.style.removeProperty("color")
      el.style.removeProperty("text-shadow")
      if (el.dataset.qaPrevColor) el.style.color = el.dataset.qaPrevColor
      delete el.dataset.qaPrevColor
    }, target.index)

    if (shot === null) continue

    let image
    try {
      image = decodePng(shot)
    } catch (error) {
      reporter.note(`PNG decode failed for ${target.selector}: ${String(error).slice(0, 80)}`)
      continue
    }

    const fgL = relativeLuminance(target.fg.r, target.fg.g, target.fg.b)
    let worst = Infinity
    let worstPixel = null
    const { width, height, channels, pixels } = image
    // Sample the middle of the box, not its border.
    //
    // A word-split heading puts each word in its own inline-block, and the
    // NEIGHBOURING word's glyph bleeds a pixel or two into this box. Taking the
    // absolute darkest pixel across the whole box read that stray glyph as the
    // background and reported near-black text on near-black — 1.07:1 on a 30px
    // heading that is, in fact, dark text on pale blue. Glyphs sit in the middle
    // band, so that is where "what is behind the text" actually is.
    const insetX = Math.max(2, Math.round(width * 0.15))
    const insetY = Math.max(2, Math.round(height * 0.15))
    const x0 = width > insetX * 2 ? insetX : 0
    const x1 = width > insetX * 2 ? width - insetX : width
    const y0 = height > insetY * 2 ? insetY : 0
    const y1 = height > insetY * 2 ? height - insetY : height
    // Every pixel in that region, not a corner sample: the failing end of a
    // gradient is usually a band, and a corner sample walks straight past it.
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = (y * width + x) * channels
        const value = contrastOf(fgL, relativeLuminance(pixels[i], pixels[i + 1], pixels[i + 2]))
        if (value < worst) {
          worst = value
          worstPixel = { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2] }
        }
      }
    }
    if (worstPixel === null) continue

    const required = target.large ? 3 : 4.5
    results.push({
      selector: target.selector,
      colour: target.colour,
      fontSize: target.fontSize,
      text: target.text,
      required,
      ratio: Number(worst.toFixed(2)),
      worstBackground: `rgb(${worstPixel.r}, ${worstPixel.g}, ${worstPixel.b})`,
      pixelsSampled: (x1 - x0) * (y1 - y0),
      pass: worst + 0.01 >= required,
    })
  }

  await page.evaluate(() => {
    for (const el of document.querySelectorAll("[data-qa-contrast]")) el.removeAttribute("data-qa-contrast")
  })
  return results
}

async function main() {
  const reporter = createReporter("layout-audit")
  const dir = resultDir("layout")
  const shotDir = join(dir, "violations")
  mkdirSync(shotDir, { recursive: true })

  reporter.section(`layout-audit — ${WIDTHS.length} widths × ${LOCALES.length} locales × ${THEMES.length} themes`)
  const spots = reportBlindSpots(reporter, BLIND_SPOTS)

  const server = startServer(PORT)
  let browser
  let executablePath
  const violations = []
  const pixelContrast = []
  const themeResolution = {}
  let shots = 0
  const startedAt = Date.now()

  try {
    await server.ready()
    ;({ browser, executablePath } = await launchBrowser({ headed: HEADED }))
    reporter.section("Matrix")
    console.log(`  chromium: ${executablePath}`)

    const widths = ONLY_WIDTH ? [Number(ONLY_WIDTH)] : WIDTHS
    const locales = ONLY_LOCALE ? [ONLY_LOCALE] : LOCALES
    const routes = publicRoutes()
    let loads = 0

    for (const theme of THEMES) {
      const context = await browser.newContext({ colorScheme: theme })
      await applyTheme(context, theme)
      const page = await context.newPage()
      let themeChecked = false

      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 })

        for (const locale of locales) {
          for (const route of routes) {
            const url = urlFor(server.base, locale, route)
            let result
            try {
              const response = await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 })
              loads += 1
              if (response !== null && response.status() >= 400) {
                reporter.check(`${locale}${route.path || "/"} @${width} ${theme}`, false,
                  `HTTP ${response.status()}`)
                continue
              }
              await preparePage(page)

              // Did the page render in the theme we asked for? `forcedTheme` in
              // the provider overrides storage, class and preference silently,
              // so without this the harness reports 96 "dark" cells that were
              // light — an unaudited theme, presented as a green tick.
              if (!themeChecked) {
                themeChecked = true
                const actual = await resolveTheme(page)
                themeResolution[theme] = actual
                if (actual.resolved !== theme) {
                  reporter.check(
                    `theme "${theme}" actually renders as "${theme}"`,
                    false,
                    `rendered "${actual.resolved}" (html class "${actual.htmlClass}", body ${actual.background}) — ` +
                      `every "${theme}" row below is really "${actual.resolved}"`,
                  )
                  violations.push({
                    kind: "theme-not-applied",
                    theme,
                    renderedAs: actual.resolved,
                    htmlClass: actual.htmlClass,
                    background: actual.background,
                    width,
                    locale,
                    route: route.name,
                    detail:
                      "The harness asked for this theme and the app rendered another. " +
                      "Every result for this theme describes the rendered one instead.",
                  })
                }
              }

              result = await page.evaluate(AUDIT)
            } catch (error) {
              reporter.check(`${locale}${route.path || "/"} @${width} ${theme}`, false,
                String(error).slice(0, 110))
              continue
            }

            const kinds = [
              ["overflow", result.overflow],
              ["clipping", result.clipping],
              ["overlap", result.overlap],
              ["tap-target", result.tapTargets],
              ["contrast", result.contrast],
              ["truncation", result.truncation],
            ]

            let found = 0
            const pageRecords = []
            for (const [kind, entries] of kinds) {
              for (const entry of entries) {
                found += 1
                const record = { kind, width, theme, locale, route: route.name, ...entry }
                violations.push(record)
                pageRecords.push(record)
                reporter.finding(record)
              }
            }
            // ---- annotated evidence -------------------------------------
            //
            // One full-page screenshot per violating page, with every offending
            // element outlined, rather than a crop per finding. The first
            // version cropped with `clip`, which is in PAGE coordinates while
            // getBoundingClientRect() is VIEWPORT-relative — every capture
            // silently threw and the run reported "0 screenshots" beside 106
            // findings. A whole page with the culprits marked is also simply
            // more useful: a 40px crop of an overhanging cell tells you nothing
            // about what pushed it there.
            if (found > 0 && shots < MAX_SHOTS) {
              const name = `${route.name}-${locale}-${width}-${theme}.png`
              try {
                await page.addStyleTag({
                  content: `[data-qa-violation] {
                    outline: 3px solid #e11d48 !important;
                    outline-offset: 1px !important;
                  }`,
                })
                await page.screenshot({ path: join(shotDir, name), fullPage: true })
                for (const record of pageRecords) record.screenshot = `violations/${name}`
                shots += 1
              } catch (error) {
                reporter.note(`screenshot failed for ${name}: ${String(error).slice(0, 80)}`)
              }
            }

            // Indeterminate contrast is reported, never counted as a pass.
            for (const entry of result.contrastIndeterminate) {
              violations.push({ kind: "contrast-indeterminate", width, theme, locale, route: route.name, ...entry })
            }

            reporter.check(
              `${locale}${route.path || "/"} @${width} ${theme}`,
              found === 0,
              found === 0 ? "" : `${found} violation(s)`,
            )
          }
        }
      }
      await context.close()
    }

    // ---- Phase 2 — contrast against gradients, from rendered pixels --------
    reporter.section(`Contrast over gradients — pixel-sampled at ${PIXEL_CONTRAST_WIDTH}px`)
    console.log(
      `  The sampled pass can only read a solid background-color, so everything on a\n` +
        `  gradient came back indeterminate. These are measured from the rendered page.`,
    )
    for (const theme of THEMES) {
      const context = await browser.newContext({ colorScheme: theme })
      await applyTheme(context, theme)
      const page = await context.newPage()
      await page.setViewportSize({ width: PIXEL_CONTRAST_WIDTH, height: 900 })
      for (const route of routes) {
        await page.goto(urlFor(server.base, PIXEL_CONTRAST_LOCALE, route), { waitUntil: "load", timeout: 60_000 })
        await preparePage(page)
        const measured = await measurePixelContrast(page, reporter)
        pixelContrast.push(
          ...measured.map((m) => ({ ...m, theme, locale: PIXEL_CONTRAST_LOCALE, route: route.name, width: PIXEL_CONTRAST_WIDTH })),
        )
        const failed = measured.filter((m) => !m.pass)
        reporter.check(
          `${route.name} ${theme} — ${measured.length} gradient-backed text style(s)`,
          failed.length === 0,
          failed.length === 0
            ? measured.length === 0
              ? "none found"
              : `worst ${Math.min(...measured.map((m) => m.ratio)).toFixed(2)}:1`
            : `${failed.length} below threshold`,
        )
        for (const f of failed) {
          const record = {
            kind: "contrast",
            width: PIXEL_CONTRAST_WIDTH,
            theme,
            locale: PIXEL_CONTRAST_LOCALE,
            route: route.name,
            selector: f.selector,
            ratio: f.ratio,
            required: f.required,
            colour: f.colour,
            background: f.worstBackground,
            fontSize: f.fontSize,
            text: f.text,
            measuredFrom: "rendered pixels",
          }
          violations.push(record)
          reporter.finding(record)
        }
      }
      await context.close()
    }

    reporter.section("Summary by kind")
    const byKind = {}
    for (const v of violations) byKind[v.kind] = (byKind[v.kind] ?? 0) + 1
    if (Object.keys(byKind).length === 0) console.log("  no violations")
    for (const [kind, count] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(4)}  ${kind}`)
    }

    const runtimeMs = Date.now() - startedAt
    const report = {
      harness: "layout-audit",
      generatedAt: new Date().toISOString(),
      chromium: executablePath,
      matrix: { widths, locales, themes: THEMES, routes: routes.map((r) => r.name) },
      pageLoads: loads,
      runtimeMs,
      blindSpots: spots,
      themeResolution,
      counts: { ...byKind, total: violations.length },
      pixelContrast: {
        width: PIXEL_CONTRAST_WIDTH,
        locale: PIXEL_CONTRAST_LOCALE,
        measured: pixelContrast.length,
        failed: pixelContrast.filter((m) => !m.pass).length,
        samples: pixelContrast,
      },
      violations,
    }
    const path = writeJson(dir, "report.json", report)
    console.log(`\n  report:      ${path}`)
    console.log(`  screenshots: ${shots} in ${shotDir}`)
    console.log(
      `  contrast:    ${pixelContrast.length} gradient-backed styles measured from pixels, ` +
        `${pixelContrast.filter((m) => !m.pass).length} below threshold`,
    )
    console.log(`  page loads:  ${loads} in ${(runtimeMs / 1000).toFixed(1)}s`)
  } finally {
    if (browser) await browser.close()
    server.stop()
  }

  process.exit(reporter.summary())
}

main().catch((error) => {
  console.error(`\nlayout-audit failed to run: ${error?.stack ?? error}`)
  process.exit(2)
})
