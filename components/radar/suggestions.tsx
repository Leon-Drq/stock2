import { RefreshCw, WifiOff } from "lucide-react"
import type { SignalLevel, StockSignal } from "@/lib/radar-data"
import { signalLevelLabel } from "@/lib/radar-data"
import { buildRadarConfluenceSignals } from "@/lib/radar-confluence"
import { SectionLabel } from "./conclusion"
import { SignalCard } from "./signal-card"

type SuggestionsProps = {
  suggestions: StockSignal[]
  isLoading?: boolean
  refreshError?: string | null
  onRetry?: () => void
}

const GROUPS: Array<{
  id: string
  title: string
  subtitle: string
  levels: SignalLevel[]
  tone: string
}> = [
  {
    id: "confirm",
    title: "确认 / 加仓",
    subtitle: "突破、趋势延续和赔率确认",
    levels: ["green", "blue"],
    tone: "bg-[#e8f4ee] text-health-ok",
  },
  {
    id: "trial",
    title: "左侧试仓",
    subtitle: "低位反转和小仓验证",
    levels: ["yellow"],
    tone: "bg-[#fff7e8] text-[#946200]",
  },
  {
    id: "watch",
    title: "观察 / 排队",
    subtitle: "信号不足或等待触发",
    levels: ["compass", "purple", "orange", "red"],
    tone: "bg-[#f5f5f4] text-ink-muted",
  },
]

