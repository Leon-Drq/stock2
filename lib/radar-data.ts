/**
 * Radar report data model.
 *
 * 这是"股票雷达"报告的领域模型。MVP 阶段使用本地结构化数据，
 * 后续接入 Qveris 后，由 server action 调用 discover + call 后映射到该结构。
 */

export type SignalLevel = "green" | "yellow" | "blue" | "compass" | "purple" | "orange" | "red"

export type SignalKind =
  | "high-confidence-buy" // 高确定性买入
  | "add-confirm" // 加仓确认
  | "left-side-trial" // 左侧试仓
  | "hold-no-add" // 持有不加
  | "watch" // 观察
  | "exit" // 离场

export type BuyPoint = "breakout-confirm" | "left-side" | "pullback" | "ema-touch" | "platform-break"

/**
 * 信号发出后某个时间窗口的实际表现。
 * 接入 Qveris 后由 server action 调用历史行情工具计算：
 *   alphaPct = stockReturnPct − benchReturnPct
 * 未到期的窗口字段全为 null。
 */
export type AttributionPoint = {
  horizon: "T+1" | "T+3" | "T+5"
  /** 区间末日（已成交日） */
  asOf: string | null
  /** 区间末价 */
  closePrice: number | null
  /** 个股区间收益 % */
  stockReturnPct: number | null
  /** 基准同期收益 % */
  benchReturnPct: number | null
  /** 超额 = stockReturn − benchReturn */
  alphaPct: number | null
  /** 是否命中（alpha > 0 且 stockReturn > 0） */
  hit: boolean | null
}

export type StockSignal = {
  ticker: string // e.g. "002518"
  name: string // 中文名
  exchange?: "SH" | "SZ" | "BJ"
  signalLevel: SignalLevel
  signalKind: SignalKind
  price: number
  changePct: number // 较昨收 %
  date: string // YYYY-MM-DD
  signalId?: string // strategy:ticker:kind:buyPoint，用于去重/续期
  dedupeKey?: string // 更粗粒度去重键；盘中信号按 strategy:ticker:tradeDate 去重
  signalLifecycle?: "candidate" | "new" | "tracking" | "closed" // 候选、首次触发、跟踪更新或已关闭
  lifecycleStage?: "candidate" | "triggered" | "tracking" | "target-hit" | "stopped" | "expired" | "invalidated"
  lifecycleStatus?: "open" | "stopped" | "target-hit" | "expired"
  lifecycleNote?: string
  firstTriggeredAt?: string
  lastSeenAt?: string
  latestQuoteAt?: string
  priceStatus?: "tracked" | "pending-follow-up"
  closedAt?: string
  recommendedAt?: string // ISO，雷达推荐/触发时间
  triggerPrice?: number // 推荐触发价
  returnSinceSignalPct?: number // 当前价相对触发价涨跌幅 %
  mfePct?: number // Maximum Favorable Excursion，信号后最高浮盈 %
  maePct?: number // Maximum Adverse Excursion，信号后最大不利波动 %
  closeReason?: string
  quoteTime?: string // HH:mm:ss，来自近实时行情快照
  priceSource?: "qveris-realtime" | "qveris-daily" | "mock"
  intradayPattern?: string // 盘中结构，例如二波拉升预备 / 高位换手蓄势
  evidence?: Array<{
    label: string
    value: string
    tone?: "good" | "warn" | "bad" | "neutral"
  }>
  invalidation?: {
    price: number
    reason: string
  }
  buyPoint: BuyPoint
  reason: string // 一句话理由
  position: { current: number | null; max: number } // 当前仓位 %, 上限 %
  suggestion: string // 建议
  stopLoss: { price: number; riskPct: number }
  winRatePct: number
  oddsRatio: number // 赔率 e.g. 3.1 → 3.1:1
  upsidePct: number
  /** 信号回测对账（T+1 / T+3 / T+5）。未提供则不渲染对账条带。 */
  attribution?: AttributionPoint[]
  /** 产生该信号的策略配置，用于从雷达回溯到策略与回测。 */
  strategyId?: string
  strategyName?: string
  strategyVersion?: string
  strategyStatus?: string
  strategyBacktest?: {
    annualReturn: number
    maxDrawdown: number
    sharpe: number
    winRate: number
  }
}

