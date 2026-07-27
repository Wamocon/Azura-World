#!/usr/bin/env node
/**
 * harvest-azura.mjs — Playwright harvest of the Azura World source estate (W0-B).
 *
 * Why Playwright and not fetch(): 9 of the 15 ticket URLs returned 403, a DNS
 * timeout, an invalid TLS chain or an HTTP 500 to a plain fetch. Most of those
 * are bot walls that a real browser context walks straight through.
 *
 * The rule this script exists to enforce:
 *
 *     VALIDATE THE BYTES, NOT THE STATUS LINE.
 *
 * The reference project (D:\Ataberg\scripts\harvest.mjs) shipped 51 of 154
 * "successful downloads" as 404 pages wearing a .jpg extension, because the
 * first pass trusted response.ok. Here, a 200 carrying a Cloudflare interstitial,
 * a soft-404 or a cookie wall is contentValidated: false and says so in the
 * manifest. Nothing is ever silently skipped.
 *
 * Config is data: scripts/sources.config.json. Adding a source must never
 * require editing this file.
 *
 * Usage:
 *   node scripts/harvest-azura.mjs [flags]
 *     --only=id[,id...]      harvest just these source ids
 *     --dry-run              print the plan, touch no network
 *     --allow-invalid-tls    permit the ONE tls-suspect host to be retried with
 *                            certificate errors ignored. A critical Finding is
 *                            emitted either way — never silently tolerated.
 *     --headed               run a visible browser (helps against strict walls)
 *     --units                also harvest the per-unit listing sources
 *     --timeout=ms           override navigation timeout
 *     --concurrency=n        override global concurrency (per-host stays 1)
 *
 * Exit codes: 0 every selected source attempted and recorded · 1 partial harvest
 * (a host soft-banned us and sources went unattempted) · 2 fatal setup error.
 */

import { createHash } from 'node:crypto'
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const CONFIG_PATH = path.join(HERE, 'sources.config.json')
const RAW_DIR = path.join(ROOT, 'sources', 'raw')
const MANIFEST_PATH = path.join(ROOT, 'sources', 'manifest.json')
const MANIFEST_ARCHIVE = path.join(ROOT, 'sources', 'manifests')
const FINDINGS_PATH = path.join(ROOT, 'sources', 'harvest-findings.json')
const DIFF_PATH = path.join(ROOT, 'sources', 'manifest-diff.json')

/* ------------------------------------------------------------------ args -- */

const argv = process.argv.slice(2)
const flag = (name) => argv.some((a) => a === `--${name}`)
const opt = (name, fallback = null) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const ARGS = {
  only: (opt('only') || '').split(',').map((s) => s.trim()).filter(Boolean),
  dryRun: flag('dry-run'),
  allowInvalidTls: flag('allow-invalid-tls'),
  headed: flag('headed'),
  units: flag('units'),
  timeout: Number(opt('timeout', 0)) || null,
  concurrency: Number(opt('concurrency', 0)) || null,
}

/* ---------------------------------------------------------------- helpers -- */

const nowIso = () => new Date().toISOString()

/** ISO 8601 is not a legal Windows filename — ':' is reserved. */
const stampFor = (iso) => iso.replace(/\.\d+Z$/, 'Z').replace(/:/g, '-')

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

const hostOf = (url) => {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return 'invalid-url'
  }
}

/**
 * Invariant casefold + diacritic strip, for `expect` token matching only.
 * String.prototype.toLowerCase is locale-independent, so this is safe for the
 * Turkish I problem: we never use a Turkish locale casefold for keys.
 * Cyrillic passes through unchanged (NFD leaves it alone here).
 */
const foldText = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------- playwright lookup -- */

/**
 * W0-A owns dependency installation and SYSTEM-PROMPT §4.3 forbids running
 * pnpm install concurrently, so this resolves Playwright from whichever of
 * these exists — the repo's own node_modules first, once W0-A lands.
 */
async function loadPlaywright() {
  const req = createRequire(import.meta.url)
  const bases = [
    process.env.AZURA_PLAYWRIGHT_BASE,
    ROOT,
    path.join(ROOT, 'apps', 'web'),
    'D:\\Ataberg',
    'D:\\Real Estate CRM\\Cati',
  ].filter(Boolean)

  for (const base of bases) {
    try {
      const entry = req.resolve('playwright', { paths: [base] })
      const imported = await import(pathToFileURL(entry).href)
      // playwright's entry is CommonJS; ESM interop may or may not surface the
      // named exports, so take whichever object actually carries `chromium`.
      const mod = imported?.chromium ? imported : imported?.default
      if (!mod?.chromium) continue
      return { mod, from: base }
    } catch {
      /* try the next base */
    }
  }
  throw new Error(
    `Playwright not found. Looked in: ${bases.join(', ')}. ` +
      `Set AZURA_PLAYWRIGHT_BASE to a directory whose node_modules has playwright.`,
  )
}

/* ------------------------------------------------------------ robots.txt --- */

