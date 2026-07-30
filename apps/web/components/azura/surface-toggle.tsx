"use client"

import { Moon, Sun } from "lucide-react"
import { useState } from "react"

import { cn } from "@/lib/cn"

/**
 * Light / dark toggle for the landing surface.                Owner: W-NIGHT
 *
 * ## Why this writes a cookie and flips a DOM attribute, not a class
 *
 * The landing's theme is `[data-surface="night"|"day"]` on one wrapper element,
 * declared server-side. The default is read from the `azura-surface` cookie in
 * `page.tsx`, so the FIRST paint already matches the user's last choice and there
 * is no flash — the failure mode of a client-only theme toggle. This control
 * only has to keep them in sync: set the cookie for next time, and flip the live
 * attribute so the change is instant now.
 *
 * It deliberately does NOT use `next-themes`. That library toggles a `.dark`
 * class on `<html>` for the whole app; the landing surface is a scoped token set
 * on one subtree and the dashboard keeps its own daylight theme regardless.
 * Reconciling the two would be more moving parts than a cookie and an attribute.
 *
 * `initial` is passed from the server so the icon rendered on the client matches
 * the SSR markup — without it the button would hydrate showing the wrong icon.
 */
export function SurfaceToggle({
  initial,
  labels,
  className,
}: {
  initial: "night" | "day"
  labels: { toLight: string; toDark: string }
  className?: string
}) {
  const [surface, setSurface] = useState<"night" | "day">(initial)

  function toggle() {
    const next = surface === "night" ? "day" : "night"
    setSurface(next)
    // A year, same-site, path-wide so every landing route agrees. Not httpOnly:
    // it is a display preference the client legitimately sets, carries nothing
    // sensitive, and the server only ever reads it to pick a default.
    document.cookie = `azura-surface=${next};path=/;max-age=31536000;samesite=lax`
    const el = document.getElementById("landing-surface")
    if (el !== null) el.dataset.surface = next
  }

  const goingToLight = surface === "night"

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={goingToLight ? labels.toLight : labels.toDark}
      title={goingToLight ? labels.toLight : labels.toDark}
      className={cn(
        "azura-tap-compact inline-flex size-9 items-center justify-center rounded-full",
        "border border-[color-mix(in_srgb,var(--foreground)_18%,transparent)]",
        "text-muted-foreground transition-colors duration-[var(--duration-fast)]",
        "hover:border-primary hover:text-foreground",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
        className
      )}
    >
      {goingToLight ? (
        <Sun className="size-[1.05rem]" aria-hidden="true" />
      ) : (
        <Moon className="size-[1.05rem]" aria-hidden="true" />
      )}
    </button>
  )
}
