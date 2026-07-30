#!/usr/bin/env node
/**
 * Seed a realistic operating year for the demo.            Owner: W-DEMO
 *
 * `pnpm seed:demo`   ·   `pnpm seed:demo -- --wipe` to replace instead of top up
 *
 * ## Why this exists
 *
 * `supabase/seed.sql` builds the INVENTORY — 656 units, 7 blocks, 47 portal
 * listings, 24 findings, 11 profiles — and stops there. Sixteen operational
 * tables ship empty:
 *
 *   service_tickets · ticket_events · workforce_tasks · activities
 *   documents · compliance_checks · leads · buyer_pipeline_entries
 *   finance_ledger_entries · payment_transactions · wallets · vendor_invoices
 *   threads · messages · notifications · hotel_rooms
 *
 * That is seventeen of the twenty-four dashboard routes with nothing to render.
 * Tickets says "Keine Tickets", Finanzen says "Noch keine Beträge", and the home
 * KPIs read 0 / 0 / 0 — so the demo shows a property-management system that has
 * never managed anything. No amount of visual work fixes that; a restyled empty
 * table is a prettier empty table.
 *
 * PIVOT.md §2 already sanctions the answer: it changed "never invent a number"
 * to "seed a realistic operating year", keeping one half of the old rule without
 * qualification — **demo data is labelled demo data, everywhere, always.**
 *
 * ## How the labelling works
 *
 * Every row this script writes carries `metadata.demo = true` and
 * `metadata.demo_seed = "W-DEMO"` wherever the table has a `metadata` column.
 * That is what makes the disclosure checkable rather than a claim in a footer:
 *
 *   select count(*) from service_tickets where metadata->>'demo' = 'true';
 *
 * It is also what `--wipe` deletes, so this script can never remove a row a
 * human created.
 *
 * ## Determinism
 *
 * No `Math.random()` and no `Date.now()` in the data. IDs are derived from a
 * table tag plus an index, and every variation comes from a seeded LCG, so two
 * runs produce byte-identical rows and re-running is an upsert rather than a
 * second set of records. Dates are computed from a fixed `TODAY` anchor, which
 * keeps a snapshot test stable and means "overdue" stays overdue.
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const WIPE = process.argv.includes("--wipe")

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

function readEnv(key) {
  for (const file of ["apps/web/.env.local", ".env.local"]) {
    try {
      const body = readFileSync(join(repoRoot, file), "utf8")
      const m = body.match(new RegExp(`^${key}=(.*)$`, "m"))
      if (m !== null && m[1].trim().length > 0) return m[1].trim()
    } catch {
      /* next candidate */
    }
  }
  return process.env[key] ?? null
}

const URL_BASE = readEnv("NEXT_PUBLIC_SUPABASE_URL")
const SERVICE_KEY = readEnv("SUPABASE_SERVICE_ROLE_KEY")
if (URL_BASE === null || SERVICE_KEY === null) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")
  process.exit(1)
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
}

async function get(path) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { headers })
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`)
  return res.json()
}

/**
 * Tables whose existing rows must never be updated.
 *
 * `finance_ledger_entries` has a trigger that rejects any UPDATE to a posted
 * row — "posted and immutable. Post a reversal entry instead." That is the
 * ledger's central guarantee and it is correct. It also means the default
 * `resolution=merge-duplicates` upsert fails on a second run, because a
 * re-run tries to merge into rows it wrote the first time.
 *
 * `ignore-duplicates` is the right verb here: the rows are deterministic, so an
 * existing row already holds exactly what this run would have written.
 */
const APPEND_ONLY = new Set(["finance_ledger_entries", "ticket_events"])

async function upsert(table, rows) {
  if (rows.length === 0) return { table, count: 0 }
  const resolution = APPEND_ONLY.has(table) ? "ignore-duplicates" : "merge-duplicates"
  // Chunked: PostgREST will accept a large body but a failure in one 400-row
  // request tells you far less than a failure in one 100-row request.
  let written = 0
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100)
    const res = await fetch(`${URL_BASE}/rest/v1/${table}`, {
      method: "POST",
      headers: { ...headers, Prefer: `resolution=${resolution},return=minimal` },
      body: JSON.stringify(chunk),
    })
    if (!res.ok) {
      throw new Error(`UPSERT ${table} [${i}..] -> ${res.status} ${(await res.text()).slice(0, 400)}`)
    }
    written += chunk.length
  }
  return { table, count: written }
}

/**
 * Which rows belong to this seed.
 *
 * Six of the sixteen tables have no `metadata` column, so the demo marker
 * cannot live in one. Those are matched on the id prefix this script mints
 * instead, which is just as narrow — nothing else in the database issues ids
 * shaped like `b2000001-0000-4000-8000-…`.
 */
const WIPE_FILTER = {
  hotel_rooms: "id=like.a1000001*",
  service_tickets: "metadata->>demo=eq.true",
  ticket_events: "id=like.b3000001*",
  workforce_tasks: "metadata->>demo=eq.true",
  activities: "metadata->>demo=eq.true",
  documents: "metadata->>demo=eq.true",
  compliance_checks: "metadata->>demo=eq.true",
  leads: "metadata->>demo=eq.true",
  buyer_pipeline_entries: "metadata->>demo=eq.true",
  wallets: "id=like.23000001*",
  finance_ledger_entries: "metadata->>demo=eq.true",
  payment_transactions: "id=like.22000001*",
  vendor_invoices: "id=like.24000001*",
  threads: "id=like.31000001*",
  messages: "id=like.32000001*",
  notifications: "id=like.33000001*",
}

async function wipe(table) {
  const filter = WIPE_FILTER[table]
  if (filter === undefined) return false
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?${filter}`, {
    method: "DELETE",
    headers: { ...headers, Prefer: "return=minimal" },
  })
  return res.ok
}

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

