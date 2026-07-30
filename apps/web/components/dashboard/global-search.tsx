"use client"

import { Search, X } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"

import { Link } from "@/app/navigation"
import { cn } from "@/lib/cn"
import type { Locale } from "@/lib/contracts"
import { shellCopy } from "@/lib/dashboard-home-copy"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Global search — Cmd/Ctrl-K.                              Owner: W3-B
 *
 * Keyboard-first, debounced 200 ms, deep-links to records, grouped by entity.
 *
 * ROLE SCOPING IS THE SERVER'S JOB, NOT THIS COMPONENT'S. It calls
 * `/api/site-management/search`, which resolves the profile and filters
 * server-side. Sending a role from here and trusting it would make the search
 * endpoint an authorisation bypass: anyone can edit a request body. This
 * component renders whatever the endpoint returns and knows nothing about who
 * may see what.
 *
 * THE ENDPOINT DOES NOT EXIST YET — W2-B owns `app/api/site-management/*` and
 * W-INT §8 records that W2-B was not started. So the fetch is written against
 * the agreed shape and the component handles the 404 as a normal error state
 * rather than pretending to search. It does **not** fall back to filtering a
 * local list, because a search that quietly returns only the records that
 * happen to be in the browser is worse than one that says it is unavailable:
 * an empty result would read as "no such unit exists".
 */

/** The group a hit is shown under. */
export type HitEntity = "units" | "tickets" | "documents" | "people" | "site"

/** One hit, in the shape THIS component renders. */
export interface GlobalSearchHit {
  id: string
  entity: HitEntity
  title: string
  subtitle?: string
  /** Locale-less path. The locale prefix is added by `Link`. */
  href: string
}

/**
 * One hit as the ENDPOINT actually returns it.
 *
 * This is the field-name contract that the component was silently getting wrong.
 * The header comment said it "mirrors W2-A's SearchHit, which the endpoint will
 * return" — but `search_operational_records()` returns `entity_table`,
 * `entity_id`, `summary` and `metadata`, and NO `href` at all, and the API maps
 * them to camelCase as `entityTable`/`entityId`/`summary`/`metadata`. The old
 * code read `hit.entity` (always undefined) and grouped by it, so every real
 * match was filtered out and the palette showed "no results" for every query
 * even though the API returned 200 with hits. Confirmed live before fixing.
 */
interface RawSearchHit {
  entityTable: string
  entityId: string
  title: string
  summary?: string
  metadata?: Record<string, unknown> | null
}

interface SearchResponse {
  ok: boolean
  data?: { hits?: RawSearchHit[] }
}

/**
 * Map the source table to a display group, or `null` to drop a hit whose table
 * has no sensible destination. Only `units` and `sites` are indexed today; the
 * operational tables (tickets, documents, leads, residents) are listed so that
 * indexing them later needs no change here.
 */
function entityOf(table: string): HitEntity | null {
  switch (table) {
    case "units":
      return "units"
    case "service_tickets":
    case "tickets":
      return "tickets"
    case "documents":
      return "documents"
    case "leads":
    case "residents":
    case "profiles":
      return "people"
    case "sites":
      return "site"
    default:
      return null
  }
}

/**
 * The deep link for a hit.
 *
 * Units have no per-record detail route, so a unit hit lands on the inventory
 * where units live rather than a 404 — an honest destination, not a fake anchor.
 * Tickets do have a detail route and link straight to it.
 */
function hrefOf(table: string, id: string): string {
  switch (table) {
    case "service_tickets":
    case "tickets":
      return `/dashboard/tickets/${id}`
    case "documents":
      return "/dashboard/documents"
    case "leads":
      return "/dashboard/leads"
    case "residents":
    case "profiles":
      return "/dashboard/users"
    case "sites":
      return "/dashboard"
    case "units":
    default:
      return "/dashboard/units"
  }
}

/** Raw endpoint hit to the render shape, or `null` for an unmappable table. */
function toClientHit(raw: RawSearchHit): GlobalSearchHit | null {
  const entity = entityOf(raw.entityTable)
  if (entity === null) return null
  return {
    // Prefixed with the table so ids stay unique across entity types.
    id: `${raw.entityTable}-${raw.entityId}`,
    entity,
    title: raw.title,
    ...(raw.summary !== undefined && raw.summary.length > 0
      ? { subtitle: raw.summary }
      : {}),
    href: hrefOf(raw.entityTable, raw.entityId),
  }
}

