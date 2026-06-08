import type { Strategy, StrategyAdmission } from "@/lib/catalog"
import { EXECUTABLE_RADAR_STRATEGIES } from "@/lib/strategy-registry"
import type { StrategyRegistryEntry, StrategyRegistrySnapshot, StrategyRegistryStatus } from "@/lib/strategy-registry-store"

export function applyRegistryToStrategies(
  strategies: Strategy[],
  snapshot?: StrategyRegistrySnapshot,
): Strategy[] {
  if (!snapshot?.entries.length) return strategies
  const byId = new Map(snapshot.entries.map((entry) => [entry.strategyId, entry]))
  const seen = new Set(strategies.map((strategy) => strategy.id))

  const updated = strategies.map((strategy) => {
    const entry = byId.get(strategy.id)
    if (!entry) return { ...strategy, registrySource: strategy.registrySource ?? ("catalog" as const) }
    return {
      ...strategy,
      registrySource: entry.source,
      annualReturn: entry.annualReturn ?? strategy.annualReturn,
      maxDrawdown: entry.maxDrawdown ?? strategy.maxDrawdown,
      sharpe: entry.sharpe ?? strategy.sharpe,
      winRate: entry.winRate ?? strategy.winRate,
      backtestStatus: entry.lastBacktestedAt ? "真实回测" : strategy.backtestStatus,
      backtestSource: normalizeBacktestSource(entry.metadata?.backtestSource) ?? strategy.backtestSource,
      admission: registryAdmission(entry, strategy.admission),
      rankScore: entry.score,
      lastBacktestedAt: entry.lastBacktestedAt ?? strategy.lastBacktestedAt,
    }
  })

  const virtualStrategies = snapshot.entries
    .filter((entry) => !seen.has(entry.strategyId))
    .map(registryEntryToStrategy)

  return [...updated, ...virtualStrategies]
    .sort((a, b) => (b.rankScore ?? b.admission?.score ?? -1) - (a.rankScore ?? a.admission?.score ?? -1))
}

export function registryAdmission(
  entry: StrategyRegistryEntry,
  fallback?: StrategyAdmission,
): StrategyAdmission {
  if (entry.metadata?.admission) return entry.metadata.admission
  const status = normalizeAdmissionStatus(entry.admissionStatus ?? entry.status)
  return {
    status,
    gate: normalizeAdmissionGate(entry.admissionGate, status),
    score: Math.max(0, Math.min(100, Math.round(entry.score))),
    tags: fallback?.tags ?? [sourceTag(entry.source), "注册表同步"],
    reason: fallback?.reason ?? registryReason(entry),
  }
}

export function registryEntryToStrategy(entry: StrategyRegistryEntry): Strategy {
  const executable = EXECUTABLE_RADAR_STRATEGIES.find((strategy) => strategy.id === entry.strategyId)
  const admission = registryAdmission(entry)
  const backtestSource = normalizeBacktestSource(entry.metadata?.backtestSource) ?? "Qveris K线代理"
  return {
    id: entry.strategyId,
    name: entry.name,
    author: sourceAuthor(entry.source, entry.metadata?.sourceName),
    registrySource: entry.source,
    desc: executable?.description ?? registryDescription(entry),
    factors: executable?.factorWeights.map((factor) => factor.id) ?? entry.metadata?.factors ?? inferFactorsFromEntry(entry),
    freq: inferFrequency(entry.strategyId, executable?.holdingPeriod),
    annualReturn: entry.annualReturn ?? 0,
    maxDrawdown: entry.maxDrawdown ?? 0,
    sharpe: entry.sharpe ?? 0,
    winRate: entry.winRate ?? 0,
    backtestStatus: entry.lastBacktestedAt ? "真实回测" : "待真实回测",
    backtestSource,
    status: entry.source === "lab" ? "私有" : entry.source === "miner" ? "审核中" : "公开",
    subscribers: entry.source === "lab" ? 1 : 0,
    admission,
    rankScore: entry.score,
    lastBacktestedAt: entry.lastBacktestedAt,
  }
}

