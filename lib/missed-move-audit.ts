import { getChinaMarketSession } from "@/lib/cn-market-session"
import { fetchLatestQuotes, type LatestQuote } from "@/lib/qveris-quotes"
import { loadStockBarsBatchFromStore } from "@/lib/backtest-data-store"
import { loadRadarSignalHistoryRecordsForTradeDate } from "@/lib/radar-signal-store"
import { getScanUniverse, isInScanUniverse, normalizeSymbol } from "@/lib/scan-universe"
import { findStock, type StockPoolItem } from "@/lib/stock-pool"

export type MissedMoveAuditItem = {
  symbol: string
  name: string
  inStockPool: boolean
  inScanUniverse: boolean
  hasHistory: boolean
  hasRealtimeQuote: boolean
  wasRecommendedToday: boolean
  quote?: {
    latest: number
    changePct: number
    tradeDate: string
    tradeTime: string
  }
  reasonCode:
    | "not-in-stock-pool"
    | "not-in-scan-universe"
    | "missing-history"
    | "missing-quote"
    | "recommended"
    | "not-triggered"
  reason: string
}

export type MissedMoveAuditReport = {
  generatedAt: string
  tradeDate: string
  universe: {
    id: string
    label: string
    requestedSymbols: number
    note: string
  }
  parsed: number
  items: MissedMoveAuditItem[]
  summary: {
    notInStockPool: number
    notInScanUniverse: number
    missingHistory: number
    missingQuote: number
    recommended: number
    notTriggered: number
  }
  quoteFallbackReason?: string
}

const NAME_ALIASES: Record<string, string> = {
  光云科技: "688365",
  软通动力: "301236",
  壹网壹创: "300792",
  久其软件: "002279",
  浙大网新: "600797",
  用友网络: "600588",
  狮头股份: "600539",
  税友股份: "603171",
  视觉中国: "000681",
  掌阅科技: "603533",
  星环科技: "688031",
  鼎捷数智: "300378",
  易点天下: "301171",
}

export async function buildMissedMoveAudit(input: string): Promise<MissedMoveAuditReport> {
  const marketSession = getChinaMarketSession()
  const universe = getScanUniverse("miss-audit")
  const targets = parseAuditTargets(input)
  const stockTargets = targets.map((target) => {
    const known = findStock(target.symbol)
    return known ?? guessStock(target)
  })
  const scanTargets = stockTargets.filter((stock) => isInScanUniverse(stock.symbol, universe))
  const [history, ledger, quotes] = await Promise.all([
    scanTargets.length ? loadStockBarsBatchFromStore(scanTargets, 250) : Promise.resolve(new Map()),
    loadRadarSignalHistoryRecordsForTradeDate(marketSession.tradeDate, 500),
    stockTargets.length ? fetchLatestQuotes(stockTargets.slice(0, 20), { discoverTimeoutMs: 3_000, callTimeoutMs: 8_000 }) : Promise.resolve(null),
  ])
  const recommended = new Set(ledger.map((record) => record.ticker))

  const items: MissedMoveAuditItem[] = stockTargets.map((stock) => {
    const original = targets.find((target) => target.symbol === stock.symbol)
    const inStockPool = Boolean(findStock(stock.symbol))
    const inScanUniverse = isInScanUniverse(stock.symbol, universe)
    const hasHistory = history.has(stock.symbol)
    const quote = quotes?.quotes.get(stock.symbol)
    const wasRecommendedToday = recommended.has(stock.symbol)
    return auditItem({
      stock,
      displayName: original?.name ?? stock.name,
      inStockPool,
      inScanUniverse,
      hasHistory,
      quote,
      wasRecommendedToday,
    })
  })

  return {
    generatedAt: new Date().toISOString(),
    tradeDate: marketSession.tradeDate,
    universe: {
      id: universe.id,
      label: universe.label,
      requestedSymbols: universe.stocks.length,
      note: universe.note,
    },
    parsed: targets.length,
    items,
    summary: {
      notInStockPool: items.filter((item) => item.reasonCode === "not-in-stock-pool").length,
      notInScanUniverse: items.filter((item) => item.reasonCode === "not-in-scan-universe").length,
      missingHistory: items.filter((item) => item.reasonCode === "missing-history").length,
      missingQuote: items.filter((item) => item.reasonCode === "missing-quote").length,
      recommended: items.filter((item) => item.reasonCode === "recommended").length,
      notTriggered: items.filter((item) => item.reasonCode === "not-triggered").length,
    },
    quoteFallbackReason: quotes?.fallbackReason,
  }
}

