/** 平台目录：数据源、因子、策略。MVP 用静态目录，后续接 Qveris discover。 */

export type DataSource = {
  id: string
  category: "行情" | "财务" | "资金" | "情绪" | "事件" | "另类"
  name: string
  desc: string
  fields: string[]
  freq: string
  coverage: string
  provider: string
  /** Qveris 自然语言查询，用于 discover 匹配工具。 */
  discoverQuery: string
}

export const DATA_SOURCES: DataSource[] = [
  {
    id: "k-line",
    category: "行情",
    name: "K 线行情",
    desc: "日/周/月/分钟级 OHLCV，含复权处理与停复牌标记。",
    fields: ["open", "high", "low", "close", "volume", "amount", "vwap"],
    freq: "1m / 5m / 15m / 30m / 60m / 1d",
    coverage: "1990-至今",
    provider: "Qveris",
    discoverQuery: "China A-share stock OHLCV daily kline 历史行情",
  },
  {
    id: "realtime",
    category: "行情",
    name: "实时行情",
    desc: "A 股实时报价、五档盘口、最新成交。",
    fields: ["last", "bid", "ask", "volume", "change_pct"],
    freq: "Tick / 实时",
    coverage: "实时",
    provider: "Qveris",
    discoverQuery: "China stock realtime quote price 实时报价",
  },
  {
    id: "fin-statement",
    category: "财务",
    name: "财务报表",
    desc: "三大表 + 关键比率，含审计意见与重述记录。",
    fields: ["营收", "净利润", "ROE", "毛利率", "现金流", "资产负债率"],
    freq: "季报",
    coverage: "2000-至今",
    provider: "Qveris",
    discoverQuery: "China listed company financial statements income balance sheet 财报",
  },
  {
    id: "north-bound",
    category: "资金",
    name: "北向资金",
    desc: "沪深港通持股明细与日度净流入。",
    fields: ["持股数", "持股比例", "净买入", "净流入额"],
    freq: "日",
    coverage: "2017-至今",
    provider: "Qveris",
    discoverQuery: "Shanghai-Hong Kong Stock Connect northbound flow 北向资金",
  },
  {
    id: "dragon-tiger",
    category: "资金",
    name: "龙虎榜",
    desc: "上榜营业部明细，含机构席位识别。",
    fields: ["营业部", "买卖额", "净买入", "机构标记"],
    freq: "日",
    coverage: "2010-至今",
    provider: "Qveris",
    discoverQuery: "China stock block trade institutional broker seat 龙虎榜",
  },
  {
    id: "margin",
    category: "资金",
    name: "融资融券",
    desc: "两融余额、买卖明细、担保比例。",
    fields: ["融资余额", "融券余额", "买入额", "偿还额"],
    freq: "日",
    coverage: "2010-至今",
    provider: "Qveris",
    discoverQuery: "China stock margin trading short selling balance 融资融券",
  },
  {
    id: "fund-flow",
    category: "资金",
    name: "主力资金流",
    desc: "按单笔成交金额分类的主力/散户净流入。",
    fields: ["超大单", "大单", "中单", "小单"],
    freq: "日 / 分钟",
    coverage: "近 5 年",
    provider: "Qveris",
    discoverQuery: "China stock money flow large order 主力资金",
  },
  {
    id: "announcement",
    category: "事件",
    name: "公告与定期报告",
    desc: "结构化抽取后的公告事件流（业绩预告、重大合同、股东减持等）。",
    fields: ["公告类型", "发布时间", "结构化摘要", "情感标签"],
    freq: "实时",
    coverage: "2005-至今",
    provider: "Qveris",
    discoverQuery: "China listed company announcement filing earnings 公告",
  },
  {
    id: "news",
    category: "情绪",
    name: "新闻与研报",
    desc: "财经媒体、券商研报、社交舆情。AI 标注情感分。",
    fields: ["标题", "来源", "情感分", "实体识别"],
    freq: "实时",
    coverage: "近 5 年",
    provider: "Qveris",
    discoverQuery: "China financial news stock research report sentiment 财经新闻",
  },
  {
    id: "index",
    category: "行情",
    name: "指数与板块",
    desc: "宽基指数、行业指数、概念板块成分及其历史调整。",
    fields: ["成分股", "权重", "调整记录"],
    freq: "日",
    coverage: "2005-至今",
    provider: "Qveris",
    discoverQuery: "China A-share index sector constituent 指数 板块",
  },
  {
    id: "concept",
    category: "事件",
    name: "概念题材",
    desc: "热点题材追踪、个股概念归类、连板分析。",
    fields: ["题材标签", "首板时间", "连板高度"],
    freq: "实时",
    coverage: "近 3 年",
    provider: "Qveris",
    discoverQuery: "China stock concept theme hot topic limit-up 概念题材",
  },
  {
    id: "macro",
    category: "另类",
    name: "宏观数据",
    desc: "CPI / PPI / PMI / M2 / 社融等，国统局口径。",
    fields: ["指标", "公布值", "预期值", "前值"],
    freq: "月",
    coverage: "1990-至今",
    provider: "Qveris",
    discoverQuery: "China macro economy indicator CPI PPI PMI 宏观经济",
  },
]

