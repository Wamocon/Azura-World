"use client"

import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useSyncExternalStore, type ReactNode } from "react"

import { Button } from "@/components/ui/button"

/**
 * Theme toggle — kitchen-sink only.                        Owner: W1-D
 *
 * The product's real switcher belongs with the chrome a W3-* window builds;
 * this exists so the design review can flip themes and screenshot both.
 *
 * `mounted` gates the render because the resolved theme is not knowable on the
 * server: `next-themes` reads localStorage and the system preference on the
 * client. Rendering the active state before that resolves guarantees a
 * hydration mismatch, and the usual "fix" — `suppressHydrationWarning` on the
 * button — hides the warning without fixing the wrong first paint.
 */
export function ThemeToggle(): ReactNode {
  const { theme, setTheme } = useTheme()

  // "Have we hydrated yet?" without a state write in an effect. The server
  // snapshot is false and the client snapshot is true, so React resolves it
  // during hydration rather than in a second paint.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )

  const options = [
    { value: "light", icon: Sun, label: "Hell" },
    { value: "dark", icon: Moon, label: "Dunkel" },
    { value: "system", icon: Monitor, label: "System" },
  ] as const

  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="theme-toggle">
      {options.map((option) => {
        const Icon = option.icon
        const active = mounted && theme === option.value
        return (
          <Button
            key={option.value}
            size="sm"
            variant={active ? "default" : "outline"}
            onClick={() => setTheme(option.value)}
            aria-pressed={active}
            data-testid={`theme-${option.value}`}
          >
            <Icon aria-hidden="true" />
            {option.label}
          </Button>
        )
      })}
    </div>
  )
}
