/**
 * 拉取 A 股 K 线，优先用 Qveris，失败时降级到 deterministic mock。
 *
 * 设计取舍：
 *  1. Qveris call 是计费的，单股单次拉 90 天 ~ 1 个工具调用。
 *     100+ 股票池默认走数据库缓存，新增股票通过数据层分批预热。
 *  2. Qveris 工具的实际返回结构未知，做防御性解析：
 *     尝试常见字段名 (dates/date, close/Close/收盘价) 而非硬编码。
 *  3. 任何单股失败不阻塞整体流程，对应股票用 mock 数据并标记 source。
 *  4. 全部失败时 UI 仍能显示完整 demo，但顶部明确标"演示数据"。
 *
 * 这是后续因子引擎的唯一数据入口。
 */
import { call, discover, type QverisTool } from "@/lib/qveris"
import { formatChinaDate } from "@/lib/format"
import { STOCK_POOL, type StockPoolItem } from "@/lib/stock-pool"
import { getRuntimeStockPool } from "@/lib/stock-pool-config"
import { loadStockBarsBatchFromStore, saveStockBarsBatchToStore, saveStockBarsToStore } from "@/lib/backtest-data-store"

export type Bar = {
  date: string  // YYYY-MM-DD
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount?: number
  preClose?: number
  change?: number
  changePct?: number
  turnoverRatio?: number
  adjustmentFactor?: number
  limitUp?: number
  limitDown?: number
  isLimitUp?: boolean
  isLimitDown?: boolean
  isSuspended?: boolean
}

export type StockBars = {
  symbol: string
  name: string
  industry: string
  /** 复权后 OHLCV，价格口径接近真实价。UI 直接用 bars 末尾 close 作为现价。 */
  bars: Bar[]
  /** 最新一根 K 线的真实涨跌幅（来自 change_pct，已是百分数）。Mock 数据时按相邻 close 计算。 */
  latestChangePct?: number
  source: "qveris" | "database" | "mock"
  toolId?: string
  toolName?: string
  error?: string
}

export type FetchBarsResult = {
  startedAt: string
  finishedAt: string
  lookbackDays: number
  totalSymbols: number
  qverisCount: number
  databaseCount?: number
  mockCount: number
  fallbackReason?: string
  stocks: StockBars[]
}

// ─────────────────────────────────────────────────────────────
// Mock K 线生成器 — deterministic per-symbol，避免每次刷新都变化
// ─────────────────────────────────────────────────────────────

function hashString(str: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0
  }
  return h
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function generateMockBars(symbol: string, days: number): Bar[] {
  const rng = mulberry32(hashString(symbol))
  // 给每只股一个 baseline 价格区间（按代码哈希分散）
  const basePrice = 30 + (hashString(symbol) % 200)
  // 每只股一个隐含趋势（-0.001 到 +0.0015 日漂移）
  const drift = (rng() - 0.4) * 0.0025
  // 波动率
  const vol = 0.012 + rng() * 0.018

  const bars: Bar[] = []
  let close = basePrice
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    // 跳过周末
    if (d.getDay() === 0 || d.getDay() === 6) continue

    // Box-Muller 近似正态
    const u1 = Math.max(rng(), 1e-9)
    const u2 = rng()
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    const ret = drift + vol * z

    const open = close * (1 + (rng() - 0.5) * 0.005)
    close = close * (1 + ret)
    const high = Math.max(open, close) * (1 + rng() * 0.008)
    const low = Math.min(open, close) * (1 - rng() * 0.008)
    const volume = Math.round(1_000_000 + rng() * 8_000_000 + Math.abs(ret) * 50_000_000)

    bars.push({
      date: d.toISOString().slice(0, 10),
      open: round2(open),
      high: round2(high),
      low: round2(low),
      close: round2(close),
      volume,
    })
  }
  return bars
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function formatDate(d: Date) {
  return formatChinaDate(d)
}

