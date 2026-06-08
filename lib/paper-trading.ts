import type { BacktestPositionTrade, BacktestReport } from "@/lib/backtest"
import {
  PAPER_CONFLUENCE_ADMISSION_SCORE,
  PAPER_CONFLUENCE_ADMISSION_STATUS,
  PAPER_CONFLUENCE_STRATEGY_ID,
  PAPER_CONFLUENCE_STRATEGY_NAME,
} from "@/lib/paper-confluence-constants"
import type { StockBars } from "@/lib/qveris-data"
import type { LatestQuote, LatestQuotesResult } from "@/lib/qveris-quotes"
import { radarExitPrice, radarExitReturnPct, type RadarHistoryRecord } from "@/lib/radar-history"

export type PaperRange = "1m" | "3m" | "all"

export type PaperEquityPoint = {
  date: string
  equity: number
  benchmarkEquity: number
  returnPct: number
  drawdownPct: number
}

export type PaperPosition = {
  symbol: string
  name: string
  shares: number
  weightPct: number
  costPrice: number
  currentPrice: number
  marketValue: number
  unrealizedPnl: number
  pnlPct: number
  holdingDays: number
  openedAt: string
  sellableFrom: string
  sellable: boolean
}

export type PaperClosedTrade = {
  tradeId?: string
  entryOrderId?: string
  exitOrderId?: string
  symbol: string
  name: string
  entryDate: string
  exitDate: string
  exitReason: BacktestPositionTrade["exitReason"] | "雷达止盈" | "雷达风控" | "雷达平价退出" | "雷达止损" | "信号到期" | "雷达退出"
  entryPrice?: number
  exitPrice?: number
  shares?: number
  amount?: number
  returnPct: number
  alphaPct: number
  holdingDays: number
}

export type PaperChartBar = {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  synthetic?: boolean
}

export type PaperTradeMarker = {
  id: string
  date: string
  time: string
  side: "buy" | "sell"
  status: PaperOrder["status"]
  price: number
  shares: number
  amount: number
  label: string
  note: string
}

export type PaperTradeChart = {
  symbol: string
  name: string
  source: StockBars["source"] | "missing"
  latestDate?: string
  currentPrice?: number
  pnlPct?: number
  bars: PaperChartBar[]
  markers: PaperTradeMarker[]
}

export type PaperOrder = {
  orderId: string
  signalId?: string
  symbol: string
  name: string
  side: "buy" | "sell"
  status: "filled" | "rejected" | "skipped"
  requestedShares: number
  filledShares: number
  limitPrice: number
  filledPrice?: number
  submittedAt: string
  filledAt?: string
  amount: number
  note: string
}

export type PaperBacktestProfile = {
  status: "真实回测" | "代理回测" | "信号代理" | "待补回测"
  source: string
  score: number
  annualReturnPct: number
  excessReturnPct: number
  maxDrawdownPct: number
  winRatePct: number
  sharpe: number
  period?: string
  finishedAt?: string
}

export type PaperStrategyOption = {
  id: string
  name: string
  status: string
  score: number
  annualReturnPct: number
  backtestProfile: PaperBacktestProfile
  positionCount?: number
  orderCount?: number
  closedTradeCount?: number
  lastSyncedAt?: string
  startedAt?: string
}

export type PaperRuntimeTone = "good" | "warning" | "bad" | "neutral"

export type PaperRuntimeCheck = {
  label: string
  value: string
  tone: PaperRuntimeTone
  note: string
}

export type PaperRuntime = {
  state: "running" | "waiting" | "stale" | "paused"
  label: string
  tone: PaperRuntimeTone
  detail: string
  heartbeatAt: string
  dataAsOf: string
  nextCheckAt: string
  cadence: string
  lastAction: string
  checks: PaperRuntimeCheck[]
}

export type PaperAccount = {
  strategyId: string
  strategyName: string
  admissionStatus: string
  admissionScore: number
  backtestProfile: PaperBacktestProfile
  ledger: {
    driver: "postgres" | "memory"
    persisted: boolean
    accountId?: string
    status?: string
    lastSyncedAt?: string
    error?: string
  }
  startedAt: string
  generatedAt: string
  range: PaperRange
  rangeLabel: string
  rangeStart: string
  rangeEnd: string
  initialCapital: number
  startEquity: number
  currentEquity: number
  availableCash: number
  investedValue: number
  rangeReturnPct: number
  totalReturnPct: number
  benchmarkReturnPct: number
  maxDrawdownPct: number
  tradeWinRatePct: number
  openPositionCount: number
  closedTradeCount: number
  orderCount: number
  curve: PaperEquityPoint[]
  positions: PaperPosition[]
  orders: PaperOrder[]
  closedTrades: PaperClosedTrade[]
  tradeCharts: PaperTradeChart[]
  options: PaperStrategyOption[]
  runtime: PaperRuntime
}

export type PaperSyncResult = {
  ok: boolean
  driver: "postgres" | "memory"
  syncedAt?: string
  error?: string
  preservedExisting?: boolean
}

const INITIAL_CAPITAL = 1_000_000
const PAPER_MAX_EXPOSURE = 0.6
const PAPER_MAX_SINGLE_POSITION = 0.1
const PAPER_LOT_SIZE = 100
const PAPER_COMMISSION_RATE = 0.0003
const PAPER_STAMP_DUTY_RATE = 0.0005
const PAPER_T_PLUS_ONE_ENABLED = true

