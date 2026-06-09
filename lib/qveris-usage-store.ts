import { ensureBackendRls, getSharedPostgresClient, hasSharedPostgresConfig } from "@/lib/backtest-data-store"
import type { QverisExecuteResponse } from "@/lib/qveris"
import type { JSONValue, Sql } from "postgres"

export type QverisUsageCategory =
  | "realtime_quote"
  | "daily_bar"
  | "market_index"
  | "market_index_history"
  | "ai_model"
  | "non_price_data"
  | "manual"
  | "unknown"

export type QverisCallMeta = {
  source?: string
  category?: QverisUsageCategory
  symbols?: string[]
  symbolCount?: number
  route?: string
  note?: string
}

export type QverisUsageLedgerEntry = {
  id: number
  executionId?: string | null
  toolId: string
  source: string
  category: QverisUsageCategory
  status: "success" | "failure" | "exception"
  success: boolean
  startedAt: string
  finishedAt: string
  elapsedMs: number
  qverisElapsedMs?: number | null
  timeoutMs?: number | null
  maxResponseSize?: number | null
  symbolsCount: number
  billingCredits?: number | null
  cost?: number | null
  billingSummary?: string | null
  errorMessage?: string | null
  parametersSummary: Record<string, unknown>
}

export type QverisUsageSummary = {
  driver: "postgres" | "memory"
  configured: boolean
  status: "ready" | "fallback" | "error"
  from: string
  to: string
  totals: {
    calls: number
    success: number
    failure: number
    exception: number
    symbols: number
    billingCredits: number | null
    cost: number | null
    avgElapsedMs: number | null
    latestAt?: string
  }
  byCategory: QverisUsageGroup[]
  bySource: QverisUsageGroup[]
  recent: QverisUsageLedgerEntry[]
  notes: string[]
  error?: string
}

export type QverisUsageGroup = {
  key: string
  calls: number
  success: number
  failure: number
  exception: number
  symbols: number
  billingCredits: number | null
  cost: number | null
  avgElapsedMs: number | null
  latestAt?: string
}

type RecordUsageInput = {
  toolId: string
  searchId: string
  sessionId?: string
  parameters: Record<string, unknown>
  maxResponseSize?: number
  timeoutMs?: number
  startedAt: Date
  finishedAt: Date
  elapsedMs: number
  response?: QverisExecuteResponse<unknown>
  error?: unknown
  meta?: QverisCallMeta
}

type UsageRow = {
  id: number
  execution_id: string | null
  tool_id: string
  source: string
  category: QverisUsageCategory
  status: "success" | "failure" | "exception"
  success: boolean
  started_at: string | Date
  finished_at: string | Date
  elapsed_time_ms: number | null
  qveris_elapsed_time_ms: number | null
  timeout_ms: number | null
  max_response_size: number | null
  symbols_count: number | null
  billing_credits: number | null
  cost: number | null
  billing_summary: string | null
  error_message: string | null
  parameters_summary: unknown
}

type GroupRow = {
  key: string
  calls: string | number
  success: string | number
  failure: string | number
  exception: string | number
  symbols: string | number | null
  billing_credits: string | number | null
  cost: string | number | null
  avg_elapsed_ms: string | number | null
  latest_at: string | Date | null
}

type TotalsRow = {
  calls: string | number
  success: string | number
  failure: string | number
  exception: string | number
  symbols: string | number | null
  billing_credits: string | number | null
  cost: string | number | null
  avg_elapsed_ms: string | number | null
  latest_at: string | Date | null
}

const TABLE = "qveris_usage_ledger"
const DEFAULT_LOG_TIMEOUT_MS = 900
let tableReady = false
let lastTableError: string | undefined

export async function recordQverisUsage(input: RecordUsageInput) {
  if (!hasSharedPostgresConfig()) return false
  const summary = summarizeParameters(input.parameters, input.meta)
  const symbolsCount = input.meta?.symbolCount ?? inferSymbolCount(input.parameters, input.meta)
  const status = input.response ? (input.response.success ? "success" : "failure") : "exception"
  const errorMessage = input.response?.error_message ?? errorMessageFrom(input.error)

  return withTimeout(writeUsageRow({
    ...input,
    status,
    symbolsCount,
    parametersSummary: summary,
    errorMessage,
  }), false, DEFAULT_LOG_TIMEOUT_MS)
}

