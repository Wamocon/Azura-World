import type { ReactNode } from "react"

import type { SourcedFact } from "@/lib/contracts"
import type { SourceChipLabels } from "./source-chip"

/**
 * The conflict popover. **Renders nothing since P2.**       Owner: W1-D · PIVOT P2
 *
 * `PIVOT.md` §4 removes conflict popovers from every surface. Pass 1 makes this
 * a no-op; pass 2 deletes it with its call sites.
 *
 * Worth stating plainly for whoever picks up pass 2, because it is the largest
 * single thing this pivot gives up: the disagreement between publishers is not
 * deleted, it is unrendered. `SourcedFact.conflictsWith` is still populated by
 * the generator, still carried through every repository, and still asserted by
 * `assertFactInvariants()`. Nothing in the dataset changed. What changed is that
 * the application no longer shows the client that four portals disagree about
 * the price of their own apartments.
 */

export interface ConflictLabels {
  /** Trigger, e.g. "Quellen widersprechen sich" */
  trigger: string
  /** Heading, e.g. "Konkurrierende Werte" */
  heading: string
  /** Template with a `{count}` placeholder. */
  summary: string
  /** The displayed value's own row, e.g. "Angezeigter Wert" */
  displayed: string
  /** Why nothing was picked. */
  unresolvedNote: string
  close: string
  source: SourceChipLabels
}

export function ConflictPopover<T>(props: {
  fact: SourcedFact<T>
  locale: string
  labels: ConflictLabels
  formatValue: (value: unknown) => string
  snapshotBasePath?: string
  className?: string
}): ReactNode {
  void props
  return null
}
