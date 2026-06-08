import { DATA_SOURCES, FACTORS } from "@/lib/catalog"

export type FactorMappingStatus = "mapped" | "proxy" | "missing"
export type DraftSource = "ai" | "heuristic"
export type StrategyLabMode = "document" | "market-observation"

export type StrategyFactorMapping = {
  sourceText: string
  factorId: string | null
  factorName: string
  confidence: number
  status: FactorMappingStatus
  note: string
}

export type StrategyDsl = {
  universe: string
  frequency: string
  ranking: string[]
  entry: string[]
  exit: string[]
  risk: string[]
  position: string[]
  rebalance: string
}

export type BacktestReadiness = {
  score: number
  ready: boolean
  issues: string[]
  requiredData: string[]
}

export type ObservationSample = {
  symbol: string
  name: string
  move: string
  evidence: string[]
}

export type ObservationHypothesis = {
  title: string
  confidence: number
  evidence: string[]
  factorIds: string[]
  test: string
}

export type ObservationDataGap = {
  data: string
  status: "available" | "partial" | "missing"
  reason: string
  qverisQuery: string
}

export type MarketObservationResearch = {
  mode: StrategyLabMode
  objective: string
  samples: ObservationSample[]
  hypotheses: ObservationHypothesis[]
  dataGaps: ObservationDataGap[]
  strategyThesis: string
}

export type StrategyDraft = {
  name: string
  summary: string
  market: string
  timeframe: string
  entryRules: string[]
  exitRules: string[]
  riskRules: string[]
  positionRules: string[]
  factorMap: StrategyFactorMapping[]
  dsl: StrategyDsl
  backtestReadiness: BacktestReadiness
  nextSteps: string[]
  source: DraftSource
  research?: MarketObservationResearch
}

const KEYWORD_FACTORS: Array<{ keys: string[]; factorId: string; note: string }> = [
  { keys: ["海龟", "donchian", "通道突破", "55日", "55 日"], factorId: "f-donchian-55", note: "用 Donchian 55 日通道突破代理趋势跟随入场。" },
  { keys: ["minervini", "趋势模板", "均线多头", "52周"], factorId: "f-minervini-trend", note: "用 Minervini 趋势模板代理强势股结构筛选。" },
  { keys: ["can slim", "canslim", "欧奈尔", "成长股", "业绩增长"], factorId: "f-canslim-proxy", note: "用 CAN SLIM 技术代理映射成长突破；财务和机构字段需补齐。" },
  { keys: ["绝对动量", "弱市空仓", "大盘过滤", "风控过滤"], factorId: "f-absolute-momentum", note: "用绝对动量代理市场状态过滤和现金仓位控制。" },
  { keys: ["低波动", "波动率", "稳健动量"], factorId: "f-low-vol-mom", note: "用低波动动量代理防守型强势轮动。" },
  { keys: ["rsi", "RSI", "connors", "康纳斯", "超卖"], factorId: "f-rsi2-reversal", note: "用 Connors RSI(2) 代理强势股短线超卖回归。" },
  { keys: ["bollinger", "布林", "下轨", "均值回归"], factorId: "f-bollinger-revert", note: "用 Bollinger 下轨偏离代理区间内均值回归。" },
  { keys: ["vcp", "窄幅", "收敛", "缩量整理"], factorId: "f-vcp-breakout", note: "用 VCP 窄幅突破代理波动收敛后的放量启动。" },
  { keys: ["keltner", "atr突破", "atr 突破", "通道上轨"], factorId: "f-keltner-breakout", note: "用 Keltner/ATR 通道突破代理强势扩张信号。" },
  { keys: ["突破后持强", "突破后不回落", "高位震荡", "蓄势", "承接"], factorId: "f-post-breakout-hold", note: "用突破后持强代理高位换手后仍不跌回箱体的承接结构。" },
  { keys: ["突破", "放量", "量能", "成交量", "平台"], factorId: "f-vol-spike", note: "用放量突破代理文档里的突破/量能确认条件。" },
  { keys: ["涨停", "强突破", "连板", "封板"], factorId: "f-tight-breakout", note: "用箱体放量突破代理涨停/强突破的日线可回测部分。" },
  { keys: ["vwap", "分时均价", "盘中承接", "日内"], factorId: "f-intra-vwap", note: "用日内 VWAP 偏离代理盘中承接；需要分钟线验证。" },
  { keys: ["板块", "题材", "概念", "共振"], factorId: "f-risk-adjusted-mom", note: "先用风险调整动量代理板块共振，后续接入板块热度和概念强度原始字段。" },
  { keys: ["趋势", "动量", "强势", "新高", "右侧"], factorId: "f-mom-60d", note: "用中期动量剔除短期噪音代理趋势强度。" },
  { keys: ["回调", "超跌", "反弹", "回撤", "低吸"], factorId: "f-rev-5d", note: "用 5 日反转捕捉短周期回调修复。" },
  { keys: ["北向", "外资", "资金流", "主力"], factorId: "f-north-net", note: "用北向净流入分位代理资金确认。" },
  { keys: ["龙虎榜", "机构席位", "游资"], factorId: "f-dragon-inst", note: "用龙虎榜机构净买代理席位资金。" },
  { keys: ["新闻", "舆情", "情绪", "研报"], factorId: "f-news-sent", note: "用新闻情感动量代理文本情绪变化。" },
  { keys: ["估值", "pe", "市盈率", "便宜"], factorId: "f-pe-rev", note: "用 PE 分位反转代理估值安全边际。" },
  { keys: ["ai", "形态", "图形", "盘整"], factorId: "f-ai-breakout", note: "用 AI 突破识别代理形态模式。" },
]

