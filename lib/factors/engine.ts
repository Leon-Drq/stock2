/**
 * 因子计算引擎 — 纯函数，输入 K 线，输出每日因子值 + 统计指标。
 *
 * 设计原则：
 *  1. 因子值是横截面的：在 t 时刻对所有股票打分，而非时序信号。
 *  2. IC = spearman(因子值_t, 未来 N 日收益_t→t+N) over 股票池。
 *     这是衡量因子预测力的金标准。
 *  3. IR = mean(IC) / std(IC)。> 0.5 即可投资，> 1.0 卓越。
 *  4. Q1Q5 = top 20% 平均未来收益 − bottom 20% 平均未来收益（%）。
 *     直观反映多空价差。
 *  5. 胜率 = IC > 0 的交易日比例。
 *
 * 当前实现核心价格/量能因子，覆盖 swing / position 两个频率：
 *   - momentum_60_5: 60 日收益剔除 5 日反转噪声（趋势跟随）
 *   - reversal_5:    -5 日收益（短期反转）
 *   - vol_breakout:  20 日均量比 × 突破 60 日新高（量价共振）
 *   - tight_breakout: 20 日箱体突破 + 放量 + ATR 低位
 *   - atr_compression: ATR14/close 的 120 日低分位
 *   - absolute_momentum: close > MA120 且 ret120 > 0
 *   - bollinger_revert / vcp_breakout / mid_vol_reversal: 用于策略目录与雷达的高阶 K 线代理
 */

import type { Bar, StockBars } from "@/lib/qveris-data"

export type FactorId =
  | "f-mom-60d"
  | "f-rev-5d"
  | "f-vol-spike"
  | "f-donchian-55"
  | "f-tight-breakout"
  | "f-atr-compression"
  | "f-minervini-trend"
  | "f-absolute-momentum"
  | "f-low-vol-mom"
  | "f-rsi2-reversal"
  | "f-sma200-momentum"
  | "f-risk-adjusted-mom"
  | "f-macd-trend"
  | "f-pullback-uptrend"
  | "f-bollinger-revert"
  | "f-vcp-breakout"
  | "f-mid-vol-reversal"

export type FactorConfig = {
  id: FactorId
  name: string
  formula: string
  forwardDays: number  // 未来 N 日收益计算 IC
  /** 因子值越大越看多。如果原始公式是越小越好，要在 compute 时取负。 */
}

export const FACTOR_CONFIGS: Record<FactorId, FactorConfig> = {
  "f-mom-60d": {
    id: "f-mom-60d",
    name: "60 日动量剔除短期",
    formula: "ret(60d) − ret(5d)",
    forwardDays: 5,
  },
  "f-rev-5d": {
    id: "f-rev-5d",
    name: "5 日反转",
    formula: "−ret(5d)",
    forwardDays: 5,
  },
  "f-vol-spike": {
    id: "f-vol-spike",
    name: "放量突破",
    formula: "vol / MA(vol,20) × 1[close > MA(close,60)]",
    forwardDays: 5,
  },
  "f-donchian-55": {
    id: "f-donchian-55",
    name: "Donchian 55 日突破",
    formula: "close / HHV(high,55,prior) − 1 + volume impulse",
    forwardDays: 5,
  },
  "f-tight-breakout": {
    id: "f-tight-breakout",
    name: "箱体放量突破",
    formula: "close/HHV20 − 1 + volume impulse + low ATR",
    forwardDays: 5,
  },
  "f-atr-compression": {
    id: "f-atr-compression",
    name: "ATR 收缩蓄势",
    formula: "1 − percentile(ATR14 / close, 120d)",
    forwardDays: 5,
  },
  "f-minervini-trend": {
    id: "f-minervini-trend",
    name: "Minervini 趋势模板",
    formula: "close > MA50 > MA150 > MA200 + 52w 高位 + MA200 上行",
    forwardDays: 5,
  },
  "f-absolute-momentum": {
    id: "f-absolute-momentum",
    name: "绝对动量风控",
    formula: "ret120 when close > MA120 else penalty",
    forwardDays: 5,
  },
  "f-low-vol-mom": {
    id: "f-low-vol-mom",
    name: "低波动动量",
    formula: "ret120 − annualized_vol20 × 0.35",
    forwardDays: 5,
  },
  "f-rsi2-reversal": {
    id: "f-rsi2-reversal",
    name: "Connors RSI(2) 反转",
    formula: "100 − RSI2, gated by MA120 uptrend",
    forwardDays: 5,
  },
  "f-sma200-momentum": {
    id: "f-sma200-momentum",
    name: "SMA200 趋势动量",
    formula: "ret120 + MA200 distance when close > MA200 and MA50 > MA150",
    forwardDays: 5,
  },
  "f-risk-adjusted-mom": {
    id: "f-risk-adjusted-mom",
    name: "风险调整动量",
    formula: "ret60 / annualized_vol20",
    forwardDays: 5,
  },
  "f-macd-trend": {
    id: "f-macd-trend",
    name: "MACD 趋势强度",
    formula: "(EMA12 − EMA26) / close + MA20/MA60 slope",
    forwardDays: 5,
  },
  "f-pullback-uptrend": {
    id: "f-pullback-uptrend",
    name: "SMA200 上升回调",
    formula: "100 − RSI2 only inside long-term uptrend",
    forwardDays: 5,
  },
  "f-bollinger-revert": {
    id: "f-bollinger-revert",
    name: "Bollinger 下轨回归",
    formula: "(lower_band20 − close) / std20, gated by MA120",
    forwardDays: 5,
  },
  "f-vcp-breakout": {
    id: "f-vcp-breakout",
    name: "VCP 窄幅突破",
    formula: "50 日突破 + ATR 收缩 + 成交量萎缩后放量",
    forwardDays: 5,
  },
  "f-mid-vol-reversal": {
    id: "f-mid-vol-reversal",
    name: "中波状态反转",
    formula: "-ret20 × mid volatility bucket × trend gate",
    forwardDays: 5,
  },
}