const DEBOUNCE_MS = 200
const MIN_QUERY = 2

/** Stable identity, so the derived empty case does not churn on every render. */
const EMPTY_HITS: readonly GlobalSearchHit[] = Object.freeze([])

export function GlobalSearch({
  open,
  onOpenChange,
  locale,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  locale: string
}): ReactNode {
  const copy = shellCopy(locale)
  const t = useTranslations("dashboard.search")
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<GlobalSearchHit[]>([])
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle"
  )
  const [activeIndex, setActiveIndex] = useState(0)

  /** Clears every result-related field. Called from the dialog's close event —
   *  an event, not an effect, so there is no cascading render on open/close. */
  const reset = () => {
    setQuery("")
    setHits([])
    setState("idle")
    setActiveIndex(0)
  }

  // Cmd/Ctrl-K, from anywhere. Registered on the document because the shortcut
  // has to work while focus is inside a table cell or a form field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        onOpenChange(true)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [onOpenChange])

  // Native <dialog>: focus trap, Escape and inert background are the
  // platform's. `onClose` covers Escape as well as the close button, so the
  // parent's state cannot drift out of sync with the element's.
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    if (open && !dialog.open) {
      dialog.showModal()
      inputRef.current?.focus()
    }
    if (!open && dialog.open) dialog.close()
  }, [open])

  const trimmed = query.trim()
  const tooShort = trimmed.length < MIN_QUERY

  useEffect(() => {
    // Nothing to clear here: a too-short query is handled by DERIVING the
    // displayed state below rather than by writing state from this effect.
    // Deriving also removes a real flicker — deleting back to one character
    // used to show the previous query's hits until the clear landed.
    if (trimmed.length < MIN_QUERY) return

    // An AbortController per keystroke: without it a slow early response can
    // land after a fast later one and show results for a query the user has
    // already replaced.
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      // `setState` moved inside the timer: a synchronous write in the effect
      // body is a cascading render on every keystroke, and the spinner is not
      // wanted until the debounce has actually elapsed anyway.
      setState("loading")
      void (async () => {
        try {
          const response = await fetch(
            `/api/site-management/search?q=${encodeURIComponent(trimmed)}`,
            {
              signal: controller.signal,
              headers: { accept: "application/json" },
            }
          )
          if (!response.ok) {
            setState("error")
            return
          }
          const payload = (await response.json()) as SearchResponse
          // Map the endpoint's shape to the render shape and drop unmappable
          // tables. This is the line whose absence made search look broken.
          setHits(
            (payload.data?.hits ?? [])
              .map(toClientHit)
              .filter((hit): hit is GlobalSearchHit => hit !== null)
          )
          setActiveIndex(0)
          setState("ready")
        } catch (error) {
          // An abort is the expected outcome of typing, not a failure.
          if (error instanceof DOMException && error.name === "AbortError")
            return
          setState("error")
        }
      })()
    }, DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [trimmed])

  // Derived, not stored. `state` and `hits` describe the last query that was
  // actually issued; these describe what the user should be looking at now.
  const displayState = tooShort ? "idle" : state
  const displayHits = tooShort ? EMPTY_HITS : hits

  const groups = groupHits(displayHits)
  const flat = groups.flatMap((group) => group.hits)

  // Not `useCallback`: `flat` is rebuilt each render, so the memo could never
  // be preserved, and memoising one keydown handler on one input buys nothing.
  const onKeyDown = (event: React.KeyboardEvent) => {
    // Escape is handled HERE, not left to the dialog.
    //
    // `<input type="search">` consumes Escape to clear its own value, and
    // Chromium does not let it reach the <dialog>, so the platform's
    // close-on-Escape silently did not fire while the input had focus — which
    // is every time, since the dialog focuses it on open. Measured, not
    // guessed: the acceptance run reported `open=true` after Escape.
    if (event.key === "Escape") {
      event.preventDefault()
      dialogRef.current?.close()
      return
    }

    if (flat.length === 0) return

    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % flat.length)
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setActiveIndex((index) => (index - 1 + flat.length) % flat.length)
    }
    if (event.key === "Enter") {
      const hit = flat[activeIndex]
      if (hit !== undefined) {
        event.preventDefault()
        // Click the real link rather than router.push, so it keeps its
        // middle-click and open-in-new-tab behaviour for mouse users.
        document.getElementById(`search-hit-${hit.id}`)?.click()
      }
    }
  }

  const groupLabel = (entity: GlobalSearchHit["entity"]): string => {
    switch (entity) {
      case "units":
        return t("groupUnits")
      case "tickets":
        return t("groupTickets")
      case "documents":
        return t("groupDocuments")
      case "people":
        return t("groupPeople")
      case "site":
        return t("groupSite")
    }
  }

  return (
    <dialog
      ref={dialogRef}
      data-testid="global-search"
      onClose={() => {
        reset()
        onOpenChange(false)
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false)
      }}
      className={cn(
        "m-0 mx-auto mt-[10vh] w-[min(40rem,calc(100vw-2rem))] rounded-xl border border-border",
        "bg-popover p-0 text-popover-foreground shadow-2xl",
        "backdrop:bg-[color-mix(in_srgb,var(--sea-deep)_55%,transparent)]"
      )}
    >
      <div className="flex min-w-0 flex-col">
        <div className="flex min-w-0 items-center gap-2 border-b border-border px-3">
          <Search
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("placeholder")}
            aria-label={t("title")}
            data-testid="global-search-input"
            className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only">{copy.searchClose}</span>
          </button>
        </div>

        <div className="azura-scrollbar-slim max-h-[50vh] min-w-0 overflow-y-auto p-2">
          {displayState === "idle" ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {copy.searchTyping}
            </p>
          ) : displayState === "loading" ? (
            <div className="flex flex-col gap-2 p-1" aria-busy="true">
              <span className="sr-only">{copy.tableLoading}</span>
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} preset="control" />
              ))}
            </div>
          ) : displayState === "error" ? (
            <div className="flex flex-col gap-1 px-2 py-6 text-center">
              <p className="text-sm font-medium text-foreground">
                {copy.tableErrorTitle}
              </p>
              <p className="text-sm text-muted-foreground">
                {copy.tableErrorBody}
              </p>
            </div>
          ) : flat.length === 0 ? (
            <div className="flex flex-col gap-1 px-2 py-6 text-center">
              <p className="text-sm font-medium text-foreground">
                {t("noResults")}
              </p>
              <p className="text-sm text-muted-foreground">
                {copy.searchEmptyBody}
              </p>
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.entity} className="flex flex-col gap-1 pb-2">
                <p className="px-2 pt-2 text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                  {groupLabel(group.entity)}
                </p>
                {group.hits.map((hit) => {
                  const index = flat.indexOf(hit)
                  return (
                    <Link
                      key={hit.id}
                      id={`search-hit-${hit.id}`}
                      href={hit.href}
                      locale={locale as Locale}
                      onClick={() => onOpenChange(false)}
                      aria-current={index === activeIndex ? "true" : undefined}
                      className={cn(
                        "flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-2 text-sm",
                        "outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        index === activeIndex
                          ? "bg-secondary text-secondary-foreground"
                          : "hover:bg-muted"
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {hit.title}
                      </span>
                      {hit.subtitle === undefined ? null : (
                        <Badge variant="muted" className="shrink-0">
                          {hit.subtitle}
                        </Badge>
                      )}
                    </Link>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          {t("hint")}
        </p>
      </div>
    </dialog>
  )
}

/** Stable group order, so results do not reshuffle between keystrokes. */
const ENTITY_ORDER: ReadonlyArray<GlobalSearchHit["entity"]> = [
  "units",
  "tickets",
  "documents",
  "people",
  "site",
]

function groupHits(hits: readonly GlobalSearchHit[]): ReadonlyArray<{
  entity: GlobalSearchHit["entity"]
  hits: GlobalSearchHit[]
}> {
  const groups: Array<{
    entity: GlobalSearchHit["entity"]
    hits: GlobalSearchHit[]
  }> = []
  for (const entity of ENTITY_ORDER) {
    const matching = hits.filter((hit) => hit.entity === entity)
    if (matching.length > 0) groups.push({ entity, hits: matching })
  }
  return groups
}