export function buildStrategyLabSystemPrompt(mode: StrategyLabMode = "document") {
  const factors = FACTORS.map((factor) => {
    return `${factor.id}: ${factor.name} / ${factor.category} / ${factor.freq} / formula=${factor.formula} / IC=${factor.ic} / IR=${factor.ir} / win=${factor.win}%`
  }).join("\n")
  const sources = DATA_SOURCES.map((source) => {
    return `${source.id}: ${source.name} / ${source.category} / fields=${source.fields.join(",")} / freq=${source.freq}`
  }).join("\n")

  return [
    mode === "market-observation"
      ? "你是 Stock Radar 的 AI 市场现象研究员，负责把用户看到的上涨样本、截图或文字观察，拆成可验证的上涨假设、因子候选和策略草稿。"
      : "你是 Stock Radar 的策略研究编译器，负责把用户上传或粘贴的投资/交易文档转成可回测的策略草稿。",
    "你的输出必须是严格 JSON，不要输出 Markdown、解释文字或代码围栏。",
    "不要声称已经完成真实回测；只能判断是否具备回测条件。",
    "不要把主力、机构、吸筹、出货等主观说法当成事实。必须写成可验证假设，并指出需要哪些数据确认。",
    "如果用户提供截图，请先识别截图中的股票、时间、涨跌幅、价格、成交额、盘口/资金/指标文字；识别不确定时要在 dataGaps 里说明。",
    "因子映射必须优先使用可用因子。不能直接覆盖的规则用 status=proxy；缺少数据或无法量化的规则用 status=missing。",
    "把主观描述翻译成可执行条件，保留不确定性和需要用户确认的地方。",
    "JSON schema:",
    JSON.stringify(
      {
        name: "策略名称",
        summary: "100 字以内摘要",
        market: "适用市场",
        timeframe: "交易周期",
        entryRules: ["入场规则"],
        exitRules: ["出场规则"],
        riskRules: ["风控规则"],
        positionRules: ["仓位规则"],
        factorMap: [
          {
            sourceText: "原文规则片段",
            factorId: "可用因子 id 或 null",
            factorName: "因子名称或缺失项名称",
            confidence: 0.72,
            status: "mapped | proxy | missing",
            note: "映射说明",
          },
        ],
        dsl: {
          universe: "股票池",
          frequency: "日线/分钟线等",
          ranking: ["排序条件"],
          entry: ["机器可执行入场条件"],
          exit: ["机器可执行出场条件"],
          risk: ["机器可执行风控条件"],
          position: ["仓位规则"],
          rebalance: "调仓频率",
        },
        backtestReadiness: {
          score: 78,
          ready: true,
          issues: ["仍需确认的问题"],
          requiredData: ["需要的数据源"],
        },
        nextSteps: ["下一步动作"],
        research: {
          mode,
          objective: "研究目标",
          samples: [
            { symbol: "000001", name: "平安银行", move: "+3.2%", evidence: ["样本证据"] },
          ],
          hypotheses: [
            {
              title: "上涨原因假设",
              confidence: 0.7,
              evidence: ["证据"],
              factorIds: ["f-vol-spike"],
              test: "如何用历史数据验证",
            },
          ],
          dataGaps: [
            {
              data: "需要补齐的数据",
              status: "available | partial | missing",
              reason: "为什么需要",
              qverisQuery: "Qveris discover 查询语句",
            },
          ],
          strategyThesis: "可回测策略主线",
        },
      },
      null,
      2,
    ),
    mode === "market-observation"
      ? "市场现象研究要求：先写 research，再写策略草稿。strategyThesis 必须能落到 dsl.entry / dsl.ranking / dsl.exit。"
      : "文档策略要求：保留原文逻辑，但把不可回测描述改写为可验证条件。",
    "可用因子：",
    factors,
    "可用数据源：",
    sources,
  ].join("\n")
}