export function Suggestions({ suggestions, isLoading = false, refreshError, onRetry }: SuggestionsProps) {
  if (isLoading) {
    return <RadarLoadingState />
  }

  if (refreshError && suggestions.length === 0) {
    return <RadarErrorState error={refreshError} onRetry={onRetry} />
  }

  const closedSuggestions = suggestions.filter((signal) => signal.signalLifecycle === "closed")
  const freshSuggestions = suggestions.filter((signal) => signal.signalLifecycle === "new" || !signal.signalLifecycle)
  const trackingSuggestions = suggestions.filter((signal) => signal.signalLifecycle === "tracking")
  const candidateSuggestions = suggestions.filter((signal) => signal.signalLifecycle === "candidate")
  const lifecycleSummary = buildLifecycleSummary(suggestions)
  const confluenceRows = buildRadarConfluenceSignals(suggestions)
  const tradeable = freshSuggestions.filter((s) => s.signalLevel === "green" || s.signalLevel === "yellow" || s.signalLevel === "blue").length
  const watch = freshSuggestions.filter((s) => s.signalLevel === "purple" || s.signalLevel === "compass").length
  const levelCounts = freshSuggestions.reduce<Record<string, number>>((acc, signal) => {
    acc[signal.signalLevel] = (acc[signal.signalLevel] ?? 0) + 1
    return acc
  }, {})

  return (
    <section>
      <div className="rounded-[7px] border border-rule bg-white px-3 py-3 md:px-5 md:py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <SectionLabel>实时信号</SectionLabel>
            <p className="mt-2 hidden text-[13px] text-ink-muted sm:block">只展示首次触发的新机会；已触发过的标的进入跟踪，不重复占用推荐位。</p>
          </div>
          <div className="grid w-full grid-cols-3 gap-2 font-mono text-[11px] sm:w-auto sm:flex sm:flex-wrap">
            <span className="rounded-[6px] bg-ink px-2.5 py-1.5 text-center text-white sm:px-3">新信号 {freshSuggestions.length}</span>
            <span className="rounded-[6px] border border-rule px-2.5 py-1.5 text-center text-ink-muted sm:px-3">可交易 {tradeable}</span>
            <span className="rounded-[6px] border border-rule px-2.5 py-1.5 text-center text-ink-muted sm:px-3">观察 {watch}</span>
            {trackingSuggestions.length > 0 && (
              <span className="rounded-[6px] border border-rule px-2.5 py-1.5 text-center text-ink-muted sm:px-3">跟踪 {trackingSuggestions.length}</span>
            )}
            {candidateSuggestions.length > 0 && (
              <span className="rounded-[6px] border border-rule px-2.5 py-1.5 text-center text-ink-muted sm:px-3">候选 {candidateSuggestions.length}</span>
            )}
            {closedSuggestions.length > 0 && (
              <span className="rounded-[6px] border border-rule px-2.5 py-1.5 text-center text-ink-muted sm:px-3">关闭 {closedSuggestions.length}</span>
            )}
          </div>
        </div>

        {freshSuggestions.length > 0 ? (
          <div className="mt-3 hidden flex-wrap gap-2 sm:flex">
            {Object.entries(levelCounts).map(([level, count]) => (
              <span key={level} className="rounded-[5px] border border-rule bg-[#fafafa] px-2.5 py-1 font-mono text-[11px] text-ink-muted">
                {signalLevelLabel[level as keyof typeof signalLevelLabel]} {count}
              </span>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-[7px] border border-dashed border-rule bg-[#fafafa] px-3 py-3 text-[12px] text-ink-muted">
            暂无新的首次触发信号；已触发标的继续在下方跟踪价格和信号后涨跌。
          </div>
        )}

        <div className="mt-3 grid grid-cols-3 gap-2 md:hidden">
          <CompactLifecycleMetric label="跟踪" value={String(lifecycleSummary.tracking)} tone={lifecycleSummary.avgTrackingReturn >= 0 ? "good" : "bad"} />
          <CompactLifecycleMetric label="关闭" value={String(lifecycleSummary.closed)} />
          <CompactLifecycleMetric label="共振" value={String(confluenceRows.length)} tone={confluenceRows.length > 0 ? "good" : undefined} />
        </div>

        <div className="mt-4 hidden gap-2 md:grid md:grid-cols-2 2xl:grid-cols-5">
          <LifecycleMetric label="新触发" value={String(lifecycleSummary.fresh)} note="首次推荐，占用交易决策位" />
          <LifecycleMetric
            label="跟踪中"
            value={String(lifecycleSummary.tracking)}
            note={`均值 ${formatSigned(lifecycleSummary.avgTrackingReturn)} · 待行情 ${lifecycleSummary.pendingQuotes}`}
            tone={lifecycleSummary.avgTrackingReturn >= 0 ? "good" : "bad"}
          />
          <LifecycleMetric
            label="已关闭"
            value={String(lifecycleSummary.closed)}
            note={`止盈 ${lifecycleSummary.targetHit} / 失效 ${lifecycleSummary.stopped} / 到期 ${lifecycleSummary.expired}`}
          />
          <LifecycleMetric label="候选池" value={String(lifecycleSummary.candidate)} note="非交易时段或未达正式触发" />
          <LifecycleMetric
            label="策略共振"
            value={String(confluenceRows.length)}
            note={confluenceRows[0] ? `${confluenceRows[0].name} · ${confluenceRows[0].strategyCount} 策略` : "暂无多策略交集"}
            tone={confluenceRows.length > 0 ? "good" : undefined}
          />
        </div>

        {confluenceRows.length > 0 && (
          <section className="mt-4 rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-normal text-ink-faint">strategy confluence</p>
                <h3 className="mt-1 text-[14px] font-semibold text-ink">多策略共同推荐</h3>
                <p className="mt-1 hidden text-[12px] leading-5 text-ink-muted sm:block">同一标的被多个上线策略同时命中，优先级高于单策略候选。</p>
              </div>
              <span className="rounded-[6px] border border-rule bg-white px-2.5 py-1 font-mono text-[11px] text-ink-muted">
                {confluenceRows.length} 个交集
              </span>
            </div>
            <div className="-mx-3 mt-3 flex gap-2 overflow-x-auto px-3 md:mx-0 md:grid md:grid-cols-2 md:px-0 2xl:grid-cols-3">
              {confluenceRows.map((row) => (
                <div key={row.ticker} className="min-w-[240px] rounded-[7px] border border-rule bg-white px-3 py-3 md:min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-ink">
                        {row.name} <span className="font-mono text-[12px]">{row.ticker}</span>
                      </div>
                      <div className="mt-1 truncate text-[11px] text-ink-muted">{row.strategyNames.join(" / ")}</div>
                    </div>
                    <div className="shrink-0 text-right font-mono text-[12px]">
                      <div className="text-bull">{row.strategyCount} 策略</div>
                      <div className={row.returnPct >= 0 ? "text-bull" : "text-bear"}>{formatSigned(row.returnPct)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="-mx-3 mt-3 flex gap-2 overflow-x-auto border-y border-rule bg-[#f7f7f6]/95 px-3 py-2 md:hidden">
        {GROUPS.map((group) => {
          const count = freshSuggestions.filter((signal) => group.levels.includes(signal.signalLevel)).length
          return (
            <a
              key={group.id}
              href={`#radar-${group.id}`}
              className="shrink-0 rounded-[6px] border border-rule bg-white px-3 py-1.5 text-[12px] text-ink"
            >
              {group.title} <span className="font-mono text-[11px] text-ink-muted">{count}</span>
            </a>
          )
        })}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2 xl:items-start 2xl:grid-cols-3">
        {GROUPS.map((group) => {
          const groupSignals = freshSuggestions
            .map((signal, index) => ({ signal, index }))
            .filter(({ signal }) => group.levels.includes(signal.signalLevel))
          return (
            <section id={`radar-${group.id}`} key={group.title} className="min-w-0 scroll-mt-16 rounded-[7px] border border-rule bg-white p-2 sm:p-3">
              <div className="flex items-start justify-between gap-3 border-b border-rule-soft pb-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-[5px] px-2 py-0.5 text-[11px] font-medium ${group.tone}`}>
                      {group.title}
                    </span>
                    <span className="font-mono text-[11px] text-ink-muted">{groupSignals.length}</span>
                  </div>
                  <p className="mt-1 text-[12px] leading-5 text-ink-muted">{group.subtitle}</p>
                </div>
              </div>

              <div className="mt-3 space-y-2 md:space-y-3">
                {groupSignals.length > 0 ? (
                  groupSignals.map(({ signal, index }) => (
                    <SignalCard key={signalRenderKey(signal, index)} signal={signal} index={index} />
                  ))
                ) : (
                  <div className="rounded-[7px] border border-dashed border-rule bg-[#fafafa] px-3 py-5 text-center text-[12px] text-ink-muted md:py-8">
                    暂无此类信号
                  </div>
                )}
              </div>
            </section>
          )
        })}
      </div>

      {candidateSuggestions.length > 0 && (
        <section className="mt-4 rounded-[7px] border border-rule bg-white p-3">
          <div className="flex items-start justify-between gap-3 border-b border-rule-soft pb-3">
            <div>
              <span className="rounded-[5px] bg-[#f5f5f4] px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                候选中
              </span>
              <p className="mt-1 text-[12px] leading-5 text-ink-muted">非交易时段只显示候选机会，不写入信号账本；等开盘后用真实盘口重新确认。</p>
            </div>
            <span className="font-mono text-[11px] text-ink-muted">{candidateSuggestions.length}</span>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
            {candidateSuggestions.map((signal, index) => (
              <CandidateRow key={signalRenderKey(signal, index)} signal={signal} />
            ))}
          </div>
        </section>
      )}

      {trackingSuggestions.length > 0 && (
        <section className="mt-4 rounded-[7px] border border-rule bg-white p-3">
          <div className="flex items-start justify-between gap-3 border-b border-rule-soft pb-3">
            <div>
              <span className="rounded-[5px] bg-[#f5f5f4] px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                已触发跟踪
              </span>
              <p className="mt-1 text-[12px] leading-5 text-ink-muted">这些信号已出现过，本次只更新现价和触发后涨跌，不作为新推荐重复展示。</p>
            </div>
            <span className="font-mono text-[11px] text-ink-muted">{trackingSuggestions.length}</span>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
            {trackingSuggestions.map((signal, index) => (
              <TrackingRow key={signalRenderKey(signal, index)} signal={signal} />
            ))}
          </div>
        </section>
      )}

      {closedSuggestions.length > 0 && (
        <section className="mt-4 rounded-[7px] border border-rule bg-white p-3">
          <div className="flex items-start justify-between gap-3 border-b border-rule-soft pb-3">
            <div>
              <span className="rounded-[5px] bg-[#fff2ea] px-2 py-0.5 text-[11px] font-medium text-warning">
                今日关闭
              </span>
              <p className="mt-1 text-[12px] leading-5 text-ink-muted">达到目标、触发风控线或超过跟踪窗口的信号会在这里留账，后续进入历史复盘。</p>
            </div>
            <span className="font-mono text-[11px] text-ink-muted">{closedSuggestions.length}</span>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
            {closedSuggestions.map((signal, index) => (
              <ClosedRow key={signalRenderKey(signal, index)} signal={signal} />
            ))}
          </div>
        </section>
      )}
    </section>
  )
}

function signalRenderKey(signal: StockSignal, index: number) {
  return [
    signal.signalId ?? signal.ticker,
    signal.strategyId ?? "strategy",
    signal.signalLifecycle ?? "new",
    signal.signalLevel,
    index,
  ].join(":")
}

function RadarLoadingState() {
  return (
    <section>
      <div className="rounded-[7px] border border-rule bg-white px-3 py-3 md:px-5 md:py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <SectionLabel>实时信号</SectionLabel>
            <p className="mt-2 hidden text-[13px] leading-6 text-ink-muted sm:block">
              正在读取策略注册表、Qveris 行情、信号账本和多策略交集。结果回来前不再显示 0，避免把加载态误判为空信号。
            </p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-[6px] border border-rule bg-[#fafafa] px-3 py-1.5 font-mono text-[11px] text-ink-muted">
            <RefreshCw className="size-3 animate-spin" aria-hidden />
            live fetch
          </span>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 md:hidden">
          {["新触发", "跟踪", "共振"].map((label) => (
            <div key={label} className="rounded-[7px] border border-rule-soft bg-[#fafafa] px-2 py-2">
              <p className="font-mono text-[10px] text-ink-faint">{label}</p>
              <div className="mt-2 h-5 w-10 animate-pulse rounded bg-[#e8e8e5]" />
            </div>
          ))}
        </div>

        <div className="mt-4 hidden gap-2 md:grid md:grid-cols-2 2xl:grid-cols-5">
          {["新触发", "跟踪中", "已关闭", "候选池", "策略共振"].map((label) => (
            <div key={label} className="rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-3">
              <p className="font-mono text-[10px] uppercase text-ink-faint">{label}</p>
              <div className="mt-3 h-6 w-16 animate-pulse rounded bg-[#e8e8e5]" />
              <div className="mt-3 h-3 w-28 animate-pulse rounded bg-[#ededeb]" />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:gap-4 xl:grid-cols-2 xl:items-start 2xl:grid-cols-3">
        {GROUPS.map((group) => (
          <section key={group.title} className="min-w-0 rounded-[7px] border border-rule bg-white p-2 sm:p-3">
            <div className="flex items-start justify-between gap-3 border-b border-rule-soft pb-3">
              <div>
                <span className={`rounded-[5px] px-2 py-0.5 text-[11px] font-medium ${group.tone}`}>
                  {group.title}
                </span>
                <p className="mt-2 text-[12px] text-ink-muted">{group.subtitle}</p>
              </div>
            </div>
            <div className="mt-3 space-y-2 md:space-y-3">
              {[0, 1].map((item) => (
                <div key={item} className={`rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-3 ${item === 1 ? "hidden md:block" : ""}`}>
                  <div className="h-4 w-32 animate-pulse rounded bg-[#e5e5e1]" />
                  <div className="mt-3 h-3 w-full animate-pulse rounded bg-[#ededeb]" />
                  <div className="mt-2 h-3 w-3/4 animate-pulse rounded bg-[#ededeb]" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  )
}

function RadarErrorState({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <section className="rounded-[7px] border border-[#ead9b8] bg-[#fff8e9] px-4 py-5 md:px-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <WifiOff className="size-4 text-warning" aria-hidden />
            <SectionLabel>实时信号</SectionLabel>
          </div>
          <h2 className="mt-3 text-[18px] font-semibold text-ink">雷达这次没有连上实时结果</h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-ink-muted">
            后端没有返回完整雷达报告，页面没有把兜底空壳当作真实空信号。错误信息：{error}
          </p>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-[7px] bg-ink px-3 text-[12px] font-medium text-white"
          >
            重新读取
          </button>
        )}
      </div>
    </section>
  )
}

function TrackingRow({ signal }: { signal: StockSignal }) {
  const ret = signal.returnSinceSignalPct ?? 0
  const color = ret >= 0 ? "text-bull" : "text-bear"
  const action = trackingAction(signal)
  const holdDays = signal.firstTriggeredAt ? holdingDays(signal.firstTriggeredAt, signal.latestQuoteAt) : 0
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink">
            {signal.name} <span className="font-mono text-[12px]">{signal.ticker}</span>
          </div>
          <div className="mt-1 truncate text-[12px] text-ink-muted">{signalKindLabelSafe(signal.signalLevel)}</div>
          <div className={`mt-2 inline-flex rounded-[5px] border px-2 py-1 text-[11px] ${action.className}`}>
            执行判断：{action.label}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[10px] text-ink-muted">
            <span className="rounded-[5px] border border-rule bg-white px-2 py-0.5">触发 {formatMaybePrice(signal.triggerPrice ?? signal.price)}</span>
            <span className="rounded-[5px] border border-rule bg-white px-2 py-0.5">MFE {formatSigned(signal.mfePct ?? ret)}</span>
            <span className="rounded-[5px] border border-rule bg-white px-2 py-0.5">MAE {formatSigned(signal.maePct ?? ret)}</span>
            <span className="rounded-[5px] border border-rule bg-white px-2 py-0.5">{holdDays} 天</span>
          </div>
          <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-ink-muted">{action.reason}</div>
        </div>
        <div className="shrink-0 text-right font-mono text-[12px]">
          <div className="text-ink">{signal.price.toFixed(2)}</div>
          <div className={color}>{ret >= 0 ? "+" : ""}{ret.toFixed(2)}%</div>
        </div>
      </div>
    </div>
  )
}

function signalKindLabelSafe(level: SignalLevel) {
  return `${signalLevelLabel[level]} · 跟踪中`
}

function CandidateRow({ signal }: { signal: StockSignal }) {
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink">
            {signal.name} <span className="font-mono text-[12px]">{signal.ticker}</span>
          </div>
          <div className="mt-1 truncate text-[12px] text-ink-muted">{signalLevelLabel[signal.signalLevel]} · 等待触发</div>
          <div className="mt-2 line-clamp-2 text-[11px] leading-5 text-ink-muted">
            {signal.lifecycleNote ?? "候选机会不会重复写入推荐历史，交易时段重新确认后才触发。"}
          </div>
        </div>
        <div className="shrink-0 text-right font-mono text-[12px]">
          <div className="text-ink">{signal.price.toFixed(2)}</div>
          <div className="text-ink-faint">candidate</div>
        </div>
      </div>
    </div>
  )
}

function trackingAction(signal: StockSignal) {
  const trigger = signal.triggerPrice ?? signal.price
  const ret = signal.returnSinceSignalPct ?? (trigger > 0 ? (signal.price / trigger - 1) * 100 : 0)
  const target = trigger * (1 + signal.upsidePct / 100)
  const distanceToTargetPct = signal.price > 0 ? (target / signal.price - 1) * 100 : 0
  const stop = signal.invalidation?.price ?? signal.stopLoss.price
  const distanceToStopPct = stop > 0 ? (signal.price / stop - 1) * 100 : 0

  if (ret > Math.min(2.5, Math.max(0.8, signal.upsidePct * 0.35)) || distanceToTargetPct < 1.5) {
    return {
      label: "等回踩，不追高",
      reason: `信号后 ${ret >= 0 ? "+" : ""}${ret.toFixed(2)}%，剩余目标空间约 ${Math.max(0, distanceToTargetPct).toFixed(2)}%。`,
      className: "border-[#ead9b8] bg-[#fff8e9] text-warning",
    }
  }
  if (ret < -1.5 || distanceToStopPct < 1.2) {
    return {
      label: "只跟踪，不加仓",
      reason: `价格低于触发价，距失效价缓冲约 ${Math.max(0, distanceToStopPct).toFixed(2)}%。`,
      className: "border-[#f1d5d5] bg-[#fff6f4] text-bear",
    }
  }
  return {
    label: "可继续跟踪",
    reason: `仍在计划区间内，触发价 ${trigger.toFixed(2)}，未破坏原始信号。`,
    className: "border-[#cfe6d8] bg-[#eef8f2] text-health-ok",
  }
}

function ClosedRow({ signal }: { signal: StockSignal }) {
  const ret = signal.returnSinceSignalPct ?? 0
  const color = ret >= 0 ? "text-bull" : "text-bear"
  const statusLabel = signal.lifecycleStatus === "target-hit"
    ? "达标关闭"
    : signal.lifecycleStatus === "stopped"
      ? ret > 0.05
        ? "风控关闭"
        : ret < -0.05
          ? "止损关闭"
          : "平价关闭"
      : "超时关闭"
  const holdDays = signal.firstTriggeredAt ? holdingDays(signal.firstTriggeredAt, signal.closedAt ?? signal.latestQuoteAt) : 0
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink">
            {signal.name} <span className="font-mono text-[12px]">{signal.ticker}</span>
          </div>
          <div className="mt-1 truncate text-[12px] text-ink-muted">{statusLabel}</div>
          <div className="mt-1 font-mono text-[11px] text-ink-faint">持仓 {holdDays} 天 · MAE {(signal.maePct ?? ret).toFixed(2)}%</div>
          {signal.closeReason && <div className="mt-1 truncate text-[11px] text-ink-faint">{signal.closeReason}</div>}
        </div>
        <div className="shrink-0 text-right font-mono text-[12px]">
          <div className={color}>{ret >= 0 ? "+" : ""}{ret.toFixed(2)}%</div>
          <div className="text-ink-faint">MFE {(signal.mfePct ?? ret).toFixed(2)}%</div>
        </div>
      </div>
    </div>
  )
}

function LifecycleMetric({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: string
  note: string
  tone?: "good" | "bad"
}) {
  const valueClass = tone === "good" ? "text-bull" : tone === "bad" ? "text-bear" : "text-ink"
  return (
    <div className="rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-3">
      <p className="font-mono text-[10px] uppercase text-ink-faint">{label}</p>
      <p className={`mt-2 font-mono text-[22px] leading-none tabular ${valueClass}`}>{value}</p>
      <p className="mt-2 text-[11px] leading-5 text-ink-muted">{note}</p>
    </div>
  )
}

function CompactLifecycleMetric({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: "good" | "bad"
}) {
  const valueClass = tone === "good" ? "text-bull" : tone === "bad" ? "text-bear" : "text-ink"
  return (
    <div className="rounded-[7px] border border-rule-soft bg-[#fafafa] px-2 py-2">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className={`mt-1 font-mono text-[18px] leading-none tabular ${valueClass}`}>{value}</p>
    </div>
  )
}

function buildLifecycleSummary(signals: StockSignal[]) {
  const tracking = signals.filter((signal) => signal.signalLifecycle === "tracking")
  const closed = signals.filter((signal) => signal.signalLifecycle === "closed")
  const measuredTracking = tracking.filter((signal) => signal.priceStatus !== "pending-follow-up")
  const avgTrackingReturn = measuredTracking.length
    ? measuredTracking.reduce((sum, signal) => sum + (signal.returnSinceSignalPct ?? 0), 0) / measuredTracking.length
    : 0
  return {
    fresh: signals.filter((signal) => signal.signalLifecycle === "new" || !signal.signalLifecycle).length,
    tracking: tracking.length,
    closed: closed.length,
    candidate: signals.filter((signal) => signal.signalLifecycle === "candidate").length,
    pendingQuotes: signals.filter((signal) => signal.priceStatus === "pending-follow-up").length,
    targetHit: closed.filter((signal) => signal.lifecycleStatus === "target-hit").length,
    stopped: closed.filter((signal) => signal.lifecycleStatus === "stopped").length,
    expired: closed.filter((signal) => signal.lifecycleStatus === "expired").length,
    avgTrackingReturn,
  }
}

function holdingDays(startIso: string, endIso?: string) {
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0
  return Math.max(0, Math.ceil((end - start) / 86_400_000))
}

function formatSigned(value: number) {
  if (Math.abs(value) < 0.005) return "0.00%"
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
}

function formatMaybePrice(value: number) {
  if (value >= 1000) return value.toFixed(0)
  if (value >= 100) return value.toFixed(2)
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")
}
