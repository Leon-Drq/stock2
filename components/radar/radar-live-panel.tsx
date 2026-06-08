"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"
import { Colophon } from "@/components/radar/colophon"
import { Conclusion } from "@/components/radar/conclusion"
import { DataSourceBadge } from "@/components/radar/data-source-badge"
import { Overview } from "@/components/radar/overview"
import { Suggestions } from "@/components/radar/suggestions"
import { TrackRecord } from "@/components/radar/track-record"
import { MissedMoveAuditPanel } from "@/components/radar/missed-move-audit-panel"
import { RadarRunDiagnostics } from "@/components/radar/radar-run-diagnostics"
import type { ChinaMarketSession } from "@/lib/cn-market-session"
import { formatBeijingTime } from "@/lib/format"
import type { RadarReport } from "@/lib/radar-data"

type RadarDiagnostics = {
  source: "qveris+factors" | "mock+factors" | "fallback"
  qverisCount: number
  mockCount: number
  quoteCount: number
  quoteTotal: number
  quoteFetchedAt?: string
  quoteCacheAgeMs?: number
  quoteTtlMs?: number
  quoteFallbackReason?: string
  scanUniverse?: {
    id: string
    label: string
    scope: "backtest" | "radar" | "paper" | "miss-audit"
    stockPoolSize: number
    targetSize: number
    requestedSymbols: number
    historyAvailable: number
    skippedNoHistory: number
    quoteRequested: number
    quoteReturned: number
    note: string
    prefilter?: {
      source: "postgres-indicators" | "unavailable"
      inputSymbols: number
      selectedSymbols: number
      eligibleSymbols: number
      latestDate?: string
      minBars: number
      note: string
    }
  }
  intradayRadar?: {
    scanned: number
    quoted: number
    triggered: number
    patterns: Record<string, number>
  }
  marketSession: ChinaMarketSession
  factorIRs: { id: string; meanIC: number; ir: number }[]
  dataFreshness?: {
    latestBarDate?: string
    latestQuoteDate?: string
    effectiveDataDate?: string
    expectedTradeDate: string
    blocksNewSignals: boolean
    staleReason?: string
  }
  fallbackReason?: string
}

type RadarRefreshResponse = {
  ok: boolean
  report?: RadarReport
  diagnostics?: RadarDiagnostics
  marketSession?: ChinaMarketSession
  snapshot?: {
    source: "postgres" | "cache" | "computed" | "empty"
    generatedAt: string
    ageMs: number
    stale: boolean
    scannedSymbols?: number
    prefilteredSymbols?: number
    note?: string
  }
}

type Props = {
  initialReport: RadarReport
  initialDiagnostics: RadarDiagnostics
  initialMarketSession: ChinaMarketSession
}

