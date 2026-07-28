#!/usr/bin/env node
/**
 * W-UX — the plain-language gate.
 *
 * Two rules the brief states as absolutes, enforced instead of asserted:
 *
 *   1. NO EM DASH in any user-visible string, in any of the four locales.
 *   2. NO HARDCODED user-visible string in a `.tsx`. Copy lives in `messages/*`.
 *
 * Why a script and not a grep: `grep -c '—' **\/*.tsx` reports ~2,400 hits in
 * this repository and every one of them is a code comment. A gate that cannot
 * tell a comment from a rendered string is a gate nobody will keep green, so
 * this strips comments with a small scanner and then looks only at the places
 * text actually reaches a user:
 *
 *   - every string VALUE in `messages/{de,en,tr,ru}.json`
 *   - JSX text nodes
 *   - string literals passed to user-visible props (title, description, label…)
 *   - string values in the shell copy modules
 *
 * It also checks the vocabulary the brief fixes, because "Nicht belegt" is not
 * a style preference: `belegt` reads as OCCUPIED to a property manager, which
 * is the opposite of "no value recorded".
 *
 * Usage:
 *   node scripts/check-plain-language.mjs           # gate, exit 1 on any error
 *   node scripts/check-plain-language.mjs --list    # print every finding
 */

import { readFile, readdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const WEB = path.join(REPO, "apps", "web")
const MESSAGES = path.join(WEB, "messages")
const LOCALES = ["de", "en", "tr", "ru"]

const EM_DASH = "—"
/** The horizontal bar is an em dash by another name. */
const BANNED_DASHES = ["—", "―"]
/**
 * An en dash is NOT banned outright: `1–20 von 656` is correct German
 * typography for a numeric range, and replacing it with a hyphen would be a
 * worse string, not a plainer one. It is only a finding in prose, so it is
 * allowed when it sits between two numbers or two placeholders with no spaces.
 */
const EN_DASH = "–"
const EN_DASH_AS_RANGE = /(\d|\})–(\d|\{)/u

/**
 * Props whose string value is rendered to a user. Deliberately a list rather
 * than "everything that is not className": a denylist lets a new prop through
 * silently, and silence is what this gate exists to remove.
 */
const VISIBLE_PROPS = new Set([
  "title", "description", "label", "placeholder", "message", "header",
  "alt", "caption", "hint", "heading", "subtitle", "summary", "text",
  "retryLabel", "actionLabel", "emptyLabel", "errorLabel", "loadingLabel",
  "confirmLabel", "cancelLabel", "submitLabel", "buttonLabel", "noValue",
  "aria-label", "aria-description", "aria-placeholder",
])

/** Values that are tokens, not prose. */
const TOKEN = /^[a-z0-9_\-.:/#@[\]{}()$*+?^|\\%,;=&!~<>"' ]*$/i
const HAS_LETTERS = /\p{L}{2,}/u

/** Vocabulary the brief replaces, and why. Checked against message VALUES. */
const BANNED_VOCAB = [
  { re: /nicht belegt/i, why: '"belegt" reads as OCCUPIED to a property manager. Use "Keine Angabe".' },
  { re: /belegte angaben/i, why: '"belegt" reads as OCCUPIED. Say what is missing, not what is "unproven".' },
  { re: /\bmodelliert\b/i, why: 'Say what it means: "Preis nicht von der Quelle bestätigt".' },
  { re: /cockpit/i, why: "Internal jargon. Use „Quellen und Nachweise“." },
  { re: /\bdeals\b/i, why: "Untranslated English among German labels. Use „Abschlüsse“." },
  { re: /\bQA\b/, why: "QA is our word, not the user's." },
  { re: /demo-daten/i, why: 'Jargon. Use "Beispieldaten" and keep the honesty.' },
  { re: /virtualisiert|virtualised|virtualized/i, why: "Implementation detail." },
  { re: /synthetische|synthetic/i, why: "Developer word." },
  { re: /\bDataTable\b|\bdata table\b/i, why: "A component name, not a thing a user has heard of." },
  { re: /\bZeilen\b|\brows\b/i, why: 'Nobody outside engineering says "rows". Use "Einheiten".' },
  { re: /^(ready|loading|empty|error)$/i, why: "State-machine names are not button labels." },
]

// ---------------------------------------------------------------------------

/**
 * Remove `//` and block comments without disturbing string or template
 * contents, so a comment cannot hide a violation and a string containing `//`
 * (a URL) is not truncated. Returns the same number of lines, so reported line
 * numbers stay true to the file on disk.
 */
export function stripComments(source) {
  let out = ""
  let i = 0
  let state = "code"
  let quote = ""
  while (i < source.length) {
    const c = source[i]
    const next = source[i + 1]
    if (state === "code") {
      if (c === "/" && next === "/") { state = "line-comment"; i += 2; continue }
      if (c === "/" && next === "*") { state = "block-comment"; i += 2; continue }
      if (c === '"' || c === "'" || c === "`") { state = "string"; quote = c; out += c; i++; continue }
      out += c; i++; continue
    }
    if (state === "line-comment") {
      if (c === "\n") { state = "code"; out += c }
      i++; continue
    }
    if (state === "block-comment") {
      if (c === "*" && next === "/") { state = "code"; i += 2; continue }
      if (c === "\n") out += c
      i++; continue
    }
    // string
    if (c === "\\") { out += c + (next ?? ""); i += 2; continue }
    if (c === quote) { state = "code"; quote = "" }
    out += c; i++
  }
  return out
}

function linesOf(text) { return text.split(/\r?\n/) }

/**
 * Which banned dash a string contains, or null. An en dash used as a numeric
 * range separator is deliberately allowed; see EN_DASH_AS_RANGE.
 */
function dashFinding(value) {
  for (const dash of BANNED_DASHES) if (value.includes(dash)) return dash
  if (value.includes(EN_DASH) && !EN_DASH_AS_RANGE.test(value)) return EN_DASH
  return null
}

/** Line number of a key in a JSON source, so a finding points at the real line. */
function lineOfKey(lines, keyPath) {
  const leaf = keyPath.split(".").pop() ?? keyPath
  const needle = `"${leaf}"`
  const idx = lines.findIndex((l) => l.includes(needle))
  return idx + 1
}

function walkJson(value, keyPath, visit) {
  if (typeof value === "string") { visit(keyPath, value); return }
  if (Array.isArray(value)) { value.forEach((v, i) => walkJson(v, `${keyPath}[${i}]`, visit)); return }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) walkJson(v, keyPath ? `${keyPath}.${k}` : k, visit)
  }
}

