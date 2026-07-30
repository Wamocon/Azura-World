"use client"

import { Eye, EyeOff } from "lucide-react"
import { useId, useState, type ComponentProps } from "react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/cn"

/**
 * A password field with a show/hide toggle.                    Owner: W-NIGHT
 *
 * The eye toggle is the single most-requested missing basic on this project, and
 * it belongs in a shared component rather than copied into login, signup, the
 * password-reset form and anywhere else a secret is typed. Every one of those
 * gets it by swapping `<Input type="password">` for `<PasswordInput>`.
 *
 * ## Client component, and only client
 *
 * The visibility state is local and never leaves the browser. This does NOT
 * change the auth flow: the field still submits inside the same server-action
 * form as before, so the password is still handled server-side and the toggle is
 * pure presentation.
 *
 * ## Accessibility, which is the whole reason to do this properly
 *
 * - The toggle is a real `<button type="button">`, so it never submits the form
 *   and is reachable by keyboard.
 * - `aria-pressed` states whether the password is currently visible, and
 *   `aria-label` switches between the show and hide wording, so a screen-reader
 *   user knows both what the control does and its current state.
 * - `aria-controls` points at the input, naming the relationship.
 * - The icon is `aria-hidden`; the button's accessible name is the label, not
 *   the glyph.
 *
 * ## Why the padding is on the input, not a wrapper hack
 *
 * The button is absolutely positioned inside a relative wrapper and the input
 * carries `pr-11` so typed text never slides under the icon. An input with an
 * overlaid toggle button is the standard pattern; the only thing that goes wrong
 * is text running under the icon, which the padding prevents.
 */
export function PasswordInput({
  className,
  showLabel,
  hideLabel,
  ...props
}: Omit<ComponentProps<typeof Input>, "type"> & {
  /** aria-label for the button when the password is hidden, e.g. "Passwort anzeigen". */
  showLabel: string
  /** aria-label for the button when the password is shown, e.g. "Passwort verbergen". */
  hideLabel: string
}) {
  const [visible, setVisible] = useState(false)
  // `useId` is called unconditionally — a hook cannot sit behind `??`, which
  // would skip it whenever `props.id` is set and violate the rules of hooks.
  // The generated id is only USED when the caller passed none.
  const generatedId = useId()
  const inputId = props.id ?? generatedId

  return (
    <div className="relative">
      <Input
        {...props}
        id={inputId}
        type={visible ? "text" : "password"}
        className={cn("pr-11", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        aria-controls={inputId}
        aria-label={visible ? hideLabel : showLabel}
        // 44px tall to match the input and clear the tap-target floor. Sits
        // over the input's right edge; `text-muted-foreground` so it reads as a
        // control, not a value.
        className={cn(
          "absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg",
          "text-muted-foreground transition-colors duration-[var(--duration-fast)]",
          "hover:text-foreground focus-visible:text-foreground",
          "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ring)]"
        )}
      >
        {visible ? (
          <EyeOff className="size-[1.15rem]" aria-hidden="true" />
        ) : (
          <Eye className="size-[1.15rem]" aria-hidden="true" />
        )}
      </button>
    </div>
  )
}