/** Seeded LCG. Same constants as Numerical Recipes; any stable PRNG would do. */
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const pick = (r, list) => list[Math.floor(r() * list.length) % list.length]
const between = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1))

/** `id("71c4e75", 3)` -> a stable, valid v4-shaped uuid. */
function uid(tag, n) {
  const t = tag.padEnd(8, "0").slice(0, 8)
  return `${t}-0000-4000-8000-${String(n).padStart(12, "0")}`
}

/** Fixed anchor so "overdue" stays overdue and snapshots stay stable. */
const TODAY = new Date("2026-07-29T09:00:00.000Z")
const DAY = 86_400_000
const at = (days, hours = 0) =>
  new Date(TODAY.getTime() + days * DAY + hours * 3_600_000).toISOString()
const dateAt = (days) => at(days).slice(0, 10)

const DEMO = { demo: true, demo_seed: "W-DEMO" }

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

const COMPANY = "11111111-1111-4111-8111-111111111111"
const SITE = "22222222-2222-4222-8222-222222222222"
const HOTEL = "33333333-3333-4333-8333-333333333333"

const P = {
  admin: "b0000000-0000-4000-8000-000000000001",
  manager: "b0000000-0000-4000-8000-000000000002",
  accountant: "b0000000-0000-4000-8000-000000000003",
  staff: "b0000000-0000-4000-8000-000000000004",
  owner: "b0000000-0000-4000-8000-000000000005",
  tenant: "b0000000-0000-4000-8000-000000000006",
  guest: "b0000000-0000-4000-8000-000000000007",
  vendor: "b0000000-0000-4000-8000-000000000008",
}

const RESIDENT = {
  ownerOne: "d0000000-0000-4000-8000-000000000001",
  ownerTwo: "d0000000-0000-4000-8000-000000000002",
  tenantOne: "d0000000-0000-4000-8000-000000000003",
}

// The three units that actually have residents attached. Everything
// resident-scoped hangs off these, so an owner/tenant login sees its own data
// rather than an empty page — which is the whole point of seeding per role.
const RESIDENT_UNITS = ["AZW-B01-0001", "AZW-B01-0002", "AZW-B01-0003"]

/**
 * Unit -> resident, and which of those residents has a login.
 *
 * THIS MAP IS WHY THE SEED IS VISIBLE TO A NON-ADMIN. The first run left
 * `resident_id` null on every thread and document, and RLS scopes those tables
 * by resident: an owner or tenant signing in got "Dokumente" and "Nachrichten"
 * with nothing under them, while admin saw all 24 and all 12. Caught by the
 * eleven-role sweep, not by reading the seed.
 *
 * `Owner Two` has `profile_id: null` in the database, so rows hung off
 * AZW-B01-0002 are reachable by staff and admin but by no resident login. Unit
 * 0001 belongs to the `owner` account and 0003 to the `tenant` account, so
 * anything that has to be visible to a signed-in resident goes on those two.
 */
const UNIT_RESIDENT = {
  "AZW-B01-0001": RESIDENT.ownerOne,
  "AZW-B01-0002": RESIDENT.ownerTwo,
  "AZW-B01-0003": RESIDENT.tenantOne,
}

/** The two units whose resident actually has a login. */
const LOGIN_UNITS = ["AZW-B01-0001", "AZW-B01-0003"]

const residentOf = (unit) => UNIT_RESIDENT[unit] ?? null

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function hotelRooms() {
  // The 188 rooms as the six types the hotel publishes, not 188 rows: the
  // dataset has a room COUNT, not a room register, and inventing 188 numbered
  // rooms would be fabricating a level of detail no source supports.
  const types = [
    ["STD", "Standardzimmer", "standard", 96, 28, 3, false],
    ["STD-SV", "Standardzimmer Meerblick", "standard", 42, 28, 3, true],
    ["FAM", "Familienzimmer", "family", 28, 42, 5, false],
    ["SUP", "Superior-Zimmer", "superior", 14, 36, 3, true],
    ["SUI", "Suite", "suite", 6, 62, 4, true],
    ["KSUI", "King-Suite", "suite", 2, 88, 4, true],
  ]
  return types.map(([code, name, room_type, room_count, interior_m2, max_occupancy, has_sea_view], i) => ({
    id: uid("a1000001", i + 1),
    hotel_id: HOTEL,
    code,
    name,
    room_type,
    room_count,
    interior_m2,
    max_occupancy,
    has_sea_view,
    sort_order: i,
  }))
}

