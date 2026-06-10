import { call, discover, type QverisTool } from "@/lib/qveris"
import {
  getSharedPostgresClient,
  hasSharedPostgresConfig,
  saveMarketIndexBarsToStore,
  saveMarketIndexQuotesToStore,
  type MarketIndexBarInput,
} from "@/lib/backtest-data-store"
import { formatChinaDate, formatChinaTime } from "@/lib/format"

export type MarketIndexQuote = {
  code: string
  codeQveris: string
  name: string
  value: number | null
  changePct: number | null
  tradeDate?: string
  tradeTime?: string
}

export type MarketIndexesResult = {
  quotes: MarketIndexQuote[]
  fetchedAt: string
  cacheAgeMs: number
  ttlMs: number
  source: "qveris" | "database" | "unavailable"
  fallbackReason?: string
  toolId?: string
  toolName?: string
}

export type FetchMarketIndexesOptions = {
  /**
   * Bypass database-first reads and attempt a foreground Qveris refresh.
   * Use this for cron/manual refresh paths where a background promise may be
   * dropped before it updates the shared cache.
   */
  refresh?: boolean
  timeoutMs?: number
}

const INDEXES = [
  { name: "上证指数", code: "000001", codeQveris: "000001.SH" },
  { name: "深证成指", code: "399001", codeQveris: "399001.SZ" },
  { name: "创业板指", code: "399006", codeQveris: "399006.SZ" },
  { name: "中证500", code: "000905", codeQveris: "000905.SH" },
]

const INDEX_CACHE_MS = 5 * 60_000
const DISCOVER_CACHE_MS = 30 * 60_000
const INDEX_TOOL_ID = "cn_financial_pro.real_time_quotation.v1"
const INDEX_HISTORY_TOOL_ID = "cn_financial_pro.adjusted_price.v1"
const INDEX_HISTORY_CACHE_MS = 6 * 60 * 60_000
const LIVE_QUOTE_TIMEOUT_MS = 10_000
const LIVE_REFRESH_THROTTLE_MS = 60_000

type AnyRecord = Record<string, unknown>

type DiscoverCache = {
  tool?: QverisTool
  searchId?: string
  error?: string
  cachedAt: number
}

let discoverCache: DiscoverCache | null = null
let historyDiscoverCache: DiscoverCache | null = null
let indexCache: { result: MarketIndexesResult; cachedAt: number } | null = null
let historyCache: { cachedAt: number; rows: number; error?: string } | null = null
let liveRefreshInFlight: Promise<MarketIndexesResult> | null = null
let liveRefreshStartedAt = 0

export async function fetchMarketIndexes(options: FetchMarketIndexesOptions = {}): Promise<MarketIndexesResult> {
  const now = Date.now()
  if (!options.refresh && indexCache && now - indexCache.cachedAt < INDEX_CACHE_MS) {
    void fetchAndSaveMarketIndexHistory().catch(() => undefined)
    return {
      ...indexCache.result,
      cacheAgeMs: now - indexCache.cachedAt,
    }
  }

  if (!options.refresh) {
    const cached = await loadLatestIndexQuotesFromStore()
    if (cached) {
      indexCache = { result: cached, cachedAt: Date.now() }
      void fetchAndSaveMarketIndexHistory().catch(() => undefined)
      refreshLiveIndexesInBackground()
      return cached
    }
  }

  const live = await fetchMarketIndexesFromQveris(options.timeoutMs ?? LIVE_QUOTE_TIMEOUT_MS)
  if (live.source === "qveris") return live

  const cached = await loadLatestIndexQuotesFromStore()
  if (cached) {
    const fallbackReason = [
      live.fallbackReason,
      cached.fallbackReason,
      "当前先展示最近一次数据库缓存，后台刷新接口恢复后会覆盖。",
    ].filter(Boolean).join("；")
    const result = { ...cached, fallbackReason }
    indexCache = { result, cachedAt: Date.now() }
    void fetchAndSaveMarketIndexHistory().catch(() => undefined)
    return result
  }

  return live
}