/**
 * Minimal RFC 9309 evaluation for the `*` group. A browser user-agent carries no
 * crawler product token, so `*` is the group that applies to us.
 *
 * Unavailable robots.txt (5xx, DNS failure) is recorded as "unavailable" and the
 * fetch proceeds: this is a bounded, one-page-per-source competitor review, not a
 * crawl. The decision is recorded per source in the manifest rather than buried.
 */
function parseRobots(text) {
  const groups = []
  let current = null
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/)
    if (!m) continue
    const field = m[1].toLowerCase()
    const value = m[2].trim()
    if (field === 'user-agent') {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
    } else if (current && (field === 'allow' || field === 'disallow')) {
      current.rules.push({ allow: field === 'allow', pattern: value })
    }
  }
  return groups
}

function robotsMatch(pattern, urlPath) {
  if (pattern === '') return false
  // RFC 9309 wildcards: * = any run, $ = end anchor.
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern
  const rx = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${rx}${anchored ? '$' : ''}`).test(urlPath)
}

function robotsAllows(groups, urlPath) {
  const star = groups.filter((g) => g.agents.includes('*'))
  if (!star.length) return { allowed: true, rule: null }
  const rules = star.flatMap((g) => g.rules)
  let best = null
  for (const rule of rules) {
    if (!robotsMatch(rule.pattern, urlPath)) continue
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) {
      best = rule
    }
  }
  if (!best) return { allowed: true, rule: null }
  return { allowed: best.allow, rule: `${best.allow ? 'Allow' : 'Disallow'}: ${best.pattern}` }
}

/* ----------------------------------------------------------- classification */

function transportLabelFor(errorMessage) {
  const m = String(errorMessage || '').toLowerCase()
  if (m.includes('err_name_not_resolved') || m.includes('err_name_resolution_failed')) return 'dns_timeout'
  if (m.includes('err_connection_timed_out') || m.includes('err_timed_out')) return 'dns_timeout'
  if (m.includes('err_cert') || m.includes('ssl') || m.includes('err_bad_ssl')) return 'tls_invalid'
  if (m.includes('err_connection_refused') || m.includes('err_connection_reset')) return 'connection_refused'
  if (m.includes('err_empty_response')) return 'empty_response'
  if (m.includes('timeout') && m.includes('exceeded')) return 'nav_timeout'
  if (m.includes('err_aborted')) return 'nav_aborted'
  if (m.includes('err_too_many_redirects')) return 'redirect_loop'
  return 'nav_error'
}

/**
 * The heart of the script. A body is real content only if it is big enough, is
 * not a wall, is not a soft-404, and actually contains what the config says it
 * must contain.
 */
/**
 * A site that answers a missing detail page with its index page returns HTTP 200
 * carrying real, plausible content — and the project name is on the index too, so
 * an `expect` token alone waves it through. That is exactly the Ataberg failure
 * mode wearing a different extension, so the requested path is checked against
 * the landed path:
 *
 *   final === requested            → fine
 *   final starts with requested    → fine (canonicalised to a longer slug)
 *   requested starts with final    → FAIL, we were bounced up to an ancestor/index
 *   anything else                  → FAIL unless the source opts in
 */
function redirectVerdict(requestedUrl, finalUrl, source) {
  if (!finalUrl) return null
  const norm = (u) => {
    try {
      const parsed = new URL(u)
      return parsed.pathname.replace(/\/+$/, '').toLowerCase()
    } catch {
      return null
    }
  }
  const from = norm(requestedUrl)
  const to = norm(finalUrl)
  if (from === null || to === null || from === to) return null
  if (to.startsWith(from)) return null
  if (source.allowRedirect) return null
  if (from.startsWith(to)) return `redirected_to_ancestor(${from} → ${to || '/'})`
  return `redirected_off_path(${from} → ${to})`
}

function validateBody({ source, defaults, html, text, title, httpStatus, requestedUrl, finalUrl }) {
  const reasons = []

  const redirect = redirectVerdict(requestedUrl, finalUrl, source)
  if (redirect) reasons.push(redirect)

  const foldedAll = foldText(`${title}\n${text}`)
  const minBytes = source.minBytes ?? defaults.minBytes

  if (Buffer.byteLength(html, 'utf8') < minBytes) {
    reasons.push(`body_under_min_bytes(${Buffer.byteLength(html, 'utf8')}<${minBytes})`)
  }

  for (const pattern of defaults.botWallPatterns) {
    if (foldedAll.includes(foldText(pattern))) {
      reasons.push(`bot_wall:${pattern}`)
      break
    }
  }

  for (const pattern of defaults.soft404Patterns) {
    if (foldedAll.includes(foldText(pattern))) {
      reasons.push(`soft_404:${pattern}`)
      break
    }
  }

  const tokens = source.expect || []
  const hits = tokens.filter((t) => foldedAll.includes(foldText(t)))
  const mode = source.expectMode || 'any'
  const tokenOk = mode === 'all' ? hits.length === tokens.length : hits.length > 0
  if (tokens.length && !tokenOk) {
    reasons.push(`expect_missing(${mode}:${tokens.join('|')})`)
  }

  if (typeof httpStatus === 'number' && httpStatus >= 400) {
    reasons.push(`http_${httpStatus}`)
  }

  return {
    contentValidated: reasons.length === 0,
    reasons,
    expectHits: hits,
  }
}

function statusLabel({ httpStatus, reasons, transport }) {
  if (transport) return transport
  if (typeof httpStatus === 'number') {
    if (httpStatus === 403) return 'blocked_403'
    if (httpStatus === 429) return 'rate_limited_429'
    if (httpStatus >= 500) return `http_${httpStatus}`
    if (httpStatus === 404) return 'http_404'
  }
  if (reasons.some((r) => r.startsWith('bot_wall'))) return 'bot_wall'
  if (reasons.some((r) => r.startsWith('soft_404'))) return 'soft_404'
  if (reasons.some((r) => r.startsWith('redirected_to_ancestor'))) return 'soft_404_redirect'
  if (reasons.some((r) => r.startsWith('redirected_off_path'))) return 'redirected'
  if (reasons.some((r) => r.startsWith('body_under_min_bytes'))) return 'thin_body'
  if (reasons.some((r) => r.startsWith('expect_missing'))) return 'expect_missing'
  return typeof httpStatus === 'number' ? httpStatus : 'unknown'
}

/* --------------------------------------------------------------- capture --- */

async function captureSource({ browser, source, defaults, robotsCache, requestFactory }) {
  const started = nowIso()
  const candidates = [source.url, ...(source.altUrls || [])].filter((u) => u && u !== 'UNRESOLVED')

  const entry = {
    id: source.id,
    ticketRef: source.ticketRef ?? null,
    url: source.url,
    finalUrl: null,
    publisher: source.publisher,
    tier: source.tier,
    kind: source.kind,
    locale: source.locale,
    group: source.group,
    unitListing: source.unitListing ?? false,
    parentId: source.parentId ?? null,
    /** "rent" must never be mixed into the sale-price series (F-002). */
    priceKind: source.priceKind ?? 'sale',
    isStale: source.isStale ?? false,
    wrongPropertySuspect: source.wrongPropertySuspect ?? false,
    status: 'not_attempted',
    fetchedAt: started,
    snapshotPath: null,
    snapshotHash: null,
    screenshotPath: null,
    textPath: null,
    bytes: 0,
    contentValidated: false,
    contentValidatedReasons: [],
    expectHits: [],
    title: null,
    textChars: 0,
    httpStatus: null,
    robots: null,
    tlsToleranceUsed: false,
    attempts: [],
  }

  if (source.urlUnresolved || !candidates.length) {
    entry.status = 'url_unresolved'
    entry.contentValidatedReasons = ['url_not_established']
    return entry
  }

  for (const candidate of candidates) {
    const url = new URL(candidate)
    const originKey = url.origin

    // ---- robots -----------------------------------------------------------
    if (!robotsCache.has(originKey)) {
      robotsCache.set(originKey, await loadRobots(requestFactory, url.origin))
    }
    const robots = robotsCache.get(originKey)
    const verdict = robots.groups
      ? robotsAllows(robots.groups, url.pathname + url.search)
      : { allowed: true, rule: null }
    entry.robots = { status: robots.status, allowed: verdict.allowed, rule: verdict.rule }

    if (!verdict.allowed) {
      entry.status = 'robots_disallowed'
      entry.attempts.push({ url: candidate, outcome: 'robots_disallowed', rule: verdict.rule })
      entry.contentValidatedReasons = [`robots_disallowed(${verdict.rule})`]
      // A robots disallow is a decision about this URL, not this host in general;
      // try the next candidate rather than abandoning the source.
      continue
    }

    // ---- navigate ---------------------------------------------------------
    const tlsPasses = source.tlsSuspect && ARGS.allowInvalidTls ? [false, true] : [false]

    for (const ignoreHTTPSErrors of tlsPasses) {
      const attempt = { url: candidate, ignoreHTTPSErrors, startedAt: nowIso() }
      let context = null
      try {
        context = await newRealisticContext(browser, source, defaults, ignoreHTTPSErrors)
        const page = await context.newPage()
        const navTimeout = ARGS.timeout || defaults.navTimeoutMs
        page.setDefaultTimeout(navTimeout)

        const response = await page.goto(candidate, {
          waitUntil: 'domcontentloaded',
          timeout: navTimeout,
        })
        const httpStatus = response ? response.status() : null

        // Settle: network idle is best-effort. A portal with a live chat widget
        // never goes idle, so a timeout here is not a failure.
        await page.waitForLoadState('networkidle', { timeout: defaults.settleTimeoutMs }).catch(() => {})

        const consentClicked = await dismissConsent(page, defaults, source)

        // Lazy-loaded prices: poll for the expect token rather than sleeping a
        // fixed amount, which is flaky by construction.
        await pollForExpect(page, source, defaults)

        const html = await page.content()
        const text = await page
          .evaluate(() => document.body?.innerText || '')
          .catch(() => '')
        const title = await page.title().catch(() => '')

        const landedUrl = page.url()
        const validation = validateBody({
          source,
          defaults,
          html,
          text,
          title,
          httpStatus,
          requestedUrl: candidate,
          finalUrl: landedUrl,
        })

        // Persist before judging: a rejected body is still evidence, and the
        // manifest must be able to point at the bytes that were rejected.
        const saved = await persistCapture({ source, url: candidate, page, html, text })

        attempt.httpStatus = httpStatus
        attempt.finalUrl = landedUrl
        attempt.consentClicked = consentClicked
        attempt.contentValidated = validation.contentValidated
        attempt.reasons = validation.reasons
        attempt.snapshotPath = saved.htmlRel
        attempt.snapshotHash = saved.hash
        attempt.bytes = saved.bytes
        attempt.finishedAt = nowIso()
        entry.attempts.push(attempt)

        entry.finalUrl = landedUrl
        entry.httpStatus = httpStatus
        entry.status = statusLabel({ httpStatus, reasons: validation.reasons, transport: null })
        entry.snapshotPath = saved.htmlRel
        entry.snapshotHash = saved.hash
        entry.screenshotPath = saved.pngRel
        entry.textPath = saved.txtRel
        entry.bytes = saved.bytes
        entry.title = title
        entry.textChars = text.length
        entry.contentValidated = validation.contentValidated
        entry.contentValidatedReasons = validation.reasons
        entry.expectHits = validation.expectHits
        entry.tlsToleranceUsed = ignoreHTTPSErrors
        entry.fetchedAt = nowIso()

        await context.close().catch(() => {})
        if (validation.contentValidated) return entry
        // Validated false: keep the snapshot as evidence, try the next candidate.
        break
      } catch (error) {
        const label = transportLabelFor(error?.message)
        attempt.outcome = label
        attempt.error = String(error?.message || error).split('\n')[0].slice(0, 300)
        attempt.finishedAt = nowIso()
        entry.attempts.push(attempt)
        entry.status = label
        entry.contentValidatedReasons = [label]
        entry.tlsToleranceUsed = ignoreHTTPSErrors
        await context?.close().catch(() => {})
        if (label !== 'tls_invalid') break
      }
    }

    if (entry.contentValidated) return entry
    await sleep(defaults.perHostDelayMs)
  }

  return entry
}

async function loadRobots(requestFactory, origin) {
  try {
    const request = await requestFactory()
    const res = await request.get(`${origin}/robots.txt`, { timeout: 20000, failOnStatusCode: false })
    const status = res.status()
    if (status >= 200 && status < 300) {
      const body = await res.text()
      await request.dispose()
      return { status, groups: parseRobots(body) }
    }
    await request.dispose()
    // 4xx: no rules published ⟹ allow all (RFC 9309 §2.3.1.3).
    // 5xx: rules unobtainable — recorded, not silently treated as permission.
    return { status, groups: status >= 400 && status < 500 ? [] : null }
  } catch (error) {
    return { status: `unavailable:${transportLabelFor(error?.message)}`, groups: null }
  }
}

async function newRealisticContext(browser, source, defaults, ignoreHTTPSErrors) {
  const localeMap = {
    de: { locale: 'de-DE', accept: 'de-DE,de;q=0.9,en;q=0.6', tz: 'Europe/Berlin' },
    en: { locale: 'en-US', accept: 'en-US,en;q=0.9', tz: 'Europe/Istanbul' },
    tr: { locale: 'tr-TR', accept: 'tr-TR,tr;q=0.9,en;q=0.6', tz: 'Europe/Istanbul' },
    ru: { locale: 'ru-RU', accept: 'ru-RU,ru;q=0.9,en;q=0.6', tz: 'Europe/Moscow' },
  }
  const l = localeMap[source.locale] || localeMap.en

  const context = await browser.newContext({
    userAgent: REAL_UA,
    locale: l.locale,
    timezoneId: l.tz,
    viewport: defaults.viewport,
    deviceScaleFactor: 1,
    ignoreHTTPSErrors,
    javaScriptEnabled: true,
    extraHTTPHeaders: {
      'Accept-Language': l.accept,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
    },
  })

  // Headed-equivalent: strip the automation tells a headless context leaks.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    Object.defineProperty(navigator, 'languages', { get: () => [navigator.language, 'en'] })
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
    window.chrome = window.chrome || { runtime: {} }
  })

  return context
}

async function dismissConsent(page, defaults, source) {
  const selectors = [...(defaults.consentSelectors || []), ...(source.consentSelectors || [])]
  for (const selector of selectors) {
    try {
      const el = page.locator(selector).first()
      if (await el.isVisible({ timeout: 400 })) {
        await el.click({ timeout: 2000 })
        await page.waitForTimeout(700)
        return selector
      }
    } catch {
      /* selector absent — normal */
    }
  }
  for (const label of defaults.consentTexts || []) {
    try {
      const el = page.getByRole('button', { name: label, exact: false }).first()
      if (await el.isVisible({ timeout: 300 })) {
        await el.click({ timeout: 2000 })
        await page.waitForTimeout(700)
        return `text:${label}`
      }
    } catch {
      /* absent — normal */
    }
  }
  return null
}

async function pollForExpect(page, source, defaults) {
  const tokens = source.expect || []
  if (!tokens.length) return
  const deadline = Date.now() + defaults.settleTimeoutMs
  while (Date.now() < deadline) {
    const text = await page.evaluate(() => document.body?.innerText || '').catch(() => '')
    const folded = foldText(text)
    if (tokens.some((t) => folded.includes(foldText(t)))) return
    await page.waitForTimeout(defaults.expectPollMs)
  }
}

async function persistCapture({ source, url, page, html, text }) {
  const host = hostOf(url)
  const dir = path.join(RAW_DIR, host)
  await mkdir(dir, { recursive: true })

  const stamp = stampFor(nowIso())
  const base = `${stamp}__${source.id}`
  const htmlPath = path.join(dir, `${base}.html`)
  const txtPath = path.join(dir, `${base}.txt`)
  const pngPath = path.join(dir, `${base}.png`)
  const metaPath = path.join(dir, `${base}.meta.json`)

  const buf = Buffer.from(html, 'utf8')
  await writeFile(htmlPath, buf)
  await writeFile(txtPath, text, 'utf8')
  await page.screenshot({ path: pngPath, fullPage: true, timeout: 25000 }).catch(async () => {
    await page.screenshot({ path: pngPath, fullPage: false, timeout: 15000 }).catch(() => {})
  })
  await writeFile(
    metaPath,
    JSON.stringify(
      {
        sourceId: source.id,
        publisher: source.publisher,
        tier: source.tier,
        requestedUrl: url,
        finalUrl: page.url(),
        fetchedAt: nowIso(),
        sha256: sha256(buf),
        bytes: buf.length,
      },
      null,
      2,
    ),
    'utf8',
  )

  const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/')
  return {
    htmlRel: rel(htmlPath),
    txtRel: rel(txtPath),
    pngRel: existsSync(pngPath) ? rel(pngPath) : null,
    hash: sha256(buf),
    bytes: buf.length,
  }
}

/* ------------------------------------------------------------------ diff --- */

async function previousManifest() {
  if (!existsSync(MANIFEST_PATH)) return null
  try {
    return JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
  } catch {
    return null
  }
}

function diffManifests(prev, next) {
  if (!prev) return { baseline: true, changes: [] }
  const byId = new Map((prev.entries || []).map((e) => [e.id, e]))
  const changes = []
  for (const entry of next.entries) {
    const before = byId.get(entry.id)
    if (!before) {
      changes.push({ id: entry.id, kind: 'added', to: entry.status })
      continue
    }
    if (before.status !== entry.status) {
      changes.push({ id: entry.id, kind: 'status', from: before.status, to: entry.status })
    }
    if (before.contentValidated !== entry.contentValidated) {
      changes.push({
        id: entry.id,
        kind: 'validation',
        from: before.contentValidated,
        to: entry.contentValidated,
      })
    }
    if (before.snapshotHash && entry.snapshotHash && before.snapshotHash !== entry.snapshotHash) {
      changes.push({ id: entry.id, kind: 'content_changed', from: before.snapshotHash.slice(0, 12), to: entry.snapshotHash.slice(0, 12) })
    }
    byId.delete(entry.id)
  }
  for (const [id, before] of byId) {
    changes.push({ id, kind: 'removed', from: before.status })
  }
  return { baseline: false, changes }
}

/* ------------------------------------------------------------------ main --- */

let REAL_UA = ''

async function main() {
  if (!existsSync(CONFIG_PATH)) {
    console.error(`FATAL: ${CONFIG_PATH} missing`)
    process.exit(2)
  }
  const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'))
  const defaults = {
    ...config.defaults,
    maxGlobalConcurrency: ARGS.concurrency || config.defaults.maxGlobalConcurrency,
  }

  let selected = [...config.sources]
  if (ARGS.units) selected = selected.concat(config.unitListingSources || [])
  if (ARGS.only.length) selected = selected.filter((s) => ARGS.only.includes(s.id))

  if (!selected.length) {
    console.error(`FATAL: no sources selected (--only=${ARGS.only.join(',')})`)
    process.exit(2)
  }

  const hostGroups = new Map()
  for (const source of selected) {
    const host = hostOf(source.url)
    if (!hostGroups.has(host)) hostGroups.set(host, [])
    hostGroups.get(host).push(source)
  }

  console.log(`harvest-azura · ${selected.length} sources across ${hostGroups.size} hosts`)
  console.log(
    `  concurrency ${defaults.maxGlobalConcurrency} global / ${defaults.maxHostConcurrency} per host · ` +
      `${defaults.perHostDelayMs}ms between same-host requests`,
  )
  console.log(`  tls tolerance: ${ARGS.allowInvalidTls ? 'ENABLED (--allow-invalid-tls)' : 'disabled'}`)

  if (ARGS.dryRun) {
    console.log('\n--dry-run: plan only, no network\n')
    for (const [host, sources] of hostGroups) {
      console.log(`  ${host}`)
      for (const s of sources) {
        console.log(`    ${s.id.padEnd(28)} tier ${s.tier}  ${s.locale}  ${s.urlUnresolved ? 'UNRESOLVED' : s.url}`)
      }
    }
    process.exit(0)
  }

  const { mod: playwright, from } = await loadPlaywright()
  console.log(`  playwright resolved from ${from}`)

  const launchArgs = [
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--no-sandbox',
  ]
  const browser = await playwright.chromium.launch({ headless: !ARGS.headed, args: launchArgs })

  /**
   * Tripadvisor and OnTheBeach serve "Please enable JS and disable any ad
   * blocker" to a headless context and real content to a headed one. That is a
   * property of the source, so it belongs in the config as requiresHeaded —
   * not in an operator's memory of which flag to pass. A second browser is
   * launched only if some selected source actually needs it.
   */
  const needsHeaded = selected.some((s) => s.requiresHeaded)
  const headedBrowser =
    needsHeaded && !ARGS.headed
      ? await playwright.chromium.launch({ headless: false, args: launchArgs })
      : null
  if (headedBrowser) console.log('  launched a second, headed browser for requiresHeaded sources')
  const browserFor = (source) => (source.requiresHeaded && headedBrowser ? headedBrowser : browser)

  const version = browser.version()
  const major = String(version).split('.')[0]
  REAL_UA =
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
    `Chrome/${major}.0.0.0 Safari/537.36`
  console.log(`  chromium ${version} · UA ${REAL_UA}`)

  const requestFactory = () =>
    playwright.request.newContext({
      userAgent: REAL_UA,
      ignoreHTTPSErrors: ARGS.allowInvalidTls,
    })

  const robotsCache = new Map()
  const entries = []
  const softBanned = new Set()
  const queue = [...hostGroups.entries()]
  let cursor = 0

  const worker = async () => {
    while (cursor < queue.length) {
      const index = cursor++
      const [host, sources] = queue[index]
      let consecutiveWalls = 0

      for (const source of sources) {
        if (softBanned.has(host)) {
          entries.push({
            id: source.id,
            url: source.url,
            publisher: source.publisher,
            tier: source.tier,
            kind: source.kind,
            locale: source.locale,
            group: source.group,
            status: 'not_attempted',
            fetchedAt: nowIso(),
            snapshotPath: null,
            snapshotHash: null,
            bytes: 0,
            contentValidated: false,
            contentValidatedReasons: ['host_soft_banned_earlier_in_run'],
            attempts: [],
          })
          continue
        }

        const entry = await captureSource({
          browser: browserFor(source),
          source,
          defaults,
          robotsCache,
          requestFactory,
        })
        entry.headed = ARGS.headed || Boolean(source.requiresHeaded && headedBrowser)
        entries.push(entry)

        const wall =
          entry.status === 'rate_limited_429' ||
          entry.status === 'bot_wall' ||
          (entry.status === 'blocked_403' && !entry.contentValidated)
        if (wall) {
          consecutiveWalls += 1
          if (consecutiveWalls >= 2) {
            softBanned.add(host)
            console.log(`  ! ${host}: two consecutive walls — backing off, remaining sources not attempted`)
          } else {
            await sleep(defaults.backoffMs)
          }
        } else {
          consecutiveWalls = 0
        }

        const mark = entry.contentValidated ? 'OK ' : '   '
        console.log(
          `  ${mark} ${String(entry.status).padEnd(16)} ${entry.id.padEnd(28)} ` +
            `${String(entry.bytes).padStart(7)}B  ${entry.contentValidatedReasons.slice(0, 2).join(',')}`,
        )

        await sleep(defaults.perHostDelayMs)
      }
    }
  }

  const workers = Array.from({ length: Math.min(defaults.maxGlobalConcurrency, queue.length) }, worker)
  await Promise.all(workers.map((w) => w))

  /* ---------------------------------------------- phase 2: follow listings --
   * Per-unit prices are the only route to real evidence for F-002, and the unit
   * URLs must be DISCOVERED from the container page rather than pasted into the
   * config by hand — otherwise the pipeline silently rots the moment a portal
   * re-slugs its inventory, and re-running it would reproduce yesterday's list.
   */
  const followParents = selected.filter((s) => s.followListingLinks)
  for (const parent of followParents) {
    const parentEntry = entries.find((e) => e.id === parent.id)
    if (!parentEntry?.snapshotPath || !parentEntry.contentValidated) {
      console.log(`  follow ${parent.id}: skipped (container page not validated)`)
      continue
    }

    const html = await readFile(path.join(ROOT, parentEntry.snapshotPath), 'utf8')
    const base = parentEntry.finalUrl || parent.url
    const pattern = new RegExp(parent.listingLinkPattern, 'i')
    const found = new Set()

    for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
      let abs
      try {
        abs = new URL(m[1], base).href
      } catch {
        continue
      }
      if (hostOf(abs) !== hostOf(base)) continue
      if (!pattern.test(new URL(abs).pathname)) continue
      if (new URL(abs).pathname.replace(/\/+$/, '') === new URL(base).pathname.replace(/\/+$/, '')) continue
      found.add(abs.split('#')[0])
    }

    const targets = [...found].slice(0, parent.maxFollow ?? 12)
    console.log(`  follow ${parent.id}: ${found.size} link(s) matched, harvesting ${targets.length}`)

    for (const [index, target] of targets.entries()) {
      const child = {
        ...parent,
        id: `${parent.id}-${String(index + 1).padStart(2, '0')}`,
        url: target,
        altUrls: [],
        followListingLinks: false,
        allowRedirect: true,
        parentId: parent.id,
        unitListing: true,
      }
      const childEntry = await captureSource({
        browser: browserFor(child),
        source: child,
        defaults,
        robotsCache,
        requestFactory,
      })
      childEntry.headed = ARGS.headed || Boolean(child.requiresHeaded && headedBrowser)
      childEntry.parentId = parent.id
      childEntry.unitListing = true
      childEntry.priceKind = parent.priceKind ?? 'sale'
      childEntry.isStale = parent.isStale ?? false
      entries.push(childEntry)
      console.log(
        `    ${childEntry.contentValidated ? 'OK ' : '   '} ${String(childEntry.status).padEnd(16)} ` +
          `${childEntry.id.padEnd(28)} ${String(childEntry.bytes).padStart(7)}B`,
      )
      await sleep(defaults.perHostDelayMs)
    }
  }

  await browser.close()
  await headedBrowser?.close()

  const runId = stampFor(nowIso())
  const prev = await previousManifest()

  /**
   * MERGE, never replace. A `--only=tripadvisor` run must not erase the other
   * 33 sources from the register — that would be exactly the "silent regression"
   * the brief forbids, and the diff would then read as 33 deletions. Entries
   * from this run overwrite their predecessors by id; everything else is carried
   * forward untouched, still carrying the runId that produced it.
   *
   * Findings are derived from the MERGED set, not this run's slice, so a partial
   * run can never emit "no tier-3 source validated" about sources it never tried.
   */
  for (const entry of entries) entry.runId = runId
  const merged = new Map((prev?.entries || []).map((e) => [e.id, e]))
  for (const entry of entries) merged.set(entry.id, entry)
  const allEntries = [...merged.values()]

  /* -------------------------------------------------------- harvest findings */

  const findings = []
  const configIndex = new Map(
    [...(config.sources || []), ...(config.unitListingSources || [])].map((s) => [s.id, s]),
  )

  const tlsSuspects = allEntries.filter((e) => configIndex.get(e.id)?.tlsSuspect)
  for (const e of tlsSuspects) {
    const repairedByBrowser = e.contentValidated && !e.tlsToleranceUsed
    findings.push({
      key: 'harvest.tls-invalid',
      severity: repairedByBrowser ? 'medium' : 'critical',
      area: 'harvest',
      field: `harvest.${e.id}`,
      message: repairedByBrowser
        ? `${e.publisher} (${e.url}) was flagged for an invalid/incomplete TLS chain, but Chromium ` +
          `validated it WITHOUT tolerance (tlsToleranceUsed: false, status ${e.status}). Browsers repair an ` +
          `incomplete chain by fetching the missing intermediate (AIA); strict TLS clients such as Node's ` +
          `https do not, which is why a plain fetch failed and this harvest succeeded. The server chain is ` +
          `still misconfigured — the failure was real, the diagnosis "invalid certificate" was not.`
        : `${e.publisher} (${e.url}) presents an invalid TLS chain. Harvest ran with tolerance ` +
          `${ARGS.allowInvalidTls ? 'ENABLED via --allow-invalid-tls' : 'DISABLED'}; final status ${e.status}` +
          `${e.tlsToleranceUsed ? ' and content was obtained ONLY by ignoring certificate errors' : ''}. ` +
          `Certificate verification is never disabled silently — the flag is required and this finding is ` +
          `emitted either way.`,
      sourceIds: [e.id],
      resolution: repairedByBrowser
        ? 'Recorded. Content is trusted at its normal tier because no verification was waived to obtain it.'
        : 'Recorded, not resolved. A tier-3 source reached only by ignoring certificate errors cannot carry ' +
          'the authority of a verified official source; facts taken from it stay single_source.',
      resolvedTo: null,
    })
  }

  const unresolved = allEntries.filter((e) => e.status === 'url_unresolved')
  if (unresolved.length) {
    findings.push({
      key: 'harvest.url-unresolved',
      severity: 'high',
      area: 'harvest',
      field: 'harvest.url',
      message:
        `${unresolved.length} source URL(s) could not be established and were left UNRESOLVED rather than ` +
        `reconstructed: ${unresolved.map((e) => e.id).join(', ')}. A fabricated URL would resolve to a different ` +
        `property and attach the wrong data to this dataset.`,
      sourceIds: unresolved.map((e) => e.id),
      resolution: 'Left as a gap. Facts that depended on these sources stay confidence: "gap".',
      resolvedTo: null,
    })
  }

  const disallowed = allEntries.filter((e) => e.status === 'robots_disallowed')
  if (disallowed.length) {
    findings.push({
      key: 'harvest.robots-disallowed',
      severity: 'medium',
      area: 'harvest',
      field: 'harvest.robots',
      message:
        `${disallowed.length} source(s) disallow this path in robots.txt and were NOT fetched: ` +
        `${disallowed.map((e) => `${e.id} (${e.robots?.rule})`).join(', ')}.`,
      sourceIds: disallowed.map((e) => e.id),
      resolution: 'Respected. The source is recorded as unavailable, not as empty.',
      resolvedTo: null,
    })
  }

  const dead = allEntries.filter((e) => !e.contentValidated)
  const tierAuthority = allEntries.filter((e) => e.tier <= 3 && e.contentValidated)
  findings.push({
    key: 'harvest.authority',
    severity: tierAuthority.length ? 'medium' : 'critical',
    area: 'harvest',
    field: 'harvest.authority',
    message:
      `${allEntries.length - dead.length}/${allEntries.length} sources returned validated content. ` +
      `Tier ≤3 (official/developer/hotel) sources validated: ${tierAuthority.length} ` +
      `(${tierAuthority.map((e) => e.id).join(', ') || 'none'}).`,
    sourceIds: tierAuthority.map((e) => e.id),
    resolution: tierAuthority.length
      ? 'Tier ≤3 corroboration exists for the fields those sources cover; everything else rests on tier 4-6.'
      : 'No tier-1/2/3 corroboration exists for any project figure. F-010 stands and must be surfaced in the UI.',
    resolvedTo: null,
  })

  /* ------------------------------------------------------------- manifest -- */

  const manifest = {
    generatedAt: nowIso(),
    runId,
    contractVersion: config.contractVersion ?? 1,
    generator: 'scripts/harvest-azura.mjs',
    playwright: { chromium: version, resolvedFrom: from },
    flags: { ...ARGS },
    attemptedThisRun: entries.map((e) => e.id).sort(),
    counts: {
      registerSelected: selected.length,
      attemptedThisRun: entries.length,
      discoveredUnitPages: allEntries.filter((e) => e.parentId).length,
      total: allEntries.length,
      validated: allEntries.filter((e) => e.contentValidated).length,
      failed: allEntries.filter((e) => !e.contentValidated).length,
      notAttempted: allEntries.filter((e) => e.status === 'not_attempted').length,
    },
    entries: allEntries.sort((a, b) => a.id.localeCompare(b.id)),
  }

  await mkdir(path.dirname(MANIFEST_PATH), { recursive: true })
  await mkdir(MANIFEST_ARCHIVE, { recursive: true })
  const diff = diffManifests(prev, manifest)

  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8')
  await writeFile(path.join(MANIFEST_ARCHIVE, `${runId}.json`), JSON.stringify(manifest, null, 2), 'utf8')
  await writeFile(FINDINGS_PATH, JSON.stringify({ generatedAt: nowIso(), findings }, null, 2), 'utf8')
  await writeFile(DIFF_PATH, JSON.stringify({ generatedAt: nowIso(), previousRun: prev?.runId ?? null, ...diff }, null, 2), 'utf8')

  /* -------------------------------------------------------------- summary -- */

  console.log('\n— harvest summary —')
  console.log(`  register      : ${manifest.counts.registerSelected} sources`)
  console.log(`  unit pages    : ${manifest.counts.discoveredUnitPages} discovered by link-following`)
  console.log(`  validated     : ${manifest.counts.validated}/${manifest.counts.total}`)
  console.log(`  failed        : ${manifest.counts.failed}`)
  console.log(`  not attempted : ${manifest.counts.notAttempted}`)
  const byStatus = {}
  for (const e of entries) byStatus[e.status] = (byStatus[e.status] || 0) + 1
  for (const [k, v] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(k).padEnd(20)} ${v}`)
  }
  if (diff.baseline) {
    console.log('  diff          : baseline run, no previous manifest')
  } else {
    console.log(`  diff vs ${prev?.runId}: ${diff.changes.length} change(s)`)
    for (const c of diff.changes.slice(0, 20)) {
      console.log(`    ${c.id.padEnd(28)} ${c.kind} ${c.from ?? ''} → ${c.to ?? ''}`)
    }
  }
  console.log(`\n  manifest → ${path.relative(ROOT, MANIFEST_PATH)}`)
  console.log(`  findings → ${path.relative(ROOT, FINDINGS_PATH)}`)

  if (manifest.counts.notAttempted > 0) {
    console.error('\nPARTIAL HARVEST: sources went unattempted (soft ban / backoff). Exit 1.')
    process.exit(1)
  }
  process.exit(0)
}

main().catch((error) => {
  console.error('FATAL:', error?.stack || error)
  process.exit(2)
})