function tickets() {
  const r = rng(1201)
  const categories = ["maintenance", "cleaning", "technical", "amenity", "security", "billing", "concierge", "inspection", "complaint"]
  const titles = {
    maintenance: ["Wasserhahn im Bad tropft", "Rollladen klemmt", "Türschloss schwergängig", "Heizkörper wird nicht warm", "Fuge im Duschbereich erneuern"],
    cleaning: ["Treppenhaus B03 reinigen", "Tiefgarage kehren", "Poolbereich nach Sturm säubern", "Fensterreinigung Fassade Süd"],
    technical: ["Aufzug B02 bleibt stehen", "Lüftung Tiefgarage laut", "Poolpumpe verliert Druck", "Notbeleuchtung Etage 4 defekt", "Gegensprechanlage ohne Ton"],
    amenity: ["Liegen am Hauptpool ergänzen", "Aquapark-Rutsche gesperrt", "Fitnessgerät wartungsfällig", "Sonnenschirm gerissen"],
    security: ["Schranke Zufahrt öffnet verzögert", "Kamera Eingang Ost ohne Bild", "Zutrittskarte funktioniert nicht"],
    billing: ["Nebenkostenabrechnung unklar", "Doppelte Abbuchung geprüft", "Zahlungserinnerung strittig"],
    concierge: ["Paketannahme außerhalb der Zeiten", "Transferwunsch Flughafen", "Schlüsselübergabe organisieren"],
    inspection: ["Abnahme nach Malerarbeiten", "Brandschutzbegehung Block B05", "Zwischenabnahme Wohnung"],
    complaint: ["Lärm aus Nachbarwohnung", "Rauchen im Treppenhaus", "Falschparker auf Besucherplatz"],
  }
  const rows = []
  const events = []
  for (let i = 1; i <= 42; i++) {
    const category = pick(r, categories)
    const title = pick(r, titles[category])
    const reportedDays = -between(r, 1, 240)
    // Status is a function of age, so the board reads like a real one: old
    // tickets are mostly closed and this week's are mostly open.
    const age = -reportedDays
    let status
    if (age > 120) status = pick(r, ["closed", "closed", "resolved", "cancelled"])
    else if (age > 40) status = pick(r, ["resolved", "closed", "in_progress"])
    else if (age > 10) status = pick(r, ["in_progress", "assigned", "blocked", "resolved"])
    else status = pick(r, ["open", "assigned", "in_progress"])

    const priority = pick(r, ["low", "normal", "normal", "high", "urgent"])
    const slaHours = { urgent: 4, high: 24, normal: 72, low: 168 }[priority]

    // THE SLA HAS TO BE MOSTLY MET, or the board is a wall of red and the
    // badge stops carrying information. The first build set `sla_due_at` to
    // `reported_at + slaHours` for every ticket; since every ticket is in the
    // past, all 42 rendered "Frist überschritten" and the home KPI read
    // "SLA überschritten 42". Screenshotted, and it made the demo look like an
    // operation that has never once hit a deadline.
    //
    // So a breach is chosen deliberately, for one ticket in six, and the due
    // date is pushed out for the rest — far enough that an old open ticket is
    // still inside its window.
    const breaches = i % 6 === 0
    const slaOffsetDays = breaches ? 0 : age + between(r, 2, 20)
    const assigned = status === "open" ? null : pick(r, [P.staff, P.vendor, P.manager])
    const resolved = ["resolved", "closed"].includes(status)
    const cost = r() > 0.55 ? between(r, 40, 2400) : null
    const id = uid("b2000001", i)

    rows.push({
      id,
      company_id: COMPANY,
      site_id: SITE,
      unit_id: r() > 0.45 ? pick(r, RESIDENT_UNITS) : null,
      ticket_no: `TCK-${String(1000 + i)}`,
      title,
      description: `${title}. Gemeldet über das Bewohnerportal, Standort Azura World Türkler.`,
      category,
      priority,
      status,
      severity: priority === "urgent" ? "critical" : priority === "high" ? "major" : "moderate",
      requester_profile_id: pick(r, [P.tenant, P.owner, P.guest]),
      assignee_profile_id: assigned,
      reported_at: at(reportedDays),
      sla_due_at: at(reportedDays + slaOffsetDays, slaHours),
      resolved_at: resolved ? at(reportedDays + between(r, 1, 9)) : null,
      closed_at: status === "closed" ? at(reportedDays + between(r, 2, 12)) : null,
      // `service_tickets_cost_needs_currency`: both or neither. Shipping a
      // currency beside a null cost is what the constraint exists to reject.
      estimated_cost: cost,
      currency: cost === null ? null : "EUR",
      requires_finance_approval: r() > 0.82,
      metadata: { ...DEMO },
    })

    // EVERY event carries the SAME key set. PostgREST rejects a bulk insert
    // whose objects differ in shape ("All object keys must match") rather than
    // filling the gaps, so an optional column has to be an explicit null.
    const event = (n, kind, actor, from, to, note, when) => ({
      id: uid("b3000001", i * 10 + n),
      ticket_id: id,
      company_id: COMPANY,
      kind,
      actor_profile_id: actor,
      from_status: from,
      to_status: to,
      note,
      payload: { ...DEMO },
      created_at: when,
    })
    events.push(event(1, "created", P.tenant, null, "open", "Meldung eingegangen.", at(reportedDays)))
    if (assigned !== null) {
      events.push(event(2, "assigned", P.manager, "open", "assigned", "Zugewiesen an den technischen Dienst.", at(reportedDays, 3)))
    }
    if (resolved) {
      events.push(event(3, "resolved", assigned ?? P.staff, "in_progress", "resolved", "Arbeiten abgeschlossen, Rückmeldung an den Melder.", at(reportedDays + 2)))
    }
  }
  return { rows, events }
}

