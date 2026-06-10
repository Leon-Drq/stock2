/**
 * 真实选股引擎 — Step 1：把现有零件粘起来产生「每日 top-N 推荐」。
 *
 * 流程：
 *   1. fetchPoolBars 拉 STOCK_POOL 已预热股票 90 日 K 线（数据库优先）
 *   2. 对 3 个互补因子分别 runFactor，拿到每只股的 latestPercentile
 *      - 动量 f-mom-60d   (权重 0.40) — 趋势头部
 *      - 放量突破 f-vol-spike (权重 0.35) — 量价共振
 *      - 反转 f-rev-5d    (权重 0.25) — 反向修正，避免追到强弩之末
 *   3. 综合分 = Σ percentile_i × w_i，取 top-N
 *   4. 按综合分映射到信号灯颜色 + 用最强因子标买点 & 理由
 *   5. ATR 反推止损价（14 日 ATR × 2 作为风险距离），避免拍脑袋
 *   6. 胜率/赔率/上涨空间引用因子目录里的历史 IR / Q1Q5 — 诚实的"近似"
 *
 * 输出 StockSignal[]，可直接喂给现有 SignalCard。
 * 全部失败时降级到 fallbackReport，不阻塞页面。
 */

import { FACTORS } from "@/lib/catalog"
import { fetchPoolBars, type Bar, type StockBars } from "@/lib/qveris-data"
import { fetchLatestQuotes, type LatestQuotesResult } from "@/lib/qveris-quotes"
import type {
  SignalKind,
  SignalLevel,
  StockSignal,
  RadarReport,
} from "@/lib/radar-data"
import { fallbackReport, buyPointLabel } from "@/lib/radar-data"
import { runFactor, type FactorResult, type StockFactorSnapshot } from "@/lib/factors/engine"
import { STOCK_POOL, type StockPoolItem } from "@/lib/stock-pool"
import { buildScanUniverseDiagnostics, getRuntimeScanUniverse, type ScanUniverseDiagnostics } from "@/lib/scan-universe"
import { selectRadarPrefilterUniverse, type RadarPrefilterDiagnostics } from "@/lib/radar-prefilter"
import { computeTechSnapshot } from "@/lib/technicals"
import { judgeBuyPoint } from "@/lib/buy-point-engine"
import { type RadarStrategyConfig, type StrategyFactorId } from "@/lib/strategy-registry"
import { type StrategyRegistryEntry } from "@/lib/strategy-registry-store"
import { strategyDeploymentDecision } from "@/lib/strategy-deployment"
import { selectExecutableRadarStrategies, type RadarStrategyCandidate } from "@/lib/radar-strategy-selector"
import { anchorRadarSignals } from "@/lib/radar-signal-store"
import { buildIntradaySignalsFromMarket } from "@/lib/intraday-radar"
import { getChinaMarketSession, getLatestCompletedChinaTradeDate, shouldRunRadarScan, shouldTrackRadarPrices, type ChinaMarketSession } from "@/lib/cn-market-session"
import { signalRankingScore, type SignalConfluenceInput } from "@/lib/signal-score"

type ContributingFactor = {
  id: StrategyFactorId
  weight: number
  /** 因子名（来自 catalog） */
  label: string
}

type RadarAdmissionState = {
  admitted: boolean
  statusLabel: "雷达候选" | "观察池" | "模拟上线" | "模拟观察"
  reason: string
  profile: {
    annualReturn: number
    maxDrawdown: number
    sharpe: number
    winRate: number
  }
  source: "registry" | "fallback"
}

type RadarDataFreshness = {
  latestBarDate?: string
  latestDailyBarDate?: string
  latestQuoteDate?: string
  effectiveDataDate?: string
  expectedTradeDate: string
  expectedDailyDate: string
  staleStockCount?: number
  dailyDataStale: boolean
  blocksNewSignals: boolean
  blocksPriceTracking: boolean
  staleReason?: string
}

type RadarStrategyRun = RadarStrategyCandidate & {
  admission: RadarAdmissionState
  factorWeights: ContributingFactor[]
  scored: ScoredStock[]
  candidatePicks: ScoredStock[]
}

// ─────────────────────────────────────────────────────────────
// 工具：ATR / 涨幅 / 上涨空间
// ─────────────────────────────────────────────────────────────

/** 14 日 ATR，用 True Range 简化版（不引入 EMA，纯算术平均） */
function atr14(bars: Bar[]): number | null {
  if (bars.length < 15) return null
  const tail = bars.slice(-15)
  let sum = 0
  for (let i = 1; i < tail.length; i++) {
    const h = tail[i].high
    const l = tail[i].low
    const pc = tail[i - 1].close
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))
    sum += tr
  }
  return sum / 14
}

/** 较昨收涨跌幅 % */
function lastChangePct(bars: Bar[]): number {
  if (bars.length < 2) return 0
  const last = bars[bars.length - 1].close
  const prev = bars[bars.length - 2].close
  if (!prev) return 0
  return (last / prev - 1) * 100
}

// ─────────────────────────────────────────────────────────────
// 综合打分 + 信号生成
// ─────────────────────────────────────────────────────────────

type ScoredStock = {
  symbol: string
  /** 综合分 0–1 */
  compositeScore: number
  /** 贡献最大的因子 */
  topFactor: ContributingFactor
  /** top factor 的分位 */
  topPercentile: number
  /** 每个因子的快照引用，用于读价格、行业、来源 */
  snapshot: StockFactorSnapshot
  bars: Bar[]
}

/**
 * 把「综合分 + 技术事件强度」映射到信号灯：
 *   - score ≥ 0.85 且事件强 ≥ 0.8 → 绿灯（高确定性）
 *   - score ≥ 0.7 且事件强 ≥ 0.6 → 蓝灯（加仓确认）
 *   - 反转/超跌主导 → 黄灯（左侧试仓）
 *   - 否则降级到指南针（观察池）
 *
 * 比之前纯看分数更稳：没有技术事件时不会强行打绿/蓝灯。
 */
function scoreToSignal(
  score: number,
  topFactorId: ContributingFactor["id"],
  eventStrength: number,
  buyPointKind: string,
): {
  level: SignalLevel
  kind: SignalKind
} {
  // 反转/超跌 → 一律左侧试仓
  if (topFactorId === "f-rev-5d" || buyPointKind === "left-side") {
    if (score >= 0.5) return { level: "yellow", kind: "left-side-trial" }
    return { level: "compass", kind: "watch" }
  }
  if (score >= 0.85 && eventStrength >= 0.8) return { level: "green", kind: "high-confidence-buy" }
  if (score >= 0.7 && eventStrength >= 0.6) return { level: "blue", kind: "add-confirm" }
  if (score >= 0.55 && eventStrength >= 0.5) return { level: "blue", kind: "add-confirm" }
  return { level: "compass", kind: "watch" }
}

/** 仓位建议文字 */
function positionSuggestion(level: SignalLevel): string {
  switch (level) {
    case "green":
      return "确认后加到 30%–50% 目标仓位"
    case "blue":
      return "确认后加至 5%–7% 仓位"
    case "yellow":
      return "左侧试仓 2%–4%，破止损出局"
    default:
      return "纳入观察池，等待信号增强"
  }
}