async function fetchMarketIndexesFromQveris(timeoutMs: number): Promise<MarketIndexesResult> {
  if (!process.env.QVERIS_API_KEY) {
    return unavailable("QVERIS_API_KEY 未配置，未拉取指数行情")
  }

  const discovered = await getOrDiscoverIndexTool(timeoutMs)
  if (!discovered.tool || !discovered.searchId) {
    return unavailable(`Qveris 指数行情 discover 失败：${discovered.error ?? "无可用工具"}`)
  }

  try {
    const codes = INDEXES.map((idx) => idx.codeQveris).join(",")
    const res = await call<unknown>(
      discovered.tool.tool_id,
      discovered.searchId,
      { codes, indicators: "common" },
      undefined,
      50_000,
      timeoutMs,
      {
        source: "market-index-live",
        category: "market_index",
        symbols: INDEXES.map((idx) => idx.codeQveris),
        symbolCount: INDEXES.length,
      },
    )

    if (!res.success) {
      return unavailable(friendlyQverisIndexError(res.error_message ?? "Qveris 指数行情调用失败"))
    }

    const rows = flattenRows(res.result?.data)
    const byCode = new Map<string, AnyRecord>()
    for (const row of rows) {
      const code = pickString(row, ["thscode", "stock_code", "index_code", "code", "symbol"])
      if (code) {
        for (const key of codeLookupKeys(code)) byCode.set(key, row)
      }
    }

    const quotes = INDEXES.map((idx) => parseIndexQuote(idx, findIndexRow(byCode, idx)))
    const validCount = quotes.filter((q) => q.value != null).length
    if (validCount === 0) {
      return unavailable("Qveris 指数行情返回为空或不可解析")
    }

    let storeWarning: string | undefined
    try {
      await saveMarketIndexQuotesToStore(quotes, { toolId: discovered.tool.tool_id })
    } catch (error) {
      storeWarning = `指数缓存写入失败，不影响行情展示：${error instanceof Error ? error.message : String(error)}`
    }

    const partialWarning = validCount < INDEXES.length ? `仅解析到 ${validCount}/${INDEXES.length} 个指数` : undefined
    const result: MarketIndexesResult = {
      quotes,
      fetchedAt: new Date().toISOString(),
      cacheAgeMs: 0,
      ttlMs: INDEX_CACHE_MS,
      source: "qveris",
      toolId: discovered.tool.tool_id,
      toolName: discovered.tool.name,
      fallbackReason: [partialWarning, storeWarning].filter(Boolean).join("；") || undefined,
    }
    void fetchAndSaveMarketIndexHistory().catch(() => undefined)
    indexCache = { result, cachedAt: Date.now() }
    return result
  } catch (err) {
    return unavailable(friendlyQverisIndexError(err instanceof Error ? err.message : String(err)))
  }
}

export async function fetchAndSaveMarketIndexHistory() {
  if (historyCache && Date.now() - historyCache.cachedAt < INDEX_HISTORY_CACHE_MS) {
    return historyCache
  }
  if (!process.env.QVERIS_API_KEY) {
    historyCache = { cachedAt: Date.now(), rows: 0, error: "QVERIS_API_KEY 未配置" }
    return historyCache
  }

  const discovered = await getOrDiscoverIndexHistoryTool()
  if (!discovered.tool || !discovered.searchId) {
    historyCache = { cachedAt: Date.now(), rows: 0, error: discovered.error ?? "无可用指数历史工具" }
    return historyCache
  }

  const endDate = formatDate(new Date())
  const startDate = dateDaysAgo(900)
  const res = await call<unknown>(
    discovered.tool.tool_id,
    discovered.searchId,
    {
      codes: INDEXES.map((idx) => idx.codeQveris).join(","),
      startdate: startDate,
      enddate: endDate,
      cps: "0",
      interval: "D",
    },
    undefined,
    800_000,
    60_000,
    {
      source: "market-index-history",
      category: "market_index_history",
      symbols: INDEXES.map((idx) => idx.codeQveris),
      symbolCount: INDEXES.length,
      note: "900d index benchmark bars",
    },
  )
  if (!res.success) {
    historyCache = { cachedAt: Date.now(), rows: 0, error: res.error_message ?? "指数历史行情调用失败" }
    return historyCache
  }

  let payload: unknown = res.result?.data
  const fileUrl = res.result?.full_content_file_url
  if (!payload && fileUrl) {
    try {
      const fr = await fetch(fileUrl, { cache: "no-store" })
      if (fr.ok) payload = await fr.json()
    } catch {
      /* 落到 truncated_content */
    }
  }
  if (!payload && typeof res.result?.truncated_content === "string") {
    payload = tryParseTruncatedJson(res.result.truncated_content)
  }

  const bars = parseIndexHistoryPayload(payload)
  if (bars.length) {
    try {
      await saveMarketIndexBarsToStore(bars, { toolId: discovered.tool.tool_id, source: "qveris-index-history" })
    } catch (error) {
      historyCache = {
        cachedAt: Date.now(),
        rows: 0,
        error: `指数历史缓存写入失败：${error instanceof Error ? error.message : String(error)}`,
      }
      return historyCache
    }
  }
  historyCache = { cachedAt: Date.now(), rows: bars.length }
  return historyCache
}

