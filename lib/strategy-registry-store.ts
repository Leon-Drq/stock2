import { getSharedPostgresClient, hasSharedPostgresConfig } from "@/lib/backtest-data-store"
import type { BacktestReport } from "@/lib/backtest"
import type { StrategyAdmission } from "@/lib/catalog"
import { syncPaperDeploymentAccounts } from "@/lib/paper-trading-store"
import type { StrategyMiningCandidate } from "@/lib/strategy-miner"
import type { JSONValue } from "postgres"

export type StrategyRegistrySource = "catalog" | "miner" | "lab"
export type StrategyRegistryStatus = "queued" | "running" | "radar-ready" | "watchlist" | "blocked" | "failed"
export type BacktestJobKind = "catalog" | "mine"
export type BacktestJobStatus = "queued" | "running" | "succeeded" | "failed"

export type StrategyRegistryEntry = {
  strategyId: string
  name: string
  source: StrategyRegistrySource
  status: StrategyRegistryStatus
  admissionStatus?: string
  admissionGate?: string
  score: number
  annualReturn?: number
  maxDrawdown?: number
  sharpe?: number
  winRate?: number
  lastBacktestJobId?: string
  lastBacktestedAt?: string
  metadata?: StrategyRegistryMetadata
  updatedAt: string
}

export type StrategyRegistryMetadata = {
  backtestSource?: string
  period?: BacktestReport["period"]
  admission?: StrategyAdmission
  sourceKind?: string
  sourceName?: string
  sourceUrl?: string
  sourceQuery?: string
  hypothesis?: string
  dsl?: unknown
  research?: unknown
  incubation?: unknown
  factors?: string[]
}

export type BacktestJobRecord = {
  jobId: string
  kind: BacktestJobKind
  strategyId?: string
  strategyName?: string
  source: StrategyRegistrySource
  status: BacktestJobStatus
  requestedAt: string
  startedAt?: string
  finishedAt?: string
  error?: string
  summary?: string
  reportCount?: number
  updatedAt: string
}

export type StrategyRegistrySnapshot = {
  driver: "postgres" | "memory"
  configured: boolean
  status: "ready" | "fallback" | "error"
  entries: StrategyRegistryEntry[]
  jobs: BacktestJobRecord[]
  summary: {
    total: number
    radarReady: number
    watchlist: number
    blocked: number
    queuedJobs: number
    runningJobs: number
  }
  error?: string
}

type MemoryState = {
  entries: Map<string, StrategyRegistryEntry>
  jobs: Map<string, BacktestJobRecord & { reportPayload?: unknown }>
}

declare global {
  var __stockRadarStrategyRegistry: MemoryState | undefined
}

let registryTablesReady = false
let registryPostgresUnavailable = false

function memoryState() {
  globalThis.__stockRadarStrategyRegistry ??= { entries: new Map(), jobs: new Map() }
  return globalThis.__stockRadarStrategyRegistry
}

export async function getStrategyRegistrySnapshot(limit = 80): Promise<StrategyRegistrySnapshot> {
  try {
    if (await ensureRegistryTables()) {
      const sql = await getSharedPostgresClient()
      const [entries, jobs] = await Promise.all([
        sql<StrategyRegistryEntry[]>`
          select
            strategy_id as "strategyId",
            name,
            source,
            status,
            admission_status as "admissionStatus",
            admission_gate as "admissionGate",
            score,
            annual_return as "annualReturn",
            max_drawdown as "maxDrawdown",
            sharpe,
            win_rate as "winRate",
            last_backtest_job_id as "lastBacktestJobId",
            last_backtested_at as "lastBacktestedAt",
            metadata,
            updated_at as "updatedAt"
          from strategy_registry
          order by score desc, updated_at desc
          limit ${limit}
        `,
        sql<BacktestJobRecord[]>`
          select
            job_id as "jobId",
            kind,
            nullif(strategy_id, '__catalog__') as "strategyId",
            strategy_name as "strategyName",
            source,
            status,
            requested_at as "requestedAt",
            started_at as "startedAt",
            finished_at as "finishedAt",
            error,
            summary,
            report_count as "reportCount",
            updated_at as "updatedAt"
          from strategy_backtest_jobs
          order by requested_at desc
          limit 20
        `,
      ])
      return buildSnapshot("postgres", true, "ready", entries.map(normalizeEntry), jobs.map(normalizeJob))
    }
  } catch (error) {
    return buildSnapshot("postgres", true, "error", [], [], error instanceof Error ? error.message : String(error))
  }

  const state = memoryState()
  return buildSnapshot("memory", false, "fallback", Array.from(state.entries.values()), Array.from(state.jobs.values()))
}

