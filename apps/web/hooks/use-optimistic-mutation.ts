"use client"

/**
 * Optimistic mutation with exact rollback.
 *
 * The one rule that makes this safe: **rollback restores the captured prior
 * state, not a refetch.** A refetch on failure looks equivalent and is not —
 * it can race with another concurrent change and land the app in a state
 * neither the user nor the server intended, and it turns a local failure into a
 * network round trip at exactly the moment the network is misbehaving.
 *
 * The snapshot is captured *before* the optimistic update is applied and is
 * restored verbatim, so a failed mutation is invisible apart from the error.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import type { ApiError, ApiResponse } from "@/lib/contracts"

export interface UseOptimisticMutationConfig<TInput, TResult> {
  mutate: (input: TInput) => Promise<ApiResponse<TResult>>
  /** Pure. Must not mutate `current` — the snapshot is that array. */
  optimisticUpdate: (current: TResult[], input: TInput) => TResult[]
  /** The list this mutation acts on, and how to write it back. */
  state: TResult[]
  setState: (next: TResult[]) => void
  rollbackOnError?: boolean
  /** Called after a confirmed success, for cache invalidation. */
  onSettled?: () => void
}

export interface UseOptimisticMutationResult<TInput> {
  execute: (input: TInput) => Promise<boolean>
  isPending: boolean
  error: ApiError | null
}

export function useOptimisticMutation<TInput, TResult>(
  config: UseOptimisticMutationConfig<TInput, TResult>
): UseOptimisticMutationResult<TInput> {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  // Held in a ref so `execute` is stable and does not re-create on every render
  // of the list it operates on. Synced in an effect rather than during render:
  // a ref written while rendering is a tearing hazard under concurrent React.
  const configRef = useRef(config)
  useEffect(() => {
    configRef.current = config
  }, [config])

  const execute = useCallback(async (input: TInput): Promise<boolean> => {
    const {
      mutate,
      optimisticUpdate,
      state,
      setState,
      rollbackOnError = true,
      onSettled,
    } = configRef.current

    // Captured BEFORE the optimistic write, and copied — holding the caller's
    // array by reference would make the "snapshot" change underneath us if
    // anything else mutated it in place.
    const snapshot = [...state]

    setIsPending(true)
    setError(null)
    setState(optimisticUpdate(snapshot, input))

    try {
      const response = await mutate(input)
      if (!response.ok) {
        if (rollbackOnError) setState(snapshot)
        setError(response.error)
        return false
      }
      onSettled?.()
      return true
    } catch (caught) {
      if (rollbackOnError) setState(snapshot)
      setError({
        code: "upstream_failed",
        message:
          caught instanceof Error && caught.message.length < 200
            ? caught.message
            : "The change could not be saved.",
        retryable: true,
      })
      return false
    } finally {
      setIsPending(false)
    }
  }, [])

  return { execute, isPending, error }
}

/**
 * The rollback rule as a pure function, so it can be proved without React.
 *
 * Returns what the state should be after a mutation resolves. Exported for
 * `scripts/realtime-probe.mts`, which asserts that a failure restores the
 * snapshot **by value** — the brief's test 7, and the reason this logic is
 * separable from the hook at all.
 */
export function resolveMutationOutcome<TResult>(input: {
  snapshot: readonly TResult[]
  optimistic: readonly TResult[]
  succeeded: boolean
  rollbackOnError: boolean
}): TResult[] {
  if (input.succeeded) return [...input.optimistic]
  return input.rollbackOnError ? [...input.snapshot] : [...input.optimistic]
}
