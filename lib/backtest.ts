import { fetchPoolBars, type Bar, type StockBars } from "@/lib/qveris-data"
import { STRATEGIES, STRATEGY_CATALOG_MIN_ANNUAL_RETURN, type Strategy, type StrategyAdmission } from "@/lib/catalog"
import { RADAR_STRATEGY, type StrategyFactorId } from "@/lib/strategy-registry"
import { STOCK_POOL } from "@/lib/stock-pool"
import { getRuntimeStockPool } from "@/lib/stock-pool-config"
import type { StrategyDraft } from "@/lib/strategy-lab"
import {
  buildFactorDataPlanForDraft,
  buildFactorDataPlanFromIds,
  type FactorDataPlan,
} from "@/lib/factor-data-bindings"
import {
  factorValueStoreKey,
  loadFactorValuesFromStore,
  saveFactorRecipesToStore,
  saveFactorValuesToStore,
  type FactorValueInput,
} from "@/lib/backtest-data-store"

export type BacktestMetric = {
  label: string
  value: string
  tone?: "good" | "bad" | "neutral"
}

export type BacktestPoint = {
  date: string
  strategy: number
  benchmark: number
  excess: number
  dailyReturn: number
  benchmarkReturn: number
  drawdown: number
  turnover: number
  holdings: string
}

export type BacktestTrade = {
  date: string
  action: "调仓" | "建仓"
  holdings: string
  turnover: number
  cashWeight: number
}

export type BacktestPositionTrade = {
  symbol: string
  name: string
  entryDate: string
  exitDate: string
  exitReason: "调仓退出" | "回测结束"
  entryPrice: number
  exitPrice: number
  weight: number
  returnPct: number
  benchmarkReturnPct: number
  alphaPct: number
  holdingDays: number
}

export type BacktestDiagnosis = {
  verdict: "可继续小样本跟踪" | "需要修正后复测" | "暂不适合上线"
  score: number
  headline: string
  tags: string[]
  admission: StrategyAdmission
  checks: Array<{
    label: string
    value: string
    tone: "good" | "warning" | "bad" | "neutral"
    note: string
  }>
  recommendations: string[]
  topWinners: BacktestPositionTrade[]
  topLosers: BacktestPositionTrade[]
  drawdownHotspot?: {
    date: string
    drawdownPct: number
    holdings: string
  }
}

export type BacktestReport = {
  strategyId: string
  title: string
  strategyName: string
  backtestSource?: Strategy["backtestSource"]
  period: { start: string; end: string; days: number }
  universe: string
  benchmark: string
  dataSource: {
    source: "qveris" | "mixed" | "mock"
    qverisCount: number
    databaseCount?: number
    total: number
    fallbackReason?: string
    finishedAt: string
  }
  factorDataPlan?: FactorDataPlan
  parameters: {
    lookbackDays: number
    momentumWindow: number
    rebalanceDays: number
    topN: number
    feeRate: number
  }
  metrics: BacktestMetric[]
  curve: BacktestPoint[]
  trades: BacktestTrade[]
  positionTrades: BacktestPositionTrade[]
  diagnosis: BacktestDiagnosis
  logs: string[]
}

type Weights = Map<string, number>
type OpenPosition = {
  symbol: string
  entryDate: string
  entryPrice: number
  weight: number
}

const MOMENTUM_WINDOW = 60
const REBALANCE_DAYS = 5
const TOP_N = 3
const FEE_RATE = 0.001
const STRATEGY_MIN_LOOKBACK = 70
const BACKTEST_LOOKBACK_DAYS = 750
const MAX_INTERACTIVE_FACTOR_VALUE_ROWS = 15_000

export type StrategyCatalogBacktest = {
  strategies: Strategy[]
  generatedAt: string
  dataSource: BacktestReport["dataSource"]
  notes: string[]
}

export type StrategyBacktestReports = {
  reports: BacktestReport[]
  generatedAt: string
  notes: string[]
}

type StrategyBacktestSummary = {
  annualReturn: number
  totalReturn: number
  maxDrawdown: number
  sharpe: number
  winRate: number
  qverisBacked: boolean
}

type CatalogFactorId = Strategy["factors"][number]
type DiagnosableStrategy = {
  name: string
  factors: string[]
  freq: Strategy["freq"]
}

type SplitValidation = {
  trainAnnual: number
  trainMaxDrawdown: number
  testAnnual: number
  testMaxDrawdown: number
  testSharpe: number
  pass: boolean
}

const barIndexCache = new WeakMap<StockBars, Map<string, Bar>>()

export async function runDefaultBacktest(): Promise<BacktestReport> {
  const stockPool = await getRuntimeStockPool().catch(() => STOCK_POOL)
  const fetched = await fetchPoolBars({
    lookbackDays: BACKTEST_LOOKBACK_DAYS,
    useReal: true,
    pool: stockPool,
    databaseOnly: true,
  })
  const stocks = fetched.stocks.filter((stock) => stock.bars.length >= MOMENTUM_WINDOW + 10)
  const source =
    fetched.qverisCount === fetched.totalSymbols
      ? "qveris"
      : fetched.qverisCount > 0
        ? "mixed"
        : "mock"

  if (stocks.length < TOP_N) {
    return emptyReport(fetched.finishedAt, fetched.fallbackReason ?? "可回测股票不足")
  }

  const dates = commonDates(stocks)
  if (dates.length < MOMENTUM_WINDOW + 10) {
    return emptyReport(fetched.finishedAt, "共同交易日不足，无法回测")
  }

  const priceBySymbol = new Map(
    stocks.map((stock) => [stock.symbol, new Map(stock.bars.map((bar) => [bar.date, bar.close]))]),
  )
  const nameBySymbol = new Map(stocks.map((stock) => [stock.symbol, stock.name]))

  let strategyEquity = 1
  let benchmarkEquity = 1
  let peak = 1
  let weights: Weights = new Map()
  let openPositions = new Map<string, OpenPosition>()
  const curve: BacktestPoint[] = []
  const trades: BacktestTrade[] = []
  const positionTrades: BacktestPositionTrade[] = []
  const logs: string[] = [
    `数据源：Qveris ${fetched.qverisCount}/${fetched.totalSymbols} 只，${source === "mock" ? "当前使用降级数据" : "历史 K 线已接入"}`,
    `策略：${RADAR_STRATEGY.name}，${RADAR_STRATEGY.factorWeights.map((factor) => `${factor.label} ${(factor.weight * 100).toFixed(0)}%`).join(" / ")}，每 ${REBALANCE_DAYS} 个交易日调仓`,
    `风险：持仓 ${RADAR_STRATEGY.holdingPeriod}，止损按 ATR×${RADAR_STRATEGY.risk.atrMultiple} 估算，单边成本 ${(FEE_RATE * 100).toFixed(2)}%`,
  ]

  for (let i = MOMENTUM_WINDOW + 1; i < dates.length; i++) {
    const date = dates[i]
    const prevDate = dates[i - 1]
    let turnover = 0

    if ((i - (MOMENTUM_WINDOW + 1)) % REBALANCE_DAYS === 0 || weights.size === 0) {
      const nextWeights = selectRadarStrategyWeights(stocks, dates, i - 1)
      closePositionTrades(positionTrades, openPositions, date, "调仓退出", stocks, priceBySymbol, nameBySymbol)
      turnover = portfolioTurnover(weights, nextWeights)
      weights = nextWeights
      openPositions = openPositionsForDate(weights, date, priceBySymbol)
      trades.push({
        date,
        action: trades.length === 0 ? "建仓" : "调仓",
        holdings: formatHoldings(weights, nameBySymbol),
        turnover,
        cashWeight: Math.max(0, 1 - sumWeights(weights)),
      })
    }

    const dailyReturn = portfolioReturn(weights, priceBySymbol, prevDate, date) - turnover * FEE_RATE
    const benchmarkReturn = equalWeightReturn(stocks, priceBySymbol, prevDate, date)
    strategyEquity *= 1 + dailyReturn
    benchmarkEquity *= 1 + benchmarkReturn
    peak = Math.max(peak, strategyEquity)
    const drawdown = strategyEquity / peak - 1

    curve.push({
      date,
      strategy: round4(strategyEquity),
      benchmark: round4(benchmarkEquity),
      excess: round4(strategyEquity - benchmarkEquity),
      dailyReturn: round4(dailyReturn),
      benchmarkReturn: round4(benchmarkReturn),
      drawdown: round4(drawdown),
      turnover: round4(turnover),
      holdings: formatHoldings(weights, nameBySymbol),
    })
  }

  closePositionTrades(positionTrades, openPositions, last(curve)?.date ?? last(dates) ?? "", "回测结束", stocks, priceBySymbol, nameBySymbol)

  const strategyReturns = curve.map((point) => point.dailyReturn)
  const benchmarkReturns = curve.map((point) => point.benchmarkReturn)
  const totalReturn = last(curve)?.strategy ?? 1
  const benchmarkTotal = last(curve)?.benchmark ?? 1
  const maxDrawdown = Math.min(...curve.map((point) => point.drawdown), 0)
  const annualReturn = Math.pow(totalReturn, 252 / Math.max(curve.length, 1)) - 1
  const benchmarkAnnual = Math.pow(benchmarkTotal, 252 / Math.max(curve.length, 1)) - 1
  const vol = std(strategyReturns) * Math.sqrt(252)
  const sharpe = vol === 0 ? 0 : (mean(strategyReturns) * 252) / vol
  const downside = std(strategyReturns.filter((x) => x < 0)) * Math.sqrt(252)
  const sortino = downside === 0 ? 0 : (mean(strategyReturns) * 252) / downside
  const winRate = strategyReturns.filter((x) => x > 0).length / Math.max(strategyReturns.length, 1)
  const beta = covariance(strategyReturns, benchmarkReturns) / Math.max(variance(benchmarkReturns), 1e-9)
  const alpha = totalReturn - benchmarkTotal
  const calmar = Math.abs(maxDrawdown) < 1e-9 ? 0 : annualReturn / Math.abs(maxDrawdown)
  const profitDays = strategyReturns.filter((x) => x > 0).length
  const lossDays = strategyReturns.filter((x) => x < 0).length
  const radarDiagnosisStrategy: DiagnosableStrategy = {
    name: RADAR_STRATEGY.name,
    factors: RADAR_STRATEGY.factorWeights.map((factor) => factor.id),
    freq: "intraday",
  }
  const diagnosis = buildDiagnosis({
    strategy: radarDiagnosisStrategy,
    curve,
    positionTrades,
    strategyReturns,
    benchmarkReturns,
    backtestSource: "Qveris",
    dataSource: {
      source,
      qverisCount: fetched.qverisCount,
      databaseCount: fetched.databaseCount,
      total: fetched.totalSymbols,
      fallbackReason: fetched.fallbackReason,
      finishedAt: fetched.finishedAt,
    },
  })

  return {
    strategyId: RADAR_STRATEGY.id,
    title: "真实历史回测",
    strategyName: RADAR_STRATEGY.name,
    backtestSource: "Qveris",
    period: {
      start: curve[0]?.date ?? dates[0],
      end: last(curve)?.date ?? last(dates) ?? "",
      days: curve.length,
    },
    universe: `A 股扩展股票池 ${stocks.length} 只`,
    benchmark: "等权股票池",
    dataSource: {
      source,
      qverisCount: fetched.qverisCount,
      databaseCount: fetched.databaseCount,
      total: fetched.totalSymbols,
      fallbackReason: fetched.fallbackReason,
      finishedAt: fetched.finishedAt,
    },
    factorDataPlan: buildFactorDataPlanFromIds(RADAR_STRATEGY.factorWeights.map((factor) => factor.id)),
    parameters: {
      lookbackDays: fetched.lookbackDays,
      momentumWindow: MOMENTUM_WINDOW,
      rebalanceDays: REBALANCE_DAYS,
      topN: TOP_N,
      feeRate: FEE_RATE,
    },
    metrics: [
      metric("策略收益", percent(totalReturn - 1), totalReturn >= benchmarkTotal ? "good" : "bad"),
      metric("策略年化收益", percent(annualReturn), annualReturn >= benchmarkAnnual ? "good" : "bad"),
      metric("超额收益", percent(alpha), alpha >= 0 ? "good" : "bad"),
      metric("基准收益", percent(benchmarkTotal - 1), "neutral"),
      metric("阿尔法", percent(alpha), alpha >= 0 ? "good" : "bad"),
      metric("贝塔", beta.toFixed(3), "neutral"),
      metric("夏普比率", sharpe.toFixed(3), sharpe >= 1 ? "good" : "neutral"),
      metric("胜率", percent(winRate), winRate >= 0.5 ? "good" : "bad"),
      metric("盈亏比", profitLossRatio(strategyReturns).toFixed(3), "neutral"),
      metric("最大回撤", percent(maxDrawdown), maxDrawdown > -0.1 ? "good" : "bad"),
      metric("索提诺比率", sortino.toFixed(3), sortino >= 1 ? "good" : "neutral"),
      metric("卡玛比率", calmar.toFixed(3), calmar >= 1 ? "good" : "neutral"),
      metric("盈利天数", String(profitDays), "good"),
      metric("亏损天数", String(lossDays), lossDays > profitDays ? "bad" : "neutral"),
      metric("策略波动率", percent(vol), "neutral"),
    ],
    curve,
    trades: trades.slice(-20).reverse(),
    positionTrades: positionTrades.slice(-120).reverse(),
    diagnosis,
    logs,
  }
}

export async function runStrategyBacktestReports(): Promise<StrategyBacktestReports> {
  return runStrategyBacktestReportsForStrategies(STRATEGIES)
}

export async function runStrategyBacktestReportsForStrategies(
  strategies: Strategy[],
  options: { notes?: string[] } = {},
): Promise<StrategyBacktestReports> {
  const stockPool = await getRuntimeStockPool().catch(() => STOCK_POOL)
  const fetched = await fetchPoolBars({
    lookbackDays: BACKTEST_LOOKBACK_DAYS,
    useReal: true,
    pool: stockPool,
    databaseOnly: true,
  })
  const source =
    fetched.qverisCount === fetched.totalSymbols
      ? "qveris"
      : fetched.qverisCount > 0
        ? "mixed"
        : "mock"
  const stocks = fetched.stocks.filter((stock) => stock.bars.length >= STRATEGY_MIN_LOOKBACK + 10)
  const dataSource: BacktestReport["dataSource"] = {
    source,
    qverisCount: fetched.qverisCount,
    databaseCount: fetched.databaseCount,
    total: fetched.totalSymbols,
    fallbackReason: fetched.fallbackReason,
    finishedAt: fetched.finishedAt,
  }

  if (stocks.length < TOP_N) {
    return {
      reports: [emptyReport(fetched.finishedAt, fetched.fallbackReason ?? "可回测股票不足")],
      generatedAt: fetched.finishedAt,
      notes: [fetched.fallbackReason ?? "可回测股票不足", ...(options.notes ?? [])],
    }
  }

  const dates = commonDates(stocks)
  if (dates.length < STRATEGY_MIN_LOOKBACK + 10) {
    return {
      reports: [emptyReport(fetched.finishedAt, "共同交易日不足，无法回测")],
      generatedAt: fetched.finishedAt,
      notes: ["共同交易日不足，无法回测", ...(options.notes ?? [])],
    }
  }

  const reports = strategies
    .map((strategy) => buildStrategyReport(strategy, stocks, dates, dataSource))
    .filter((report): report is BacktestReport => Boolean(report))
    .sort(compareBacktestReports)

  return {
    reports: reports.length ? reports : [emptyReport(fetched.finishedAt, "全部策略缺少有效信号")],
    generatedAt: fetched.finishedAt,
    notes: [
      `Qveris 历史 K 线 ${fetched.qverisCount}/${fetched.totalSymbols} 只；统一股票池 ${stocks.length} 只；区间 ${dates[0] ?? "N/A"} 至 ${last(dates) ?? "N/A"}`,
      "资金、新闻、AI、估值类因子当前用价格/量能代理信号回测；接入对应 Qveris 原始字段后可替换为全因子真实回测。",
      "回测结果已按雷达准入、诊断分、收益、超额、回撤和胜率综合排序。",
      ...(options.notes ?? []),
    ],
  }
}

