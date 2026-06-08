import { PageMasthead, PageShell } from "@/components/shared/page-shell"
import { StrategiesClient } from "@/components/strategies/strategies-client"
import { StrategyPipelineStrip } from "@/components/strategies/strategy-pipeline-strip"
import { resolveWithFallback } from "@/lib/async-timeout"
import { isStrategyCatalogApproved, STRATEGIES } from "@/lib/catalog"
import { applyRegistryToStrategies } from "@/lib/strategy-registry-adapter"
import { getStrategyRegistrySnapshot, type StrategyRegistrySnapshot } from "@/lib/strategy-registry-store"

export const metadata = {
  title: "正式策略目录 — Stock Radar",
}

export const dynamic = "force-dynamic"

export default async function StrategiesPage() {
  const registrySnapshot = await resolveWithFallback(getStrategyRegistrySnapshot(), {
    timeoutMs: 4_000,
    onFallback: (reason, error) => strategyRegistryFallback(reason, error),
  })
  const strategies = applyRegistryToStrategies(STRATEGIES, registrySnapshot)
  const approvedCount = strategies.filter(isStrategyCatalogApproved).length
  const generatedAt = registrySnapshot.entries[0]?.updatedAt ?? new Date().toISOString()
  const notes = [
    registrySnapshot.status === "ready"
      ? `策略目录已接入统一注册表：${approvedCount}/${strategies.length} 个策略通过目录准入；未通过的候选保留在真实回测和策略研究页诊断，不进入正式目录。`
      : `策略注册表暂不可用：${registrySnapshot.error ?? "使用本地目录降级显示"}。`,
  ]

  return (
    <PageShell width="wide">
      <PageMasthead
        layer="Layer 2"
        layerEn="Strategy"
        title="正式策略目录"
        subtitle="这里是回测后的正式货架：候选、矿工和实验室策略先进入真实回测，只有 Qveris 原始数据、收益、回撤和准入分通过后才展示在这里。"
      />
      <StrategyPipelineStrip
        current="catalog"
        summary={`正式目录只展示通过准入的策略；当前 ${approvedCount}/${strategies.length} 个策略可被用户当作可上线候选继续观察。`}
      />
      <StrategiesClient
        strategies={strategies}
        notes={notes}
        generatedAt={generatedAt}
        registrySnapshot={registrySnapshot}
      />
    </PageShell>
  )
}

function strategyRegistryFallback(reason: "timeout" | "error", error?: unknown): StrategyRegistrySnapshot {
  const message = reason === "timeout"
    ? "策略注册表读取超过 4 秒，已先使用本地策略目录。"
    : `策略注册表读取失败：${error instanceof Error ? error.message : "使用本地策略目录"}`

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
    error: message,
  }
}
