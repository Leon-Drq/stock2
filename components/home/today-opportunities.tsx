import Link from "next/link"
import { ArrowRight, BadgeCheck, Clock3, GitMerge, LogOut, Radar, Shield, Target, TrendingUp } from "lucide-react"
import { resolveWithFallback } from "@/lib/async-timeout"
import { fallbackReport, signalKindLabel, signalLevelColor, signalLevelLabel, type SignalLevel, type StockSignal } from "@/lib/radar-data"
import { CHINA_TIME_LABEL, formatChinaDateTime, formatPercent, formatPrice } from "@/lib/format"
import { PAPER_CONFLUENCE_STRATEGY_ID } from "@/lib/paper-confluence-constants"
import { radarExitActionLabel, radarExitPrice, radarExitReturnPct, radarExitTone, radarLifecycleStatus, recordsFromSignals, type RadarHistoryRecord } from "@/lib/radar-history"
import { loadRadarSignalHistoryRecordsForDateRange } from "@/lib/radar-signal-store"
import { excludeSignalsWithLaterExits, radarHistoryRecordToSignal, recordsToExitRecordsForTradeDate } from "@/lib/radar-ledger-signals"
import { loadPaperConfluenceSignals, loadPaperConfluenceSignalsForDateRange, PAPER_CONFLUENCE_ORDER_LIMIT, type PaperConfluenceSignal } from "@/lib/paper-confluence"
import { getChinaMarketSession, shouldRunRadarScan } from "@/lib/cn-market-session"
import { computeUnifiedSignalScore, SIGNAL_SCORE_WEIGHTS, signalRankingScore, type UnifiedSignalScore } from "@/lib/signal-score"
import { buildRadarConfluenceSignals, type RadarConfluenceSignal } from "@/lib/radar-confluence"
import { loadTodayRadarSignalView, type TodayRadarSignalView } from "@/lib/signal-ledger-view"
import { getDefaultModelRuntime } from "@/lib/model-providers"
import { StockDiagnosisPanel } from "@/components/home/stock-diagnosis-panel"

const FEATURED_BUY_SCORE_MIN = 62
const HOME_PRIMARY_TIMEOUT_MS = 5_000
const HOME_SECONDARY_TIMEOUT_MS = 3_000
const HOME_WEEKLY_TIMEOUT_MS = 3_500
const TODAY_SIGNAL_LEDGER_LIMIT = 500
const WEEKLY_SIGNAL_LEDGER_LIMIT = 1800
const WEEKLY_FEATURED_MAX = 16
const WEEKLY_FEATURED_MAX_PER_DAY = 4
const REALTIME_SIGNAL_MAX_AGE_MS = 15 * 60_000
const OPENING_PLAN_MAX = 24

type CockpitModeId =
  | "pre-open-plan"
  | "intraday-live"
  | "lunch-watch"
  | "closing-overnight"
  | "post-close-review"
  | "non-trading-review"

type CockpitModeCopy = {
  title: string
  sourceLabel: string
  sourceValue: string
  primaryLabel: string
  candidateLabel: string
  confluenceLabel: string
  actionVerb: string
  activeState: string
  emptyState: string
  emptyTitle: string
  emptyBody: string
  listTitle: string
  listSubtitle: string
  note?: string
}

type TodayOpportunity = {
  signal: StockSignal
  confluence?: RadarConfluenceSignal | PaperConfluenceSignal
  score: UnifiedSignalScore
}

type WeeklyFeaturedRecord = {
  record: RadarHistoryRecord
  score: UnifiedSignalScore
  source: "radar-confluence" | "paper-confluence" | "single"
}

type CockpitSignalCandidate =
  | {
      kind: "radar-confluence"
      ticker: string
      score: UnifiedSignalScore
      signalAt: string
      sourceRank: number
      radar: RadarConfluenceSignal
    }
  | {
      kind: "paper-confluence"
      ticker: string
      score: UnifiedSignalScore
      signalAt: string
      sourceRank: number
      paper: PaperConfluenceSignal
    }
  | {
      kind: "buy"
      ticker: string
      score: UnifiedSignalScore
      signalAt: string
      sourceRank: number
      opportunity: TodayOpportunity
    }

async function getTodayRadarReport() {
  const marketSession = getChinaMarketSession()
  const [todayView, paperConfluence, weeklyPaperConfluence, weeklySignalLedger] = await loadHomeLedgerSnapshot(
    marketSession,
  )
  const snapshotRecords = recordsFromSignals(todayView.snapshotSignals)
  const weeklyRecords = mergeHistoryRecords(weeklySignalLedger, snapshotRecords)
  return {
    ...todayLedgerResult(marketSession, todayView.signals, {
      source: todayView.source,
      fallbackReason: todayView.fallbackReason,
      dataFreshness: todayView.dataFreshness,
      snapshotStale: todayView.snapshotStale,
    }),
    paperConfluence,
    weeklyPaperConfluence,
    signalLedger: todayView.records,
    weeklySignalLedger: weeklyRecords,
  }
}

async function loadHomeLedgerSnapshot(
  marketSession: ReturnType<typeof getChinaMarketSession>,
): Promise<[TodayRadarSignalView, PaperConfluenceSignal[], PaperConfluenceSignal[], RadarHistoryRecord[]]> {
  const tradeDate = marketSession.tradeDate
  const weeklyFromDate = shiftChinaDate(tradeDate, -6)
  const [todayView, paperConfluence, weeklyPaperConfluence, weeklySignalLedger] = await Promise.all([
    loadTodayRadarSignalView({
      marketSession,
      includeTodaySignals: marketSession.isTradingDay,
      ledgerLimit: TODAY_SIGNAL_LEDGER_LIMIT,
      ledgerTimeoutMs: HOME_SECONDARY_TIMEOUT_MS,
      snapshotTimeoutMs: HOME_PRIMARY_TIMEOUT_MS,
    }),
    marketSession.isTradingDay
      ? resolveWithFallback(
          loadPaperConfluenceSignals({
            tradeDate,
            windowDays: 1,
            minStrategies: 2,
            limit: PAPER_CONFLUENCE_ORDER_LIMIT,
          }),
          {
            timeoutMs: HOME_SECONDARY_TIMEOUT_MS,
            onFallback: () => [],
          },
        )
      : Promise.resolve([]),
    resolveWithFallback(
      loadPaperConfluenceSignalsForDateRange({
        fromDate: weeklyFromDate,
        toDate: tradeDate,
        minStrategies: 2,
        limit: PAPER_CONFLUENCE_ORDER_LIMIT,
      }),
      {
        timeoutMs: HOME_WEEKLY_TIMEOUT_MS,
        onFallback: () => [],
      },
    ),
    resolveWithFallback(
      loadRadarSignalHistoryRecordsForDateRange(weeklyFromDate, tradeDate, WEEKLY_SIGNAL_LEDGER_LIMIT),
      {
        timeoutMs: HOME_WEEKLY_TIMEOUT_MS,
        onFallback: () => [],
      },
    ),
  ])

  return [todayView, paperConfluence, weeklyPaperConfluence, weeklySignalLedger]
}

function todayLedgerResult(
  marketSession: ReturnType<typeof getChinaMarketSession>,
  ledgerSignals: StockSignal[] = [],
  options: {
    source?: "qveris+ledger" | "qveris+snapshot" | "ledger"
    fallbackReason?: string
    dataFreshness?: TodayRadarSignalView["dataFreshness"]
    snapshotStale?: boolean
  } = {},
) {
  const signalCounts = ledgerSignals.reduce(
    (acc, signal) => {
      acc[signal.signalLevel] += 1
      return acc
    },
    { green: 0, yellow: 0, blue: 0, compass: 0, purple: 0, orange: 0, red: 0 } satisfies Record<SignalLevel, number>,
  )
  return {
    report: {
      ...fallbackReport,
      generatedAt: new Date().toISOString(),
      conclusion: marketSession.note,
      suggestions: ledgerSignals,
      overview: {
        ...fallbackReport.overview,
        signals: signalCounts,
        actionSignalCount: ledgerSignals.length,
      },
    },
    diagnostics: {
      source: options.source ?? (ledgerSignals.length > 0 ? "qveris+ledger" as const : "ledger" as const),
      qverisCount: 0,
      mockCount: 0,
      quoteCount: 0,
      quoteTotal: 0,
      marketSession,
      factorIRs: [],
      dataFreshness: options.dataFreshness,
      fallbackReason: options.fallbackReason ?? (ledgerSignals.length > 0
        ? undefined
        : options.snapshotStale
          ? "最近雷达快照超过实时有效窗口，首页不会用旧快照冒充今日可买信号。"
        : marketSession.isTradingDay
          ? "首页只展示已落库信号；当前账本暂无今日新买点，等待下一次雷达定时任务写入。"
          : `${marketSession.phaseLabel}：${marketSession.note}`),
    },
  }
}

function resolveCockpitMode(marketSession: ReturnType<typeof getChinaMarketSession>): CockpitModeId {
  if (!marketSession.isTradingDay) return "non-trading-review"
  if (marketSession.phase === "pre-open") return "pre-open-plan"
  if (marketSession.phase === "lunch") return "lunch-watch"
  if (marketSession.isClosingWindow) return "closing-overnight"
  if (marketSession.phase === "post-close" || marketSession.phase === "closed") return "post-close-review"
  return "intraday-live"
}

function getCockpitModeCopy(mode: CockpitModeId, sourceDate?: string | null): CockpitModeCopy {
  const sourceDateLabel = sourceDate ? formatShortDate(sourceDate) : "近 7 日"

  if (mode === "pre-open-plan") {
    return {
      title: "开盘前交易计划",
      sourceLabel: `开盘前计划 · ${sourceDateLabel} 信号账本`,
      sourceValue: "计划",
      primaryLabel: "开盘计划",
      candidateLabel: "计划候选",
      confluenceLabel: "计划共振",
      actionVerb: "计划关注",
      activeState: "有开盘计划",
      emptyState: "等待开盘",
      emptyTitle: "暂无可执行的开盘前计划",
      emptyBody: "开盘前只读取上一交易日仍在跟踪的上线策略信号；若账本没有强信号，就不临时拼凑推荐。",
      listTitle: "开盘前计划清单",
      listSubtitle: "来自仍在跟踪的上线策略信号，开盘后需重新看实时盘口、成交和风控是否仍成立。",
      note: "开盘前不会现场触发新信号；这里展示的是同一套策略雷达账本里仍然有效的计划池，9:30 后会切换到盘中实时账本。",
    }
  }

  if (mode === "lunch-watch") {
    return {
      title: "午间交易复核",
      sourceLabel: "午间复核 · 今日雷达账本",
      sourceValue: "账本",
      primaryLabel: "午后关注",
      candidateLabel: "午间候选",
      confluenceLabel: "雷达共振",
      actionVerb: "午后关注",
      activeState: "有午后计划",
      emptyState: "等待下午开盘",
      emptyTitle: "午间暂无动作级买点",
      emptyBody: "午间休市不新增触发；下午开盘后雷达会继续按上线策略扫描并更新账本。",
      listTitle: "午间复核清单",
      listSubtitle: "只展示今天已经落库且仍未被卖出/关闭的信号，下午开盘后继续按实时行情确认。",
      note: "午间休市期间不新增买点，页面只复核上午已经落库的上线策略信号。",
    }
  }

  if (mode === "closing-overnight") {
    return {
      title: "尾盘隔夜候选",
      sourceLabel: "尾盘隔夜候选 · 今日雷达账本",
      sourceValue: "尾盘",
      primaryLabel: "隔夜候选",
      candidateLabel: "尾盘候选",
      confluenceLabel: "隔夜共振",
      actionVerb: "尾盘关注",
      activeState: "有隔夜候选",
      emptyState: "等待尾盘信号",
      emptyTitle: "尾盘暂无合格隔夜候选",
      emptyBody: "尾盘只采用今天已经落库、仍未关闭的上线策略信号；若没有共振或高分信号，就不推荐隔夜。",
      listTitle: "尾盘隔夜候选清单",
      listSubtitle: "给快收盘用户看的第二天计划池，仍需结合 14:30 后实时价格、止损和仓位上限执行。",
      note: "尾盘模式不另造策略，只把今天已触发的上线策略信号按隔夜视角重排；收盘后会进入复盘跟踪。",
    }
  }

  if (mode === "post-close-review") {
    return {
      title: "收盘后复盘跟踪",
      sourceLabel: "收盘复盘 · 今日信号账本",
      sourceValue: "复盘",
      primaryLabel: "复盘主线",
      candidateLabel: "今日候选",
      confluenceLabel: "今日共振",
      actionVerb: "复盘关注",
      activeState: "有复盘主线",
      emptyState: "等待下一交易日",
      emptyTitle: "今天没有新的动作级买入机会",
      emptyBody: "收盘后不新增推荐；可以查看本周精选和今日卖出，下一交易日前再生成开盘计划。",
      listTitle: "收盘复盘清单",
      listSubtitle: "按今天已经落库的上线策略信号复盘，不把收盘后的静态价格误当成新触发。",
    }
  }

  if (mode === "non-trading-review") {
    return {
      title: "休市计划复盘",
      sourceLabel: `休市复盘 · ${sourceDateLabel} 信号账本`,
      sourceValue: "休市",
      primaryLabel: "计划跟踪",
      candidateLabel: "近期候选",
      confluenceLabel: "近期共振",
      actionVerb: "计划关注",
      activeState: "有跟踪计划",
      emptyState: "等待交易日",
      emptyTitle: "休市暂无新的交易机会",
      emptyBody: "非交易日不新增推荐，只展示仍在跟踪的上线策略信号和本周复盘记录。",
      listTitle: "休市跟踪清单",
      listSubtitle: "只读取近期开启且仍未关闭的策略雷达账本，作为下个交易日前的观察池。",
      note: "休市不调用盘中扫描，也不会把旧行情包装成实时买点。",
    }
  }

  return {
    title: "今天先看这几件事",
    sourceLabel: "盘中实时 · 今日雷达账本",
    sourceValue: "真实",
    primaryLabel: "今日主买",
    candidateLabel: "候选信号",
    confluenceLabel: "雷达共振",
    actionVerb: "买",
    activeState: "有主信号",
    emptyState: "等待下一次扫描",
    emptyTitle: "当前没有今天的动作级买入机会。",
    emptyBody: "建议等待下一次雷达扫描，旧信号不会再作为今日交易机会展示。",
    listTitle: "今日买入清单",
    listSubtitle: "只展示达到 B 级以上的动作级信号；每张卡直接给出北京时间、买入触发价、止盈目标和止损位置。",
  }
}