// ─────────────────────────────────────────────────────────────
// 单股时序因子值计算
// ─────────────────────────────────────────────────────────────

function ret(bars: Bar[], i: number, n: number): number | null {
  if (i - n < 0) return null
  const p0 = bars[i - n].close
  const p1 = bars[i].close
  if (!p0) return null
  return p1 / p0 - 1
}

function sma(bars: Bar[], i: number, n: number, key: "close" | "volume"): number | null {
  if (i - n + 1 < 0) return null
  let sum = 0
  for (let j = i - n + 1; j <= i; j++) sum += bars[j][key]
  return sum / n
}

function ema(bars: Bar[], i: number, n: number): number | null {
  if (i - n + 1 < 0) return null
  const alpha = 2 / (n + 1)
  let value = bars[i - n + 1].close
  for (let j = i - n + 2; j <= i; j++) {
    value = bars[j].close * alpha + value * (1 - alpha)
  }
  return value
}

function highest(bars: Bar[], i: number, n: number, key: "high" | "close"): number | null {
  if (i - n < 0) return null
  let value = -Infinity
  for (let j = i - n; j < i; j++) value = Math.max(value, bars[j][key])
  return Number.isFinite(value) ? value : null
}

function lowest(bars: Bar[], i: number, n: number, key: "low" | "close"): number | null {
  if (i - n < 0) return null
  let value = Infinity
  for (let j = i - n; j < i; j++) value = Math.min(value, bars[j][key])
  return Number.isFinite(value) ? value : null
}

function atrRatio(bars: Bar[], i: number, n: number): number | null {
  if (i - n + 1 < 0 || bars[i].close <= 0) return null
  let sum = 0
  for (let j = i - n + 1; j <= i; j++) {
    const bar = bars[j]
    const prev = bars[j - 1]
    const prevClose = prev?.close ?? bar.open
    sum += Math.max(bar.high - bar.low, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose))
  }
  return sum / n / bars[i].close
}

function atrCompression(bars: Bar[], i: number): number | null {
  const current = atrRatio(bars, i, 14)
  if (current == null || i < 40) return null
  const ratios: number[] = []
  for (let j = Math.max(20, i - 120); j <= i; j++) {
    const value = atrRatio(bars, j, 14)
    if (value != null && Number.isFinite(value)) ratios.push(value)
  }
  if (ratios.length < 40) return null
  const ranked = [...ratios].sort((a, b) => a - b)
  const idx = ranked.findIndex((value) => value >= current)
  const percentile = (idx < 0 ? ranked.length - 1 : idx) / Math.max(1, ranked.length - 1)
  return 1 - percentile
}

