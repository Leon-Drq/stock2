import { createHash } from "node:crypto"
import { call, discover, type QverisExecuteResponse, type QverisTool } from "@/lib/qveris"
import {
  getNonPriceCoverageSnapshot,
  saveNonPriceIngestionBatch,
  type FactorBindingInput,
  type NonPriceIngestionBatch,
  type NonPriceSourceId,
  type RawMarketDataInput,
  type StockEventInput,
  type StockFundamentalInput,
  type StockSentimentInput,
} from "@/lib/non-price-data-store"
import { STOCK_POOL, type StockPoolItem } from "@/lib/stock-pool"

export type NonPriceWarmOptions = {
  sourceIds?: NonPriceSourceId[]
  symbols?: string[]
  maxCalls?: number
  sample?: boolean
  persist?: boolean
}

export type NonPriceWarmSourceResult = {
  sourceId: NonPriceSourceId
  query: string
  tool?: {
    id: string
    name: string
  }
  discoveredTools: number
  sampled: number
  savedRows: number
  errors: string[]
}

export type NonPriceWarmResult = {
  ok: boolean
  startedAt: string
  finishedAt: string
  sample: boolean
  persist: boolean
  symbols: Array<{ symbol: string; name: string }>
  sources: NonPriceWarmSourceResult[]
  coverage: Awaited<ReturnType<typeof getNonPriceCoverageSnapshot>>
}

type SourceConfig = {
  sourceId: NonPriceSourceId
  query: string
  factorIds: string[]
  requiredFields: string[]
  prefer: RegExp[]
  buildParams: (stock: StockPoolItem) => Record<string, unknown>
  kind: "factor" | "event" | "fundamental"
}

const SOURCE_CONFIGS: SourceConfig[] = [
  {
    sourceId: "fund-flow",
    query: "China stock money flow large order 主力资金",
    factorIds: ["f-ai-flow"],
    requiredFields: ["symbol", "main_force_net_inflow", "super_large_net_inflow", "large_order_net_inflow", "amount"],
    prefer: [/A-Share Stock Money Flow Analysis/i, /RealStockFundFlow/i, /Stock Cash Flow/i],
    buildParams: (stock) => ({ symbol: stock.symbolQveris }),
    kind: "factor",
  },
  {
    sourceId: "north-bound",
    query: "Shanghai-Hong Kong Stock Connect northbound flow holdings by stock daily 北向资金 个股",
    factorIds: ["f-north-net", "f-ai-flow"],
    requiredFields: ["trade_date", "symbol", "northbound_net_buy", "holding_ratio", "float_market_cap"],
    prefer: [/Stock Cash Flow/i, /HSGT Market Trading Statistics/i, /RealStockFundFlow/i],
    buildParams: (stock) => ({
      stockObject: [stock.name],
      pageNo: 1,
      pageSize: 10,
      beginDate: daysAgo(45),
      endDate: todayInChina(),
    }),
    kind: "factor",
  },
  {
    sourceId: "dragon-tiger",
    query: "China A-share dragon tiger list institutional seat net buy daily 龙虎榜",
    factorIds: ["f-dragon-inst"],
    requiredFields: ["trade_date", "symbol", "seat_type", "buy_amount", "sell_amount", "net_buy_amount"],
    prefer: [/Daily Stock Bo Statistics/i, /Institution Investor Query/i],
    buildParams: (stock) => ({ stockObject: [stock.name], pageNo: 1, pageSize: 10 }),
    kind: "event",
  },
  {
    sourceId: "news",
    query: "China A-share stock news research report announcement sentiment score history 新闻 研报 情绪",
    factorIds: ["f-news-sent"],
    requiredFields: ["published_at", "symbol", "sentiment_score", "source", "title"],
    prefer: [/Hybrid Financial Search/i, /Research Report Search/i, /NewsInfoList/i],
    buildParams: (stock) => ({ input: `${stock.name} ${stock.symbol}`, tsCode: stock.symbolQveris, size: 8 }),
    kind: "event",
  },
  {
    sourceId: "announcement",
    query: "China listed company announcement filing earnings disclosure A-share 公告 定期报告",
    factorIds: ["f-news-sent"],
    requiredFields: ["event_time", "symbol", "announcement_type", "title", "impact_direction"],
    prefer: [/Finance Report Disclosure Time/i, /Announcement/i, /Earnings Report/i],
    buildParams: (stock) => ({
      stockObject: [stock.name],
      pageNo: 1,
      pageSize: 10,
      beginDate: daysAgo(180),
      endDate: todayInChina(),
    }),
    kind: "event",
  },
  {
    sourceId: "fin-statement",
    query: "China listed company financial statements income balance sheet 财报 ROE PE PB A-share",
    factorIds: ["f-pe-rev", "f-canslim-proxy"],
    requiredFields: ["report_date", "symbol", "revenue", "net_profit", "roe", "pe_ttm", "pb"],
    prefer: [/Key Metrics/i, /Balance Sheet Statement/i, /AI Financial Fundamentals/i, /Main Operating Income/i],
    buildParams: (stock) => ({ symbol: toFmpSymbol(stock), limit: 8, period: "quarter" }),
    kind: "fundamental",
  },
]

