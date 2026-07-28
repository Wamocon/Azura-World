"use client"

/**
 * Copy-this-page-link.                                               Owner: W3-A
 *
 * The whole interaction is one button and one confirmation, so the craft is in
 * the parts nobody notices: the label swaps in place rather than the button
 * resizing under the cursor, the confirmation reverts on a timer that is
 * cleared on unmount, and a failed clipboard write says so instead of silently
 * claiming success — a "Copied" that copied nothing is worse than an error.
 *
 * No animation on the swap. A control a visitor presses once does not need
 * one, and a transition here would delay the only feedback the action has.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"

import { cn } from "@/lib/cn"

export function ShareLink({
  copyLabel,
  copiedLabel,
  className,
}: {
  copyLabel: string
  copiedLabel: string
  className?: string
}): ReactNode {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    []
  )

  const copy = useCallback(async () => {
    const url = window.location.href
    try {
      await navigator.clipboard.writeText(url)
      setFailed(false)
      setCopied(true)
    } catch {
      // Denied permission, an insecure origin, or no clipboard API. The URL is
      // in the address bar either way, so the honest recovery is to say the
      // copy did not happen rather than to pretend.
      setCopied(false)
      setFailed(true)
    }
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setCopied(false)
      setFailed(false)
    }, 2400)
  }, [])

  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <button
        type="button"
        onClick={() => void copy()}
        className={cn(
          "azura-tap inline-flex items-center rounded-full border border-primary px-6",
          "text-[0.9375rem] font-medium text-primary",
          "transition-transform duration-[var(--duration-instant)] ease-[var(--ease-out)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
          "active:scale-[0.97]"
        )}
      >
        {/* The widest label reserves the width, so the button never resizes
            between states and the pointer never lands on a moving target. */}
        <span aria-hidden="true" className="invisible h-0 overflow-hidden">
          {copyLabel.length >= copiedLabel.length ? copyLabel : copiedLabel}
        </span>
        <span>{copied ? copiedLabel : copyLabel}</span>
      </button>
      <span
        aria-live="polite"
        className="text-[0.8125rem] text-muted-foreground"
      >
        {failed ? copyLabel : ""}
      </span>
    </div>
  )
}