export async function getQverisUsageSummary({
  days = 7,
  limit = 80,
}: {
  days?: number
  limit?: number
} = {}): Promise<QverisUsageSummary> {
  const to = new Date()
  const from = new Date(to.getTime() - Math.max(1, Math.min(days, 30)) * 24 * 60 * 60_000)
  if (!hasSharedPostgresConfig()) {
    return fallbackSummary(from, to, "Postgres/Supabase 未配置，无法持久统计 Qveris 付费调用。", undefined, false)
  }
  if (!(await ensureQverisUsageTable())) {
    return fallbackSummary(
      from,
      to,
      "Qveris 用量账本暂未就绪；这不影响数据源目录和 Qveris 工具调用。请确认 Python API 服务已启动并完成数据库迁移。",
      lastTableError,
      true,
      lastTableError ? "error" : "fallback",
    )
  }

  try {
    const sql = await getSharedPostgresClient()
    const cappedLimit = Math.max(10, Math.min(limit, 200))
    const [totalsRows, categoryRows, sourceRows, recentRows] = await Promise.all([
      sql<TotalsRow[]>`
        select
          count(*) as calls,
          count(*) filter (where status = 'success') as success,
          count(*) filter (where status = 'failure') as failure,
          count(*) filter (where status = 'exception') as exception,
          coalesce(sum(symbols_count), 0) as symbols,
          sum(billing_credits) as billing_credits,
          sum(cost) as cost,
          avg(elapsed_time_ms) as avg_elapsed_ms,
          max(finished_at) as latest_at
        from qveris_usage_ledger
        where created_at >= ${from.toISOString()}
      `,
      groupedQuery(sql, "category", from),
      groupedQuery(sql, "source", from),
      sql<UsageRow[]>`
        select
          id, execution_id, tool_id, source, category, status, success,
          started_at, finished_at, elapsed_time_ms, qveris_elapsed_time_ms,
          timeout_ms, max_response_size, symbols_count, billing_credits, cost,
          billing_summary, error_message, parameters_summary
        from qveris_usage_ledger
        order by created_at desc
        limit ${cappedLimit}
      `,
    ])

    const totals = totalsRows[0] ?? {
      calls: 0,
      success: 0,
      failure: 0,
      exception: 0,
      symbols: 0,
      billing_credits: null,
      cost: null,
      avg_elapsed_ms: null,
      latest_at: null,
    }

    return {
      driver: "postgres",
      configured: true,
      status: "ready",
      from: from.toISOString(),
      to: to.toISOString(),
      totals: {
        calls: intValue(totals.calls),
        success: intValue(totals.success),
        failure: intValue(totals.failure),
        exception: intValue(totals.exception),
        symbols: intValue(totals.symbols),
        billingCredits: nullableNumber(totals.billing_credits),
        cost: nullableNumber(totals.cost),
        avgElapsedMs: nullableNumber(totals.avg_elapsed_ms),
        latestAt: dateString(totals.latest_at),
      },
      byCategory: categoryRows.map(groupFromRow),
      bySource: sourceRows.map(groupFromRow),
      recent: recentRows.map(entryFromRow),
      notes: [
        "只统计接入账本后的 Qveris /tools/execute；历史调用无法回溯。",
        "discover/search 不进入账本；页面里的 qverisCount 代表真实数据覆盖数，不等于本次付费调用数。",
      ],
    }
  } catch (error) {
    return fallbackSummary(from, to, "Qveris 用量账本读取失败。", errorMessageFrom(error), true)
  }
}