function parseAuditTargets(input: string) {
  const bySymbol = new Map<string, { symbol: string; name?: string }>()
  const codePattern = /([\u4e00-\u9fa5A-Za-z]{2,16})?\s*[（(]?\s*([0368]\d{5})\s*[）)]?/g
  for (const match of input.matchAll(codePattern)) {
    const symbol = normalizeSymbol(match[2])
    if (!symbol) continue
    bySymbol.set(symbol, { symbol, name: match[1]?.trim() })
  }
  for (const [name, symbol] of Object.entries(NAME_ALIASES)) {
    if (input.includes(name) && !bySymbol.has(symbol)) bySymbol.set(symbol, { symbol, name })
  }
  return Array.from(bySymbol.values()).slice(0, 30)
}

function guessStock(target: { symbol: string; name?: string }): StockPoolItem {
  const exchange = target.symbol.startsWith("6") || target.symbol.startsWith("8") ? "SH" : "SZ"
  return {
    symbol: target.symbol,
    symbolQveris: `${target.symbol}.${exchange}`,
    name: target.name ?? target.symbol,
    industry: "待归类",
  }
}

function auditItem({
  stock,
  displayName,
  inStockPool,
  inScanUniverse,
  hasHistory,
  quote,
  wasRecommendedToday,
}: {
  stock: StockPoolItem
  displayName: string
  inStockPool: boolean
  inScanUniverse: boolean
  hasHistory: boolean
  quote?: LatestQuote
  wasRecommendedToday: boolean
}): MissedMoveAuditItem {
  const base = {
    symbol: stock.symbol,
    name: displayName || stock.name,
    inStockPool,
    inScanUniverse,
    hasHistory,
    hasRealtimeQuote: Boolean(quote),
    wasRecommendedToday,
    quote: quote
      ? {
          latest: quote.latest,
          changePct: quote.changePct,
          tradeDate: quote.tradeDate,
          tradeTime: quote.tradeTime,
        }
      : undefined,
  }
  if (!inStockPool) {
    return {
      ...base,
      reasonCode: "not-in-stock-pool",
      reason: "不在统一股票池内，回测、雷达、实盘模拟都不会扫描到它。",
    }
  }
  if (!inScanUniverse) {
    return {
      ...base,
      reasonCode: "not-in-scan-universe",
      reason: "在股票池里，但不在当前统一扫描池；需要先调整扫描池，而不是加策略。",
    }
  }
  if (!hasHistory) {
    return {
      ...base,
      reasonCode: "missing-history",
      reason: "在扫描池里，但缺少足够历史 K 线，技术因子无法严肃计算。",
    }
  }
  if (!quote) {
    return {
      ...base,
      reasonCode: "missing-quote",
      reason: "有历史 K 线，但本次没有拿到近实时报价，盘中信号无法确认。",
    }
  }
  if (wasRecommendedToday) {
    return {
      ...base,
      reasonCode: "recommended",
      reason: "今日已经进入信号账本，可在策略雷达或信号账本继续跟踪。",
    }
  }
  return {
    ...base,
    reasonCode: "not-triggered",
    reason: quote.changePct >= 8
      ? "数据覆盖正常，但当前技术策略没有在可交易买点前触发，或因追高/排序/风控未进入动作级信号。"
      : "数据覆盖正常，但没有满足当前技术买点。",
  }
}
