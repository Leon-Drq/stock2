import type { StockSignal } from "@/lib/radar-data"
import { radarHistoryStatusFromLifecycle, type RadarHistoryRecord } from "@/lib/radar-history"
import { ensureBackendRls, getSharedPostgresClient, hasSharedPostgresConfig, readSharedCache, writeSharedCache } from "@/lib/backtest-data-store"
import { fetchLatestQuotes, type LatestQuote } from "@/lib/qveris-quotes"
import { findStock, type StockPoolItem } from "@/lib/stock-pool"

type SignalAnchor = {
  key: string
  ticker: string
  recommendedAt: string
  firstTriggeredAt?: string
  latestQuoteAt?: string
  priceStatus?: "tracked" | "pending-follow-up"
  lifecycleStage?: "triggered" | "tracking" | "target-hit" | "stopped" | "expired" | "invalidated"
  triggerPrice: number
  latestPrice?: number
  returnSinceSignalPct?: number
  mfePct?: number
  maePct?: number
  stopLossPrice?: number
  targetPrice?: number
  status?: "open" | "stopped" | "target-hit" | "expired"
  closeReason?: string
  closedAt?: string
  lastSeenAt: number
}

type AnchorOptions = {
  allowNewSignals?: boolean
  allowPriceUpdates?: boolean
  persist?: boolean
}

type SignalLedgerRow = {
  signal_id: string
  ticker: string
  name: string | null
  exchange: string | null
  strategy_id: string | null
  strategy_name: string | null
  signal_kind: string | null
  signal_level: string | null
  buy_point: string | null
  lifecycle_status: SignalAnchor["status"] | null
  first_triggered_at: string | Date
  last_seen_at: string | Date
  closed_at: string | Date | null
  trigger_price: string | number
  latest_price: string | number | null
  return_since_signal_pct: string | number | null
  mfe_pct: string | number | null
  mae_pct: string | number | null
  stop_loss_price: string | number | null
  target_price: string | number | null
  close_reason: string | null
  note: string | null
  payload: string | null
}

export type RadarSignalTrackingResult = {
  ok: boolean
  checkedAt: string
  openBefore: number
  quoted: number
  updated: number
  missingQuotes: number
  closed: number
  stopped: number
  targetHit: number
  expired: number
  quoteFallbackReason?: string
  reason?: string
  samples: Array<{
    signalId: string
    ticker: string
    name: string
    latestPrice: number
    returnSinceSignalPct: number
    mfePct: number
    maePct: number
    status: NonNullable<SignalAnchor["status"]>
    closeReason?: string
  }>
}

const SIGNAL_TTL_MS = 7 * 24 * 60 * 60_000
const SIGNAL_TTL_SECONDS = Math.floor(SIGNAL_TTL_MS / 1000)
const CLOSED_SIGNAL_KEEP_MS = 14 * 24 * 60 * 60_000
const MAX_HOLD_MS = 5 * 24 * 60 * 60_000
const SIGNAL_LEDGER_KEY = "stock-radar:signal-ledger:v2"
const PERSISTENCE_TIMEOUT_MS = 5000

let signalAnchors = new Map<string, SignalAnchor>()
let radarSignalsTableReady = false
let radarSignalsTableUnavailable = false

export function radarSignalKey(signal: Pick<StockSignal, "strategyId" | "ticker" | "signalKind" | "buyPoint" | "dedupeKey">) {
  if (signal.dedupeKey) return signal.dedupeKey
  return [
    signal.strategyId ?? "default",
    signal.ticker,
    signal.buyPoint,
  ].join(":")
}

function pruneSignalAnchors(now: number) {
  signalAnchors = new Map(
    Array.from(signalAnchors.entries()).filter(([, anchor]) => now - anchor.lastSeenAt <= SIGNAL_TTL_MS),
  )
}

