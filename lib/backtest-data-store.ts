import { findStock, STOCK_POOL } from "@/lib/stock-pool"
import { getLatestCompletedChinaTradeDate } from "@/lib/cn-market-session"
import type { Bar, StockBars } from "@/lib/qveris-data"
import type { JSONValue, Sql } from "postgres"

const STORE_VERSION = "v1"
const KEY_PREFIX = `stock-radar:backtest-bars:${STORE_VERSION}`
const MANIFEST_KEY = `${KEY_PREFIX}:manifest`
const DEFAULT_TTL_SECONDS = 60 * 60 * 24
const SNAPSHOT_TIMEOUT_MS = 20_000
const DERIVED_FACTOR_IDS = [
  "f-mom-60d",
  "f-rev-5d",
  "f-vol-spike",
  "f-donchian-55",
  "f-atr-compression",
  "f-minervini-trend",
  "f-canslim-proxy",
  "f-absolute-momentum",
  "f-low-vol-mom",
  "f-rsi2-reversal",
  "f-bollinger-revert",
  "f-intra-vwap",
  "f-overnight",
  "f-margin-spike",
  "f-ai-breakout",
]

const MARKET_DATA_TABLES = [
  "stock_daily_bars",
  "stock_daily_indicators",
  "factor_values",
  "factor_recipes",
  "data_quality_snapshots",
  "stock_non_price_factors",
  "stock_events",
  "stock_fundamentals",
  "trading_calendar",
  "market_index_bars",
]

export type BacktestDataCacheRecord = {
  key: string
  symbol: string
  name: string
  lookbackDays: number
  bars: number
  latestDate: string
  cachedAt: string
  expiresAt: string
  source: "qveris" | "database"
}

export type BacktestDataStoreSnapshot = {
  driver: "postgres" | "redis" | "memory"
  configured: boolean
  status: "ready" | "fallback" | "error"
  records: BacktestDataCacheRecord[]
  totalBars: number
  totalSymbols: number
  stockPoolSymbols?: number
  marketData?: BacktestMarketDataCoverage
  lastUpdatedAt?: string
  error?: string
}

export type MarketDataFieldCoverage = {
  amountPct: number
  turnoverPct: number
  adjustmentPct: number
  limitBandPct: number
  suspensionFlagPct: number
  calendarPct: number
  indexPct: number
  indicatorPct: number
  factorPct: number
}

export type MarketDataAnomalySample = {
  symbol: string
  name: string
  tradeDate: string
  issue: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  changePct?: number
}

export type MarketDataSymbolStatus = {
  symbol: string
  name: string
  industry: string
  bars: number
  latestDate?: string
  staleDays: number
}

export type MarketDataQualitySnapshot = {
  status: "ready" | "fallback" | "error"
  checkedAt: string
  targetUniverseSize: number
  stockPoolSymbols: number
  coveredStockPoolSymbols: number
  stockPoolCoveragePct: number
  barRows: number
  latestDate?: string
  earliestDate?: string
  fieldCoverage: MarketDataFieldCoverage
  missingSymbols: Array<{ symbol: string; name: string; industry: string }>
  staleSymbols: MarketDataSymbolStatus[]
  shortHistorySymbols: MarketDataSymbolStatus[]
  anomalyRows: number
  anomalySamples: MarketDataAnomalySample[]
  dailySnapshot?: {
    latestSnapshotDate?: string
    generatedAt?: string
    snapshotRows: number
  }
  tradingCalendar?: {
    rows: number
    openRows: number
    latestDate?: string
    coveragePct: number
  }
  indexes?: {
    rows: number
    symbols: number
    latestDate?: string
    coveragePct: number
  }
  limitRules?: {
    limitRows: number
    suspensionRows: number
    limitPct: number
    suspensionPct: number
  }
  notes: string[]
  error?: string
}

export type BacktestMarketDataCoverage = {
  barRows: number
  indicatorRows: number
  factorRows: number
  calendarRows: number
  indexRows: number
  limitRows: number
  suspensionRows: number
  symbols: number
  earliestDate?: string
  latestDate?: string
  latestCalendarDate?: string
  latestIndexDate?: string
  lastFetchedAt?: string
}

export type MarketIndexQuoteInput = {
  code: string
  codeQveris?: string
  name: string
  value: number | null
  changePct: number | null
  tradeDate?: string
  tradeTime?: string
}

export type MarketIndexBarInput = {
  indexCode: string
  name: string
  date: string
  open?: number | null
  high?: number | null
  low?: number | null
  close: number
  volume?: number | null
  amount?: number | null
  changePct?: number | null
}

export type FactorRecipeInput = {
  factorId: string
  version?: string
  factorName: string
  category?: string
  formula: string
  implementation: string
  status: "real" | "proxy" | "missing"
  source?: string
  strategyId?: string
  strategyName?: string
  timeframe?: string
  requiredFields?: string[]
  sourceIds?: string[]
  dsl?: Record<string, unknown>
  binding?: Record<string, unknown>
}

export type FactorValueInput = {
  factorId: string
  symbol: string
  asOf: string
  value: number
  source?: string
}

type StoredStockBars = {
  record: BacktestDataCacheRecord
  stock: StockBars
}

type MemoryStore = {
  values: Map<string, string>
}

declare global {
  var __stockRadarBacktestDataStore: MemoryStore | undefined
}

let postgresClient: Sql | null = null
let postgresTableReady = false
let postgresMarketDataReady = false

function memoryStore() {
  globalThis.__stockRadarBacktestDataStore ??= { values: new Map() }
  return globalThis.__stockRadarBacktestDataStore
}

function redisConfig() {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return { url, token }
}

function postgresConfig() {
  const url =
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.SUPABASE_DB_URL ??
    process.env.NEON_DATABASE_URL
  if (!url) return null
  return { url }
}

export function getBacktestDataStoreDriver() {
  if (postgresConfig()) return "postgres" as const
  return redisConfig() ? "redis" as const : "memory" as const
}

export function hasSharedPostgresConfig() {
  return Boolean(postgresConfig())
}

export async function getSharedPostgresClient() {
  return getPostgresClient()
}

export async function readSharedCache(key: string) {
  try {
    return await storeGet(key)
  } catch {
    return null
  }
}

export async function writeSharedCache(key: string, value: string, ttlSeconds = DEFAULT_TTL_SECONDS) {
  try {
    await storeSet(key, value, ttlSeconds)
    return true
  } catch {
    return false
  }
}

export async function loadStockBarsFromStore(symbol: string, lookbackDays: number): Promise<StockBars | null> {
  const marketData = await loadStockBarsFromMarketData(symbol, lookbackDays)
  if (marketData) return marketData

  const key = stockKey(symbol, lookbackDays)
  const raw = await storeGet(key)
  if (!raw) return null
  const parsed = parseStoredStock(raw)
  if (!parsed) return null
  if (new Date(parsed.record.expiresAt).getTime() <= Date.now()) {
    await storeDelete(key)
    await removeManifestRecord(key)
    return null
  }
  if (parsed.stock.bars.length < Math.min(lookbackDays, 30)) return null
  return {
    ...parsed.stock,
    bars: parsed.stock.bars.slice(-lookbackDays),
    source: "database",
  }
}

export async function loadStockBarsBatchFromStore(
  pool: Array<{ symbol: string; name: string; industry: string }>,
  lookbackDays: number,
): Promise<Map<string, StockBars>> {
  if (postgresConfig()) return loadStockBarsBatchFromMarketData(pool, lookbackDays)

  const entries = await Promise.all(
    pool.map(async (stock) => [stock.symbol, await loadStockBarsFromStore(stock.symbol, lookbackDays)] as const),
  )
  return new Map(entries.filter((entry): entry is readonly [string, StockBars] => Boolean(entry[1])))
}

export async function saveStockBarsToStore(stock: StockBars, lookbackDays: number, ttlSeconds = DEFAULT_TTL_SECONDS) {
  if (stock.source !== "qveris" && stock.source !== "database") return
  if (stock.bars.length === 0) return

  if (postgresConfig()) {
    await saveStockBarsToMarketData(stock)
    return
  }

  if (stock.bars.length < 30) return

  const key = stockKey(stock.symbol, lookbackDays)
  const now = new Date()
  const expires = new Date(now.getTime() + ttlSeconds * 1000)
  const bars = stock.bars.slice(-lookbackDays)
  const record: BacktestDataCacheRecord = {
    key,
    symbol: stock.symbol,
    name: stock.name,
    lookbackDays,
    bars: bars.length,
    latestDate: bars[bars.length - 1]?.date ?? "",
    cachedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    source: "qveris",
  }
  const payload: StoredStockBars = {
    record,
    stock: {
      ...stock,
      bars,
      source: "qveris",
    },
  }

  await storeSet(key, JSON.stringify(payload), ttlSeconds)
  await upsertManifestRecord(record)
  await saveStockBarsToMarketData(stock)
}

export async function saveStockBarsBatchToStore(stocks: StockBars[], lookbackDays: number, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const valid = stocks.filter((stock) => (stock.source === "qveris" || stock.source === "database") && stock.bars.length > 0)
  if (!valid.length) return

  if (postgresConfig()) {
    await saveStockBarsBatchToMarketData(valid)
    return
  }

  for (const stock of valid) {
    await saveStockBarsToStore(stock, lookbackDays, ttlSeconds)
  }
}

export async function saveMarketIndexQuotesToStore(
  quotes: MarketIndexQuoteInput[],
  meta: { toolId?: string; source?: string } = {},
) {
  const valid = quotes.filter((quote) => quote.value != null && Number.isFinite(quote.value))
  if (!postgresConfig() || !valid.length) return
  await ensurePostgresMarketDataTables()
  const sql = await getPostgresClient()
  const rows = valid.map((quote) => ({
    index_code: quote.codeQveris ?? quote.code,
    trade_date: quote.tradeDate ?? todayInChina(),
    name: quote.name,
    open: nullableNumber(quote.value),
    high: nullableNumber(quote.value),
    low: nullableNumber(quote.value),
    close: nullableNumber(quote.value),
    volume: null as number | null,
    amount: null as number | null,
    change_pct: nullableNumber(quote.changePct),
    source: meta.source ?? "qveris-realtime",
    tool_id: meta.toolId ?? null,
  }))

  for (const chunk of chunks(rows, 100)) {
    await sql`
      insert into market_index_bars ${sql(
        chunk,
        "index_code",
        "trade_date",
        "name",
        "open",
        "high",
        "low",
        "close",
        "volume",
        "amount",
        "change_pct",
        "source",
        "tool_id",
      )}
      on conflict (index_code, trade_date) do update set
        name = excluded.name,
        open = excluded.open,
        high = excluded.high,
        low = excluded.low,
        close = excluded.close,
        volume = excluded.volume,
        amount = excluded.amount,
        change_pct = excluded.change_pct,
        source = excluded.source,
        tool_id = excluded.tool_id,
        fetched_at = now()
    `
  }
}