function shouldUseOpeningPlanSignals(
  mode: CockpitModeId,
  todaySignals: StockSignal[],
  openingPlanSignals: StockSignal[],
) {
  if (!openingPlanSignals.length) return false
  if (mode === "pre-open-plan" || mode === "non-trading-review") return true
  return false
}

function buildOpeningPlanSignals(records: RadarHistoryRecord[], tradeDate: string) {
  const exitRecords = records.filter((record) => radarLifecycleStatus(record) !== "open")
  const candidates = records
    .filter((record) => {
      if (record.lifecycleStage === "candidate") return false
      if (record.signalKind === "exit") return false
      if (radarLifecycleStatus(record) !== "open") return false
      const signalDate = signalDateInChina(record.recommendedAt)
      return Boolean(signalDate && signalDate < tradeDate)
    })
    .map(radarHistoryRecordToSignal)

  const stillOpen = excludeSignalsWithLaterExits(candidates, exitRecords)
  const byTicker = new Map<string, StockSignal>()
  for (const signal of stillOpen) {
    const existing = byTicker.get(signal.ticker)
    if (!existing || compareStockSignalsForPlan(signal, existing) < 0) {
      byTicker.set(signal.ticker, signal)
    }
  }

  return Array.from(byTicker.values())
    .sort(compareStockSignalsForPlan)
    .slice(0, OPENING_PLAN_MAX)
}

function compareStockSignalsForPlan(a: StockSignal, b: StockSignal) {
  const scoreDelta = signalRankingScore(b) - signalRankingScore(a)
  if (scoreDelta !== 0) return scoreDelta
  const timeDelta = recordTimeMs(stockSignalTime(b)) - recordTimeMs(stockSignalTime(a))
  if (timeDelta !== 0) return timeDelta
  return a.ticker.localeCompare(b.ticker)
}

function latestStockSignalDate(signals: StockSignal[]) {
  const dates: string[] = []
  for (const signal of signals) {
    const date = signalDateInChina(stockSignalTime(signal)) ?? signal.date
    if (date) dates.push(date)
  }
  dates.sort()
  return dates.length ? dates[dates.length - 1] : null
}

export async function TodayOpportunities() {
  const { report, diagnostics, paperConfluence, weeklyPaperConfluence, signalLedger, weeklySignalLedger } = await getTodayRadarReport()
  const defaultModel = getDefaultModelRuntime()
  const marketSession = diagnostics.marketSession
  const tradeDate = marketSession.tradeDate
  const todayExitCandidates = recordsToExitRecordsForTradeDate(signalLedger, tradeDate)
  const rawTodayActionSignals = report.suggestions.filter((signal) => isTodayActionable(signal, tradeDate))
  const freshTodayActionSignals = rawTodayActionSignals.filter((signal) => isFreshEnoughForTrading(signal, marketSession))
  const todayActionSignals = excludeSignalsWithLaterExits(
    freshTodayActionSignals,
    todayExitCandidates,
  )
  const openingPlanSignals = buildOpeningPlanSignals(weeklySignalLedger, tradeDate)
  const cockpitMode = resolveCockpitMode(marketSession)
  const useOpeningPlan = shouldUseOpeningPlanSignals(cockpitMode, todayActionSignals, openingPlanSignals)
  const actionSignals = useOpeningPlan ? openingPlanSignals : todayActionSignals
  const actionSignalDate = useOpeningPlan ? latestStockSignalDate(actionSignals) : tradeDate
  const cockpitCopy = getCockpitModeCopy(cockpitMode, actionSignalDate)
  const staleActionCount = rawTodayActionSignals.length - freshTodayActionSignals.length
  const radarConfluence = buildRadarConfluenceSignals(actionSignals, { includeCandidates: false })
  const rankedRadarConfluence = rankRadarConfluenceSignals(radarConfluence)
  const executablePaperConfluence = useOpeningPlan ? [] : paperConfluence.filter(isExecutablePaperConfluence)
  const rankedPaperConfluence = rankPaperConfluenceSignals(executablePaperConfluence)
  const opportunities = rankTodayOpportunities(actionSignals, radarConfluence)
  const todayExits = todayExitCandidates.slice(0, 6)
  const top = opportunities[0]
  const qualifiedOpportunities = opportunities.filter(isFeaturedBuyCandidate)
  const weeklyFeatured = buildWeeklyFeaturedRecords(weeklySignalLedger, tradeDate, radarConfluence, weeklyPaperConfluence)
  const cockpitCandidates = rankCockpitCandidates(rankedRadarConfluence, rankedPaperConfluence, qualifiedOpportunities)
  const primaryCandidate = cockpitCandidates[0]
  const secondaryCandidate = cockpitCandidates.find((candidate) => candidate.ticker !== primaryCandidate?.ticker)
  const visibleOpportunities = (qualifiedOpportunities.length ? qualifiedOpportunities : opportunities).slice(0, 8)
  const featuredRadarConfluence = rankedRadarConfluence[0]
  const primaryScore = primaryCandidate?.score
  const primarySignalTime = primaryCandidate ? formatSignalTime(primaryCandidate.signalAt) : "待确认"
  const isLedger = diagnostics.source === "qveris+ledger" || diagnostics.source === "ledger"
  const isReal = diagnostics.source === "qveris+ledger" || diagnostics.source === "qveris+snapshot"
  const isMarketClosed = !marketSession.isTradingDay || cockpitMode === "post-close-review" || cockpitMode === "non-trading-review"
  const dataFreshness = "dataFreshness" in diagnostics
    ? diagnostics.dataFreshness as { staleReason?: string } | undefined
    : undefined
  const staleReason = dataFreshness?.staleReason ?? diagnostics.fallbackReason
  const realtimeGuardReason = staleActionCount > 0 && marketSession.allowsPriceTracking
    ? `${staleActionCount} 条今日信号因近实时行情超过有效窗口，暂不进入主推荐；等待下一次 Qveris 行情跟踪写入。`
    : undefined
  const featuredExit = todayExits[0]
  const sourceLabel = cockpitCopy.sourceLabel
  const cockpitState = primaryCandidate
    ? cockpitCopy.activeState
    : opportunities.length > 0
      ? "仅候选观察"
      : todayExits.length > 0
      ? "仅卖出/关闭"
      : cockpitCopy.emptyState

  return (
    <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <Radar className="size-4" aria-hidden />
            Today · 交易驾驶舱
          </div>
          <h2 className="mt-2 text-[22px] font-semibold text-ink">{cockpitCopy.title}</h2>
          <p className="mt-1 font-mono text-[11px] text-ink-muted">
            {sourceLabel}
            <span className="mx-2 text-ink-faint">·</span>
            {CHINA_TIME_LABEL}主信号：{primarySignalTime}
            <span className="mx-2 text-ink-faint">·</span>
            {cockpitCopy.primaryLabel} {primaryCandidate ? 1 : 0} 只 / {cockpitCopy.candidateLabel} {opportunities.length} 只 / {cockpitCopy.confluenceLabel} {radarConfluence.length} 只 / 模拟成交共振 {executablePaperConfluence.length} 只 / 卖出 {todayExits.length} 只
            {primaryScore && (
              <>
                <span className="mx-2 text-ink-faint">·</span>
                主评分 {primaryScore.total}
              </>
            )}
            <span className="mx-2 text-ink-faint">·</span>
            {cockpitState}
            {radarConfluence.length > 0 && (
              <>
                <span className="mx-2 text-ink-faint">·</span>
                多策略共同推荐 {radarConfluence.length}
              </>
            )}
          </p>
        </div>
        <Link
          href="/radar"
          className="inline-flex h-9 items-center gap-1.5 rounded-[7px] bg-ink px-3 text-[12px] text-white"
        >
          查看策略雷达 <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-6">
        <CockpitStat label="交易日" value={formatShortDate(tradeDate)} sub={CHINA_TIME_LABEL} />
        <CockpitStat label="数据源" value={cockpitCopy.sourceValue} sub={sourceLabel} tone={isReal && !isMarketClosed ? "good" : isLedger || isMarketClosed ? undefined : "bad"} />
        <CockpitStat
          label={cockpitCopy.primaryLabel}
          value={primaryCandidate?.kind === "radar-confluence" || primaryCandidate?.kind === "paper-confluence" ? "共振" : primaryCandidate ? "1" : "0"}
          sub={primaryScore ? `${primaryScore.total} · ${primaryScore.grade}` : "等待强信号"}
          tone={primaryScore && primaryScore.total >= FEATURED_BUY_SCORE_MIN ? "good" : undefined}
        />
        <CockpitStat label={cockpitCopy.candidateLabel} value={`${opportunities.length}`} sub={top ? `最高 ${top.score.total} · ${top.score.grade}` : "策略雷达"} />
        <CockpitStat label={cockpitCopy.confluenceLabel} value={`${radarConfluence.length}`} sub={featuredRadarConfluence ? featuredRadarConfluence.name : "等待交集"} tone={radarConfluence.length > 0 ? "good" : undefined} />
        <CockpitStat label="今日卖出" value={`${todayExits.length}`} sub={featuredExit ? radarExitActionLabel(featuredExit) : "暂无关闭"} />
      </div>

      {(cockpitCopy.note || staleReason || realtimeGuardReason) && (
        <div className="mb-4 rounded-[7px] border border-rule bg-[#fff7e8] px-3 py-2 text-[12px] leading-5 text-ink-muted">
          {[cockpitCopy.note, staleReason, realtimeGuardReason].filter(Boolean).join(" ")}
        </div>
      )}

      <StockDiagnosisPanel variant="cockpit" defaultModel={defaultModel} />

      <CockpitCommandGrid
        primary={primaryCandidate}
        secondary={secondaryCandidate}
        exitRecord={featuredExit}
        tradeDate={tradeDate}
        staleReason={staleReason ?? realtimeGuardReason}
        actionVerb={cockpitCopy.actionVerb}
      />

      <WeeklyFeaturedTracker records={weeklyFeatured} tradeDate={tradeDate} />

      {opportunities.length > 0 ? (
        <>
          <TradeSectionHeader
            title={qualifiedOpportunities.length ? cockpitCopy.listTitle : `${cockpitCopy.candidateLabel}观察清单`}
            subtitle={qualifiedOpportunities.length
              ? cockpitCopy.listSubtitle
              : "当前没有达到主推荐门槛的买点，以下信号仅用于观察，不占用主推荐位。"}
            count={visibleOpportunities.length}
          />
          <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-4">
            {visibleOpportunities.map((opportunity, index) => (
              <OpportunityTile
                key={`${opportunity.signal.strategyId ?? "radar"}:${opportunity.signal.ticker}:${opportunity.signal.signalKind}:${opportunity.signal.buyPoint}`}
                opportunity={opportunity}
                index={index + 1}
                featured={index === 0}
                actionVerb={cockpitCopy.actionVerb}
              />
            ))}
          </div>
          {opportunities.length > visibleOpportunities.length && (
            <div className="mt-3 flex items-center justify-between rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-2 text-[12px] text-ink-muted">
              <span>还有 {opportunities.length - visibleOpportunities.length} 条今日信号，完整流水在策略雷达查看。</span>
              <Link href="/radar" className="inline-flex items-center gap-1 font-mono text-[11px] text-ink">
                全部信号 <ArrowRight className="size-3" aria-hidden />
              </Link>
            </div>
          )}
          {radarConfluence.length > 0 && <RadarConfluenceStrip signals={radarConfluence} tradeDate={tradeDate} actionVerb={cockpitCopy.actionVerb} />}
          {executablePaperConfluence.length > 0 && <PaperConfluenceStrip signals={executablePaperConfluence} tradeDate={tradeDate} actionVerb={cockpitCopy.actionVerb} />}
          <TodayExitPanel records={todayExits} tradeDate={tradeDate} />
        </>
      ) : (
        <>
          {radarConfluence.length > 0 && <RadarConfluenceStrip signals={radarConfluence} tradeDate={tradeDate} actionVerb={cockpitCopy.actionVerb} />}
          {executablePaperConfluence.length > 0 && <PaperConfluenceStrip signals={executablePaperConfluence} tradeDate={tradeDate} actionVerb={cockpitCopy.actionVerb} />}
          <div className="rounded-[7px] border border-dashed border-rule bg-[#fafafa] px-4 py-8 text-center text-[13px] text-ink-muted">
            <p className="font-semibold text-ink">{cockpitCopy.emptyTitle}</p>
            <p className="mt-2">
              {staleReason ?? cockpitCopy.emptyBody}
            </p>
          </div>
          <TodayExitPanel records={todayExits} tradeDate={tradeDate} />
        </>
      )}
    </section>
  )
}