function dateDaysAgo(days: number) {
  return formatChinaDate(new Date(Date.now() - days * 24 * 60 * 60_000))
}

// ─────────────────────────────────────────────────────────────
// Qveris 响应解析 — 工具返回结构未知，尝试多种常见 schema
// ─────────────────────────────────────────────────────────────

type AnyRecord = Record<string, unknown>

type ParsedSeries = {
  bars: Bar[]
  /** 最后一根 K 线的复权因子，用于还原未复权价格 */
  adjustmentFactor?: number
  /** 最后一根 K 线的真实涨跌幅 % */
  changePct?: number
}

function parseQverisBars(data: unknown): ParsedSeries | null {
  if (data == null) return null

  // cn_financial_pro.adjusted_price.v1 返回 [[{...},{...}]] — 单股一个外层数组
  if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
    const inner = data[0] as unknown[]
    return parseRowArray(inner)
  }

  // 尝试 1: data 本身就是数组
  if (Array.isArray(data)) {
    return parseRowArray(data)
  }

  // 尝试 2: { data: [...] } / items / bars / kline 等常见包装
  if (typeof data === "object") {
    const obj = data as AnyRecord
    for (const key of ["data", "items", "bars", "kline", "k_line", "history", "ohlc"]) {
      const arr = obj[key]
      if (Array.isArray(arr)) {
        const parsed = parseRowArray(arr)
        if (parsed && parsed.bars.length >= 10) return parsed
      }
    }
  }

  return null
}

function parseRowArray(arr: unknown[]): ParsedSeries | null {
  const bars = arr.map(toBar).filter((b): b is Bar => b !== null)
  if (bars.length < 10) return null

  // 从最后一行抓 adjustment_factor 和 change_pct 用于 UI 显示
  const lastRow = arr[arr.length - 1]
  let adjustmentFactor: number | undefined
  let changePct: number | undefined
  if (lastRow && typeof lastRow === "object") {
    const r = lastRow as AnyRecord
    const af = pickNumber(r, ["adjustment_factor", "adj_factor", "factor"])
    if (af && af > 0) adjustmentFactor = af
    const cp = pickNumber(r, ["change_pct", "pct_chg", "changePercent", "涨跌幅"])
    if (cp != null) changePct = cp
  }
  return { bars, adjustmentFactor, changePct }
}

function toBar(row: unknown): Bar | null {
  if (!row || typeof row !== "object") return null
  const r = row as AnyRecord
  const date = pickString(r, ["date", "Date", "trade_date", "日期", "time"])
  const open = pickNumber(r, ["open", "Open", "开盘", "开盘价"])
  const high = pickNumber(r, ["high", "High", "最高", "最高价"])
  const low = pickNumber(r, ["low", "Low", "最低", "最低价"])
  const close = pickNumber(r, ["close", "Close", "收盘", "收盘价"])
  const volume = pickNumber(r, ["volume", "Volume", "vol", "成交量"])
  if (!date || open == null || high == null || low == null || close == null) return null
  return {
    date: normalizeDate(date),
    open,
    high,
    low,
    close,
    volume: volume ?? 0,
    amount: pickNumber(r, ["amount", "Amount", "成交额"]) ?? undefined,
    preClose: pickNumber(r, ["pre_close", "preClose", "昨收", "前收盘"]) ?? undefined,
    change: pickNumber(r, ["change", "涨跌额"]) ?? undefined,
    changePct: pickNumber(r, ["change_pct", "changeRatio", "pct_chg", "涨跌幅"]) ?? undefined,
    turnoverRatio: pickNumber(r, ["turnover_ratio", "turnoverRatio", "换手率"]) ?? undefined,
    adjustmentFactor: pickNumber(r, ["adjustment_factor", "ths_af_stock", "adj_factor", "factor"]) ?? undefined,
    limitUp: pickNumber(r, ["limit_up", "limitUp", "up_limit", "涨停价"]) ?? undefined,
    limitDown: pickNumber(r, ["limit_down", "limitDown", "down_limit", "跌停价"]) ?? undefined,
    isLimitUp: pickBoolean(r, ["is_limit_up", "isLimitUp", "涨停"]) ?? undefined,
    isLimitDown: pickBoolean(r, ["is_limit_down", "isLimitDown", "跌停"]) ?? undefined,
    isSuspended: pickBoolean(r, ["is_suspended", "isSuspended", "停牌"]) ?? undefined,
  }
}