// ─────────────────────────────────────────────────────────────
// 主入口：构建 RadarReport
// ─────────────────────────────────────────────────────────────

export type BuildOptions = {
  /** true = 真调 Qveris；false = 全 mock，仅用于本地预览 */
  useReal: boolean
  /** 取前 N 只信号，默认 5 */
  topN?: number
  marketSession?: ChinaMarketSession
  allowNewSignals?: boolean
  allowPriceUpdates?: boolean
  includePaperWatch?: boolean
  strategyIds?: string[]
  signalScope?: "radar" | "paper"
  persistSignals?: boolean
  requireCurrentQuotes?: boolean
  scanTargetSize?: number
}

export async function buildRadarReport(opts: BuildOptions): Promise<{
  report: RadarReport
  diagnostics: {
    source: "qveris+factors" | "mock+factors" | "fallback"
    qverisCount: number
    mockCount: number
    quoteCount: number
    quoteTotal: number
    quoteFetchedAt?: string
    quoteCacheAgeMs?: number
    quoteTtlMs?: number
    quoteFallbackReason?: string
    scanUniverse?: ScanUniverseDiagnostics
    intradayRadar?: {
      scanned: number
      quoted: number
      triggered: number
      patterns: Record<string, number>
    }
    marketSession: ChinaMarketSession
    factorIRs: { id: string; meanIC: number; ir: number }[]
    dataFreshness?: RadarDataFreshness
    fallbackReason?: string
  }
}> {
  const topN = opts.topN ?? 5
  const marketSession = opts.marketSession ?? getChinaMarketSession()
  const strategySelections = await selectExecutableRadarStrategies(8, {
    includePaperWatch: opts.includePaperWatch,
    strategyIds: opts.strategyIds,
  })
  const primarySelection = strategySelections.strategies[0]
  if (!primarySelection) {
    return emptyStrategyReport({
      generatedAt: new Date().toISOString(),
      marketSession,
      reason: opts.strategyIds?.length
        ? `未找到可执行策略：${opts.strategyIds.join(" / ")}。`
        : "未找到可执行策略。",
    })
  }
  const strategySelection = {
    strategy: primarySelection.strategy,
    entry: primarySelection.entry,
    source: primarySelection.source,
    skipped: strategySelections.skipped,
  }
  const activeStrategy = strategySelection.strategy
  const baseScanUniverse = await getRuntimeScanUniverse("radar", { targetSize: opts.scanTargetSize })
  const prefilterLimit = numberEnv("RADAR_DEEP_SCAN_TOP_N", numberEnv("RADAR_PREFILTER_TOP_N", 80))
  const prefilter = await prefilterRadarPool(baseScanUniverse.stocks, prefilterLimit, opts.useReal)
  const radarPool = prefilter.stocks
  const scanUniverse = {
    ...baseScanUniverse,
    stocks: radarPool,
    note: prefilter.diagnostics
      ? `${baseScanUniverse.note} ${prefilter.diagnostics.note}`
      : baseScanUniverse.note,
  }
  const factorWeights: ContributingFactor[] = activeStrategy.factorWeights.map((factor) => ({ ...factor }))
  const signalScope = opts.signalScope ?? "radar"
  const strategyAdmission = radarStrategyAdmission(activeStrategy, strategySelection.entry, strategySelection.source, signalScope)
  const extraStrategyRuns = strategySelections.strategies.slice(1).map((selection) => ({
    ...selection,
    admission: radarStrategyAdmission(selection.strategy, selection.entry, selection.source, signalScope),
    factorWeights: selection.strategy.factorWeights.map((factor) => ({ ...factor })),
  }))
  const admittedStrategyCount = [strategyAdmission, ...extraStrategyRuns.map((run) => run.admission)].filter((admission) => admission.admitted).length
  const requestedAllowNewSignals = (opts.allowNewSignals ?? shouldRunRadarScan(marketSession)) && admittedStrategyCount > 0
  const requestedAllowPriceUpdates = opts.allowPriceUpdates ?? shouldTrackRadarPrices(marketSession)
  let quoteResult: LatestQuotesResult | null = null

  // 1. 拉 K 线
  let fetchResult: Awaited<ReturnType<typeof fetchPoolBars>>
  try {
    fetchResult = await fetchPoolBars({
      lookbackDays: Math.max(...strategySelections.strategies.map((selection) => radarLookbackDays(selection.strategy))),
      useReal: opts.useReal,
      databaseOnly: opts.useReal,
      pool: radarPool,
    })
  } catch (err) {
    return {
      report: sessionScopedFallbackReport(fallbackReport, marketSession, requestedAllowNewSignals),
      diagnostics: {
        source: "fallback",
        qverisCount: 0,
        mockCount: 0,
        quoteCount: 0,
        quoteTotal: 0,
        marketSession,
        factorIRs: [],
        fallbackReason: err instanceof Error ? err.message : String(err),
      },
    }
  }

  // 没有任何有效 K 线 → 兜底
  if (!fetchResult.stocks.length || fetchResult.stocks.every((s) => s.bars.length < 30)) {
    return {
      report: sessionScopedFallbackReport(fallbackReport, marketSession, requestedAllowNewSignals),
      diagnostics: {
        source: "fallback",
        qverisCount: fetchResult.qverisCount,
        mockCount: fetchResult.mockCount,
        quoteCount: 0,
        quoteTotal: fetchResult.totalSymbols,
        marketSession,
        factorIRs: [],
        fallbackReason: fetchResult.fallbackReason ?? "K 线数据不足",
      },
    }
  }

  const expectedDailyDate = getLatestCompletedChinaTradeDate()
  const analysisStocks = fetchResult.stocks.filter((stock) => isStockDailyFresh(stock, expectedDailyDate))
  const staleStockCount = fetchResult.stocks.length - analysisStocks.length

  if (!analysisStocks.length || analysisStocks.every((stock) => stock.bars.length < 30)) {
    const dataFreshness = assessRadarDataFreshness(fetchResult.stocks, quoteResult, marketSession, undefined, {
      expectedDailyDate,
      staleStockCount,
    })
    const report = staleDataReport({
      generatedAt: new Date().toISOString(),
      marketSession,
      activeStrategy,
      strategyAdmission,
      dataFreshness,
      fetchSummary: fetchResult,
      quoteResult,
    })

    return {
      report,
      diagnostics: {
        source: fetchResult.qverisCount > 0 ? "qveris+factors" : "mock+factors",
        qverisCount: fetchResult.qverisCount,
        mockCount: fetchResult.mockCount,
        quoteCount: 0,
        quoteTotal: fetchResult.totalSymbols,
        scanUniverse: buildScanUniverseDiagnostics({
          universe: scanUniverse,
          historyAvailable: 0,
          quoteRequested: 0,
          quoteReturned: 0,
          prefilter: prefilter.diagnostics,
        }),
        marketSession,
        factorIRs: [],
        dataFreshness,
        fallbackReason: dataFreshness.staleReason ?? "没有达到最近已完成交易日的单股 K 线。",
      },
    }
  }

  // 2. 对每个因子跑横截面
  const factorResults: Record<string, FactorResult> = {}
  const allFactorWeights = uniqueContributingFactors([
    ...factorWeights,
    ...extraStrategyRuns.flatMap((run) => run.factorWeights),
  ])
  for (const f of allFactorWeights) {
    factorResults[f.id] = runFactor(analysisStocks, f.id)
  }

  // 3. 综合打分：每个上线策略按自己的因子组合独立排名。
  const stockBySymbol = new Map<string, StockBars>(analysisStocks.map((s) => [s.symbol, s]))

  // 4. 取 top-N。日线模式按因子综合分；盘中模式改按“异动强度”重排。
  // 否则近实时 K 线只轻微改变 60/90 日因子，榜单会长期固定在同几只权重股上。
  const scored = scoreStocksForStrategy(analysisStocks, factorWeights, factorResults, stockBySymbol)
  const ranked = scored.sort((a, b) => b.compositeScore - a.compositeScore)
  let candidatePicks = ranked.slice(0, Math.min(ranked.length, Math.max(topN, topN * 3)))
  const extraCandidateRuns: RadarStrategyRun[] = extraStrategyRuns.map((run) => ({
    ...run,
    scored: scoreStocksForStrategy(analysisStocks, run.factorWeights, factorResults, stockBySymbol),
    candidatePicks: [] as ScoredStock[],
  }))
  for (const run of extraCandidateRuns) {
    run.candidatePicks = run.scored.slice(0, Math.min(run.scored.length, Math.max(topN, topN * 3)))
  }
  if (opts.useReal && fetchResult.qverisCount > 0 && (candidatePicks.length > 0 || extraCandidateRuns.some((run) => run.candidatePicks.length > 0))) {
    const candidateSymbols = new Set([
      ...candidatePicks.map((pick) => pick.symbol),
      ...extraCandidateRuns.flatMap((run) => run.candidatePicks.map((pick) => pick.symbol)),
    ])
    const quotePool = radarPool.filter((stock) => candidateSymbols.has(stock.symbol))
    quoteResult = await fetchLatestQuotes(quotePool, radarQuoteTimeouts())
    if (requestedAllowNewSignals && (opts.requireCurrentQuotes ?? marketSession.isOpen)) {
      const currentQuoteSymbols = currentQuoteSymbolSet(quoteResult, marketSession.tradeDate)
      candidatePicks = candidatePicks.filter((pick) => currentQuoteSymbols.has(pick.symbol))
      for (const run of extraCandidateRuns) {
        run.candidatePicks = run.candidatePicks.filter((pick) => currentQuoteSymbols.has(pick.symbol))
      }
    }
  }
  const latestAnalysisBarDate = maxDateString(analysisStocks.map((stock) => stock.bars[stock.bars.length - 1]?.date))
  const intraday = mergeIntradayQuotes(fetchResult.stocks, quoteResult?.quotes)
  const signalStocks = intraday.stocks
  const signalStockBySymbol = new Map<string, StockBars>(signalStocks.map((s) => [s.symbol, s]))
  const dataFreshness = assessRadarDataFreshness(signalStocks, quoteResult, marketSession, latestAnalysisBarDate, {
    expectedDailyDate,
    staleStockCount,
  })
  const allowNewSignals = requestedAllowNewSignals && !dataFreshness.blocksNewSignals
  const allowPriceUpdates = requestedAllowPriceUpdates && !dataFreshness.blocksPriceTracking

  if (dataFreshness.dailyDataStale || (requestedAllowNewSignals && dataFreshness.blocksNewSignals)) {
    const report = staleDataReport({
      generatedAt: new Date().toISOString(),
      marketSession,
      activeStrategy,
      strategyAdmission,
      dataFreshness,
      fetchSummary: fetchResult,
      quoteResult,
    })

    return {
      report,
      diagnostics: {
        source: fetchResult.qverisCount > 0 ? "qveris+factors" : "mock+factors",
        qverisCount: fetchResult.qverisCount,
        mockCount: fetchResult.mockCount,
        quoteCount: quoteResult?.qverisCount ?? 0,
        quoteTotal: quoteResult?.totalSymbols ?? candidatePicks.length,
        quoteFetchedAt: quoteResult?.fetchedAt,
        quoteCacheAgeMs: quoteResult?.cacheAgeMs,
        quoteTtlMs: quoteResult?.ttlMs,
        quoteFallbackReason: quoteResult?.fallbackReason,
        scanUniverse: buildScanUniverseDiagnostics({
          universe: scanUniverse,
          historyAvailable: fetchResult.stocks.length,
          quoteRequested: quoteResult?.totalSymbols ?? 0,
          quoteReturned: quoteResult?.qverisCount ?? 0,
          prefilter: prefilter.diagnostics,
        }),
        marketSession,
        factorIRs: [],
        dataFreshness,
        fallbackReason: dataFreshness.staleReason ?? fetchResult.fallbackReason,
      },
    }
  }
  const candidateSymbols = new Set(candidatePicks.map((pick) => pick.symbol))
  const intradayRadar = buildIntradaySignalsFromMarket({
    stocks: signalStocks.filter((stock) => candidateSymbols.has(stock.symbol)),
    quotes: quoteResult?.quotes,
    topN,
  })

  const generatedAt = new Date().toISOString()

  // 5. 转成 StockSignal —— 真实价格 + 技术指标判定 buyPoint + ATR 止损
  const dailySignals: StockSignal[] = candidatePicks.map((pick) => buildSignalFromPick({
    pick,
    strategy: activeStrategy,
    admission: strategyAdmission,
    signalStockBySymbol,
    stockBySymbol,
    quoteResult,
    intradaySymbols: intraday.symbols,
  }))
  const intradaySignals = intradayRadar.signals
    .filter((signal) => candidateSymbols.has(signal.ticker))
    .map((signal) => ({
      ...signal,
      strategyId: activeStrategy.id,
      strategyName: `${activeStrategy.name} + 盘中确认`,
      strategyVersion: activeStrategy.version,
      strategyStatus: strategyAdmission.statusLabel,
      strategyBacktest: strategyAdmission.profile,
      position: { current: signal.position.current, max: activeStrategy.risk.maxPositionPct },
    }))
  const extraSignalRuns = extraCandidateRuns.map((run) => buildExtraStrategySignals({
    run,
    topN,
    signalStocks,
    signalStockBySymbol,
    stockBySymbol,
    quoteResult,
    intradaySymbols: intraday.symbols,
  }))
  const rawSignals = [
    ...[...intradaySignals, ...dailySignals].map((signal) => applyRadarAdmission(signal, strategyAdmission)),
    ...extraSignalRuns.flatMap((run) => run.signals),
  ]
  const anchoringSignals = signalScope === "paper"
    ? rawSignals.filter(isPaperTradableSignal)
    : rawSignals
  const anchoredSignals = await anchorRadarSignals(anchoringSignals, {
    allowNewSignals,
    allowPriceUpdates,
    persist: opts.persistSignals ?? true,
  })
  const maxSignalSlots = Math.max(topN, topN * Math.max(1, admittedStrategyCount || strategySelections.strategies.length))
  const anchoredConfluence = signalConfluenceMap(anchoredSignals)
  const compareAnchoredSignals = (a: StockSignal, b: StockSignal) => compareSignals(a, b, anchoredConfluence)
  const freshSignals = anchoredSignals
    .filter((signal) => signal.signalLifecycle === "new")
    .sort(compareAnchoredSignals)
    .slice(0, maxSignalSlots)
  const trackingSignals = anchoredSignals.filter((signal) => signal.signalLifecycle === "tracking").sort(compareAnchoredSignals).slice(0, maxSignalSlots)
  const candidateSignals = anchoredSignals.filter((signal) => signal.signalLifecycle === "candidate").sort(compareAnchoredSignals).slice(0, maxSignalSlots)
  const suggestions: StockSignal[] = [...freshSignals, ...trackingSignals, ...candidateSignals]

  // 6. 构造 overview 信号灯计数
  const signalCounts: Record<SignalLevel, number> = {
    green: 0,
    yellow: 0,
    blue: 0,
    compass: 0,
    purple: 0,
    orange: 0,
    red: 0,
  }
  for (const s of freshSignals) signalCounts[s.signalLevel]++

  // 因子诊断：用 IR 作为质量分主要构成
  const factorIRs = allFactorWeights.map((f) => ({
    id: f.id,
    meanIC: round2(factorResults[f.id].meanIC),
    ir: round2(factorResults[f.id].irAnnualized),
  }))
  // 质量分 = 三个因子的均 |IR| 映射到 0-100（IR=1 → 80, IR=0.5 → 50）
  const avgAbsIR = factorIRs.reduce((s, x) => s + Math.abs(x.ir), 0) / factorIRs.length
  const qualityScore = Math.max(20, Math.min(95, Math.round(40 + avgAbsIR * 40)))

  const greenCount = signalCounts.green
  const blueCount = signalCounts.blue
  const yellowCount = signalCounts.yellow
  const conclusionParts: string[] = []
  if (greenCount > 0) conclusionParts.push(`${greenCount} 条高确定性`)
  if (blueCount > 0) conclusionParts.push(`${blueCount} 条加仓确认`)
  if (yellowCount > 0) conclusionParts.push(`${yellowCount} 条左侧试仓`)
  const topPick = freshSignals[0]
  const confluence = signalConfluence(suggestions)
  const topConfluence = confluence[0]
  const strategyLabel = `已上线 ${admittedStrategyCount}/${strategySelections.strategies.length} 个策略`
  const conclusion = topPick
    ? `${strategyLabel}并行扫描，${conclusionParts.join(" + ") || "今日无动作级信号"}；优先关注 ${topPick.name} ${topPick.ticker}（${buyPointLabel[topPick.buyPoint]}）${topConfluence ? `，${topConfluence.name} 获 ${topConfluence.strategyCount} 策略共振` : ""}。`
    : trackingSignals.length > 0
      ? `${strategyLabel}并行扫描；暂无新的首次触发信号，${trackingSignals.length} 条已触发信号继续跟踪现价和信号后涨跌。`
      : candidateSignals.length > 0
        ? `${admittedStrategyCount > 0 ? marketSession.phaseLabel : "策略准入未通过"}不新增正式触发；${candidateSignals.length} 条候选机会仅进入观察。`
      : `${strategyLabel}；今日无动作级信号，建议空仓观望。`

  const source: "qveris+factors" | "mock+factors" =
    fetchResult.qverisCount > 0 ? "qveris+factors" : "mock+factors"

  const report: RadarReport = {
    reportType: "股票雷达 | A股",
    generatedAt,
    conclusion,
    overview: {
      signals: signalCounts,
      cleanups: 0,
      qualityScore: admittedStrategyCount > 0 ? qualityScore : Math.min(qualityScore, 49),
      qualityNote: admittedStrategyCount === 0 ? "低" : qualityScore >= 70 ? "高" : qualityScore >= 50 ? "中" : "低",
      actionSignalCount: freshSignals.length,
      freshnessIssues: fetchResult.mockCount + Math.max(0, (quoteResult?.totalSymbols ?? 0) - (quoteResult?.qverisCount ?? 0)),
      runtimeErrors: 0,
      pools: [
        {
          name: "策略准入",
          count: admittedStrategyCount,
          cap: strategySelections.strategies.length,
          note: strategySelections.strategies.map((selection) => selection.strategy.name).join(" / "),
        },
        ...(strategySelection.skipped.length
          ? [{
              name: "执行缺口",
              count: strategySelection.skipped.length,
              cap: strategySelection.skipped.length,
              note: `${strategySelection.skipped[0].name} 已回测放行，但还缺雷达因子执行映射。`,
            }]
          : []),
        {
          name: totalIntradayTriggered(intradayRadar.diagnostics, extraSignalRuns) > 0 ? "多策略盘中雷达" : "多策略主雷达",
          count: scored.length + extraCandidateRuns.reduce((sum, run) => sum + run.scored.length, 0),
          cap: radarPool.length * strategySelections.strategies.length,
          note: intraday.symbols.size
            ? `${strategySelections.strategies.length} 个策略并行；盘中触发 ${totalIntradayTriggered(intradayRadar.diagnostics, extraSignalRuns)} 条，价格用 ${quoteResult?.qverisCount ?? 0}/${radarPool.length} 近实时快照`
            : `${strategySelections.strategies.length} 个策略分别取 Top ${topN}；价格用 ${quoteResult?.qverisCount ?? 0}/${radarPool.length} 近实时快照`,
        },
        {
          name: "策略共振",
          count: confluence.length,
          cap: suggestions.length,
          note: topConfluence
            ? `${topConfluence.name} ${topConfluence.ticker} 被 ${topConfluence.strategyCount} 个策略共同推荐。`
            : "暂无多策略交集；各策略仍独立输出信号。",
        },
        ...factorIRs.slice(0, 8).map((f) => ({
          name: f.id.replace("f-", "因子 "),
          count: Math.round(Math.abs(f.ir) * 100),
          note: `IR ${f.ir.toFixed(2)} / IC ${f.meanIC.toFixed(3)}`,
        })),
      ],
    },
    // 首次部署没有归档对账数据 → 不渲染 trackRecord
    trackRecord: undefined,
    suggestions,
  }

  return {
    report,
    diagnostics: {
      source,
      qverisCount: fetchResult.qverisCount,
      mockCount: fetchResult.mockCount,
      quoteCount: quoteResult?.qverisCount ?? 0,
      quoteTotal: quoteResult?.totalSymbols ?? STOCK_POOL.length,
      quoteFetchedAt: quoteResult?.fetchedAt,
      quoteCacheAgeMs: quoteResult?.cacheAgeMs,
      quoteTtlMs: quoteResult?.ttlMs,
      quoteFallbackReason: quoteResult?.fallbackReason,
      scanUniverse: buildScanUniverseDiagnostics({
        universe: scanUniverse,
        historyAvailable: analysisStocks.length,
        quoteRequested: quoteResult?.totalSymbols ?? 0,
        quoteReturned: quoteResult?.qverisCount ?? 0,
        prefilter: prefilter.diagnostics,
      }),
      intradayRadar: mergeIntradayDiagnostics([intradayRadar.diagnostics, ...extraSignalRuns.map((run) => run.intraday)]),
      marketSession,
      factorIRs,
      dataFreshness,
      fallbackReason: fetchResult.fallbackReason,
    },
  }
}