export const DEFAULT_NON_PRICE_SOURCE_IDS: NonPriceSourceId[] = ["fund-flow", "news", "fin-statement"]

export async function warmQverisNonPriceData(options: NonPriceWarmOptions = {}): Promise<NonPriceWarmResult> {
  const startedAt = new Date().toISOString()
  const sourceIds = options.sourceIds?.length ? options.sourceIds : DEFAULT_NON_PRICE_SOURCE_IDS
  const configs = sourceIds.map((id) => configFor(id)).filter((config): config is SourceConfig => Boolean(config))
  const symbolSet = new Set(options.symbols?.map(normalizeSymbol).filter(Boolean))
  const stocks = symbolSet.size
    ? STOCK_POOL.filter((stock) => symbolSet.has(stock.symbol) || symbolSet.has(stock.symbolQveris))
    : STOCK_POOL.slice(0, 3)
  const maxCalls = Math.max(0, Math.min(24, options.maxCalls ?? 6))
  const callsPerSource = configs.length ? Math.max(1, Math.floor(maxCalls / configs.length)) : 0
  const sample = options.sample !== false
  const persist = options.persist !== false
  let remainingCalls = maxCalls
  const results: NonPriceWarmSourceResult[] = []

  for (const config of configs) {
    const result: NonPriceWarmSourceResult = {
      sourceId: config.sourceId,
      query: config.query,
      discoveredTools: 0,
      sampled: 0,
      savedRows: 0,
      errors: [],
    }

    try {
      const search = await discover(config.query, undefined, 8)
      result.discoveredTools = search.results.length
      const tool = selectTool(search.results, config)
      if (!tool) {
        result.errors.push("Qveris discover 未匹配到可用工具")
        results.push(result)
        continue
      }
      result.tool = { id: tool.tool_id, name: tool.name }

      const batch: NonPriceIngestionBatch = {
        bindings: bindingRows(config, tool, config.buildParams(stocks[0] ?? STOCK_POOL[0])),
      }

      if (sample && remainingCalls > 0) {
        let sourceCalls = 0
        for (const stock of stocks) {
          if (remainingCalls <= 0) break
          if (sourceCalls >= callsPerSource) break
          const params = sanitizeParamsForTool(config.buildParams(stock), tool)
          let countedCall = false
          try {
            const exec = await call<unknown>(tool.tool_id, search.search_id, params, undefined, 60_000, 60_000, {
              source: `non-price:${config.sourceId}`,
              category: "non_price_data",
              symbols: [stock.symbolQveris],
              symbolCount: 1,
              note: config.sourceId,
            })
            remainingCalls -= 1
            sourceCalls += 1
            countedCall = true
            if (!exec.success) throw new Error(exec.error_message ?? "Qveris call success=false")
            const parsed = parseExecutionPayload(exec)
            appendSampleRows(batch, config, tool, stock, params, parsed)
            batch.bindings = bindingRows(config, tool, params, parsed.payload, "sampled")
            result.sampled += 1
          } catch (error) {
            if (!countedCall) {
              remainingCalls -= 1
              sourceCalls += 1
            }
            const message = error instanceof Error ? error.message : String(error)
            result.errors.push(`${stock.symbol} ${stock.name}: ${message}`)
            batch.bindings = bindingRows(config, tool, params, undefined, "failed", message)
          }
        }
      }

      if (persist) {
        const saved = await saveNonPriceIngestionBatch(batch)
        result.savedRows = saved.saved ? saved.rows ?? 0 : 0
        if (!saved.saved && saved.reason) result.errors.push(saved.reason)
      }
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error))
    }

    results.push(result)
  }

  const coverage = await getNonPriceCoverageSnapshot(sourceIds)
  return {
    ok: results.some((result) => result.discoveredTools > 0 || result.savedRows > 0),
    startedAt,
    finishedAt: new Date().toISOString(),
    sample,
    persist,
    symbols: stocks.map(({ symbol, name }) => ({ symbol, name })),
    sources: results,
    coverage,
  }
}