export function heuristicStrategyDraft(input: {
  title?: string
  text: string
  mode?: StrategyLabMode
  imageAttached?: boolean
  imageName?: string
}): StrategyDraft {
  const text = normalizeWhitespace(input.text)
  const mode = input.mode ?? "document"
  const name = cleanTitle(input.title) || inferName(text, mode)
  const mappings = inferFactorMap(text)
  const requiredData = inferRequiredData(text, mappings)
  const missingCount = mappings.filter((item) => item.status === "missing").length
  const score = clamp(54 + mappings.filter((item) => item.status !== "missing").length * 8 - missingCount * 10, 35, 86)
  const research = buildMarketObservationResearch({
    text,
    mode,
    mappings,
    imageAttached: input.imageAttached,
    imageName: input.imageName,
  })

  const entryRules = mode === "market-observation"
    ? [
        "从用户给出的上涨样本中抽取共同量价/题材/资金特征，先生成候选池",
        text.includes("突破") || text.includes("涨停") ? "价格突破近期平台或 20-60 日高点，并伴随成交额/成交量放大" : "综合动量、放量、相对强度和流动性因子排名靠前",
        text.includes("板块") || text.includes("题材") ? "优先选择同板块/同题材内相对强度排名靠前的股票" : "同一行业过度集中时降低权重",
      ]
    : [
        text.includes("突破") ? "价格突破关键位或平台上沿后进入候选池" : "满足核心因子排名靠前后进入候选池",
        text.includes("量") ? "成交量或量比相对近 20 日均值显著放大" : "使用可量化因子综合评分排序",
      ]
  const exitRules = [
    text.includes("止损") ? "触发文档定义的止损条件后退出" : "跌破入场价下方 5%-8% 或 ATR 风险阈值后退出",
    "持有 5-20 个交易日后复核，排名跌出候选池则调出",
  ]

  return {
    name,
    summary: mode === "market-observation" ? summarizeObservation(text, research) : summarizeText(text),
    market: text.includes("A股") || text.includes("A 股") ? "A 股" : "A 股，后续可扩展到港股/美股",
    timeframe: text.includes("日内") || text.includes("分钟") || text.includes("盘口") ? "分钟级 / 日内 + 日线波段" : "日线波段",
    entryRules,
    exitRules,
    riskRules: [
      "单票最大亏损控制在 5%-8% 或 2 倍 ATR 内",
      "单票仓位不超过组合 10%-20%，避免同一行业过度集中",
      "遇到停牌、涨跌停无法成交时顺延处理",
    ],
    positionRules: [
      "按综合评分 Top N 等权或波动率倒数加权",
      "只有回测胜率、回撤、成交可行性通过后才允许进入雷达",
    ],
    factorMap: mappings,
    dsl: {
      universe: mode === "market-observation" ? "A 股可交易股票池 / 用户样本扩展池" : "HS300 / 中证 500 / 自定义股票池",
      frequency: text.includes("日内") || text.includes("分钟") || text.includes("盘口") ? "5m 或 15m + 1d" : "1d",
      ranking: mappings.filter((item) => item.factorId).map((item) => `${item.factorId} desc`),
      entry: entryRules,
      exit: exitRules,
      risk: ["stop_loss_pct <= 8", "position_pct <= 20", "skip_limit_up_down = true"],
      position: ["top_n = 5", "weight = equal_weight 或 inverse_volatility"],
      rebalance: text.includes("日内") || text.includes("盘口") ? "交易日盘中每 30-60 分钟扫描，收盘复核" : "每 1-5 个交易日调仓",
    },
    backtestReadiness: {
      score,
      ready: score >= 70 && missingCount <= 1,
      issues: buildReadinessIssues(text, mappings),
      requiredData,
    },
    nextSteps: [
      "确认股票池、持仓天数、止损阈值和调仓频率。",
      mode === "market-observation"
        ? "用 Qveris 补齐样本股历史 K 线、板块/题材、资金流和新闻事件，检验共同因子是否显著。"
        : "用 Qveris 拉取历史 K 线和所需资金/情绪/基本面数据跑真实回测。",
      "回测通过后固化为策略目录条目，再接入策略雷达定时扫描。",
    ],
    source: "heuristic",
    research,
  }
}

