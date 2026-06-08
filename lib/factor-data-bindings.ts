import { DATA_SOURCES, FACTORS, type DataSource, type Factor } from "@/lib/catalog"
import type { StrategyDraft, StrategyFactorMapping } from "@/lib/strategy-lab"

export type FactorDataStatus = "real" | "proxy" | "missing"

export type FactorDataBinding = {
  factorId: string
  factorName: string
  category: Factor["category"] | "自定义"
  formula: string
  status: FactorDataStatus
  sourceIds: string[]
  sourceNames: string[]
  requiredFields: string[]
  qverisQuery: string
  currentImplementation: string
  nextAction: string
  confidence: number
}

export type FactorDataPlan = {
  generatedAt: string
  total: number
  realCount: number
  proxyCount: number
  missingCount: number
  coveragePct: number
  bindings: FactorDataBinding[]
  storagePlan: Array<{
    table: string
    purpose: string
    key: string
    ttl: string
  }>
}

type BindingSpec = {
  sourceIds: string[]
  requiredFields: string[]
  query: string
  direct: boolean
  action: string
  implementation?: string
}

const DIRECT_PRICE_FACTORS = new Set([
  "f-mom-60d",
  "f-vol-spike",
  "f-rev-5d",
  "f-donchian-55",
  "f-atr-compression",
  "f-minervini-trend",
  "f-absolute-momentum",
  "f-low-vol-mom",
  "f-rsi2-reversal",
  "f-bollinger-revert",
  "f-sma200-momentum",
  "f-risk-adjusted-mom",
  "f-macd-trend",
  "f-tight-breakout",
  "f-pullback-uptrend",
  "f-vcp-breakout",
  "f-keltner-breakout",
  "f-post-breakout-hold",
  "f-rsrs-right-side",
  "f-residual-mom-low-vol",
  "f-mid-vol-reversal",
  "f-value-low-vol",
  "f-intra-vwap",
  "f-overnight",
])