function workforceTasks(ticketRows) {
  const r = rng(2202)
  const teams = ["Technik", "Reinigung", "Garten", "Sicherheit", "Pool"]
  return ticketRows
    .filter((t) => t.assignee_profile_id !== null)
    .slice(0, 26)
    .map((t, i) => {
      const done = ["resolved", "closed"].includes(t.status)
      return {
        id: uid("c4000001", i + 1),
        company_id: COMPANY,
        site_id: SITE,
        ticket_id: t.id,
        unit_id: t.unit_id,
        assignee_profile_id: t.assignee_profile_id,
        task_no: `WF-${String(2000 + i)}`,
        title: t.title,
        team: pick(r, teams),
        status: done ? pick(r, ["completed", "verified"]) : pick(r, ["assigned", "in_progress", "blocked"]),
        priority: t.priority,
        sla_due_at: t.sla_due_at,
        started_at: t.reported_at,
        completed_at: done ? t.resolved_at : null,
        checklist: {
          ...DEMO,
          steps: [
            { label: "Vor Ort geprüft", done: true },
            { label: "Material beschafft", done: done },
            { label: "Ausgeführt", done: done },
            { label: "Abgenommen", done: done && r() > 0.4 },
          ],
        },
        field_note: done ? "Ausgeführt und abgenommen." : "In Bearbeitung.",
        metadata: { ...DEMO },
      }
    })
}

function activities() {
  const r = rng(3303)
  const set = [
    ["wellness", "Yoga am Pool", "Poolterrasse", 20],
    ["wellness", "Aqua-Fitness", "Hauptpool", 16],
    ["sports", "Tennisturnier", "Tennisplatz", 16],
    ["sports", "Beachvolleyball", "Strandbereich", 12],
    ["kids", "Kinderclub Basteln", "Kinderclub", 24],
    ["kids", "Schatzsuche im Garten", "Gartenanlage", 30],
    ["social", "Willkommensabend", "Lobby-Bar", 60],
    ["social", "Livemusik am Abend", "Poolbar", 80],
    ["dining", "Türkischer Abend", "Hauptrestaurant", 120],
    ["dining", "Grillabend am Strand", "Strandbereich", 70],
    ["excursion", "Ausflug Alanya-Burg", "Treffpunkt Lobby", 25],
    ["maintenance_window", "Wartung Poolpumpe", "Technikraum", null],
  ]
  const rows = []
  for (let i = 0; i < 30; i++) {
    const [category, title, location, capacity] = set[i % set.length]
    const day = -14 + i
    const hour = between(r, 9, 20)
    rows.push({
      id: uid("d5000001", i + 1),
      company_id: COMPANY,
      site_id: SITE,
      title,
      description: `${title} auf der Anlage Azura World.`,
      category,
      starts_at: at(day, hour),
      ends_at: at(day, hour + 2),
      capacity,
      location,
      status: day < 0 ? "completed" : day === 0 ? "in_progress" : pick(r, ["scheduled", "open", "open", "full"]),
      organiser_profile_id: P.staff,
      metadata: { ...DEMO },
    })
  }
  return rows
}

