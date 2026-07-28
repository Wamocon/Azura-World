/**
 * # iCalendar (RFC 5545) serialisation
 *
 * Owned by **W3-E**. Pure string work: no clock, no I/O, no repository. The
 * calendar route composes it.
 *
 * Four things break ICS silently rather than loudly, which is why each has its
 * own function and its own test rather than being inlined at the call site.
 *
 * ## 1. Escaping — §3.3.11
 *
 * `TEXT` gives meaning to `\`, `;`, `,` and the line break. An activity called
 * `Yoga, Sauna; Handtuch mitbringen` unescaped becomes three properties in most
 * parsers and one truncated title in the rest. Outlook does not report this; it
 * shows a short title and drops the remainder.
 *
 * The backslash is replaced **first**. Any other order double-escapes the
 * backslashes introduced by the later rules.
 *
 * The colon is deliberately *not* escaped: it is a separator in the property
 * line, not inside a `TEXT` value, and escaping it produces `\:` which
 * conformant parsers pass through literally.
 *
 * ## 2. Folding — §3.1, at 75 OCTETS
 *
 * Octets, not characters. Turkish and German titles are the ordinary case here:
 * `ö` and `ş` are two UTF-8 bytes, `İ` is two, an emoji is four. A fold counted
 * in `String.length` overshoots the limit on exactly the content this project
 * carries, and a fold that splits a multi-byte sequence produces a replacement
 * character in the middle of a word after the client unfolds it.
 *
 * {@link foldContentLine} therefore walks **code points**, adds their real
 * UTF-8 width, and never splits either a surrogate pair or an escape pair.
 * Splitting `\` from its `,` unfolds correctly by the letter of the spec and
 * still confuses enough clients to be worth avoiding.
 *
 * ## 3. CRLF — §3.1
 *
 * Required. `\n` alone is accepted by some clients and silently ignored by
 * others, which is worse than a clean failure because it works on the developer
 * machine. The final line is terminated too, not merely separated.
 *
 * ## 4. Time zones — the reason this is not simply "render in Istanbul"
 *
 * **Türkiye has been permanently UTC+3 with no DST since 2016. Germany has
 * DST.** A subscriber in Berlin is therefore +2 from the site in January and +1
 * in July, and any feed that ships local wall-clock times is wrong for half the
 * year in one direction and half in the other.
 *
 * Every stamp here is an absolute UTC instant with a `Z` suffix
 * ({@link icsUtcStamp}). A conformant client converts that to the viewer's own
 * zone, so a 09:00 Istanbul activity shows as 07:00 in Berlin in January and
 * 08:00 in July — both correct, with no VTIMEZONE block to get wrong.
 *
 * `X-WR-TIMEZONE` is **not** emitted, deliberately. It tells a client to
 * display the calendar in a fixed zone, which is precisely the failure this
 * design avoids: the Berlin subscriber wants Berlin time, not Istanbul time
 * relabelled. It is also non-standard, and the only clients that honour it
 * apply it to floating times, which this feed does not contain.
 */

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

/**
 * Escape a `TEXT` value per §3.3.11.
 *
 * Order matters: backslash first, or the backslashes this function introduces
 * are themselves escaped on the next pass and `Yoga, Sauna` arrives as
 * `Yoga\\, Sauna`.
 *
 * `\r\n`, `\r` and `\n` all collapse to the literal two-character sequence
 * `\n`, which is what the spec means by an escaped newline. A bare `\r` left in
 * place would terminate the content line early and turn the rest of a
 * description into an unparseable property.
 */
export function icsEscapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n")
}

// ---------------------------------------------------------------------------
// Folding
// ---------------------------------------------------------------------------

/** UTF-8 width of one code point. The unit the 75-octet limit is measured in. */
function utf8Width(codePoint: number): number {
  if (codePoint < 0x80) return 1
  if (codePoint < 0x800) return 2
  if (codePoint < 0x10000) return 3
  return 4
}

/** The RFC's limit, excluding the CRLF. */
export const ICS_OCTET_LIMIT = 75

/**
 * Split one content line into folded segments.
 *
 * The first segment may carry 75 octets. Every continuation begins with one
 * space, and that space counts against the limit, so continuations carry 74
 * octets of content. Unfolding is defined as removing the CRLF **and** the
 * single following whitespace character, so the space is pure overhead and must
 * be budgeted for rather than added afterwards.
 *
 * Returns segments **without** line breaks; {@link joinIcsLines} adds the CRLF.
 */
export function foldContentLine(
  line: string,
  limit: number = ICS_OCTET_LIMIT
): string[] {
  const segments: string[] = []
  let current = ""
  let width = 0
  // The first line has the full budget; every later one loses an octet to the
  // leading space that marks it as a continuation.
  let budget = limit

  const flush = (): void => {
    segments.push(current)
    current = ""
    width = 0
    budget = limit - 1
  }

  const points = Array.from(line)
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]
    if (point === undefined) continue

    // An escape pair travels as one unit. Legal to split, and reliably
    // mishandled by enough clients that it is not worth the two saved octets.
    let chunk = point
    if (point === "\\" && index + 1 < points.length) {
      const next = points[index + 1]
      if (next !== undefined) {
        chunk = point + next
        index += 1
      }
    }

    let chunkWidth = 0
    for (const character of chunk) {
      chunkWidth += utf8Width(character.codePointAt(0) ?? 0)
    }

    // `current !== ""` guards the pathological case: a chunk wider than the
    // whole budget would otherwise flush forever on an empty line.
    if (width + chunkWidth > budget && current !== "") flush()

    current += chunk
    width += chunkWidth
  }

  segments.push(current)
  return segments
}

