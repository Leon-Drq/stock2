import Link from "next/link"
import type { ReactNode } from "react"
import { PageMasthead, PageShell } from "@/components/shared/page-shell"
import { getChinaMarketSession, shouldTrackRadarPrices } from "@/lib/cn-market-session"
import { formatBeijingDateTime, formatPercent, formatPrice } from "@/lib/format"
import { radarExitReturnPct, SEEDED_RADAR_HISTORY, recordsFromSignals, type RadarHistoryRecord } from "@/lib/radar-history"
import { buildRadarReport } from "@/lib/radar-pick"
import { loadRadarSignalHistoryRecords, trackOpenRadarSignals } from "@/lib/radar-signal-store"

export const metadata = {
  title: "信号账本 — Stock Radar",
}

export const dynamic = "force-dynamic"

type SearchParams = Record<string, string | string[] | undefined>
type HistorySort = "recent" | "return-desc" | "return-asc" | "mfe-desc" | "worst-first"

const STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "open", label: "跟踪中" },
  { value: "target-hit", label: "已止盈" },
  { value: "stopped", label: "已失效" },
  { value: "expired", label: "到期" },
] as const

const SORT_OPTIONS: Array<{ value: HistorySort; label: string }> = [
  { value: "recent", label: "最新触发" },
  { value: "return-desc", label: "收益最高" },
  { value: "return-asc", label: "收益最低" },
  { value: "mfe-desc", label: "最高浮盈" },
  { value: "worst-first", label: "优先复盘" },
]

const RADAR_HISTORY_IO_TIMEOUT_MS = 5_000

