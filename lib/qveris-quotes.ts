/**
 * Near-real-time A-share quote overlay.
 *
 * Factor scoring still uses daily OHLCV because it needs a 90d window.
 * The final displayed price/change comes from this batched quote endpoint and is
 * cached for 1 minute so the radar can show post-trigger P/L without making
 * the heavier daily factor layer refresh at the same cadence.
 */
import { call, discover, type QverisTool } from "@/lib/qveris"
import type { StockPoolItem } from "@/lib/stock-pool"

export type LatestQuote = {
  symbol: string
  symbolQveris: string
  latest: number
  changePct: number
  tradeDate: string
  tradeTime: string
  timestamp: string
  preClose?: number
  open?: number
  high?: number
  low?: number
  volume?: number
  amount?: number
}

export type LatestQuotesResult = {
  startedAt: string
  finishedAt: string
  fetchedAt: string
  cacheAgeMs: number
  ttlMs: number
  qverisCount: number
  totalSymbols: number
  toolId?: string
  toolName?: string
  fallbackReason?: string
  quotes: Map<string, LatestQuote>
}

const LEGACY_QUOTE_TOOL_ID = "cn_financial_pro.real_time_quotation.v1"
const HANGSENG_QUOTE_TOOL_ID = "hangseng_polysource.a_shares_live_quote.query.v2.10fe0581"
const QUOTE_CACHE_MS = 60_000
const DISCOVER_CACHE_MS = 30 * 60_000
const DISCOVER_FAIL_CACHE_MS = 30_000
const MAX_QUOTE_CODES_PER_CALL = 10

type DiscoverCache = {
  tool?: QverisTool
  searchId?: string
  error?: string
  cachedAt: number
  ttl: number
}

type QuoteCache = {
  key: string
  symbols: Set<string>
  result: Omit<LatestQuotesResult, "startedAt" | "finishedAt">
  cachedAt: number
}

type FetchLatestQuotesOptions = {
  discoverTimeoutMs?: number
  callTimeoutMs?: number
}

let discoverCache: DiscoverCache | null = null
let quoteCache: QuoteCache | null = null

type AnyRecord = Record<string, unknown>

function normalizeDate(date: string) {
  if (/^\d{8}$/.test(date)) return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
  return date.replace(/\//g, "-").slice(0, 10)
}

function pickString(obj: AnyRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number") return String(value)
  }
}

function pickNumber(obj: AnyRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string") {
      const n = Number(value.replace(/,/g, ""))
      if (Number.isFinite(n)) return n
    }
  }
}

function flattenRows(data: unknown): AnyRecord[] {
  const rows: unknown[] = []

  function visit(value: unknown, depth: number) {
    if (depth > 6 || value == null) return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    if (typeof value !== "object") return

    const obj = value as AnyRecord
    if (
      pickString(obj, ["thscode", "stock_code", "stockCode", "code", "symbol"]) &&
      pickNumber(obj, ["latest", "latest_price", "latestPrice", "price", "close", "最新价"])
    ) {
      rows.push(obj)
      return
    }

    for (const key of ["rows", "items", "list", "data", "result"]) {
      if (key in obj) visit(obj[key], depth + 1)
    }
  }

  visit(data, 0)
  return rows.filter((row): row is AnyRecord => Boolean(row) && typeof row === "object")
}

function chunkPool(pool: StockPoolItem[], size: number) {
  const chunks: StockPoolItem[][] = []
  for (let i = 0; i < pool.length; i += size) chunks.push(pool.slice(i, i + size))
  return chunks
}

