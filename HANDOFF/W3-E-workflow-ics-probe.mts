/**
 * Probe for the ticket state machine, routing and the iCalendar serialiser.
 *
 *   Written by W3-E (night 2, N3).
 *
 *   node --experimental-strip-types --import ./scripts/register-ts-resolve.mjs \
 *        HANDOFF/W3-E-workflow-ics-probe.mts
 *
 * It exercises the shipped modules, not copies of them. The three claims worth
 * stating up front:
 *
 *  1. **Every** (from, to, role) triple is enumerated — 8 x 8 x 11 = 704
 *     decisions — and the set the machine permits is compared against the table
 *     itself. A pair the table does not carry must be refused for every role.
 *  2. Line folding is measured in **UTF-8 octets**, on strings that actually
 *     contain Turkish and German characters, because a fold counted in
 *     `String.length` passes a Latin-only test and ships broken.
 *  3. The Berlin claim is checked in **both halves of the year**. Türkiye has no
 *     DST and Germany does, so one measurement proves nothing.
 */

import {
  allowedTransitions,
  assessSla,
  canTransition,
  closedOutStatuses,
  findTransition,
  slaDueAt,
  slaHoursByPriority,
  ticketTransitions,
  transitionRequiresNote,
  transitionsFrom,
} from "../apps/web/lib/ticket-workflow.ts"
import {
  buildIcsCalendar,
  foldContentLine,
  icsEscapeText,
  icsUtcStamp,
  isWellFormedFeedToken,
} from "../apps/web/lib/ics-calendar.ts"
import {
  overrideRouting,
  routeTicket,
  selectAssignee,
  validateAssignee,
  type RoutingCandidate,
} from "../apps/web/lib/ticket-routing.ts"
import { roles } from "../apps/web/lib/contracts.ts"
import { ticketStatuses } from "../apps/web/lib/operations-data.ts"

let pass = 0
let fail = 0

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass += 1
    console.log(`PASS  ${label}${detail ? `  ${detail}` : ""}`)
  } else {
    fail += 1
    console.log(`FAIL  ${label}${detail ? `  ${detail}` : ""}`)
  }
}

const utf8 = (value: string): number => Buffer.byteLength(value, "utf8")

// ===========================================================================
console.log("=== 1. The transition table ===\n")
// ===========================================================================

console.log("from            -> to              id                permission        note")
for (const transition of ticketTransitions) {
  console.log(
    `${transition.from.padEnd(15)} -> ${transition.to.padEnd(15)} ` +
      `${transition.id.padEnd(17)} ${transition.permission.padEnd(17)} ` +
      `${transition.requiresNote ? "required" : "-"}`
  )
}
console.log(`\n${ticketTransitions.length} edges over ${ticketStatuses.length} statuses`)
console.log(`terminal (no edge out): ${closedOutStatuses.join(", ")}\n`)

check(
  "every edge names a status that exists",
  ticketTransitions.every(
    (t) => ticketStatuses.includes(t.from) && ticketStatuses.includes(t.to)
  )
)
check(
  "no edge is a self-loop",
  ticketTransitions.every((t) => t.from !== t.to)
)
check(
  // `closed` is NOT a dead end: reopen_closed leaves it. Only `cancelled` has
  // no way out, which is the point of cancelling rather than closing.
  "cancelled is the only status with no way out",
  closedOutStatuses.length === 1 && closedOutStatuses[0] === "cancelled",
  `terminal=${JSON.stringify(closedOutStatuses)}`
)
check(
  "every status except cancelled is reachable out of",
  ticketStatuses.every(
    (s) => s === "cancelled" || transitionsFrom(s).length > 0
  )
)
check(
  // The rule is narrower than "every hold/reject/cancel/reopen", and the first
  // version of this assertion got that wrong rather than the code being wrong.
  // `discard_draft` is a reject-intent edge that deliberately needs no reason:
  // a draft nobody submitted has no reader waiting on an explanation. The rule
  // the table actually implements is about work somebody else can see.
  "every move that ends or interrupts SUBMITTED work demands a reason",
  ticketTransitions
    .filter(
      (t) =>
        t.from !== "draft" &&
        ["hold", "reject", "cancel", "reopen"].includes(t.intent)
    )
    .every((t) => t.requiresNote),
  `${ticketTransitions.filter((t) => t.requiresNote).length} of ${ticketTransitions.length} edges need a note`
)
check(
  "discarding your own unsent draft is the one exception, and it is deliberate",
  findTransition("draft", "cancelled")?.requiresNote === false
)

