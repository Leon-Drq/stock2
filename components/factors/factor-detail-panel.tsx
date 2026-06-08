"use client"

import { useState, useTransition } from "react"
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
  ComposedChart,
  Bar,
} from "recharts"

type ComputeResponse = {
  ok: boolean
  error?: string
  factorId?: string
  factor?: { id: string; name: string; formula: string; forwardDays: number }
  computedAt?: string
  dataSource?: {
    useReal: boolean
    qverisCount: number
    databaseCount?: number
    mockCount: number
    fallbackReason?: string
    durationMs: number
    bySymbol: Array<{
      symbol: string
      name: string
      source: "qveris" | "database" | "mock"
      toolId?: string
      toolName?: string
      error?: string
      barCount: number
    }>
  }
  stats?: {
    meanIC: number
    irAnnualized: number
    q1q5Pct: number
    winRatePct: number
    symbolCount: number
    observationDays: number
  }
  dailyIC?: Array<{ date: string; ic: number; n: number }>
  cumulativeIC?: Array<{ date: string; value: number }>
  snapshots?: Array<{
    symbol: string
    name: string
    industry: string
    source: "qveris" | "database" | "mock"
    latestFactor: number
    latestPercentile: number
    recentReturnPct: number
    latestClose: number
    latestDate: string
  }>
}

type ComputeSuccess = ComputeResponse & Required<Pick<ComputeResponse, "dataSource" | "stats" | "dailyIC" | "cumulativeIC" | "snapshots">>

const SUPPORTED = new Set([
  "f-mom-60d",
  "f-rev-5d",
  "f-vol-spike",
  "f-tight-breakout",
  "f-atr-compression",
  "f-absolute-momentum",
])

