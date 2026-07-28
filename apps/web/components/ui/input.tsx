import { Input as InputPrimitive } from "@base-ui/react/input"
import type { ComponentProps } from "react"

import { cn } from "@/lib/cn"

/**
 * Input and Label.                                         Owner: W1-D
 *
 * The border uses `--input`, not `--border`: this is a control boundary, so
 * WCAG 1.4.11 applies and the token is contrast-gated at 3:1 in both themes.
 * `--border` is a decorative hairline and would fail that on purpose.
 */

function Input({ className, ...props }: ComponentProps<typeof InputPrimitive>) {
  return (
    <InputPrimitive
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3",
        "text-sm text-foreground placeholder:text-muted-foreground",
        "transition-[border-color,box-shadow] duration-[160ms] ease-[var(--ease-out)]",
        "outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30",
        className
      )}
      {...props}
    />
  )
}

function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium text-foreground",
        "has-[+_:disabled]:opacity-50",
        className
      )}
      {...props}
    />
  )
}

/**
 * The id `Field` gives its hint/error node, so the caller can point the
 * control's `aria-describedby` at it:
 *
 *   <Field htmlFor="q" label="…" error={err}>
 *     <Input id="q" aria-describedby={fieldDescriptionId("q", err !== undefined)} />
 *   </Field>
 *
 * Wiring it explicitly rather than cloning the child keeps `Field` working
 * with any content — a plain input, a select, a composite control, or two
 * inputs side by side. `cloneElement` would only support the first.
 */
export function fieldDescriptionId(htmlFor: string, hasError: boolean): string {
  return hasError ? `${htmlFor}-error` : `${htmlFor}-hint`
}

/**
 * Field wrapper. Errors render inline and are announced, not collected into a
 * summary on submit (apple-design §16: validate inline, not on submit).
 */
function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string
  hint?: string
  error?: string
  htmlFor: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint !== undefined && error === undefined ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error !== undefined ? (
        <p
          id={`${htmlFor}-error`}
          role="alert"
          className="text-xs font-medium text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}

export { Input, Label, Field }