type RadarIntradayDiagnostics = {
  scanned: number
  quoted: number
  triggered: number
  patterns: Record<string, number>
}

function uniqueContributingFactors(factors: ContributingFactor[]) {
  const byId = new Map<StrategyFactorId, ContributingFactor>()
  for (const factor of factors) {
    if (!byId.has(factor.id)) byId.set(factor.id, factor)
  }
  return Array.from(byId.values())
}

async function prefilterRadarPool(
  pool: StockPoolItem[],
  limit: number,
  useReal: boolean,
): Promise<{
  stocks: StockPoolItem[]
  diagnostics?: RadarPrefilterDiagnostics
}> {
  const deepLimit = Math.max(30, Math.min(pool.length, Math.floor(limit)))
  if (!useReal || pool.length <= deepLimit) return { stocks: pool }
  const result = await selectRadarPrefilterUniverse(pool, {
    limit: deepLimit,
    minBars: numberEnv("RADAR_PREFILTER_MIN_BARS", 60),
  })
  return {
    stocks: result.stocks,
    diagnostics: result.diagnostics,
  }
}

function scoreStocksForStrategy(
  stocks: StockBars[],
  factorWeights: ContributingFactor[],
  factorResults: Record<string, FactorResult>,
  stockBySymbol: Map<string, StockBars>,
) {
  const scored: ScoredStock[] = []
  if (!factorWeights.length) return scored

  for (const stock of stocks) {
    let composite = 0
    let bestPct = -1
    let bestFactor: ContributingFactor = factorWeights[0]
    let bestSnapshot: StockFactorSnapshot | null = null
    let weightUsed = 0

    for (const factor of factorWeights) {
      const snap = factorResults[factor.id]?.snapshots.find((item) => item.symbol === stock.symbol)
      if (!snap) continue
      composite += snap.latestPercentile * factor.weight
      weightUsed += factor.weight
      if (snap.latestPercentile > bestPct) {
        bestPct = snap.latestPercentile
        bestFactor = factor
        bestSnapshot = snap
      }
    }

    const bars = stockBySymbol.get(stock.symbol)?.bars
    if (!bestSnapshot || weightUsed === 0 || !bars) continue
    scored.push({
      symbol: stock.symbol,
      compositeScore: composite / weightUsed,
      topFactor: bestFactor,
      topPercentile: bestPct,
      snapshot: bestSnapshot,
      bars,
    })
  }

  return scored.sort((a, b) => b.compositeScore - a.compositeScore)
}

