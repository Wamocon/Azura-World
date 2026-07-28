"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import type { ComponentProps } from "react"

import { cn } from "@/lib/cn"

/**
 * Tabs.                                                    Owner: W1-D
 *
 * The active pill is Base UI's `Indicator` — one element that slides between
 * tabs — rather than a background on each tab that cross-fades. Cross-fading
 * two backgrounds always shows both at once mid-transition; a single moving
 * element cannot, and it reads as one object rather than two.
 *
 * The indicator moves with `ease-in-out`, not `ease-out`: it travels ON screen
 * between two rest positions, which is the one case where symmetric
 * acceleration is right. Entering and exiting elements still use `ease-out`.
 *
 * The list scrolls horizontally rather than wrapping. Four German tab labels
 * do not fit at 320px, and a wrapped tab strip changes height as the user
 * moves through it, which pushes the panel down under their cursor.
 */

function Tabs({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex min-w-0 flex-col gap-4", className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "relative flex w-full max-w-full items-center gap-1 overflow-x-auto",
        "azura-scrollbar-slim rounded-lg bg-muted p-1",
        className
      )}
      {...props}
    />
  )
}

function TabsIndicator({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Indicator>) {
  return (
    <TabsPrimitive.Indicator
      data-slot="tabs-indicator"
      className={cn(
        "absolute top-1/2 left-0 z-0 h-[calc(100%-0.5rem)] -translate-y-1/2 rounded-md bg-card shadow-sm",
        "w-[var(--active-tab-width)] translate-x-[var(--active-tab-left)]",
        "transition-[transform,width] duration-[220ms] ease-[var(--ease-in-out)]",
        "motion-reduce:transition-none",
        className
      )}
      {...props}
    />
  )
}

function TabsTab({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Tab>) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        "relative z-10 inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap",
        "rounded-md px-3 text-sm font-medium text-muted-foreground",
        "transition-colors duration-150 ease-[var(--ease-out)]",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "data-[selected]:text-foreground",
        "[&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function TabsPanel({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Panel>) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-panel"
      className={cn("min-w-0 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsIndicator, TabsTab, TabsPanel }