export default async function RadarHistoryPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const params = searchParams ? await searchParams : {}
  const activeStatus = firstParam(params, "status") ?? "all"
  const activeStrategy = firstParam(params, "strategy") ?? "all"
  const activeIndustry = firstParam(params, "industry") ?? "all"
  const activeSort = normalizeSort(firstParam(params, "sort"))
  const marketSession = getChinaMarketSession()
  const tracking = shouldTrackRadarPrices(marketSession)
    ? await withFallback(trackOpenRadarSignals({ limit: 120 }), RADAR_HISTORY_IO_TIMEOUT_MS, null)
    : null

  const ledgerRecords = await withFallback(loadRadarSignalHistoryRecords(260), RADAR_HISTORY_IO_TIMEOUT_MS, [])
  const latestSignals =
    ledgerRecords.length > 0
      ? []
      : await withFallback(
          buildRadarReport({ useReal: true, topN: 5 }).then((result) => recordsFromSignals(result.report.suggestions)),
          RADAR_HISTORY_IO_TIMEOUT_MS,
          [],
        )
  const fallbackRecords = ledgerRecords.length > 0 ? [] : [...latestSignals, ...SEEDED_RADAR_HISTORY]
  const allRecords = (ledgerRecords.length > 0 ? ledgerRecords : fallbackRecords).sort(sortHistory("recent"))
  const strategies = optionList(allRecords, displayStrategyName)
  const industries = optionList(allRecords, (record) => record.industry ?? "未分类")
  const records = allRecords
    .filter((record) => activeStatus === "all" || normalizeStatus(record) === activeStatus)
    .filter((record) => activeStrategy === "all" || displayStrategyName(record) === activeStrategy)
    .filter((record) => activeIndustry === "all" || (record.industry ?? "未分类") === activeIndustry)
    .sort(sortHistory(activeSort))

  const metrics = summarizeRecords(records)
  const strategyStats = buildStrategyStats(allRecords).slice(0, 4)

  return (
    <PageShell width="wide">
      <PageMasthead
        layer="Layer 3"
        layerEn="Radar History"
        title="信号账本"
        subtitle="记录每次雷达信号的推荐时间、触发价、当前价、触发后涨跌幅与跟踪状态；刚入账且没有后续行情的信号会标记为待更新，不纳入收益统计。"
      />

      <section className="mt-5 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="跟踪中" value={String(metrics.active)} />
        <Metric label="正收益记录" value={`${metrics.hit}/${metrics.measured}`} />
        <Metric label="达标 / 失效" value={`${metrics.targetHit}/${metrics.stopped}`} />
        <Metric label="平均涨跌" value={formatSignedPercent(metrics.avgReturn)} tone={metrics.avgReturn >= 0 ? "up" : "down"} />
        <Metric label="平均最高浮盈" value={formatSignedPercent(metrics.avgMfe)} tone={metrics.avgMfe >= 0 ? "up" : "down"} />
        <Metric
          label="本次跟踪"
          value={tracking ? `${tracking.updated}/${tracking.openBefore}` : "休市"}
          tone={tracking && tracking.closed > 0 ? "down" : undefined}
          note={tracking ? `关闭 ${tracking.closed}` : marketSession.phaseLabel}
        />
      </section>

      <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] text-ink-muted">Strategy Quality</p>
            <h2 className="mt-1 text-[20px] font-semibold text-ink">策略真实表现</h2>
          </div>
          <span className="font-mono text-[11px] text-ink-muted">{allRecords.length} 条信号样本</span>
        </div>
        <div className="grid gap-2 lg:grid-cols-4">
          {strategyStats.map((strategy) => (
            <StrategyStatCard key={strategy.key} strategy={strategy} />
          ))}
        </div>
      </section>

      <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="grid gap-4 xl:grid-cols-[1fr_auto] xl:items-start">
          <div className="space-y-3">
            <FilterGroup label="状态">
              {STATUS_OPTIONS.map((option) => (
                <FilterChip
                  key={option.value}
                  href={historyHref(params, { status: option.value, page: null })}
                  active={activeStatus === option.value}
                >
                  {option.label}
                </FilterChip>
              ))}
            </FilterGroup>
            <FilterGroup label="策略">
              <FilterChip href={historyHref(params, { strategy: "all" })} active={activeStrategy === "all"}>全部策略</FilterChip>
              {strategies.map((strategy) => (
                <FilterChip key={strategy} href={historyHref(params, { strategy })} active={activeStrategy === strategy}>
                  {strategy}
                </FilterChip>
              ))}
            </FilterGroup>
            <FilterGroup label="行业">
              <FilterChip href={historyHref(params, { industry: "all" })} active={activeIndustry === "all"}>全部行业</FilterChip>
              {industries.slice(0, 18).map((industry) => (
                <FilterChip key={industry} href={historyHref(params, { industry })} active={activeIndustry === industry}>
                  {industry}
                </FilterChip>
              ))}
            </FilterGroup>
          </div>
          <FilterGroup label="排序">
            {SORT_OPTIONS.map((option) => (
              <FilterChip
                key={option.value}
                href={historyHref(params, { sort: option.value })}
                active={activeSort === option.value}
              >
                {option.label}
              </FilterChip>
            ))}
          </FilterGroup>
        </div>
      </section>

      <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] text-ink-muted">Recommendation Ledger</p>
            <h2 className="mt-1 text-[20px] font-semibold text-ink">推荐流水</h2>
          </div>
          <span className="font-mono text-[11px] text-ink-muted">{records.length} / {allRecords.length} 条记录</span>
        </div>

        <div className="grid gap-2 md:hidden">
          {records.map((record) => (
            <HistoryMobileCard key={record.id} record={record} />
          ))}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1280px] border-collapse text-left">
            <thead>
              <tr className="border-b border-rule-soft font-mono text-[11px] text-ink-muted">
                <th className="py-2 pr-3 font-normal">推荐时间（北京时间）</th>
                <th className="py-2 pr-3 font-normal">标的</th>
                <th className="py-2 pr-3 font-normal">策略 / 行业</th>
                <th className="py-2 pr-3 font-normal">信号</th>
                <th className="py-2 pr-3 text-right font-normal">持仓</th>
                <th className="py-2 pr-3 text-right font-normal">触发价</th>
                <th className="py-2 pr-3 text-right font-normal">当前价</th>
                <th className="py-2 pr-3 text-right font-normal">信号后</th>
                <th className="py-2 pr-3 text-right font-normal">最高浮盈</th>
                <th className="py-2 pr-3 text-right font-normal">最大不利</th>
                <th className="py-2 pr-3 text-right font-normal">状态</th>
                <th className="py-2 text-right font-normal">退出 / 备注</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <HistoryRow key={record.id} record={record} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </PageShell>
  )
}