function buildExtraStrategySignals({
  run,
  topN,
  signalStocks,
  signalStockBySymbol,
  stockBySymbol,
  quoteResult,
  intradaySymbols,
}: {
  run: RadarStrategyRun
  topN: number
  signalStocks: StockBars[]
  signalStockBySymbol: Map<string, StockBars>
  stockBySymbol: Map<string, StockBars>
  quoteResult: LatestQuotesResult | null
  intradaySymbols: Set<string>
}): {
  signals: StockSignal[]
  intraday: RadarIntradayDiagnostics
} {
  const candidateSymbols = new Set(run.candidatePicks.map((pick) => pick.symbol))
  const intradayRadar = buildIntradaySignalsFromMarket({
    stocks: signalStocks.filter((stock) => candidateSymbols.has(stock.symbol)),
    quotes: quoteResult?.quotes,
    topN,
  })
  const dailySignals = run.candidatePicks.map((pick) => buildSignalFromPick({
    pick,
    strategy: run.strategy,
    admission: run.admission,
    signalStockBySymbol,
    stockBySymbol,
    quoteResult,
    intradaySymbols,
  }))
  const intradaySignals = intradayRadar.signals
    .filter((signal) => candidateSymbols.has(signal.ticker))
    .map((signal) => ({
      ...signal,
      strategyId: run.strategy.id,
      strategyName: `${run.strategy.name} + 盘中确认`,
      strategyVersion: run.strategy.version,
      strategyStatus: run.admission.statusLabel,
      strategyBacktest: run.admission.profile,
      position: { current: signal.position.current, max: run.strategy.risk.maxPositionPct },
    }))

  return {
    signals: [...intradaySignals, ...dailySignals].map((signal) => applyRadarAdmission(signal, run.admission)),
    intraday: intradayRadar.diagnostics,
  }
}