export function buildPaperAccount(
  reports: BacktestReport[],
  opts: {
    strategyId?: string | null
    range?: PaperRange
    startedAt?: string | null
    signalRecords?: RadarHistoryRecord[]
  } = {},
): PaperAccount {
  const signalReports = buildSignalOnlyReports(opts.signalRecords ?? [], reports)
  const candidateReports = mergeReports([...signalReports, ...reports])
  const eligible = candidateReports.filter(isPaperEligible).sort((a, b) => paperRank(b) - paperRank(a))
  const sourceReports = mergeReports([...signalReports, ...(eligible.length ? eligible : candidateReports)])
  const range = opts.range ?? "3m"
  const startedAt = normalizeStartedAt(opts.startedAt)
  const startDate = paperTradeDate(startedAt)
  const startTime = new Date(startedAt).getTime()
  const explicitStrategyId = opts.strategyId?.trim()
  const signalPreferred = !opts.strategyId
    ? sourceReports
        .map((report) => ({
          report,
          signals: paperSignalCount(report, opts.signalRecords ?? [], startTime),
        }))
        .filter((item) => item.signals > 0)
        .sort((a, b) => b.signals - a.signals || paperRank(b.report) - paperRank(a.report))[0]?.report
    : undefined
  const selected =
    explicitStrategyId
      ? sourceReports.find((report) => report.strategyId === explicitStrategyId) ??
        reports.find((report) => report.strategyId === explicitStrategyId) ??
        (explicitStrategyId === PAPER_CONFLUENCE_STRATEGY_ID ? buildPaperConfluenceReport(opts.signalRecords ?? []) : undefined)
      : signalPreferred ??
        sourceReports[0] ??
        reports[0]

  if (!selected) {
    return emptyPaperAccount(opts.range ?? "3m")
  }

  const curve = [{
    date: startDate,
    equity: INITIAL_CAPITAL,
    benchmarkEquity: INITIAL_CAPITAL,
    returnPct: 0,
    drawdownPct: 0,
  }]

  const account: Omit<PaperAccount, "runtime"> = {
    strategyId: selected.strategyId,
    strategyName: selected.strategyName,
    admissionStatus: selected.diagnosis.admission.gate,
    admissionScore: selected.diagnosis.admission.score,
    backtestProfile: paperBacktestProfile(selected),
    ledger: {
      driver: "memory",
      persisted: false,
    },
    startedAt,
    generatedAt: new Date().toISOString(),
    range,
    rangeLabel: rangeLabel(range),
    rangeStart: startDate,
    rangeEnd: startDate,
    initialCapital: INITIAL_CAPITAL,
    startEquity: INITIAL_CAPITAL,
    currentEquity: INITIAL_CAPITAL,
    availableCash: INITIAL_CAPITAL,
    investedValue: 0,
    rangeReturnPct: 0,
    totalReturnPct: 0,
    benchmarkReturnPct: 0,
    maxDrawdownPct: 0,
    tradeWinRatePct: 0,
    openPositionCount: 0,
    closedTradeCount: 0,
    orderCount: 0,
    curve,
    positions: [],
    orders: [],
    closedTrades: [],
    tradeCharts: [],
    options: paperOptionReports(sourceReports, selected).map((report) => ({
      id: report.strategyId,
      name: report.strategyName,
      status: report.diagnosis.admission.gate,
      score: report.diagnosis.admission.score,
      annualReturnPct: metricPercent(report, "策略年化收益"),
      backtestProfile: paperBacktestProfile(report),
    })),
  }
  return attachPaperRuntime(applySignalLedgerToPaperAccount(account, selected, opts.signalRecords ?? []))
}

export function attachPaperRuntime(
  account: Omit<PaperAccount, "runtime"> | PaperAccount,
  sync?: PaperSyncResult,
): PaperAccount {
  return {
    ...account,
    runtime: buildPaperRuntime(account, sync),
  }
}

function isPaperEligible(report: BacktestReport) {
  return report.backtestSource === "Qveris" && report.diagnosis.admission.status !== "blocked" && metricPercent(report, "策略年化收益") >= 10
}

function paperRank(report: BacktestReport) {
  const admissionBonus = report.diagnosis.admission.status === "radar-ready" ? 1_000 : 0
  return admissionBonus + report.diagnosis.admission.score * 10 + metricPercent(report, "策略年化收益")
}

function mergeReports(reports: BacktestReport[]) {
  const byId = new Map<string, BacktestReport>()
  for (const report of reports) {
    if (!byId.has(report.strategyId)) byId.set(report.strategyId, report)
  }
  return Array.from(byId.values())
}

function buildSignalOnlyReports(records: RadarHistoryRecord[], existingReports: BacktestReport[]): BacktestReport[] {
  const existingIds = new Set(existingReports.map((report) => report.strategyId))
  const existingNames = new Set(existingReports.map((report) => normalizeName(report.strategyName)))
  const groups = new Map<string, RadarHistoryRecord[]>()

  for (const record of records) {
    const strategyName = record.strategyName?.trim()
    const strategyId = record.strategyId?.trim() || (strategyName ? `signal-ledger:${normalizeName(strategyName)}` : "")
    if (!strategyId || existingIds.has(strategyId) || existingNames.has(normalizeName(strategyName))) continue
    const group = groups.get(strategyId) ?? []
    group.push(record)
    groups.set(strategyId, group)
  }

  return Array.from(groups.entries()).map(([strategyId, group]) => {
    const sorted = group.slice().sort((a, b) => signalTimeValue(b) - signalTimeValue(a))
    const latest = sorted[0]
    const name = latest.strategyName || `${latest.signal} 雷达策略`
    const dates = sorted.map((record) => paperTradeDate(record.recommendedAt)).sort()
    const start = dates[0] ?? paperTradeDate(latest.recommendedAt)
    const end = dates.at(-1) ?? start
    const openSignals = sorted.filter(isOpenSignalRecord).length
    const winRate = sorted.length
      ? (sorted.filter((record) => record.returnPct > 0).length / sorted.length) * 100
      : 0

    return {
      strategyId,
      title: name,
      strategyName: name,
      backtestSource: "Qveris",
      period: { start, end, days: Math.max(1, dates.length) },
      universe: "雷达信号账本",
      benchmark: "现金账户",
      dataSource: {
        source: "qveris",
        qverisCount: group.length,
        total: group.length,
        finishedAt: new Date().toISOString(),
      },
      parameters: {
        lookbackDays: 0,
        momentumWindow: 0,
        rebalanceDays: 0,
        topN: 0,
        feeRate: PAPER_COMMISSION_RATE,
      },
      metrics: [
        { label: "策略年化收益", value: "+0.00%", tone: "neutral" },
        { label: "胜率", value: `${Math.round(winRate)}%`, tone: winRate >= 50 ? "good" : "neutral" },
      ],
      curve: [],
      trades: [],
      positionTrades: [],
      diagnosis: {
        verdict: "可继续小样本跟踪",
        score: 72,
        headline: "来自雷达层的实时信号策略",
        tags: ["雷达信号", "纸面模拟", `${openSignals} 个跟踪中`],
        admission: {
          status: "radar-ready",
          gate: "雷达候选",
          score: 72,
          tags: ["雷达信号", "纸面模拟"],
          reason: "该策略存在接入后的真实雷达信号，先进入纸面模拟观察；历史回测明细以策略目录为准。",
        },
        checks: [],
        recommendations: ["用实时行情继续跟踪成交、止盈、止损和 T+1 约束。"],
        topWinners: [],
        topLosers: [],
      },
      logs: ["signal-ledger-paper-report"],
    } satisfies BacktestReport
  })
}

function buildPaperConfluenceReport(records: RadarHistoryRecord[]): BacktestReport {
  const matched = records.filter((record) => record.strategyId === PAPER_CONFLUENCE_STRATEGY_ID)
  const dates = matched.map((record) => paperTradeDate(record.recommendedAt)).sort()
  const start = dates[0] ?? paperTradeDate(new Date().toISOString())
  const end = dates.at(-1) ?? start
  return {
    strategyId: PAPER_CONFLUENCE_STRATEGY_ID,
    title: PAPER_CONFLUENCE_STRATEGY_NAME,
    strategyName: PAPER_CONFLUENCE_STRATEGY_NAME,
    backtestSource: "Qveris",
    period: { start, end, days: Math.max(1, dates.length) },
    universe: "已上线模拟账户交集",
    benchmark: "现金账户",
    dataSource: {
      source: "qveris",
      qverisCount: matched.length,
      total: matched.length,
      finishedAt: new Date().toISOString(),
    },
    parameters: {
      lookbackDays: 5,
      momentumWindow: 0,
      rebalanceDays: 0,
      topN: 0,
      feeRate: PAPER_COMMISSION_RATE,
    },
    metrics: [
      { label: "策略年化收益", value: "+0.00%", tone: "neutral" },
      { label: "胜率", value: "0%", tone: "neutral" },
    ],
    curve: [],
    trades: [],
    positionTrades: [],
    diagnosis: {
      verdict: "可继续小样本跟踪",
      score: PAPER_CONFLUENCE_ADMISSION_SCORE,
      headline: "多策略交集账户",
      tags: ["多策略共振", "纸面模拟", "独立账户"],
      admission: {
        status: "radar-ready",
        gate: "雷达候选",
        score: PAPER_CONFLUENCE_ADMISSION_SCORE,
        tags: [PAPER_CONFLUENCE_ADMISSION_STATUS, "多策略共振", "实盘模拟"],
        reason: "同一股票被 2 个以上已上线策略同向命中后，作为合成策略独立进入纸面模拟。",
      },
      checks: [],
      recommendations: ["和单策略账户分开观察，重点看信号数量、回撤和成交后收益分布。"],
      topWinners: [],
      topLosers: [],
    },
    logs: ["paper-confluence-report"],
  }
}