// ===========================================================================
console.log("\n=== 2. Exhaustive: every (from, to, role) triple ===\n")
// ===========================================================================

let permitted = 0
let refusedNoEdge = 0
let refusedRole = 0
let refusedSame = 0
let refusedTerminal = 0
let contradictions = 0

for (const role of roles) {
  for (const from of ticketStatuses) {
    for (const to of ticketStatuses) {
      const decision = canTransition(from, to, role)
      const edge = findTransition(from, to)

      if (decision.allowed) {
        permitted += 1
        // A permitted move must correspond to a real edge, and must agree with
        // what allowedTransitions() would have offered the same role.
        if (edge === null) contradictions += 1
        if (!allowedTransitions(from, role).some((t) => t.to === to)) {
          contradictions += 1
        }
      } else {
        if (decision.reason === "same_status") refusedSame += 1
        else if (decision.reason === "terminal") refusedTerminal += 1
        else if (decision.reason === "no_such_transition") {
          refusedNoEdge += 1
          if (edge !== null) contradictions += 1
        } else {
          refusedRole += 1
          // Refused for the role only: the edge must exist, or the reason lies.
          if (edge === null) contradictions += 1
        }
        // A refusal must never advertise a move this role cannot make.
        if (
          decision.allowedTo.some(
            (candidate) => !allowedTransitions(from, role).some((t) => t.to === candidate)
          )
        ) {
          contradictions += 1
        }
      }
    }
  }
}

const total = roles.length * ticketStatuses.length * ticketStatuses.length
console.log(
  `${total} decisions: ${permitted} permitted · ${refusedNoEdge} no such transition · ` +
    `${refusedRole} role not permitted · ${refusedSame} same status · ${refusedTerminal} terminal`
)
check("every triple was decided", permitted + refusedNoEdge + refusedRole + refusedSame + refusedTerminal === total)
check(
  "no decision contradicts the table or allowedTransitions()",
  contradictions === 0,
  `${contradictions} contradictions`
)
check(
  "the permitted set is non-vacuous",
  permitted > 0,
  `${permitted} permitted of ${total}`
)

// A pair absent from the table must be refused for EVERY role, including admin.
const invalidPairs = ticketStatuses.flatMap((from) =>
  ticketStatuses
    .filter((to) => from !== to && findTransition(from, to) === null)
    .map((to) => [from, to] as const)
)
const invalidEverAllowed = invalidPairs.filter(([from, to]) =>
  roles.some((role) => canTransition(from, to, role).allowed)
)
check(
  "every invalid pair is refused for all 11 roles, admin included",
  invalidEverAllowed.length === 0,
  `${invalidPairs.length} invalid pairs checked, ${invalidEverAllowed.length} leaked`
)

// ===========================================================================
console.log("\n=== 3. Role separation ===\n")
// ===========================================================================

const spCanReach = ticketStatuses.flatMap((from) =>
  allowedTransitions(from, "service_provider").map((t) => `${from}->${t.to}`)
)
console.log(`service_provider may perform: ${spCanReach.join(", ") || "(nothing)"}`)

check(
  "service_provider cannot close a ticket",
  !canTransition("resolved", "closed", "service_provider").allowed
)
check(
  "service_provider cannot reject at triage",
  !canTransition("open", "cancelled", "service_provider").allowed
)
check(
  "service_provider cannot assign",
  !canTransition("open", "assigned", "service_provider").allowed
)
check(
  "service_provider CAN start, hold, resume and resolve its own work",
  canTransition("assigned", "in_progress", "service_provider").allowed &&
    canTransition("in_progress", "blocked", "service_provider").allowed &&
    canTransition("blocked", "in_progress", "service_provider").allowed &&
    canTransition("in_progress", "resolved", "service_provider").allowed
)
check(
  "an owner may sign off a resolved ticket (the brief's approval step)",
  canTransition("resolved", "closed", "owner").allowed
)
check(
  "a tenant may not sign off a resolved ticket",
  !canTransition("resolved", "closed", "tenant").allowed
)
check(
  "guest and child_guest can perform no transition at all",
  ticketStatuses.every(
    (s) =>
      allowedTransitions(s, "guest").length === 0 &&
      allowedTransitions(s, "child_guest").length === 0
  )
)
check(
  "a refusal names the alternatives the role DOES have",
  (() => {
    const decision = canTransition("resolved", "closed", "service_provider")
    return !decision.allowed && decision.allowedTo.includes("assigned")
  })(),
  "resolved->closed refused for service_provider, offers resolved->assigned"
)
check(
  "a rejection demands a reason; starting work does not",
  transitionRequiresNote("open", "cancelled") &&
    !transitionRequiresNote("assigned", "in_progress")
)