function buildSignalFromPick({
  pick,
  strategy,
  admission,
  signalStockBySymbol,
  stockBySymbol,
  quoteResult,
  intradaySymbols,
}: {
  pick: ScoredStock
  strategy: RadarStrategyConfig
  admission: RadarAdmissionState
  signalStockBySymbol: Map<string, StockBars>
  stockBySymbol: Map<string, StockBars>
  quoteResult: LatestQuotesResult | null
  intradaySymbols: Set<string>
}): StockSignal {
  const stockBars = signalStockBySymbol.get(pick.symbol) ?? stockBySymbol.get(pick.symbol)
  const bars = stockBars?.bars ?? pick.bars
  const last = bars[bars.length - 1]
  const quote = quoteResult?.quotes.get(pick.symbol)
  const displayPrice = quote?.latest ?? last.close
  const usesIntradaySignal = intradaySymbols.has(pick.symbol)
  // 日线信号绑定最后一根有效 K 线；盘中信号绑定近实时快照。
  // 这样周末不会伪装成刚触发，交易日盘中又能按小时重算机会。
  const triggerPrice = usesIntradaySignal ? displayPrice : last.close
  const change = quote?.changePct ?? stockBars?.latestChangePct ?? lastChangePct(bars)
  const returnSinceSignalPct = triggerPrice > 0 ? (displayPrice / triggerPrice - 1) * 100 : 0
  const signalTime = usesIntradaySignal
    ? signalTimestamp(last.date, quote?.tradeTime ?? "09:30:00")
    : signalTimestamp(last.date, "15:00:00")
  const atr = atr14(bars) ?? displayPrice * 0.03
  const stopPriceDisplay = round2(Math.max(0.01, displayPrice - strategy.risk.atrMultiple * atr))
  const riskPct = ((displayPrice - stopPriceDisplay) / displayPrice) * 100

  const tech = computeTechSnapshot(bars)
  const verdict = tech
    ? judgeBuyPoint(tech, pick.topFactor.label, pick.topPercentile)
    : {
        buyPoint: "left-side" as const,
        reason: `${pick.topFactor.label}分位 ${(pick.topPercentile * 100).toFixed(0)}%，K 线不足无法计算技术指标`,
        eventStrength: 0.3,
        matched: "factor-only" as const,
      }

  const { level, kind } = scoreToSignal(
    pick.compositeScore,
    pick.topFactor.id,
    verdict.eventStrength,
    verdict.buyPoint,
  )
  const poolInfo = STOCK_POOL.find((stock) => stock.symbol === pick.symbol)
  const exchange: StockSignal["exchange"] = poolInfo?.symbolQveris.endsWith(".SH")
    ? "SH"
    : poolInfo?.symbolQveris.endsWith(".SZ")
      ? "SZ"
      : "SZ"

  const factorMeta = FACTORS.find((factor) => factor.id === pick.topFactor.id)
  const baseWin = factorMeta?.win ?? 55
  const winRatePct = Math.round(
    Math.max(35, Math.min(75, baseWin + (verdict.eventStrength - 0.5) * 10)),
  )
  const oddsRatio = Math.max(1, (factorMeta?.q1q5 ?? 5) / Math.max(2, riskPct))
  const upsidePct = (factorMeta?.q1q5 ?? 5) / 4 + Math.max(0, pick.compositeScore - 0.5) * 10

  return {
    ticker: pick.symbol,
    name: poolInfo?.name ?? pick.symbol,
    exchange,
    signalLevel: level,
    signalKind: kind,
    price: round2(displayPrice),
    changePct: round2(change),
    date: last.date,
    recommendedAt: signalTime,
    triggerPrice: round2(triggerPrice),
    returnSinceSignalPct: round2(returnSinceSignalPct),
    quoteTime: quote?.tradeTime,
    priceSource: quote ? "qveris-realtime" : stockBars?.source === "qveris" || stockBars?.source === "database" ? "qveris-daily" : "mock",
    buyPoint: verdict.buyPoint,
    reason: verdict.reason,
    position: { current: null, max: strategy.risk.maxPositionPct },
    suggestion: positionSuggestion(level),
    stopLoss: { price: stopPriceDisplay, riskPct: round1(riskPct) },
    winRatePct,
    oddsRatio: round1(oddsRatio),
    upsidePct: round1(upsidePct),
    strategyId: strategy.id,
    strategyName: strategy.name,
    strategyVersion: strategy.version,
    strategyStatus: admission.statusLabel,
    strategyBacktest: admission.profile,
  }
}

