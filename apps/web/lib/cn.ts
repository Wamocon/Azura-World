/**
 * Class merging. The single implementation in this repository.
 *
 * `lib/utils.ts` (W0-A) deliberately does NOT export `cn` and says so in its
 * header: two `cn` implementations is exactly the "second way to do something
 * that already has one" that CONVENTIONS §0 forbids. Every component imports
 * from here.
 *
 * `clsx` resolves conditional class expressions; `twMerge` then resolves
 * Tailwind conflicts *by precedence rather than by source order*, so a caller's
 * `className="px-8"` beats a component's built-in `px-4` no matter which order
 * they are concatenated in. Without the merge step, the built-in wins whenever
 * it happens to sort later in the stylesheet, which is why variant props and
 * `className` overrides appear to work in dev and fail in production.
 */

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/** Merge class names, resolving Tailwind conflicts in favour of the last writer. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