function appendSampleRows(
  batch: NonPriceIngestionBatch,
  config: SourceConfig,
  tool: QverisTool,
  stock: StockPoolItem,
  params: Record<string, unknown>,
  parsed: ParsedExecutionPayload,
) {
  const asOf = inferDate(parsed.payload) ?? todayInChina()
  const rawRow: RawMarketDataInput = {
    sourceId: config.sourceId,
    symbol: stock.symbol,
    asOf,
    toolId: tool.tool_id,
    toolName: tool.name,
    query: config.query,
    params,
    payload: parsed.payload,
    payloadHash: hashPayload(parsed.payload),
  }
  batch.raw = [...(batch.raw ?? []), rawRow]

  if (config.kind === "factor") {
    const score = extractScore(parsed.payload)
    batch.factors = [
      ...(batch.factors ?? []),
      {
        sourceId: config.sourceId,
        factorId: config.factorIds[0],
        symbol: stock.symbol,
        asOf,
        score,
        value: score,
        payload: parsed.payload,
      },
    ]
  }

  if (config.kind === "event") {
    const events = eventRowsFromPayload(config, stock, parsed.payload)
    batch.events = [...(batch.events ?? []), ...events]
    const sentiments = events
      .filter((event) => event.sentiment != null || event.title)
      .map((event): StockSentimentInput => ({
        symbol: event.symbol,
        eventTime: event.eventTime,
        sourceId: config.sourceId,
        sentiment: event.sentiment,
        title: event.title,
        payload: event.payload,
        source: `qveris:${config.sourceId}`,
      }))
    batch.sentiments = [...(batch.sentiments ?? []), ...sentiments]
  }

  if (config.kind === "fundamental") {
    const fundamental: StockFundamentalInput = {
      symbol: stock.symbol,
      reportPeriod: inferDate(parsed.payload) ?? todayInChina(),
      payload: parsed.payload,
      source: "qveris:fin-statement",
    }
    batch.fundamentals = [...(batch.fundamentals ?? []), fundamental]
  }
}

function bindingRows(
  config: SourceConfig,
  tool: QverisTool,
  sampleParams: Record<string, unknown>,
  samplePayload?: unknown,
  status: FactorBindingInput["status"] = "discovered",
  error?: string,
): FactorBindingInput[] {
  return config.factorIds.map((factorId) => ({
    factorId,
    sourceId: config.sourceId,
    toolId: tool.tool_id,
    toolName: tool.name,
    query: config.query,
    requiredFields: config.requiredFields,
    paramsSchema: tool.params ?? [],
    sampleParams,
    samplePayload,
    status,
    confidence: status === "sampled" ? 0.82 : status === "discovered" ? 0.58 : 0.25,
    error,
  }))
}

