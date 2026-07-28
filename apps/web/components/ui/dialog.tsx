"use client"

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { X } from "lucide-react"
import type { ComponentProps, ReactNode } from "react"

import { cn } from "@/lib/cn"

/**
 * Dialog.                                                  Owner: W1-D
 *
 * Base UI, not the hand-rolled native `<dialog>` the 1Çatı reference uses.
 * That file re-implements focus trapping, restore-on-close and scroll locking
 * by hand; those are exactly the things a primitive library exists to get
 * right, and getting them subtly wrong is an accessibility defect nobody
 * notices until an audit.
 *
 * `transform-origin` stays CENTRED here, unlike the tooltip and popover. A
 * modal is not anchored to a trigger — it arrives in the middle of the
 * viewport and belongs to the whole screen — so scaling it out of the button
 * that opened it would assert a spatial relationship that does not exist.
 *
 * The backdrop dims to focus (apple-design §12): a modal task blocks, so the
 * background is pushed back rather than left as a peer.
 */

function Dialog(props: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root {...props} />
}

function DialogTrigger(props: ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogClose(props: ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogContent({
  className,
  children,
  closeLabel,
  ...props
}: ComponentProps<typeof DialogPrimitive.Popup> & {
  /** Localised accessible name for the close control. Required — never "X". */
  closeLabel: string
}): ReactNode {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        className={cn(
          "fixed inset-0 z-50 bg-[color-mix(in_srgb,var(--sea-deep)_55%,transparent)] backdrop-blur-sm",
          "transition-opacity duration-200 ease-[var(--ease-out)]",
          "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0"
        )}
      />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
          "flex w-[calc(100vw-2rem)] max-w-lg flex-col gap-4",
          // A dialog taller than the viewport must scroll inside itself; at
          // 320px with German copy this is not a rare case.
          "max-h-[calc(100dvh-2rem)] overflow-y-auto azura-scrollbar-slim",
          "rounded-xl border border-border bg-popover p-6 text-popover-foreground shadow-2xl",
          "transition-[transform,opacity] duration-200 ease-[var(--ease-out)]",
          "data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0",
          "data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0",
          "motion-reduce:transition-opacity motion-reduce:data-[starting-style]:scale-100 motion-reduce:data-[ending-style]:scale-100",
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          aria-label={closeLabel}
          className={cn(
            "absolute right-3 top-3 inline-flex size-9 items-center justify-center rounded-md",
            "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            "outline-none focus-visible:ring-2 focus-visible:ring-ring"
          )}
        >
          <X className="size-4" aria-hidden="true" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  )
}

function DialogTitle({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "pr-10 font-display text-lg font-semibold tracking-[-0.015em]",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
}
