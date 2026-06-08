import type { Sql } from "postgres"
import { resolveWithFallback } from "@/lib/async-timeout"
import { getChinaMarketSession, shouldRunRadarScan, shouldTrackRadarPrices, type ChinaMarketSession } from "@/lib/cn-market-session"
import type { RadarReport } from "@/lib/radar-data"
import { fallbackReport } from "@/lib/radar-data"
import { buildRadarReport } from "@/lib/radar-pick"
import { ensureBackendRls, getSharedPostgresClient, hasSharedPostgresConfig, readSharedCache, writeSharedCache } from "@/lib/backtest-data-store"
import { trackOpenRadarSignals, type RadarSignalTrackingResult } from "@/lib/radar-signal-store"
import { STOCK_POOL } from "@/lib/stock-pool"

type RadarBuildDiagnostics = Awaited<ReturnType<typeof buildRadarReport>>["diagnostics"]

export type RadarSnapshotMeta = {
  source: "postgres" | "cache" | "computed" | "empty"
  tradeDate: string
  generatedAt: string
  ageMs: number
  stale: boolean
  maxAgeMs: number
  scannedSymbols?: number
  prefilteredSymbols?: number
  note?: string
}

export type RadarSnapshotPayload = {
  ok: true
  generatedAt: string
  report: RadarReport
  tracking: RadarSignalTrackingResult | null
  marketSession: ChinaMarketSession
  diagnostics: RadarBuildDiagnostics
  diagnosticsSummary: {
    source: RadarBuildDiagnostics["source"]
    qverisCount: number
    quoteCount: number
    quoteFetchedAt?: string
    quoteFallbackReason?: string
    dataFreshness?: RadarBuildDiagnostics["dataFreshness"]
    trackingUpdated: number
    trackingClosed: number
  }
  snapshot?: RadarSnapshotMeta
}

type StoredRadarSnapshotRow = {
  snapshot_key: string
  trade_date: string | Date
  generated_at: string | Date
  expires_at: string | Date
  scan_universe_size: number | null
  payload: RadarSnapshotPayload
}

const SNAPSHOT_TABLE = "radar_scan_snapshots"
const SNAPSHOT_CACHE_PREFIX = "stock-radar:radar-snapshot:v1"
const DEFAULT_OPEN_MAX_AGE_MS = 8 * 60_000
const DEFAULT_CLOSED_MAX_AGE_MS = 6 * 60 * 60_000
const DEFAULT_TTL_SECONDS = 12 * 60 * 60
const DEFAULT_TABLE_READ_TIMEOUT_MS = 2_500
const DEFAULT_CACHE_READ_TIMEOUT_MS = 1_200
const DEFAULT_TABLE_WRITE_TIMEOUT_MS = 8_000
const DEFAULT_CACHE_WRITE_TIMEOUT_MS = 2_000

let snapshotTableReady = false
let snapshotTableUnavailable = false

export function radarSnapshotMaxAgeMs(session: ChinaMarketSession) {
  if (session.isOpen || session.phase === "lunch") return numberEnv("RADAR_SNAPSHOT_MAX_AGE_MS", DEFAULT_OPEN_MAX_AGE_MS)
  return numberEnv("RADAR_SNAPSHOT_CLOSED_MAX_AGE_MS", DEFAULT_CLOSED_MAX_AGE_MS)
}

export function radarPrecomputeUniverseSize() {
  return numberEnv(
    "RADAR_PRECOMPUTE_UNIVERSE_SIZE",
    numberEnv("RADAR_SCAN_UNIVERSE_SIZE", numberEnv("SCAN_UNIVERSE_SIZE", STOCK_POOL.length)),
  )
}

export async function loadLatestRadarSnapshot({
  tradeDate,
  maxAgeMs,
  allowStale = true,
}: {
  tradeDate: string
  maxAgeMs: number
  allowStale?: boolean
}): Promise<RadarSnapshotPayload | null> {
  const [fromCache, fromTable] = await Promise.all([
    resolveWithFallback(loadRadarSnapshotFromCache(tradeDate, maxAgeMs, allowStale), {
      timeoutMs: snapshotCacheReadTimeoutMs(),
      onFallback: () => null,
    }),
    resolveWithFallback(loadRadarSnapshotFromTable(tradeDate, maxAgeMs, allowStale), {
      timeoutMs: snapshotTableReadTimeoutMs(),
      onFallback: () => null,
    }),
  ])

  return chooseBestRadarSnapshot([fromCache, fromTable])
}

