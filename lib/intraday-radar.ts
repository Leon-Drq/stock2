import type { BuyPoint, SignalKind, SignalLevel, StockSignal } from "@/lib/radar-data"
import type { Bar, StockBars } from "@/lib/qveris-data"
import type { LatestQuote, LatestQuotesResult } from "@/lib/qveris-quotes"
import { STOCK_POOL } from "@/lib/stock-pool"

export type IntradayBuildInput = {
  stocks: StockBars[]
  quotes?: LatestQuotesResult["quotes"]
  topN: number
}

export type IntradayBuildResult = {
  signals: StockSignal[]
  diagnostics: {
    scanned: number
    quoted: number
    triggered: number
    patterns: Record<string, number>
  }
}

type IntradayPatternId =
  | "second-wave-ready"
  | "high-turnover-base"
  | "vwap-support"
  | "breakout-platform"
  | "low-start"

type IntradayPattern = {
  id: IntradayPatternId
  label: string
  score: number
  buyPoint: BuyPoint
  kindHint: SignalKind
  reason: string
}

type IntradayContext = {
  stock: StockBars
  quote: LatestQuote
  historyBars: Bar[]
  currentBar: Bar
  latest: number
  preClose: number
  open: number
  high: number
  low: number
  dayPct: number
  openPct: number
  fromHighPct: number
  fromLowPct: number
  rangePct: number
  ma20: number
  ma60: number
  atr: number
  avgVolume20: number
  projectedVolumeRatio: number
  recentHigh20: number
  recentLow20: number
  trendScore: number
  sessionProgress: number
}

const INTRADAY_STRATEGY = {
  id: "s-intraday-radar-v1",
  name: "盘中雷达 v1",
  version: "0.1.0",
  status: "实验中",
  maxPositionPct: 8,
}

const MIN_SCORE = 61

export function buildIntradaySignalsFromMarket(input: IntradayBuildInput): IntradayBuildResult {
  const quotes = input.quotes
  if (!quotes?.size) {
    return { signals: [], diagnostics: { scanned: input.stocks.length, quoted: 0, triggered: 0, patterns: {} } }
  }

  const signals: StockSignal[] = []
  const patterns: Record<string, number> = {}

  for (const stock of input.stocks) {
    const quote = quotes.get(stock.symbol)
    if (!quote || stock.bars.length < 60) continue

    const ctx = buildContext(stock, quote)
    if (!ctx) continue

    const pattern = choosePattern(ctx)
    if (!pattern || pattern.score < MIN_SCORE) continue

    const signal = toSignal(ctx, pattern)
    signals.push(signal)
    patterns[pattern.label] = (patterns[pattern.label] ?? 0) + 1
  }

  signals.sort((a, b) => signalSortScore(b) - signalSortScore(a))
  const cap = Math.max(input.topN, input.topN * 2)
  return {
    signals: signals.slice(0, cap),
    diagnostics: {
      scanned: input.stocks.length,
      quoted: quotes.size,
      triggered: signals.length,
      patterns,
    },
  }
}

