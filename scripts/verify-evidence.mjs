#!/usr/bin/env node
/**
 * verify-evidence.mjs — independent validator for the Azura World dataset (W0-B).
 *
 * "Independent" is the whole point, so read this before changing it:
 *
 *   - it validates the EMITTED ARTIFACT (apps/web/lib/azura-world-data.ts), which
 *     is what actually ships, not the builder's in-memory view of what it meant
 *     to emit;
 *   - it re-computes every snapshot sha256 from the files on disk rather than
 *     trusting sources/manifest.json, so a citation is only accepted when the
 *     bytes it points at still exist and still hash to the same value.
 *
 * A builder checking its own work catches typos and nothing else. The failure
 * this guards against is the one the reference project actually shipped: an
 * artifact that looks complete and whose citations do not resolve.
 *
 * Usage:
 *   node scripts/verify-evidence.mjs [--json] [--quiet]
 * Exit 0 clean · 1 violations found · 2 could not run.
 */

import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const DATA_TS = path.join(ROOT, 'apps', 'web', 'lib', 'azura-world-data.ts')
const RAW_DIR = path.join(ROOT, 'sources', 'raw')
const MANIFEST = path.join(ROOT, 'sources', 'manifest.json')

const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const quiet = argv.includes('--quiet')

const violations = []
const fail = (rule, where, detail) => violations.push({ rule, where, detail })

/**
 * How many snapshotHash → file resolutions were skipped because there are no
 * snapshots on disk at all. Non-zero means half of invariant 6 was NOT RUN;
 * see the comment at the check itself.
 */
let skippedHashResolutions = 0

/* ------------------------------------------------------------------ input -- */

/**
 * Pull the dataset literal out of the generated module. Deliberately not an
 * import: this must run before the workspace has a toolchain (W0-A owns
 * dependency installation) and must not execute generated code to inspect it.
 */
function extractDataset(source) {
  const marker = 'export const azuraWorldDataset ='
  const start = source.indexOf(marker)
  if (start === -1) throw new Error('azuraWorldDataset export not found')
  const open = source.indexOf('{', start)
  let depth = 0
  let inString = false
  let quote = ''
  let escaped = false
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) inString = false
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true
      quote = ch
      continue
    }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return JSON.parse(source.slice(open, i + 1))
    }
  }
  throw new Error('unterminated dataset literal')
}

async function walk(dir) {
  const out = []
  let items
  try {
    items = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const item of items) {
    const full = path.join(dir, item.name)
    if (item.isDirectory()) out.push(...(await walk(full)))
    else out.push(full)
  }
  return out
}

/** sha256 of every stored snapshot, computed here, from the bytes on disk. */
async function snapshotHashes() {
  const files = (await walk(RAW_DIR)).filter((f) => f.endsWith('.html'))
  const hashes = new Map()
  for (const file of files) {
    const buf = await readFile(file)
    hashes.set(createHash('sha256').update(buf).digest('hex'), path.relative(ROOT, file))
  }
  return hashes
}

/* ------------------------------------------------------------- fact checks -- */

const isFact = (node) =>
  node && typeof node === 'object' && !Array.isArray(node) && 'confidence' in node && 'sources' in node

function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

/**
 * The six invariants from CONTRACTS.md §1.
 *
 * W0-A owns `assertFactInvariants` in apps/web/lib/contracts.ts. It does not
 * exist yet, and this validator must be runnable now, so the rules are
 * implemented here against the same specification. When W0-A lands, this should
 * delegate rather than keep a second copy — recorded as a request in HANDOFF/W0-B.md.
 */
