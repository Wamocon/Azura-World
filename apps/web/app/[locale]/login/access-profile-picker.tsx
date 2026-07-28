"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { roles, type Role } from "@/lib/contracts"

/**
 * The QA role picker.                                         Owner: W3-H
 *
 * **A deliberate backdoor, and it is labelled as one on screen.**
 *
 * It adopts any of the eleven roles with no password. That is the whole point in
 * a review environment and a catastrophe anywhere else, so three separate things
 * have to be true before it can render:
 *
 *  1. `isAccessProfileEnabled()` is true — checked on the server, in `page.tsx`.
 *     This component is not imported at all when it is false.
 *  2. `lib/access-profile-policy.ts`'s module-load guard did not refuse the
 *     process. In a production environment with the flags set it throws, and the
 *     server never starts.
 *  3. `POST /api/access-profile` itself re-checks. This component's request is
 *     rejected there too, so a copy of this UI pasted into a browser console
 *     gains nothing.
 *
 * `tasks/W3-H` §1 puts it plainly: *"your job is to not add a second path around
 * it."* So there is no local fallback, no optimistic cookie write, and no
 * `document.cookie` anywhere in this file. Every role change is a server
 * decision that this component only asks for.
 *
 * ## Why the banner is loud
 *
 * A reviewer who forgets which mode they are in will report "the dashboard shows
 * everything to everyone" as a security bug, or worse, will not report it. The
 * banner uses the destructive token, states that there is no real authentication,
 * and is not dismissible.
 */
export function AccessProfilePicker({
  locale,
  labels,
}: {
  locale: string
  labels: {
    heading: string
    warning: string
    apply: string
    applying: string
    failed: string
  }
}): React.JSX.Element {
  const [role, setRole] = useState<Role>("manager")
  const [status, setStatus] = useState<"idle" | "pending" | "failed">("idle")

  async function adopt(): Promise<void> {
    setStatus("pending")
    try {
      const response = await fetch("/api/access-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      })
      if (!response.ok) {
        setStatus("failed")
        return
      }
      // A full navigation, not a client transition: the role lives in a cookie
      // the server reads, so every cached server component has to be rebuilt
      // against the new identity. A soft push would leave the previous role's
      // markup on screen under the new role's cookie.
      window.location.assign(`/${locale}/dashboard`)
    } catch {
      setStatus("failed")
    }
  }

  return (
    <section
      aria-labelledby="qa-mode-heading"
      className="rounded-xl border-2 border-destructive/50 bg-destructive/5 p-4"
    >
      <h2
        id="qa-mode-heading"
        className="text-sm font-semibold tracking-[0.08em] text-destructive uppercase"
      >
        {labels.heading}
      </h2>
      <p className="mt-1.5 text-sm text-foreground/80">{labels.warning}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label htmlFor="qa-role" className="sr-only">
          {labels.heading}
        </label>
        <select
          id="qa-role"
          value={role}
          onChange={(event) => setRole(event.target.value as Role)}
          className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {roles.map((candidate) => (
            <option key={candidate} value={candidate}>
              {candidate}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          onClick={() => void adopt()}
          disabled={status === "pending"}
        >
          {status === "pending" ? labels.applying : labels.apply}
        </Button>
      </div>

      {status === "failed" ? (
        <p role="alert" className="mt-3 text-sm font-medium text-destructive">
          {labels.failed}
        </p>
      ) : null}
    </section>
  )
}