function pickString(obj: AnyRecord, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "string") return v
    if (typeof v === "number") return String(v)
  }
  return null
}

function pickNumber(obj: AnyRecord, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "number" && Number.isFinite(v)) return v
    if (typeof v === "string") {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
  }
  return null
}

function pickBoolean(obj: AnyRecord, keys: string[]): boolean | null {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "boolean") return v
    if (typeof v === "number" && Number.isFinite(v)) return v !== 0
    if (typeof v === "string") {
      const normalized = v.trim().toLowerCase()
      if (["true", "1", "yes", "y", "涨停", "跌停", "停牌"].includes(normalized)) return true
      if (["false", "0", "no", "n", "正常"].includes(normalized)) return false
    }
  }
  return null
}

/**
 * Qveris truncated_content 是被截断的 JSON 字符串（形如 `[[{...},{...},{"date":"20...`）。
 * 暴力修复：从末尾往前找最后一个合法的对象闭合 `}`，截到那里再补 `]]`。
 */
function tryParseTruncatedJson(s: string): unknown {
  if (!s.trim().startsWith("[")) return null
  try {
    return JSON.parse(s)
  } catch {
    /* 修复截断 JSON */
  }
  // 找最后一个 "}, "（对象之间分隔）的位置
  const lastObjEnd = s.lastIndexOf("},")
  if (lastObjEnd < 0) return null
  const candidate = s.slice(0, lastObjEnd + 1) + (s.trim().startsWith("[[") ? "]]" : "]")
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

function normalizeDate(s: string): string {
  // 支持 "2024-01-15", "20240115", "2024/01/15"
  const cleaned = s.replace(/[\/]/g, "-")
  if (/^\d{8}$/.test(cleaned)) {
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`
  }
  return cleaned.slice(0, 10)
}

// ─────────────────────────────────────────────────────────────
// 单股拉取 — Qveris 优先，失败降级到 mock
// ─────────────────────────────────────────────────────────────

/**
 * 拉单股 K 线。**复用上层 discover 出来的 tool**，每只股只产生一次 execute 调用。
 *
 * 这避免了每只股都跑一次 discover 把 Qveris 限速 (30/min) 吃光的问题。
 */
async function fetchOneStock(
  stock: StockPoolItem,
  lookbackDays: number,
  tool: QverisTool,
  searchId: string,
): Promise<StockBars> {
  // 用自然日窗口覆盖非交易日，确保能拿到 lookbackDays 根左右的最新日线。
  const endDate = formatDate(new Date())
  const startDate = dateDaysAgo(Math.max(Math.ceil(lookbackDays * 1.7) + 30, 120))

  // cn_financial_pro.adjusted_price.v1 的精确参数（实测确认，多余字段会让工具走截断输出而非 data）
  const params = {
    codes: stock.symbolQveris,
    startdate: startDate,
    enddate: endDate,
    cps: "2", // 2 = 后复权
    interval: "D",
  }

  let errorMsg: string | undefined
  try {
    const res = await call<unknown>(tool.tool_id, searchId, params, undefined, 400_000, undefined, {
      source: "historical-daily-bars",
      category: "daily_bar",
      symbols: [stock.symbolQveris],
      symbolCount: 1,
      note: `${lookbackDays}d adjusted OHLCV`,
    })
    if (!res.success) {
      errorMsg = res.error_message ?? "Qveris execute success=false"
    } else {
      // 数据有三种载体（按优先级）:
      //   (a) res.result.data        — 极少数工具走这里
      //   (b) full_content_file_url  — 大多数 cn_financial_pro 工具走这里 (完整 JSON)
      //   (c) truncated_content      — 截断 JSON 字符串，最后兜底
      let arr: unknown = res.result?.data
      const fileUrl = res.result?.full_content_file_url
      if (!arr && fileUrl) {
        try {
          const fr = await fetch(fileUrl, { cache: "no-store" })
          if (fr.ok) arr = await fr.json()
        } catch {
          /* 落到 truncated_content */
        }
      }
      if (!arr && typeof res.result?.truncated_content === "string") {
        arr = tryParseTruncatedJson(res.result.truncated_content)
      }

      const parsed = parseQverisBars(arr)
      if (parsed && parsed.bars.length > 0) {
        return {
          symbol: stock.symbol,
          name: stock.name,
          industry: stock.industry,
          bars: parsed.bars.slice(-lookbackDays),
          latestChangePct: parsed.changePct,
          source: "qveris",
          toolId: tool.tool_id,
          toolName: tool.name,
        }
      }
      errorMsg = parsed
        ? `仅 ${parsed.bars.length} 根 K 线`
        : `无法解析响应 (data=${typeof res.result?.data}, fileUrl=${fileUrl ? "yes" : "no"})`
    }
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err)
  }

  return {
    symbol: stock.symbol,
    name: stock.name,
    industry: stock.industry,
    bars: generateMockBars(stock.symbol, lookbackDays + 10).slice(-lookbackDays),
    source: "mock",
    toolId: tool.tool_id,
    toolName: tool.name,
    error: errorMsg,
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

async function saveStockBarsWithRetry(stock: StockBars, lookbackDays: number) {
  const maxAttempts = 3
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await saveStockBarsToStore(stock, lookbackDays)
      return
    } catch (error) {
      if (attempt === maxAttempts) throw error
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[qveris-data] save retry ${attempt}/${maxAttempts - 1} for ${stock.symbol}: ${message}`)
      await sleep(1000 * attempt)
    }
  }
}

