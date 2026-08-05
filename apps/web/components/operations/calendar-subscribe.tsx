"use client"

import { Check, Copy, CalendarPlus } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"

/**
 * "Add this calendar to your phone" — the end-user version.
 *                                                             Owner: W-NIGHT
 *
 * ## What it replaced
 *
 * A panel that printed this, and nothing else:
 *
 *     /api/calendar/ics/5d1d3813c32489a7e664f72903142fca2185540ac446585f33e8aec4d43d723f
 *
 * Four things wrong with that, all of them the same mistake — it was written
 * for somebody who already understands the system.
 *
 * 1. **It is not a link.** It has no `https://` and no host, so pasting it into
 *    Outlook or Google Calendar does nothing at all. The one piece of text on
 *    the panel that looks actionable was the one piece that could not work.
 * 2. **Sixty-four characters of hexadecimal**, to be selected by hand, on a
 *    phone. There was no copy button.
 * 3. **"there is currently one single feed for the whole site, not one per
 *    person. Anyone holding the link sees the same list of appointments as
 *    management."** True, important, and written as a release note. A resident
 *    reads that and does not know whether they are supposed to worry.
 * 4. **"Access is withdrawn by having management change the key."** "The key"
 *    is an implementation detail nobody outside the code has heard of.
 *
 * ## What it does now
 *
 * A full, copyable address; one button that copies it; three short sentences
 * that say what it is, what to be careful of, and who to ask. The warning stays
 * — it is real — but as advice a person can act on rather than a caveat.
 *
 * The address is built in the browser from `window.location.origin`, which is
 * why this is a client component: the server does not reliably know the public
 * host behind a proxy, and a link with the wrong host is the original bug in a
 * new costume.
 */

export interface CalendarSubscribeLabels {
  heading: string
  /** One line: what subscribing does. */
  explanation: string
  /** Plain-language caution about sharing the link. */
  caution: string
  /** Who to ask to stop a link working. */
  revocation: string
  copy: string
  copied: string
  /** Announced to screen readers when the copy succeeds. */
  copiedAnnouncement: string
}

export function CalendarSubscribe({
  path,
  labels,
}: {
  /** Locale-less path, e.g. `/api/calendar/ics/<token>`. */
  path: string
  labels: CalendarSubscribeLabels
}) {
  const [copied, setCopied] = useState(false)

  // `window` is only read inside the handler and the render-time fallback, so
  // the first server render and the first client render agree.
  const [origin, setOrigin] = useState("")
  if (typeof window !== "undefined" && origin === "") {
    setOrigin(window.location.origin)
  }
  const url = origin === "" ? path : `${origin}${path}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      // Long enough to notice, short enough not to become the button's label.
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // A blocked clipboard is not an error worth a dialog — the address is
      // on screen and selectable, which is the fallback.
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
        <CalendarPlus aria-hidden="true" className="size-4 text-primary" />
        {labels.heading}
      </h2>

      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        {labels.explanation}
      </p>

      {/* The address and the button on one line, so the thing you copy and the
          way you copy it are not separated by a paragraph of text. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-muted/40 px-3 py-2 text-xs whitespace-nowrap text-foreground">
          {url}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={copy}
          className="shrink-0"
        >
          {copied ? (
            <Check aria-hidden="true" className="size-3.5" />
          ) : (
            <Copy aria-hidden="true" className="size-3.5" />
          )}
          {copied ? labels.copied : labels.copy}
        </Button>
      </div>

      {/* Announced rather than only shown: the icon swap is invisible to a
          screen reader, and "did that work?" is the whole question. */}
      <span aria-live="polite" className="sr-only">
        {copied ? labels.copiedAnnouncement : ""}
      </span>

      <p className="max-w-prose text-sm leading-relaxed text-foreground">
        {labels.caution}
      </p>
      <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
        {labels.revocation}
      </p>
    </section>
  )
}