async function getOrDiscoverIndexHistoryTool(): Promise<DiscoverCache> {
  if (historyDiscoverCache && Date.now() - historyDiscoverCache.cachedAt < DISCOVER_CACHE_MS) {
    return historyDiscoverCache
  }

  try {
    const search = await discover(
      "A股指数历史日线 上证指数 深证成指 创业板指 中证500 open high low close volume adjusted_price",
      undefined,
      8,
    )
    const tool =
      search.results.find((t) => t.tool_id === INDEX_HISTORY_TOOL_ID) ??
      search.results.find((t) => /历史|日线|adjusted|price/i.test(`${t.tool_id} ${t.name}`)) ??
      search.results[0]

    historyDiscoverCache = tool
      ? { tool, searchId: search.search_id, cachedAt: Date.now() }
      : { error: "Qveris discover 未返回指数历史行情工具", cachedAt: Date.now() }
  } catch (err) {
    historyDiscoverCache = {
      error: err instanceof Error ? err.message : String(err),
      cachedAt: Date.now(),
    }
  }
  return historyDiscoverCache
}

async function getOrDiscoverIndexTool(timeoutMs = LIVE_QUOTE_TIMEOUT_MS): Promise<DiscoverCache> {
  if (discoverCache && Date.now() - discoverCache.cachedAt < DISCOVER_CACHE_MS) {
    return discoverCache
  }

  try {
    const search = await discover(
      "A股指数实时行情 上证指数 深证成指 创业板指 中证500 最新价格 涨跌幅 批量 codes real_time_quotation",
      undefined,
      8,
      timeoutMs,
    )
    const tool =
      search.results.find((t) => t.tool_id === INDEX_TOOL_ID) ??
      search.results.find((t) => /real[-_ ]?time|实时行情|指数/i.test(`${t.tool_id} ${t.name}`)) ??
      search.results[0]

    discoverCache = tool
      ? { tool, searchId: search.search_id, cachedAt: Date.now() }
      : { error: "Qveris discover 未返回指数行情工具", cachedAt: Date.now() }
  } catch (err) {
    discoverCache = {
      error: err instanceof Error ? err.message : String(err),
      cachedAt: Date.now(),
    }
  }
  return discoverCache
}

type StoredIndexRow = {
  index_code: string
  trade_date: string | Date
  name: string | null
  close: number | string | null
  change_pct: number | string | null
  source: string | null
  fetched_at: string | Date | null
}

