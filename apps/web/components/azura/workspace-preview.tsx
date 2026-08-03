import {
  FileText,
  Home,
  LayoutGrid,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"

/**
 * WorkspacePreview — the product, in a browser frame.         Owner: W-NIGHT
 *
 * 1Çatı's New Level landing shows the actual workspace in a chrome window so a
 * reader sees there is a real system behind the marketing. Azura had none of
 * that on the way in. This is that window: the nav a role would see, and one
 * panel of work.
 *
 * ## It is an illustration, and it says so
 *
 * A Server Component with no data fetch — the rows are a fixed, generic sample
 * (operations, not invented people), and the caption names them as sample data,
 * consistent with the demo-data disclosure the system section already carries.
 * It ships no JavaScript: the whole thing is static markup, so it costs the
 * landing budget nothing.
 */

const NAV: ReadonlyArray<{ key: string; icon: LucideIcon }> = [
  { key: "overview", icon: LayoutGrid },
  { key: "units", icon: Home },
  { key: "tickets", icon: Wrench },
  { key: "finance", icon: Wallet },
  { key: "documents", icon: FileText },
]

/**
 * The four sample rows: a message key, a block code, and a status tone. Keyed
 * by name rather than by array index because the message catalogue forbids
 * arrays (check-i18n rule 0b) — and a named key is what makes a translator's
 * job possible anyway.
 */
const ROWS: ReadonlyArray<{ key: string; block: string; color: string }> = [
  { key: "lift", block: "B03", color: "var(--chart-4)" }, // in progress → amber
  { key: "water", block: "B01", color: "var(--chart-2)" }, // open → blue
  { key: "pool", block: "B05", color: "var(--chart-3)" }, // done → green
  { key: "handover", block: "B07", color: "var(--chart-5)" }, // planned → slate
]

export async function WorkspacePreview({
  locale,
}: {
  locale: string
}): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing.workspace" })

  return (
    <figure className="m-0 flex flex-col gap-3">
      <div className="azura-pane overflow-hidden rounded-[var(--radius-2xl)] border border-[color-mix(in_srgb,var(--foreground)_12%,transparent)] shadow-[0_30px_70px_rgba(10,22,32,0.18)]">
        {/* Title bar. */}
        <div className="flex items-center gap-3 border-b border-[color-mix(in_srgb,var(--foreground)_10%,transparent)] bg-[color-mix(in_srgb,var(--foreground)_4%,transparent)] px-4 py-3">
          <span aria-hidden="true" className="flex gap-1.5">
            <span className="size-3 rounded-full bg-[#e0685c]" />
            <span className="size-3 rounded-full bg-[#e0a75c]" />
            <span className="size-3 rounded-full bg-[#5cc88a]" />
          </span>
          <span className="azura-label text-muted-foreground">{t("title")}</span>
        </div>

        <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] sm:grid-cols-[11rem_minmax(0,1fr)]">
          {/* Sidebar. Icon-only below sm, icon + label from sm. */}
          <nav
            aria-hidden="true"
            className="flex flex-col gap-1 border-r border-[color-mix(in_srgb,var(--foreground)_10%,transparent)] p-2 sm:p-3"
          >
            {NAV.map((item, index) => {
              const Icon = item.icon
              const active = index === 0
              return (
                <span
                  key={item.key}
                  className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.8125rem] ${
                    active
                      ? "bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] font-semibold text-primary"
                      : "text-muted-foreground"
                  }`}
                >
                  <Icon className="size-[1.05rem] shrink-0" />
                  <span className="hidden truncate sm:inline">
                    {t(`nav.${item.key}`)}
                  </span>
                </span>
              )
            })}
          </nav>

          {/* Main panel. */}
          <div className="min-w-0 p-4 sm:p-5">
            <h4 className="font-display text-[1rem] leading-none tracking-[-0.01em] text-foreground">
              {t("panelTitle")}
            </h4>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-left text-[0.8125rem]">
                <thead>
                  <tr className="border-b border-[color-mix(in_srgb,var(--foreground)_10%,transparent)] text-[0.6875rem] tracking-[0.06em] text-muted-foreground uppercase">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      {t("cols.block")}
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      {t("cols.task")}
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      {t("cols.status")}
                    </th>
                    <th
                      scope="col"
                      className="hidden py-2 pr-1 font-medium sm:table-cell"
                    >
                      {t("cols.due")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row) => (
                    <tr
                      key={row.key}
                      className="border-b border-[color-mix(in_srgb,var(--foreground)_7%,transparent)] last:border-0"
                    >
                      <td
                        data-numeric
                        className="py-2.5 pr-3 font-medium text-foreground"
                      >
                        {row.block}
                      </td>
                      <td className="py-2.5 pr-3 text-muted-foreground">
                        {t(`rows.${row.key}.task`)}
                      </td>
                      <td className="py-2.5 pr-3">
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium whitespace-nowrap"
                          style={{
                            color: row.color,
                            backgroundColor: `color-mix(in srgb, ${row.color} 14%, transparent)`,
                          }}
                        >
                          <span
                            aria-hidden="true"
                            className="size-1.5 rounded-full"
                            style={{ backgroundColor: row.color }}
                          />
                          {t(`rows.${row.key}.status`)}
                        </span>
                      </td>
                      <td
                        data-numeric
                        className="hidden py-2.5 pr-1 text-muted-foreground sm:table-cell"
                      >
                        {t(`rows.${row.key}.due`)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="text-[0.6875rem] leading-relaxed text-muted-foreground">
        {t("caption")}
      </figcaption>
    </figure>
  )
}
