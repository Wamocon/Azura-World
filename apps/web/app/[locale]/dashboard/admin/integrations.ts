/**
 * Integration status, stated only as strongly as it has been observed.
 *                                                              Owner: W3-F
 *
 * `tasks/W3-F`: *"Integration status must be honest. Show configured / not
 * configured / unreachable per provider. Never render an unconfigured
 * integration as healthy."* And W4-C's honesty audit lists **"an unconfigured
 * integration shown as healthy"** as one of five High-severity failure modes,
 * currently `CLEAN at the contract, UNPROVEN at the surface`. This is the
 * surface.
 *
 * ## The four states, and the one that does most of the work
 *
 * | state                   | means                                                       |
 * |-------------------------|-------------------------------------------------------------|
 * | `not_configured`        | the settings for it are absent. It cannot work.             |
 * | `configured_unverified` | settings are present. **Nobody has contacted it.**          |
 * | `reachable`             | it was contacted, in this session, and it answered          |
 * | `unreachable`           | it was contacted, in this session, and it did not           |
 *
 * `configured_unverified` is the default and it is the honest one. A panel that
 * renders a filled-in environment variable as a green tick is claiming a fact
 * nobody established: the key may be revoked, the project paused, the URL a
 * typo. The three prohibited words here are "healthy", "connected" and "live" —
 * none of them is true of a variable that merely exists.
 *
 * ## Reachability is never probed on render
 *
 * Two reasons, and the first is the important one. **A page render that fans out
 * to four providers reports their latency as ours** — the panel would go slow,
 * or hang, exactly when an integration is broken, which is when someone is most
 * likely to be looking at it. The second is that an automatic probe on every
 * render is an unbounded outbound request rate driven by page views.
 *
 * So `probeSupabase()` is invoked by an explicit user action (`./actions.ts`),
 * with a hard timeout, and its result is shown as an observation with a
 * timestamp rather than as the provider's standing state.
 *
 * ## Declared is not wired
 *
 * `wired: false` marks a provider this codebase has configuration for but no
 * code path that calls. Displaying those as integrations at all would overclaim;
 * omitting them would hide that the configuration exists. So they are listed and
 * labelled, which is what the reference project's status document means by
 * refusing to present provider-capable contracts as live integrations.
 */

import {
  isAiGatewayConfigured,
  isSupabaseConfigured,
  publicEnv,
} from "@/lib/env"

export type IntegrationState =
  "not_configured" | "configured_unverified" | "reachable" | "unreachable"

export interface IntegrationStatus {
  /** Stable key. Also the message key: `dashboard.admin.integrations.<id>`. */
  id: string
  state: IntegrationState
  /**
   * False when configuration for this provider exists but **no code path in
   * this repository calls it**. A wired:false provider can never be more than
   * `configured_unverified`, because nothing here would notice if it broke.
   */
  wired: boolean
  /**
   * What the state was read from. Never a value, only a name — SEC-010 is a
   * Medium against publishing the server variable inventory to the browser, and
   * this string is rendered.
   */
  readFrom: string
}

/**
 * Status for every provider, from configuration alone.
 *
 * Synchronous and I/O-free by construction: if this function could make a
 * request, some later edit would make it make one on every render.
 */
export function integrationStatuses(): readonly IntegrationStatus[] {
  return Object.freeze([
    {
      id: "supabase",
      state: isSupabaseConfigured()
        ? ("configured_unverified" as const)
        : ("not_configured" as const),
      wired: true,
      readFrom: "NEXT_PUBLIC_SUPABASE_URL",
    },
    {
      id: "storage",
      // Storage is part of the same project, so its configuration cannot be
      // more present than Supabase's. It is listed separately because the two
      // can fail independently, and this panel exists for the person reading it
      // to find out why an upload did not work.
      //
      // The comment here used to say "a configured project with no bucket
      // created is the exact state this deployment is in". That stopped being
      // true on 2026-08-03, when `azura-documents` and `azura-evidence` were
      // created — and the copy beside it went on telling administrators to
      // create a bucket that already existed. The real blocker was never the
      // bucket: it was a revoked INSERT grant on `documents` and RLS enabled on
      // `storage.objects` with zero policies, both closed by migration 26.
      state: isSupabaseConfigured()
        ? ("configured_unverified" as const)
        : ("not_configured" as const),
      wired: true,
      readFrom: "NEXT_PUBLIC_SUPABASE_URL",
    },
    {
      id: "aiGateway",
      state: isAiGatewayConfigured()
        ? ("configured_unverified" as const)
        : ("not_configured" as const),
      wired: true,
      readFrom: "AI_GATEWAY_API_KEY",
    },
    {
      id: "jira",
      // Declared in `lib/env.ts` and used by no application code path — only by
      // a script. `wired: false` is the honest label.
      state: "not_configured" as const,
      wired: false,
      readFrom: "JIRA_API_TOKEN",
    },
  ])
}

/**
 * True when nothing at all is configured.
 *
 * Used to render one clear sentence instead of four identical rows: a reader
 * needs to know "this build has no integrations" before they need the
 * per-provider breakdown.
 */
export function noIntegrationsConfigured(
  statuses: readonly IntegrationStatus[]
): boolean {
  return statuses.every((status) => status.state === "not_configured")
}

/** A reachability observation, with the instant it was taken. */
export interface ReachabilityObservation {
  id: string
  state: "reachable" | "unreachable"
  observedAt: string
  /** Round trip in milliseconds. `null` when the attempt did not complete. */
  latencyMs: number | null
}

/** Hard ceiling on the probe. A status panel must never be the slow page. */
export const PROBE_TIMEOUT_MS = 4_000

/**
 * Contact Supabase once and report what happened.
 *
 * Deliberately unauthenticated and deliberately uninterested in the status code:
 * the question is "does something answer at this URL", and a `401` from the REST
 * endpoint answers it as well as a `200` does. Only a transport failure or the
 * timeout counts as `unreachable`, which keeps the check from reporting a
 * permissions problem as an outage.
 */
export async function probeSupabase(): Promise<ReachabilityObservation> {
  const url = publicEnv.NEXT_PUBLIC_SUPABASE_URL
  const startedAt = Date.now()

  if (url === undefined) {
    return {
      id: "supabase",
      state: "unreachable",
      observedAt: new Date().toISOString(),
      latencyMs: null,
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, PROBE_TIMEOUT_MS)

  try {
    await fetch(`${url}/rest/v1/`, {
      method: "HEAD",
      signal: controller.signal,
      cache: "no-store",
    })
    return {
      id: "supabase",
      state: "reachable",
      observedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
    }
  } catch {
    return {
      id: "supabase",
      state: "unreachable",
      observedAt: new Date().toISOString(),
      latencyMs: null,
    }
  } finally {
    clearTimeout(timer)
  }
}
