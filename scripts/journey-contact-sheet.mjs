/**
 * A contact sheet of everything the journey will show.        Owner: W-CINEMA
 *
 * 889 assets cannot be reviewed by eye, so `publish-journey-media.mjs` selects
 * mechanically. But the 26 it selects absolutely can be, and must be: the four
 * "real Azura World" videos turned out to include Batman, Superman and Captain
 * America statues (third-party character IP), a Google Earth screen capture,
 * and two carrying burnt-in Russian sales banners. A rules-only pipeline would
 * have shipped all four onto a client demo.
 *
 * One sheet, one screenshot, one look. `azura-ui-ux` and the Ataberg README say
 * the same thing: look at the page.
 *
 * Run: `node scripts/journey-contact-sheet.mjs`
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const APP = join(ROOT, "apps", "web")
const OUT = join(ROOT, "quality", "cinema")
mkdirSync(OUT, { recursive: true })

const src = readFileSync(join(APP, "lib", "journey-media.ts"), "utf8")
const images = [
  ...src.matchAll(
    /"id": "([^"]+)",\s*\n\s*"act": "(\w+)",\s*\n\s*"width": (\d+)[\s\S]*?"publisher": "((?:[^"\\]|\\.)*)"/g
  ),
].map((m) => ({ id: m[1], act: m[2], width: Number(m[3]), publisher: m[4] }))

const byAct = {}
for (const image of images) (byAct[image.act] ??= []).push(image)

const html = `<!doctype html><meta charset="utf-8">
<style>
  body { background:#0d1418; color:#e8f2f6; font:13px/1.4 system-ui, sans-serif; margin:0; padding:24px; }
  h2 { font-size:12px; letter-spacing:.14em; text-transform:uppercase; color:#7fb6cc; margin:26px 0 10px; }
  .grid { display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; }
  figure { margin:0; }
  img { width:100%; aspect-ratio:16/10; object-fit:cover; border-radius:6px; display:block; background:#16232a; }
  figcaption { margin-top:5px; font-size:10px; color:#8fa8b4; word-break:break-all; }
</style>
${Object.entries(byAct)
  .map(
    ([act, list]) => `<h2>${act} &middot; ${list.length}</h2><div class="grid">${list
      .map(
        (i) =>
          `<figure><img src="/media/${i.id}-800.webp" alt=""><figcaption>${i.width}px &middot; ${i.publisher}</figcaption></figure>`
      )
      .join("")}</div>`
  )
  .join("")}
`
writeFileSync(join(APP, "public", "contact-sheet.html"), html, "utf8")

// ---- screenshot it ---------------------------------------------------------
const req = createRequire(join(APP, "package.json"))
const { chromium } = req("@playwright/test")
async function launch() {
  try {
    return await chromium.launch({ headless: true })
  } catch {
    const root = join(process.env.LOCALAPPDATA ?? "", "ms-playwright")
    const c = readdirSync(root)
      .filter((n) => /^chromium-\d+$/.test(n))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))[0]
    const exe = [
      join(root, c, "chrome-win64", "chrome.exe"),
      join(root, c, "chrome-win", "chrome.exe"),
    ].find((p) => existsSync(p))
    return chromium.launch({ headless: true, executablePath: exe })
  }
}

const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
// Served straight off the filesystem: the sheet only needs the copied files, and
// booting Next for a contact sheet is a minute this does not need to spend.
await page.goto(
  `file:///${join(APP, "public", "contact-sheet.html").replace(/\\/g, "/")}`.replace(
    "file:////",
    "file:///"
  )
)
await page.addStyleTag({
  content: `img { }`,
})
// Rewrite /media/… to the real on-disk folder for the file:// context.
await page.evaluate((base) => {
  for (const img of document.querySelectorAll("img")) {
    img.src = base + img.getAttribute("src")
  }
}, `file:///${join(APP, "public").replace(/\\/g, "/")}`.replace("file:////", "file:///"))
await page.waitForTimeout(2500)
await page.screenshot({ path: join(OUT, "contact-sheet.png"), fullPage: true })
await browser.close()
console.log(`wrote ${join(OUT, "contact-sheet.png")} (${images.length} images)`)
