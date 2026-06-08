export type StrategyCandidatePriority = "P1" | "P2" | "P3"
export type StrategyCandidateFamily = "突破" | "趋势" | "反转" | "轮动" | "资金" | "事件" | "防守" | "AI"
export type StrategyCandidateStage = "可代理回测" | "需补数据" | "研究观察"
export type StrategyCandidateReadiness = "ready" | "proxy" | "missing"

export type StrategyCandidateDataNeed = {
  name: string
  status: StrategyCandidateReadiness
  note: string
}

export type StrategyCandidate = {
  id: string
  name: string
  priority: StrategyCandidatePriority
  family: StrategyCandidateFamily
  stage: StrategyCandidateStage
  score: number
  sourceName: string
  sourceUrl: string
  thesis: string
  rules: string[]
  exitRules: string[]
  dataNeeds: StrategyCandidateDataNeed[]
  factors: string[]
  targetUse: Array<"真实回测" | "策略雷达" | "实盘模拟" | "因子补齐">
  holdingPeriod: string
  antiOverfitChecks: string[]
  nextAction: string
  cautions: string[]
}

export const STRATEGY_CANDIDATES: StrategyCandidate[] = []

export function strategyCandidateSummary(candidates = STRATEGY_CANDIDATES) {
  return {
    total: candidates.length,
    p1: candidates.filter((item) => item.priority === "P1").length,
    proxyBacktest: candidates.filter((item) => item.stage === "可代理回测").length,
    dataGap: candidates.filter((item) => item.stage === "需补数据").length,
    radarTargets: candidates.filter((item) => item.targetUse.includes("策略雷达")).length,
  }
}

export function readinessLabel(status: StrategyCandidateReadiness) {
  if (status === "ready") return "可用"
  if (status === "proxy") return "代理"
  return "缺失"
}

export function stageTone(stage: StrategyCandidateStage): "good" | "warning" | "bad" {
  if (stage === "可代理回测") return "good"
  if (stage === "需补数据") return "warning"
  return "bad"
}