async function tsxFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await tsxFiles(full, acc)
    else if (entry.name.endsWith(".tsx")) acc.push(full)
  }
  return acc
}

// ---------------------------------------------------------------------------

const findings = []
const add = (rule, file, line, detail, text) =>
  findings.push({ rule, file: path.relative(REPO, file).replace(/\\/g, "/"), line, detail, text })

/** 1. Message catalogues — every value is user-visible by definition. */
async function checkMessages() {
  let strings = 0
  for (const locale of LOCALES) {
    const file = path.join(MESSAGES, `${locale}.json`)
    if (!existsSync(file)) { add("messages-missing", file, 0, `no ${locale}.json`, ""); continue }
    const raw = await readFile(file, "utf8")
    const lines = linesOf(raw)
    const doc = JSON.parse(raw)
    walkJson(doc, "", (keyPath, value) => {
      strings++
      const lineNo = lineOfKey(lines, keyPath)
      const dash = dashFinding(value)
      if (dash) {
        add("em-dash", file, lineNo, `${keyPath} contains ${dash === EM_DASH ? "an em dash" : `a "${dash}" in prose`}`, value)
      }
      for (const { re, why } of BANNED_VOCAB) {
        if (re.test(value)) add("vocabulary", file, lineNo, `${keyPath}: ${why}`, value)
      }
    })
  }
  return strings
}