function paperOptionReports(sourceReports: BacktestReport[], selected: BacktestReport) {
  if (sourceReports.some((report) => report.strategyId === selected.strategyId)) return sourceReports
  return [selected, ...sourceReports]
}

function paperBacktestProfile(report: BacktestReport): PaperBacktestProfile {
  return {
    status: paperBacktestStatus(report),
    source: report.backtestSource ?? report.dataSource.source,
    score: scorePaperBacktestReport(report),
    annualReturnPct: metricPercent(report, "策略年化收益"),
    excessReturnPct: metricPercent(report, "超额收益"),
    maxDrawdownPct: Math.abs(metricPercent(report, "最大回撤")),
    winRatePct: metricPercent(report, "胜率"),
    sharpe: metricPercent(report, "夏普比率"),
    period: `${report.period.start} 至 ${report.period.end}`,
    finishedAt: report.dataSource.finishedAt,
  }
}

function paperBacktestStatus(report: BacktestReport): PaperBacktestProfile["status"] {
  if (report.logs.includes("signal-ledger-paper-report") || report.logs.includes("paper-confluence-report")) return "信号代理"
  if (report.backtestSource === "Qveris") return "真实回测"
  if (report.backtestSource === "Qveris K线代理" || report.dataSource.source === "mixed") return "代理回测"
  return "待补回测"
}

function scorePaperBacktestReport(report: BacktestReport) {
  const annual = metricPercent(report, "策略年化收益")
  const excess = metricPercent(report, "超额收益")
  const drawdown = Math.abs(metricPercent(report, "最大回撤"))
  const sharpe = metricPercent(report, "夏普比率")
  const winRate = metricPercent(report, "胜率")
  const admission = report.diagnosis.admission
  const gateBonus = admission.status === "radar-ready" ? 20 : admission.status === "watchlist" ? 6 : -12
  return Math.round((admission.score + annual * 0.18 + excess * 0.28 + sharpe * 5 + (winRate - 50) * 0.25 - drawdown * 0.35 + gateBonus) * 10) / 10
}

function paperSignalCount(report: BacktestReport, records: RadarHistoryRecord[], startTime: number) {
  if (!Number.isFinite(startTime)) return 0
  return records.filter((record) => {
    const triggeredAt = new Date(record.recommendedAt).getTime()
    return Number.isFinite(triggeredAt) &&
      triggeredAt >= startTime &&
      recordMatchesReportStrategy(record, report) &&
      isTradablePaperSignal(record)
  }).length
}

export function applyRealtimeQuotesToPaperAccount(
  account: PaperAccount,
  quotes: LatestQuotesResult | null | undefined,
): PaperAccount {
  if (!quotes?.quotes.size) return account

  const quoteEntries = Array.from(quotes.quotes.values())
  const quoteIso = newestQuoteTime(quoteEntries)
  const quoteDate = quoteIso ? paperTradeDate(quoteIso) : undefined
  if (!quoteIso || !quoteDate) return account

  const positions = account.positions.map((position) => {
    const quote = quotes.quotes.get(position.symbol)
    if (!quote || quote.latest <= 0) return position

    const currentPrice = quote.latest
    const marketValue = round2(position.shares * currentPrice)
    const costValue = position.shares * position.costPrice
    const unrealizedPnl = round2(marketValue - costValue)
    return {
      ...position,
      currentPrice,
      marketValue,
      unrealizedPnl,
      pnlPct: costValue > 0 ? round2((unrealizedPnl / costValue) * 100) : 0,
      holdingDays: holdingDays(`${position.openedAt}T09:30:00+08:00`, quoteIso),
      sellable: !PAPER_T_PLUS_ONE_ENABLED || isAshareT1SellAllowed(position, quoteIso),
    }
  })

  const investedValue = round2(positions.reduce((sum, position) => sum + position.marketValue, 0))
  const currentEquity = round2(account.availableCash + investedValue)
  const curve = markPaperCurve(account.curve, quoteDate, currentEquity, account.initialCapital)
  const startEquity = account.initialCapital
  const rangeReturnPct = startEquity > 0 ? round2((currentEquity / startEquity - 1) * 100) : 0

  return {
    ...account,
    generatedAt: quoteIso,
    rangeEnd: account.rangeEnd && account.rangeEnd > quoteDate ? account.rangeEnd : quoteDate,
    currentEquity,
    investedValue,
    rangeReturnPct,
    totalReturnPct: account.initialCapital > 0 ? round2((currentEquity / account.initialCapital - 1) * 100) : 0,
    maxDrawdownPct: Math.min(...curve.map((point) => point.drawdownPct), 0),
    openPositionCount: positions.length,
    curve,
    positions,
  }
}

type PaperExecutionState = {
  cash: number
  positions: Map<string, PaperExecutionPosition>
  orders: PaperOrder[]
  closedTrades: PaperClosedTrade[]
  equityMarks: Map<string, number>
}

type PaperExecutionPosition = {
  signalId?: string
  entryOrderId: string
  symbol: string
  name: string
  shares: number
  entryPrice: number
  entryAt: string
  buyCommission: number
  latestPrice: number
  latestAt: string
  sellableFrom: string
}