function normalizeAdmissionStatus(value?: string): StrategyAdmission["status"] {
  if (value === "radar-ready" || value === "watchlist" || value === "blocked") return value
  return "blocked"
}

function normalizeAdmissionGate(value: unknown, status: StrategyAdmission["status"]): StrategyAdmission["gate"] {
  if (value === "雷达候选" || value === "观察池" || value === "禁止入雷达") return value
  if (status === "radar-ready") return "雷达候选"
  if (status === "watchlist") return "观察池"
  return "禁止入雷达"
}

function registryReason(entry: StrategyRegistryEntry) {
  if (entry.status === "queued") {
    return "策略矿工已发现该候选并写入待回测队列；完成真实回测和准入诊断前不会进入雷达层。"
  }
  if (entry.status === "running") {
    return "该策略正在执行真实历史回测，等待完成后自动更新准入结果。"
  }
  if (entry.status === "failed") {
    return "最近一次真实回测失败，需修复数据或执行映射后重新排队。"
  }
  if (entry.status === "radar-ready") {
    return "注册表确认该策略已通过最近一次真实回测准入，可作为雷达候选。"
  }
  if (entry.status === "watchlist") {
    return "注册表确认该策略仍在观察池，需继续样本外验证或补齐数据后再上线雷达。"
  }
  return "注册表未放行该策略进入雷达层。"
}

function sourceAuthor(source: StrategyRegistryEntry["source"], sourceName?: string) {
  if (source === "miner") return sourceName ? `策略矿工 · ${sourceName}` : "策略矿工"
  if (source === "lab") return "策略实验室"
  return "内置策略"
}

function sourceTag(source: StrategyRegistryEntry["source"]) {
  if (source === "miner") return "矿工回测"
  if (source === "lab") return "实验室回测"
  return "目录回测"
}

function registryDescription(entry: StrategyRegistryEntry) {
  const source = sourceAuthor(entry.source, entry.metadata?.sourceName)
  const period = entry.metadata?.period
  const periodText = period?.start && period?.end ? `，回测区间 ${period.start} 至 ${period.end}` : ""
  if (entry.metadata?.hypothesis) {
    return `${source}挖掘：${entry.metadata.hypothesis}${periodText}。`
  }
  return `${source}生成并写入统一策略注册表${periodText}；目录按真实回测、准入分和风险指标统一排序。`
}

function inferFactorsFromEntry(entry: StrategyRegistryEntry) {
  const id = entry.strategyId.toLowerCase()
  if (id.includes("vcp")) return ["f-vcp-breakout", "f-atr-compression", "f-vol-spike"]
  if (id.includes("keltner") || id.includes("atr")) return ["f-keltner-breakout", "f-atr-compression", "f-absolute-momentum"]
  if (id.includes("breakout") || id.includes("突破")) return ["f-vol-spike", "f-tight-breakout", "f-absolute-momentum"]
  if (id.includes("pullback") || id.includes("rsi")) return ["f-pullback-uptrend", "f-rsi2-reversal", "f-absolute-momentum"]
  if (id.includes("news")) return ["f-news-sent", "f-vol-spike"]
  if (id.includes("trend") || id.includes("mom")) return ["f-mom-60d", "f-risk-adjusted-mom", "f-absolute-momentum"]
  return ["f-mom-60d"]
}

function inferFrequency(strategyId: string, holdingPeriod?: string): Strategy["freq"] {
  const id = strategyId.toLowerCase()
  if (id.includes("intra") || id.includes("vwap")) return "intraday"
  if (holdingPeriod && /20|30|60/.test(holdingPeriod)) return "position"
  return "swing"
}

function normalizeBacktestSource(value: unknown): Strategy["backtestSource"] | undefined {
  if (value === "Qveris" || value === "Qveris K线代理" || value === "示例指标") return value
  return undefined
}

export function registryStatusLabel(status: StrategyRegistryStatus) {
  if (status === "radar-ready") return "雷达候选"
  if (status === "watchlist") return "观察池"
  if (status === "blocked") return "拦截"
  if (status === "queued") return "排队中"
  if (status === "running") return "回测中"
  return "失败"
}
