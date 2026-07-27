import type { ComponentProps } from "react"

import { cn } from "@/lib/cn"

/**
 * Card and its parts.                                      Owner: W1-D
 *
 * Plain composition — no cva, because a card has one shape and a `variant`
 * prop here would only ever encode "does it have a border", which `className`
 * already does. The reference repo's `glass-card.tsx` reaches for `forwardRef`
 * and boolean props; React 19 passes `ref` as an ordinary prop, so neither is
 * needed.
 */

function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-card p-5 text-card-foreground",
        className
      )}
      {...props}
    />
  )
}

/** Translucent variant. Content scrolls under it; see `.azura-glass`. */
function GlassCard({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "azura-glass azura-edge-light flex min-w-0 flex-col gap-4 rounded-xl p-5 text-card-foreground",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex min-w-0 flex-col gap-1.5", className)}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: ComponentProps<"h3">) {
  return (
    <h3
      data-slot="card-title"
      className={cn(
        "font-display text-lg font-semibold leading-tight tracking-[-0.015em]",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-sm leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("min-w-0", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      // `flex-wrap` is not optional: two buttons with German labels do not fit
      // on one line at 320px, and without it they overflow the card instead.
      className={cn("flex flex-wrap items-center gap-2", className)}
      {...props}
    />
  )
}

export {
  Card,
  GlassCard,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
}