function applySignalLedgerToPaperAccount(
  account: Omit<PaperAccount, "runtime">,
  report: BacktestReport,
  records: RadarHistoryRecord[],
): Omit<PaperAccount, "runtime"> {
  const startTime = new Date(account.startedAt).getTime()
  const startDate = paperTradeDate(account.startedAt)
  const matched = records
    .filter((record) => recordMatchesPaperStrategy(record, account, report))
    .filter(isTradablePaperSignal)
    .filter((record) => {
      const triggeredAt = new Date(record.recommendedAt).getTime()
      return Number.isFinite(triggeredAt) && triggeredAt >= startTime
    })
    .filter((record) => record.triggerPrice > 0 && record.latestPrice > 0)
    .sort(comparePaperSignalRecords)

  if (!matched.length) return account

  const execution = runSignalExecution(account, matched)
  const currentEquity = round2(currentExecutionEquity(execution))
  const positions = Array.from(execution.positions.values()).map((position) => paperPositionFromExecution(position, currentEquity))
  const investedValue = positions.reduce((sum, position) => sum + position.marketValue, 0)
  const curve = buildExecutionEquityCurve(execution.equityMarks, account.startedAt, account.range, account.initialCapital)
  const firstPoint = curve[0]
  const latestPoint = curve.at(-1)
  const rangeStart = firstPoint?.date ?? startDate
  const rangeEnd = latestPoint?.date ?? newestSignalDate(matched) ?? startDate
  const startEquity = account.initialCapital
  const rangeReturnPct = startEquity > 0 ? (currentEquity / startEquity - 1) * 100 : 0
  const closedTrades = execution.closedTrades
    .slice()
    .sort((a, b) => new Date(b.exitDate).getTime() - new Date(a.exitDate).getTime())
  const orders = execution.orders
    .slice()
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())

  return {
    ...account,
    generatedAt: newestSignalTime(matched) ?? account.generatedAt,
    rangeStart,
    rangeEnd,
    startEquity: round2(startEquity),
    currentEquity,
    availableCash: round2(Math.max(0, currentEquity - investedValue)),
    investedValue: round2(investedValue),
    rangeReturnPct: round2(rangeReturnPct),
    totalReturnPct: round2((currentEquity / account.initialCapital - 1) * 100),
    benchmarkReturnPct: report.curve.at(-1) && report.curve[0]
      ? round2(((report.curve.at(-1)?.benchmark ?? 1) / (report.curve[0]?.benchmark ?? 1) - 1) * 100)
      : account.benchmarkReturnPct,
    maxDrawdownPct: Math.min(...curve.map((point) => point.drawdownPct), 0),
    tradeWinRatePct: closedTrades.length
      ? round2((closedTrades.filter((trade) => trade.returnPct > 0).length / closedTrades.length) * 100)
      : 0,
    openPositionCount: positions.length,
    closedTradeCount: closedTrades.length,
    orderCount: orders.length,
    curve,
    positions,
    orders,
    closedTrades,
    tradeCharts: [],
  }
}

export function enrichPaperAccountWithTradeCharts(
  account: PaperAccount,
  barsBySymbol: Map<string, StockBars>,
): PaperAccount {
  const symbols = rankedChartSymbols(account)
  if (!symbols.length) return { ...account, tradeCharts: [] }

  const tradeCharts: PaperTradeChart[] = symbols.slice(0, 12).map(({ symbol, name }) => {
    const source = barsBySymbol.get(symbol)
    const markers = buildTradeMarkers(account, symbol)
    const bars = chartBarsForSymbol(source, markers)
    const position = account.positions.find((item) => item.symbol === symbol)
    const lastTrade = account.closedTrades.find((item) => item.symbol === symbol)
    const currentPrice = source?.bars.at(-1)?.close ?? position?.currentPrice ?? lastTrade?.exitPrice
    const pnlPct = position?.pnlPct ?? lastTrade?.returnPct

    return {
      symbol,
      name,
      source: source?.source ?? "missing",
      latestDate: source?.bars.at(-1)?.date,
      currentPrice,
      pnlPct,
      bars,
      markers,
    }
  })

  return { ...account, tradeCharts }
}

function runSignalExecution(account: Omit<PaperAccount, "runtime">, records: RadarHistoryRecord[]): PaperExecutionState {
  const state: PaperExecutionState = {
    cash: account.initialCapital,
    positions: new Map(),
    orders: [],
    closedTrades: [],
    equityMarks: new Map(),
  }
  markExecutionEquity(state, paperTradeDate(account.startedAt))

  for (const record of dedupeSignalRecords(records)) {
    const openSignal = isOpenSignalRecord(record)
    const current = state.positions.get(record.ticker)
    if (openSignal && !current) {
      executePaperBuy(state, account, record)
    } else if (openSignal && current) {
      updateExecutionPosition(current, record)
      state.orders.push({
        orderId: paperOrderId(record, "buy", "duplicate"),
        signalId: record.id,
        symbol: record.ticker,
        name: record.name,
        side: "buy",
        status: "skipped",
        requestedShares: 0,
        filledShares: 0,
        limitPrice: record.triggerPrice,
        submittedAt: record.recommendedAt,
        amount: 0,
        note: "已有持仓，跳过重复入场信号。",
      })
    }

    const position = state.positions.get(record.ticker)
    if (position) updateExecutionPosition(position, record)
    if (!openSignal) executePaperSell(state, record)
    markExecutionEquity(state, signalMarkDate(record))
  }

  const latest = newestSignalDate(records) ?? paperTradeDate(account.startedAt)
  markExecutionEquity(state, latest)
  return state
}

function executePaperBuy(
  state: PaperExecutionState,
  account: Pick<PaperAccount, "initialCapital">,
  record: RadarHistoryRecord,
) {
  const price = record.triggerPrice
  const maxPortfolioExposure = account.initialCapital * PAPER_MAX_EXPOSURE
  const maxSinglePosition = account.initialCapital * PAPER_MAX_SINGLE_POSITION
  const exposureLeft = Math.max(0, maxPortfolioExposure - currentPositionValue(state))
  const affordableNotional = Math.max(0, state.cash / (1 + PAPER_COMMISSION_RATE))
  const targetNotional = Math.min(maxSinglePosition, exposureLeft, affordableNotional)
  const requestedShares = roundLotShares(targetNotional / price)

  if (requestedShares < PAPER_LOT_SIZE) {
    state.orders.push({
      orderId: paperOrderId(record, "buy", "rejected"),
      signalId: record.id,
      symbol: record.ticker,
      name: record.name,
      side: "buy",
      status: "rejected",
      requestedShares,
      filledShares: 0,
      limitPrice: price,
      submittedAt: record.recommendedAt,
      amount: 0,
      note: exposureLeft < price * PAPER_LOT_SIZE
        ? "组合 60% 仓位上限已满，未继续加仓。"
        : "现金或目标仓位不足 100 股一手，未成交。",
    })
    return
  }

  const amount = requestedShares * price
  const commission = amount * PAPER_COMMISSION_RATE
  if (amount + commission > state.cash) {
    state.orders.push({
      orderId: paperOrderId(record, "buy", "cash"),
      signalId: record.id,
      symbol: record.ticker,
      name: record.name,
      side: "buy",
      status: "rejected",
      requestedShares,
      filledShares: 0,
      limitPrice: price,
      submittedAt: record.recommendedAt,
      amount: 0,
      note: "扣除佣金后现金不足，未成交。",
    })
    return
  }

  const orderId = paperOrderId(record, "buy")
  state.cash = round2(state.cash - amount - commission)
  state.positions.set(record.ticker, {
    signalId: record.id,
    entryOrderId: orderId,
    symbol: record.ticker,
    name: record.name,
    shares: requestedShares,
    entryPrice: price,
    entryAt: record.recommendedAt,
    buyCommission: commission,
    latestPrice: record.latestPrice || price,
    latestAt: record.latestQuoteAt ?? record.recommendedAt,
    sellableFrom: nextAshareTradeDate(record.recommendedAt),
  })
  state.orders.push({
    orderId,
    signalId: record.id,
    symbol: record.ticker,
    name: record.name,
    side: "buy",
    status: "filled",
    requestedShares,
    filledShares: requestedShares,
    limitPrice: price,
    filledPrice: price,
    submittedAt: record.recommendedAt,
    filledAt: record.recommendedAt,
    amount: round2(amount),
    note: `雷达入场信号触发，按 100 股整手模拟买入；A 股 T+1，${nextAshareTradeDate(record.recommendedAt)} 起可卖。`,
  })
}

