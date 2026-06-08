"use client"

import { useEffect, useState, type ComponentType } from "react"
import { Activity, AlertTriangle, CheckCircle2, Database, Loader2, RadioTower, RefreshCw, ShieldCheck } from "lucide-react"
import type { MarketDataQualitySnapshot } from "@/lib/backtest-data-store"

type MissingQuoteSymbol = {
  symbol: string
  name: string
  industry: string
}

type DataQualityResponse = {
  ok: boolean
  checkedAt: string
  quality: MarketDataQualitySnapshot
  realtimeQuotes: {
    qverisCount: number
    totalSymbols: number
    fetchedAt: string
    ttlMs: number
    cacheAgeMs: number
    fallbackReason?: string
    latestTradeStamp?: string | null
    missingSymbols: MissingQuoteSymbol[]
  }
}

export function DataTrustSection() {
  const [snapshot, setSnapshot] = useState<DataQualityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/data-quality/status", { cache: "no-store" })
      const json = (await res.json()) as DataQualityResponse
      if (!res.ok || !json.ok) throw new Error(`HTTP ${res.status}`)
      setSnapshot(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : "数据可信度审计失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  if (!snapshot) {
    return (
      <>
        <DataTrustFallback />
        {error && (
          <p className="mt-3 rounded-[7px] border border-warning/20 bg-warning/5 px-3 py-2 text-[12px] leading-5 text-warning">
            {error}
          </p>
        )}
      </>
    )
  }

  const { quality, realtimeQuotes } = snapshot
  const quoteMissing = realtimeQuotes.missingSymbols.slice(0, 16)
  const overallScore = Math.round(
    quality.stockPoolCoveragePct * 0.42 +
      quotePct(realtimeQuotes.qverisCount, realtimeQuotes.totalSymbols) * 0.24 +
      quality.fieldCoverage.indicatorPct * 0.18 +
      Math.min(100, quality.fieldCoverage.factorPct) * 0.1 +
      (quality.anomalyRows === 0 ? 100 : 70) * 0.06,
  )

  return (
    <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <ShieldCheck className="size-4" aria-hidden />
            data reliability
          </div>
          <h2 className="mt-2 text-[20px] font-semibold text-ink">数据可信度审计</h2>
          <p className="mt-1 max-w-[860px] text-[13px] leading-6 text-ink-muted">
            回测和雷达共用这一层数据：历史 K 线、派生指标、因子值、Qveris 近实时快照都会在这里对账。缺失、滞后、异常价格不会被吞掉。
          </p>
        </div>
        <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 text-right">
          <p className="font-mono text-[10px] text-ink-faint">trust score</p>
          <div className="flex items-center justify-end gap-2">
            {loading ? <Loader2 className="size-3.5 animate-spin text-ink-faint" aria-hidden /> : null}
            <p className={`font-mono text-[24px] font-semibold ${overallScore >= 85 ? "text-health-ok" : overallScore >= 65 ? "text-warning" : "text-bear"}`}>
              {overallScore}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] text-ink-faint disabled:opacity-50"
          >
            <RefreshCw className="size-3" aria-hidden />
            refresh
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        <TrustKpi icon={Database} label="历史覆盖" value={`${quality.coveredStockPoolSymbols}/${quality.stockPoolSymbols}`} sub={`${quality.stockPoolCoveragePct.toFixed(1)}% 股票池`} good={quality.stockPoolCoveragePct >= 95} />
        <TrustKpi icon={Activity} label="K线行数" value={formatInt(quality.barRows)} sub={`${quality.earliestDate ?? "N/A"} → ${quality.latestDate ?? "N/A"}`} good={quality.barRows > 0} />
        <TrustKpi icon={RadioTower} label="实时行情" value={`${realtimeQuotes.qverisCount}/${realtimeQuotes.totalSymbols}`} sub={realtimeQuotes.latestTradeStamp ?? "等待快照"} good={realtimeQuotes.qverisCount / Math.max(1, realtimeQuotes.totalSymbols) >= 0.9} />
        <TrustKpi icon={CheckCircle2} label="指标覆盖" value={`${quality.fieldCoverage.indicatorPct.toFixed(1)}%`} sub="MA / ATR / RSI" good={quality.fieldCoverage.indicatorPct >= 95} />
        <TrustKpi icon={CheckCircle2} label="因子覆盖" value={`${quality.fieldCoverage.factorPct.toFixed(1)}%`} sub="7 个派生因子" good={quality.fieldCoverage.factorPct >= 90} />
        <TrustKpi icon={AlertTriangle} label="异常样本" value={`${quality.anomalyRows}`} sub="OHLC / 涨跌幅" good={quality.anomalyRows === 0} />
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-[7px] border border-rule bg-[#fafafa] p-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[13px] font-semibold text-ink">字段完整度</h3>
            <span className="font-mono text-[10px] text-ink-faint">structured columns</span>
          </div>
          <div className="mt-3 space-y-2">
            <CoverageBar label="成交额 amount" value={quality.fieldCoverage.amountPct} />
            <CoverageBar label="换手率 turnover" value={quality.fieldCoverage.turnoverPct} />
            <CoverageBar label="复权因子 adjustment" value={quality.fieldCoverage.adjustmentPct} />
            <CoverageBar label="技术指标 indicators" value={quality.fieldCoverage.indicatorPct} />
            <CoverageBar label="因子值 factors" value={quality.fieldCoverage.factorPct} />
          </div>
        </div>

        <div className="rounded-[7px] border border-rule bg-[#fafafa] p-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[13px] font-semibold text-ink">覆盖缺口</h3>
            <span className="font-mono text-[10px] text-ink-faint">target {quality.targetUniverseSize}</span>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <GapList
              title="历史 K 线缺失"
              empty="当前股票池已全部入库"
              items={quality.missingSymbols.map((stock) => `${stock.name} ${stock.symbol}`)}
            />
            <GapList
              title="实时快照缺失"
              empty="实时行情覆盖完整"
              items={quoteMissing.map((stock) => `${stock.name} ${stock.symbol}`)}
            />
          </div>
        </div>
      </div>

      {(quality.notes.length > 0 || quality.error || realtimeQuotes.fallbackReason || error) && (
        <div className="mt-3 space-y-2">
          {[...quality.notes, quality.error, realtimeQuotes.fallbackReason, error].filter(Boolean).map((note) => (
            <p key={note} className="rounded-[7px] border border-warning/20 bg-warning/5 px-3 py-2 text-[12px] leading-5 text-warning">
              {note}
            </p>
          ))}
        </div>
      )}

      {(quality.staleSymbols.length > 0 || quality.shortHistorySymbols.length > 0 || quality.anomalySamples.length > 0) && (
        <div className="mt-4 grid gap-3 xl:grid-cols-3">
          <MiniTable
            title="日期滞后"
            empty="没有发现日期滞后样本"
            rows={quality.staleSymbols.slice(0, 8).map((item) => [
              `${item.name} ${item.symbol}`,
              item.latestDate ?? "N/A",
              `${item.staleDays} 天`,
            ])}
          />
          <MiniTable
            title="样本不足"
            empty="没有发现样本不足股票"
            rows={quality.shortHistorySymbols.slice(0, 8).map((item) => [
              `${item.name} ${item.symbol}`,
              item.latestDate ?? "N/A",
              `${item.bars} 根`,
            ])}
          />
          <MiniTable
            title="异常价格样本"
            empty="没有发现异常 OHLC"
            rows={quality.anomalySamples.slice(0, 8).map((item) => [
              `${item.name} ${item.symbol}`,
              item.tradeDate,
              item.issue,
            ])}
          />
        </div>
      )}
    </section>
  )
}