function mergeIntradayDiagnostics(items: RadarIntradayDiagnostics[]): RadarIntradayDiagnostics {
  const patterns: Record<string, number> = {}
  let scanned = 0
  let quoted = 0
  let triggered = 0

  for (const item of items) {
    scanned += item.scanned
    quoted += item.quoted
    triggered += item.triggered
    for (const [pattern, count] of Object.entries(item.patterns)) {
      patterns[pattern] = (patterns[pattern] ?? 0) + count
    }
  }

  return { scanned, quoted, triggered, patterns }
}

function totalIntradayTriggered(primary: RadarIntradayDiagnostics, runs: Array<{ intraday: RadarIntradayDiagnostics }>) {
  return primary.triggered + runs.reduce((sum, run) => sum + run.intraday.triggered, 0)
}

const SIGNAL_LEVEL_PRIORITY: Record<SignalLevel, number> = {
  green: 7,
  blue: 6,
  yellow: 5,
  compass: 3,
  purple: 2,
  orange: 1,
  red: 0,
}

function compareSignals(a: StockSignal, b: StockSignal, confluenceByTicker: ReadonlyMap<string, SignalConfluenceInput> = new Map()) {
  const aScore = signalRankingScore(a, confluenceByTicker.get(a.ticker))
  const bScore = signalRankingScore(b, confluenceByTicker.get(b.ticker))
  return (
    bScore - aScore ||
    SIGNAL_LEVEL_PRIORITY[b.signalLevel] - SIGNAL_LEVEL_PRIORITY[a.signalLevel] ||
    b.winRatePct - a.winRatePct ||
    b.oddsRatio - a.oddsRatio ||
    (b.returnSinceSignalPct ?? 0) - (a.returnSinceSignalPct ?? 0)
  )
}

function signalConfluence(signals: StockSignal[]) {
  const byTicker = new Map<string, {
    ticker: string
    name: string
    strategyIds: Set<string>
    strategyNames: Set<string>
  }>()

  for (const signal of signals) {
    if (signal.signalLifecycle === "closed") continue
    const strategyName = normalizeStrategyName(signal.strategyName ?? signal.strategyId ?? "未知策略")
    const strategyId = signal.strategyId ?? strategyName
    const row = byTicker.get(signal.ticker) ?? {
      ticker: signal.ticker,
      name: signal.name,
      strategyIds: new Set<string>(),
      strategyNames: new Set<string>(),
    }
    row.strategyIds.add(strategyId)
    row.strategyNames.add(strategyName)
    byTicker.set(signal.ticker, row)
  }

  return Array.from(byTicker.values())
    .map((row) => ({
      ticker: row.ticker,
      name: row.name,
      strategyCount: row.strategyIds.size,
      strategyNames: Array.from(row.strategyNames),
    }))
    .filter((row) => row.strategyCount >= 2)
    .sort((a, b) => b.strategyCount - a.strategyCount || a.ticker.localeCompare(b.ticker))
}

function signalConfluenceMap(signals: StockSignal[]) {
  return new Map<string, SignalConfluenceInput>(
    signalConfluence(signals).map((row) => [row.ticker, { strategyCount: row.strategyCount, status: "watch" }]),
  )
}