function executePaperSell(state: PaperExecutionState, record: RadarHistoryRecord) {
  const position = state.positions.get(record.ticker)
  const submittedAt = sellSubmittedAt(position, record)
  const price = radarExitPrice(record)
  if (!position) {
    state.orders.push({
      orderId: paperOrderId(record, "sell", "no-position"),
      signalId: record.id,
      symbol: record.ticker,
      name: record.name,
      side: "sell",
      status: "skipped",
      requestedShares: 0,
      filledShares: 0,
      limitPrice: price,
      submittedAt,
      amount: 0,
      note: "没有对应持仓，平仓信号只记录不成交。",
    })
    return
  }
  if (PAPER_T_PLUS_ONE_ENABLED && !isAshareT1SellAllowed(position, submittedAt)) {
    state.orders.push({
      orderId: paperOrderId(record, "sell", "t1-locked"),
      signalId: record.id,
      symbol: record.ticker,
      name: record.name,
      side: "sell",
      status: "skipped",
      requestedShares: position.shares,
      filledShares: 0,
      limitPrice: price,
      submittedAt,
      amount: 0,
      note: `A 股 T+1：${paperTradeDate(position.entryAt)} 买入的仓位 ${position.sellableFrom} 起可卖，当前退出信号只记录，持仓继续跟踪。`,
    })
    return
  }
  if (price <= 0) {
    state.orders.push({
      orderId: paperOrderId(record, "sell", "bad-price"),
      signalId: record.id,
      symbol: record.ticker,
      name: record.name,
      side: "sell",
      status: "rejected",
      requestedShares: position.shares,
      filledShares: 0,
      limitPrice: 0,
      submittedAt,
      amount: 0,
      note: "缺少有效平仓价，未成交。",
    })
    return
  }

  const orderId = paperOrderId(record, "sell")
  const gross = position.shares * price
  const commission = gross * PAPER_COMMISSION_RATE
  const stampDuty = gross * PAPER_STAMP_DUTY_RATE
  const net = gross - commission - stampDuty
  const costBasis = position.shares * position.entryPrice + position.buyCommission
  const returnPct = costBasis > 0 ? (net / costBasis - 1) * 100 : 0

  state.cash = round2(state.cash + net)
  state.positions.delete(record.ticker)
  state.orders.push({
    orderId,
    signalId: record.id,
    symbol: record.ticker,
    name: record.name,
    side: "sell",
    status: "filled",
    requestedShares: position.shares,
    filledShares: position.shares,
    limitPrice: price,
    filledPrice: price,
    submittedAt,
    filledAt: submittedAt,
    amount: round2(gross),
    note: signalExitReason(record),
  })
  state.closedTrades.push({
    tradeId: `${orderId}:trade`,
    entryOrderId: position.entryOrderId,
    exitOrderId: orderId,
    symbol: position.symbol,
    name: position.name,
    entryDate: paperTradeDate(position.entryAt),
    exitDate: paperTradeDate(submittedAt),
    exitReason: signalExitReason(record),
    entryPrice: position.entryPrice,
    exitPrice: price,
    shares: position.shares,
    amount: round2(gross),
    returnPct: round2(returnPct),
    alphaPct: round2(returnPct),
    holdingDays: holdingDays(position.entryAt, submittedAt),
  })
}

function dedupeSignalRecords(records: RadarHistoryRecord[]) {
  const byId = new Map<string, RadarHistoryRecord>()
  for (const record of records) {
    const key = record.id || `${record.strategyId ?? record.strategyName}:${record.ticker}:${record.recommendedAt}`
    const existing = byId.get(key)
    if (!existing || signalTimeValue(record) >= signalTimeValue(existing)) byId.set(key, record)
  }
  return Array.from(byId.values()).sort(comparePaperSignalRecords)
}

function comparePaperSignalRecords(a: RadarHistoryRecord, b: RadarHistoryRecord) {
  const timeDelta = paperExecutionTimeValue(a) - paperExecutionTimeValue(b)
  if (timeDelta !== 0) return timeDelta

  const actionDelta = paperSignalActionRank(a) - paperSignalActionRank(b)
  if (actionDelta !== 0) return actionDelta

  const qualityDelta = paperSignalQualityRank(b) - paperSignalQualityRank(a)
  if (qualityDelta !== 0) return qualityDelta

  return stableSignalKey(a).localeCompare(stableSignalKey(b))
}

function paperExecutionTimeValue(record: RadarHistoryRecord) {
  const raw = isOpenSignalRecord(record)
    ? record.recommendedAt
    : record.closedAt ?? record.latestQuoteAt ?? record.recommendedAt
  const value = new Date(raw).getTime()
  return Number.isFinite(value) ? value : 0
}

function paperSignalActionRank(record: RadarHistoryRecord) {
  return isOpenSignalRecord(record) ? 1 : 0
}

function paperSignalQualityRank(record: RadarHistoryRecord) {
  if (record.signalKind === "high-confidence-buy") return 3
  if (record.signalKind === "add-confirm") return 2
  return 1
}

function stableSignalKey(record: RadarHistoryRecord) {
  return [
    record.ticker,
    record.strategyId ?? "",
    record.strategyName ?? "",
    record.buyPoint ?? "",
    record.id ?? "",
  ].join(":")
}

function updateExecutionPosition(position: PaperExecutionPosition, record: RadarHistoryRecord) {
  position.latestPrice = record.latestPrice || position.latestPrice
  position.latestAt = record.latestQuoteAt ?? record.closedAt ?? position.latestAt
}

function paperPositionFromExecution(position: PaperExecutionPosition, currentEquity: number): PaperPosition {
  const marketValue = position.shares * position.latestPrice
  const costValue = position.shares * position.entryPrice + position.buyCommission
  const pnl = marketValue - costValue
  return {
    symbol: position.symbol,
    name: position.name,
    shares: position.shares,
    weightPct: currentEquity > 0 ? round2((marketValue / currentEquity) * 100) : 0,
    costPrice: position.entryPrice,
    currentPrice: position.latestPrice,
    marketValue: round2(marketValue),
    unrealizedPnl: round2(pnl),
    pnlPct: costValue > 0 ? round2((pnl / costValue) * 100) : 0,
    holdingDays: holdingDays(position.entryAt, position.latestAt),
    openedAt: paperTradeDate(position.entryAt),
    sellableFrom: position.sellableFrom,
    sellable: !PAPER_T_PLUS_ONE_ENABLED || isAshareT1SellAllowed(position, new Date().toISOString()),
  }
}

function currentPositionValue(state: PaperExecutionState) {
  return Array.from(state.positions.values()).reduce((sum, position) => sum + position.shares * position.latestPrice, 0)
}

function currentExecutionEquity(state: PaperExecutionState) {
  return round2(state.cash + currentPositionValue(state))
}

function markExecutionEquity(state: PaperExecutionState, date: string) {
  state.equityMarks.set(date, currentExecutionEquity(state))
}

