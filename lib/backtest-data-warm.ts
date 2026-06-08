import { getMarketDataQualitySnapshot } from "@/lib/backtest-data-store"
import { STOCK_POOL, type StockPoolItem } from "@/lib/stock-pool"

export type BacktestWarmMode = "missing" | "offset"

export type BacktestWarmPlan = {
  mode: BacktestWarmMode
  pool: StockPoolItem[]
  offset: number
  limit: number
  refresh: boolean
  lookbackDays: number
  reason: string
  missingCount?: number
  staleCount?: number
  selectedStaleCount?: number
}

export async function buildBacktestWarmPlan({
  mode = "missing",
  offset = 0,
  limit = 5,
}: {
  mode?: BacktestWarmMode
  offset?: number
  limit?: number
}): Promise<BacktestWarmPlan> {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit) || 10))
  const safeOffset = Math.max(0, Math.min(STOCK_POOL.length - 1, Math.floor(offset) || 0))

  if (mode === "offset") {
    return {
      mode,
      pool: STOCK_POOL.slice(safeOffset, safeOffset + safeLimit),
      offset: safeOffset,
      limit: safeLimit,
      refresh: false,
      lookbackDays: 750,
      reason: `从静态股票池第 ${safeOffset + 1} 只开始顺序预热。`,
    }
  }

  const quality = await getMarketDataQualitySnapshot()
  const missingSymbols = new Set(quality.missingSymbols.map((stock) => stock.symbol))
  const staleSymbols = new Set(quality.staleSymbols.map((stock) => stock.symbol))
  const missingPool = STOCK_POOL.filter((stock) => missingSymbols.has(stock.symbol))
  const stalePool = STOCK_POOL.filter((stock) => !missingSymbols.has(stock.symbol) && staleSymbols.has(stock.symbol))

  if (missingPool.length) {
    const pool = missingPool.slice(0, safeLimit)
    return {
      mode: "missing",
      pool,
      offset: 0,
      limit: safeLimit,
      refresh: false,
      lookbackDays: 750,
      missingCount: quality.missingSymbols.length,
      staleCount: quality.staleSymbols.length,
      selectedStaleCount: 0,
      reason: `优先补齐 ${quality.missingSymbols.length} 只缺失股票；日期滞后股票留到下一批轻量刷新。`,
    }
  }

  if (stalePool.length) {
    const pool = stalePool.slice(0, safeLimit)
    return {
      mode: "missing",
      pool,
      offset: 0,
      limit: safeLimit,
      refresh: true,
      lookbackDays: 180,
      missingCount: 0,
      staleCount: quality.staleSymbols.length,
      selectedStaleCount: pool.length,
      reason: `优先刷新 ${quality.staleSymbols.length} 只日期滞后股票。`,
    }
  }

  return {
    mode: "offset",
    pool: STOCK_POOL.slice(safeOffset, safeOffset + safeLimit),
    offset: safeOffset,
    limit: safeLimit,
    refresh: false,
    lookbackDays: 750,
    missingCount: 0,
    staleCount: 0,
    selectedStaleCount: 0,
    reason: "股票池已无明显缺口，按顺序刷新下一批缓存。",
  }
}
