import Link from "next/link"
import { ArrowRight, Bell, Command, Monitor, Moon, Search, Sun } from "lucide-react"
import { CHINA_TIME_LABEL, formatReportDate } from "@/lib/format"

export function HomeMasthead() {
  const now = formatReportDate(new Date().toISOString())

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
          <div className="hidden min-w-[156px] items-center gap-2 rounded-[7px] border border-rule px-3 py-1.5 md:flex">
            <span className="size-2 rounded-full bg-health-ok" aria-hidden />
            <span className="font-mono text-[11px] leading-tight text-ink-muted">
              <span className="block">All systems</span>
              <span className="block">operational</span>
            </span>
          </div>
          <div className="hidden items-center gap-1 rounded-[7px] border border-rule p-1 sm:flex">
            <IconButton label="light"><Sun className="size-4" aria-hidden /></IconButton>
            <IconButton label="screen"><Monitor className="size-4" aria-hidden /></IconButton>
            <IconButton label="dark"><Moon className="size-4" aria-hidden /></IconButton>
          </div>
          <Bell className="size-4 text-ink-muted" aria-hidden />
          <span className="size-7 rounded-full border border-rule bg-[#f5f5f4]" aria-hidden />
        </div>
      </div>

      <div className="px-4 py-6 md:px-5 md:py-8">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-ink-muted">
          <span>Today · A 股 · 交易驾驶舱</span>
          <span className="text-ink-faint">·</span>
          <span>{CHINA_TIME_LABEL} {now.date} {now.weekday} {now.time}</span>
        </div>
        <div className="mt-4 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <h1 className="text-[32px] font-semibold leading-[1.04] text-ink sm:text-[42px] md:text-[56px]">
              今日交易<br className="sm:hidden" />驾驶舱
            </h1>
            <p className="mt-4 max-w-[680px] text-[15px] leading-7 text-ink-muted md:text-[16px]">
              先看今天能买什么、什么时候触发、止盈止损在哪里，以及哪些信号已经卖出或被多策略共振确认。
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row md:flex-col xl:flex-row">
            <Link href="/radar" className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[7px] bg-ink px-3 text-[12px] font-medium text-white">
              进入策略雷达 <ArrowRight className="size-3.5" aria-hidden />
            </Link>
            <Link href="/simulation" className="inline-flex h-9 items-center justify-center rounded-[7px] border border-rule bg-[#fafafa] px-3 font-mono text-[11px] text-ink-muted hover:bg-white hover:text-ink">
              查看实盘模拟
            </Link>
          </div>
        </div>
      </div>
    </header>
  )
}

function IconButton({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <button className="grid size-7 place-items-center rounded-[5px] text-ink-muted hover:bg-[#f5f5f4] hover:text-ink" aria-label={label}>
      {children}
    </button>
  )
}