export async function runCustomDraftBacktest(draft: StrategyDraft): Promise<BacktestReport> {
  const stockPool = await getRuntimeStockPool().catch(() => STOCK_POOL)
  const fetched = await fetchPoolBars({
    lookbackDays: BACKTEST_LOOKBACK_DAYS,
    useReal: true,
    pool: stockPool,
    databaseOnly: true,
  })
  const source =
    fetched.qverisCount === fetched.totalSymbols
      ? "qveris"
      : fetched.qverisCount > 0
        ? "mixed"
        : "mock"
  const dataSource: BacktestReport["dataSource"] = {
    source,
    qverisCount: fetched.qverisCount,
    databaseCount: fetched.databaseCount,
    total: fetched.totalSymbols,
    fallbackReason: fetched.fallbackReason,
    finishedAt: fetched.finishedAt,
  }
  const stocks = fetched.stocks.filter((stock) => stock.bars.length >= STRATEGY_MIN_LOOKBACK + 10)
  if (stocks.length < TOP_N) {
    return customDraftEmptyReport(draft, fetched.finishedAt, fetched.fallbackReason ?? "可回测股票不足")
  }

  const dates = commonDates(stocks)
  if (dates.length < STRATEGY_MIN_LOOKBACK + 10) {
    return customDraftEmptyReport(draft, fetched.finishedAt, "共同交易日不足，无法回测")
  }

  return await buildCustomDraftReport(draft, stocks, dates, dataSource) ?? customDraftEmptyReport(draft, fetched.finishedAt, "策略草稿缺少有效信号")
}

export async function runStrategyCatalogBacktests(): Promise<StrategyCatalogBacktest> {
  const stockPool = await getRuntimeStockPool().catch(() => STOCK_POOL)
  const fetched = await fetchPoolBars({
    lookbackDays: BACKTEST_LOOKBACK_DAYS,
    useReal: true,
    pool: stockPool,
    databaseOnly: true,
  })
  const source =
    fetched.qverisCount === fetched.totalSymbols
      ? "qveris"
      : fetched.qverisCount > 0
        ? "mixed"
        : "mock"
  const stocks = fetched.stocks.filter((stock) => stock.bars.length >= STRATEGY_MIN_LOOKBACK + 10)
  const dataSource: BacktestReport["dataSource"] = {
    source,
    qverisCount: fetched.qverisCount,
    databaseCount: fetched.databaseCount,
    total: fetched.totalSymbols,
    fallbackReason: fetched.fallbackReason,
    finishedAt: fetched.finishedAt,
  }

  if (stocks.length < TOP_N) {
    return {
      strategies: STRATEGIES.map((strategy) => ({
        ...strategy,
        backtestStatus: "待真实回测",
        backtestSource: "示例指标",
      })),
      generatedAt: fetched.finishedAt,
      dataSource,
      notes: [fetched.fallbackReason ?? "可回测股票不足，策略目录保留原始示例指标"],
    }
  }

  const dates = commonDates(stocks)
  const notes = [
    `Qveris 历史 K 线 ${fetched.qverisCount}/${fetched.totalSymbols} 只；统一股票池 ${stocks.length} 只；区间 ${dates[0] ?? "N/A"} 至 ${last(dates) ?? "N/A"}`,
    "资金、新闻、AI、估值类因子当前用价格/量能代理信号回测；后续接入对应 Qveris 原始字段后可替换为全因子回测。",
  ]

  const strategies = STRATEGIES.map((strategy) => {
    const report = buildStrategyReport(strategy, stocks, dates, dataSource)
    if (!report) {
      return {
        ...strategy,
        backtestStatus: "待真实回测" as const,
        backtestSource: "示例指标" as const,
        admission: {
          status: "blocked",
          gate: "禁止入雷达",
          score: 0,
          tags: ["样本太少"],
          reason: "缺少有效信号或共同交易日，不能进入雷达。",
        } satisfies StrategyAdmission,
        rankScore: 0,
        lastBacktestedAt: fetched.finishedAt,
      }
    }

    return {
      ...strategy,
      annualReturn: metricNumber(report, "策略年化收益"),
      maxDrawdown: Math.abs(metricNumber(report, "最大回撤")),
      sharpe: metricNumber(report, "夏普比率"),
      winRate: metricNumber(report, "胜率"),
      backtestStatus: "真实回测" as const,
      backtestSource: report.backtestSource ?? (strategy.factors.every(isDirectPriceFactor) ? "Qveris" as const : "Qveris K线代理" as const),
      admission: report.diagnosis.admission,
      rankScore: scoreBacktestReport(report),
      lastBacktestedAt: report.dataSource.finishedAt,
    }
  }).sort((a, b) => (b.rankScore ?? -1) - (a.rankScore ?? -1))
  const radarReadyCount = strategies.filter((strategy) => strategy.admission?.status === "radar-ready").length
  const watchlistCount = strategies.filter((strategy) => strategy.admission?.status === "watchlist" && strategy.annualReturn >= STRATEGY_CATALOG_MIN_ANNUAL_RETURN).length
  const clearedCount = strategies.filter((strategy) => {
    return strategy.backtestStatus !== "真实回测" || strategy.annualReturn < STRATEGY_CATALOG_MIN_ANNUAL_RETURN || strategy.admission?.status === "blocked"
  }).length
  notes.push(`准入筛选：雷达候选 ${radarReadyCount} 个，观察池 ${watchlistCount} 个，主目录清除 ${clearedCount} 个年化低于 ${STRATEGY_CATALOG_MIN_ANNUAL_RETURN}% 或未达标策略。`)

  return {
    strategies,
    generatedAt: fetched.finishedAt,
    dataSource,
    notes,
  }
}

function emptyReport(finishedAt: string, reason: string): BacktestReport {
  return {
    strategyId: RADAR_STRATEGY.id,
    title: "真实历史回测",
    strategyName: RADAR_STRATEGY.name,
    backtestSource: "示例指标",
    period: { start: "", end: "", days: 0 },
    universe: "A 股扩展股票池",
    benchmark: "等权股票池",
    dataSource: { source: "mock", qverisCount: 0, total: STOCK_POOL.length, fallbackReason: reason, finishedAt },
    factorDataPlan: buildFactorDataPlanFromIds(RADAR_STRATEGY.factorWeights.map((factor) => factor.id)),
    parameters: { lookbackDays: BACKTEST_LOOKBACK_DAYS, momentumWindow: MOMENTUM_WINDOW, rebalanceDays: REBALANCE_DAYS, topN: TOP_N, feeRate: FEE_RATE },
    metrics: [],
    curve: [],
    trades: [],
    positionTrades: [],
    diagnosis: emptyDiagnosis(reason),
    logs: [reason],
  }
}

function customDraftEmptyReport(draft: StrategyDraft, finishedAt: string, reason: string): BacktestReport {
  const factorIds = draftFactorIds(draft)
  const factorDataPlan = buildFactorDataPlanForDraft(draft)
  return {
    strategyId: buildDraftStrategyId(draft),
    title: "真实历史回测",
    strategyName: draft.name,
    backtestSource: backtestSourceForFactorDataPlan(factorDataPlan),
    period: { start: "", end: "", days: 0 },
    universe: draft.dsl.universe || draft.market || "自定义股票池",
    benchmark: "等权股票池",
    dataSource: { source: "mock", qverisCount: 0, total: STOCK_POOL.length, fallbackReason: reason, finishedAt },
    factorDataPlan,
    parameters: {
      lookbackDays: BACKTEST_LOOKBACK_DAYS,
      momentumWindow: STRATEGY_MIN_LOOKBACK,
      rebalanceDays: parseDraftRebalanceDays(draft.dsl.rebalance),
      topN: TOP_N,
      feeRate: FEE_RATE,
    },
    metrics: [],
    curve: [],
    trades: [],
    positionTrades: [],
    diagnosis: emptyDiagnosis(reason),
    logs: [
      `策略实验室草稿：${draft.name}`,
      `因子：${factorIds.length ? factorIds.join(" / ") : "无可解析因子"}`,
      reason,
    ],
  }
}

function backtestSourceForFactorDataPlan(plan: FactorDataPlan): Strategy["backtestSource"] {
  return plan.proxyCount === 0 && plan.missingCount === 0 ? "Qveris" : "Qveris K线代理"
}

async function buildCustomDraftReport(
  draft: StrategyDraft,
  stocks: StockBars[],
  dates: string[],
  dataSource: BacktestReport["dataSource"],
): Promise<BacktestReport | null> {
  const factorIds = draftFactorIds(draft)
  const minIndex = STRATEGY_MIN_LOOKBACK + 1
  if (dates.length < minIndex + 10) return null

  const priceBySymbol = new Map(
    stocks.map((stock) => [stock.symbol, new Map(stock.bars.map((bar) => [bar.date, bar.close]))]),
  )
  const nameBySymbol = new Map(stocks.map((stock) => [stock.symbol, stock.name]))
  const rebalanceDays = parseDraftRebalanceDays(draft.dsl.rebalance)
  const targetCount = Math.min(TOP_N, stocks.length)
  const factorDataPlan = buildFactorDataPlanForDraft(draft)
  const backtestSource = backtestSourceForFactorDataPlan(factorDataPlan)
  const persistedFactors = await prepareDraftFactorArtifacts({
    draft,
    factorDataPlan,
    stocks,
    dates,
    rebalanceDays,
    minIndex,
  })

  let strategyEquity = 1
  let benchmarkEquity = 1
  let peak = 1
  let weights: Weights = new Map()
  let openPositions = new Map<string, OpenPosition>()
  const curve: BacktestPoint[] = []
  const trades: BacktestTrade[] = []
  const positionTrades: BacktestPositionTrade[] = []
  const logs = [
    `策略实验室导入：${draft.name}`,
    `数据源：Qveris ${dataSource.qverisCount}/${dataSource.total} 只，${dataSource.source === "mock" ? "当前使用降级数据" : "历史 K 线已接入"}`,
    `因子：${factorIds.join(" / ")}，每 ${rebalanceDays} 个交易日调仓，Top${targetCount}`,
    backtestSource === "Qveris K线代理"
      ? "说明：自定义或非价格类因子当前用 Qveris 真实 K 线构造代理信号回测。"
      : "说明：该策略因子可直接由 Qveris K 线计算。",
    persistedFactors.message,
  ]

  for (let i = minIndex; i < dates.length; i++) {
    const date = dates[i]
    const prevDate = dates[i - 1]
    let turnover = 0

    if ((i - minIndex) % rebalanceDays === 0 || weights.size === 0) {
      const nextWeights = selectDraftStrategyWeights(draft, stocks, dates, i - 1, targetCount, persistedFactors.lookup)
      if (!nextWeights.size) return null
      closePositionTrades(positionTrades, openPositions, date, "调仓退出", stocks, priceBySymbol, nameBySymbol)
      turnover = portfolioTurnover(weights, nextWeights)
      weights = nextWeights
      openPositions = openPositionsForDate(weights, date, priceBySymbol)
      trades.push({
        date,
        action: trades.length === 0 ? "建仓" : "调仓",
        holdings: formatHoldings(weights, nameBySymbol),
        turnover,
        cashWeight: Math.max(0, 1 - sumWeights(weights)),
      })
    }

    const dailyReturn = portfolioReturn(weights, priceBySymbol, prevDate, date) - turnover * FEE_RATE
    const benchmarkReturn = equalWeightReturn(stocks, priceBySymbol, prevDate, date)
    strategyEquity *= 1 + dailyReturn
    benchmarkEquity *= 1 + benchmarkReturn
    peak = Math.max(peak, strategyEquity)
    const drawdown = strategyEquity / peak - 1

    curve.push({
      date,
      strategy: round4(strategyEquity),
      benchmark: round4(benchmarkEquity),
      excess: round4(strategyEquity - benchmarkEquity),
      dailyReturn: round4(dailyReturn),
      benchmarkReturn: round4(benchmarkReturn),
      drawdown: round4(drawdown),
      turnover: round4(turnover),
      holdings: formatHoldings(weights, nameBySymbol),
    })
  }

  if (!curve.length) return null
  closePositionTrades(positionTrades, openPositions, last(curve)?.date ?? last(dates) ?? "", "回测结束", stocks, priceBySymbol, nameBySymbol)
  const strategyReturns = curve.map((point) => point.dailyReturn)
  const benchmarkReturns = curve.map((point) => point.benchmarkReturn)
  const totalReturn = last(curve)?.strategy ?? 1
  const benchmarkTotal = last(curve)?.benchmark ?? 1
  const maxDrawdown = Math.min(...curve.map((point) => point.drawdown), 0)
  const annualReturn = Math.pow(totalReturn, 252 / Math.max(curve.length, 1)) - 1
  const benchmarkAnnual = Math.pow(benchmarkTotal, 252 / Math.max(curve.length, 1)) - 1
  const vol = std(strategyReturns) * Math.sqrt(252)
  const sharpe = vol === 0 ? 0 : (mean(strategyReturns) * 252) / vol
  const downside = std(strategyReturns.filter((x) => x < 0)) * Math.sqrt(252)
  const sortino = downside === 0 ? 0 : (mean(strategyReturns) * 252) / downside
  const winRate = strategyReturns.filter((x) => x > 0).length / Math.max(strategyReturns.length, 1)
  const beta = covariance(strategyReturns, benchmarkReturns) / Math.max(variance(benchmarkReturns), 1e-9)
  const alpha = totalReturn - benchmarkTotal
  const calmar = Math.abs(maxDrawdown) < 1e-9 ? 0 : annualReturn / Math.abs(maxDrawdown)
  const profitDays = strategyReturns.filter((x) => x > 0).length
  const lossDays = strategyReturns.filter((x) => x < 0).length
  const diagnosis = buildDiagnosis({
    strategy: {
      name: draft.name,
      factors: factorIds,
      freq: draft.timeframe.includes("分钟") || draft.timeframe.includes("日内") ? "intraday" : "swing",
    },
    curve,
    positionTrades,
    strategyReturns,
    benchmarkReturns,
    backtestSource,
    dataSource,
    factorDataPlan,
  })

  return {
    strategyId: buildDraftStrategyId(draft),
    title: "真实历史回测",
    strategyName: draft.name,
    backtestSource,
    period: {
      start: curve[0]?.date ?? dates[0],
      end: last(curve)?.date ?? last(dates) ?? "",
      days: curve.length,
    },
    universe: draft.dsl.universe || `A 股扩展股票池 ${stocks.length} 只`,
    benchmark: "等权股票池",
    dataSource,
    factorDataPlan,
    parameters: {
      lookbackDays: BACKTEST_LOOKBACK_DAYS,
      momentumWindow: STRATEGY_MIN_LOOKBACK,
      rebalanceDays,
      topN: targetCount,
      feeRate: FEE_RATE,
    },
    metrics: [
      metric("策略收益", percent(totalReturn - 1), totalReturn >= benchmarkTotal ? "good" : "bad"),
      metric("策略年化收益", percent(annualReturn), annualReturn >= benchmarkAnnual ? "good" : "bad"),
      metric("超额收益", percent(alpha), alpha >= 0 ? "good" : "bad"),
      metric("基准收益", percent(benchmarkTotal - 1), "neutral"),
      metric("阿尔法", percent(alpha), alpha >= 0 ? "good" : "bad"),
      metric("贝塔", beta.toFixed(3), "neutral"),
      metric("夏普比率", sharpe.toFixed(3), sharpe >= 1 ? "good" : "neutral"),
      metric("胜率", percent(winRate), winRate >= 0.5 ? "good" : "bad"),
      metric("盈亏比", profitLossRatio(strategyReturns).toFixed(3), "neutral"),
      metric("最大回撤", percent(maxDrawdown), maxDrawdown > -0.1 ? "good" : "bad"),
      metric("索提诺比率", sortino.toFixed(3), sortino >= 1 ? "good" : "neutral"),
      metric("卡玛比率", calmar.toFixed(3), calmar >= 1 ? "good" : "neutral"),
      metric("盈利天数", String(profitDays), "good"),
      metric("亏损天数", String(lossDays), lossDays > profitDays ? "bad" : "neutral"),
      metric("策略波动率", percent(vol), "neutral"),
    ],
    curve,
    trades: trades.slice(-20).reverse(),
    positionTrades: positionTrades.slice(-120).reverse(),
    diagnosis,
    logs,
  }
}

