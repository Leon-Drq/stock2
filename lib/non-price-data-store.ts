import { ensureBackendRls, getBacktestDataStoreDriver, getSharedPostgresClient, hasSharedPostgresConfig } from "@/lib/backtest-data-store"

export type NonPriceSourceId =
  | "fund-flow"
  | "north-bound"
  | "dragon-tiger"
  | "news"
  | "announcement"
  | "fin-statement"

export type RawMarketDataInput = {
  sourceId: NonPriceSourceId
  symbol: string
  asOf: string
  provider?: string
  toolId?: string
  toolName?: string
  query?: string
  params?: Record<string, unknown>
  payload: unknown
  payloadHash?: string
}

export type FactorBindingInput = {
  factorId: string
  sourceId: NonPriceSourceId
  provider?: string
  toolId: string
  toolName?: string
  query: string
  requiredFields?: string[]
  paramsSchema?: unknown
  sampleParams?: Record<string, unknown>
  samplePayload?: unknown
  status: "discovered" | "sampled" | "failed"
  confidence?: number
  error?: string
}

export type NonPriceFactorInput = {
  sourceId: NonPriceSourceId
  factorId?: string
  symbol: string
  asOf: string
  score?: number | null
  value?: number | null
  payload: unknown
  source?: string
}

export type StockEventInput = {
  eventId: string
  symbol: string
  eventTime: string
  eventType: string
  title?: string
  sentiment?: number | null
  payload: unknown
  source?: string
}

export type StockSentimentInput = {
  symbol: string
  eventTime: string
  sourceId?: NonPriceSourceId
  sentiment?: number | null
  title?: string
  payload: unknown
  source?: string
}

export type StockFundamentalInput = {
  symbol: string
  reportPeriod: string
  payload: unknown
  source?: string
}

export type NonPriceIngestionBatch = {
  raw?: RawMarketDataInput[]
  bindings?: FactorBindingInput[]
  factors?: NonPriceFactorInput[]
  events?: StockEventInput[]
  sentiments?: StockSentimentInput[]
  fundamentals?: StockFundamentalInput[]
}

export type NonPriceCoverageRow = {
  sourceId: NonPriceSourceId
  rawRows: number
  rawSymbols: number
  factorRows: number
  eventRows: number
  sentimentRows: number
  fundamentalRows: number
  bindings: number
  sampledBindings: number
  latestAsOf?: string
  latestFetchedAt?: string
}

export type NonPriceCoverageSnapshot = {
  driver: "postgres" | "redis" | "memory"
  configured: boolean
  status: "ready" | "fallback" | "error"
  checkedAt: string
  rows: NonPriceCoverageRow[]
  error?: string
}

export type StockNonPriceContext = {
  configured: boolean
  status: "ready" | "empty" | "fallback" | "error"
  checkedAt: string
  symbol: string
  factors: Array<{
    sourceId: NonPriceSourceId
    asOf: string
    score?: number
    source: string
    fetchedAt?: string
    summary: string
  }>
  events: Array<{
    eventType: string
    eventTime: string
    title?: string
    sentiment?: number
    source: string
  }>
  sentiments: Array<{
    sourceId: NonPriceSourceId
    eventTime: string
    sentiment?: number
    title?: string
    source: string
  }>
  fundamentals: Array<{
    reportPeriod: string
    source: string
    fetchedAt?: string
    summary: string
  }>
  raw: Array<{
    sourceId: NonPriceSourceId
    asOf: string
    toolName?: string
    provider?: string
    fetchedAt?: string
    summary: string
  }>
  availableSources: NonPriceSourceId[]
  missingSources: Array<NonPriceSourceId | "order-book">
  limitations: string[]
  error?: string
}

const NON_PRICE_TABLES = [
  "raw_market_data",
  "factor_bindings",
  "stock_non_price_factors",
  "stock_events",
  "stock_sentiment",
  "stock_fundamentals",
  "factor_values",
]

let nonPriceTablesReady = false

