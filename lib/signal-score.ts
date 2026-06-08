import { PAPER_CONFLUENCE_STRATEGY_ID } from "@/lib/paper-confluence-constants"
import type { StockSignal } from "@/lib/radar-data"

export type SignalConfluenceInput = {
  strategyCount: number
  filledStrategyCount?: number
  orderCount?: number
  status?: "filled" | "watch" | "blocked"
}

export type UnifiedSignalScore = {
  total: number
  grade: "S" | "A" | "B" | "C"
  confidence: number
  riskReward: number
  confluence: number
  timing: number
  dataQuality: number
  labels: string[]
  summary: string
}

export const SIGNAL_SCORE_WEIGHTS = {
  confidence: 34,
  riskReward: 20,
  confluence: 26,
  timing: 15,
  dataQuality: 5,
} as const

export function computeUnifiedSignalScore(
  signal: StockSignal,
  options: { confluence?: SignalConfluenceInput; now?: number } = {},
): UnifiedSignalScore {
  const confluence = options.confluence
  const signalReturn = signal.returnSinceSignalPct ?? (signal.triggerPrice && signal.triggerPrice > 0 ? (signal.price / signal.triggerPrice - 1) * 100 : 0)
  const rawRiskPct = positiveNumber(signal.stopLoss.riskPct) ?? 6
  const effectiveRiskPct = Math.max(rawRiskPct, 2)
  const rawOdds = Number.isFinite(signal.oddsRatio) ? signal.oddsRatio : signal.upsidePct / effectiveRiskPct
  const scoreOdds = clamp(rawOdds, 1, 6)
  const labels: string[] = []
  const winRate = calibratedWinRate(signal, confluence)
  const hasMeasuredBacktest = Boolean(signal.strategyBacktest && signal.strategyBacktest.winRate > 0)
  const hasConfluence = confluenceScoreEligible(confluence)

  const confidence = clampScore(
    signalLevelScore(signal.signalLevel) +
    signalKindScore(signal.signalKind) +
    clamp((winRate - 50) * 0.35, 0, 6) +
    (signal.strategyBacktest ? clamp(signal.strategyBacktest.sharpe * 1.8, 0, 4) : 0) -
    (!hasMeasuredBacktest && !hasConfluence ? 3 : 0),
    0,
    SIGNAL_SCORE_WEIGHTS.confidence,
  )

  const riskReward = clampScore(
    4 +
    scoreOdds * 2.15 +
    clamp((signal.upsidePct - effectiveRiskPct) * 0.45, 0, 5) -
    (rawRiskPct > 7.5 ? 3 : 0) -
    (rawRiskPct < 1.5 ? 3 : 0),
    0,
    SIGNAL_SCORE_WEIGHTS.riskReward,
  )

  const confluenceScore = clampScore(
    confluenceScoreEligible(confluence)
      ? 8 +
        Math.min(confluence.strategyCount, 5) * 4 +
        Math.min(confluence.filledStrategyCount ?? 0, 4) * 3 +
        (confluence.status === "filled" ? 3 : 0)
      : signal.strategyId === PAPER_CONFLUENCE_STRATEGY_ID
        ? 18
        : 0,
    0,
    SIGNAL_SCORE_WEIGHTS.confluence,
  )

  const timing = clampScore(
    9 +
    (signalReturn >= -0.8 && signalReturn <= 2.8 ? 5 : 0) -
    (signalReturn > 5 ? 6 : 0) -
    (signalReturn < -3 ? 5 : 0) +
    (isFreshSignal(signal.recommendedAt, options.now) ? 1 : 0),
    0,
    SIGNAL_SCORE_WEIGHTS.timing,
  )

  const dataQuality = clampScore(
    dataQualityScore(signal) - (signal.priceStatus === "pending-follow-up" ? 2 : 0),
    0,
    SIGNAL_SCORE_WEIGHTS.dataQuality,
  )

  if (confluenceScoreEligible(confluence)) {
    labels.push(confluenceLabel(confluence))
  } else if (signal.strategyId === PAPER_CONFLUENCE_STRATEGY_ID) {
    labels.push("多策略共振")
  }
  labels.push(`${hasMeasuredBacktest ? "实测" : "估算"}胜率 ${Math.round(winRate)}%`)
  labels.push(`赔率 ${rawOdds.toFixed(1)}:1`)
  if (rawRiskPct < 1.5) labels.push("止损过窄，按风险下限折算")
  else if (rawRiskPct > 7.5) labels.push("止损距离偏宽")
  else labels.push(`止损 ${rawRiskPct.toFixed(1)}%`)
  if (signalReturn > 5) labels.push("已涨较多，防追高")
  else if (signalReturn < -3) labels.push("触发后转弱")
  else labels.push("触发后仍可跟踪")
  if (dataQuality <= 1) labels.push("行情质量偏低")

  const total = Math.round(clamp(confidence + riskReward + confluenceScore + timing + dataQuality, 0, 100))
  return {
    total,
    grade: scoreGrade(total),
    confidence,
    riskReward,
    confluence: confluenceScore,
    timing,
    dataQuality,
    labels,
    summary: scoreSummary(total),
  }
}

