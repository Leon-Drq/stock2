import type { Factor } from "@/lib/catalog"
import type { StrategyDraft, StrategyFactorMapping } from "@/lib/strategy-lab"

export const CUSTOM_FACTORS_STORAGE_KEY = "stock-radar.custom-factors.v1"

export type CustomFactor = Factor & {
  source: "user-generated"
  status: "draft" | "validated"
  sourceText: string
  strategyName: string
  implementation: string
  dataRequirements: string[]
  originalMappingStatus: StrategyFactorMapping["status"]
  createdAt: string
  updatedAt: string
}

export function loadCustomFactors(): CustomFactor[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(CUSTOM_FACTORS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isCustomFactor)
  } catch {
    return []
  }
}

export function saveCustomFactors(factors: CustomFactor[]) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(CUSTOM_FACTORS_STORAGE_KEY, JSON.stringify(dedupeFactors(factors)))
}

export function upsertCustomFactor(next: CustomFactor) {
  const current = loadCustomFactors()
  const index = current.findIndex((item) => item.id === next.id)
  const updated = { ...next, updatedAt: new Date().toISOString() }
  if (index >= 0) {
    current[index] = { ...current[index], ...updated, createdAt: current[index].createdAt }
  } else {
    current.unshift(updated)
  }
  saveCustomFactors(current)
  return updated
}

export function removeCustomFactor(id: string) {
  const next = loadCustomFactors().filter((item) => item.id !== id)
  saveCustomFactors(next)
  return next
}

export function mergeFactors(baseFactors: Factor[], customFactors: CustomFactor[]): Array<Factor | CustomFactor> {
  const seen = new Set(baseFactors.map((item) => item.id))
  return [
    ...customFactors.filter((item) => !seen.has(item.id)),
    ...baseFactors,
  ]
}

export function buildCustomFactorCandidates(draft: StrategyDraft): CustomFactor[] {
  const fromMappings = draft.factorMap
    .filter((mapping) => shouldCreateCustomFactor(mapping))
    .map((mapping, index) => buildCustomFactorFromMapping(mapping, draft, index))
  const fromRules = inferRuleFactorMappings(draft).map((mapping, index) =>
    buildCustomFactorFromMapping(mapping, draft, fromMappings.length + index),
  )
  return dedupeFactors([...fromMappings, ...fromRules])
}

export function buildCustomFactorFromMapping(
  mapping: StrategyFactorMapping,
  draft: Pick<StrategyDraft, "name" | "timeframe">,
  index: number,
): CustomFactor {
  const now = new Date().toISOString()
  const name = normalizeFactorName(mapping.factorName || mapping.sourceText || `自定义因子 ${index + 1}`)
  const sourceText = mapping.sourceText || name
  const category = inferCategory(`${name} ${sourceText} ${mapping.note}`)
  const formula = inferFormula(`${name} ${sourceText} ${mapping.note}`)

  return {
    id: `u-${slug(draft.name)}-${slug(name)}-${shortHash(`${draft.name}:${name}:${sourceText}`)}`,
    category,
    name,
    formula,
    ic: 0,
    ir: 0,
    q1q5: 0,
    win: 0,
    freq: draft.timeframe.includes("分钟") || draft.timeframe.includes("日内") ? "intraday" : "swing",
    source: "user-generated",
    status: "draft",
    sourceText,
    strategyName: draft.name,
    implementation: buildImplementation(formula),
    dataRequirements: inferDataRequirements(`${name} ${sourceText} ${formula}`),
    originalMappingStatus: mapping.status,
    createdAt: now,
    updatedAt: now,
  }
}

export function patchDraftWithCustomFactor(draft: StrategyDraft, factor: CustomFactor): StrategyDraft {
  let matched = false
  const nextMap = draft.factorMap.map((mapping) => {
    const sameName = normalizeFactorName(mapping.factorName) === normalizeFactorName(factor.name)
    const sameSource = mapping.sourceText === factor.sourceText
    if (!sameName && !sameSource) return mapping
    matched = true
    return {
      ...mapping,
      factorId: factor.id,
      factorName: factor.name,
      status: "mapped" as const,
      confidence: Math.max(mapping.confidence, 0.72),
      note: `已生成用户自定义因子：${factor.formula}`,
    }
  })
  if (!matched) {
    nextMap.push({
      sourceText: factor.sourceText,
      factorId: factor.id,
      factorName: factor.name,
      confidence: 0.72,
      status: "mapped",
      note: `已从策略规则生成用户自定义因子：${factor.formula}`,
    })
  }
  const ranking = new Set(draft.dsl.ranking)
  ranking.add(`${factor.id} desc`)
  const requiredData = new Set([...draft.backtestReadiness.requiredData, ...factor.dataRequirements])

  return {
    ...draft,
    factorMap: nextMap,
    dsl: {
      ...draft.dsl,
      ranking: Array.from(ranking),
    },
    backtestReadiness: {
      ...draft.backtestReadiness,
      requiredData: Array.from(requiredData),
      issues: draft.backtestReadiness.issues.map((issue) =>
        issue.includes("无法直接量化") ? "缺失规则已转成用户自定义因子草稿，真实回测前需确认公式参数。" : issue,
      ),
    },
  }
}

