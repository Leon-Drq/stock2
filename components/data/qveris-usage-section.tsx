"use client"

import { useEffect, useMemo, useState } from "react"
import { Activity, Coins, DatabaseZap, Loader2, RefreshCw, Route, Timer, Zap } from "lucide-react"
import type { QverisUsageGroup, QverisUsageLedgerEntry, QverisUsageSummary } from "@/lib/qveris-usage-store"

export function QverisUsageSection() {
  const [summary, setSummary] = useState<QverisUsageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load(signal?: AbortSignal) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/qveris/usage?days=7&limit=80", { cache: "no-store", signal })
      const json = (await res.json()) as QverisUsageSummary
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setSummary(json)
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      setError(err instanceof Error ? err.message : "Qveris 用量账本加载失败")
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/qveris/usage?days=7&limit=80", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const json = (await res.json()) as QverisUsageSummary
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        setSummary(json)
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return
        setError(err instanceof Error ? err.message : "Qveris 用量账本加载失败")
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])

  if (!summary) {
    return (
      <>
        <QverisUsageFallback />
        {error && (
          <p className="mt-3 rounded-[7px] border border-warning/20 bg-warning/5 px-3 py-2 text-[12px] leading-5 text-warning">
            {error}
          </p>
        )}
      </>
    )
  }

  const totalCost = summary.totals.cost
  const totalCredits = summary.totals.billingCredits
  const successRate = summary.totals.calls > 0 ? (summary.totals.success / summary.totals.calls) * 100 : 0
  const topCategory = summary.byCategory[0]

  return (
    <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <Zap className="size-4" aria-hidden />
            qveris usage ledger
          </div>
          <h2 className="mt-2 text-[20px] font-semibold text-ink">Qveris 付费调用账本</h2>
          <p className="mt-1 max-w-[860px] text-[13px] leading-6 text-ink-muted">
            只记录 `/tools/execute`：实时行情、历史 K 线、指数、AI 模型和非价格补数。`discover/search` 不计入；历史调用从本功能上线后开始统计。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex h-9 items-center gap-1.5 rounded-[7px] border border-rule bg-[#fafafa] px-3 font-mono text-[11px] text-ink-muted disabled:opacity-50"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
          刷新
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        <UsageKpi icon={Activity} label="7日调用" value={formatInt(summary.totals.calls)} sub={`${formatPct(successRate)} 成功`} good={successRate >= 90 || summary.totals.calls === 0} />
        <UsageKpi icon={DatabaseZap} label="触达标的" value={formatInt(summary.totals.symbols)} sub="批量行情/补数" />
        <UsageKpi icon={Coins} label="Credits" value={totalCredits == null ? "待返回" : compactNumber(totalCredits)} sub="Qveris billing" />
        <UsageKpi icon={Coins} label="Cost" value={totalCost == null ? "待返回" : compactNumber(totalCost)} sub="Qveris cost" />
        <UsageKpi icon={Timer} label="平均耗时" value={summary.totals.avgElapsedMs == null ? "N/A" : `${Math.round(summary.totals.avgElapsedMs)}ms`} sub={summary.totals.latestAt ? `最新 ${formatChinaTime(summary.totals.latestAt)}` : "暂无调用"} />
        <UsageKpi icon={Route} label="主要消耗" value={topCategory ? categoryLabel(topCategory.key) : "暂无"} sub={topCategory ? `${topCategory.calls} 次` : "等待调用"} />
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        <UsageGroupPanel title="按类别拆分" groups={summary.byCategory} labelForKey={categoryLabel} />
        <UsageGroupPanel title="按来源拆分" groups={summary.bySource} labelForKey={(key) => key} />
      </div>

      <RecentUsage records={summary.recent.slice(0, 10)} />

      {(summary.notes.length > 0 || summary.error || error) && (
        <div className="mt-3 space-y-2">
          {[...summary.notes, summary.error, error].filter(Boolean).map((note) => (
            <p key={note} className="rounded-[7px] border border-warning/20 bg-warning/5 px-3 py-2 text-[12px] leading-5 text-warning">
              {note}
            </p>
          ))}
        </div>
      )}
    </section>
  )
}

export function QverisUsageFallback() {
  return (
    <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="h-5 w-48 animate-pulse bg-rule-soft" />
      <div className="mt-3 h-4 w-2/3 animate-pulse bg-rule-soft" />
      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-20 animate-pulse rounded-[7px] border border-rule bg-[#fafafa]" />
        ))}
      </div>
    </section>
  )
}

function UsageKpi({
  icon: Icon,
  label,
  value,
  sub,
  good,
}: {
  icon: typeof Activity
  label: string
  value: string
  sub: string
  good?: boolean
}) {
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
      <div className="flex items-center gap-2 text-[12px] text-ink-muted">
        <Icon className="size-4" aria-hidden />
        {label}
      </div>
      <p className={`mt-3 font-mono text-[22px] font-semibold leading-none ${good ? "text-health-ok" : "text-ink"}`}>
        {value}
      </p>
      <p className="mt-2 truncate text-[11px] text-ink-faint">{sub}</p>
    </div>
  )
}