function returnVolatility(bars: Bar[], i: number, n: number): number | null {
  if (i - n < 0) return null
  const returns: number[] = []
  for (let j = i - n + 1; j <= i; j++) {
    const prev = bars[j - 1]
    const now = bars[j]
    if (!prev || prev.close <= 0) continue
    returns.push(now.close / prev.close - 1)
  }
  if (returns.length < Math.max(5, Math.floor(n * 0.75))) return null
  return std(returns)
}

function closeStd(bars: Bar[], i: number, n: number): number | null {
  if (i - n + 1 < 0) return null
  const closes: number[] = []
  for (let j = i - n + 1; j <= i; j++) {
    const close = bars[j]?.close
    if (typeof close === "number" && close > 0) closes.push(close)
  }
  return closes.length === n ? std(closes) : null
}

function rsi(bars: Bar[], i: number, n: number): number | null {
  if (i - n < 0) return null
  let gains = 0
  let losses = 0
  for (let j = i - n + 1; j <= i; j++) {
    const change = bars[j].close - bars[j - 1].close
    if (change >= 0) gains += change
    else losses += Math.abs(change)
  }
  if (gains === 0 && losses === 0) return 50
  if (losses === 0) return 100
  const rs = gains / losses
  return 100 - 100 / (1 + rs)
}