export async function saveNonPriceIngestionBatch(batch: NonPriceIngestionBatch) {
  if (!hasSharedPostgresConfig()) {
    return { driver: getBacktestDataStoreDriver(), saved: false, reason: "Postgres/Supabase 未配置" }
  }

  await ensureNonPriceDataTables()
  const sql = await getSharedPostgresClient()
  let rows = 0

  for (const item of batch.raw ?? []) {
    await sql`
      insert into raw_market_data (
        source_id,
        symbol,
        as_of,
        provider,
        tool_id,
        tool_name,
        query,
        params,
        payload,
        payload_hash
      )
      values (
        ${item.sourceId},
        ${item.symbol},
        ${item.asOf},
        ${item.provider ?? "qveris"},
        ${item.toolId ?? null},
        ${item.toolName ?? null},
        ${item.query ?? null},
        ${sql.json(asJson(item.params ?? {}))},
        ${sql.json(asJson(item.payload))},
        ${item.payloadHash ?? null}
      )
      on conflict (source_id, symbol, as_of, provider) do update set
        tool_id = excluded.tool_id,
        tool_name = excluded.tool_name,
        query = excluded.query,
        params = excluded.params,
        payload = excluded.payload,
        payload_hash = excluded.payload_hash,
        fetched_at = now()
    `
    rows += 1
  }

  for (const item of batch.bindings ?? []) {
    await sql`
      insert into factor_bindings (
        factor_id,
        source_id,
        provider,
        tool_id,
        tool_name,
        query,
        required_fields,
        params_schema,
        sample_params,
        sample_payload,
        status,
        confidence,
        error,
        last_discovered_at,
        last_sampled_at
      )
      values (
        ${item.factorId},
        ${item.sourceId},
        ${item.provider ?? "qveris"},
        ${item.toolId},
        ${item.toolName ?? null},
        ${item.query},
        ${item.requiredFields ?? []},
        ${sql.json(asJson(item.paramsSchema ?? []))},
        ${sql.json(asJson(item.sampleParams ?? {}))},
        ${item.samplePayload == null ? null : sql.json(asJson(item.samplePayload))},
        ${item.status},
        ${item.confidence ?? (item.status === "sampled" ? 0.8 : item.status === "discovered" ? 0.55 : 0.2)},
        ${item.error ?? null},
        now(),
        ${item.status === "sampled" ? new Date().toISOString() : null}
      )
      on conflict (factor_id, source_id, provider, tool_id) do update set
        tool_name = excluded.tool_name,
        query = excluded.query,
        required_fields = excluded.required_fields,
        params_schema = excluded.params_schema,
        sample_params = excluded.sample_params,
        sample_payload = coalesce(excluded.sample_payload, factor_bindings.sample_payload),
        status = excluded.status,
        confidence = excluded.confidence,
        error = excluded.error,
        last_discovered_at = now(),
        last_sampled_at = coalesce(excluded.last_sampled_at, factor_bindings.last_sampled_at)
    `
    rows += 1
  }

  for (const item of batch.factors ?? []) {
    await sql`
      insert into stock_non_price_factors (source_id, symbol, as_of, score, payload, source)
      values (
        ${item.sourceId},
        ${item.symbol},
        ${item.asOf},
        ${finiteOrNull(item.score)},
        ${sql.json(asJson(item.payload))},
        ${item.source ?? `qveris:${item.sourceId}`}
      )
      on conflict (source_id, symbol, as_of) do update set
        score = excluded.score,
        payload = excluded.payload,
        source = excluded.source,
        fetched_at = now()
    `
    rows += 1

    if (item.factorId && Number.isFinite(item.value ?? item.score)) {
      await sql`
        insert into factor_values (factor_id, symbol, as_of, value, source)
        values (
          ${item.factorId},
          ${item.symbol},
          ${item.asOf},
          ${(item.value ?? item.score) as number},
          ${`qveris-non-price:${item.sourceId}`}
        )
        on conflict (factor_id, symbol, as_of) do update set
          value = excluded.value,
          source = excluded.source,
          updated_at = now()
      `
      rows += 1
    }
  }

  for (const item of batch.events ?? []) {
    await sql`
      insert into stock_events (event_id, symbol, event_time, event_type, title, sentiment, payload, source)
      values (
        ${item.eventId},
        ${item.symbol},
        ${item.eventTime},
        ${item.eventType},
        ${item.title ?? null},
        ${finiteOrNull(item.sentiment)},
        ${sql.json(asJson(item.payload))},
        ${item.source ?? `qveris:${item.eventType}`}
      )
      on conflict (event_id) do update set
        symbol = excluded.symbol,
        event_time = excluded.event_time,
        event_type = excluded.event_type,
        title = excluded.title,
        sentiment = excluded.sentiment,
        payload = excluded.payload,
        source = excluded.source,
        fetched_at = now()
    `
    rows += 1
  }

  for (const item of batch.sentiments ?? []) {
    await sql`
      insert into stock_sentiment (symbol, event_time, source_id, sentiment, title, payload, source)
      values (
        ${item.symbol},
        ${item.eventTime},
        ${item.sourceId ?? "news"},
        ${finiteOrNull(item.sentiment)},
        ${item.title ?? null},
        ${sql.json(asJson(item.payload))},
        ${item.source ?? `qveris:${item.sourceId ?? "news"}`}
      )
      on conflict (symbol, event_time, source_id) do update set
        sentiment = excluded.sentiment,
        title = excluded.title,
        payload = excluded.payload,
        source = excluded.source,
        fetched_at = now()
    `
    rows += 1
  }

  for (const item of batch.fundamentals ?? []) {
    await sql`
      insert into stock_fundamentals (symbol, report_period, payload, source)
      values (
        ${item.symbol},
        ${item.reportPeriod},
        ${sql.json(asJson(item.payload))},
        ${item.source ?? "qveris:fin-statement"}
      )
      on conflict (symbol, report_period) do update set
        payload = excluded.payload,
        source = excluded.source,
        fetched_at = now()
    `
    rows += 1
  }

  return { driver: "postgres" as const, saved: true, rows }
}