export function signalRankingScore(signal: StockSignal, confluence?: SignalConfluenceInput) {
  const score = computeUnifiedSignalScore(signal, { confluence })
  return score.total * 100 + signalLevelPriority(signal.signalLevel) * 4 + signalKindPriority(signal.signalKind)
}

function calibratedWinRate(signal: StockSignal, confluence?: SignalConfluenceInput) {
  if (signal.strategyBacktest && signal.strategyBacktest.winRate > 0) {
    return clamp(signal.strategyBacktest.winRate, 35, 78)
  }
  if (confluenceScoreEligible(confluence)) {
    return clamp(Math.max(signal.winRatePct || 50, 54 + confluence.strategyCount * 2 + (confluence.filledStrategyCount ?? 0)), 50, 68)
  }
  if (signal.strategyId === PAPER_CONFLUENCE_STRATEGY_ID) return clamp(Math.max(signal.winRatePct || 50, 60), 55, 68)
  return clamp(Math.min(signal.winRatePct || 50, 54), 45, 58)
}

function confluenceScoreEligible(confluence?: SignalConfluenceInput): confluence is SignalConfluenceInput {
  if (!confluence || confluence.strategyCount < 2) return false
  if (confluence.status === "blocked") return false
  if (confluence.status === "watch" && typeof confluence.filledStrategyCount === "number") {
    return confluence.filledStrategyCount >= 2
  }
  return true
}

function confluenceLabel(confluence: SignalConfluenceInput) {
  const filled = confluence.filledStrategyCount ?? 0
  if (confluence.strategyCount >= 3 || filled >= 2) return `${confluence.strategyCount} 策略强共振`
  return `${confluence.strategyCount} 策略共振`
}

function dataQualityScore(signal: StockSignal) {
  if (signal.priceSource === "qveris-realtime") return 5
  if (signal.priceSource === "qveris-daily") return 3
  if (signal.priceSource === "mock") return 0
  return 3
}

function signalLevelScore(level: StockSignal["signalLevel"]) {
  const scores: Record<StockSignal["signalLevel"], number> = {
    green: 13,
    blue: 11,
    yellow: 8,
    compass: 5,
    purple: 4,
    orange: 2,
    red: 0,
  }
  return scores[level]
}

function signalKindScore(kind: StockSignal["signalKind"]) {
  const scores: Record<StockSignal["signalKind"], number> = {
    "high-confidence-buy": 9,
    "add-confirm": 7,
    "left-side-trial": 5,
    "hold-no-add": 2,
    watch: 1,
    exit: 0,
  }
  return scores[kind]
}

function signalLevelPriority(level: StockSignal["signalLevel"]) {
  const scores: Record<StockSignal["signalLevel"], number> = {
    green: 7,
    blue: 6,
    yellow: 5,
    compass: 3,
    purple: 2,
    orange: 1,
    red: 0,
  }
  return scores[level]
}

function signalKindPriority(kind: StockSignal["signalKind"]) {
  const scores: Record<StockSignal["signalKind"], number> = {
    "high-confidence-buy": 20,
    "add-confirm": 16,
    "left-side-trial": 10,
    "hold-no-add": 4,
    watch: 2,
    exit: 0,
  }
  return scores[kind]
}

function scoreGrade(score: number): UnifiedSignalScore["grade"] {
  if (score >= 86) return "S"
  if (score >= 74) return "A"
  if (score >= 62) return "B"
  return "C"
}

function scoreSummary(score: number) {
  if (score >= 86) return "优先执行"
  if (score >= 74) return "重点关注"
  if (score >= 62) return "小仓验证"
  return "仅观察"
}

function isFreshSignal(value?: string, now = Date.now()) {
  if (!value) return false
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return false
  return now - time <= 2 * 60 * 60 * 1000
}

function positiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

function clampScore(value: number, min: number, max: number) {
  return Math.round(clamp(value, min, max))
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}
