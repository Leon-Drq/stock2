import { STOCK_POOL, STOCK_POOL_TARGET_SIZE, type StockPoolItem } from "@/lib/stock-pool"

export type ScanUniverseScope = "backtest" | "radar" | "paper" | "miss-audit"

export type ScanUniverse = {
  id: string
  label: string
  scope: ScanUniverseScope
  stocks: StockPoolItem[]
  targetSize: number
  stockPoolSize: number
  note: string
}

export type ScanUniverseDiagnostics = {
  id: string
  label: string
  scope: ScanUniverseScope
  stockPoolSize: number
  targetSize: number
  requestedSymbols: number
  historyAvailable: number
  skippedNoHistory: number
  quoteRequested: number
  quoteReturned: number
  note: string
  prefilter?: {
    source: "postgres-indicators" | "unavailable"
    inputSymbols: number
    selectedSymbols: number
    eligibleSymbols: number
    latestDate?: string
    minBars: number
    note: string
  }
}

const DEFAULT_SCAN_UNIVERSE_ID = "technical-core-v1"
const DEFAULT_SCAN_UNIVERSE_LABEL = "统一技术扫描池"

export function getScanUniverse(scope: ScanUniverseScope = "radar", options: { targetSize?: number } = {}): ScanUniverse {
  const targetSize = scanUniverseTargetSize(scope, options.targetSize)
  const stocks = STOCK_POOL.slice(0, targetSize)
  return {
    id: DEFAULT_SCAN_UNIVERSE_ID,
    label: DEFAULT_SCAN_UNIVERSE_LABEL,
    scope,
    stocks,
    targetSize,
    stockPoolSize: STOCK_POOL.length,
    note: targetSize < STOCK_POOL.length
      ? `共用统一股票池和技术面准入规则；${scopeLabel(scope)}实时窗口扫描前 ${targetSize}/${STOCK_POOL.length} 只，后续由数据层预热和环境变量逐步扩容。`
      : "回测、策略雷达、实盘模拟和漏报复盘共用完整技术面扫描池；信号仍由价格、成交量、趋势和风控规则触发。",
  }
}

export function isInScanUniverse(symbol: string, universe = getScanUniverse()) {
  const normalized = normalizeSymbol(symbol)
  return universe.stocks.some((stock) => stock.symbol === normalized)
}

export function normalizeSymbol(value: string) {
  const match = value.match(/[0368]\d{5}/)
  return match?.[0] ?? value.trim().slice(0, 6)
}

export function buildScanUniverseDiagnostics({
  universe,
  historyAvailable,
  quoteRequested,
  quoteReturned,
  prefilter,
}: {
  universe: ScanUniverse
  historyAvailable: number
  quoteRequested: number
  quoteReturned: number
  prefilter?: ScanUniverseDiagnostics["prefilter"]
}): ScanUniverseDiagnostics {
  return {
    id: universe.id,
    label: universe.label,
    scope: universe.scope,
    stockPoolSize: universe.stockPoolSize,
    targetSize: universe.targetSize,
    requestedSymbols: universe.stocks.length,
    historyAvailable,
    skippedNoHistory: Math.max(0, universe.stocks.length - historyAvailable),
    quoteRequested,
    quoteReturned,
    note: universe.note,
    prefilter,
  }
}

function scanUniverseTargetSize(scope: ScanUniverseScope, explicitTargetSize?: number) {
  if (explicitTargetSize != null && Number.isFinite(explicitTargetSize)) {
    return Math.max(30, Math.min(STOCK_POOL.length, Math.floor(explicitTargetSize)))
  }
  const raw = envSizeForScope(scope)
  const parsed = raw ? Number(raw) : defaultSizeForScope(scope)
  if (!Number.isFinite(parsed)) return Math.min(STOCK_POOL_TARGET_SIZE, STOCK_POOL.length)
  return Math.max(30, Math.min(STOCK_POOL.length, Math.floor(parsed)))
}

function envSizeForScope(scope: ScanUniverseScope) {
  if (scope === "radar") return process.env.RADAR_SCAN_UNIVERSE_SIZE ?? process.env.SCAN_UNIVERSE_SIZE
  if (scope === "paper") return process.env.PAPER_SCAN_UNIVERSE_SIZE ?? process.env.RADAR_SCAN_UNIVERSE_SIZE ?? process.env.SCAN_UNIVERSE_SIZE
  if (scope === "backtest") return process.env.BACKTEST_SCAN_UNIVERSE_SIZE ?? process.env.SCAN_UNIVERSE_SIZE
  return process.env.MISS_AUDIT_SCAN_UNIVERSE_SIZE ?? process.env.SCAN_UNIVERSE_SIZE
}

function defaultSizeForScope(scope: ScanUniverseScope) {
  if (scope === "radar" || scope === "paper") return 120
  return STOCK_POOL_TARGET_SIZE
}

function scopeLabel(scope: ScanUniverseScope) {
  if (scope === "paper") return "实盘模拟"
  if (scope === "backtest") return "真实回测"
  if (scope === "miss-audit") return "漏涨复盘"
  return "策略雷达"
}