export function normalizeStrategyDraft(value: unknown, fallback: StrategyDraft, source: DraftSource): StrategyDraft {
  if (!value || typeof value !== "object") {
    return { ...fallback, source }
  }
  const obj = value as Record<string, unknown>
  const dsl = asRecord(obj.dsl)
  const readiness = asRecord(obj.backtestReadiness)

  return {
    name: asText(obj.name, fallback.name),
    summary: asText(obj.summary, fallback.summary),
    market: asText(obj.market, fallback.market),
    timeframe: asText(obj.timeframe, fallback.timeframe),
    entryRules: asTextArray(obj.entryRules, fallback.entryRules),
    exitRules: asTextArray(obj.exitRules, fallback.exitRules),
    riskRules: asTextArray(obj.riskRules, fallback.riskRules),
    positionRules: asTextArray(obj.positionRules, fallback.positionRules),
    factorMap: normalizeFactorMap(obj.factorMap, fallback.factorMap),
    dsl: {
      universe: asText(dsl.universe, fallback.dsl.universe),
      frequency: asText(dsl.frequency, fallback.dsl.frequency),
      ranking: asTextArray(dsl.ranking, fallback.dsl.ranking),
      entry: asTextArray(dsl.entry, fallback.dsl.entry),
      exit: asTextArray(dsl.exit, fallback.dsl.exit),
      risk: asTextArray(dsl.risk, fallback.dsl.risk),
      position: asTextArray(dsl.position, fallback.dsl.position),
      rebalance: asText(dsl.rebalance, fallback.dsl.rebalance),
    },
    backtestReadiness: {
      score: asNumber(readiness.score, fallback.backtestReadiness.score, 0, 100),
      ready: typeof readiness.ready === "boolean" ? readiness.ready : fallback.backtestReadiness.ready,
      issues: asTextArray(readiness.issues, fallback.backtestReadiness.issues),
      requiredData: asTextArray(readiness.requiredData, fallback.backtestReadiness.requiredData),
    },
    nextSteps: asTextArray(obj.nextSteps, fallback.nextSteps),
    source,
    research: normalizeResearch(obj.research, fallback.research),
  }
}

export function parseModelJson(content: string) {
  const trimmed = content.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1]?.trim() || trimmed
  try {
    return JSON.parse(candidate) as unknown
  } catch {
    const jsonObject = extractFirstJsonObject(candidate)
    if (jsonObject) return JSON.parse(jsonObject) as unknown
    throw new Error("模型没有返回可解析 JSON")
  }
}

function extractFirstJsonObject(value: string) {
  const start = value.indexOf("{")
  if (start < 0) return ""
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < value.length; i += 1) {
    const char = value[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    if (char === "\"") {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === "{") depth += 1
    if (char === "}") {
      depth -= 1
      if (depth === 0) return value.slice(start, i + 1)
    }
  }
  return ""
}

function normalizeResearch(value: unknown, fallback?: MarketObservationResearch): MarketObservationResearch | undefined {
  if (!value || typeof value !== "object") return fallback
  const obj = value as Record<string, unknown>
  const mode: StrategyLabMode = obj.mode === "market-observation" ? "market-observation" : "document"
  return {
    mode,
    objective: asText(obj.objective, fallback?.objective ?? (mode === "market-observation" ? "从市场样本发掘可验证因子" : "从文档提取可回测规则")),
    samples: normalizeSamples(obj.samples, fallback?.samples ?? []),
    hypotheses: normalizeHypotheses(obj.hypotheses, fallback?.hypotheses ?? []),
    dataGaps: normalizeDataGaps(obj.dataGaps, fallback?.dataGaps ?? []),
    strategyThesis: asText(obj.strategyThesis, fallback?.strategyThesis ?? "把观察到的共同特征转成可回测策略。"),
  }
}