// ===========================================================================
console.log("\n=== 4. SLA ===\n")
// ===========================================================================

const reported = "2026-07-28T08:00:00.000Z"
for (const [priority, hours] of Object.entries(slaHoursByPriority)) {
  console.log(`${priority.padEnd(7)} ${String(hours).padStart(3)} h  -> ${slaDueAt(reported, priority as never)}`)
}
check(
  "urgent is due four hours after it was reported",
  slaDueAt(reported, "urgent") === "2026-07-28T12:00:00.000Z"
)
check(
  "a breach is a breach",
  assessSla(
    { slaDueAt: "2026-07-28T09:00:00.000Z", status: "in_progress", priority: "urgent", reportedAt: reported },
    "2026-07-28T14:00:00.000Z"
  ).state === "breached"
)
check(
  "a resolved ticket has no running clock, even past its due-by",
  assessSla(
    { slaDueAt: "2026-07-28T09:00:00.000Z", status: "resolved", priority: "urgent", reportedAt: reported },
    "2026-07-30T00:00:00.000Z"
  ).state === "none"
)
check(
  "the last quarter of the window reads as due soon",
  assessSla(
    { slaDueAt: "2026-07-28T12:00:00.000Z", status: "in_progress", priority: "urgent", reportedAt: reported },
    "2026-07-28T11:30:00.000Z"
  ).state === "due_soon"
)
check(
  "a ticket with no due-by is not silently overdue",
  assessSla(
    { slaDueAt: null, status: "open", priority: "low", reportedAt: reported },
    "2030-01-01T00:00:00.000Z"
  ).state === "none"
)

// ===========================================================================
console.log("\n=== 5. Routing ===\n")
// ===========================================================================

check(
  "billing goes to the accounts desk, cleaning to housekeeping",
  routeTicket({ category: "billing", priority: "normal", severity: "minor" }).team === "finance_desk" &&
    routeTicket({ category: "cleaning", priority: "normal", severity: "minor" }).team === "housekeeping"
)
check(
  "critical severity escalates, and says which trigger fired",
  (() => {
    const d = routeTicket({ category: "technical", priority: "low", severity: "critical" })
    return d.escalate && d.escalationReason === "critical_severity"
  })()
)
check(
  "an override keeps the proposal it replaced",
  (() => {
    const base = routeTicket({ category: "cleaning", priority: "normal", severity: "minor" })
    const over = overrideRouting(base, "maintenance")
    return over.team === "maintenance" && over.overriddenFrom === "housekeeping"
  })()
)
check(
  "overriding to the same team is a no-op, not a self-reference",
  overrideRouting(
    routeTicket({ category: "cleaning", priority: "normal", severity: "minor" }),
    "housekeeping"
  ).overriddenFrom === undefined
)

const candidates: RoutingCandidate[] = [
  { profileId: "p-002", displayName: "B", team: "maintenance", active: true, openTicketCount: 5 },
  { profileId: "p-001", displayName: "A", team: "maintenance", active: true, openTicketCount: 2 },
  { profileId: "p-003", displayName: "C", team: "maintenance", active: false, openTicketCount: 0 },
  { profileId: "p-004", displayName: "D", team: "security", active: true, openTicketCount: 0 },
]
const decision = routeTicket({ category: "maintenance", priority: "normal", severity: "minor" })
check(
  "auto-assignment picks the least loaded ACTIVE member",
  selectAssignee(decision, candidates)?.profileId === "p-001",
  "p-003 has 0 open tickets but is inactive"
)
check(
  "assignment to an inactive profile is refused, with the reason",
  (() => {
    const v = validateAssignee("p-003", decision, candidates)
    return !v.assignable && v.reason === "inactive_profile"
  })()
)
check(
  "assignment to an unknown profile is refused, with the reason",
  (() => {
    const v = validateAssignee("p-999", decision, candidates)
    return !v.assignable && v.reason === "unknown_profile"
  })()
)
check(
  "assignment across teams is refused rather than silently permitted",
  (() => {
    const v = validateAssignee("p-004", decision, candidates)
    return !v.assignable && v.reason === "wrong_team"
  })()
)
check(
  "selection is deterministic across repeated calls",
  new Set(
    Array.from({ length: 20 }, () => selectAssignee(decision, candidates)?.profileId)
  ).size === 1
)
check(
  "a team with nobody available yields null, not a wrong person",
  selectAssignee(
    routeTicket({ category: "concierge", priority: "normal", severity: "minor" }),
    candidates
  ) === null
)

