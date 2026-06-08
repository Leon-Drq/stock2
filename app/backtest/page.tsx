import { BacktestDashboardShell } from "@/components/backtest/backtest-dashboard-shell"
import { PageMasthead, PageShell } from "@/components/shared/page-shell"
import { StrategyPipelineStrip } from "@/components/strategies/strategy-pipeline-strip"
import { resolveWithFallback } from "@/lib/async-timeout"
import { runStrategyBacktestReports, scoreBacktestReport, type BacktestReport, type StrategyBacktestReports } from "@/lib/backtest"
import { runStrategyMiningCandidateBacktest } from "@/lib/strategy-miner"
import { getStrategyMiningBacktestReport } from "@/lib/strategy-miner-store"
import { getLatestCatalogBacktestPayload, getStrategyRegistrySnapshot, syncStrategyRegistryFromReports, type StrategyRegistrySnapshot } from "@/lib/strategy-registry-store"

export const metadata = {
  title: "真实历史回测 — Stock Radar",
}

export const dynamic = "force-dynamic"

export default async function BacktestPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const requestedStrategyId = firstParam(params, "strategy")
  const storedBatch = await resolveWithFallback(getLatestCatalogBacktestPayload(), {
    timeoutMs: 1_500,
    onFallback: () => null,
  })
  const batch = storedBatch ?? await resolveWithFallback(runStrategyBacktestReports(), {
    timeoutMs: 4_000,
    onFallback: (reason, error) => backtestFallback(reason, error),
  })
  const cachedMiningReport = requestedStrategyId?.startsWith("mine-")
    ? await resolveWithFallback(getStrategyMiningBacktestReport(requestedStrategyId), {
        timeoutMs: 8_000,
        onFallback: () => null,
      })
    : null
  const mining = requestedStrategyId?.startsWith("mine-") && !cachedMiningReport
    ? await resolveWithFallback(runStrategyMiningCandidateBacktest(requestedStrategyId, { persist: true, maxCandidates: 24, githubLimitPerQuery: 4 }), {
        timeoutMs: 12_000,
        onFallback: () => null,
      })
    : null
  const requestedMiningReports = cachedMiningReport ? [cachedMiningReport] : mining?.candidate?.report ? [mining.candidate.report] : []
  const reports = mergeBacktestReports([...requestedMiningReports, ...batch.reports])
  if (reports.length) {
    await resolveWithFallback(syncStrategyRegistryFromReports(reports), {
      timeoutMs: 1_000,
      onFallback: () => undefined,
    })
  }
  const registrySnapshot = await resolveWithFallback(getStrategyRegistrySnapshot(), {
    timeoutMs: 2_000,
    onFallback: (reason, error) => registryFallback(reason, error),
  })
  const notes = [
    requestedMiningReports.length > 0
      ? `本页已加载策略目录 ${batch.reports.length} 个，并接入策略矿工指定候选 ${requestedMiningReports.length} 个${cachedMiningReport ? "（来自缓存完整回测）" : ""}。`
      : `本页已加载策略目录 ${batch.reports.length} 个，并按综合回测分排序。策略矿工候选从「策略研究」页点击单个策略后按需接入，避免首屏批量回测卡住。`,
    ...batch.notes,
    ...(mining ? [`策略矿工指定候选 ${mining.candidate ? "1/1" : "0/1"} 个已接入本页。`, ...mining.notes] : []),
  ]

  return (
    <PageShell width="wide">
      <PageMasthead
        layer="Layer 2"
        layerEn="Backtest"
        title="真实历史回测"
        subtitle="用 Qveris 拉取真实 A 股后复权日线，优先加载策略目录并按综合分排序；策略矿工候选从策略研究页按需接入，输出净值、超额收益、回撤、调仓明细与日志。"
      />
      <StrategyPipelineStrip
        current="backtest"
        summary="回测页是策略发布前的质量闸门；年化、回撤、数据血缘、交易成本和稳定性不通过，就不会进入正式目录。"
      />
      <BacktestDashboardShell reports={reports} notes={notes} generatedAt={mining?.generatedAt ?? batch.generatedAt} registrySnapshot={registrySnapshot} />
    </PageShell>
  )
}

function mergeBacktestReports(reports: BacktestReport[]) {
  const byId = new Map<string, BacktestReport>()
  for (const report of reports) {
    if (!byId.has(report.strategyId)) byId.set(report.strategyId, report)
  }
  return Array.from(byId.values()).sort((a, b) => scoreBacktestReport(b) - scoreBacktestReport(a))
}

function firstParam(params: Record<string, string | string[] | undefined> | undefined, key: string) {
  const value = params?.[key]
  return Array.isArray(value) ? value[0] : value
}

function backtestFallback(reason: "timeout" | "error", error?: unknown): StrategyBacktestReports {
  const message = reason === "timeout"
    ? "服务端回测读取超过 4 秒，已先展示控制台；请从回测任务中心重新触发。"
    : `服务端回测读取失败：${error instanceof Error ? error.message : "请稍后重试"}`
  return {
    reports: [],
    generatedAt: new Date().toISOString(),
    notes: [message],
  }
}

function registryFallback(reason: "timeout" | "error", error?: unknown): StrategyRegistrySnapshot {
  return {
    driver: "memory",
    configured: true,
    status: "fallback",
    entries: [],
    jobs: [],
    summary: {
      total: 0,
      radarReady: 0,
      watchlist: 0,
      blocked: 0,
      queuedJobs: 0,
      runningJobs: 0,
    },
    error: reason === "timeout"
      ? "策略注册表读取超过 4 秒。"
      : error instanceof Error ? error.message : "策略注册表读取失败。",
  }
}