export async function refreshRadarSnapshot({
  source = "cron",
  marketSession = getChinaMarketSession(),
  topN = numberEnv("RADAR_PRECOMPUTE_TOP_N", 20),
  scanTargetSize = radarPrecomputeUniverseSize(),
}: {
  source?: "cron" | "manual" | "startup"
  marketSession?: ChinaMarketSession
  topN?: number
  scanTargetSize?: number
} = {}) {
  const canScan = shouldRunRadarScan(marketSession)
  const canTrack = shouldTrackRadarPrices(marketSession)
  const result = await buildRadarReport({
    useReal: true,
    topN,
    marketSession,
    allowNewSignals: canScan,
    allowPriceUpdates: canTrack,
    scanTargetSize,
  })
  const tracking = canTrack && !result.diagnostics.dataFreshness?.blocksPriceTracking
    ? await trackOpenRadarSignals({ limit: 20 })
    : null
  const payload = radarSnapshotPayload({
    report: result.report,
    diagnostics: result.diagnostics,
    tracking,
    marketSession,
  })
  const persistable = isPersistableRadarSnapshot(payload)
  const persisted = persistable
    ? await saveRadarSnapshot(payload, {
      tradeDate: marketSession.tradeDate,
      ttlSeconds: DEFAULT_TTL_SECONDS,
      scanUniverseSize: result.diagnostics.scanUniverse?.prefilter?.inputSymbols ??
        result.diagnostics.scanUniverse?.requestedSymbols ??
        scanTargetSize,
    })
    : {
      table: false,
      cache: false,
      skipped: "non_persistable_scan_result",
      reason: result.diagnostics.fallbackReason ?? "扫描结果不足，未覆盖上一份有效快照。",
    }

  return {
    ok: true as const,
    source,
    persisted,
    payload: attachSnapshotMeta(payload, {
      source: "computed",
      maxAgeMs: radarSnapshotMaxAgeMs(marketSession),
      stale: !persistable,
      note: persistable
        ? "刚完成后台扫描并写入快照。"
        : "本次扫描没有形成有效真实快照，已跳过写入，避免覆盖上一份有效数据。",
    }),
  }
}

export function emptyRadarSnapshotPayload(marketSession = getChinaMarketSession(), reason = "等待后台雷达扫描快照。"): RadarSnapshotPayload {
  const generatedAt = marketSession.now
  const report: RadarReport = {
    ...fallbackReport,
    generatedAt,
    conclusion: reason,
    overview: {
      ...fallbackReport.overview,
      signals: {
        green: 0,
        yellow: 0,
        blue: 0,
        compass: 0,
        purple: 0,
        orange: 0,
        red: 0,
      },
      cleanups: 0,
      qualityScore: 0,
      qualityNote: "待确认",
      actionSignalCount: 0,
      freshnessIssues: 0,
      runtimeErrors: 0,
      pools: [{
        name: "雷达快照",
        count: 0,
        cap: radarPrecomputeUniverseSize(),
        note: "前端不再现场扫描 500 只；等待 cron 或手动预计算写入最新快照。",
      }],
    },
    trackRecord: undefined,
    suggestions: [],
  }
  const diagnostics: RadarBuildDiagnostics = {
    source: "fallback",
    qverisCount: 0,
    mockCount: 0,
    quoteCount: 0,
    quoteTotal: 0,
    marketSession,
    factorIRs: [],
    fallbackReason: reason,
  }

  return attachSnapshotMeta(radarSnapshotPayload({ report, diagnostics, tracking: null, marketSession }), {
    source: "empty",
    maxAgeMs: radarSnapshotMaxAgeMs(marketSession),
    stale: true,
    note: reason,
  })
}

function radarSnapshotPayload({
  report,
  diagnostics,
  tracking,
  marketSession,
}: {
  report: RadarReport
  diagnostics: RadarBuildDiagnostics
  tracking: RadarSignalTrackingResult | null
  marketSession: ChinaMarketSession
}): RadarSnapshotPayload {
  return {
    ok: true,
    generatedAt: report.generatedAt,
    report,
    tracking,
    marketSession,
    diagnostics,
    diagnosticsSummary: {
      source: diagnostics.source,
      qverisCount: diagnostics.qverisCount,
      quoteCount: diagnostics.quoteCount,
      quoteFetchedAt: diagnostics.quoteFetchedAt,
      quoteFallbackReason: diagnostics.quoteFallbackReason,
      dataFreshness: diagnostics.dataFreshness,
      trackingUpdated: tracking?.updated ?? 0,
      trackingClosed: tracking?.closed ?? 0,
    },
  }
}