function normalizeSamples(value: unknown, fallback: ObservationSample[]) {
  if (!Array.isArray(value)) return fallback
  const items = value.map((item) => {
    const obj = asRecord(item)
    return {
      symbol: asText(obj.symbol, ""),
      name: asText(obj.name, "待识别股票"),
      move: asText(obj.move, "待确认"),
      evidence: asTextArray(obj.evidence, []),
    }
  }).filter((item) => item.symbol || item.name !== "待识别股票" || item.evidence.length > 0)
  return items.length ? items.slice(0, 12) : fallback
}

function normalizeHypotheses(value: unknown, fallback: ObservationHypothesis[]) {
  if (!Array.isArray(value)) return fallback
  const items = value.map((item) => {
    const obj = asRecord(item)
    return {
      title: asText(obj.title, "待验证上涨假设"),
      confidence: asNumber(obj.confidence, 0.5, 0, 1),
      evidence: asTextArray(obj.evidence, []),
      factorIds: asTextArray(obj.factorIds, []),
      test: asText(obj.test, "用历史样本回测该因子组合的超额收益、回撤和胜率。"),
    }
  })
  return items.length ? items.slice(0, 8) : fallback
}

function normalizeDataGaps(value: unknown, fallback: ObservationDataGap[]) {
  if (!Array.isArray(value)) return fallback
  const items = value.map((item) => {
    const obj = asRecord(item)
    const status: ObservationDataGap["status"] = obj.status === "available" || obj.status === "partial" || obj.status === "missing"
      ? obj.status
      : "partial"
    return {
      data: asText(obj.data, "待确认数据"),
      status,
      reason: asText(obj.reason, "用于验证该观察是否可重复。"),
      qverisQuery: asText(obj.qverisQuery, "China A-share stock data"),
    }
  })
  return items.length ? items.slice(0, 10) : fallback
}

function buildMarketObservationResearch({
  text,
  mode,
  mappings,
  imageAttached,
  imageName,
}: {
  text: string
  mode: StrategyLabMode
  mappings: StrategyFactorMapping[]
  imageAttached?: boolean
  imageName?: string
}): MarketObservationResearch {
  const samples = mode === "market-observation" ? extractObservationSamples(text) : []
  const factorIds = mappings.map((item) => item.factorId).filter((item): item is string => Boolean(item))
  const hypotheses = mode === "market-observation"
    ? inferObservationHypotheses(text, factorIds)
    : [{
        title: "文档规则可量化",
        confidence: 0.58,
        evidence: ["已从文档中提取入场、出场、风控和仓位规则。"],
        factorIds,
        test: "用历史 K 线和已映射因子回测文档策略，观察样本数、收益、回撤和交易成本。",
      }]
  const dataGaps = inferObservationDataGaps(text, mode, imageAttached, imageName)
  return {
    mode,
    objective: mode === "market-observation"
      ? "从上涨样本和截图/文字观察中提炼可重复的交易因子"
      : "把策略文档转成可验证规则",
    samples,
    hypotheses,
    dataGaps,
    strategyThesis: mode === "market-observation"
      ? buildObservationThesis(text, factorIds)
      : "先把文档规则转成因子组合，再用真实历史数据验证后进入策略目录。",
  }
}

function extractObservationSamples(text: string): ObservationSample[] {
  const samples = new Map<string, ObservationSample>()
  const codePattern = /([\u4e00-\u9fa5A-Za-z]{2,12})?\s*[\(（\s]*([0368]\d{5})[\)）\s]*(?:[^，。；\n]{0,20}?([+\-]?\d+(?:\.\d+)?%|涨停|连板|大涨|新高))?/g
  let match: RegExpExecArray | null
  while ((match = codePattern.exec(text)) !== null) {
    const rawName = match[1]?.trim() ?? ""
    const symbol = match[2]
    const move = match[3]?.trim() ?? inferMoveText(text)
    const name = rawName && !/^\d+$/.test(rawName) ? rawName : "待识别股票"
    samples.set(symbol, {
      symbol,
      name,
      move,
      evidence: inferSampleEvidence(text),
    })
  }

  if (!samples.size && /(几只|上涨|涨停|大涨|样本|股票)/.test(text)) {
    samples.set("sample-basket", {
      symbol: "sample-basket",
      name: "用户给定上涨样本",
      move: inferMoveText(text),
      evidence: inferSampleEvidence(text),
    })
  }

  return Array.from(samples.values()).slice(0, 10)
}