export async function getStrategyRegistryEntry(strategyId: string): Promise<StrategyRegistryEntry | null> {
  try {
    if (await ensureRegistryTables()) {
      const sql = await getSharedPostgresClient()
      const rows = await sql<StrategyRegistryEntry[]>`
        select
          strategy_id as "strategyId",
          name,
          source,
          status,
          admission_status as "admissionStatus",
          admission_gate as "admissionGate",
          score,
          annual_return as "annualReturn",
          max_drawdown as "maxDrawdown",
          sharpe,
          win_rate as "winRate",
          last_backtest_job_id as "lastBacktestJobId",
          last_backtested_at as "lastBacktestedAt",
          metadata,
          updated_at as "updatedAt"
        from strategy_registry
        where strategy_id = ${strategyId}
        limit 1
      `
      return rows[0] ? normalizeEntry(rows[0]) : null
    }
  } catch {
    return null
  }

  const entry = memoryState().entries.get(strategyId)
  return entry ? normalizeEntry(entry) : null
}

export async function getLatestCatalogBacktestPayload(): Promise<{ generatedAt: string; notes: string[]; reports: BacktestReport[] } | null> {
  try {
    if (await ensureRegistryTables()) {
      const sql = await getSharedPostgresClient()
      const rows = await sql<Array<{ reportPayload: unknown }>>`
        select report_payload as "reportPayload"
        from strategy_backtest_jobs
        where kind = 'catalog'
          and status = 'succeeded'
          and report_payload is not null
        order by finished_at desc nulls last, requested_at desc
        limit 1
      `
      return normalizeBacktestPayload(rows[0]?.reportPayload)
    }
  } catch {
    return null
  }

  const job = Array.from(memoryState().jobs.values())
    .filter((item) => item.kind === "catalog" && item.status === "succeeded" && item.reportPayload)
    .sort((a, b) => Date.parse(b.finishedAt ?? b.requestedAt) - Date.parse(a.finishedAt ?? a.requestedAt))[0]
  return normalizeBacktestPayload(job?.reportPayload)
}

