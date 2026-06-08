import { getSharedPostgresClient, hasSharedPostgresConfig } from "@/lib/backtest-data-store"
import type { BacktestReport } from "@/lib/backtest"
import type { StrategyMiningCandidate, StrategyMiningReport } from "@/lib/strategy-miner"

export type StrategyMinerStoreResult = {
  driver: "postgres" | "memory"
  persisted: boolean
  rows?: number
  error?: string
}

let strategyMinerTableReady = false
let strategyMinerUnavailable = false

export async function syncStrategyMiningReport(report: StrategyMiningReport): Promise<StrategyMinerStoreResult> {
  if (!(await ensureStrategyMinerTable())) {
    return { driver: hasSharedPostgresConfig() ? "postgres" : "memory", persisted: false }
  }

  try {
    const sql = await getSharedPostgresClient()
    const rows = report.candidates.map(candidateToRow)
    for (const chunk of chunks(rows, 50)) {
      await sql`
        insert into strategy_miner_candidates ${sql(
          chunk,
          "candidate_id",
          "strategy_id",
          "strategy_name",
          "source_kind",
          "source_name",
          "source_url",
          "source_query",
          "source_stars",
          "source_language",
          "source_license",
          "hypothesis",
          "factors",
          "frequency",
          "dsl",
          "status",
          "annual_return",
          "max_drawdown",
          "sharpe",
          "win_rate",
          "admission_status",
          "admission_score",
          "admission_reason",
          "incubation_score",
          "incubation_gate",
          "overfit_risk",
          "market_coverage",
          "incubation_payload",
          "report_payload",
          "raw_payload",
          "discovered_at",
          "backtested_at",
        )}
        on conflict (candidate_id) do update set
          strategy_id = excluded.strategy_id,
          strategy_name = excluded.strategy_name,
          source_kind = excluded.source_kind,
          source_name = excluded.source_name,
          source_url = excluded.source_url,
          source_query = excluded.source_query,
          source_stars = excluded.source_stars,
          source_language = excluded.source_language,
          source_license = excluded.source_license,
          hypothesis = excluded.hypothesis,
          factors = excluded.factors,
          frequency = excluded.frequency,
          dsl = excluded.dsl,
          status = excluded.status,
          annual_return = excluded.annual_return,
          max_drawdown = excluded.max_drawdown,
          sharpe = excluded.sharpe,
          win_rate = excluded.win_rate,
          admission_status = excluded.admission_status,
          admission_score = excluded.admission_score,
          admission_reason = excluded.admission_reason,
          incubation_score = excluded.incubation_score,
          incubation_gate = excluded.incubation_gate,
          overfit_risk = excluded.overfit_risk,
          market_coverage = excluded.market_coverage,
          incubation_payload = excluded.incubation_payload,
          report_payload = excluded.report_payload,
          raw_payload = excluded.raw_payload,
          discovered_at = excluded.discovered_at,
          backtested_at = excluded.backtested_at,
          updated_at = now()
      `
    }
    return { driver: "postgres", persisted: true, rows: rows.length }
  } catch (error) {
    return {
      driver: "postgres",
      persisted: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function getStrategyMiningBacktestReport(strategyId: string): Promise<BacktestReport | null> {
  if (!(await ensureStrategyMinerTable())) return null

  try {
    const sql = await getSharedPostgresClient()
    const rows = await sql<Array<{ reportPayload: unknown }>>`
      select report_payload as "reportPayload"
      from strategy_miner_candidates
      where (strategy_id = ${strategyId} or candidate_id = ${strategyId})
        and report_payload is not null
      order by backtested_at desc nulls last, updated_at desc
      limit 1
    `
    return normalizeBacktestReport(rows[0]?.reportPayload)
  } catch {
    return null
  }
}

async function ensureStrategyMinerTable() {
  if (strategyMinerTableReady) return true
  if (strategyMinerUnavailable || !hasSharedPostgresConfig()) return false

  try {
    const sql = await getSharedPostgresClient()
    await sql`select candidate_id from strategy_miner_candidates where false`
    strategyMinerTableReady = true
    return true
  } catch {
    strategyMinerUnavailable = true
    return false
  }
}

function candidateToRow(candidate: StrategyMiningCandidate) {
  const metrics = candidate.metrics
  return {
    candidate_id: candidate.candidateId,
    strategy_id: candidate.strategy.id,
    strategy_name: candidate.strategy.name,
    source_kind: candidate.source.kind,
    source_name: candidate.source.name,
    source_url: candidate.source.url ?? null,
    source_query: candidate.source.query ?? null,
    source_stars: candidate.source.stars ?? null,
    source_language: candidate.source.language ?? null,
    source_license: candidate.source.license ?? null,
    hypothesis: candidate.hypothesis,
    factors: candidate.strategy.factors,
    frequency: candidate.strategy.freq,
    dsl: JSON.stringify(candidate.dsl),
    status: candidate.status,
    annual_return: metrics?.annualReturn ?? null,
    max_drawdown: metrics?.maxDrawdown ?? null,
    sharpe: metrics?.sharpe ?? null,
    win_rate: metrics?.winRate ?? null,
    admission_status: candidate.report?.diagnosis.admission.status ?? null,
    admission_score: candidate.report?.diagnosis.admission.score ?? null,
    admission_reason: candidate.report?.diagnosis.admission.reason ?? null,
    incubation_score: candidate.incubation?.score ?? null,
    incubation_gate: candidate.incubation?.gate ?? null,
    overfit_risk: candidate.incubation?.overfitRisk ?? null,
    market_coverage: candidate.incubation?.marketCoverage ?? null,
    incubation_payload: JSON.stringify(candidate.incubation ?? {}),
    report_payload: JSON.stringify({
      reportVersion: 2,
      report: candidate.report,
      period: candidate.report?.period,
      diagnosis: candidate.report?.diagnosis,
      metrics: candidate.report?.metrics,
      dataSource: candidate.report?.dataSource,
      incubation: candidate.incubation,
    }),
    raw_payload: JSON.stringify(candidate.raw),
    discovered_at: new Date(candidate.discoveredAt),
    backtested_at: candidate.report ? new Date(candidate.report.dataSource.finishedAt) : null,
  }
}

function normalizeBacktestReport(payload: unknown): BacktestReport | null {
  const parsed = parsePayload(payload)
  if (!parsed || typeof parsed !== "object") return null
  const report = "report" in parsed ? (parsed as { report?: unknown }).report : parsed
  if (!isBacktestReport(report)) return null
  return report
}

function parsePayload(payload: unknown): unknown {
  if (!payload) return null
  if (typeof payload !== "string") return payload
  try {
    return JSON.parse(payload)
  } catch {
    return null
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
    Array.isArray(report.trades) &&
    Array.isArray(report.positionTrades) &&
    Boolean(report.diagnosis) &&
    Boolean(report.dataSource)
  )
}

function chunks<T>(values: T[], size: number) {
  const out: T[][] = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
  return out
}