type StrategyStats = ReturnType<typeof buildStrategyStats>[number]

function Metric({ label, value, tone, note }: { label: string; value: string; tone?: "up" | "down"; note?: string }) {
  const color = tone === "up" ? "text-bull" : tone === "down" ? "text-bear" : "text-ink"
  return (
    <div className="rounded-[7px] border border-rule bg-white px-4 py-4">
      <p className="font-mono text-[11px] text-ink-muted">{label}</p>
      <p className={`mt-2 font-mono text-[26px] leading-none tabular ${color}`}>{value}</p>
      {note && <p className="mt-2 text-[11px] text-ink-muted">{note}</p>}
    </div>
  )
}

function HistoryMobileCard({ record }: { record: RadarHistoryRecord }) {
  const isPending = record.priceStatus === "pending-follow-up"
  const displayReturnPct = radarExitReturnPct(record)
  const isUp = displayReturnPct >= 0
  const status = normalizeStatus(record)
  const maxDrawdown = record.maxDrawdownPct ?? Math.min(record.returnPct, 0)
  const holdDays = record.holdDays ?? holdingDays(record.recommendedAt, record.closedAt ?? record.latestQuoteAt)

  return (
    <article className="rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold text-ink">{record.name}</div>
          <div className="mt-1 font-mono text-[11px] text-ink-muted">{record.ticker} · {displayStrategyName(record)}</div>
        </div>
        <span className={`shrink-0 rounded-[5px] border px-2 py-1 font-mono text-[11px] ${statusClass(status, record)}`}>
          {statusLabel(status, record)}
        </span>
      </div>
      <p className="mt-2 text-[12px] leading-5 text-ink-muted">{displaySignalName(record.signal)}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <MiniField label="推荐时间（北京时间）" value={formatDateTime(record.recommendedAt)} />
        <MiniField label="持仓" value={`${holdDays} 天`} />
        <MiniField label="触发价" value={formatPrice(record.triggerPrice)} />
        <MiniField label="当前价" value={isPending ? "待新行情" : formatPrice(record.latestPrice)} />
        <MiniField
          label="信号后"
          value={isPending ? "待更新" : `${isUp ? "+" : ""}${formatPercent(displayReturnPct)}`}
          tone={isPending ? undefined : isUp ? "up" : "down"}
        />
        <MiniField
          label="最高 / 最大不利"
          value={isPending ? "待更新" : `+${formatPercent(Math.max(0, record.maxReturnPct))} / ${formatSignedPercent(maxDrawdown)}`}
          tone={isPending ? undefined : maxDrawdown < 0 ? "down" : "up"}
        />
      </div>
      <p className="mt-3 line-clamp-2 text-[12px] leading-5 text-ink-muted">{record.exitReason ?? record.note}</p>
      {(record.stopLossPrice || record.targetPrice) && (
        <div className="mt-2 font-mono text-[10px] text-ink-faint">
          {record.stopLossPrice ? `失效价 ${formatPrice(record.stopLossPrice)}` : ""}
          {record.stopLossPrice && record.targetPrice ? " / " : ""}
          {record.targetPrice ? `目标 ${formatPrice(record.targetPrice)}` : ""}
        </div>
      )}
    </article>
  )
}