const FACTOR_SPECS: Record<string, BindingSpec> = {
  "f-rev-5d": {
    sourceIds: ["k-line"],
    requiredFields: ["date", "close", "adjustment_factor"],
    query: "China A-share adjusted daily kline close price history",
    direct: true,
    action: "已可由 Qveris K 线直接计算。",
  },
  "f-mom-60d": {
    sourceIds: ["k-line"],
    requiredFields: ["date", "close", "adjustment_factor"],
    query: "China A-share adjusted daily kline close price history",
    direct: true,
    action: "已可由 Qveris K 线直接计算。",
  },
  "f-vol-spike": {
    sourceIds: ["k-line"],
    requiredFields: ["date", "close", "volume", "amount", "adjustment_factor"],
    query: "China A-share adjusted daily kline volume amount history",
    direct: true,
    action: "已可由 Qveris K 线直接计算；后续可补充换手率提升质量。",
  },
  "f-donchian-55": {
    sourceIds: ["k-line"],
    requiredFields: ["date", "high", "close", "adjustment_factor"],
    query: "China A-share adjusted daily kline high close Donchian channel breakout",
    direct: true,
    action: "已可由 Qveris K 线直接计算 55 日通道突破。",
  },
  "f-atr-compression": {
    sourceIds: ["k-line"],
    requiredFields: ["date", "high", "low", "close", "adjustment_factor"],
    query: "China A-share adjusted daily kline ATR volatility compression",
    direct: true,
    action: "已可由 Qveris K 线计算 ATR14/价格分位。",
  },
  "f-minervini-trend": {
    sourceIds: ["k-line"],
    requiredFields: ["date", "high", "low", "close", "adjustment_factor"],
    query: "China A-share adjusted daily kline moving averages 52 week high low",
    direct: true,
    action: "已可由 Qveris K 线计算均线多头、52 周高低位与动量条件。",
  },
  "f-canslim-proxy": {
    sourceIds: ["k-line", "fin-statement"],
    requiredFields: ["date", "close", "high", "volume", "eps_growth", "sales_growth", "institutional_ownership"],
    query: "China A-share CAN SLIM earnings growth sales growth institutional sponsorship price breakout",
    direct: false,
    action: "当前只用 K 线构造 CAN SLIM 技术代理；需补 EPS/营收增长、机构持仓后才是完整 CAN SLIM。",
  },
  "f-absolute-momentum": {
    sourceIds: ["k-line"],
    requiredFields: ["date", "close", "adjustment_factor"],
    query: "China A-share adjusted daily kline absolute momentum trend filter",
    direct: true,
    action: "已可由 Qveris K 线计算 120 日绝对动量和趋势过滤。",
  },
  "f-low-vol-mom": {
    sourceIds: ["k-line"],
    requiredFields: ["date", "close", "high", "low", "adjustment_factor"],
    query: "China A-share adjusted daily kline momentum volatility factor",
    direct: true,
    action: "已可由 Qveris K 线计算中期动量减波动惩罚。",
  },
  "f-rsi2-reversal": {
    sourceIds: ["k-line"],
    requiredFields: ["date", "close", "adjustment_factor"],
    query: "China A-share adjusted daily kline RSI 2 mean reversion",
    direct: true,
    action: "已可由 Qveris K 线计算 2 日 RSI 反转信号。",
  },
  "f-bollinger-revert": {
    sourceIds: ["k-line"],
    requiredFields: ["date", "close", "high", "low", "adjustment_factor"],
    query: "China A-share adjusted daily kline Bollinger Bands mean reversion",
    direct: true,
    action: "已可由 Qveris K 线计算 20 日 Bollinger 下轨偏离。",
  },
  "f-sma200-momentum": {
    sourceIds: ["k-line"],
    requiredFields: ["date", "close", "adjustment_factor"],
    query: "China A-share adjusted daily kline SMA200 momentum trend filter",
    direct: true,
    action: "已可由 Qveris K 线计算长期均线趋势和中期动量。",
  },
  "f-risk-adjusted-mom": {
    sourceIds: ["k-line"],
    requiredFields: ["date", "close", "adjustment_factor"],
    query: "China A-share adjusted daily kline risk adjusted momentum volatility",
    direct: true,
    action: "已可由 Qveris K 线计算收益/波动比。",
  },
  "f-macd-trend": {
    sourceIds: ["k-line"],
    requiredFields: ["date", "close", "adjustment_factor"],
    query: "China A-share adjusted daily kline MACD EMA trend",
    direct: true,
    action: "已可由 Qveris K 线计算 EMA/MACD 趋势强度。",
  },
  "f-tight-breakout": {
    sourceIds: ["k-line"],
    requiredFields: ["date", "high", "low", "close", "volume", "adjustment_factor"],
    query: "China A-share adjusted daily kline tight base breakout volume ATR",
    direct: true,
    action: "已可由 Qveris K 线计算箱体突破、放量和 ATR 收缩。",
  },
  "f-pullback-uptrend": {
    sourceIds: ["k-line"],
    requiredFields: ["date", "close", "adjustment_factor"],
    query: "China A-share adjusted daily kline SMA200 uptrend RSI2 pullback",
    direct: true,
    action: "已可由 Qveris K 线计算趋势内 RSI2 回调。",
  },
  "f-vcp-breakout": {
    sourceIds: ["k-line"],
    requiredFields: ["date", "high", "low", "close", "volume", "adjustment_factor"],
    query: "China A-share adjusted daily kline volatility contraction pattern breakout volume dry up",
    direct: true,
    action: "已可由 Qveris K 线计算波动收敛、量能萎缩和高点突破。",
  },
  "f-keltner-breakout": {
    sourceIds: ["k-line"],
    requiredFields: ["date", "high", "low", "close", "volume", "adjustment_factor"],
    query: "China A-share adjusted daily kline Keltner channel ATR breakout",
    direct: true,
    action: "已可由 Qveris K 线计算 Keltner/ATR 通道突破。",
  },
  "f-post-breakout-hold": {
    sourceIds: ["k-line"],
    requiredFields: ["date", "high", "low", "close", "volume", "adjustment_factor"],
    query: "China A-share adjusted daily kline breakout follow through hold above pivot",
    direct: true,
    action: "已可由 Qveris K 线计算突破后站稳和量价延续。",
  },
  "f-rsrs-right-side": {
    sourceIds: ["k-line"],
    requiredFields: ["date", "high", "low", "close", "adjustment_factor"],
    query: "China A-share RSRS high low regression slope daily kline",
    direct: true,
    action: "已可由 Qveris K 线计算 high/low 回归斜率与标准化强度。",
  },
  "f-residual-mom-low-vol": {
    sourceIds: ["k-line"],
    requiredFields: ["date", "close", "adjustment_factor"],
    query: "China A-share residual momentum low volatility adjusted daily kline",
    direct: true,
    action: "已可由 Qveris K 线构造残差动量低波代理。",
  },
  "f-mid-vol-reversal": {
    sourceIds: ["k-line"],
    requiredFields: ["date", "high", "low", "close", "adjustment_factor"],
    query: "China A-share medium volatility reversal factor daily kline",
    direct: true,
    action: "已可由 Qveris K 线计算中等波动状态下的反转信号。",
  },
  "f-value-low-vol": {
    sourceIds: ["k-line", "fin-statement"],
    requiredFields: ["date", "close", "high", "low", "pe_ttm", "roe", "cash_flow"],
    query: "China A-share value low volatility quality financial statement factor",
    direct: true,
    action: "当前可用 K 线价格分位和波动构造防守代理；财报字段补齐后替换为真实价值质量因子。",
  },
  "f-intra-vwap": {
    sourceIds: ["k-line", "realtime"],
    requiredFields: ["date", "close", "vwap", "amount", "volume"],
    query: "China A-share intraday vwap minute kline amount volume",
    direct: true,
    action: "已可由分钟 K 线或日内 VWAP 字段计算。",
  },
  "f-overnight": {
    sourceIds: ["k-line"],
    requiredFields: ["date", "open", "prev_close", "close"],
    query: "China A-share adjusted daily kline open close previous close",
    direct: true,
    action: "已可由 Qveris K 线直接计算。",
  },
  "f-north-net": {
    sourceIds: ["north-bound"],
    requiredFields: ["trade_date", "symbol", "net_buy_amount", "holding_ratio", "float_market_cap"],
    query: "Shanghai Hong Kong Stock Connect northbound net inflow holdings by stock daily",
    direct: false,
    action: "绑定北向资金日度明细，写入 factor_values 后替换 K 线代理。",
  },
  "f-dragon-inst": {
    sourceIds: ["dragon-tiger"],
    requiredFields: ["trade_date", "symbol", "seat_type", "buy_amount", "sell_amount", "net_buy_amount"],
    query: "China A-share dragon tiger list institutional seat net buy daily",
    direct: false,
    action: "绑定龙虎榜机构席位净买入，按 5 日滚动聚合。",
  },
  "f-pe-rev": {
    sourceIds: ["fin-statement"],
    requiredFields: ["report_date", "symbol", "pe_ttm", "industry", "market_cap"],
    query: "China A-share PE TTM valuation industry percentile history",
    direct: false,
    action: "绑定估值历史快照，按行业计算 PE 分位。",
  },
  "f-news-sent": {
    sourceIds: ["news", "announcement"],
    requiredFields: ["published_at", "symbol", "sentiment_score", "source", "title"],
    query: "China A-share stock news research report announcement sentiment score history",
    direct: false,
    action: "绑定新闻/公告情绪分，计算 5/20 日 EMA 差值。",
  },
  "f-margin-spike": {
    sourceIds: ["margin"],
    requiredFields: ["trade_date", "symbol", "margin_balance", "financing_buy_amount", "short_balance"],
    query: "China A-share margin financing balance daily by stock history",
    direct: false,
    action: "绑定两融余额日度数据，计算 5 日二阶变化。",
  },
  "f-ai-breakout": {
    sourceIds: ["k-line"],
    requiredFields: ["date", "open", "high", "low", "close", "volume", "model_version"],
    query: "China A-share historical kline breakout pattern model features",
    direct: false,
    action: "需要把形态模型版本和特征产物落库；目前只能用 K 线规则代理。",
  },
  "f-ai-flow": {
    sourceIds: ["fund-flow", "north-bound"],
    requiredFields: ["trade_date", "symbol", "large_order_net_inflow", "northbound_net_buy", "model_version"],
    query: "China A-share stock money flow large order northbound flow daily history",
    direct: false,
    action: "绑定主力资金/北向资金并记录模型版本，替换 K 线代理。",
  },
}