export async function anchorRadarSignals(signals: StockSignal[], options: AnchorOptions = {}): Promise<StockSignal[]> {
  const now = Date.now()
  const allowNewSignals = options.allowNewSignals ?? true
  const allowPriceUpdates = options.allowPriceUpdates ?? true
  const persist = options.persist ?? true
  pruneSignalAnchors(now)
  const persisted = await loadPersistentLedger(now)
  for (const [key, anchor] of persisted) {
    if (!signalAnchors.has(key)) signalAnchors.set(key, anchor)
  }

  const keys = signals.map((signal) => radarSignalKey(signal))

  const anchored = signals.map((signal, index) => {
    const key = keys[index]
    const existing = signalAnchors.get(key)
    if (!existing && !allowNewSignals) {
      return candidateSignal(signal, key)
    }

    const isRepeat = Boolean(existing)
    const recommendedAt = existing?.recommendedAt ?? signal.recommendedAt
    const firstTriggeredAt = existing?.firstTriggeredAt ?? existing?.recommendedAt ?? recommendedAt ?? `${signal.date}T${signal.quoteTime ?? "09:30:00"}+08:00`
    const triggerPrice = existing?.triggerPrice ?? signal.triggerPrice ?? signal.price
    const currentQuoteAt = parseSignalQuoteAt(signal)
    const previousQuoteAt = existing?.latestQuoteAt ? parseDate(existing.latestQuoteAt) : parseDate(firstTriggeredAt)
    const hasNewQuote = Boolean(currentQuoteAt && currentQuoteAt.getTime() > previousQuoteAt.getTime() + 500)
    const existingClosed = Boolean(existing?.status && existing.status !== "open")
    const canUpdatePrice = !existingClosed && allowPriceUpdates && hasNewQuote
    const latestQuoteAt = canUpdatePrice && currentQuoteAt
      ? currentQuoteAt.toISOString()
      : existing?.latestQuoteAt ?? currentQuoteAt?.toISOString() ?? firstTriggeredAt
    const latestPrice = existing && !canUpdatePrice
      ? existing.latestPrice ?? triggerPrice
      : signal.price
    const returnSinceSignalPct = triggerPrice > 0 ? round2((latestPrice / triggerPrice - 1) * 100) : signal.returnSinceSignalPct ?? 0
    const mfePct = Math.max(existing?.mfePct ?? returnSinceSignalPct, returnSinceSignalPct)
    const maePct = Math.min(existing?.maePct ?? returnSinceSignalPct, returnSinceSignalPct)
    const stopLossPrice = existing?.stopLossPrice ?? signal.invalidation?.price ?? signal.stopLoss.price
    const targetPrice = existing?.targetPrice ?? round2(triggerPrice * (1 + signal.upsidePct / 100))
    const priceStatus = quoteTrackingStatus(firstTriggeredAt, latestQuoteAt, returnSinceSignalPct, mfePct, maePct)
    const closeState = closeStateForSignal({
      existing,
      firstTriggeredAt,
      latestPrice,
      stopLossPrice,
      targetPrice,
      now,
    })
    const anchor = {
      key,
      ticker: signal.ticker,
      recommendedAt: firstTriggeredAt,
      firstTriggeredAt,
      latestQuoteAt,
      priceStatus,
      lifecycleStage: lifecycleStage(closeState.status, isRepeat, priceStatus),
      triggerPrice,
      latestPrice,
      returnSinceSignalPct,
      mfePct,
      maePct,
      stopLossPrice,
      targetPrice,
      status: closeState.status,
      closeReason: closeState.closeReason,
      closedAt: closeState.closedAt,
      lastSeenAt: now,
    }

    signalAnchors.set(key, anchor)

    const lifecycle: StockSignal["signalLifecycle"] = closeState.status === "open" ? (isRepeat ? "tracking" : "new") : "closed"
    return {
      ...signal,
      price: round2(latestPrice),
      signalId: key,
      signalLifecycle: lifecycle,
      lifecycleStage: anchor.lifecycleStage,
      lifecycleStatus: closeState.status,
      lifecycleNote: lifecycleNote(closeState.status, returnSinceSignalPct, mfePct, maePct, priceStatus),
      recommendedAt: firstTriggeredAt,
      firstTriggeredAt,
      latestQuoteAt,
      priceStatus,
      lastSeenAt: new Date(now).toISOString(),
      closedAt: closeState.closedAt,
      closeReason: closeState.closeReason,
      triggerPrice,
      returnSinceSignalPct,
      mfePct: round2(mfePct),
      maePct: round2(maePct),
    }
  })

  if (persist) {
    await savePersistentLedger(
      anchored.filter((signal) => signal.signalLifecycle !== "candidate"),
      signalAnchors,
    )
  }
  return anchored
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

async function loadPersistentLedger(now: number): Promise<Map<string, SignalAnchor>> {
  const dbLedger = await withTimeout(loadLedgerFromDatabase(now), null, PERSISTENCE_TIMEOUT_MS)
  if (dbLedger?.size) return dbLedger

  const raw = await withTimeout(readSharedCache(SIGNAL_LEDGER_KEY), null, PERSISTENCE_TIMEOUT_MS)
  const records = new Map<string, SignalAnchor>()
  if (!raw) return records
  try {
    const parsed = JSON.parse(raw) as unknown
    const values = Array.isArray(parsed) ? parsed : Object.values(parsed as Record<string, unknown>)
    for (const value of values) {
      const record = normalizeAnchor(value, now)
      if (record) records.set(record.key, record)
    }
  } catch {
    return records
  }
  return records
}

async function savePersistentLedger(signals: StockSignal[], records: Map<string, SignalAnchor>) {
  const now = Date.now()
  const values = Array.from(records.values()).filter((record) => keepRecord(record, now)).slice(-500)
  await Promise.all([
    withTimeout(writeSharedCache(SIGNAL_LEDGER_KEY, JSON.stringify(values), SIGNAL_TTL_SECONDS * 2), false, PERSISTENCE_TIMEOUT_MS),
    withTimeout(upsertSignalsToDatabase(signals), false, PERSISTENCE_TIMEOUT_MS),
  ])
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

function normalizeAnchor(value: unknown, now: number): SignalAnchor | null {
  if (!value || typeof value !== "object") return null
  const record = value as Partial<SignalAnchor>
  if (
    typeof record.key !== "string" ||
    typeof record.ticker !== "string" ||
    typeof record.recommendedAt !== "string" ||
    typeof record.triggerPrice !== "number" ||
    !Number.isFinite(record.triggerPrice) ||
    typeof record.lastSeenAt !== "number"
  ) {
    return null
  }
  const status = record.status ?? "open"
  const rawLatestPrice = numberOrUndefined(record.latestPrice)
  const latestPrice = rawLatestPrice == null
    ? undefined
    : displayPriceForClosedSignal(status, rawLatestPrice, numberOrUndefined(record.stopLossPrice), numberOrUndefined(record.targetPrice))
  const returnSinceSignalPct = latestPrice != null && latestPrice !== rawLatestPrice && record.triggerPrice > 0
    ? round2((latestPrice / record.triggerPrice - 1) * 100)
    : numberOrUndefined(record.returnSinceSignalPct)
  const normalized = {
    key: record.key,
    ticker: record.ticker,
    recommendedAt: record.firstTriggeredAt ?? record.recommendedAt,
    firstTriggeredAt: record.firstTriggeredAt ?? record.recommendedAt,
    latestQuoteAt: typeof record.latestQuoteAt === "string" ? record.latestQuoteAt : undefined,
    priceStatus: record.priceStatus === "tracked" || record.priceStatus === "pending-follow-up" ? record.priceStatus : undefined,
    lifecycleStage: normalizeLifecycleStage(record.lifecycleStage),
    triggerPrice: record.triggerPrice,
    latestPrice,
    returnSinceSignalPct,
    mfePct: Math.max(numberOrUndefined(record.mfePct) ?? returnSinceSignalPct ?? 0, returnSinceSignalPct ?? 0),
    maePct: Math.min(numberOrUndefined(record.maePct) ?? returnSinceSignalPct ?? 0, returnSinceSignalPct ?? 0),
    stopLossPrice: numberOrUndefined(record.stopLossPrice),
    targetPrice: numberOrUndefined(record.targetPrice),
    status,
    closeReason: typeof record.closeReason === "string" ? record.closeReason : undefined,
    closedAt: typeof record.closedAt === "string" ? record.closedAt : undefined,
    lastSeenAt: record.lastSeenAt,
  } satisfies SignalAnchor
  return keepRecord(normalized, now) ? normalized : null
}

function numberOrUndefined(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function normalizeLifecycleStage(value: unknown): SignalAnchor["lifecycleStage"] {
  if (
    value === "triggered" ||
    value === "tracking" ||
    value === "target-hit" ||
    value === "stopped" ||
    value === "expired" ||
    value === "invalidated"
  ) {
    return value
  }
  return undefined
}

function candidateSignal(signal: StockSignal, key: string): StockSignal {
  return {
    ...signal,
    signalId: key,
    signalLifecycle: "candidate",
    lifecycleStage: "candidate",
    lifecycleStatus: "open",
    lifecycleNote: "候选中：非交易时段不新增触发，等待连续竞价时段重新确认。",
    priceStatus: "pending-follow-up",
  }
}

function keepRecord(record: SignalAnchor, now: number) {
  if (record.status && record.status !== "open") {
    const closedAt = record.closedAt ? new Date(record.closedAt).getTime() : record.lastSeenAt
    return Number.isFinite(closedAt) && now - closedAt <= CLOSED_SIGNAL_KEEP_MS
  }
  return now - record.lastSeenAt <= SIGNAL_TTL_MS
}

function closeStateForSignal({
  existing,
  firstTriggeredAt,
  latestPrice,
  stopLossPrice,
  targetPrice,
  now,
}: {
  existing?: SignalAnchor
  firstTriggeredAt: string
  latestPrice: number
  stopLossPrice?: number
  targetPrice?: number
  now: number
}): { status: NonNullable<SignalAnchor["status"]>; closeReason?: string; closedAt?: string } {
  if (existing?.status && existing.status !== "open") {
    return { status: existing.status, closeReason: existing.closeReason, closedAt: existing.closedAt }
  }
  if (stopLossPrice != null && latestPrice <= stopLossPrice) {
    return { status: "stopped", closeReason: `跌破失效价 ${stopLossPrice.toFixed(2)}`, closedAt: new Date(now).toISOString() }
  }
  if (targetPrice != null && latestPrice >= targetPrice) {
    return { status: "target-hit", closeReason: `达到目标位 ${targetPrice.toFixed(2)}`, closedAt: new Date(now).toISOString() }
  }
  const firstSeen = new Date(firstTriggeredAt).getTime()
  if (Number.isFinite(firstSeen) && now - firstSeen >= MAX_HOLD_MS) {
    return { status: "expired", closeReason: "超过 5 天跟踪窗口", closedAt: new Date(now).toISOString() }
  }
  return { status: "open" }
}

function lifecycleNote(
  status: NonNullable<SignalAnchor["status"]>,
  ret: number,
  mfe: number,
  mae: number,
  priceStatus?: "tracked" | "pending-follow-up",
) {
  if (status === "stopped") {
    const label = ret > 0.05 ? "风控退出" : ret < -0.05 ? "已止损" : "平价退出"
    return `${label}，信号后 ${ret.toFixed(2)}%，最大不利 ${mae.toFixed(2)}%`
  }
  if (status === "target-hit") return `已达标，信号后 ${ret.toFixed(2)}%，最高浮盈 ${mfe.toFixed(2)}%`
  if (status === "expired") return `已超时关闭，信号后 ${ret.toFixed(2)}%`
  if (priceStatus === "pending-follow-up") return "已触发，等待触发后的下一笔真实行情确认浮盈。"
  return `跟踪中，最高浮盈 ${mfe.toFixed(2)}%，最大不利 ${mae.toFixed(2)}%`
}

function lifecycleStage(
  status: NonNullable<SignalAnchor["status"]>,
  isRepeat: boolean,
  priceStatus?: "tracked" | "pending-follow-up",
): NonNullable<SignalAnchor["lifecycleStage"]> {
  if (status === "target-hit") return "target-hit"
  if (status === "stopped") return "stopped"
  if (status === "expired") return "expired"
  if (priceStatus === "pending-follow-up") return "triggered"
  return isRepeat ? "tracking" : "triggered"
}

function quoteTrackingStatus(
  firstTriggeredAt: string,
  latestQuoteAt: string | undefined,
  returnPct: number,
  mfePct: number,
  maePct: number,
): "tracked" | "pending-follow-up" {
  const first = new Date(firstTriggeredAt).getTime()
  const quote = latestQuoteAt ? new Date(latestQuoteAt).getTime() : Number.NaN
  if (Number.isFinite(first) && Number.isFinite(quote) && quote > first + 500) return "tracked"
  if (Math.abs(returnPct) >= 0.005 || Math.abs(mfePct) >= 0.005 || Math.abs(maePct) >= 0.005) return "tracked"
  return "pending-follow-up"
}

async function ensureRadarSignalsTable() {
  if (radarSignalsTableReady) return true
  if (radarSignalsTableUnavailable || !hasSharedPostgresConfig()) return false
  try {
    const sql = await getSharedPostgresClient()
    try {
      await sql`select signal_id from radar_signals where false`
      radarSignalsTableReady = true
      return true
    } catch (error) {
      if (!isUndefinedTable(error)) throw error
    }

    await sql`
      create table if not exists radar_signals (
        signal_id text primary key,
        ticker text not null,
        name text,
        exchange text,
        strategy_id text,
        strategy_name text,
        signal_kind text,
        signal_level text,
        buy_point text,
        lifecycle_status text not null default 'open',
        first_triggered_at timestamptz not null,
        last_seen_at timestamptz not null,
        closed_at timestamptz,
        trigger_price double precision not null,
        latest_price double precision,
        return_since_signal_pct double precision,
        mfe_pct double precision,
        mae_pct double precision,
        stop_loss_price double precision,
        target_price double precision,
        close_reason text,
        note text,
        payload text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `
    await tryEnsureRadarSignalIndexes(sql)
    await ensureBackendRls(sql, ["radar_signals"])
    radarSignalsTableReady = true
    return true
  } catch {
    radarSignalsTableUnavailable = true
    return false
  }
}

async function ensureRadarSignalIndexes(sql: Awaited<ReturnType<typeof getSharedPostgresClient>>) {
  await sql`
    create index if not exists radar_signals_last_seen_idx
    on radar_signals (last_seen_at desc)
  `
  await sql`
    create index if not exists radar_signals_status_idx
    on radar_signals (lifecycle_status, last_seen_at desc)
  `
  await sql`
    create index if not exists radar_signals_first_triggered_idx
    on radar_signals (first_triggered_at desc)
  `
}

async function tryEnsureRadarSignalIndexes(sql: Awaited<ReturnType<typeof getSharedPostgresClient>>) {
  try {
    await ensureRadarSignalIndexes(sql)
  } catch {
    // Index creation should never block reads in runtime paths.
  }
}

async function loadLedgerFromDatabase(now: number): Promise<Map<string, SignalAnchor> | null> {
  if (!(await ensureRadarSignalsTable())) return null
  const sql = await getSharedPostgresClient()
  const cutoff = new Date(now - Math.max(SIGNAL_TTL_MS, CLOSED_SIGNAL_KEEP_MS))
  const rows = await sql<SignalLedgerRow[]>`
    select signal_id, ticker, name, exchange, strategy_id, strategy_name,
           signal_kind, signal_level, buy_point, lifecycle_status,
           first_triggered_at, last_seen_at, closed_at, trigger_price,
           latest_price, return_since_signal_pct, mfe_pct, mae_pct,
           stop_loss_price, target_price, close_reason, note, payload
    from radar_signals
    where last_seen_at >= ${cutoff}
       or closed_at >= ${cutoff}
    order by last_seen_at desc
    limit 500
  `
  const records = new Map<string, SignalAnchor>()
  for (const row of rows) {
    const record = anchorFromRow(row, now)
    if (record) records.set(record.key, record)
  }
  return records
}

async function upsertSignalsToDatabase(signals: StockSignal[]) {
  if (!signals.length || !(await ensureRadarSignalsTable())) return false
  const sql = await getSharedPostgresClient()
  const rows = signals.map((signal) => {
    const signalId = signal.signalId ?? radarSignalKey(signal)
    const firstTriggeredAt = parseDate(signal.firstTriggeredAt ?? signal.recommendedAt ?? `${signal.date}T${signal.quoteTime ?? "09:30:00"}+08:00`)
    const lastSeenAt = parseDate(signal.lastSeenAt ?? new Date().toISOString())
    const latestQuoteAt = parseSignalQuoteAt(signal) ?? firstTriggeredAt
    const closedAt = signal.closedAt ? parseDate(signal.closedAt) : null
    const triggerPrice = signal.triggerPrice ?? signal.price
    const targetPrice = round2(triggerPrice * (1 + signal.upsidePct / 100))
    const quoteTrackingStatus = signal.priceStatus ?? (latestQuoteAt.getTime() > firstTriggeredAt.getTime() + 500 ? "tracked" : "pending-follow-up")
    const stage = signal.lifecycleStage ?? lifecycleStage(signal.lifecycleStatus ?? "open", signal.signalLifecycle === "tracking", quoteTrackingStatus)
    return {
      signal_id: signalId,
      ticker: signal.ticker,
      name: signal.name,
      exchange: signal.exchange ?? null,
      strategy_id: signal.strategyId ?? null,
      strategy_name: signal.strategyName ?? null,
      signal_kind: signal.signalKind,
      signal_level: signal.signalLevel,
      buy_point: signal.buyPoint,
      lifecycle_status: signal.lifecycleStatus ?? "open",
      first_triggered_at: firstTriggeredAt,
      last_seen_at: lastSeenAt,
      closed_at: closedAt,
      trigger_price: triggerPrice,
      latest_price: signal.price,
      return_since_signal_pct: signal.returnSinceSignalPct ?? null,
      mfe_pct: signal.mfePct ?? signal.returnSinceSignalPct ?? null,
      mae_pct: signal.maePct ?? signal.returnSinceSignalPct ?? null,
      stop_loss_price: signal.invalidation?.price ?? signal.stopLoss.price,
      target_price: targetPrice,
      close_reason: signal.closeReason ?? null,
      note: signal.lifecycleNote ?? signal.reason,
      payload: JSON.stringify({
        reason: signal.reason,
        suggestion: signal.suggestion,
        intradayPattern: signal.intradayPattern,
        evidence: signal.evidence,
        quoteTime: signal.quoteTime,
        priceSource: signal.priceSource,
        latestQuoteAt: latestQuoteAt.toISOString(),
        quoteTrackingStatus,
        lifecycleStage: stage,
        winRatePct: signal.winRatePct,
        oddsRatio: signal.oddsRatio,
        upsidePct: signal.upsidePct,
      }),
    }
  })

  for (const chunk of chunks(rows, 50)) {
    await sql`
      insert into radar_signals ${sql(
        chunk,
        "signal_id",
        "ticker",
        "name",
        "exchange",
        "strategy_id",
        "strategy_name",
        "signal_kind",
        "signal_level",
        "buy_point",
        "lifecycle_status",
        "first_triggered_at",
        "last_seen_at",
        "closed_at",
        "trigger_price",
        "latest_price",
        "return_since_signal_pct",
        "mfe_pct",
        "mae_pct",
        "stop_loss_price",
        "target_price",
        "close_reason",
        "note",
        "payload",
      )}
      on conflict (signal_id) do update set
        ticker = excluded.ticker,
        name = excluded.name,
        exchange = excluded.exchange,
        strategy_id = excluded.strategy_id,
        strategy_name = excluded.strategy_name,
        signal_kind = excluded.signal_kind,
        signal_level = excluded.signal_level,
        buy_point = excluded.buy_point,
        lifecycle_status = case
          when radar_signals.lifecycle_status <> 'open' then radar_signals.lifecycle_status
          else excluded.lifecycle_status
        end,
        last_seen_at = greatest(radar_signals.last_seen_at, excluded.last_seen_at),
        closed_at = coalesce(radar_signals.closed_at, excluded.closed_at),
        latest_price = case
          when radar_signals.lifecycle_status <> 'open' then radar_signals.latest_price
          when (excluded.payload::jsonb ->> 'latestQuoteAt')::timestamptz > coalesce((radar_signals.payload::jsonb ->> 'latestQuoteAt')::timestamptz, radar_signals.first_triggered_at - interval '1 millisecond')
            then excluded.latest_price
          else radar_signals.latest_price
        end,
        return_since_signal_pct = case
          when radar_signals.lifecycle_status <> 'open' then radar_signals.return_since_signal_pct
          when (excluded.payload::jsonb ->> 'latestQuoteAt')::timestamptz > coalesce((radar_signals.payload::jsonb ->> 'latestQuoteAt')::timestamptz, radar_signals.first_triggered_at - interval '1 millisecond')
            then excluded.return_since_signal_pct
          else radar_signals.return_since_signal_pct
        end,
        mfe_pct = case
          when radar_signals.lifecycle_status <> 'open' then radar_signals.mfe_pct
          when (excluded.payload::jsonb ->> 'latestQuoteAt')::timestamptz > coalesce((radar_signals.payload::jsonb ->> 'latestQuoteAt')::timestamptz, radar_signals.first_triggered_at - interval '1 millisecond')
            then greatest(coalesce(radar_signals.mfe_pct, excluded.mfe_pct), coalesce(excluded.mfe_pct, radar_signals.mfe_pct))
          else radar_signals.mfe_pct
        end,
        mae_pct = case
          when radar_signals.lifecycle_status <> 'open' then radar_signals.mae_pct
          when (excluded.payload::jsonb ->> 'latestQuoteAt')::timestamptz > coalesce((radar_signals.payload::jsonb ->> 'latestQuoteAt')::timestamptz, radar_signals.first_triggered_at - interval '1 millisecond')
            then least(coalesce(radar_signals.mae_pct, excluded.mae_pct), coalesce(excluded.mae_pct, radar_signals.mae_pct))
          else radar_signals.mae_pct
        end,
        stop_loss_price = case
          when radar_signals.lifecycle_status <> 'open' then radar_signals.stop_loss_price
          else excluded.stop_loss_price
        end,
        target_price = case
          when radar_signals.lifecycle_status <> 'open' then radar_signals.target_price
          else excluded.target_price
        end,
        close_reason = coalesce(radar_signals.close_reason, excluded.close_reason),
        note = case
          when radar_signals.lifecycle_status <> 'open' then radar_signals.note
          else excluded.note
        end,
        payload = case
          when radar_signals.lifecycle_status <> 'open' then radar_signals.payload
          when (excluded.payload::jsonb ->> 'latestQuoteAt')::timestamptz > coalesce((radar_signals.payload::jsonb ->> 'latestQuoteAt')::timestamptz, radar_signals.first_triggered_at - interval '1 millisecond')
            then excluded.payload
          else radar_signals.payload
        end,
        updated_at = now()
    `
  }
  return true
}

export async function trackOpenRadarSignals(options: { limit?: number } = {}): Promise<RadarSignalTrackingResult> {
  const checkedAt = new Date()
  const checkedAtIso = checkedAt.toISOString()
  const empty = (reason: string): RadarSignalTrackingResult => ({
    ok: false,
    checkedAt: checkedAtIso,
    openBefore: 0,
    quoted: 0,
    updated: 0,
    missingQuotes: 0,
    closed: 0,
    stopped: 0,
    targetHit: 0,
    expired: 0,
    reason,
    samples: [],
  })

  if (!(await ensureRadarSignalsTable())) return empty("radar_signals 表不可用")

  const sql = await getSharedPostgresClient()
  const limit = Math.max(1, Math.min(options.limit ?? 200, 500))
  const rows = await sql<SignalLedgerRow[]>`
    select signal_id, ticker, name, exchange, strategy_id, strategy_name,
           signal_kind, signal_level, buy_point, lifecycle_status,
           first_triggered_at, last_seen_at, closed_at, trigger_price,
           latest_price, return_since_signal_pct, mfe_pct, mae_pct,
           stop_loss_price, target_price, close_reason, note, payload
    from radar_signals
    where lifecycle_status = 'open'
      and closed_at is null
    order by last_seen_at asc
    limit ${limit}
  `

  if (!rows.length) {
    return {
      ok: true,
      checkedAt: checkedAtIso,
      openBefore: 0,
      quoted: 0,
      updated: 0,
      missingQuotes: 0,
      closed: 0,
      stopped: 0,
      targetHit: 0,
      expired: 0,
      samples: [],
    }
  }

  const pool = rows.map(stockPoolItemFromSignalRow)
  const quotes = await fetchLatestQuotes(pool, {
    discoverTimeoutMs: 4_000,
    callTimeoutMs: 8_000,
  })
  let updated = 0
  let missingQuotes = 0
  let closed = 0
  let stopped = 0
  let targetHit = 0
  let expired = 0
  const samples: RadarSignalTrackingResult["samples"] = []

  for (const row of rows) {
    const triggerPrice = toNumber(row.trigger_price)
    if (!triggerPrice || triggerPrice <= 0) {
      missingQuotes++
      continue
    }

    const quote = quotes.quotes.get(row.ticker)
    const quoteAt = quote ? quoteSeenAt(quote) : null
    const ledgerMeta = parseSignalPayload(row.payload)
    const previousQuoteAt = ledgerMeta.latestQuoteAt ? parseDate(ledgerMeta.latestQuoteAt) : parseDate(formatDateTime(row.first_triggered_at))
    const hasNewQuote = Boolean(quote && quoteAt && quoteAt.getTime() > previousQuoteAt.getTime() + 500)
    const latestPrice = hasNewQuote && quote ? quote.latest : toNumber(row.latest_price) ?? triggerPrice
    const returnSinceSignalPct = round2((latestPrice / triggerPrice - 1) * 100)
    const mfePct = round2(Math.max(toNumber(row.mfe_pct) ?? returnSinceSignalPct, returnSinceSignalPct))
    const maePct = round2(Math.min(toNumber(row.mae_pct) ?? returnSinceSignalPct, returnSinceSignalPct))
    const closeState = closeStateForSignal({
      firstTriggeredAt: formatDateTime(row.first_triggered_at),
      latestPrice,
      stopLossPrice: toNumber(row.stop_loss_price),
      targetPrice: toNumber(row.target_price),
      now: checkedAt.getTime(),
    })

    if (!hasNewQuote && closeState.status === "open") {
      missingQuotes++
      continue
    }

    if (closeState.status !== "open") {
      closed++
      if (closeState.status === "stopped") stopped++
      if (closeState.status === "target-hit") targetHit++
      if (closeState.status === "expired") expired++
    }

    const nextPriceStatus = hasNewQuote ? "tracked" : ledgerMeta.quoteTrackingStatus ?? "pending-follow-up"
    const nextStage = lifecycleStage(closeState.status, true, nextPriceStatus)
    const note = lifecycleNote(closeState.status, returnSinceSignalPct, mfePct, maePct, nextPriceStatus)
    const payload = mergeSignalPayload(row.payload, {
      latestQuoteAt: hasNewQuote && quoteAt ? quoteAt.toISOString() : ledgerMeta.latestQuoteAt,
      quoteTrackingStatus: nextPriceStatus,
      lifecycleStage: nextStage,
    })
    await sql`
      update radar_signals
      set lifecycle_status = ${closeState.status},
          last_seen_at = ${checkedAt},
          closed_at = ${closeState.closedAt ? parseDate(closeState.closedAt) : null},
          latest_price = ${latestPrice},
          return_since_signal_pct = ${returnSinceSignalPct},
          mfe_pct = ${mfePct},
          mae_pct = ${maePct},
          close_reason = ${closeState.closeReason ?? null},
          note = ${note},
          payload = ${payload},
          updated_at = now()
      where signal_id = ${row.signal_id}
    `
    updated++
    if (samples.length < 8) {
      samples.push({
        signalId: row.signal_id,
        ticker: row.ticker,
        name: row.name ?? row.ticker,
        latestPrice,
        returnSinceSignalPct,
        mfePct,
        maePct,
        status: closeState.status,
        closeReason: closeState.closeReason,
      })
    }
  }

  return {
    ok: true,
    checkedAt: checkedAtIso,
    openBefore: rows.length,
    quoted: quotes.qverisCount,
    updated,
    missingQuotes,
    closed,
    stopped,
    targetHit,
    expired,
    quoteFallbackReason: quotes.fallbackReason,
    samples,
  }
}

export async function loadRadarSignalHistoryRecords(limit = 120): Promise<RadarHistoryRecord[]> {
  if (await ensureRadarSignalsTable()) {
    const sql = await getSharedPostgresClient()
    const rows = await sql<SignalLedgerRow[]>`
      select signal_id, ticker, name, exchange, strategy_id, strategy_name,
             signal_kind, signal_level, buy_point, lifecycle_status,
             first_triggered_at, last_seen_at, closed_at, trigger_price,
             latest_price, return_since_signal_pct, mfe_pct, mae_pct,
             stop_loss_price, target_price, close_reason, note, payload
      from radar_signals
      order by first_triggered_at desc
      limit ${limit}
    `
    return rows.map(historyRecordFromRow)
  }

  const records = Array.from((await loadPersistentLedger(Date.now())).values())
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .slice(0, limit)
  return records.map(historyRecordFromAnchor)
}

export async function loadRadarSignalHistoryRecordsForTradeDate(tradeDate: string, limit = 120): Promise<RadarHistoryRecord[]> {
  const safeLimit = Math.max(1, Math.min(limit, 500))
  const start = new Date(`${tradeDate}T00:00:00+08:00`)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)

  if (!radarSignalsTableUnavailable && hasSharedPostgresConfig()) {
    const sql = await getSharedPostgresClient()
    try {
      const rows = await sql<SignalLedgerRow[]>`
        select signal_id, ticker, name, exchange, strategy_id, strategy_name,
               signal_kind, signal_level, buy_point, lifecycle_status,
               first_triggered_at, last_seen_at, closed_at, trigger_price,
               latest_price, return_since_signal_pct, mfe_pct, mae_pct,
               stop_loss_price, target_price, close_reason, note, payload
        from radar_signals
        where first_triggered_at >= ${start}
          and first_triggered_at < ${end}
        order by first_triggered_at desc
        limit ${safeLimit}
      `
      radarSignalsTableReady = true
      return rows.map(historyRecordFromRow)
    } catch (error) {
      if (isUndefinedTable(error)) radarSignalsTableUnavailable = true
    }
  }

  return (await loadRadarSignalHistoryRecords(safeLimit))
    .filter((record) => recordDateInChina(record.recommendedAt) === tradeDate)
}

export async function loadRadarSignalHistoryRecordsForStrategySince(
  strategyId: string,
  startedAt: string,
  limit = 5000,
): Promise<RadarHistoryRecord[]> {
  const safeLimit = Math.max(1, Math.min(limit, 10_000))
  const start = new Date(startedAt)
  if (!strategyId || Number.isNaN(start.getTime())) return []

  if (!radarSignalsTableUnavailable && hasSharedPostgresConfig()) {
    const sql = await getSharedPostgresClient()
    try {
      const rows = await sql<SignalLedgerRow[]>`
        select signal_id, ticker, name, exchange, strategy_id, strategy_name,
               signal_kind, signal_level, buy_point, lifecycle_status,
               first_triggered_at, last_seen_at, closed_at, trigger_price,
               latest_price, return_since_signal_pct, mfe_pct, mae_pct,
               stop_loss_price, target_price, close_reason, note, payload
        from radar_signals
        where strategy_id = ${strategyId}
          and first_triggered_at >= ${start}
        order by first_triggered_at asc
        limit ${safeLimit}
      `
      radarSignalsTableReady = true
      return rows.map(historyRecordFromRow)
    } catch (error) {
      if (isUndefinedTable(error)) radarSignalsTableUnavailable = true
    }
  }

  const startMs = start.getTime()
  return (await loadRadarSignalHistoryRecords(safeLimit))
    .filter((record) => record.strategyId === strategyId)
    .filter((record) => {
      const time = new Date(record.recommendedAt).getTime()
      return Number.isFinite(time) && time >= startMs
    })
}

export async function loadRadarSignalHistoryRecordsForDateRange(
  fromTradeDate: string,
  toTradeDate: string,
  limit = 1200,
): Promise<RadarHistoryRecord[]> {
  const safeLimit = Math.max(1, Math.min(limit, 3000))
  const start = new Date(`${fromTradeDate}T00:00:00+08:00`)
  const end = new Date(`${toTradeDate}T00:00:00+08:00`)
  end.setUTCDate(end.getUTCDate() + 1)

  if (!radarSignalsTableUnavailable && hasSharedPostgresConfig()) {
    const sql = await getSharedPostgresClient()
    try {
      const rows = await sql<SignalLedgerRow[]>`
        select signal_id, ticker, name, exchange, strategy_id, strategy_name,
               signal_kind, signal_level, buy_point, lifecycle_status,
               first_triggered_at, last_seen_at, closed_at, trigger_price,
               latest_price, return_since_signal_pct, mfe_pct, mae_pct,
               stop_loss_price, target_price, close_reason, note, payload
        from radar_signals
        where first_triggered_at >= ${start}
          and first_triggered_at < ${end}
        order by first_triggered_at desc
        limit ${safeLimit}
      `
      radarSignalsTableReady = true
      return rows.map(historyRecordFromRow)
    } catch (error) {
      if (isUndefinedTable(error)) radarSignalsTableUnavailable = true
    }
  }

  return (await loadRadarSignalHistoryRecords(safeLimit))
    .filter((record) => {
      const date = recordDateInChina(record.recommendedAt)
      if (!date) return false
      return date >= fromTradeDate && date <= toTradeDate
    })
}

function stockPoolItemFromSignalRow(row: SignalLedgerRow): StockPoolItem {
  const stock = findStock(row.ticker)
  if (stock) return stock
  const exchange = row.exchange === "SH" || row.ticker.startsWith("6") ? "SH" : "SZ"
  return {
    symbol: row.ticker,
    symbolQveris: `${row.ticker}.${exchange}`,
    name: row.name ?? row.ticker,
    industry: row.strategy_name ?? "雷达跟踪",
  }
}

function anchorFromRow(row: SignalLedgerRow, now: number): SignalAnchor | null {
  const ledgerMeta = parseSignalPayload(row.payload)
  const status = row.lifecycle_status ?? "open"
  const triggerPrice = toNumber(row.trigger_price) ?? 0
  const stopLossPrice = toNumber(row.stop_loss_price)
  const targetPrice = toNumber(row.target_price)
  const rawLatestPrice = toNumber(row.latest_price) ?? triggerPrice
  const latestPrice = displayPriceForClosedSignal(status, rawLatestPrice, stopLossPrice, targetPrice)
  const returnPct = latestPrice !== rawLatestPrice && triggerPrice > 0
    ? round2((latestPrice / triggerPrice - 1) * 100)
    : toNumber(row.return_since_signal_pct)
  const mfePct = Math.max(toNumber(row.mfe_pct) ?? returnPct ?? 0, returnPct ?? 0)
  const maePct = Math.min(toNumber(row.mae_pct) ?? returnPct ?? 0, returnPct ?? 0)
  const firstTriggeredAt = formatDateTime(row.first_triggered_at)
  const latestQuoteAt = ledgerMeta.latestQuoteAt
  const priceStatus = quoteTrackingStatus(
    firstTriggeredAt,
    latestQuoteAt,
    returnPct ?? 0,
    mfePct ?? returnPct ?? 0,
    maePct ?? returnPct ?? 0,
  )
  const record = {
    key: row.signal_id,
    ticker: row.ticker,
    recommendedAt: firstTriggeredAt,
    firstTriggeredAt,
    latestQuoteAt,
    priceStatus,
    lifecycleStage: ledgerMeta.lifecycleStage ?? lifecycleStage(status, true, priceStatus),
    triggerPrice,
    latestPrice,
    returnSinceSignalPct: returnPct,
    mfePct,
    maePct,
    stopLossPrice,
    targetPrice,
    status,
    closeReason: row.close_reason ?? undefined,
    closedAt: row.closed_at ? formatDateTime(row.closed_at) : undefined,
    lastSeenAt: new Date(row.last_seen_at).getTime(),
  } satisfies SignalAnchor
  if (!record.triggerPrice || !Number.isFinite(record.lastSeenAt)) return null
  return keepRecord(record, now) ? record : null
}

function historyRecordFromRow(row: SignalLedgerRow): RadarHistoryRecord {
  const rawLatestPrice = toNumber(row.latest_price) ?? toNumber(row.trigger_price) ?? 0
  const triggerPrice = toNumber(row.trigger_price) ?? rawLatestPrice
  const stopLossPrice = toNumber(row.stop_loss_price)
  const targetPrice = toNumber(row.target_price)
  const latestPrice = displayPriceForClosedSignal(row.lifecycle_status ?? "open", rawLatestPrice, stopLossPrice, targetPrice)
  const returnPct = latestPrice !== rawLatestPrice && triggerPrice > 0
    ? round2((latestPrice / triggerPrice - 1) * 100)
    : toNumber(row.return_since_signal_pct) ?? (triggerPrice > 0 ? (latestPrice / triggerPrice - 1) * 100 : 0)
  const mfePct = Math.max(toNumber(row.mfe_pct) ?? returnPct, returnPct)
  const maePct = Math.min(toNumber(row.mae_pct) ?? returnPct, returnPct)
  const ledgerMeta = parseSignalPayload(row.payload)
  const latestQuoteAt = ledgerMeta.latestQuoteAt
  const firstTriggeredAt = formatDateTime(row.first_triggered_at)
  const closedAt = row.closed_at ? formatDateTime(row.closed_at) : undefined
  const priceStatus = historyPriceStatus({
    firstTriggeredAt,
    latestQuoteAt,
    returnPct,
    mfePct,
    maePct,
    trackingStatus: ledgerMeta.quoteTrackingStatus,
  })
  const stage = ledgerMeta.lifecycleStage ?? lifecycleStage(row.lifecycle_status ?? "open", true, priceStatus)
  const stock = findStock(row.ticker)
  return {
    id: row.signal_id,
    recommendedAt: firstTriggeredAt,
    latestQuoteAt,
    closedAt,
    ticker: row.ticker,
    name: row.name ?? row.ticker,
    industry: stock?.industry,
    strategyId: row.strategy_id ?? undefined,
    strategyName: row.strategy_name ?? undefined,
    signalKind: row.signal_kind ?? undefined,
    buyPoint: row.buy_point ?? undefined,
    lifecycleStage: stage,
    lifecycleStatus: row.lifecycle_status ?? "open",
    signal: signalLabel(row),
    triggerPrice,
    latestPrice,
    returnPct,
    maxReturnPct: mfePct,
    maxDrawdownPct: maePct,
    holdDays: holdingDays(firstTriggeredAt, closedAt ?? latestQuoteAt),
    stopLossPrice,
    targetPrice,
    exitReason: row.close_reason ?? undefined,
    priceStatus,
    status: historyStatus(row.lifecycle_status ?? "open"),
    note:
      priceStatus === "pending-follow-up"
        ? "等待触发后的下一笔真实行情；当前价仍是信号入账快照，暂不计入浮盈。"
        : row.note ?? row.close_reason ?? "雷达生命周期账本记录",
  }
}

function historyRecordFromAnchor(record: SignalAnchor): RadarHistoryRecord {
  const rawLatestPrice = record.latestPrice ?? record.triggerPrice
  const latestPrice = displayPriceForClosedSignal(record.status ?? "open", rawLatestPrice, record.stopLossPrice, record.targetPrice)
  const returnPct = latestPrice !== rawLatestPrice && record.triggerPrice > 0
    ? round2((latestPrice / record.triggerPrice - 1) * 100)
    : record.returnSinceSignalPct ?? (record.triggerPrice > 0 ? (latestPrice / record.triggerPrice - 1) * 100 : 0)
  const firstTriggeredAt = record.firstTriggeredAt ?? record.recommendedAt
  const closedAt = record.closedAt
  const priceStatus = historyPriceStatus({
    firstTriggeredAt,
    latestQuoteAt: record.latestQuoteAt,
    returnPct,
    mfePct: record.mfePct ?? returnPct,
    maePct: record.maePct ?? returnPct,
  })
  return {
    id: record.key,
    recommendedAt: firstTriggeredAt,
    latestQuoteAt: record.latestQuoteAt,
    closedAt,
    ticker: record.ticker,
    name: findStock(record.ticker)?.name ?? record.ticker,
    industry: findStock(record.ticker)?.industry,
    lifecycleStage: record.lifecycleStage ?? lifecycleStage(record.status ?? "open", true, priceStatus),
    lifecycleStatus: record.status ?? "open",
    signal: "雷达信号",
    triggerPrice: record.triggerPrice,
    latestPrice,
    returnPct,
    maxReturnPct: record.mfePct ?? returnPct,
    maxDrawdownPct: record.maePct ?? returnPct,
    holdDays: holdingDays(firstTriggeredAt, closedAt ?? record.latestQuoteAt),
    stopLossPrice: record.stopLossPrice,
    targetPrice: record.targetPrice,
    exitReason: record.closeReason,
    priceStatus,
    status: historyStatus(record.status ?? "open"),
    note:
      priceStatus === "pending-follow-up"
        ? "等待触发后的下一笔真实行情；当前价仍是信号入账快照，暂不计入浮盈。"
        : record.closeReason ?? lifecycleNote(record.status ?? "open", returnPct, record.mfePct ?? returnPct, record.maePct ?? returnPct),
  }
}

function historyPriceStatus({
  firstTriggeredAt,
  latestQuoteAt,
  returnPct,
  mfePct,
  maePct,
  trackingStatus,
}: {
  firstTriggeredAt: string
  latestQuoteAt?: string
  returnPct: number
  mfePct: number
  maePct: number
  trackingStatus?: string | null
}): RadarHistoryRecord["priceStatus"] {
  if (trackingStatus === "tracked") return "tracked"
  const first = new Date(firstTriggeredAt).getTime()
  const quote = latestQuoteAt ? new Date(latestQuoteAt).getTime() : Number.NaN
  if (Number.isFinite(first) && Number.isFinite(quote) && quote > first + 500) return "tracked"
  if (Math.abs(returnPct) >= 0.005 || Math.abs(mfePct) >= 0.005 || Math.abs(maePct) >= 0.005) return "tracked"
  return "pending-follow-up"
}

function parseSignalPayload(payload: string | null | undefined): {
  latestQuoteAt?: string
  quoteTrackingStatus?: "tracked" | "pending-follow-up"
  lifecycleStage?: NonNullable<SignalAnchor["lifecycleStage"]>
} {
  if (!payload) return {}
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>
    const latestQuoteAt = typeof parsed.latestQuoteAt === "string" ? parsed.latestQuoteAt : undefined
    const quoteTrackingStatus =
      parsed.quoteTrackingStatus === "tracked" || parsed.quoteTrackingStatus === "pending-follow-up"
        ? parsed.quoteTrackingStatus
        : undefined
    return { latestQuoteAt, quoteTrackingStatus, lifecycleStage: normalizeLifecycleStage(parsed.lifecycleStage) }
  } catch {
    return {}
  }
}

function mergeSignalPayload(
  payload: string | null | undefined,
  updates: {
    latestQuoteAt?: string
    quoteTrackingStatus: "tracked" | "pending-follow-up"
    lifecycleStage?: NonNullable<SignalAnchor["lifecycleStage"]>
  },
) {
  let base: Record<string, unknown> = {}
  if (payload) {
    try {
      const parsed = JSON.parse(payload) as unknown
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) base = parsed as Record<string, unknown>
    } catch {
      base = {}
    }
  }
  return JSON.stringify({ ...base, ...updates })
}