function MiniField({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  const color = tone === "up" ? "text-bull" : tone === "down" ? "text-bear" : "text-ink"
  return (
    <div className="rounded-[6px] border border-rule bg-white px-2.5 py-2">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className={`mt-1 break-words font-mono text-[12px] tabular ${color}`}>{value}</p>
    </div>
  )
}

function HistoryRow({ record }: { record: RadarHistoryRecord }) {
  const isPending = record.priceStatus === "pending-follow-up"
  const displayReturnPct = radarExitReturnPct(record)
  const isUp = displayReturnPct >= 0
  const status = normalizeStatus(record)
  const maxDrawdown = record.maxDrawdownPct ?? Math.min(record.returnPct, 0)
  const holdDays = record.holdDays ?? holdingDays(record.recommendedAt, record.closedAt ?? record.latestQuoteAt)
  return (
    <tr className="border-b border-rule-soft align-top text-[13px] text-ink-muted last:border-b-0">
      <td className="py-3 pr-3 font-mono text-[12px]">{formatDateTime(record.recommendedAt)}</td>
      <td className="py-3 pr-3">
        <div className="font-semibold text-ink">{record.name}</div>
        <div className="font-mono text-[11px] text-ink-muted">{record.ticker}</div>
      </td>
      <td className="py-3 pr-3">
        <div className="text-[12px] text-ink-soft">{displayStrategyName(record)}</div>
        <div className="mt-1 font-mono text-[11px] text-ink-faint">{record.industry ?? "未分类"}</div>
      </td>
      <td className="py-3 pr-3">
        <div className="text-ink-soft">{displaySignalName(record.signal)}</div>
        <div className="mt-1 line-clamp-1 max-w-[280px] text-[12px] text-ink-faint" title={record.note}>
          {record.note}
        </div>
      </td>
      <td className="py-3 pr-3 text-right font-mono text-ink-muted">{holdDays} 天</td>
      <td className="py-3 pr-3 text-right font-mono text-ink">{formatPrice(record.triggerPrice)}</td>
      <td className="py-3 pr-3 text-right">
        <div className="font-mono text-ink">{formatPrice(record.latestPrice)}</div>
        {isPending ? <div className="mt-1 font-mono text-[10px] text-ink-faint">待新行情</div> : null}
      </td>
      <td className={`py-3 pr-3 text-right font-mono ${isPending ? "text-ink-faint" : isUp ? "text-bull" : "text-bear"}`}>
        {isPending ? (
          "待更新"
        ) : (
          <>
            {isUp ? "+" : ""}
            {formatPercent(displayReturnPct)}
          </>
        )}
      </td>
      <td className={`py-3 pr-3 text-right font-mono ${isPending ? "text-ink-faint" : "text-health-ok"}`}>
        {isPending ? "待更新" : `+${formatPercent(Math.max(0, record.maxReturnPct))}`}
      </td>
      <td className={`py-3 pr-3 text-right font-mono ${isPending ? "text-ink-faint" : maxDrawdown < 0 ? "text-bear" : "text-ink-muted"}`}>
        {isPending ? "待更新" : formatSignedPercent(maxDrawdown)}
      </td>
      <td className="py-3 pr-3 text-right">
        <span className={`rounded-[5px] border px-2 py-1 font-mono text-[11px] ${statusClass(status, record)}`}>
          {statusLabel(status, record)}
        </span>
      </td>
      <td className="py-3 text-right">
        <div className="ml-auto max-w-[220px] text-[12px] leading-5 text-ink-muted">
          {record.exitReason ?? record.note}
        </div>
        {(record.stopLossPrice || record.targetPrice) && (
          <div className="mt-1 font-mono text-[10px] text-ink-faint">
            {record.stopLossPrice ? `失效价 ${formatPrice(record.stopLossPrice)}` : ""}
            {record.stopLossPrice && record.targetPrice ? " / " : ""}
            {record.targetPrice ? `目标 ${formatPrice(record.targetPrice)}` : ""}
          </div>
        )}
      </td>
    </tr>
  )
}

function StrategyStatCard({ strategy }: { strategy: StrategyStats }) {
  const pass = strategy.hitRate >= 0.5 && strategy.avgReturn >= 0
  return (
    <div className="rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[14px] font-semibold text-ink">{strategy.name}</h3>
          <p className="mt-1 font-mono text-[11px] text-ink-muted">{strategy.total} signals · {strategy.active} open</p>
        </div>
        <span className={`rounded-[5px] border px-2 py-1 font-mono text-[10px] ${pass ? "border-[#cfe6d8] bg-[#eef8f2] text-health-ok" : "border-rule bg-white text-ink-muted"}`}>
          {pass ? "可继续" : "观察"}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <MiniStat label="胜率" value={`${Math.round(strategy.hitRate * 100)}%`} />
        <MiniStat label="均值" value={formatSignedPercent(strategy.avgReturn)} tone={strategy.avgReturn >= 0 ? "up" : "down"} />
        <MiniStat label="最差" value={formatSignedPercent(strategy.worstReturn)} tone={strategy.worstReturn >= 0 ? "up" : "down"} />
      </div>
      <div className="mt-3 font-mono text-[11px] text-ink-muted">
        止盈 {strategy.targetHit} / 失效 {strategy.stopped} / 到期 {strategy.expired}
      </div>
    </div>
  )
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  const color = tone === "up" ? "text-bull" : tone === "down" ? "text-bear" : "text-ink"
  return (
    <div>
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className={`mt-1 font-mono text-[14px] font-semibold tabular ${color}`}>{value}</p>
    </div>
  )
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 font-mono text-[11px] text-ink-muted">{label}</span>
      {children}
    </div>
  )
}