export function FactorDetailPanel({ factorId }: { factorId: string }) {
  const [data, setData] = useState<ComputeResponse | null>(null)
  const [isPending, startTransition] = useTransition()
  const [useReal, setUseReal] = useState(false)
  const supported = SUPPORTED.has(factorId)

  const compute = async () => {
    const res = await fetch(`/api/factors/${factorId}/compute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ useReal, lookbackDays: 120 }),
    })
    const json = (await res.json()) as ComputeResponse
    setData(json)
  }

  const handleClick = () => {
    startTransition(async () => {
      await compute()
    })
  }

  if (!supported) {
    return (
      <div className="mt-5 border-l border-rule px-5 py-3">
        <p className="font-mono text-[11px] text-ink-faint">
          此因子暂未接入实时计算，仅展示静态指标。已支持：
          <span className="ml-1 font-mono text-ink-soft">5 日反转 / 60 日动量 / 放量突破 / 箱体突破 / ATR 收缩 / 绝对动量</span>
        </p>
      </div>
    )
  }

  return (
    <div className="mt-5 border-l border-rule px-5 py-3">
      {/* 控制条 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={handleClick}
            disabled={isPending}
            className="border border-ink bg-ink px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper transition-colors hover:bg-paper hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "计算中…" : data ? "重新计算" : "运行计算"}
          </button>
          <label className="flex items-center gap-2 font-mono text-[11px] text-ink-soft">
            <input
              type="checkbox"
              checked={useReal}
              onChange={(e) => setUseReal(e.target.checked)}
              disabled={isPending}
              className="size-3 accent-ink"
            />
            调用 Qveris 真实数据
          </label>
        </div>
        {data?.dataSource && (
          <p className="font-mono text-[10px] text-ink-faint">
            {data.dataSource.durationMs} ms · {data.stats?.observationDays} 个观测日
          </p>
        )}
      </div>

      {/* 状态区 */}
      {!data && !isPending && (
        <p className="mt-4 font-serif text-[13px] italic text-ink-muted">
          点击运行后将基于 500 只目标股票池中已预热的真实 K 线，跑出 IC 时序、累积 IC、多空分位与最新选股快照。
        </p>
      )}

      {isPending && (
        <div className="mt-4 flex items-center gap-3">
          <span className="size-2 animate-pulse rounded-full bg-health-warn" aria-hidden />
          <p className="font-mono text-[11px] text-ink-soft">
            正在{useReal ? "通过 Qveris 拉取真实 K 线" : "生成演示 K 线"}并计算横截面 IC…
          </p>
        </div>
      )}

      {data && !data.ok && (
        <div className="mt-4 border-l-2 border-health-bad/40 bg-health-bad/5 px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-health-bad">计算失败</p>
          <p className="mt-1 font-mono text-[11px] text-ink-soft">{data.error}</p>
        </div>
      )}

      {isComputeSuccess(data) && (
        <FactorResultView data={data} />
      )}
    </div>
  )
}

function isComputeSuccess(data: ComputeResponse | null): data is ComputeSuccess {
  return Boolean(data?.ok && data.dataSource && data.stats && data.dailyIC && data.cumulativeIC && data.snapshots)
}

function FactorResultView({ data }: { data: ComputeSuccess }) {
  const { dataSource, stats, dailyIC, cumulativeIC, snapshots } = data
  const sourceLabel =
    dataSource.qverisCount === dataSource.bySymbol.length
      ? { tone: "ok" as const, label: "实时 · Qveris", note: `${dataSource.qverisCount}/${dataSource.bySymbol.length} 全量真实` }
      : dataSource.qverisCount > 0
        ? { tone: "warn" as const, label: "混合", note: `${dataSource.qverisCount} 真实 · ${dataSource.mockCount} 演示` }
        : { tone: "mute" as const, label: "演示数据", note: dataSource.fallbackReason ?? "未启用真实数据" }

  return (
    <div className="mt-5 space-y-6">
      {/* 数据来源徽章 */}
      <DataSourceBadge label={sourceLabel.label} tone={sourceLabel.tone} note={sourceLabel.note} />

      {/* 4 个统计 */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-y border-rule py-4 sm:grid-cols-4">
        <Stat label="IC 均值" value={stats.meanIC.toFixed(3)} hint={`基于 ${stats.observationDays} 日`} />
        <Stat label="IR" value={stats.irAnnualized.toFixed(2)} hint="mean / std(IC)" />
        <Stat label="Q1−Q5" value={`${stats.q1q5Pct >= 0 ? "+" : ""}${stats.q1q5Pct.toFixed(1)}%`} hint="年化分位价差" />
        <Stat label="胜率" value={`${stats.winRatePct.toFixed(0)}%`} hint="IC > 0 的天数" />
      </div>

      {/* IC 时序图 + 累积 IC */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ICTimeSeries dailyIC={dailyIC} />
        <CumulativeICChart cumulativeIC={cumulativeIC} />
      </div>

      {/* 选股快照 */}
      <Snapshots snapshots={snapshots} forwardDays={data.factor?.forwardDays ?? 5} />

      {/* 每只股的数据源 */}
      <SymbolSourceList bySymbol={dataSource.bySymbol} />
    </div>
  )
}

function DataSourceBadge({
  label,
  tone,
  note,
}: {
  label: string
  tone: "ok" | "warn" | "mute"
  note: string
}) {
  const cls =
    tone === "ok"
      ? "border-health-ok/40 bg-health-ok/5 text-health-ok"
      : tone === "warn"
        ? "border-health-warn/40 bg-health-warn/5 text-health-warn"
        : "border-rule bg-ink-faint/5 text-ink-muted"
  return (
    <div className={`flex flex-col gap-1 border-l-2 px-3 py-2 sm:flex-row sm:items-baseline sm:justify-between ${cls}`}>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em]">{label}</p>
      <p className="font-mono text-[11px] text-ink-soft">{note}</p>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-faint">{label}</p>
      <p className="mt-1 font-display text-2xl tabular text-ink">{value}</p>
      <p className="mt-0.5 font-mono text-[10px] text-ink-faint">{hint}</p>
    </div>
  )
}

function ICTimeSeries({ dailyIC }: { dailyIC: Array<{ date: string; ic: number; n: number }> }) {
  // 取每 N 个采样点显示日期，避免拥挤
  return (
    <figure>
      <figcaption className="mb-2 flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">每日 IC</span>
        <span className="font-mono text-[10px] text-ink-faint">{dailyIC.length} 日</span>
      </figcaption>
      <div className="h-[180px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={dailyIC} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="var(--color-rule)" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 9, fill: "var(--color-ink-faint)", fontFamily: "var(--font-mono)" }}
              stroke="var(--color-rule)"
              tickFormatter={(d: string) => d.slice(5)}
              interval={Math.max(0, Math.floor(dailyIC.length / 6))}
            />
            <YAxis
              tick={{ fontSize: 9, fill: "var(--color-ink-faint)", fontFamily: "var(--font-mono)" }}
              stroke="var(--color-rule)"
              tickFormatter={(v: number) => v.toFixed(2)}
              width={36}
              domain={[-1, 1]}
            />
            <ReferenceLine y={0} stroke="var(--color-ink)" strokeWidth={1} />
            <Tooltip
              cursor={{ stroke: "var(--color-ink-muted)", strokeDasharray: "2 2" }}
              contentStyle={{
                background: "var(--color-paper)",
                border: "1px solid var(--color-ink)",
                borderRadius: 0,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
              }}
              labelFormatter={(d) => `日期 ${d}`}
              formatter={(v: number) => [v.toFixed(3), "IC"]}
            />
            <Bar
              dataKey="ic"
              shape={(props: { x?: number; y?: number; width?: number; height?: number; payload?: { ic: number } }) => {
                const x = props.x ?? 0
                const width = props.width ?? 0
                const ic = props.payload?.ic ?? 0
                const zeroY = ((1 - 0) / 2) * 164 + 8 // 近似零轴位置
                // recharts 已经计算好正负 bar 的 y 与 height，直接用
                return (
                  <rect
                    x={x}
                    y={props.y ?? zeroY}
                    width={width}
                    height={Math.abs(props.height ?? 0)}
                    fill={ic >= 0 ? "var(--color-health-ok)" : "var(--color-health-bad)"}
                    fillOpacity={0.75}
                  />
                )
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}

function CumulativeICChart({ cumulativeIC }: { cumulativeIC: Array<{ date: string; value: number }> }) {
  return (
    <figure>
      <figcaption className="mb-2 flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">累积 IC</span>
        <span className="font-mono text-[10px] text-ink-faint">
          末值 {cumulativeIC.at(-1)?.value.toFixed(2) ?? "—"}
        </span>
      </figcaption>
      <div className="h-[180px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={cumulativeIC} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="var(--color-rule)" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 9, fill: "var(--color-ink-faint)", fontFamily: "var(--font-mono)" }}
              stroke="var(--color-rule)"
              tickFormatter={(d: string) => d.slice(5)}
              interval={Math.max(0, Math.floor(cumulativeIC.length / 6))}
            />
            <YAxis
              tick={{ fontSize: 9, fill: "var(--color-ink-faint)", fontFamily: "var(--font-mono)" }}
              stroke="var(--color-rule)"
              tickFormatter={(v: number) => v.toFixed(1)}
              width={36}
            />
            <ReferenceLine y={0} stroke="var(--color-ink)" strokeWidth={1} />
            <Tooltip
              cursor={{ stroke: "var(--color-ink-muted)", strokeDasharray: "2 2" }}
              contentStyle={{
                background: "var(--color-paper)",
                border: "1px solid var(--color-ink)",
                borderRadius: 0,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
              }}
              labelFormatter={(d) => `日期 ${d}`}
              formatter={(v: number) => [v.toFixed(2), "累积 IC"]}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="var(--color-ink)"
              strokeWidth={1.5}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}

function Snapshots({
  snapshots,
  forwardDays,
}: {
  snapshots: Array<{
    symbol: string
    name: string
    industry: string
    source: "qveris" | "database" | "mock"
    latestFactor: number
    latestPercentile: number
    recentReturnPct: number
    latestClose: number
    latestDate: string
  }>
  forwardDays: number
}) {
  return (
    <section>
      <h4 className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
        最新一期排名 · 按因子值降序 · {snapshots[0]?.latestDate}
      </h4>
      <ul className="space-y-px">
        {snapshots.map((s, idx) => {
          const isTop = idx < Math.ceil(snapshots.length * 0.3)
          const isBottom = idx >= Math.floor(snapshots.length * 0.7)
          const tone = isTop ? "text-health-ok" : isBottom ? "text-health-bad" : "text-ink-soft"
          return (
            <li
              key={s.symbol}
              className="grid grid-cols-[28px_1fr_72px_72px_56px] items-center gap-3 border-t border-rule py-2 text-[12px]"
            >
              <span className="font-mono text-[10px] text-ink-faint">{idx + 1}</span>
              <div className="min-w-0">
                <p className="truncate font-serif text-ink">
                  {s.name}{" "}
                  <span className="ml-1 font-mono text-[10px] text-ink-faint">{s.symbol}</span>
                </p>
                <p className="font-mono text-[10px] text-ink-faint">{s.industry}</p>
              </div>
              <p className={`text-right font-mono tabular ${tone}`}>{s.latestFactor.toFixed(3)}</p>
              <p className="text-right font-mono tabular text-ink-soft">
                {s.recentReturnPct >= 0 ? "+" : ""}
                {s.recentReturnPct.toFixed(1)}%
                <span className="ml-1 text-[9px] text-ink-faint">{forwardDays}d</span>
              </p>
              <p className="text-right font-mono text-[10px] uppercase text-ink-faint">
                {s.source === "qveris" ? "实时" : s.source === "database" ? "缓存" : "演示"}
              </p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function SymbolSourceList({
  bySymbol,
}: {
  bySymbol: Array<{
    symbol: string
    name: string
    source: "qveris" | "database" | "mock"
    toolId?: string
    toolName?: string
    error?: string
    barCount: number
  }>
}) {
  const hasAnyReal = bySymbol.some((s) => s.source === "qveris" || s.source === "database")
  if (!hasAnyReal) return null
  return (
    <details className="border-t border-rule pt-4">
      <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted hover:text-ink">
        每只股的数据来源 ({bySymbol.length})
      </summary>
      <ul className="mt-3 space-y-1">
        {bySymbol.map((s) => (
          <li key={s.symbol} className="flex flex-wrap items-baseline gap-x-3 font-mono text-[11px]">
            <span className="text-ink">{s.name}</span>
            <span className="text-ink-faint">{s.symbol}</span>
            <span
              className={
                s.source === "qveris" || s.source === "database" ? "text-health-ok" : "text-health-warn"
              }
            >
              {s.source === "qveris" ? "Qveris" : s.source === "database" ? "DB" : "Mock"}
            </span>
            <span className="text-ink-faint">{s.barCount} bars</span>
            {s.toolName && <span className="truncate text-ink-soft">{s.toolName}</span>}
            {s.error && <span className="text-health-bad">{s.error}</span>}
          </li>
        ))}
      </ul>
    </details>
  )
}
