import { getSharedPostgresClient, hasSharedPostgresConfig, readSharedCache, writeSharedCache } from "@/lib/backtest-data-store"
import { BASE_STOCK_POOL, STOCK_POOL_TARGET_SIZE, type Exchange, type StockPoolItem } from "@/lib/stock-pool"

export type StockPoolFilters = {
  exchanges: Exchange[]
  industries: string[]
  symbolPrefixes: string[]
  requireHistory: boolean
  minBars: number
  maxStaleDays: number | null
}

export type StockPoolManualItem = StockPoolItem & {
  note?: string
  createdAt?: string
}

export type StockPoolConfig = {
  targetSize: number
  include: StockPoolManualItem[]
  excludeSymbols: string[]
  filters: StockPoolFilters
  updatedAt?: string
  updatedBy?: string
}

export type RuntimeStockPoolResult = {
  config: StockPoolConfig
  stocks: StockPoolItem[]
  baseCount: number
  afterStaticFilters: number
  afterHistoryFilters: number
  manualIncludeCount: number
  excludedCount: number
  targetSize: number
  historyFilterApplied: boolean
  historyFilterAvailable: boolean
  notes: string[]
}

type HistoryStatus = {
  symbol: string
  bars: number
  latestDate?: string
}

const CONFIG_KEY = "stock-radar:stock-pool-config:v1"
const CONFIG_TTL_SECONDS = 60 * 60 * 24 * 365

export const DEFAULT_STOCK_POOL_FILTERS: StockPoolFilters = {
  exchanges: [],
  industries: [],
  symbolPrefixes: [],
  requireHistory: false,
  minBars: 0,
  maxStaleDays: null,
}

export const DEFAULT_STOCK_POOL_CONFIG: StockPoolConfig = {
  targetSize: STOCK_POOL_TARGET_SIZE,
  include: [],
  excludeSymbols: [],
  filters: DEFAULT_STOCK_POOL_FILTERS,
}

export async function loadStockPoolConfig(): Promise<StockPoolConfig> {
  const raw = await readSharedCache(CONFIG_KEY)
  if (!raw) return DEFAULT_STOCK_POOL_CONFIG
  try {
    return normalizeConfig(JSON.parse(raw))
  } catch {
    return DEFAULT_STOCK_POOL_CONFIG
  }
}

export async function saveStockPoolConfig(input: unknown): Promise<StockPoolConfig> {
  const config = normalizeConfig(input)
  const next = { ...config, updatedAt: new Date().toISOString() }
  await writeSharedCache(CONFIG_KEY, JSON.stringify(next), CONFIG_TTL_SECONDS)
  return next
}

export async function getRuntimeStockPool(): Promise<StockPoolItem[]> {
  const result = await buildRuntimeStockPool(await loadStockPoolConfig())
  return result.stocks
}

export async function getRuntimeStockPoolSummary(): Promise<RuntimeStockPoolResult & {
  availableIndustries: string[]
  candidates: Array<StockPoolItem & { included: boolean; excluded: boolean; effective: boolean }>
}> {
  const result = await buildRuntimeStockPool(await loadStockPoolConfig())
  const effectiveSymbols = new Set(result.stocks.map((stock) => stock.symbol))
  const includeSymbols = new Set(result.config.include.map((stock) => stock.symbol))
  const excludeSymbols = new Set(result.config.excludeSymbols)
  const candidates = dedupeStockPool([...BASE_STOCK_POOL, ...result.config.include]).map((stock) => ({
    ...stock,
    included: includeSymbols.has(stock.symbol),
    excluded: excludeSymbols.has(stock.symbol),
    effective: effectiveSymbols.has(stock.symbol),
  }))
  return {
    ...result,
    availableIndustries: Array.from(new Set(candidates.map((stock) => stock.industry).filter(Boolean))).sort(),
    candidates,
  }
}

export async function buildRuntimeStockPool(config: StockPoolConfig): Promise<RuntimeStockPoolResult> {
  const normalized = normalizeConfig(config)
  const notes: string[] = []
  let filtered = applyStaticFilters(BASE_STOCK_POOL, normalized.filters)
  const afterStaticFilters = filtered.length
  const historyEligible = await loadHistoryEligibility(filtered, normalized.filters)
  const historyFilterAvailable = historyEligible !== null
  if (needsHistoryFilter(normalized.filters)) {
    if (historyEligible) {
      filtered = filtered.filter((stock) => historyEligible.has(stock.symbol))
    } else {
      notes.push("未配置 Postgres，历史覆盖过滤条件暂未生效。")
    }
  }
  const afterHistoryFilters = filtered.length
  const merged = dedupeStockPool([...normalized.include, ...filtered])
  const excluded = new Set(normalized.excludeSymbols)
  const stocks = merged
    .filter((stock) => !excluded.has(stock.symbol))
    .slice(0, normalized.targetSize)

  return {
    config: normalized,
    stocks,
    baseCount: BASE_STOCK_POOL.length,
    afterStaticFilters,
    afterHistoryFilters,
    manualIncludeCount: normalized.include.length,
    excludedCount: normalized.excludeSymbols.length,
    targetSize: normalized.targetSize,
    historyFilterApplied: needsHistoryFilter(normalized.filters) && historyFilterAvailable,
    historyFilterAvailable,
    notes,
  }
}