function documents() {
  const r = rng(4404)
  // `category` is a CHECK, not a free string. These twelve are the allowed
  // values (documents_category); anything else is rejected at insert.
  const set = [
    ["Kaufvertrag", "contract", "vertraege"],
    ["Übergabeprotokoll", "handover", "protokolle"],
    ["Energieausweis", "permit", "nachweise"],
    ["Hausordnung", "general", "allgemein"],
    ["Nebenkostenabrechnung 2025", "invoice", "finanzen"],
    ["Brandschutzprotokoll", "inspection", "protokolle"],
    ["Wartungsvertrag Aufzug", "contract", "vertraege"],
    ["Versicherungspolice Gebäude", "insurance", "nachweise"],
    ["Eigentumsurkunde", "title_deed", "nachweise"],
    ["Abnahmeprotokoll Malerarbeiten", "handover", "protokolle"],
    ["Prüfbericht Poolwasser", "inspection", "protokolle"],
    ["Schriftverkehr Bauträger", "correspondence", "allgemein"],
  ]
  return set.flatMap(([title, category, folder], i) =>
    [0, 1].map((k) => {
      const n = i * 2 + k + 1
      const unit = LOGIN_UNITS[n % LOGIN_UNITS.length]
      /**
       * A RESIDENT'S READ PATH NEEDS BOTH `visibility = 'unit'` AND
       * `review_status = 'approved'`.
       *
       * That is the policy's own comment, and it is deliberate: "an unreviewed
       * document is not shown to the person it is about." The first seed made
       * everything `private` and 40% unreviewed, so a tenant signing in saw the
       * Dokumente page with nothing on it while admin saw all 24. Found by the
       * role sweep.
       *
       * Two thirds are now resident-visible and approved. The remaining third
       * stays private and pending on purpose, because a document register where
       * everything is already approved does not show the review step existing.
       */
      const residentVisible = n % 3 !== 0
      const reviewed = residentVisible
      return {
        id: uid("e6000001", n),
        company_id: COMPANY,
        site_id: SITE,
        // Weighted to the two units with a login behind them, so a signed-in
        // owner or tenant has documents of their own to look at.
        unit_id: unit,
        resident_id: residentOf(unit),
        title: k === 0 ? title : `${title} (Nachtrag)`,
        category,
        storage_bucket: "azura-documents",
        // A path, not a file. The bucket does not exist yet
        // (`verify:supabase` warns about it), so a download would 404 — the row
        // is the register entry, and the UI is honest that the file is pending.
        storage_path: `${folder}/${String(n).padStart(3, "0")}-${category}.pdf`,
        original_filename: `${category}-${n}.pdf`,
        mime_type: "application/pdf",
        size_bytes: between(r, 48_000, 3_400_000),
        visibility: residentVisible ? "unit" : "private",
        // `documents_review_decision_recorded`: anything other than
        // `pending_review` must name the reviewer AND the time. There is no
        // "changes_requested" — the CHECK allows three values only.
        review_status: reviewed ? "approved" : "pending_review",
        retention_class: category === "contract" ? "legal" : "general",
        expires_at: category === "insurance" ? at(between(r, 30, 400)) : null,
        uploaded_by: P.manager,
        reviewed_by: reviewed ? P.admin : null,
        reviewed_at: reviewed ? at(-between(r, 1, 90)) : null,
        metadata: { ...DEMO },
      }
    })
  )
}

function compliance() {
  const r = rng(5505)
  // Both `check_type` and `status` are CHECKs. The first build invented
  // plausible-sounding types (elevator_inspection, pool_water_quality) and an
  // "overdue" status; none of them exist. Overdue is expressed by a `due_at` in
  // the past on a still-`pending` check, which is what the UI reads anyway.
  const checks = [
    ["fire_safety", "Brandschutzprüfung", "high"],
    ["occupancy_permit", "Nutzungsgenehmigung", "high"],
    ["building_permit", "Baugenehmigung", "high"],
    ["energy_certificate", "Energieausweis", "medium"],
    ["earthquake_certificate", "Erdbebennachweis", "critical"],
    ["insurance", "Versicherungsnachweis", "medium"],
    ["gdpr_consent", "Einwilligungen nach KVKK", "medium"],
    ["tax_registration", "Steuerliche Registrierung", "low"],
    ["title_deed", "Eigentumsnachweis", "high"],
    ["contract_review", "Vertragsprüfung", "medium"],
    ["vendor_due_diligence", "Lieferantenprüfung", "low"],
    ["kyc_identity", "Identitätsprüfung", "medium"],
  ]
  return checks.map(([check_type, label, risk_level], i) => {
    const overdue = i % 5 === 0
    const decided = !overdue && r() > 0.45
    return {
      id: uid("f7000001", i + 1),
      company_id: COMPANY,
      site_id: SITE,
      subject_type: "site",
      subject_id: SITE,
      check_type,
      status: overdue ? "pending" : decided ? "passed" : "in_review",
      risk_level,
      rationale: `${label} nach Betreibervorgabe. Turnus und Fristen sind für die Vorführung angesetzt.`,
      human_decision_required: true,
      decided_by: decided ? P.admin : null,
      decided_at: decided ? at(-between(r, 5, 120)) : null,
      due_at: overdue ? at(-between(r, 3, 40)) : at(between(r, 5, 180)),
      metadata: { ...DEMO },
    }
  })
}