function buildContext(stock: StockBars, quote: LatestQuote): IntradayContext | null {
  const latest = quote.latest
  if (!Number.isFinite(latest) || latest <= 0) return null

  const historyBars = stock.bars.filter((bar) => compareDate(bar.date, quote.tradeDate) < 0)
  if (historyBars.length < 60) return null

  const prev = historyBars[historyBars.length - 1]
  const preClose = positive(quote.preClose) ?? prev.close
  const open = positive(quote.open) ?? preClose
  const high = Math.max(positive(quote.high) ?? latest, open, latest)
  const low = Math.min(positive(quote.low) ?? latest, open, latest)
  const sessionProgress = tradingSessionProgress(quote.tradeTime)
  const estimatedVolume = positive(quote.volume) ?? Math.round(prev.volume * sessionProgress)

  const currentBar: Bar = {
    date: quote.tradeDate,
    open: round2(open),
    high: round2(high),
    low: round2(low),
    close: round2(latest),
    volume: estimatedVolume,
    amount: quote.amount,
    preClose,
    changePct: quote.changePct,
  }
  const withCurrent = [...historyBars, currentBar]
  const ma20 = sma(withCurrent.slice(-20).map((bar) => bar.close))
  const ma60 = sma(withCurrent.slice(-60).map((bar) => bar.close))
  if (!ma20 || !ma60) return null

  const atr = atr14(withCurrent) ?? Math.max(latest * 0.025, latest - low)
  const avgVolume20 = sma(historyBars.slice(-20).map((bar) => bar.volume))
  const avgAmount20 = sma(historyBars.slice(-20).map((bar) => bar.amount ?? 0).filter((value) => value > 0))
  const amount = positive(quote.amount)
  const projectedAmountRatio = amount && avgAmount20 > 0
    ? amount / Math.max(sessionProgress, 0.08) / avgAmount20
    : null
  const projectedRawVolumeRatio = avgVolume20 > 0 ? estimatedVolume / Math.max(sessionProgress, 0.08) / avgVolume20 : 1
  const projectedVolumeRatio = projectedAmountRatio ?? projectedRawVolumeRatio
  const recentHigh20 = Math.max(...historyBars.slice(-20).map((bar) => bar.high))
  const recentLow20 = Math.min(...historyBars.slice(-20).map((bar) => bar.low))
  const dayPct = quote.changePct || (preClose > 0 ? (latest / preClose - 1) * 100 : 0)
  const openPct = open > 0 ? (latest / open - 1) * 100 : 0
  const fromHighPct = high > 0 ? (latest / high - 1) * 100 : 0
  const fromLowPct = low > 0 ? (latest / low - 1) * 100 : 0
  const rangePct = low > 0 ? (high / low - 1) * 100 : 0
  const trendScore = clamp01((latest / ma20 - 0.985) / 0.045) * 0.55 + clamp01((ma20 / ma60 - 0.99) / 0.04) * 0.45

  return {
    stock,
    quote,
    historyBars,
    currentBar,
    latest,
    preClose,
    open,
    high,
    low,
    dayPct,
    openPct,
    fromHighPct,
    fromLowPct,
    rangePct,
    ma20,
    ma60,
    atr,
    avgVolume20,
    projectedVolumeRatio,
    recentHigh20,
    recentLow20,
    trendScore,
    sessionProgress,
  }
}

