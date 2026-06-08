import { getChinaMarketSession } from "@/lib/cn-market-session"
import {
  PAPER_CONFLUENCE_STRATEGY_ID,
  PAPER_CONFLUENCE_STRATEGY_NAME,
} from "@/lib/paper-confluence-constants"
import type { RecentPaperOrderRecord } from "@/lib/paper-trading-store"
import { listPaperOrdersForConfluence } from "@/lib/paper-trading-store"
import type { RadarHistoryRecord } from "@/lib/radar-history"

export const PAPER_CONFLUENCE_ORDER_LIMIT = 2_000

export type PaperConfluenceStatus = "filled" | "watch" | "blocked"

export type PaperConfluenceSignal = {
  symbol: string
  name: string
  strategyCount: number
  strategyIds: string[]
  strategyNames: string[]
  orderCount: number
  filledStrategyCount: number
  skippedStrategyCount: number
  rejectedStrategyCount: number
  totalShares: number
  totalAmount: number
  avgPrice?: number
  referencePrice?: number
  firstAt: string
  triggerAt: string
  triggerPrice?: number
  latestAt: string
  status: PaperConfluenceStatus
  statusLabel: string
  note: string
}

type PaperConfluenceOptions = {
  tradeDate?: string
  windowDays?: number
  minStrategies?: number
  limit?: number
  startedAt?: string | null
}

type PaperConfluenceRangeOptions = Omit<PaperConfluenceOptions, "tradeDate" | "windowDays"> & {
  fromDate: string
  toDate: string
}

type StrategyHit = {
  id: string
  name: string
  status: RecentPaperOrderRecord["status"]
  firstAt: string
  firstPrice?: number
  latestAt: string
  latestPrice?: number
  filledShares: number
  filledAmount: number
}

type GroupDraft = {
  symbol: string
  name: string
  firstAt: string
  latestAt: string
  orderCount: number
  strategies: Map<string, StrategyHit>
  totalShares: number
  totalAmount: number
  referencePriceTotal: number
  referencePriceCount: number
}

export async function loadPaperConfluenceSignals(options: PaperConfluenceOptions = {}) {
  const window = paperConfluenceWindow(options)
  const orders = await listPaperOrdersForConfluence({
    fromDate: window.fromDate,
    toDate: window.tradeDate,
    limit: options.limit ?? PAPER_CONFLUENCE_ORDER_LIMIT,
  })
  return buildPaperOrderConfluence(orders, {
    ...options,
    tradeDate: window.tradeDate,
    windowDays: window.windowDays,
  })
}

export async function loadPaperConfluenceSignalsForDateRange(options: PaperConfluenceRangeOptions) {
  const fromDate = normalizeDate(options.fromDate)
  const toDate = normalizeDate(options.toDate)
  if (!fromDate || !toDate || fromDate > toDate) return []

  const orders = await listPaperOrdersForConfluence({
    fromDate,
    toDate,
    limit: options.limit ?? PAPER_CONFLUENCE_ORDER_LIMIT,
  })
  const signals: PaperConfluenceSignal[] = []
  for (const tradeDate of dateRange(fromDate, toDate)) {
    signals.push(...buildPaperOrderConfluence(orders, {
      ...options,
      tradeDate,
      windowDays: 1,
    }))
  }
  return signals
}

export async function loadPaperConfluenceSignalRecords(options: PaperConfluenceOptions = {}) {
  const window = paperConfluenceWindow(options)
  const orders = await listPaperOrdersForConfluence({
    fromDate: window.fromDate,
    toDate: window.tradeDate,
    limit: options.limit ?? PAPER_CONFLUENCE_ORDER_LIMIT,
  })
  return buildPaperConfluenceSignalRecords(orders, {
    ...options,
    tradeDate: window.tradeDate,
    windowDays: window.windowDays,
  })
}

