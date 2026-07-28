import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/cn"

/**
 * Button.                                                  Owner: W1-D
 *
 * Mirrors 1Çatı's `components/ui/button.tsx` shape — cva + Base UI primitive +
 * `data-slot`, named exports, no `forwardRef` — with three deliberate changes:
 *
 *   1. `active:scale-[0.97]`. The reference nudges 1px down; a scale is the
 *      stronger signal because it scales the label and icon with it, so the
 *      whole control acknowledges the press rather than shifting. Feedback is
 *      on pointer-down, which is when the user is looking.
 *   2. Sizes start at 44px, not 32px. CONVENTIONS §5 floors tap targets at
 *      24px and the reference's `h-8` default only clears that with padding.
 *      44px is the size a thumb actually hits.
 *   3. `destructive` is a filled button. The reference renders it as tinted
 *      text on a 10%-alpha wash, which reads as a disabled state rather than
 *      a dangerous one.
 *
 * Only `transform` and `colour` transition — never `all`, which would animate
 * layout properties nobody asked to animate and is a guaranteed jank source
 * the first time a variant changes padding.
 */
const buttonVariants = cva(
  cn(
    "group/button relative inline-flex shrink-0 items-center justify-center gap-2 select-none",
    "rounded-lg border border-transparent bg-clip-padding whitespace-nowrap",
    "text-sm font-semibold tracking-[0.005em]",
    "transition-[transform,background-color,border-color,color] duration-[160ms] ease-[var(--ease-out)]",
    "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "active:scale-[0.97]",
    "disabled:pointer-events-none disabled:opacity-50",
    "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    // Reduced motion keeps the colour change and drops the press scale: the
    // feedback survives, the movement does not.
    "motion-reduce:transition-[background-color,border-color,color] motion-reduce:active:scale-100"
  ),
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        /* Warm sand. CTAs only — see globals.css. */
        accent: "bg-accent text-accent-foreground hover:bg-accent/90",
        outline:
          "border-input bg-background text-foreground hover:bg-muted hover:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "text-foreground hover:bg-muted",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        /* 44px. The floor for anything a finger has to find. */
        default: "h-11 px-4",
        sm: "h-9 rounded-md px-3 text-[0.8125rem]",
        /* 24px — CONVENTIONS §5's absolute minimum. Inline affordances inside
           dense tables only, never a primary action. */
        xs: "h-6 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        lg: "h-12 px-6 text-base",
        icon: "size-11",
        "icon-sm": "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
      },
      /** Full-width. German runs ~30% longer than English and wraps at 320px. */
      block: {
        true: "w-full",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      block: false,
    },
  }
)

function Button({
  className,
  variant,
  size,
  block,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, block, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