function choosePattern(ctx: IntradayContext): IntradayPattern | null {
  const volumeScore = clamp01((ctx.projectedVolumeRatio - 0.85) / 1.4)
  const positiveDay = clamp01((ctx.dayPct + 0.2) / 3.2)
  const holdingHigh = clamp01((ctx.fromHighPct + 2.0) / 2.0)
  const lowLift = clamp01((ctx.fromLowPct - 0.5) / 3.5)
  const breakoutScore = ctx.recentHigh20 > 0 ? clamp01((ctx.latest / ctx.recentHigh20 - 0.985) / 0.035) : 0
  const supportScore = clamp01((ctx.latest / ctx.ma20 - 0.985) / 0.035) * clamp01((ctx.ma20 / ctx.ma60 - 0.99) / 0.04)
  const rangeScore = clamp01((ctx.rangePct - 1.0) / 2.8)

  const candidates: IntradayPattern[] = [
    {
      id: "second-wave-ready",
      label: "二波拉升预备",
      score: score100(
        positiveDay * 0.22 +
          holdingHigh * 0.22 +
          lowLift * 0.16 +
          volumeScore * 0.18 +
          ctx.trendScore * 0.22,
      ),
      buyPoint: "platform-break",
      kindHint: "add-confirm",
      reason: [
        `日内涨幅 ${signedPct(ctx.dayPct)}`,
        `距日内高点 ${signedPct(ctx.fromHighPct)}`,
        `从低点抬升 ${signedPct(ctx.fromLowPct)}`,
        `预估量比 ${formatRatio(ctx.projectedVolumeRatio)}`,
      ].join(" / "),
    },
    {
      id: "high-turnover-base",
      label: "高位换手蓄势",
      score: score100(
        positiveDay * 0.18 +
          clamp01((ctx.fromHighPct + 2.5) / 2.3) * 0.2 +
          rangeScore * 0.16 +
          volumeScore * 0.21 +
          ctx.trendScore * 0.25,
      ),
      buyPoint: "pullback",
      kindHint: "add-confirm",
      reason: [
        `高位回落 ${signedPct(ctx.fromHighPct)}`,
        `日内振幅 ${formatPct(ctx.rangePct)}`,
        `MA20 ${formatPrice(ctx.ma20)}`,
        `预估量比 ${formatRatio(ctx.projectedVolumeRatio)}`,
      ].join(" / "),
    },
    {
      id: "vwap-support",
      label: "回踩承接",
      score: score100(
        supportScore * 0.3 +
          clamp01((ctx.fromHighPct + 3.2) / 2.8) * 0.16 +
          clamp01((ctx.openPct + 0.6) / 2.4) * 0.16 +
          volumeScore * 0.14 +
          ctx.trendScore * 0.24,
      ),
      buyPoint: "ema-touch",
      kindHint: "left-side-trial",
      reason: [
        `当前距 MA20 ${signedPct((ctx.latest / ctx.ma20 - 1) * 100)}`,
        `MA20/MA60 ${formatRatio(ctx.ma20 / ctx.ma60)}`,
        `日内回撤 ${signedPct(ctx.fromHighPct)}`,
        `开盘后 ${signedPct(ctx.openPct)}`,
      ].join(" / "),
    },
    {
      id: "breakout-platform",
      label: "放量突破横盘",
      score: score100(
        breakoutScore * 0.32 +
          volumeScore * 0.24 +
          positiveDay * 0.16 +
          holdingHigh * 0.12 +
          ctx.trendScore * 0.16,
      ),
      buyPoint: "breakout-confirm",
      kindHint: "high-confidence-buy",
      reason: [
        `逼近 20 日高点 ${signedPct((ctx.latest / ctx.recentHigh20 - 1) * 100)}`,
        `预估量比 ${formatRatio(ctx.projectedVolumeRatio)}`,
        `日内涨幅 ${signedPct(ctx.dayPct)}`,
        `距高点 ${signedPct(ctx.fromHighPct)}`,
      ].join(" / "),
    },
    {
      id: "low-start",
      label: "低位启动",
      score: score100(
        lowLift * 0.26 +
          positiveDay * 0.22 +
          clamp01((ctx.openPct + 0.4) / 2.4) * 0.16 +
          volumeScore * 0.18 +
          clamp01((ctx.latest / ctx.recentLow20 - 1) / 0.12) * 0.18,
      ),
      buyPoint: "left-side",
      kindHint: "left-side-trial",
      reason: [
        `从日内低点反弹 ${signedPct(ctx.fromLowPct)}`,
        `日内涨幅 ${signedPct(ctx.dayPct)}`,
        `开盘后 ${signedPct(ctx.openPct)}`,
        `距 20 日低点 ${signedPct((ctx.latest / ctx.recentLow20 - 1) * 100)}`,
      ].join(" / "),
    },
  ]

  return candidates.sort((a, b) => b.score - a.score)[0] ?? null
}