function historyStatus(status: NonNullable<SignalAnchor["status"]>): RadarHistoryRecord["status"] {
  return radarHistoryStatusFromLifecycle(status)
}

function displayPriceForClosedSignal(
  status: NonNullable<SignalAnchor["status"]>,
  latestPrice: number,
  stopLossPrice?: number,
  targetPrice?: number,
) {
  if (status === "stopped" && stopLossPrice != null && stopLossPrice > 0 && latestPrice > stopLossPrice) {
    return stopLossPrice
  }
  if (status === "target-hit" && targetPrice != null && targetPrice > 0 && latestPrice < targetPrice) {
    return targetPrice
  }
  return latestPrice
}

function signalLabel(row: SignalLedgerRow) {
  if (row.signal_kind === "high-confidence-buy") return "高确定性买入"
  if (row.signal_kind === "add-confirm") return "加仓确认"
  if (row.signal_kind === "left-side-trial") return "左侧试仓"
  return row.strategy_name ?? "雷达信号"
}

function holdingDays(startIso: string, endIso?: string) {
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0
  return Math.max(0, Math.ceil((end - start) / 86_400_000))
}

function isUndefinedTable(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "42P01"
}

function parseDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function parseSignalQuoteAt(signal: StockSignal) {
  if (signal.date && signal.quoteTime) return parseMarketTimestamp(signal.date, signal.quoteTime)
  if (signal.recommendedAt) return parseDate(signal.recommendedAt)
  return null
}

function quoteSeenAt(quote: LatestQuote) {
  return parseMarketTimestamp(quote.tradeDate, quote.tradeTime)
}

function parseMarketTimestamp(tradeDate: string, tradeTime?: string) {
  const normalizedDate = /^\d{8}$/.test(tradeDate)
    ? `${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6, 8)}`
    : tradeDate.replace(/\//g, "-").slice(0, 10)
  const timeMatch = (tradeTime ?? "").match(/\d{2}:\d{2}:\d{2}/)
  const normalizedTime = timeMatch?.[0] ?? "15:00:00"
  const date = new Date(`${normalizedDate}T${normalizedTime}+08:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDateTime(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function recordDateInChina(value?: string) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" })
}

function toNumber(value: string | number | null | undefined) {
  if (value == null) return undefined
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size))
  return result
}
