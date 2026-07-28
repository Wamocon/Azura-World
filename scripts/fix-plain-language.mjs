#!/usr/bin/env node
/**
 * W-UX — one-shot rewrite for the plain-language gate.
 *
 * Kept in the repo rather than run ad hoc, because the German rewrites below are
 * editorial decisions and the next person should be able to see what changed and
 * why, not just find 122 altered strings in a diff.
 *
 * Three passes:
 *   1. VOCABULARY (brief §2)  — exact, mandated substitutions, all four locales.
 *   2. GERMAN EM DASHES (§3)  — hand-written per key. German is authoritative
 *      and this copy is client-facing, so none of it is machine-transformed.
 *   3. OTHER LOCALES (§3)     — structural transform of the same sentence shapes.
 *      An em dash between two full clauses becomes a full stop; before an
 *      appositive or in a title it becomes a colon. Flagged in the handoff as
 *      needing a native read, because a transform that only *looks* finished is
 *      the failure this project names explicitly.
 *
 * Idempotent: re-running changes nothing once the strings are clean.
 *
 *   node scripts/fix-plain-language.mjs           # apply
 *   node scripts/fix-plain-language.mjs --dry-run
 */

import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const MESSAGES = path.join(REPO, "apps", "web", "messages")
const DRY = process.argv.includes("--dry-run")

// ---------------------------------------------------------------------------
// 1. Vocabulary — brief §2. The null placeholder is the important one: it was
//    an em dash, which is both the tell this task removes AND tells the reader
//    nothing. "Keine Angabe" is honest; blank and 0 are not (§6).
// ---------------------------------------------------------------------------

const VOCABULARY = {
  de: {
    "evidence.label.noValue": "Keine Angabe",
    "evidence.confidence.gap": "Keine Angabe",
    "evidence.confidenceShort.gap": "Keine Angabe",
    "evidence.modelled": "Preis nicht von der Quelle bestätigt",
    "evidence.method.modelled": "Preis nicht von der Quelle bestätigt",
    "common.pagination.rowsPerPage": "Einträge pro Seite",
    "common.table.noRows": "Keine Einträge",
    "dashboard.evidence.title": "Quellen und Nachweise",
    "dashboard.units.provenance.modelledMeaning": "Preis nicht von der Quelle bestätigt",
    "dashboard.units.split.rowNote": "Preis nicht von der Quelle bestätigt",
  },
  en: {
    "evidence.label.noValue": "Not stated",
    "evidence.confidence.gap": "Not stated",
    "evidence.confidenceShort.gap": "Not stated",
    "evidence.modelled": "Price not confirmed by the source",
    "evidence.method.modelled": "Price not confirmed by the source",
    "common.pagination.rowsPerPage": "Entries per page",
    "common.table.noRows": "No entries",
    "dashboard.evidence.title": "Sources and evidence",
    "dashboard.units.provenance.modelledMeaning": "Price not confirmed by the source",
    "dashboard.units.split.rowNote": "Price not confirmed by the source",
  },
  tr: {
    "evidence.label.noValue": "Belirtilmemiş",
    "evidence.confidence.gap": "Belirtilmemiş",
    "evidence.confidenceShort.gap": "Belirtilmemiş",
    "evidence.modelled": "Fiyat kaynak tarafından doğrulanmadı",
    "evidence.method.modelled": "Fiyat kaynak tarafından doğrulanmadı",
    "common.pagination.rowsPerPage": "Sayfa başına kayıt",
    "common.table.noRows": "Kayıt yok",
    "dashboard.evidence.title": "Kaynaklar ve belgeler",
    "dashboard.units.provenance.modelledMeaning": "Fiyat kaynak tarafından doğrulanmadı",
    "dashboard.units.split.rowNote": "Fiyat kaynak tarafından doğrulanmadı",
  },
  ru: {
    "evidence.label.noValue": "Нет данных",
    "evidence.confidence.gap": "Нет данных",
    "evidence.confidenceShort.gap": "Нет данных",
    "evidence.modelled": "Цена не подтверждена источником",
    "evidence.method.modelled": "Цена не подтверждена источником",
    "common.pagination.rowsPerPage": "Записей на странице",
    "common.table.noRows": "Нет записей",
    "dashboard.evidence.title": "Источники и подтверждения",
    "dashboard.units.provenance.modelledMeaning": "Цена не подтверждена источником",
    "dashboard.units.split.rowNote": "Цена не подтверждена источником",
  },
}

// ---------------------------------------------------------------------------
// 2. German em dashes — hand-written, one key at a time.
//
// Three shapes recur, and each takes a different fix:
//   title/label  "A — B"      -> colon, because B names what A contains
//   appositive   "A — kein B" -> comma, because B qualifies A rather than
//                                starting a new statement
//   two clauses  "A — B verb" -> full stop, because it IS two sentences and the
//                                dash was doing a full stop's job
// ---------------------------------------------------------------------------