/**
 * 过去 N 天信号成绩单。聚合自所有已到期的归档 RadarReport。
 */
export type TrackRecord = {
  /** 统计窗口（自然日） */
  windowDays: number
  /** 窗口内已结算信号总数 */
  totalSignals: number
  /** 命中率 0–1（按 T+5 计；T+5 未到的不计入） */
  hitRate: number
  /** 平均 T+1 超额（%），跨所有信号 */
  avgAlphaT1: number | null
  /** 平均 T+5 超额（%），跨所有信号 */
  avgAlphaT5: number | null
  /** 基准名称，用于 UI 标注 vs */
  benchmarkName: string
  /** 该窗口内基准同期总收益（%） */
  benchmarkReturnPct: number
  /** 最近一份已结算报告中表现最好的一只票（用于 hero 引用） */
  topAlpha?: { name: string; ticker: string; alphaPct: number; horizon: "T+1" | "T+5" }
}

export type RadarReport = {
  reportType: string // "股票雷达 | A股"
  generatedAt: string // ISO
  conclusion: string // 一句话结论
  overview: {
    signals: Record<SignalLevel, number>
    cleanups: number // 清扫数
    qualityScore: number // 0-100
    qualityNote: string // 低/中/高
    actionSignalCount: number
    freshnessIssues: number
    runtimeErrors: number
    pools: { name: string; count: number; cap?: number; note?: string }[]
  }
  /** 过去 30 天成绩单。可选——首次部署、没有足够历史时省略。 */
  trackRecord?: TrackRecord
  suggestions: StockSignal[]
}

/**
 * Fallback report — 结构与图3/图4 一致，先用本地数据保证 UI 完整。
 * 等确认 Qveris 数据形态后，将其换为 server-side 调用映射结果。
 */
