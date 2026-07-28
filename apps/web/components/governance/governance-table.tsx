import type { ReactNode } from "react"

import { cn } from "@/lib/cn"

/**
 * The scroll frame every governance table sits in.              Owner: W3-F
 *
 * NOT `TableScrollArea` from `components/ui/table.tsx`. That one takes a
 * required pixel `height` because it owns the window arithmetic for a
 * **virtualised** body — it is the right frame for 656 rows in one scroll. Every
 * table in this module group is **server-paged** instead (25 or 50 rows a page,
 * `?auditPage=` in the URL), and a fixed 520px box around a three-row page is a
 * worse layout than no box at all.
 *
 * What it does keep is the part that matters at 320px: the table scrolls
 * sideways inside its own container so the page body never does. German runs
 * about 30% longer than English and Russian about 35%, and a five-column audit
 * table with a monospaced action name is the widest thing in this product.
 */
export function GovernanceTableFrame({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}): ReactNode {
  return (
    <div
      data-slot="governance-table-frame"
      className={cn(
        "azura-scrollbar-slim min-w-0 overflow-x-auto rounded-xl border border-border",
        className
      )}
    >
      {children}
    </div>
  )
}