export async function saveMarketIndexBarsToStore(
  bars: MarketIndexBarInput[],
  meta: { toolId?: string; source?: string } = {},
) {
  const valid = bars.filter((bar) => Number.isFinite(bar.close) && Boolean(bar.date))
  if (!postgresConfig() || !valid.length) return
  await ensurePostgresMarketDataTables()
  const sql = await getPostgresClient()
  const rows = valid.map((bar) => ({
    index_code: bar.indexCode,
    trade_date: bar.date,
    name: bar.name,
    open: nullableNumber(bar.open ?? bar.close),
    high: nullableNumber(bar.high ?? bar.close),
    low: nullableNumber(bar.low ?? bar.close),
    close: nullableNumber(bar.close),
    volume: nullableNumber(bar.volume),
    amount: nullableNumber(bar.amount),
    change_pct: nullableNumber(bar.changePct),
    source: meta.source ?? "qveris-daily",
    tool_id: meta.toolId ?? null,
  }))

  for (const chunk of chunks(rows, 250)) {
    await sql`
      insert into market_index_bars ${sql(
        chunk,
        "index_code",
        "trade_date",
        "name",
        "open",
        "high",
        "low",
        "close",
        "volume",
        "amount",
        "change_pct",
        "source",
        "tool_id",
      )}
      on conflict (index_code, trade_date) do update set
        name = excluded.name,
        open = excluded.open,
        high = excluded.high,
        low = excluded.low,
        close = excluded.close,
        volume = excluded.volume,
        amount = excluded.amount,
        change_pct = excluded.change_pct,
        source = excluded.source,
        tool_id = excluded.tool_id,
        fetched_at = now()
    `
  }
}

export function factorValueStoreKey(factorId: string, symbol: string, asOf: string) {
  return `${factorId}|${symbol}|${asOf}`
}

export async function saveFactorRecipesToStore(recipes: FactorRecipeInput[]) {
  const valid = recipes.filter((recipe) => recipe.factorId && recipe.factorName && recipe.formula)
  if (!postgresConfig() || !valid.length) return { saved: 0, configured: Boolean(postgresConfig()) }
  await ensurePostgresMarketDataTables()
  const sql = await getPostgresClient()
  const rows = valid.map((recipe) => ({
    factor_id: recipe.factorId,
    version: recipe.version ?? "v1",
    factor_name: recipe.factorName,
    category: recipe.category ?? null,
    formula: recipe.formula,
    implementation: recipe.implementation,
    status: recipe.status,
    source: recipe.source ?? "strategy-lab",
    strategy_id: recipe.strategyId ?? null,
    strategy_name: recipe.strategyName ?? null,
    timeframe: recipe.timeframe ?? null,
    required_fields: recipe.requiredFields ?? [],
    source_ids: recipe.sourceIds ?? [],
    dsl: toJsonValue(recipe.dsl ?? {}),
    binding: toJsonValue(recipe.binding ?? {}),
  }))

  for (const chunk of chunks(rows, 250)) {
    await sql`
      insert into factor_recipes ${sql(
        chunk,
        "factor_id",
        "version",
        "factor_name",
        "category",
        "formula",
        "implementation",
        "status",
        "source",
        "strategy_id",
        "strategy_name",
        "timeframe",
        "required_fields",
        "source_ids",
        "dsl",
        "binding",
      )}
      on conflict (factor_id, version) do update set
        factor_name = excluded.factor_name,
        category = excluded.category,
        formula = excluded.formula,
        implementation = excluded.implementation,
        status = excluded.status,
        source = excluded.source,
        strategy_id = excluded.strategy_id,
        strategy_name = excluded.strategy_name,
        timeframe = excluded.timeframe,
        required_fields = excluded.required_fields,
        source_ids = excluded.source_ids,
        dsl = excluded.dsl,
        binding = excluded.binding,
        updated_at = now()
    `
  }
  return { saved: valid.length, configured: true }
}

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JSONValue
}

export async function saveFactorValuesToStore(values: FactorValueInput[]) {
  const valid = values.filter((value) => (
    value.factorId &&
    value.symbol &&
    value.asOf &&
    Number.isFinite(value.value)
  ))
  if (!postgresConfig() || !valid.length) return { saved: 0, configured: Boolean(postgresConfig()) }
  await ensurePostgresMarketDataTables()
  const sql = await getPostgresClient()
  const rows = valid.map((value) => ({
    factor_id: value.factorId,
    symbol: value.symbol,
    as_of: value.asOf,
    value: round6(value.value),
    source: value.source ?? "strategy-lab-kline",
  }))

  for (const chunk of chunks(rows, 3000)) {
    await sql`
      insert into factor_values ${sql(chunk, "factor_id", "symbol", "as_of", "value", "source")}
      on conflict (factor_id, symbol, as_of) do update set
        value = excluded.value,
        source = excluded.source,
        updated_at = now()
    `
  }
  return { saved: valid.length, configured: true }
}

export async function loadFactorValuesFromStore(
  factorIds: string[],
  symbols: string[],
  dates: string[],
) {
  const lookup = new Map<string, number>()
  const cleanFactorIds = Array.from(new Set(factorIds.filter(Boolean)))
  const cleanSymbols = Array.from(new Set(symbols.filter(Boolean)))
  const cleanDates = Array.from(new Set(dates.filter(Boolean)))
  if (!postgresConfig() || !cleanFactorIds.length || !cleanSymbols.length || !cleanDates.length) return lookup

  await ensurePostgresMarketDataTables()
  const sql = await getPostgresClient()
  const rows = await sql<Array<{ factor_id: string; symbol: string; as_of: string | Date; value: number | string }>>`
    select factor_id, symbol, as_of, value
    from factor_values
    where factor_id = any(${cleanFactorIds})
      and symbol = any(${cleanSymbols})
      and as_of::text = any(${cleanDates})
  `
  for (const row of rows) {
    const asOf = formatSqlDate(row.as_of)
    const value = toNumber(row.value)
    if (!asOf || value == null || !Number.isFinite(value)) continue
    lookup.set(factorValueStoreKey(row.factor_id, row.symbol, asOf), value)
  }
  return lookup
}

export async function getBacktestDataStoreSnapshot(): Promise<BacktestDataStoreSnapshot> {
  const driver = getBacktestDataStoreDriver()
  try {
    const recordsPromise = driver === "postgres"
      ? withTimeout(loadManifestRecords(), [], SNAPSHOT_TIMEOUT_MS)
      : await loadManifestRecords()
    const marketDataPromise = driver === "postgres"
      ? withTimeout(getMarketDataCoverage().catch((error) => {
        console.error("[backtest-data] market coverage failed", error)
        return undefined
      }), undefined, SNAPSHOT_TIMEOUT_MS)
      : Promise.resolve(undefined)
    const [records, marketData] = await Promise.all([recordsPromise, marketDataPromise])
    const active = records
      .filter((record) => new Date(record.expiresAt).getTime() > Date.now())
      .sort((a, b) => b.cachedAt.localeCompare(a.cachedAt))
    const stale = records.length !== active.length
    if (stale) await saveManifestRecords(active)
    return {
      driver,
      configured: driver !== "memory",
      status: driver === "memory" ? "fallback" : "ready",
      records: active,
      totalBars: marketData?.barRows ?? active.reduce((sum, record) => sum + record.bars, 0),
      totalSymbols: marketData?.symbols ?? new Set(active.map((record) => record.symbol)).size,
      stockPoolSymbols: STOCK_POOL.length,
      marketData,
      lastUpdatedAt: marketData?.lastFetchedAt ?? active[0]?.cachedAt,
    }
  } catch (error) {
    return {
      driver,
      configured: driver === "redis",
      status: "error",
      records: [],
      totalBars: 0,
      totalSymbols: 0,
      stockPoolSymbols: STOCK_POOL.length,
      error: error instanceof Error ? error.message : "回测数据存储读取失败",
    }
  }
}