async function loadLatestIndexQuotesFromStore(): Promise<MarketIndexesResult | null> {
  if (!hasSharedPostgresConfig()) return null

  try {
    const sql = await getSharedPostgresClient()
    const codes = INDEXES.map((idx) => idx.codeQveris)
    const rows = await sql<StoredIndexRow[]>`
      with requested(index_code) as (
        select * from unnest(${codes}::text[])
      )
      select distinct on (b.index_code)
        b.index_code,
        b.trade_date::text as trade_date,
        b.name,
        b.close,
        b.change_pct,
        b.source,
        b.fetched_at::text as fetched_at
      from requested r
      join market_index_bars b on b.index_code = r.index_code
      order by b.index_code, b.trade_date desc, b.fetched_at desc
    `
    if (!rows.length) return null

    const byCode = new Map(rows.map((row) => [normalizeCode(row.index_code), row]))
    const latestFetchedAt = rows
      .map((row) => toTime(row.fetched_at))
      .filter((time) => time > 0)
      .sort((a, b) => b - a)[0]
    const fetchedAt = latestFetchedAt ? new Date(latestFetchedAt).toISOString() : new Date().toISOString()
    const quotes = INDEXES.map((idx) => {
      const row = byCode.get(normalizeCode(idx.codeQveris))
      if (!row) {
        return { ...idx, value: null, changePct: null }
      }
      return {
        ...idx,
        name: row.name ?? idx.name,
        value: toNumber(row.close),
        changePct: toNumber(row.change_pct),
        tradeDate: normalizeDate(String(row.trade_date)),
        tradeTime: row.fetched_at ? formatChinaTime(row.fetched_at, false) : undefined,
      }
    })
    const validCount = quotes.filter((quote) => quote.value != null).length
    if (validCount === 0) return null

    const ageMs = Math.max(0, Date.now() - new Date(fetchedAt).getTime())
    return {
      quotes,
      fetchedAt,
      cacheAgeMs: ageMs,
      ttlMs: INDEX_CACHE_MS,
      source: "database",
      fallbackReason:
        ageMs > INDEX_CACHE_MS * 2
          ? `Qveris 实时指数工具刷新较慢，当前显示最近一次数据库缓存（${validCount}/${INDEXES.length}）。`
          : validCount < INDEXES.length
            ? `指数缓存仅覆盖 ${validCount}/${INDEXES.length} 个标的，后台继续刷新 Qveris。`
            : undefined,
    }
  } catch {
    return null
  }
}

function refreshLiveIndexesInBackground() {
  const now = Date.now()
  if (liveRefreshInFlight || now - liveRefreshStartedAt < LIVE_REFRESH_THROTTLE_MS) return

  liveRefreshStartedAt = now
  liveRefreshInFlight = fetchMarketIndexesFromQveris(LIVE_QUOTE_TIMEOUT_MS)
    .then((result) => {
      if (result.source === "qveris") {
        indexCache = { result, cachedAt: Date.now() }
      }
      return result
    })
    .finally(() => {
      liveRefreshInFlight = null
    })
}

function friendlyQverisIndexError(message: string) {
  if (/timeout/i.test(message)) {
    return "Qveris 实时指数工具超时，稍后会自动重试；若有数据库缓存，首页会优先显示最近一次可信快照。"
  }
  return `Qveris 指数行情调用异常：${message}`
}

function unavailable(fallbackReason: string): MarketIndexesResult {
  return {
    quotes: INDEXES.map((idx) => ({
      code: idx.code,
      codeQveris: idx.codeQveris,
      name: idx.name,
      value: null,
      changePct: null,
    })),
    fetchedAt: new Date().toISOString(),
    cacheAgeMs: 0,
    ttlMs: INDEX_CACHE_MS,
    source: "unavailable",
    fallbackReason,
  }
}

function parseIndexQuote(
  index: { name: string; code: string; codeQveris: string },
  row?: AnyRecord,
): MarketIndexQuote {
  if (!row) {
    return { ...index, value: null, changePct: null }
  }
  return {
    ...index,
    value: pickNumber(row, ["latest", "latest_price", "price", "close", "最新价"]),
    changePct: pickNumber(row, ["changeRatio", "change_pct", "pct_chg", "涨跌幅"]),
    tradeDate: normalizeDate(pickString(row, ["tradeDate", "date", "交易日期"])),
    tradeTime: pickString(row, ["tradeTime", "time", "交易时间"])?.slice(-8),
  }
}