function CockpitCommandGrid({
  primary,
  secondary,
  exitRecord,
  tradeDate,
  staleReason,
  actionVerb,
}: {
  primary?: CockpitSignalCandidate
  secondary?: CockpitSignalCandidate
  exitRecord?: RadarHistoryRecord
  tradeDate: string
  staleReason?: string
  actionVerb: string
}) {
  return (
    <section className="mb-4 grid gap-2 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
      {primary?.kind === "radar-confluence" ? (
        <FeaturedRadarConfluenceCommand signal={primary.radar} actionVerb={actionVerb} />
      ) : primary?.kind === "paper-confluence" ? (
        <FeaturedConfluenceCommand signal={primary.paper} actionVerb={actionVerb} />
      ) : (
        <FeaturedBuyCommand signal={primary?.opportunity} tradeDate={tradeDate} staleReason={staleReason} actionVerb={actionVerb} />
      )}
      <div className="grid gap-2">
        <SecondaryCockpitCommand candidate={secondary} tradeDate={tradeDate} staleReason={staleReason} actionVerb={actionVerb} />
        <ExitCommand record={exitRecord} tradeDate={tradeDate} />
      </div>
    </section>
  )
}

function SecondaryCockpitCommand({
  candidate,
  tradeDate,
  staleReason,
  actionVerb,
}: {
  candidate?: CockpitSignalCandidate
  tradeDate: string
  staleReason?: string
  actionVerb: string
}) {
  if (candidate?.kind === "radar-confluence") return <RadarConfluenceCommand signal={candidate.radar} actionVerb={actionVerb} />
  if (candidate?.kind === "paper-confluence") return <ConfluenceCommand signal={candidate.paper} tradeDate={tradeDate} actionVerb={actionVerb} />
  return <FeaturedBuyCommand signal={candidate?.opportunity} tradeDate={tradeDate} staleReason={staleReason} compact actionVerb={actionVerb} />
}

