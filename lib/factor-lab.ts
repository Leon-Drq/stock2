import { DATA_SOURCES, FACTORS, type Factor } from "@/lib/catalog"
import type { CustomFactor } from "@/lib/custom-factors"

export type FactorDiscoverySource = "ai" | "heuristic"

export type FactorDiscoveryCandidate = {
  name: string
  category: Factor["category"]
  frequency: Factor["freq"]
  thesis: string
  formula: string
  implementation: string
  direction: "higher_is_better" | "lower_is_better"
  requiredData: string[]
  requiredFields: string[]
  qverisQueries: string[]
  similarFactors: string[]
  validation: {
    score: number
    ready: boolean
    issues: string[]
    tests: string[]
    passCriteria: string[]
  }
  dsl: {
    universe: string
    expression: string
    ranking: string
    forwardDays: number
    rebalance: string
  }
}

export function buildFactorDiscoverySystemPrompt() {
  const factors = FACTORS.map((factor) =>
    `${factor.id}: ${factor.name} / ${factor.category} / ${factor.freq} / formula=${factor.formula} / IC=${factor.ic} / IR=${factor.ir}`,
  ).join("\n")
  const sources = DATA_SOURCES.map((source) =>
    `${source.name}: fields=${source.fields.join(",")} / freq=${source.freq} / query=${source.discoverQuery}`,
  ).join("\n")

  return [
    "你是 Stock Radar 的因子研究编译器，负责把自然语言投资想法转成候选量化因子。",
    "输出必须是严格 JSON，不要输出 Markdown、解释文字或代码围栏。",
    "不要声称已经真实回测通过。只能给出候选因子、数据需求、验证计划和加入因子库前的风险。",
    "优先生成能在 A 股日线 OHLCV 上计算的因子；如果想法依赖资金、新闻、财务等非价格数据，要明确 requiredData 和 qverisQueries。",
    "JSON schema:",
    JSON.stringify(
      {
        name: "因子名称",
        category: "动量 | 反转 | 量价 | 资金 | 情绪 | 基本面 | AI",
        frequency: "intraday | swing | position",
        thesis: "因子假设，100 字以内",
        formula: "机器可读公式",
        implementation: "计算步骤，说明标准化、分位、方向",
        direction: "higher_is_better | lower_is_better",
        requiredData: ["K 线行情"],
        requiredFields: ["close", "volume"],
        qverisQueries: ["China A-share adjusted daily kline close volume history"],
        similarFactors: ["f-mom-60d"],
        validation: {
          score: 70,
          ready: true,
          issues: ["仍需真实 IC 回测"],
          tests: ["IC 时序", "Q1-Q5 分组收益", "样本外 walk-forward"],
          passCriteria: ["IC 均值 > 0.02", "IR > 0.3", "分组收益单调"],
        },
        dsl: {
          universe: "当前 130 只统一股票池",
          expression: "factor expression",
          ranking: "score desc",
          forwardDays: 5,
          rebalance: "每日收盘后",
        },
      },
      null,
      2,
    ),
    "已有因子：",
    factors,
    "可用数据源：",
    sources,
  ].join("\n")
}

