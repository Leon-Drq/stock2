import { STRATEGY_CATALOG_MIN_ANNUAL_RETURN } from "@/lib/catalog"
import { EXECUTABLE_RADAR_STRATEGY_BY_ID } from "@/lib/strategy-registry"
import type { StrategyRegistryEntry, StrategyRegistrySnapshot } from "@/lib/strategy-registry-store"

export type StrategyDeploymentLane = "radar-online" | "paper-watch" | "mapping-missing" | "blocked" | "pending"
export type StrategyDeploymentGateStatus = "pass" | "warn" | "fail"

export type StrategyDeploymentGate = {
  key: "backtest" | "data" | "return" | "risk" | "stability" | "execution"
  label: string
  status: StrategyDeploymentGateStatus
  value: string
  note: string
}

export type StrategyDeploymentDecision = {
  strategyId: string
  name: string
  source: StrategyRegistryEntry["source"]
  lane: StrategyDeploymentLane
  score: number
  annualReturn: number
  maxDrawdown: number
  hasExecutableMapping: boolean
  gates: StrategyDeploymentGate[]
  radar: {
    status: "online" | "mapping-missing" | "watch" | "blocked" | "pending"
    label: string
    reason: string
  }
  paper: {
    status: "online" | "watch" | "blocked" | "pending"
    label: string
    reason: string
  }
  primaryAction: string
  reason: string
}

export type StrategyDeploymentSnapshot = {
  decisions: StrategyDeploymentDecision[]
  summary: {
    total: number
    radarOnline: number
    paperWatch: number
    mappingMissing: number
    blocked: number
    pending: number
  }
}

export function buildStrategyDeploymentSnapshot(snapshot: StrategyRegistrySnapshot): StrategyDeploymentSnapshot {
  const decisions = snapshot.entries
    .map(strategyDeploymentDecision)
    .sort((a, b) => laneRank(b.lane) - laneRank(a.lane) || b.score - a.score)

  return {
    decisions,
    summary: {
      total: decisions.length,
      radarOnline: decisions.filter((decision) => decision.lane === "radar-online").length,
      paperWatch: decisions.filter((decision) => decision.lane === "paper-watch").length,
      mappingMissing: decisions.filter((decision) => decision.lane === "mapping-missing").length,
      blocked: decisions.filter((decision) => decision.lane === "blocked").length,
      pending: decisions.filter((decision) => decision.lane === "pending").length,
    },
  }
}

export function strategyDeploymentDecision(entry: StrategyRegistryEntry): StrategyDeploymentDecision {
  const annualReturn = entry.annualReturn ?? 0
  const maxDrawdown = entry.maxDrawdown ?? 0
  const hasBacktest = Boolean(entry.lastBacktestedAt)
  const hasExecutableMapping = EXECUTABLE_RADAR_STRATEGY_BY_ID.has(entry.strategyId)
  const gates = buildDeploymentGates({ entry, annualReturn, maxDrawdown, hasBacktest, hasExecutableMapping })
  const qualityPass =
    hasBacktest &&
    annualReturn >= STRATEGY_CATALOG_MIN_ANNUAL_RETURN &&
    entry.score >= 50 &&
    (maxDrawdown === 0 || maxDrawdown <= 35)
  const isPending = entry.status === "queued" || entry.status === "running"

  if (isPending) {
    return buildDecision(entry, {
      lane: "pending",
      annualReturn,
      maxDrawdown,
      hasExecutableMapping,
      gates,
      radar: {
        status: "pending",
        label: "等待回测",
        reason: "策略还在排队或运行，等真实回测写回注册表后再决定是否上线。",
      },
      paper: {
        status: "pending",
        label: "等待回测",
        reason: "模拟盘不会接入未完成真实回测的策略。",
      },
      primaryAction: "等待任务完成",
      reason: "真实回测任务尚未结束。",
    })
  }

  if (entry.status === "radar-ready" && qualityPass && hasExecutableMapping) {
    return buildDecision(entry, {
      lane: "radar-online",
      annualReturn,
      maxDrawdown,
      hasExecutableMapping,
      gates,
      radar: {
        status: "online",
        label: "雷达上线",
        reason: "真实回测通过，且执行层已有因子映射，可直接参与策略雷达选股。",
      },
      paper: {
        status: "online",
        label: "模拟上线",
        reason: "从接入时点开始进入实盘模拟，收益只从上线后计算。",
      },
      primaryAction: "上线雷达 + 模拟盘",
      reason: "回测质量和执行映射都已满足上线条件。",
    })
  }

  if (entry.status === "radar-ready" && qualityPass && !hasExecutableMapping) {
    return buildDecision(entry, {
      lane: "mapping-missing",
      annualReturn,
      maxDrawdown,
      hasExecutableMapping,
      gates,
      radar: {
        status: "mapping-missing",
        label: "缺执行映射",
        reason: "真实回测已放行，但雷达执行层还没有对应因子映射，不能直接发正式信号。",
      },
      paper: {
        status: "watch",
        label: "模拟观察",
        reason: "先进入模拟盘观察池，补齐执行适配器后再进入雷达。",
      },
      primaryAction: "补执行映射",
      reason: "策略通过了真实回测，但还缺把 DSL/因子转成雷达扫描规则的适配器。",
    })
  }

  if (entry.status === "watchlist" && qualityPass) {
    return buildDecision(entry, {
      lane: "paper-watch",
      annualReturn,
      maxDrawdown,
      hasExecutableMapping,
      gates,
      radar: {
        status: "watch",
        label: "观察池",
        reason: "策略质量未到正式雷达门槛，先不推送交易机会。",
      },
      paper: {
        status: "watch",
        label: "模拟观察",
        reason: "可以从当前时点开始观察模拟盘表现，积累样本后再复评。",
      },
      primaryAction: "接入模拟观察",
      reason: "收益门槛达标，但准入评分或稳健性还需要继续观察。",
    })
  }

  const missingBacktest = !hasBacktest ? "缺少真实回测记录" : ""
  const lowAnnual = annualReturn < STRATEGY_CATALOG_MIN_ANNUAL_RETURN ? `年化 ${annualReturn.toFixed(1)}% 低于 ${STRATEGY_CATALOG_MIN_ANNUAL_RETURN}%` : ""
  const highDrawdown = maxDrawdown > 35 ? `回撤 ${maxDrawdown.toFixed(1)}% 过高` : ""
  const lowScore = entry.score < 50 ? `评分 ${entry.score.toFixed(1)} 偏低` : ""
  const statusBlocked = entry.status === "blocked" || entry.status === "failed" ? "注册表未放行" : ""
  const blockers = [missingBacktest, statusBlocked, lowAnnual, highDrawdown, lowScore].filter(Boolean)
  const reason = blockers.join(" / ") || "策略暂未满足雷达或模拟盘准入。"

  return buildDecision(entry, {
    lane: "blocked",
    annualReturn,
    maxDrawdown,
    hasExecutableMapping,
    gates,
    radar: {
      status: "blocked",
      label: "不上线",
      reason,
    },
    paper: {
      status: "blocked",
      label: "不接入",
      reason: "未通过基础质量门槛，模拟盘也不应产生误导性流水。",
    },
    primaryAction: "继续修正",
    reason,
  })
}