function checkFact(pathLabel, fact, hashes) {
  const { value, sources = [], confidence, conflictsWith, note } = fact

  if (!['confirmed', 'official', 'single_source', 'conflicted', 'inferred', 'gap'].includes(confidence)) {
    fail('confidence-enum', pathLabel, `unknown confidence "${confidence}"`)
  }

  // 1. gap ⟹ value null AND note non-empty
  if (confidence === 'gap') {
    if (value !== null) fail('inv-1-gap-value', pathLabel, `gap with non-null value ${JSON.stringify(value)}`)
    if (!note || !String(note).trim()) fail('inv-1-gap-note', pathLabel, 'gap without an explanatory note')
  }

  // 2. conflicted ⟹ conflictsWith.length >= 1
  if (confidence === 'conflicted' && !(Array.isArray(conflictsWith) && conflictsWith.length >= 1)) {
    fail('inv-2-conflicted', pathLabel, 'conflicted with empty conflictsWith')
  }

  // 3. confirmed ⟹ >= 2 sources with DISTINCT hosts
  if (confidence === 'confirmed') {
    const hosts = new Set(sources.map((s) => hostOf(s.url)).filter(Boolean))
    if (sources.length < 2) fail('inv-3-confirmed-count', pathLabel, `confirmed with ${sources.length} source(s)`)
    else if (hosts.size < 2)
      fail('inv-3-confirmed-hosts', pathLabel, `confirmed but all sources share host ${[...hosts].join(',')}`)
  }

  // 4. inferred ⟹ note explains the computation
  if (confidence === 'inferred' && (!note || !String(note).trim())) {
    fail('inv-4-inferred-note', pathLabel, 'inferred without a note explaining the derivation')
  }

  // 5. sources.length === 0 only legal for gap
  if (sources.length === 0 && confidence !== 'gap') {
    fail('inv-5-no-sources', pathLabel, `${confidence} with zero sources`)
  }

  // 6. every snapshotHash resolves to a real file under sources/raw/
  //
  // `sources/raw/*` is git-ignored on purpose — the harvested HTML is evidence,
  // not source, and committing 500+ scraped pages is what the ignore rule and
  // the secret-hygiene audit both exist to prevent. So the snapshots exist only
  // on a machine that has run the harvest, and this half of invariant 6 CANNOT
  // be evaluated in a fresh clone, which is what CI is.
  //
  // It is therefore skipped when there are no snapshots at all — counted, and
  // reported as NOT RUN rather than passing quietly. Skipping it silently would
  // turn the strongest check in this file, "the hash in the dataset matches the
  // bytes we actually fetched", into a green tick that means nothing.
  //
  // The other half — "a source carries no snapshotHash at all" — is a property
  // of the DATA, not of the disk, so it always runs.
  const canResolveHashes = hashes.size > 0
  for (const source of sources) {
    if (!source?.snapshotHash) {
      fail('inv-6-missing-hash', pathLabel, `source ${source?.url} has no snapshotHash`)
      continue
    }
    if (!canResolveHashes) {
      skippedHashResolutions += 1
    } else if (!hashes.has(source.snapshotHash)) {
      fail('inv-6-unresolvable', pathLabel, `snapshotHash ${String(source.snapshotHash).slice(0, 16)}… (${source.url}) matches no file under sources/raw/`)
    }
  }
  for (const conflict of conflictsWith || []) {
    const hash = conflict?.source?.snapshotHash
    if (!hash) continue
    if (!canResolveHashes) {
      skippedHashResolutions += 1
    } else if (!hashes.has(hash)) {
      fail('inv-6-unresolvable', `${pathLabel}.conflictsWith`, `snapshotHash ${String(hash).slice(0, 16)}… matches no stored file`)
    }
  }

  // 7. Money amounts must be positive. A price of 0 is a bug; null is honest.
  const money = value && typeof value === 'object' && 'amount' in value ? value : null
  if (money && !(Number(money.amount) > 0)) {
    fail('money-non-positive', pathLabel, `amount ${money.amount} — 0 or negative is a parse bug, use null`)
  }
  if (money && !['EUR', 'USD', 'TRY', 'GBP'].includes(money.currency)) {
    fail('money-currency', pathLabel, `unknown currency ${money.currency}`)
  }
}

function walkFacts(node, label, hashes, seen = new Set()) {
  if (!node || typeof node !== 'object') return
  if (seen.has(node)) return
  seen.add(node)

  if (isFact(node)) {
    checkFact(label, node, hashes)
    for (const [key, child] of Object.entries(node)) {
      if (key === 'sources' || key === 'conflictsWith' || key === 'value') continue
      walkFacts(child, `${label}.${key}`, hashes, seen)
    }
    return
  }
  if (Array.isArray(node)) {
    node.forEach((child, index) => walkFacts(child, `${label}[${index}]`, hashes, seen))
    return
  }
  for (const [key, child] of Object.entries(node)) {
    walkFacts(child, label ? `${label}.${key}` : key, hashes, seen)
  }
}