function parseQuote(row: AnyRecord): LatestQuote | null {
  const symbolQveris = pickString(row, ["thscode", "stock_code", "stockCode", "code", "symbol", "股票代码"])
  const latest = pickNumber(row, ["latest", "latest_price", "latestPrice", "price", "close", "最新价"])
  if (!symbolQveris || latest == null || latest <= 0) return null

  const tradingTimestamp = pickString(row, ["tradingTimestamp", "timestamp", "交易时间"])
  const rawTradeDate = pickString(row, ["tradeDate", "date", "交易日期"]) ?? tradingTimestamp
  if (!rawTradeDate) return null
  const tradeDate = normalizeDate(rawTradeDate)
  const tradeTime = normalizeTime(pickString(row, ["tradeTime", "time"]) ?? tradingTimestamp)
  const changePct = pickNumber(row, ["changeRatio", "change_pct", "changePCT", "pct_chg", "涨跌幅"]) ?? 0
  const symbol = symbolQveris.slice(0, 6)

  return {
    symbol,
    symbolQveris,
    latest,
    changePct,
    tradeDate,
    tradeTime,
    timestamp: `${tradeDate} ${tradeTime}`,
    preClose: pickNumber(row, ["preClose", "pre_close", "昨收"]),
    open: pickNumber(row, ["open", "openPrice", "开盘价"]),
    high: pickNumber(row, ["high", "highPrice", "最高价"]),
    low: pickNumber(row, ["low", "lowPrice", "最低价"]),
    volume: pickNumber(row, ["volume", "turnoverVolumeLot", "成交量"]),
    amount: pickNumber(row, ["amount", "turnoverValue", "成交额"]),
  }
}

function normalizeTime(value?: string) {
  if (!value) return "00:00:00"
  const time = value.includes(" ") ? value.split(" ").at(-1) ?? value : value
  const normalized = time.trim().slice(0, 8)
  if (/^\d{2}:\d{2}:\d{2}$/.test(normalized)) return normalized
  if (/^\d{2}:\d{2}$/.test(normalized)) return `${normalized}:00`
  return "00:00:00"
}

async function getOrDiscoverQuoteTool(timeoutMs?: number): Promise<DiscoverCache> {
  if (discoverCache && Date.now() - discoverCache.cachedAt < discoverCache.ttl) {
    return discoverCache
  }

  try {
    const search = await discover("A股实时行情 股票 最新价格 涨跌幅 批量 codes real_time_quotation", undefined, 8, timeoutMs)
    const tool =
      search.results.find((t) => t.tool_id === HANGSENG_QUOTE_TOOL_ID) ??
      search.results.find((t) => t.tool_id === LEGACY_QUOTE_TOOL_ID) ??
      search.results.find((t) => /real[-_ ]?time|实时行情/i.test(`${t.tool_id} ${t.name}`)) ??
      search.results[0]

    discoverCache = tool
      ? { tool, searchId: search.search_id, cachedAt: Date.now(), ttl: DISCOVER_CACHE_MS }
      : { error: "Qveris discover 未返回实时行情工具", cachedAt: Date.now(), ttl: DISCOVER_FAIL_CACHE_MS }
  } catch (err) {
    discoverCache = {
      error: err instanceof Error ? err.message : String(err),
      cachedAt: Date.now(),
      ttl: DISCOVER_FAIL_CACHE_MS,
    }
  }
  return discoverCache
}

function emptyResult(startedAt: string, fallbackReason: string, totalSymbols: number): LatestQuotesResult {
  const now = new Date().toISOString()
  return {
    startedAt,
    finishedAt: now,
    fetchedAt: now,
    cacheAgeMs: 0,
    ttlMs: QUOTE_CACHE_MS,
    qverisCount: 0,
    totalSymbols,
    fallbackReason,
    quotes: new Map(),
  }
}