function toSignal(ctx: IntradayContext, pattern: IntradayPattern): StockSignal {
  const poolInfo = STOCK_POOL.find((item) => item.symbol === ctx.stock.symbol)
  const exchange = poolInfo?.symbolQveris.endsWith(".SH") ? "SH" : poolInfo?.symbolQveris.endsWith(".BJ") ? "BJ" : "SZ"
  const stopByAtr = ctx.latest - Math.max(ctx.atr * 1.2, ctx.latest * 0.018)
  const structureStop = Math.min(ctx.low * 0.995, ctx.ma20 * 0.985)
  const tightStop = ctx.latest * 0.97
  const invalidationPrice = round2(Math.max(0.01, Math.min(ctx.latest * 0.998, Math.max(stopByAtr, structureStop, tightStop))))
  const riskPct = ctx.latest > 0 ? ((ctx.latest - invalidationPrice) / ctx.latest) * 100 : 0
  const upsidePct = estimateUpsidePct(ctx, pattern)
  const level = signalLevel(pattern.score, riskPct, ctx.projectedVolumeRatio)
  const kind = signalKind(level, pattern.kindHint)
  const amountText = formatAmount(ctx.quote.amount)

  return {
    ticker: ctx.stock.symbol,
    name: poolInfo?.name ?? ctx.stock.name ?? ctx.stock.symbol,
    exchange,
    signalLevel: level,
    signalKind: kind,
    price: round2(ctx.latest),
    changePct: round2(ctx.dayPct),
    date: ctx.quote.tradeDate,
    dedupeKey: `${INTRADAY_STRATEGY.id}:${ctx.stock.symbol}:${ctx.quote.tradeDate}`,
    recommendedAt: signalTimestamp(ctx.quote.tradeDate, ctx.quote.tradeTime),
    triggerPrice: round2(ctx.latest),
    returnSinceSignalPct: 0,
    quoteTime: ctx.quote.tradeTime,
    priceSource: "qveris-realtime",
    intradayPattern: pattern.label,
    evidence: [
      { label: "涨幅", value: signedPct(ctx.dayPct), tone: ctx.dayPct >= 0 ? "good" : "bad" },
      { label: "距高点", value: signedPct(ctx.fromHighPct), tone: ctx.fromHighPct > -1.5 ? "good" : "neutral" },
      { label: "低点抬升", value: signedPct(ctx.fromLowPct), tone: ctx.fromLowPct >= 1.5 ? "good" : "neutral" },
      { label: "预估量比", value: formatRatio(ctx.projectedVolumeRatio), tone: ctx.projectedVolumeRatio >= 1.2 ? "good" : "neutral" },
      { label: "MA20/60", value: formatRatio(ctx.ma20 / ctx.ma60), tone: ctx.ma20 >= ctx.ma60 ? "good" : "warn" },
      ...(amountText ? [{ label: "成交额", value: amountText, tone: "neutral" as const }] : []),
    ],
    invalidation: {
      price: invalidationPrice,
      reason: `跌破 ${formatPrice(invalidationPrice)} 或重新跌回 MA20 下方，盘中结构失效`,
    },
    buyPoint: pattern.buyPoint,
    reason: `盘中触发“${pattern.label}”：${pattern.reason}。先按信号触发价跟踪，不把盘口叙事当成结论。`,
    position: { current: null, max: INTRADAY_STRATEGY.maxPositionPct },
    suggestion: level === "green" ? "放量确认后小仓试买，回落立即降级" : level === "blue" ? "等待回踩不破后加仓确认" : "只做小仓验证，跌破失效价退出",
    stopLoss: { price: invalidationPrice, riskPct: round1(riskPct) },
    winRatePct: Math.round(Math.max(48, Math.min(69, 48 + (pattern.score - 55) * 0.42))),
    oddsRatio: round1(Math.max(1, upsidePct / Math.max(riskPct, 1))),
    upsidePct: round1(upsidePct),
    strategyId: INTRADAY_STRATEGY.id,
    strategyName: INTRADAY_STRATEGY.name,
    strategyVersion: INTRADAY_STRATEGY.version,
    strategyStatus: INTRADAY_STRATEGY.status,
  }
}

function signalLevel(score: number, riskPct: number, volumeRatio: number): SignalLevel {
  if (score >= 84 && riskPct <= 6.5 && volumeRatio >= 1.15) return "green"
  if (score >= 70) return "blue"
  if (score >= MIN_SCORE) return "yellow"
  return "compass"
}