/**
 * Assemble folded lines into the body of a file.
 *
 * Every line is CRLF-**terminated**, including the last. A file ending without
 * one is rejected outright by some parsers and silently truncated by others.
 */
export function joinIcsLines(lines: readonly string[]): string {
  return lines.flatMap((line) => foldContentLine(line)).join("\r\n") + "\r\n"
}

// ---------------------------------------------------------------------------
// Instants
// ---------------------------------------------------------------------------

/**
 * An ISO instant as an RFC 5545 UTC `DATE-TIME`: `20260115T060000Z`.
 *
 * Returns `null` for anything unparseable rather than a plausible-looking
 * fallback. A caller drops the event; a guessed date puts a wrong appointment
 * in somebody's calendar, which is worse than a missing one.
 */
export function icsUtcStamp(iso: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return `${date.toISOString().replace(/[-:]/g, "").split(".")[0] ?? ""}Z`
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/** RFC 5545 §3.8.1.11. `cancelled` is what keeps a withdrawn event visible. */
export type IcsEventStatus = "CONFIRMED" | "TENTATIVE" | "CANCELLED"

export interface IcsEvent {
  /** Globally unique and **stable across regenerations**, or clients duplicate. */
  uid: string
  startsAt: string
  endsAt?: string | null
  summary: string
  description?: string | null
  location?: string | null
  url?: string | null
  status?: IcsEventStatus
  categories?: readonly string[]
  /** Drives `LAST-MODIFIED`. Falls back to the start instant. */
  updatedAt?: string | null
}

export interface IcsCalendarOptions {
  prodId: string
  /** `X-WR-CALNAME`. Non-standard but honoured almost everywhere, and harmless. */
  calendarName?: string
  /** Fixed for the whole document so a regeneration is byte-stable. */
  dtstamp: string
  events: readonly IcsEvent[]
}

function textProperty(name: string, value: string): string {
  return `${name}:${icsEscapeText(value)}`
}

/**
 * Serialise one `VCALENDAR`.
 *
 * Events whose start does not parse are **skipped**, not defaulted: an event
 * with no time is not an event. The count of what was dropped is the caller's
 * to surface if it matters.
 */
export function buildIcsCalendar(options: IcsCalendarOptions): string {
  const stamp = icsUtcStamp(options.dtstamp)
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${options.prodId}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ]
  if (options.calendarName !== undefined) {
    lines.push(textProperty("X-WR-CALNAME", options.calendarName))
  }

  for (const event of options.events) {
    const start = icsUtcStamp(event.startsAt)
    if (start === null) continue
    const end =
      event.endsAt === undefined || event.endsAt === null
        ? null
        : icsUtcStamp(event.endsAt)
    const modified =
      event.updatedAt === undefined || event.updatedAt === null
        ? null
        : icsUtcStamp(event.updatedAt)

    lines.push(
      "BEGIN:VEVENT",
      textProperty("UID", event.uid),
      `DTSTAMP:${stamp ?? start}`,
      `DTSTART:${start}`
    )
    if (end !== null) lines.push(`DTEND:${end}`)
    lines.push(textProperty("SUMMARY", event.summary))
    if (event.description !== undefined && event.description !== null) {
      lines.push(textProperty("DESCRIPTION", event.description))
    }
    if (event.location !== undefined && event.location !== null) {
      lines.push(textProperty("LOCATION", event.location))
    }
    if (event.url !== undefined && event.url !== null) {
      // URI, not TEXT (§3.3.13). Escaping it would corrupt any query string.
      lines.push(`URL:${event.url}`)
    }
    if (event.categories !== undefined && event.categories.length > 0) {
      // A comma-separated list of TEXT: the separators are structural, so each
      // item is escaped on its own and then joined.
      lines.push(`CATEGORIES:${event.categories.map(icsEscapeText).join(",")}`)
    }
    if (event.status !== undefined) lines.push(`STATUS:${event.status}`)
    if (modified !== null) lines.push(`LAST-MODIFIED:${modified}`)
    lines.push("END:VEVENT")
  }

  lines.push("END:VCALENDAR")
  return joinIcsLines(lines)
}

// ---------------------------------------------------------------------------
// Feed tokens
// ---------------------------------------------------------------------------

/**
 * Whether a feed token is well formed, before anything is looked up.
 *
 * A calendar client cannot present a cookie, so the token in the URL *is* the
 * credential. Two consequences the calendar route depends on:
 *
 *  - The token must not contain the user id, in plaintext or recoverable form.
 *    A subscription URL ends up in phone backups, in shared family calendars,
 *    and in any proxy log that records paths.
 *  - A token that fails this shape check is rejected **exactly like** one that
 *    fails the constant-time comparison: 404, no detail. Returning "malformed"
 *    for one and "not found" for the other is a free oracle for anyone probing.
 */
export const ICS_TOKEN_PATTERN = /^[0-9a-f]{64}$/

export function isWellFormedFeedToken(token: string): boolean {
  return ICS_TOKEN_PATTERN.test(token)
}