function inferObservationHypotheses(text: string, factorIds: string[]): ObservationHypothesis[] {
  const hypotheses: ObservationHypothesis[] = []
  const add = (title: string, confidence: number, evidence: string[], ids: string[], test: string) => {
    hypotheses.push({ title, confidence, evidence, factorIds: ids, test })
  }

  if (/(放量|成交量|成交额|量比|换手)/.test(text)) {
    add(
      "量能确认后的突破更容易延续",
      0.72,
      ["观察中出现成交量、成交额、量比或换手描述。"],
      pickFactorIds(factorIds, ["f-vol-spike", "f-tight-breakout", "f-keltner-breakout"]),
      "回测 close 突破近 20-60 日高点且 volume/MA20 放大的样本，比较 1/3/5 日后收益和最大不利波动。",
    )
  }
  if (/(板块|题材|概念|共振|同板块)/.test(text)) {
    add(
      "板块共振可能比单股形态更重要",
      0.64,
      ["观察中提到板块、题材、概念或共振。"],
      pickFactorIds(factorIds, ["f-risk-adjusted-mom", "f-mom-60d"]),
      "按板块相对强度分层，测试同板块 TopN 个股在信号后是否显著跑赢市场。",
    )
  }
  if (/(主力|资金|买一|大单|盘口|承接|锁仓|资金流)/.test(text)) {
    add(
      "资金承接是上涨延续的候选解释，但需要原始资金/盘口验证",
      0.58,
      ["观察中包含主力、盘口、大单、买一或承接描述。"],
      pickFactorIds(factorIds, ["f-ai-flow", "f-north-net", "f-dragon-inst", "f-intra-vwap"]),
      "用主力资金流、逐笔成交或盘口挂单数据验证；如果没有原始字段，只能用 VWAP/成交额做代理。",
    )
  }
  if (/(高位|震荡|蓄势|不跌|回落|回踩|沉淀)/.test(text)) {
    add(
      "突破后高位不回落可能代表强势持有结构",
      0.67,
      ["观察中出现高位震荡、回踩、蓄势或不跌回平台的描述。"],
      pickFactorIds(factorIds, ["f-post-breakout-hold", "f-vcp-breakout", "f-atr-compression"]),
      "筛选突破后 3-8 日不跌回箱体且 ATR/成交量未失速的样本，测试后续 5-20 日收益。",
    )
  }
  if (/(新闻|公告|研报|催化|事件|政策)/.test(text)) {
    add(
      "事件催化可能提供第一波解释，量价确认决定是否可交易",
      0.6,
      ["观察中提到新闻、公告、研报、政策或事件。"],
      pickFactorIds(factorIds, ["f-news-sent", "f-vol-spike"]),
      "把事件时间戳与股价突破时间对齐，测试事件后放量突破是否优于单纯事件样本。",
    )
  }

  if (!hypotheses.length) {
    add(
      "先用强势动量 + 放量确认作为可回测基线",
      0.52,
      ["观察文本还不够结构化，先建立可验证基线。"],
      pickFactorIds(factorIds, ["f-mom-60d", "f-vol-spike"]),
      "先回测动量、放量、流动性三因子组合，再根据失败样本补充资金/事件字段。",
    )
  }

  return hypotheses.slice(0, 6)
}

function inferObservationDataGaps(
  text: string,
  mode: StrategyLabMode,
  imageAttached?: boolean,
  imageName?: string,
): ObservationDataGap[] {
  const gaps: ObservationDataGap[] = [
    {
      data: "复权日 K / 分钟 K",
      status: "available",
      reason: "用于验证突破、回踩、VWAP、成交量和信号后涨跌幅。",
      qverisQuery: "China A-share adjusted OHLCV daily minute kline",
    },
  ]

  if (mode === "market-observation") {
    gaps.push({
      data: "样本股票池与当日涨幅榜",
      status: "available",
      reason: "需要把用户给出的上涨样本扩展到全市场，避免只解释个案。",
      qverisQuery: "China A-share daily top gainers stock ranking",
    })
  }
  if (/(板块|题材|概念|共振)/.test(text)) {
    gaps.push({
      data: "板块/题材成分与热度",
      status: "partial",
      reason: "判断上涨是否来自板块扩散，而不是单股独立事件。",
      qverisQuery: "China A-share concept sector constituent hot theme rank",
    })
  }
  if (/(主力|资金|买一|大单|盘口|逐笔|承接|锁仓)/.test(text)) {
    gaps.push({
      data: "主力资金流 / 盘口 / 逐笔成交",
      status: "partial",
      reason: "验证资金承接、买一挂单和大单行为，不能只靠主观描述。",
      qverisQuery: "China A-share money flow large order level2 order book tick",
    })
  }
  if (/(新闻|公告|研报|催化|事件|政策)/.test(text)) {
    gaps.push({
      data: "新闻、公告和研报事件流",
      status: "partial",
      reason: "判断上涨是否由事件催化，并量化事件发生到价格反应的时差。",
      qverisQuery: "China listed company news announcement research report sentiment",
    })
  }
  if (imageAttached) {
    gaps.push({
      data: "截图视觉识别校验",
      status: "partial",
      reason: `已附加${imageName ? ` ${imageName}` : "截图"}；如果当前模型不支持视觉，需要用户补充截图里的股票、时间和指标文字。`,
      qverisQuery: "OCR stock screenshot quote chart order book",
    })
  }

  return gaps
}