function normalizeStrategyName(name: string) {
  return name.replace(/\s*\+\s*盘中确认$/, "")
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function radarStrategyAdmission(
  strategy: RadarStrategyConfig,
  entry: StrategyRegistryEntry | undefined,
  source: RadarAdmissionState["source"],
  signalScope: "radar" | "paper" = "radar",
): RadarAdmissionState {
  if (entry) {
    return signalScope === "paper"
      ? registryPaperAdmission(entry, source)
      : registryRadarAdmission(entry, source)
  }

  return {
    admitted: false,
    statusLabel: "观察池",
    reason: "注册表尚未找到当前雷达策略的真实回测记录，先只进入候选观察。",
    profile: strategy.backtestProfile,
    source,
  }
}

function registryPaperAdmission(
  entry: StrategyRegistryEntry,
  source: RadarAdmissionState["source"],
): RadarAdmissionState {
  const profile = registryProfile(entry)
  const decision = strategyDeploymentDecision(entry)
  const admitted = decision.paper.status === "online" || decision.paper.status === "watch"

  return {
    admitted,
    statusLabel: admitted
      ? decision.paper.status === "online" ? "模拟上线" : "模拟观察"
      : "观察池",
    reason: decision.paper.reason,
    profile,
    source,
  }
}

function registryRadarAdmission(
  entry: StrategyRegistryEntry,
  source: RadarAdmissionState["source"],
): RadarAdmissionState {
  const profile = registryProfile(entry)
  const admitted = entry.status === "radar-ready"

  if (admitted) {
    return {
      admitted: true,
      statusLabel: "雷达候选",
      reason: entry.metadata?.admission?.reason ??
        `注册表放行：年化 ${profile.annualReturn.toFixed(1)}%，Sharpe ${profile.sharpe.toFixed(2)}，胜率 ${profile.winRate.toFixed(1)}%。`,
      profile,
      source,
    }
  }

  const blockers = [
    profile.annualReturn <= 0 ? `年化 ${profile.annualReturn.toFixed(1)}%` : "",
    profile.sharpe < 0.8 ? `Sharpe ${profile.sharpe.toFixed(2)}` : "",
    profile.winRate < 50 ? `胜率 ${profile.winRate.toFixed(1)}%` : "",
    profile.maxDrawdown > 18 ? `回撤 ${profile.maxDrawdown.toFixed(1)}%` : "",
  ].filter(Boolean)

  return {
    admitted: false,
    statusLabel: "观察池",
    reason: entry.metadata?.admission?.reason ??
      `${blockers.join(" / ") || "注册表未放行"} 未过雷达准入，候选只用于研究跟踪。`,
    profile,
    source,
  }
}

function registryProfile(entry: StrategyRegistryEntry) {
  return {
    annualReturn: entry.annualReturn ?? 0,
    maxDrawdown: entry.maxDrawdown ?? 0,
    sharpe: entry.sharpe ?? 0,
    winRate: entry.winRate ?? 0,
  }
}

function applyRadarAdmission(signal: StockSignal, admission: RadarAdmissionState): StockSignal {
  if (admission.admitted) {
    return { ...signal, strategyStatus: admission.statusLabel }
  }

  return {
    ...signal,
    strategyStatus: admission.statusLabel,
    suggestion: `观察，不新增正式推荐。${signal.suggestion}`,
    reason: `${signal.reason}；策略准入：${admission.reason}`,
  }
}

function isPaperTradableSignal(signal: StockSignal) {
  return signal.signalKind === "high-confidence-buy" || signal.signalKind === "add-confirm"
}

function round1(n: number) {
  return Math.round(n * 10) / 10
}

function intradayRankScore(stock: ScoredStock, strategy: RadarStrategyConfig, quote?: { changePct: number }): number {
  const bars = stock.bars
  const last = bars[bars.length - 1]
  const prev = bars[bars.length - 2]
  if (!last || !prev) return stock.compositeScore

  const changePct = quote?.changePct ?? ((last.close / prev.close - 1) * 100)
  const moveScore = clamp(Math.abs(changePct) / 3)
  const bullishScore = clamp(changePct / 2.5)
  const avgVolume = meanNumber(bars.slice(-21, -1).map((bar) => bar.volume).filter((v) => v > 0))
  const volumeRatio = avgVolume > 0 ? last.volume / avgVolume : 1
  const volumeScore = clamp((volumeRatio - 0.6) / 1.4)
  const recentHigh = Math.max(...bars.slice(-21, -1).map((bar) => bar.high))
  const recentLow = Math.min(...bars.slice(-21, -1).map((bar) => bar.low))
  const breakoutScore = recentHigh > 0 ? clamp((last.close / recentHigh - 0.985) / 0.035) : 0
  const pullbackScore = recentLow > 0 ? clamp((last.close / recentLow - 1) / 0.08) : 0
  const factorScore = stock.compositeScore
  const weights = strategy.intradayWeights

  return (
    factorScore * weights.factorBase +
    moveScore * weights.move +
    bullishScore * weights.direction +
    volumeScore * weights.volume +
    Math.max(breakoutScore, pullbackScore * 0.55) * weights.priceStructure
  )
}

function radarLookbackDays(strategy: RadarStrategyConfig) {
  let lookback = 180
  for (const factor of strategy.factorWeights) {
    if (factor.id === "f-minervini-trend") lookback = Math.max(lookback, 320)
    if (factor.id === "f-sma200-momentum" || factor.id === "f-pullback-uptrend") {
      lookback = Math.max(lookback, 260)
    }
    if (factor.id === "f-donchian-55" || factor.id === "f-atr-compression") {
      lookback = Math.max(lookback, 180)
    }
    if (factor.id === "f-absolute-momentum" || factor.id === "f-low-vol-mom" || factor.id === "f-rsi2-reversal") {
      lookback = Math.max(lookback, 180)
    }
  }
  return lookback
}

function clamp(n: number) {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function meanNumber(values: number[]) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function mergeIntradayQuotes(
  stocks: StockBars[],
  quotes?: LatestQuotesResult["quotes"],
): {
  stocks: StockBars[]
  symbols: Set<string>
} {
  const symbols = new Set<string>()
  if (!quotes?.size) return { stocks, symbols }

  const merged = stocks.map((stock) => {
    const quote = quotes.get(stock.symbol)
    const last = stock.bars[stock.bars.length - 1]
    if (!quote || !last || compareDate(quote.tradeDate, last.date) <= 0) return stock

    symbols.add(stock.symbol)
    const open = quote.open ?? last.close
    const high = Math.max(quote.high ?? quote.latest, open, quote.latest)
    const low = Math.min(quote.low ?? quote.latest, open, quote.latest)
    const intradayBar = {
      date: quote.tradeDate,
      open: round2(open),
      high: round2(high),
      low: round2(low),
      close: round2(quote.latest),
      volume: quote.volume ?? last.volume,
    }

    return {
      ...stock,
      bars: [...stock.bars, intradayBar].slice(-stock.bars.length),
      latestChangePct: quote.changePct,
    }
  })

  return { stocks: merged, symbols }
}

function compareDate(a: string, b: string) {
  return a.localeCompare(b)
}

function assessRadarDataFreshness(
  stocks: StockBars[],
  quotes: LatestQuotesResult | null,
  marketSession: ChinaMarketSession,
  latestBarDateOverride?: string,
  options: {
    expectedDailyDate?: string
    staleStockCount?: number
  } = {},
): RadarDataFreshness {
  const latestBarDate = maxDateString(stocks.map((stock) => stock.bars[stock.bars.length - 1]?.date))
  const latestDailyBarDate = latestBarDateOverride ?? latestBarDate
  const latestQuoteDate = quotes?.quotes ? maxDateString(Array.from(quotes.quotes.values()).map((quote) => quote.tradeDate)) : undefined
  const effectiveDataDate = maxDateString([latestBarDate, latestQuoteDate])
  const expectedTradeDate = marketSession.tradeDate
  const expectedDailyDate = options.expectedDailyDate ?? getLatestCompletedChinaTradeDate()
  const hasCurrentQuoteData = Boolean(latestQuoteDate && compareDate(latestQuoteDate, expectedTradeDate) >= 0)
  const hasCurrentBarData = Boolean(latestBarDate && compareDate(latestBarDate, expectedTradeDate) >= 0)
  const hasCurrentTradeData = hasCurrentQuoteData || hasCurrentBarData
  const dailyDataStale = isDailyDataStale(latestDailyBarDate, expectedDailyDate)
  const blocksPriceTracking = marketSession.isTradingDay && marketSession.allowsPriceTracking && !hasCurrentTradeData
  const blocksNewSignals = marketSession.isTradingDay && marketSession.allowsNewSignals && (!hasCurrentTradeData || dailyDataStale)
  const staleReason = !hasCurrentTradeData && (blocksNewSignals || blocksPriceTracking)
    ? `行情数据截至 ${formatCnDate(effectiveDataDate ?? latestBarDate ?? latestQuoteDate ?? "未知")}，早于当前交易日 ${formatCnDate(expectedTradeDate)}；已冻结新触发。`
    : dailyDataStale
      ? `日线/指标数据截至 ${formatCnDate(latestDailyBarDate ?? "未知")}，早于最近已完成交易日 ${formatCnDate(expectedDailyDate)}；当前报价只用于跟踪，不生成新推荐。`
      : options.staleStockCount && options.staleStockCount > 0
        ? `${options.staleStockCount} 只股票未达到最近已完成交易日 ${formatCnDate(expectedDailyDate)}，已从本轮策略扫描剔除。`
      : undefined

  return {
    latestBarDate,
    latestDailyBarDate,
    latestQuoteDate,
    effectiveDataDate,
    expectedTradeDate,
    expectedDailyDate,
    staleStockCount: options.staleStockCount,
    dailyDataStale,
    blocksNewSignals,
    blocksPriceTracking,
    staleReason,
  }
}

function isStockDailyFresh(stock: StockBars, expectedDailyDate: string) {
  const latestDate = stock.bars[stock.bars.length - 1]?.date
  return Boolean(latestDate && compareDate(latestDate.replace(/\//g, "-").slice(0, 10), expectedDailyDate) >= 0)
}

function emptyStrategyReport({
  generatedAt,
  marketSession,
  reason,
}: {
  generatedAt: string
  marketSession: ChinaMarketSession
  reason: string
}) {
  return {
    report: {
      reportType: "股票雷达 | A股",
      generatedAt,
      conclusion: reason,
      overview: {
        signals: {
          green: 0,
          yellow: 0,
          blue: 0,
          compass: 0,
          purple: 0,
          orange: 0,
          red: 0,
        },
        cleanups: 0,
        qualityScore: 0,
        qualityNote: "待确认",
        actionSignalCount: 0,
        freshnessIssues: 0,
        runtimeErrors: 1,
        pools: [{
          name: "策略选择",
          count: 0,
          cap: 1,
          note: reason,
        }],
      },
      trackRecord: undefined,
      suggestions: [],
    },
    diagnostics: {
      source: "fallback" as const,
      qverisCount: 0,
      mockCount: 0,
      quoteCount: 0,
      quoteTotal: 0,
      marketSession,
      factorIRs: [],
      fallbackReason: reason,
    },
  }
}

function staleDataReport({
  generatedAt,
  marketSession,
  activeStrategy,
  strategyAdmission,
  dataFreshness,
  fetchSummary,
  quoteResult,
}: {
  generatedAt: string
  marketSession: ChinaMarketSession
  activeStrategy: RadarStrategyConfig
  strategyAdmission: RadarAdmissionState
  dataFreshness: RadarDataFreshness
  fetchSummary: {
    qverisCount: number
    totalSymbols: number
    fallbackReason?: string
  }
  quoteResult: LatestQuotesResult | null
}): RadarReport {
  const issueCount = 1 + (quoteResult?.fallbackReason ? 1 : 0)

  return {
    reportType: "股票雷达 | A股",
    generatedAt,
    conclusion: `${marketSession.phaseLabel}，但${dataFreshness.staleReason ?? "行情数据未达到当前交易日"} 等待 Qveris 当日行情恢复后再扫描交易机会。`,
    overview: {
      signals: {
        green: 0,
        yellow: 0,
        blue: 0,
        compass: 0,
        purple: 0,
        orange: 0,
        red: 0,
      },
      cleanups: 0,
      qualityScore: 0,
      qualityNote: "待确认",
      actionSignalCount: 0,
      freshnessIssues: issueCount,
      runtimeErrors: quoteResult?.fallbackReason ? 1 : 0,
      pools: [
        {
          name: "数据新鲜度",
          count: 0,
          cap: 1,
          note: dataFreshness.staleReason,
        },
        {
          name: "策略准入",
          count: strategyAdmission.admitted ? 1 : 0,
          cap: 1,
          note: `${activeStrategy.name}：${strategyAdmission.statusLabel}，${strategyAdmission.reason} (${strategyAdmission.source})`,
        },
        {
          name: "行情覆盖",
          count: quoteResult?.qverisCount ?? 0,
          cap: quoteResult?.totalSymbols ?? STOCK_POOL.length,
          note: quoteResult?.fallbackReason ??
            `日线 ${fetchSummary.qverisCount}/${fetchSummary.totalSymbols}，最新 ${dataFreshness.effectiveDataDate ?? "未知"}`,
        },
      ],
    },
    trackRecord: undefined,
    suggestions: [],
  }
}

function maxDateString(values: Array<string | undefined>) {
  return values
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/\//g, "-").slice(0, 10))
    .sort()
    .at(-1)
}

function currentQuoteSymbolSet(quotes: LatestQuotesResult, tradeDate: string) {
  const symbols = new Set<string>()
  for (const quote of quotes.quotes.values()) {
    if (compareDate(quote.tradeDate, tradeDate) >= 0) symbols.add(quote.symbol)
  }
  return symbols
}

function isDailyDataStale(latestDailyBarDate: string | undefined, expectedTradeDate: string) {
  if (!latestDailyBarDate) return true
  if (compareDate(latestDailyBarDate, expectedTradeDate) >= 0) return false
  const ageDays = daysBetween(latestDailyBarDate, expectedTradeDate)
  return ageDays > numberEnv("RADAR_MAX_DAILY_STALE_DAYS", 7)
}

function daysBetween(startDate: string, endDate: string) {
  const start = Date.parse(`${startDate.replace(/\//g, "-").slice(0, 10)}T00:00:00+08:00`)
  const end = Date.parse(`${endDate.replace(/\//g, "-").slice(0, 10)}T00:00:00+08:00`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.POSITIVE_INFINITY
  return Math.floor((end - start) / 86_400_000)
}

function formatCnDate(date: string) {
  if (date === "未知") return date
  const normalized = date.replace(/\//g, "-").slice(0, 10)
  const [year, month, day] = normalized.split("-")
  if (!year || !month || !day) return date
  return `${year}-${month}-${day}`
}

function radarQuoteTimeouts() {
  return {
    discoverTimeoutMs: 10_000,
    callTimeoutMs: 30_000,
  }
}

function signalTimestamp(tradeDate: string, tradeTime?: string) {
  const normalizedDate = tradeDate.replace(/\//g, "-").slice(0, 10)
  const normalizedTime = tradeTime?.slice(-8) || "15:00:00"
  return `${normalizedDate}T${normalizedTime}+08:00`
}

function numberEnv(name: string, fallback: number) {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function sessionScopedFallbackReport(report: RadarReport, marketSession: ChinaMarketSession, allowNewSignals: boolean): RadarReport {
  if (allowNewSignals) return report
  return {
    ...report,
    generatedAt: marketSession.now,
    conclusion: `${marketSession.phaseLabel}不新增触发；以下仅作为候选观察，开盘后需用真实盘口重新确认。`,
    overview: {
      ...report.overview,
      actionSignalCount: 0,
    },
    suggestions: report.suggestions.map((signal) => ({
      ...signal,
      signalLifecycle: "candidate" as const,
      lifecycleStage: "candidate" as const,
      lifecycleStatus: "open" as const,
      lifecycleNote: "候选中：非交易时段不写入信号账本，等待交易时段重新确认。",
      priceStatus: "pending-follow-up" as const,
    })),
  }
}