export function buildPaperOrderConfluence(
  orders: RecentPaperOrderRecord[],
  options: PaperConfluenceOptions = {},
): PaperConfluenceSignal[] {
  const tradeDate = options.tradeDate ?? getChinaMarketSession().tradeDate
  const windowDays = normalizedWindowDays(options.windowDays)
  const minStrategies = normalizedMinStrategies(options.minStrategies)
  const fromDate = shiftDate(tradeDate, -(windowDays - 1))
  const startedAtTime = parseTime(options.startedAt)
  const groups = new Map<string, GroupDraft>()

  for (const order of orders) {
    if (order.side !== "buy") continue
    if (order.strategyId === PAPER_CONFLUENCE_STRATEGY_ID) continue
    const orderTime = parseTime(order.submittedAt)
    if (startedAtTime !== null && (orderTime === null || orderTime < startedAtTime)) continue
    const orderDate = chinaDate(order.submittedAt)
    if (!orderDate || orderDate < fromDate || orderDate > tradeDate) continue

    const group = groups.get(order.symbol) ?? {
      symbol: order.symbol,
      name: order.name,
      firstAt: order.submittedAt,
      latestAt: order.submittedAt,
      orderCount: 0,
      strategies: new Map<string, StrategyHit>(),
      totalShares: 0,
      totalAmount: 0,
      referencePriceTotal: 0,
      referencePriceCount: 0,
    }

    group.orderCount += 1
    if (new Date(order.submittedAt).getTime() > new Date(group.latestAt).getTime()) group.latestAt = order.submittedAt
    if (new Date(order.submittedAt).getTime() < new Date(group.firstAt).getTime()) group.firstAt = order.submittedAt

    const price = order.filledPrice ?? order.limitPrice
    if (Number.isFinite(price) && price > 0) {
      group.referencePriceTotal += price
      group.referencePriceCount += 1
    }
    if (order.status === "filled" && order.filledShares > 0 && price > 0) {
      group.totalShares += order.filledShares
      group.totalAmount += order.filledShares * price
    }

    const strategyKey = order.strategyId || order.strategyName
    const strategy = group.strategies.get(strategyKey)
    const firstAt = strategy ? olderDate(strategy.firstAt, order.submittedAt) : order.submittedAt
    const latestAt = strategy ? newerDate(strategy.latestAt, order.submittedAt) : order.submittedAt
    const firstPrice = strategy && new Date(strategy.firstAt).getTime() <= new Date(order.submittedAt).getTime()
      ? strategy.firstPrice
      : validPrice(price)
    const latestPrice = strategy && new Date(strategy.latestAt).getTime() >= new Date(order.submittedAt).getTime()
      ? strategy.latestPrice
      : validPrice(price)
    const hit: StrategyHit = strategy
      ? {
          ...strategy,
          status: mergeStatus(strategy.status, order.status),
          firstAt,
          firstPrice: firstPrice ?? strategy.firstPrice,
          latestAt,
          latestPrice: latestPrice ?? strategy.latestPrice,
          filledShares: strategy.filledShares + (order.status === "filled" ? order.filledShares : 0),
          filledAmount: strategy.filledAmount + (order.status === "filled" && price > 0 ? order.filledShares * price : 0),
        }
      : {
          id: order.strategyId,
          name: order.strategyName,
          status: order.status,
          firstAt: order.submittedAt,
          firstPrice: validPrice(price),
          latestAt: order.submittedAt,
          latestPrice: validPrice(price),
          filledShares: order.status === "filled" ? order.filledShares : 0,
          filledAmount: order.status === "filled" && price > 0 ? order.filledShares * price : 0,
        }

    group.strategies.set(strategyKey, hit)
    groups.set(order.symbol, group)
  }

  return Array.from(groups.values())
    .map((group) => toConfluenceSignal(group, minStrategies))
    .filter((row) => row.strategyCount >= minStrategies)
    .sort((a, b) => {
      if (b.filledStrategyCount !== a.filledStrategyCount) return b.filledStrategyCount - a.filledStrategyCount
      if (b.strategyCount !== a.strategyCount) return b.strategyCount - a.strategyCount
      return new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime()
    })
}

export function buildPaperConfluenceSignalRecords(
  orders: RecentPaperOrderRecord[],
  options: PaperConfluenceOptions = {},
): RadarHistoryRecord[] {
  const minStrategies = normalizedMinStrategies(options.minStrategies)
  return buildPaperOrderConfluence(orders, options)
    .filter((signal) => signal.status === "filled" && signal.filledStrategyCount >= minStrategies && signal.totalShares > 0)
    .map(confluenceToRadarRecord)
    .filter((record) => record.triggerPrice > 0 && record.latestPrice > 0)
}

function toConfluenceSignal(group: GroupDraft, minStrategies: number): PaperConfluenceSignal {
  const strategies = Array.from(group.strategies.values()).sort((a, b) => {
    if (statusRank(b.status) !== statusRank(a.status)) return statusRank(b.status) - statusRank(a.status)
    return new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime()
  })
  const filledStrategyCount = strategies.filter((strategy) => strategy.status === "filled").length
  const rejectedStrategyCount = strategies.filter((strategy) => strategy.status === "rejected").length
  const skippedStrategyCount = strategies.filter((strategy) => strategy.status === "skipped").length
  const status = filledStrategyCount >= minStrategies ? "filled" : rejectedStrategyCount >= strategies.length ? "blocked" : "watch"
  const strategyNames = strategies.map((strategy) => normalizeStrategyName(strategy.name))
  const strategyIds = strategies.map((strategy) => strategy.id).filter(Boolean)
  const avgPrice = group.totalShares > 0 ? group.totalAmount / group.totalShares : undefined
  const referencePrice = group.referencePriceCount > 0 ? group.referencePriceTotal / group.referencePriceCount : undefined
  const trigger = confluenceTrigger(strategies, minStrategies, avgPrice ?? referencePrice)

  return {
    symbol: group.symbol,
    name: group.name,
    strategyCount: strategies.length,
    strategyIds,
    strategyNames,
    orderCount: group.orderCount,
    filledStrategyCount,
    skippedStrategyCount,
    rejectedStrategyCount,
    totalShares: group.totalShares,
    totalAmount: group.totalAmount,
    avgPrice,
    referencePrice,
    firstAt: group.firstAt,
    triggerAt: trigger.at,
    triggerPrice: trigger.price,
    latestAt: group.latestAt,
    status,
    statusLabel: status === "filled" ? "已成交共振" : status === "blocked" ? "风控阻断" : "观察共振",
    note: `${strategies.length} 个策略同向命中：${strategyNames.slice(0, 4).join("、")}；触发锚点固定为首次达到 ${minStrategies} 策略成交共振的北京时间。`,
  }
}

