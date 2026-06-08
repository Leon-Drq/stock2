"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Activity, AlertTriangle, BarChart3, CheckCircle2, Clock3, Database, ListChecks, Loader2, Play, RefreshCw, SlidersHorizontal } from "lucide-react"
import type { BacktestReport } from "@/lib/backtest"
import type { StrategyRegistrySnapshot } from "@/lib/strategy-registry-store"
import { FactorDataCompletionPanel } from "@/components/shared/factor-data-completion-panel"
import { formatBeijingDateTime } from "@/lib/format"
import {
  loadCustomStrategies,
  saveCustomStrategyError,
  saveCustomStrategyReport,
  strategyDraftToBacktestReport,
  type StoredStrategyDraft,
} from "@/lib/custom-strategies"

export type BacktestDashboardProps = {
  report?: BacktestReport
  reports?: BacktestReport[]
  notes?: string[]
  generatedAt?: string
  registrySnapshot?: StrategyRegistrySnapshot
}

export function BacktestDashboard({
  report,
  reports,
  notes = [],
  generatedAt,
  registrySnapshot,
}: BacktestDashboardProps) {
  const searchParams = useSearchParams()
  const requestedStrategyId = searchParams.get("strategy")
  const runningBacktests = useRef(new Set<string>())
  const [customStrategies, setCustomStrategies] = useState<StoredStrategyDraft[]>([])
  const baseReports = useMemo(() => (reports?.length ? reports : report ? [report] : []), [report, reports])
  const customReports = useMemo(() => customStrategies.map(strategyDraftToBacktestReport), [customStrategies])
  const allReports = useMemo(() => [...customReports, ...baseReports].sort(compareBacktestReports), [baseReports, customReports])
  const [selectedId, setSelectedId] = useState("")

  useEffect(() => {
    setCustomStrategies(loadCustomStrategies())
  }, [])

  useEffect(() => {
    if (!allReports.length) return
    if (requestedStrategyId && allReports.some((item) => item.strategyId === requestedStrategyId)) {
      setSelectedId(requestedStrategyId)
      return
    }
    setSelectedId((current) => current && allReports.some((item) => item.strategyId === current) ? current : allReports[0].strategyId)
  }, [allReports, requestedStrategyId])

  useEffect(() => {
    const pending = customStrategies.filter((item) => item.status === "queued" && !runningBacktests.current.has(item.id))
    for (const item of pending) {
      runningBacktests.current.add(item.id)
      void fetch("/api/backtest/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: item.draft }),
      })
        .then(async (res) => {
          const json = await res.json()
          if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
          saveCustomStrategyReport(item.id, json.report as BacktestReport)
          setCustomStrategies(loadCustomStrategies())
        })
        .catch((error) => {
          saveCustomStrategyError(item.id, error instanceof Error ? error.message : "自定义策略回测失败")
          setCustomStrategies(loadCustomStrategies())
        })
        .finally(() => {
          runningBacktests.current.delete(item.id)
        })
    }
  }, [customStrategies])

  const selectedReport = allReports.find((item) => item.strategyId === selectedId) ?? allReports[0]
  if (!selectedReport) {
    return (
      <>
        {registrySnapshot && <BacktestJobCenter initial={registrySnapshot} />}
        <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-5 md:px-5">
          <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">Backtest Fallback</div>
          <h2 className="mt-2 text-xl font-semibold text-ink">回测报告暂不可用</h2>
          <div className="mt-3 grid gap-2 text-sm text-ink-muted">
            {(notes.length ? notes : ["服务端回测数据暂未返回，可以从回测任务中心重新触发。"]).map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        </section>
      </>
    )
  }

  const activeReport = selectedReport
  const isLabReport = activeReport.strategyId.startsWith("lab-")
  const metricGroups = [activeReport.metrics.slice(0, 12), activeReport.metrics.slice(12)]
  const sourceLabel =
    isLabReport && activeReport.dataSource.source === "mock"
      ? "策略实验室导入草稿"
      : activeReport.dataSource.source === "qveris"
      ? "Qveris 真实历史数据"
      : activeReport.dataSource.source === "mixed"
        ? "Qveris + 降级数据"
        : "降级数据"
  const radarReadyCount = allReports.filter((item) => safeAdmission(item).status === "radar-ready").length
  const watchlistCount = allReports.filter((item) => safeAdmission(item).status === "watchlist").length

  return (
    <>
    {registrySnapshot && <BacktestJobCenter initial={registrySnapshot} />}
    <div className="mt-5 grid min-w-0 gap-5 2xl:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="space-y-5 2xl:sticky 2xl:top-5 2xl:self-start">
        {allReports.length > 1 && (
          <section className="rounded-[7px] border border-rule bg-white px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
                <ListChecks className="size-4" aria-hidden />
                策略切换
              </div>
              <span className="font-mono text-[11px] text-ink-muted">{allReports.length} 个策略 · 按分排序</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <BacktestMiniStat label="雷达" value={radarReadyCount} tone="good" />
              <BacktestMiniStat label="观察" value={watchlistCount} tone="warning" />
              <BacktestMiniStat label="最高分" value={Math.round(scoreReport(allReports[0]))} tone="neutral" />
            </div>
            <div className="mt-4 grid gap-2">
              {allReports.map((item) => {
                const active = item.strategyId === activeReport.strategyId
                const admission = safeAdmission(item)
                return (
                  <button
                    key={item.strategyId}
                    type="button"
                    onClick={() => setSelectedId(item.strategyId)}
                    className={`flex items-center justify-between gap-3 rounded-[7px] border px-3 py-2 text-left transition ${
                      active ? "border-ink bg-ink text-white" : "border-rule bg-[#fafafa] text-ink hover:border-ink/40"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">{item.strategyName}</span>
                      <span className={`mt-1 block truncate font-mono text-[10px] ${active ? "text-white/70" : "text-ink-faint"}`}>
                        {reportSourceLabel(item)} · {admission.gate}
                      </span>
                    </span>
                    <span className={`shrink-0 rounded-[5px] border px-2 py-1 font-mono text-[10px] ${active ? "border-white/20 text-white" : "border-rule bg-white text-ink-muted"}`}>
                      {scoreReport(item).toFixed(1)}
                    </span>
                  </button>
                )
              })}
            </div>
            {generatedAt && (
              <p className="mt-3 font-mono text-[10px] text-ink-faint">生成 {formatStableDateTime(generatedAt)}</p>
            )}
          </section>
        )}

        <section className="rounded-[7px] border border-rule bg-white px-4 py-4">
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <Database className="size-4" aria-hidden />
            数据源
          </div>
          <p className="mt-3 text-[18px] font-semibold text-ink">{sourceLabel}</p>
          <p className="mt-2 text-[13px] leading-5 text-ink-muted">
            历史 K 线 {activeReport.dataSource.qverisCount}/{activeReport.dataSource.total} 只来自 Qveris。
            {activeReport.dataSource.databaseCount ? ` 其中 ${activeReport.dataSource.databaseCount} 只命中数据库缓存。` : ""}
          </p>
          {activeReport.backtestSource === "Qveris K线代理" && (
            <p className="mt-3 rounded-[7px] border border-rule bg-[#fff7e8] px-3 py-2 text-[12px] leading-5 text-ink-muted">
              该策略包含非价格类因子，当前用 Qveris 真实 K 线构造代理信号回测。
            </p>
          )}
          {activeReport.dataSource.fallbackReason && (
            <p className="mt-3 rounded-[7px] border border-rule bg-[#fff7e8] px-3 py-2 text-[12px] leading-5 text-ink-muted">
              {activeReport.dataSource.fallbackReason}
            </p>
          )}
        </section>

        <section className="rounded-[7px] border border-rule bg-white px-4 py-4">
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <SlidersHorizontal className="size-4" aria-hidden />
            回测参数
          </div>
          <div className="mt-4 space-y-2">
            <Param label="策略" value={activeReport.strategyName} />
            <Param label="股票池" value={activeReport.universe} />
            <Param label="基准" value={activeReport.benchmark} />
            <Param label="动量窗口" value={`${activeReport.parameters.momentumWindow} 日`} />
            <Param label="调仓频率" value={`${activeReport.parameters.rebalanceDays} 个交易日`} />
            <Param label="交易成本" value={`${(activeReport.parameters.feeRate * 100).toFixed(2)}%`} />
          </div>
        </section>

        <section className="rounded-[7px] border border-rule bg-white px-4 py-4">
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <ListChecks className="size-4" aria-hidden />
            日志输出
          </div>
          <ul className="mt-4 space-y-2">
            {activeReport.logs.map((line) => (
              <li key={line} className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 text-[12px] leading-5 text-ink-muted">
                {line}
              </li>
            ))}
          </ul>
          {notes.length > 0 && (
            <div className="mt-3 space-y-2">
              {notes.map((line) => (
                <p key={line} className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 text-[12px] leading-5 text-ink-muted">
                  {line}
                </p>
              ))}
            </div>
          )}
        </section>
      </aside>

      <div className="min-w-0 space-y-5">
        {isLabReport && (
          <section className="rounded-[7px] border border-rule bg-white px-4 py-3 md:px-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] text-ink-muted">strategy lab → backtest</p>
                <p className="mt-1 text-[13px] leading-5 text-ink-muted">
                  该策略来自策略实验室。若刚导入，页面会自动调用 Qveris 历史 K 线回测并刷新本报告。
                </p>
              </div>
              <span className="rounded-[6px] border border-rule bg-[#fafafa] px-2 py-1 font-mono text-[10px] text-ink-muted">
                {activeReport.dataSource.source === "mock" ? "running" : "ready"}
              </span>
            </div>
          </section>
        )}

        <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
                <Activity className="size-4" aria-hidden />
                收益概览
              </div>
              <h2 className="mt-2 text-[22px] font-semibold text-ink">{activeReport.strategyName}</h2>
            </div>
            <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 font-mono text-[11px] text-ink-muted">
              <span>{activeReport.period.start || "N/A"}</span>
              <span className="mx-2 text-ink-faint">-</span>
              <span>{activeReport.period.end || "N/A"}</span>
            </div>
          </div>

          <div className="grid gap-x-4 gap-y-5 md:grid-cols-3 xl:grid-cols-6">
            {metricGroups.flat().map((metric) => (
              <Metric key={metric.label} label={metric.label} value={metric.value} tone={metric.tone} />
            ))}
          </div>
        </section>

        {activeReport.factorDataPlan && (
          <FactorDataCompletionPanel
            plan={activeReport.factorDataPlan}
            subtitle={
              activeReport.backtestSource === "Qveris K线代理"
                ? "该策略仍有非价格类因子使用 K 线代理。先绑定下方 Qveris 原始字段，再把因子值写入缓存表，回测结论才算完整。"
                : undefined
            }
          />
        )}

        <StrategyDiagnosis report={activeReport} />

        <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
              <BarChart3 className="size-4" aria-hidden />
              收益曲线
            </div>
            <div className="flex flex-wrap gap-2 font-mono text-[11px] text-ink-muted">
              <span className="inline-flex items-center gap-1.5 rounded-[5px] border border-rule px-2 py-1">
                <span className="size-2 rounded-full bg-[#2f6f97]" aria-hidden />
                策略收益
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-[5px] border border-rule px-2 py-1">
                <span className="size-2 rounded-full bg-[#9b3d3d]" aria-hidden />
                基准收益
              </span>
            </div>
          </div>

          <div className="h-[300px] sm:h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activeReport.curve} margin={{ left: 4, right: 4, top: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="strategyFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#2f6f97" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="#2f6f97" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e7e4dd" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} minTickGap={28} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${((Number(v) - 1) * 100).toFixed(0)}%`} width={42} />
                <Tooltip content={<CurveTooltip />} />
                <Area type="monotone" dataKey="strategy" stroke="#2f6f97" strokeWidth={2} fill="url(#strategyFill)" dot={false} />
                <Area type="monotone" dataKey="benchmark" stroke="#9b3d3d" strokeWidth={1.6} fill="transparent" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
            <div className="mb-4 flex items-center gap-2 font-mono text-[11px] text-ink-muted">
              <BarChart3 className="size-4" aria-hidden />
              每日超额收益
            </div>
            <div className="h-[220px] sm:h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={activeReport.curve} margin={{ left: 4, right: 4, top: 8, bottom: 0 }}>
                  <CartesianGrid stroke="#e7e4dd" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} minTickGap={34} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(Number(v) * 100).toFixed(1)}%`} width={42} />
                  <Tooltip content={<BarTooltip />} />
                  <Bar dataKey="dailyReturn" fill="#789262" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
            <div className="mb-4 flex items-center gap-2 font-mono text-[11px] text-ink-muted">
              <Clock3 className="size-4" aria-hidden />
              最近调仓
            </div>
            <div className="space-y-2">
              {activeReport.trades.slice(0, 6).map((trade) => (
                <div key={`${trade.date}-${trade.holdings}`} className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-[11px] text-ink-muted">{trade.date}</span>
                    <span className="rounded-[5px] bg-white px-2 py-0.5 font-mono text-[10px] text-ink-muted">{trade.action}</span>
                  </div>
                  <p className="mt-2 text-[13px] leading-5 text-ink">{trade.holdings}</p>
                  <p className="mt-2 font-mono text-[11px] text-ink-muted">换手 {(trade.turnover * 100).toFixed(1)}%</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
              <ListChecks className="size-4" aria-hidden />
              历史交易明细
            </div>
            <span className="font-mono text-[11px] text-ink-muted">{activeReport.positionTrades.length} 笔已结算</span>
          </div>

          {activeReport.positionTrades.length > 0 ? (
            <>
            <div className="grid gap-2 md:hidden">
              {activeReport.positionTrades.slice(0, 60).map((trade) => (
                <PositionTradeMobileCard key={`${trade.symbol}-${trade.entryDate}-${trade.exitDate}-${trade.weight}`} trade={trade} />
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1040px] border-separate border-spacing-0 text-left">
                <thead>
                  <tr className="font-mono text-[11px] text-ink-faint">
                    <th className="border-b border-rule-soft py-2 pr-3 font-normal">股票</th>
                    <th className="border-b border-rule-soft py-2 pr-3 font-normal">买入日</th>
                    <th className="border-b border-rule-soft py-2 pr-3 font-normal">卖出日</th>
                    <th className="border-b border-rule-soft py-2 pr-3 font-normal">退出原因</th>
                    <th className="border-b border-rule-soft py-2 pr-3 text-right font-normal">买入价</th>
                    <th className="border-b border-rule-soft py-2 pr-3 text-right font-normal">卖出价</th>
                    <th className="border-b border-rule-soft py-2 pr-3 text-right font-normal">权重</th>
                    <th className="border-b border-rule-soft py-2 pr-3 text-right font-normal">收益</th>
                    <th className="border-b border-rule-soft py-2 pr-3 text-right font-normal">同期基准</th>
                    <th className="border-b border-rule-soft py-2 text-right font-normal">超额</th>
                  </tr>
                </thead>
                <tbody>
                  {activeReport.positionTrades.slice(0, 60).map((trade) => (
                    <PositionTradeRow key={`${trade.symbol}-${trade.entryDate}-${trade.exitDate}-${trade.weight}`} trade={trade} />
                  ))}
                </tbody>
              </table>
            </div>
            </>
          ) : (
            <div className="rounded-[7px] border border-dashed border-rule bg-[#fafafa] px-3 py-8 text-center text-[12px] text-ink-muted">
              当前策略还没有可结算的历史交易。
            </div>
          )}
        </section>
      </div>
    </div>
    </>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" | "neutral" }) {
  const color = tone === "good" ? "text-bull" : tone === "bad" ? "text-bear" : "text-ink"
  return (
    <div>
      <p className="font-mono text-[11px] text-ink-muted">{label}</p>
      <p className={`mt-2 font-mono text-[22px] font-semibold leading-none tabular ${color}`}>{value}</p>
    </div>
  )
}

function Param({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2">
      <span className="font-mono text-[10px] text-ink-faint">{label}</span>
      <span className="text-right text-[12px] leading-5 text-ink">{value}</span>
    </div>
  )
}

function BacktestJobCenter({ initial }: { initial: StrategyRegistrySnapshot }) {
  const [snapshot, setSnapshot] = useState(initial)
  const [loading, setLoading] = useState<"refresh" | "catalog" | "run" | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const latestJob = snapshot.jobs[0]

  async function refreshJobs() {
    setLoading("refresh")
    setMessage(null)
    try {
      const res = await fetch("/api/backtest/jobs", { cache: "no-store" })
      const json = await res.json() as StrategyRegistrySnapshot
      if (!res.ok) throw new Error("刷新任务状态失败")
      setSnapshot(json)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "刷新任务状态失败")
    } finally {
      setLoading(null)
    }
  }

  async function createCatalogJob() {
    setLoading("catalog")
    setMessage(null)
    try {
      const res = await fetch("/api/backtest/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "catalog" }),
      })
      const json = await res.json() as { ok?: boolean; error?: string; job?: { jobId: string }; snapshot?: StrategyRegistrySnapshot }
      if (!res.ok || !json.ok || !json.job) throw new Error(json.error ?? "创建回测任务失败")
      if (json.snapshot) setSnapshot(json.snapshot)
      setMessage(`已创建目录回测任务 ${json.job.jobId}，可点击“运行下一项”执行。`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建回测任务失败")
    } finally {
      setLoading(null)
    }
  }

  async function runNextJob() {
    setLoading("run")
    setMessage(null)
    try {
      const res = await fetch("/api/backtest/jobs/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      const json = await res.json() as { ok?: boolean; error?: string; skipped?: boolean; reason?: string; summary?: string; snapshot?: StrategyRegistrySnapshot }
      if (!res.ok || !json.ok) throw new Error(json.error ?? "运行回测任务失败")
      if (json.snapshot) setSnapshot(json.snapshot)
      setMessage(json.summary ?? json.reason ?? (json.skipped ? "没有排队任务。" : "回测任务已完成。"))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "运行回测任务失败")
    } finally {
      setLoading(null)
    }
  }

  return (
    <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <ListChecks className="size-4" aria-hidden />
            async backtest control plane
          </div>
          <h2 className="mt-2 text-[20px] font-semibold text-ink">策略注册表与回测任务</h2>
          <p className="mt-1 max-w-[780px] text-[13px] leading-6 text-ink-muted">
            回测结果会写入统一策略注册表，任务状态独立保存；页面只读结果，不再为了矿工候选批量计算而卡住首屏。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={refreshJobs}
            disabled={Boolean(loading)}
            className="inline-flex h-9 items-center gap-1.5 rounded-[7px] border border-rule bg-[#fafafa] px-3 font-mono text-[11px] text-ink-muted disabled:opacity-50"
          >
            {loading === "refresh" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
            刷新
          </button>
          <button
            type="button"
            onClick={createCatalogJob}
            disabled={Boolean(loading)}
            className="inline-flex h-9 items-center gap-1.5 rounded-[7px] border border-rule bg-white px-3 font-mono text-[11px] text-ink disabled:opacity-50"
          >
            {loading === "catalog" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
            创建目录任务
          </button>
          <button
            type="button"
            onClick={runNextJob}
            disabled={Boolean(loading) || snapshot.summary.runningJobs > 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-[7px] bg-ink px-3 font-mono text-[11px] text-white disabled:opacity-50"
          >
            {loading === "run" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
            运行下一项
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        <BacktestMiniStat label="注册策略" value={snapshot.summary.total} tone="neutral" />
        <BacktestMiniStat label="雷达候选" value={snapshot.summary.radarReady} tone="good" />
        <BacktestMiniStat label="观察池" value={snapshot.summary.watchlist} tone="warning" />
        <BacktestMiniStat label="拦截" value={snapshot.summary.blocked} tone="neutral" />
        <BacktestMiniStat label="排队" value={snapshot.summary.queuedJobs} tone="warning" />
        <BacktestMiniStat label="运行" value={snapshot.summary.runningJobs} tone="neutral" />
      </div>

      <div className="mt-3 grid gap-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[11px] text-ink-muted">latest job</span>
            <span className="font-mono text-[10px] text-ink-faint">{snapshot.driver}</span>
          </div>
          {latestJob ? (
            <p className="mt-2 text-[12px] leading-5 text-ink-muted">
              <span className="font-mono text-ink">{latestJob.status}</span>
              <span className="mx-2 text-ink-faint">·</span>
              {latestJob.summary ?? latestJob.strategyName ?? latestJob.kind}
              <span className="mx-2 text-ink-faint">·</span>
              {formatStableDateTime(latestJob.updatedAt)}
            </p>
          ) : (
            <p className="mt-2 text-[12px] leading-5 text-ink-muted">还没有回测任务。创建目录任务后，结果会写入策略注册表。</p>
          )}
        </div>
        <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
          <div className="font-mono text-[11px] text-ink-muted">top registered strategies</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {snapshot.entries.slice(0, 5).map((entry) => (
              <span key={entry.strategyId} className="rounded-[5px] border border-rule bg-white px-2 py-1 font-mono text-[10px] text-ink-muted">
                {entry.name} · {Math.round(entry.score)}
              </span>
            ))}
            {snapshot.entries.length === 0 && <span className="text-[12px] text-ink-muted">注册表等待首次同步。</span>}
          </div>
        </div>
      </div>

      {message && (
        <p className="mt-3 rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 text-[12px] leading-5 text-ink-muted">
          {message}
        </p>
      )}
    </section>
  )
}

function BacktestMiniStat({ label, value, tone }: { label: string; value: number; tone: "good" | "warning" | "neutral" }) {
  const color = tone === "good" ? "text-bull" : tone === "warning" ? "text-warning" : "text-ink"
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-2 py-2">
      <p className="font-mono text-[9px] text-ink-faint">{label}</p>
      <p className={`mt-1 font-mono text-[15px] font-semibold ${color}`}>{value}</p>
    </div>
  )
}

function StrategyDiagnosis({ report }: { report: BacktestReport }) {
  const diagnosis = report.diagnosis
  const admission = diagnosis.admission ?? {
    status: "blocked" as const,
    gate: "禁止入雷达" as const,
    score: diagnosis.score,
    tags: diagnosis.tags?.length ? diagnosis.tags : ["待复测"],
    reason: "旧版回测报告缺少准入信息，请重新运行真实回测。",
  }
  const verdictColor =
    diagnosis.verdict === "可继续小样本跟踪"
      ? "text-bull"
      : diagnosis.verdict === "需要修正后复测"
        ? "text-warning"
        : "text-bear"

  return (
    <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <AlertTriangle className="size-4" aria-hidden />
            策略诊断
          </div>
          <h3 className={`mt-2 text-[18px] font-semibold ${verdictColor}`}>{diagnosis.verdict}</h3>
          <p className="mt-1 max-w-[760px] text-[13px] leading-6 text-ink-muted">{diagnosis.headline}</p>
        </div>
        <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 text-right">
          <div className="font-mono text-[24px] font-semibold leading-none text-ink">{diagnosis.score}</div>
          <div className="mt-1 font-mono text-[10px] text-ink-muted">diagnosis score</div>
        </div>
      </div>

      <div className="mb-4 rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] text-ink-faint">radar admission</p>
            <p className={`mt-1 text-[15px] font-semibold ${admission.status === "radar-ready" ? "text-bull" : admission.status === "watchlist" ? "text-warning" : "text-bear"}`}>
              {admission.gate}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            {admission.tags.map((tag) => (
              <span key={tag} className="rounded-[5px] border border-rule bg-white px-2 py-1 font-mono text-[10px] text-ink-muted">
                {tag}
              </span>
            ))}
          </div>
        </div>
        <p className="mt-2 text-[12px] leading-5 text-ink-muted">{admission.reason}</p>
      </div>

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {diagnosis.checks.map((check) => (
          <DiagnosisCheck key={check.label} check={check} />
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <CheckCircle2 className="size-4" aria-hidden />
            下一步修正
          </div>
          <ol className="mt-3 space-y-2">
            {diagnosis.recommendations.map((item, index) => (
              <li key={item} className="flex gap-2 text-[12px] leading-5 text-ink-muted">
                <span className="font-mono text-ink-faint">{String(index + 1).padStart(2, "0")}</span>
                <span>{item}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
          <TradeMiniList title="主要拖累" trades={diagnosis.topLosers} tone="bad" />
          <TradeMiniList title="主要贡献" trades={diagnosis.topWinners} tone="good" />
        </div>
      </div>
    </section>
  )
}

function DiagnosisCheck({ check }: { check: BacktestReport["diagnosis"]["checks"][number] }) {
  const toneClass =
    check.tone === "good"
      ? "text-bull"
      : check.tone === "bad"
        ? "text-bear"
        : check.tone === "warning"
          ? "text-warning"
          : "text-ink"

  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
      <div className="font-mono text-[10px] text-ink-faint">{check.label}</div>
      <div className={`mt-2 font-mono text-[16px] font-semibold ${toneClass}`}>{check.value}</div>
      <p className="mt-2 text-[12px] leading-5 text-ink-muted">{check.note}</p>
    </div>
  )
}

function TradeMiniList({
  title,
  trades,
  tone,
}: {
  title: string
  trades: BacktestReport["positionTrades"]
  tone: "good" | "bad"
}) {
  const color = tone === "good" ? "text-bull" : "text-bear"
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
      <div className="font-mono text-[11px] text-ink-muted">{title}</div>
      <div className="mt-2 space-y-2">
        {trades.slice(0, 3).map((trade) => (
          <div key={`${title}-${trade.symbol}-${trade.entryDate}-${trade.exitDate}`} className="flex items-center justify-between gap-3 text-[12px]">
            <div className="min-w-0">
              <div className="truncate font-medium text-ink">{trade.name}</div>
              <div className="font-mono text-[10px] text-ink-faint">{trade.entryDate} - {trade.exitDate}</div>
            </div>
            <div className={`shrink-0 font-mono font-semibold ${color}`}>{formatSignedPercentValue(trade.returnPct)}</div>
          </div>
        ))}
        {trades.length === 0 && <p className="text-[12px] text-ink-muted">暂无已结算交易。</p>}
      </div>
    </div>
  )
}

function CurveTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey?: string; value?: number; payload?: { holdings?: string; drawdown?: number } }>; label?: string }) {
  if (!active || !payload?.length) return null
  const strategy = payload.find((item) => item.dataKey === "strategy")?.value ?? 1
  const benchmark = payload.find((item) => item.dataKey === "benchmark")?.value ?? 1
  const row = payload[0]?.payload
  return (
    <div className="rounded-[7px] border border-rule bg-white px-3 py-2 text-[12px] shadow-sm">
      <p className="font-mono text-ink">{label}</p>
      <p className="mt-1 text-[#2f6f97]">策略收益 {formatReturn(strategy - 1)}</p>
      <p className="text-[#9b3d3d]">基准收益 {formatReturn(benchmark - 1)}</p>
      <p className="text-ink-muted">回撤 {formatReturn(row?.drawdown ?? 0)}</p>
      <p className="mt-1 max-w-[260px] text-ink-muted">{row?.holdings}</p>
    </div>
  )
}

function BarTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: number }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-[7px] border border-rule bg-white px-3 py-2 text-[12px] shadow-sm">
      <p className="font-mono text-ink">{label}</p>
      <p className="mt-1 text-ink-muted">当日收益 {formatReturn(payload[0]?.value ?? 0)}</p>
    </div>
  )
}

function PositionTradeRow({ trade }: { trade: BacktestReport["positionTrades"][number] }) {
  const retColor = trade.returnPct >= 0 ? "text-bull" : "text-bear"
  const alphaColor = trade.alphaPct >= 0 ? "text-bull" : "text-bear"

  return (
    <tr className="text-[12px] text-ink">
      <td className="border-b border-rule-soft py-3 pr-3">
        <div className="font-semibold">{trade.name}</div>
        <div className="font-mono text-[11px] text-ink-muted">{trade.symbol}</div>
      </td>
      <td className="border-b border-rule-soft py-3 pr-3 font-mono text-ink-muted">{trade.entryDate}</td>
      <td className="border-b border-rule-soft py-3 pr-3 font-mono text-ink-muted">
        {trade.exitDate}
        <span className="ml-2 text-ink-faint">{trade.holdingDays}d</span>
      </td>
      <td className="border-b border-rule-soft py-3 pr-3 text-ink-muted">{trade.exitReason ?? "调仓退出"}</td>
      <td className="border-b border-rule-soft py-3 pr-3 text-right font-mono">{trade.entryPrice.toFixed(2)}</td>
      <td className="border-b border-rule-soft py-3 pr-3 text-right font-mono">{trade.exitPrice.toFixed(2)}</td>
      <td className="border-b border-rule-soft py-3 pr-3 text-right font-mono">{(trade.weight * 100).toFixed(1)}%</td>
      <td className={`border-b border-rule-soft py-3 pr-3 text-right font-mono font-semibold ${retColor}`}>
        {formatSignedPercentValue(trade.returnPct)}
      </td>
      <td className="border-b border-rule-soft py-3 pr-3 text-right font-mono text-ink-muted">
        {formatSignedPercentValue(trade.benchmarkReturnPct)}
      </td>
      <td className={`border-b border-rule-soft py-3 text-right font-mono font-semibold ${alphaColor}`}>
        {formatSignedPercentValue(trade.alphaPct)}
      </td>
    </tr>
  )
}

function PositionTradeMobileCard({ trade }: { trade: BacktestReport["positionTrades"][number] }) {
  const retColor = trade.returnPct >= 0 ? "text-bull" : "text-bear"
  const alphaColor = trade.alphaPct >= 0 ? "text-bull" : "text-bear"

  return (
    <article className="rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-ink">{trade.name}</p>
          <p className="mt-1 font-mono text-[11px] text-ink-muted">{trade.symbol}</p>
        </div>
        <span className={`shrink-0 font-mono text-[14px] font-semibold ${retColor}`}>
          {formatSignedPercentValue(trade.returnPct)}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <TradeField label="买入日" value={trade.entryDate} />
        <TradeField label="卖出日" value={`${trade.exitDate} · ${trade.holdingDays}d`} />
        <TradeField label="买入价" value={trade.entryPrice.toFixed(2)} />
        <TradeField label="卖出价" value={trade.exitPrice.toFixed(2)} />
        <TradeField label="权重" value={`${(trade.weight * 100).toFixed(1)}%`} />
        <TradeField label="超额" value={formatSignedPercentValue(trade.alphaPct)} toneClass={alphaColor} />
      </div>
      <p className="mt-3 text-[12px] leading-5 text-ink-muted">{trade.exitReason ?? "调仓退出"}</p>
    </article>
  )
}

function TradeField({ label, value, toneClass = "text-ink" }: { label: string; value: string; toneClass?: string }) {
  return (
    <div className="rounded-[6px] border border-rule bg-white px-2.5 py-2">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className={`mt-1 font-mono text-[12px] tabular ${toneClass}`}>{value}</p>
    </div>
  )
}

function formatReturn(value: number) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`
}

function formatSignedPercentValue(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
}

function compareBacktestReports(a: BacktestReport, b: BacktestReport) {
  return scoreReport(b) - scoreReport(a)
}

function scoreReport(report: BacktestReport) {
  const annual = metricValue(report, "策略年化收益")
  const excess = metricValue(report, "超额收益")
  const drawdown = Math.abs(metricValue(report, "最大回撤"))
  const sharpe = metricValue(report, "夏普比率")
  const winRate = metricValue(report, "胜率")
  const admission = safeAdmission(report)
  const gateBonus = admission.status === "radar-ready" ? 20 : admission.status === "watchlist" ? 6 : -12
  return round1(admission.score + annual * 0.18 + excess * 0.28 + sharpe * 5 + (winRate - 50) * 0.25 - drawdown * 0.35 + gateBonus)
}

function safeAdmission(report: BacktestReport) {
  const admission = report.diagnosis?.admission
  if (admission?.status === "radar-ready" || admission?.status === "watchlist" || admission?.status === "blocked") {
    return admission
  }
  return {
    status: "blocked" as const,
    gate: "禁止入雷达" as const,
    score: report.diagnosis?.score ?? 0,
    tags: report.diagnosis?.tags?.length ? report.diagnosis.tags : ["待复测"],
    reason: "旧版回测报告缺少雷达准入信息，请重新运行真实回测。",
  }
}

function metricValue(report: BacktestReport, label: string) {
  const value = report.metrics.find((item) => item.label === label)?.value ?? "0"
  return Number(value.replace("%", "").replace(/[+,]/g, "")) || 0
}

function reportSourceLabel(report: BacktestReport) {
  if (report.strategyId.startsWith("mine-")) return "策略矿工"
  if (report.strategyId.startsWith("lab-")) return "策略实验室"
  return report.backtestSource ?? "Qveris"
}

function formatStableDateTime(value: string) {
  if (!value) return "N/A"
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return formatBeijingDateTime(date, { seconds: true })
}

function round1(value: number) {
  return Math.round(value * 10) / 10
}