export function heuristicFactorCandidate(idea: string): FactorDiscoveryCandidate {
  const text = idea.trim()
  const normalized = text.toLowerCase()
  const category = inferCategory(text)
  const frequency = /日内|分钟|盘口|tick/i.test(text) ? "intraday" : /中长期|基本面|估值|财务/.test(text) ? "position" : "swing"
  const name = inferName(text)
  const formula = inferFormula(text)
  const requiredData = inferRequiredData(text)
  const requiredFields = inferRequiredFields(text)
  const qverisQueries = inferQverisQueries(requiredData, text)
  const directPrice = requiredData.length === 1 && requiredData[0] === "K 线行情"
  const similarFactors = inferSimilarFactors(normalized)

  return {
    name,
    category,
    frequency,
    thesis: buildThesis(text),
    formula,
    implementation: [
      `计算：${formula}`,
      "标准化：按交易日做横截面 percentile/rank，剔除停牌和缺失值。",
      "方向：数值越高代表候选股票越强，先进入候选因子库，真实 IC 通过后再用于策略和雷达。",
    ].join("\n"),
    direction: "higher_is_better",
    requiredData,
    requiredFields,
    qverisQueries,
    similarFactors,
    validation: {
      score: directPrice ? 72 : 58,
      ready: directPrice,
      issues: directPrice
        ? ["需要用 130 只股票池做 IC、分组收益和样本外验证。"]
        : ["包含非价格类字段，需先绑定 Qveris 原始数据再做完整验证。"],
      tests: ["IC 时序", "Q1-Q5 多空分位收益", "TopN 换手和交易成本", "样本外 walk-forward"],
      passCriteria: ["IC 均值 > 0.02", "IR > 0.3", "Q1-Q5 为正且分组尽量单调", "加入成本后仍跑赢基准"],
    },
    dsl: {
      universe: "当前 130 只统一股票池",
      expression: formula,
      ranking: "factor_score desc",
      forwardDays: frequency === "position" ? 20 : 5,
      rebalance: frequency === "intraday" ? "交易时段定时扫描" : "每日收盘后",
    },
  }
}

export function normalizeFactorCandidate(value: unknown, fallback: FactorDiscoveryCandidate): FactorDiscoveryCandidate {
  if (!value || typeof value !== "object") return fallback
  const obj = value as Record<string, unknown>
  const validation = asRecord(obj.validation)
  const dsl = asRecord(obj.dsl)
  return {
    name: normalizeCandidateName(asText(obj.name, fallback.name), fallback.name),
    category: normalizeCategory(obj.category, fallback.category),
    frequency: normalizeFrequency(obj.frequency, fallback.frequency),
    thesis: asText(obj.thesis, fallback.thesis),
    formula: asText(obj.formula, fallback.formula),
    implementation: asText(obj.implementation, fallback.implementation),
    direction: obj.direction === "lower_is_better" ? "lower_is_better" : "higher_is_better",
    requiredData: asTextArray(obj.requiredData, fallback.requiredData),
    requiredFields: asTextArray(obj.requiredFields, fallback.requiredFields),
    qverisQueries: asTextArray(obj.qverisQueries, fallback.qverisQueries),
    similarFactors: asTextArray(obj.similarFactors, fallback.similarFactors),
    validation: {
      score: asNumber(validation.score, fallback.validation.score, 0, 100),
      ready: typeof validation.ready === "boolean" ? validation.ready : fallback.validation.ready,
      issues: asTextArray(validation.issues, fallback.validation.issues),
      tests: asTextArray(validation.tests, fallback.validation.tests),
      passCriteria: asTextArray(validation.passCriteria, fallback.validation.passCriteria),
    },
    dsl: {
      universe: asText(dsl.universe, fallback.dsl.universe),
      expression: asText(dsl.expression, fallback.dsl.expression),
      ranking: asText(dsl.ranking, fallback.dsl.ranking),
      forwardDays: Math.round(asNumber(dsl.forwardDays, fallback.dsl.forwardDays, 1, 60)),
      rebalance: asText(dsl.rebalance, fallback.dsl.rebalance),
    },
  }
}

export function candidateToCustomFactor(candidate: FactorDiscoveryCandidate, idea: string): CustomFactor {
  const now = new Date().toISOString()
  return {
    id: `u-ai-${slug(candidate.name)}-${shortHash(`${candidate.name}:${candidate.formula}:${idea}`)}`,
    category: candidate.category,
    name: candidate.name,
    formula: candidate.formula,
    ic: 0,
    ir: 0,
    q1q5: 0,
    win: 0,
    freq: candidate.frequency,
    source: "user-generated",
    status: "draft",
    sourceText: idea.trim(),
    strategyName: "AI 因子实验台",
    implementation: candidate.implementation,
    dataRequirements: candidate.requiredData,
    originalMappingStatus: candidate.validation.ready ? "proxy" : "missing",
    createdAt: now,
    updatedAt: now,
  }
}

