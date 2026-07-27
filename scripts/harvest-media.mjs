#!/usr/bin/env node
/**
 * W0-D — media harvest for Azura World (INTERNAL-107).
 *
 * Playwright-driven discovery + byte-validated download of every image, floor
 * plan, render, brochure and video reference the 23 registered sources expose.
 *
 * THE RULE THIS SCRIPT EXISTS TO ENFORCE
 * ──────────────────────────────────────
 * Ataberg's first harvest pass checked HTTP status codes and kept the body
 * regardless, so 51 of 154 "downloaded" photos were 404 HTML pages wearing a
 * .jpg extension and 5 were HEIC that sharp could not decode.
 * *Validate the bytes, not the status line.* Every candidate here must survive:
 *   1. a magic-byte sniff (HTML/JSON/empty bodies are rejected by shape),
 *   2. a real sharp decode (or a %PDF header for documents),
 *   3. a 10KB floor and a 200px long-edge floor,
 * and every rejection is recorded with its reason. Nothing is silently skipped.
 *
 * POLITENESS — SHARED WITH W0-B
 * ─────────────────────────────
 * Reads the same env vars W0-B reads (HARVEST_USER_AGENT, HARVEST_MIN_DELAY_MS,
 * HARVEST_MAX_CONCURRENCY, HARVEST_ALLOW_INVALID_TLS) and additionally takes a
 * cross-process per-host lease under HARVEST_LOCK_DIR, so a W0-B harvest running
 * in another window cannot hit the same host at the same time as this one.
 * See MEDIA-LICENSE.md §6 and HANDOFF/W0-D.md for the lease protocol.
 *
 * VIDEO — reference, do not rehost
 * ────────────────────────────────
 * Video is recorded as URL + platform + duration + poster frame. Downloading a
 * competitor's promotional video is the highest-risk action in this task and is
 * off by default. MEDIA_ALLOW_VIDEO_DOWNLOAD=true is required to change that,
 * and MEDIA-LICENSE.md records the decision.
 *
 * Usage:
 *   node scripts/harvest-media.mjs                 # discover + download + dedupe
 *   node scripts/harvest-media.mjs --discover-only  # discovery pass, no downloads
 *   node scripts/harvest-media.mjs --download-only  # re-run download from discovery/
 *   node scripts/harvest-media.mjs --only=alanya-home.com,housearch.com
 *   node scripts/harvest-media.mjs --selftest       # prove the byte validator rejects
 *
 * Outputs (all under sources/media/, git-ignored — see HANDOFF request to W0-A):
 *   discovery/<host>.json      per-host discovery result
 *   raw/<host>/<sha>.<ext>     the exact bytes downloaded (hash-verifiable)
 *   originals/<id>.<ext>       working original, capped at 2400px long edge
 *   harvest-report.json        every attempt, with status and rejection reason
 *   assets.json                deduped survivors — input to encode-images.mjs
 */

import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO = path.resolve(HERE, '..')

// ── directories ──────────────────────────────────────────────────────────────
export const DIR = {
  media: path.join(REPO, 'sources', 'media'),
  discovery: path.join(REPO, 'sources', 'media', 'discovery'),
  recon: path.join(REPO, 'sources', 'media', 'recon'),
  raw: path.join(REPO, 'sources', 'media', 'raw'),
  originals: path.join(REPO, 'sources', 'media', 'originals'),
  encoded: path.join(REPO, 'sources', 'media', 'encoded'),
  publicMedia: path.join(REPO, 'apps', 'web', 'public', 'media'),
  lib: path.join(REPO, 'apps', 'web', 'lib'),
}

// ── env ──────────────────────────────────────────────────────────────────────
/** Minimal .env reader — no dotenv dependency, because W0-A owns package.json. */
function readEnvFile(file) {
  if (!existsSync(file)) return {}
  const out = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let v = m[2].replace(/\s+#.*$/, '').trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[m[1]] = v
  }
  return out
}

const fileEnv = { ...readEnvFile(path.join(REPO, '.env.example')), ...readEnvFile(path.join(REPO, '.env.local')) }
const env = (k, d) => process.env[k] ?? fileEnv[k] ?? d

export const CFG = {
  userAgent: env(
    'HARVEST_USER_AGENT',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  ),
  minDelayMs: Number(env('HARVEST_MIN_DELAY_MS', '2000')),
  maxConcurrency: Math.max(1, Number(env('HARVEST_MAX_CONCURRENCY', '3'))),
  allowInvalidTls: env('HARVEST_ALLOW_INVALID_TLS', 'false') === 'true',
  lockDir: path.resolve(REPO, env('HARVEST_LOCK_DIR', '.tmp/harvest-locks')),
  allowVideoDownload: env('MEDIA_ALLOW_VIDEO_DOWNLOAD', 'false') === 'true',
  /** Fallback module roots — W0-A has not installed node_modules yet. */
  depRoots: env('MEDIA_DEP_ROOTS', 'D:/Ataberg/node_modules/;D:/Real Estate CRM/New Level Premium/node_modules/')
    .split(';')
    .filter(Boolean),
  navTimeoutMs: Number(env('MEDIA_NAV_TIMEOUT_MS', '45000')),
  maxPagesPerHost: Number(env('MEDIA_MAX_PAGES_PER_HOST', '12')),
}

// Validation floors — from the brief.
export const MIN_BYTES = 10 * 1024
export const MIN_LONG_EDGE = 200
export const ORIGINAL_CAP_PX = 2400
/** dHash Hamming distance at or below which two images are the same render. */
export const PHASH_MAX_DISTANCE = 6

// ── dependency loading (works before and after W0-A's pnpm install) ───────────
const localRequire = createRequire(import.meta.url)
const depCache = new Map()
export function loadDep(name) {
  if (depCache.has(name)) return depCache.get(name)
  const tried = []
  const attempt = (req, where) => {
    try {
      const m = req(name)
      const resolved = m?.default ?? m
      depCache.set(name, resolved)
      return resolved
    } catch (e) {
      tried.push(`${where}: ${e.code ?? e.message}`)
      return null
    }
  }
  let m = attempt(localRequire, 'in-tree')
  if (m) return m
  for (const root of CFG.depRoots) {
    m = attempt(createRequire(root.endsWith('/') ? root : root + '/'), root)
    if (m) return m
  }
  throw new Error(
    `Cannot load "${name}". W0-A owns pnpm install; until it lands this script resolves ` +
      `dependencies out-of-tree via MEDIA_DEP_ROOTS.\n  ${tried.join('\n  ')}`,
  )
}

// ── source register — mirrors SOURCES.md §1 ──────────────────────────────────
/**
 * `pages` are the entry points to render. Discovery follows same-host links that
 * look like galleries or plans; it does not crawl the whole site.
 * TERRA's path is the corrected one from SOURCES.md §5.3, not the ticket's.
 */
