import { Bell, Command, Monitor, Moon, Search, Sun } from "lucide-react"
import { Colophon } from "@/components/radar/colophon"
import { SiteNav } from "@/components/radar/site-nav"
import type { ReactNode } from "react"

type Width = "prose" | "wide"

export function PageShell({
  children,
  width = "prose",
}: {
  children: ReactNode
  width?: Width
}) {
  const maxW = width === "wide" ? "max-w-[1760px]" : "max-w-[1360px]"
  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f7f7f6] text-ink">
      <SiteNav />
      <main className="min-w-0 lg:pl-[232px]">
        <div className={`mx-auto min-w-0 ${maxW} px-3 py-4 sm:px-4 sm:py-5 md:px-6 md:py-7`}>
          {children}
          <Colophon />
        </div>
      </main>
    </div>
  )
}

export function PageMasthead({
  layer,
  layerEn,
  title,
  subtitle,
}: {
  layer: string
  layerEn: string
  title: string
  subtitle: string
}) {
  return (
    <header className="max-w-full overflow-hidden rounded-[7px] border border-rule bg-white">
      <div className="flex min-h-14 items-center gap-3 border-b border-rule px-4 md:px-5">
        <div className="hidden h-9 min-w-[280px] flex-1 items-center gap-2 rounded-[7px] border border-rule bg-[#fafafa] px-3 text-sm text-ink-muted md:flex">
          <Search className="size-4" aria-hidden />
          <span className="truncate">搜索股票、因子、策略、数据源...</span>
          <span className="ml-auto inline-flex items-center gap-1 rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
            <Command className="size-3" aria-hidden />K
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <StatusPill label="All systems" value="operational" />
          <div className="hidden items-center gap-1 rounded-[7px] border border-rule p-1 sm:flex">
            <IconButton label="light"><Sun className="size-4" aria-hidden /></IconButton>
            <IconButton label="screen"><Monitor className="size-4" aria-hidden /></IconButton>
            <IconButton label="dark"><Moon className="size-4" aria-hidden /></IconButton>
          </div>
          <Bell className="size-4 text-ink-muted" aria-hidden />
          <span className="size-7 rounded-full border border-rule bg-[#f5f5f4]" aria-hidden />
        </div>
      </div>

      <div className="px-4 py-6 md:px-5 md:py-9">
        <div className="font-mono text-[11px] text-ink-muted">
          {layer} · {layerEn}
        </div>
        <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <h1 className="break-words text-[30px] font-semibold leading-[0.98] text-ink sm:text-[36px] md:text-[44px]">
              {title}
            </h1>
            <p className="mt-3 max-w-[760px] text-[14px] leading-6 text-ink-muted md:text-[15px]">
              {subtitle}
            </p>
          </div>
          <div className="w-fit max-w-full rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 font-mono text-[11px] text-ink-muted">
            <span className="text-ink">workspace</span>
            <span className="mx-2 text-ink-faint">/</span>
            live
          </div>
        </div>
      </div>
    </header>
  )
}

function StatusPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="hidden min-w-[156px] items-center gap-2 rounded-[7px] border border-rule px-3 py-1.5 md:flex">
      <span className="size-2 rounded-full bg-health-ok" aria-hidden />
      <span className="font-mono text-[11px] leading-tight text-ink-muted">
        <span className="block">{label}</span>
        <span className="block">{value}</span>
      </span>
    </div>
  )
}

function IconButton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <button className="grid size-7 place-items-center rounded-[5px] text-ink-muted hover:bg-[#f5f5f4] hover:text-ink" aria-label={label}>
      {children}
    </button>
  )
}
