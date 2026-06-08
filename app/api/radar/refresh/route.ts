import { NextResponse } from "next/server"
import {
  emptyRadarSnapshotPayload,
  loadLatestRadarSnapshot,
  radarSnapshotMaxAgeMs,
  refreshRadarSnapshot,
  type RadarSnapshotPayload,
} from "@/lib/radar-snapshot-store"
import { resolveWithFallback } from "@/lib/async-timeout"
import { getChinaMarketSession } from "@/lib/cn-market-session"
import type { SignalLevel, StockSignal } from "@/lib/radar-data"
import { excludeSignalsWithLaterExits, recordsToExitRecordsForTradeDate, recordsToOpenSignalsForTradeDate } from "@/lib/radar-ledger-signals"
import { loadRadarSignalHistoryRecordsForTradeDate } from "@/lib/radar-signal-store"

export const dynamic = "force-dynamic"
export const maxDuration = 60
const LEDGER_ATTACH_TIMEOUT_MS = 2_500

export async function GET(request: Request) {
  const marketSession = getChinaMarketSession()
  const url = new URL(request.url)
  const forceCompute = url.searchParams.get("compute") === "1"
  if (forceCompute) {
    const size = Number(url.searchParams.get("size"))
    const refreshed = await refreshRadarSnapshot({
      source: "manual",
      marketSession,
      scanTargetSize: Number.isFinite(size) ? size : undefined,
    })
    return NextResponse.json(refreshed.payload)
  }

  const snapshot = await loadLatestRadarSnapshot({
    tradeDate: marketSession.tradeDate,
    maxAgeMs: radarSnapshotMaxAgeMs(marketSession),
    allowStale: true,
  })
  if (snapshot) return NextResponse.json(await attachTodayLedgerSignals(snapshot, marketSession))

  return NextResponse.json(emptyRadarSnapshotPayload(
    marketSession,
    "暂无雷达快照：后台任务会扫描统一股票池并写入快照；本接口不再为页面现场重算 500 只股票。",
  ))
}

async function attachTodayLedgerSignals(payload: RadarSnapshotPayload, marketSession: ReturnType<typeof getChinaMarketSession>) {
  try {
    if (payload.diagnosticsSummary.dataFreshness?.blocksNewSignals || payload.diagnosticsSummary.dataFreshness?.dailyDataStale) {
      return {
        ...payload,
        snapshot: payload.snapshot
          ? {
              ...payload.snapshot,
              note: payload.diagnosticsSummary.dataFreshness.staleReason ??
                "数据新鲜度未通过，暂不使用今日信号账本覆盖雷达快照。",
            }
          : payload.snapshot,
      } satisfies RadarSnapshotPayload
    }
    const records = await resolveWithFallback(loadRadarSignalHistoryRecordsForTradeDate(marketSession.tradeDate, 500), {
      timeoutMs: LEDGER_ATTACH_TIMEOUT_MS,
      onFallback: () => [],
    })
    const signals = excludeSignalsWithLaterExits(
      recordsToOpenSignalsForTradeDate(records, marketSession.tradeDate),
      recordsToExitRecordsForTradeDate(records, marketSession.tradeDate),
    )
    if (!signals.length) return payload

    return {
      ...payload,
      report: {
        ...payload.report,
        conclusion: ledgerConclusion(signals, payload.report.conclusion),
        overview: {
          ...payload.report.overview,
          signals: signalCounts(signals),
          actionSignalCount: signals.length,
          pools: [
            {
              name: "今日信号账本",
              count: signals.length,
              cap: 500,
              note: "策略雷达、首页今日精选和实盘模拟共同使用这批落库信号，避免页面口径不一致。",
            },
            ...payload.report.overview.pools.slice(0, 2),
          ],
        },
        suggestions: signals,
      },
      snapshot: payload.snapshot
        ? {
            ...payload.snapshot,
            note: "已用今日信号账本覆盖页面展示；原始雷达快照仅作为后台扫描来源。",
          }
        : payload.snapshot,
    } satisfies RadarSnapshotPayload
  } catch {
    return payload
  }
}

function ledgerConclusion(signals: StockSignal[], fallback: string) {
  const confluenceCandidates = new Set<string>()
  const strategyByTicker = new Map<string, Set<string>>()
  for (const signal of signals) {
    const set = strategyByTicker.get(signal.ticker) ?? new Set<string>()
    set.add(signal.strategyId ?? signal.strategyName ?? "unknown")
    strategyByTicker.set(signal.ticker, set)
    if (set.size >= 2) confluenceCandidates.add(signal.ticker)
  }
  if (!signals.length) return fallback
  return `今日信号账本已落库 ${signals.length} 条打开信号，其中 ${confluenceCandidates.size} 只股票被 2 个以上上线策略共同推荐；本页、首页和实盘模拟使用同一口径。`
}

function signalCounts(signals: StockSignal[]) {
  return signals.reduce(
    (acc, signal) => {
      acc[signal.signalLevel] += 1
      return acc
    },
    { green: 0, yellow: 0, blue: 0, compass: 0, purple: 0, orange: 0, red: 0 } satisfies Record<SignalLevel, number>,
  )
}