export type Factor = {
  id: string
  category: "动量" | "反转" | "量价" | "资金" | "情绪" | "基本面" | "AI"
  name: string
  formula: string
  ic: number // 信息系数
  ir: number // 信息比率
  q1q5: number // 多空分位收益 %
  win: number // 胜率 %
  freq: "intraday" | "swing" | "position"
}

export const FACTORS: Factor[] = [
  { id: "f-rev-5d", category: "反转", name: "5 日反转", formula: "-1 × ret(5d)", ic: 0.042, ir: 0.68, q1q5: 6.2, win: 54, freq: "swing" },
  { id: "f-mom-60d", category: "动量", name: "60 日动量剔除短期", formula: "ret(60d) − ret(5d)", ic: 0.056, ir: 0.81, q1q5: 9.1, win: 57, freq: "position" },
  { id: "f-vol-spike", category: "量价", name: "放量突破", formula: "vol / MA(vol, 20) × (close > MA(close, 60))", ic: 0.071, ir: 0.94, q1q5: 11.4, win: 61, freq: "swing" },
  { id: "f-donchian-55", category: "量价", name: "Donchian 55 日突破", formula: "close / HHV(high, 55, prior) − 1", ic: 0.066, ir: 0.9, q1q5: 10.2, win: 58, freq: "position" },
  { id: "f-atr-compression", category: "量价", name: "ATR 收缩蓄势", formula: "1 − percentile(ATR14 / close, 120d)", ic: 0.049, ir: 0.73, q1q5: 6.6, win: 55, freq: "swing" },
  { id: "f-minervini-trend", category: "动量", name: "Minervini 趋势模板", formula: "close > MA50 > MA150 > MA200 + 52w 高位 + MA200 上行", ic: 0.061, ir: 0.88, q1q5: 9.8, win: 57, freq: "position" },
  { id: "f-canslim-proxy", category: "基本面", name: "CAN SLIM 技术代理", formula: "52w 相对强度 + 放量突破；EPS/机构字段待接入", ic: 0.047, ir: 0.69, q1q5: 6.4, win: 54, freq: "position" },
  { id: "f-absolute-momentum", category: "动量", name: "绝对动量风控", formula: "ret(120d) when close > MA120 else cash", ic: 0.058, ir: 0.82, q1q5: 8.7, win: 56, freq: "position" },
  { id: "f-low-vol-mom", category: "动量", name: "低波动动量", formula: "ret(120d) − volatility20 × 3", ic: 0.052, ir: 0.78, q1q5: 7.5, win: 55, freq: "position" },
  { id: "f-rsi2-reversal", category: "反转", name: "Connors RSI(2) 反转", formula: "100 − RSI(close, 2), only in MA120 uptrend", ic: 0.039, ir: 0.64, q1q5: 5.8, win: 54, freq: "swing" },
  { id: "f-bollinger-revert", category: "反转", name: "Bollinger 下轨回归", formula: "(lower_band20 − close) / std20, trend-filtered", ic: 0.043, ir: 0.66, q1q5: 6.1, win: 55, freq: "swing" },
  { id: "f-sma200-momentum", category: "动量", name: "SMA200 趋势动量", formula: "close > MA200 且 MA50 > MA150 时 ret120 + MA200 乖离", ic: 0.052, ir: 0.76, q1q5: 7.6, win: 55, freq: "position" },
  { id: "f-risk-adjusted-mom", category: "动量", name: "风险调整动量", formula: "ret60 / annualized_vol20", ic: 0.049, ir: 0.72, q1q5: 7.1, win: 55, freq: "position" },
  { id: "f-macd-trend", category: "量价", name: "MACD 趋势强度", formula: "(EMA12 − EMA26) / close + MA20/MA60 slope", ic: 0.045, ir: 0.69, q1q5: 6.4, win: 54, freq: "swing" },
  { id: "f-tight-breakout", category: "量价", name: "箱体放量突破", formula: "close 突破 20 日高点 + 放量 + ATR 低位", ic: 0.054, ir: 0.78, q1q5: 8.3, win: 56, freq: "swing" },
  { id: "f-pullback-uptrend", category: "反转", name: "SMA200 上升回调", formula: "close > MA200 且 MA50 > MA150 时 100 − RSI2", ic: 0.041, ir: 0.65, q1q5: 5.9, win: 54, freq: "swing" },
  { id: "f-vcp-breakout", category: "量价", name: "VCP 窄幅突破", formula: "波动收敛 + 成交量萎缩 + close 突破 50 日高点", ic: 0.061, ir: 0.86, q1q5: 9.7, win: 57, freq: "swing" },
  { id: "f-keltner-breakout", category: "量价", name: "Keltner ATR 突破", formula: "close > EMA20 + 1.5 × ATR20，叠加趋势与放量确认", ic: 0.057, ir: 0.82, q1q5: 8.9, win: 56, freq: "swing" },
  { id: "f-post-breakout-hold", category: "动量", name: "突破后持强", formula: "20 日突破后 3-8 日不跌回箱体且量能未失速", ic: 0.055, ir: 0.8, q1q5: 8.5, win: 56, freq: "swing" },
  { id: "f-rsrs-right-side", category: "量价", name: "RSRS 右侧趋势", formula: "18 日 high/low 回归斜率 × R² 的 110 日标准化", ic: 0.053, ir: 0.77, q1q5: 7.8, win: 55, freq: "position" },
  { id: "f-residual-mom-low-vol", category: "动量", name: "残差动量低波", formula: "ret120 − ret20 − 年化波动惩罚，剔除短期拥挤", ic: 0.059, ir: 0.84, q1q5: 8.8, win: 56, freq: "position" },
  { id: "f-mid-vol-reversal", category: "反转", name: "中波状态反转", formula: "-ret20 × mid_vol_bucket × positive_market_state", ic: 0.044, ir: 0.69, q1q5: 6.5, win: 54, freq: "swing" },
  { id: "f-value-low-vol", category: "基本面", name: "价值低波代理", formula: "价格分位低位 + 低波动 + 正绝对动量", ic: 0.048, ir: 0.72, q1q5: 6.9, win: 55, freq: "position" },
  { id: "f-north-net", category: "资金", name: "北向净流入分位", formula: "rank(北向净流入 / 流通市值, 20d)", ic: 0.063, ir: 0.85, q1q5: 8.7, win: 58, freq: "swing" },
  { id: "f-dragon-inst", category: "资金", name: "龙虎榜机构净买", formula: "Σ(机构席位净买入, 5d)", ic: 0.058, ir: 0.79, q1q5: 7.9, win: 56, freq: "swing" },
  { id: "f-pe-rev", category: "基本面", name: "PE 分位反转", formula: "1 − rank(PE_TTM, 行业内)", ic: 0.038, ir: 0.62, q1q5: 5.4, win: 53, freq: "position" },
  { id: "f-news-sent", category: "情绪", name: "新闻情感动量", formula: "EMA(情感分, 5d) − EMA(情感分, 20d)", ic: 0.045, ir: 0.71, q1q5: 6.8, win: 55, freq: "swing" },
  { id: "f-intra-vwap", category: "量价", name: "日内 VWAP 偏离", formula: "(close − vwap) / vwap", ic: 0.029, ir: 0.52, q1q5: 3.8, win: 52, freq: "intraday" },
  { id: "f-margin-spike", category: "资金", name: "融资余额加速", formula: "Δ²(融资余额, 5d)", ic: 0.041, ir: 0.67, q1q5: 5.9, win: 54, freq: "swing" },
  { id: "f-ai-breakout", category: "AI", name: "AI 突破识别 v2", formula: "深度学习识别盘整突破形态（专有模型）", ic: 0.082, ir: 1.08, q1q5: 13.2, win: 64, freq: "swing" },
  { id: "f-ai-flow", category: "AI", name: "AI 资金共振", formula: "多源资金流 + LSTM 时序融合", ic: 0.075, ir: 0.98, q1q5: 12.1, win: 62, freq: "position" },
  { id: "f-overnight", category: "量价", name: "隔夜跳空回补", formula: "(open − prev_close) × −sign(intraday_ret)", ic: 0.035, ir: 0.58, q1q5: 4.6, win: 53, freq: "intraday" },
]