function leadsAndPipeline() {
  const r = rng(6606)
  const names = ["Anna Weber", "Mehmet Yılmaz", "Ольга Смирнова", "James Carter", "Sofia Rossi", "Lukas Braun", "Elif Demir", "Иван Петров", "Claire Dubois", "Marco Bianchi", "Ayşe Kaya", "Nina Fischer", "Tom Hayes", "Дмитрий Орлов", "Julia Schmidt", "Emre Şahin", "Laura Moretti", "Peter Novak", "Мария Иванова", "Sarah König", "Ahmet Öztürk", "David Klein", "Chiara Ferrari", "Hannah Vogel"]
  const layouts = ["1+1", "2+1", "3+1", "4+1", "penthouse", "villa"]
  const sources = ["website", "portal", "referral", "walk_in", "phone", "social", "partner_agent", "exhibition"]
  const statuses = ["new", "contacted", "qualified", "viewing_booked", "offer_made", "negotiating", "won", "lost", "dormant"]

  const leadRows = []
  const pipelineRows = []
  for (let i = 0; i < names.length; i++) {
    const id = uid("11000001", i + 1)
    const status = statuses[i % statuses.length]
    const created = -between(r, 3, 300)
    leadRows.push({
      id,
      company_id: COMPANY,
      site_id: SITE,
      unit_id: r() > 0.5 ? pick(r, RESIDENT_UNITS) : null,
      reference: `LEA-${String(3000 + i)}`,
      full_name: names[i],
      email: `lead${i + 1}@example.invalid`,
      phone: `+49 30 ${String(1000000 + i * 7919).slice(0, 7)}`,
      locale: pick(r, ["de", "en", "tr", "ru"]),
      status,
      source: pick(r, sources),
      budget_amount: between(r, 12, 62) * 10_000,
      budget_currency: "EUR",
      desired_layout: pick(r, layouts),
      assigned_to: P.manager,
      score: between(r, 20, 98),
      notes: "Interesse an der Anlage. Kontaktdaten sind Beispieldaten.",
      last_contacted_at: at(created + between(r, 1, 20)),
      next_action_at: ["won", "lost", "dormant"].includes(status) ? null : at(between(r, 1, 21)),
      lost_reason: status === "lost" ? "Budget nicht ausreichend." : null,
      consent_marketing: r() > 0.4,
      metadata: { ...DEMO },
      created_at: at(created),
    })

    if (!["new", "dormant"].includes(status)) {
      const stage = { contacted: "qualification", qualified: "qualification", viewing_booked: "viewing", offer_made: "reservation", negotiating: "contract", won: "handover", lost: "closed" }[status] ?? "enquiry"
      pipelineRows.push({
        id: uid("12000001", i + 1),
        company_id: COMPANY,
        lead_id: id,
        unit_id: leadRows[i].unit_id,
        stage,
        entered_stage_at: at(created + between(r, 2, 30)),
        expected_close: dateAt(between(r, 10, 120)),
        deal_amount: leadRows[i].budget_amount,
        deal_currency: "EUR",
        probability: status === "won" ? 100 : status === "lost" ? 0 : between(r, 15, 85),
        owner_profile_id: P.manager,
        blocker: status === "negotiating" ? "Wartet auf Finanzierungszusage." : null,
        metadata: { ...DEMO },
      })
    }
  }
  return { leadRows, pipelineRows }
}

function finance() {
  const r = rng(7707)
  const ledger = []
  const payments = []
  let n = 0

  // Twelve months of dues and service charges per resident unit, plus the
  // matching payments. Amounts are the same each month on purpose: a service
  // charge that wanders is a data-entry story, not an operating one.
  for (let month = 11; month >= 0; month--) {
    const period = new Date(TODAY.getFullYear(), TODAY.getMonth() - month, 1)
    const label = `${period.getFullYear()}-${String(period.getMonth() + 1).padStart(2, "0")}`
    for (const [u, unit] of RESIDENT_UNITS.entries()) {
      for (const [kind, amount] of [["dues", 180], ["service_charge", 95 + u * 12], ["utility", 40 + u * 6]]) {
        n += 1
        const posted = month > 0
        const id = uid("21000001", n)
        ledger.push({
          id,
          company_id: COMPANY,
          site_id: SITE,
          unit_id: unit,
          resident_id: [RESIDENT.ownerOne, RESIDENT.ownerTwo, RESIDENT.tenantOne][u],
          entry_type: kind,
          status: posted ? "posted" : "draft",
          period: label,
          due_date: `${label}-05`,
          posted_at: posted ? at(-month * 30) : null,
          debit_amount: amount,
          credit_amount: 0,
          currency: "EUR",
          description: { dues: "Hausgeld", service_charge: "Nebenkosten", utility: "Verbrauch" }[kind],
          reference: `${label}/${unit}`,
          metadata: { ...DEMO },
        })

        // Most months are paid; two of the last three are deliberately not, so
        // "offene Posten" is a real number rather than always zero.
        if (posted && (month > 2 || r() > 0.5)) {
          n += 1
          const payId = uid("21000001", n)
          ledger.push({
            id: payId,
            company_id: COMPANY,
            site_id: SITE,
            unit_id: unit,
            resident_id: [RESIDENT.ownerOne, RESIDENT.ownerTwo, RESIDENT.tenantOne][u],
            entry_type: "payment",
            status: "posted",
            period: label,
            due_date: `${label}-05`,
            posted_at: at(-month * 30 + 3),
            debit_amount: 0,
            credit_amount: amount,
            currency: "EUR",
            description: "Zahlungseingang",
            reference: `${label}/${unit}/PAY`,
            metadata: { ...DEMO },
          })
          payments.push({
            id: uid("22000001", payments.length + 1),
            company_id: COMPANY,
            ledger_entry_id: payId,
            unit_id: unit,
            resident_id: [RESIDENT.ownerOne, RESIDENT.ownerTwo, RESIDENT.tenantOne][u],
            provider: pick(r, ["sepa", "stripe", "banktransfer"]),
            // UNIQUE (provider, provider_reference). Month + unit alone repeats
            // across the three entry types in the same month, which is a 23505.
            provider_reference: `REF-${label}-${unit.slice(-4)}-${kind}`,
            direction: "inbound",
            status: "captured",
            amount,
            currency: "EUR",
            paid_at: at(-month * 30 + 3),
            provider_payload: { ...DEMO },
          })
        }
      }
    }
  }
  return { ledger, payments }
}