export async function fetchLatestQuotes(pool: StockPoolItem[], opts: FetchLatestQuotesOptions = {}): Promise<LatestQuotesResult> {
  const startedAt = new Date().toISOString()
  if (!process.env.QVERIS_API_KEY) {
    return emptyResult(startedAt, "QVERIS_API_KEY 未配置，未拉取实时行情", pool.length)
  }

  const key = pool.map((s) => s.symbolQveris).sort().join(",")
  const requestedSymbols = pool.map((s) => s.symbolQveris)
  const canServeFromSuperset =
    quoteCache &&
    Date.now() - quoteCache.cachedAt < quoteCache.result.ttlMs &&
    requestedSymbols.every((symbol) => quoteCache?.symbols.has(symbol))
  if (quoteCache?.key === key && Date.now() - quoteCache.cachedAt < quoteCache.result.ttlMs) {
    const cacheAgeMs = Date.now() - quoteCache.cachedAt
    return {
      ...quoteCache.result,
      startedAt,
      finishedAt: new Date().toISOString(),
      cacheAgeMs,
    }
  }
  if (canServeFromSuperset && quoteCache) {
    const quotes = new Map<string, LatestQuote>()
    for (const stock of pool) {
      const quote = quoteCache.result.quotes.get(stock.symbol)
      if (quote) quotes.set(stock.symbol, quote)
    }
    const cacheAgeMs = Date.now() - quoteCache.cachedAt
    return {
      ...quoteCache.result,
      startedAt,
      finishedAt: new Date().toISOString(),
      cacheAgeMs,
      qverisCount: quotes.size,
      totalSymbols: pool.length,
      quotes,
    }
  }

  const discovered = await getOrDiscoverQuoteTool(opts.discoverTimeoutMs)
  if (!discovered.tool || !discovered.searchId) {
    return emptyResult(
      startedAt,
      `Qveris 实时行情 discover 失败：${discovered.error ?? "无可用工具"}`,
      pool.length,
    )
  }

  try {
    const quotes = new Map<string, LatestQuote>()
    const errors: string[] = []
    const chunks = chunkPool(pool, MAX_QUOTE_CODES_PER_CALL)
    const batches = await Promise.all(
      chunks.map(async (chunk, index) => {
        try {
          const parameters = quoteParameters(discovered.tool!.tool_id, chunk)
          const res = await call<unknown>(
            discovered.tool!.tool_id,
            discovered.searchId!,
            parameters,
            undefined,
            50_000,
            opts.callTimeoutMs ?? 50_000,
            {
              source: "realtime-quotes",
              category: "realtime_quote",
              symbols: chunk.map((stock) => stock.symbolQveris),
              symbolCount: chunk.length,
              note: "batched A-share quote overlay",
            },
          )
          return { index, res }
        } catch (err) {
          return {
            index,
            error: err instanceof Error ? err.message : String(err),
          }
        }
      }),
    )

    for (const batch of batches) {
      if ("error" in batch) {
        errors.push(`批次 ${batch.index + 1}: ${batch.error}`)
        continue
      }
      if (!batch.res.success) {
        errors.push(`批次 ${batch.index + 1}: ${batch.res.error_message ?? "调用失败"}`)
        continue
      }
      for (const row of flattenRows(batch.res.result?.data)) {
        const quote = parseQuote(row)
        if (quote) quotes.set(quote.symbol, quote)
      }
    }

    if (quotes.size === 0 && errors.length > 0) {
      return emptyResult(startedAt, `Qveris 实时行情调用失败：${errors.slice(0, 2).join("；")}`, pool.length)
    }

    const finishedAt = new Date().toISOString()
    const result: Omit<LatestQuotesResult, "startedAt" | "finishedAt"> = {
      fetchedAt: finishedAt,
      cacheAgeMs: 0,
      ttlMs: QUOTE_CACHE_MS,
      qverisCount: quotes.size,
      totalSymbols: pool.length,
      toolId: discovered.tool.tool_id,
      toolName: discovered.tool.name,
      fallbackReason: errors.length
        ? `部分实时行情失败：${errors.slice(0, 2).join("；")}`
        : quotes.size === 0
          ? "Qveris 实时行情返回为空或不可解析"
          : undefined,
      quotes,
    }
    quoteCache = { key, symbols: new Set(requestedSymbols), result, cachedAt: Date.now() }

    return { ...result, startedAt, finishedAt }
  } catch (err) {
    return emptyResult(
      startedAt,
      `Qveris 实时行情调用异常：${err instanceof Error ? err.message : String(err)}`,
      pool.length,
    )
  }
}

function quoteParameters(toolId: string, chunk: StockPoolItem[]): Record<string, unknown> {
  if (toolId === HANGSENG_QUOTE_TOOL_ID) {
    return {
      stockObject: chunk.map((stock) => stock.symbolQveris),
      pageNo: 1,
      pageSize: chunk.length,
    }
  }

  return {
    codes: chunk.map((stock) => stock.symbolQveris).join(","),
    indicators: "common",
  }
}