function shouldCreateCustomFactor(mapping: StrategyFactorMapping) {
  if (mapping.status === "missing") return true
  if (mapping.status === "proxy" && !mapping.factorId) return true
  return false
}

function inferRuleFactorMappings(draft: StrategyDraft): StrategyFactorMapping[] {
  const rules = [
    ...draft.entryRules,
    ...draft.exitRules,
    ...draft.riskRules,
    ...draft.positionRules,
    ...draft.dsl.entry,
    ...draft.dsl.exit,
    ...draft.dsl.risk,
  ]
  const specs = [
    { name: "大盘环境过滤", re: /大盘|市场弱势|指数|index/i, source: "避免大盘弱势时交易" },
    { name: "流动性过滤", re: /流动性|成交活跃|成交额|换手/i, source: "避免流动性不足时交易" },
    { name: "关键点突破", re: /关键点|pivot|平台上沿/i, source: "价格突破关键点" },
    { name: "回撤止损", re: /回撤|止损|跌破/i, source: "回撤或跌破关键点止损" },
    { name: "趋势确认", re: /趋势确认|趋势上行|强势/i, source: "趋势确认后买入" },
  ]
  const text = rules.join("\n")
  const existing = new Set(draft.factorMap.map((item) => normalizeFactorName(item.factorName)))
  return specs
    .filter((spec) => spec.re.test(text) && !existing.has(normalizeFactorName(spec.name)))
    .map((spec) => ({
      sourceText: spec.source,
      factorId: null,
      factorName: spec.name,
      confidence: 0.66,
      status: "missing" as const,
      note: "从策略规则自动生成，加入因子库后可进入真实回测。",
    }))
}

function isCustomFactor(value: unknown): value is CustomFactor {
  if (!value || typeof value !== "object") return false
  const obj = value as Partial<CustomFactor>
  return (
    typeof obj.id === "string" &&
    typeof obj.name === "string" &&
    typeof obj.formula === "string" &&
    obj.source === "user-generated"
  )
}

function dedupeFactors(factors: CustomFactor[]) {
  const map = new Map<string, CustomFactor>()
  for (const factor of factors) map.set(factor.id, factor)
  return Array.from(map.values())
}

function normalizeFactorName(value: string) {
  return value.trim().replace(/\s+/g, " ") || "用户自定义因子"
}

function inferCategory(text: string): Factor["category"] {
  if (/(资金|北向|主力|流入|流出|龙虎榜)/.test(text)) return "资金"
  if (/(新闻|情绪|研报|舆情)/.test(text)) return "情绪"
  if (/(估值|市盈率|财务|利润|\b(?:pe|roe)\b)/i.test(text)) return "基本面"
  if (/(AI|形态|识别|模式)/i.test(text)) return "AI"
  if (/(回撤|回调|超跌|反弹|止损)/.test(text)) return "反转"
  if (/(成交|量|突破|关键点|流动性|换手)/.test(text)) return "量价"
  return "动量"
}

function inferFormula(text: string) {
  if (/大盘|市场/.test(text)) return "index_close > MA(index_close, 60) AND index_ret(20d) > 0"
  if (/流动性|成交活跃/.test(text)) return "avg_amount(20d) >= threshold AND amount_rank(20d) >= 0.4"
  if (/关键点/.test(text)) return "close > pivot_high(60d) AND volume / MA(volume, 20) > 1.5"
  if (/止损|回撤/.test(text)) return "drawdown_from_entry <= 7% OR close < pivot_low(20d)"
  if (/趋势|强势/.test(text)) return "close > MA(close, 20) AND MA(close, 20) > MA(close, 60)"
  if (/突破|放量|成交量/.test(text)) return "close > MA(close, 60) AND volume / MA(volume, 20) > 1.5"
  return "rank(signal_score, 20d)"
}

function buildImplementation(formula: string) {
  return [
    "inputs: daily adjusted OHLCV + required auxiliary data",
    `formula: ${formula}`,
    "score: normalize to 0-1 cross-sectional percentile",
    "direction: higher score means stronger long signal",
  ].join("\n")
}

function inferDataRequirements(text: string) {
  const requirements = new Set<string>(["K 线行情"])
  if (/大盘|index/.test(text)) requirements.add("指数与板块")
  if (/资金|北向|主力/.test(text)) requirements.add("资金流")
  if (/情绪|新闻|研报/.test(text)) requirements.add("新闻与研报")
  if (/估值|财务|\b(?:pe|roe)\b/i.test(text)) requirements.add("财务报表")
  return Array.from(requirements)
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[\u4e00-\u9fa5]/g, (char) => char.charCodeAt(0).toString(36))
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "factor"
}

function shortHash(value: string) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36).slice(0, 6)
}