const GERMAN = {
  "evidence.confidence.conflicted_long":
    "Quellen widersprechen sich. Beide Werte sind erfasst.",
  "landing.topBar.notice": "Evidenzbasierte Wettbewerbsanalyse. Jede Zahl mit Quelle.",
  "landing.hero.subtitle":
    "Wohnanlage und 5-Sterne-Hotel an der türkischen Mittelmeerküste, vollständig belegt, Zahl für Zahl.",
  "landing.hero.conflictCallout":
    "Drei dieser vier Zahlen sind mehrfach bestätigt. Die vierte nicht. Die Seite sagt das an derselben Stelle, in derselben Schrift.",
  "landing.immersion.lead":
    "Dieselbe Anlage über den Tagesverlauf. Licht, Belegung und Betrieb ändern sich, die Daten dahinter bleiben dieselben.",
  "landing.amenities.gapBody":
    "Aus 60 abgerufenen Quellen liess sich keine Ausstattungsliste gewinnen, die einzeln zuordenbar wäre. Der Datensatz führt deshalb null Positionen. Eine plausible Liste stünde hier schnell. Sie wäre nur nicht belegt.",
  "landing.desire.lead":
    "Ein 5-Sterne-Haus mit All-inclusive-Betrieb direkt auf der Anlage. Das ist der Unterschied zu vergleichbaren Projekten in der Region.",
  "landing.evidenceBand.lead":
    "Jede Angabe auf dieser Seite ist mit ihrer Quelle verknüpft. Wo Quellen sich widersprechen, steht der Widerspruch hier. Er wird nicht aufgelöst.",
  "landing.evidenceBand.priceHeading": "F-002: vier Herausgeber, vier Preise",
  "landing.evidenceBand.priceIntro":
    "Dieselbe Wohnungsgrösse, vier Anbieter, ein Faktor von {factor}. Zwei Währungen, keine Beobachtungsdaten, mindestens ein veraltetes Inserat. Nicht aufgelöst. Die Werte stehen nebeneinander.",
  "landing.after.lead":
    "Verwaltung, Nebenkosten, Vermietung und Instandhaltung. Der Teil, den Verkaufsseiten auslassen.",
  "landing.after.items.1.body":
    "Alle 656 Einheiten mit Eigentümer, Vertrag und Zahlungsstand. Reale Inserate und modellierte Datensätze bleiben unterscheidbar.",
  "landing.after.items.3.body":
    "Dieselbe Herkunftsanzeige wie auf dieser Seite, in der Verwaltung, im Report und im Export.",
  "landing.provenance.conflict.unresolvedNote":
    "Bewusst nicht aufgelöst. Kein Mittelwert, kein Median, keine „wahrscheinlichste“ Auswahl. Jede einzelne Zahl hier wäre eine Erfindung mit einer Quellenangabe daran.",
  "landing.masterplan.schematicNote":
    "Schematisch. Keine Quelle veröffentlicht die Gebäudegeometrie. Dargestellt ist die Zusammensetzung, nicht der Grundriss. Block wählen für Details.",
  "dashboard.evidence.unstatedLead":
    "Diese Portale nennen einen Preis, ohne den Grundriss anzugeben. Sie stehen deshalb nicht auf der Skala oben. Welchen Wohnungstyp sie beschreiben, sagt die Quelle nicht. Aufgeführt werden sie trotzdem: Alanya-Homes Einstiegspreis gehört zu den vier Angaben, die Befund F-002 nennt.",
  "dashboard.listings.lead":
    "Dieselbe Wohnung auf mehreren Portalen, mit Preis, Datum und Abweichung.",
  "hotel.lead":
    "Das 5-Sterne-Haus auf dem Gelände der Anlage, mit seinen Bewertungen, seinen Widersprüchen und den Quellen, die beides belegen.",
  "hotel.meta.title": "Azura World Hotel: Bewertungen und Quellen",
  "hotel.rebrand.body":
    "Bis zur Umbenennung lief das Haus unter {formerName}. Buchungsportale führen es teilweise weiter unter dem alten Namen und der alten Adresse. Wer das nicht weiß, findet zwei Objekte, wo nur eines ist.",
  "hotel.facts.intro":
    "Jede Angabe führt auf die Quelle zurück, aus der sie stammt. Wo Quellen sich widersprechen, steht der Widerspruch an der Zahl, nicht in einer Fußnote.",
  "hotel.reviews.noAverageNote":
    "Es gibt hier keinen Gesamtwert. 4,6 von 5 und 6,7 von 10 lassen sich nicht verrechnen. Jede Zahl, die dabei herauskäme, hätte keine Quelle. Die Plattformen stehen deshalb nebeneinander, nicht übereinander.",
  "hotel.platform.syndicatedNote":
    "Dieselbe Wertung wird von weiteren Seiten ausgeliefert. Das ist keine zweite, unabhängige Bewertung. Es ist dieselbe Zahl mit einem anderen Logo davor.",
  "hotel.verdict.intro":
    "Links die niedrigste, rechts die höchste Bewertung, die dieser Abruf gefunden hat, bei gleicher Breite und gleicher Schriftgröße. Beide werden rechnerisch aus derselben Liste bestimmt. Eine Ansicht, die nur die guten zeigt, ist hier baulich nicht möglich.",
  "hotel.unrecovered.intro":
    "Diese Portale wurden angefragt und lieferten keinen verwertbaren Inhalt. Sie fehlen nicht. Sie wurden versucht, und das Ergebnis steht hier. Eine von Booking.com erzeugte Wertung liegt trotzdem vor: sie wurde als Badge auf einer fremden Seite gefunden, nicht auf booking.com selbst. Die Plattformkarte oben nennt deshalb die Seite, die sie ausgeliefert hat.",
  "hotel.provenance.unresolvedNote":
    "Bewusst nicht aufgelöst. Kein Mittelwert, kein Median, keine „wahrscheinlichste“ Auswahl. Jede einzelne Zahl, die dabei herauskäme, wäre eine Erfindung mit einer Quellenangabe daran.",
  "report.lead":
    "Der Datenbestand zu Azura World. Dieselben Zahlen, dieselben Quellen, ohne Anmeldung.",
  "concierge.subtitle":
    "Fragen zum Projekt, beantwortet ausschließlich aus dem belegten Datenbestand.",
}

