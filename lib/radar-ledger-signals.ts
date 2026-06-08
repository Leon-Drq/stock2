import { PAPER_CONFLUENCE_STRATEGY_ID } from "@/lib/paper-confluence-constants"
import { radarLifecycleStatus, type RadarHistoryRecord } from "@/lib/radar-history"
import type { BuyPoint, SignalKind, SignalLevel, StockSignal } from "@/lib/radar-data"

export function recordsToOpenSignalsForTradeDate(records: RadarHistoryRecord[], tradeDate: string): StockSignal[] {
  return records
    .filter((record) => {
      if (radarLifecycleStatus(record) !== "open") return false
      if (record.status !== "跟踪中") return false
      if (record.lifecycleStage === "candidate") return false
      return signalDateInChina(record.recommendedAt) === tradeDate
    })
    .map(radarHistoryRecordToSignal)
}

export function recordsToExitRecordsForTradeDate(records: RadarHistoryRecord[], tradeDate: string): RadarHistoryRecord[] {
  return records
    .filter((record) => {
      const status = radarLifecycleStatus(record)
      if (status !== "target-hit" && status !== "stopped" && status !== "expired") return false
      return signalDateInChina(record.closedAt ?? record.latestQuoteAt ?? record.recommendedAt) === tradeDate
    })
    .sort((a, b) => {
      const aTime = recordTimeMs(a.closedAt ?? a.latestQuoteAt ?? a.recommendedAt)
      const bTime = recordTimeMs(b.closedAt ?? b.latestQuoteAt ?? b.recommendedAt)
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0)
    })
}

export function excludeSignalsWithLaterExits(signals: StockSignal[], exitRecords: RadarHistoryRecord[]): StockSignal[] {
  return signals.filter((signal) => !hasLaterExit(signal, exitRecords))
}

export function radarHistoryRecordToSignal(record: RadarHistoryRecord): StockSignal {
  const triggerPrice = positiveNumber(record.triggerPrice) ?? positiveNumber(record.latestPrice) ?? 0
  const latestPrice = positiveNumber(record.latestPrice) ?? triggerPrice
  const returnPct = Number.isFinite(record.returnPct) ? record.returnPct : triggerPrice > 0 ? (latestPrice / triggerPrice - 1) * 100 : 0
  const stopLossPrice = positiveNumber(record.stopLossPrice) ?? triggerPrice * 0.96
  const targetPrice = positiveNumber(record.targetPrice) ?? triggerPrice * 1.06
  const upsidePct = triggerPrice > 0 ? Math.max(0, (targetPrice / triggerPrice - 1) * 100) : 0
  const riskPct = triggerPrice > 0 ? Math.max(0, (1 - stopLossPrice / triggerPrice) * 100) : 0
  const recommendedAt = record.recommendedAt
  const date = signalDateInChina(recommendedAt) ?? recommendedAt.slice(0, 10)

  return {
    ticker: record.ticker,
    name: record.name,
    exchange: record.ticker.startsWith("6") ? "SH" : record.ticker.startsWith("8") || record.ticker.startsWith("4") ? "BJ" : "SZ",
    signalLevel: signalLevelFromRecord(record, returnPct),
    signalKind: normalizeSignalKind(record.signalKind),
    price: latestPrice,
    changePct: returnPct,
    date,
    signalId: record.id,
    signalLifecycle: "tracking",
    lifecycleStage: record.lifecycleStage ?? "tracking",
    lifecycleStatus: record.lifecycleStatus ?? "open",
    latestQuoteAt: record.latestQuoteAt,
    recommendedAt,
    triggerPrice,
    returnSinceSignalPct: returnPct,
    mfePct: record.maxReturnPct,
    maePct: record.maxDrawdownPct,
    closedAt: record.closedAt,
    buyPoint: normalizeBuyPoint(record.buyPoint),
    reason: record.note,
    position: { current: null, max: 20 },
    suggestion: record.signal,
    stopLoss: { price: stopLossPrice, riskPct },
    invalidation: { price: stopLossPrice, reason: record.exitReason ?? "跌破风控价" },
    winRatePct: record.strategyId === PAPER_CONFLUENCE_STRATEGY_ID ? 62 : 50,
    oddsRatio: upsidePct > 0 && riskPct > 0 ? Math.max(1, upsidePct / riskPct) : 2,
    upsidePct: upsidePct || 6,
    strategyId: record.strategyId,
    strategyName: record.strategyName,
    priceStatus: record.priceStatus,
  }
}

function signalLevelFromRecord(record: RadarHistoryRecord, returnPct: number): SignalLevel {
  if (record.strategyId === PAPER_CONFLUENCE_STRATEGY_ID) return "blue"
  if (returnPct >= 2) return "green"
  if (returnPct >= 0) return "yellow"
  return "orange"
}

function normalizeSignalKind(value?: string): SignalKind {
  if (
    value === "high-confidence-buy" ||
    value === "add-confirm" ||
    value === "left-side-trial" ||
    value === "hold-no-add" ||
    value === "watch" ||
    value === "exit"
  ) {
    return value
  }
  return "add-confirm"
}

function normalizeBuyPoint(value?: string): BuyPoint {
  if (
    value === "breakout-confirm" ||
    value === "left-side" ||
    value === "pullback" ||
    value === "ema-touch" ||
    value === "platform-break"
  ) {
    return value
  }
  return "breakout-confirm"
}

function signalDateInChina(value?: string) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d)
}

function hasLaterExit(signal: StockSignal, exitRecords: RadarHistoryRecord[]) {
  const signalTime = signalTimeMs(signal)
  return exitRecords.some((record) => {
    if (record.ticker !== signal.ticker) return false
    const exitTime = recordTimeMs(record.closedAt ?? record.latestQuoteAt ?? record.recommendedAt)
    if (!Number.isFinite(exitTime)) return true
    if (!Number.isFinite(signalTime)) return true
    return exitTime >= signalTime
  })
}

function signalTimeMs(signal: StockSignal) {
  return recordTimeMs(signal.recommendedAt ?? `${signal.date}T${signal.quoteTime ?? "09:30:00"}+08:00`)
}

function recordTimeMs(value?: string) {
  if (!value) return NaN
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : NaN
}

function positiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}