export async function getNonPriceCoverageSnapshot(
  sourceIds: NonPriceSourceId[] = ["fund-flow", "north-bound", "dragon-tiger", "news", "announcement", "fin-statement"],
): Promise<NonPriceCoverageSnapshot> {
  const checkedAt = new Date().toISOString()
  if (!hasSharedPostgresConfig()) {
    return {
      driver: getBacktestDataStoreDriver(),
      configured: false,
      status: "fallback",
      checkedAt,
      rows: emptyCoverageRows(sourceIds),
      error: "Postgres/Supabase 未配置",
    }
  }

  try {
    await ensureNonPriceDataTables()
    const sql = await getSharedPostgresClient()
    const rows = await sql<Array<{
      source_id: NonPriceSourceId
      raw_rows: number
      raw_symbols: number
      factor_rows: number
      event_rows: number
      sentiment_rows: number
      fundamental_rows: number
      bindings: number
      sampled_bindings: number
      latest_as_of: string | Date | null
      latest_fetched_at: string | Date | null
    }>>`
      with source_ids as (
        select unnest(${sourceIds}::text[]) as source_id
      ),
      raw as (
        select source_id,
               count(*)::int as raw_rows,
               count(distinct symbol)::int as raw_symbols,
               max(as_of) as latest_as_of,
               max(fetched_at) as latest_fetched_at
        from raw_market_data
        where source_id = any(${sourceIds})
        group by source_id
      ),
      factors as (
        select source_id, count(*)::int as factor_rows
        from stock_non_price_factors
        where source_id = any(${sourceIds})
        group by source_id
      ),
      events as (
        select event_type as source_id, count(*)::int as event_rows
        from stock_events
        where event_type = any(${sourceIds})
        group by event_type
      ),
      sentiments as (
        select source_id, count(*)::int as sentiment_rows
        from stock_sentiment
        where source_id = any(${sourceIds})
        group by source_id
      ),
      fundamentals as (
        select 'fin-statement'::text as source_id, count(*)::int as fundamental_rows
        from stock_fundamentals
        where source = 'qveris:fin-statement'
      ),
      bindings as (
        select source_id,
               count(*)::int as bindings,
               count(*) filter (where status = 'sampled')::int as sampled_bindings
        from factor_bindings
        where source_id = any(${sourceIds})
        group by source_id
      )
      select source_ids.source_id,
             coalesce(raw.raw_rows, 0)::int as raw_rows,
             coalesce(raw.raw_symbols, 0)::int as raw_symbols,
             coalesce(factors.factor_rows, 0)::int as factor_rows,
             coalesce(events.event_rows, 0)::int as event_rows,
             coalesce(sentiments.sentiment_rows, 0)::int as sentiment_rows,
             coalesce(fundamentals.fundamental_rows, 0)::int as fundamental_rows,
             coalesce(bindings.bindings, 0)::int as bindings,
             coalesce(bindings.sampled_bindings, 0)::int as sampled_bindings,
             raw.latest_as_of,
             raw.latest_fetched_at
      from source_ids
      left join raw on raw.source_id = source_ids.source_id
      left join factors on factors.source_id = source_ids.source_id
      left join events on events.source_id = source_ids.source_id
      left join sentiments on sentiments.source_id = source_ids.source_id
      left join fundamentals on fundamentals.source_id = source_ids.source_id
      left join bindings on bindings.source_id = source_ids.source_id
      order by array_position(${sourceIds}::text[], source_ids.source_id)
    `

    return {
      driver: "postgres",
      configured: true,
      status: "ready",
      checkedAt,
      rows: rows.map((row) => ({
        sourceId: row.source_id,
        rawRows: row.raw_rows,
        rawSymbols: row.raw_symbols,
        factorRows: row.factor_rows,
        eventRows: row.event_rows,
        sentimentRows: row.sentiment_rows,
        fundamentalRows: row.fundamental_rows,
        bindings: row.bindings,
        sampledBindings: row.sampled_bindings,
        latestAsOf: formatDate(row.latest_as_of),
        latestFetchedAt: formatDateTime(row.latest_fetched_at),
      })),
    }
  } catch (error) {
    return {
      driver: getBacktestDataStoreDriver(),
      configured: true,
      status: "error",
      checkedAt,
      rows: emptyCoverageRows(sourceIds),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function loadStockNonPriceContext(symbol: string): Promise<StockNonPriceContext> {
  const checkedAt = new Date().toISOString()
  const normalized = symbol.trim().slice(0, 6)
  const base = (): StockNonPriceContext => ({
    configured: hasSharedPostgresConfig(),
    status: hasSharedPostgresConfig() ? "empty" : "fallback",
    checkedAt,
    symbol: normalized,
    factors: [],
    events: [],
    sentiments: [],
    fundamentals: [],
    raw: [],
    availableSources: [],
    missingSources: ["fund-flow", "north-bound", "dragon-tiger", "news", "announcement", "fin-statement", "order-book"],
    limitations: hasSharedPostgresConfig()
      ? ["暂未找到该股已落库的资金、新闻、事件或财务补充数据。"]
      : ["Postgres/Supabase 未配置，无法读取已缓存的非价格数据。"],
  })

  if (!normalized) return base()
  if (!hasSharedPostgresConfig()) return base()

  try {
    await ensureNonPriceDataTables()
    const sql = await getSharedPostgresClient()
    const [factorRows, eventRows, sentimentRows, fundamentalRows, rawRows] = await Promise.all([
      sql<Array<{
        source_id: NonPriceSourceId
        as_of: string | Date
        score: number | null
        payload: unknown
        source: string
        fetched_at: string | Date | null
      }>>`
        select source_id, as_of, score, payload, source, fetched_at
        from stock_non_price_factors
        where symbol = ${normalized}
        order by as_of desc, fetched_at desc
        limit 8
      `,
      sql<Array<{
        event_type: string
        event_time: string | Date
        title: string | null
        sentiment: number | null
        source: string
      }>>`
        select event_type, event_time, title, sentiment, source
        from stock_events
        where symbol = ${normalized}
        order by event_time desc
        limit 8
      `,
      sql<Array<{
        source_id: NonPriceSourceId
        event_time: string | Date
        sentiment: number | null
        title: string | null
        source: string
      }>>`
        select source_id, event_time, sentiment, title, source
        from stock_sentiment
        where symbol = ${normalized}
        order by event_time desc
        limit 8
      `,
      sql<Array<{
        report_period: string | Date
        payload: unknown
        source: string
        fetched_at: string | Date | null
      }>>`
        select report_period, payload, source, fetched_at
        from stock_fundamentals
        where symbol = ${normalized}
        order by report_period desc, fetched_at desc
        limit 3
      `,
      sql<Array<{
        source_id: NonPriceSourceId
        as_of: string | Date
        provider: string | null
        tool_name: string | null
        payload: unknown
        fetched_at: string | Date | null
      }>>`
        select source_id, as_of, provider, tool_name, payload, fetched_at
        from raw_market_data
        where symbol = ${normalized}
        order by as_of desc, fetched_at desc
        limit 8
      `,
    ])

    const factors = factorRows.map((row) => ({
      sourceId: row.source_id,
      asOf: formatDate(row.as_of) ?? "",
      score: finiteOrUndefined(row.score),
      source: row.source,
      fetchedAt: formatDateTime(row.fetched_at),
      summary: summarizePayload(row.payload),
    }))
    const events = eventRows.map((row) => ({
      eventType: row.event_type,
      eventTime: formatDateTime(row.event_time) ?? "",
      title: row.title ?? undefined,
      sentiment: finiteOrUndefined(row.sentiment),
      source: row.source,
    }))
    const sentiments = sentimentRows.map((row) => ({
      sourceId: row.source_id,
      eventTime: formatDateTime(row.event_time) ?? "",
      sentiment: finiteOrUndefined(row.sentiment),
      title: row.title ?? undefined,
      source: row.source,
    }))
    const fundamentals = fundamentalRows.map((row) => ({
      reportPeriod: formatDate(row.report_period) ?? "",
      source: row.source,
      fetchedAt: formatDateTime(row.fetched_at),
      summary: summarizePayload(row.payload),
    }))
    const raw = rawRows.map((row) => ({
      sourceId: row.source_id,
      asOf: formatDate(row.as_of) ?? "",
      toolName: row.tool_name ?? undefined,
      provider: row.provider ?? undefined,
      fetchedAt: formatDateTime(row.fetched_at),
      summary: summarizePayload(row.payload),
    }))
    const sourceSet = new Set<NonPriceSourceId>([
      ...factors.map((row) => row.sourceId),
      ...sentiments.map((row) => row.sourceId),
      ...raw.map((row) => row.sourceId),
      ...events.map((row) => row.eventType).filter(isNonPriceSourceId),
      ...(fundamentals.length ? ["fin-statement" as const] : []),
    ])
    const expected: NonPriceSourceId[] = ["fund-flow", "north-bound", "dragon-tiger", "news", "announcement", "fin-statement"]
    const missingSources: StockNonPriceContext["missingSources"] = [
      ...expected.filter((sourceId) => !sourceSet.has(sourceId)),
      "order-book",
    ]
    const limitations = [
      missingSources.includes("order-book") ? "实时五档盘口/逐笔成交尚未落库，AI 不会编造盘口结论。" : "",
      ...expected
        .filter((sourceId) => !sourceSet.has(sourceId))
        .map((sourceId) => `${nonPriceSourceLabel(sourceId)}暂无该股缓存。`),
    ].filter(Boolean)

    return {
      configured: true,
      status: sourceSet.size ? "ready" : "empty",
      checkedAt,
      symbol: normalized,
      factors,
      events,
      sentiments,
      fundamentals,
      raw,
      availableSources: [...sourceSet],
      missingSources,
      limitations: limitations.length ? limitations : ["已读取该股非价格补充数据。"],
    }
  } catch (error) {
    return {
      ...base(),
      configured: true,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      limitations: ["非价格数据读取失败，AI 将只使用价格、策略和模拟盘数据。"],
    }
  }
}

async function ensureNonPriceDataTables() {
  if (nonPriceTablesReady) return
  const sql = await getSharedPostgresClient()
  try {
    await sql`select source_id from raw_market_data where false`
    await sql`select factor_id from factor_bindings where false`
    await sql`select symbol from stock_sentiment where false`
    nonPriceTablesReady = true
    return
  } catch (error) {
    if (!isMissingSchemaObject(error)) throw error
  }

  await sql`
    create table if not exists raw_market_data (
      source_id text not null,
      symbol text not null,
      as_of date not null,
      provider text not null default 'qveris',
      tool_id text,
      tool_name text,
      query text,
      params jsonb not null default '{}'::jsonb,
      payload jsonb not null,
      payload_hash text,
      fetched_at timestamptz not null default now(),
      primary key (source_id, symbol, as_of, provider)
    )
  `
  await sql`
    create index if not exists raw_market_data_source_date_idx
    on raw_market_data (source_id, as_of desc)
  `
  await sql`
    create table if not exists factor_bindings (
      factor_id text not null,
      source_id text not null,
      provider text not null default 'qveris',
      tool_id text not null,
      tool_name text,
      query text not null,
      required_fields text[] not null default '{}',
      params_schema jsonb not null default '[]'::jsonb,
      sample_params jsonb not null default '{}'::jsonb,
      sample_payload jsonb,
      status text not null default 'discovered',
      confidence double precision not null default 0,
      error text,
      last_discovered_at timestamptz not null default now(),
      last_sampled_at timestamptz,
      primary key (factor_id, source_id, provider, tool_id)
    )
  `
  await sql`
    create index if not exists factor_bindings_source_status_idx
    on factor_bindings (source_id, status, last_discovered_at desc)
  `
  await sql`
    create table if not exists stock_sentiment (
      symbol text not null,
      event_time timestamptz not null,
      source_id text not null default 'news',
      sentiment double precision,
      title text,
      payload jsonb not null,
      source text not null default 'qveris',
      fetched_at timestamptz not null default now(),
      primary key (symbol, event_time, source_id)
    )
  `
  await sql`
    create index if not exists stock_sentiment_symbol_time_idx
    on stock_sentiment (symbol, event_time desc)
  `
  await ensureBackendRls(sql, NON_PRICE_TABLES)
  nonPriceTablesReady = true
}

function isMissingSchemaObject(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : ""
  const message = error instanceof Error ? error.message : String(error)
  return code === "42P01" || code === "42703" || /does not exist|不存在|undefined table|undefined column/i.test(message)
}

function emptyCoverageRows(sourceIds: NonPriceSourceId[]): NonPriceCoverageRow[] {
  return sourceIds.map((sourceId) => ({
    sourceId,
    rawRows: 0,
    rawSymbols: 0,
    factorRows: 0,
    eventRows: 0,
    sentimentRows: 0,
    fundamentalRows: 0,
    bindings: 0,
    sampledBindings: 0,
  }))
}

function asJson(value: unknown): never {
  return jsonSafe(value) as never
}

function jsonSafe(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null))
}

function finiteOrNull(value: number | null | undefined) {
  return Number.isFinite(value) ? value as number : null
}

function finiteOrUndefined(value: number | null | undefined) {
  return Number.isFinite(value) ? value as number : undefined
}

function formatDate(value: string | Date | null | undefined) {
  if (!value) return undefined
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return undefined
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function summarizePayload(payload: unknown) {
  const title = textByKey(payload, ["title", "标题", "newsTitle", "reportTitle", "公告标题", "name"])
  const direction = textByKey(payload, ["direction", "emotionDirection", "sentimentLabel", "impact_direction", "情绪", "方向"])
  const numeric = numberByKey(payload, [
    "main_force_net_inflow",
    "super_large_net_inflow",
    "large_order_net_inflow",
    "northbound_net_buy",
    "net_buy_amount",
    "netInflow",
    "roe",
    "pe_ttm",
    "pb",
    "主力净流入",
    "大单净流入",
    "净买入",
    "净流入",
  ])
  const parts = [
    title,
    direction ? `方向 ${direction}` : "",
    numeric != null ? `数值 ${formatCompactNumber(numeric)}` : "",
  ].filter(Boolean)
  if (parts.length) return parts.join(" · ")
  const text = typeof payload === "string" ? payload : JSON.stringify(payload ?? null)
  return text.length > 160 ? `${text.slice(0, 160)}...` : text
}

function textByKey(payload: unknown, keys: string[]): string | undefined {
  if (!payload || typeof payload !== "object") return undefined
  const obj = payload as Record<string, unknown>
  for (const [key, value] of Object.entries(obj)) {
    if (keys.some((target) => key.toLowerCase().includes(target.toLowerCase())) && typeof value === "string" && value.trim()) {
      return value.trim().slice(0, 80)
    }
  }
  for (const value of Object.values(obj)) {
    const nested = textByKey(value, keys)
    if (nested) return nested
  }
}

function numberByKey(payload: unknown, keys: string[]): number | undefined {
  if (!payload || typeof payload !== "object") return undefined
  const obj = payload as Record<string, unknown>
  for (const [key, value] of Object.entries(obj)) {
    if (keys.some((target) => key.toLowerCase().includes(target.toLowerCase()))) {
      const parsed = parsePayloadNumber(value)
      if (parsed != null) return parsed
    }
  }
  for (const value of Object.values(obj)) {
    const nested = numberByKey(value, keys)
    if (nested != null) return nested
  }
}

function parsePayloadNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return null
  const multiplier = /亿/.test(value) ? 100_000_000 : /万/.test(value) ? 10_000 : 1
  const match = value.replace(/[,，%]/g, "").match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0]) * multiplier
  return Number.isFinite(parsed) ? parsed : null
}

function formatCompactNumber(value: number) {
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(2)}万`
  return value.toFixed(Math.abs(value) >= 10 ? 2 : 4)
}

function isNonPriceSourceId(value: string): value is NonPriceSourceId {
  return ["fund-flow", "north-bound", "dragon-tiger", "news", "announcement", "fin-statement"].includes(value)
}

function nonPriceSourceLabel(sourceId: NonPriceSourceId) {
  if (sourceId === "fund-flow") return "主力资金流"
  if (sourceId === "north-bound") return "北向资金"
  if (sourceId === "dragon-tiger") return "龙虎榜"
  if (sourceId === "news") return "新闻/研报"
  if (sourceId === "announcement") return "公告"
  return "财务报表"
}
