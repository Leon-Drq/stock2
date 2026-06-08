import {
  EXECUTABLE_RADAR_STRATEGY_BY_ID,
  RADAR_STRATEGY,
  type RadarStrategyConfig,
} from "@/lib/strategy-registry"
import {
  getStrategyRegistryEntry,
  getStrategyRegistrySnapshot,
  type StrategyRegistryEntry,
} from "@/lib/strategy-registry-store"
import { strategyDeploymentDecision } from "@/lib/strategy-deployment"

export type RadarStrategySelection = {
  strategy: RadarStrategyConfig
  entry?: StrategyRegistryEntry
  source: "registry" | "fallback"
  skipped: Array<{
    strategyId: string
    name: string
    status: string
    reason: string
  }>
}

export type RadarStrategyCandidate = {
  strategy: RadarStrategyConfig
  entry?: StrategyRegistryEntry
  source: "registry" | "fallback"
}

export type RadarStrategySelections = {
  strategies: RadarStrategyCandidate[]
  source: "registry" | "fallback"
  skipped: RadarStrategySelection["skipped"]
}

export type RadarStrategySelectionOptions = {
  includePaperWatch?: boolean
  strategyIds?: string[]
}

export async function selectExecutableRadarStrategies(
  limit = 8,
  options: RadarStrategySelectionOptions = {},
): Promise<RadarStrategySelections> {
  const skipped: RadarStrategySelection["skipped"] = []
  const requestedIds = new Set((options.strategyIds ?? []).map((id) => id.trim()).filter(Boolean))

  try {
    const snapshot = await getStrategyRegistrySnapshot(120)
    const executable = snapshot.entries
      .map((entry) => ({ entry, decision: strategyDeploymentDecision(entry) }))
      .filter(({ entry, decision }) => {
        if (requestedIds.size > 0 && !requestedIds.has(entry.strategyId)) return false
        if (decision.radar.status === "online") return true
        if (options.includePaperWatch && decision.paper.status === "watch" && decision.hasExecutableMapping) return true
        if (decision.radar.status === "mapping-missing") {
          skipped.push({
            strategyId: entry.strategyId,
            name: entry.name,
            status: entry.status,
            reason: decision.radar.reason,
          })
        }
        return false
      })
      .sort((a, b) => b.entry.score - a.entry.score)

    const strategies: RadarStrategyCandidate[] = []
    for (const { entry } of executable) {
      const strategy = EXECUTABLE_RADAR_STRATEGY_BY_ID.get(entry.strategyId)
      if (strategy) strategies.push({ strategy, entry, source: "registry" })
    }
    const limitedStrategies = strategies.slice(0, Math.max(1, limit))

    if (limitedStrategies.length > 0) {
      return { strategies: limitedStrategies, source: "registry", skipped }
    }

    const fallbackEntry = snapshot.entries.find((entry) => entry.strategyId === RADAR_STRATEGY.id)
    if (fallbackEntry) {
      return {
        strategies: [{ strategy: RADAR_STRATEGY, entry: fallbackEntry, source: "registry" }],
        source: "registry",
        skipped,
      }
    }

    if (requestedIds.size > 0) {
      return { strategies: [], source: "registry", skipped }
    }
  } catch {
    // 页面和 API 不能因为注册表短暂不可用而阻塞，后续用默认策略降级。
  }

  if (requestedIds.size > 0) {
    const requestedFallbacks: RadarStrategyCandidate[] = Array.from(requestedIds)
      .map((id) => EXECUTABLE_RADAR_STRATEGY_BY_ID.get(id))
      .filter((strategy): strategy is RadarStrategyConfig => Boolean(strategy))
      .map((strategy) => ({ strategy, source: "fallback" as const }))
    return {
      strategies: requestedFallbacks.slice(0, Math.max(1, limit)),
      source: "fallback",
      skipped,
    }
  }

  const fallbackEntry = await getStrategyRegistryEntry(RADAR_STRATEGY.id)
  return {
    strategies: [{
      strategy: RADAR_STRATEGY,
      entry: fallbackEntry ?? undefined,
      source: fallbackEntry ? "registry" : "fallback",
    }],
    source: fallbackEntry ? "registry" : "fallback",
    skipped,
  }
}

export async function selectExecutableRadarStrategy(): Promise<RadarStrategySelection> {
  const selection = await selectExecutableRadarStrategies(1)
  const first = selection.strategies[0] ?? { strategy: RADAR_STRATEGY, source: "fallback" as const }
  return {
    strategy: first.strategy,
    entry: first.entry,
    source: first.source,
    skipped: selection.skipped,
  }
}