// ===========================================================================
console.log("\n=== 6. iCalendar: escaping ===\n")
// ===========================================================================

const nasty = 'Yoga, Sauna; Handtuch\\Badetuch mitbringen\nTreffpunkt: Pool'
const escaped = icsEscapeText(nasty)
console.log(`in : ${JSON.stringify(nasty)}`)
console.log(`out: ${JSON.stringify(escaped)}`)

check("a comma is escaped", escaped.includes("\\,") && !/[^\\],/.test(escaped))
check("a semicolon is escaped", escaped.includes("\\;"))
check("a backslash is escaped first, not doubled by a later rule", escaped.includes("Handtuch\\\\Badetuch"))
check("a newline becomes the literal two-character escape", escaped.includes("\\n") && !escaped.includes("\n"))
check("a colon is NOT escaped — it is legal inside a TEXT value", escaped.includes("Treffpunkt:"))
check(
  "CR, LF and CRLF all collapse to one escape",
  icsEscapeText("a\r\nb") === "a\\nb" &&
    icsEscapeText("a\rb") === "a\\nb" &&
    icsEscapeText("a\nb") === "a\\nb"
)

// ===========================================================================
console.log("\n=== 7. iCalendar: folding at 75 OCTETS ===\n")
// ===========================================================================

// Every character here is two UTF-8 bytes, so a fold counted in characters
// overshoots the octet limit by a factor of two.
const turkish = `SUMMARY:${"şğüöçİĞÜÖÇ".repeat(12)}`
const foldedTurkish = foldContentLine(turkish)
console.log(
  `chars=${turkish.length} octets=${utf8(turkish)} -> ${foldedTurkish.length} segments ` +
    `[${foldedTurkish.map((s) => utf8(s)).join(", ")}]`
)
check(
  "the first segment fits in 75 octets",
  utf8(foldedTurkish[0] ?? "") <= 75,
  `${utf8(foldedTurkish[0] ?? "")} octets`
)
check(
  "every continuation fits in 74 octets, leaving room for its leading space",
  foldedTurkish.slice(1).every((segment) => utf8(segment) <= 74),
  `max continuation = ${Math.max(...foldedTurkish.slice(1).map((s) => utf8(s)))} octets`
)
check(
  "folding is lossless — the segments rejoin to the original",
  foldedTurkish.join("") === turkish
)
check(
  "no segment splits a multi-byte character",
  foldedTurkish.every((segment) => !segment.includes("�")) &&
    Buffer.from(foldedTurkish.join(""), "utf8").toString("utf8") === turkish
)

const emoji = `DESCRIPTION:${"a".repeat(70)}${"\u{1F3CA}".repeat(6)}`
const foldedEmoji = foldContentLine(emoji)
check(
  "a 4-octet astral character is never split across a fold",
  foldedEmoji.join("") === emoji &&
    foldedEmoji.every((s) => utf8(s) <= 75) &&
    !foldedEmoji.some((s) => /[\uD800-\uDBFF]$/.test(s)),
  `${foldedEmoji.length} segments [${foldedEmoji.map((s) => utf8(s)).join(", ")}]`
)

const escapeHeavy = `SUMMARY:${"x\\,".repeat(30)}`
const foldedEscapes = foldContentLine(escapeHeavy)
check(
  "an escape pair is never split across a fold",
  foldedEscapes.join("") === escapeHeavy &&
    !foldedEscapes.some((s) => /(^|[^\\])\\$/.test(s)),
  `${foldedEscapes.length} segments`
)

// ===========================================================================
console.log("\n=== 8. iCalendar: a whole document ===\n")
// ===========================================================================

