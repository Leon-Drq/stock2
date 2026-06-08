"use client"

import { useEffect, useState } from "react"
import { DatabaseZap, Loader2, Play, RefreshCw } from "lucide-react"
import type { NonPriceCoverageSnapshot, NonPriceSourceId } from "@/lib/non-price-data-store"

type WarmResponse = {
  ok: boolean
  error?: string
  coverage?: NonPriceCoverageSnapshot
  sources?: Array<{
    sourceId: string
    discoveredTools: number
    sampled: number
    savedRows: number
    errors: string[]
  }>
}

const EMPTY_COVERAGE: NonPriceCoverageSnapshot = {
  driver: "memory",
  configured: false,
  status: "fallback",
  checkedAt: "",
  rows: (["fund-flow", "north-bound", "dragon-tiger", "news", "announcement", "fin-statement"] satisfies NonPriceSourceId[]).map((sourceId) => ({
    sourceId,
    rawRows: 0,
    rawSymbols: 0,
    factorRows: 0,
    eventRows: 0,
    sentimentRows: 0,
    fundamentalRows: 0,
    bindings: 0,
    sampledBindings: 0,
  })),
}

export function NonPriceDataPanel({ initial = EMPTY_COVERAGE }: { initial?: NonPriceCoverageSnapshot }) {
  const [coverage, setCoverage] = useState(initial)
  const [loading, setLoading] = useState<"refresh" | "warm" | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function refreshStatus() {
    setLoading("refresh")
    setMessage(null)
    try {
      const res = await fetch("/api/non-price-data/status")
      const json = await res.json() as { coverage?: NonPriceCoverageSnapshot; error?: string }
      if (!res.ok || !json.coverage) throw new Error(json.error ?? `HTTP ${res.status}`)
      setCoverage(json.coverage)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "刷新失败")
    } finally {
      setLoading(null)
    }
  }

  useEffect(() => {
    void refreshStatus()
  }, [])

  async function warmFirstBatch() {
    setLoading("warm")
    setMessage(null)
    try {
      const res = await fetch("/api/non-price-data/warm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceIds: ["fund-flow", "news", "fin-statement"],
          symbols: ["600519", "300750", "600900"],
          maxCalls: 6,
          sample: true,
          persist: true,
        }),
      })
      const json = await res.json() as WarmResponse
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      if (json.coverage) setCoverage(json.coverage)
      const sampled = json.sources?.reduce((sum, item) => sum + item.sampled, 0) ?? 0
      const saved = json.sources?.reduce((sum, item) => sum + item.savedRows, 0) ?? 0
      const errors = json.sources?.flatMap((item) => item.errors).slice(0, 2) ?? []
      setMessage(`首批非价格数据已处理：采样 ${sampled} 次，写入 ${saved} 行。${errors.length ? `部分错误：${errors.join(" / ")}` : ""}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "补齐失败")
    } finally {
      setLoading(null)
    }
  }

  const totalRows = coverage.rows.reduce(
    (sum, row) => sum + row.rawRows + row.factorRows + row.eventRows + row.sentimentRows + row.fundamentalRows,
    0,
  )
  const sampledSources = coverage.rows.filter((row) => row.rawRows > 0 || row.sampledBindings > 0).length

  return (
    <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <DatabaseZap className="size-4" aria-hidden />
            non-price ingestion
          </div>
          <h2 className="mt-2 text-[20px] font-semibold text-ink">非价格数据补齐</h2>
          <p className="mt-1 max-w-[820px] text-[13px] leading-6 text-ink-muted">
            先用 Qveris 做小样本采样，确认工具、字段和返回结构，再把原始响应、事件、财务和因子值写入 Supabase。第一批覆盖主力资金、新闻研报和财务报表。
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
            onClick={warmFirstBatch}
            disabled={Boolean(loading)}
            className="inline-flex h-9 items-center gap-1.5 rounded-[7px] bg-ink px-3 font-mono text-[11px] text-white disabled:opacity-50"
          >
            {loading === "warm" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
            补齐首批
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <Kpi label="入库行" value={String(totalRows)} />
        <Kpi label="已采样源" value={`${sampledSources}/${coverage.rows.length}`} />
        <Kpi label="driver" value={coverage.driver} />
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-3">
        {coverage.rows.map((row) => (
          <div key={row.sourceId} className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-mono text-[12px] font-semibold text-ink">{sourceName(row.sourceId)}</h3>
              <span className={`rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] ${row.rawRows > 0 ? "text-health-ok" : row.bindings > 0 ? "text-warning" : "text-bear"}`}>
                {row.rawRows > 0 ? "已入库" : row.bindings > 0 ? "已绑定" : "待探测"}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Mini label="raw" value={row.rawRows} />
              <Mini label="factor" value={row.factorRows} />
              <Mini label="std" value={row.eventRows + row.sentimentRows + row.fundamentalRows} />
            </div>
            <p className="mt-2 font-mono text-[10px] text-ink-faint">
              symbols {row.rawSymbols} · bindings {row.sampledBindings}/{row.bindings} · latest {row.latestAsOf ?? "N/A"}
            </p>
          </div>
        ))}
      </div>

      {coverage.error && (
        <p className="mt-3 rounded-[7px] border border-bear/20 bg-bear/5 px-3 py-2 text-[12px] leading-5 text-bear">
          {coverage.error}
        </p>
      )}
      {message && (
        <p className="mt-3 rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 text-[12px] leading-5 text-ink-muted">
          {message}
        </p>
      )}
    </section>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className="mt-1 truncate text-[18px] font-semibold text-ink">{value}</p>
    </div>
  )
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[6px] border border-rule bg-white px-2 py-2">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className="mt-1 font-mono text-[14px] font-semibold text-ink">{value}</p>
    </div>
  )
}

function sourceName(sourceId: string) {
  const names: Record<string, string> = {
    "fund-flow": "主力资金流",
    "north-bound": "北向资金",
    "dragon-tiger": "龙虎榜",
    news: "新闻与研报",
    announcement: "公告与定报",
    "fin-statement": "财务报表",
  }
  return names[sourceId] ?? sourceId
}