export function buildFactorDataPlanFromIds(factorIds: string[]): FactorDataPlan {
  const bindings = Array.from(new Set(factorIds)).map((factorId) => buildBinding(factorId))
  return buildPlan(bindings)
}

export function buildFactorDataPlanForDraft(draft: StrategyDraft): FactorDataPlan {
  const mappings = new Map<string, StrategyFactorMapping>()
  const factorIds = new Set<string>()
  for (const ranking of draft.dsl.ranking) {
    const factorId = ranking.trim().split(/\s+/)[0]
    if (factorId) factorIds.add(factorId)
  }
  for (const mapping of draft.factorMap) {
    if (mapping.factorId) {
      factorIds.add(mapping.factorId)
      mappings.set(mapping.factorId, mapping)
    } else {
      const missingId = `missing-${slug(mapping.factorName || mapping.sourceText)}`
      factorIds.add(missingId)
      mappings.set(missingId, mapping)
    }
  }
  if (!factorIds.size) factorIds.add("f-mom-60d")
  const bindings = Array.from(factorIds).map((factorId) => buildBinding(factorId, mappings.get(factorId), draft))
  return buildPlan(bindings)
}

function buildPlan(bindings: FactorDataBinding[]): FactorDataPlan {
  const realCount = bindings.filter((item) => item.status === "real").length
  const proxyCount = bindings.filter((item) => item.status === "proxy").length
  const missingCount = bindings.filter((item) => item.status === "missing").length
  const total = bindings.length
  return {
    generatedAt: new Date().toISOString(),
    total,
    realCount,
    proxyCount,
    missingCount,
    coveragePct: total ? Math.round((realCount / total) * 100) : 0,
    bindings,
    storagePlan: [
      {
        table: "raw_market_data",
        purpose: "缓存 Qveris 原始行情、资金、情绪、财务等响应。",
        key: "source_id + symbol + date",
        ttl: "行情 5-10 分钟；历史/财务按日或公告日刷新",
      },
      {
        table: "factor_values",
        purpose: "保存因子引擎计算后的日度/分钟级因子值。",
        key: "factor_id + symbol + as_of",
        ttl: "随源数据版本失效",
      },
      {
        table: "factor_bindings",
        purpose: "记录因子到 Qveris 工具、字段、参数 schema 的绑定关系。",
        key: "factor_id + provider + tool_id",
        ttl: "工具 schema 变化时刷新",
      },
      {
        table: "factor_recipes",
        purpose: "保存 AI/文档生成的 K 线公式、字段依赖和版本，便于复测、雷达和模拟盘共用同一口径。",
        key: "factor_id + version",
        ttl: "公式或字段口径变化时生成新版本",
      },
    ],
  }
}