// ---------------------------------------------------------------------------
// 3. Structural transform for en / tr / ru.
// ---------------------------------------------------------------------------

/** Sentence-ending punctuation, per script. Cyrillic and Latin share these. */
const ENDS_CLAUSE = /[.!?:;,]$/

/**
 * Replace an em dash with the punctuation the sentence actually needs.
 *
 * A short string with no sentence punctuation is a title, and a title's dash is
 * doing a colon's job. Otherwise the dash separates two statements, so it
 * becomes a full stop and the next word is capitalised. Where the tail is
 * clearly a fragment (it starts with a lower-case function word that cannot
 * open a sentence) a comma is used instead, because a full stop there would
 * manufacture a sentence with no verb.
 */
const FRAGMENT_OPENERS =
  /^(not|no|and|or|but|with|without|for|from|in|on|at|by|of|the|a|an|ile|ve|veya|ama|için|ile birlikte|и|или|но|с|без|для|от|в|на|по)\b/i

function rewriteEmDashes(value) {
  if (!value.includes("—")) return value
  let out = value

  // " — " with something either side is the only form that carries meaning here.
  out = out.replace(/\s*—\s*/g, (_m, offset, whole) => {
    const before = whole.slice(0, offset)
    const after = whole.slice(offset).replace(/^\s*—\s*/, "")
    const isTitle = whole.length < 60 && !/[.!?]/.test(whole)
    if (isTitle) return ": "
    if (FRAGMENT_OPENERS.test(after)) return ", "
    if (ENDS_CLAUSE.test(before.trim())) return " "
    return ". "
  })

  // Capitalise after a full stop the transform introduced.
  out = out.replace(/\.\s+(\p{Ll})/gu, (m, ch) => `. ${ch.toLocaleUpperCase()}`)
  return out.replace(/\s{2,}/g, " ").trim()
}

// ---------------------------------------------------------------------------

function getPath(obj, dotted) {
  return dotted.split(".").reduce((o, k) => (o == null ? o : o[k]), obj)
}
function setPath(obj, dotted, value) {
  const parts = dotted.split(".")
  const last = parts.pop()
  const target = parts.reduce((o, k) => (o[k] ??= {}), obj)
  const had = target[last] !== value
  target[last] = value
  return had
}
function walk(node, prefix, fn) {
  for (const [k, v] of Object.entries(node)) {
    const p = prefix ? `${prefix}.${k}` : k
    if (typeof v === "string") fn(p, v, node, k)
    else if (v && typeof v === "object") walk(v, p, fn)
  }
}

const summary = []

for (const locale of ["de", "en", "tr", "ru"]) {
  const file = path.join(MESSAGES, `${locale}.json`)
  const doc = JSON.parse(await readFile(file, "utf8"))
  let vocab = 0
  let dashes = 0

  for (const [key, value] of Object.entries(VOCABULARY[locale])) {
    if (getPath(doc, key) === undefined) continue
    if (setPath(doc, key, value)) vocab++
  }

  if (locale === "de") {
    for (const [key, value] of Object.entries(GERMAN)) {
      if (getPath(doc, key) === undefined) continue
      if (setPath(doc, key, value)) dashes++
    }
  }

  // Anything still carrying a dash after the hand-written pass.
  walk(doc, "", (p, v, parent, k) => {
    if (!v.includes("—")) return
    const next = rewriteEmDashes(v)
    if (next !== v) {
      parent[k] = next
      dashes++
    }
  })

  summary.push({ locale, vocab, dashes })
  if (!DRY) await writeFile(file, `${JSON.stringify(doc, null, 2)}\n`, "utf8")
}

for (const s of summary) {
  process.stdout.write(
    `${s.locale}: ${String(s.vocab).padStart(2)} vocabulary · ${String(s.dashes).padStart(2)} em-dash strings rewritten\n`,
  )
}
process.stdout.write(DRY ? "\n--dry-run: nothing written\n" : "\nwritten\n")