async function writeUsageRow(input: RecordUsageInput & {
  status: "success" | "failure" | "exception"
  symbolsCount: number
  parametersSummary: Record<string, unknown>
  errorMessage?: string
}) {
  if (!(await ensureQverisUsageTable())) return false
  try {
    const sql = await getSharedPostgresClient()
    await sql`
      insert into qveris_usage_ledger (
        execution_id, tool_id, search_id, session_id_hash, source, category, status,
        success, started_at, finished_at, elapsed_time_ms, qveris_elapsed_time_ms,
        timeout_ms, max_response_size, symbols_count, billing_credits, cost,
        billing_summary, error_message, parameters_summary
      ) values (
        ${input.response?.execution_id ?? null},
        ${input.toolId},
        ${input.searchId},
        ${input.sessionId ? hashText(input.sessionId) : null},
        ${input.meta?.source ?? sourceFromTool(input.toolId)},
        ${input.meta?.category ?? categoryFromTool(input.toolId)},
        ${input.status},
        ${input.response?.success ?? false},
        ${input.startedAt.toISOString()},
        ${input.finishedAt.toISOString()},
        ${input.elapsedMs},
        ${input.response?.elapsed_time_ms ?? null},
        ${input.timeoutMs ?? null},
        ${input.maxResponseSize ?? null},
        ${input.symbolsCount},
        ${input.response?.billing?.list_amount_credits ?? null},
        ${input.response?.cost ?? null},
        ${input.response?.billing?.summary ?? null},
        ${input.errorMessage ?? null},
        ${sql.json(input.parametersSummary as JSONValue)}
      )
    `
    return true
  } catch {
    return false
  }
}

async function ensureQverisUsageTable() {
  if (tableReady) return true
  if (!hasSharedPostgresConfig()) return false
  try {
    const sql = await getSharedPostgresClient()
    try {
      await checkQverisUsageTableSchema(sql)
      tableReady = true
      lastTableError = undefined
      return true
    } catch (error) {
      if (isUndefinedColumn(error)) {
        await ensureQverisUsageTableMigrations(sql)
        await checkQverisUsageTableSchema(sql)
        tableReady = true
        lastTableError = undefined
        return true
      }
      if (!isUndefinedTable(error)) throw error
    }

    await sql`
      create table if not exists qveris_usage_ledger (
        id bigserial primary key,
        execution_id text,
        tool_id text not null,
        search_id text,
        session_id_hash text,
        source text not null default 'unknown',
        category text not null default 'unknown',
        status text not null default 'success',
        success boolean not null default false,
        started_at timestamptz not null,
        finished_at timestamptz not null,
        elapsed_time_ms integer,
        qveris_elapsed_time_ms integer,
        timeout_ms integer,
        max_response_size integer,
        symbols_count integer not null default 0,
        billing_credits double precision,
        cost double precision,
        billing_summary text,
        error_message text,
        parameters_summary jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      )
    `
    await sql`create index if not exists qveris_usage_ledger_created_idx on qveris_usage_ledger (created_at desc)`
    await sql`create index if not exists qveris_usage_ledger_category_idx on qveris_usage_ledger (category, created_at desc)`
    await sql`create index if not exists qveris_usage_ledger_source_idx on qveris_usage_ledger (source, created_at desc)`
    await sql`create index if not exists qveris_usage_ledger_tool_idx on qveris_usage_ledger (tool_id, created_at desc)`
    await ensureBackendRls(sql, [TABLE])
    tableReady = true
    lastTableError = undefined
    return true
  } catch (error) {
    lastTableError = errorMessageFrom(error)
    console.warn("[qveris-usage-store] usage ledger initialization failed", error)
    return false
  }
}

async function checkQverisUsageTableSchema(sql: Sql) {
  await sql`
    select
      id, execution_id, tool_id, search_id, session_id_hash, source, category, status, success,
      started_at, finished_at, elapsed_time_ms, qveris_elapsed_time_ms, timeout_ms,
      max_response_size, symbols_count, billing_credits, cost, billing_summary,
      error_message, parameters_summary, created_at
    from qveris_usage_ledger
    where false
  `
}