function confluenceToRadarRecord(signal: PaperConfluenceSignal): RadarHistoryRecord {
  const signalAt = signal.triggerAt || signal.latestAt
  const price = round2(signal.triggerPrice ?? signal.avgPrice ?? signal.referencePrice ?? 0)
  const targetPct = signal.strategyCount >= 3 || signal.filledStrategyCount >= 2 ? 8 : 5.5
  const stopPct = signal.strategyCount >= 3 ? 4.5 : 3.5
  const chinaTradeDate = chinaDate(signalAt) ?? signalAt.slice(0, 10)
  const strategyLabel = signal.strategyNames.slice(0, 4).join("、")
  const action = signal.strategyCount >= 3 || signal.filledStrategyCount >= 2 ? "多策略高共振买入" : "多策略加仓确认"

  return {
    id: `${PAPER_CONFLUENCE_STRATEGY_ID}:${chinaTradeDate}:${signal.symbol}`,
    recommendedAt: signalAt,
    latestQuoteAt: signal.latestAt,
    ticker: signal.symbol,
    name: signal.name,
    strategyId: PAPER_CONFLUENCE_STRATEGY_ID,
    strategyName: PAPER_CONFLUENCE_STRATEGY_NAME,
    signalKind: signal.strategyCount >= 3 || signal.filledStrategyCount >= 2 ? "high-confidence-buy" : "add-confirm",
    buyPoint: "multi-strategy-confluence",
    lifecycleStage: "triggered",
    lifecycleStatus: "open",
    signal: action,
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
    note: `${signal.strategyCount} 个已上线策略同向命中：${strategyLabel}；以首次达到共振门槛的北京时间作为合成入场信号，后续策略加入不改原始触发价。`,
  }
}

function mergeStatus(current: RecentPaperOrderRecord["status"], next: RecentPaperOrderRecord["status"]) {
  return statusRank(next) > statusRank(current) ? next : current
}

function statusRank(status: RecentPaperOrderRecord["status"]) {
  if (status === "filled") return 3
  if (status === "skipped") return 2
  return 1
}

function newerDate(a: string, b: string) {
  return new Date(b).getTime() > new Date(a).getTime() ? b : a
}

function olderDate(a: string, b: string) {
  return new Date(b).getTime() < new Date(a).getTime() ? b : a
}

function validPrice(value: number | undefined | null) {
  return value != null && Number.isFinite(value) && value > 0 ? value : undefined
}

function parseTime(value?: string | null) {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

function confluenceTrigger(strategies: StrategyHit[], minStrategies: number, fallbackPrice?: number) {
  const filled = strategies
    .filter((strategy) => strategy.status === "filled" && strategy.filledShares > 0)
    .sort((a, b) => new Date(a.firstAt).getTime() - new Date(b.firstAt).getTime())
  const basis = (filled.length >= minStrategies ? filled : strategies)
    .slice()
    .sort((a, b) => new Date(a.firstAt).getTime() - new Date(b.firstAt).getTime())
  const trigger = basis[Math.min(Math.max(minStrategies, 1), basis.length) - 1] ?? basis.at(-1)
  return {
    at: trigger?.firstAt ?? strategies[0]?.firstAt ?? new Date().toISOString(),
    price: trigger?.firstPrice ?? trigger?.latestPrice ?? fallbackPrice,
  }
}

function normalizeStrategyName(name: string) {
  return name.replace(/\s*\+\s*盘中确认$/, "").replace(/\s*候选$/, "")
}

function paperConfluenceWindow(options: PaperConfluenceOptions = {}) {
  const tradeDate = options.tradeDate ?? getChinaMarketSession().tradeDate
  const windowDays = normalizedWindowDays(options.windowDays)
  return {
    tradeDate,
    windowDays,
    fromDate: shiftDate(tradeDate, -(windowDays - 1)),
  }
}

function normalizedWindowDays(value?: number) {
  return Math.max(1, Math.min(value ?? 3, 30))
}

function normalizedMinStrategies(value?: number) {
  return Math.max(2, Math.min(value ?? 2, 6))
}

function chinaDate(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" })
}

function shiftDate(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number)
  if (!year || !month || !day) return date
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return shifted.toISOString().slice(0, 10)
}

function dateRange(fromDate: string, toDate: string) {
  const dates: string[] = []
  let current = fromDate
  while (current <= toDate && dates.length < 31) {
    dates.push(current)
    current = shiftDate(current, 1)
  }
  return dates
}

function normalizeDate(value?: string) {
  if (!value) return null
  const text = value.replace(/\//g, "-").slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

function round2(value: number) {
  return Math.round(value * 100) / 100
}