function buildObservationThesis(text: string, factorIds: string[]) {
  const parts = []
  if (factorIds.includes("f-vol-spike") || /放量|成交/.test(text)) parts.push("放量确认")
  if (factorIds.includes("f-vcp-breakout") || /窄幅|收敛/.test(text)) parts.push("波动收敛突破")
  if (factorIds.includes("f-post-breakout-hold") || /高位|承接|蓄势/.test(text)) parts.push("突破后持强")
  if (/板块|题材|概念/.test(text)) parts.push("板块共振")
  if (/资金|主力|盘口/.test(text)) parts.push("资金承接验证")
  const thesis = parts.length ? parts.join(" + ") : "强势动量 + 放量突破"
  return `${thesis}：先从用户上涨样本中提取共同特征，再扩展到全市场历史样本回测，只有通过样本外和实盘模拟后才进入雷达。`
}

function inferSampleEvidence(text: string) {
  const evidence: string[] = []
  if (/(涨停|连板|大涨|新高)/.test(text)) evidence.push("价格表现强于普通上涨样本")
  if (/(成交额|成交量|放量|量比|换手)/.test(text)) evidence.push("量能/换手特征被用户明确提到")
  if (/(MACD|均线|VWAP|分时|K线|突破)/i.test(text)) evidence.push("存在技术结构描述")
  if (/(主力|资金|盘口|买一|大单)/.test(text)) evidence.push("存在资金或盘口观察")
  if (!evidence.length) evidence.push("需要补充涨幅、时间、成交和形态证据")
  return evidence
}

function inferMoveText(text: string) {
  if (text.includes("涨停")) return "涨停"
  const match = text.match(/[+＋]?\d+(?:\.\d+)?%/)
  return match?.[0] ?? "上涨样本"
}

function pickFactorIds(available: string[], preferred: string[]) {
  const picked = preferred.filter((id) => available.includes(id))
  return picked.length ? picked : preferred.slice(0, 2)
}

function inferFactorMap(text: string): StrategyFactorMapping[] {
  const lower = text.toLowerCase()
  const hits = KEYWORD_FACTORS.filter((item) => item.keys.some((key) => lower.includes(key.toLowerCase())))
  const unique = new Map<string, StrategyFactorMapping>()

  for (const hit of hits) {
    const factor = FACTORS.find((item) => item.id === hit.factorId)
    if (!factor || unique.has(factor.id)) continue
    unique.set(factor.id, {
      sourceText: hit.keys.find((key) => lower.includes(key.toLowerCase())) ?? factor.name,
      factorId: factor.id,
      factorName: factor.name,
      confidence: 0.68,
      status: "proxy",
      note: hit.note,
    })
  }

  if (unique.size === 0) {
    const factor = FACTORS.find((item) => item.id === "f-mom-60d") ?? FACTORS[0]
    unique.set(factor.id, {
      sourceText: "文档未出现明确可量化关键词",
      factorId: factor.id,
      factorName: factor.name,
      confidence: 0.45,
      status: "proxy",
      note: "先用通用动量因子形成可回测草稿，需继续人工确认规则。",
    })
  }

  if (text.includes("主观") || text.includes("经验") || text.includes("盘感")) {
    unique.set("missing-discretion", {
      sourceText: "主观经验 / 盘感",
      factorId: null,
      factorName: "主观规则待量化",
      confidence: 0.2,
      status: "missing",
      note: "需要把主观判断改写成价格、成交量、资金或事件条件。",
    })
  }

  return Array.from(unique.values()).slice(0, 8)
}