function buildStrategyReport(
  strategy: Strategy,
  stocks: StockBars[],
  dates: string[],
  dataSource: BacktestReport["dataSource"],
): BacktestReport | null {
  const minIndex = Math.max(STRATEGY_MIN_LOOKBACK + 1, strategyRequiredLookback(strategy) + 1)
  if (dates.length < minIndex + 10) return null

  const priceBySymbol = new Map(
    stocks.map((stock) => [stock.symbol, new Map(stock.bars.map((bar) => [bar.date, bar.close]))]),
  )
  const nameBySymbol = new Map(stocks.map((stock) => [stock.symbol, stock.name]))
  const rebalanceDays = strategy.freq === "position" ? 20 : strategy.freq === "intraday" || strategy.freq === "hf" ? 1 : REBALANCE_DAYS
  const targetCount = Math.min(strategy.freq === "position" ? 4 : TOP_N, stocks.length)
  const backtestSource = strategy.factors.every(isDirectPriceFactor) ? "Qveris" : "Qveris K线代理"

  let strategyEquity = 1
  let benchmarkEquity = 1
  let peak = 1
  let weights: Weights = new Map()
  let openPositions = new Map<string, OpenPosition>()
  let initialized = false
  let portfolioGuardActive = false
  const curve: BacktestPoint[] = []
  const trades: BacktestTrade[] = []
  const positionTrades: BacktestPositionTrade[] = []
  const logs: string[] = [
    `数据源：Qveris ${dataSource.qverisCount}/${dataSource.total} 只，${dataSource.source === "mock" ? "当前使用降级数据" : "历史 K 线已接入"}`,
    `策略：${strategy.name}，因子 ${strategy.factors.join(" / ")}，每 ${rebalanceDays} 个交易日调仓，Top${targetCount}`,
    backtestSource === "Qveris K线代理"
      ? "说明：该策略包含资金、新闻、AI 或估值类因子，当前用真实 K 线构造代理信号回测。"
      : "说明：该策略使用价格/量能类因子，可直接由 Qveris K 线计算。",
    `风险：持仓按策略频率滚动，单边成本 ${(FEE_RATE * 100).toFixed(2)}%`,
  ]

  for (let i = minIndex; i < dates.length; i++) {
    const date = dates[i]
    const prevDate = dates[i - 1]
    let turnover = 0
    const usePortfolioGuard = strategyUsesPortfolioRiskGuard(strategy.id)
    if (usePortfolioGuard && portfolioGuardActive && marketRecoveryConfirmed(stocks, dates, i - 1)) {
      portfolioGuardActive = false
    }
    const forceRiskCash = usePortfolioGuard && portfolioGuardActive

    if ((i - minIndex) % rebalanceDays === 0 || !initialized || forceRiskCash) {
      const inCash = forceRiskCash || shouldHoldCash(strategy, stocks, dates, i - 1)
      const selectedWeights = inCash ? new Map<string, number>() : selectCatalogStrategyWeights(strategy, stocks, dates, i - 1, targetCount)
      const nextWeights = scaleWeights(selectedWeights, strategyTargetExposure(strategy.id))
      if (!nextWeights.size && !inCash && !strategyHasEntryGate(strategy)) return null
      closePositionTrades(positionTrades, openPositions, date, "调仓退出", stocks, priceBySymbol, nameBySymbol)
      turnover = portfolioTurnover(weights, nextWeights)
      weights = nextWeights
      openPositions = openPositionsForDate(weights, date, priceBySymbol)
      initialized = true
      trades.push({
        date,
        action: trades.length === 0 ? "建仓" : "调仓",
        holdings: formatHoldings(weights, nameBySymbol),
        turnover,
        cashWeight: Math.max(0, 1 - sumWeights(weights)),
      })
    }

    const dailyReturn = portfolioReturn(weights, priceBySymbol, prevDate, date) - turnover * FEE_RATE
    const benchmarkReturn = equalWeightReturn(stocks, priceBySymbol, prevDate, date)
    strategyEquity *= 1 + dailyReturn
    benchmarkEquity *= 1 + benchmarkReturn
    peak = Math.max(peak, strategyEquity)
    const drawdown = strategyEquity / peak - 1
    if (usePortfolioGuard && drawdown <= -0.12) portfolioGuardActive = true

    curve.push({
      date,
      strategy: round4(strategyEquity),
      benchmark: round4(benchmarkEquity),
      excess: round4(strategyEquity - benchmarkEquity),
      dailyReturn: round4(dailyReturn),
      benchmarkReturn: round4(benchmarkReturn),
      drawdown: round4(drawdown),
      turnover: round4(turnover),
      holdings: formatHoldings(weights, nameBySymbol),
    })
  }

  if (!curve.length) return null
  closePositionTrades(positionTrades, openPositions, last(curve)?.date ?? last(dates) ?? "", "回测结束", stocks, priceBySymbol, nameBySymbol)
  const strategyReturns = curve.map((point) => point.dailyReturn)
  const benchmarkReturns = curve.map((point) => point.benchmarkReturn)
  const totalReturn = last(curve)?.strategy ?? 1
  const benchmarkTotal = last(curve)?.benchmark ?? 1
  const maxDrawdown = Math.min(...curve.map((point) => point.drawdown), 0)
  const annualReturn = Math.pow(totalReturn, 252 / Math.max(curve.length, 1)) - 1
  const benchmarkAnnual = Math.pow(benchmarkTotal, 252 / Math.max(curve.length, 1)) - 1
  const vol = std(strategyReturns) * Math.sqrt(252)
  const sharpe = vol === 0 ? 0 : (mean(strategyReturns) * 252) / vol
  const downside = std(strategyReturns.filter((x) => x < 0)) * Math.sqrt(252)
  const sortino = downside === 0 ? 0 : (mean(strategyReturns) * 252) / downside
  const winRate = strategyReturns.filter((x) => x > 0).length / Math.max(strategyReturns.length, 1)
  const beta = covariance(strategyReturns, benchmarkReturns) / Math.max(variance(benchmarkReturns), 1e-9)
  const alpha = totalReturn - benchmarkTotal
  const calmar = Math.abs(maxDrawdown) < 1e-9 ? 0 : annualReturn / Math.abs(maxDrawdown)
  const profitDays = strategyReturns.filter((x) => x > 0).length
  const lossDays = strategyReturns.filter((x) => x < 0).length
  const diagnosis = buildDiagnosis({
    strategy,
    curve,
    positionTrades,
    strategyReturns,
    benchmarkReturns,
    backtestSource,
    dataSource,
  })

  return {
    strategyId: strategy.id,
    title: "真实历史回测",
    strategyName: strategy.name,
    backtestSource,
    period: {
      start: curve[0]?.date ?? dates[0],
      end: last(curve)?.date ?? last(dates) ?? "",
      days: curve.length,
    },
    universe: `A 股扩展股票池 ${stocks.length} 只`,
    benchmark: "等权股票池",
    dataSource,
    factorDataPlan: buildFactorDataPlanFromIds(strategy.factors),
    parameters: {
      lookbackDays: BACKTEST_LOOKBACK_DAYS,
      momentumWindow: STRATEGY_MIN_LOOKBACK,
      rebalanceDays,
      topN: targetCount,
      feeRate: FEE_RATE,
    },
    metrics: [
      metric("策略收益", percent(totalReturn - 1), totalReturn >= benchmarkTotal ? "good" : "bad"),
      metric("策略年化收益", percent(annualReturn), annualReturn >= benchmarkAnnual ? "good" : "bad"),
      metric("超额收益", percent(alpha), alpha >= 0 ? "good" : "bad"),
      metric("基准收益", percent(benchmarkTotal - 1), "neutral"),
      metric("阿尔法", percent(alpha), alpha >= 0 ? "good" : "bad"),
      metric("贝塔", beta.toFixed(3), "neutral"),
      metric("夏普比率", sharpe.toFixed(3), sharpe >= 1 ? "good" : "neutral"),
      metric("胜率", percent(winRate), winRate >= 0.5 ? "good" : "bad"),
      metric("盈亏比", profitLossRatio(strategyReturns).toFixed(3), "neutral"),
      metric("最大回撤", percent(maxDrawdown), maxDrawdown > -0.1 ? "good" : "bad"),
      metric("索提诺比率", sortino.toFixed(3), sortino >= 1 ? "good" : "neutral"),
      metric("卡玛比率", calmar.toFixed(3), calmar >= 1 ? "good" : "neutral"),
      metric("盈利天数", String(profitDays), "good"),
      metric("亏损天数", String(lossDays), lossDays > profitDays ? "bad" : "neutral"),
      metric("策略波动率", percent(vol), "neutral"),
    ],
    curve,
    trades: trades.slice(-20).reverse(),
    positionTrades: positionTrades.slice(-120).reverse(),
    diagnosis,
    logs,
  }
}

