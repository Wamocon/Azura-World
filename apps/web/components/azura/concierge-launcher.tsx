"use client"

/**
 * The button that opens the assistant, and the panel it opens.
 *                                                            Owner: W-SITEMODEL
 *
 * ## Why a dock and not a section
 *
 * The assistant answers questions a reader has *while looking at something
 * else*: a price on the plate, a figure in the feed, a block letter. Putting it
 * in the page flow means they have to leave what prompted the question to go
 * and ask it. A dock keeps the question and its subject on the same screen.
 *
 * ## What it does not do
 *
 * It does not open by itself, it does not animate to get attention, and it does
 * not greet anybody. An assistant that opens uninvited on a proposal page reads
 * as a support bot on a broken checkout. The launcher is a button, and the
 * button waits.
 *
 * Closed, it is one button and the whole conversation UI is unmounted, so a
 * reader who never opens it pays for a button. `SiteConcierge` aborts its own
 * request on unmount, so closing mid-answer stops the generation rather than
 * leaving the gateway producing tokens nobody will read.
 */

import { useEffect, useRef, useState } from "react"
import { MessageCircle, X } from "lucide-react"

import { SiteConcierge } from "@/components/site-concierge"
import type { ConciergeLabels } from "@/components/site-concierge"
import type { Locale } from "@/lib/contracts"

export function ConciergeLauncher({
  locale,
  labels,
  suggestions,
  openLabel,
  closeLabel,
}: {
  locale: Locale
  labels: ConciergeLabels
  suggestions: readonly string[]
  openLabel: string
  closeLabel: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  // Escape closes, and focus goes back to the button that opened it. Without
  // the second half a keyboard user is dropped at the top of the document.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open])

  useEffect(() => {
    if (open) panelRef.current?.focus()
  }, [open])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="azura-concierge-panel"
        className="fixed right-4 bottom-4 z-50 inline-flex items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--primary)_55%,transparent)] bg-[color-mix(in_srgb,var(--background)_92%,var(--primary))] px-4 py-3 text-[0.875rem] font-medium text-foreground shadow-lg backdrop-blur transition-colors duration-[var(--duration-fast)] hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] sm:right-6 sm:bottom-6"
      >
        {open ? (
          <X aria-hidden className="size-4" />
        ) : (
          <MessageCircle aria-hidden className="size-4 text-primary" />
        )}
        <span className="hidden sm:inline">{open ? closeLabel : openLabel}</span>
        <span className="sr-only sm:hidden">{open ? closeLabel : openLabel}</span>
      </button>

      {open ? (
        <div
          id="azura-concierge-panel"
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-label={openLabel}
          tabIndex={-1}
          className="fixed inset-x-3 bottom-20 z-50 max-h-[min(34rem,calc(100svh-7rem))] overflow-y-auto rounded-[var(--radius)] border border-border bg-card p-4 shadow-2xl outline-none sm:inset-x-auto sm:right-6 sm:bottom-24 sm:w-[26rem]"
        >
          <SiteConcierge
            locale={locale}
            labels={labels}
            suggestions={suggestions}
          />
        </div>
      ) : null}
    </>
  )
}