const ics = buildIcsCalendar({
  prodId: "-//Azura World CATI//Activities//EN",
  calendarName: "Azura World, Aktivitäten",
  dtstamp: "2026-07-28T00:00:00.000Z",
  events: [
    {
      uid: "activity-jan@azura-world.cati",
      startsAt: "2026-01-15T06:00:00.000Z", // 09:00 in Istanbul
      endsAt: "2026-01-15T07:00:00.000Z",
      summary: nasty,
      description: "Bitte 10 Minuten früher da sein; Handtuch, Wasser",
      location: "Pool, Block B3",
      categories: ["Wellness, Sport", "Erwachsene"],
      status: "CONFIRMED",
    },
    {
      uid: "activity-jul@azura-world.cati",
      startsAt: "2026-07-15T06:00:00.000Z", // 09:00 in Istanbul
      endsAt: "2026-07-15T07:00:00.000Z",
      summary: "Sunrise Yoga",
      status: "CONFIRMED",
    },
    { uid: "broken", startsAt: "not-a-date", summary: "dropped" },
  ],
})

const lines = ics.split("\r\n")
check("every line ends CRLF, including the last", ics.endsWith("\r\n"))
check("no bare LF survives anywhere", !/[^\r]\n/.test(ics))
check("it opens and closes as a VCALENDAR", lines[0] === "BEGIN:VCALENDAR" && lines.at(-2) === "END:VCALENDAR")
check(
  "an unparseable start drops the event rather than defaulting its date",
  (ics.match(/BEGIN:VEVENT/g) ?? []).length === 2,
  `${(ics.match(/BEGIN:VEVENT/g) ?? []).length} events from 3 inputs`
)
check(
  "no emitted line exceeds 75 octets",
  lines.every((line) => utf8(line) <= 75),
  `longest = ${Math.max(...lines.map((l) => utf8(l)))} octets`
)
check(
  "CATEGORIES keeps its structural commas and escapes the ones inside an item",
  ics.includes("CATEGORIES:Wellness\\, Sport,Erwachsene")
)
check("a well-formed hex token is accepted", isWellFormedFeedToken("a".repeat(64)))
check("a short or non-hex token is rejected before any lookup", !isWellFormedFeedToken("abc") && !isWellFormedFeedToken("z".repeat(64)))

// ===========================================================================
console.log("\n=== 9. Türkiye has no DST, Germany does ===\n")
// ===========================================================================

const janUtc = icsUtcStamp("2026-01-15T06:00:00.000Z")
const julUtc = icsUtcStamp("2026-07-15T06:00:00.000Z")

const wall = (iso: string, zone: string): string =>
  new Intl.DateTimeFormat("de-DE", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso))

const rows = [
  ["January", "2026-01-15T06:00:00.000Z", janUtc],
  ["July", "2026-07-15T06:00:00.000Z", julUtc],
] as const

console.log("month     emitted           Istanbul  Berlin")
for (const [month, iso, stamp] of rows) {
  console.log(
    `${month.padEnd(9)} ${String(stamp).padEnd(17)} ${wall(iso, "Europe/Istanbul").padEnd(9)} ${wall(iso, "Europe/Berlin")}`
  )
}

check("both stamps are absolute UTC instants", janUtc === "20260115T060000Z" && julUtc === "20260715T060000Z")
check(
  "the site sees 09:00 in both halves of the year — Türkiye has no DST",
  wall(rows[0][1], "Europe/Istanbul") === "09:00" && wall(rows[1][1], "Europe/Istanbul") === "09:00"
)
check(
  "a Berlin viewer sees 07:00 in January and 08:00 in July — the DST shift, rendered correctly",
  wall(rows[0][1], "Europe/Berlin") === "07:00" && wall(rows[1][1], "Europe/Berlin") === "08:00",
  `${wall(rows[0][1], "Europe/Berlin")} / ${wall(rows[1][1], "Europe/Berlin")}`
)
check(
  "no X-WR-TIMEZONE is emitted — it would pin the display to the site's zone",
  !ics.includes("X-WR-TIMEZONE")
)
check(
  "no floating times: every DTSTART and DTEND carries the Z suffix",
  lines
    .filter((line) => line.startsWith("DTSTART") || line.startsWith("DTEND") || line.startsWith("DTSTAMP"))
    .every((line) => line.endsWith("Z"))
)

console.log(`\n${pass} pass · ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)
