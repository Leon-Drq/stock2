import Link from "next/link"
import { ArrowUpRight, Clock3, ShieldAlert, TrendingUp } from "lucide-react"
import type { StockSignal } from "@/lib/radar-data"
import { signalKindLabel, signalLevelColor, signalLevelLabel } from "@/lib/radar-data"
import { CHINA_TIME_LABEL, formatPercent, formatPrice } from "@/lib/format"

type SignalCardProps = {
  signal: StockSignal
  index: number
}

export function SignalCard({ signal, index }: SignalCardProps) {
  const isBull = signal.changePct >= 0
  const trendColor = isBull ? "text-bull" : "text-bear"
  const sign = isBull ? "+" : ""
  const returnSinceSignal = signal.returnSinceSignalPct ?? 0
  const signalReturnColor = returnSinceSignal >= 0 ? "text-bull" : "text-bear"
  const signalReturnText = formatSignalReturn(returnSinceSignal)
  const levelColor = signalLevelColor[signal.signalLevel]
  const invalidationReason = signal.invalidation?.reason ?? `跌破 ${formatPrice(signal.stopLoss.price)} 视为信号失效`
  const isPendingQuote = signal.priceStatus === "pending-follow-up"
  const stageLabel = lifecycleStageLabel(signal)
  const planBasePrice = signal.triggerPrice ?? signal.price
  const targetPrice = planBasePrice * (1 + signal.upsidePct / 100)
  const entryLow = planBasePrice * 0.995
  const entryHigh = planBasePrice * 1.005
  const tierOne = planBasePrice * (1 + signal.upsidePct * 0.34 / 100)
  const tierTwo = planBasePrice * (1 + signal.upsidePct * 0.67 / 100)
  const holdDays = signal.firstTriggeredAt
    ? holdingDays(signal.firstTriggeredAt, signal.closedAt ?? signal.latestQuoteAt)
    : null
  const priceSource = signal.priceSource === "qveris-realtime"
    ? `近实时 · ${signal.quoteTime ?? "最新快照"}`
    : signal.priceSource === "qveris-daily"
      ? "日线收盘"
      : "演示价格"
  const execution = executionView(signal)
  const actionLabel =
    signal.signalLifecycle === "candidate" || signal.signalKind === "watch" || signal.signalLevel === "compass"
      ? "观察等待"
      : signal.signalLevel === "green"
        ? "立即买入"
        : "建议买入"
  const supportItems = [
    `来源策略：${signal.strategyName ?? "注册表策略雷达"}${signal.strategyBacktest ? ` · Sharpe ${signal.strategyBacktest.sharpe.toFixed(2)}` : ""}`,
    ...(signal.intradayPattern ? [`盘中结构：${signal.intradayPattern}`] : []),
    `${signal.reason}`,
    `胜率 ${signal.winRatePct}% · 赔率 ${signal.oddsRatio.toFixed(1)}:1`,
    `上涨空间 ${signal.upsidePct.toFixed(1)}%`,
  ]
  const riskItems = [
    `止损距离 ${signal.stopLoss.riskPct.toFixed(1)}%`,
    invalidationReason,
    "仅作研究参考，需结合盘中流动性确认",
  ]

  return (
    <>
      <article className="overflow-hidden rounded-[7px] border border-rule bg-white shadow-[0_1px_0_rgba(0,0,0,0.02)] md:hidden">
        <div className="border-b border-rule px-3 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[10px] text-ink-faint">#{String(index + 1).padStart(2, "0")}</span>
                <span className="size-2 rounded-full" style={{ backgroundColor: levelColor }} aria-hidden />
                <span className="font-mono text-[10px] text-ink-muted">{signalLevelLabel[signal.signalLevel]}</span>
                <span className="rounded-[5px] bg-[#f5f5f4] px-1.5 py-0.5 text-[10px] text-ink-muted">
                  {signalKindLabel[signal.signalKind]}
                </span>
              </div>
              <Link href={`/stock/${signal.ticker}`} className="mt-2 block truncate text-[18px] font-semibold leading-tight text-ink">
                {signal.name} <span className="font-mono text-[13px]">{signal.ticker}</span>
              </Link>
              <p className="mt-1 line-clamp-1 text-[12px] text-ink-muted">{signal.suggestion}</p>
            </div>
            <div className="shrink-0 text-right font-mono">
              <div className="text-[18px] leading-tight text-ink tabular">{formatPrice(signal.price)}</div>
              <div className={`mt-1 text-[11px] tabular ${trendColor}`}>
                {sign}
                {formatPercent(signal.changePct)}
              </div>
            </div>
          </div>
        </div>

        <div className="border-b border-rule-soft bg-[#e9f5ed] px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-[13px] font-semibold text-health-ok">{actionLabel}</span>
            <span className={`shrink-0 font-mono text-[11px] ${signalReturnColor}`}>
              信号后 {isPendingQuote ? "待新行情" : signalReturnText}
            </span>
          </div>
        </div>

        <div className="px-3 py-3">
          <div className="grid grid-cols-2 gap-1.5">
            <MobileMetric label="推荐" value={formatSignalTime(signal.recommendedAt, signal.date, signal.quoteTime)} sub={CHINA_TIME_LABEL} />
            <MobileMetric label="触发" value={formatPrice(signal.triggerPrice ?? signal.price)} />
            <MobileMetric label="止损" value={formatPrice(signal.stopLoss.price)} sub={`-${signal.stopLoss.riskPct.toFixed(1)}%`} tone="bad" />
            <MobileMetric label="目标" value={formatPrice(targetPrice)} sub={`+${signal.upsidePct.toFixed(1)}%`} tone="good" />
            <MobileMetric label="胜率" value={`${signal.winRatePct}%`} sub={`赔率 ${signal.oddsRatio.toFixed(1)}:1`} tone="good" />
            <MobileMetric label="状态" value={stageLabel} sub={holdDays == null ? undefined : `${holdDays} 天`} />
          </div>

          <p className="mt-3 line-clamp-2 text-[12px] leading-5 text-ink-muted">{signal.reason}</p>

          <details className="mt-3 rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2">
            <summary className="cursor-pointer text-[12px] font-semibold text-ink">执行计划与依据</summary>
            <div className="mt-3 space-y-3 border-t border-rule-soft pt-3">
              <div className="rounded-[7px] border border-rule bg-white px-3 py-2">
                <p className={`text-[12px] font-semibold ${execution.tone === "good" ? "text-health-ok" : execution.tone === "bad" ? "text-bear" : execution.tone === "warn" ? "text-warning" : "text-ink"}`}>
                  {execution.title}
                </p>
                <p className="mt-1 text-[12px] leading-5 text-ink-muted">{execution.reason}</p>
              </div>
              {signal.evidence && signal.evidence.length > 0 && (
                <div className="grid gap-1.5">
                  {signal.evidence.slice(0, 3).map((item) => (
                    <div key={`${item.label}-${item.value}`} className="flex items-center justify-between gap-3 rounded-[6px] border border-rule-soft bg-white px-2.5 py-2">
                      <span className="text-[11px] text-ink-muted">{item.label}</span>
                      <span className={`font-mono text-[12px] tabular ${evidenceToneClass(item.tone)}`}>{item.value}</span>
                    </div>
                  ))}
                </div>
              )}
              <InfoBlock icon={ArrowUpRight} title="支持依据" items={supportItems.slice(0, 3)} />
              <InfoBlock icon={ShieldAlert} title="风险提示" items={riskItems} warn />
              <Link href={`/stock/${signal.ticker}`} className="inline-flex h-9 w-full items-center justify-center gap-1 rounded-[7px] bg-ink px-3 text-[12px] text-white">
                查看 K 线 <ArrowUpRight className="size-3" aria-hidden />
              </Link>
            </div>
          </details>
        </div>
      </article>

      <article className="hidden overflow-hidden rounded-[7px] border border-rule bg-white shadow-[0_1px_0_rgba(0,0,0,0.02)] md:block">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-3 py-2.5 md:px-5 md:py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] text-ink-faint">#{String(index + 1).padStart(2, "0")}</span>
          <span className="size-2 rounded-full" style={{ backgroundColor: levelColor }} aria-hidden />
          <span className="font-mono text-[11px] text-ink-muted">{signalLevelLabel[signal.signalLevel]}</span>
          <span className="rounded-[5px] bg-[#f5f5f4] px-2 py-0.5 text-[11px] text-ink-muted">
            {signalKindLabel[signal.signalKind]}
          </span>
          {signal.strategyName && (
            <span className="rounded-[5px] border border-rule bg-white px-2 py-0.5 font-mono text-[10px] text-ink-muted">
              {signal.strategyName}
            </span>
          )}
          {signal.intradayPattern && (
            <span className="rounded-[5px] border border-[#cfe6d8] bg-[#eef8f2] px-2 py-0.5 text-[10px] text-health-ok">
              {signal.intradayPattern}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-ink-muted">
          <span className="text-health-ok">胜率 {signal.winRatePct}%</span>
          <span className="text-ink-faint">/</span>
          <span>赔率 {signal.oddsRatio.toFixed(1)}:1</span>
          <span className="text-ink-faint">/</span>
          <span className={signalReturnColor}>
            信号后 {isPendingQuote ? "待新行情" : signalReturnText}
          </span>
        </div>
      </div>

      <div className="border-b border-rule-soft bg-[#e9f5ed] px-3 py-2.5 md:px-5 md:py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-health-ok">
                {actionLabel}
              </span>
              <span className="rounded-[5px] bg-white/70 px-2 py-0.5 font-mono text-[10px] text-health-ok">
                置信度 {signal.winRatePct.toFixed(3)}%
              </span>
            </div>
          </div>
          <span className="font-mono text-[12px] text-health-ok">
            预期盈亏比 1 : {signal.oddsRatio.toFixed(1)}
          </span>
        </div>
      </div>

      <div className="px-3 py-3 md:px-5 md:py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={`/stock/${signal.ticker}`} className="break-words text-[18px] font-semibold leading-tight text-ink hover:underline md:text-[20px]">
              {signal.name}
              <span className="ml-1 font-mono text-[15px] font-semibold md:text-[17px]">{signal.ticker}</span>
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-muted">
              {signal.exchange && <span className="font-mono">{signal.exchange}</span>}
              <span>{signal.suggestion}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 font-mono text-[11px] text-ink-muted">
              <span className="rounded-[5px] border border-rule bg-[#fafafa] px-2 py-1">
                推荐 {CHINA_TIME_LABEL} {formatSignalTime(signal.recommendedAt, signal.date, signal.quoteTime)}
              </span>
              <span className="rounded-[5px] border border-rule bg-[#fafafa] px-2 py-1">
                触发价 {formatPrice(signal.triggerPrice ?? signal.price)}
              </span>
              <span className={`rounded-[5px] border border-rule bg-[#fafafa] px-2 py-1 ${signalReturnColor}`}>
                当前距触发 {isPendingQuote ? "待新行情" : signalReturnText}
              </span>
              <span className="rounded-[5px] border border-rule bg-[#fafafa] px-2 py-1">
                状态 {stageLabel}
              </span>
              {signal.strategyStatus && (
                <span className="rounded-[5px] border border-rule bg-[#fafafa] px-2 py-1">
                  {signal.strategyStatus} · v{signal.strategyVersion}
                </span>
              )}
              {signal.lifecycleNote && (
                <span className="rounded-[5px] border border-rule bg-[#fafafa] px-2 py-1 text-ink-muted">
                  {signal.lifecycleNote}
                </span>
              )}
            </div>
          </div>

          <div className="shrink-0 text-right">
            <div className="font-mono text-[18px] leading-tight text-ink tabular md:text-[20px]">{formatPrice(signal.price)}</div>
            <div className={`mt-1 font-mono text-[12px] tabular ${trendColor}`}>
              {sign}
              {formatPercent(signal.changePct)} · 24h
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-[7px] bg-[#fafafa] px-3 py-3 md:mt-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            <TrendingUp className="size-4" aria-hidden />
            <span>{signal.name} {signal.intradayPattern ?? signalKindLabel[signal.signalKind]} · {signal.winRatePct}% 胜率</span>
          </div>
          <p className="mt-2 text-[13px] leading-6 text-ink-muted">{signal.reason}</p>
          {signal.evidence && signal.evidence.length > 0 && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
              {signal.evidence.map((item) => (
                <div key={`${item.label}-${item.value}`} className="flex items-center justify-between gap-3 rounded-[6px] border border-rule-soft bg-white px-2.5 py-2">
                  <span className="text-[11px] text-ink-muted">{item.label}</span>
                  <span className={`font-mono text-[12px] tabular ${evidenceToneClass(item.tone)}`}>{item.value}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 grid gap-2 md:grid-cols-[1.1fr_1fr_1fr]">
            <ExecutionCell label="执行判断" value={execution.title} tone={execution.tone} sub={execution.reason} />
            <ExecutionCell label="追高风险" value={execution.chaseRisk} tone={execution.chaseTone} sub={execution.chaseReason} />
            <ExecutionCell label="下一步" value={execution.nextAction} tone="neutral" sub={execution.nextReason} />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 md:mt-4 md:grid-cols-3">
          <PlanCell label="入场区间" value={`${formatPrice(entryLow)} - ${formatPrice(entryHigh)}`} />
          <PlanCell label="触发价" value={formatPrice(signal.triggerPrice ?? signal.price)} sub={`当前距触发 ${isPendingQuote ? "待新行情" : signalReturnText}`} success={!isPendingQuote && returnSinceSignal >= 0} danger={!isPendingQuote && returnSinceSignal < 0} />
          <PlanCell label="当前价" value={formatPrice(signal.price)} sub={holdDays == null ? undefined : `已跟踪 ${holdDays} 天`} />
          <PlanCell label="最高浮盈 / 最大不利" value={`${formatSigned(signal.mfePct ?? returnSinceSignal)} / ${formatSigned(signal.maePct ?? returnSinceSignal)}`} />
          <PlanCell label={signal.invalidation ? "失效价" : "止损价"} value={formatPrice(signal.stopLoss.price)} sub={`-${signal.stopLoss.riskPct.toFixed(1)}%`} danger />
          <PlanCell label="目标位" value={formatPrice(targetPrice)} sub={`+${signal.upsidePct.toFixed(1)}%`} success />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <TargetPill label="T1" value={tierOne} pct={signal.upsidePct * 0.34} />
          <TargetPill label="T2" value={tierTwo} pct={signal.upsidePct * 0.67} />
          <TargetPill label="T3" value={targetPrice} pct={signal.upsidePct} />
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-ink-muted sm:ml-auto">
            <Clock3 className="size-3.5" aria-hidden />
            持仓 1-5 天
          </span>
        </div>

        <details className="mt-3 rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 md:hidden">
          <summary className="cursor-pointer text-[12px] font-semibold text-ink">
            展开依据与风险
          </summary>
          <div className="mt-3 grid gap-4 border-t border-rule-soft pt-3">
            <InfoBlock icon={ArrowUpRight} title="支持依据" items={supportItems} />
            <InfoBlock icon={ShieldAlert} title="风险提示" items={riskItems} warn />
            <Link href={`/stock/${signal.ticker}`} className="inline-flex h-9 items-center justify-center gap-1 rounded-[7px] bg-ink px-3 text-[12px] text-white">
              查看 K 线 <ArrowUpRight className="size-3" aria-hidden />
            </Link>
          </div>
        </details>

        <div className="mt-4 hidden gap-4 border-t border-rule-soft pt-4 md:grid 2xl:grid-cols-2">
          <InfoBlock
            icon={ArrowUpRight}
            title="支持依据"
            items={supportItems}
          />
          <InfoBlock
            icon={ShieldAlert}
            title="风险提示"
            items={riskItems}
            warn
          />
        </div>

        <div className="mt-4 hidden flex-wrap items-center gap-2 border-t border-rule-soft pt-3 font-mono text-[11px] text-ink-muted md:flex">
          <span>{priceSource}</span>
          <span className="text-ink-faint">·</span>
          <span>推荐 {CHINA_TIME_LABEL} {formatSignalTime(signal.recommendedAt, signal.date, signal.quoteTime)}</span>
          {signal.latestQuoteAt && (
            <>
              <span className="text-ink-faint">·</span>
              <span>行情 {CHINA_TIME_LABEL} {formatSignalTime(signal.latestQuoteAt)}</span>
            </>
          )}
          {signal.strategyBacktest && (
            <>
              <span className="text-ink-faint">·</span>
              <span>
                回测 年化 {signal.strategyBacktest.annualReturn.toFixed(1)}% / 回撤 {signal.strategyBacktest.maxDrawdown.toFixed(1)}%
              </span>
            </>
          )}
          <Link href={`/stock/${signal.ticker}`} className="inline-flex items-center gap-1 text-ink hover:underline sm:ml-auto">
            查看 K 线 <ArrowUpRight className="size-3" aria-hidden />
          </Link>
        </div>
      </div>
    </article>
    </>
  )
}

function formatSignalTime(recommendedAt?: string, date?: string, quoteTime?: string) {
  if (recommendedAt) {
    const d = new Date(recommendedAt)
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    }
  }
  return [date, quoteTime].filter(Boolean).join(" ") || "待确认"
}

function lifecycleStageLabel(signal: StockSignal) {
  if (signal.lifecycleStage === "candidate") return "候选中"
  if (signal.priceStatus === "pending-follow-up" && signal.lifecycleStatus === "open") return "已触发"
  if (signal.lifecycleStage === "triggered") return "已触发"
  if (signal.lifecycleStage === "tracking") return "跟踪中"
  if (signal.lifecycleStage === "target-hit") return "已止盈"
  if (signal.lifecycleStage === "stopped" || signal.lifecycleStage === "invalidated") return "已失效"
  if (signal.lifecycleStage === "expired") return "已过期"
  if (signal.signalLifecycle === "candidate") return "候选中"
  if (signal.signalLifecycle === "tracking") return "跟踪中"
  if (signal.signalLifecycle === "closed") return "已关闭"
  return signal.priceStatus === "pending-follow-up" ? "已触发" : "新触发"
}

function formatSignalReturn(value: number) {
  if (Math.abs(value) < 0.005) return formatPercent(0)
  return `${value >= 0 ? "+" : ""}${formatPercent(value)}`
}

function holdingDays(startIso: string, endIso?: string) {
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0
  return Math.max(0, Math.ceil((end - start) / 86_400_000))
}

function formatSigned(value: number) {
  if (Math.abs(value) < 0.005) return formatPercent(0)
  return `${value >= 0 ? "+" : ""}${formatPercent(value)}`
}

function evidenceToneClass(tone?: "good" | "warn" | "bad" | "neutral") {
  if (tone === "good") return "text-health-ok"
  if (tone === "warn") return "text-warning"
  if (tone === "bad") return "text-bear"
  return "text-ink"
}

function PlanCell({
  label,
  value,
  sub,
  danger,
  success,
}: {
  label: string
  value: string
  sub?: string
  danger?: boolean
  success?: boolean
}) {
  const color = danger ? "text-bear" : success ? "text-health-ok" : "text-ink"
  return (
    <div className="rounded-[7px] border border-rule bg-white px-3 py-3">
      <dt className="text-[11px] text-ink-muted">{label}</dt>
      <dd className={`mt-2 font-mono text-[15px] font-semibold tabular ${color}`}>{value}</dd>
      {sub && <dd className="mt-1 font-mono text-[11px] text-ink-muted">{sub}</dd>}
    </div>
  )
}

function MobileMetric({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string
  tone?: "good" | "bad"
}) {
  const color = tone === "good" ? "text-health-ok" : tone === "bad" ? "text-bear" : "text-ink"
  return (
    <div className="min-w-0 rounded-[7px] border border-rule bg-[#fafafa] px-2.5 py-2">
      <dt className="truncate text-[10px] text-ink-muted">{label}</dt>
      <dd className={`mt-1 truncate font-mono text-[12px] font-semibold tabular ${color}`}>{value}</dd>
      {sub && <dd className="mt-0.5 truncate font-mono text-[10px] text-ink-muted">{sub}</dd>}
    </div>
  )
}

function ExecutionCell({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub: string
  tone: "good" | "warn" | "bad" | "neutral"
}) {
  const toneClass =
    tone === "good"
      ? "border-[#cfe6d8] bg-[#eef8f2] text-health-ok"
      : tone === "warn"
        ? "border-[#ead9b8] bg-[#fff8e9] text-warning"
        : tone === "bad"
          ? "border-[#f1d5d5] bg-[#fff6f4] text-bear"
          : "border-rule bg-white text-ink"
  return (
    <div className={`rounded-[7px] border px-3 py-3 ${toneClass}`}>
      <p className="text-[11px] opacity-70">{label}</p>
      <p className="mt-1 text-[13px] font-semibold">{value}</p>
      <p className="mt-1 text-[12px] leading-5 opacity-80">{sub}</p>
    </div>
  )
}

function executionView(signal: StockSignal) {
  const trigger = signal.triggerPrice ?? signal.price
  const ret = signal.returnSinceSignalPct ?? (trigger > 0 ? (signal.price / trigger - 1) * 100 : 0)
  const target = trigger * (1 + signal.upsidePct / 100)
  const stop = signal.invalidation?.price ?? signal.stopLoss.price
  const distanceToStopPct = signal.price > 0 ? ((signal.price / stop) - 1) * 100 : 0
  const distanceToTargetPct = signal.price > 0 ? ((target / signal.price) - 1) * 100 : 0
  const maxComfortRet = Math.min(2.5, Math.max(0.8, signal.upsidePct * 0.35))

  if (signal.signalLifecycle === "candidate") {
    return {
      title: "候选中，未触发",
      tone: "neutral" as const,
      reason: "当前非连续竞价时段，只保留候选判断，开盘后重新确认才写入推荐。",
      chaseRisk: "不执行",
      chaseTone: "warn" as const,
      chaseReason: "候选价格不是正式触发价。",
      nextAction: "等待开盘",
      nextReason: "用下一笔真实盘口确认量价结构。",
    }
  }

  if (signal.priceStatus === "pending-follow-up") {
    return {
      title: "等待新行情",
      tone: "neutral" as const,
      reason: "已记录触发价，但还没有触发后的下一笔真实行情，暂不计算浮盈。",
      chaseRisk: "待确认",
      chaseTone: "warn" as const,
      chaseReason: "当前价仍是触发快照。",
      nextAction: "等行情刷新",
      nextReason: "下一笔报价出现后再判断追高或回踩。",
    }
  }

  if (signal.lifecycleStatus && signal.lifecycleStatus !== "open") {
    const closedTone = signal.lifecycleStatus === "target-hit"
      ? "good" as const
      : signal.lifecycleStatus === "stopped"
        ? ret >= 0
          ? "neutral" as const
          : "bad" as const
        : "neutral" as const
    return {
      title: "信号已关闭",
      tone: closedTone,
      reason: signal.closeReason ?? signal.lifecycleNote ?? "该信号已退出跟踪窗口。",
      chaseRisk: "禁止追单",
      chaseTone: "bad" as const,
      chaseReason: "关闭后的价格不再按原计划执行。",
      nextAction: "复盘归档",
      nextReason: "看收益、MFE/MAE 和退出原因。",
    }
  }

  if (ret > maxComfortRet || distanceToTargetPct < Math.max(1.5, signal.upsidePct * 0.25)) {
    return {
      title: "等回踩确认",
      tone: "warn" as const,
      reason: `当前已较触发价 ${formatSignalReturn(ret)}，不在舒适入场区。`,
      chaseRisk: "偏高",
      chaseTone: "warn" as const,
      chaseReason: `距目标约 ${formatPercent(Math.max(0, distanceToTargetPct))}，剩余赔率变薄。`,
      nextAction: "回到触发价附近再看",
      nextReason: `优先等 ${formatPrice(trigger * 0.995)}-${formatPrice(trigger * 1.005)} 区间。`,
    }
  }

  if (ret < -1.5 || distanceToStopPct < 1.2) {
    return {
      title: "只跟踪不加仓",
      tone: "bad" as const,
      reason: `当前低于触发价 ${formatSignalReturn(ret)}，离失效价太近。`,
      chaseRisk: "低但弱",
      chaseTone: "warn" as const,
      chaseReason: "不是追高问题，而是信号强度正在减弱。",
      nextAction: "等重新站回触发价",
      nextReason: `重新站上 ${formatPrice(trigger)} 后再评估。`,
    }
  }

  if (signal.signalLifecycle === "tracking") {
    return {
      title: "可继续跟踪",
      tone: "good" as const,
      reason: `当前距触发 ${formatSignalReturn(ret)}，仍未破坏原计划。`,
      chaseRisk: "可控",
      chaseTone: "good" as const,
      chaseReason: `止损缓冲约 ${formatPercent(distanceToStopPct)}。`,
      nextAction: "按仓位上限执行",
      nextReason: `不超过 ${signal.position.max}%，跌破失效价退出。`,
    }
  }

  return {
    title: "可按计划入场",
    tone: "good" as const,
    reason: `现价仍贴近触发价 ${formatPrice(trigger)}，赔率未明显压缩。`,
    chaseRisk: "低",
    chaseTone: "good" as const,
    chaseReason: `距目标约 ${formatPercent(Math.max(0, distanceToTargetPct))}。`,
    nextAction: "分批确认",
    nextReason: `先小仓，放量或回踩不破再加。`,
  }
}

function TargetPill({ label, value, pct }: { label: string; value: number; pct: number }) {
  return (
    <span className="rounded-[5px] bg-[#e9f5ed] px-2.5 py-1 font-mono text-[11px] text-health-ok">
      {label} {formatPrice(value)} (+{pct.toFixed(1)}%)
    </span>
  )
}

function InfoBlock({
  icon: Icon,
  title,
  items,
  warn,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  title: string
  items: string[]
  warn?: boolean
}) {
  return (
    <div>
      <div className={`flex items-center gap-2 text-[12px] ${warn ? "text-warning" : "text-health-ok"}`}>
        <Icon className="size-4" aria-hidden />
        <span>{title}</span>
      </div>
      <ul className="mt-2 space-y-1.5 text-[12px] leading-5 text-ink-muted">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className={warn ? "text-warning" : "text-health-ok"}>{warn ? "!" : "+"}</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
