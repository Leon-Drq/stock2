import { resolveWithFallback } from "@/lib/async-timeout"
import { getChinaMarketSession, type ChinaMarketSession } from "@/lib/cn-market-session"
import type { StockSignal } from "@/lib/radar-data"
import { excludeSignalsWithLaterExits, recordsToExitRecordsForTradeDate, recordsToOpenSignalsForTradeDate } from "@/lib/radar-ledger-signals"
import { loadRadarSignalHistoryRecordsForTradeDate } from "@/lib/radar-signal-store"
import { loadLatestRadarSnapshot, radarSnapshotMaxAgeMs, type RadarSnapshotPayload } from "@/lib/radar-snapshot-store"
import type { RadarHistoryRecord } from "@/lib/radar-history"

export type TodayRadarSignalSource = "qveris+ledger" | "qveris+snapshot" | "ledger"

export type TodayRadarSignalView = {
  tradeDate: string
  source: TodayRadarSignalSource
  signals: StockSignal[]
  ledgerSignals: StockSignal[]
  snapshotSignals: StockSignal[]
  records: RadarHistoryRecord[]
  exitRecords: RadarHistoryRecord[]
  snapshot: RadarSnapshotPayload | null
  dataFreshness?: RadarSnapshotPayload["diagnosticsSummary"]["dataFreshness"]
  snapshotStale?: boolean
  fallbackReason?: string
}

export async function loadTodayRadarSignalView({
  marketSession = getChinaMarketSession(),
  includeTodaySignals = true,
  ledgerLimit = 500,
  ledgerTimeoutMs = 3_000,
  snapshotTimeoutMs = 5_000,
  allowSnapshotFallback = true,
}: {
  marketSession?: ChinaMarketSession
  includeTodaySignals?: boolean
  ledgerLimit?: number
  ledgerTimeoutMs?: number
  snapshotTimeoutMs?: number
  allowSnapshotFallback?: boolean
} = {}): Promise<TodayRadarSignalView> {
  const tradeDate = marketSession.tradeDate
  const [snapshot, records] = await Promise.all([
    allowSnapshotFallback
      ? resolveWithFallback(
          loadLatestRadarSnapshot({
            tradeDate,
            maxAgeMs: radarSnapshotMaxAgeMs(marketSession),
            allowStale: !marketSession.allowsNewSignals,
          }),
          {
            timeoutMs: snapshotTimeoutMs,
            onFallback: () => null,
          },
        )
      : Promise.resolve(null),
    includeTodaySignals
      ? resolveWithFallback(loadRadarSignalHistoryRecordsForTradeDate(tradeDate, ledgerLimit), {
          timeoutMs: ledgerTimeoutMs,
          onFallback: () => [],
        })
      : Promise.resolve([]),
  ])
  const exitRecords = recordsToExitRecordsForTradeDate(records, tradeDate)
  const ledgerSignals = excludeSignalsWithLaterExits(
    recordsToOpenSignalsForTradeDate(records, tradeDate),
    exitRecords,
  )
  const dataFreshness = snapshot?.diagnosticsSummary.dataFreshness
  const snapshotUsable = isSnapshotUsableForTrading(snapshot, marketSession)
  const snapshotSignals = snapshotUsable ? snapshotSignalsForTradeDate(snapshot, tradeDate) : []

  if (ledgerSignals.length > 0) {
    return {
      tradeDate,
      source: "qveris+ledger",
      signals: ledgerSignals,
      ledgerSignals,
      snapshotSignals,
      records,
      exitRecords,
      snapshot,
      dataFreshness,
      snapshotStale: Boolean(snapshot?.snapshot?.stale),
    }
  }

  if (snapshotSignals.length > 0) {
    return {
      tradeDate,
      source: "qveris+snapshot",
      signals: snapshotSignals,
      ledgerSignals,
      snapshotSignals,
      records,
      exitRecords,
      snapshot,
      dataFreshness,
      snapshotStale: Boolean(snapshot?.snapshot?.stale),
      fallbackReason: snapshotFallbackReason(snapshot, snapshotSignals.length),
    }
  }

  return {
    tradeDate,
    source: "ledger",
    signals: [],
    ledgerSignals,
    snapshotSignals,
    records,
    exitRecords,
    snapshot,
    dataFreshness,
    snapshotStale: Boolean(snapshot?.snapshot?.stale),
    fallbackReason: marketSession.isTradingDay
      ? snapshotBlockedReason(snapshot, marketSession) ?? "当前信号账本暂无今日主买记录，且最近雷达快照没有动作级信号；等待下一次定时任务写入。"
      : `${marketSession.phaseLabel}：${marketSession.note}`,
  }
}

export function snapshotSignalsForTradeDate(snapshot: RadarSnapshotPayload | null, tradeDate: string) {
  if (!snapshot) return []
  return snapshot.report.suggestions.filter((signal) => {
    if (signal.signalLifecycle === "candidate" || signal.signalLifecycle === "closed") return false
    const signalDate = signalDateInChina(signal.recommendedAt) ?? signal.date
    return signalDate === tradeDate
  })
}

function snapshotFallbackReason(snapshot: RadarSnapshotPayload | null, signalCount: number) {
  const snapshotTime = snapshot ? formatSignalTime(snapshot.generatedAt) : "待确认"
  if (signalCount > 0) {
    const staleText = snapshot?.snapshot?.stale ? "最近快照已略有滞后，" : ""
    return `当前信号账本暂无今日主买记录，已切换到 ${snapshotTime} 的 Qveris 雷达快照；${staleText}等待下一次定时任务写入账本。`
  }
  return undefined
}

function isSnapshotUsableForTrading(snapshot: RadarSnapshotPayload | null, marketSession: ChinaMarketSession) {
  if (!snapshot) return false
  if (!marketSession.allowsNewSignals) return true
  const freshness = snapshot.diagnosticsSummary.dataFreshness
  if (snapshot.snapshot?.stale) return false
  if (freshness?.blocksNewSignals || freshness?.dailyDataStale) return false
  return true
}

function snapshotBlockedReason(snapshot: RadarSnapshotPayload | null, marketSession: ChinaMarketSession) {
  if (!snapshot || !marketSession.allowsNewSignals) return undefined
  const freshness = snapshot.diagnosticsSummary.dataFreshness
  if (freshness?.staleReason) return freshness.staleReason
  if (snapshot.snapshot?.stale) return "最近雷达快照超过实时有效窗口，首页不会用旧快照冒充今日可买信号。"
  return undefined
}

function signalDateInChina(value?: string) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" })
}

function formatSignalTime(value?: string) {
  if (!value) return "待确认"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "待确认"
  return d.toLocaleTimeString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}