async function ensureQverisUsageTableMigrations(sql: Sql) {
  await sql`alter table qveris_usage_ledger add column if not exists execution_id text`
  await sql`alter table qveris_usage_ledger add column if not exists tool_id text`
  await sql`alter table qveris_usage_ledger add column if not exists search_id text`
  await sql`alter table qveris_usage_ledger add column if not exists session_id_hash text`
  await sql`alter table qveris_usage_ledger add column if not exists source text not null default 'unknown'`
  await sql`alter table qveris_usage_ledger add column if not exists category text not null default 'unknown'`
  await sql`alter table qveris_usage_ledger add column if not exists status text not null default 'success'`
  await sql`alter table qveris_usage_ledger add column if not exists success boolean not null default false`
  await sql`alter table qveris_usage_ledger add column if not exists started_at timestamptz`
  await sql`alter table qveris_usage_ledger add column if not exists finished_at timestamptz`
  await sql`alter table qveris_usage_ledger add column if not exists elapsed_time_ms integer`
  await sql`alter table qveris_usage_ledger add column if not exists qveris_elapsed_time_ms integer`
  await sql`alter table qveris_usage_ledger add column if not exists timeout_ms integer`
  await sql`alter table qveris_usage_ledger add column if not exists max_response_size integer`
  await sql`alter table qveris_usage_ledger add column if not exists symbols_count integer not null default 0`
  await sql`alter table qveris_usage_ledger add column if not exists billing_credits double precision`
  await sql`alter table qveris_usage_ledger add column if not exists cost double precision`
  await sql`alter table qveris_usage_ledger add column if not exists billing_summary text`
  await sql`alter table qveris_usage_ledger add column if not exists error_message text`
  await sql`alter table qveris_usage_ledger add column if not exists parameters_summary jsonb not null default '{}'::jsonb`
  await sql`alter table qveris_usage_ledger add column if not exists created_at timestamptz not null default now()`
  await sql`update qveris_usage_ledger set tool_id = 'unknown' where tool_id is null`
  await sql`alter table qveris_usage_ledger alter column tool_id set not null`
  await sql`update qveris_usage_ledger set started_at = coalesce(started_at, created_at, now()) where started_at is null`
  await sql`update qveris_usage_ledger set finished_at = coalesce(finished_at, started_at, created_at, now()) where finished_at is null`
  await sql`alter table qveris_usage_ledger alter column started_at set not null`
  await sql`alter table qveris_usage_ledger alter column finished_at set not null`
  await sql`create index if not exists qveris_usage_ledger_created_idx on qveris_usage_ledger (created_at desc)`
  await sql`create index if not exists qveris_usage_ledger_category_idx on qveris_usage_ledger (category, created_at desc)`
  await sql`create index if not exists qveris_usage_ledger_source_idx on qveris_usage_ledger (source, created_at desc)`
  await sql`create index if not exists qveris_usage_ledger_tool_idx on qveris_usage_ledger (tool_id, created_at desc)`
  await ensureBackendRls(sql, [TABLE])
}

function groupedQuery(sql: Sql, field: "category" | "source", from: Date) {
  return sql<GroupRow[]>`
    select
      ${sql.unsafe(field)} as key,
      count(*) as calls,
      count(*) filter (where status = 'success') as success,
      count(*) filter (where status = 'failure') as failure,
      count(*) filter (where status = 'exception') as exception,
      coalesce(sum(symbols_count), 0) as symbols,
      sum(billing_credits) as billing_credits,
      sum(cost) as cost,
      avg(elapsed_time_ms) as avg_elapsed_ms,
      max(finished_at) as latest_at
    from qveris_usage_ledger
    where created_at >= ${from.toISOString()}
    group by ${sql.unsafe(field)}
    order by calls desc, latest_at desc
    limit 12
  `
}

function fallbackSummary(
  from: Date,
  to: Date,
  note: string,
  error?: string,
  configured = false,
  status: QverisUsageSummary["status"] = error ? "error" : "fallback",
): QverisUsageSummary {
  return {
    driver: "memory",
    configured,
    status,
    from: from.toISOString(),
    to: to.toISOString(),
    totals: {
      calls: 0,
      success: 0,
      failure: 0,
      exception: 0,
      symbols: 0,
      billingCredits: null,
      cost: null,
      avgElapsedMs: null,
    },
    byCategory: [],
    bySource: [],
    recent: [],
    notes: [note],
    error,
  }
}