export const SOURCES = [
  { id: 1, host: 'www.azuraworld.com', publisher: 'Azura World (official)', tier: 1,
    pages: ['https://www.azuraworld.com/'] },
  { id: 2, host: 'www.cebecigroup.com', publisher: 'Cebeci Group', tier: 2,
    pages: ['https://www.cebecigroup.com/en/project/azura-world-residence-hotel'] },
  { id: 3, host: 'www.cebecigroup.com', publisher: 'Cebeci Group (index)', tier: 2,
    pages: ['https://www.cebecigroup.com/en/projects'] },
  { id: 4, host: 'www.alanyacebeci.com', publisher: 'Cebeci Alanya', tier: 2,
    pages: ['https://www.alanyacebeci.com/en/azura-world-residence-hotel'] },
  { id: 5, host: 'azuraworldhotel.com', publisher: 'Azura World Hotel', tier: 3,
    pages: ['https://azuraworldhotel.com/en'], tlsSuspect: true },
  { id: 6, host: 'terrarealestate.com', publisher: 'TERRA Real Estate', tier: 4,
    pages: ['https://terrarealestate.com/project/azura-world-residence-and-villas'] },
  { id: 7, host: 'alanya-home.com', publisher: 'Alanya-Home', tier: 4,
    pages: ['https://alanya-home.com/property/466/de/azura-world-residence'] },
  { id: 8, host: 'housearch.com', publisher: 'Housearch', tier: 4,
    pages: ['https://housearch.com/de/turkey/residential-complexes/azura-world-3403639/'] },
  { id: 9, host: 'hasporealty.com', publisher: 'Haspo Realty', tier: 4,
    pages: ['https://hasporealty.com/de/complex/azura-world/'], stale: true },
  { id: 10, host: 'www.seaside-alanya.com', publisher: 'Seaside Alanya', tier: 4,
    pages: ['https://www.seaside-alanya.com/de/antalya-alanya/residence/azura-world-residence'] },
  { id: 11, host: 'www.realtygroup.com.tr', publisher: 'Realty Group', tier: 4,
    pages: ['https://www.realtygroup.com.tr/property/alanya/turkler/azura-world-rg-6005'] },
  { id: 12, host: 'ivm-turkey.com', publisher: 'IVM Turkey', tier: 4,
    pages: ['https://ivm-turkey.com/en/azura-world-residence-a-2767-1.html'] },
  { id: 13, host: 'www.tripadvisor.com', publisher: 'Tripadvisor', tier: 5,
    pages: ['https://www.tripadvisor.com/Hotel_Review-g8752132-d33176030-Reviews-Azura_World_Hotel-Turkler_Alanya_Antalya_Province_Turkish_Mediterranean_Coast.html'],
    userGeneratedContent: true },
  { id: 14, host: 'wyndham.antalyacoast.com', publisher: 'Wyndham Alanya (superseded brand)', tier: 5,
    pages: ['https://wyndham.antalyacoast.com/en/'] },
  { id: 15, host: 'www.facebook.com', publisher: 'Facebook / Instagram', tier: 2,
    pages: ['https://www.facebook.com/azuraworldhotel', 'https://www.instagram.com/cebeci.group'],
    socialPublicOnly: true },
  { id: 16, host: 'enspride.com', publisher: 'ENS Pride', tier: 6,
    pages: ['https://enspride.com/property/azura-world-residence-hotel-a-new-iconic-lifestyle-concept-in-alanya/'] },
  { id: 17, host: 'www.booking.com', publisher: 'Booking.com', tier: 5,
    pages: ['https://www.booking.com/hotel/tr/azura-world.html'] },
  { id: 18, host: 'www.agoda.com', publisher: 'Agoda', tier: 5,
    pages: ['https://www.agoda.com/azura-world-hotel-ex-wyndham-alanya/hotel/alanya-tr.html'] },
  { id: 19, host: 'www.onthebeach.co.uk', publisher: 'OnTheBeach', tier: 5,
    pages: ['https://www.onthebeach.co.uk/hotels/turkey/antalya/alanya/azura-world-hotel'] },
  { id: 20, host: 'kalinka-realty.com', publisher: 'Kalinka Realty', tier: 6,
    pages: ['https://kalinka-realty.com/zarubezh/zhilye-kompleksy/azura-world-residence-hotel/'] },
  { id: 21, host: 'www.cestate.net', publisher: 'Capital Estate', tier: 6,
    pages: ['https://www.cestate.net/building/AzuraWorld'] },
  { id: 22, host: 'alanyhome.com', publisher: '7AlanyHome', tier: 6,
    pages: ['https://alanyhome.com/property/azura-world-alanya/'] },
  { id: 23, host: 'www.turizmguncel.com', publisher: 'Turizm Güncel', tier: 6,
    pages: ['https://www.turizmguncel.com/haber/ahmet-cebeci-wyndham-markasini-alanyaya-getiriyor'] },
]

// ── politeness: cross-process host lease + min delay + robots ────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Atomic cross-process lease on a host. mkdir is atomic on NTFS, so whichever
 * process creates the directory owns the host. W0-B running in another window
 * takes the same lease, which is what stops both windows hammering one host.
 * A lease older than staleMs is reclaimed — a crashed harvest must not wedge a host.
 */
export async function withHostLease(host, fn, { staleMs = 120_000 } = {}) {
  mkdirSync(CFG.lockDir, { recursive: true })
  const lock = path.join(CFG.lockDir, `${host.replace(/[^a-z0-9.-]/gi, '_')}.lock`)
  const hitFile = path.join(CFG.lockDir, `${host.replace(/[^a-z0-9.-]/gi, '_')}.lasthit`)
  for (let i = 0; ; i++) {
    try {
      mkdirSync(lock) // throws EEXIST if another process holds it
      break
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      let age = Infinity
      try {
        age = Date.now() - (await stat(lock)).mtimeMs
      } catch {
        continue
      }
      if (age > staleMs) {
        try {
          rmSync(lock, { recursive: true, force: true })
        } catch {}
        continue
      }
      if (i === 0) console.log(`   waiting for host lease on ${host} (held elsewhere, age ${(age / 1000) | 0}s)`)
      await sleep(1000)
    }
  }
  try {
    writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, task: 'W0-D', at: new Date().toISOString() }))
  } catch {}
  try {
    return await fn({
      /** Honour HARVEST_MIN_DELAY_MS *across processes* via a shared timestamp file. */
      async pace() {
        let last = 0
        try {
          last = Number(readFileSync(hitFile, 'utf8')) || 0
        } catch {}
        const wait = CFG.minDelayMs - (Date.now() - last)
        if (wait > 0) await sleep(wait)
        try {
          writeFileSync(hitFile, String(Date.now()))
        } catch {}
      },
    })
  } finally {
    try {
      rmSync(lock, { recursive: true, force: true })
    } catch {}
  }
}

/** robots.txt: group by user-agent, longest-match Allow/Disallow, Crawl-delay. */
export function parseRobots(txt) {
  const groups = []
  let cur = null
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const i = line.indexOf(':')
    if (i < 0) continue
    const key = line.slice(0, i).trim().toLowerCase()
    const val = line.slice(i + 1).trim()
    if (key === 'user-agent') {
      if (!cur || cur.rules.length || cur.crawlDelay != null) {
        cur = { agents: [], rules: [], crawlDelay: null }
        groups.push(cur)
      }
      cur.agents.push(val.toLowerCase())
    } else if (cur && (key === 'allow' || key === 'disallow')) {
      cur.rules.push({ allow: key === 'allow', pathPrefix: val })
    } else if (cur && key === 'crawl-delay') {
      cur.crawlDelay = Number(val)
    }
  }
  return groups
}

/**
 * Compile a robots path pattern. `*` is a wildcard and a trailing `$` anchors the
 * end of the path; every other regex metacharacter — including `?`, which is an
 * ordinary URL character here — must be escaped. Escaping the `$` along with the
 * rest silently turns "Disallow: /*.pdf$" into "a path containing a literal $",
 * which matches nothing and quietly grants access the site refused.
 */
export function robotsPatternToRegex(pattern) {
  let p = pattern
  let anchorEnd = false
  if (p.endsWith('$')) {
    anchorEnd = true
    p = p.slice(0, -1)
  }
  const escaped = p.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp('^' + escaped + (anchorEnd ? '$' : ''))
}

export function robotsVerdict(groups, urlPath) {
  const star = groups.filter((g) => g.agents.includes('*'))
  const rules = star.flatMap((g) => g.rules)
  const crawlDelay = star.map((g) => g.crawlDelay).find((d) => d != null) ?? null
  let best = null
  for (const r of rules) {
    if (r.pathPrefix === '' && !r.allow) continue // "Disallow:" empty means allow all
    if (!robotsPatternToRegex(r.pathPrefix).test(urlPath)) continue
    // Longest match wins; on an equal-length tie, Allow wins (REP convention).
    if (!best || r.pathPrefix.length > best.pathPrefix.length || (r.pathPrefix.length === best.pathPrefix.length && r.allow)) best = r
  }
  return { allowed: best ? best.allow : true, matched: best?.pathPrefix ?? null, crawlDelay }
}

const robotsCache = new Map()
export async function getRobots(origin, pace) {
  if (robotsCache.has(origin)) return robotsCache.get(origin)
  let result = { status: 0, groups: [], text: '', error: null }
  try {
    if (pace) await pace()
    const r = await fetch(new URL('/robots.txt', origin), { headers: { 'user-agent': CFG.userAgent }, redirect: 'follow' })
    const text = r.status === 200 ? await r.text() : ''
    result = { status: r.status, groups: text ? parseRobots(text) : [], text, error: null }
  } catch (e) {
    result = { status: 0, groups: [], text: '', error: String(e.cause?.code ?? e.message) }
  }
  robotsCache.set(origin, result)
  return result
}

// ── byte validation — the heart of this script ───────────────────────────────
/**
 * Magic-byte sniff. Deliberately independent of any library: a 404 HTML page
 * served as .jpg is caught here, before sharp is ever asked.
 * Returns { kind, format } where kind is 'image' | 'pdf' | 'svg' | 'html' |
 * 'heic' | 'video' | 'empty' | 'unknown'.
 */
