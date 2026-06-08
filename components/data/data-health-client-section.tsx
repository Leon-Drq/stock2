"use client"

import { useEffect, useState } from "react"
import { Loader2, RefreshCw } from "lucide-react"
import type { HealthReport } from "@/lib/data-health"
import { DataOverviewChart } from "@/components/data/data-overview-chart"

type StatusResponse = {
  ok: boolean
  report?: HealthReport
  error?: string
}

function formatAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return "刚刚"
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

export function DataHealthClientSection() {
  const [report, setReport] = useState<HealthReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load(refresh = false) {
    setLoading(true)
    setError(null)
    try {
      if (refresh) {
        await fetch("/api/data-health/refresh", { method: "POST" })
      }
      const statusUrl = refresh ? `/api/data-health/status?refresh=${Date.now()}` : "/api/data-health/status"
      const res = await fetch(statusUrl)
      const json = (await res.json()) as StatusResponse
      if (!res.ok || !json.ok || !json.report) throw new Error(json.error ?? `HTTP ${res.status}`)
      setReport(json.report)
    } catch (err) {
      setError(err instanceof Error ? err.message : "数据源探活失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  if (report && !report.apiKeyConfigured) {
    return (
      <section className="mt-5 rounded-[7px] border border-health-bad/30 bg-health-bad/[0.03] px-4 py-4 md:px-5">
        <p className="font-mono text-[11px] text-health-bad">API Key 未配置</p>
        <p className="mt-2 text-[15px] text-ink">
          请在项目环境变量中设置 <code className="font-mono text-[13px]">QVERIS_API_KEY</code>，否则无法监控数据源可用性。
        </p>
      </section>
    )
  }

  return (
    <>
      <div className="mt-5 flex flex-col gap-2 rounded-[7px] border border-rule bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-5">
        <p className="font-mono text-[11px] text-ink-muted">
          Qveris 数据源探活 · 客户端异步加载
        </p>
        <div className="flex items-center gap-3">
          <p className="font-mono text-[11px] text-ink-faint">
            {loading ? "采样中..." : report ? `采样于 ${formatAge(report.checkedAt)}` : "等待采样"}
          </p>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-rule bg-[#fafafa] px-3 font-mono text-[11px] text-ink-muted disabled:opacity-50"
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
            刷新
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-[7px] border border-warning/20 bg-warning/5 px-3 py-2 text-[12px] leading-5 text-warning">
          {error}
        </p>
      )}

      {report ? <DataOverviewChart report={report} /> : <HealthSkeleton />}
    </>
  )
}

function HealthSkeleton() {
  return (
    <section className="mt-5">
      <div className="grid grid-cols-2 gap-y-4 rounded-[7px] border border-rule bg-white px-5 py-4 sm:grid-cols-4 sm:px-6">
        {["数据源", "状态", "工具", "健康率"].map((label) => (
          <div key={label} className="flex flex-col gap-1">
            <span className="font-mono text-[9px] uppercase tracking-wider text-ink-faint">{label}</span>
            <span className="font-sans text-2xl font-semibold text-ink-faint">-</span>
          </div>
        ))}
      </div>
    </section>
  )
}