function entryFromRow(row: UsageRow): QverisUsageLedgerEntry {
  return {
    id: row.id,
    executionId: row.execution_id,
    toolId: row.tool_id,
    source: row.source,
    category: row.category,
    status: row.status,
    success: row.success,
    startedAt: dateString(row.started_at) ?? new Date().toISOString(),
    finishedAt: dateString(row.finished_at) ?? new Date().toISOString(),
    elapsedMs: row.elapsed_time_ms ?? 0,
    qverisElapsedMs: row.qveris_elapsed_time_ms,
    timeoutMs: row.timeout_ms,
    maxResponseSize: row.max_response_size,
    symbolsCount: row.symbols_count ?? 0,
    billingCredits: row.billing_credits,
    cost: row.cost,
    billingSummary: row.billing_summary,
    errorMessage: row.error_message,
    parametersSummary: objectValue(row.parameters_summary),
  }
}

function groupFromRow(row: GroupRow): QverisUsageGroup {
  return {
    key: row.key,
    calls: intValue(row.calls),
    success: intValue(row.success),
    failure: intValue(row.failure),
    exception: intValue(row.exception),
    symbols: intValue(row.symbols),
    billingCredits: nullableNumber(row.billing_credits),
    cost: nullableNumber(row.cost),
    avgElapsedMs: nullableNumber(row.avg_elapsed_ms),
    latestAt: dateString(row.latest_at),
  }
}

function summarizeParameters(parameters: Record<string, unknown>, meta?: QverisCallMeta) {
  const symbols = meta?.symbols?.length ? meta.symbols : inferSymbols(parameters)
  const summary: Record<string, unknown> = {
    keys: Object.keys(parameters).slice(0, 20),
    symbols: symbols.slice(0, 20),
    symbolsCount: meta?.symbolCount ?? symbols.length,
  }
  for (const key of ["model", "interval", "cps", "startdate", "enddate", "indicators", "pageNo", "pageSize", "beginDate", "endDate"]) {
    if (parameters[key] != null) summary[key] = parameters[key]
  }
  if (meta?.route) summary.route = meta.route
  if (meta?.note) summary.note = meta.note
  if (Array.isArray(parameters.messages)) summary.messages = `${parameters.messages.length} messages`
  if (typeof parameters.input === "string") summary.inputPreview = parameters.input.slice(0, 80)
  return summary
}

function inferSymbolCount(parameters: Record<string, unknown>, meta?: QverisCallMeta) {
  if (meta?.symbols?.length) return meta.symbols.length
  const symbols = inferSymbols(parameters)
  return symbols.length
}

function inferSymbols(parameters: Record<string, unknown>) {
  const candidates: string[] = []
  for (const key of ["codes", "symbol", "tsCode"]) {
    const value = parameters[key]
    if (typeof value === "string") candidates.push(...value.split(",").map((item) => item.trim()).filter(Boolean))
  }
  const stockObject = parameters.stockObject
  if (Array.isArray(stockObject)) {
    candidates.push(...stockObject.filter((item): item is string => typeof item === "string"))
  }
  return Array.from(new Set(candidates)).slice(0, 500)
}

function categoryFromTool(toolId: string): QverisUsageCategory {
  if (/live_quote|real_time_quotation/i.test(toolId)) return "realtime_quote"
  if (/adjusted_price/i.test(toolId)) return "daily_bar"
  if (/aigateway|chat|completion|bigmodel/i.test(toolId)) return "ai_model"
  if (/fund|flow|news|announcement|balance|statement|dragon|tiger|bo_statistics/i.test(toolId)) return "non_price_data"
  return "unknown"
}

function sourceFromTool(toolId: string) {
  return categoryFromTool(toolId).replace(/_/g, "-")
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function nullableNumber(value: unknown) {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function intValue(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

function dateString(value: unknown) {
  if (!value) return undefined
  if (value instanceof Date) return value.toISOString()
  const d = new Date(String(value))
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

function hashText(value: string) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

function errorMessageFrom(error: unknown) {
  return error instanceof Error ? error.message : error ? String(error) : undefined
}

function isUndefinedTable(error: unknown) {
  const err = error as { code?: string; message?: string }
  return err?.code === "42P01" || /does not exist|undefined_table/i.test(err?.message ?? "")
}

function isUndefinedColumn(error: unknown) {
  const err = error as { code?: string; message?: string }
  return err?.code === "42703" || /column .* does not exist|undefined_column/i.test(err?.message ?? "")
}

async function withTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