function buildBinding(factorId: string, mapping?: StrategyFactorMapping, draft?: StrategyDraft): FactorDataBinding {
  const factor = FACTORS.find((item) => item.id === factorId)
  const fallbackFormula = factor?.formula ?? mapping?.note ?? mapping?.sourceText ?? "用户自定义公式待确认"
  const compiledKLineSpec = FACTOR_SPECS[factorId] ? null : compileKLineFormulaSpec(factorId, mapping, fallbackFormula)
  const spec = FACTOR_SPECS[factorId] ?? compiledKLineSpec ?? inferCustomSpec(factorId, mapping)
  const sourceNames = spec.sourceIds.map(sourceName).filter(Boolean)
  const name = factor?.name ?? mapping?.factorName ?? factorId
  const formula = fallbackFormula
  const query = spec.query || `${name} ${draft?.market ?? "China A-share"} Qveris historical data`
  const isMissing = Boolean(mapping && !mapping.factorId && !compiledKLineSpec)
  const isDirectPriceBinding = spec.direct && (DIRECT_PRICE_FACTORS.has(factorId) || Boolean(compiledKLineSpec))
  const status: FactorDataStatus = isMissing ? "missing" : isDirectPriceBinding ? "real" : "proxy"

  return {
    factorId,
    factorName: name,
    category: factor?.category ?? inferCategory(`${factorId} ${name} ${formula}`),
    formula,
    status,
    sourceIds: spec.sourceIds,
    sourceNames,
    requiredFields: spec.requiredFields,
    qverisQuery: query,
    currentImplementation:
      spec.implementation ??
      (status === "real"
        ? "真实字段"
        : status === "proxy"
          ? "K 线代理"
          : "未绑定"),
    nextAction:
      status === "real"
        ? spec.action
        : isMissing
          ? "先把该规则转成可计算公式，再 discover Qveris 字段并写入 factor_bindings。"
          : spec.action,
    confidence: status === "real" ? 1 : status === "proxy" ? 0.62 : 0.35,
  }
}