export function sniff(buf) {
  if (!buf || buf.length === 0) return { kind: 'empty', format: null }
  const hex = buf.subarray(0, 16).toString('hex')
  const head = buf.subarray(0, Math.min(buf.length, 1024)).toString('latin1')

  if (hex.startsWith('ffd8ff')) return { kind: 'image', format: 'jpeg' }
  if (hex.startsWith('89504e470d0a1a0a')) return { kind: 'image', format: 'png' }
  if (hex.startsWith('47494638')) return { kind: 'image', format: 'gif' }
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP')
    return { kind: 'image', format: 'webp' }
  if (hex.startsWith('49492a00') || hex.startsWith('4d4d002a')) return { kind: 'image', format: 'tiff' }
  if (hex.startsWith('424d')) return { kind: 'image', format: 'bmp' }
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return { kind: 'pdf', format: 'pdf' }

  // ISO-BMFF family: AVIF is decodable by sharp; HEIC (HEVC) is not, because the
  // prebuilt libheif ships AV1 only. Ataberg lost 5 photos to exactly this — so
  // it is detected and REPORTED, never silently dropped.
  if (buf.length > 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('latin1')
    const compat = buf.subarray(8, Math.min(buf.length, 64)).toString('latin1')
    if (/^(avif|avis)/.test(brand) || /avif/.test(compat)) return { kind: 'image', format: 'avif' }
    if (/^(heic|heix|hevc|hevx|mif1|msf1)/.test(brand)) return { kind: 'heic', format: brand }
    if (/^(isom|mp4|M4V|qt|iso2|avc1)/.test(brand)) return { kind: 'video', format: brand }
    return { kind: 'unknown', format: `ftyp:${brand}` }
  }

  const trimmed = head.replace(/^\uFEFF/, '').trimStart().toLowerCase()
  if (trimmed.startsWith('<svg') || (trimmed.startsWith('<?xml') && trimmed.includes('<svg')))
    return { kind: 'svg', format: 'svg' }
  if (trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html') || trimmed.startsWith('<head') || /<meta|<title|<body/.test(trimmed))
    return { kind: 'html', format: null }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return { kind: 'json', format: null }
  return { kind: 'unknown', format: null }
}

/** Heuristic EXIF-GPS presence: the GPS IFD pointer tag is 0x8825. `[I]` heuristic. */
export function looksLikeExifGps(exifBuf) {
  if (!exifBuf || exifBuf.length < 8) return false
  const be = exifBuf.includes(Buffer.from([0x88, 0x25]))
  const le = exifBuf.includes(Buffer.from([0x25, 0x88]))
  return be || le
}

/**
 * Full validation of a downloaded body. Returns a verdict object; `ok:false`
 * always carries a machine-readable `reason` so the manifest can report it.
 */
export async function validateBytes(buf, { url, expectDocument = false } = {}) {
  const sha256 = createHash('sha256').update(buf).digest('hex')
  const base = { sha256, bytes: buf.length, url }
  const s = sniff(buf)

  if (s.kind === 'empty') return { ...base, ok: false, reason: 'empty_body', sniff: s }
  if (s.kind === 'html') return { ...base, ok: false, reason: 'soft_404_or_bot_wall_html', sniff: s }
  if (s.kind === 'json') return { ...base, ok: false, reason: 'json_error_body', sniff: s }
  if (s.kind === 'heic')
    return { ...base, ok: false, reason: `heic_not_decodable(${s.format})`, sniff: s, reportable: true }
  if (s.kind === 'video') return { ...base, ok: false, reason: 'video_body_not_image', sniff: s }

  if (s.kind === 'pdf') {
    // A PDF is a legitimate floor-plan/brochure carrier. sharp cannot decode it;
    // the header + a page-object check is the honest bar we can actually meet.
    const hasPages = buf.includes(Buffer.from('/Page'))
    if (buf.length < MIN_BYTES) return { ...base, ok: false, reason: `pdf_below_${MIN_BYTES}_bytes`, sniff: s }
    if (!hasPages) return { ...base, ok: false, reason: 'pdf_header_without_page_objects', sniff: s }
    return { ...base, ok: true, kind: 'pdf', format: 'pdf', width: null, height: null, sniff: s, hadExifGps: false }
  }

  if (buf.length < MIN_BYTES) return { ...base, ok: false, reason: `below_${MIN_BYTES}_bytes`, sniff: s }

  if (s.kind === 'svg') {
    // Vector logos are legitimate but have no raster dimensions to floor-check.
    return { ...base, ok: true, kind: 'svg', format: 'svg', width: null, height: null, sniff: s, hadExifGps: false }
  }

  if (s.kind !== 'image') return { ...base, ok: false, reason: `unrecognised_bytes(${s.format ?? 'none'})`, sniff: s }
  if (expectDocument) return { ...base, ok: false, reason: 'expected_document_got_image', sniff: s }

  const sharp = loadDep('sharp')
  let meta
  try {
    meta = await sharp(buf).metadata()
  } catch (e) {
    return { ...base, ok: false, reason: `sharp_header_unreadable: ${String(e.message).split('\n')[0]}`, sniff: s }
  }
  if (!meta.width || !meta.height) return { ...base, ok: false, reason: 'decoded_without_dimensions', sniff: s }
  const longEdge = Math.max(meta.width, meta.height)
  if (longEdge < MIN_LONG_EDGE)
    return { ...base, ok: false, reason: `below_${MIN_LONG_EDGE}px_long_edge(${meta.width}x${meta.height})`, sniff: s }

  // metadata() only parses the header — a JPEG truncated at 30% still reports
  // 1200x800 and would pass. Ataberg's validator used metadata() alone, so it
  // would have kept corrupt bodies as well as 404 pages. Force a real pixel
  // decode (sharp's default failOn:'warning' aborts on truncated data) and pay
  // the CPU once, at harvest time, to know the pixels are actually there.
  try {
    await sharp(buf).resize(32, 32, { fit: 'inside' }).raw().toBuffer()
  } catch (e) {
    return { ...base, ok: false, reason: `pixel_decode_failed: ${String(e.message).split('\n')[0].slice(0, 120)}`, sniff: s, width: meta.width, height: meta.height }
  }

  return {
    ...base,
    ok: true,
    kind: 'image',
    format: meta.format,
    width: meta.width,
    height: meta.height,
    hasAlpha: Boolean(meta.hasAlpha),
    hadExifGps: looksLikeExifGps(meta.exif),
    sniff: s,
  }
}

/** 64-bit dHash for perceptual dedupe: 9x8 grayscale, compare horizontal neighbours. */
export async function dHash(buf) {
  const sharp = loadDep('sharp')
  const px = await sharp(buf).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer()
  let bits = ''
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? '1' : '0'
  return BigInt('0b' + bits).toString(16).padStart(16, '0')
}

export function hamming(a, b) {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b)
  let n = 0
  while (x) {
    n += Number(x & 1n)
    x >>= 1n
  }
  return n
}

// ── classification ───────────────────────────────────────────────────────────
const RX = {
  siteplan: /(site[-_\s]?plan|master[-_\s]?plan|masterplan|vaziyet|genplan|генплан|situationsplan|lageplan|site[-_\s]?layout)/i,
  floorplan: /(floor[-_\s]?plan|floorplan|grundriss|grundrisse|kat[-_\s]?plan|planlar|planировк|планировк|apartment[-_\s]?plan|unit[-_\s]?plan|\bplans?\b|layout)/i,
  logo: /(logo|brand[-_\s]?mark|favicon|apple-touch|wordmark)/i,
  render: /(render|rendering|3d|visual|görsel|gorsel|proje[-_\s]?görsel)/i,
  brochure: /(brochure|broschur|broschüre|katalog|catalog|prospekt|price[-_\s]?list|pdf)/i,
  hotel: /(hotel|room|zimmer|oda|suite|lobby|restaurant|bar|spa|breakfast|buffet|reception)/i,
  amenity: /(pool|aquapark|aqua[-_\s]?park|slide|water[-_\s]?slide|gym|fitness|sauna|hamam|tennis|playground|kids|cinema|garden|landscape)/i,
  unit: /(apartment|daire|wohnung|interior|kitchen|k[üu]che|mutfak|bathroom|bad|banyo|bedroom|schlafzimmer|salon|living|1\+1|2\+1|3\+1|4\+1|5\+1|6\+1|penthouse|villa|townhouse)/i,
  location: /(alanya|t[üu]rkler|beach|strand|sea|meer|deniz|castle|kale|map|karte|harita|location|umgebung)/i,
  developer: /(cebeci|developer|bauträger|firma|about|hakkinda)/i,
}

export function classify({ url, alt = '', caption = '', hintCategory, hintSubject }) {
  const hay = `${decodeURIComponent(url)} ${alt} ${caption}`
  const isPdf = /\.pdf(\?|$)/i.test(url)

  let category = hintCategory && hintCategory !== 'photo' ? hintCategory : null
  if (!category) {
    if (RX.siteplan.test(hay)) category = 'siteplan'
    else if (RX.floorplan.test(hay)) category = 'floorplan'
    else if (isPdf) category = 'document'
    else if (RX.logo.test(hay)) category = 'logo'
    else if (RX.render.test(hay)) category = 'render'
    else category = 'photo'
  }
  // A PDF that names a plan is a plan, not a generic document.
  if (isPdf && category === 'document' && RX.siteplan.test(hay)) category = 'siteplan'
  if (isPdf && category === 'document' && RX.floorplan.test(hay)) category = 'floorplan'

  let subject = hintSubject ?? null
  if (!subject) {
    if (category === 'logo') subject = RX.developer.test(hay) ? 'developer' : 'project'
    else if (RX.unit.test(hay)) subject = 'unit'
    else if (RX.amenity.test(hay)) subject = 'amenity'
    else if (RX.hotel.test(hay)) subject = 'hotel'
    else if (RX.location.test(hay)) subject = 'location'
    else subject = 'project'
  }
  return { category, subject }
}

// ── rights engine ────────────────────────────────────────────────────────────
/**
 * `sources/media/rights-policy.json` is a HAND-AUTHORED decision record, not a
 * generated file. It is the machine-readable form of MEDIA-LICENSE.md: per-host
 * terms evidence plus the usage decision that follows from it. Generated files
 * in this repo must never be hand-edited; this one is the reverse — it is input,
 * and the generators read it.
 *
 * If the file is missing, every asset resolves to `internal_only`. Fail-safe by
 * construction: an absent rights decision must never permit publication.
 */