export async function createBacktestJob(input: {
  kind: BacktestJobKind
  strategyId?: string
  strategyName?: string
  source?: StrategyRegistrySource
}) {
  const now = new Date().toISOString()
  const job: BacktestJobRecord = {
    jobId: `bt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind: input.kind,
    strategyId: input.kind === "catalog" ? undefined : input.strategyId,
    strategyName: input.strategyName,
    source: input.source ?? (input.kind === "mine" ? "miner" : "catalog"),
    status: "queued",
    requestedAt: now,
    updatedAt: now,
  }

  if (await ensureRegistryTables()) {
    const sql = await getSharedPostgresClient()
    await sql`
      insert into strategy_backtest_jobs (
        job_id, kind, strategy_id, strategy_name, source, status, requested_at, updated_at
      ) values (
        ${job.jobId},
        ${job.kind},
        ${job.strategyId ?? "__catalog__"},
        ${job.strategyName ?? null},
        ${job.source},
        ${job.status},
        ${job.requestedAt},
        ${job.updatedAt}
      )
    `
  } else {
    memoryState().jobs.set(job.jobId, job)
  }

  return job
}

export async function ensureBacktestJob(input: {
  kind: BacktestJobKind
  strategyId?: string
  strategyName?: string
  source?: StrategyRegistrySource
}) {
  if (await ensureRegistryTables()) {
    const sql = await getSharedPostgresClient()
    const rows = await sql<BacktestJobRecord[]>`
      select
        job_id as "jobId",
        kind,
        nullif(strategy_id, '__catalog__') as "strategyId",
        strategy_name as "strategyName",
        source,
        status,
        requested_at as "requestedAt",
        started_at as "startedAt",
        finished_at as "finishedAt",
        error,
        summary,
        report_count as "reportCount",
        updated_at as "updatedAt"
      from strategy_backtest_jobs
      where kind = ${input.kind}
        and strategy_id = ${input.kind === "catalog" ? "__catalog__" : input.strategyId ?? "__missing__"}
        and status in ('queued', 'running')
      order by requested_at desc
      limit 1
    `
    if (rows[0]) return normalizeJob(rows[0])
  } else {
    const existing = Array.from(memoryState().jobs.values()).find((job) => (
      job.kind === input.kind &&
      job.strategyId === (input.kind === "catalog" ? undefined : input.strategyId) &&
      (job.status === "queued" || job.status === "running")
    ))
    if (existing) return normalizeJob(existing)
  }

  return createBacktestJob(input)
}

export async function getQueuedBacktestJob(jobId?: string) {
  if (await ensureRegistryTables()) {
    const sql = await getSharedPostgresClient()
    const rows = jobId
      ? await sql<BacktestJobRecord[]>`
          select job_id as "jobId", kind, nullif(strategy_id, '__catalog__') as "strategyId", strategy_name as "strategyName", source, status, requested_at as "requestedAt", started_at as "startedAt", finished_at as "finishedAt", error, summary, report_count as "reportCount", updated_at as "updatedAt"
          from strategy_backtest_jobs
          where job_id = ${jobId}
          limit 1
        `
      : await sql<BacktestJobRecord[]>`
          select job_id as "jobId", kind, nullif(strategy_id, '__catalog__') as "strategyId", strategy_name as "strategyName", source, status, requested_at as "requestedAt", started_at as "startedAt", finished_at as "finishedAt", error, summary, report_count as "reportCount", updated_at as "updatedAt"
          from strategy_backtest_jobs
          where status = 'queued'
          order by requested_at asc
          limit 1
        `
    return rows[0] ? normalizeJob(rows[0]) : null
  }

  const jobs = Array.from(memoryState().jobs.values())
  return jobId ? jobs.find((job) => job.jobId === jobId) ?? null : jobs.find((job) => job.status === "queued") ?? null
}

export async function markBacktestJobRunning(jobId: string) {
  const now = new Date().toISOString()
  await updateJob(jobId, { status: "running", startedAt: now, updatedAt: now })
}

export async function completeBacktestJob(jobId: string, input: { reportCount: number; summary: string; reportPayload?: unknown }) {
  const now = new Date().toISOString()
  await updateJob(jobId, {
    status: "succeeded",
    finishedAt: now,
    updatedAt: now,
    reportCount: input.reportCount,
    summary: input.summary,
    reportPayload: input.reportPayload,
  })
}

export async function failBacktestJob(jobId: string, error: string) {
  const now = new Date().toISOString()
  await updateJob(jobId, { status: "failed", finishedAt: now, updatedAt: now, error })
}

export async function syncStrategyRegistryFromReports(reports: BacktestReport[], jobId?: string) {
  const entries: StrategyRegistryEntry[] = []
  for (const report of reports) {
    entries.push(await upsertStrategyRegistryFromReport(report, jobId))
  }
  if (entries.length) {
    try {
      await syncPaperDeploymentAccounts(entries, { source: jobId ? `backtest-job:${jobId}` : "strategy-registry-sync" })
    } catch {
      // 注册表同步是主路径；模拟盘账户预热失败时不能反向阻断回测结果写入。
    }
  }
  return entries
}

export async function syncStrategyRegistryFromMiningCandidates(candidates: StrategyMiningCandidate[], jobId?: string) {
  const entries: StrategyRegistryEntry[] = []
  const queuedJobs: BacktestJobRecord[] = []
  for (const candidate of candidates) {
    if (!candidate.report) {
      const existing = await getStrategyRegistryEntry(candidate.strategy.id)
      if (existing?.lastBacktestedAt) {
        entries.push(existing)
        continue
      }
      const job = await ensureBacktestJob({
        kind: "mine",
        strategyId: candidate.strategy.id,
        strategyName: candidate.strategy.name,
        source: "miner",
      })
      queuedJobs.push(job)
      const entry = miningCandidateToEntry(candidate, job.jobId)
      await upsertStrategyRegistryEntry(entry)
      entries.push(entry)
      continue
    }

    const entry = miningCandidateToEntry(candidate, jobId)
    await upsertStrategyRegistryEntry(entry)
    entries.push(entry)
  }

  if (entries.length) {
    try {
      await syncPaperDeploymentAccounts(entries, { source: jobId ? `mining-job:${jobId}` : "strategy-miner-sync" })
    } catch {
      // 这里只同步注册表为主；模拟盘预热失败不能阻断策略准入队列。
    }
  }

  return { entries, queuedJobs }
}

export async function upsertStrategyRegistryFromReport(report: BacktestReport, jobId?: string) {
  const entry = entryFromReport(report, jobId)
  await upsertStrategyRegistryEntry(entry)
  return entry
}

async function upsertStrategyRegistryEntry(entry: StrategyRegistryEntry) {
  if (await ensureRegistryTables()) {
    const sql = await getSharedPostgresClient()
    await sql`
      insert into strategy_registry (
        strategy_id, name, source, status, admission_status, admission_gate, score,
        annual_return, max_drawdown, sharpe, win_rate, last_backtest_job_id,
        last_backtested_at, metadata, updated_at
      ) values (
        ${entry.strategyId},
        ${entry.name},
        ${entry.source},
        ${entry.status},
        ${entry.admissionStatus ?? null},
        ${entry.admissionGate ?? null},
        ${entry.score},
        ${entry.annualReturn ?? null},
        ${entry.maxDrawdown ?? null},
        ${entry.sharpe ?? null},
        ${entry.winRate ?? null},
        ${entry.lastBacktestJobId ?? null},
        ${entry.lastBacktestedAt ?? null},
        ${sql.json(toJsonValue(entry.metadata ?? {}))},
        ${entry.updatedAt}
      )
      on conflict (strategy_id) do update set
        name = excluded.name,
        source = excluded.source,
        status = excluded.status,
        admission_status = excluded.admission_status,
        admission_gate = excluded.admission_gate,
        score = excluded.score,
        annual_return = excluded.annual_return,
        max_drawdown = excluded.max_drawdown,
        sharpe = excluded.sharpe,
        win_rate = excluded.win_rate,
        last_backtest_job_id = excluded.last_backtest_job_id,
        last_backtested_at = excluded.last_backtested_at,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
    `
  } else {
    memoryState().entries.set(entry.strategyId, entry)
  }
}

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JSONValue
}

async function updateJob(jobId: string, patch: Partial<BacktestJobRecord> & { reportPayload?: unknown }) {
  if (await ensureRegistryTables()) {
    const sql = await getSharedPostgresClient()
    await sql`
      update strategy_backtest_jobs set
        status = ${patch.status ?? null},
        started_at = coalesce(${patch.startedAt ?? null}, started_at),
        finished_at = coalesce(${patch.finishedAt ?? null}, finished_at),
        error = ${patch.error ?? null},
        summary = coalesce(${patch.summary ?? null}, summary),
        report_count = coalesce(${patch.reportCount ?? null}, report_count),
        report_payload = coalesce(${patch.reportPayload ? sql.json(patch.reportPayload as Parameters<typeof sql.json>[0]) : null}, report_payload),
        updated_at = ${patch.updatedAt ?? new Date().toISOString()}
      where job_id = ${jobId}
    `
    return
  }

  const state = memoryState()
  const current = state.jobs.get(jobId)
  if (current) state.jobs.set(jobId, { ...current, ...patch })
}

async function ensureRegistryTables() {
  if (registryTablesReady) return true
  if (registryPostgresUnavailable || !hasSharedPostgresConfig()) return false

  try {
    const sql = await getSharedPostgresClient()
    await sql`select strategy_id from strategy_registry where false`
    await sql`select job_id from strategy_backtest_jobs where false`
    registryTablesReady = true
    return true
  } catch (error) {
    if (!isMissingSchemaObject(error)) {
      registryPostgresUnavailable = true
      return false
    }
  }

  try {
    const sql = await getSharedPostgresClient()
    await sql`
      create table if not exists strategy_registry (
        strategy_id text primary key,
        name text not null,
        source text not null,
        status text not null,
        admission_status text,
        admission_gate text,
        score double precision not null default 0,
        annual_return double precision,
        max_drawdown double precision,
        sharpe double precision,
        win_rate double precision,
        last_backtest_job_id text,
        last_backtested_at timestamptz,
        metadata jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now()
      )
    `
    await sql`
      create table if not exists strategy_backtest_jobs (
        job_id text primary key,
        kind text not null,
        strategy_id text not null,
        strategy_name text,
        source text not null,
        status text not null,
        requested_at timestamptz not null default now(),
        started_at timestamptz,
        finished_at timestamptz,
        error text,
        summary text,
        report_count integer,
        report_payload jsonb,
        updated_at timestamptz not null default now()
      )
    `
    await tryEnsureStrategyRegistryIndexes(sql)
    registryTablesReady = true
    return true
  } catch {
    registryPostgresUnavailable = true
    return false
  }
}

async function ensureStrategyRegistryIndexes(sql: Awaited<ReturnType<typeof getSharedPostgresClient>>) {
  await sql`create index if not exists strategy_registry_status_idx on strategy_registry (status, score desc)`
  await sql`create index if not exists strategy_registry_score_updated_idx on strategy_registry (score desc, updated_at desc)`
  await sql`create index if not exists strategy_backtest_jobs_status_idx on strategy_backtest_jobs (status, requested_at desc)`
  await sql`create index if not exists strategy_backtest_jobs_requested_idx on strategy_backtest_jobs (requested_at desc)`
}

async function tryEnsureStrategyRegistryIndexes(sql: Awaited<ReturnType<typeof getSharedPostgresClient>>) {
  try {
    await ensureStrategyRegistryIndexes(sql)
  } catch {
    // Index creation is a best-effort runtime optimization, not a reason to hide existing strategy data.
  }
}

function entryFromReport(report: BacktestReport, jobId?: string): StrategyRegistryEntry {
  const admission = report.diagnosis.admission
  return {
    strategyId: report.strategyId,
    name: report.strategyName,
    source: report.strategyId.startsWith("mine-") ? "miner" : report.strategyId.startsWith("lab-") ? "lab" : "catalog",
    status: admission.status,
    admissionStatus: admission.status,
    admissionGate: admission.gate,
    score: scoreReport(report),
    annualReturn: metricValue(report, "策略年化收益"),
    maxDrawdown: Math.abs(metricValue(report, "最大回撤")),
    sharpe: metricValue(report, "夏普比率"),
    winRate: metricValue(report, "胜率"),
    lastBacktestJobId: jobId,
    lastBacktestedAt: report.dataSource.finishedAt,
    metadata: {
      backtestSource: report.backtestSource,
      period: report.period,
      admission: report.diagnosis.admission,
    },
    updatedAt: new Date().toISOString(),
  }
}

function miningCandidateToEntry(candidate: StrategyMiningCandidate, jobId?: string): StrategyRegistryEntry {
  if (candidate.report) {
    const entry = entryFromReport(candidate.report, jobId)
    return {
      ...entry,
      source: "miner",
      metadata: {
        ...(entry.metadata ?? {}),
        sourceKind: candidate.source.kind,
        sourceName: candidate.source.name,
        sourceUrl: candidate.source.url,
        sourceQuery: candidate.source.query,
        hypothesis: candidate.hypothesis,
        dsl: candidate.dsl,
        research: candidate.research,
        incubation: candidate.incubation,
        factors: candidate.strategy.factors,
      },
    }
  }

  const now = new Date().toISOString()
  return {
    strategyId: candidate.strategy.id,
    name: candidate.strategy.name,
    source: "miner",
    status: "queued",
    admissionStatus: "queued",
    admissionGate: "待真实回测",
    score: 0,
    lastBacktestJobId: jobId,
    metadata: {
      sourceKind: candidate.source.kind,
      sourceName: candidate.source.name,
      sourceUrl: candidate.source.url,
      sourceQuery: candidate.source.query,
      hypothesis: candidate.hypothesis,
      dsl: candidate.dsl,
      research: candidate.research,
      factors: candidate.strategy.factors,
    },
    updatedAt: now,
  }
}

function buildSnapshot(
  driver: "postgres" | "memory",
  configured: boolean,
  status: StrategyRegistrySnapshot["status"],
  entries: StrategyRegistryEntry[],
  jobs: BacktestJobRecord[],
  error?: string,
): StrategyRegistrySnapshot {
  const radarReady = entries.filter((entry) => entry.status === "radar-ready").length
  const watchlist = entries.filter((entry) => entry.status === "watchlist").length
  const blocked = entries.filter((entry) => entry.status === "blocked").length
  return {
    driver,
    configured,
    status,
    entries,
    jobs,
    summary: {
      total: entries.length,
      radarReady,
      watchlist,
      blocked,
      queuedJobs: jobs.filter((job) => job.status === "queued").length,
      runningJobs: jobs.filter((job) => job.status === "running").length,
    },
    error,
  }
}

function normalizeEntry(entry: StrategyRegistryEntry): StrategyRegistryEntry {
  return {
    ...entry,
    lastBacktestedAt: formatDate(entry.lastBacktestedAt),
    metadata: normalizeMetadata(entry.metadata),
    updatedAt: formatDate(entry.updatedAt) ?? new Date().toISOString(),
  }
}

function normalizeJob(job: BacktestJobRecord): BacktestJobRecord {
  return {
    jobId: job.jobId,
    kind: job.kind,
    strategyId: job.strategyId,
    strategyName: job.strategyName,
    source: job.source,
    status: job.status,
    requestedAt: formatDate(job.requestedAt) ?? new Date().toISOString(),
    startedAt: formatDate(job.startedAt),
    finishedAt: formatDate(job.finishedAt),
    error: job.error,
    summary: job.summary,
    reportCount: job.reportCount,
    updatedAt: formatDate(job.updatedAt) ?? new Date().toISOString(),
  }
}

function scoreReport(report: BacktestReport) {
  const annual = metricValue(report, "策略年化收益")
  const excess = metricValue(report, "超额收益")
  const drawdown = Math.abs(metricValue(report, "最大回撤"))
  const sharpe = metricValue(report, "夏普比率")
  const winRate = metricValue(report, "胜率")
  const admission = report.diagnosis.admission
  const gateBonus = admission.status === "radar-ready" ? 20 : admission.status === "watchlist" ? 6 : -12
  return Math.round((admission.score + annual * 0.18 + excess * 0.28 + sharpe * 5 + (winRate - 50) * 0.25 - drawdown * 0.35 + gateBonus) * 10) / 10
}

function metricValue(report: BacktestReport, label: string) {
  const value = report.metrics.find((item) => item.label === label)?.value ?? "0"
  return Number(value.replace("%", "").replace(/[+,]/g, "")) || 0
}

function formatDate(value: unknown) {
  if (!value) return undefined
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function normalizeMetadata(value: unknown): StrategyRegistryMetadata | undefined {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown
      return normalizeMetadata(parsed)
    } catch {
      return undefined
    }
  }
  if (!value || typeof value !== "object") return undefined
  return value as StrategyRegistryMetadata
}

function normalizeBacktestPayload(value: unknown): { generatedAt: string; notes: string[]; reports: BacktestReport[] } | null {
  if (typeof value === "string") {
    try {
      return normalizeBacktestPayload(JSON.parse(value) as unknown)
    } catch {
      return null
    }
  }
  if (!value || typeof value !== "object") return null
  const payload = value as { generatedAt?: unknown; notes?: unknown; reports?: unknown }
  if (!Array.isArray(payload.reports)) return null
  const reports = payload.reports.filter(isBacktestReport)
  if (!reports.length) return null
  return {
    generatedAt: typeof payload.generatedAt === "string" ? payload.generatedAt : new Date().toISOString(),
    notes: Array.isArray(payload.notes) ? payload.notes.filter((item): item is string => typeof item === "string") : [],
    reports,
  }
}

function isBacktestReport(value: unknown): value is BacktestReport {
  if (!value || typeof value !== "object") return false
  const report = value as Partial<BacktestReport>
  return (
    typeof report.strategyId === "string" &&
    typeof report.strategyName === "string" &&
    Array.isArray(report.metrics) &&
    Array.isArray(report.curve) &&
    Boolean(report.diagnosis)
  )
}

function isMissingSchemaObject(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : ""
  return code === "42P01" || code === "42703" || code === "42P07"
}