function compileKLineFormulaSpec(
  factorId: string,
  mapping: StrategyFactorMapping | undefined,
  formula: string,
): BindingSpec | null {
  const text = `${factorId} ${mapping?.factorName ?? ""} ${mapping?.sourceText ?? ""} ${mapping?.note ?? ""} ${formula}`
  if (!looksLikeKLineComputableFormula(text)) return null

  return {
    sourceIds: ["k-line"],
    requiredFields: inferKLineFields(text),
    query: `${mapping?.factorName ?? factorId} China A-share adjusted daily kline OHLCV amount turnover history`,
    direct: true,
    implementation: "Qveris K线公式",
    action: "已编译为 Qveris K 线派生因子；可写入 factor_values 后直接用于回测、雷达和实盘模拟。",
  }
}

function looksLikeKLineComputableFormula(text: string) {
  const normalized = text.toLowerCase()
  if (/(主力|北向|资金流|资金净流入|龙虎榜|机构席位|新闻|研报|公告|舆情|情绪|财务|估值|营收|利润|融资|融券|盘口|挂单|买一|卖一|order book|\b(?:roe|eps|pe|pb)\b)/i.test(normalized)) {
    return false
  }
  return /(open|high|low|close|volume|vol\b|amount|turnover|vwap|ma\s*\(|ema\s*\(|sma\s*\(|rsi|macd|atr|boll|keltner|donchian|pivot|highest|lowest|rank|percentile|zscore|收盘|开盘|最高|最低|成交|成交量|成交额|均量|换手|量比|均线|新高|突破|回撤|止损|波动|振幅|分位|排序|箱体|通道|涨幅|跌幅)/i.test(normalized)
}

function inferKLineFields(text: string) {
  const normalized = text.toLowerCase()
  const fields = new Set(["date", "close", "adjustment_factor"])
  if (/(open|开盘|隔夜|overnight)/i.test(normalized)) fields.add("open")
  if (/(high|最高|新高|突破|pivot|highest|donchian|通道|箱体|atr|keltner|boll|振幅|波动)/i.test(normalized)) fields.add("high")
  if (/(low|最低|lowest|atr|keltner|boll|振幅|波动|箱体)/i.test(normalized)) fields.add("low")
  if (/(volume|vol\b|成交量|均量|放量|缩量|量比|流动性)/i.test(normalized)) fields.add("volume")
  if (/(amount|成交额|金额|流动性)/i.test(normalized)) fields.add("amount")
  if (/(turnover|换手)/i.test(normalized)) fields.add("turnover_rate")
  return Array.from(fields)
}

function inferCustomSpec(factorId: string, mapping?: StrategyFactorMapping): BindingSpec {
  const text = `${factorId} ${mapping?.factorName ?? ""} ${mapping?.sourceText ?? ""} ${mapping?.note ?? ""}`
  if (/(北向|资金|主力|flow|龙虎榜)/i.test(text)) {
    return {
      sourceIds: ["fund-flow", "north-bound"],
      requiredFields: ["trade_date", "symbol", "net_inflow", "large_order_net_inflow"],
      query: "China A-share stock money flow northbound net inflow daily history",
      direct: false,
      action: "绑定资金流字段后计算用户因子，替换 K 线量能代理。",
    }
  }
  if (/(新闻|情绪|公告|研报|sentiment)/i.test(text)) {
    return {
      sourceIds: ["news", "announcement"],
      requiredFields: ["published_at", "symbol", "sentiment_score", "event_type"],
      query: "China A-share stock news announcement sentiment score history",
      direct: false,
      action: "绑定情绪/公告事件流，按策略窗口聚合。",
    }
  }
  if (/(估值|财务|利润|value|\b(?:pe|pb|roe)\b)/i.test(text)) {
    return {
      sourceIds: ["fin-statement"],
      requiredFields: ["report_date", "symbol", "pe_ttm", "pb", "roe", "net_profit_growth"],
      query: "China A-share valuation PE PB ROE financial statement history",
      direct: false,
      action: "绑定财务和估值快照，按报告期对齐到交易日。",
    }
  }
  if (/(大盘|指数|市场|环境|宽度|index)/i.test(text)) {
    return {
      sourceIds: ["index"],
      requiredFields: ["date", "index_code", "close", "advance_count", "decline_count"],
      query: "China A-share index market breadth advance decline daily history",
      direct: false,
      action: "绑定指数和市场宽度数据，作为组合级过滤条件。",
    }
  }
  if (/(突破|关键点|成交|量|流动性|换手|volume|turnover)/i.test(text)) {
    return {
      sourceIds: ["k-line"],
      requiredFields: ["date", "close", "high", "volume", "amount", "turnover_rate"],
      query: "China A-share daily kline amount turnover rate volume history",
      direct: false,
      action: "补充成交额/换手率字段后可从代理升级为真实量价因子。",
    }
  }
  return {
    sourceIds: [],
    requiredFields: [],
    query: mapping?.sourceText ?? factorId,
    direct: false,
    action: "需要人工确认公式、数据源和字段口径。",
  }
}

function sourceName(id: string) {
  return DATA_SOURCES.find((item: DataSource) => item.id === id)?.name ?? id
}

function inferCategory(text: string): FactorDataBinding["category"] {
  if (/(资金|北向|主力|flow|龙虎榜)/i.test(text)) return "资金"
  if (/(新闻|情绪|公告|研报|sentiment)/i.test(text)) return "情绪"
  if (/(估值|PE|PB|ROE|财务|利润|value)/i.test(text)) return "基本面"
  if (/(AI|模型|形态|pattern)/i.test(text)) return "AI"
  if (/(回撤|止损|反转|reversal)/i.test(text)) return "反转"
  if (/(成交|量|突破|换手|volume)/i.test(text)) return "量价"
  if (/(趋势|动量|momentum)/i.test(text)) return "动量"
  return "自定义"
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "factor"
}