function selectRadarStrategyWeights(
  stocks: StockBars[],
  dates: string[],
  asOfIndex: number,
): Weights {
  const rawScores = stocks
    .map((stock) => ({
      symbol: stock.symbol,
      factors: RADAR_STRATEGY.factorWeights.map((factor) => ({
        id: factor.id,
        value: computeCatalogFactor(stock, dates, asOfIndex, factor.id),
      })),
    }))
    .filter((item) => item.factors.every((factor) => Number.isFinite(factor.value)))

  const percentileByFactor = new Map<StrategyFactorId, Map<string, number>>()
  for (const factor of RADAR_STRATEGY.factorWeights) {
    percentileByFactor.set(
      factor.id,
      rankPercentiles(rawScores.map((item) => ({
        symbol: item.symbol,
        value: item.factors.find((candidate) => candidate.id === factor.id)?.value ?? -Infinity,
      }))),
    )
  }

  const ranked = rawScores
    .map((item) => {
      const score = RADAR_STRATEGY.factorWeights.reduce((sum, factor) => {
        return sum + (percentileByFactor.get(factor.id)?.get(item.symbol) ?? 0) * factor.weight
      }, 0)
      return { symbol: item.symbol, score }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N)

  const weight = ranked.length ? 1 / ranked.length : 0
  return new Map(ranked.map((item) => [item.symbol, weight]))
}

function buildDiagnosis({
  strategy,
  curve,
  positionTrades,
  strategyReturns,
  benchmarkReturns,
  backtestSource,
  dataSource,
  factorDataPlan,
}: {
  strategy: DiagnosableStrategy
  curve: BacktestPoint[]
  positionTrades: BacktestPositionTrade[]
  strategyReturns: number[]
  benchmarkReturns: number[]
  backtestSource: Strategy["backtestSource"]
  dataSource: BacktestReport["dataSource"]
  factorDataPlan?: FactorDataPlan
}): BacktestDiagnosis {
  const totalReturn = (last(curve)?.strategy ?? 1) - 1
  const benchmarkReturn = (last(curve)?.benchmark ?? 1) - 1
  const alpha = totalReturn - benchmarkReturn
  const maxDrawdown = Math.min(...curve.map((point) => point.drawdown), 0)
  const annualReturn = Math.pow(totalReturn + 1, 252 / Math.max(curve.length, 1)) - 1
  const drawdownPoint = curve.reduce<BacktestPoint | null>((worst, point) => {
    if (!worst || point.drawdown < worst.drawdown) return point
    return worst
  }, null)
  const vol = std(strategyReturns) * Math.sqrt(252)
  const sharpe = vol === 0 ? 0 : (mean(strategyReturns) * 252) / vol
  const tradeWinRate = positionTrades.length
    ? positionTrades.filter((trade) => trade.returnPct > 0).length / positionTrades.length
    : 0
  const avgTradeReturn = mean(positionTrades.map((trade) => trade.returnPct))
  const avgAlpha = mean(positionTrades.map((trade) => trade.alphaPct))
  const avgTurnover = mean(curve.map((point) => point.turnover))
  const directFactorCount = factorDataPlan?.realCount ?? strategy.factors.filter(isDirectPriceFactor).length
  const proxyFactorCount = factorDataPlan
    ? factorDataPlan.proxyCount + factorDataPlan.missingCount
    : strategy.factors.length - directFactorCount
  const factorTotal = factorDataPlan?.total ?? strategy.factors.length
  const validation = splitValidation(strategyReturns)

  let score = 100
  if (totalReturn < 0) score -= 25
  if (annualReturn < STRATEGY_CATALOG_MIN_ANNUAL_RETURN / 100) score -= 16
  if (alpha < 0) score -= 20
  if (sharpe < 0) score -= 15
  else if (sharpe < 0.5) score -= 8
  if (maxDrawdown < -0.2) score -= 15
  else if (maxDrawdown < -0.1) score -= 8
  if (tradeWinRate < 0.45) score -= 10
  if (backtestSource === "Qveris K线代理") score -= 15
  if (dataSource.total < 50) score -= 10
  if (dataSource.qverisCount < dataSource.total) score -= 8
  if (!validation.pass) score -= validation.testAnnual < 0 ? 16 : 8
  if (validation.testMaxDrawdown < -0.25) score -= 8
  score = Math.max(0, Math.min(100, Math.round(score)))

  const tags = buildStrategyTags({
    totalReturn,
    annualReturn,
    alpha,
    maxDrawdown,
    avgTurnover,
    backtestSource,
    dataSource,
    tradeCount: positionTrades.length,
    factorCount: strategy.factors.length,
    sharpe,
    validation,
  })
  const admission = buildStrategyAdmission({
    score,
    totalReturn,
    annualReturn,
    alpha,
    maxDrawdown,
    avgTurnover,
    backtestSource,
    dataSource,
    tradeWinRate,
    tradeCount: positionTrades.length,
    sharpe,
    tags,
    validation,
  })

  const verdict =
    score >= 70 ? "可继续小样本跟踪" : score >= 45 ? "需要修正后复测" : "暂不适合上线"
  const headline =
    totalReturn >= 0 && alpha >= 0
      ? "当前回测能跑赢基准，但仍需扩大股票池和做样本外验证。"
      : totalReturn < 0 && alpha >= 0
        ? "策略绝对收益为负，但相对股票池仍有超额，优先增加市场状态过滤。"
        : "策略同时亏损且跑输基准，先不要上线到雷达推荐。"

  const checks: BacktestDiagnosis["checks"] = [
    {
      label: "收益质量",
      value: `${percent(totalReturn)} / 超额 ${percent(alpha)}`,
      tone: totalReturn >= 0 && alpha >= 0 ? "good" : alpha >= 0 ? "warning" : "bad",
      note: `同期基准 ${percent(benchmarkReturn)}，判断策略是否真有 alpha。`,
    },
    {
      label: "交易胜率",
      value: `${Math.round(tradeWinRate * 100)}%`,
      tone: tradeWinRate >= 0.55 ? "good" : tradeWinRate >= 0.45 ? "warning" : "bad",
      note: `${positionTrades.filter((trade) => trade.returnPct > 0).length}/${positionTrades.length} 笔盈利，均笔收益 ${avgTradeReturn.toFixed(2)}%。`,
    },
    {
      label: "最大回撤",
      value: percent(maxDrawdown),
      tone: maxDrawdown > -0.1 ? "good" : maxDrawdown > -0.2 ? "warning" : "bad",
      note: drawdownPoint ? `${drawdownPoint.date} 持仓：${drawdownPoint.holdings || "空"}` : "暂无回撤样本。",
    },
    {
      label: "因子真实性",
      value: backtestSource,
      tone: backtestSource === "Qveris" ? "good" : "warning",
      note: proxyFactorCount > 0
        ? `${proxyFactorCount}/${factorTotal} 个因子仍需原始字段或人工绑定，不能当作完整原始因子结论。`
        : `${directFactorCount}/${factorTotal} 个因子可由 Qveris 字段或 K 线公式直接计算。`,
    },
    {
      label: "股票池样本",
      value: `${dataSource.qverisCount}/${dataSource.total}`,
      tone: dataSource.total >= 50 && dataSource.qverisCount === dataSource.total ? "good" : "warning",
      note: dataSource.total < 50 ? "当前横截面太小，因子分层和 TopN 排名稳定性不足。" : "样本覆盖较完整。",
    },
    {
      label: "换手成本",
      value: `${(avgTurnover * 100).toFixed(1)}%`,
      tone: avgTurnover > 0.45 ? "bad" : avgTurnover > 0.25 ? "warning" : "good",
      note: `单边成本 ${(FEE_RATE * 100).toFixed(2)}%，高换手策略需要更强胜率补偿。`,
    },
    {
      label: "样本外一致性",
      value: `后段年化 ${percent(validation.testAnnual)}`,
      tone: validation.pass ? "good" : validation.testAnnual >= 0 ? "warning" : "bad",
      note: `前段年化 ${percent(validation.trainAnnual)}，后段最大回撤 ${percent(validation.testMaxDrawdown)}；未通过则不直接入雷达。`,
    },
  ]

  const recommendations: string[] = []
  if (dataSource.qverisCount < 50) recommendations.push("继续分批预热股票池历史数据，至少让 50-100 只股票进入真实回测截面。")
  if (backtestSource === "Qveris K线代理") recommendations.push("把资金流、新闻、AI、估值类代理因子替换成 Qveris 原始字段；K 线公式因子应先写入 factor_values 再复测。")
  if (totalReturn < 0) recommendations.push("加入大盘趋势过滤：指数弱于 20/60 日均线时降仓或空仓。")
  if (annualReturn < STRATEGY_CATALOG_MIN_ANNUAL_RETURN / 100) recommendations.push(`年化低于 ${STRATEGY_CATALOG_MIN_ANNUAL_RETURN}% 的策略先移出主目录，只保留在真实回测页做复盘。`)
  if (alpha < 0) recommendations.push("先在因子层做 IC/分组收益验证，剔除跑输基准的因子组合。")
  if (avgTradeReturn < 0) recommendations.push("复盘最亏交易，调整入场阈值、止损和持仓天数。")
  if (avgTurnover > 0.25) recommendations.push("降低调仓频率或提高入选阈值，避免交易成本吞掉 alpha。")
  if (maxDrawdown < -0.25) recommendations.push("回撤超过 25%，先加入指数趋势过滤、分批建仓和单票硬止损，不应直接上线雷达。")
  else if (maxDrawdown < -0.15) recommendations.push("增加组合级风控：最大回撤触发降仓、单票亏损阈值和行业集中度限制。")
  if (sharpe < 1 && annualReturn > 0) recommendations.push("收益波动过大，优先做持仓上限、行业分散和波动率归一化。")
  if (!validation.pass) recommendations.push("样本外表现不稳定，先做 walk-forward 分段复测，不要直接上线雷达。")
  recommendations.push("完成参数网格后做 walk-forward 样本外验证，再决定是否进入雷达实时推荐。")

  return {
    verdict,
    score,
    headline,
    tags,
    admission,
    checks,
    recommendations: Array.from(new Set(recommendations)).slice(0, 6),
    topWinners: [...positionTrades].sort((a, b) => b.returnPct - a.returnPct).slice(0, 5),
    topLosers: [...positionTrades].sort((a, b) => a.returnPct - b.returnPct).slice(0, 5),
    drawdownHotspot: drawdownPoint
      ? {
          date: drawdownPoint.date,
          drawdownPct: round4(drawdownPoint.drawdown * 100),
          holdings: drawdownPoint.holdings,
        }
      : undefined,
  }
}

function emptyDiagnosis(reason: string): BacktestDiagnosis {
  const admission: StrategyAdmission = {
    status: "blocked",
    gate: "禁止入雷达",
    score: 0,
    tags: ["样本太少"],
    reason,
  }
  return {
    verdict: "暂不适合上线",
    score: 0,
    headline: reason,
    tags: admission.tags,
    admission,
    checks: [
      {
        label: "数据状态",
        value: "不可回测",
        tone: "bad",
        note: reason,
      },
    ],
    recommendations: ["先修复数据覆盖和共同交易日，再重新运行回测。"],
    topWinners: [],
    topLosers: [],
  }
}

function buildStrategyTags({
  totalReturn,
  annualReturn,
  alpha,
  maxDrawdown,
  avgTurnover,
  backtestSource,
  dataSource,
  tradeCount,
  factorCount,
  sharpe,
  validation,
}: {
  totalReturn: number
  annualReturn: number
  alpha: number
  maxDrawdown: number
  avgTurnover: number
  backtestSource: Strategy["backtestSource"]
  dataSource: BacktestReport["dataSource"]
  tradeCount: number
  factorCount: number
  sharpe: number
  validation: SplitValidation
}) {
  const tags: string[] = []
  if (totalReturn < 0 || alpha < 0) tags.push("无 alpha")
  if (annualReturn < STRATEGY_CATALOG_MIN_ANNUAL_RETURN / 100) tags.push(`年化低于${STRATEGY_CATALOG_MIN_ANNUAL_RETURN}%`)
  if (maxDrawdown < -0.18) tags.push("回撤过大")
  if (avgTurnover > 0.32) tags.push("换手过高")
  if (dataSource.total < 100 || dataSource.qverisCount < 80 || tradeCount < 80) tags.push("样本太少")
  if (backtestSource === "Qveris K线代理") tags.push("非价格代理")
  if ((factorCount >= 3 && dataSource.total < 150) || (sharpe > 2.2 && tradeCount < 120)) tags.push("过拟合风险")
  if (!validation.pass) tags.push("样本外弱")
  if (!tags.length) tags.push("通过初筛")
  return Array.from(new Set(tags))
}

function buildStrategyAdmission({
  score,
  totalReturn,
  annualReturn,
  alpha,
  maxDrawdown,
  avgTurnover,
  backtestSource,
  dataSource,
  tradeWinRate,
  tradeCount,
  sharpe,
  tags,
  validation,
}: {
  score: number
  totalReturn: number
  annualReturn: number
  alpha: number
  maxDrawdown: number
  avgTurnover: number
  backtestSource: Strategy["backtestSource"]
  dataSource: BacktestReport["dataSource"]
  tradeWinRate: number
  tradeCount: number
  sharpe: number
  tags: string[]
  validation: SplitValidation
}): StrategyAdmission {
  const rawDataReady = backtestSource === "Qveris"
  const sampleReady = dataSource.total >= 100 && dataSource.qverisCount >= 80 && tradeCount >= 80
  const riskReady = maxDrawdown > -0.18 && avgTurnover <= 0.32
  const returnReady = annualReturn >= STRATEGY_CATALOG_MIN_ANNUAL_RETURN / 100
  const expectancyReady = tradeWinRate >= 0.5 || (tradeWinRate >= 0.45 && sharpe >= 1.8)
  const alphaReady = totalReturn > 0 && alpha > 0 && expectancyReady
  const validationReady = validation.pass && validation.testMaxDrawdown > -0.25
  const ready = score >= 72 && rawDataReady && sampleReady && riskReady && returnReady && alphaReady && validationReady

  if (!returnReady) {
    return {
      status: "blocked",
      gate: "禁止入雷达",
      score,
      tags,
      reason: `真实回测年化低于 ${STRATEGY_CATALOG_MIN_ANNUAL_RETURN}%，已从主策略目录清除。`,
    }
  }

  if (ready) {
    return {
      status: "radar-ready",
      gate: "雷达候选",
      score,
      tags,
      reason: "通过真实 K 线、样本、收益、回撤和换手门槛，可进入雷达候选池。",
    }
  }

  if (score >= 45 && dataSource.total >= 50) {
    const blockers = [
      rawDataReady ? "" : "非价格类原始字段未补齐",
      sampleReady ? "" : "样本或交易笔数不足",
      riskReady ? "" : "回撤或换手未达标",
      returnReady ? "" : `年化低于 ${STRATEGY_CATALOG_MIN_ANNUAL_RETURN}%`,
      alphaReady ? "" : "收益/超额/交易期望未达标",
      validationReady ? "" : "样本外一致性未达标",
    ].filter(Boolean)
    return {
      status: "watchlist",
      gate: "观察池",
      score,
      tags,
      reason: blockers.length ? blockers.join("；") : "分数接近门槛，先做样本外验证后再决定是否入雷达。",
    }
  }

  return {
    status: "blocked",
    gate: "禁止入雷达",
    score,
    tags,
    reason: "未通过真实回测准入门槛，雷达不会展示该策略信号。",
  }
}

function metricNumber(report: BacktestReport, label: string) {
  const value = report.metrics.find((item) => item.label === label)?.value ?? "0"
  const normalized = value.replace("%", "").replace(/[+,]/g, "")
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? round2(parsed) : 0
}

export function scoreBacktestReport(report: BacktestReport) {
  const annual = metricNumber(report, "策略年化收益")
  const excess = metricNumber(report, "超额收益")
  const drawdown = Math.abs(metricNumber(report, "最大回撤"))
  const sharpe = metricNumber(report, "夏普比率")
  const winRate = metricNumber(report, "胜率")
  const admission = report.diagnosis.admission
  const gateBonus = admission.status === "radar-ready" ? 20 : admission.status === "watchlist" ? 6 : -12
  return round2(admission.score + annual * 0.18 + excess * 0.28 + sharpe * 5 + (winRate - 50) * 0.25 - drawdown * 0.35 + gateBonus)
}

function compareBacktestReports(a: BacktestReport, b: BacktestReport) {
  return scoreBacktestReport(b) - scoreBacktestReport(a)
}

function backtestStrategySummary(strategy: Strategy, stocks: StockBars[], dates: string[]): StrategyBacktestSummary | null {
  const minIndex = Math.max(STRATEGY_MIN_LOOKBACK + 1, strategyRequiredLookback(strategy) + 1)
  if (dates.length < minIndex + 10) return null

  const priceBySymbol = new Map(
    stocks.map((stock) => [stock.symbol, new Map(stock.bars.map((bar) => [bar.date, bar.close]))]),
  )
  const rebalanceDays = strategy.freq === "position" ? 20 : strategy.freq === "intraday" || strategy.freq === "hf" ? 1 : REBALANCE_DAYS
  const targetCount = Math.min(strategy.freq === "position" ? 4 : TOP_N, stocks.length)

  let strategyEquity = 1
  let benchmarkEquity = 1
  let peak = 1
  let weights: Weights = new Map()
  let initialized = false
  const returns: number[] = []
  const benchmarkReturns: number[] = []
  const drawdowns: number[] = []

  for (let i = minIndex; i < dates.length; i++) {
    const date = dates[i]
    const prevDate = dates[i - 1]
    let turnover = 0

    if ((i - minIndex) % rebalanceDays === 0 || !initialized) {
      const inCash = shouldHoldCash(strategy, stocks, dates, i - 1)
      const selectedWeights = inCash ? new Map<string, number>() : selectCatalogStrategyWeights(strategy, stocks, dates, i - 1, targetCount)
      const nextWeights = scaleWeights(selectedWeights, strategyTargetExposure(strategy.id))
      if (!nextWeights.size && !inCash && !strategyHasEntryGate(strategy)) return null
      turnover = portfolioTurnover(weights, nextWeights)
      weights = nextWeights
      initialized = true
    }

    const dailyReturn = portfolioReturn(weights, priceBySymbol, prevDate, date) - turnover * FEE_RATE
    const benchmarkReturn = equalWeightReturn(stocks, priceBySymbol, prevDate, date)
    strategyEquity *= 1 + dailyReturn
    benchmarkEquity *= 1 + benchmarkReturn
    peak = Math.max(peak, strategyEquity)
    returns.push(dailyReturn)
    benchmarkReturns.push(benchmarkReturn)
    drawdowns.push(strategyEquity / peak - 1)
  }

  if (!returns.length) return null
  const totalReturn = strategyEquity - 1
  const annualReturn = Math.pow(strategyEquity, 252 / returns.length) - 1
  const maxDrawdown = Math.min(...drawdowns, 0)
  const vol = std(returns) * Math.sqrt(252)
  const sharpe = vol === 0 ? 0 : (mean(returns) * 252) / vol
  const winRate = returns.filter((value) => value > 0).length / returns.length

  return {
    annualReturn,
    totalReturn,
    maxDrawdown,
    sharpe,
    winRate,
    qverisBacked: stocks.some((stock) => stock.source === "qveris" || stock.source === "database") && benchmarkReturns.length > 0,
  }
}

function selectCatalogStrategyWeights(
  strategy: Strategy,
  stocks: StockBars[],
  dates: string[],
  asOfIndex: number,
  targetCount: number,
): Weights {
  const rawScores = stocks
    .map((stock) => ({
      symbol: stock.symbol,
      factors: strategy.factors.map((factorId) => ({
        id: factorId,
        value: computeCatalogFactor(stock, dates, asOfIndex, factorId),
      })),
    }))
    .filter((item) => item.factors.every((factor) => Number.isFinite(factor.value)))
    .filter((item) => passesStrategyEntryGate(strategy, new Map(item.factors.map((factor) => [factor.id, factor.value]))))

  if (!rawScores.length) return new Map()

  const percentileByFactor = new Map<string, Map<string, number>>()
  for (const factorId of strategy.factors) {
    percentileByFactor.set(
      factorId,
      rankPercentiles(rawScores.map((item) => ({
        symbol: item.symbol,
        value: item.factors.find((factor) => factor.id === factorId)?.value ?? -Infinity,
      }))),
    )
  }

  const ranked = rawScores
    .map((item) => {
      const score = strategy.factors.reduce((sum, factorId) => {
        return sum + (percentileByFactor.get(factorId)?.get(item.symbol) ?? 0)
      }, 0) / Math.max(1, strategy.factors.length)
      return { symbol: item.symbol, score }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, targetCount)

  const weight = ranked.length ? 1 / ranked.length : 0
  return new Map(ranked.map((item) => [item.symbol, weight]))
}

function strategyHasEntryGate(strategy: Pick<Strategy, "id" | "factors">) {
  if (strategy.id.startsWith("mine-")) return true
  return [
    "s-turtle-donchian",
    "s-minervini-trend",
    "s-dual-momentum",
    "s-canslim-proxy",
    "s-low-vol-momentum",
    "s-connors-rsi2",
    "s-bollinger-reversion",
    "s-sma200-rsi2-defensive",
    "s-macd-low-vol-trend",
    "s-tight-breakout-defensive",
    "s-vcp-breakout-a-share",
    "s-keltner-atr-breakout",
    "s-post-breakout-hold",
    "s-rsrs-right-side",
    "s-residual-mom-low-vol",
    "s-mid-vol-reversal",
    "s-value-low-vol-quality",
    "s-sma200-strength-rotation",
    "s-defensive-minervini",
    "s-ranked-rsi2-bollinger",
    "s-bollinger-low-vol-reversion",
    "s-mid-vol-reversal-low-vol",
    "s-vcp-low-vol-breakout",
    "s-vcp-risk-momentum-breakout",
    "s-vcp-atr-low-vol-breakout",
  ].includes(strategy.id)
}

function strategyUsesPortfolioRiskGuard(strategyId: string) {
  if (strategyId.startsWith("mine-")) return true
  return [
    "s-sma200-rsi2-defensive",
    "s-macd-low-vol-trend",
    "s-tight-breakout-defensive",
    "s-vcp-breakout-a-share",
    "s-keltner-atr-breakout",
    "s-post-breakout-hold",
    "s-rsrs-right-side",
    "s-residual-mom-low-vol",
    "s-mid-vol-reversal",
    "s-value-low-vol-quality",
    "s-sma200-strength-rotation",
    "s-defensive-minervini",
    "s-ranked-rsi2-bollinger",
    "s-bollinger-low-vol-reversion",
    "s-mid-vol-reversal-low-vol",
    "s-vcp-low-vol-breakout",
    "s-vcp-risk-momentum-breakout",
    "s-vcp-atr-low-vol-breakout",
  ].includes(strategyId)
}

function strategyTargetExposure(strategyId: string) {
  if (strategyId.startsWith("mine-a-share-vwap")) return 0.45
  if (strategyId.startsWith("mine-")) return 0.7
  if (strategyId === "s-tight-breakout-defensive") return 0.6
  if (strategyId === "s-sma200-rsi2-defensive") return 0.65
  if (strategyId === "s-vcp-breakout-a-share") return 0.65
  if (strategyId === "s-keltner-atr-breakout") return 0.7
  if (strategyId === "s-post-breakout-hold") return 0.7
  if (strategyId === "s-mid-vol-reversal") return 0.6
  if (strategyId === "s-value-low-vol-quality") return 0.75
  if (strategyId === "s-ranked-rsi2-bollinger") return 0.55
  if (strategyId === "s-bollinger-low-vol-reversion") return 0.55
  if (strategyId === "s-mid-vol-reversal-low-vol") return 0.55
  if (strategyId === "s-vcp-low-vol-breakout") return 0.5
  if (strategyId === "s-vcp-risk-momentum-breakout") return 0.5
  if (strategyId === "s-vcp-atr-low-vol-breakout") return 0.5
  if (strategyUsesPortfolioRiskGuard(strategyId)) return 0.75
  return 1
}

function scaleWeights(weights: Weights, exposure: number) {
  const cappedExposure = Math.max(0, Math.min(1, exposure))
  if (cappedExposure >= 0.999 || weights.size === 0) return weights
  return new Map(Array.from(weights.entries()).map(([symbol, weight]) => [symbol, weight * cappedExposure]))
}

function marketRecoveryConfirmed(stocks: StockBars[], dates: string[], asOfIndex: number) {
  const ret20 = meanSafeRet(stocks, dates, asOfIndex, 20)
  const ret60 = meanSafeRet(stocks, dates, asOfIndex, 60)
  if (!Number.isFinite(ret20) || !Number.isFinite(ret60)) return false
  return ret20 > 0.015 && ret60 > 0
}

function passesStrategyEntryGate(strategy: Pick<Strategy, "id" | "factors">, factors: Map<string, number>) {
  if (strategy.id.startsWith("mine-")) {
    if ((strategy.factors.includes("f-absolute-momentum") && (factors.get("f-absolute-momentum") ?? -Infinity) <= 0)) return false
    if (strategy.factors.includes("f-tight-breakout") && (factors.get("f-tight-breakout") ?? -Infinity) <= 0) return false
    if (strategy.factors.includes("f-donchian-55") && (factors.get("f-donchian-55") ?? -Infinity) <= 0) return false
    if (strategy.factors.includes("f-minervini-trend") && (factors.get("f-minervini-trend") ?? -Infinity) < 0.68) return false
    if (strategy.factors.includes("f-atr-compression") && (factors.get("f-atr-compression") ?? -Infinity) < 0.35) return false
    if (strategy.factors.includes("f-pullback-uptrend") && (factors.get("f-pullback-uptrend") ?? -Infinity) < 58) return false
    if (strategy.factors.includes("f-rsi2-reversal") && (factors.get("f-rsi2-reversal") ?? -Infinity) < 55) return false
    if (strategy.factors.includes("f-intra-vwap") && (factors.get("f-vol-spike") ?? -Infinity) < 0.8) return false
  }
  if (strategy.id === "s-turtle-donchian") {
    return (factors.get("f-donchian-55") ?? -Infinity) > 0 && (factors.get("f-absolute-momentum") ?? -Infinity) > 0
  }
  if (strategy.id === "s-minervini-trend") {
    return (factors.get("f-minervini-trend") ?? -Infinity) >= 0.85 && (factors.get("f-vol-spike") ?? -Infinity) >= 0.75
  }
  if (strategy.id === "s-dual-momentum") {
    return (factors.get("f-absolute-momentum") ?? -Infinity) > 0
  }
  if (strategy.id === "s-canslim-proxy") {
    return (factors.get("f-canslim-proxy") ?? -Infinity) >= 0.35 && (factors.get("f-vol-spike") ?? -Infinity) >= 0.75
  }
  if (strategy.id === "s-low-vol-momentum") {
    return (factors.get("f-low-vol-mom") ?? -Infinity) > 0 && (factors.get("f-absolute-momentum") ?? -Infinity) > 0
  }
  if (strategy.id === "s-connors-rsi2") {
    return (factors.get("f-rsi2-reversal") ?? -Infinity) >= 80 && (factors.get("f-mom-60d") ?? -Infinity) > -0.05
  }
  if (strategy.id === "s-bollinger-reversion") {
    return (factors.get("f-bollinger-revert") ?? -Infinity) > 0 && (factors.get("f-rsi2-reversal") ?? -Infinity) >= 65
  }
  if (strategy.id === "s-sma200-rsi2-defensive") {
    return (
      (factors.get("f-pullback-uptrend") ?? -Infinity) >= 70 &&
      (factors.get("f-sma200-momentum") ?? -Infinity) > 0 &&
      (factors.get("f-absolute-momentum") ?? -Infinity) > 0
    )
  }
  if (strategy.id === "s-macd-low-vol-trend") {
    return (
      (factors.get("f-macd-trend") ?? -Infinity) > 0 &&
      (factors.get("f-risk-adjusted-mom") ?? -Infinity) > 0 &&
      (factors.get("f-absolute-momentum") ?? -Infinity) > 0
    )
  }
  if (strategy.id === "s-tight-breakout-defensive") {
    return (
      (factors.get("f-tight-breakout") ?? -Infinity) > 0 &&
      (factors.get("f-atr-compression") ?? -Infinity) >= 0.45 &&
      (factors.get("f-absolute-momentum") ?? -Infinity) > 0
    )
  }
  if (strategy.id === "s-vcp-breakout-a-share") {
    return (
      (factors.get("f-vcp-breakout") ?? -Infinity) > 0 &&
      (factors.get("f-atr-compression") ?? -Infinity) >= 0.35 &&
      (factors.get("f-risk-adjusted-mom") ?? -Infinity) > 0 &&
      (factors.get("f-absolute-momentum") ?? -Infinity) > 0
    )
  }
  if (strategy.id === "s-keltner-atr-breakout") {
    return (
      (factors.get("f-keltner-breakout") ?? -Infinity) > 0 &&
      (factors.get("f-risk-adjusted-mom") ?? -Infinity) > 0 &&
      (factors.get("f-absolute-momentum") ?? -Infinity) > 0
    )
  }
  if (strategy.id === "s-post-breakout-hold") {
    return (
      (factors.get("f-post-breakout-hold") ?? -Infinity) > 0 &&
      (factors.get("f-vol-spike") ?? -Infinity) >= 0.8 &&
      (factors.get("f-absolute-momentum") ?? -Infinity) > 0
    )
  }
  if (strategy.id === "s-rsrs-right-side") {
    return (
      (factors.get("f-rsrs-right-side") ?? -Infinity) > 0 &&
      (factors.get("f-risk-adjusted-mom") ?? -Infinity) > 0 &&
      (factors.get("f-absolute-momentum") ?? -Infinity) > 0
    )
  }
  if (strategy.id === "s-residual-mom-low-vol") {
    return (
      (factors.get("f-residual-mom-low-vol") ?? -Infinity) > 0 &&
      (factors.get("f-value-low-vol") ?? -Infinity) > 0 &&
      (factors.get("f-absolute-momentum") ?? -Infinity) > 0
    )
  }
  if (strategy.id === "s-mid-vol-reversal") {
    return (
      (factors.get("f-mid-vol-reversal") ?? -Infinity) > 0 &&
      (factors.get("f-absolute-momentum") ?? -Infinity) > -0.05
    )
  }
  if (strategy.id === "s-value-low-vol-quality") {
    return (
      (factors.get("f-value-low-vol") ?? -Infinity) > 0 &&
      (factors.get("f-low-vol-mom") ?? -Infinity) > -0.05 &&
      (factors.get("f-absolute-momentum") ?? -Infinity) > 0
    )
  }
  if (strategy.id === "s-sma200-strength-rotation") {
    return (
      (factors.get("f-sma200-momentum") ?? -Infinity) > 0 &&
      (factors.get("f-risk-adjusted-mom") ?? -Infinity) > 0 &&
      (factors.get("f-absolute-momentum") ?? -Infinity) > 0
    )
  }
  if (strategy.id === "s-defensive-minervini") {
    return (
      (factors.get("f-minervini-trend") ?? -Infinity) >= 0.85 &&
      (factors.get("f-risk-adjusted-mom") ?? -Infinity) > 0 &&
      (factors.get("f-absolute-momentum") ?? -Infinity) > 0
    )
  }
  if (strategy.id === "s-ranked-rsi2-bollinger") {
    return (
      (factors.get("f-bollinger-revert") ?? -Infinity) > -1.25 &&
      (factors.get("f-rsi2-reversal") ?? -Infinity) >= 35 &&
      (factors.get("f-absolute-momentum") ?? -Infinity) > -0.12
    )
  }
  if (strategy.id === "s-bollinger-low-vol-reversion") {
    return (
      (factors.get("f-bollinger-revert") ?? -Infinity) > -1.1 &&
      (factors.get("f-low-vol-mom") ?? -Infinity) > -0.2 &&
      (factors.get("f-absolute-momentum") ?? -Infinity) > -0.12
    )
  }
  if (strategy.id === "s-mid-vol-reversal-low-vol") {
    return (
      (factors.get("f-mid-vol-reversal") ?? -Infinity) > -0.08 &&
      (factors.get("f-low-vol-mom") ?? -Infinity) > -0.2 &&
      (factors.get("f-absolute-momentum") ?? -Infinity) > -0.12
    )
  }
  if (strategy.id === "s-vcp-low-vol-breakout") {
    return (
      (factors.get("f-vcp-breakout") ?? -Infinity) > -0.03 &&
      (factors.get("f-tight-breakout") ?? -Infinity) > -0.03 &&
      (factors.get("f-low-vol-mom") ?? -Infinity) > -0.2 &&
      (factors.get("f-absolute-momentum") ?? -Infinity) > -0.12
    )
  }
  if (strategy.id === "s-vcp-risk-momentum-breakout") {
    return (
      (factors.get("f-vcp-breakout") ?? -Infinity) > -0.03 &&
      (factors.get("f-tight-breakout") ?? -Infinity) > -0.03 &&
      (factors.get("f-risk-adjusted-mom") ?? -Infinity) > -0.2 &&
      (factors.get("f-low-vol-mom") ?? -Infinity) > -0.2 &&
      (factors.get("f-absolute-momentum") ?? -Infinity) > -0.12
    )
  }
  if (strategy.id === "s-vcp-atr-low-vol-breakout") {
    return (
      (factors.get("f-vcp-breakout") ?? -Infinity) > -0.03 &&
      (factors.get("f-tight-breakout") ?? -Infinity) > -0.03 &&
      (factors.get("f-low-vol-mom") ?? -Infinity) > -0.2 &&
      (factors.get("f-absolute-momentum") ?? -Infinity) > -0.12
    )
  }
  return true
}

function selectDraftStrategyWeights(
  draft: StrategyDraft,
  stocks: StockBars[],
  dates: string[],
  asOfIndex: number,
  targetCount: number,
  persistedFactors?: Map<string, number>,
): Weights {
  const factorIds = draftFactorIds(draft)
  const rawScores = stocks
    .map((stock) => ({
      symbol: stock.symbol,
      factors: factorIds.map((factorId) => ({
        id: factorId,
        value: computeDraftFactorWithStore(stock, dates, asOfIndex, factorId, draft, persistedFactors),
      })),
    }))
    .filter((item) => item.factors.every((factor) => Number.isFinite(factor.value)))

  if (!rawScores.length) return new Map()

  const percentileByFactor = new Map<string, Map<string, number>>()
  for (const factorId of factorIds) {
    percentileByFactor.set(
      factorId,
      rankPercentiles(rawScores.map((item) => ({
        symbol: item.symbol,
        value: item.factors.find((factor) => factor.id === factorId)?.value ?? -Infinity,
      }))),
    )
  }

  const ranked = rawScores
    .map((item) => {
      const score = factorIds.reduce((sum, factorId) => {
        return sum + (percentileByFactor.get(factorId)?.get(item.symbol) ?? 0)
      }, 0) / Math.max(1, factorIds.length)
      return { symbol: item.symbol, score }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, targetCount)

  const weight = ranked.length ? 1 / ranked.length : 0
  return new Map(ranked.map((item) => [item.symbol, weight]))
}

async function prepareDraftFactorArtifacts({
  draft,
  factorDataPlan,
  stocks,
  dates,
  rebalanceDays,
  minIndex,
}: {
  draft: StrategyDraft
  factorDataPlan: FactorDataPlan
  stocks: StockBars[]
  dates: string[]
  rebalanceDays: number
  minIndex: number
}) {
  const strategyId = buildDraftStrategyId(draft)
  const customBindings = factorDataPlan.bindings.filter((binding) => !isCatalogFactorId(binding.factorId))
  const klineValueFactorIds = customBindings
    .filter((binding) => binding.status === "real" && binding.sourceIds.includes("k-line"))
    .map((binding) => binding.factorId)

  let recipeCount = 0
  let savedValues = 0
  const lookup = new Map<string, number>()

  try {
    if (customBindings.length) {
      const result = await saveFactorRecipesToStore(customBindings.map((binding) => ({
        factorId: binding.factorId,
        factorName: binding.factorName,
        category: binding.category,
        formula: binding.formula,
        implementation: binding.currentImplementation,
        status: binding.status,
        source: "strategy-lab",
        strategyId,
        strategyName: draft.name,
        timeframe: draft.timeframe,
        requiredFields: binding.requiredFields,
        sourceIds: binding.sourceIds,
        dsl: draft.dsl as unknown as Record<string, unknown>,
        binding: binding as unknown as Record<string, unknown>,
      })))
      recipeCount = result.saved
    }

    if (klineValueFactorIds.length) {
      const decisionDates = draftDecisionDates(dates, minIndex, rebalanceDays)
      const persistDates = capPersistedDecisionDates(decisionDates, stocks.length, klineValueFactorIds.length)
      const symbols = stocks.map((stock) => stock.symbol)
      const existing = await loadFactorValuesFromStore(klineValueFactorIds, symbols, persistDates)
      for (const [key, value] of existing) lookup.set(key, value)

      const dateIndex = new Map(dates.map((date, index) => [date, index]))
      const rows: FactorValueInput[] = []
      for (const factorId of klineValueFactorIds) {
        for (const stock of stocks) {
          for (const date of persistDates) {
            const key = factorValueStoreKey(factorId, stock.symbol, date)
            if (lookup.has(key)) continue
            const asOfIndex = dateIndex.get(date)
            if (asOfIndex == null) continue
            const value = computeDraftFactor(stock, dates, asOfIndex, factorId, draft)
            if (!Number.isFinite(value)) continue
            lookup.set(key, value)
            rows.push({
              factorId,
              symbol: stock.symbol,
              asOf: date,
              value,
              source: `strategy-lab-kline:${strategyId}`,
            })
          }
        }
      }
      const result = await saveFactorValuesToStore(rows)
      savedValues = result.saved
    }
  } catch (error) {
    return {
      lookup,
      message: `因子入库：失败，${error instanceof Error ? error.message : "数据库写入异常"}；本次回测继续使用内存计算值。`,
    }
  }

  if (!customBindings.length) {
    return { lookup, message: "因子入库：本策略未包含策略实验室自定义因子，沿用内置 factor_values。" }
  }

  return {
    lookup,
    message: `因子入库：factor_recipes ${recipeCount} 个，近期 factor_values 新增/更新 ${savedValues} 条；回测优先读取持久化因子值，缺口用同一公式内存计算。`,
  }
}

function capPersistedDecisionDates(decisionDates: string[], stockCount: number, factorCount: number) {
  const rowsPerDate = Math.max(1, stockCount * factorCount)
  const maxDates = Math.max(1, Math.floor(MAX_INTERACTIVE_FACTOR_VALUE_ROWS / rowsPerDate))
  return decisionDates.slice(-maxDates)
}

function draftDecisionDates(dates: string[], minIndex: number, rebalanceDays: number) {
  const result = new Set<string>()
  for (let i = minIndex; i < dates.length; i++) {
    if ((i - minIndex) % rebalanceDays === 0) {
      const decisionDate = dates[i - 1]
      if (decisionDate) result.add(decisionDate)
    }
  }
  return Array.from(result)
}

function computeDraftFactorWithStore(
  stock: StockBars,
  dates: string[],
  asOfIndex: number,
  factorId: string,
  draft: StrategyDraft,
  persistedFactors?: Map<string, number>,
) {
  const date = dates[asOfIndex]
  if (date && persistedFactors?.has(factorValueStoreKey(factorId, stock.symbol, date))) {
    return persistedFactors.get(factorValueStoreKey(factorId, stock.symbol, date)) ?? -Infinity
  }
  return computeDraftFactor(stock, dates, asOfIndex, factorId, draft)
}

function computeCatalogFactor(stock: StockBars, dates: string[], asOfIndex: number, factorId: CatalogFactorId) {
  switch (factorId) {
    case "f-mom-60d":
      return factorMomentum60(stock, dates, asOfIndex) - safeRet(stock, dates, asOfIndex, 5)
    case "f-vol-spike":
      return factorVolumeSpike(stock, dates, asOfIndex)
    case "f-rev-5d":
      return factorReversal5(stock, dates, asOfIndex)
    case "f-donchian-55":
      return factorDonchianBreakout(stock, dates, asOfIndex, 55)
    case "f-atr-compression":
      return factorAtrCompression(stock, dates, asOfIndex)
    case "f-minervini-trend":
      return factorMinerviniTrend(stock, dates, asOfIndex)
    case "f-canslim-proxy":
      return factorCanSlimProxy(stock, dates, asOfIndex)
    case "f-absolute-momentum":
      return factorAbsoluteMomentum(stock, dates, asOfIndex)
    case "f-low-vol-mom":
      return factorLowVolMomentum(stock, dates, asOfIndex)
    case "f-rsi2-reversal":
      return factorRsi2Reversal(stock, dates, asOfIndex)
    case "f-bollinger-revert":
      return factorBollingerReversion(stock, dates, asOfIndex)
    case "f-sma200-momentum":
      return factorSma200Momentum(stock, dates, asOfIndex)
    case "f-risk-adjusted-mom":
      return factorRiskAdjustedMomentum(stock, dates, asOfIndex)
    case "f-macd-trend":
      return factorMacdTrend(stock, dates, asOfIndex)
    case "f-tight-breakout":
      return factorTightBreakout(stock, dates, asOfIndex)
    case "f-pullback-uptrend":
      return factorPullbackUptrend(stock, dates, asOfIndex)
    case "f-vcp-breakout":
      return factorVcpBreakout(stock, dates, asOfIndex)
    case "f-keltner-breakout":
      return factorKeltnerBreakout(stock, dates, asOfIndex)
    case "f-post-breakout-hold":
      return factorPostBreakoutHold(stock, dates, asOfIndex)
    case "f-rsrs-right-side":
      return factorRsrsRightSide(stock, dates, asOfIndex)
    case "f-residual-mom-low-vol":
      return factorResidualMomentumLowVol(stock, dates, asOfIndex)
    case "f-mid-vol-reversal":
      return factorMidVolReversal(stock, dates, asOfIndex)
    case "f-value-low-vol":
      return factorValueLowVol(stock, dates, asOfIndex)
    case "f-north-net":
      return factorVolumeSpike(stock, dates, asOfIndex) * Math.max(0, safeRet(stock, dates, asOfIndex, 20))
    case "f-dragon-inst":
      return factorVolumeSpike(stock, dates, asOfIndex) * Math.max(0, factorReversal5(stock, dates, asOfIndex))
    case "f-ai-breakout":
      return factorBreakoutPattern(stock, dates, asOfIndex)
    case "f-ai-flow":
      return factorVolumeSpike(stock, dates, asOfIndex) * Math.max(0, safeRet(stock, dates, asOfIndex, 20))
    case "f-intra-vwap":
      return factorDailyVwapReversion(stock, dates, asOfIndex)
    case "f-overnight":
      return factorOvernightReversal(stock, dates, asOfIndex)
    case "f-pe-rev":
      return factorValueProxy(stock, dates, asOfIndex)
    case "f-news-sent":
      return Math.max(0, safeRet(stock, dates, asOfIndex, 5)) * factorVolumeSpike(stock, dates, asOfIndex)
    case "f-margin-spike":
      return factorVolumeAcceleration(stock, dates, asOfIndex)
    default:
      return -Infinity
  }
}

function computeDraftFactor(stock: StockBars, dates: string[], asOfIndex: number, factorId: string, draft: StrategyDraft) {
  if (isCatalogFactorId(factorId)) return computeCatalogFactor(stock, dates, asOfIndex, factorId)
  return computeCatalogFactor(stock, dates, asOfIndex, inferDraftFactorProxy(factorId, draft))
}

function isCatalogFactorId(factorId: string): factorId is CatalogFactorId {
  return [
    "f-mom-60d",
    "f-vol-spike",
    "f-rev-5d",
    "f-donchian-55",
    "f-atr-compression",
    "f-minervini-trend",
    "f-canslim-proxy",
    "f-absolute-momentum",
    "f-low-vol-mom",
    "f-rsi2-reversal",
    "f-bollinger-revert",
    "f-sma200-momentum",
    "f-risk-adjusted-mom",
    "f-macd-trend",
    "f-tight-breakout",
    "f-pullback-uptrend",
    "f-vcp-breakout",
    "f-keltner-breakout",
    "f-post-breakout-hold",
    "f-rsrs-right-side",
    "f-residual-mom-low-vol",
    "f-mid-vol-reversal",
    "f-value-low-vol",
    "f-north-net",
    "f-dragon-inst",
    "f-ai-breakout",
    "f-ai-flow",
    "f-intra-vwap",
    "f-overnight",
    "f-pe-rev",
    "f-news-sent",
    "f-margin-spike",
  ].includes(factorId)
}

function inferDraftFactorProxy(factorId: string, draft: StrategyDraft): CatalogFactorId {
  const mapping = draft.factorMap.find((item) => item.factorId === factorId)
  const text = `${factorId} ${mapping?.factorName ?? ""} ${mapping?.sourceText ?? ""} ${mapping?.note ?? ""}`.toLowerCase()
  if (/donchian|海龟|通道|channel|新高|52周|52w/.test(text)) return "f-donchian-55"
  if (/vcp|收缩|窄幅|缩量|volatility contraction/.test(text)) return "f-vcp-breakout"
  if (/keltner|atr.*突破|通道突破/.test(text)) return "f-keltner-breakout"
  if (/rsrs|斜率|slope|右侧/.test(text)) return "f-rsrs-right-side"
  if (/minervini|趋势模板|trend template|均线多头/.test(text)) return "f-minervini-trend"
  if (/canslim|can slim|成长|eps|业绩/.test(text)) return "f-canslim-proxy"
  if (/绝对动量|absolute|弱市|空仓|风控/.test(text)) return "f-absolute-momentum"
  if (/残差动量|residual/.test(text)) return "f-residual-mom-low-vol"
  if (/低波动|low vol|波动率|价值|value/.test(text)) return "f-low-vol-mom"
  if (/rsi|connors|超卖/.test(text)) return "f-rsi2-reversal"
  if (/bollinger|布林|下轨/.test(text)) return "f-bollinger-revert"
  if (/量|volume|vol|成交|换手|流动性|突破|breakout|关键点/.test(text)) return "f-vol-spike"
  if (/回撤|回调|止损|反转|reversal|rev|超跌/.test(text)) return "f-rev-5d"
  if (/估值|pe|value|便宜|低位/.test(text)) return "f-pe-rev"
  if (/新闻|情绪|sent|研报|舆情/.test(text)) return "f-news-sent"
  if (/资金|北向|主力|flow|龙虎榜/.test(text)) return "f-north-net"
  if (/形态|ai|pattern/.test(text)) return "f-ai-breakout"
  return "f-mom-60d"
}

function draftFactorIds(draft: StrategyDraft) {
  const ids = new Set<string>()
  for (const item of draft.dsl.ranking) {
    const id = item.trim().split(/\s+/)[0]
    if (id) ids.add(id)
  }
  for (const item of draft.factorMap) {
    if (item.factorId) ids.add(item.factorId)
  }
  if (!ids.size) ids.add("f-mom-60d")
  return Array.from(ids)
}

function parseDraftRebalanceDays(value: string) {
  const match = value.match(/(\d+)/)
  if (!match) return REBALANCE_DAYS
  return Math.max(1, Math.min(30, Number(match[1]) || REBALANCE_DAYS))
}

function buildDraftStrategyId(draft: StrategyDraft) {
  return `lab-${slug(draft.name)}-${shortHash(JSON.stringify(draft.dsl))}`
}

function isDirectPriceFactor(factorId: string) {
  return [
    "f-mom-60d",
    "f-vol-spike",
    "f-rev-5d",
    "f-donchian-55",
    "f-atr-compression",
    "f-minervini-trend",
    "f-absolute-momentum",
    "f-low-vol-mom",
    "f-rsi2-reversal",
    "f-bollinger-revert",
    "f-sma200-momentum",
    "f-risk-adjusted-mom",
    "f-macd-trend",
    "f-tight-breakout",
    "f-pullback-uptrend",
    "f-vcp-breakout",
    "f-keltner-breakout",
    "f-post-breakout-hold",
    "f-rsrs-right-side",
    "f-residual-mom-low-vol",
    "f-mid-vol-reversal",
    "f-value-low-vol",
    "f-intra-vwap",
    "f-overnight",
  ].includes(factorId)
}

function safeRet(stock: StockBars, dates: string[], asOfIndex: number, days: number) {
  const now = barForDate(stock, dates[asOfIndex])
  const before = barForDate(stock, dates[asOfIndex - days])
  if (!now || !before || before.close <= 0) return -Infinity
  return now.close / before.close - 1
}

function factorBreakoutPattern(stock: StockBars, dates: string[], asOfIndex: number) {
  const now = barForDate(stock, dates[asOfIndex])
  if (!now) return -Infinity
  const recentBars = dates
    .slice(Math.max(0, asOfIndex - 60), asOfIndex)
    .map((date) => barForDate(stock, date))
    .filter((bar): bar is Bar => Boolean(bar))
  if (recentBars.length < 30) return -Infinity
  const recentHigh = Math.max(...recentBars.map((bar) => bar.high))
  const volumeScore = factorVolumeSpike(stock, dates, asOfIndex)
  return (recentHigh > 0 ? now.close / recentHigh - 1 : -Infinity) + Math.max(0, volumeScore - 1) * 0.08
}

function factorDailyVwapReversion(stock: StockBars, dates: string[], asOfIndex: number) {
  const now = barForDate(stock, dates[asOfIndex])
  if (!now) return -Infinity
  const typical = (now.high + now.low + now.close) / 3
  if (typical <= 0) return -Infinity
  return (typical - now.close) / typical
}

function factorOvernightReversal(stock: StockBars, dates: string[], asOfIndex: number) {
  const now = barForDate(stock, dates[asOfIndex])
  const prev = barForDate(stock, dates[asOfIndex - 1])
  if (!now || !prev || prev.close <= 0 || now.open <= 0) return -Infinity
  const gap = now.open / prev.close - 1
  const intraday = now.close / now.open - 1
  return -gap * Math.sign(intraday || gap)
}

function factorValueProxy(stock: StockBars, dates: string[], asOfIndex: number) {
  const now = barForDate(stock, dates[asOfIndex])
  if (!now) return -Infinity
  const closes = dates
    .slice(Math.max(0, asOfIndex - 120), asOfIndex + 1)
    .map((date) => barForDate(stock, date)?.close)
    .filter((close): close is number => typeof close === "number" && close > 0)
  if (closes.length < 60) return -Infinity
  const low = Math.min(...closes)
  const high = Math.max(...closes)
  if (high <= low) return 0
  return 1 - (now.close - low) / (high - low)
}

function factorDonchianBreakout(stock: StockBars, dates: string[], asOfIndex: number, days: number) {
  const now = barForDate(stock, dates[asOfIndex])
  const priorHigh = highestHigh(stock, dates, asOfIndex, days)
  if (!now || !priorHigh || priorHigh <= 0) return -Infinity
  const breakout = now.close / priorHigh - 1
  const volume = factorVolumeSpike(stock, dates, asOfIndex)
  return breakout + Math.max(0, volume - 1) * 0.04
}

function factorAtrCompression(stock: StockBars, dates: string[], asOfIndex: number) {
  const now = barForDate(stock, dates[asOfIndex])
  if (!now || now.close <= 0) return -Infinity
  const ratios: number[] = []
  for (let i = Math.max(20, asOfIndex - 120); i <= asOfIndex; i++) {
    const bar = barForDate(stock, dates[i])
    const value = atrRatio(stock, dates, i, 14)
    if (bar && value != null && Number.isFinite(value)) ratios.push(value)
  }
  const current = atrRatio(stock, dates, asOfIndex, 14)
  if (current == null || ratios.length < 40) return -Infinity
  const ranked = [...ratios].sort((a, b) => a - b)
  const idx = ranked.findIndex((value) => value >= current)
  const percentile = (idx < 0 ? ranked.length - 1 : idx) / Math.max(1, ranked.length - 1)
  return 1 - percentile
}

function factorMinerviniTrend(stock: StockBars, dates: string[], asOfIndex: number) {
  const now = barForDate(stock, dates[asOfIndex])
  if (!now) return -Infinity
  const ma50 = movingAverage(stock, dates, asOfIndex, 50)
  const ma150 = movingAverage(stock, dates, asOfIndex, 150)
  const ma200 = movingAverage(stock, dates, asOfIndex, 200)
  const ma200Prev = movingAverage(stock, dates, asOfIndex - 20, 200)
  const high252 = highestHigh(stock, dates, asOfIndex + 1, 252)
  const low252 = lowestLow(stock, dates, asOfIndex + 1, 252)
  const ret120 = safeRet(stock, dates, asOfIndex, 120)
  if (!ma50 || !ma150 || !ma200 || !ma200Prev || !high252 || !low252 || low252 <= 0 || !Number.isFinite(ret120)) return -Infinity
  const checks = [
    now.close > ma50,
    ma50 > ma150,
    ma150 > ma200,
    ma200 > ma200Prev,
    now.close >= high252 * 0.75,
    now.close >= low252 * 1.3,
    ret120 > 0,
  ]
  return checks.filter(Boolean).length / checks.length + Math.max(0, ret120) * 0.35
}

function factorCanSlimProxy(stock: StockBars, dates: string[], asOfIndex: number) {
  const now = barForDate(stock, dates[asOfIndex])
  const high252 = highestHigh(stock, dates, asOfIndex + 1, 252)
  if (!now || !high252 || high252 <= 0) return -Infinity
  const ret120 = safeRet(stock, dates, asOfIndex, 120)
  const ret20 = safeRet(stock, dates, asOfIndex, 20)
  const volume = factorVolumeSpike(stock, dates, asOfIndex)
  const newHighProximity = now.close / high252
  if (![ret120, ret20, volume, newHighProximity].every(Number.isFinite)) return -Infinity
  return ret120 * 0.55 + Math.max(0, ret20) * 0.2 + Math.max(0, volume - 1) * 0.08 + newHighProximity * 0.25
}

function factorAbsoluteMomentum(stock: StockBars, dates: string[], asOfIndex: number) {
  const now = barForDate(stock, dates[asOfIndex])
  const ma120 = movingAverage(stock, dates, asOfIndex, 120)
  const ret120 = safeRet(stock, dates, asOfIndex, 120)
  if (!now || !ma120 || !Number.isFinite(ret120)) return -Infinity
  return now.close >= ma120 && ret120 > 0 ? ret120 : ret120 - 0.35
}

function factorLowVolMomentum(stock: StockBars, dates: string[], asOfIndex: number) {
  const ret120 = safeRet(stock, dates, asOfIndex, 120)
  const vol20 = returnVolatility(stock, dates, asOfIndex, 20)
  if (!Number.isFinite(ret120) || vol20 == null) return -Infinity
  return ret120 - vol20 * Math.sqrt(252) * 0.35
}

function factorRsi2Reversal(stock: StockBars, dates: string[], asOfIndex: number) {
  const value = rsi(stock, dates, asOfIndex, 2)
  const ma120 = movingAverage(stock, dates, asOfIndex, 120)
  const now = barForDate(stock, dates[asOfIndex])
  if (value == null || !ma120 || !now) return -Infinity
  const trendGate = now.close >= ma120 ? 1 : 0.35
  return (100 - value) * trendGate
}

function factorBollingerReversion(stock: StockBars, dates: string[], asOfIndex: number) {
  const now = barForDate(stock, dates[asOfIndex])
  const ma20 = movingAverage(stock, dates, asOfIndex, 20)
  const ma120 = movingAverage(stock, dates, asOfIndex, 120)
  const vol20 = closeStd(stock, dates, asOfIndex, 20)
  if (!now || !ma20 || !ma120 || !vol20 || vol20 <= 0) return -Infinity
  const lower = ma20 - vol20 * 2
  const trendGate = now.close >= ma120 ? 1 : 0.45
  return ((lower - now.close) / vol20) * trendGate
}

function factorSma200Momentum(stock: StockBars, dates: string[], asOfIndex: number) {
  const now = barForDate(stock, dates[asOfIndex])
  const ma50 = movingAverage(stock, dates, asOfIndex, 50)
  const ma150 = movingAverage(stock, dates, asOfIndex, 150)
  const ma200 = movingAverage(stock, dates, asOfIndex, 200)
  const ret120 = safeRet(stock, dates, asOfIndex, 120)
  if (!now || !ma50 || !ma150 || !ma200 || !Number.isFinite(ret120) || ma200 <= 0) return -Infinity
  const trendOk = now.close > ma200 && ma50 > ma150
  const distance = now.close / ma200 - 1
  return trendOk ? ret120 + Math.max(0, distance) * 0.25 : ret120 - 0.45
}

function factorRiskAdjustedMomentum(stock: StockBars, dates: string[], asOfIndex: number) {
  const ret60 = safeRet(stock, dates, asOfIndex, 60)
  const vol20 = returnVolatility(stock, dates, asOfIndex, 20)
  if (!Number.isFinite(ret60) || vol20 == null || vol20 <= 0) return -Infinity
  return ret60 / (vol20 * Math.sqrt(252))
}

function factorMacdTrend(stock: StockBars, dates: string[], asOfIndex: number) {
  const now = barForDate(stock, dates[asOfIndex])
  const ema12 = exponentialMovingAverage(stock, dates, asOfIndex, 12)
  const ema26 = exponentialMovingAverage(stock, dates, asOfIndex, 26)
  const ma20 = movingAverage(stock, dates, asOfIndex, 20)
  const ma60 = movingAverage(stock, dates, asOfIndex, 60)
  if (!now || !ema12 || !ema26 || !ma20 || !ma60 || now.close <= 0 || ma60 <= 0) return -Infinity
  const macd = (ema12 - ema26) / now.close
  const slope = ma20 / ma60 - 1
  return macd + slope * 0.6
}

function factorTightBreakout(stock: StockBars, dates: string[], asOfIndex: number) {
  const now = barForDate(stock, dates[asOfIndex])
  const priorHigh20 = highestHigh(stock, dates, asOfIndex, 20)
  const ma60 = movingAverage(stock, dates, asOfIndex, 60)
  const atr = atrRatio(stock, dates, asOfIndex, 14)
  const volume = factorVolumeSpike(stock, dates, asOfIndex)
  if (!now || !priorHigh20 || !ma60 || atr == null || priorHigh20 <= 0 || !Number.isFinite(volume)) return -Infinity
  const breakout = now.close / priorHigh20 - 1
  const trendGate = now.close >= ma60 ? 1 : 0.35
  const tightness = Math.max(0, 0.045 - atr)
  return (breakout + Math.max(0, volume - 1) * 0.05 + tightness) * trendGate
}

function factorPullbackUptrend(stock: StockBars, dates: string[], asOfIndex: number) {
  const now = barForDate(stock, dates[asOfIndex])
  const ma50 = movingAverage(stock, dates, asOfIndex, 50)
  const ma150 = movingAverage(stock, dates, asOfIndex, 150)
  const ma200 = movingAverage(stock, dates, asOfIndex, 200)
  const value = rsi(stock, dates, asOfIndex, 2)
  if (!now || !ma50 || !ma150 || !ma200 || value == null) return -Infinity
  const trendOk = now.close > ma200 && ma50 > ma150
  return trendOk ? 100 - value : (100 - value) * 0.2
}

function factorVcpBreakout(stock: StockBars, dates: string[], asOfIndex: number) {
  const now = barForDate(stock, dates[asOfIndex])
  const priorHigh50 = highestHigh(stock, dates, asOfIndex, 50)
  const ma60 = movingAverage(stock, dates, asOfIndex, 60)
  const atrNow = atrRatio(stock, dates, asOfIndex, 14)
  const atrBefore = atrRatio(stock, dates, asOfIndex - 20, 14)
  const recentVolume = meanVolume(stock, dates, asOfIndex - 1, 5)
  const baseVolume = meanVolume(stock, dates, asOfIndex - 6, 30)
  const volume = factorVolumeSpike(stock, dates, asOfIndex)
  if (!now || !priorHigh50 || !ma60 || atrNow == null || atrBefore == null || !recentVolume || !baseVolume || !Number.isFinite(volume)) return -Infinity
  const breakout = priorHigh50 > 0 ? now.close / priorHigh50 - 1 : -Infinity
  const contraction = Math.max(0, atrBefore - atrNow)
  const dryUp = Math.max(0, 1 - recentVolume / baseVolume)
  const trendGate = now.close >= ma60 ? 1 : 0.25
  return (breakout + contraction * 1.35 + dryUp * 0.08 + Math.max(0, volume - 1) * 0.04) * trendGate
}

function factorKeltnerBreakout(stock: StockBars, dates: string[], asOfIndex: number) {
  const now = barForDate(stock, dates[asOfIndex])
  const ema20 = exponentialMovingAverage(stock, dates, asOfIndex, 20)
  const ma60 = movingAverage(stock, dates, asOfIndex, 60)
  const atr = atrRatio(stock, dates, asOfIndex, 20)
  const volume = factorVolumeSpike(stock, dates, asOfIndex)
  if (!now || !ema20 || !ma60 || atr == null || !Number.isFinite(volume) || now.close <= 0) return -Infinity
  const upper = ema20 + now.close * atr * 1.5
  const breakout = upper > 0 ? now.close / upper - 1 : -Infinity
  const trendGate = now.close >= ma60 ? 1 : 0.25
  return (breakout + Math.max(0, volume - 1) * 0.04 + Math.max(0, safeRet(stock, dates, asOfIndex, 20)) * 0.25) * trendGate
}

function factorPostBreakoutHold(stock: StockBars, dates: string[], asOfIndex: number) {
  const now = barForDate(stock, dates[asOfIndex])
  const pivot = highestHigh(stock, dates, asOfIndex - 5, 20)
  const recentLow = lowestLow(stock, dates, asOfIndex + 1, 5)
  const ret5 = safeRet(stock, dates, asOfIndex, 5)
  const ma60 = movingAverage(stock, dates, asOfIndex, 60)
  const volume = factorVolumeSpike(stock, dates, asOfIndex)
  if (!now || !pivot || !recentLow || !ma60 || !Number.isFinite(ret5) || !Number.isFinite(volume)) return -Infinity
  const heldAbovePivot = recentLow / pivot - 1
  const trendGate = now.close >= ma60 ? 1 : 0.25
  return (heldAbovePivot + Math.max(0, ret5) * 0.45 + Math.max(0, volume - 0.8) * 0.03) * trendGate
}

function factorRsrsRightSide(stock: StockBars, dates: string[], asOfIndex: number) {
  const window = 18
  const history = 110
  if (asOfIndex < window + history) return -Infinity
  const values: number[] = []
  for (let end = asOfIndex - history + 1; end <= asOfIndex; end++) {
    const regression = highLowRegression(stock, dates, end, window)
    if (regression) values.push(regression.slope * regression.r2)
  }
  if (values.length < 80) return -Infinity
  const current = values[values.length - 1]
  const avg = mean(values)
  const deviation = std(values)
  if (!deviation) return -Infinity
  const z = (current - avg) / deviation
  const ret60 = safeRet(stock, dates, asOfIndex, 60)
  return z + (Number.isFinite(ret60) ? ret60 * 0.5 : 0)
}

function factorResidualMomentumLowVol(stock: StockBars, dates: string[], asOfIndex: number) {
  const ret120 = safeRet(stock, dates, asOfIndex, 120)
  const ret20 = safeRet(stock, dates, asOfIndex, 20)
  const ret5 = safeRet(stock, dates, asOfIndex, 5)
  const vol20 = returnVolatility(stock, dates, asOfIndex, 20)
  if (!Number.isFinite(ret120) || !Number.isFinite(ret20) || !Number.isFinite(ret5) || vol20 == null) return -Infinity
  const annualVol = vol20 * Math.sqrt(252)
  return ret120 - Math.max(0, ret20) * 0.45 - Math.abs(ret5) * 0.25 - annualVol * 0.28
}

function factorMidVolReversal(stock: StockBars, dates: string[], asOfIndex: number) {
  const now = barForDate(stock, dates[asOfIndex])
  const ma120 = movingAverage(stock, dates, asOfIndex, 120)
  const ret20 = safeRet(stock, dates, asOfIndex, 20)
  const ret5 = safeRet(stock, dates, asOfIndex, 5)
  const vol20 = returnVolatility(stock, dates, asOfIndex, 20)
  if (!now || !ma120 || !Number.isFinite(ret20) || !Number.isFinite(ret5) || vol20 == null) return -Infinity
  const annualVol = vol20 * Math.sqrt(252)
  const midVolScore = Math.max(0, 1 - Math.abs(annualVol - 0.32) / 0.32)
  const trendGate = now.close >= ma120 ? 1 : 0.2
  return (-ret20 * 0.8 - ret5 * 0.2) * midVolScore * trendGate
}

function factorValueLowVol(stock: StockBars, dates: string[], asOfIndex: number) {
  const value = factorValueProxy(stock, dates, asOfIndex)
  const absoluteMomentum = factorAbsoluteMomentum(stock, dates, asOfIndex)
  const vol20 = returnVolatility(stock, dates, asOfIndex, 20)
  if (!Number.isFinite(value) || !Number.isFinite(absoluteMomentum) || vol20 == null) return -Infinity
  const annualVol = vol20 * Math.sqrt(252)
  return value * 0.45 + Math.max(0, absoluteMomentum) * 0.35 - annualVol * 0.2
}

function factorVolumeAcceleration(stock: StockBars, dates: string[], asOfIndex: number) {
  const recent = meanVolume(stock, dates, asOfIndex, 5)
  const mid = meanVolume(stock, dates, asOfIndex - 5, 5)
  const base = meanVolume(stock, dates, asOfIndex - 10, 10)
  if (!recent || !mid || !base) return -Infinity
  return (recent - mid) / base
}

function strategyRequiredLookback(strategy: Pick<Strategy, "factors">) {
  let lookback = STRATEGY_MIN_LOOKBACK
  for (const factorId of strategy.factors) {
    if (factorId === "f-minervini-trend" || factorId === "f-canslim-proxy" || factorId === "f-sma200-momentum" || factorId === "f-pullback-uptrend" || factorId === "f-rsrs-right-side") lookback = Math.max(lookback, 252)
    if (factorId === "f-absolute-momentum" || factorId === "f-low-vol-mom" || factorId === "f-rsi2-reversal" || factorId === "f-bollinger-revert" || factorId === "f-risk-adjusted-mom" || factorId === "f-residual-mom-low-vol" || factorId === "f-mid-vol-reversal" || factorId === "f-value-low-vol") lookback = Math.max(lookback, 140)
    if (factorId === "f-donchian-55" || factorId === "f-atr-compression" || factorId === "f-vcp-breakout") lookback = Math.max(lookback, 125)
    if (factorId === "f-macd-trend" || factorId === "f-tight-breakout" || factorId === "f-keltner-breakout" || factorId === "f-post-breakout-hold") lookback = Math.max(lookback, 90)
  }
  return lookback
}

function shouldHoldCash(strategy: Pick<Strategy, "factors"> & Partial<Pick<Strategy, "id">>, stocks: StockBars[], dates: string[], asOfIndex: number) {
  if (!strategy.factors.includes("f-absolute-momentum")) return false
  const defensiveIds = new Set([
    "s-sma200-rsi2-defensive",
    "s-macd-low-vol-trend",
    "s-tight-breakout-defensive",
    "s-vcp-breakout-a-share",
    "s-keltner-atr-breakout",
    "s-post-breakout-hold",
    "s-rsrs-right-side",
    "s-residual-mom-low-vol",
    "s-mid-vol-reversal",
    "s-value-low-vol-quality",
    "s-sma200-strength-rotation",
    "s-defensive-minervini",
    "s-ranked-rsi2-bollinger",
    "s-bollinger-low-vol-reversion",
    "s-mid-vol-reversal-low-vol",
    "s-vcp-low-vol-breakout",
    "s-vcp-risk-momentum-breakout",
    "s-vcp-atr-low-vol-breakout",
  ])
  const ret60 = meanSafeRet(stocks, dates, asOfIndex, 60)
  const ret120 = meanSafeRet(stocks, dates, asOfIndex, 120)
  const ret20 = meanSafeRet(stocks, dates, asOfIndex, 20)
  if (!Number.isFinite(ret120) || !Number.isFinite(ret20)) return false
  if (strategy.id && defensiveIds.has(strategy.id)) {
    return ret20 < -0.015 || ret60 < -0.03 || ret120 < 0
  }
  return ret120 < 0 && ret20 < 0
}

function meanSafeRet(stocks: StockBars[], dates: string[], asOfIndex: number, days: number) {
  const returns = stocks
    .map((stock) => safeRet(stock, dates, asOfIndex, days))
    .filter((value) => Number.isFinite(value))
  return mean(returns)
}

function movingAverage(stock: StockBars, dates: string[], asOfIndex: number, days: number) {
  if (asOfIndex - days + 1 < 0) return null
  const closes = dates
    .slice(asOfIndex - days + 1, asOfIndex + 1)
    .map((date) => barForDate(stock, date)?.close)
    .filter((close): close is number => typeof close === "number" && close > 0)
  return closes.length === days ? mean(closes) : null
}

function exponentialMovingAverage(stock: StockBars, dates: string[], asOfIndex: number, days: number) {
  if (asOfIndex - days * 3 + 1 < 0) return null
  const closes = dates
    .slice(asOfIndex - days * 3 + 1, asOfIndex + 1)
    .map((date) => barForDate(stock, date)?.close)
    .filter((close): close is number => typeof close === "number" && close > 0)
  if (closes.length < days) return null
  const k = 2 / (days + 1)
  let ema = closes.slice(0, days).reduce((sum, close) => sum + close, 0) / days
  for (const close of closes.slice(days)) {
    ema = close * k + ema * (1 - k)
  }
  return ema
}

function highestHigh(stock: StockBars, dates: string[], asOfIndex: number, days: number) {
  if (asOfIndex - days < 0) return null
  const highs = dates
    .slice(asOfIndex - days, asOfIndex)
    .map((date) => barForDate(stock, date)?.high)
    .filter((high): high is number => typeof high === "number" && high > 0)
  return highs.length >= Math.min(days, 40) ? Math.max(...highs) : null
}

function lowestLow(stock: StockBars, dates: string[], asOfIndex: number, days: number) {
  if (asOfIndex - days < 0) return null
  const lows = dates
    .slice(asOfIndex - days, asOfIndex)
    .map((date) => barForDate(stock, date)?.low)
    .filter((low): low is number => typeof low === "number" && low > 0)
  return lows.length >= Math.min(days, 40) ? Math.min(...lows) : null
}

function atrRatio(stock: StockBars, dates: string[], asOfIndex: number, days: number) {
  const now = barForDate(stock, dates[asOfIndex])
  if (!now || now.close <= 0 || asOfIndex - days + 1 < 0) return null
  let sum = 0
  for (let i = asOfIndex - days + 1; i <= asOfIndex; i++) {
    const bar = barForDate(stock, dates[i])
    if (!bar) return null
    const prev = barForDate(stock, dates[i - 1])
    const prevClose = prev?.close ?? bar.open
    sum += Math.max(bar.high - bar.low, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose))
  }
  return sum / days / now.close
}

function returnVolatility(stock: StockBars, dates: string[], asOfIndex: number, days: number) {
  if (asOfIndex - days < 0) return null
  const returns: number[] = []
  for (let i = asOfIndex - days + 1; i <= asOfIndex; i++) {
    const ret = safeRet(stock, dates, i, 1)
    if (Number.isFinite(ret)) returns.push(ret)
  }
  return returns.length >= days ? std(returns) : null
}

function closeStd(stock: StockBars, dates: string[], asOfIndex: number, days: number) {
  if (asOfIndex - days + 1 < 0) return null
  const closes = dates
    .slice(asOfIndex - days + 1, asOfIndex + 1)
    .map((date) => barForDate(stock, date)?.close)
    .filter((close): close is number => typeof close === "number" && close > 0)
  return closes.length === days ? std(closes) : null
}

function rsi(stock: StockBars, dates: string[], asOfIndex: number, days: number) {
  if (asOfIndex - days < 0) return null
  let gains = 0
  let losses = 0
  for (let i = asOfIndex - days + 1; i <= asOfIndex; i++) {
    const now = barForDate(stock, dates[i])
    const prev = barForDate(stock, dates[i - 1])
    if (!now || !prev) return null
    const diff = now.close - prev.close
    if (diff >= 0) gains += diff
    else losses -= diff
  }
  if (gains === 0 && losses === 0) return 50
  if (losses === 0) return 100
  const rs = gains / losses
  return 100 - 100 / (1 + rs)
}

function highLowRegression(stock: StockBars, dates: string[], asOfIndex: number, days: number) {
  if (asOfIndex - days + 1 < 0) return null
  const lows: number[] = []
  const highs: number[] = []
  for (let i = asOfIndex - days + 1; i <= asOfIndex; i++) {
    const bar = barForDate(stock, dates[i])
    if (!bar || bar.low <= 0 || bar.high <= 0) return null
    lows.push(bar.low)
    highs.push(bar.high)
  }
  const lowVariance = variance(lows)
  const highVariance = variance(highs)
  if (!lowVariance || !highVariance) return null
  const slope = covariance(lows, highs) / lowVariance
  const correlation = covariance(lows, highs) / Math.sqrt(lowVariance * highVariance)
  return { slope, r2: correlation * correlation }
}

function meanVolume(stock: StockBars, dates: string[], asOfIndex: number, days: number) {
  const volumes = dates
    .slice(Math.max(0, asOfIndex - days + 1), asOfIndex + 1)
    .map((date) => barForDate(stock, date)?.volume)
    .filter((volume): volume is number => typeof volume === "number" && volume > 0)
  return mean(volumes)
}

function factorMomentum60(stock: StockBars, dates: string[], asOfIndex: number) {
  const now = barForDate(stock, dates[asOfIndex])
  const before = barForDate(stock, dates[asOfIndex - 60])
  if (!now || !before || before.close <= 0) return -Infinity
  return now.close / before.close - 1
}

function factorVolumeSpike(stock: StockBars, dates: string[], asOfIndex: number) {
  const now = barForDate(stock, dates[asOfIndex])
  if (!now) return -Infinity
  const priorBars = dates
    .slice(Math.max(0, asOfIndex - 20), asOfIndex)
    .map((date) => barForDate(stock, date))
    .filter((bar): bar is Bar => Boolean(bar))
  const avgVolume = mean(priorBars.map((bar) => bar.volume).filter((volume) => volume > 0))
  const ma60 = mean(
    dates
      .slice(Math.max(0, asOfIndex - 60), asOfIndex)
      .map((date) => barForDate(stock, date)?.close)
      .filter((close): close is number => typeof close === "number" && close > 0),
  )
  if (!avgVolume || !ma60) return -Infinity
  const trendGate = now.close >= ma60 ? 1 : 0.45
  return (now.volume / avgVolume) * trendGate
}

function factorReversal5(stock: StockBars, dates: string[], asOfIndex: number) {
  const now = barForDate(stock, dates[asOfIndex])
  const before = barForDate(stock, dates[asOfIndex - 5])
  if (!now || !before || before.close <= 0) return -Infinity
  return -(now.close / before.close - 1)
}

function barForDate(stock: StockBars, date: string | undefined) {
  if (!date) return null
  let index = barIndexCache.get(stock)
  if (!index) {
    index = new Map(stock.bars.map((bar) => [bar.date, bar]))
    barIndexCache.set(stock, index)
  }
  return index.get(date) ?? null
}

function rankPercentiles(items: Array<{ symbol: string; value: number }>) {
  const ranked = items
    .filter((item) => Number.isFinite(item.value))
    .sort((a, b) => a.value - b.value)
  const denominator = Math.max(1, ranked.length - 1)
  return new Map(ranked.map((item, index) => [item.symbol, ranked.length === 1 ? 1 : index / denominator]))
}

function commonDates(stocks: StockBars[]) {
  const counts = new Map<string, number>()
  for (const stock of stocks) {
    for (const bar of stock.bars) counts.set(bar.date, (counts.get(bar.date) ?? 0) + 1)
  }
  const minCoverage = Math.max(TOP_N, Math.min(stocks.length, Math.ceil(stocks.length * 0.65)))
  return Array.from(counts.entries())
    .filter(([, count]) => count >= minCoverage)
    .map(([date]) => date)
    .sort()
}

function portfolioReturn(weights: Weights, priceBySymbol: Map<string, Map<string, number>>, prevDate: string, date: string) {
  let ret = 0
  for (const [symbol, weight] of weights) {
    const prices = priceBySymbol.get(symbol)
    const prev = prices?.get(prevDate)
    const next = prices?.get(date)
    if (prev && next) ret += weight * (next / prev - 1)
  }
  return ret
}

function openPositionsForDate(weights: Weights, date: string, priceBySymbol: Map<string, Map<string, number>>) {
  const positions = new Map<string, OpenPosition>()
  for (const [symbol, weight] of weights) {
    const entryPrice = priceBySymbol.get(symbol)?.get(date)
    if (entryPrice && entryPrice > 0) {
      positions.set(symbol, { symbol, entryDate: date, entryPrice, weight })
    }
  }
  return positions
}

function closePositionTrades(
  trades: BacktestPositionTrade[],
  openPositions: Map<string, OpenPosition>,
  exitDate: string,
  exitReason: BacktestPositionTrade["exitReason"],
  stocks: StockBars[],
  priceBySymbol: Map<string, Map<string, number>>,
  nameBySymbol: Map<string, string>,
) {
  if (!exitDate || openPositions.size === 0) return
  for (const position of openPositions.values()) {
    if (position.entryDate === exitDate) continue
    const exitPrice = priceBySymbol.get(position.symbol)?.get(exitDate)
    if (!exitPrice || exitPrice <= 0 || position.entryPrice <= 0) continue
    const rawReturn = exitPrice / position.entryPrice - 1
    const netReturn = rawReturn - FEE_RATE * 2
    const benchmarkReturn = equalWeightPeriodReturn(stocks, priceBySymbol, position.entryDate, exitDate)
    trades.push({
      symbol: position.symbol,
      name: nameBySymbol.get(position.symbol) ?? position.symbol,
      entryDate: position.entryDate,
      exitDate,
      exitReason,
      entryPrice: round4(position.entryPrice),
      exitPrice: round4(exitPrice),
      weight: round4(position.weight),
      returnPct: round4(netReturn * 100),
      benchmarkReturnPct: round4(benchmarkReturn * 100),
      alphaPct: round4((netReturn - benchmarkReturn) * 100),
      holdingDays: Math.max(1, calendarDayDiff(position.entryDate, exitDate)),
    })
  }
  openPositions.clear()
}

function equalWeightReturn(stocks: StockBars[], priceBySymbol: Map<string, Map<string, number>>, prevDate: string, date: string) {
  const returns = stocks
    .map((stock) => {
      const prices = priceBySymbol.get(stock.symbol)
      const prev = prices?.get(prevDate)
      const next = prices?.get(date)
      return prev && next ? next / prev - 1 : null
    })
    .filter((value): value is number => value != null)
  return mean(returns)
}

function equalWeightPeriodReturn(stocks: StockBars[], priceBySymbol: Map<string, Map<string, number>>, entryDate: string, exitDate: string) {
  const returns = stocks
    .map((stock) => {
      const prices = priceBySymbol.get(stock.symbol)
      const entry = prices?.get(entryDate)
      const exit = prices?.get(exitDate)
      return entry && exit ? exit / entry - 1 : null
    })
    .filter((value): value is number => value != null)
  return mean(returns)
}

function portfolioTurnover(prev: Weights, next: Weights) {
  const symbols = new Set([...prev.keys(), ...next.keys()])
  let turnover = 0
  for (const symbol of symbols) {
    turnover += Math.abs((next.get(symbol) ?? 0) - (prev.get(symbol) ?? 0))
  }
  return turnover / 2
}

function calendarDayDiff(start: string, end: string) {
  const startTime = new Date(`${start}T00:00:00Z`).getTime()
  const endTime = new Date(`${end}T00:00:00Z`).getTime()
  if (Number.isNaN(startTime) || Number.isNaN(endTime)) return 0
  return Math.round((endTime - startTime) / 86_400_000)
}

function sumWeights(weights: Weights) {
  return Array.from(weights.values()).reduce((sum, weight) => sum + weight, 0)
}

function formatHoldings(weights: Weights, nameBySymbol: Map<string, string>) {
  if (!weights.size) return "现金"
  return Array.from(weights.keys())
    .map((symbol) => `${nameBySymbol.get(symbol) ?? symbol} ${symbol}`)
    .join(" / ")
}

function metric(label: string, value: string, tone: BacktestMetric["tone"] = "neutral"): BacktestMetric {
  return { label, value, tone }
}

function percent(value: number) {
  return `${(value * 100).toFixed(2)}%`
}

function mean(values: number[]) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function variance(values: number[]) {
  if (values.length < 2) return 0
  const avg = mean(values)
  return mean(values.map((value) => (value - avg) ** 2))
}

function std(values: number[]) {
  return Math.sqrt(variance(values))
}

function covariance(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length)
  if (n < 2) return 0
  const aa = a.slice(0, n)
  const bb = b.slice(0, n)
  const ma = mean(aa)
  const mb = mean(bb)
  return mean(aa.map((value, i) => (value - ma) * (bb[i] - mb)))
}

function profitLossRatio(values: number[]) {
  const wins = values.filter((value) => value > 0)
  const losses = values.filter((value) => value < 0)
  const avgWin = mean(wins)
  const avgLoss = Math.abs(mean(losses))
  if (!avgLoss) return avgWin ? 99 : 0
  return avgWin / avgLoss
}

function splitValidation(returns: number[]): SplitValidation {
  if (returns.length < 80) {
    return {
      trainAnnual: 0,
      trainMaxDrawdown: 0,
      testAnnual: 0,
      testMaxDrawdown: 0,
      testSharpe: 0,
      pass: false,
    }
  }
  const split = Math.max(40, Math.floor(returns.length * 0.6))
  const train = returnStats(returns.slice(0, split))
  const test = returnStats(returns.slice(split))
  return {
    trainAnnual: train.annualReturn,
    trainMaxDrawdown: train.maxDrawdown,
    testAnnual: test.annualReturn,
    testMaxDrawdown: test.maxDrawdown,
    testSharpe: test.sharpe,
    pass: test.annualReturn >= 0 && test.maxDrawdown > -0.25 && test.sharpe > 0,
  }
}

function returnStats(returns: number[]) {
  let equity = 1
  let peak = 1
  let maxDrawdown = 0
  for (const ret of returns) {
    equity *= 1 + ret
    peak = Math.max(peak, equity)
    maxDrawdown = Math.min(maxDrawdown, equity / peak - 1)
  }
  const annualReturn = Math.pow(equity, 252 / Math.max(returns.length, 1)) - 1
  const vol = std(returns) * Math.sqrt(252)
  const sharpe = vol === 0 ? 0 : (mean(returns) * 252) / vol
  return { annualReturn, maxDrawdown, sharpe }
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "strategy"
}

function shortHash(value: string) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36).slice(0, 8)
}

function last<T>(items: T[]) {
  return items[items.length - 1]
}