export type Strategy = {
  id: string
  name: string
  author: string
  registrySource?: "catalog" | "miner" | "lab"
  desc: string
  factors: string[] // factor ids
  freq: "intraday" | "swing" | "position" | "hf"
  annualReturn: number // %
  maxDrawdown: number // %
  sharpe: number
  winRate: number // %
  backtestStatus: "真实回测" | "待真实回测"
  backtestSource: "Qveris" | "Qveris K线代理" | "示例指标"
  status: "公开" | "私有" | "审核中"
  subscribers: number
  admission?: StrategyAdmission
  rankScore?: number
  lastBacktestedAt?: string
}

export type StrategyAdmission = {
  status: "radar-ready" | "watchlist" | "blocked"
  gate: "雷达候选" | "观察池" | "禁止入雷达"
  score: number
  tags: string[]
  reason: string
}

export const STRATEGY_CATALOG_MIN_ANNUAL_RETURN = 10
export const STRATEGY_CATALOG_MIN_SCORE = 60
export const STRATEGY_CATALOG_MAX_DRAWDOWN = 35

export function getStrategyCatalogGateReason(strategy: Strategy): string | null {
  if (strategy.backtestStatus !== "真实回测") {
    return "尚未完成真实历史回测。"
  }
  if (strategy.backtestSource !== "Qveris") {
    return "当前仍使用 K 线代理或示例指标，不能作为正式目录策略。"
  }
  if (!Number.isFinite(strategy.annualReturn) || strategy.annualReturn < STRATEGY_CATALOG_MIN_ANNUAL_RETURN) {
    return `年化收益低于 ${STRATEGY_CATALOG_MIN_ANNUAL_RETURN}%。`
  }
  const drawdown = Math.abs(strategy.maxDrawdown)
  if (!Number.isFinite(drawdown) || drawdown <= 0) {
    return "最大回撤数据无效，需要重新回测。"
  }
  if (drawdown > STRATEGY_CATALOG_MAX_DRAWDOWN) {
    return `最大回撤高于 ${STRATEGY_CATALOG_MAX_DRAWDOWN}%。`
  }
  if (strategy.admission?.status === "blocked") {
    return strategy.admission.reason || "准入诊断未通过。"
  }
  const score = strategy.rankScore ?? strategy.admission?.score
  if (!Number.isFinite(score ?? Number.NaN)) {
    return "缺少真实回测准入分。"
  }
  if ((score ?? 0) < STRATEGY_CATALOG_MIN_SCORE) {
    return `准入分低于 ${STRATEGY_CATALOG_MIN_SCORE}。`
  }
  return null
}

export function isStrategyCatalogApproved(strategy: Strategy) {
  return getStrategyCatalogGateReason(strategy) === null
}

export const STRATEGIES: Strategy[] = []