export async function getMarketDataQualitySnapshot(): Promise<MarketDataQualitySnapshot> {
  const checkedAt = new Date().toISOString()
  const stockPoolSymbols = STOCK_POOL.length
  const targetUniverseSize = Math.max(500, stockPoolSymbols)
  const notes: string[] = []

  if (!postgresConfig()) {
    return {
      status: "fallback",
      checkedAt,
      targetUniverseSize,
      stockPoolSymbols,
      coveredStockPoolSymbols: 0,
      stockPoolCoveragePct: 0,
      barRows: 0,
      fieldCoverage: emptyFieldCoverage(),
      missingSymbols: STOCK_POOL.slice(0, 20).map(({ symbol, name, industry }) => ({ symbol, name, industry })),
      staleSymbols: [],
      shortHistorySymbols: [],
      anomalyRows: 0,
      anomalySamples: [],
      notes: ["未配置 Postgres/Supabase，无法做跨请求数据质量审计。"],
    }
  }

  try {
    await ensurePostgresMarketDataTables()
    const sql = await getPostgresClient()
    const symbols = STOCK_POOL.map((stock) => stock.symbol)
    const symbolRows = await sql<QualitySymbolRow[]>`
      select symbol, count(*)::int as bars, max(trade_date) as latest_date
      from stock_daily_bars
      where symbol = any(${symbols})
      group by symbol
    `
    const fieldRows = await sql<QualityFieldRow[]>`
      with bars as (
        select count(*)::int as bar_rows,
               count(amount)::int as amount_rows,
               count(turnover_ratio)::int as turnover_rows,
               count(adjustment_factor)::int as adjustment_rows,
               count(*) filter (where limit_up is not null and limit_down is not null)::int as limit_rows,
               count(*) filter (where is_suspended is not null)::int as suspension_checked_rows,
               count(*) filter (where is_suspended)::int as suspended_rows,
               min(trade_date) as earliest_date,
               max(trade_date) as latest_date,
               count(*) filter (
                 where open <= 0 or high <= 0 or low <= 0 or close <= 0 or volume < 0
                   or high < greatest(open, close, low)
                   or low > least(open, close, high)
                   or abs(coalesce(change_pct, 0)) > 30
               )::int as anomaly_rows
        from stock_daily_bars
        where symbol = any(${symbols})
      ),
      calendar as (
        select count(*)::int as calendar_rows,
               count(*) filter (where is_open)::int as open_rows,
               max(trade_date) as calendar_latest_date
        from trading_calendar
      ),
      indexes as (
        select count(*)::int as index_rows,
               count(distinct index_code)::int as index_symbols,
               max(trade_date) as index_latest_date
        from market_index_bars
      )
      select bars.*,
             (select greatest(reltuples, 0)::int from pg_class where oid = 'stock_daily_indicators'::regclass) as indicator_rows,
             (select greatest(reltuples, 0)::int from pg_class where oid = 'factor_values'::regclass) as factor_rows,
             calendar.calendar_rows,
             calendar.open_rows,
             calendar.calendar_latest_date,
             indexes.index_rows,
             indexes.index_symbols,
             indexes.index_latest_date
      from bars, calendar, indexes
    `

    const field = fieldRows[0]
    const anomalyRows = (field?.anomaly_rows ?? 0) > 0
      ? await sql<QualityAnomalyRow[]>`
        select symbol, trade_date, name, open, high, low, close, volume, change_pct
        from stock_daily_bars
        where symbol = any(${symbols})
          and (
            open <= 0 or high <= 0 or low <= 0 or close <= 0 or volume < 0
            or high < greatest(open, close, low)
            or low > least(open, close, high)
            or abs(coalesce(change_pct, 0)) > 30
          )
        order by trade_date desc, symbol asc
        limit 12
      `
      : []
    const barRows = field?.bar_rows ?? 0
    const covered = new Set(symbolRows.map((row) => row.symbol))
    const latestDate = formatSqlDate(field?.latest_date)
    const latestIndexDate = formatSqlDate(field?.index_latest_date)
    const expectedLatestDate = getLatestCompletedChinaTradeDate() ?? latestDate
    const expectedLatestDateMs = expectedLatestDate ? new Date(`${expectedLatestDate}T00:00:00Z`).getTime() : NaN
    const stockBySymbol = new Map(STOCK_POOL.map((stock) => [stock.symbol, stock]))
    const symbolStatus = symbolRows.map((row) => {
      const stock = stockBySymbol.get(row.symbol)
      const rowLatestDate = formatSqlDate(row.latest_date)
      return {
        symbol: row.symbol,
        name: stock?.name ?? row.symbol,
        industry: stock?.industry ?? "",
        bars: row.bars,
        latestDate: rowLatestDate,
        staleDays: rowLatestDate && Number.isFinite(expectedLatestDateMs)
          ? Math.max(0, Math.round((expectedLatestDateMs - new Date(`${rowLatestDate}T00:00:00Z`).getTime()) / 86_400_000))
          : 999,
      }
    })
    const missingCount = Math.max(0, STOCK_POOL.length - covered.size)
    const missingSymbols = STOCK_POOL
      .filter((stock) => !covered.has(stock.symbol))
      .slice(0, 120)
      .map(({ symbol, name, industry }) => ({ symbol, name, industry }))
    const staleSymbols = symbolStatus
      .filter((stock) => stock.staleDays >= 2)
      .sort((a, b) => b.staleDays - a.staleDays || a.bars - b.bars)
      .slice(0, 120)
    const shortHistorySymbols = symbolStatus
      .filter((stock) => stock.bars < 120 && stock.staleDays < 2)
      .sort((a, b) => a.bars - b.bars)
      .slice(0, 120)

    if (stockPoolSymbols < targetUniverseSize) notes.push(`当前静态股票池 ${stockPoolSymbols} 只，阶段目标 ${targetUniverseSize} 只，需要继续扩容。`)
    if (missingCount > 0) notes.push(`股票池仍有 ${missingCount} 只未写入历史 K 线。`)
    if (latestDate && expectedLatestDate && latestDate < expectedLatestDate) notes.push(`股票日线最新 ${latestDate}，参照日期 ${expectedLatestDate}，需要从 Qveris 刷新滞后数据。`)
    if (staleSymbols.length > 0) notes.push(`有 ${staleSymbols.length} 只股票落后最近已完成交易日，需要从 Qveris 刷新。`)
    if (shortHistorySymbols.length > 0) notes.push(`有 ${shortHistorySymbols.length} 只股票历史样本不足 120 根，多为新股/次新股；不作为补数据缺口。`)
    if ((field?.anomaly_rows ?? 0) > 0) notes.push("检测到 OHLC/涨跌幅异常样本，需要人工复核或重新拉取。")
    if ((field?.calendar_rows ?? 0) === 0) notes.push("交易日历尚未生成，回测会难以区分休市和缺口数据。")
    if ((field?.index_rows ?? 0) === 0) notes.push("指数基准尚未入库，暂时只能用等权股票池作为比较基准。")

    const snapshot: MarketDataQualitySnapshot = {
      status: "ready",
      checkedAt,
      targetUniverseSize,
      stockPoolSymbols,
      coveredStockPoolSymbols: covered.size,
      stockPoolCoveragePct: pct(covered.size, stockPoolSymbols),
      barRows,
      earliestDate: formatSqlDate(field?.earliest_date),
      latestDate,
      fieldCoverage: {
        amountPct: pct(field?.amount_rows ?? 0, barRows),
        turnoverPct: pct(field?.turnover_rows ?? 0, barRows),
        adjustmentPct: pct(field?.adjustment_rows ?? 0, barRows),
        limitBandPct: pct(field?.limit_rows ?? 0, barRows),
        suspensionFlagPct: pct(field?.suspension_checked_rows ?? 0, barRows),
        calendarPct: pct(field?.calendar_rows ?? 0, Math.max(1, distinctCalendarTarget(field?.earliest_date, field?.latest_date))),
        indexPct: pct(field?.index_symbols ?? 0, 4),
        indicatorPct: pct(field?.indicator_rows ?? 0, barRows),
        factorPct: pct(field?.factor_rows ?? 0, barRows * DERIVED_FACTOR_IDS.length),
      },
      missingSymbols,
      staleSymbols,
      shortHistorySymbols,
      anomalyRows: field?.anomaly_rows ?? 0,
      anomalySamples: anomalyRows.map((row) => ({
        symbol: row.symbol,
        name: row.name ?? stockBySymbol.get(row.symbol)?.name ?? row.symbol,
        tradeDate: formatSqlDate(row.trade_date) ?? "",
        issue: anomalyIssue(row),
        open: toNumber(row.open) ?? 0,
        high: toNumber(row.high) ?? 0,
        low: toNumber(row.low) ?? 0,
        close: toNumber(row.close) ?? 0,
        volume: toNumber(row.volume) ?? 0,
        changePct: toNumber(row.change_pct) ?? undefined,
      })),
      tradingCalendar: {
        rows: field?.calendar_rows ?? 0,
        openRows: field?.open_rows ?? 0,
        latestDate: formatSqlDate(field?.calendar_latest_date),
        coveragePct: pct(field?.calendar_rows ?? 0, Math.max(1, distinctCalendarTarget(field?.earliest_date, field?.latest_date))),
      },
      indexes: {
        rows: field?.index_rows ?? 0,
        symbols: field?.index_symbols ?? 0,
        latestDate: latestIndexDate,
        coveragePct: pct(field?.index_symbols ?? 0, 4),
      },
      limitRules: {
        limitRows: field?.limit_rows ?? 0,
        suspensionRows: field?.suspended_rows ?? 0,
        limitPct: pct(field?.limit_rows ?? 0, barRows),
        suspensionPct: pct(field?.suspension_checked_rows ?? 0, barRows),
      },
      notes,
    }
    snapshot.dailySnapshot = await saveMarketDataQualitySnapshot(snapshot).catch(() => undefined)
    return snapshot
  } catch (error) {
    return {
      status: "error",
      checkedAt,
      targetUniverseSize,
      stockPoolSymbols,
      coveredStockPoolSymbols: 0,
      stockPoolCoveragePct: 0,
      barRows: 0,
      fieldCoverage: emptyFieldCoverage(),
      missingSymbols: [],
      staleSymbols: [],
      shortHistorySymbols: [],
      anomalyRows: 0,
      anomalySamples: [],
      notes: ["数据质量审计失败。"],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function withTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => resolve(fallback), timeoutMs)
  })
  return Promise.race([promise.catch(() => fallback), timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId)
  })
}

function stockKey(symbol: string, lookbackDays: number) {
  return `${KEY_PREFIX}:stock:${symbol}:${lookbackDays}`
}

function parseStoredStock(raw: string): StoredStockBars | null {
  try {
    const parsed = JSON.parse(raw) as StoredStockBars
    if (!parsed?.record?.key || !parsed?.stock?.symbol || !Array.isArray(parsed.stock.bars)) return null
    return parsed
  } catch {
    return null
  }
}

async function loadManifestRecords() {
  const raw = await storeGet(MANIFEST_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRecord)
  } catch {
    return []
  }
}

async function saveManifestRecords(records: BacktestDataCacheRecord[]) {
  await storeSet(MANIFEST_KEY, JSON.stringify(records.slice(0, 1000)), DEFAULT_TTL_SECONDS * 14)
}

async function upsertManifestRecord(record: BacktestDataCacheRecord) {
  const records = await loadManifestRecords()
  await saveManifestRecords([record, ...records.filter((item) => item.key !== record.key)])
}

async function removeManifestRecord(key: string) {
  const records = await loadManifestRecords()
  await saveManifestRecords(records.filter((item) => item.key !== key))
}