function buildDecision(
  entry: StrategyRegistryEntry,
  input: Omit<StrategyDeploymentDecision, "strategyId" | "name" | "source" | "score">,
): StrategyDeploymentDecision {
  return {
    strategyId: entry.strategyId,
    name: entry.name,
    source: entry.source,
    score: entry.score,
    ...input,
  }
}

function buildDeploymentGates({
  entry,
  annualReturn,
  maxDrawdown,
  hasBacktest,
  hasExecutableMapping,
}: {
  entry: StrategyRegistryEntry
  annualReturn: number
  maxDrawdown: number
  hasBacktest: boolean
  hasExecutableMapping: boolean
}): StrategyDeploymentGate[] {
  const backtestSource = entry.metadata?.backtestSource
  const periodDays = entry.metadata?.period?.days ?? 0
  const score = entry.score ?? 0

  return [
    {
      key: "backtest",
      label: "真实回测",
      status: hasBacktest ? "pass" : entry.status === "queued" || entry.status === "running" ? "warn" : "fail",
      value: hasBacktest ? formatDate(entry.lastBacktestedAt) : entry.status === "running" ? "running" : "missing",
      note: hasBacktest ? `覆盖 ${periodDays || "N/A"} 个交易日。` : "没有完成回测前不能上线。",
    },
    {
      key: "data",
      label: "数据血缘",
      status: backtestSource === "Qveris" ? "pass" : backtestSource ? "warn" : "fail",
      value: backtestSource ?? "unknown",
      note: backtestSource === "Qveris"
        ? "使用 Qveris 真实历史数据。"
        : backtestSource
          ? "含 K 线代理或混合字段，正式雷达前要继续补原始字段。"
          : "缺少数据来源标记。",
    },
    {
      key: "return",
      label: "收益门槛",
      status: annualReturn >= STRATEGY_CATALOG_MIN_ANNUAL_RETURN ? "pass" : annualReturn > 0 ? "warn" : "fail",
      value: `${annualReturn.toFixed(1)}%`,
      note: `最低上线门槛 ${STRATEGY_CATALOG_MIN_ANNUAL_RETURN}% 年化。`,
    },
    {
      key: "risk",
      label: "回撤控制",
      status: maxDrawdown > 0 && maxDrawdown <= 25 ? "pass" : maxDrawdown <= 35 ? "warn" : "fail",
      value: maxDrawdown ? `${maxDrawdown.toFixed(1)}%` : "N/A",
      note: "超过 35% 回撤不允许进雷达，25%-35% 只能观察。",
    },
    {
      key: "stability",
      label: "稳定评分",
      status: score >= 72 ? "pass" : score >= 50 ? "warn" : "fail",
      value: score.toFixed(1),
      note: "综合收益、超额、夏普、胜率和准入分。",
    },
    {
      key: "execution",
      label: "执行映射",
      status: hasExecutableMapping ? "pass" : entry.status === "radar-ready" ? "warn" : "fail",
      value: hasExecutableMapping ? "ready" : "missing",
      note: hasExecutableMapping ? "已有雷达扫描适配器。" : "缺少执行适配器时不能发正式雷达信号。",
    },
  ]
}

function laneRank(lane: StrategyDeploymentLane) {
  if (lane === "radar-online") return 5
  if (lane === "paper-watch") return 4
  if (lane === "mapping-missing") return 3
  if (lane === "pending") return 2
  return 1
}

function formatDate(value?: string) {
  if (!value) return "N/A"
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value.slice(0, 10)
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" })
}
