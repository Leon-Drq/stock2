import type { Factor } from "@/lib/catalog"
import type { CustomFactor } from "@/lib/custom-factors"

export type FactorAssetStatus = "validated" | "watchlist" | "data-gap" | "duplicate" | "deprecated"

export type FactorAsset = {
  factor: Factor | CustomFactor
  score: number
  status: FactorAssetStatus
  statusLabel: string
  usageLabel: string
  live: boolean
  isCustom: boolean
  dataRequirements: string[]
  notes: string[]
}

export const LIVE_FACTOR_IDS = new Set([
  "f-mom-60d",
  "f-rev-5d",
  "f-vol-spike",
  "f-tight-breakout",
  "f-atr-compression",
  "f-absolute-momentum",
])

const DUPLICATE_FACTOR_IDS = new Set([
  "f-risk-adjusted-mom",
  "f-sma200-momentum",
  "f-pullback-uptrend",
])

const NON_PRICE_REQUIREMENTS: Record<Factor["category"], string[]> = {
  动量: ["K 线行情"],
  反转: ["K 线行情"],
  量价: ["K 线行情"],
  资金: ["资金流"],
  情绪: ["新闻与研报"],
  基本面: ["财务报表"],
  AI: ["K 线行情", "模型推理"],
}

export function buildFactorAssets(factors: Array<Factor | CustomFactor>): FactorAsset[] {
  return factors.map((factor) => {
    const isCustom = isCustomFactor(factor)
    const live = LIVE_FACTOR_IDS.has(factor.id)
    const score = factorQualityScore(factor, live)
    const status = factorStatus(factor, score, live)
    return {
      factor,
      score,
      status,
      statusLabel: statusLabel(status),
      usageLabel: usageLabel(status, factor.freq),
      live,
      isCustom,
      dataRequirements: isCustom ? factor.dataRequirements : NON_PRICE_REQUIREMENTS[factor.category],
      notes: factorNotes(factor, status, live, isCustom),
    }
  })
}

export function factorAssetSummary(assets: FactorAsset[]) {
  return {
    total: assets.length,
    validated: assets.filter((asset) => asset.status === "validated").length,
    watchlist: assets.filter((asset) => asset.status === "watchlist").length,
    dataGap: assets.filter((asset) => asset.status === "data-gap").length,
    live: assets.filter((asset) => asset.live).length,
    custom: assets.filter((asset) => asset.isCustom).length,
  }
}

export function factorStatusClass(status: FactorAssetStatus) {
  if (status === "validated") return "border-health-ok/30 bg-health-ok/5 text-health-ok"
  if (status === "watchlist") return "border-[#b9d7ff] bg-[#eef6ff] text-[#1e5a91]"
  if (status === "data-gap") return "border-warning/30 bg-warning/5 text-warning"
  if (status === "duplicate") return "border-[#d8d8d8] bg-white text-ink-muted"
  return "border-bear/30 bg-bear/5 text-bear"
}

export function factorQualityScore(factor: Factor | CustomFactor, live = LIVE_FACTOR_IDS.has(factor.id)) {
  if (isCustomFactor(factor) && factor.status === "draft") {
    return factor.originalMappingStatus === "missing" ? 30 : 42
  }
  const icScore = clamp((factor.ic / 0.08) * 32, 0, 32)
  const irScore = clamp((factor.ir / 1.0) * 28, 0, 28)
  const spreadScore = clamp((factor.q1q5 / 12) * 18, 0, 18)
  const winScore = clamp(((factor.win - 50) / 14) * 14, 0, 14)
  const liveScore = live ? 8 : 0
  return Math.round(icScore + irScore + spreadScore + winScore + liveScore)
}

function factorStatus(factor: Factor | CustomFactor, score: number, live: boolean): FactorAssetStatus {
  if (isCustomFactor(factor) && factor.status === "draft") return "data-gap"
  if (DUPLICATE_FACTOR_IDS.has(factor.id)) return "duplicate"
  if (!live && requiresNonPriceData(factor)) return "data-gap"
  if (score >= 72 && live) return "validated"
  if (score >= 56) return "watchlist"
  return "deprecated"
}

function statusLabel(status: FactorAssetStatus) {
  if (status === "validated") return "已验证"
  if (status === "watchlist") return "观察中"
  if (status === "data-gap") return "数据待补"
  if (status === "duplicate") return "高相关重复"
  return "暂不使用"
}

function usageLabel(status: FactorAssetStatus, freq: Factor["freq"]) {
  if (status === "validated") return freq === "intraday" ? "日内扫描" : "可入策略"
  if (status === "watchlist") return "研究观察"
  if (status === "data-gap") return "先补字段"
  if (status === "duplicate") return "降权合并"
  return "暂停调用"
}

function factorNotes(factor: Factor | CustomFactor, status: FactorAssetStatus, live: boolean, isCustom: boolean) {
  if (isCustom && isCustomFactor(factor)) {
    return [
      "用户生成因子，先做单因子 IC / 分组收益验证。",
      factor.originalMappingStatus === "missing" ? "缺少直接映射字段，不能直接上线策略。" : "可先用代理字段试跑。",
    ]
  }
  if (status === "validated") return ["已接入真实计算白名单，可被策略实验与雷达候选调用。"]
  if (status === "data-gap") return [`需要补齐 ${NON_PRICE_REQUIREMENTS[factor.category].join(" / ")} 后再做完整验证。`]
  if (status === "duplicate") return ["与现有趋势/动量类因子相关性可能偏高，组合时需要降权或去重。"]
  if (!live) return ["静态指标已登记，等待接入因子引擎实时计算。"]
  return ["历史统计较弱，暂不建议进入策略目录。"]
}

function requiresNonPriceData(factor: Factor | CustomFactor) {
  return factor.category === "资金" || factor.category === "情绪" || factor.category === "基本面"
}

function isCustomFactor(factor: Factor | CustomFactor): factor is CustomFactor {
  return "source" in factor && factor.source === "user-generated"
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}
