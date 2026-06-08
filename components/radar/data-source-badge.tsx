import { Activity, Clock3, Database, Filter } from "lucide-react"
import { formatBeijingTime } from "@/lib/format"

type Props = {
  diagnostics: {
    source: "qveris+factors" | "mock+factors" | "fallback"
    qverisCount: number
    mockCount: number
    quoteCount: number
    quoteTotal: number
    quoteFetchedAt?: string
    quoteCacheAgeMs?: number
    quoteTtlMs?: number
    quoteFallbackReason?: string
    scanUniverse?: {
      requestedSymbols: number
      historyAvailable: number
      skippedNoHistory: number
      quoteRequested: number
      quoteReturned: number
      prefilter?: {
        source: "postgres-indicators" | "unavailable"
        inputSymbols: number
        selectedSymbols: number
        eligibleSymbols: number
        latestDate?: string
        minBars: number
        note: string
      }
    }
    intradayRadar?: {
      scanned: number
      quoted: number
      triggered: number
      patterns: Record<string, number>
    }
    factorIRs: { id: string; meanIC: number; ir: number }[]
    dataFreshness?: {
      latestBarDate?: string
      latestDailyBarDate?: string
      latestQuoteDate?: string
      effectiveDataDate?: string
      expectedTradeDate: string
      dailyDataStale?: boolean
      blocksNewSignals: boolean
      blocksPriceTracking?: boolean
      staleReason?: string
    }
    fallbackReason?: string
  }
}