async function saveRadarSnapshot(
  payload: RadarSnapshotPayload,
  opts: { tradeDate: string; ttlSeconds: number; scanUniverseSize: number },
) {
  const [table, cache] = await Promise.all([
    resolveWithFallback(saveRadarSnapshotToTable(payload, opts), {
      timeoutMs: snapshotTableWriteTimeoutMs(),
      onFallback: () => false,
    }),
    resolveWithFallback(writeSharedCache(cacheKey(opts.tradeDate), JSON.stringify(payload), opts.ttlSeconds), {
      timeoutMs: snapshotCacheWriteTimeoutMs(),
      onFallback: () => false,
    }),
  ])
  return { table, cache }
}

async function loadRadarSnapshotFromTable(tradeDate: string, maxAgeMs: number, allowStale: boolean) {
  if (!hasSharedPostgresConfig() || snapshotTableUnavailable) return null
  try {
    await ensureRadarSnapshotTable()
    if (snapshotTableUnavailable) return null
    const sql = await getSharedPostgresClient()
    const rows = await sql<StoredRadarSnapshotRow[]>`
      select snapshot_key, trade_date, generated_at, expires_at, scan_universe_size, payload
      from radar_scan_snapshots
      where snapshot_key = ${snapshotKey(tradeDate)}
      limit 1
    `
    const row = rows[0]
    if (!row) return null
    const payload = normalizePayload(row.payload)
    if (!payload) return null
    const ageMs = Date.now() - new Date(row.generated_at).getTime()
    const stale = ageMs > maxAgeMs
    if (stale && !allowStale) return null
    return attachSnapshotMeta(payload, {
      source: "postgres",
      maxAgeMs,
      stale,
      scannedSymbols: row.scan_universe_size ?? undefined,
    })
  } catch (error) {
    console.warn(`[radar-snapshot] read postgres failed: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

async function saveRadarSnapshotToTable(
  payload: RadarSnapshotPayload,
  opts: { tradeDate: string; ttlSeconds: number; scanUniverseSize: number },
) {
  if (!hasSharedPostgresConfig() || snapshotTableUnavailable) return false
  try {
    await ensureRadarSnapshotTable()
    if (snapshotTableUnavailable) return false
    const sql = await getSharedPostgresClient()
    const generatedAt = new Date(payload.generatedAt)
    const expiresAt = new Date(Date.now() + opts.ttlSeconds * 1000)
    await sql`
      insert into radar_scan_snapshots (
        snapshot_key,
        trade_date,
        generated_at,
        expires_at,
        scan_universe_size,
        payload,
        updated_at
      )
      values (
        ${snapshotKey(opts.tradeDate)},
        ${opts.tradeDate},
        ${generatedAt},
        ${expiresAt},
        ${opts.scanUniverseSize},
        ${sql.json(payload)},
        now()
      )
      on conflict (snapshot_key) do update set
        trade_date = excluded.trade_date,
        generated_at = excluded.generated_at,
        expires_at = excluded.expires_at,
        scan_universe_size = excluded.scan_universe_size,
        payload = excluded.payload,
        updated_at = now()
    `
    return true
  } catch (error) {
    console.warn(`[radar-snapshot] write postgres failed: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

async function loadRadarSnapshotFromCache(tradeDate: string, maxAgeMs: number, allowStale: boolean) {
  const raw = await readSharedCache(cacheKey(tradeDate))
  if (!raw) return null
  try {
    const payload = normalizePayload(JSON.parse(raw))
    if (!payload) return null
    const ageMs = Date.now() - new Date(payload.generatedAt).getTime()
    const stale = ageMs > maxAgeMs
    if (stale && !allowStale) return null
    return attachSnapshotMeta(payload, { source: "cache", maxAgeMs, stale })
  } catch {
    return null
  }
}

async function ensureRadarSnapshotTable() {
  if (snapshotTableReady || snapshotTableUnavailable) return
  const sql = await getSharedPostgresClient()
  try {
    const state = await sql<{ table_name: string | null; can_create: boolean }[]>`
      select to_regclass('public.radar_scan_snapshots')::text as table_name,
             has_schema_privilege(current_user, 'public', 'CREATE') as can_create
    `
    if (!state[0]?.table_name && !state[0]?.can_create) {
      snapshotTableUnavailable = true
      return
    }
    await sql`select snapshot_key from radar_scan_snapshots where false`
    snapshotTableReady = true
    return
  } catch (error) {
    if (!isUndefinedTable(error)) {
      snapshotTableUnavailable = true
      throw error
    }
  }

  try {
    await createRadarSnapshotTable(sql)
    await ensureBackendRls(sql, [SNAPSHOT_TABLE])
    snapshotTableReady = true
  } catch (error) {
    snapshotTableUnavailable = true
    throw error
  }
}

async function createRadarSnapshotTable(sql: Sql) {
  await sql`
    create table if not exists radar_scan_snapshots (
      snapshot_key text primary key,
      trade_date date not null,
      generated_at timestamptz not null,
      expires_at timestamptz not null,
      scan_universe_size integer,
      payload jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `
  await sql`
    create index if not exists radar_scan_snapshots_trade_date_idx
    on radar_scan_snapshots (trade_date desc, generated_at desc)
  `
  await sql`
    create index if not exists radar_scan_snapshots_expires_at_idx
    on radar_scan_snapshots (expires_at)
  `
}

function attachSnapshotMeta(
  payload: RadarSnapshotPayload,
  opts: {
    source: RadarSnapshotMeta["source"]
    maxAgeMs: number
    stale: boolean
    scannedSymbols?: number
    note?: string
  },
): RadarSnapshotPayload {
  const generatedAt = payload.generatedAt
  return {
    ...payload,
    snapshot: {
      source: opts.source,
      tradeDate: payload.marketSession.tradeDate,
      generatedAt,
      ageMs: Math.max(0, Date.now() - new Date(generatedAt).getTime()),
      stale: opts.stale,
      maxAgeMs: opts.maxAgeMs,
      scannedSymbols: opts.scannedSymbols ??
        payload.diagnostics.scanUniverse?.prefilter?.inputSymbols ??
        payload.diagnostics.scanUniverse?.requestedSymbols,
      prefilteredSymbols: payload.diagnostics.scanUniverse?.prefilter?.selectedSymbols,
      note: opts.note,
    },
  }
}

function normalizePayload(value: unknown): RadarSnapshotPayload | null {
  if (!value || typeof value !== "object") return null
  const payload = value as Partial<RadarSnapshotPayload>
  if (!payload.ok || !payload.generatedAt || !payload.report || !payload.diagnostics || !payload.marketSession) return null
  return payload as RadarSnapshotPayload
}

function isPersistableRadarSnapshot(payload: RadarSnapshotPayload) {
  if (payload.diagnostics.source === "fallback") return false
  if (payload.diagnostics.qverisCount <= 0) return false
  if (payload.diagnostics.dataFreshness?.dailyDataStale || payload.diagnostics.dataFreshness?.blocksNewSignals) return true
  if (payload.report.suggestions.length <= 0) return false
  return true
}

function snapshotKey(tradeDate: string) {
  return `radar:${tradeDate}:latest`
}

function cacheKey(tradeDate: string) {
  return `${SNAPSHOT_CACHE_PREFIX}:${snapshotKey(tradeDate)}`
}

function chooseBestRadarSnapshot(candidates: Array<RadarSnapshotPayload | null>) {
  const snapshots = candidates.filter((snapshot): snapshot is RadarSnapshotPayload => Boolean(snapshot))
  if (!snapshots.length) return null
  return snapshots.sort((a, b) => {
    const aStale = Boolean(a.snapshot?.stale)
    const bStale = Boolean(b.snapshot?.stale)
    if (aStale !== bStale) return aStale ? 1 : -1
    return new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
  })[0]
}

function numberEnv(name: string, fallback: number) {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function snapshotTableReadTimeoutMs() {
  return numberEnv("RADAR_SNAPSHOT_TABLE_READ_TIMEOUT_MS", DEFAULT_TABLE_READ_TIMEOUT_MS)
}

function snapshotCacheReadTimeoutMs() {
  return numberEnv("RADAR_SNAPSHOT_CACHE_READ_TIMEOUT_MS", DEFAULT_CACHE_READ_TIMEOUT_MS)
}

function snapshotTableWriteTimeoutMs() {
  return numberEnv("RADAR_SNAPSHOT_TABLE_WRITE_TIMEOUT_MS", DEFAULT_TABLE_WRITE_TIMEOUT_MS)
}

function snapshotCacheWriteTimeoutMs() {
  return numberEnv("RADAR_SNAPSHOT_CACHE_WRITE_TIMEOUT_MS", DEFAULT_CACHE_WRITE_TIMEOUT_MS)
}

function isUndefinedTable(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "42P01")
}
