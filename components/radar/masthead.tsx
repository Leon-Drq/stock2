import { CHINA_TIME_LABEL, formatReportDate } from "@/lib/format"
import { Bell, Command, Monitor, Moon, Search, Sun } from "lucide-react"

type MastheadProps = {
  reportType: string
  generatedAt: string
}

export function Masthead({ reportType, generatedAt }: MastheadProps) {
  const { date, time, weekday } = formatReportDate(generatedAt)

  return (
    <header className="border-b border-rule bg-white">
      <div className="hidden min-h-14 items-center gap-3 border-b border-rule px-4 md:flex md:px-6">
        <div className="hidden h-9 min-w-[360px] max-w-[520px] flex-1 items-center gap-2 rounded-[7px] border border-rule bg-[#fafafa] px-3 text-sm text-ink-muted md:flex">
          <Search className="size-4" aria-hidden />
          <span className="truncate">搜索股票、地址、交易信号...</span>
          <span className="ml-auto inline-flex items-center gap-1 rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
            <Command className="size-3" aria-hidden />K
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <StatusPill label="All systems" value="operational" />
          <div className="hidden rounded-[7px] border border-rule px-3 py-1.5 font-mono text-[11px] leading-tight text-ink-muted sm:block">
            <span className="block tabular">{time}</span>
            <span className="block">{CHINA_TIME_LABEL}</span>
          </div>
          <div className="hidden items-center gap-1 rounded-[7px] border border-rule p-1 md:flex">
            <IconButton label="light"><Sun className="size-4" aria-hidden /></IconButton>
            <IconButton label="screen"><Monitor className="size-4" aria-hidden /></IconButton>
            <IconButton label="dark"><Moon className="size-4" aria-hidden /></IconButton>
          </div>
          <Bell className="size-4 text-ink-muted" aria-hidden />
          <span className="size-7 rounded-full border border-rule bg-[#f5f5f4]" aria-hidden />
        </div>
      </div>
      <div className="px-3 py-4 sm:px-4 sm:py-5 md:px-6 md:py-10">
        <div className="flex flex-col gap-3">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
            {reportType} · {date} · {weekday} · {CHINA_TIME_LABEL} {time}
          </div>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="break-words text-[26px] font-semibold leading-[0.98] tracking-normal text-ink sm:text-[34px] md:text-[44px]">
                策略雷达
              </h1>
              <p className="mt-3 hidden max-w-[760px] text-[14px] leading-6 text-ink-muted sm:block md:text-[15px]">
                只展示通过真实回测与注册表准入的上线策略；观察池和未达标策略留在策略层诊断，不占用雷达推荐位。
              </p>
            </div>
            <div className="hidden rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 font-mono text-[11px] text-ink-muted sm:block">
              <span className="text-ink">No. 098</span>
              <span className="mx-2 text-ink-faint">/</span>
              registry scan
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}

function StatusPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="hidden min-w-[156px] items-center gap-2 rounded-[7px] border border-rule px-3 py-1.5 sm:flex">
      <span className="size-2 rounded-full bg-health-ok" aria-hidden />
      <span className="font-mono text-[11px] leading-tight text-ink-muted">
        <span className="block">{label}</span>
        <span className="block">{value}</span>
      </span>
    </div>
  )
}

function IconButton({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <button className="grid size-7 place-items-center rounded-[5px] text-ink-muted hover:bg-[#f5f5f4] hover:text-ink" aria-label={label}>
      {children}
    </button>
  )
}