export function DataSourceBadge({ diagnostics }: Props) {
  const {
    source,
    qverisCount,
    mockCount,
    quoteCount,
    quoteTotal,
    quoteFetchedAt,
    quoteCacheAgeMs,
    quoteTtlMs,
    quoteFallbackReason,
    scanUniverse,
    intradayRadar,
    factorIRs,
    dataFreshness,
    fallbackReason,
  } = diagnostics

  const isReal = source === "qveris+factors"
  const dailyDate = dataFreshness?.latestDailyBarDate ?? dataFreshness?.latestBarDate
  const quoteDate = dataFreshness?.latestQuoteDate
  const hasFreshnessIssue = Boolean(dataFreshness?.blocksNewSignals || dataFreshness?.dailyDataStale)
  const dotColor = hasFreshnessIssue ? "bg-[var(--health-warn)]" : isReal ? "bg-[var(--health-ok)]" : "bg-[var(--health-warn)]"
  const label = isReal
    ? scanUniverse?.prefilter
      ? `真实日线 · 全池 ${scanUniverse.prefilter.inputSymbols} 只 → 深算 ${scanUniverse.historyAvailable}/${scanUniverse.prefilter.selectedSymbols} 只${dailyDate ? ` · 日线 ${dailyDate}` : ""}${quoteDate ? ` · 报价 ${quoteDate}` : ""}`
      : `真实日线 · 可分析 ${scanUniverse?.historyAvailable ?? qverisCount} / ${scanUniverse?.requestedSymbols ?? qverisCount + mockCount} 只${dailyDate ? ` · 日线 ${dailyDate}` : ""}${quoteDate ? ` · 报价 ${quoteDate}` : ""}`
    : source === "mock+factors"
    ? `演示数据 · 全部 ${mockCount} 只为本地模拟 K 线`
    : `兜底数据 · ${fallbackReason ?? "数据源不可用"}`
  const quoteAgeMin = quoteCacheAgeMs == null ? null : Math.floor(quoteCacheAgeMs / 60_000)
  const quoteTtlMin = quoteTtlMs == null ? null : Math.round(quoteTtlMs / 60_000)
  const quoteTime = quoteFetchedAt ? formatBeijingTime(quoteFetchedAt) : null
  const statusLabel = hasFreshnessIssue ? "数据滞后" : isReal ? "真实数据" : source === "mock+factors" ? "演示数据" : "兜底数据"
  const quoteLabel = isReal
    ? `近实时 ${quoteCount}/${quoteTotal}${quoteTtlMin ? ` · ${quoteTtlMin}m TTL` : ""}`
    : "行情不可用"

  return (
    <section className="rounded-[7px] border border-rule bg-white" aria-label="数据源状态">
      <div className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`size-2 rounded-full ${dotColor}`} aria-hidden />
            <span className="font-mono text-[11px] text-ink-muted">可执行信号</span>
            <span className="rounded-[5px] bg-[#f5f5f4] px-2 py-0.5 font-mono text-[10px] text-ink-muted">
              {statusLabel}
            </span>
          </div>
          <p className="mt-1 truncate text-[13px] text-ink-soft">{label}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-muted">
          <StatusItem
            icon={Activity}
            label="扫描"
            value={scanUniverse?.prefilter
              ? `${scanUniverse.prefilter.inputSymbols}→${scanUniverse.historyAvailable}`
              : `${scanUniverse?.historyAvailable ?? qverisCount + mockCount}/${scanUniverse?.requestedSymbols ?? qverisCount + mockCount} 只`}
          />
          <StatusItem icon={Database} label="行情" value={quoteLabel} />
          <StatusItem icon={Clock3} label="最后更新" value={quoteTime ?? "等待"} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-rule-soft px-4 py-3 md:px-5">
        <span className="inline-flex items-center gap-1.5 rounded-[5px] border border-rule bg-ink px-2.5 py-1 font-mono text-[11px] text-white">
          <Filter className="size-3" aria-hidden />
          所有类型 {factorIRs.length}
        </span>
        {factorIRs.map((f) => (
          <span
            key={f.id}
            className="rounded-[5px] border border-rule bg-white px-2.5 py-1 font-mono text-[11px] text-ink-muted"
          >
            {f.id.replace("f-", "")} · IR {f.ir.toFixed(2)}
          </span>
        ))}
        {isReal && (
          <span className="rounded-[5px] border border-rule bg-[#f5f5f4] px-2.5 py-1 font-mono text-[11px] text-ink-muted">
            缓存 {quoteAgeMin ?? 0}m
          </span>
        )}
        {intradayRadar && (
          <span className="rounded-[5px] border border-[#cfe6d8] bg-[#eef8f2] px-2.5 py-1 font-mono text-[11px] text-health-ok">
            盘中触发 {intradayRadar.triggered} / 报价 {intradayRadar.quoted}
          </span>
        )}
        {scanUniverse?.prefilter && (
          <span className="rounded-[5px] border border-[#cfe6d8] bg-[#eef8f2] px-2.5 py-1 font-mono text-[11px] text-health-ok">
            预筛 {scanUniverse.prefilter.inputSymbols} → {scanUniverse.prefilter.selectedSymbols}
          </span>
        )}
        {fallbackReason && source !== "fallback" && (
          <span className="rounded-[5px] border border-rule bg-[#fff7e8] px-2.5 py-1 text-[11px] text-ink-muted">
            {fallbackReason}
          </span>
        )}
        {dataFreshness?.staleReason && (
          <span className="rounded-[5px] border border-rule bg-[#fff7e8] px-2.5 py-1 text-[11px] text-ink-muted">
            {dataFreshness.staleReason}
          </span>
        )}
        {quoteFallbackReason && (
          <span className="rounded-[5px] border border-rule bg-[#fff7e8] px-2.5 py-1 text-[11px] text-ink-muted">
            {quoteFallbackReason}
          </span>
        )}
      </div>
    </section>
  )
}

function StatusItem({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  label: string
  value: string
}) {
  return (
    <span className="inline-flex h-8 items-center gap-2 rounded-[7px] border border-rule bg-[#fafafa] px-2.5">
      <Icon className="size-3.5 text-ink-muted" aria-hidden />
      <span className="font-mono text-[10px] text-ink-faint">{label}</span>
      <span className="font-mono text-[11px] text-ink-soft">{value}</span>
    </span>
  )
}