function FilterChip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-[6px] border px-2.5 py-1.5 text-[12px] transition ${
        active
          ? "border-ink bg-ink text-paper"
          : "border-rule bg-[#fafafa] text-ink-muted hover:border-ink hover:text-ink"
      }`}
    >
      {children}
    </Link>
  )
}

function summarizeRecords(records: RadarHistoryRecord[]) {
  const measured = records.filter(isMeasuredRecord)
  const active = records.filter((record) => normalizeStatus(record) === "open").length
  const targetHit = records.filter((record) => normalizeStatus(record) === "target-hit").length
  const stopped = records.filter((record) => normalizeStatus(record) === "stopped").length
  const expired = records.filter((record) => normalizeStatus(record) === "expired").length
  const hit = measured.filter((record) => record.returnPct > 0).length
  const avgReturn = measured.length ? measured.reduce((sum, record) => sum + record.returnPct, 0) / measured.length : 0
  const avgMfe = measured.length ? measured.reduce((sum, record) => sum + record.maxReturnPct, 0) / measured.length : 0
  return { active, targetHit, stopped, expired, hit, measured: measured.length, avgReturn, avgMfe }
}

function buildStrategyStats(records: RadarHistoryRecord[]) {
  const groups = new Map<string, { name: string; records: RadarHistoryRecord[] }>()
  for (const record of records) {
    const name = displayStrategyName(record)
    const key = record.strategyId ?? name
    const group = groups.get(key) ?? { name, records: [] }
    group.records.push(record)
    groups.set(key, group)
  }

  return Array.from(groups.entries())
    .map(([key, group]) => {
      const metrics = summarizeRecords(group.records)
      const closed = group.records.filter((record) => normalizeStatus(record) !== "open")
      const measured = group.records.filter(isMeasuredRecord)
      const hitBase = closed.filter(isMeasuredRecord).length ? closed.filter(isMeasuredRecord) : measured
      return {
        key,
        name: group.name,
        total: group.records.length,
        active: metrics.active,
        targetHit: metrics.targetHit,
        stopped: metrics.stopped,
        expired: metrics.expired,
        hitRate: hitBase.length ? hitBase.filter((record) => record.returnPct > 0).length / hitBase.length : 0,
        avgReturn: metrics.avgReturn,
        avgMfe: metrics.avgMfe,
        worstReturn: measured.length ? Math.min(...measured.map((record) => record.returnPct)) : 0,
      }
    })
    .sort((a, b) => b.total - a.total || b.avgReturn - a.avgReturn)
}

function optionList(records: RadarHistoryRecord[], pick: (record: RadarHistoryRecord) => string) {
  return Array.from(new Set(records.map(pick).filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-CN"))
}

function sortHistory(sort: HistorySort) {
  return (a: RadarHistoryRecord, b: RadarHistoryRecord) => {
    const pendingRank = Number(!isMeasuredRecord(a)) - Number(!isMeasuredRecord(b))
    if (sort !== "recent" && pendingRank !== 0) return pendingRank
    if (sort === "return-desc") return b.returnPct - a.returnPct
    if (sort === "return-asc") return a.returnPct - b.returnPct
    if (sort === "mfe-desc") return b.maxReturnPct - a.maxReturnPct
    if (sort === "worst-first") return a.returnPct - b.returnPct || b.maxReturnPct - a.maxReturnPct
    return new Date(b.recommendedAt).getTime() - new Date(a.recommendedAt).getTime()
  }
}

function isMeasuredRecord(record: RadarHistoryRecord) {
  return record.priceStatus !== "pending-follow-up"
}

function displayStrategyName(record: RadarHistoryRecord) {
  return displaySignalName(record.strategyName ?? record.strategyId ?? "未标记策略")
}

function displaySignalName(value: string) {
  if (value.includes("异动雷达")) return "策略雷达（历史）"
  return value
}

function normalizeStatus(record: RadarHistoryRecord) {
  if (record.lifecycleStatus) return record.lifecycleStatus
  if (record.status === "已止盈") return "target-hit"
  if (record.status === "已失效" || record.status === "已止损") return "stopped"
  if (record.status === "到期") return "expired"
  return "open"
}

function statusLabel(status: ReturnType<typeof normalizeStatus>, record?: RadarHistoryRecord) {
  if (record?.lifecycleStage === "candidate") return "候选中"
  if (record?.lifecycleStage === "triggered" || record?.priceStatus === "pending-follow-up") return "已触发"
  if (record?.lifecycleStage === "tracking") return "跟踪中"
  if (status === "target-hit") return "已止盈"
  if (status === "stopped") {
    const ret = record ? radarExitReturnPct(record) : -1
    if (ret > 0.05) return "风控退出"
    if (ret < -0.05) return "已止损"
    return "平价退出"
  }
  if (status === "expired") return "到期"
  return "跟踪中"
}

function statusClass(status: ReturnType<typeof normalizeStatus>, record?: RadarHistoryRecord) {
  if (status === "target-hit") return "border-[#cfe6d8] bg-[#eef8f2] text-health-ok"
  if (status === "stopped") {
    const ret = record ? radarExitReturnPct(record) : -1
    if (ret > 0.05) return "border-[#cfe6d8] bg-[#eef8f2] text-health-ok"
    if (ret < -0.05) return "border-[#f1d5d5] bg-[#fff6f4] text-bear"
    return "border-rule bg-[#fafafa] text-ink-muted"
  }
  if (status === "expired") return "border-rule bg-[#fafafa] text-ink-muted"
  return "border-[#d7e5ef] bg-[#f2f8fb] text-[#2f6f97]"
}

function normalizeSort(value?: string | null): HistorySort {
  return SORT_OPTIONS.some((option) => option.value === value) ? (value as HistorySort) : "recent"
}

function firstParam(params: SearchParams, key: string) {
  const value = params[key]
  return Array.isArray(value) ? value[0] : value
}

function historyHref(params: SearchParams, updates: Record<string, string | null>) {
  const next = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    const first = Array.isArray(value) ? value[0] : value
    if (first) next.set(key, first)
  }
  for (const [key, value] of Object.entries(updates)) {
    if (!value || value === "all" || (key === "sort" && value === "recent")) next.delete(key)
    else next.set(key, value)
  }
  const query = next.toString()
  return query ? `/radar/history?${query}` : "/radar/history"
}

function formatSignedPercent(value: number) {
  if (Math.abs(value) < 0.005) return formatPercent(0)
  return `${value >= 0 ? "+" : ""}${formatPercent(value)}`
}

function formatDateTime(iso: string) {
  return formatBeijingDateTime(iso, { dateStyle: "short" })
}

function holdingDays(startIso: string, endIso?: string) {
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0
  return Math.max(0, Math.ceil((end - start) / 86_400_000))
}

async function withFallback<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<T>((resolve) => {
    timeout = setTimeout(() => resolve(fallback), timeoutMs)
  })
  try {
    return await Promise.race([promise.catch(() => fallback), timeoutPromise])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