function FeaturedBuyCommand({
  signal,
  tradeDate,
  staleReason,
  compact,
  actionVerb,
}: {
  signal?: TodayOpportunity
  tradeDate: string
  staleReason?: string
  compact?: boolean
  actionVerb: string
}) {
  if (!signal) {
    return (
      <div className="rounded-[7px] border border-dashed border-rule bg-[#fafafa] px-4 py-5">
        <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
          <TrendingUp className="size-4" aria-hidden />
          {compact ? "单策略强信号" : "今日优先买入"}
        </div>
        <h3 className="mt-3 text-[20px] font-semibold text-ink">暂无达到主推门槛的买点</h3>
        <p className="mt-2 max-w-[620px] text-[13px] leading-6 text-ink-muted">
          {staleReason ?? `${formatShortDate(tradeDate)} 的低分候选只进入观察清单；主推荐位只展示多策略共振或 B 级以上信号。`}
        </p>
        <Link href="/radar" className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-rule bg-white px-3 font-mono text-[11px] text-ink-muted hover:text-ink">
          查看雷达状态 <ArrowRight className="size-3" aria-hidden />
        </Link>
      </div>
    )
  }

  const opportunity = signal
  const pick = opportunity.signal
  const score = opportunity.score
  const triggerPrice = pick.triggerPrice ?? pick.price
  const stopPrice = pick.invalidation?.price ?? pick.stopLoss.price
  const objectivePrice = triggerPrice * (1 + pick.upsidePct / 100)
  const signalReturn = pick.returnSinceSignalPct ?? (triggerPrice > 0 ? (pick.price / triggerPrice - 1) * 100 : 0)
  const action = buyActionLabel(pick)
  const dayUp = pick.changePct >= 0

  return (
    <Link href="/radar" className="group block overflow-hidden rounded-[7px] border border-[#b9d8c5] bg-[#f7fcf9] transition hover:border-[#89bf9d]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#d8eadf] bg-[#e8f6ed] px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-[5px] bg-ink px-2 py-1 text-[11px] font-semibold text-white">{action}</span>
          <span className="rounded-[5px] border border-[#c6e2d0] bg-white px-2 py-1 font-mono text-[10px] text-health-ok">
            {signalLevelLabel[pick.signalLevel]}
          </span>
          <span className="rounded-[5px] border border-[#c6e2d0] bg-white px-2 py-1 font-mono text-[10px] text-ink-muted">
            {signalKindLabel[pick.signalKind]}
          </span>
        </div>
        <ScorePill score={score} />
      </div>

      <div className="px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[11px] text-ink-muted">
              信号时间 {formatSignalTime(pick.recommendedAt, pick.date, pick.quoteTime)} · {CHINA_TIME_LABEL}
            </p>
            <h3 className="mt-2 text-[22px] font-semibold leading-tight text-ink">
              {actionVerb} {pick.name} <span className="font-mono text-[15px]">{pick.ticker}</span>
            </h3>
            <p className="mt-2 line-clamp-2 text-[13px] leading-6 text-ink-muted">{pick.reason}</p>
          </div>
          <div className="shrink-0 text-right font-mono">
            <p className="text-[28px] leading-none text-ink tabular">{formatPrice(pick.price)}</p>
            <p className={`mt-1 text-[12px] tabular ${dayUp ? "text-bull" : "text-bear"}`}>
              {dayUp ? "+" : ""}{formatPercent(pick.changePct)}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-1.5 md:grid-cols-4">
          <MiniMetric label="推荐评分" value={`${score.total}`} sub={`${score.grade} · ${score.summary}`} icon={BadgeCheck} />
          <MiniMetric label="买入/触发" value={formatPrice(triggerPrice)} sub={`现价 ${formatPrice(pick.price)}`} icon={TrendingUp} />
          <MiniMetric label="止盈目标" value={formatPrice(objectivePrice)} sub={`+${pick.upsidePct.toFixed(1)}%`} tone="good" icon={Target} />
          <MiniMetric label="止损位置" value={formatPrice(stopPrice)} sub={`-${pick.stopLoss.riskPct.toFixed(1)}%`} tone="bad" icon={Shield} />
          <MiniMetric label="触发后" value={formatSignedPercent(signalReturn)} tone={signalReturn >= 0 ? "good" : "bad"} sub="信号收益" />
          <MiniMetric label="信号质量" value={`${score.confidence}/${SIGNAL_SCORE_WEIGHTS.confidence}`} sub={`胜率 ${pick.winRatePct}%`} />
          <MiniMetric label="赔率风控" value={`${score.riskReward}/${SIGNAL_SCORE_WEIGHTS.riskReward}`} sub={`${pick.oddsRatio.toFixed(1)}:1`} />
          <MiniMetric label="共振加权" value={`${score.confluence}/${SIGNAL_SCORE_WEIGHTS.confluence}`} sub={opportunity.confluence ? `${opportunity.confluence.strategyCount} 策略` : "单策略"} />
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {score.labels.slice(0, 4).map((label) => (
            <span key={label} className="rounded-[5px] border border-[#d8eadf] bg-white px-2 py-1 text-[11px] text-ink-muted">
              {label}
            </span>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#d8eadf] pt-3 font-mono text-[11px] text-ink-muted">
          <span>{pick.strategyName ?? "策略雷达"}</span>
          <span className="text-ink-faint">/</span>
          <span>仓位上限 {pick.position.max}%</span>
          <span className="ml-auto inline-flex items-center gap-1 text-ink">
            查看交易计划 <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </div>
      </div>
    </Link>
  )
}

function FeaturedRadarConfluenceCommand({ signal, actionVerb }: { signal: RadarConfluenceSignal; actionVerb: string }) {
  const score = scoreRadarConfluenceSignal(signal)
  const referencePrice = radarConfluenceReferencePrice(signal)
  const targetPct = radarConfluenceTargetPct(signal)
  const stopPct = radarConfluenceStopPct(signal)

  return (
    <Link href="/radar" className="group block overflow-hidden rounded-[7px] border border-[#9acaa9] bg-[#f7fcf9] transition hover:border-[#6fad83]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#d8eadf] bg-[#e4f5ea] px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-[5px] bg-ink px-2 py-1 text-[11px] font-semibold text-white">共振观察</span>
          <span className="rounded-[5px] border border-[#c6e2d0] bg-white px-2 py-1 font-mono text-[10px] text-health-ok">
            {signal.strategyCount} 策略共同推荐
          </span>
          <span className="rounded-[5px] border border-[#c6e2d0] bg-white px-2 py-1 font-mono text-[10px] text-ink-muted">
            雷达账本
          </span>
        </div>
        <ScorePill score={score} />
      </div>

      <div className="px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[11px] text-ink-muted">
              共振触发 {formatSignalTime(signal.triggerAt)} · {CHINA_TIME_LABEL}
            </p>
            <h3 className="mt-2 text-[22px] font-semibold leading-tight text-ink">
              {actionVerb} {signal.name} <span className="font-mono text-[15px]">{signal.ticker}</span>
            </h3>
            <p className="mt-2 line-clamp-2 text-[13px] leading-6 text-ink-muted">
              {signal.strategyCount} 个上线策略同向推荐：{signal.strategyNames.slice(0, 4).join("、")}；这是雷达共同推荐，模拟盘是否成交看实盘模拟账户的仓位和风控。
            </p>
          </div>
          <div className="shrink-0 text-right font-mono">
            <p className="text-[28px] leading-none text-ink tabular">{formatMaybePrice(referencePrice)}</p>
            <p className={`mt-1 text-[12px] tabular ${signal.returnPct >= 0 ? "text-bull" : "text-bear"}`}>
              {formatSignedPercent(signal.returnPct)}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-1.5 md:grid-cols-4">
          <MiniMetric label="推荐评分" value={`${score.total}`} sub={`${score.grade} · ${score.summary}`} icon={BadgeCheck} />
          <MiniMetric label="买入/触发" value={formatMaybePrice(referencePrice)} sub="雷达共振" icon={TrendingUp} />
          <MiniMetric label="止盈目标" value={formatMaybePrice(radarConfluenceTargetPrice(signal))} sub={`+${targetPct.toFixed(1)}%`} tone="good" icon={Target} />
          <MiniMetric label="止损位置" value={formatMaybePrice(radarConfluenceStopPrice(signal))} sub={`-${stopPct.toFixed(1)}%`} tone="bad" icon={Shield} />
          <MiniMetric label="共振加权" value={`${score.confluence}/${SIGNAL_SCORE_WEIGHTS.confluence}`} sub={`${signal.strategyCount} 策略`} />
          <MiniMetric label="信号数" value={`${signal.signalCount}`} sub={`${signal.buyPoints.length} 类买点`} />
          <MiniMetric label="触发后" value={formatSignedPercent(signal.returnPct)} tone={signal.returnPct >= 0 ? "good" : "bad"} />
          <MiniMetric label="来源" value="雷达" sub="非模拟成交" />
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {score.labels.slice(0, 4).map((label) => (
            <span key={label} className="rounded-[5px] border border-[#d8eadf] bg-white px-2 py-1 text-[11px] text-ink-muted">
              {label}
            </span>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#d8eadf] pt-3 font-mono text-[11px] text-ink-muted">
          <span>策略雷达共同推荐</span>
          <span className="text-ink-faint">/</span>
          <span>{signal.strategyNames.slice(0, 3).join(" / ")}</span>
          <span className="ml-auto inline-flex items-center gap-1 text-ink">
            进入策略雷达 <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </div>
      </div>
    </Link>
  )
}

function FeaturedConfluenceCommand({ signal, actionVerb }: { signal: PaperConfluenceSignal; actionVerb: string }) {
  const score = scorePaperConfluenceSignal(signal)
  const referencePrice = confluenceReferencePrice(signal)
  const targetPct = confluenceTargetPct(signal)
  const stopPct = confluenceStopPct(signal)

  return (
    <Link href={simulationConfluenceHref(signal)} className="group block overflow-hidden rounded-[7px] border border-[#9acaa9] bg-[#f7fcf9] transition hover:border-[#6fad83]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#d8eadf] bg-[#e4f5ea] px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-[5px] bg-ink px-2 py-1 text-[11px] font-semibold text-white">{confluenceActionLabel(signal)}</span>
          <span className="rounded-[5px] border border-[#c6e2d0] bg-white px-2 py-1 font-mono text-[10px] text-health-ok">
            {signal.strategyCount} 策略共振
          </span>
          <span className="rounded-[5px] border border-[#c6e2d0] bg-white px-2 py-1 font-mono text-[10px] text-ink-muted">
            {signal.statusLabel}
          </span>
        </div>
        <ScorePill score={score} />
      </div>

      <div className="px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[11px] text-ink-muted">
              共振触发 {formatSignalTime(signal.triggerAt)} · {CHINA_TIME_LABEL}
            </p>
            <h3 className="mt-2 text-[22px] font-semibold leading-tight text-ink">
              {actionVerb} {signal.name} <span className="font-mono text-[15px]">{signal.symbol}</span>
            </h3>
            <p className="mt-2 line-clamp-2 text-[13px] leading-6 text-ink-muted">{signal.note}</p>
          </div>
          <div className="shrink-0 text-right font-mono">
            <p className="text-[28px] leading-none text-ink tabular">{formatMaybePrice(referencePrice)}</p>
            <p className="mt-1 text-[10px] text-ink-faint">触发均价</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-1.5 md:grid-cols-4">
          <MiniMetric label="推荐评分" value={`${score.total}`} sub={`${score.grade} · ${score.summary}`} icon={BadgeCheck} />
          <MiniMetric label="买入/触发" value={formatMaybePrice(referencePrice)} sub={signal.statusLabel} icon={TrendingUp} />
          <MiniMetric label="止盈目标" value={formatMaybePrice(confluenceTargetPrice(signal))} sub={`+${targetPct.toFixed(1)}%`} tone="good" icon={Target} />
          <MiniMetric label="止损位置" value={formatMaybePrice(confluenceStopPrice(signal))} sub={`-${stopPct.toFixed(1)}%`} tone="bad" icon={Shield} />
          <MiniMetric label="共振加权" value={`${score.confluence}/${SIGNAL_SCORE_WEIGHTS.confluence}`} sub={`${signal.strategyCount} 策略`} />
          <MiniMetric label="成交策略" value={`${signal.filledStrategyCount}/${signal.strategyCount}`} sub={`${signal.orderCount} 条订单`} />
          <MiniMetric label="成交金额" value={formatMoneyCompact(signal.totalAmount)} sub="模拟盘账本" />
          <MiniMetric label="信号来源" value="多策略" sub="优先于单策略候选" />
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {score.labels.slice(0, 4).map((label) => (
            <span key={label} className="rounded-[5px] border border-[#d8eadf] bg-white px-2 py-1 text-[11px] text-ink-muted">
              {label}
            </span>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#d8eadf] pt-3 font-mono text-[11px] text-ink-muted">
          <span>多策略共振模拟</span>
          <span className="text-ink-faint">/</span>
          <span>{signal.strategyNames.slice(0, 3).join(" / ")}</span>
          <span className="ml-auto inline-flex items-center gap-1 text-ink">
            查看共振账户 <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </div>
      </div>
    </Link>
  )
}

function ConfluenceCommand({ signal, tradeDate, actionVerb }: { signal?: PaperConfluenceSignal; tradeDate: string; actionVerb: string }) {
  if (!signal) {
    return (
      <Link href={`/simulation?strategy=${encodeURIComponent(PAPER_CONFLUENCE_STRATEGY_ID)}`} className="block rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3 transition hover:bg-white">
        <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
          <GitMerge className="size-4" aria-hidden />
          多策略共振
        </div>
        <p className="mt-3 text-[16px] font-semibold text-ink">暂无共振买点</p>
        <p className="mt-1 text-[12px] leading-5 text-ink-muted">
          {formatShortDate(tradeDate)} 尚无 2 个以上模拟策略同向命中。
        </p>
      </Link>
    )
  }

  const referencePrice = confluenceReferencePrice(signal)

  return (
    <Link href={simulationConfluenceHref(signal)} className="block rounded-[7px] border border-[#b7dcc4] bg-white px-3 py-3 transition hover:border-[#89bf9d]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-mono text-[11px] text-health-ok">
          <GitMerge className="size-4" aria-hidden />
          多策略共振
        </div>
        <span className="rounded-[5px] bg-[#e7f4eb] px-2 py-1 font-mono text-[10px] text-health-ok">
          {signal.strategyCount} 策略
        </span>
      </div>
      <p className="mt-3 truncate text-[16px] font-semibold text-ink">
        {actionVerb} {signal.name} <span className="font-mono text-[12px]">{signal.symbol}</span>
      </p>
      <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-ink-muted">{signal.note}</p>
      <div className="mt-3 grid grid-cols-3 gap-1.5">
        <MiniMetric label="时间" value={formatSignalTime(signal.triggerAt)} sub={CHINA_TIME_LABEL} />
        <MiniMetric label="触发" value={formatMaybePrice(referencePrice)} />
        <MiniMetric label="止损" value={formatMaybePrice(confluenceStopPrice(signal))} tone="bad" />
      </div>
    </Link>
  )
}

function RadarConfluenceCommand({ signal, actionVerb }: { signal: RadarConfluenceSignal; actionVerb: string }) {
  const score = scoreRadarConfluenceSignal(signal)
  const referencePrice = radarConfluenceReferencePrice(signal)

  return (
    <Link href="/radar" className="block rounded-[7px] border border-[#b7dcc4] bg-white px-3 py-3 transition hover:border-[#89bf9d]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-mono text-[11px] text-health-ok">
          <GitMerge className="size-4" aria-hidden />
          雷达共振
        </div>
        <ScorePill score={score} compact />
      </div>
      <p className="mt-3 truncate text-[16px] font-semibold text-ink">
        {actionVerb} {signal.name} <span className="font-mono text-[12px]">{signal.ticker}</span>
      </p>
      <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-ink-muted">
        {signal.strategyCount} 个上线策略同向推荐：{signal.strategyNames.slice(0, 3).join("、")}。
      </p>
      <div className="mt-3 grid grid-cols-3 gap-1.5">
        <MiniMetric label="时间" value={formatSignalTime(signal.triggerAt)} sub={CHINA_TIME_LABEL} />
        <MiniMetric label="触发" value={formatMaybePrice(referencePrice)} />
        <MiniMetric label="触发后" value={formatSignedPercent(signal.returnPct)} tone={signal.returnPct >= 0 ? "good" : "bad"} />
      </div>
    </Link>
  )
}

function ExitCommand({ record, tradeDate }: { record?: RadarHistoryRecord; tradeDate: string }) {
  if (!record) {
    return (
      <Link href="/radar/history?status=all&sort=recent" className="block rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3 transition hover:bg-white">
        <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
          <LogOut className="size-4" aria-hidden />
          今日卖出 / 关闭
        </div>
        <p className="mt-3 text-[16px] font-semibold text-ink">暂无卖出信号</p>
        <p className="mt-1 text-[12px] leading-5 text-ink-muted">
          {formatShortDate(tradeDate)} 还没有止盈、止损或到期退出记录。
        </p>
      </Link>
    )
  }

  const exitReturn = radarExitReturnPct(record)
  const exitTone = radarExitTone(record)
  const action = radarExitActionLabel(record)

  return (
    <Link href="/radar/history?status=all&sort=recent" className="block rounded-[7px] border border-rule bg-white px-3 py-3 transition hover:border-ink/30">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
          <LogOut className="size-4" aria-hidden />
          今日卖出 / 关闭
        </div>
        <span className={`rounded-[5px] px-2 py-1 text-[11px] font-semibold ${
          exitTone === "good"
            ? "bg-[#e7f4eb] text-health-ok"
            : exitTone === "bad"
              ? "bg-[#fff2ea] text-warning"
              : "bg-[#f2f2f2] text-ink-muted"
        }`}>
          {action}
        </span>
      </div>
      <div className="mt-3 flex items-start justify-between gap-3">
        <p className="min-w-0 truncate text-[16px] font-semibold text-ink">
          卖 {record.name} <span className="font-mono text-[12px]">{record.ticker}</span>
        </p>
        <p className={`shrink-0 font-mono text-[15px] font-semibold ${exitReturn >= 0 ? "text-bull" : "text-bear"}`}>
          {formatSignedPercent(exitReturn)}
        </p>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1.5">
        <MiniMetric label="时间" value={formatExitTime(record)} sub={CHINA_TIME_LABEL} />
        <MiniMetric label="卖出价" value={formatPrice(radarExitPrice(record))} />
        <MiniMetric label="最高浮盈" value={formatSignedPercent(record.maxReturnPct)} tone={record.maxReturnPct >= 0 ? "good" : "bad"} />
      </div>
    </Link>
  )
}

export function TodayOpportunitiesFallback() {
  const marketSession = getChinaMarketSession()
  const canScanNow = shouldRunRadarScan(marketSession)
  return (
    <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <Radar className="size-4" aria-hidden />
            Today · 交易驾驶舱
          </div>
          <h2 className="mt-2 text-[22px] font-semibold text-ink">今天先看这几件事</h2>
          <p className="mt-1 text-[12px] leading-5 text-ink-muted">
            {canScanNow ? "正在读取最近雷达快照。" : `${marketSession.phaseLabel}，不现场扫描新信号；优先读取已落库账本。`}
          </p>
        </div>
        <span className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 font-mono text-[11px] text-ink-muted">
          {CHINA_TIME_LABEL} · {marketSession.tradeDate}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <CockpitStat label="交易日" value={formatShortDate(marketSession.tradeDate)} sub={CHINA_TIME_LABEL} />
        <CockpitStat label="数据源" value={canScanNow ? "读取中" : "休市"} sub={marketSession.phaseLabel} />
        <CockpitStat label="今日买入" value="--" sub="最近快照" />
        <CockpitStat label="多策略共振" value="--" sub="模拟账本" />
        <CockpitStat label="今日卖出" value="--" sub="信号账本" />
      </div>
    </section>
  )
}

function CockpitStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub: string
  tone?: "good" | "bad"
}) {
  const color = tone === "good" ? "text-bull" : tone === "bad" ? "text-bear" : "text-ink"
  return (
    <div className="min-w-0 rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className={`mt-1 truncate font-mono text-[16px] font-semibold tabular ${color}`}>{value}</p>
      <p className="mt-0.5 truncate text-[11px] text-ink-muted">{sub}</p>
    </div>
  )
}

function RadarConfluenceStrip({
  signals,
  tradeDate,
  actionVerb,
}: {
  signals: RadarConfluenceSignal[]
  tradeDate: string
  actionVerb: string
}) {
  if (!signals.length) return null

  const featured = signals[0]
  const secondary = signals.slice(1, 5)
  const featuredPrice = radarConfluenceReferencePrice(featured)
  const targetPct = radarConfluenceTargetPct(featured)
  const stopPct = radarConfluenceStopPct(featured)

  return (
    <section className="mb-4 overflow-hidden rounded-[7px] border border-[#b7dcc4] bg-[#f7fcf9]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#d8eadf] px-3 py-3">
        <div className="flex items-center gap-2">
          <GitMerge className="size-4 text-health-ok" aria-hidden />
          <div>
            <p className="text-[13px] font-semibold text-ink">今日雷达共同推荐</p>
            <p className="mt-0.5 text-[11px] text-ink-muted">
              同一股票被 2 个以上上线策略在北京时间 {formatShortDate(tradeDate)} 的雷达账本中同向推荐。
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-[6px] bg-[#e7f4eb] px-2.5 py-1 font-mono text-[11px] text-health-ok">
            {signals.length} 只雷达共振
          </span>
          <Link href="/radar" className="font-mono text-[11px] text-health-ok hover:text-ink">
            查看策略雷达 →
          </Link>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
        <Link
          href="/radar"
          className="block border-b border-[#d8eadf] bg-white/70 px-3 py-3 transition hover:bg-white lg:border-b-0 lg:border-r"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-[5px] bg-ink px-2 py-1 text-[11px] font-semibold text-white">
              共振观察
            </span>
            <span className="rounded-[5px] bg-[#e7f4eb] px-2 py-1 font-mono text-[10px] text-health-ok">
              {featured.strategyCount} 策略共同推荐
            </span>
            <span className="rounded-[5px] border border-[#d8eadf] bg-white px-2 py-1 font-mono text-[10px] text-ink-muted">
              雷达账本
            </span>
          </div>
          <div className="mt-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[18px] font-semibold leading-tight text-ink">
                {actionVerb} {featured.name} <span className="font-mono text-[13px]">{featured.ticker}</span>
              </p>
              <p className="mt-2 line-clamp-2 text-[12px] leading-5 text-ink-muted">
                {featured.strategyNames.slice(0, 4).join("、")} 同向命中；模拟盘是否成交取决于仓位上限、现金和 T+1 规则。
              </p>
            </div>
            <div className="shrink-0 text-right font-mono">
              <p className="text-[20px] leading-none text-ink tabular">{formatMaybePrice(featuredPrice)}</p>
              <p className={`mt-1 text-[11px] ${featured.returnPct >= 0 ? "text-bull" : "text-bear"}`}>
                {formatSignedPercent(featured.returnPct)}
              </p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            <MiniMetric label="共振时间" value={formatSignalTime(featured.triggerAt)} sub="北京时间" icon={Clock3} />
            <MiniMetric label="买入/触发" value={formatMaybePrice(featuredPrice)} sub="雷达共振" icon={TrendingUp} />
            <MiniMetric label="止盈目标" value={formatMaybePrice(radarConfluenceTargetPrice(featured))} sub={`+${targetPct.toFixed(1)}%`} tone="good" icon={Target} />
            <MiniMetric label="止损位置" value={formatMaybePrice(radarConfluenceStopPrice(featured))} sub={`-${stopPct.toFixed(1)}%`} tone="bad" icon={Shield} />
            <MiniMetric label="命中策略" value={`${featured.strategyCount} 个`} sub={`${featured.signalCount} 条信号`} />
            <MiniMetric label="触发后" value={formatSignedPercent(featured.returnPct)} tone={featured.returnPct >= 0 ? "good" : "bad"} />
          </div>
        </Link>

        <div className="grid gap-2 p-3">
          {secondary.length > 0 ? secondary.map((signal) => (
            <Link
              key={signal.ticker}
              href="/radar"
              className="block rounded-[7px] border border-[#d8eadf] bg-white px-3 py-2.5 transition hover:border-[#9fceb0]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-ink">
                    {signal.name} <span className="font-mono text-[11px] text-ink-muted">{signal.ticker}</span>
                  </p>
                  <p className="mt-1 truncate text-[11px] text-ink-muted">{signal.strategyNames.slice(0, 3).join(" / ")}</p>
                </div>
                <span className="shrink-0 rounded-[5px] bg-[#e7f4eb] px-2 py-1 font-mono text-[10px] text-health-ok">
                  {signal.strategyCount} 策略
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                <MiniMetric label="时间" value={formatSignalTime(signal.triggerAt)} sub="北京时间" />
                <MiniMetric label="触发" value={formatMaybePrice(radarConfluenceReferencePrice(signal))} />
                <MiniMetric label="收益" value={formatSignedPercent(signal.returnPct)} tone={signal.returnPct >= 0 ? "good" : "bad"} />
              </div>
            </Link>
          )) : (
            <div className="flex min-h-[152px] items-center justify-center rounded-[7px] border border-dashed border-[#d8eadf] bg-white px-3 text-center text-[12px] text-ink-muted">
              当前只有 1 只雷达共振标的，新的交集信号会在这里继续追加。
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function PaperConfluenceStrip({
  signals,
  tradeDate,
  actionVerb,
}: {
  signals: PaperConfluenceSignal[]
  tradeDate: string
  actionVerb: string
}) {
  if (!signals.length) {
    return (
      <div className="mb-3 flex flex-col gap-2 rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <GitMerge className="size-4 text-ink-muted" aria-hidden />
          <div>
            <p className="text-[13px] font-semibold text-ink">今日多策略共振</p>
            <p className="mt-0.5 text-[11px] text-ink-muted">
              {formatShortDate(tradeDate)} 暂无 2 个以上已上线模拟策略同向命中的共振买入。
            </p>
          </div>
        </div>
        <Link href={`/simulation?strategy=${encodeURIComponent(PAPER_CONFLUENCE_STRATEGY_ID)}`} className="font-mono text-[11px] text-ink-muted hover:text-ink">
          进入共振模拟 →
        </Link>
      </div>
    )
  }
  const featured = signals[0]
  const secondary = signals.slice(1, 5)
  const featuredPrice = confluenceReferencePrice(featured)
  const targetPct = confluenceTargetPct(featured)
  const stopPct = confluenceStopPct(featured)

  return (
    <section className="mb-4 overflow-hidden rounded-[7px] border border-[#b7dcc4] bg-[#f7fcf9]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#d8eadf] px-3 py-3">
        <div className="flex items-center gap-2">
          <GitMerge className="size-4 text-health-ok" aria-hidden />
          <div>
            <p className="text-[13px] font-semibold text-ink">今日多策略共振</p>
            <p className="mt-0.5 text-[11px] text-ink-muted">
              同一股票被 2 个以上已上线模拟策略在北京时间 {formatShortDate(tradeDate)} 同向命中。
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-[6px] bg-[#e7f4eb] px-2.5 py-1 font-mono text-[11px] text-health-ok">
            {signals.length} 只共振
          </span>
          <Link href={`/simulation?strategy=${encodeURIComponent(PAPER_CONFLUENCE_STRATEGY_ID)}`} className="font-mono text-[11px] text-health-ok hover:text-ink">
            进入共振模拟 →
          </Link>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
        <Link
          href={simulationConfluenceHref(featured)}
          className="block border-b border-[#d8eadf] bg-white/70 px-3 py-3 transition hover:bg-white lg:border-b-0 lg:border-r"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-[5px] bg-ink px-2 py-1 text-[11px] font-semibold text-white">
              {confluenceActionLabel(featured)}
            </span>
            <span className="rounded-[5px] bg-[#e7f4eb] px-2 py-1 font-mono text-[10px] text-health-ok">
              {featured.statusLabel}
            </span>
            <span className="rounded-[5px] border border-[#d8eadf] bg-white px-2 py-1 font-mono text-[10px] text-ink-muted">
              {featured.strategyCount} 策略共振
            </span>
          </div>
          <div className="mt-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[18px] font-semibold leading-tight text-ink">
                {actionVerb} {featured.name} <span className="font-mono text-[13px]">{featured.symbol}</span>
              </p>
              <p className="mt-2 line-clamp-2 text-[12px] leading-5 text-ink-muted">
                {featured.note}
              </p>
            </div>
            <div className="shrink-0 text-right font-mono">
              <p className="text-[20px] leading-none text-ink tabular">{formatMaybePrice(featuredPrice)}</p>
              <p className="mt-1 text-[10px] text-ink-faint">触发均价</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            <MiniMetric label="共振时间" value={formatSignalTime(featured.latestAt)} sub="北京时间" icon={Clock3} />
            <MiniMetric label="买入/触发" value={formatMaybePrice(featuredPrice)} sub={featured.statusLabel} icon={TrendingUp} />
            <MiniMetric
              label="止盈目标"
              value={formatMaybePrice(confluenceTargetPrice(featured))}
              sub={`+${targetPct.toFixed(1)}%`}
              tone="good"
              icon={Target}
            />
            <MiniMetric
              label="止损位置"
              value={formatMaybePrice(confluenceStopPrice(featured))}
              sub={`-${stopPct.toFixed(1)}%`}
              tone="bad"
              icon={Shield}
            />
            <MiniMetric label="命中策略" value={`${featured.strategyCount} 个`} sub={`成交 ${featured.filledStrategyCount} / 观察 ${featured.skippedStrategyCount}`} />
            <MiniMetric label="成交金额" value={formatMoneyCompact(featured.totalAmount)} sub={`${featured.orderCount} 条订单`} />
          </div>
        </Link>

        <div className="grid gap-2 p-3">
          {secondary.length > 0 ? secondary.map((signal) => (
          <Link
            key={signal.symbol}
            href={simulationConfluenceHref(signal)}
            className="block rounded-[7px] border border-[#d8eadf] bg-white px-3 py-2.5 transition hover:border-[#9fceb0]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold text-ink">
                  {signal.name} <span className="font-mono text-[11px] text-ink-muted">{signal.symbol}</span>
                </p>
                <p className="mt-1 truncate text-[11px] text-ink-muted">{signal.strategyNames.slice(0, 3).join(" / ")}</p>
              </div>
              <span className="shrink-0 rounded-[5px] bg-[#e7f4eb] px-2 py-1 font-mono text-[10px] text-health-ok">
                {signal.strategyCount} 策略
              </span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              <MiniMetric label="时间" value={formatSignalTime(signal.triggerAt)} sub="北京时间" />
              <MiniMetric label="触发" value={formatMaybePrice(confluenceReferencePrice(signal))} />
              <MiniMetric label="止损" value={formatMaybePrice(confluenceStopPrice(signal))} tone="bad" />
            </div>
          </Link>
          )) : (
            <div className="flex min-h-[152px] items-center justify-center rounded-[7px] border border-dashed border-[#d8eadf] bg-white px-3 text-center text-[12px] text-ink-muted">
              当前只有 1 只共振标的，新的交集信号会在这里继续追加。
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function OpportunityTile({
  opportunity,
  index,
  featured,
  actionVerb,
}: {
  opportunity: TodayOpportunity
  index: number
  featured?: boolean
  actionVerb: string
}) {
  const { signal, score } = opportunity
  const dayUp = signal.changePct >= 0
  const triggerPrice = signal.triggerPrice ?? signal.price
  const stopPrice = signal.invalidation?.price ?? signal.stopLoss.price
  const targetPrice = triggerPrice * (1 + signal.upsidePct / 100)
  const signalReturn = signal.returnSinceSignalPct ?? (triggerPrice > 0 ? (signal.price / triggerPrice - 1) * 100 : 0)
  const signalUp = signalReturn >= 0
  const levelColor = signalLevelColor[signal.signalLevel]
  const action = buyActionLabel(signal)

  return (
    <Link
      href="/radar"
      className={`group block rounded-[7px] border px-3 py-3 transition-colors ${
        featured ? "border-[#b9d8c5] bg-[#f4fbf7]" : "border-rule bg-[#fafafa] hover:bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[10px] text-ink-faint">#{String(index).padStart(2, "0")}</span>
            <span className="size-2 rounded-full" style={{ backgroundColor: levelColor }} aria-hidden />
            <span className="font-mono text-[10px] text-ink-muted">{signalLevelLabel[signal.signalLevel]}</span>
            <span className="rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
              {signalKindLabel[signal.signalKind]}
            </span>
          </div>
          <div className="mt-2 inline-flex rounded-[5px] bg-ink px-2 py-1 text-[11px] font-semibold text-white">
            {action}
          </div>
          <p className="mt-2 truncate text-[16px] font-semibold leading-tight text-ink">
            {actionVerb} {signal.name} <span className="font-mono text-[12px]">{signal.ticker}</span>
          </p>
          <StrategySourcePill name={signal.strategyName} id={signal.strategyId} />
        </div>
        <div className="shrink-0 text-right">
          <ScorePill score={score} compact />
          <p className="font-mono text-[18px] leading-none text-ink tabular">{formatPrice(signal.price)}</p>
          <p className={`mt-1 font-mono text-[11px] tabular ${dayUp ? "text-bull" : "text-bear"}`}>
            {dayUp ? "+" : ""}{formatPercent(signal.changePct)}
          </p>
        </div>
      </div>

      <p className="mt-2 line-clamp-2 min-h-[40px] text-[12px] leading-5 text-ink-muted">{signal.reason}</p>

      <div className="mt-3 grid grid-cols-2 gap-1.5 border-t border-rule-soft pt-3">
        <MiniMetric label="推荐时间" value={formatSignalTime(signal.recommendedAt, signal.date, signal.quoteTime)} sub="北京时间" icon={Clock3} />
        <MiniMetric label="买入/触发" value={formatPrice(triggerPrice)} sub={`现价 ${formatPrice(signal.price)}`} icon={TrendingUp} />
        <MiniMetric label="止盈目标" value={formatPrice(targetPrice)} sub={`+${signal.upsidePct.toFixed(1)}%`} tone="good" icon={Target} />
        <MiniMetric label="止损位置" value={formatPrice(stopPrice)} sub={`-${signal.stopLoss.riskPct.toFixed(1)}%`} tone="bad" icon={Shield} />
        <MiniMetric label="触发后" value={formatSignedPercent(signalReturn)} tone={signalUp ? "good" : "bad"} />
        <MiniMetric label="仓位上限" value={`${signal.position.max}%`} sub={signal.position.current == null ? "按计划执行" : `当前 ${signal.position.current}%`} />
      </div>

      <div className="mt-2 flex items-center gap-2 font-mono text-[10px] text-ink-muted">
        <span className="max-w-[46%] truncate">策略 {compactStrategyName(signal.strategyName, signal.strategyId)}</span>
        <span className="text-ink-faint">/</span>
        <span>胜率 {signal.winRatePct}%</span>
        <span className="text-ink-faint">/</span>
        <span>赔率 {signal.oddsRatio.toFixed(1)}:1</span>
        <span className="hidden text-ink-faint sm:inline">/</span>
        <span className="hidden sm:inline">{score.labels[0]}</span>
        <ArrowRight className="ml-auto size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </div>
    </Link>
  )
}

function WeeklyFeaturedTracker({ records, tradeDate }: { records: WeeklyFeaturedRecord[]; tradeDate: string }) {
  const openCount = records.filter((item) => weeklyDisplayState(item.record, tradeDate).isOpen).length
  const closedCount = records.length - openCount
  const startDate = shiftChinaDate(tradeDate, -6)

  return (
    <section className="mb-4 rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule-soft pb-3">
        <div>
          <div className="flex items-center gap-2">
            <BadgeCheck className="size-4 text-ink-muted" aria-hidden />
            <h3 className="text-[14px] font-semibold text-ink">本周精选跟踪</h3>
          </div>
          <p className="mt-1 text-[12px] leading-5 text-ink-muted">
            只展示 {formatShortDate(startDate)} - {formatShortDate(tradeDate)} 进入主买门槛的记录；低分候选不进入这里。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-[6px] border border-rule bg-white px-2.5 py-1 font-mono text-[11px] text-ink-muted">
            {records.length} 条精选
          </span>
          <span className="rounded-[6px] border border-rule bg-white px-2.5 py-1 font-mono text-[11px] text-ink-muted">
            跟踪 {openCount} / 已关闭 {closedCount}
          </span>
          <Link href="/radar/history?status=all&sort=recent" className="rounded-[6px] border border-rule bg-white px-2.5 py-1 font-mono text-[11px] text-ink-muted hover:text-ink">
            信号账本 →
          </Link>
        </div>
      </div>

      {records.length > 0 ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {records.map((item) => (
            <WeeklyFeaturedTile key={item.record.id} item={item} tradeDate={tradeDate} />
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-[7px] border border-dashed border-rule bg-white px-4 py-8 text-center text-[13px] text-ink-muted">
          本周暂无进入主买门槛的精选记录；若出现多策略共振或 B 级以上买点，会自动进入这里持续跟踪。
        </div>
      )}
    </section>
  )
}

function WeeklyFeaturedTile({ item, tradeDate }: { item: WeeklyFeaturedRecord; tradeDate: string }) {
  const { record, score, source } = item
  const state = weeklyDisplayState(record, tradeDate)
  const statusClass = state.tone === "good"
    ? "bg-[#e7f4eb] text-health-ok"
    : state.tone === "bad"
      ? "bg-[#fff2ea] text-warning"
      : "bg-[#eef5ff] text-[#22639c]"

  return (
    <Link href="/radar/history?status=all&sort=recent" className="block rounded-[7px] border border-rule bg-white px-3 py-3 transition hover:border-ink/30">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded-[5px] px-2 py-1 font-mono text-[10px] ${source !== "single" ? "bg-[#e7f4eb] text-health-ok" : "bg-[#f2f2f2] text-ink-muted"}`}>
              {source === "radar-confluence" ? "雷达共振" : source === "paper-confluence" ? "成交共振" : "优先买入"}
            </span>
            <span className={`rounded-[5px] px-2 py-1 text-[10px] font-semibold ${statusClass}`}>{state.label}</span>
          </div>
          <p className="mt-2 truncate text-[15px] font-semibold text-ink">
            {record.name} <span className="font-mono text-[11px] text-ink-muted">{record.ticker}</span>
          </p>
          <p className="mt-1 truncate text-[11px] text-ink-muted">{record.strategyName ?? "策略雷达"}</p>
        </div>
        <div className="shrink-0 text-right">
          <ScorePill score={score} compact />
          <p className={`font-mono text-[15px] font-semibold ${state.returnPct >= 0 ? "text-bull" : "text-bear"}`}>
            {formatSignedPercent(state.returnPct)}
          </p>
          <p className="mt-1 text-[10px] text-ink-faint">{state.isOpen ? "信号收益" : "关闭收益"}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1.5 border-t border-rule-soft pt-3">
        <MiniMetric label="推荐时间" value={formatSignalTime(record.recommendedAt)} sub="北京时间" icon={Clock3} />
        <MiniMetric label="触发价" value={formatPrice(record.triggerPrice)} />
        <MiniMetric label={state.isOpen ? "当前价" : "关闭价"} value={formatPrice(state.displayPrice)} sub={state.priceSub} />
        <MiniMetric label="最高浮盈" value={formatSignedPercent(state.mfePct)} tone={state.mfePct >= 0 ? "good" : "bad"} />
        <MiniMetric label="最大不利" value={formatSignedPercent(state.maePct)} tone={state.maePct >= 0 ? "good" : "bad"} />
        <MiniMetric label={state.isOpen ? "持有" : "持有期"} value={`${state.holdDays} 天`} sub={state.holdSub} />
        <MiniMetric label="止盈目标" value={formatMaybePrice(record.targetPrice)} tone="good" icon={Target} />
        <MiniMetric label="止损位置" value={formatMaybePrice(record.stopLossPrice)} tone="bad" icon={Shield} />
      </div>

      <p className="mt-3 line-clamp-2 min-h-[40px] text-[12px] leading-5 text-ink-muted">
        {state.note}
      </p>
    </Link>
  )
}

function TodayExitPanel({ records, tradeDate }: { records: RadarHistoryRecord[]; tradeDate: string }) {
  return (
    <section className="mt-4 rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule-soft pb-3">
        <div>
          <div className="flex items-center gap-2">
            <LogOut className="size-4 text-ink-muted" aria-hidden />
            <h3 className="text-[14px] font-semibold text-ink">今日卖出 / 关闭</h3>
          </div>
          <p className="mt-1 text-[12px] leading-5 text-ink-muted">
            展示 {formatShortDate(tradeDate)} 北京时间触发的止盈、风控、止损或到期退出。
          </p>
        </div>
        <Link href="/radar/history?status=all&sort=recent" className="font-mono text-[11px] text-ink-muted hover:text-ink">
          查看信号账本 →
        </Link>
      </div>

      {records.length > 0 ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {records.map((record) => (
            <ExitTile key={record.id} record={record} />
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-[7px] border border-dashed border-rule bg-white px-4 py-8 text-center text-[13px] text-ink-muted">
          今天暂无卖出/关闭记录；若触发止盈、风控、止损或到期退出，会在这里显示具体北京时间。
        </div>
      )}
    </section>
  )
}

function ExitTile({ record }: { record: RadarHistoryRecord }) {
  const exitReturn = radarExitReturnPct(record)
  const exitTone = radarExitTone(record)
  const action = radarExitActionLabel(record)
  return (
    <Link href="/radar/history?status=all&sort=recent" className="block rounded-[7px] border border-rule bg-white px-3 py-3 transition hover:border-ink/30">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className={`inline-flex rounded-[5px] px-2 py-1 text-[11px] font-semibold ${
            exitTone === "good"
              ? "bg-[#e7f4eb] text-health-ok"
              : exitTone === "bad"
                ? "bg-[#fff2ea] text-warning"
                : "bg-[#f2f2f2] text-ink-muted"
          }`}>
            {action}
          </span>
          <p className="mt-2 truncate text-[15px] font-semibold text-ink">
            卖 {record.name} <span className="font-mono text-[12px]">{record.ticker}</span>
          </p>
        </div>
        <div className="shrink-0 text-right font-mono">
          <p className={`text-[15px] font-semibold ${exitReturn >= 0 ? "text-bull" : "text-bear"}`}>
            {formatSignedPercent(exitReturn)}
          </p>
          <p className="mt-1 text-[10px] text-ink-faint">信号收益</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1.5">
        <MiniMetric label="卖出时间" value={formatExitTime(record)} sub="北京时间" />
        <MiniMetric label="卖出价" value={formatPrice(radarExitPrice(record))} />
        <MiniMetric label="原触发价" value={formatPrice(record.triggerPrice)} />
        <MiniMetric label="最高浮盈" value={formatSignedPercent(record.maxReturnPct)} tone={record.maxReturnPct >= 0 ? "good" : "bad"} />
      </div>

      <p className="mt-3 line-clamp-2 text-[12px] leading-5 text-ink-muted">
        {record.exitReason ?? record.note}
      </p>
    </Link>
  )
}

function TradeSectionHeader({ title, subtitle, count }: { title: string; subtitle: string; count: number }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
        <p className="mt-1 text-[12px] leading-5 text-ink-muted">{subtitle}</p>
      </div>
      <span className="rounded-[6px] border border-rule bg-[#fafafa] px-2.5 py-1 font-mono text-[11px] text-ink-muted">
        {count} 条
      </span>
    </div>
  )
}

function ScorePill({ score, compact }: { score: UnifiedSignalScore; compact?: boolean }) {
  const tone = score.total >= 82
    ? "bg-ink text-white"
    : score.total >= 70
      ? "bg-[#e7f4eb] text-health-ok"
      : score.total >= 58
        ? "bg-[#fff7e8] text-warning"
        : "bg-[#f2f2f2] text-ink-muted"
  return (
    <span className={`mb-1 inline-flex items-center justify-center rounded-[6px] font-mono font-semibold tabular ${tone} ${
      compact ? "min-w-12 px-2 py-1 text-[11px]" : "gap-1.5 px-2.5 py-1 text-[12px]"
    }`}>
      {compact ? score.total : `推荐分 ${score.total} · ${score.grade}`}
    </span>
  )
}

function StrategySourcePill({ name, id }: { name?: string; id?: string }) {
  return (
    <div className="mt-2 flex max-w-full items-center gap-1.5">
      <span className="shrink-0 rounded-[5px] border border-rule-soft bg-white px-1.5 py-0.5 font-mono text-[9px] text-ink-faint">
        策略
      </span>
      <span className="truncate rounded-[5px] border border-rule-soft bg-white px-2 py-0.5 text-[11px] text-ink-muted">
        {compactStrategyName(name, id)}
      </span>
    </div>
  )
}

function MiniMetric({
  label,
  value,
  tone,
  sub,
  icon: Icon,
}: {
  label: string
  value: string
  tone?: "good" | "bad"
  sub?: string
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
}) {
  const color = tone === "good" ? "text-bull" : tone === "bad" ? "text-bear" : "text-ink"
  return (
    <div className="rounded-[6px] border border-rule-soft bg-white px-2 py-1.5">
      <p className="flex items-center gap-1 font-mono text-[9px] uppercase text-ink-faint">
        {Icon && <Icon className="size-3" aria-hidden />}
        {label}
      </p>
      <p className={`mt-1 truncate font-mono text-[12px] font-semibold tabular ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-[10px] text-ink-faint">{sub}</p>}
    </div>
  )
}

function formatSignalTime(recommendedAt?: string, date?: string, quoteTime?: string) {
  if (recommendedAt) {
    const d = new Date(recommendedAt)
    if (!Number.isNaN(d.getTime())) {
      return formatChinaDateTime(d, { dateStyle: "short" })
    }
  }
  return [date, quoteTime].filter(Boolean).join(" ") || "待确认"
}

function formatExitTime(record: RadarHistoryRecord) {
  return formatChinaDateTime(record.closedAt ?? record.latestQuoteAt ?? record.recommendedAt, { dateStyle: "short" })
}

function mergeHistoryRecords(records: RadarHistoryRecord[], fallbackRecords: RadarHistoryRecord[]) {
  const byId = new Map<string, RadarHistoryRecord>()
  for (const record of records) {
    byId.set(record.id, record)
  }
  for (const record of fallbackRecords) {
    if (!byId.has(record.id)) byId.set(record.id, record)
  }
  return Array.from(byId.values())
}

function isTodayActionable(signal: StockSignal, tradeDate: string) {
  if (signal.signalLifecycle === "candidate" || signal.signalLifecycle === "closed") return false
  const signalDate = signalDateInChina(signal.recommendedAt) ?? signal.date
  return signalDate === tradeDate
}

function isFreshEnoughForTrading(signal: StockSignal, marketSession: ReturnType<typeof getChinaMarketSession>) {
  if (!marketSession.allowsPriceTracking) return true
  if (signal.priceSource !== "qveris-realtime") return false
  const latestAt = signal.latestQuoteAt ?? signal.lastSeenAt ?? signal.recommendedAt
  if (!latestAt) return false
  const nowMs = new Date(marketSession.now).getTime()
  const latestMs = recordTimeMs(latestAt)
  if (!Number.isFinite(nowMs) || !Number.isFinite(latestMs)) return false
  return nowMs - latestMs <= REALTIME_SIGNAL_MAX_AGE_MS
}

function rankCockpitCandidates(
  radarConfluence: RadarConfluenceSignal[],
  paperConfluence: PaperConfluenceSignal[],
  opportunities: TodayOpportunity[],
) {
  const candidates: CockpitSignalCandidate[] = [
    ...radarConfluence.map((signal): CockpitSignalCandidate => ({
      kind: "radar-confluence",
      ticker: signal.ticker,
      score: scoreRadarConfluenceSignal(signal),
      signalAt: signal.triggerAt || signal.latestAt,
      sourceRank: 3,
      radar: signal,
    })),
    ...paperConfluence.map((signal): CockpitSignalCandidate => ({
      kind: "paper-confluence",
      ticker: signal.symbol,
      score: scorePaperConfluenceSignal(signal),
      signalAt: signal.triggerAt || signal.latestAt,
      sourceRank: 2,
      paper: signal,
    })),
    ...opportunities.map((opportunity): CockpitSignalCandidate => ({
      kind: "buy",
      ticker: opportunity.signal.ticker,
      score: opportunity.score,
      signalAt: stockSignalTime(opportunity.signal),
      sourceRank: opportunity.confluence ? 2 : 1,
      opportunity,
    })),
  ].sort(compareCockpitCandidates)

  const byTicker = new Map<string, CockpitSignalCandidate>()
  for (const candidate of candidates) {
    if (!byTicker.has(candidate.ticker)) byTicker.set(candidate.ticker, candidate)
  }
  return Array.from(byTicker.values())
}

function rankRadarConfluenceSignals(signals: RadarConfluenceSignal[]) {
  return signals.slice().sort((a, b) => compareCockpitCandidates(
    {
      kind: "radar-confluence",
      ticker: a.ticker,
      score: scoreRadarConfluenceSignal(a),
      signalAt: a.triggerAt || a.latestAt,
      sourceRank: 3,
      radar: a,
    },
    {
      kind: "radar-confluence",
      ticker: b.ticker,
      score: scoreRadarConfluenceSignal(b),
      signalAt: b.triggerAt || b.latestAt,
      sourceRank: 3,
      radar: b,
    },
  ))
}

function rankPaperConfluenceSignals(signals: PaperConfluenceSignal[]) {
  return signals.slice().sort((a, b) => compareCockpitCandidates(
    {
      kind: "paper-confluence",
      ticker: a.symbol,
      score: scorePaperConfluenceSignal(a),
      signalAt: a.triggerAt || a.latestAt,
      sourceRank: 2,
      paper: a,
    },
    {
      kind: "paper-confluence",
      ticker: b.symbol,
      score: scorePaperConfluenceSignal(b),
      signalAt: b.triggerAt || b.latestAt,
      sourceRank: 2,
      paper: b,
    },
  ))
}

function compareCockpitCandidates(a: CockpitSignalCandidate, b: CockpitSignalCandidate) {
  if (b.score.total !== a.score.total) return b.score.total - a.score.total
  const timeDelta = recordTimeMs(b.signalAt) - recordTimeMs(a.signalAt)
  if (timeDelta !== 0) return timeDelta
  if (b.sourceRank !== a.sourceRank) return b.sourceRank - a.sourceRank
  return b.ticker.localeCompare(a.ticker)
}

function stockSignalTime(signal: StockSignal) {
  return signal.recommendedAt ?? signal.firstTriggeredAt ?? signal.latestQuoteAt ?? `${signal.date}T${signal.quoteTime ?? "09:30:00"}+08:00`
}

function rankTodayOpportunities(signals: StockSignal[], confluenceSignals: RadarConfluenceSignal[]) {
  const confluenceBySymbol = new Map(confluenceSignals.map((signal) => [signal.ticker, signal]))
  const byTicker = new Map<string, TodayOpportunity>()
  for (const signal of signals) {
    const confluence = confluenceBySymbol.get(signal.ticker)
    const opportunity: TodayOpportunity = {
      signal,
      confluence,
      score: scoreTodayOpportunity(signal, confluence),
    }
    const existing = byTicker.get(signal.ticker)
    if (!existing) {
      byTicker.set(signal.ticker, opportunity)
      continue
    }
    if (
      opportunity.score.total > existing.score.total ||
      (opportunity.score.total === existing.score.total && signalPriority(signal, confluence) > signalPriority(existing.signal, existing.confluence))
    ) {
      byTicker.set(signal.ticker, opportunity)
    }
  }
  return Array.from(byTicker.values()).sort((a, b) => {
    if (b.score.total !== a.score.total) return b.score.total - a.score.total
    const timeDelta = recordTimeMs(stockSignalTime(b.signal)) - recordTimeMs(stockSignalTime(a.signal))
    if (timeDelta !== 0) return timeDelta
    return signalPriority(b.signal, b.confluence) - signalPriority(a.signal, a.confluence)
  })
}

function buildWeeklyFeaturedRecords(
  records: RadarHistoryRecord[],
  tradeDate: string,
  radarConfluence: RadarConfluenceSignal[] = [],
  paperConfluence: PaperConfluenceSignal[] = [],
): WeeklyFeaturedRecord[] {
  const startDate = shiftChinaDate(tradeDate, -6)
  const byId = new Map<string, WeeklyFeaturedRecord>()
  const confluenceTickerDates = new Set<string>()

  for (const signal of buildWeeklyRadarConfluence(records, startDate, tradeDate)) {
    const record = radarConfluenceToHistoryRecord(signal)
    const signalDate = signalDateInChina(record.recommendedAt)
    if (!signalDate || signalDate < startDate || signalDate > tradeDate) continue
    confluenceTickerDates.add(`${signalDate}:${record.ticker}`)
    byId.set(record.id, {
      record,
      score: scoreRadarConfluenceSignal(signal),
      source: "radar-confluence",
    })
  }

  for (const signal of radarConfluence) {
    const record = radarConfluenceToHistoryRecord(signal)
    const signalDate = signalDateInChina(record.recommendedAt)
    if (!signalDate || signalDate < startDate || signalDate > tradeDate) continue
    confluenceTickerDates.add(`${signalDate}:${record.ticker}`)
    byId.set(record.id, {
      record,
      score: scoreRadarConfluenceSignal(signal),
      source: "radar-confluence",
    })
  }

  for (const signal of paperConfluence) {
    const record = paperConfluenceToHistoryRecord(signal)
    const signalDate = signalDateInChina(record.recommendedAt)
    if (!signalDate || signalDate < startDate || signalDate > tradeDate) continue
    byId.set(record.id, {
      record,
      score: scorePaperConfluenceSignal(signal),
      source: "paper-confluence",
    })
  }

  for (const record of records) {
    const signalDate = signalDateInChina(record.recommendedAt)
    if (!signalDate || signalDate < startDate || signalDate > tradeDate) continue
    if (record.lifecycleStage === "candidate") continue
    if (confluenceTickerDates.has(`${signalDate}:${record.ticker}`)) continue

    const signal = radarHistoryRecordToSignal(record)
    const score = scoreTodayOpportunity(signal)
    const isConfluence = record.strategyId === PAPER_CONFLUENCE_STRATEGY_ID
    if (!isConfluence && score.total < FEATURED_BUY_SCORE_MIN) continue

    if (!byId.has(record.id)) byId.set(record.id, {
      record,
      score,
      source: isConfluence ? "paper-confluence" : "single",
    })
  }

  return dedupeWeeklyFeaturedRecords(Array.from(byId.values()))
    .sort((a, b) => {
      const dateDelta = recordDateValue(b.record.recommendedAt) - recordDateValue(a.record.recommendedAt)
      if (dateDelta !== 0) return dateDelta
      if (b.score.total !== a.score.total) return b.score.total - a.score.total
      const openDelta = Number(isOpenWeeklyRecord(b.record)) - Number(isOpenWeeklyRecord(a.record))
      if (openDelta !== 0) return openDelta
      return recordTimeMs(b.record.recommendedAt) - recordTimeMs(a.record.recommendedAt)
    })
    .filter(limitWeeklyRecordsByDay())
    .slice(0, WEEKLY_FEATURED_MAX)
}

function dedupeWeeklyFeaturedRecords(records: WeeklyFeaturedRecord[]) {
  const byTickerDate = new Map<string, WeeklyFeaturedRecord>()
  for (const item of records) {
    const date = signalDateInChina(item.record.recommendedAt) ?? item.record.recommendedAt.slice(0, 10)
    const key = `${date}:${item.record.ticker}`
    const existing = byTickerDate.get(key)
    if (!existing || isBetterWeeklyRecord(item, existing)) {
      byTickerDate.set(key, item)
    }
  }
  return Array.from(byTickerDate.values())
}

function isBetterWeeklyRecord(candidate: WeeklyFeaturedRecord, existing: WeeklyFeaturedRecord) {
  const candidateSourceRank = weeklySourceRank(candidate.source)
  const existingSourceRank = weeklySourceRank(existing.source)
  if (candidateSourceRank !== existingSourceRank) return candidateSourceRank > existingSourceRank
  if (candidate.score.total !== existing.score.total) return candidate.score.total > existing.score.total
  return recordTimeMs(candidate.record.recommendedAt) > recordTimeMs(existing.record.recommendedAt)
}

function weeklySourceRank(source: WeeklyFeaturedRecord["source"]) {
  return source === "radar-confluence"
    ? 3
    : source === "paper-confluence"
      ? 2
      : 1
}

function buildWeeklyRadarConfluence(records: RadarHistoryRecord[], startDate: string, tradeDate: string) {
  const byDate = new Map<string, StockSignal[]>()
  for (const record of records) {
    const signalDate = signalDateInChina(record.recommendedAt)
    if (!signalDate || signalDate < startDate || signalDate > tradeDate) continue
    if (record.lifecycleStage === "candidate") continue
    if (record.signalKind === "exit") continue
    const signals = byDate.get(signalDate) ?? []
    signals.push(radarHistoryRecordToSignal(record))
    byDate.set(signalDate, signals)
  }

  return Array.from(byDate.entries()).flatMap(([, signals]) =>
    buildRadarConfluenceSignals(signals, { includeCandidates: false, includeClosed: true }),
  )
}

function limitWeeklyRecordsByDay() {
  const counts = new Map<string, number>()
  return (item: WeeklyFeaturedRecord) => {
    const date = signalDateInChina(item.record.recommendedAt) ?? item.record.recommendedAt.slice(0, 10)
    const count = counts.get(date) ?? 0
    if (count >= WEEKLY_FEATURED_MAX_PER_DAY) return false
    counts.set(date, count + 1)
    return true
  }
}

function recordDateValue(value?: string) {
  const date = signalDateInChina(value)
  if (!date) return 0
  return new Date(`${date}T00:00:00+08:00`).getTime()
}

function isFeaturedBuyCandidate(opportunity: TodayOpportunity) {
  return opportunity.score.total >= FEATURED_BUY_SCORE_MIN
}

function scoreTodayOpportunity(signal: StockSignal, confluence?: RadarConfluenceSignal | PaperConfluenceSignal): UnifiedSignalScore {
  return computeUnifiedSignalScore(signal, { confluence })
}

function signalPriority(signal: StockSignal, confluence?: RadarConfluenceSignal | PaperConfluenceSignal) {
  return signalRankingScore(signal, confluence)
}

function scoreRadarConfluenceSignal(signal: RadarConfluenceSignal) {
  return computeUnifiedSignalScore(radarConfluenceToStockSignal(signal), { confluence: signal })
}

function scorePaperConfluenceSignal(signal: PaperConfluenceSignal) {
  return computeUnifiedSignalScore(paperConfluenceToStockSignal(signal), { confluence: signal })
}

function radarConfluenceToStockSignal(signal: RadarConfluenceSignal): StockSignal {
  const referencePrice = radarConfluenceReferencePrice(signal) ?? 0
  const targetPct = radarConfluenceTargetPct(signal)
  const stopPct = radarConfluenceStopPct(signal)
  const signalAt = signal.triggerAt || signal.latestAt
  const date = signalDateInChina(signalAt) ?? signalAt.slice(0, 10)
  const strongConfluence = signal.strategyCount >= 3

  return {
    ticker: signal.ticker,
    name: signal.name,
    exchange: signal.ticker.startsWith("6") ? "SH" : signal.ticker.startsWith("8") || signal.ticker.startsWith("4") ? "BJ" : "SZ",
    signalLevel: strongConfluence ? "green" : "blue",
    signalKind: strongConfluence ? "high-confidence-buy" : "add-confirm",
    price: signal.latestPrice ?? referencePrice,
    changePct: signal.returnPct,
    date,
    recommendedAt: signalAt,
    triggerPrice: referencePrice,
    returnSinceSignalPct: signal.returnPct,
    buyPoint: signal.buyPoints[0] ?? "breakout-confirm",
    reason: `${signal.strategyCount} 个上线策略共同推荐：${signal.strategyNames.slice(0, 4).join("、")}。`,
    position: { current: null, max: 20 },
    suggestion: "雷达共同推荐",
    stopLoss: { price: referencePrice ? referencePrice * (1 - stopPct / 100) : 0, riskPct: stopPct },
    invalidation: { price: referencePrice ? referencePrice * (1 - stopPct / 100) : 0, reason: "雷达共振跌破风控价" },
    winRatePct: strongConfluence ? 64 : 59,
    oddsRatio: targetPct / Math.max(stopPct, 1),
    upsidePct: targetPct,
    priceSource: "qveris-realtime",
    strategyId: "radar-confluence",
    strategyName: "雷达共同推荐",
  }
}

function paperConfluenceToStockSignal(signal: PaperConfluenceSignal): StockSignal {
  const referencePrice = confluenceReferencePrice(signal) ?? 0
  const targetPct = confluenceTargetPct(signal)
  const stopPct = confluenceStopPct(signal)
  const signalAt = signal.triggerAt || signal.latestAt
  const date = signalDateInChina(signalAt) ?? signalAt.slice(0, 10)
  const strongConfluence = signal.strategyCount >= 3 || signal.filledStrategyCount >= 2

  return {
    ticker: signal.symbol,
    name: signal.name,
    exchange: signal.symbol.startsWith("6") ? "SH" : signal.symbol.startsWith("8") || signal.symbol.startsWith("4") ? "BJ" : "SZ",
    signalLevel: strongConfluence ? "green" : "blue",
    signalKind: strongConfluence ? "high-confidence-buy" : "add-confirm",
    price: referencePrice,
    changePct: 0,
    date,
    recommendedAt: signalAt,
    triggerPrice: referencePrice,
    returnSinceSignalPct: 0,
    buyPoint: "breakout-confirm",
    reason: signal.note,
    position: { current: null, max: 20 },
    suggestion: confluenceActionLabel(signal),
    stopLoss: { price: referencePrice ? referencePrice * (1 - stopPct / 100) : 0, riskPct: stopPct },
    invalidation: { price: referencePrice ? referencePrice * (1 - stopPct / 100) : 0, reason: "多策略共振跌破风控价" },
    winRatePct: strongConfluence ? 64 : 60,
    oddsRatio: targetPct / Math.max(stopPct, 1),
    upsidePct: targetPct,
    priceSource: "qveris-realtime",
    strategyId: PAPER_CONFLUENCE_STRATEGY_ID,
    strategyName: "多策略共振",
  }
}

function radarConfluenceToHistoryRecord(signal: RadarConfluenceSignal): RadarHistoryRecord {
  const signalAt = signal.triggerAt || signal.latestAt
  const price = round2(radarConfluenceReferencePrice(signal) ?? 0)
  const latestPrice = round2(signal.latestPrice ?? price)
  const targetPct = radarConfluenceTargetPct(signal)
  const stopPct = radarConfluenceStopPct(signal)
  const signalDate = signalDateInChina(signalAt) ?? signalAt.slice(0, 10)

  return {
    id: `radar-confluence:${signalDate}:${signal.ticker}`,
    recommendedAt: signalAt,
    latestQuoteAt: signal.latestAt,
    ticker: signal.ticker,
    name: signal.name,
    strategyId: "radar-confluence",
    strategyName: "雷达共同推荐",
    signalKind: signal.strategyCount >= 3 ? "high-confidence-buy" : "add-confirm",
    buyPoint: signal.buyPoints[0] ?? "breakout-confirm",
    lifecycleStage: "triggered",
    lifecycleStatus: "open",
    signal: signal.strategyCount >= 3 ? "多策略高共振买入" : "多策略加仓确认",
    triggerPrice: price,
    latestPrice,
    returnPct: signal.returnPct,
    maxReturnPct: signal.maxReturnPct,
    maxDrawdownPct: Math.min(signal.returnPct, 0),
    holdDays: 0,
    stopLossPrice: round2(price * (1 - stopPct / 100)),
    targetPrice: round2(price * (1 + targetPct / 100)),
    priceStatus: "tracked",
    status: "跟踪中",
    note: `${signal.strategyCount} 个上线策略共同推荐：${signal.strategyNames.slice(0, 4).join("、")}；该记录来自策略雷达账本，模拟盘成交情况需看实盘模拟。`,
  }
}

function paperConfluenceToHistoryRecord(signal: PaperConfluenceSignal): RadarHistoryRecord {
  const signalAt = signal.triggerAt || signal.latestAt
  const price = round2(confluenceReferencePrice(signal) ?? 0)
  const targetPct = confluenceTargetPct(signal)
  const stopPct = confluenceStopPct(signal)
  const signalDate = signalDateInChina(signalAt) ?? signalAt.slice(0, 10)

  return {
    id: `${PAPER_CONFLUENCE_STRATEGY_ID}:${signalDate}:${signal.symbol}`,
    recommendedAt: signalAt,
    latestQuoteAt: signal.latestAt,
    ticker: signal.symbol,
    name: signal.name,
    strategyId: PAPER_CONFLUENCE_STRATEGY_ID,
    strategyName: "多策略成交共振",
    signalKind: signal.strategyCount >= 3 || signal.filledStrategyCount >= 2 ? "high-confidence-buy" : "add-confirm",
    buyPoint: "multi-strategy-confluence",
    lifecycleStage: "triggered",
    lifecycleStatus: "open",
    signal: "多策略成交共振",
    triggerPrice: price,
    latestPrice: price,
    returnPct: 0,
    maxReturnPct: 0,
    maxDrawdownPct: 0,
    holdDays: 0,
    stopLossPrice: round2(price * (1 - stopPct / 100)),
    targetPrice: round2(price * (1 + targetPct / 100)),
    priceStatus: "tracked",
    status: "跟踪中",
    note: `${signal.filledStrategyCount}/${signal.strategyCount} 个策略已模拟成交：${signal.strategyNames.slice(0, 4).join("、")}；该记录来自多策略模拟盘成交账本。`,
  }
}

function isExecutablePaperConfluence(signal: PaperConfluenceSignal) {
  return signal.status === "filled" && signal.filledStrategyCount >= 2 && signal.totalShares > 0
}

function signalDateInChina(value?: string) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" })
}

function recordTimeMs(value?: string) {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

function isOpenWeeklyRecord(record: RadarHistoryRecord) {
  return inferWeeklyLifecycle(record) === "open"
}

function weeklyDisplayState(record: RadarHistoryRecord, tradeDate?: string): {
  lifecycle: "open" | "target-hit" | "stopped" | "expired"
  label: string
  tone: "good" | "bad" | "neutral"
  isOpen: boolean
  returnPct: number
  mfePct: number
  maePct: number
  holdDays: number
  holdSub: string
  displayPrice: number
  priceSub?: string
  note: string
} {
  const inferredLifecycle = inferWeeklyLifecycle(record)
  const isOpen = inferredLifecycle === "open"
  const displayPrice = weeklyDisplayPrice(record, inferredLifecycle)
  const returnPct = weeklyReturnPct(record, displayPrice)
  const mfePct = Math.max(validNumber(record.maxReturnPct, returnPct), returnPct)
  const maePct = Math.min(validNumber(record.maxDrawdownPct, Math.min(returnPct, 0)), returnPct, 0)
  const holdDays = weeklyHoldDays(record, tradeDate, inferredLifecycle)
  const label = weeklyLifecycleLabel(record, inferredLifecycle, returnPct)
  const tone = weeklyLifecycleTone(inferredLifecycle, returnPct)
  const closedTime = record.closedAt ? formatSignalTime(record.closedAt) : undefined
  const priceSub = record.priceStatus === "pending-follow-up" && isOpen
    ? "待后续行情"
    : isOpen
      ? undefined
      : closedTime ?? "按风控价"
  const holdSub = isOpen ? "跟踪中" : label
  const note = weeklyStateNote(record, inferredLifecycle, returnPct)

  return {
    lifecycle: inferredLifecycle,
    label,
    tone,
    isOpen,
    returnPct,
    mfePct,
    maePct,
    holdDays,
    holdSub,
    displayPrice,
    priceSub,
    note,
  }
}

function inferWeeklyLifecycle(record: RadarHistoryRecord): "open" | "target-hit" | "stopped" | "expired" {
  const lifecycle = radarLifecycleStatus(record)
  if (lifecycle !== "open") return lifecycle
  if (record.priceStatus === "pending-follow-up") return "open"
  const latestPrice = positivePrice(record.latestPrice)
  const targetPrice = positivePrice(record.targetPrice)
  const stopLossPrice = positivePrice(record.stopLossPrice)
  if (targetPrice !== null && latestPrice !== null && latestPrice >= targetPrice) {
    return "target-hit"
  }
  if (stopLossPrice !== null && latestPrice !== null && latestPrice <= stopLossPrice) {
    return "stopped"
  }
  return "open"
}

function weeklyDisplayPrice(record: RadarHistoryRecord, lifecycle: "open" | "target-hit" | "stopped" | "expired") {
  const targetPrice = positivePrice(record.targetPrice)
  const stopLossPrice = positivePrice(record.stopLossPrice)
  const latestPrice = positivePrice(record.latestPrice)
  if (lifecycle === "target-hit" && targetPrice !== null) return targetPrice
  if (lifecycle === "stopped" && stopLossPrice !== null) return stopLossPrice
  if (latestPrice !== null) return latestPrice
  return record.triggerPrice
}

function weeklyReturnPct(record: RadarHistoryRecord, displayPrice: number) {
  if (record.triggerPrice > 0 && Number.isFinite(displayPrice)) {
    return (displayPrice / record.triggerPrice - 1) * 100
  }
  return validNumber(record.returnPct, 0)
}

function weeklyLifecycleLabel(
  record: RadarHistoryRecord,
  lifecycle: "open" | "target-hit" | "stopped" | "expired",
  returnPct: number,
) {
  if (record.priceStatus === "pending-follow-up" && lifecycle === "open") return "待行情"
  if (lifecycle === "open") return "跟踪中"
  if (lifecycle === "target-hit") return "已止盈"
  if (lifecycle === "expired") return "到期"
  if (returnPct > 0.05) return "风控卖出"
  if (returnPct < -0.05) return "已止损"
  return "平价退出"
}

function weeklyLifecycleTone(lifecycle: "open" | "target-hit" | "stopped" | "expired", returnPct: number): "good" | "bad" | "neutral" {
  if (lifecycle === "target-hit") return "good"
  if (lifecycle === "stopped") return returnPct >= 0 ? "neutral" : "bad"
  if (lifecycle === "expired") return returnPct >= 0 ? "neutral" : "bad"
  return returnPct >= 0 ? "good" : "neutral"
}

function weeklyStateNote(
  record: RadarHistoryRecord,
  lifecycle: "open" | "target-hit" | "stopped" | "expired",
  returnPct: number,
) {
  if (lifecycle === "target-hit") {
    return `已触达止盈目标 ${formatMaybePrice(record.targetPrice)}，按目标位计算收益 ${formatSignedPercent(returnPct)}。${record.note}`
  }
  if (lifecycle === "stopped") {
    return `已跌破止损位置 ${formatMaybePrice(record.stopLossPrice)}，按风控价计算收益 ${formatSignedPercent(returnPct)}。${record.note}`
  }
  if (lifecycle === "expired") {
    return `已超过跟踪窗口，到期收益 ${formatSignedPercent(returnPct)}。${record.note}`
  }
  return record.note
}

function weeklyHoldDays(
  record: RadarHistoryRecord,
  tradeDate?: string,
  lifecycle: "open" | "target-hit" | "stopped" | "expired" = inferWeeklyLifecycle(record),
) {
  if (Number.isFinite(record.holdDays) && (record.holdDays ?? 0) > 0 && lifecycle !== "open") {
    return Math.max(0, Math.round(record.holdDays ?? 0))
  }
  const start = signalDateInChina(record.recommendedAt)
  const end = lifecycle === "open"
    ? tradeDate ?? signalDateInChina(record.latestQuoteAt) ?? getChinaMarketSession().tradeDate
    : signalDateInChina(record.closedAt ?? record.latestQuoteAt) ?? tradeDate ?? getChinaMarketSession().tradeDate
  if (!start || !end) return Math.max(0, Math.round(record.holdDays ?? 0))
  return Math.max(0, chinaDateDiff(start, end))
}

function chinaDateDiff(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00+08:00`).getTime()
  const end = new Date(`${endDate}T00:00:00+08:00`).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.floor((end - start) / 86_400_000)
}

function positivePrice(value?: number) {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Number(value) : null
}

function validNumber(value: unknown, fallback: number) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function buyActionLabel(signal: StockSignal) {
  if (signal.signalKind === "high-confidence-buy") return "建议买入"
  if (signal.signalKind === "add-confirm") return "建议加仓"
  if (signal.signalKind === "left-side-trial") return "小仓试买"
  if (signal.signalKind === "hold-no-add") return "持有观察"
  return "观察等待"
}

function compactStrategyName(name?: string, id?: string) {
  const fallback = id ? readableStrategyId(id) : "策略雷达"
  return (name ?? fallback).replace(/\s*\+\s*盘中确认$/, "")
}

function readableStrategyId(id: string) {
  return id
    .replace(/^mine-/, "")
    .replace(/^s-/, "")
    .split("-")
    .filter(Boolean)
    .join(" ")
}

function formatShortDate(date: string) {
  const [, month, day] = date.split("-")
  return month && day ? `${month}/${day}` : date
}

function shiftChinaDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00+08:00`)
  if (!Number.isFinite(value.getTime())) return date
  value.setUTCDate(value.getUTCDate() + days)
  return value.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" })
}

function formatSignedPercent(value: number) {
  if (Math.abs(value) < 0.005) return "0.00%"
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
}

function confluenceReferencePrice(signal: PaperConfluenceSignal) {
  const price = signal.triggerPrice ?? signal.avgPrice ?? signal.referencePrice
  return Number.isFinite(price) && price && price > 0 ? price : undefined
}

function radarConfluenceReferencePrice(signal: RadarConfluenceSignal) {
  const price = signal.triggerPrice ?? signal.latestPrice
  return Number.isFinite(price) && price && price > 0 ? price : undefined
}

function radarConfluenceTargetPct(signal: RadarConfluenceSignal) {
  return signal.strategyCount >= 4 ? 8.5 : signal.strategyCount >= 3 ? 7 : 5.5
}

function radarConfluenceStopPct(signal: RadarConfluenceSignal) {
  return signal.strategyCount >= 4 ? 4.5 : 3.5
}

function radarConfluenceTargetPrice(signal: RadarConfluenceSignal) {
  const price = radarConfluenceReferencePrice(signal)
  if (!price) return undefined
  return price * (1 + radarConfluenceTargetPct(signal) / 100)
}

function radarConfluenceStopPrice(signal: RadarConfluenceSignal) {
  const price = radarConfluenceReferencePrice(signal)
  if (!price) return undefined
  return price * (1 - radarConfluenceStopPct(signal) / 100)
}

function confluenceTargetPct(signal: PaperConfluenceSignal) {
  return signal.strategyCount >= 3 || signal.filledStrategyCount >= 2 ? 8 : 5.5
}

function confluenceStopPct(signal: PaperConfluenceSignal) {
  return signal.strategyCount >= 3 ? 4.5 : 3.5
}

function confluenceTargetPrice(signal: PaperConfluenceSignal) {
  const price = confluenceReferencePrice(signal)
  if (!price) return undefined
  return price * (1 + confluenceTargetPct(signal) / 100)
}

function confluenceStopPrice(signal: PaperConfluenceSignal) {
  const price = confluenceReferencePrice(signal)
  if (!price) return undefined
  return price * (1 - confluenceStopPct(signal) / 100)
}

function confluenceActionLabel(signal: PaperConfluenceSignal) {
  if (signal.status === "filled") return "共振买入"
  if (signal.status === "blocked") return "共振排除"
  return "共振观察"
}

function formatMaybePrice(value?: number) {
  if (!value || !Number.isFinite(value)) return "--"
  return formatPrice(value)
}

function formatMoneyCompact(value: number) {
  if (!value || !Number.isFinite(value)) return "观察"
  if (Math.abs(value) >= 10_000) return `¥${(value / 10_000).toFixed(1)}万`
  return `¥${value.toFixed(0)}`
}

function simulationConfluenceHref(signal: PaperConfluenceSignal) {
  void signal
  return `/simulation?strategy=${encodeURIComponent(PAPER_CONFLUENCE_STRATEGY_ID)}`
}

function round2(value: number) {
  return Math.round(value * 100) / 100
}
