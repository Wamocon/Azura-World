#!/usr/bin/env node
/**
 * W0-D — generate apps/web/lib/media-manifest.ts from the harvest outputs.
 *
 * Inputs  : sources/media/assets.json        (harvest-media.mjs)
 *           sources/media/encoded.json       (encode-images.mjs)
 *           apps/web/lib/lqip.json           (encode-images.mjs)
 *           sources/media/rights-policy.json (hand-authored decision record)
 * Output  : apps/web/lib/media-manifest.ts   (generated, never hand-edited)
 *
 * The manifest carries the same provenance discipline as the fact dataset: every
 * asset names every page that served it, with publisher, tier, fetch time and
 * content hash, and every asset carries the rights posture that decides whether
 * it may be displayed at all.
 *
 * Usage:
 *   node scripts/media-manifest.mjs
 *   node scripts/media-manifest.mjs --check   # verify the committed file is current
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DIR, REPO, SOURCES, loadRightsPolicy, resolveUsage } from './harvest-media.mjs'

const OUT = path.join(DIR.lib, 'media-manifest.ts')
const s = (v) => JSON.stringify(v ?? null)

/** Locale of the page an asset was found on, from its URL path. `[I]` inference. */
function localeOfPage(url) {
  const m = /^https?:\/\/[^/]+\/(de|en|tr|ru)(\/|$)/i.exec(url ?? '')
  if (m) return m[1].toLowerCase()
  if (/kalinka-realty|cestate\.net|\/zarubezh\//.test(url ?? '')) return 'ru'
  if (/\.com\.tr|turizmguncel/.test(url ?? '')) return 'tr'
  return null
}

function sourceRefsFor(asset) {
  const byHost = new Map()
  for (const s of SOURCES) if (!byHost.has(s.host)) byHost.set(s.host, s)
  const pages = asset.carriedBy?.length ? asset.carriedBy : [asset.url]
  const seen = new Set()
  const refs = []
  for (const page of pages) {
    if (!page || seen.has(page)) continue
    seen.add(page)
    let host = asset.sourceHost
    try {
      host = new URL(page).host
    } catch {}
    const src = byHost.get(host) ?? byHost.get(`www.${host}`) ?? byHost.get(host.replace(/^www\./, ''))
    refs.push({
      url: page,
      publisher: src?.publisher ?? host,
      fetchedAt: asset.collectedAt,
      // For media the asset bytes ARE the snapshot; the file lives at
      // sources/media/raw/<host>/<sha16>.<ext>. W0-B owns sources/raw/ for the
      // HTML snapshots behind the fact dataset — see HANDOFF/W0-D.md.
      snapshotHash: asset.sha256,
      tier: src?.tier ?? 6,
    })
  }
  return refs
}

function header(stats) {
  return `/**
 * GENERATED FILE — DO NOT HAND-EDIT.
 *
 * Generator : scripts/media-manifest.mjs  (W0-D, INTERNAL-107)
 * Inputs    : sources/media/assets.json · sources/media/encoded.json
 *             apps/web/lib/lqip.json · sources/media/rights-policy.json
 * Generated : ${stats.generatedAt}
 *
 * If a value in here is wrong, fix the harvester, the encoder or the rights
 * policy and re-run \`node scripts/media-manifest.mjs\`. Never edit this file.
 *
 * RIGHTS — these images are not ours.
 * They are a competitor's marketing material, collected for internal competitive
 * analysis under INTERNAL-107. \`usage\` decides where an asset may appear:
 *
 *   internal_only      ${String(stats.usage.internal_only ?? 0).padStart(4)}  authenticated dashboard only, never a public route
 *   unknown            ${String(stats.usage.unknown ?? 0).padStart(4)}  treated exactly like internal_only until decided
 *   attributed_display ${String(stats.usage.attributed_display ?? 0).padStart(4)}  publishable, and only with visible attribution
 *
 * \`delivery: "internal"\` assets are NOT in apps/web/public — their encoded
 * variants live in git-ignored sources/media/encoded/ and must be served through
 * an authenticated route. Rendering one from a public page is a rights breach.
 * The full decision record is MEDIA-LICENSE.md.
 */
`
}

async function build() {
  const assetsFile = path.join(DIR.media, 'assets.json')
  if (!existsSync(assetsFile)) throw new Error('sources/media/assets.json missing — run node scripts/harvest-media.mjs')
  const { assets, videoRefs } = JSON.parse(await readFile(assetsFile, 'utf8'))

  const encodedFile = path.join(DIR.media, 'encoded.json')
  const encodedById = new Map()
  if (existsSync(encodedFile)) {
    const doc = JSON.parse(await readFile(encodedFile, 'utf8'))
    for (const e of doc.encoded ?? []) encodedById.set(e.id, e)
  }

  const lqipFile = path.join(DIR.lib, 'lqip.json')
  const lqipById = existsSync(lqipFile) ? (JSON.parse(await readFile(lqipFile, 'utf8')).lqip ?? {}) : {}

  const policy = await loadRightsPolicy()

  const rows = []
  const usage = {}
  const byCategory = {}
  const bySubject = {}
  const skippedNoEncode = []

  for (const a of assets) {
    const enc = encodedById.get(a.id)
    const u = enc ? { usage: enc.usage, reason: enc.usageReason } : resolveUsage(a, policy)
    usage[u.usage] = (usage[u.usage] ?? 0) + 1
    byCategory[a.category] = (byCategory[a.category] ?? 0) + 1
    bySubject[a.subject] = (bySubject[a.subject] ?? 0) + 1
    if (!enc) skippedNoEncode.push({ id: a.id, kind: a.kind, category: a.category })

    rows.push({
      asset: a,
      encoded: enc ?? null,
      usage: u,
      lqip: lqipById[a.id] ?? null,
      refs: sourceRefsFor(a),
    })
  }

  const stats = {
    generatedAt: new Date().toISOString(),
    total: rows.length,
    usage,
    byCategory,
    bySubject,
    videoRefs: videoRefs?.length ?? 0,
    skippedNoEncode: skippedNoEncode.length,
  }

  const lines = []
  lines.push(header(stats))
  lines.push(`import type { Locale, SourceRef } from "./contracts"`)
  lines.push('')
  lines.push(`export const MEDIA_MANIFEST_GENERATED_AT = ${s(stats.generatedAt)} as const`)
  lines.push('')
  lines.push(`export type MediaCategory = "render" | "photo" | "floorplan" | "siteplan" | "logo" | "video" | "document"`)
  lines.push(`export type MediaSubject = "project" | "hotel" | "unit" | "amenity" | "location" | "developer"`)
  lines.push(`/** Rights posture — see MEDIA-LICENSE.md. Drives whether it may be displayed. */`)
  lines.push(`export type MediaUsage = "internal_only" | "attributed_display" | "unknown"`)
  lines.push('')
  lines.push(`export interface MediaAsset {`)
  lines.push(`  id: string`)
  lines.push(`  category: MediaCategory`)
  lines.push(`  subject: MediaSubject`)
  lines.push(`  /** Every page that carried this asset. Deduped renders credit all of them. */`)
  lines.push(`  sources: SourceRef[]`)
  lines.push(`  originalUrl: string`)
  lines.push(`  width: number`)
  lines.push(`  height: number`)
  lines.push(`  formats: { avif: string[]; webp: string[]; jpeg: string[] }`)
  lines.push(`  lqip: string`)
  lines.push(`  sha256: string`)
  lines.push(`  caption: Record<Locale, string> | null`)
  lines.push(`  /** Rights posture — see MEDIA-LICENSE.md. Drives whether it may be displayed. */`)
  lines.push(`  usage: MediaUsage`)
  lines.push('')
  lines.push(`  // ── W0-D additions to the brief's shape, all provenance or rights ──`)
  lines.push(`  /** Why \`usage\` resolved the way it did. Quoted in the dashboard's evidence panel. */`)
  lines.push(`  usageReason: string`)
  lines.push(`  /** "public" ⟹ served from /media/…. "internal" ⟹ git-ignored sources/media/encoded/…,`)
  lines.push(`   *  which MUST be served through an authenticated route, never a public page. */`)
  lines.push(`  delivery: "public" | "internal"`)
  lines.push(`  /** True source pixels when the stored original was capped at 2400px on the long edge. */`)
  lines.push(`  sourceDimensions: { width: number; height: number } | null`)
  lines.push(`  bytes: number`)
  lines.push(`  format: string`)
  lines.push(`  aspectRatio: number | null`)
  lines.push(`  /** Caption text as observed, in the source page's language. Untranslated — W1-C owns i18n. */`)
  lines.push(`  sourceCaption: { text: string; locale: Locale | null } | null`)
  lines.push(`  /** Watermark preserved. Removing it is both a rights and a provenance problem. */`)
  lines.push(`  watermarked: boolean`)
  lines.push(`  /** Traveller photos etc. — rights sit with the individual, not the publisher. */`)
  lines.push(`  userGeneratedContent: boolean`)
  lines.push(`  /** The listing that carried it is stale (SOURCES.md F-006). Label it in the UI. */`)
  lines.push(`  fromStaleListing: boolean`)
  lines.push(`  /** Same render found on other hosts at lower resolution; all credited in \`sources\`. */`)
  lines.push(`  duplicateSourceHosts: string[]`)
  lines.push(`  collectedAt: string`)
  lines.push(`}`)
  lines.push('')
  lines.push(`export interface MediaVideoRef {`)
  lines.push(`  id: string`)
  lines.push(`  /** Referenced, never rehosted — see MEDIA-LICENSE.md §4. */`)
  lines.push(`  embedUrl: string`)
  lines.push(`  platform: string`)
  lines.push(`  foundOn: string`)
  lines.push(`  publisher: string`)
  lines.push(`  durationSec: number | null`)
  lines.push(`  /** Poster frame URL on the platform's own CDN. Not rehosted either. */`)
  lines.push(`  posterUrl: string | null`)
  lines.push(`  rehosted: false`)
  lines.push(`  rehostRationale: string`)
  lines.push(`}`)
  lines.push('')

  const staleHosts = new Set(SOURCES.filter((x) => x.stale).map((x) => x.host))

  lines.push(`export const mediaAssets: MediaAsset[] = [`)
  for (const r of rows) {
    const a = r.asset
    const f = r.encoded?.formats ?? { avif: [], webp: [], jpeg: [] }
    lines.push(`  {`)
    lines.push(`    id: ${s(a.id)},`)
    lines.push(`    category: ${s(a.category)},`)
    lines.push(`    subject: ${s(a.subject)},`)
    lines.push(`    sources: [`)
    for (const ref of r.refs) {
      lines.push(
        `      { url: ${s(ref.url)}, publisher: ${s(ref.publisher)}, fetchedAt: ${s(ref.fetchedAt)}, snapshotHash: ${s(ref.snapshotHash)}, tier: ${ref.tier} },`,
      )
    }
    lines.push(`    ],`)
    lines.push(`    originalUrl: ${s(a.url)},`)
    lines.push(`    width: ${a.width ?? 0},`)
    lines.push(`    height: ${a.height ?? 0},`)
    lines.push(`    formats: { avif: [${f.avif.map(s).join(', ')}], webp: [${f.webp.map(s).join(', ')}], jpeg: [${f.jpeg.map(s).join(', ')}] },`)
    lines.push(`    lqip: ${s(r.lqip ?? '')},`)
    lines.push(`    sha256: ${s(a.sha256)},`)
    // caption stays null: we observed one language, and Record<Locale, string>
    // would require inventing the other three. sourceCaption carries the truth.
    lines.push(`    caption: null,`)
    lines.push(`    usage: ${s(r.usage.usage)},`)
    lines.push(`    usageReason: ${s(r.usage.reason)},`)
    lines.push(`    delivery: ${s(r.encoded?.delivery ?? 'internal')},`)
    lines.push(
      `    sourceDimensions: ${a.capped ? `{ width: ${a.sourceWidth}, height: ${a.sourceHeight} }` : 'null'},`,
    )
    lines.push(`    bytes: ${a.bytes ?? 0},`)
    lines.push(`    format: ${s(a.format ?? 'unknown')},`)
    lines.push(`    aspectRatio: ${r.encoded?.aspect ?? (a.width && a.height ? Number((a.width / a.height).toFixed(4)) : 'null')},`)
    const capText = (a.caption ?? a.alt ?? '').trim()
    lines.push(
      `    sourceCaption: ${capText ? `{ text: ${s(capText.slice(0, 300))}, locale: ${s(localeOfPage(a.carriedBy?.[0] ?? a.url))} }` : 'null'},`,
    )
    lines.push(`    watermarked: ${Boolean(a.watermarked)},`)
    lines.push(`    userGeneratedContent: ${Boolean(a.userGeneratedContent)},`)
    lines.push(`    fromStaleListing: ${staleHosts.has(a.sourceHost)},`)
    lines.push(`    duplicateSourceHosts: [${(a.carriedByHosts ?? []).filter((h) => h !== a.sourceHost).map(s).join(', ')}],`)
    lines.push(`    collectedAt: ${s(a.collectedAt)},`)
    lines.push(`  },`)
  }
  lines.push(`]`)
  lines.push('')

  lines.push(`export const mediaVideos: MediaVideoRef[] = [`)
  for (const [i, v] of (videoRefs ?? []).entries()) {
    const host = (() => {
      try {
        return new URL(v.embedUrl).host
      } catch {
        return 'unknown'
      }
    })()
    const platform = v.platform ?? (/youtu/.test(host) ? 'youtube' : /vimeo/.test(host) ? 'vimeo' : host)
    lines.push(`  {`)
    lines.push(`    id: ${s(`video-${String(i + 1).padStart(3, '0')}`)},`)
    lines.push(`    embedUrl: ${s(v.embedUrl)},`)
    lines.push(`    platform: ${s(platform)},`)
    lines.push(`    foundOn: ${s(v.foundOn ?? '')},`)
    lines.push(`    publisher: ${s(v.publisher ?? v.sourceHost ?? host)},`)
    lines.push(`    durationSec: ${v.durationSec ?? 'null'},`)
    lines.push(`    posterUrl: ${s(v.poster ?? v.posterUrl ?? null)},`)
    lines.push(`    rehosted: false,`)
    lines.push(
      `    rehostRationale: ${s('Reference over rehost. Downloading and rehosting a competitor promotional video is the highest-risk action in W0-D; no source term was found permitting it. Poster frame and link-out only (MEDIA-LICENSE.md §4).')},`,
    )
    lines.push(`  },`)
  }
  lines.push(`]`)
  lines.push('')

  lines.push(`// ── selectors ────────────────────────────────────────────────────────────────`)
  lines.push(`/** Everything a public route may legally render. Empty is a legitimate answer. */`)
  lines.push(`export const publiclyDisplayableAssets: MediaAsset[] = mediaAssets.filter(`)
  lines.push(`  (a) => a.usage === "attributed_display" && a.delivery === "public",`)
  lines.push(`)`)
  lines.push('')
  lines.push(`export function mediaByCategory(category: MediaCategory): MediaAsset[] {`)
  lines.push(`  return mediaAssets.filter((a) => a.category === category)`)
  lines.push(`}`)
  lines.push('')
  lines.push(`export function mediaBySubject(subject: MediaSubject): MediaAsset[] {`)
  lines.push(`  return mediaAssets.filter((a) => a.subject === subject)`)
  lines.push(`}`)
  lines.push('')
  lines.push(`export function mediaById(id: string): MediaAsset | null {`)
  lines.push(`  return mediaAssets.find((a) => a.id === id) ?? null`)
  lines.push(`}`)
  lines.push('')
  lines.push(`/** The highest-value assets in the harvest: unit layouts and resort site plans. */`)
  lines.push(`export const planAssets: MediaAsset[] = mediaAssets.filter(`)
  lines.push(`  (a) => a.category === "floorplan" || a.category === "siteplan",`)
  lines.push(`)`)
  lines.push('')
  lines.push(`export interface MediaManifestStats {`)
  lines.push(`  total: number`)
  lines.push(`  byCategory: Record<MediaCategory, number>`)
  lines.push(`  bySubject: Record<MediaSubject, number>`)
  lines.push(`  byUsage: Record<MediaUsage, number>`)
  lines.push(`  videoReferences: number`)
  lines.push(`}`)
  lines.push('')
  const cat = (k) => byCategory[k] ?? 0
  const sub = (k) => bySubject[k] ?? 0
  lines.push(`export const mediaManifestStats: MediaManifestStats = {`)
  lines.push(`  total: ${rows.length},`)
  lines.push(
    `  byCategory: { render: ${cat('render')}, photo: ${cat('photo')}, floorplan: ${cat('floorplan')}, siteplan: ${cat('siteplan')}, logo: ${cat('logo')}, video: ${cat('video')}, document: ${cat('document')} },`,
  )
  lines.push(
    `  bySubject: { project: ${sub('project')}, hotel: ${sub('hotel')}, unit: ${sub('unit')}, amenity: ${sub('amenity')}, location: ${sub('location')}, developer: ${sub('developer')} },`,
  )
  lines.push(
    `  byUsage: { internal_only: ${usage.internal_only ?? 0}, attributed_display: ${usage.attributed_display ?? 0}, unknown: ${usage.unknown ?? 0} },`,
  )
  lines.push(`  videoReferences: ${videoRefs?.length ?? 0},`)
  lines.push(`}`)
  lines.push('')

  return { text: lines.join('\n'), stats }
}

async function run() {
  const check = process.argv.includes('--check')
  const { text, stats } = await build()

  if (check) {
    const current = existsSync(OUT) ? await readFile(OUT, 'utf8') : ''
    const norm = (t) => t.replace(/Generated : .*/g, '').replace(/MEDIA_MANIFEST_GENERATED_AT = "[^"]*"/g, '')
    const same = norm(current) === norm(text)
    console.log(same ? 'media-manifest.ts is current' : 'media-manifest.ts is STALE — re-run node scripts/media-manifest.mjs')
    if (!same) process.exitCode = 1
    return
  }

  await mkdir(DIR.lib, { recursive: true })
  await writeFile(OUT, text)

  console.log('W0-D media-manifest')
  console.log(`  wrote ${path.relative(REPO, OUT).replace(/\\/g, '/')} — ${text.split('\n').length} lines, ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB`)
  console.log(`\n── Assets by category ──`)
  for (const [k, v] of Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(10)} ${v}`)
  console.log(`\n── Assets by subject ──`)
  for (const [k, v] of Object.entries(stats.bySubject).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(10)} ${v}`)
  console.log(`\n── Rights posture (usage) ──`)
  for (const k of ['internal_only', 'unknown', 'attributed_display']) console.log(`  ${k.padEnd(19)} ${stats.usage[k] ?? 0}`)
  console.log(`\n  video references: ${stats.videoRefs} (none rehosted)`)
  if (stats.skippedNoEncode) console.log(`  assets with no encoded variants: ${stats.skippedNoEncode} (PDF/vector or encode skipped — see sources/media/encoded.json)`)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  run().catch((e) => {
    console.error('\nmedia-manifest.mjs failed:', e)
    process.exitCode = 1
  })
}