function buildExecutionEquityCurve(
  marks: Map<string, number>,
  startedAt: string,
  range: PaperRange,
  initialCapital: number,
) {
  const startDate = paperTradeDate(startedAt)
  const allDates = Array.from(new Set([startDate, ...marks.keys()])).sort()
  const cutoff = rangeStartDate(allDates.at(-1) ?? startDate, range)
  const visibleDates = allDates.filter((date) => date >= startDate && date >= cutoff)
  const dates = visibleDates.length ? visibleDates : [startDate]
  let peak = initialCapital
  let lastEquity = initialCapital

  return dates.map((date) => {
    lastEquity = marks.get(date) ?? lastEquity
    const equity = round2(lastEquity)
    peak = Math.max(peak, equity)
    return {
      date,
      equity,
      benchmarkEquity: initialCapital,
      returnPct: round2((equity / initialCapital - 1) * 100),
      drawdownPct: peak > 0 ? round2((equity / peak - 1) * 100) : 0,
    }
  })
}

function rankedChartSymbols(account: PaperAccount) {
  const bySymbol = new Map<string, { symbol: string; name: string; rank: number }>()
  const add = (symbol: string, name: string, rank: number) => {
    if (!symbol) return
    const existing = bySymbol.get(symbol)
    if (!existing || rank > existing.rank) bySymbol.set(symbol, { symbol, name: name || symbol, rank })
  }

  for (const position of account.positions) add(position.symbol, position.name, 400 + Math.abs(position.pnlPct))
  for (const order of account.orders) add(order.symbol, order.name, order.status === "filled" ? 300 : 120)
  for (const trade of account.closedTrades) add(trade.symbol, trade.name, 220 + Math.abs(trade.returnPct))

  return Array.from(bySymbol.values()).sort((a, b) => b.rank - a.rank)
}

function buildTradeMarkers(account: PaperAccount, symbol: string) {
  const markers = new Map<string, PaperTradeMarker>()

  for (const order of account.orders.filter((item) => item.symbol === symbol)) {
    const price = order.filledPrice ?? order.limitPrice
    if (price <= 0) continue
    const time = order.filledAt ?? order.submittedAt
    const marker: PaperTradeMarker = {
      id: order.orderId,
      date: paperTradeDate(time),
      time,
      side: order.side,
      status: order.status,
      price,
      shares: order.filledShares || order.requestedShares,
      amount: order.amount,
      label: `${order.side === "buy" ? "买" : "卖"} ${order.status === "filled" ? "成交" : order.status === "rejected" ? "拒单" : "跳过"}`,
      note: order.note,
    }
    markers.set(marker.id, marker)
  }

  for (const trade of account.closedTrades.filter((item) => item.symbol === symbol)) {
    if (trade.entryPrice && trade.entryPrice > 0) {
      const id = trade.entryOrderId ?? `trade:${trade.symbol}:${trade.entryDate}:entry`
      if (!markers.has(id)) {
        markers.set(id, {
          id,
          date: trade.entryDate,
          time: `${trade.entryDate}T09:30:00+08:00`,
          side: "buy",
          status: "filled",
          price: trade.entryPrice,
          shares: trade.shares ?? 0,
          amount: trade.amount ?? 0,
          label: "买 成交",
          note: "平仓记录反推的入场点。",
        })
      }
    }
    if (trade.exitPrice && trade.exitPrice > 0) {
      const id = trade.exitOrderId ?? `trade:${trade.symbol}:${trade.exitDate}:exit`
      if (!markers.has(id)) {
        markers.set(id, {
          id,
          date: trade.exitDate,
          time: `${trade.exitDate}T15:00:00+08:00`,
          side: "sell",
          status: "filled",
          price: trade.exitPrice,
          shares: trade.shares ?? 0,
          amount: trade.amount ?? 0,
          label: "卖 成交",
          note: trade.exitReason,
        })
      }
    }
  }

  return Array.from(markers.values()).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
}

function chartBarsForSymbol(stock: StockBars | undefined, markers: PaperTradeMarker[]) {
  if (!stock?.bars.length) return []
  const markerDates = markers.map((marker) => marker.date).sort()
  const firstMarker = markerDates[0]
  const lastMarker = markerDates.at(-1)
  const startDate = firstMarker ? offsetDate(firstMarker, -20) : stock.bars.at(-90)?.date
  const endDate = lastMarker ? offsetDate(lastMarker, 20) : undefined
  const ranged = stock.bars.filter((bar) => {
    if (startDate && bar.date < startDate) return false
    if (endDate && bar.date > endDate) return false
    return true
  })
  const bars = ranged.length >= 20 ? ranged : stock.bars.slice(-90)
  const normalized: PaperChartBar[] = bars.map((bar) => ({
    date: bar.date,
    open: round2(bar.open),
    high: round2(bar.high),
    low: round2(bar.low),
    close: round2(bar.close),
    volume: Math.max(0, Math.round(bar.volume)),
  }))

  const existingDates = new Set(normalized.map((bar) => bar.date))
  for (const marker of markers) {
    if (existingDates.has(marker.date) || marker.price <= 0) continue
    normalized.push({
      date: marker.date,
      open: round2(marker.price),
      high: round2(marker.price),
      low: round2(marker.price),
      close: round2(marker.price),
      volume: 0,
      synthetic: true,
    })
    existingDates.add(marker.date)
  }

  return normalized.sort((a, b) => a.date.localeCompare(b.date)).slice(-140)
}

function newestQuoteTime(quotes: LatestQuote[]) {
  return quotes
    .map((quote) => `${quote.tradeDate}T${quote.tradeTime || "15:00:00"}+08:00`)
    .filter((value) => Number.isFinite(new Date(value).getTime()))
    .sort()
    .at(-1)
}

function markPaperCurve(curve: PaperEquityPoint[], date: string, equity: number, initialCapital: number) {
  const points = curve.length
    ? curve.map((point) => ({ ...point }))
    : [{
        date,
        equity: initialCapital,
        benchmarkEquity: initialCapital,
        returnPct: 0,
        drawdownPct: 0,
      }]
  const existingIndex = points.findIndex((point) => point.date === date)
  const point = {
    date,
    equity,
    benchmarkEquity: points.at(-1)?.benchmarkEquity ?? initialCapital,
    returnPct: initialCapital > 0 ? round2((equity / initialCapital - 1) * 100) : 0,
    drawdownPct: 0,
  }
  if (existingIndex >= 0) {
    points[existingIndex] = point
  } else {
    points.push(point)
  }

  points.sort((a, b) => a.date.localeCompare(b.date))
  let peak = initialCapital
  return points.map((item) => {
    peak = Math.max(peak, item.equity)
    return {
      ...item,
      drawdownPct: peak > 0 ? round2((item.equity / peak - 1) * 100) : 0,
    }
  })
}

function offsetDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00+08:00`)
  if (!Number.isFinite(value.getTime())) return date
  value.setUTCDate(value.getUTCDate() + days)
  return paperTradeDate(value.toISOString())
}

function paperOrderId(record: RadarHistoryRecord, side: PaperOrder["side"], suffix = "filled") {
  const scope = record.strategyId || normalizeName(record.strategyName) || "unknown"
  return `paper:${scope}:${record.id}:${side}:${suffix}`
}

function recordMatchesPaperStrategy(
  record: RadarHistoryRecord,
  account: Pick<PaperAccount, "strategyId" | "strategyName">,
  report: BacktestReport,
) {
  if (record.strategyId && record.strategyId === account.strategyId) return true
  const recordName = normalizeName(record.strategyName)
  return Boolean(recordName && (recordName === normalizeName(account.strategyName) || recordName === normalizeName(report.strategyName)))
}

function recordMatchesReportStrategy(record: RadarHistoryRecord, report: BacktestReport) {
  if (record.strategyId && record.strategyId === report.strategyId) return true
  const recordName = normalizeName(record.strategyName)
  return Boolean(recordName && recordName === normalizeName(report.strategyName))
}

function isOpenSignalRecord(record: RadarHistoryRecord) {
  return (record.lifecycleStatus ?? "open") === "open" && record.status === "跟踪中"
}

function isTradablePaperSignal(record: RadarHistoryRecord) {
  if ((record.lifecycleStatus ?? "open") !== "open") return true
  return record.signalKind === "high-confidence-buy" || record.signalKind === "add-confirm"
}

function signalExitReason(record: RadarHistoryRecord): PaperClosedTrade["exitReason"] {
  if (record.lifecycleStatus === "target-hit" || record.status === "已止盈") return "雷达止盈"
  if (record.lifecycleStatus === "stopped" || record.status === "已失效" || record.status === "已止损") {
    const ret = radarExitReturnPct(record)
    if (ret > 0.05) return "雷达风控"
    if (ret < -0.05) return "雷达止损"
    return "雷达平价退出"
  }
  if (record.lifecycleStatus === "expired" || record.status === "到期") return "信号到期"
  return "雷达退出"
}

function signalMarkDate(record: RadarHistoryRecord) {
  return paperTradeDate(record.closedAt ?? record.latestQuoteAt ?? record.recommendedAt)
}

function signalTimeValue(record: RadarHistoryRecord) {
  const value = new Date(record.closedAt ?? record.latestQuoteAt ?? record.recommendedAt).getTime()
  return Number.isFinite(value) ? value : 0
}

function newestSignalDate(records: RadarHistoryRecord[]) {
  const value = newestSignalTime(records)
  return value ? paperTradeDate(value) : undefined
}

function newestSignalTime(records: RadarHistoryRecord[]) {
  return records
    .map((record) => record.closedAt ?? record.latestQuoteAt ?? record.recommendedAt)
    .filter(Boolean)
    .sort()
    .at(-1)
}

function rangeStartDate(endDate: string, range: PaperRange) {
  if (range === "all") return "0000-01-01"
  const days = range === "1m" ? 31 : 93
  const end = new Date(`${endDate}T00:00:00+08:00`)
  if (!Number.isFinite(end.getTime())) return "0000-01-01"
  end.setUTCDate(end.getUTCDate() - days)
  return paperTradeDate(end.toISOString())
}

function sellSubmittedAt(position: PaperExecutionPosition | undefined, record: RadarHistoryRecord) {
  const requestedAt = record.closedAt ?? record.latestQuoteAt ?? record.recommendedAt
  if (!position || !record.latestQuoteAt) return requestedAt
  return isAshareT1SellAllowed(position, record.latestQuoteAt) ? record.latestQuoteAt : requestedAt
}

function isAshareT1SellAllowed(position: Pick<PaperExecutionPosition, "sellableFrom">, submittedAt: string) {
  return paperTradeDate(submittedAt) >= position.sellableFrom
}

function nextAshareTradeDate(value: string) {
  const date = new Date(`${paperTradeDate(value)}T12:00:00+08:00`)
  if (!Number.isFinite(date.getTime())) return paperTradeDate(value)

  do {
    date.setUTCDate(date.getUTCDate() + 1)
  } while (isWeekendChinaDate(date))

  return paperTradeDate(date.toISOString())
}

function isWeekendChinaDate(date: Date) {
  const weekday = date.getUTCDay()
  return weekday === 0 || weekday === 6
}

function paperTradeDate(value: string) {
  const parsed = new Date(value.includes("T") ? value : `${value}T00:00:00+08:00`)
  if (!Number.isFinite(parsed.getTime())) return value.slice(0, 10)
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const parts = Object.fromEntries(formatter.formatToParts(parsed).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

function roundLotShares(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.floor(value / PAPER_LOT_SIZE) * PAPER_LOT_SIZE
}

function normalizeName(value?: string | null) {
  return (value ?? "").replace(/\s+/g, "").toLowerCase()
}

function holdingDays(startIso: string, endIso?: string) {
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0
  return Math.max(0, Math.ceil((end - start) / 86_400_000))
}

function metricPercent(report: BacktestReport, label: string) {
  const raw = report.metrics.find((metric) => metric.label === label)?.value ?? "0"
  return Number(raw.replace("%", "").replace("+", "")) || 0
}

function rangeLabel(range: PaperRange) {
  if (range === "1m") return "近一月"
  if (range === "3m") return "近三月"
  return "交易至今"
}

function normalizeStartedAt(value?: string | null) {
  if (value && value !== "now") {
    const parsed = new Date(value)
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString()
  }
  return new Date().toISOString()
}

function emptyPaperAccount(range: PaperRange): PaperAccount {
  const account: Omit<PaperAccount, "runtime"> = {
    strategyId: "",
    strategyName: "暂无可模拟策略",
    admissionStatus: "待接入",
    admissionScore: 0,
    backtestProfile: emptyPaperBacktestProfile(),
    ledger: {
      driver: "memory",
      persisted: false,
    },
    startedAt: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    range,
    rangeLabel: rangeLabel(range),
    rangeStart: "",
    rangeEnd: "",
    initialCapital: INITIAL_CAPITAL,
    startEquity: INITIAL_CAPITAL,
    currentEquity: INITIAL_CAPITAL,
    availableCash: INITIAL_CAPITAL,
    investedValue: 0,
    rangeReturnPct: 0,
    totalReturnPct: 0,
    benchmarkReturnPct: 0,
    maxDrawdownPct: 0,
    tradeWinRatePct: 0,
    openPositionCount: 0,
    closedTradeCount: 0,
    orderCount: 0,
    curve: [],
    positions: [],
    orders: [],
    closedTrades: [],
    tradeCharts: [],
    options: [],
  }
  return attachPaperRuntime(account)
}

function emptyPaperBacktestProfile(): PaperBacktestProfile {
  return {
    status: "待补回测",
    source: "N/A",
    score: 0,
    annualReturnPct: 0,
    excessReturnPct: 0,
    maxDrawdownPct: 0,
    winRatePct: 0,
    sharpe: 0,
  }
}

function round2(value: number) {
  return Number(value.toFixed(2))
}

function buildPaperRuntime(account: Omit<PaperAccount, "runtime">, sync?: PaperSyncResult): PaperRuntime {
  const now = new Date()
  const market = chinaMarketState(now)
  const heartbeatAt = sync?.syncedAt ?? account.ledger.lastSyncedAt ?? account.generatedAt
  const dataAsOf = account.rangeEnd || paperTradeDate(account.generatedAt) || "N/A"
  const dataAgeDays = daysBetweenDateStrings(chinaDateString(now), dataAsOf)
  const dataFresh = dataAgeDays <= (market.weekend ? 3 : 1)
  const hasStrategy = Boolean(account.strategyId && account.options.length)
  const ledgerOk = account.ledger.persisted && !account.ledger.error && sync?.ok !== false
  const activeAccount = (account.ledger.status ?? "active") !== "closed"

  let state: PaperRuntime["state"] = "running"
  let label = market.isOpen ? "运行中" : "等待开盘"
  let tone: PaperRuntimeTone = market.isOpen ? "good" : "neutral"
  let detail = market.isOpen
    ? "后台心跳正在按雷达信号和最新行情校验纸面账户。"
    : `市场未开盘，账户保持监控；${market.reason}。`

  if (!hasStrategy) {
    state = "paused"
    label = "未接入"
    tone = "bad"
    detail = "当前没有可模拟策略，模拟盘不会产生信号。"
  } else if (!activeAccount) {
    state = "paused"
    label = "已暂停"
    tone = "bad"
    detail = "该纸面账户状态不是 active，需要重新接入或打开账户。"
  } else if (!ledgerOk) {
    state = market.isOpen ? "running" : "waiting"
    label = "本页快照"
    tone = "warning"
    detail = account.ledger.error ?? sync?.error ?? "Postgres 账本同步延迟；本页仍按接入后信号和最新行情计算，刷新会重试持久化。"
  } else if (!dataFresh) {
    state = "stale"
    label = "数据滞后"
    tone = "warning"
    detail = `最新可用行情截至 ${dataAsOf}，距离当前中国日期已有 ${dataAgeDays} 天。`
  } else if (!market.isOpen) {
    state = "waiting"
  }

  const lastAction = latestPaperAction(account)
  return {
    state,
    label,
    tone,
    detail,
    heartbeatAt,
    dataAsOf,
    nextCheckAt: market.nextCheckAt,
    cadence: market.isOpen ? "约 3 分钟 / 后台心跳" : "下个交易窗口校验",
    lastAction,
    checks: [
      {
        label: "账户状态",
        value: activeAccount ? "active" : "closed",
        tone: activeAccount ? "good" : "bad",
        note: activeAccount ? "策略账户未关闭。" : "账户已关闭，不会继续模拟。",
      },
      {
        label: "心跳写入",
        value: ledgerOk ? "正常" : "快照",
        tone: ledgerOk ? "good" : "warning",
        note: ledgerOk ? "最新快照已写入 Postgres。" : "Postgres 写入延迟，本页先使用实时快照。",
      },
      {
        label: "行情新鲜度",
        value: dataFresh ? "可用" : "滞后",
        tone: dataFresh ? "good" : "warning",
        note: `最新行情 ${dataAsOf}。`,
      },
      {
        label: "持仓状态",
        value: account.openPositionCount > 0 ? `${account.openPositionCount} 只` : "空仓",
        tone: account.openPositionCount > 0 ? "good" : "neutral",
        note: account.openPositionCount > 0 ? "正在跟踪持仓浮盈。" : "空仓不代表暂停，只是当前没有入场信号。",
      },
      {
        label: "订单流水",
        value: account.orderCount ? `${account.orderCount} 条` : "等待",
        tone: account.orders.some((order) => order.status === "filled") ? "good" : "neutral",
        note: account.orderCount ? "入场、跳过和拒单原因已记录。" : "还没有接入后的撮合记录。",
      },
      {
        label: "A股 T+1",
        value: "已启用",
        tone: "good",
        note: "当天买入的仓位不会当天卖出，卖出需等下一交易日可卖。",
      },
    ],
  }
}

function latestPaperAction(account: Omit<PaperAccount, "runtime">) {
  const order = account.orders[0]
  if (order) {
    const side = order.side === "buy" ? "买入" : "卖出"
    const status = order.status === "filled" ? "已成交" : order.status === "rejected" ? "已拒单" : "已跳过"
    return `最近撮合：${order.name} ${side}${status}，${order.note}`
  }
  if (account.positions.length) {
    const names = account.positions.slice(0, 2).map((position) => position.name).join(" / ")
    return `持仓跟踪：${names}${account.positions.length > 2 ? ` 等 ${account.positions.length} 只` : ""}。`
  }
  const trade = account.closedTrades[0]
  if (trade) {
    return `最近平仓：${trade.name} ${trade.exitDate}，收益 ${formatRuntimePercent(trade.returnPct)}。`
  }
  return "空仓观察：策略在线，等待下一次入场信号或调仓窗口。"
}

function chinaMarketState(now: Date) {
  const parts = chinaParts(now)
  const minutes = parts.hour * 60 + parts.minute
  const weekend = parts.weekday === 0 || parts.weekday === 6
  const morningOpen = 9 * 60 + 30
  const morningClose = 11 * 60 + 30
  const afternoonOpen = 13 * 60
  const close = 15 * 60
  const isOpen = !weekend && ((minutes >= morningOpen && minutes <= morningClose) || (minutes >= afternoonOpen && minutes <= close))

  if (isOpen) {
    return {
      isOpen,
      weekend,
      reason: "A 股交易时段",
      nextCheckAt: formatChinaDateTime(addMinutes(now, 5)),
    }
  }
  if (weekend) {
    return {
      isOpen,
      weekend,
      reason: "周末休市",
      nextCheckAt: `${nextWeekdayDate(parts.date)} 09:30`,
    }
  }
  if (minutes < morningOpen) {
    return { isOpen, weekend, reason: "盘前等待", nextCheckAt: `${parts.date} 09:30` }
  }
  if (minutes > morningClose && minutes < afternoonOpen) {
    return { isOpen, weekend, reason: "午间休市", nextCheckAt: `${parts.date} 13:00` }
  }
  return {
    isOpen,
    weekend,
    reason: "收盘后等待",
    nextCheckAt: `${nextWeekdayDate(parts.date)} 09:30`,
  }
}

function chinaParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]))
  const dateString = `${values.year}-${values.month}-${values.day}`
  const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[values.weekday ?? ""] ?? 1
  return {
    date: dateString,
    hour: Number(values.hour),
    minute: Number(values.minute),
    weekday,
  }
}

function chinaDateString(date: Date) {
  return chinaParts(date).date
}

function nextWeekdayDate(dateString: string) {
  const date = new Date(`${dateString}T12:00:00+08:00`)
  do {
    date.setUTCDate(date.getUTCDate() + 1)
  } while (date.getUTCDay() === 0 || date.getUTCDay() === 6)
  return paperTradeDate(date.toISOString())
}

function daysBetweenDateStrings(current: string, previous: string) {
  if (!previous || previous === "N/A") return 999
  const currentDate = new Date(`${current}T00:00:00+08:00`).getTime()
  const previousDate = new Date(`${previous}T00:00:00+08:00`).getTime()
  if (!Number.isFinite(currentDate) || !Number.isFinite(previousDate)) return 999
  return Math.max(0, Math.round((currentDate - previousDate) / 86_400_000))
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

function formatChinaDateTime(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)
}

function formatRuntimePercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
}