function computeOneStockSeries(bars: Bar[], factorId: FactorId): Array<number | null> {
  return bars.map((_, i) => {
    switch (factorId) {
      case "f-mom-60d": {
        const r60 = ret(bars, i, 60)
        const r5 = ret(bars, i, 5)
        if (r60 == null || r5 == null) return null
        return r60 - r5
      }
      case "f-rev-5d": {
        const r5 = ret(bars, i, 5)
        if (r5 == null) return null
        return -r5
      }
      case "f-vol-spike": {
        const maVol = sma(bars, i, 20, "volume")
        const maClose = sma(bars, i, 60, "close")
        if (!maVol || !maClose) return null
        const volRatio = bars[i].volume / maVol
        const breakout = bars[i].close > maClose ? 1 : 0
        return volRatio * breakout
      }
      case "f-donchian-55": {
        const priorHigh55 = highest(bars, i, 55, "high")
        const maVol = sma(bars, i, 20, "volume")
        if (!priorHigh55 || !maVol || priorHigh55 <= 0) return null
        const breakout = bars[i].close / priorHigh55 - 1
        const volumeImpulse = Math.max(0, bars[i].volume / maVol - 1) * 0.04
        return breakout + volumeImpulse
      }
      case "f-tight-breakout": {
        const priorHigh20 = highest(bars, i, 20, "high")
        const ma60 = sma(bars, i, 60, "close")
        const maVol = sma(bars, i, 20, "volume")
        const atr = atrRatio(bars, i, 14)
        if (!priorHigh20 || !ma60 || !maVol || atr == null || priorHigh20 <= 0) return null
        const breakout = bars[i].close / priorHigh20 - 1
        const volumeImpulse = Math.max(0, bars[i].volume / maVol - 1) * 0.05
        const tightness = Math.max(0, 0.045 - atr)
        const trendGate = bars[i].close >= ma60 ? 1 : 0.35
        return (breakout + volumeImpulse + tightness) * trendGate
      }
      case "f-atr-compression": {
        return atrCompression(bars, i)
      }
      case "f-minervini-trend": {
        const ma50 = sma(bars, i, 50, "close")
        const ma150 = sma(bars, i, 150, "close")
        const ma200 = sma(bars, i, 200, "close")
        const ma200Prev = sma(bars, i - 20, 200, "close")
        const high252 = highest(bars, i + 1, 252, "high")
        const low252 = lowest(bars, i + 1, 252, "low")
        const r120 = ret(bars, i, 120)
        if (!ma50 || !ma150 || !ma200 || !ma200Prev || !high252 || !low252 || low252 <= 0 || r120 == null) return null
        const checks = [
          bars[i].close > ma50,
          ma50 > ma150,
          ma150 > ma200,
          ma200 > ma200Prev,
          bars[i].close >= high252 * 0.75,
          bars[i].close >= low252 * 1.3,
          r120 > 0,
        ]
        return checks.filter(Boolean).length / checks.length + Math.max(0, r120) * 0.35
      }
      case "f-absolute-momentum": {
        const r120 = ret(bars, i, 120)
        const ma120 = sma(bars, i, 120, "close")
        if (r120 == null || !ma120) return null
        return bars[i].close >= ma120 && r120 > 0 ? r120 : r120 - 0.35
      }
      case "f-low-vol-mom": {
        const r120 = ret(bars, i, 120)
        const vol20 = returnVolatility(bars, i, 20)
        if (r120 == null || vol20 == null) return null
        return r120 - vol20 * Math.sqrt(252) * 0.35
      }
      case "f-rsi2-reversal": {
        const value = rsi(bars, i, 2)
        const ma120 = sma(bars, i, 120, "close")
        if (value == null || !ma120) return null
        const trendGate = bars[i].close >= ma120 ? 1 : 0.35
        return (100 - value) * trendGate
      }
      case "f-sma200-momentum": {
        const r120 = ret(bars, i, 120)
        const ma50 = sma(bars, i, 50, "close")
        const ma150 = sma(bars, i, 150, "close")
        const ma200 = sma(bars, i, 200, "close")
        if (r120 == null || !ma50 || !ma150 || !ma200 || ma200 <= 0) return null
        const trendOk = bars[i].close > ma200 && ma50 > ma150
        const distance = bars[i].close / ma200 - 1
        return trendOk ? r120 + Math.max(0, distance) * 0.25 : r120 - 0.45
      }
      case "f-risk-adjusted-mom": {
        const r60 = ret(bars, i, 60)
        const vol20 = returnVolatility(bars, i, 20)
        if (r60 == null || vol20 == null || vol20 <= 0) return null
        return r60 / (vol20 * Math.sqrt(252))
      }
      case "f-macd-trend": {
        const ema12 = ema(bars, i, 12)
        const ema26 = ema(bars, i, 26)
        const ma20 = sma(bars, i, 20, "close")
        const ma60 = sma(bars, i, 60, "close")
        if (!ema12 || !ema26 || !ma20 || !ma60 || bars[i].close <= 0 || ma60 <= 0) return null
        return (ema12 - ema26) / bars[i].close + (ma20 / ma60 - 1) * 0.6
      }
      case "f-pullback-uptrend": {
        const value = rsi(bars, i, 2)
        const ma50 = sma(bars, i, 50, "close")
        const ma150 = sma(bars, i, 150, "close")
        const ma200 = sma(bars, i, 200, "close")
        if (value == null || !ma50 || !ma150 || !ma200) return null
        const trendOk = bars[i].close > ma200 && ma50 > ma150
        return trendOk ? 100 - value : (100 - value) * 0.2
      }
      case "f-bollinger-revert": {
        const ma20 = sma(bars, i, 20, "close")
        const ma120 = sma(bars, i, 120, "close")
        const vol20 = closeStd(bars, i, 20)
        if (!ma20 || !ma120 || !vol20 || vol20 <= 0) return null
        const lower = ma20 - vol20 * 2
        const trendGate = bars[i].close >= ma120 ? 1 : 0.45
        return ((lower - bars[i].close) / vol20) * trendGate
      }
      case "f-vcp-breakout": {
        const priorHigh50 = highest(bars, i, 50, "high")
        const ma60 = sma(bars, i, 60, "close")
        const atrNow = atrRatio(bars, i, 14)
        const atrBefore = atrRatio(bars, i - 20, 14)
        const recentVolume = sma(bars, i - 1, 5, "volume")
        const baseVolume = sma(bars, i - 6, 30, "volume")
        const maVol20 = sma(bars, i, 20, "volume")
        if (!priorHigh50 || !ma60 || atrNow == null || atrBefore == null || !recentVolume || !baseVolume || !maVol20) return null
        const breakout = priorHigh50 > 0 ? bars[i].close / priorHigh50 - 1 : null
        if (breakout == null) return null
        const contraction = Math.max(0, atrBefore - atrNow)
        const dryUp = Math.max(0, 1 - recentVolume / baseVolume)
        const volumeImpulse = Math.max(0, bars[i].volume / maVol20 - 1)
        const trendGate = bars[i].close >= ma60 ? 1 : 0.25
        return (breakout + contraction * 1.35 + dryUp * 0.08 + volumeImpulse * 0.04) * trendGate
      }
      case "f-mid-vol-reversal": {
        const ma120 = sma(bars, i, 120, "close")
        const r20 = ret(bars, i, 20)
        const r5 = ret(bars, i, 5)
        const vol20 = returnVolatility(bars, i, 20)
        if (!ma120 || r20 == null || r5 == null || vol20 == null) return null
        const annualVol = vol20 * Math.sqrt(252)
        const midVolScore = Math.max(0, 1 - Math.abs(annualVol - 0.32) / 0.32)
        const trendGate = bars[i].close >= ma120 ? 1 : 0.2
        return (-r20 * 0.8 - r5 * 0.2) * midVolScore * trendGate
      }
    }
  })
}

