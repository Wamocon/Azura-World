"use client"

/**
 * Is the browser online, and is this tab visible?
 *
 * Two signals that both change how hard the app should work, kept in one hook so
 * the polling loop has a single thing to read.
 *
 * `navigator.onLine` is famously optimistic — it reports "online" for a laptop
 * connected to a captive-portal wifi with no route to anywhere. It is used here
 * only to decide when to *stop* trying, never to decide that a request will
 * succeed; a failed fetch is what actually demotes the mode.
 */

import { useEffect, useState } from "react"

export interface ConnectionStatus {
  online: boolean
  /** False when the tab is backgrounded. Polling pauses; it does not stop. */
  visible: boolean
}

function readStatus(): ConnectionStatus {
  // SSR has neither. Assuming online+visible matches what the first client
  // render will almost always find, so the markup does not flip on hydration.
  if (typeof window === "undefined") return { online: true, visible: true }
  return {
    online: window.navigator.onLine,
    visible: document.visibilityState === "visible",
  }
}

export function useConnectionStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(readStatus)

  useEffect(() => {
    const update = (): void => setStatus(readStatus())

    // `online`/`offline` fire on the window; `visibilitychange` on the document.
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    document.addEventListener("visibilitychange", update)

    // The state can have changed between the initial render and this effect —
    // a slow hydration on a flaky connection is exactly when that happens.
    update()

    return () => {
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
      document.removeEventListener("visibilitychange", update)
    }
  }, [])

  return status
}
