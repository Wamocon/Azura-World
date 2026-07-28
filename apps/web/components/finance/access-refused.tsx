import type { ReactNode } from "react"

/**
 * The refusal panel every finance surface renders.             Owner: W3-D
 *
 * A component rather than a helper inside each `page.tsx`, for two reasons.
 * Next only expects `default`, `metadata` and the segment-config exports from a
 * route file, so a second exported component there is a shape the framework
 * does not promise to keep supporting. And three surfaces refusing three
 * slightly different ways is how one of them ends up leaking a heading it
 * should not have rendered.
 *
 * **403, never a redirect.** W3-B's contract spells out why: a redirect
 * destroys the URL the user was trying to reach, so they cannot pass it to
 * somebody who does have access; it loops for a role that also lacks
 * `dashboard:view`; and it races the explanation it renders beside.
 *
 * `role="alert"` because this replaced content the reader asked for. The page
 * heading is still rendered, so the browser tab and the back button still make
 * sense, but nothing below it is fetched.
 */
export function AccessRefused({
  title,
  message,
  hint,
}: {
  title: string
  message: string
  hint: string
}): ReactNode {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
        {title}
      </h1>
      <div
        role="alert"
        className="flex max-w-prose flex-col gap-1.5 rounded-xl border border-confidence-conflicted/40 bg-confidence-conflicted/5 px-4 py-3"
      >
        <p className="text-sm font-semibold text-foreground">{message}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">{hint}</p>
      </div>
    </div>
  )
}
