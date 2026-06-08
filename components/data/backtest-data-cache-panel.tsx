"use client"

import { useMemo, useState } from "react"
import { Database, Loader2, Play, RefreshCw } from "lucide-react"
import type { BacktestDataStoreSnapshot } from "@/lib/backtest-data-store"

type WarmResponse = {
  ok: boolean
  error?: string
  warmed?: {
    mode?: "missing" | "offset"
    reason?: string
    offset?: number
    symbols: number
    lookbackDays: number
    qverisCount: number
    databaseCount: number
    mockCount: number
    fallbackReason?: string
    startedAt: string
    finishedAt: string
  }
  snapshot?: BacktestDataStoreSnapshot
}

export function BacktestDataCachePanel({ initial }: { initial: BacktestDataStoreSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial)
  const [loading, setLoading] = useState<"warm" | "refresh" | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const stockPoolSymbols = snapshot.stockPoolSymbols ?? snapshot.totalSymbols
  const isFullyWarmed = stockPoolSymbols > 0 && snapshot.totalSymbols >= stockPoolSymbols

  const statusText = useMemo(() => {
    if (snapshot.status === "error") return "存储异常"
    if (snapshot.driver === "postgres") return "Postgres 已接入"
    if (snapshot.driver === "redis") return "数据库已接入"
    return "本机缓存"
  }, [snapshot])

  async function refreshStatus() {
    setLoading("refresh")
    setMessage(null)
    try {
      const res = await fetch("/api/backtest-data/status")
      const json = await res.json()
      setSnapshot(json as BacktestDataStoreSnapshot)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "刷新失败")
    } finally {
      setLoading(null)
    }
  }

  async function warmData() {
    setLoading("warm")
    setMessage(null)
    try {
      const offset = Math.min(snapshot.totalSymbols, Math.max(0, stockPoolSymbols - 1))
      const res = await fetch("/api/backtest-data/warm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offset, limit: 10, lookbackDays: 750, mode: "missing" }),
      })
      const json = await res.json() as WarmResponse
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      if (json.snapshot) setSnapshot(json.snapshot)
      setMessage(`${json.warmed?.reason ?? `已从第 ${offset + 1} 只开始预热`} 本批 ${json.warmed?.symbols ?? 0} 只，Qveris/数据库 ${json.warmed?.qverisCount ?? 0} 只。`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "预热失败")
    } finally {
      setLoading(null)
    }
  }

  return (
    <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <Database className="size-4" aria-hidden />
            backtest data store
          </div>
          <h2 className="mt-2 text-[20px] font-semibold text-ink">回测数据缓存</h2>
          <p className="mt-1 max-w-[760px] text-[13px] leading-6 text-ink-muted">
            把 Qveris 历史 K 线、技术指标、因子值、交易日历、指数基准和涨跌停/停牌字段按股票保存起来。后续真实回测优先读数据库，缺失股票才重新拉取。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={refreshStatus}
            disabled={Boolean(loading)}
            className="inline-flex h-9 items-center gap-1.5 rounded-[7px] border border-rule bg-[#fafafa] px-3 font-mono text-[11px] text-ink-muted disabled:opacity-50"
          >
            {loading === "refresh" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
            刷新
          </button>
          <button
            type="button"
            onClick={warmData}
            disabled={Boolean(loading) || isFullyWarmed}
            className="inline-flex h-9 items-center gap-1.5 rounded-[7px] bg-ink px-3 font-mono text-[11px] text-white disabled:opacity-50"
          >
            {loading === "warm" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
            {isFullyWarmed ? "已全部预热" : "预热下一批"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
        <Kpi label="状态" value={statusText} />
        <Kpi label="股票" value={`${snapshot.totalSymbols}/${stockPoolSymbols}`} />
        <Kpi label="K线" value={`${snapshot.totalBars}`} />
        <Kpi label="指标" value={`${snapshot.marketData?.indicatorRows ?? 0}`} />
        <Kpi label="因子值" value={`${snapshot.marketData?.factorRows ?? 0}`} />
        <Kpi label="交易日" value={`${snapshot.marketData?.calendarRows ?? 0}`} />
        <Kpi label="指数" value={`${snapshot.marketData?.indexRows ?? 0}`} />
        <Kpi label="涨跌停" value={`${snapshot.marketData?.limitRows ?? 0}`} />
      </div>

      {snapshot.marketData && (
        <p className="mt-3 rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 font-mono text-[11px] leading-5 text-ink-muted">
          structured coverage · {snapshot.marketData.earliestDate ?? "N/A"} → {snapshot.marketData.latestDate ?? "N/A"} · calendar {snapshot.marketData.latestCalendarDate ?? "N/A"} · index {snapshot.marketData.latestIndexDate ?? "N/A"} · {snapshot.driver === "postgres" ? "Postgres" : snapshot.driver === "redis" ? "Redis" : "Memory"} · updated {snapshot.lastUpdatedAt ? formatAge(snapshot.lastUpdatedAt) : "N/A"}
        </p>
      )}

      {snapshot.driver === "memory" && (
        <p className="mt-3 rounded-[7px] border border-warning/20 bg-warning/5 px-3 py-2 text-[12px] leading-5 text-warning">
          当前未检测到 DATABASE_URL / POSTGRES_URL，也未检测到 KV_REST_API_URL / KV_REST_API_TOKEN，线上会退回到实例内缓存。接入 Supabase、Neon、Vercel Postgres 或 Upstash Redis 后即可跨请求持久保存。
        </p>
      )}
      {snapshot.error && (
        <p className="mt-3 rounded-[7px] border border-bear/20 bg-bear/5 px-3 py-2 text-[12px] leading-5 text-bear">
          {snapshot.error}
        </p>
      )}
      {message && (
        <p className="mt-3 rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 text-[12px] leading-5 text-ink-muted">
          {message}
        </p>
      )}

      <div className="mt-4 grid gap-2 md:hidden">
        {snapshot.records.slice(0, 12).map((record) => (
          <CacheRecordCard key={record.key} record={record} />
        ))}
        {snapshot.records.length === 0 && (
          <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-8 text-center text-[12px] text-ink-muted">
            暂无缓存。点击“预热首批数据”后会写入历史 K 线、指标和因子值。
          </div>
        )}
      </div>

      <div className="mt-4 hidden overflow-x-auto md:block">
        <table className="min-w-[760px] w-full border-separate border-spacing-0 text-left">
          <thead>
            <tr className="font-mono text-[10px] text-ink-faint">
              <th className="border-b border-rule-soft py-2 pr-3 font-normal">股票</th>
              <th className="border-b border-rule-soft py-2 pr-3 font-normal">窗口</th>
              <th className="border-b border-rule-soft py-2 pr-3 font-normal">K线</th>
              <th className="border-b border-rule-soft py-2 pr-3 font-normal">最新日期</th>
              <th className="border-b border-rule-soft py-2 pr-3 font-normal">缓存时间</th>
              <th className="border-b border-rule-soft py-2 font-normal">过期</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.records.slice(0, 12).map((record) => (
              <tr key={record.key} className="text-[12px] text-ink">
                <td className="border-b border-rule-soft py-2 pr-3">
                  <span className="font-semibold">{record.name}</span>
                  <span className="ml-2 font-mono text-[10px] text-ink-faint">{record.symbol}</span>
                </td>
                <td className="border-b border-rule-soft py-2 pr-3 font-mono text-ink-muted">{record.lookbackDays}d</td>
                <td className="border-b border-rule-soft py-2 pr-3 font-mono text-ink-muted">{record.bars}</td>
                <td className="border-b border-rule-soft py-2 pr-3 font-mono text-ink-muted">{record.latestDate || "N/A"}</td>
                <td className="border-b border-rule-soft py-2 pr-3 font-mono text-ink-muted">{formatAge(record.cachedAt)}</td>
                <td className="border-b border-rule-soft py-2 font-mono text-ink-muted">{formatAge(record.expiresAt, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {snapshot.records.length === 0 && (
          <div className="rounded-b-[7px] border-x border-b border-rule bg-[#fafafa] px-3 py-8 text-center text-[12px] text-ink-muted">
            暂无缓存。点击“预热首批数据”后会写入历史 K 线、指标和因子值。
          </div>
        )}
      </div>
    </section>
  )
}

function CacheRecordCard({ record }: { record: BacktestDataStoreSnapshot["records"][number] }) {
  return (
    <article className="rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-ink">{record.name}</p>
          <p className="mt-1 font-mono text-[11px] text-ink-faint">{record.symbol}</p>
        </div>
        <span className="shrink-0 rounded-[5px] border border-rule bg-white px-2 py-1 font-mono text-[10px] text-ink-muted">
          {record.lookbackDays}d
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <CacheField label="K线" value={`${record.bars}`} />
        <CacheField label="最新日期" value={record.latestDate || "N/A"} />
        <CacheField label="缓存时间" value={formatAge(record.cachedAt)} />
        <CacheField label="过期" value={formatAge(record.expiresAt, true)} />
      </div>
    </article>
  )
}

function CacheField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[6px] border border-rule bg-white px-2.5 py-2">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className="mt-1 break-words font-mono text-[12px] text-ink">{value}</p>
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className="mt-1 truncate text-[16px] font-semibold text-ink">{value}</p>
    </div>
  )
}

function formatAge(iso: string, future = false) {
  const diff = future ? new Date(iso).getTime() - Date.now() : Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(diff)) return "N/A"
  const minutes = Math.max(0, Math.floor(diff / 60_000))
  if (minutes < 1) return future ? "即将过期" : "刚刚"
  if (minutes < 60) return future ? `${minutes} 分钟后` : `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return future ? `${hours} 小时后` : `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return future ? `${days} 天后` : `${days} 天前`
}