function inferName(text: string) {
  if (/缩量|量缩/.test(text) && /回调|调整/.test(text)) return "缩量回调趋势保持"
  if (/放量|成交量/.test(text) && /突破|新高/.test(text)) return "放量突破延续"
  if (/大盘|指数/.test(text)) return "大盘环境过滤"
  if (/资金|北向|主力/.test(text)) return "资金流确认"
  if (/新闻|情绪|研报/.test(text)) return "情绪动量"
  if (/估值|pe|市盈率|便宜/i.test(text)) return "估值安全边际"
  if (/反弹|超跌|低吸/.test(text)) return "超跌修复"
  return `${text.replace(/[，。,.！!？?\s]+/g, "").slice(0, 10) || "AI"}因子`
}

function inferCategory(text: string): Factor["category"] {
  if (/资金|北向|主力|龙虎榜|融资/.test(text)) return "资金"
  if (/新闻|情绪|研报|舆情/.test(text)) return "情绪"
  if (/估值|pe|市盈率|财务|roe|利润/i.test(text)) return "基本面"
  if (/AI|形态|图形|识别|模型/i.test(text)) return "AI"
  if (/回调|反弹|超跌|低吸|回撤|rsi|connors|康纳斯|布林|下轨|均值回归/i.test(text)) return "反转"
  if (/量|突破|换手|成交|vwap/i.test(text)) return "量价"
  return "动量"
}

function inferFormula(text: string) {
  if (/donchian|海龟|通道突破|55日|55 日/i.test(text)) return "close / HHV(high,55,prior) - 1"
  if (/minervini|趋势模板|均线多头|52周/i.test(text)) return "close > MA(close,50) > MA(close,150) > MA(close,200) AND close >= HHV(high,252) * 0.75"
  if (/can slim|canslim|欧奈尔|成长股|业绩增长/i.test(text)) return "relative_strength_120d + volume_breakout + earnings_growth_score"
  if (/绝对动量|大盘过滤|弱市空仓/i.test(text)) return "ret(120d) if close > MA(close,120) else cash"
  if (/低波动|波动率|稳健动量/i.test(text)) return "ret(120d) - volatility(20d) * 0.35"
  if (/rsi|connors|康纳斯|超卖/i.test(text)) return "100 - RSI(close,2)"
  if (/bollinger|布林|下轨|均值回归/i.test(text)) return "(MA(close,20) - 2*STD(close,20) - close) / STD(close,20)"
  if (/缩量|量缩/.test(text) && /回调|调整/.test(text)) {
    return "close > MA(close,60) AND MA(close,20) > MA(close,60) AND ret(5d) < 0 AND volume / MA(volume,20) < 0.85"
  }
  if (/放量|成交量/.test(text) && /突破|新高/.test(text)) {
    return "close > HHV(high,60) * 0.995 AND volume / MA(volume,20) > 1.5"
  }
  if (/大盘|指数/.test(text)) return "index_close > MA(index_close,60) AND index_ret(20d) > 0"
  if (/资金|北向|主力/.test(text)) return "rank(net_inflow / float_market_cap, 20d)"
  if (/新闻|情绪|研报/.test(text)) return "EMA(sentiment_score,5d) - EMA(sentiment_score,20d)"
  if (/估值|pe|市盈率/i.test(text)) return "1 - rank(PE_TTM, industry)"
  if (/反弹|超跌|低吸/.test(text)) return "-ret(5d) * (close > MA(close,60))"
  return "rank(signal_score, 20d)"
}

function buildThesis(text: string) {
  if (!text) return "把自然语言想法转成可验证候选因子，先做历史 IC 验证再进入策略。"
  return `假设：${text.slice(0, 80)}${text.length > 80 ? "..." : ""} 可转化为横截面排序信号，并对未来收益有预测力。`
}