function signalKind(level: SignalLevel, hint: SignalKind): SignalKind {
  if (level === "green") return "high-confidence-buy"
  if (level === "blue") return hint === "high-confidence-buy" ? "add-confirm" : hint
  if (level === "yellow") return "left-side-trial"
  return "watch"
}

function estimateUpsidePct(ctx: IntradayContext, pattern: IntradayPattern) {
  const atrPct = ctx.latest > 0 ? (ctx.atr / ctx.latest) * 100 : 2
  const highTargetPct = ctx.recentHigh20 > ctx.latest ? (ctx.recentHigh20 / ctx.latest - 1) * 100 : 0
  const base = pattern.id === "breakout-platform" || pattern.id === "second-wave-ready" ? 2.8 : 2.0
  return Math.max(2.2, Math.min(8.5, base + atrPct * 1.15 + Math.max(0, highTargetPct) * 0.35))
}

function signalSortScore(signal: StockSignal) {
  const levelBonus = signal.signalLevel === "green" ? 30 : signal.signalLevel === "blue" ? 18 : signal.signalLevel === "yellow" ? 9 : 0
  return levelBonus + signal.winRatePct + signal.oddsRatio * 3 + Math.max(0, signal.changePct) * 1.2
}

function atr14(bars: Bar[]) {
  if (bars.length < 15) return null
  const tail = bars.slice(-15)
  let sum = 0
  for (let i = 1; i < tail.length; i++) {
    const high = tail[i].high
    const low = tail[i].low
    const prevClose = tail[i - 1].close
    sum += Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
  }
  return sum / 14
}

function tradingSessionProgress(time: string) {
  const [h = "0", m = "0"] = time.split(":")
  const minutes = Number(h) * 60 + Number(m)
  const morningStart = 9 * 60 + 30
  const morningEnd = 11 * 60 + 30
  const afternoonStart = 13 * 60
  const afternoonEnd = 15 * 60
  let elapsed = 0
  if (minutes <= morningStart) elapsed = 8
  else if (minutes <= morningEnd) elapsed = minutes - morningStart
  else if (minutes <= afternoonStart) elapsed = morningEnd - morningStart
  else if (minutes <= afternoonEnd) elapsed = morningEnd - morningStart + minutes - afternoonStart
  else elapsed = morningEnd - morningStart + afternoonEnd - afternoonStart
  return Math.max(0.05, Math.min(1, elapsed / 240))
}

function signalTimestamp(tradeDate: string, tradeTime?: string) {
  const normalizedDate = tradeDate.replace(/\//g, "-").slice(0, 10)
  const normalizedTime = tradeTime?.slice(-8) || "09:30:00"
  return `${normalizedDate}T${normalizedTime}+08:00`
}

function compareDate(a: string, b: string) {
  return a.localeCompare(b)
}

function positive(value?: number) {
  return value != null && Number.isFinite(value) && value > 0 ? value : undefined
}

function sma(values: number[]) {
  const valid = values.filter((value) => Number.isFinite(value))
  if (!valid.length) return 0
  return valid.reduce((sum, value) => sum + value, 0) / valid.length
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function score100(value: number) {
  return Math.round(clamp01(value) * 100)
}

function round2(value: number) {
  return Math.round(value * 100) / 100
}

function round1(value: number) {
  return Math.round(value * 10) / 10
}

function signedPct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
}

function formatPct(value: number) {
  return `${value.toFixed(2)}%`
}

function formatPrice(value: number) {
  return value.toFixed(value >= 100 ? 2 : 3)
}

function formatRatio(value: number) {
  if (!Number.isFinite(value)) return "n/a"
  return value.toFixed(2)
}

function formatAmount(value?: number) {
  if (value == null || !Number.isFinite(value) || value <= 0) return null
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`
  if (value >= 10_000) return `${(value / 10_000).toFixed(0)}万`
  return value.toFixed(0)
}