function isRecord(value: unknown): value is BacktestDataCacheRecord {
  if (!value || typeof value !== "object") return false
  const obj = value as Partial<BacktestDataCacheRecord>
  return typeof obj.key === "string" && typeof obj.symbol === "string" && typeof obj.cachedAt === "string"
}

async function storeGet(key: string) {
  const postgres = postgresConfig()
  if (postgres) return postgresGet(key)
  const redis = redisConfig()
  if (redis) {
    const res = await redisCommand<string | null>(redis, ["GET", key])
    return typeof res === "string" ? res : null
  }
  return memoryStore().values.get(key) ?? null
}

async function storeSet(key: string, value: string, ttlSeconds: number) {
  const postgres = postgresConfig()
  if (postgres) {
    await postgresSet(key, value, ttlSeconds)
    return
  }
  const redis = redisConfig()
  if (redis) {
    await redisCommand(redis, ["SET", key, value, "EX", ttlSeconds])
    return
  }
  memoryStore().values.set(key, value)
}

async function storeDelete(key: string) {
  const postgres = postgresConfig()
  if (postgres) {
    await postgresDelete(key)
    return
  }
  const redis = redisConfig()
  if (redis) {
    await redisCommand(redis, ["DEL", key])
    return
  }
  memoryStore().values.delete(key)
}

type MarketBarRow = {
  symbol: string
  trade_date: string | Date
  name: string | null
  industry: string | null
  open: string | number
  high: string | number
  low: string | number
  close: string | number
  volume: string | number
  amount: string | number | null
  pre_close: string | number | null
  change: string | number | null
  change_pct: string | number | null
  turnover_ratio: string | number | null
  adjustment_factor: string | number | null
  limit_up: string | number | null
  limit_down: string | number | null
  is_limit_up: boolean | null
  is_limit_down: boolean | null
  is_suspended: boolean | null
  source: string
  tool_id: string | null
}

type IndicatorInsertRow = {
  symbol: string
  trade_date: string
  ma5: number | null
  ma10: number | null
  ma20: number | null
  ma60: number | null
  ret1: number | null
  ret5: number | null
  ret20: number | null
  ret60: number | null
  volume_ma20: number | null
  volume_ratio20: number | null
  vwap_proxy: number | null
  atr14: number | null
  volatility20: number | null
  rsi14: number | null
}

type FactorInsertRow = {
  factor_id: string
  symbol: string
  as_of: string
  value: number
  source: string
}

type QualitySymbolRow = {
  symbol: string
  bars: number
  latest_date: string | Date | null
}

type QualityFieldRow = {
  bar_rows: number
  amount_rows: number
  turnover_rows: number
  adjustment_rows: number
  limit_rows: number
  suspension_checked_rows: number
  suspended_rows: number
  anomaly_rows: number
  earliest_date: string | Date | null
  latest_date: string | Date | null
  indicator_rows: number
  factor_rows: number
  calendar_rows: number
  open_rows: number
  calendar_latest_date: string | Date | null
  index_rows: number
  index_symbols: number
  index_latest_date: string | Date | null
}

type QualityAnomalyRow = {
  symbol: string
  trade_date: string | Date
  name: string | null
  open: string | number
  high: string | number
  low: string | number
  close: string | number
  volume: string | number
  change_pct: string | number | null
}

async function loadStockBarsFromMarketData(symbol: string, lookbackDays: number): Promise<StockBars | null> {
  if (!postgresConfig()) return null
  try {
    await ensurePostgresMarketDataTables()
    const sql = await getPostgresClient()
    const rows = await sql<MarketBarRow[]>`
      select symbol, trade_date, name, industry, open, high, low, close, volume, amount,
             pre_close, change, change_pct, turnover_ratio, adjustment_factor,
             limit_up, limit_down, is_limit_up, is_limit_down, is_suspended,
             source, tool_id
      from stock_daily_bars
      where symbol = ${symbol}
      order by trade_date desc
      limit ${lookbackDays}
    `
    if (rows.length < 1) return null
    const ordered = [...rows].reverse()
    const latest = ordered[ordered.length - 1]
    const stock = findStock(symbol)
    return {
      symbol,
      name: latest?.name || stock?.name || symbol,
      industry: latest?.industry || stock?.industry || "",
      bars: ordered.map(rowToBar),
      latestChangePct: toNumber(latest?.change_pct) ?? undefined,
      source: "database",
      toolId: latest?.tool_id ?? undefined,
      toolName: latest?.source === "qveris" ? "Qveris structured daily bars" : "Structured daily bars",
    }
  } catch {
    return null
  }
}

async function loadStockBarsBatchFromMarketData(
  pool: Array<{ symbol: string; name: string; industry: string }>,
  lookbackDays: number,
): Promise<Map<string, StockBars>> {
  const result = new Map<string, StockBars>()
  if (!postgresConfig() || !pool.length) return result

  try {
    await ensurePostgresMarketDataTables()
    const sql = await getPostgresClient()
    const symbols = pool.map((stock) => stock.symbol)
    const rows = await sql<MarketBarRow[]>`
      select symbol, trade_date, name, industry, open, high, low, close, volume, amount,
             pre_close, change, change_pct, turnover_ratio, adjustment_factor,
             limit_up, limit_down, is_limit_up, is_limit_down, is_suspended,
             source, tool_id
      from (
        with requested(symbol) as (
          select unnest(${symbols}::text[])
        )
        select b.symbol,
               b.trade_date,
               null::text as name,
               null::text as industry,
               b.open,
               b.high,
               b.low,
               b.close,
               b.volume,
               b.amount,
               b.pre_close,
               b.change,
               b.change_pct,
               b.turnover_ratio,
               b.adjustment_factor,
               b.limit_up,
               b.limit_down,
               b.is_limit_up,
               b.is_limit_down,
               b.is_suspended,
               null::text as source,
               null::text as tool_id
        from requested r
        join lateral (
          select symbol, trade_date, open, high, low, close, volume, amount,
                 pre_close, change, change_pct, turnover_ratio, adjustment_factor,
                 limit_up, limit_down, is_limit_up, is_limit_down, is_suspended
          from stock_daily_bars
          where symbol = r.symbol
          order by trade_date desc
          limit ${lookbackDays}
        ) b on true
      ) ranked
      order by symbol asc, trade_date asc
    `
    const rowsBySymbol = new Map<string, MarketBarRow[]>()
    for (const row of rows) {
      const existing = rowsBySymbol.get(row.symbol) ?? []
      existing.push(row)
      rowsBySymbol.set(row.symbol, existing)
    }

    const stockBySymbol = new Map(pool.map((stock) => [stock.symbol, stock]))
    for (const [symbol, symbolRows] of rowsBySymbol) {
      if (symbolRows.length < 1) continue
      const latest = symbolRows[symbolRows.length - 1]
      const stock = stockBySymbol.get(symbol) ?? findStock(symbol)
      result.set(symbol, {
        symbol,
        name: latest?.name || stock?.name || symbol,
        industry: latest?.industry || stock?.industry || "",
        bars: symbolRows.map(rowToBar),
        latestChangePct: toNumber(latest?.change_pct) ?? undefined,
        source: "database",
        toolId: latest?.tool_id ?? undefined,
        toolName: latest?.source === "qveris" ? "Qveris structured daily bars" : "Structured daily bars",
      })
    }
  } catch {
    return result
  }

  return result
}

