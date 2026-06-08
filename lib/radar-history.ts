import type { StockSignal } from "@/lib/radar-data"

export type RadarHistoryRecord = {
  id: string
  recommendedAt: string
  latestQuoteAt?: string
  closedAt?: string
  ticker: string
  name: string
  industry?: string
  strategyId?: string
  strategyName?: string
  signalKind?: string
  buyPoint?: string
  lifecycleStage?: "candidate" | "triggered" | "tracking" | "target-hit" | "stopped" | "expired" | "invalidated"
  lifecycleStatus?: "open" | "stopped" | "target-hit" | "expired"
  signal: string
  triggerPrice: number
  latestPrice: number
  returnPct: number
  maxReturnPct: number
  maxDrawdownPct?: number
  holdDays?: number
  stopLossPrice?: number
  targetPrice?: number
  exitReason?: string
  priceStatus?: "tracked" | "pending-follow-up"
  status: "跟踪中" | "已止盈" | "已失效" | "已止损" | "到期"
  note: string
}

export function radarLifecycleStatus(record: RadarHistoryRecord): "open" | "stopped" | "target-hit" | "expired" {
  if (record.lifecycleStatus) return record.lifecycleStatus
  if (record.status === "已止盈") return "target-hit"
  if (record.status === "已失效" || record.status === "已止损") return "stopped"
  if (record.status === "到期") return "expired"
  return "open"
}

export function radarHistoryStatusFromLifecycle(
  status: RadarHistoryRecord["lifecycleStatus"] | "open" | undefined,
): RadarHistoryRecord["status"] {
  if (status === "target-hit") return "已止盈"
  if (status === "stopped") return "已失效"
  if (status === "expired") return "到期"
  return "跟踪中"
}

export function radarExitPrice(record: RadarHistoryRecord) {
  const status = radarLifecycleStatus(record)
  if (status === "target-hit" && isPositiveNumber(record.targetPrice) && record.latestPrice < record.targetPrice) {
    return record.targetPrice
  }
  if (status === "stopped" && isPositiveNumber(record.stopLossPrice) && record.latestPrice > record.stopLossPrice) {
    return record.stopLossPrice
  }
  return record.latestPrice
}

export function radarExitReturnPct(record: RadarHistoryRecord) {
  const exitPrice = radarExitPrice(record)
  if (record.triggerPrice > 0 && Number.isFinite(exitPrice)) {
    return (exitPrice / record.triggerPrice - 1) * 100
  }
  return record.returnPct
}

export function radarExitActionLabel(record: RadarHistoryRecord) {
  const status = radarLifecycleStatus(record)
  if (status === "target-hit") return "止盈卖出"
  if (status === "expired") return "到期退出"
  if (status === "stopped") {
    const ret = radarExitReturnPct(record)
    if (ret > 0.05) return "风控卖出"
    if (ret < -0.05) return "止损卖出"
    return "平价退出"
  }
  return "卖出记录"
}

export function radarExitTone(record: RadarHistoryRecord): "good" | "bad" | "neutral" {
  const ret = radarExitReturnPct(record)
  if (ret > 0.05) return "good"
  if (ret < -0.05) return "bad"
  return "neutral"
}

export const SEEDED_RADAR_HISTORY: RadarHistoryRecord[] = [
  {
    id: "20260513-002518",
    recommendedAt: "2026-05-13T09:51:00+08:00",
    ticker: "002518",
    name: "科士达",
    signal: "突破确认",
    triggerPrice: 50.43,
    latestPrice: 54.58,
    returnPct: 8.23,
    maxReturnPct: 10.4,
    status: "到期",
    note: "T+1 跑赢沪深 300，信号有效。",
  },
  {
    id: "20260513-601669",
    recommendedAt: "2026-05-13T09:51:00+08:00",
    ticker: "601669",
    name: "中国电建",
    signal: "加仓确认",
    triggerPrice: 5.94,
    latestPrice: 6.04,
    returnPct: 1.68,
    maxReturnPct: 2.7,
    status: "到期",
    note: "温和上涨，未触发止损。",
  },
  {
    id: "20260513-300608",
    recommendedAt: "2026-05-13T09:51:00+08:00",
    ticker: "300608",
    name: "思特奇",
    signal: "左侧试仓",
    triggerPrice: 18.62,
    latestPrice: 18.54,
    returnPct: -0.43,
    maxReturnPct: 1.1,
    status: "到期",
    note: "信号偏弱，适合小仓位验证。",
  },
]

export function recordsFromSignals(signals: StockSignal[]): RadarHistoryRecord[] {
  return signals.map((signal) => {
    const triggerPrice = signal.triggerPrice ?? signal.price
    const returnPct = signal.returnSinceSignalPct ?? (triggerPrice > 0 ? (signal.price / triggerPrice - 1) * 100 : 0)
    const mfePct = signal.mfePct ?? returnPct
    const recommendedAt = signal.recommendedAt ?? `${signal.date}T${signal.quoteTime ?? "09:30:00"}+08:00`
    const latestQuoteAt = signal.latestQuoteAt ?? signal.recommendedAt
    const targetPrice = triggerPrice * (1 + signal.upsidePct / 100)
    return {
      id: signal.signalId ?? `${signal.date}-${signal.ticker}`,
      recommendedAt,
      ticker: signal.ticker,
      name: signal.name,
      strategyId: signal.strategyId,
      strategyName: signal.strategyName,
      signalKind: signal.signalKind,
      buyPoint: signal.buyPoint,
      lifecycleStage: signal.lifecycleStage ?? (signal.signalLifecycle === "candidate" ? "candidate" : signal.signalLifecycle === "tracking" ? "tracking" : "triggered"),
      lifecycleStatus: signal.lifecycleStatus ?? "open",
      latestQuoteAt,
      closedAt: signal.closedAt,
      priceStatus: signal.priceStatus,
      signal: signal.suggestion,
      triggerPrice,
      latestPrice: signal.price,
      returnPct,
      maxReturnPct: mfePct,
      maxDrawdownPct: signal.maePct ?? Math.min(returnPct, 0),
      holdDays: holdingDays(recommendedAt, signal.closedAt ?? latestQuoteAt),
      stopLossPrice: signal.invalidation?.price ?? signal.stopLoss.price,
      targetPrice,
      exitReason: signal.closeReason,
      status: radarHistoryStatusFromLifecycle(signal.lifecycleStatus ?? "open"),
      note: signal.reason,
    }
  })
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function holdingDays(startIso: string, endIso?: string) {
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0
  return Math.max(0, Math.ceil((end - start) / 86_400_000))
}