function inferRequiredData(text: string) {
  const data = new Set<string>(["K 线行情"])
  if (/大盘|指数/.test(text)) data.add("指数与板块")
  if (/资金|北向|主力|龙虎榜|融资/.test(text)) data.add("资金流")
  if (/新闻|情绪|研报|舆情/.test(text)) data.add("新闻与研报")
  if (/估值|pe|市盈率|财务|roe|利润/i.test(text)) data.add("财务报表")
  return Array.from(data)
}

function inferRequiredFields(text: string) {
  const fields = new Set(["date", "symbol", "close"])
  if (/开盘|跳空|日内|vwap/i.test(text)) fields.add("open")
  if (/突破|新高|平台/.test(text)) fields.add("high")
  if (/回撤|止损|新低/.test(text)) fields.add("low")
  if (/量|成交|换手|流动性/.test(text)) {
    fields.add("volume")
    fields.add("amount")
  }
  if (/资金|北向|主力/.test(text)) fields.add("net_inflow")
  if (/新闻|情绪|研报/.test(text)) fields.add("sentiment_score")
  if (/估值|pe|市盈率/i.test(text)) fields.add("pe_ttm")
  return Array.from(fields)
}

function inferQverisQueries(requiredData: string[], text: string) {
  const queries = new Set<string>()
  for (const data of requiredData) {
    const source = DATA_SOURCES.find((item) => item.name === data)
    if (source) queries.add(source.discoverQuery)
  }
  if (!queries.size) queries.add(`China A-share ${text} historical factor data`)
  return Array.from(queries).slice(0, 4)
}

function inferSimilarFactors(text: string) {
  const ids = new Set<string>()
  if (/donchian|海龟|通道|55日|55 日/.test(text)) ids.add("f-donchian-55")
  if (/minervini|趋势模板|均线多头|52周/.test(text)) ids.add("f-minervini-trend")
  if (/can slim|canslim|欧奈尔|成长股|业绩/.test(text)) ids.add("f-canslim-proxy")
  if (/绝对动量|弱市|空仓|大盘过滤/.test(text)) ids.add("f-absolute-momentum")
  if (/低波动|波动率|稳健/.test(text)) ids.add("f-low-vol-mom")
  if (/rsi|connors|康纳斯|超卖/.test(text)) ids.add("f-rsi2-reversal")
  if (/bollinger|布林|下轨|均值回归/.test(text)) ids.add("f-bollinger-revert")
  if (/momentum|动量|趋势|强势|新高/.test(text)) ids.add("f-mom-60d")
  if (/reversal|反转|回调|超跌|低吸/.test(text)) ids.add("f-rev-5d")
  if (/volume|vol|量|突破|成交/.test(text)) ids.add("f-vol-spike")
  if (/新闻|情绪|sentiment/.test(text)) ids.add("f-news-sent")
  if (/资金|北向|flow/.test(text)) ids.add("f-north-net")
  return Array.from(ids)
}

function normalizeCategory(value: unknown, fallback: Factor["category"]): Factor["category"] {
  return value === "动量" || value === "反转" || value === "量价" || value === "资金" || value === "情绪" || value === "基本面" || value === "AI"
    ? value
    : fallback
}

function normalizeFrequency(value: unknown, fallback: Factor["freq"]): Factor["freq"] {
  return value === "intraday" || value === "swing" || value === "position" ? value : fallback
}

function normalizeCandidateName(value: string, fallback: string) {
  const trimmed = value.trim()
  if (!trimmed) return fallback
  if (/^f[-_]/i.test(trimmed) || /^[a-z0-9_-]{18,}$/i.test(trimmed)) return fallback
  return trimmed.slice(0, 24)
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function asText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function asTextArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback
  const items = value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
  return items.length ? items : fallback
}

function asNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
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