function wallets() {
  // Same key set on every row: PostgREST rejects a bulk insert whose objects
  // differ in shape. The first build omitted `allows_overdraft` on four of the
  // five and got "All object keys must match".
  const w = (n, owner, kind, balance, overdraft) => ({
    id: uid("23000001", n),
    company_id: COMPANY,
    owner_profile_id: owner,
    kind,
    currency: "EUR",
    balance_amount: balance,
    allows_overdraft: overdraft > 0,
    overdraft_limit_amount: overdraft,
    low_balance_threshold_amount: 50,
    status: "active",
  })
  return [
    w(1, P.owner, "resident", 420.5, 0),
    w(2, P.tenant, "resident", 86.2, 0),
    w(3, P.guest, "resident", 12, 0),
    w(4, P.vendor, "vendor", 2_480, 0),
    w(5, null, "company", 41_260.75, 10_000),
  ]
}

function vendorInvoices() {
  const r = rng(8808)
  const vendors = [
    ["Alanya Teknik Servis", "Aufzugswartung"],
    ["Türkler Havuz", "Poolchemie und Wartung"],
    ["Akdeniz Temizlik", "Reinigung Gemeinschaftsflächen"],
    ["Güvenlik 24", "Sicherheitsdienst"],
    ["Peyzaj Bahçe", "Gartenpflege"],
    ["Enerji Bakım", "Notstrom und Elektrik"],
  ]
  return Array.from({ length: 18 }, (_, i) => {
    const [vendor_name, subject] = vendors[i % vendors.length]
    const issued = -between(r, 5, 300)
    const total = between(r, 4, 92) * 100
    const status = pick(r, ["paid", "paid", "open", "partially_paid", "disputed"])
    return {
      id: uid("24000001", i + 1),
      company_id: COMPANY,
      site_id: SITE,
      vendor_profile_id: P.vendor,
      vendor_name,
      invoice_no: `RE-2026-${String(400 + i)}`,
      status,
      total_amount: total,
      tax_amount: Math.round(total * 0.2 * 100) / 100,
      paid_amount: status === "paid" ? total : status === "partially_paid" ? Math.round(total * 0.4) : 0,
      currency: "EUR",
      issued_on: dateAt(issued),
      due_on: dateAt(issued + 30),
      // No `metadata` column on this table, so the demo marker cannot live in
      // one. The id prefix is the marker instead — see WIPE_FILTER.
      notes: `${subject} · Beispieldaten`,
    }
  })
}

function messaging() {
  const r = rng(9909)
  const subjects = [
    ["Nebenkosten 2025 - Rückfrage", "billing"],
    ["Schlüsselübergabe Termin", "concierge"],
    ["Wasserschaden Bad", "maintenance"],
    ["Zutritt für Handwerker", "access"],
    ["Parkplatz dauerhaft belegt", "complaint"],
    ["Poolzeiten im August", "general"],
    ["Internetanschluss langsam", "technical"],
    ["Bestätigung Zahlungseingang", "billing"],
    ["Hausordnung - Ruhezeiten", "general"],
    ["Abnahme nach Malerarbeiten", "handover"],
    ["Kaution Rückzahlung", "billing"],
    ["Anfrage Ferienvermietung", "general"],
  ]
  const threadRows = []
  const messageRows = []
  let m = 0
  subjects.forEach(([subject, topic], i) => {
    const id = uid("31000001", i + 1)
    // Alternating across the two login-backed units: a tenant and an owner both
    // need a conversation of their own, or the page is empty for one of them.
    const threadUnit = LOGIN_UNITS[i % LOGIN_UNITS.length]
    const started = -between(r, 1, 120)
    const count = between(r, 2, 5)
    threadRows.push({
      id,
      company_id: COMPANY,
      site_id: SITE,
      unit_id: threadUnit,
      resident_id: residentOf(threadUnit),
      subject,
      status: i % 4 === 0 ? "open" : pick(r, ["open", "pending", "resolved", "closed"]),
      priority: i % 6 === 0 ? "high" : "normal",
      locale: "de",
      channel: pick(r, ["portal", "email"]),
      created_by: P.tenant,
      assigned_to: P.manager,
      last_message_at: at(started + count),
      message_count: count,
      // No `metadata` column here either; the id prefix carries the marker.
      created_at: at(started),
    })
    for (let k = 0; k < count; k++) {
      m += 1
      const fromResident = k % 2 === 0
      messageRows.push({
        id: uid("32000001", m),
        thread_id: id,
        company_id: COMPANY,
        sender_profile_id: fromResident ? P.tenant : P.manager,
        sender_kind: "user",
        body: fromResident
          ? `Guten Tag, es geht um ${subject.toLowerCase()}. Können Sie das bitte prüfen?`
          : "Vielen Dank für Ihre Nachricht. Wir haben den Vorgang aufgenommen und melden uns zurück.",
        channel: "portal",
        locale: "de",
        is_internal_note: false,
        delivered_at: at(started + k),
        read_at: k < count - 1 ? at(started + k, 2) : null,
        created_at: at(started + k),
      })
    }
    void topic
  })
  return { threadRows, messageRows }
}