export async function loadRightsPolicy() {
  const file = path.join(DIR.media, 'rights-policy.json')
  if (!existsSync(file)) {
    return {
      source: 'MISSING — every asset defaults to internal_only',
      default: { usage: 'internal_only', reason: 'no rights-policy.json present; publication requires a recorded decision' },
      categoryFloors: {},
      hosts: {},
    }
  }
  const doc = JSON.parse(await readFile(file, 'utf8'))
  return { source: path.relative(REPO, file).replace(/\\/g, '/'), ...doc }
}

/** Only `attributed_display` may be published. `unknown` renders internally, like `internal_only`. */
const RESTRICTIVENESS = { attributed_display: 0, unknown: 1, internal_only: 2 }

/**
 * The most restrictive of: the host decision, the category floor, the global
 * default, and the per-asset overrides (UGC and watermarked material never
 * become publishable by a host-level rule).
 */
export function resolveUsage(asset, policy) {
  const candidates = []
  const def = policy.default ?? { usage: 'internal_only', reason: 'implicit default' }
  candidates.push({ usage: def.usage, reason: `default: ${def.reason}` })

  const floor = policy.categoryFloors?.[asset.category]
  if (floor) candidates.push({ usage: typeof floor === 'string' ? floor : floor.usage, reason: `category floor for "${asset.category}": ${typeof floor === 'string' ? 'set in rights-policy.json' : floor.reason}` })

  const host = policy.hosts?.[asset.sourceHost] ?? policy.hosts?.[asset.sourceHost?.replace(/^www\./, '')]
  if (host) candidates.push({ usage: host.usage, reason: `host ${asset.sourceHost}: ${host.reasoning ?? 'per rights-policy.json'}` })
  else candidates.push({ usage: 'unknown', reason: `host ${asset.sourceHost} has no entry in rights-policy.json` })

  if (asset.userGeneratedContent)
    candidates.push({ usage: 'internal_only', reason: 'user-generated content — rights held by the individual traveller, not the publisher' })
  if (asset.tlsInvalid)
    candidates.push({ usage: 'internal_only', reason: 'retrieved over an invalid TLS chain — provenance not cleanly established' })

  const worst = candidates.reduce((a, b) => (RESTRICTIVENESS[b.usage] > RESTRICTIVENESS[a.usage] ? b : a))
  return { usage: worst.usage, reason: worst.reason, considered: candidates }
}

// ── URL helpers ──────────────────────────────────────────────────────────────
/** Largest candidate in a srcset, by width descriptor then by density. */
export function largestFromSrcset(srcset) {
  if (!srcset) return null
  const parts = srcset
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [u, d] = s.split(/\s+/)
      const w = d && /^\d+w$/.test(d) ? parseInt(d) : d && /^[\d.]+x$/.test(d) ? parseFloat(d) * 1000 : 0
      return { url: u, w }
    })
    .filter((p) => p.url)
  if (!parts.length) return null
  return parts.sort((a, b) => b.w - a.w)[0].url
}

/**
 * Candidate "original" URLs for a resized CDN URL. Tries, in order:
 * strip query size params, drop a WordPress -WxH suffix, drop known
 * thumbnail/cache path segments. The caller probes each and records which won.
 */