/** 2. `.tsx` — hardcoded user-visible text, and em dashes outside comments. */
async function checkTsx() {
  const files = [...(await tsxFiles(path.join(WEB, "app"))), ...(await tsxFiles(path.join(WEB, "components")))]
  for (const file of files) {
    const raw = await readFile(file, "utf8")
    const code = stripComments(raw)
    const lines = linesOf(code)

    lines.forEach((line, idx) => {
      const lineNo = idx + 1

      // Dashes anywhere in real code (comments are already gone).
      const lineDash = dashFinding(line)
      if (lineDash) {
        add("em-dash", file, lineNo, `${lineDash === EM_DASH ? "em dash" : `"${lineDash}" in prose`} in code`, line.trim())
      }

      // A user-visible prop given a bare string literal.
      for (const m of line.matchAll(/(\b[a-zA-Z-]+)=\{?["']([^"']{2,})["']\}?/g)) {
        const [, prop, value] = m
        if (!VISIBLE_PROPS.has(prop)) continue
        if (!HAS_LETTERS.test(value)) continue
        if (TOKEN.test(value) && !/\s/.test(value)) continue
        add("hardcoded-prop", file, lineNo, `${prop}="${value}" is user-visible and not from messages/*`, value)
      }

      // JSX text node: >Some words< on one line, not an expression.
      for (const m of line.matchAll(/>([^<>{}\n]{3,})</g)) {
        const value = m[1].trim()
        if (!value || !HAS_LETTERS.test(value)) continue
        if (TOKEN.test(value) && !/\s/.test(value)) continue
        if (/^[\d\s.,%:+-]+$/.test(value)) continue
        add("hardcoded-jsx-text", file, lineNo, `JSX text "${value}" is not from messages/*`, value)
      }
    })
  }
  return files.length
}

/** 3. Copy modules that are not `.tsx` but hold four-locale user copy. */
async function checkCopyModules() {
  const candidates = ["lib/dashboard-home-copy.ts", "lib/users-copy.ts"]
  for (const rel of candidates) {
    const file = path.join(WEB, rel)
    if (!existsSync(file)) continue
    const code = stripComments(await readFile(file, "utf8"))
    linesOf(code).forEach((line, idx) => {
      const d = dashFinding(line)
      if (d) add("em-dash", file, idx + 1, `${d === EM_DASH ? "em dash" : `"${d}" in prose`} in shell copy`, line.trim())
      for (const { re, why } of BANNED_VOCAB) {
        const m = /["']([^"']{2,})["']/.exec(line)
        if (m && re.test(m[1])) add("vocabulary", file, idx + 1, why, m[1])
      }
    })
  }
}

// ---------------------------------------------------------------------------

const stringCount = await checkMessages()
const fileCount = await checkTsx()
await checkCopyModules()

const byRule = {}
for (const f of findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1

console.log("W-UX plain-language gate")
console.log(`  scanned : ${stringCount} message strings across ${LOCALES.length} locales, ${fileCount} .tsx files`)
console.log("")
console.log("  rule                  count")
console.log("  --------------------- -----")
for (const rule of ["em-dash", "vocabulary", "hardcoded-prop", "hardcoded-jsx-text", "messages-missing"]) {
  console.log(`  ${rule.padEnd(21)} ${String(byRule[rule] ?? 0).padStart(5)}`)
}
console.log("")

if (process.argv.includes("--list")) {
  for (const f of findings) {
    console.log(`  ${f.rule.padEnd(19)} ${f.file}:${f.line}`)
    console.log(`      ${f.detail}`)
    if (f.text && f.text !== f.detail) console.log(`      > ${f.text.slice(0, 150)}`)
  }
  console.log("")
}

if (findings.length === 0) {
  console.log("  0 findings. Every user-visible string is in messages/*, and none contains an em dash.")
  process.exit(0)
}
console.log(`  ${findings.length} finding(s). Run with --list to see each one.`)
process.exit(1)