export function DataTrustFallback() {
  return (
    <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="h-5 w-44 animate-pulse bg-rule-soft" />
      <div className="mt-3 h-4 w-2/3 animate-pulse bg-rule-soft" />
      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-20 animate-pulse rounded-[7px] border border-rule bg-[#fafafa]" />
        ))}
      </div>
    </section>
  )
}

function TrustKpi({
  icon: Icon,
  label,
  value,
  sub,
  good,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  label: string
  value: string
  sub: string
  good: boolean
}) {
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-ink-faint">{label}</span>
        <Icon className={`size-3.5 ${good ? "text-health-ok" : "text-warning"}`} aria-hidden />
      </div>
      <p className="mt-2 truncate font-mono text-[17px] font-semibold text-ink">{value}</p>
      <p className="mt-1 truncate text-[11px] text-ink-muted">{sub}</p>
    </div>
  )
}

function CoverageBar({ label, value }: { label: string; value: number }) {
  const capped = Math.max(0, Math.min(100, value))
  const color = capped >= 90 ? "bg-health-ok" : capped >= 60 ? "bg-warning" : "bg-bear"
  return (
    <div>
      <div className="flex items-center justify-between gap-3 font-mono text-[11px]">
        <span className="text-ink-muted">{label}</span>
        <span className="text-ink">{value.toFixed(1)}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-rule-soft">
        <div className={`h-full ${color}`} style={{ width: `${capped}%` }} />
      </div>
    </div>
  )
}

function GapList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="rounded-[7px] border border-rule bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-medium text-ink">{title}</span>
        <span className="font-mono text-[10px] text-ink-faint">{items.length}</span>
      </div>
      {items.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {items.slice(0, 10).map((item) => (
            <span key={item} className="rounded-[5px] border border-rule bg-[#fafafa] px-2 py-1 font-mono text-[10px] text-ink-muted">
              {item}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-health-ok">{empty}</p>
      )}
    </div>
  )
}

function MiniTable({ title, rows, empty }: { title: string; rows: string[][]; empty: string }) {
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        <span className="font-mono text-[10px] text-ink-faint">{rows.length}</span>
      </div>
      {rows.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {rows.map((row) => (
            <div key={row.join("-")} className="grid grid-cols-[1.4fr_0.8fr_0.8fr] gap-2 rounded-[6px] border border-rule bg-white px-2.5 py-2 font-mono text-[10px] text-ink-muted">
              {row.map((cell) => <span key={cell} className="truncate">{cell}</span>)}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 rounded-[6px] border border-rule bg-white px-2.5 py-3 text-[12px] text-health-ok">{empty}</p>
      )}
    </div>
  )
}

function quotePct(part: number, total: number) {
  if (!total) return 0
  return (part / total) * 100
}

function formatInt(value: number) {
  return value.toLocaleString("zh-CN")
}