// ─────────────────────────────────────────────────────────────
// 横截面统计：IC / IR / Q1Q5 / 胜率
// ─────────────────────────────────────────────────────────────

function spearmanRankCorr(xs: number[], ys: number[]): number | null {
  if (xs.length < 4 || xs.length !== ys.length) return null
  const rx = rank(xs)
  const ry = rank(ys)
  const n = rx.length
  const mean = (n + 1) / 2
  let num = 0
  let dx2 = 0
  let dy2 = 0
  for (let i = 0; i < n; i++) {
    const a = rx[i] - mean
    const b = ry[i] - mean
    num += a * b
    dx2 += a * a
    dy2 += b * b
  }
  const denom = Math.sqrt(dx2 * dy2)
  if (denom === 0) return null
  return num / denom
}

function rank(arr: number[]): number[] {
  // average rank（处理并列）
  const idx = arr.map((v, i) => [v, i] as const)
  idx.sort((a, b) => a[0] - b[0])
  const ranks = new Array(arr.length).fill(0)
  let i = 0
  while (i < idx.length) {
    let j = i
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++
    const avgRank = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) ranks[idx[k][1]] = avgRank
    i = j + 1
  }
  return ranks
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(v)
}

// ─────────────────────────────────────────────────────────────
// 主入口
// ─────────────────────────────────────────────────────────────

export type StockFactorSnapshot = {
  symbol: string
  name: string
  industry: string
  source: "qveris" | "database" | "mock"
  /** 最新一期因子值（已剔除 NaN） */
  latestFactor: number
  /** 最新一期因子分位（0=最低, 1=最高） */
  latestPercentile: number
  /** 过去 forwardDays 收益（用于验证因子对该股是否有效） */
  recentReturnPct: number
  latestClose: number
  latestDate: string
}

export type DailyIC = {
  date: string
  ic: number
  /** 用了多少只股做横截面（n） */
  n: number
}

export type FactorResult = {
  factor: FactorConfig
  // 统计
  meanIC: number
  irAnnualized: number  // IR × sqrt(252)
  q1q5Pct: number       // %
  winRatePct: number    // IC > 0 的天数比例
  // 时序
  dailyIC: DailyIC[]
  cumulativeIC: Array<{ date: string; value: number }>
  // 横截面快照
  snapshots: StockFactorSnapshot[]
  // 元信息
  symbolCount: number
  observationDays: number
}

