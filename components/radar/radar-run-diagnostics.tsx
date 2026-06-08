import { Activity, Clock3, Database, RadioTower } from "lucide-react"
import { formatBeijingDateTime } from "@/lib/format"

type Props = {
  diagnostics: {
    quoteFetchedAt?: string
    quoteFallbackReason?: string
    fallbackReason?: string
    scanUniverse?: {
      label: string
      requestedSymbols: number
      historyAvailable: number
      skippedNoHistory: number
      quoteRequested: number
      quoteReturned: number
      note: string
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
    dataFreshness?: {
      latestDailyBarDate?: string
      latestQuoteDate?: string
      effectiveDataDate?: string
      blocksNewSignals: boolean
      dailyDataStale?: boolean
      staleReason?: string
    }
  }
}

export function RadarRunDiagnostics({ diagnostics }: Props) {
  const universe = diagnostics.scanUniverse
  if (!universe) return null

  const health = universe.skippedNoHistory === 0 && universe.quoteRequested === universe.quoteReturned
    ? diagnostics.dataFreshness?.dailyDataStale
      ? "有缺口"
      : "正常"
    : universe.historyAvailable === 0
      ? "不可运行"
      : "有缺口"

  return (
    <section className="mt-3 rounded-[7px] border border-rule bg-white px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
          <Activity className="size-4" aria-hidden />
          雷达运行诊断
        </div>
        <span className={`rounded-[5px] border border-rule bg-[#fafafa] px-2 py-1 font-mono text-[10px] ${health === "正常" ? "text-health-ok" : health === "有缺口" ? "text-warning" : "text-bear"}`}>
          {health}
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 2xl:grid-cols-1">
        <RunMetric
          icon={Database}
          label={universe.prefilter ? "全池预筛" : "统一扫描池"}
          value={universe.prefilter ? `${universe.prefilter.inputSymbols} → ${universe.prefilter.selectedSymbols}` : `${universe.requestedSymbols} 只`}
          note={universe.prefilter?.note ?? universe.label}
        />
        <RunMetric icon={Activity} label="可分析 K 线" value={`${universe.historyAvailable}/${universe.requestedSymbols}`} note={universe.skippedNoHistory > 0 ? `缺 ${universe.skippedNoHistory} 只历史数据` : "历史数据完整"} />
        <RunMetric icon={RadioTower} label="近实时报价" value={`${universe.quoteReturned}/${universe.quoteRequested}`} note={diagnostics.quoteFallbackReason ?? "候选股报价覆盖"} />
        <RunMetric
          icon={Clock3}
          label="数据时间"
          value={diagnostics.quoteFetchedAt ? formatBeijingDateTime(diagnostics.quoteFetchedAt, { seconds: true }) : "等待"}
          note={[
            diagnostics.dataFreshness?.latestDailyBarDate ? `日线 ${diagnostics.dataFreshness.latestDailyBarDate}` : null,
            diagnostics.dataFreshness?.latestQuoteDate ? `报价 ${diagnostics.dataFreshness.latestQuoteDate}` : null,
          ].filter(Boolean).join(" · ") || diagnostics.dataFreshness?.effectiveDataDate || "北京时间"}
        />
      </div>

      <p className="mt-3 rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-2 text-[12px] leading-5 text-ink-muted">
        {diagnostics.dataFreshness?.staleReason ?? diagnostics.fallbackReason ?? universe.note}
      </p>
    </section>
  )
}

function RunMetric({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  label: string
  value: string
  note: string
}) {
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2.5">
      <div className="flex items-center gap-2 font-mono text-[10px] text-ink-faint">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </div>
      <p className="mt-1 font-mono text-[16px] font-semibold text-ink">{value}</p>
      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-ink-muted">{note}</p>
    </div>
  )
}