function findIndexRow(byCode: Map<string, AnyRecord>, index: { code: string; codeQveris: string }) {
  for (const key of codeLookupKeys(index.codeQveris, index.code)) {
    const row = byCode.get(key)
    if (row) return row
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
    const hasCode = pickString(obj, ["thscode", "stock_code", "index_code", "code", "symbol"])
    const hasPrice = pickNumber(obj, ["latest", "latest_price", "latestPrice", "price", "close", "最新价"])
    if (hasCode && hasPrice != null) {
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

function parseIndexHistoryPayload(data: unknown): MarketIndexBarInput[] {
  if (!Array.isArray(data)) return []

  if (data.length > 0 && Array.isArray(data[0])) {
    return data.flatMap((group, index) => {
      const spec = INDEXES[index]
      if (!spec) return []
      return (group as unknown[])
        .map((row) => toIndexBar(row, spec))
        .filter((bar): bar is MarketIndexBarInput => Boolean(bar))
    })
  }

  return flattenRows(data)
    .map((row) => {
      const rawCode = pickString(row, ["thscode", "stock_code", "index_code", "code", "symbol"])
      const spec = rawCode
        ? INDEXES.find((idx) => normalizeCode(idx.codeQveris) === normalizeCode(rawCode) || idx.code === normalizeCode(rawCode).slice(0, 6))
        : undefined
      return spec ? toIndexBar(row, spec) : null
    })
    .filter((bar): bar is MarketIndexBarInput => Boolean(bar))
}

function toIndexBar(row: unknown, index: { name: string; code: string; codeQveris: string }): MarketIndexBarInput | null {
  if (!row || typeof row !== "object") return null
  const record = row as AnyRecord
  const date = normalizeDate(pickString(record, ["date", "Date", "trade_date", "日期", "time"]))
  const close = pickNumber(record, ["close", "Close", "收盘", "收盘价"])
  if (!date || close == null) return null
  return {
    indexCode: index.codeQveris,
    name: index.name,
    date,
    open: pickNumber(record, ["open", "Open", "开盘", "开盘价"]),
    high: pickNumber(record, ["high", "High", "最高", "最高价"]),
    low: pickNumber(record, ["low", "Low", "最低", "最低价"]),
    close,
    volume: pickNumber(record, ["volume", "Volume", "vol", "成交量"]),
    amount: pickNumber(record, ["amount", "Amount", "成交额"]),
    changePct: pickNumber(record, ["change_pct", "changeRatio", "pct_chg", "涨跌幅"]),
  }
}

function tryParseTruncatedJson(s: string): unknown {
  if (!s.trim().startsWith("[")) return null
  try {
    return JSON.parse(s)
  } catch {
    /* 修复截断 JSON */
  }
  const lastObjEnd = s.lastIndexOf("},")
  if (lastObjEnd < 0) return null
  const candidate = s.slice(0, lastObjEnd + 1) + (s.trim().startsWith("[[") ? "]]" : "]")
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

function formatDate(d: Date) {
  return formatChinaDate(d)
}

function dateDaysAgo(days: number) {
  return formatChinaDate(new Date(Date.now() - days * 24 * 60 * 60_000))
}

function normalizeCode(code: string) {
  return code.trim().toUpperCase().replace(/^SH\./, "").replace(/^SZ\./, "")
}

function codeLookupKeys(...codes: Array<string | undefined>) {
  const keys = new Set<string>()
  for (const code of codes) {
    if (!code) continue
    const normalized = normalizeCode(code)
    keys.add(normalized)
    keys.add(normalized.replace(/\.(SH|SZ|BJ)$/, ""))
    keys.add(normalized.replace(/^(SH|SZ|BJ)/, ""))
  }
  return Array.from(keys).filter(Boolean)
}

function normalizeDate(date?: string) {
  if (!date) return undefined
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

function pickNumber(obj: AnyRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string") {
      const n = Number(value.replace(/,/g, ""))
      if (Number.isFinite(n)) return n
    }
  }
  return null
}

function toNumber(value: number | string | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const n = Number(value.replace(/,/g, ""))
    if (Number.isFinite(n)) return n
  }
  return null
}

function toTime(value: string | Date | null | undefined) {
  if (!value) return 0
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}