type ParsedExecutionPayload = {
  payload: unknown
  rows: unknown[]
}

function parseExecutionPayload(exec: QverisExecuteResponse<unknown>): ParsedExecutionPayload {
  const payload =
    normalizePayload(exec.result?.data) ??
    normalizePayload(exec.result?.message) ??
    normalizePayload(exec.result?.truncated_content) ??
    exec.result ??
    exec
  return {
    payload,
    rows: extractRows(payload),
  }
}

function normalizePayload(value: unknown): unknown | null {
  if (value == null) return null
  if (typeof value !== "string") return value
  const trimmed = value.trim()
  if (!trimmed) return null
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return value
    }
  }
  return value
}

function eventRowsFromPayload(config: SourceConfig, stock: StockPoolItem, payload: unknown): StockEventInput[] {
  const rows = extractRows(payload)
  const candidates = rows.length ? rows.slice(0, 12) : [payload]
  return candidates.map((row, index) => {
    const eventTime = inferDateTime(row) ?? new Date().toISOString()
    const title = extractText(row, ["title", "标题", "newsTitle", "reportTitle", "reportName", "name", "公告标题"]) ??
      `${stock.name} ${sourceLabel(config.sourceId)}`
    const sentiment = extractSentiment(row)
    const eventId = stableId([config.sourceId, stock.symbol, eventTime, title, String(index)])
    return {
      eventId,
      symbol: stock.symbol,
      eventTime,
      eventType: config.sourceId,
      title,
      sentiment,
      payload: row,
      source: `qveris:${config.sourceId}`,
    }
  })
}

function extractRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    if (payload.every((item) => item && typeof item === "object")) return payload
    return []
  }
  if (!payload || typeof payload !== "object") return []
  const obj = payload as Record<string, unknown>
  const directKeys = ["data", "items", "list", "rows", "result", "records", "content"]
  for (const key of directKeys) {
    const value = obj[key]
    if (Array.isArray(value)) return value
    const nested = extractRows(value)
    if (nested.length) return nested
  }
  for (const value of Object.values(obj)) {
    const nested = extractRows(value)
    if (nested.length) return nested
  }
  return []
}

function extractScore(payload: unknown): number | null {
  const exact = findNumericByKey(payload, [
    "main_force_net_inflow",
    "mainNetInflow",
    "mainNetAmount",
    "large_order_net_inflow",
    "northbound_net_buy",
    "net_buy_amount",
    "netBuyAmount",
    "netInflow",
    "net_amount",
    "主力净流入",
    "大单净流入",
    "净买入",
    "净流入",
  ])
  if (exact != null) return exact
  return findFirstFiniteNumber(payload)
}

function extractSentiment(payload: unknown): number | null {
  const numeric = findNumericByKey(payload, ["sentiment", "sentiment_score", "emotionScore", "情感分", "情绪分"])
  if (numeric != null) return Math.max(-1, Math.min(1, numeric > 1 ? numeric / 100 : numeric))
  const text = extractText(payload, ["emotionDirection", "sentimentLabel", "情感", "情绪", "emotionDirectionCode"])
  if (!text) return null
  if (/负|悲|利空|negative|bear/i.test(text)) return -1
  if (/正|乐观|利好|positive|bull/i.test(text)) return 1
  return 0
}

function findNumericByKey(payload: unknown, keys: string[]): number | null {
  if (!payload || typeof payload !== "object") return null
  const obj = payload as Record<string, unknown>
  for (const [key, value] of Object.entries(obj)) {
    if (keys.some((target) => key.toLowerCase().includes(target.toLowerCase()))) {
      const parsed = toNumber(value)
      if (parsed != null) return parsed
    }
  }
  for (const value of Object.values(obj)) {
    const nested = findNumericByKey(value, keys)
    if (nested != null) return nested
  }
  return null
}