function notifications() {
  const r = rng(1010)
  // `category` is a CHECK over seven values. "ticket", "lead" and "wallet" are
  // not among them — service, announcement and finance are the right buckets.
  const set = [
    ["service", "info", "Neue Meldung zugewiesen", "Ein Vorgang wurde Ihnen zugewiesen.", "/de/dashboard/tickets"],
    ["finance", "warning", "Offener Posten fällig", "Eine Position ist seit mehr als 14 Tagen offen.", "/de/dashboard/finance"],
    ["compliance", "critical", "Prüfung überfällig", "Eine Pflichtprüfung hat die Frist überschritten.", "/de/dashboard/compliance"],
    ["document", "info", "Dokument freigegeben", "Ein Dokument wurde geprüft und freigegeben.", "/de/dashboard/documents"],
    ["announcement", "info", "Neue Anfrage", "Über das Portal ist eine Anfrage eingegangen.", "/de/dashboard/leads"],
    ["service", "warning", "Frist überschritten", "Ein Vorgang hat seine Bearbeitungsfrist überschritten.", "/de/dashboard/tickets"],
    ["message", "info", "Neue Nachricht", "Ein Bewohner hat auf einen Vorgang geantwortet.", "/de/dashboard/communications"],
    ["finance", "warning", "Guthaben niedrig", "Ein Wallet liegt unter der Warnschwelle.", "/de/dashboard/wallet"],
  ]
  const targets = [P.admin, P.manager, P.accountant, P.staff, P.owner, P.tenant]
  const rows = []
  let n = 0
  for (const profile of targets) {
    for (const [category, severity, title, body, link] of set) {
      n += 1
      if (n % 3 === 0 && profile !== P.admin && profile !== P.manager) continue
      const read = r() > 0.6
      const age = between(r, 0, 30)
      rows.push({
        id: uid("33000001", n),
        company_id: COMPANY,
        profile_id: profile,
        category,
        severity,
        title,
        body,
        payload: { ...DEMO },
        link,
        locale: "de",
        // `notifications_read_at_consistent`: read and read_at are a pair. A
        // read notification with no timestamp is a row that cannot say when it
        // was read, which is the thing the constraint refuses to store.
        is_read: read,
        read_at: read ? at(-age, 5) : null,
        created_at: at(-age),
      })
    }
  }
  return rows
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log(`\nseed-demo-operations  anchor ${TODAY.toISOString().slice(0, 10)}${WIPE ? "  (--wipe)" : ""}`)
console.log("=".repeat(64))

// Prove the anchors exist before writing anything. A foreign-key failure 400
// rows in is a much worse error message than this one.
const company = await get(`companies?id=eq.${COMPANY}&select=id`)
if (company.length === 0) {
  console.error("Company row missing. Run supabase/seed.sql first.")
  process.exit(1)
}

const TABLES = [
  "notifications", "messages", "threads", "vendor_invoices", "payment_transactions",
  "finance_ledger_entries", "wallets", "buyer_pipeline_entries", "leads",
  "compliance_checks", "documents", "workforce_tasks", "activities",
  "ticket_events", "service_tickets", "hotel_rooms",
]

if (WIPE) {
  for (const t of TABLES) await wipe(t)
  console.log(`  wiped demo rows from ${TABLES.length} tables\n`)
}

const { rows: ticketRows, events: ticketEventRows } = tickets()
const { leadRows, pipelineRows } = leadsAndPipeline()
const { ledger, payments } = finance()
const { threadRows, messageRows } = messaging()

// Order matters: parents before children, every time.
const plan = [
  ["hotel_rooms", hotelRooms()],
  ["service_tickets", ticketRows],
  ["ticket_events", ticketEventRows],
  ["workforce_tasks", workforceTasks(ticketRows)],
  ["activities", activities()],
  ["documents", documents()],
  ["compliance_checks", compliance()],
  ["leads", leadRows],
  ["buyer_pipeline_entries", pipelineRows],
  ["wallets", wallets()],
  ["finance_ledger_entries", ledger],
  ["payment_transactions", payments],
  ["vendor_invoices", vendorInvoices()],
  ["threads", threadRows],
  ["messages", messageRows],
  ["notifications", notifications()],
]

let total = 0
let failed = 0
for (const [table, rows] of plan) {
  try {
    const { count } = await upsert(table, rows)
    total += count
    console.log(`  ok    ${String(count).padStart(4)}  ${table}`)
  } catch (e) {
    failed += 1
    console.log(`  FAIL        ${table}\n        ${String(e.message).slice(0, 260)}`)
  }
}

console.log("=".repeat(64))
console.log(`  ${total} rows across ${plan.length - failed}/${plan.length} tables\n`)
process.exit(failed > 0 ? 1 : 0)