async function ensureMarketDataPerformanceIndexes(sql: Sql) {
  try {
    await sql`
      create index if not exists stock_daily_bars_symbol_trade_date_desc_idx
      on stock_daily_bars (symbol, trade_date desc)
    `
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[backtest-data-store] skip performance index setup: ${message}`)
  }
}

async function saveStockBarsToMarketData(stock: StockBars) {
  await saveStockBarsBatchToMarketData([stock])
}

async function saveStockBarsBatchToMarketData(stocks: StockBars[]) {
  const valid = stocks.filter((stock) => stock.bars.length > 0)
  if (!postgresConfig() || !valid.length) return
  await ensurePostgresMarketDataTables()
  const sql = await getPostgresClient()
  const barRows: Array<{
    symbol: string
    trade_date: string
    name: string
    industry: string
    open: number
    high: number
    low: number
    close: number
    volume: number
    amount: number | null
    pre_close: number | null
    change: number | null
    change_pct: number | null
    turnover_ratio: number | null
    adjustment_factor: number | null
    limit_up: number | null
    limit_down: number | null
    is_limit_up: boolean
    is_limit_down: boolean
    is_suspended: boolean
    source: string
    tool_id: string | null
  }> = []
  const indicatorRows: IndicatorInsertRow[] = []
  const factorRows: FactorInsertRow[] = []
  const calendarDates: string[] = []

  for (const stock of valid) {
    const bars = enrichMarketRuleBars(
      stock.symbol,
      stock.name,
      [...stock.bars].sort((a, b) => a.date.localeCompare(b.date)),
    )
    barRows.push(...bars.map((bar) => ({
      symbol: stock.symbol,
      trade_date: bar.date,
      name: stock.name,
      industry: stock.industry,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      amount: nullableNumber(bar.amount),
      pre_close: nullableNumber(bar.preClose),
      change: nullableNumber(bar.change),
      change_pct: nullableNumber(bar.changePct),
      turnover_ratio: nullableNumber(bar.turnoverRatio),
      adjustment_factor: nullableNumber(bar.adjustmentFactor),
      limit_up: nullableNumber(bar.limitUp),
      limit_down: nullableNumber(bar.limitDown),
      is_limit_up: bar.isLimitUp === true,
      is_limit_down: bar.isLimitDown === true,
      is_suspended: bar.isSuspended === true,
      source: stock.source === "database" ? "qveris" : stock.source,
      tool_id: stock.toolId ?? null,
    })))
    const stockIndicatorRows = computeIndicatorRows(stock.symbol, bars)
    indicatorRows.push(...stockIndicatorRows)
    factorRows.push(...computeFactorRows(stock.symbol, bars, stockIndicatorRows))
    calendarDates.push(...bars.map((bar) => bar.date))
  }

  for (const chunk of chunks(barRows, 1000)) {
    await sql`
      insert into stock_daily_bars ${sql(
        chunk,
        "symbol",
        "trade_date",
        "name",
        "industry",
        "open",
        "high",
        "low",
        "close",
        "volume",
        "amount",
        "pre_close",
        "change",
        "change_pct",
        "turnover_ratio",
        "adjustment_factor",
        "limit_up",
        "limit_down",
        "is_limit_up",
        "is_limit_down",
        "is_suspended",
        "source",
        "tool_id",
      )}
      on conflict (symbol, trade_date) do update set
        name = excluded.name,
        industry = excluded.industry,
        open = excluded.open,
        high = excluded.high,
        low = excluded.low,
        close = excluded.close,
        volume = excluded.volume,
        amount = excluded.amount,
        pre_close = excluded.pre_close,
        change = excluded.change,
        change_pct = excluded.change_pct,
        turnover_ratio = excluded.turnover_ratio,
        adjustment_factor = excluded.adjustment_factor,
        limit_up = excluded.limit_up,
        limit_down = excluded.limit_down,
        is_limit_up = excluded.is_limit_up,
        is_limit_down = excluded.is_limit_down,
        is_suspended = excluded.is_suspended,
        source = excluded.source,
        tool_id = excluded.tool_id,
        fetched_at = now()
    `
  }

  await upsertTradingCalendarForDates(sql, calendarDates).catch((error) => {
    console.warn(`[backtest-data-store] skip trading_calendar upsert: ${errorMessage(error)}`)
  })

  for (const chunk of chunks(indicatorRows, 1500)) {
    await sql`
      insert into stock_daily_indicators ${sql(
        chunk,
        "symbol",
        "trade_date",
        "ma5",
        "ma10",
        "ma20",
        "ma60",
        "ret1",
        "ret5",
        "ret20",
        "ret60",
        "volume_ma20",
        "volume_ratio20",
        "vwap_proxy",
        "atr14",
        "volatility20",
        "rsi14",
      )}
      on conflict (symbol, trade_date) do update set
        ma5 = excluded.ma5,
        ma10 = excluded.ma10,
        ma20 = excluded.ma20,
        ma60 = excluded.ma60,
        ret1 = excluded.ret1,
        ret5 = excluded.ret5,
        ret20 = excluded.ret20,
        ret60 = excluded.ret60,
        volume_ma20 = excluded.volume_ma20,
        volume_ratio20 = excluded.volume_ratio20,
        vwap_proxy = excluded.vwap_proxy,
        atr14 = excluded.atr14,
        volatility20 = excluded.volatility20,
        rsi14 = excluded.rsi14,
        updated_at = now()
    `
  }

  for (const chunk of chunks(factorRows, 3000)) {
    await sql`
      insert into factor_values ${sql(chunk, "factor_id", "symbol", "as_of", "value", "source")}
      on conflict (factor_id, symbol, as_of) do update set
        value = excluded.value,
        source = excluded.source,
        updated_at = now()
    `
  }
}

async function upsertTradingCalendarForDates(sql: Sql, dates: string[]) {
  const uniqueDates = [...new Set(dates.filter(Boolean))]
  if (!uniqueDates.length) return
  await sql`
    insert into trading_calendar (market, trade_date, is_open, source, sample_symbols, updated_at)
    select 'CN-A',
           trade_date,
           true,
           'derived-stock-bars',
           count(distinct symbol)::int,
           now()
    from stock_daily_bars
    where trade_date::text = any(${uniqueDates})
    group by trade_date
    on conflict (market, trade_date) do update set
      is_open = excluded.is_open,
      source = excluded.source,
      sample_symbols = excluded.sample_symbols,
      updated_at = now()
  `
}

function enrichMarketRuleBars(symbol: string, name: string, bars: Bar[]): Bar[] {
  return bars.map((bar, index) => {
    const previousClose = nullableNumber(bar.preClose) ?? nullableNumber(bars[index - 1]?.close)
    const limitBand = dailyLimitBand(symbol, name)
    const limitUp = nullableNumber(bar.limitUp) ?? (previousClose ? roundPrice(previousClose * (1 + limitBand)) : undefined)
    const limitDown = nullableNumber(bar.limitDown) ?? (previousClose ? roundPrice(previousClose * (1 - limitBand)) : undefined)
    const change = nullableNumber(bar.change) ?? (previousClose ? round6(bar.close - previousClose) : undefined)
    const changePct = nullableNumber(bar.changePct) ?? (previousClose ? round6((bar.close / previousClose - 1) * 100) : undefined)
    const isSuspended = bar.isSuspended ?? isSuspendedBar(bar)
    const isLimitUp = bar.isLimitUp ?? (!isSuspended && limitUp != null && bar.close >= limitUp - 0.01)
    const isLimitDown = bar.isLimitDown ?? (!isSuspended && limitDown != null && bar.close <= limitDown + 0.01)

    return {
      ...bar,
      preClose: previousClose ?? bar.preClose,
      change: change ?? bar.change,
      changePct: changePct ?? bar.changePct,
      limitUp,
      limitDown,
      isLimitUp,
      isLimitDown,
      isSuspended,
    }
  })
}

function dailyLimitBand(symbol: string, name: string) {
  if (/\*?ST/i.test(name)) return 0.05
  if (/^(300|301|688|689|8|4)/.test(symbol)) return 0.2
  return 0.1
}

function isSuspendedBar(bar: Bar) {
  const volume = nullableNumber(bar.volume) ?? 0
  const amount = nullableNumber(bar.amount) ?? 0
  return volume <= 0 && amount <= 0 && bar.open === bar.high && bar.high === bar.low && bar.low === bar.close
}

function roundPrice(value: number) {
  return Math.round(value * 100) / 100
}

async function getMarketDataCoverage(): Promise<BacktestMarketDataCoverage> {
  if (!postgresConfig()) {
    return {
      barRows: 0,
      indicatorRows: 0,
      factorRows: 0,
      calendarRows: 0,
      indexRows: 0,
      limitRows: 0,
      suspensionRows: 0,
      symbols: 0,
    }
  }
  await ensurePostgresMarketDataTables()
  const sql = await getPostgresClient()
  const rows = await sql<Array<{
    bar_rows: number
    symbols: number
    limit_rows: number
    suspension_rows: number
    earliest_date: string | Date | null
    latest_date: string | Date | null
    last_fetched_at: string | Date | null
    indicator_rows: number
    factor_rows: number
    calendar_rows: number
    latest_calendar_date: string | Date | null
    index_rows: number
    latest_index_date: string | Date | null
  }>>`
    with bars as (
      select count(*)::int as bar_rows,
             count(distinct symbol)::int as symbols,
             count(*) filter (where limit_up is not null and limit_down is not null)::int as limit_rows,
             count(*) filter (where is_suspended)::int as suspension_rows,
             min(trade_date) as earliest_date,
             max(trade_date) as latest_date,
             max(fetched_at) as last_fetched_at
      from stock_daily_bars
    ),
    calendar as (
      select count(*)::int as calendar_rows,
             max(trade_date) as latest_calendar_date
      from trading_calendar
    ),
    indexes as (
      select count(*)::int as index_rows,
             max(trade_date) as latest_index_date
      from market_index_bars
    )
    select bars.*,
           (select greatest(reltuples, 0)::int from pg_class where oid = 'stock_daily_indicators'::regclass) as indicator_rows,
           (select greatest(reltuples, 0)::int from pg_class where oid = 'factor_values'::regclass) as factor_rows,
           calendar.calendar_rows,
           calendar.latest_calendar_date,
           indexes.index_rows,
           indexes.latest_index_date
    from bars, calendar, indexes
  `
  const row = rows[0]
  return {
    barRows: row?.bar_rows ?? 0,
    indicatorRows: row?.indicator_rows ?? 0,
    factorRows: row?.factor_rows ?? 0,
    calendarRows: row?.calendar_rows ?? 0,
    indexRows: row?.index_rows ?? 0,
    limitRows: row?.limit_rows ?? 0,
    suspensionRows: row?.suspension_rows ?? 0,
    symbols: row?.symbols ?? 0,
    earliestDate: formatSqlDate(row?.earliest_date),
    latestDate: formatSqlDate(row?.latest_date),
    latestCalendarDate: formatSqlDate(row?.latest_calendar_date),
    latestIndexDate: formatSqlDate(row?.latest_index_date),
    lastFetchedAt: formatSqlDateTime(row?.last_fetched_at),
  }
}

async function getPostgresClient() {
  if (postgresClient) return postgresClient
  const config = postgresConfig()
  if (!config) throw new Error("Postgres 连接串未配置")
  const { default: postgres } = await import("postgres")
  postgresClient = postgres(config.url, {
    max: postgresPoolMax(),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    ssl: /localhost|127\.0\.0\.1/.test(config.url) ? false : "require",
  })
  return postgresClient
}

function postgresPoolMax() {
  const raw = Number(process.env.POSTGRES_POOL_MAX ?? process.env.DATABASE_POOL_MAX)
  if (!Number.isFinite(raw) || raw <= 0) return 8
  return Math.max(1, Math.min(Math.floor(raw), 20))
}

async function ensurePostgresTable() {
  if (postgresTableReady) return
  const sql = await getPostgresClient()
  try {
    await sql`select cache_key from stock_radar_cache where false`
    postgresTableReady = true
    return
  } catch (error) {
    if (!isUndefinedTable(error)) throw error
  }

  await sql`
    create table if not exists stock_radar_cache (
      cache_key text primary key,
      value text not null,
      expires_at timestamptz not null,
      updated_at timestamptz not null default now()
    )
  `
  await sql`
    create index if not exists stock_radar_cache_expires_at_idx
    on stock_radar_cache (expires_at)
  `
  await ensureBackendRls(sql, ["stock_radar_cache"])
  postgresTableReady = true
}

async function ensurePostgresMarketDataTables() {
  if (postgresMarketDataReady) return
  const sql = await getPostgresClient()
  try {
    await sql`
      select symbol, limit_up, limit_down, is_limit_up, is_limit_down, is_suspended
      from stock_daily_bars
      where false
    `
    await sql`select symbol from stock_daily_indicators where false`
    await sql`select factor_id from factor_values where false`
    await sql`select factor_id from factor_recipes where false`
    await sql`select snapshot_date from data_quality_snapshots where false`
    await sql`select source_id from stock_non_price_factors where false`
    await sql`select event_id from stock_events where false`
    await sql`select symbol from stock_fundamentals where false`
    await sql`select trade_date from trading_calendar where false`
    await sql`select index_code from market_index_bars where false`
    await ensureMarketDataPerformanceIndexes(sql)
    await ensureBackendRls(sql, MARKET_DATA_TABLES)
    postgresMarketDataReady = true
    return
  } catch (error) {
    if (!isMissingSchemaObject(error)) throw error
  }

  await sql`
    create table if not exists stock_daily_bars (
      symbol text not null,
      trade_date date not null,
      name text,
      industry text,
      open double precision not null,
      high double precision not null,
      low double precision not null,
      close double precision not null,
      volume double precision not null,
      amount double precision,
      pre_close double precision,
      change double precision,
      change_pct double precision,
      turnover_ratio double precision,
      adjustment_factor double precision,
      limit_up double precision,
      limit_down double precision,
      is_limit_up boolean not null default false,
      is_limit_down boolean not null default false,
      is_suspended boolean not null default false,
      source text not null default 'qveris',
      tool_id text,
      fetched_at timestamptz not null default now(),
      primary key (symbol, trade_date)
    )
  `
  await sql`
    create index if not exists stock_daily_bars_trade_date_idx
    on stock_daily_bars (trade_date desc)
  `
  await ensureMarketDataPerformanceIndexes(sql)
  await sql`
    create table if not exists stock_daily_indicators (
      symbol text not null,
      trade_date date not null,
      ma5 double precision,
      ma10 double precision,
      ma20 double precision,
      ma60 double precision,
      ret1 double precision,
      ret5 double precision,
      ret20 double precision,
      ret60 double precision,
      volume_ma20 double precision,
      volume_ratio20 double precision,
      vwap_proxy double precision,
      atr14 double precision,
      volatility20 double precision,
      rsi14 double precision,
      updated_at timestamptz not null default now(),
      primary key (symbol, trade_date)
    )
  `
  await sql`
    create table if not exists factor_values (
      factor_id text not null,
      symbol text not null,
      as_of date not null,
      value double precision not null,
      source text not null default 'qveris-derived',
      updated_at timestamptz not null default now(),
      primary key (factor_id, symbol, as_of)
    )
  `
  await sql`
    create index if not exists factor_values_as_of_idx
    on factor_values (as_of desc, factor_id)
  `
  await sql`
    create table if not exists factor_recipes (
      factor_id text not null,
      version text not null default 'v1',
      factor_name text not null,
      category text,
      formula text not null,
      implementation text not null,
      status text not null default 'real',
      source text not null default 'strategy-lab',
      strategy_id text,
      strategy_name text,
      timeframe text,
      required_fields text[] not null default '{}',
      source_ids text[] not null default '{}',
      dsl jsonb not null default '{}'::jsonb,
      binding jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (factor_id, version)
    )
  `
  await sql`
    create index if not exists factor_recipes_strategy_idx
    on factor_recipes (strategy_id, updated_at desc)
  `
  await sql`
    create table if not exists data_quality_snapshots (
      snapshot_date date primary key,
      generated_at timestamptz not null default now(),
      stock_pool_symbols integer not null,
      covered_symbols integer not null,
      bar_rows integer not null,
      latest_trade_date date,
      field_coverage jsonb not null,
      notes text[] not null default '{}',
      payload jsonb not null
    )
  `
  await sql`
    create table if not exists stock_non_price_factors (
      source_id text not null,
      symbol text not null,
      as_of date not null,
      score double precision,
      payload jsonb not null,
      source text not null default 'qveris',
      fetched_at timestamptz not null default now(),
      primary key (source_id, symbol, as_of)
    )
  `
  await sql`
    create index if not exists stock_non_price_factors_as_of_idx
    on stock_non_price_factors (as_of desc, source_id)
  `
  await sql`
    create table if not exists stock_events (
      event_id text primary key,
      symbol text not null,
      event_time timestamptz not null,
      event_type text not null,
      title text,
      sentiment double precision,
      payload jsonb not null,
      source text not null default 'qveris',
      fetched_at timestamptz not null default now()
    )
  `
  await sql`
    create index if not exists stock_events_symbol_time_idx
    on stock_events (symbol, event_time desc)
  `
  await sql`
    create table if not exists stock_fundamentals (
      symbol text not null,
      report_period date not null,
      payload jsonb not null,
      source text not null default 'qveris',
      fetched_at timestamptz not null default now(),
      primary key (symbol, report_period)
    )
  `
  await ensurePostgresMarketDataMigrations(sql)
  await ensureBackendRls(sql, MARKET_DATA_TABLES)
  postgresMarketDataReady = true
}

export async function ensureBackendRls(sql: Sql, tableNames: string[]) {
  const tableArray = tableNames.map(quoteLiteral).join(", ")
  await sql.unsafe(`
    do $$
    declare
      app_role text;
      table_name text;
      policy_name text;
    begin
      foreach table_name in array array[${tableArray}]
      loop
        if to_regclass(format('public.%I', table_name)) is not null then
          begin
            execute format('alter table public.%I enable row level security', table_name);
          exception
            when insufficient_privilege then null;
          end;
        end if;
      end loop;

      foreach app_role in array array['stock_radar_backend', 'service_role']
      loop
        if exists (select 1 from pg_roles where rolname = app_role) then
          if not has_schema_privilege(app_role, 'public', 'USAGE') then
            begin
              execute format('grant usage on schema public to %I', app_role);
            exception
              when insufficient_privilege then null;
            end;
          end if;

          foreach table_name in array array[${tableArray}]
          loop
            if to_regclass(format('public.%I', table_name)) is not null then
              if not (
                has_table_privilege(app_role, format('public.%I', table_name), 'SELECT') and
                has_table_privilege(app_role, format('public.%I', table_name), 'INSERT') and
                has_table_privilege(app_role, format('public.%I', table_name), 'UPDATE') and
                has_table_privilege(app_role, format('public.%I', table_name), 'DELETE')
              ) then
                begin
                  execute format('grant select, insert, update, delete on table public.%I to %I', table_name, app_role);
                exception
                  when insufficient_privilege then null;
                end;
              end if;

              if app_role = 'stock_radar_backend' then
                policy_name := table_name || '_backend_access';
              else
                policy_name := table_name || '_service_role_all';
              end if;

              if not exists (
                select 1
                from pg_policies
                where schemaname = 'public'
                  and tablename = table_name
                  and policyname = policy_name
              ) then
                begin
                  execute format(
                    'create policy %I on public.%I for all to %I using (true) with check (true)',
                    policy_name,
                    table_name,
                    app_role
                  );
                exception
                  when duplicate_object or insufficient_privilege then null;
                end;
              end if;
            end if;
          end loop;
        end if;
      end loop;
    end $$;
  `)
}

function quoteLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

async function ensurePostgresMarketDataMigrations(sql: Sql) {
  await sql`alter table stock_daily_bars add column if not exists limit_up double precision`
  await sql`alter table stock_daily_bars add column if not exists limit_down double precision`
  await sql`alter table stock_daily_bars add column if not exists is_limit_up boolean not null default false`
  await sql`alter table stock_daily_bars add column if not exists is_limit_down boolean not null default false`
  await sql`alter table stock_daily_bars add column if not exists is_suspended boolean not null default false`
  await sql`
    create index if not exists stock_daily_bars_trade_flags_idx
    on stock_daily_bars (trade_date desc, is_suspended, is_limit_up, is_limit_down)
  `

  await sql`
    create table if not exists trading_calendar (
      market text not null default 'CN-A',
      trade_date date not null,
      is_open boolean not null default true,
      source text not null default 'derived-stock-bars',
      sample_symbols integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (market, trade_date)
    )
  `
  await sql`
    create index if not exists trading_calendar_trade_date_idx
    on trading_calendar (trade_date desc)
  `

  await sql`
    create table if not exists market_index_bars (
      index_code text not null,
      trade_date date not null,
      name text,
      open double precision,
      high double precision,
      low double precision,
      close double precision not null,
      volume double precision,
      amount double precision,
      change_pct double precision,
      source text not null default 'qveris',
      tool_id text,
      fetched_at timestamptz not null default now(),
      primary key (index_code, trade_date)
    )
  `
  await sql`
    create index if not exists market_index_bars_trade_date_idx
    on market_index_bars (trade_date desc)
  `

  await sql`
    create table if not exists factor_recipes (
      factor_id text not null,
      version text not null default 'v1',
      factor_name text not null,
      category text,
      formula text not null,
      implementation text not null,
      status text not null default 'real',
      source text not null default 'strategy-lab',
      strategy_id text,
      strategy_name text,
      timeframe text,
      required_fields text[] not null default '{}',
      source_ids text[] not null default '{}',
      dsl jsonb not null default '{}'::jsonb,
      binding jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (factor_id, version)
    )
  `
  await sql`
    create index if not exists factor_recipes_strategy_idx
    on factor_recipes (strategy_id, updated_at desc)
  `

  const [backfillState, calendarState] = await Promise.all([
    sql<Array<{ needs_backfill: boolean }>>`
      select exists (
        select 1
        from stock_daily_bars
        where pre_close is not null
          and (limit_up is null or limit_down is null)
        limit 1
      ) as needs_backfill
    `,
    sql<Array<{ has_calendar: boolean }>>`
      select exists (select 1 from trading_calendar limit 1) as has_calendar
    `,
  ])

  if (backfillState[0]?.needs_backfill) {
    await sql`
      update stock_daily_bars
      set
        limit_up = round((
          pre_close * case
            when coalesce(name, '') ~* '\\*?ST' then 1.05
            when symbol ~ '^(300|301|688|689|8|4)' then 1.20
            else 1.10
          end
        )::numeric, 2)::double precision,
        limit_down = round((
          pre_close * case
            when coalesce(name, '') ~* '\\*?ST' then 0.95
            when symbol ~ '^(300|301|688|689|8|4)' then 0.80
            else 0.90
          end
        )::numeric, 2)::double precision
      where pre_close is not null
        and (limit_up is null or limit_down is null)
    `
    await sql`
      update stock_daily_bars
      set
        is_suspended = (volume <= 0 and coalesce(amount, 0) <= 0 and open = high and high = low and low = close),
        is_limit_up = (limit_up is not null and close >= limit_up - 0.01 and not (volume <= 0 and coalesce(amount, 0) <= 0 and open = high and high = low and low = close)),
        is_limit_down = (limit_down is not null and close <= limit_down + 0.01 and not (volume <= 0 and coalesce(amount, 0) <= 0 and open = high and high = low and low = close))
      where limit_up is not null or limit_down is not null
    `
  }

  if (!calendarState[0]?.has_calendar) {
    await sql`
      insert into trading_calendar (market, trade_date, is_open, source, sample_symbols, updated_at)
      select 'CN-A',
             trade_date,
             true,
             'derived-stock-bars',
             count(distinct symbol)::int,
             now()
      from stock_daily_bars
      group by trade_date
      on conflict (market, trade_date) do update set
        is_open = excluded.is_open,
        source = excluded.source,
        sample_symbols = excluded.sample_symbols,
        updated_at = now()
    `.catch((error) => {
      console.warn(`[backtest-data-store] skip initial trading_calendar backfill: ${errorMessage(error)}`)
    })
  }
}

async function saveMarketDataQualitySnapshot(snapshot: MarketDataQualitySnapshot) {
  if (!postgresConfig()) return undefined
  const sql = await getPostgresClient()
  const snapshotDate = snapshot.checkedAt.slice(0, 10)
  const payload = {
    status: snapshot.status,
    checkedAt: snapshot.checkedAt,
    targetUniverseSize: snapshot.targetUniverseSize,
    stockPoolSymbols: snapshot.stockPoolSymbols,
    coveredStockPoolSymbols: snapshot.coveredStockPoolSymbols,
    stockPoolCoveragePct: snapshot.stockPoolCoveragePct,
    barRows: snapshot.barRows,
    latestDate: snapshot.latestDate,
    earliestDate: snapshot.earliestDate,
    fieldCoverage: snapshot.fieldCoverage,
    tradingCalendar: snapshot.tradingCalendar,
    indexes: snapshot.indexes,
    limitRules: snapshot.limitRules,
    anomalyRows: snapshot.anomalyRows,
    notes: snapshot.notes,
  }
  await sql`
    insert into data_quality_snapshots (
      snapshot_date,
      generated_at,
      stock_pool_symbols,
      covered_symbols,
      bar_rows,
      latest_trade_date,
      field_coverage,
      notes,
      payload
    )
    values (
      ${snapshotDate},
      now(),
      ${snapshot.stockPoolSymbols},
      ${snapshot.coveredStockPoolSymbols},
      ${snapshot.barRows},
      ${snapshot.latestDate ?? null},
      ${sql.json(snapshot.fieldCoverage)},
      ${snapshot.notes},
      ${sql.json(payload)}
    )
    on conflict (snapshot_date) do update set
      generated_at = now(),
      stock_pool_symbols = excluded.stock_pool_symbols,
      covered_symbols = excluded.covered_symbols,
      bar_rows = excluded.bar_rows,
      latest_trade_date = excluded.latest_trade_date,
      field_coverage = excluded.field_coverage,
      notes = excluded.notes,
      payload = excluded.payload
  `
  const rows = await sql<Array<{ snapshot_rows: number; latest_snapshot_date: string | Date | null; generated_at: string | Date | null }>>`
    select count(*)::int as snapshot_rows,
           max(snapshot_date) as latest_snapshot_date,
           max(generated_at) as generated_at
    from data_quality_snapshots
  `
  return {
    snapshotRows: rows[0]?.snapshot_rows ?? 0,
    latestSnapshotDate: formatSqlDate(rows[0]?.latest_snapshot_date),
    generatedAt: formatSqlDateTime(rows[0]?.generated_at),
  }
}

function isMissingSchemaObject(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error.code === "42P01" || error.code === "42703")
}

function isUndefinedTable(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "42P01"
}

function rowToBar(row: MarketBarRow): Bar {
  return {
    date: formatSqlDate(row.trade_date) ?? "",
    open: toNumber(row.open) ?? 0,
    high: toNumber(row.high) ?? 0,
    low: toNumber(row.low) ?? 0,
    close: toNumber(row.close) ?? 0,
    volume: toNumber(row.volume) ?? 0,
    amount: toNumber(row.amount) ?? undefined,
    preClose: toNumber(row.pre_close) ?? undefined,
    change: toNumber(row.change) ?? undefined,
    changePct: toNumber(row.change_pct) ?? undefined,
    turnoverRatio: toNumber(row.turnover_ratio) ?? undefined,
    adjustmentFactor: toNumber(row.adjustment_factor) ?? undefined,
    limitUp: toNumber(row.limit_up) ?? undefined,
    limitDown: toNumber(row.limit_down) ?? undefined,
    isLimitUp: row.is_limit_up ?? undefined,
    isLimitDown: row.is_limit_down ?? undefined,
    isSuspended: row.is_suspended ?? undefined,
  }
}

function computeIndicatorRows(symbol: string, bars: Bar[]): IndicatorInsertRow[] {
  return bars.map((bar, index) => {
    const volumeMa20 = windowMean(bars, index, 20, "volume")
    const vwapProxy = (bar.high + bar.low + bar.close) / 3
    return {
      symbol,
      trade_date: bar.date,
      ma5: nullableNumber(windowMean(bars, index, 5, "close")),
      ma10: nullableNumber(windowMean(bars, index, 10, "close")),
      ma20: nullableNumber(windowMean(bars, index, 20, "close")),
      ma60: nullableNumber(windowMean(bars, index, 60, "close")),
      ret1: nullableNumber(periodReturn(bars, index, 1)),
      ret5: nullableNumber(periodReturn(bars, index, 5)),
      ret20: nullableNumber(periodReturn(bars, index, 20)),
      ret60: nullableNumber(periodReturn(bars, index, 60)),
      volume_ma20: nullableNumber(volumeMa20),
      volume_ratio20: nullableNumber(volumeMa20 && volumeMa20 > 0 ? bar.volume / volumeMa20 : null),
      vwap_proxy: nullableNumber(vwapProxy),
      atr14: nullableNumber(atr(bars, index, 14)),
      volatility20: nullableNumber(volatility(bars, index, 20)),
      rsi14: nullableNumber(rsi(bars, index, 14)),
    }
  })
}

function computeFactorRows(symbol: string, bars: Bar[], indicators: IndicatorInsertRow[]): FactorInsertRow[] {
  const rows: FactorInsertRow[] = []
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]
    const ind = indicators[i]
    const ret5 = ind.ret5
    const ret60 = ind.ret60
    const volumeRatio = ind.volume_ratio20
    const ma60 = ind.ma60
    const vwap = ind.vwap_proxy
    pushFactor(rows, "f-mom-60d", symbol, bar.date, ret60 != null && ret5 != null ? ret60 - ret5 : null)
    pushFactor(rows, "f-rev-5d", symbol, bar.date, ret5 != null ? -ret5 : null)
    pushFactor(
      rows,
      "f-vol-spike",
      symbol,
      bar.date,
      volumeRatio != null && ma60 != null ? volumeRatio * (bar.close >= ma60 ? 1 : 0.45) : null,
    )
    pushFactor(rows, "f-donchian-55", symbol, bar.date, donchianBreakout(bars, indicators, i, 55))
    pushFactor(rows, "f-atr-compression", symbol, bar.date, atrCompression(bars, indicators, i))
    pushFactor(rows, "f-minervini-trend", symbol, bar.date, minerviniTrendTemplate(bars, i))
    pushFactor(rows, "f-canslim-proxy", symbol, bar.date, canSlimProxy(bars, indicators, i))
    pushFactor(rows, "f-absolute-momentum", symbol, bar.date, absoluteMomentum(bars, i))
    pushFactor(rows, "f-low-vol-mom", symbol, bar.date, lowVolMomentum(bars, indicators, i))
    pushFactor(rows, "f-rsi2-reversal", symbol, bar.date, rsi2Reversal(bars, i))
    pushFactor(rows, "f-bollinger-revert", symbol, bar.date, bollingerReversion(bars, i))
    pushFactor(rows, "f-intra-vwap", symbol, bar.date, vwap && vwap > 0 ? (vwap - bar.close) / vwap : null)
    const prev = bars[i - 1]
    const gap = prev && prev.close > 0 ? bar.open / prev.close - 1 : null
    const intraday = bar.open > 0 ? bar.close / bar.open - 1 : null
    pushFactor(
      rows,
      "f-overnight",
      symbol,
      bar.date,
      gap != null && intraday != null ? -gap * Math.sign(intraday || gap) : null,
    )
    pushFactor(rows, "f-margin-spike", symbol, bar.date, volumeAcceleration(bars, i))
    pushFactor(rows, "f-ai-breakout", symbol, bar.date, breakoutPattern(bars, indicators, i))
  }
  return rows
}

function pushFactor(rows: FactorInsertRow[], factorId: string, symbol: string, asOf: string, value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return
  rows.push({ factor_id: factorId, symbol, as_of: asOf, value: round6(value), source: "qveris-derived" })
}

function windowMean(bars: Bar[], index: number, days: number, key: "close" | "volume") {
  if (index - days + 1 < 0) return null
  let sum = 0
  for (let i = index - days + 1; i <= index; i++) sum += bars[i][key]
  return sum / days
}

function periodReturn(bars: Bar[], index: number, days: number) {
  if (index - days < 0) return null
  const before = bars[index - days].close
  const now = bars[index].close
  return before > 0 ? now / before - 1 : null
}

function atr(bars: Bar[], index: number, days: number) {
  if (index - days + 1 < 0) return null
  let sum = 0
  for (let i = index - days + 1; i <= index; i++) {
    const prevClose = bars[i - 1]?.close ?? bars[i].open
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - prevClose),
      Math.abs(bars[i].low - prevClose),
    )
    sum += tr
  }
  return sum / days
}

function volatility(bars: Bar[], index: number, days: number) {
  if (index - days < 0) return null
  const returns: number[] = []
  for (let i = index - days + 1; i <= index; i++) {
    const ret = periodReturn(bars, i, 1)
    if (ret != null) returns.push(ret)
  }
  if (returns.length < days) return null
  const m = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance = returns.reduce((sum, value) => sum + (value - m) ** 2, 0) / Math.max(1, returns.length - 1)
  return Math.sqrt(variance)
}

function rsi(bars: Bar[], index: number, days: number) {
  if (index - days < 0) return null
  let gains = 0
  let losses = 0
  for (let i = index - days + 1; i <= index; i++) {
    const diff = bars[i].close - bars[i - 1].close
    if (diff >= 0) gains += diff
    else losses -= diff
  }
  if (gains === 0 && losses === 0) return 50
  if (losses === 0) return 100
  const rs = gains / losses
  return 100 - 100 / (1 + rs)
}

function volumeAcceleration(bars: Bar[], index: number) {
  const recent = windowMean(bars, index, 5, "volume")
  const mid = index - 5 >= 0 ? windowMean(bars, index - 5, 5, "volume") : null
  const base = index - 10 >= 0 ? windowMean(bars, index - 10, 10, "volume") : null
  if (!recent || !mid || !base) return null
  return (recent - mid) / base
}

function breakoutPattern(bars: Bar[], indicators: IndicatorInsertRow[], index: number) {
  if (index < 30) return null
  const bar = bars[index]
  const from = Math.max(0, index - 60)
  const priorHigh = Math.max(...bars.slice(from, index).map((item) => item.high))
  const volumeRatio = indicators[index].volume_ratio20
  if (!Number.isFinite(priorHigh) || priorHigh <= 0 || volumeRatio == null) return null
  return bar.close / priorHigh - 1 + Math.max(0, volumeRatio - 1) * 0.08
}

function donchianBreakout(bars: Bar[], indicators: IndicatorInsertRow[], index: number, days: number) {
  if (index - days < 0) return null
  const priorHigh = Math.max(...bars.slice(index - days, index).map((item) => item.high))
  const volumeRatio = indicators[index].volume_ratio20
  if (!Number.isFinite(priorHigh) || priorHigh <= 0) return null
  return bars[index].close / priorHigh - 1 + Math.max(0, (volumeRatio ?? 1) - 1) * 0.04
}

function atrCompression(bars: Bar[], indicators: IndicatorInsertRow[], index: number) {
  const currentAtr = indicators[index].atr14
  const currentClose = bars[index]?.close
  if (currentAtr == null || !currentClose || currentClose <= 0 || index < 60) return null
  const current = currentAtr / currentClose
  const ratios: number[] = []
  for (let i = Math.max(0, index - 120); i <= index; i++) {
    const atrValue = indicators[i]?.atr14
    const close = bars[i]?.close
    if (atrValue != null && close > 0) ratios.push(atrValue / close)
  }
  if (ratios.length < 40) return null
  const ranked = [...ratios].sort((a, b) => a - b)
  const idx = ranked.findIndex((value) => value >= current)
  const percentile = (idx < 0 ? ranked.length - 1 : idx) / Math.max(1, ranked.length - 1)
  return 1 - percentile
}

function minerviniTrendTemplate(bars: Bar[], index: number) {
  if (index < 252) return null
  const bar = bars[index]
  const ma50 = windowMean(bars, index, 50, "close")
  const ma150 = windowMean(bars, index, 150, "close")
  const ma200 = windowMean(bars, index, 200, "close")
  const ma200Prev = windowMean(bars, index - 20, 200, "close")
  const priorYear = bars.slice(index - 252 + 1, index + 1)
  const high252 = Math.max(...priorYear.map((item) => item.high))
  const low252 = Math.min(...priorYear.map((item) => item.low))
  const ret120 = periodReturn(bars, index, 120)
  if (!ma50 || !ma150 || !ma200 || !ma200Prev || !high252 || !low252 || low252 <= 0 || ret120 == null) return null
  const checks = [
    bar.close > ma50,
    ma50 > ma150,
    ma150 > ma200,
    ma200 > ma200Prev,
    bar.close >= high252 * 0.75,
    bar.close >= low252 * 1.3,
    ret120 > 0,
  ]
  return checks.filter(Boolean).length / checks.length + Math.max(0, ret120) * 0.35
}

function canSlimProxy(bars: Bar[], indicators: IndicatorInsertRow[], index: number) {
  if (index < 252) return null
  const bar = bars[index]
  const high252 = Math.max(...bars.slice(index - 252 + 1, index + 1).map((item) => item.high))
  const ret120 = periodReturn(bars, index, 120)
  const ret20 = periodReturn(bars, index, 20)
  const volumeRatio = indicators[index].volume_ratio20
  if (!high252 || high252 <= 0 || ret120 == null || ret20 == null || volumeRatio == null) return null
  return ret120 * 0.55 + Math.max(0, ret20) * 0.2 + Math.max(0, volumeRatio - 1) * 0.08 + (bar.close / high252) * 0.25
}

function absoluteMomentum(bars: Bar[], index: number) {
  const ma120 = windowMean(bars, index, 120, "close")
  const ret120 = periodReturn(bars, index, 120)
  if (!ma120 || ret120 == null) return null
  return bars[index].close >= ma120 && ret120 > 0 ? ret120 : ret120 - 0.35
}

function lowVolMomentum(bars: Bar[], indicators: IndicatorInsertRow[], index: number) {
  const ret120 = periodReturn(bars, index, 120)
  const ret60 = indicators[index].ret60
  const vol20 = indicators[index].volatility20
  const momentum = ret120 ?? ret60
  if (momentum == null || vol20 == null) return null
  return momentum - vol20 * Math.sqrt(252) * 0.35
}

function rsi2Reversal(bars: Bar[], index: number) {
  const value = rsi(bars, index, 2)
  const ma120 = windowMean(bars, index, 120, "close")
  if (value == null || !ma120) return null
  return (100 - value) * (bars[index].close >= ma120 ? 1 : 0.35)
}

function bollingerReversion(bars: Bar[], index: number) {
  if (index < 120) return null
  const ma20 = windowMean(bars, index, 20, "close")
  const ma120 = windowMean(bars, index, 120, "close")
  const std20 = closeStd(bars, index, 20)
  if (!ma20 || !ma120 || !std20 || std20 <= 0) return null
  const lower = ma20 - std20 * 2
  return ((lower - bars[index].close) / std20) * (bars[index].close >= ma120 ? 1 : 0.45)
}

function closeStd(bars: Bar[], index: number, days: number) {
  if (index - days + 1 < 0) return null
  const values = bars.slice(index - days + 1, index + 1).map((bar) => bar.close)
  const m = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - m) ** 2, 0) / Math.max(1, values.length - 1)
  return Math.sqrt(variance)
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size))
  return result
}

function nullableNumber(value: unknown): number | null {
  const number = toNumber(value)
  return number == null || !Number.isFinite(number) ? null : round6(number)
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string" && value.trim()) {
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }
  return null
}

function round6(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000
}

function pct(part: number, total: number) {
  if (!total || total <= 0) return 0
  return Math.round((part / total) * 1000) / 10
}

function distinctCalendarTarget(start: string | Date | null | undefined, end: string | Date | null | undefined) {
  const startDate = formatSqlDate(start)
  const endDate = formatSqlDate(end)
  if (!startDate || !endDate) return 0
  const current = new Date(`${startDate}T00:00:00Z`)
  const last = new Date(`${endDate}T00:00:00Z`)
  if (!Number.isFinite(current.getTime()) || !Number.isFinite(last.getTime()) || current > last) return 0
  let days = 0
  while (current <= last) {
    const weekday = current.getUTCDay()
    if (weekday !== 0 && weekday !== 6) days += 1
    current.setUTCDate(current.getUTCDate() + 1)
  }
  return days
}

function emptyFieldCoverage(): MarketDataFieldCoverage {
  return {
    amountPct: 0,
    turnoverPct: 0,
    adjustmentPct: 0,
    limitBandPct: 0,
    suspensionFlagPct: 0,
    calendarPct: 0,
    indexPct: 0,
    indicatorPct: 0,
    factorPct: 0,
  }
}

function anomalyIssue(row: QualityAnomalyRow) {
  const open = toNumber(row.open) ?? 0
  const high = toNumber(row.high) ?? 0
  const low = toNumber(row.low) ?? 0
  const close = toNumber(row.close) ?? 0
  const volume = toNumber(row.volume) ?? 0
  const changePct = toNumber(row.change_pct) ?? 0
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0) return "价格非正"
  if (volume < 0) return "成交量为负"
  if (high < Math.max(open, close, low)) return "最高价小于 OHLC"
  if (low > Math.min(open, close, high)) return "最低价大于 OHLC"
  if (Math.abs(changePct) > 30) return "涨跌幅超阈值"
  return "未知异常"
}

function formatSqlDate(value: string | Date | null | undefined) {
  if (!value) return undefined
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function formatSqlDateTime(value: string | Date | null | undefined) {
  if (!value) return undefined
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function todayInChina() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${byType.year}-${byType.month}-${byType.day}`
}

async function postgresGet(key: string) {
  await ensurePostgresTable()
  const sql = await getPostgresClient()
  await sql`delete from stock_radar_cache where expires_at <= now()`
  const rows = await sql<{ value: string }[]>`
    select value
    from stock_radar_cache
    where cache_key = ${key}
      and expires_at > now()
    limit 1
  `
  return rows[0]?.value ?? null
}

async function postgresSet(key: string, value: string, ttlSeconds: number) {
  await ensurePostgresTable()
  const sql = await getPostgresClient()
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
  await sql`
    insert into stock_radar_cache (cache_key, value, expires_at, updated_at)
    values (${key}, ${value}, ${expiresAt}, now())
    on conflict (cache_key) do update set
      value = excluded.value,
      expires_at = excluded.expires_at,
      updated_at = now()
  `
}

async function postgresDelete(key: string) {
  await ensurePostgresTable()
  const sql = await getPostgresClient()
  await sql`delete from stock_radar_cache where cache_key = ${key}`
}

async function redisCommand<T>(config: { url: string; token: string }, command: unknown[]): Promise<T> {
  const res = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Redis REST ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = await res.json() as { result?: T; error?: string }
  if (json.error) throw new Error(json.error)
  return json.result as T
}