async function saveStockBarsBatchWithRetry(stocks: StockBars[], lookbackDays: number) {
  if (!stocks.length) return
  const maxAttempts = 2
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await saveStockBarsBatchToStore(stocks, lookbackDays)
      return
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[qveris-data] batch save retry ${attempt}/${maxAttempts} for ${stocks.length} stocks: ${message}`)
      if (attempt === maxAttempts) break
      await sleep(1500 * attempt)
    }
  }

  for (const stock of stocks) {
    await saveStockBarsWithRetry(stock, lookbackDays)
  }
}

// ─── Module-level cache：避免 /search 30/min 限速被反复打爆 ───
// Next dev 下每次刷新都会重跑 fetchPoolBars；如果叠加 /data 页等其它 discover 调用，
// 一分钟内很容易 > 30 次 → 429。同一 tool 一周内基本不变，5 分钟复用足够安全。
const PREFERRED_TOOL_ID = "cn_financial_pro.adjusted_price.v1"
const DISCOVER_CACHE_MS = 5 * 60_000
const DISCOVER_FAIL_CACHE_MS = 30_000 // 失败时短缓存，避免连续 429
const POOL_BARS_CACHE_MS = 5 * 60_000

type DiscoverCache = {
  tool?: QverisTool
  searchId?: string
  error?: string
  cachedAt: number
  ttl: number
}

let discoverCache: DiscoverCache | null = null
let poolBarsCache: { key: string; result: FetchBarsResult; cachedAt: number } | null = null

/** 调试用：直接看 cache 内部状态 */
export function _peekDiscoverCache() {
  if (!discoverCache) return { state: "empty" as const }
  return {
    state: "set" as const,
    ageMs: Date.now() - discoverCache.cachedAt,
    ttlMs: discoverCache.ttl,
    expired: Date.now() - discoverCache.cachedAt >= discoverCache.ttl,
    toolId: discoverCache.tool?.tool_id,
    searchId: discoverCache.searchId,
    error: discoverCache.error,
  }
}

async function getOrDiscoverTool(): Promise<DiscoverCache> {
  if (discoverCache && Date.now() - discoverCache.cachedAt < discoverCache.ttl) {
    return discoverCache
  }
  try {
    const search = await discover(
      "A-share Shanghai Shenzhen stock adjusted OHLC open high low close volume turnover daily 沪深 个股 后复权 日线 历史行情",
      undefined,
      10,
    )
    if (search.results.length === 0) {
      discoverCache = {
        error: "Qveris discover 返回 0 个匹配工具",
        cachedAt: Date.now(),
        ttl: DISCOVER_FAIL_CACHE_MS,
      }
    } else {
      const tool =
        search.results.find((t) => t.tool_id === PREFERRED_TOOL_ID) ??
        search.results.slice().sort((a, b) => (b.stats?.success_rate ?? 0) - (a.stats?.success_rate ?? 0))[0]
      discoverCache = {
        tool,
        searchId: search.search_id,
        cachedAt: Date.now(),
        ttl: DISCOVER_CACHE_MS,
      }
    }
  } catch (err) {
    discoverCache = {
      error: err instanceof Error ? err.message : String(err),
      cachedAt: Date.now(),
      ttl: DISCOVER_FAIL_CACHE_MS,
    }
  }
  return discoverCache
}

/**
 * 拉取股票池所有股票的 K 线。
 * 限速策略：每批 5 个，批间隔 1.5s（远低于 30/min）。
 * 全部用 mock 时不调 Qveris，秒返回（用于演示模式）。
 */
export async function fetchPoolBars(opts: {
  lookbackDays: number
  useReal: boolean
  pool?: StockPoolItem[]
  refresh?: boolean
  databaseOnly?: boolean
}): Promise<FetchBarsResult> {
  const startedAt = new Date().toISOString()
  const pool = opts.pool ?? await getRuntimeStockPool().catch(() => STOCK_POOL)
  const lookbackDays = Math.max(30, Math.min(opts.lookbackDays, 750))
  const cacheKey = `${opts.useReal ? "real" : "mock"}:${opts.databaseOnly ? "database-only" : "fill-missing"}:${lookbackDays}:${pool
    .map((s) => s.symbolQveris)
    .sort()
    .join(",")}`

  if (!opts.refresh && opts.useReal && poolBarsCache?.key === cacheKey && Date.now() - poolBarsCache.cachedAt < POOL_BARS_CACHE_MS) {
    return poolBarsCache.result
  }

  const cachedStocks: StockBars[] = []
  const missingPool: StockPoolItem[] = []
  if (opts.useReal && (!opts.refresh || opts.databaseOnly)) {
    const cached = await loadStockBarsBatchFromStore(pool, lookbackDays)
    for (const stock of pool) {
      const cachedStock = cached.get(stock.symbol)
      if (cachedStock) cachedStocks.push(cachedStock)
      else missingPool.push(stock)
    }
    if (cachedStocks.length === pool.length) {
      const result = {
        startedAt,
        finishedAt: new Date().toISOString(),
        lookbackDays,
        totalSymbols: pool.length,
        qverisCount: cachedStocks.length,
        databaseCount: cachedStocks.length,
        mockCount: 0,
        stocks: cachedStocks,
      }
      poolBarsCache = { key: cacheKey, result, cachedAt: Date.now() }
      return result
    }
  } else {
    missingPool.push(...pool)
  }

  if (opts.useReal && opts.databaseOnly) {
    const missingCount = missingPool.length
    const result = {
      startedAt,
      finishedAt: new Date().toISOString(),
      lookbackDays,
      totalSymbols: pool.length,
      qverisCount: cachedStocks.length,
      databaseCount: cachedStocks.length,
      mockCount: 0,
      fallbackReason:
        missingCount > 0
          ? `数据库已缓存 ${cachedStocks.length}/${pool.length} 只；剩余 ${missingCount} 只待分批预热。`
          : undefined,
      stocks: cachedStocks,
    }
    if (cachedStocks.length >= Math.min(pool.length, 30)) {
      poolBarsCache = { key: cacheKey, result, cachedAt: Date.now() }
    }
    return result
  }

  let fallbackReason: string | undefined
  if (opts.useReal && !process.env.QVERIS_API_KEY) {
    fallbackReason = "QVERIS_API_KEY 未配置"
  }

  if (!opts.useReal || fallbackReason) {
    const fallbackStocks: StockBars[] = missingPool.map((s) => ({
      symbol: s.symbol,
      name: s.name,
      industry: s.industry,
      bars: generateMockBars(s.symbol, lookbackDays),
      source: "mock",
    }))
    const stocks = [...cachedStocks, ...fallbackStocks]
    const result = {
      startedAt,
      finishedAt: new Date().toISOString(),
      lookbackDays,
      totalSymbols: pool.length,
      qverisCount: cachedStocks.length,
      databaseCount: cachedStocks.length,
      mockCount: fallbackStocks.length,
      fallbackReason: fallbackReason ?? "用户选择演示数据",
      stocks,
    }
    return result
  }

  // ─── 通过 module cache 拿 tool_id + search_id，5 分钟内不再打 /search ───
  // 工具选择已验证：cn_financial_pro.adjusted_price.v1 是 240+ 个候选里唯一
  // 同时满足 (a) 完整 OHLCV (b) 后复权 (c) 日线 (d) 真实生产数据的工具。
  const cached = await getOrDiscoverTool()
  const tool = cached.tool
  const searchId = cached.searchId
  const discoverError = cached.error

  // discover 失败 → 全部 mock，但走完流程让上层知道原因
  if (!tool || !searchId) {
    const fallbackStocks: StockBars[] = missingPool.map((s) => ({
      symbol: s.symbol,
      name: s.name,
      industry: s.industry,
      bars: generateMockBars(s.symbol, lookbackDays),
      source: "mock",
      error: discoverError,
    }))
    const stocks = [...cachedStocks, ...fallbackStocks]
    const result = {
      startedAt,
      finishedAt: new Date().toISOString(),
      lookbackDays,
      totalSymbols: pool.length,
      qverisCount: cachedStocks.length,
      databaseCount: cachedStocks.length,
      mockCount: fallbackStocks.length,
      fallbackReason: `Qveris discover 失败：${discoverError ?? "无可用工具"}`,
      stocks,
    }
    poolBarsCache = { key: cacheKey, result, cachedAt: Date.now() }
    return result
  }

  const stocks: StockBars[] = []
  const batchSize = 5
  for (let i = 0; i < missingPool.length; i += batchSize) {
    if (i > 0) await sleep(1500)
    const batch = missingPool.slice(i, i + batchSize)
    stocks.push(...(await Promise.all(batch.map((s) => fetchOneStock(s, lookbackDays, tool!, searchId!)))))
  }

  await saveStockBarsBatchWithRetry(stocks.filter((item) => item.source === "qveris"), lookbackDays)

  const mergedStocks = [...cachedStocks, ...stocks]
  const databaseCount = mergedStocks.filter((s) => s.source === "database").length
  const directQverisCount = mergedStocks.filter((s) => s.source === "qveris").length
  const qverisCount = databaseCount + directQverisCount
  const mockCount = mergedStocks.length - qverisCount

  const result = {
    startedAt,
    finishedAt: new Date().toISOString(),
    lookbackDays,
    totalSymbols: pool.length,
    qverisCount,
    databaseCount,
    mockCount,
    fallbackReason: qverisCount === 0 ? "全部 Qveris 调用失败或无可解析数据" : undefined,
    stocks: mergedStocks,
  }
  poolBarsCache = { key: cacheKey, result, cachedAt: Date.now() }
  return result
}