export const fallbackReport: RadarReport = {
  reportType: "股票雷达 | A 股",
  generatedAt: "2026-05-13T09:51:00+08:00",
  conclusion:
    "今日 A 股出现 3 条动作级信号；优先关注科士达 002518 突破买点、思特奇 300608 左侧试仓、中国电建 601669 加仓确认。",
  overview: {
    signals: {
      green: 1,
      yellow: 1,
      blue: 1,
      compass: 1,
      purple: 0,
      orange: 0,
      red: 0,
    },
    cleanups: 8,
    qualityScore: 54,
    qualityNote: "低",
    actionSignalCount: 12,
    freshnessIssues: 2,
    runtimeErrors: 11,
    pools: [
      { name: "主雷达", count: 198, cap: 120, note: "已超硬上限 120，需迁入知识库" },
    ],
  },
  /**
   * 30 天成绩单。MVP 用 fallback；上线后由 server action 扫描归档目录、
   * 用 Qveris 历史行情工具补齐每条 signal 的 T+1/T+5 价格、聚合 alpha。
   */
  trackRecord: {
    windowDays: 30,
    totalSignals: 56,
    hitRate: 0.64,
    avgAlphaT1: 1.8,
    avgAlphaT5: 3.2,
    benchmarkName: "沪深 300",
    benchmarkReturnPct: -0.7,
    topAlpha: { name: "科士达", ticker: "002518", alphaPct: 8.28, horizon: "T+1" },
  },
  suggestions: [
    {
      ticker: "002518",
      name: "科士达",
      exchange: "SZ",
      signalLevel: "green",
      signalKind: "high-confidence-buy",
      price: 50.43,
      changePct: 3.0,
      date: "2026-05-13",
      recommendedAt: "2026-05-13T09:51:00+08:00",
      triggerPrice: 50.43,
      returnSinceSignalPct: 8.23,
      buyPoint: "breakout-confirm",
      reason: "突破或贴近枢轴，趋势和量能出现确认，风险距离较小。",
      position: { current: 0, max: 10 },
      suggestion: "确认后加到 30%–50% 目标仓位",
      stopLoss: { price: 47.327, riskPct: 6.2 },
      winRatePct: 72,
      oddsRatio: 3.1,
      upsidePct: 19.4,
      // 对账：5/13 09:51 发信号 → 5/14 真实涨幅 +8.23%（来自截图 2，大盘 -0.05%）
      attribution: [
        {
          horizon: "T+1",
          asOf: "2026-05-14",
          closePrice: 54.58,
          stockReturnPct: 8.23,
          benchReturnPct: -0.05,
          alphaPct: 8.28,
          hit: true,
        },
        { horizon: "T+3", asOf: null, closePrice: null, stockReturnPct: null, benchReturnPct: null, alphaPct: null, hit: null },
        { horizon: "T+5", asOf: null, closePrice: null, stockReturnPct: null, benchReturnPct: null, alphaPct: null, hit: null },
      ],
    },
    {
      ticker: "300608",
      name: "思特奇",
      exchange: "SZ",
      signalLevel: "yellow",
      signalKind: "left-side-trial",
      price: 18.62,
      changePct: -1.2,
      date: "2026-05-13",
      recommendedAt: "2026-05-13T09:51:00+08:00",
      triggerPrice: 18.62,
      returnSinceSignalPct: -0.43,
      buyPoint: "left-side",
      reason: "回踩 EMA/BOLL 中轨/平台附近，风险距离可控。",
      position: { current: 2.5, max: 10 },
      suggestion: "左侧试仓 2%–4%，破止损出局",
      stopLoss: { price: 17.45, riskPct: 6.3 },
      winRatePct: 58,
      oddsRatio: 1.4,
      upsidePct: 11.2,
      attribution: [
        {
          horizon: "T+1",
          asOf: "2026-05-14",
          closePrice: 18.54,
          stockReturnPct: -0.43,
          benchReturnPct: -0.05,
          alphaPct: -0.38,
          hit: false,
        },
        { horizon: "T+3", asOf: null, closePrice: null, stockReturnPct: null, benchReturnPct: null, alphaPct: null, hit: null },
        { horizon: "T+5", asOf: null, closePrice: null, stockReturnPct: null, benchReturnPct: null, alphaPct: null, hit: null },
      ],
    },
    {
      ticker: "601669",
      name: "中国电建",
      exchange: "SH",
      signalLevel: "blue",
      signalKind: "add-confirm",
      price: 5.94,
      changePct: 0.8,
      date: "2026-05-13",
      recommendedAt: "2026-05-13T09:51:00+08:00",
      triggerPrice: 5.94,
      returnSinceSignalPct: 1.68,
      buyPoint: "ema-touch",
      reason: "回踩 EMA/BOLL 中轨/平台，风险距离可控，加仓确认。",
      position: { current: 1.9, max: 10 },
      suggestion: "确认后加至 5%–7% 仓位",
      stopLoss: { price: 5.65, riskPct: 4.9 },
      winRatePct: 59,
      oddsRatio: 6.5,
      upsidePct: 32.5,
      attribution: [
        {
          horizon: "T+1",
          asOf: "2026-05-14",
          closePrice: 6.04,
          stockReturnPct: 1.68,
          benchReturnPct: -0.05,
          alphaPct: 1.73,
          hit: true,
        },
        { horizon: "T+3", asOf: null, closePrice: null, stockReturnPct: null, benchReturnPct: null, alphaPct: null, hit: null },
        { horizon: "T+5", asOf: null, closePrice: null, stockReturnPct: null, benchReturnPct: null, alphaPct: null, hit: null },
      ],
    },
  ],
}

export const signalKindLabel: Record<SignalKind, string> = {
  "high-confidence-buy": "高确定性买入",
  "add-confirm": "加仓确认",
  "left-side-trial": "左侧试仓",
  "hold-no-add": "持有不加",
  watch: "观察",
  exit: "离场",
}

export const buyPointLabel: Record<BuyPoint, string> = {
  "breakout-confirm": "突破确认（B 轨）",
  "left-side": "左侧试仓",
  pullback: "回踩买入",
  "ema-touch": "EMA 触碰",
  "platform-break": "平台突破",
}

export const signalLevelLabel: Record<SignalLevel, string> = {
  green: "高确定性",
  yellow: "次确定",
  blue: "加仓确认",
  compass: "择时",
  purple: "观察",
  orange: "警示",
  red: "止损",
}

export const signalLevelColor: Record<SignalLevel, string> = {
  green: "var(--signal-green)",
  yellow: "var(--signal-yellow)",
  blue: "var(--signal-blue)",
  compass: "var(--neutral)",
  purple: "var(--signal-purple)",
  orange: "var(--signal-orange)",
  red: "var(--signal-red)",
}