export function RadarLivePanel({ initialReport, initialDiagnostics, initialMarketSession }: Props) {
  const [report, setReport] = useState(initialReport)
  const [diagnostics, setDiagnostics] = useState(initialDiagnostics)
  const [marketSession, setMarketSession] = useState(initialDiagnostics.marketSession ?? initialMarketSession)
  const [lastPulledAt, setLastPulledAt] = useState<Date | null>(null)
  const [snapshot, setSnapshot] = useState<RadarRefreshResponse["snapshot"]>(undefined)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [hasCompletedFirstFetch, setHasCompletedFirstFetch] = useState(initialDiagnostics.source !== "fallback")
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [manualRefreshNonce, setManualRefreshNonce] = useState(0)
  const seenSignalIdsRef = useRef(new Set(initialReport.suggestions.map(signalIdentity)))
  const refreshMs = refreshIntervalMs(marketSession)
  const isInitialLoading = !hasCompletedFirstFetch && initialDiagnostics.source === "fallback"

  useEffect(() => {
    let cancelled = false

    async function refresh() {
      setIsRefreshing(true)
      setRefreshError(null)
      try {
        const res = await fetch("/api/radar/refresh", { cache: "no-store" })
        const json = (await res.json()) as RadarRefreshResponse
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        if (!cancelled && json.ok && json.report && json.diagnostics) {
          setReport(markRepeatedSignals(json.report, seenSignalIdsRef.current))
          setDiagnostics(json.diagnostics)
          setMarketSession(json.marketSession ?? json.diagnostics.marketSession)
          setSnapshot(json.snapshot)
          setLastPulledAt(new Date())
          setHasCompletedFirstFetch(true)
        } else if (!cancelled && json.marketSession) {
          setMarketSession(json.marketSession)
          setSnapshot(json.snapshot)
          setHasCompletedFirstFetch(true)
          setRefreshError("雷达接口没有返回完整报告，已保留当前页面状态。")
        } else if (!cancelled) {
          setHasCompletedFirstFetch(true)
          setRefreshError("雷达接口返回为空，已保留当前页面状态。")
        }
      } catch (error) {
        if (!cancelled) {
          setHasCompletedFirstFetch(true)
          setRefreshError(error instanceof Error ? error.message : "雷达刷新失败")
        }
      } finally {
        if (!cancelled) setIsRefreshing(false)
      }
    }

    void refresh()

    if (!refreshMs) {
      return () => {
        cancelled = true
      }
    }

    const timer = window.setInterval(refresh, refreshMs)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [refreshMs, manualRefreshNonce])

  const refreshLabel = useMemo(() => {
    if (isInitialLoading) return "连接中"
    if (isRefreshing) return "刷新中"
    if (snapshot?.stale) return `快照滞后 · ${Math.max(1, Math.round(snapshot.ageMs / 60_000))}m`
    if (snapshot?.source === "postgres" || snapshot?.source === "cache") {
      return `快照 ${Math.max(0, Math.round(snapshot.ageMs / 60_000))}m`
    }
    if (!refreshMs) return marketSession.phaseLabel
    if (!lastPulledAt) return `${Math.round(refreshMs / 60_000)}m 自动刷新`
    return `已刷新 ${formatBeijingTime(lastPulledAt)}`
  }, [isInitialLoading, isRefreshing, lastPulledAt, marketSession.phaseLabel, refreshMs, snapshot])

  return (
    <div className="mx-auto grid min-w-0 max-w-[1760px] gap-5 px-3 py-4 sm:px-4 sm:py-5 md:px-6 md:py-7 2xl:grid-cols-[400px_minmax(0,1fr)]">
      <aside className="order-2 min-w-0 2xl:order-1 2xl:sticky 2xl:top-5 2xl:self-start">
        <div className="mb-3 flex items-center justify-between rounded-[7px] border border-rule bg-white px-3 py-2 font-mono text-[11px] text-ink-muted">
          <span className="inline-flex items-center gap-2">
            <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} aria-hidden />
            {refreshLabel}
          </span>
          <button
            type="button"
            onClick={() => setManualRefreshNonce((value) => value + 1)}
            disabled={isRefreshing}
            className="rounded-[5px] border border-rule bg-[#fafafa] px-2 py-1 text-[10px] text-ink-soft transition hover:bg-white disabled:cursor-wait disabled:opacity-60"
          >
            {isRefreshing ? "刷新中" : "立即刷新"}
          </button>
        </div>
        {refreshError && (
          <div className="mb-3 rounded-[7px] border border-[#ead9b8] bg-[#fff8e9] px-3 py-2 text-[12px] leading-5 text-warning">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <p>
                雷达刷新失败：{refreshError}。页面会保留最近一次结果，可点“立即刷新”重试。
              </p>
            </div>
          </div>
        )}
        <div className="mb-3 rounded-[7px] border border-rule bg-white px-3 py-2 text-[12px] leading-5 text-ink-muted">
          <span className="font-mono text-[11px] text-ink-faint">A-share session</span>
          <p className="mt-1">{marketSession.note}</p>
        </div>
        <RadarAdmissionNote />
        {snapshot && <RadarSnapshotNote snapshot={snapshot} />}
        <DataSourceBadge diagnostics={diagnostics} />
        <RadarRunDiagnostics diagnostics={diagnostics} />
        <Conclusion text={report.conclusion} />
        {report.trackRecord && <TrackRecord trackRecord={report.trackRecord} />}
        <Overview overview={report.overview} compact />
        <Colophon />
      </aside>
      <div className="order-1 min-w-0 2xl:order-2">
        <Suggestions
          suggestions={report.suggestions}
          isLoading={isInitialLoading}
          refreshError={refreshError}
          onRetry={() => setManualRefreshNonce((value) => value + 1)}
        />
        <MissedMoveAuditPanel />
      </div>
    </div>
  )
}

function RadarSnapshotNote({ snapshot }: { snapshot: NonNullable<RadarRefreshResponse["snapshot"]> }) {
  const sourceLabel = snapshot.source === "postgres"
    ? "Postgres 快照"
    : snapshot.source === "cache"
      ? "缓存快照"
      : snapshot.source === "computed"
        ? "刚生成"
        : "等待生成"
  return (
    <div className="mb-3 rounded-[7px] border border-rule bg-white px-3 py-2 text-[12px] leading-5 text-ink-muted">
      <span className="font-mono text-[11px] text-ink-faint">Radar snapshot</span>
      <p className="mt-1">
        {sourceLabel} · {snapshot.prefilteredSymbols
          ? `${snapshot.scannedSymbols ?? 0} 只全池 → ${snapshot.prefilteredSymbols} 只深算`
          : `${snapshot.scannedSymbols ?? 0} 只`} · {snapshot.stale ? "已滞后" : "可用"}。
        {snapshot.note ? ` ${snapshot.note}` : " 页面只读扫描快照，不再现场重算全池。"}
      </p>
    </div>
  )
}

function RadarAdmissionNote() {
  return (
    <div className="mb-3 rounded-[7px] border border-rule bg-white px-3 py-2 text-[12px] leading-5 text-ink-muted">
      <span className="font-mono text-[11px] text-ink-faint">Radar admission</span>
      <p className="mt-1">
        只运行注册表放行的策略；观察池、低收益和未完成真实回测的策略不会进入 L3 推荐流。
      </p>
    </div>
  )
}

function markRepeatedSignals(report: RadarReport, seen: Set<string>): RadarReport {
  const suggestions = report.suggestions.map((signal) => {
    const id = signalIdentity(signal)
    const wasSeen = seen.has(id)
    seen.add(id)
    return {
      ...signal,
      signalId: signal.signalId ?? id,
      signalLifecycle: signal.signalLifecycle === "candidate"
        ? "candidate" as const
        : signal.signalLifecycle === "tracking" || wasSeen
          ? "tracking" as const
          : "new" as const,
    }
  })

  return { ...report, suggestions }
}

function refreshIntervalMs(session: ChinaMarketSession) {
  if (session.quoteRefreshMs > 0) return session.quoteRefreshMs
  if (session.phase === "lunch") return session.radarRefreshMs
  return 0
}

function signalIdentity(signal: RadarReport["suggestions"][number]) {
  return signal.signalId ?? [
    signal.strategyId ?? "default",
    signal.ticker,
    signal.signalKind,
    signal.buyPoint,
  ].join(":")
}