export function normalizeStockPoolItem(input: unknown): StockPoolManualItem | null {
  if (!input || typeof input !== "object") return null
  const row = input as Partial<StockPoolManualItem>
  const symbol = normalizeSymbol(row.symbol ?? row.symbolQveris ?? "")
  if (!symbol) return null
  const exchange = normalizeExchange(row.symbolQveris, symbol)
  const name = cleanText(row.name) || symbol
  const industry = cleanText(row.industry) || "待归类"
  return {
    symbol,
    symbolQveris: `${symbol}.${exchange}`,
    name,
    industry,
    note: cleanText(row.note),
    createdAt: cleanText(row.createdAt) || new Date().toISOString(),
  }
}

export function normalizeConfig(input: unknown): StockPoolConfig {
  const row = input && typeof input === "object" ? input as Partial<StockPoolConfig> : {}
  const filters = row.filters && typeof row.filters === "object" ? row.filters as Partial<StockPoolFilters> : {}
  const rawMaxStaleDays = (filters as Record<string, unknown>).maxStaleDays
  const include = Array.isArray(row.include)
    ? row.include.map(normalizeStockPoolItem).filter((item): item is StockPoolManualItem => Boolean(item))
    : []
  const excludeSymbols = Array.isArray(row.excludeSymbols)
    ? Array.from(new Set(row.excludeSymbols.map(normalizeSymbol).filter(Boolean)))
    : []
  return {
    targetSize: clampInteger(row.targetSize, 30, Math.max(30, BASE_STOCK_POOL.length + include.length), STOCK_POOL_TARGET_SIZE),
    include: dedupeStockPool(include) as StockPoolManualItem[],
    excludeSymbols,
    filters: {
      exchanges: normalizeExchangeList(filters.exchanges),
      industries: normalizeTextList(filters.industries),
      symbolPrefixes: normalizeTextList(filters.symbolPrefixes).map((prefix) => prefix.slice(0, 3)),
      requireHistory: filters.requireHistory === true,
      minBars: clampInteger(filters.minBars, 0, 750, 0),
      maxStaleDays: rawMaxStaleDays == null || rawMaxStaleDays === "" ? null : clampInteger(rawMaxStaleDays, 0, 3650, 30),
    },
    updatedAt: cleanText(row.updatedAt),
    updatedBy: cleanText(row.updatedBy),
  }
}

function applyStaticFilters(pool: StockPoolItem[], filters: StockPoolFilters) {
  const exchangeSet = new Set(filters.exchanges)
  const industrySet = new Set(filters.industries)
  const prefixes = filters.symbolPrefixes
  return pool.filter((stock) => {
    const exchange = stock.symbolQveris.endsWith(".SH") ? "SH" : "SZ"
    if (exchangeSet.size && !exchangeSet.has(exchange)) return false
    if (industrySet.size && !industrySet.has(stock.industry)) return false
    if (prefixes.length && !prefixes.some((prefix) => stock.symbol.startsWith(prefix))) return false
    return true
  })
}

async function loadHistoryEligibility(pool: StockPoolItem[], filters: StockPoolFilters): Promise<Set<string> | null> {
  if (!needsHistoryFilter(filters)) return new Set(pool.map((stock) => stock.symbol))
  if (!hasSharedPostgresConfig()) return null
  const sql = await getSharedPostgresClient()
  const symbols = pool.map((stock) => stock.symbol)
  if (!symbols.length) return new Set()
  try {
    const rows = await sql<HistoryStatus[]>`
      select symbol,
             count(*)::int as bars,
             max(trade_date)::text as "latestDate"
      from stock_daily_bars
      where symbol = any(${symbols})
      group by symbol
    `
    const latestAllowed = latestAllowedDate(filters.maxStaleDays)
    return new Set(rows
      .filter((row) => row.bars >= filters.minBars)
      .filter((row) => !filters.requireHistory || row.bars > 0)
      .filter((row) => !latestAllowed || (row.latestDate ?? "") >= latestAllowed)
      .map((row) => row.symbol))
  } catch {
    return null
  }
}

function needsHistoryFilter(filters: StockPoolFilters) {
  return filters.requireHistory || filters.minBars > 0 || filters.maxStaleDays != null
}

function latestAllowedDate(maxStaleDays: number | null) {
  if (maxStaleDays == null) return null
  const date = new Date()
  date.setDate(date.getDate() - maxStaleDays)
  return date.toISOString().slice(0, 10)
}

function dedupeStockPool<T extends StockPoolItem>(pool: T[]): T[] {
  const bySymbol = new Map<string, T>()
  for (const stock of pool) {
    if (!bySymbol.has(stock.symbol)) bySymbol.set(stock.symbol, stock)
  }
  return Array.from(bySymbol.values())
}

function normalizeSymbol(value: unknown) {
  if (typeof value !== "string") return ""
  const match = value.match(/[0368]\d{5}/)
  return match?.[0] ?? ""
}

function normalizeExchange(symbolQveris: unknown, symbol: string): Exchange {
  if (typeof symbolQveris === "string" && symbolQveris.toUpperCase().endsWith(".SZ")) return "SZ"
  if (typeof symbolQveris === "string" && symbolQveris.toUpperCase().endsWith(".SH")) return "SH"
  return symbol.startsWith("6") || symbol.startsWith("8") ? "SH" : "SZ"
}

function normalizeExchangeList(value: unknown): Exchange[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item) => String(item).toUpperCase()).filter((item): item is Exchange => item === "SH" || item === "SZ")))
}

function normalizeTextList(value: unknown) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map(cleanText).filter(Boolean)))
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.floor(parsed)))
}