function collectFacts(node, label, out = []) {
  if (!node || typeof node !== 'object') return out
  if (isFact(node)) {
    out.push([label, node])
    return out
  }
  if (Array.isArray(node)) {
    node.forEach((child, index) => collectFacts(child, `${label}[${index}]`, out))
    return out
  }
  for (const [key, child] of Object.entries(node)) collectFacts(child, label ? `${label}.${key}` : key, out)
  return out
}

/* ------------------------------------------------------------------- main -- */

async function main() {
  if (!existsSync(DATA_TS)) {
    console.error(`FATAL: ${path.relative(ROOT, DATA_TS)} not found — run the dataset build first.`)
    process.exit(2)
  }

  const source = await readFile(DATA_TS, 'utf8')
  let dataset
  try {
    dataset = extractDataset(source)
  } catch (error) {
    console.error(`FATAL: could not read the dataset literal: ${error.message}`)
    process.exit(2)
  }

  const hashes = await snapshotHashes()

  walkFacts(dataset.project, 'project', hashes)
  walkFacts(dataset.hotel, 'hotel', hashes)
  walkFacts(dataset.units, 'units', hashes)
  walkFacts(dataset.reviews, 'reviews', hashes)

  // Findings: resolvedTo set ⟹ resolution non-empty.
  for (const finding of dataset.findings || []) {
    if (finding.resolvedTo !== null && finding.resolvedTo !== undefined) {
      if (!finding.resolution || !String(finding.resolution).trim()) {
        fail('finding-resolution', finding.id, 'resolvedTo is set but resolution is empty')
      }
    }
    if (!finding.message || !String(finding.message).trim()) {
      fail('finding-message', finding.id, 'finding has no message')
    }
    if (!['critical', 'high', 'medium', 'low', 'info'].includes(finding.severity)) {
      fail('finding-severity', finding.id, `unknown severity ${finding.severity}`)
    }
  }

  // F-002 must stay unresolved. It is named explicitly because it is the one
  // conflict a well-meaning later change is most likely to "tidy up" into a
  // single number, and that change would be indistinguishable from progress.
  const f002 = (dataset.findings || []).find((f) => f.id === 'F-002')
  if (!f002) fail('f002-missing', 'F-002', 'the 1+1 price conflict finding is absent from the dataset')
  else if (f002.resolvedTo !== null) {
    fail('f002-resolved', 'F-002', `F-002 has been resolved to ${JSON.stringify(f002.resolvedTo)} — the 1+1 price spread must stay unresolved`)
  }

  // Modelled units must never look sourced.
  for (const unit of dataset.units || []) {
    if (unit.dataQuality === 'modelled') {
      const conf = unit.askingPrice?.confidence
      if (!['inferred', 'gap'].includes(conf)) {
        fail('modelled-confidence', unit.id, `modelled unit with askingPrice.confidence "${conf}" — must be inferred or gap`)
      }
      if ((unit.competingPrices || []).length) {
        fail('modelled-competing', unit.id, 'modelled unit carries competingPrices, which implies real observations')
      }
    }
    if (unit.dataQuality === 'portal_listing') {
      if (!(unit.askingPrice?.sources || []).length) {
        fail('portal-listing-unsourced', unit.id, 'portal_listing unit with no source')
      }
      // The mirror of the modelled-unit rule, and the one that actually caught a
      // hole: relabelling a modelled unit as portal_listing escaped every other
      // check, because modelled units legitimately carry the sources their price
      // was derived FROM. A real listing has an observed price, never a derived
      // one, so the confidence is what distinguishes them — not the label.
      if (['inferred', 'gap'].includes(unit.askingPrice?.confidence)) {
        fail(
          'portal-listing-derived-price',
          unit.id,
          `portal_listing unit with askingPrice.confidence "${unit.askingPrice?.confidence}" — ` +
            'a real listing has an observed price; this is a modelled unit wearing a listing label',
        )
      }
      if (!(unit.competingPrices || []).length) {
        fail('portal-listing-no-observation', unit.id, 'portal_listing unit with no observed price in competingPrices')
      }
    }
  }

  /* ---------------------------------------------------------- coverage -- */

  const facts = [
    ...collectFacts(dataset.project, 'project'),
    ...collectFacts(dataset.hotel, 'hotel'),
    ...collectFacts(dataset.units, 'units'),
    ...collectFacts(dataset.reviews, 'reviews'),
  ]
  const byConfidence = {}
  for (const [, fact] of facts) byConfidence[fact.confidence] = (byConfidence[fact.confidence] || 0) + 1

  const bySeverity = {}
  for (const finding of dataset.findings || []) bySeverity[finding.severity] = (bySeverity[finding.severity] || 0) + 1

  const byStatus = {}
  for (const entry of dataset.harvest || []) {
    const key = entry.contentValidated ? 'validated' : `failed:${entry.status}`
    byStatus[key] = (byStatus[key] || 0) + 1
  }

  const report = {
    ok: violations.length === 0,
    checkedAt: new Date().toISOString(),
    snapshotsOnDisk: hashes.size,
    // Non-zero ⟹ "inv-6-unresolvable" was NOT RUN. A consumer treating `ok`
    // as "everything was checked" must read this too.
    skippedHashResolutions,
    factsChecked: facts.length,
    factsByConfidence: byConfidence,
    findingsBySeverity: bySeverity,
    sourcesByStatus: byStatus,
    unitSplit: dataset.unitSplit,
    violations,
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
  } else if (!quiet) {
    const pad = (s, n) => String(s).padEnd(n)
    console.log('verify-evidence · independent validation of apps/web/lib/azura-world-data.ts\n')
    console.log(`  snapshots on disk (sha256 recomputed) : ${hashes.size}`)
    console.log(`  facts checked                         : ${facts.length}\n`)

    if (skippedHashResolutions > 0) {
      console.log(
        `  !! inv-6-unresolvable: NOT RUN — ${skippedHashResolutions} snapshotHash lookups\n` +
          '     skipped because sources/raw/ holds no snapshots. That directory is\n' +
          '     git-ignored, so a fresh clone (and CI) cannot check that a hash in the\n' +
          '     dataset matches the bytes that were actually fetched. Run `pnpm harvest`\n' +
          '     to get the evidence, then re-run this. Every other invariant DID run.\n',
      )
    }

    console.log('  facts by confidence')
    for (const key of ['confirmed', 'official', 'single_source', 'conflicted', 'inferred', 'gap']) {
      if (byConfidence[key]) console.log(`    ${pad(key, 16)} ${String(byConfidence[key]).padStart(5)}`)
    }

    console.log('\n  sources by status')
    for (const [key, count] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${pad(key, 24)} ${String(count).padStart(4)}`)
    }

    console.log('\n  findings by severity')
    for (const key of ['critical', 'high', 'medium', 'low', 'info']) {
      if (bySeverity[key]) console.log(`    ${pad(key, 16)} ${String(bySeverity[key]).padStart(5)}`)
    }

    console.log(
      `\n  units: ${dataset.unitSplit?.portalListing ?? '?'} portal_listing + ` +
        `${dataset.unitSplit?.modelled ?? '?'} modelled = ${dataset.unitSplit?.total ?? '?'}`,
    )

    if (violations.length) {
      console.log(`\n  VIOLATIONS: ${violations.length}\n`)
      const grouped = {}
      for (const v of violations) (grouped[v.rule] ||= []).push(v)
      for (const [rule, items] of Object.entries(grouped)) {
        console.log(`    ${rule}  (${items.length})`)
        for (const item of items.slice(0, 8)) console.log(`      ${item.where}: ${item.detail}`)
        if (items.length > 8) console.log(`      … and ${items.length - 8} more`)
      }
    } else {
      console.log('\n  no violations')
    }
  }

  process.exit(violations.length ? 1 : 0)
}

main().catch((error) => {
  console.error('FATAL:', error?.stack || error)
  process.exit(2)
})