export function originalCandidates(url) {
  const out = []
  const push = (u) => {
    if (u && u !== url && !out.includes(u)) out.push(u)
  }
  try {
    const u = new URL(url)
    if (u.search) {
      const stripped = new URL(url)
      for (const k of ['w', 'h', 'width', 'height', 'size', 'resize', 'fit', 'q', 'quality', 'ca', 'ce', 's']) stripped.searchParams.delete(k)
      push(stripped.toString().replace(/\?$/, ''))
      const bare = new URL(url)
      bare.search = ''
      push(bare.toString())
    }
    push(url.replace(/-\d{2,4}x\d{2,4}(\.[a-z]{3,4})(\?|$)/i, '$1$2'))
    push(url.replace(/\/(thumbs?|thumbnail|thumbnails|small|medium|resize[d]?|cache|crop|preview)\//i, '/'))
    push(url.replace(/\/max\d+x\d+\//i, '/original/'))
    push(url.replace(/\/(square|max)\d+(x\d+)?\//i, '/max1920x1080/'))
    push(url.replace(/_(thumb|small|medium|s|m)(\.[a-z]{3,4})(\?|$)/i, '$2$3'))
  } catch {}
  return out
}

const extFor = (format) =>
  ({ jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', avif: 'avif', tiff: 'tif', bmp: 'bmp', svg: 'svg', pdf: 'pdf' })[format] ?? 'bin'

// ── discovery (Playwright) ───────────────────────────────────────────────────
/** In-page collector. Runs in the browser; returns raw candidates, no judgement. */
const COLLECT_IN_PAGE = `() => {
  const abs = (u) => { try { return new URL(u, location.href).toString() } catch { return null } };
  const out = [];
  const add = (url, discovery, el) => {
    const a = abs(url); if (!a || a.startsWith('data:') || a.startsWith('blob:')) return;
    out.push({ url: a, discovery,
      alt: el?.getAttribute?.('alt') || '',
      title: el?.getAttribute?.('title') || '',
      caption: (el?.closest?.('figure')?.querySelector?.('figcaption')?.textContent || '').trim().slice(0, 200) });
  };
  for (const img of document.querySelectorAll('img')) {
    const ss = img.getAttribute('srcset') || img.getAttribute('data-srcset');
    if (ss) add(ss.split(',').map(s=>s.trim()).map(s=>{const [u,d]=s.split(/\\s+/);return {u,w:d&&/^\\d+w$/.test(d)?parseInt(d):0}}).sort((a,b)=>b.w-a.w)[0]?.u, 'srcset', img);
    for (const attr of ['src','data-src','data-original','data-lazy','data-lazy-src','data-full','data-large','data-image','data-bg','data-zoom-image','data-href']) {
      const v = img.getAttribute(attr); if (v) add(v, attr === 'src' ? 'img' : 'lazy-attr', img);
    }
  }
  for (const s of document.querySelectorAll('source')) {
    const ss = s.getAttribute('srcset') || s.getAttribute('data-srcset');
    if (ss) add(ss.split(',').map(x=>x.trim()).map(x=>{const [u,d]=x.split(/\\s+/);return {u,w:d&&/^\\d+w$/.test(d)?parseInt(d):0}}).sort((a,b)=>b.w-a.w)[0]?.u, 'srcset', s);
    const sv = s.getAttribute('src'); if (sv) add(sv, 'source', s);
  }
  // CSS background images — many hero renders are never in an <img>.
  for (const el of document.querySelectorAll('*')) {
    let bg = '';
    try { bg = getComputedStyle(el).backgroundImage } catch { continue }
    if (!bg || bg === 'none') continue;
    for (const m of bg.matchAll(/url\\((['"]?)(.*?)\\1\\)/g)) add(m[2], 'css-background', el);
  }
  for (const sel of ['meta[property="og:image"]','meta[property="og:image:secure_url"]','meta[name="twitter:image"]','link[rel*="icon"]','link[rel="apple-touch-icon"]']) {
    for (const m of document.querySelectorAll(sel)) add(m.getAttribute('content') || m.getAttribute('href'), sel.startsWith('link') ? 'icon' : 'og-image', m);
  }
  for (const sc of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const walk = (v) => {
        if (typeof v === 'string') { if (/^https?:\\/\\/.+\\.(jpe?g|png|webp|avif|gif|pdf)/i.test(v)) add(v, 'json-ld', null) }
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') { for (const k of Object.keys(v)) if (/image|photo|logo|contentUrl|thumbnailUrl/i.test(k) || typeof v[k] === 'object') walk(v[k]) }
      };
      walk(JSON.parse(sc.textContent));
    } catch {}
  }
  for (const a of document.querySelectorAll('a[href]')) {
    const h = a.getAttribute('href') || '';
    if (/\\.(pdf|jpe?g|png|webp|avif|tiff?)(\\?|$)/i.test(h)) {
      const abs2 = abs(h); if (abs2) out.push({ url: abs2, discovery: /\\.pdf(\\?|$)/i.test(h) ? 'anchor-pdf' : 'anchor-image', alt: (a.textContent||'').trim().slice(0,120), title: a.getAttribute('title')||'', caption: '' });
    }
  }
  const videos = [];
  for (const f of document.querySelectorAll('iframe[src], iframe[data-src]')) {
    const src = f.getAttribute('src') || f.getAttribute('data-src') || '';
    if (/youtube|youtu\\.be|vimeo|dailymotion|kuula|matterport/i.test(src)) videos.push({ embedUrl: abs(src), kind: 'iframe' });
  }
  for (const v of document.querySelectorAll('video')) {
    videos.push({ embedUrl: abs(v.getAttribute('src') || v.querySelector('source')?.getAttribute('src') || ''), poster: abs(v.getAttribute('poster') || ''), kind: 'video-tag',
      durationSec: Number.isFinite(v.duration) ? Math.round(v.duration) : null });
  }
  for (const m of document.querySelectorAll('meta[property="og:video"],meta[property="og:video:url"],meta[property="og:video:duration"]')) {
    videos.push({ embedUrl: m.getAttribute('content'), kind: 'og-video' });
  }
  return { candidates: out, videos, title: document.title,
    bodyText: (document.body?.innerText || '').slice(0, 4000),
    linkCount: document.querySelectorAll('a[href]').length };
}`

const GALLERY_TRIGGERS = [
  'text=/show all photos/i',
  'text=/alle fotos/i',
  'text=/all photos/i',
  'text=/gallery/i',
  'text=/galerie/i',
  'text=/galeri/i',
  'text=/grundriss/i',
  'text=/floor plan/i',
  'text=/kat plan/i',
  '[class*="gallery"] button',
  '[class*="lightbox"]',
]

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let y = 0
      const step = 600
      const t = setInterval(() => {
        window.scrollBy(0, step)
        y += step
        if (y >= document.body.scrollHeight + 2000 || y > 40000) {
          clearInterval(t)
          resolve()
        }
      }, 180)
    })
    window.scrollTo(0, 0)
  })
}

/** Discover one source's media candidates. Returns a discovery record. */
export async function discoverSource(src, pace) {
  const record = {
    sourceId: src.id,
    host: src.host,
    publisher: src.publisher,
    tier: src.tier,
    discoveredAt: new Date().toISOString(),
    robots: null,
    pages: [],
    candidates: [],
    videos: [],
    zeroYieldReason: null,
    notes: [],
  }

  const origin = new URL(src.pages[0]).origin
  const robots = await getRobots(origin, pace)
  record.robots = { status: robots.status, error: robots.error, crawlDelay: null, directiveCount: robots.groups.length }

  const pw = loadDep('playwright')
  let browser
  try {
    browser = await pw.chromium.launch({ headless: true })
  } catch (e) {
    record.zeroYieldReason = `browser_launch_failed: ${e.message}`
    return record
  }
  const ctx = await browser.newContext({
    userAgent: CFG.userAgent,
    ignoreHTTPSErrors: src.tlsSuspect ? CFG.allowInvalidTls : false,
    locale: 'de-DE',
    viewport: { width: 1440, height: 900 },
  })

  try {
    for (const url of src.pages.slice(0, CFG.maxPagesPerHost)) {
      const u = new URL(url)
      const verdict = robotsVerdict(robots.groups, u.pathname)
      if (robots.status === 200 && !verdict.allowed) {
        record.pages.push({ url, status: 'robots_disallow', matched: verdict.matched, assetCount: 0 })
        record.notes.push(`robots.txt disallows ${u.pathname} (rule "${verdict.matched}") — not fetched`)
        continue
      }
      if (verdict.crawlDelay) record.robots.crawlDelay = verdict.crawlDelay

      await pace()
      if (verdict.crawlDelay && verdict.crawlDelay * 1000 > CFG.minDelayMs) await sleep(verdict.crawlDelay * 1000 - CFG.minDelayMs)

      const page = await ctx.newPage()
      /** Network sniffing catches lazy-loaded assets a DOM scrape never sees. */
      const fromNetwork = new Map()
      page.on('response', (res) => {
        try {
          const ct = (res.headers()['content-type'] || '').toLowerCase()
          if (/^(image\/|application\/pdf)/.test(ct) && !res.url().startsWith('data:'))
            fromNetwork.set(res.url(), { status: res.status(), contentType: ct, contentLength: Number(res.headers()['content-length'] || 0) })
        } catch {}
      })

      let nav = null
      let navError = null
      try {
        nav = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CFG.navTimeoutMs })
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
        await autoScroll(page)
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
        for (const sel of GALLERY_TRIGGERS) {
          try {
            const el = page.locator(sel).first()
            if (await el.isVisible({ timeout: 400 })) {
              await el.click({ timeout: 2000, noWaitAfter: true })
              await page.waitForTimeout(1500)
              await autoScroll(page)
            }
          } catch {}
        }
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
      } catch (e) {
        navError = String(e.message).split('\n')[0]
      }

      let dom = { candidates: [], videos: [], title: '', bodyText: '', linkCount: 0 }
      try {
        dom = await page.evaluate(COLLECT_IN_PAGE)
      } catch (e) {
        record.notes.push(`in-page collection failed on ${url}: ${String(e.message).split('\n')[0]}`)
      }

      const status = nav ? nav.status() : navError ? `error: ${navError}` : 'no_response'
      /** Bot wall / soft 404 detection at page level. */
      const wall = /just a moment|enable javascript and cookies|access denied|are you a robot|cf-browser-verification|verifying you are human/i.test(dom.bodyText)
      const soft404 = /(^|\s)(404|not found|sayfa bulunamad|seite nicht gefunden)(\s|$)/i.test(dom.title)

      const merged = new Map()
      for (const c of dom.candidates) if (c.url) merged.set(c.url, { ...c, fromNetwork: false })
      for (const [nu, meta] of fromNetwork) {
        if (merged.has(nu)) merged.get(nu).networkMeta = meta
        else merged.set(nu, { url: nu, discovery: 'network', alt: '', title: '', caption: '', fromNetwork: true, networkMeta: meta })
      }

      const pageCandidates = []
      for (const c of merged.values()) {
        if (/^data:|^blob:/.test(c.url)) continue
        const { category, subject } = classify({ url: c.url, alt: c.alt, caption: `${c.title} ${c.caption}` })
        pageCandidates.push({
          url: c.url,
          foundOn: url,
          discovery: c.discovery,
          category,
          subject,
          alt: c.alt || null,
          caption: c.caption || c.title || null,
          networkContentType: c.networkMeta?.contentType ?? null,
          networkContentLength: c.networkMeta?.contentLength ?? null,
        })
      }

      record.pages.push({
        url,
        status,
        title: dom.title,
        botWall: wall,
        soft404,
        assetCount: pageCandidates.length,
        networkImages: fromNetwork.size,
      })
      if (wall) record.notes.push(`bot wall detected on ${url} — candidates from this page are unreliable`)
      record.candidates.push(...pageCandidates)
      for (const v of dom.videos) if (v.embedUrl) record.videos.push({ ...v, foundOn: url })

      await page.close()
    }
  } finally {
    await ctx.close().catch(() => {})
    await browser.close().catch(() => {})
  }

  if (!record.candidates.length) {
    const p = record.pages[0]
    record.zeroYieldReason =
      p?.status === 'robots_disallow'
        ? 'robots_disallow'
        : p?.botWall
          ? 'bot_wall'
          : typeof p?.status === 'number' && p.status >= 400
            ? `http_${p.status}`
            : typeof p?.status === 'string' && p.status.startsWith('error')
              ? p.status
              : 'no_media_on_page'
  }
  return record
}

// ── seed candidates from the recon subagents ─────────────────────────────────
/**
 * The recon fan-out (one subagent per source-host group) probed each host and
 * returned verified candidate URLs. Those files are copied into
 * sources/media/recon/ as evidence and merged in here, so a re-run reproduces
 * the same input set without re-running the agents.
 */
export async function reconPagesByHost() {
  const byHost = new Map()
  if (!existsSync(DIR.recon)) return byHost
  for (const f of await readdir(DIR.recon)) {
    if (!f.endsWith('.json')) continue
    let doc
    try {
      doc = JSON.parse(await readFile(path.join(DIR.recon, f), 'utf8'))
    } catch {
      continue
    }
    for (const host of doc.hosts ?? []) {
      for (const p of host.pages ?? []) {
        // Only pages the recon pass actually reached. A page it recorded as 403 or
        // robots-blocked is evidence, not a work item.
        if (!p.url || p.status !== 200) continue
        let h = host.host
        try {
          h = new URL(p.url).host
        } catch {}
        if (!byHost.has(h)) byHost.set(h, new Set())
        byHost.get(h).add(p.url)
      }
    }
  }
  return byHost
}

export async function loadReconSeeds() {
  const seeds = []
  if (!existsSync(DIR.recon)) return seeds
  for (const f of await readdir(DIR.recon)) {
    if (!f.endsWith('.json')) continue
    let doc
    try {
      doc = JSON.parse(await readFile(path.join(DIR.recon, f), 'utf8'))
    } catch (e) {
      console.error(`  ! recon file ${f} is not valid JSON: ${e.message}`)
      continue
    }
    for (const host of doc.hosts ?? []) {
      for (const a of host.assets ?? []) {
        if (!a.url) continue
        seeds.push({
          url: a.url,
          foundOn: a.foundOn || (host.pages?.[0]?.url ?? ''),
          discovery: `recon:${a.discovery ?? 'unknown'}`,
          category: a.category ?? null,
          subject: a.subject ?? null,
          alt: null,
          caption: a.captionText ?? null,
          host: host.host,
          sourceIds: host.sourceIds ?? [],
          needsReferer: Boolean(a.needsReferer),
          watermarked: Boolean(a.watermarked),
          userGeneratedContent: Boolean(a.userGeneratedContent),
          tlsInvalid: Boolean(a.tlsInvalid),
          reconAgent: doc.agent ?? f,
        })
      }
      for (const v of host.videos ?? []) {
        seeds.push({ __video: true, ...v, host: host.host, sourceIds: host.sourceIds ?? [], reconAgent: doc.agent ?? f })
      }
    }
  }
  return seeds
}

// ── download ─────────────────────────────────────────────────────────────────
async function fetchBytes(url, { referer, allowInvalidTls = false } = {}) {
  const headers = { 'user-agent': CFG.userAgent, accept: 'image/avif,image/webp,image/apng,image/*,application/pdf,*/*;q=0.8' }
  if (referer) headers.referer = referer
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED
  if (allowInvalidTls) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  try {
    const r = await fetch(url, { headers, redirect: 'follow' })
    const buf = Buffer.from(await r.arrayBuffer())
    return { status: r.status, contentType: r.headers.get('content-type'), buf, finalUrl: r.url }
  } catch (e) {
    return { status: 0, error: String(e.cause?.code ?? e.cause?.message ?? e.message), buf: Buffer.alloc(0) }
  } finally {
    if (allowInvalidTls) {
      if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev
    }
  }
}

/**
 * Download one candidate with the full validation ladder.
 *   1. try the original-upgrade candidates first (largest wins),
 *   2. then the discovered URL,
 *   3. on 403 without a Referer, retry with the source page as Referer —
 *      normal browser behaviour for hotlink protection, not a bypass.
 * Every attempt lands in `attempts` so the report can explain any rejection.
 */
export async function acquire(cand, pace) {
  const attempts = []
  const ordered = [...originalCandidates(cand.url).map((u) => ({ url: u, why: 'original-upgrade' })), { url: cand.url, why: 'as-discovered' }]
  let best = null

  for (const step of ordered) {
    await pace()
    let res = await fetchBytes(step.url, { allowInvalidTls: cand.tlsInvalid && CFG.allowInvalidTls })
    let usedReferer = false
    if (res.status === 403 && cand.foundOn) {
      await pace()
      res = await fetchBytes(step.url, { referer: cand.foundOn, allowInvalidTls: cand.tlsInvalid && CFG.allowInvalidTls })
      usedReferer = true
    }
    if (res.status !== 200) {
      attempts.push({ url: step.url, why: step.why, status: res.status, error: res.error ?? null, usedReferer, ok: false, reason: res.error ? `transport_${res.error}` : `http_${res.status}` })
      continue
    }
    const v = await validateBytes(res.buf, { url: step.url })
    attempts.push({
      url: step.url, why: step.why, status: 200, usedReferer, ok: v.ok,
      reason: v.ok ? null : v.reason, bytes: v.bytes, width: v.width ?? null, height: v.height ?? null,
      format: v.format ?? null, sniffKind: v.sniff?.kind ?? null, reportable: v.reportable ?? false,
    })
    if (!v.ok) continue
    const area = (v.width ?? 0) * (v.height ?? 0)
    const bestArea = (best?.width ?? 0) * (best?.height ?? 0)
    if (!best || area > bestArea || (area === bestArea && v.bytes > best.bytes)) best = { ...v, buf: res.buf, contentType: res.contentType, usedReferer, upgradedFrom: step.why === 'original-upgrade' ? cand.url : null }
    // An original-upgrade that decoded is already the best we will get.
    if (step.why === 'original-upgrade' && v.ok) break
  }

  return { candidate: cand, attempts, accepted: best }
}

// ── the run ──────────────────────────────────────────────────────────────────
function idFor(host, sha256, category) {
  const slug = host.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  return `${category}-${slug}-${sha256.slice(0, 10)}`
}

async function run() {
  const args = process.argv.slice(2)
  const flag = (n) => args.includes(`--${n}`)
  const val = (n, d) => {
    const a = args.find((x) => x.startsWith(`--${n}=`))
    return a ? a.split('=').slice(1).join('=') : d
  }
  const only = (val('only', '') || '').split(',').filter(Boolean)
  const maxPerSource = Number(val('max-per-source', '0')) || Infinity

  for (const d of [DIR.media, DIR.discovery, DIR.recon, DIR.raw, DIR.originals]) await mkdir(d, { recursive: true })

  console.log('W0-D media harvest')
  console.log(`  politeness   : ${CFG.minDelayMs}ms/host · ${CFG.maxConcurrency} hosts in flight · 1 request per host`)
  console.log(`  host leases  : ${path.relative(REPO, CFG.lockDir)} (shared with W0-B)`)
  console.log(`  invalid TLS  : ${CFG.allowInvalidTls ? 'ALLOWED (explicit opt-in)' : 'rejected'}`)
  console.log(`  video        : ${CFG.allowVideoDownload ? 'DOWNLOAD ENABLED' : 'reference only, no rehost'}`)

  if (flag('selftest')) return selftest()

  // ── discovery ─────────────────────────────────────────────────────────────
  let discoveries = []
  if (!flag('download-only')) {
    const byHost = new Map()
    for (const s of SOURCES) {
      if (only.length && !only.includes(s.host)) continue
      if (!byHost.has(s.host)) byHost.set(s.host, [])
      byHost.get(s.host).push(s)
    }
    // Fold in the page URLs the recon pass proved reachable — e.g. the working
    // cebecigroup.com project path, which the ticket's URL 500s on.
    const reconPages = await reconPagesByHost()
    let added = 0
    for (const [host, srcs] of byHost) {
      const extra = [...(reconPages.get(host) ?? [])].filter((u) => !srcs.some((s) => s.pages.includes(u)))
      if (extra.length && srcs[0]) {
        srcs[0].pages = [...srcs[0].pages, ...extra].slice(0, CFG.maxPagesPerHost)
        added += extra.length
      }
    }
    console.log(`\nDiscovery — ${byHost.size} hosts, ${[...byHost.values()].flat().length} source entries` + (added ? ` (+${added} pages from recon)` : ''))
    const hosts = [...byHost.entries()]
    let cursor = 0
    const workers = Array.from({ length: Math.min(CFG.maxConcurrency, hosts.length) }, async () => {
      while (cursor < hosts.length) {
        const [host, srcs] = hosts[cursor++]
        await withHostLease(host, async ({ pace }) => {
          for (const s of srcs) {
            const t = Date.now()
            let rec
            try {
              rec = await discoverSource(s, pace)
            } catch (e) {
              rec = { sourceId: s.id, host: s.host, publisher: s.publisher, tier: s.tier, discoveredAt: new Date().toISOString(), pages: [], candidates: [], videos: [], zeroYieldReason: `discovery_threw: ${String(e.message).split('\n')[0]}`, notes: [] }
            }
            discoveries.push(rec)
            await writeFile(path.join(DIR.discovery, `${String(s.id).padStart(2, '0')}-${s.host}.json`), JSON.stringify(rec, null, 2))
            console.log(`  [${String(s.id).padStart(2)}] ${s.host.padEnd(28)} ${String(rec.candidates.length).padStart(4)} candidates · ${rec.videos.length} video · ${((Date.now() - t) / 1000).toFixed(1)}s${rec.zeroYieldReason ? ` · ZERO: ${rec.zeroYieldReason}` : ''}`)
          }
        })
      }
    })
    await Promise.all(workers)
  } else {
    for (const f of await readdir(DIR.discovery)) if (f.endsWith('.json')) discoveries.push(JSON.parse(await readFile(path.join(DIR.discovery, f), 'utf8')))
    console.log(`\nLoaded ${discoveries.length} discovery records from disk`)
  }

  // ── merge with recon seeds ────────────────────────────────────────────────
  const seeds = await loadReconSeeds()
  console.log(`Recon seeds  : ${seeds.filter((s) => !s.__video).length} assets · ${seeds.filter((s) => s.__video).length} videos from ${DIR.recon.replace(REPO, '.')}`)

  const hostOf = (u) => {
    try {
      return new URL(u).host
    } catch {
      return 'unknown'
    }
  }
  const sourceByHost = new Map()
  for (const s of SOURCES) if (!sourceByHost.has(s.host)) sourceByHost.set(s.host, s)

  /** Candidate keyed by URL; `carriedBy` accumulates every page that served it. */
  const candidates = new Map()
  const addCandidate = (c, originHost) => {
    if (!c.url || /^data:|^blob:/.test(c.url)) return
    const key = c.url
    const prev = candidates.get(key)
    if (prev) {
      if (c.foundOn && !prev.carriedBy.includes(c.foundOn)) prev.carriedBy.push(c.foundOn)
      prev.discovery = [...new Set([...prev.discovery.split('+'), c.discovery])].join('+')
      prev.needsReferer = prev.needsReferer || Boolean(c.needsReferer)
      prev.watermarked = prev.watermarked || Boolean(c.watermarked)
      prev.userGeneratedContent = prev.userGeneratedContent || Boolean(c.userGeneratedContent)
      return
    }
    const h = originHost ?? hostOf(c.foundOn || c.url)
    candidates.set(key, {
      url: c.url,
      foundOn: c.foundOn || '',
      carriedBy: c.foundOn ? [c.foundOn] : [],
      discovery: c.discovery ?? 'unknown',
      sourceHost: h,
      alt: c.alt ?? null,
      caption: c.caption ?? null,
      needsReferer: Boolean(c.needsReferer),
      watermarked: Boolean(c.watermarked),
      userGeneratedContent: Boolean(c.userGeneratedContent),
      tlsInvalid: Boolean(c.tlsInvalid),
      ...classify({ url: c.url, alt: c.alt ?? '', caption: c.caption ?? '', hintCategory: c.category ?? undefined, hintSubject: c.subject ?? undefined }),
    })
  }

  const videoRefs = []
  for (const d of discoveries) {
    let n = 0
    for (const c of d.candidates) {
      if (n++ >= maxPerSource) break
      addCandidate(c, d.host)
    }
    for (const v of d.videos) videoRefs.push({ ...v, sourceHost: d.host, sourceId: d.sourceId, publisher: d.publisher, tier: d.tier })
  }
  for (const s of seeds) {
    if (s.__video) {
      videoRefs.push({ embedUrl: s.embedUrl, foundOn: s.pageUrl, platform: s.platform, videoId: s.videoId, durationSec: s.durationSec, poster: s.posterUrl, termsPermitRehost: s.termsPermitRehost, evidence: s.evidence, sourceHost: s.host, publisher: sourceByHost.get(s.host)?.publisher ?? s.host, tier: sourceByHost.get(s.host)?.tier ?? null, discovery: `recon:${s.reconAgent}` })
    } else addCandidate(s, s.host)
  }

  // Video: reference, do not rehost. The brief permits a POSTER FRAME, so the
  // platform's own thumbnail is acquired and validated like any other image and
  // filed under category "video" — one still standing in for the clip, with a
  // link out. The clip itself is never downloaded (MEDIA_ALLOW_VIDEO_DOWNLOAD).
  for (const v of videoRefs) {
    const yt = /(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([\w-]{11})/.exec(v.embedUrl ?? '')
    if (yt && !v.videoId) v.videoId = yt[1]
    if (yt && !v.poster) v.poster = `https://i.ytimg.com/vi/${yt[1]}/maxresdefault.jpg`
    if (!v.platform) v.platform = yt ? 'youtube' : /vimeo/.test(v.embedUrl ?? '') ? 'vimeo' : null
    if (v.poster) {
      addCandidate(
        { url: v.poster, foundOn: v.foundOn ?? '', discovery: 'video-poster', category: 'video', subject: 'project', caption: null },
        v.sourceHost,
      )
    }
  }
  if (CFG.allowVideoDownload) {
    console.log('  ! MEDIA_ALLOW_VIDEO_DOWNLOAD=true — video rehost is enabled; MEDIA-LICENSE.md must record why')
  }

  const all = [...candidates.values()].filter((c) => !only.length || only.includes(c.sourceHost))
  console.log(`\nCandidates   : ${all.length} unique URLs across ${new Set(all.map((c) => c.sourceHost)).size} hosts`)

  if (flag('discover-only')) {
    await writeFile(path.join(DIR.media, 'candidates.json'), JSON.stringify({ generatedAt: new Date().toISOString(), candidates: all, videoRefs }, null, 2))
    console.log('--discover-only: candidates.json written, no downloads performed')
    return
  }

  // ── download + validate ──────────────────────────────────────────────────
  console.log(`\nDownload + byte validation (${MIN_BYTES / 1024}KB floor · ${MIN_LONG_EDGE}px long-edge floor)`)
  const results = []
  const byHostQueue = new Map()
  for (const c of all) {
    if (!byHostQueue.has(c.sourceHost)) byHostQueue.set(c.sourceHost, [])
    byHostQueue.get(c.sourceHost).push(c)
  }
  const queues = [...byHostQueue.entries()]
  let qi = 0
  const dlWorkers = Array.from({ length: Math.min(CFG.maxConcurrency, queues.length) }, async () => {
    while (qi < queues.length) {
      const [host, list] = queues[qi++]
      await withHostLease(host, async ({ pace }) => {
        let ok = 0
        let bad = 0
        for (const cand of list) {
          const r = await acquire(cand, pace)
          results.push(r)
          if (r.accepted) ok++
          else bad++
        }
        console.log(`  ${host.padEnd(28)} accepted ${String(ok).padStart(4)} · rejected ${String(bad).padStart(4)}`)
      })
    }
  })
  await Promise.all(dlWorkers)

  // ── persist raw bytes + capped originals ─────────────────────────────────
  const sharp = loadDep('sharp')
  const accepted = []
  for (const r of results) {
    if (!r.accepted) continue
    const v = r.accepted
    const ext = extFor(v.format)
    const hostDir = path.join(DIR.raw, r.candidate.sourceHost.replace(/[^a-z0-9.-]/gi, '_'))
    await mkdir(hostDir, { recursive: true })
    const rawPath = path.join(hostDir, `${v.sha256.slice(0, 16)}.${ext}`)
    if (!existsSync(rawPath)) await writeFile(rawPath, v.buf)

    const id = idFor(r.candidate.sourceHost, v.sha256, r.candidate.category)
    let storedWidth = v.width
    let storedHeight = v.height
    let originalPath = null
    let phash = null

    if (v.kind === 'image') {
      const longEdge = Math.max(v.width, v.height)
      const capped = longEdge > ORIGINAL_CAP_PX
      originalPath = path.join(DIR.originals, `${id}.${capped ? 'jpg' : ext}`)
      if (capped) {
        // Cap the working original; the true source dimensions are recorded below.
        // .rotate() applies EXIF orientation before we drop metadata.
        const out = await sharp(v.buf).rotate().resize({ width: v.width >= v.height ? ORIGINAL_CAP_PX : null, height: v.height > v.width ? ORIGINAL_CAP_PX : null, withoutEnlargement: true }).jpeg({ quality: 92, mozjpeg: true }).toBuffer()
        await writeFile(originalPath, out)
        const m = await sharp(out).metadata()
        storedWidth = m.width
        storedHeight = m.height
      } else if (!existsSync(originalPath)) {
        await writeFile(originalPath, v.buf)
      }
      try {
        phash = await dHash(await readFile(originalPath))
      } catch (e) {
        r.attempts.push({ url: r.candidate.url, why: 'phash', ok: false, reason: `phash_failed: ${e.message}` })
      }
    } else {
      originalPath = path.join(DIR.originals, `${id}.${ext}`)
      if (!existsSync(originalPath)) await writeFile(originalPath, v.buf)
    }

    accepted.push({
      id,
      url: r.candidate.url,
      upgradedFrom: v.upgradedFrom,
      sourceHost: r.candidate.sourceHost,
      carriedBy: r.candidate.carriedBy.length ? r.candidate.carriedBy : [r.candidate.foundOn].filter(Boolean),
      discovery: r.candidate.discovery,
      category: r.candidate.category,
      subject: r.candidate.subject,
      alt: r.candidate.alt,
      caption: r.candidate.caption,
      kind: v.kind,
      format: v.format,
      bytes: v.bytes,
      sha256: v.sha256,
      width: storedWidth,
      height: storedHeight,
      sourceWidth: v.width,
      sourceHeight: v.height,
      capped: v.kind === 'image' && Math.max(v.width, v.height) > ORIGINAL_CAP_PX,
      hadExifGps: v.hadExifGps,
      usedReferer: v.usedReferer,
      watermarked: r.candidate.watermarked,
      userGeneratedContent: r.candidate.userGeneratedContent,
      tlsInvalid: r.candidate.tlsInvalid,
      phash,
      rawPath: path.relative(REPO, rawPath).replace(/\\/g, '/'),
      originalPath: path.relative(REPO, originalPath).replace(/\\/g, '/'),
      collectedAt: new Date().toISOString(),
    })
  }

  // ── perceptual dedupe ────────────────────────────────────────────────────
  // The same render appears on six portals at six sizes. Keep the highest
  // resolution; credit every source that carried it.
  const groups = []
  for (const a of accepted) {
    if (!a.phash) {
      // No perceptual hash (PDF/SVG) — dedupe by sha256 only.
      const g = groups.find((x) => !x.phash && x.members.some((m) => m.sha256 === a.sha256))
      if (g) g.members.push(a)
      else groups.push({ phash: null, members: [a] })
      continue
    }
    const g = groups.find((x) => x.phash && hamming(x.phash, a.phash) <= PHASH_MAX_DISTANCE)
    if (g) g.members.push(a)
    else groups.push({ phash: a.phash, members: [a] })
  }

  const unique = groups.map((g) => {
    const sorted = [...g.members].sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0) || b.bytes - a.bytes)
    const primary = sorted[0]
    const dupes = sorted.slice(1)
    return {
      ...primary,
      duplicateOf: null,
      duplicates: dupes.map((d) => ({ id: d.id, url: d.url, sourceHost: d.sourceHost, width: d.width, height: d.height, bytes: d.bytes, sha256: d.sha256, phashDistance: primary.phash && d.phash ? hamming(primary.phash, d.phash) : null })),
      carriedBy: [...new Set([...primary.carriedBy, ...dupes.flatMap((d) => d.carriedBy)])],
      carriedByHosts: [...new Set([primary.sourceHost, ...dupes.map((d) => d.sourceHost)])],
    }
  })

  // ── report ───────────────────────────────────────────────────────────────
  const rejections = results.filter((r) => !r.accepted)
  const reasonTally = {}
  for (const r of rejections) {
    const last = r.attempts.filter((a) => a.reason).pop()
    const key = last?.reason?.replace(/\(.*\)/, '(…)').replace(/: .*/, '') ?? 'no_attempt_recorded'
    reasonTally[key] = (reasonTally[key] ?? 0) + 1
  }

  const report = {
    generatedAt: new Date().toISOString(),
    generator: 'scripts/harvest-media.mjs',
    politeness: { minDelayMs: CFG.minDelayMs, maxConcurrency: CFG.maxConcurrency, onePerHost: true, lockDir: path.relative(REPO, CFG.lockDir).replace(/\\/g, '/'), userAgent: CFG.userAgent, allowInvalidTls: CFG.allowInvalidTls },
    validation: { minBytes: MIN_BYTES, minLongEdgePx: MIN_LONG_EDGE, phashMaxDistance: PHASH_MAX_DISTANCE, originalCapPx: ORIGINAL_CAP_PX },
    totals: { attempted: results.length, decoded: accepted.length, rejected: rejections.length, unique: unique.length, duplicatesFolded: accepted.length - unique.length, videoReferences: videoRefs.length },
    rejectionReasons: reasonTally,
    perHost: [...new Set(all.map((c) => c.sourceHost))].map((h) => ({
      host: h,
      candidates: all.filter((c) => c.sourceHost === h).length,
      accepted: accepted.filter((a) => a.sourceHost === h).length,
      unique: unique.filter((a) => a.sourceHost === h).length,
    })),
    zeroYield: discoveries.filter((d) => d.zeroYieldReason).map((d) => ({ sourceId: d.sourceId, host: d.host, publisher: d.publisher, tier: d.tier, reason: d.zeroYieldReason, pages: d.pages })),
    heicFindings: results.flatMap((r) => r.attempts.filter((a) => a.reportable).map((a) => ({ url: a.url, reason: a.reason }))),
    exifGpsFindings: accepted.filter((a) => a.hadExifGps).map((a) => ({ id: a.id, url: a.url })),
    attempts: results.map((r) => ({ url: r.candidate.url, host: r.candidate.sourceHost, foundOn: r.candidate.foundOn, category: r.candidate.category, accepted: Boolean(r.accepted), attempts: r.attempts })),
  }
  await writeFile(path.join(DIR.media, 'harvest-report.json'), JSON.stringify(report, null, 2))
  await writeFile(path.join(DIR.media, 'assets.json'), JSON.stringify({ generatedAt: report.generatedAt, generator: 'scripts/harvest-media.mjs', assets: unique, videoRefs }, null, 2))

  console.log(`\n── Validation table ──`)
  console.log(`  attempted : ${report.totals.attempted}`)
  console.log(`  decoded   : ${report.totals.decoded}`)
  console.log(`  rejected  : ${report.totals.rejected}`)
  for (const [k, v] of Object.entries(reasonTally).sort((a, b) => b[1] - a[1])) console.log(`      ${String(v).padStart(4)}  ${k}`)
  console.log(`\n── Dedupe ──`)
  console.log(`  unique ${report.totals.unique} of ${report.totals.decoded} decoded (${report.totals.duplicatesFolded} folded)`)
  console.log(`\n── By category ──`)
  const cats = {}
  for (const a of unique) cats[a.category] = (cats[a.category] ?? 0) + 1
  for (const [k, v] of Object.entries(cats).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(10)} ${v}`)
  if (report.zeroYield.length) {
    console.log(`\n── Zero-yield sources ──`)
    for (const z of report.zeroYield) console.log(`  [${String(z.sourceId).padStart(2)}] ${z.host.padEnd(28)} ${z.reason}`)
  }
  if (report.heicFindings.length) console.log(`\n  ! ${report.heicFindings.length} HEIC asset(s) detected and reported, not silently dropped`)
  if (report.exifGpsFindings.length) console.log(`  ! ${report.exifGpsFindings.length} asset(s) carry EXIF GPS — encode-images.mjs strips it`)
  console.log(`\n  videos referenced: ${videoRefs.length} (rehost ${CFG.allowVideoDownload ? 'ENABLED' : 'disabled'})`)
  console.log(`\nWrote sources/media/assets.json and sources/media/harvest-report.json`)
}

// ── selftest: prove the validator rejects a 404 page wearing .jpg ────────────
async function selftest() {
  console.log('\n── Byte-validation selftest (the Ataberg regression) ──\n')
  const sharp = loadDep('sharp')
  const cases = []

  // 1. A real remote 404 body requested with a .jpg extension.
  const url404 = 'https://www.azuraworld.com/this-does-not-exist-w0d-selftest.jpg'
  await sleep(CFG.minDelayMs)
  const remote = await fetchBytes(url404)
  cases.push({ name: 'live 404 page requested as .jpg', http: remote.status, contentType: remote.contentType, buf: remote.buf, url: url404 })

  // 2. A synthetic soft-404: HTTP 200 with an HTML body under a .jpg name.
  const soft = Buffer.from('<!DOCTYPE html><html><head><title>404 Not Found</title></head><body><h1>Not Found</h1>' + 'x'.repeat(20000) + '</body></html>', 'utf8')
  cases.push({ name: 'soft 404: HTTP 200, HTML body, .jpg name, >10KB', http: 200, contentType: 'image/jpeg', buf: soft, url: 'https://example.invalid/soft404.jpg' })

  // 3. A Cloudflare-style bot wall served as an image.
  const wall = Buffer.from('<html><head><title>Just a moment...</title></head><body>Enable JavaScript and cookies to continue' + 'y'.repeat(15000) + '</body></html>', 'utf8')
  cases.push({ name: 'bot wall served as .jpg', http: 200, contentType: 'image/jpeg', buf: wall, url: 'https://example.invalid/wall.jpg' })

  // 4. HEIC — the other half of the Ataberg loss (5 files). Synthesised ftyp box.
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypheic'), Buffer.from('mif1heicmsf1'), Buffer.alloc(MIN_BYTES + 100, 0x11)])
  heic.writeUInt32BE(0x20, 0)
  cases.push({ name: 'HEIC (HEVC) — sharp cannot decode', http: 200, contentType: 'image/heic', buf: heic, url: 'https://example.invalid/photo.heic' })

  // 5. A tracking pixel: a real, decodable image that is too small to be content.
  const pixel = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } }).png().toBuffer()
  cases.push({ name: 'tracking pixel 1x1 (decodes, but below floors)', http: 200, contentType: 'image/png', buf: pixel, url: 'https://example.invalid/px.png' })

  // 6. A thumbnail: decodable, over 10KB, but under the 200px long-edge floor.
  const thumb = await sharp({ create: { width: 160, height: 120, channels: 3, background: '#3355aa' } }).png({ compressionLevel: 0 }).toBuffer()
  cases.push({ name: 'thumbnail 160x120 (decodes, >10KB, under 200px)', http: 200, contentType: 'image/png', buf: thumb, url: 'https://example.invalid/thumb.png' })

  // 7/8 use a NOISE image, not a flat colour: a flat 900x600 JPEG compresses to
  // ~3.5KB and would trip the 10KB floor before the decoder is ever reached,
  // which would make the truncation and control cases prove nothing.
  const noise = Buffer.alloc(1200 * 800 * 3)
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) % 251
  const good = await sharp(noise, { raw: { width: 1200, height: 800, channels: 3 } }).jpeg({ quality: 92 }).toBuffer()

  // 7. A truncated JPEG — correct magic bytes, over the byte floor, corrupt payload.
  cases.push({ name: 'truncated JPEG (valid magic, >10KB, corrupt payload)', http: 200, contentType: 'image/jpeg', buf: good.subarray(0, Math.floor(good.length * 0.3)), url: 'https://example.invalid/trunc.jpg' })

  // 8. The control: a genuine 1200x800 JPEG that must be ACCEPTED.
  cases.push({ name: 'CONTROL: genuine 1200x800 JPEG', http: 200, contentType: 'image/jpeg', buf: good, url: 'https://example.invalid/real.jpg' })

  console.log(`${'case'.padEnd(48)} ${'http'.padEnd(5)} ${'bytes'.padStart(7)}  ${'sniff'.padEnd(8)} verdict`)
  console.log('─'.repeat(112))
  let pass = 0
  let fail = 0
  for (const c of cases) {
    const v = await validateBytes(c.buf, { url: c.url })
    const expectAccept = c.name.startsWith('CONTROL')
    const correct = v.ok === expectAccept
    if (correct) pass++
    else fail++
    console.log(
      `${c.name.slice(0, 47).padEnd(48)} ${String(c.http).padEnd(5)} ${String(c.buf.length).padStart(7)}  ${(v.sniff?.kind ?? '-').padEnd(8)} ` +
        `${v.ok ? `ACCEPT ${v.width}x${v.height}` : `REJECT ${v.reason}`}  ${correct ? 'as expected' : '*** WRONG ***'}`,
    )
  }
  console.log('─'.repeat(112))
  console.log(`${pass} of ${cases.length} cases behaved as expected, ${fail} wrong`)
  console.log(
    `\nAtaberg's number to beat: 51 of 154 "downloads" were 404 HTML pages wearing .jpg, plus 5 HEIC.\n` +
      `Cases 1-4 are exactly those two failure modes; both are rejected by shape before sharp is asked.`,
  )
  if (fail) process.exitCode = 1
}

// Only run when invoked directly — encode-images.mjs and media-manifest.mjs
// import the helpers above.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  run().catch((e) => {
    console.error('\nharvest-media.mjs failed:', e)
    process.exitCode = 1
  })
}