function findFirstFiniteNumber(payload: unknown): number | null {
  const parsed = toNumber(payload)
  if (parsed != null) return parsed
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const nested = findFirstFiniteNumber(item)
      if (nested != null) return nested
    }
    return null
  }
  if (payload && typeof payload === "object") {
    for (const value of Object.values(payload)) {
      const nested = findFirstFiniteNumber(value)
      if (nested != null) return nested
    }
  }
  return null
}

function extractText(payload: unknown, keys: string[]): string | null {
  if (!payload || typeof payload !== "object") return null
  const obj = payload as Record<string, unknown>
  for (const [key, value] of Object.entries(obj)) {
    if (keys.some((target) => key.toLowerCase().includes(target.toLowerCase())) && typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }
  for (const value of Object.values(obj)) {
    const nested = extractText(value, keys)
    if (nested) return nested
  }
  return null
}

function inferDate(payload: unknown): string | null {
  const text = extractText(payload, ["trade_date", "tradeDate", "date", "reportDate", "report_period", "报告期", "交易日", "日期"])
  if (!text) return null
  const match = text.match(/20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/)
  return match ? match[0].replace(/[/.]/g, "-") : null
}

function inferDateTime(payload: unknown): string | null {
  const text = extractText(payload, ["published_at", "publishDate", "publishTime", "event_time", "date", "time", "发布时间", "发布日期"])
  if (!text) return null
  const normalized = text.replace(/\//g, "-")
  const date = normalized.match(/20\d{2}-\d{1,2}-\d{1,2}/)?.[0]
  if (!date) return null
  const time = normalized.match(/\d{1,2}:\d{2}(?::\d{2})?/)?.[0] ?? "00:00:00"
  return new Date(`${date}T${time.length === 5 ? `${time}:00` : time}+08:00`).toISOString()
}

function selectTool(tools: QverisTool[], config: SourceConfig) {
  return [...tools].sort((a, b) => toolScore(b, config) - toolScore(a, config))[0]
}

function toolScore(tool: QverisTool, config: SourceConfig) {
  const text = `${tool.name} ${tool.description} ${tool.tool_id}`
  const preferScore = config.prefer.reduce((sum, pattern, index) => sum + (pattern.test(text) ? 100 - index * 10 : 0), 0)
  return preferScore + (tool.stats?.success_rate ?? 0) * 10
}

function sanitizeParamsForTool(params: Record<string, unknown>, tool: QverisTool) {
  const allowed = new Set((tool.params ?? []).map((param) => param.name))
  if (!allowed.size) return params
  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (allowed.has(key)) cleaned[key] = value
  }
  for (const param of tool.params ?? []) {
    if (param.required && cleaned[param.name] == null && param.name === "symbol") cleaned[param.name] = params.symbol
  }
  return cleaned
}

function configFor(sourceId: NonPriceSourceId) {
  return SOURCE_CONFIGS.find((config) => config.sourceId === sourceId)
}

function normalizeSymbol(value: string | undefined) {
  return value?.trim().toUpperCase()
}

function toFmpSymbol(stock: StockPoolItem) {
  if (stock.symbolQveris.endsWith(".SH")) return `${stock.symbol}.SS`
  return stock.symbolQveris
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return null
  const cleaned = value.replace(/[,，%]/g, "").trim()
  const multiplier = /亿/.test(value) ? 100_000_000 : /万/.test(value) ? 10_000 : 1
  const match = cleaned.match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0]) * multiplier
  return Number.isFinite(parsed) ? parsed : null
}

function hashPayload(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex")
}

function stableId(parts: string[]) {
  return createHash("sha1").update(parts.join("|")).digest("hex")
}

function todayInChina() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date())
}

function daysAgo(days: number) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(date)
}

function sourceLabel(sourceId: NonPriceSourceId) {
  if (sourceId === "dragon-tiger") return "龙虎榜"
  if (sourceId === "announcement") return "公告"
  if (sourceId === "news") return "新闻"
  return sourceId
}