export function runFactor(stocks: StockBars[], factorId: FactorId): FactorResult {
  const cfg = FACTOR_CONFIGS[factorId]

  // 每只股独立计算时序，再按日期做横截面聚合。
  // 不能取“所有股票共同日期交集”：扩池后会遇到停牌、上市较晚、历史源缺口，
  // 只要一只股票日期不完整，严格交集就可能被清空。
  const seriesByStock = stocks.map((s) => {
    const bars = [...s.bars].sort((a, b) => a.date.localeCompare(b.date))
    return {
    symbol: s.symbol,
    name: s.name,
    industry: s.industry,
    source: s.source,
      bars,
      dateIndex: new Map(bars.map((bar, index) => [bar.date, index] as const)),
      series: computeOneStockSeries(bars, factorId),
    }
  })
  const allDates = Array.from(new Set(
    seriesByStock.flatMap((stock) => stock.bars.slice(0, -cfg.forwardDays).map((bar) => bar.date)),
  )).sort()

  // 每日 IC
  const dailyIC: DailyIC[] = []
  for (const date of allDates) {
    const xs: number[] = []
    const ys: number[] = []
    for (const stock of seriesByStock) {
      const t = stock.dateIndex.get(date)
      if (t == null) continue
      const f = stock.series[t]
      const p0 = stock.bars[t]?.close
      const p1 = stock.bars[t + cfg.forwardDays]?.close
      if (f == null || !p0 || !p1) continue
      xs.push(f)
      ys.push(p1 / p0 - 1)
    }
    const corr = spearmanRankCorr(xs, ys)
    if (corr != null) {
      dailyIC.push({ date, ic: corr, n: xs.length })
    }
  }

  // 统计
  const icValues = dailyIC.map((d) => d.ic)
  const meanIC = icValues.length ? mean(icValues) : 0
  const stdIC = std(icValues)
  // 信息比率：mean / std（不做 sqrt(252) 年化，因为短样本年化噪声过大）
  // 标准量化金融惯例：IR > 0.5 可投资，> 1 优秀
  const irAnnualized = stdIC > 0 ? meanIC / stdIC : 0
  const winRatePct = icValues.length
    ? (icValues.filter((v) => v > 0).length / icValues.length) * 100
    : 0

  // 累积 IC
  const cumulativeIC: Array<{ date: string; value: number }> = []
  let acc = 0
  for (const d of dailyIC) {
    acc += d.ic
    cumulativeIC.push({ date: d.date, value: acc })
  }

  // Q1Q5 分位收益 — 用所有日的平均
  let q1q5Pct = 0
  if (dailyIC.length > 0) {
    let topSum = 0
    let bottomSum = 0
    let cnt = 0
    for (const date of allDates) {
      const pairs: Array<{ f: number; r: number }> = []
      for (const stock of seriesByStock) {
        const t = stock.dateIndex.get(date)
        if (t == null) continue
        const f = stock.series[t]
        const p0 = stock.bars[t]?.close
        const p1 = stock.bars[t + cfg.forwardDays]?.close
        if (f == null || !p0 || !p1) continue
        pairs.push({ f, r: p1 / p0 - 1 })
      }
      if (pairs.length < 5) continue
      pairs.sort((a, b) => b.f - a.f)
      const k = Math.max(1, Math.floor(pairs.length * 0.2))
      const top = pairs.slice(0, k).reduce((a, b) => a + b.r, 0) / k
      const bot = pairs.slice(-k).reduce((a, b) => a + b.r, 0) / k
      topSum += top
      bottomSum += bot
      cnt++
    }
    if (cnt > 0) {
      // 年化（5 日重叠近似）
      q1q5Pct = ((topSum - bottomSum) / cnt) * (252 / cfg.forwardDays) * 100
    }
  }

  // 最新一期快照
  const snapshotsRaw = seriesByStock
    .map((s) => {
      let lastIdx = s.series.length - 1
      while (lastIdx >= 0 && s.series[lastIdx] == null) lastIdx--
      const f = s.series[lastIdx]
      const lastBar = s.bars[lastIdx]
      const baseBar = s.bars[lastIdx - cfg.forwardDays]
      if (f == null || !lastBar || !baseBar) return null
      return {
        symbol: s.symbol,
        name: s.name,
        industry: s.industry,
        source: s.source,
        latestFactor: f,
        recentReturnPct: (lastBar.close / baseBar.close - 1) * 100,
        latestClose: lastBar.close,
        latestDate: lastBar.date,
      }
    })
    .filter(Boolean) as Array<Omit<StockFactorSnapshot, "latestPercentile">>

  // 算分位
  const sortedFactors = [...snapshotsRaw].sort((a, b) => a.latestFactor - b.latestFactor)
  const snapshots: StockFactorSnapshot[] = snapshotsRaw
    .map((s) => ({
      ...s,
      latestPercentile:
        sortedFactors.findIndex((x) => x.symbol === s.symbol) / Math.max(1, sortedFactors.length - 1),
    }))
    .sort((a, b) => b.latestFactor - a.latestFactor)

  return {
    factor: cfg,
    meanIC,
    irAnnualized,
    q1q5Pct,
    winRatePct,
    dailyIC,
    cumulativeIC,
    snapshots,
    symbolCount: stocks.length,
    observationDays: dailyIC.length,
  }
}
