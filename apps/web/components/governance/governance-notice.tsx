import { AlertTriangle, Database, Info } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/cn"

/**
 * Standing notices for the governance surfaces.                Owner: W3-F
 *
 * Three tones, deliberately few:
 *
 * | tone      | means                                                        |
 * |-----------|--------------------------------------------------------------|
 * | `seed`    | you are looking at fixture data, not this deployment's data   |
 * | `warning` | something is true and unwelcome (a gap, an expiry, a refusal) |
 * | `info`    | a limitation of the surface itself                            |
 *
 * `seed` exists because CONTRACTS §4's `source: "supabase" | "local-seed"` is
 * only worth having if a user can see it. W4-C's honesty audit records the
 * repository layer as CLEAN on this point and names the *surface* as where the
 * control gets tested next. This is that surface's half of it.
 *
 * There is no `success` tone. A governance module has very little to be pleased
 * about, and a green banner beside a compliance gap reads as reassurance the
 * data does not support.
 */
export type NoticeTone = "seed" | "warning" | "info"

const TONE_STYLES: Readonly<Record<NoticeTone, string>> = Object.freeze({
  seed: "border-quality-modelled/40 bg-quality-modelled/10 text-quality-modelled",
  warning:
    "border-confidence-conflicted/45 bg-surface-conflict text-confidence-conflicted",
  info: "border-input bg-muted/40 text-muted-foreground",
})

const TONE_ICONS = Object.freeze({
  seed: Database,
  warning: AlertTriangle,
  info: Info,
})

export function GovernanceNotice({
  tone,
  children,
  className,
}: {
  tone: NoticeTone
  children: ReactNode
  className?: string
}): ReactNode {
  const Icon = TONE_ICONS[tone]

  return (
    <p
      data-slot="governance-notice"
      data-tone={tone}
      // `status`, not `alert`: these are standing conditions of the page, and an
      // assertive live region that fires on every navigation is noise a screen
      // reader user cannot turn off.
      role="status"
      className={cn(
        "flex min-w-0 items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed",
        TONE_STYLES[tone],
        className
      )}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </p>
  )
}