function UsageGroupPanel({
  title,
  groups,
  labelForKey,
}: {
  title: string
  groups: QverisUsageGroup[]
  labelForKey: (key: string) => string
}) {
  const maxCalls = useMemo(() => Math.max(1, ...groups.map((group) => group.calls)), [groups])
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        <span className="font-mono text-[10px] text-ink-faint">{groups.length} groups</span>
      </div>
      <div className="mt-3 space-y-2">
        {groups.map((group) => (
          <div key={group.key} className="rounded-[6px] border border-rule bg-white px-3 py-2">
            <div className="flex items-center justify-between gap-3 text-[12px]">
              <span className="font-semibold text-ink">{labelForKey(group.key)}</span>
              <span className="font-mono text-ink-muted">{group.calls} 次 · {group.symbols} 标的</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-rule-soft">
              <div className="h-full bg-ink" style={{ width: `${Math.max(4, (group.calls / maxCalls) * 100)}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-ink-faint">
              <span>success {group.success}</span>
              <span>fail {group.failure + group.exception}</span>
              <span>avg {group.avgElapsedMs == null ? "N/A" : `${Math.round(group.avgElapsedMs)}ms`}</span>
              {group.latestAt && <span>latest {formatChinaTime(group.latestAt)}</span>}
            </div>
          </div>
        ))}
        {groups.length === 0 && (
          <div className="rounded-[7px] border border-dashed border-rule bg-white px-3 py-8 text-center text-[12px] text-ink-muted">
            暂无 Qveris 付费调用记录。
          </div>
        )}
      </div>
    </div>
  )
}

function RecentUsage({ records }: { records: QverisUsageLedgerEntry[] }) {
  return (
    <div className="mt-4 rounded-[7px] border border-rule bg-[#fafafa] p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-ink">最近调用</h3>
        <span className="font-mono text-[10px] text-ink-faint">{records.length} rows</span>
      </div>
      <div className="mt-3 grid gap-2 md:hidden">
        {records.map((record) => (
          <UsageRecordCard key={record.id} record={record} />
        ))}
      </div>
      <div className="mt-3 hidden overflow-x-auto md:block">
        <table className="min-w-[860px] w-full border-separate border-spacing-0 text-left">
          <thead>
            <tr className="font-mono text-[10px] text-ink-faint">
              <th className="border-b border-rule-soft py-2 pr-3 font-normal">时间</th>
              <th className="border-b border-rule-soft py-2 pr-3 font-normal">来源</th>
              <th className="border-b border-rule-soft py-2 pr-3 font-normal">类别</th>
              <th className="border-b border-rule-soft py-2 pr-3 font-normal">工具</th>
              <th className="border-b border-rule-soft py-2 pr-3 font-normal">状态</th>
              <th className="border-b border-rule-soft py-2 pr-3 font-normal">标的</th>
              <th className="border-b border-rule-soft py-2 pr-3 font-normal">耗时</th>
              <th className="border-b border-rule-soft py-2 pr-3 font-normal">计费</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id} className="text-[12px] text-ink-muted">
                <td className="border-b border-rule-soft py-2 pr-3 font-mono text-ink">{formatChinaTime(record.finishedAt)}</td>
                <td className="border-b border-rule-soft py-2 pr-3">{record.source}</td>
                <td className="border-b border-rule-soft py-2 pr-3">{categoryLabel(record.category)}</td>
                <td className="max-w-[260px] truncate border-b border-rule-soft py-2 pr-3 font-mono text-[11px]">{record.toolId}</td>
                <td className="border-b border-rule-soft py-2 pr-3">
                  <StatusBadge status={record.status} />
                </td>
                <td className="border-b border-rule-soft py-2 pr-3 font-mono">{record.symbolsCount}</td>
                <td className="border-b border-rule-soft py-2 pr-3 font-mono">{record.elapsedMs}ms</td>
                <td className="border-b border-rule-soft py-2 pr-3 font-mono">{feeText(record)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {records.length === 0 && (
        <div className="rounded-[7px] border border-dashed border-rule bg-white px-3 py-8 text-center text-[12px] text-ink-muted">
          暂无记录。下一次 Qveris 付费工具执行后会自动写入这里。
        </div>
      )}
    </div>
  )
}

function UsageRecordCard({ record }: { record: QverisUsageLedgerEntry }) {
  return (
    <div className="rounded-[7px] border border-rule bg-white px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] text-ink-faint">{formatChinaTime(record.finishedAt)}</p>
          <p className="mt-1 truncate text-[13px] font-semibold text-ink">{record.source}</p>
          <p className="mt-1 truncate font-mono text-[10px] text-ink-muted">{record.toolId}</p>
        </div>
        <StatusBadge status={record.status} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1.5 font-mono text-[11px]">
        <Mini label="类别" value={categoryLabel(record.category)} />
        <Mini label="标的" value={`${record.symbolsCount}`} />
        <Mini label="耗时" value={`${record.elapsedMs}ms`} />
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: QverisUsageLedgerEntry["status"] }) {
  const cls = status === "success"
    ? "bg-[#e7f4eb] text-health-ok"
    : status === "failure"
      ? "bg-[#fff7e8] text-warning"
      : "bg-bear/10 text-bear"
  return <span className={`rounded-[5px] px-2 py-1 font-mono text-[10px] ${cls}`}>{status}</span>
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[6px] border border-rule-soft bg-[#fafafa] px-2 py-2">
      <p className="text-[10px] text-ink-faint">{label}</p>
      <p className="mt-1 truncate text-ink">{value}</p>
    </div>
  )
}

function categoryLabel(key: string) {
  switch (key) {
    case "realtime_quote":
      return "实时行情"
    case "daily_bar":
      return "历史K线"
    case "market_index":
      return "市场指数"
    case "market_index_history":
      return "指数历史"
    case "ai_model":
      return "AI模型"
    case "non_price_data":
      return "非价格数据"
    case "manual":
      return "手动调用"
    default:
      return key || "未知"
  }
}

function feeText(record: QverisUsageLedgerEntry) {
  if (record.billingCredits != null) return `${compactNumber(record.billingCredits)} credits`
  if (record.cost != null) return compactNumber(record.cost)
  return "待返回"
}

function formatInt(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value)
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(value)
}

function formatPct(value: number) {
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`
}

function formatChinaTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "N/A"
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}