function inferRequiredData(text: string, mappings: StrategyFactorMapping[]) {
  const sourceIds = new Set(["k-line"])
  for (const mapping of mappings) {
    if (mapping.factorId?.includes("north")) sourceIds.add("north-bound")
    if (mapping.factorId?.includes("dragon")) sourceIds.add("dragon-tiger")
    if (mapping.factorId?.includes("news")) sourceIds.add("news")
    if (mapping.factorId?.includes("pe")) sourceIds.add("fin-statement")
  }
  if (text.includes("融资")) sourceIds.add("margin")
  if (text.includes("主力")) sourceIds.add("fund-flow")
  if (/(盘口|买一|逐笔|分时|VWAP|vwap)/i.test(text)) sourceIds.add("realtime")
  if (/(板块|题材|概念|共振)/.test(text)) {
    sourceIds.add("index")
    sourceIds.add("concept")
  }
  if (/(公告|事件|政策|催化)/.test(text)) sourceIds.add("announcement")
  return DATA_SOURCES.filter((source) => sourceIds.has(source.id)).map((source) => source.name)
}

function buildReadinessIssues(text: string, mappings: StrategyFactorMapping[]) {
  const issues: string[] = []
  if (!/(止损|退出|卖出|离场)/.test(text)) issues.push("文档没有明确退出/止损规则，已生成默认风险阈值。")
  if (!/(仓位|等权|满仓|半仓|分批)/.test(text)) issues.push("仓位规则不完整，需要确认单票上限和组合持仓数量。")
  if (mappings.some((item) => item.status === "missing")) issues.push("存在无法直接量化的主观规则，需要人工确认替代指标。")
  if (issues.length === 0) issues.push("已具备首轮历史回测条件，仍需确认股票池和交易成本。")
  return issues
}

function normalizeFactorMap(value: unknown, fallback: StrategyFactorMapping[]) {
  if (!Array.isArray(value)) return fallback
  const items = value.map((item) => {
    const obj = asRecord(item)
    const status: FactorMappingStatus =
      obj.status === "mapped" || obj.status === "proxy" || obj.status === "missing" ? obj.status : "proxy"
    const factorId = typeof obj.factorId === "string" && obj.factorId.trim() ? obj.factorId.trim() : null
    const knownFactor = factorId ? FACTORS.find((factor) => factor.id === factorId) : null
    return {
      sourceText: asText(obj.sourceText, knownFactor?.name ?? "规则片段"),
      factorId,
      factorName: asText(obj.factorName, knownFactor?.name ?? "待映射因子"),
      confidence: asNumber(obj.confidence, 0.5, 0, 1),
      status,
      note: asText(obj.note, status === "missing" ? "缺少可直接映射的数据或因子。" : "已映射到现有因子库。"),
    }
  })
  return items.length > 0 ? items.slice(0, 10) : fallback
}

function cleanTitle(value?: string) {
  return value?.replace(/\.(pdf|txt|md)$/i, "").trim() ?? ""
}

function inferName(text: string, mode: StrategyLabMode = "document") {
  const firstLine = text.split(/\n/).map((line) => line.trim()).find(Boolean)
  if (firstLine && firstLine.length <= 24) return firstLine
  if (mode === "market-observation") {
    if (text.includes("涨停")) return "上涨样本因子挖掘"
    if (text.includes("突破")) return "强势突破样本研究"
    return "市场现象因子研究"
  }
  if (text.includes("利弗莫尔")) return "利弗莫尔买入法"
  if (text.includes("突破")) return "文档突破策略"
  return "用户文档策略"
}

function summarizeObservation(text: string, research: MarketObservationResearch) {
  const sampleLabel = research.samples.length ? `识别 ${research.samples.length} 个样本` : "等待补充样本股票"
  const hypothesis = research.hypotheses[0]?.title ?? "先建立可验证上涨假设"
  const compact = normalizeWhitespace(text)
  const suffix = compact.length ? `；原始观察：${compact.slice(0, 48)}${compact.length > 48 ? "..." : ""}` : ""
  return `${sampleLabel}，核心假设：${hypothesis}${suffix}`
}

function summarizeText(text: string) {
  const compact = normalizeWhitespace(text)
  if (compact.length <= 96) return compact
  return `${compact.slice(0, 96)}...`
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim()
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
  return items.length > 0 ? items : fallback
}

function asNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN
  if (!Number.isFinite(numeric)) return fallback
  return clamp(numeric, min, max)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
