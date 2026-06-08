import { computeTechSnapshot } from "@/lib/technicals"
import { getChinaMarketSession } from "@/lib/cn-market-session"
import { formatChinaDateTime } from "@/lib/format"
import { extractModelError, resolveModelConfig, type ModelRequestConfig } from "@/lib/model-providers"
import { loadStockNonPriceContext, type StockNonPriceContext } from "@/lib/non-price-data-store"
import { listPaperPositionsForSymbol, listRecentPaperOrders, type PaperPositionRecord, type RecentPaperOrderRecord } from "@/lib/paper-trading-store"
import { callQverisDefaultModel } from "@/lib/qveris-model"
import { fetchPoolBars, type Bar, type StockBars } from "@/lib/qveris-data"
import { fetchLatestQuotes, type LatestQuote } from "@/lib/qveris-quotes"
import { radarExitActionLabel, radarExitReturnPct, radarLifecycleStatus, type RadarHistoryRecord } from "@/lib/radar-history"
import { loadRadarSignalHistoryRecordsForDateRange } from "@/lib/radar-signal-store"
import { STOCK_POOL, type StockPoolItem } from "@/lib/stock-pool"

export type StockDiagnosisAction =
  | "hold"
  | "watch"
  | "warning"
  | "stop"
  | "take-profit"
  | "not-covered"

export type StockDiagnosisTone = "good" | "warn" | "bad" | "neutral"

export type StockDiagnosisMetric = {
  label: string
  value: string
  detail?: string
  tone?: StockDiagnosisTone
}

export type StockDiagnosisTradePlan = {
  stance: "buy-zone" | "hold" | "wait" | "reduce" | "stop" | "take-profit"
  label: string
  summary: string
  entryPlan: string
  stopLossPlan: string
  takeProfitPlan: string
  exitPlan: string
  holdingPeriod: string
  positionPlan: string
  invalidation: string
  watchPoints: string[]
  dataBasis: string[]
}

export type StockDiagnosisResult = {
  ok: true
  generatedAt: string
  query: string
  stock: {
    symbol: string
    symbolQveris: string
    name: string
    industry: string
    covered: boolean
  }
  quote: {
    latest: number
    changePct: number
    tradeDate: string
    tradeTime: string
    timestamp: string
    source: "qveris-realtime" | "database-daily" | "unavailable"
    fallbackReason?: string
  }
  bars: {
    count: number
    latestDate?: string
    source?: StockBars["source"]
    error?: string
  }
  indicators: {
    ma20?: number
    ma60?: number
    rsi14?: number
    volumeRatio20?: number
    atr14Pct?: number
    trend: "up" | "down" | "mixed" | "unknown"
  }
  radar: {
    open: RadarHistoryRecord[]
    recent: RadarHistoryRecord[]
    latestOpen?: RadarHistoryRecord
    latestClosed?: RadarHistoryRecord
    strategyNames: string[]
  }
  paper: {
    positions: PaperPositionRecord[]
    orders: RecentPaperOrderRecord[]
    strategyNames: string[]
  }
  marketContext: StockNonPriceContext
  rule: {
    action: StockDiagnosisAction
    label: string
    tone: StockDiagnosisTone
    summary: string
    nextStep: string
    riskLine?: number
    targetLine?: number
    triggerPrice?: number
    returnSinceSignalPct?: number
    distanceToStopPct?: number
    distanceToTargetPct?: number
  }
  tradePlan: StockDiagnosisTradePlan
  metrics: StockDiagnosisMetric[]
  ai?: {
    source: "ai" | "rule-fallback"
    provider?: string
    model?: string
    content: string
    warning?: string
  }
  warnings: string[]
}

export type StockDiagnosisFailure = {
  ok: false
  error: string
}

export type StockDiagnosisResponse = StockDiagnosisResult | StockDiagnosisFailure

export type BuildStockDiagnosisOptions = ModelRequestConfig & {
  query: string
  includeAi?: boolean
  question?: string
}

export async function buildStockDiagnosis(options: BuildStockDiagnosisOptions): Promise<StockDiagnosisResponse> {
  const query = options.query.trim()
  const stock = resolveStock(query)
  if (!stock) {
    return { ok: false, error: "没有识别到股票。请输入 6 位代码，或输入统一股票池里的股票名。" }
  }

  const generatedAt = new Date().toISOString()
  const session = getChinaMarketSession()
  const warnings: string[] = []
  const [barsResult, quotesResult, records, recentOrders, positions, marketContext] = await Promise.all([
    fetchPoolBars({
      pool: [stock.item],
      lookbackDays: 180,
      useReal: true,
    }).catch((error) => {
      warnings.push(`历史 K 线读取失败：${error instanceof Error ? error.message : String(error)}`)
      return null
    }),
    fetchLatestQuotes([stock.item], { discoverTimeoutMs: 4_000, callTimeoutMs: 18_000 }).catch((error) => {
      warnings.push(`Qveris 实时报价读取失败：${error instanceof Error ? error.message : String(error)}`)
      return null
    }),
    loadRadarSignalHistoryRecordsForDateRange(shiftChinaDate(session.tradeDate, -14), session.tradeDate, 900).catch((error) => {
      warnings.push(`雷达信号账本读取失败：${error instanceof Error ? error.message : String(error)}`)
      return []
    }),
    listRecentPaperOrders(600).catch((error) => {
      warnings.push(`模拟盘订单读取失败：${error instanceof Error ? error.message : String(error)}`)
      return []
    }),
    listPaperPositionsForSymbol(stock.item.symbol, 40).catch((error) => {
      warnings.push(`模拟盘持仓读取失败：${error instanceof Error ? error.message : String(error)}`)
      return []
    }),
    loadStockNonPriceContext(stock.item.symbol).catch((error) => {
      warnings.push(`资金/事件补充数据读取失败：${error instanceof Error ? error.message : String(error)}`)
      return emptyMarketContext(stock.item.symbol, error)
    }),
  ])

  const bars = barsResult?.stocks.find((item) => item.symbol === stock.item.symbol)
  const quote = quotesResult?.quotes.get(stock.item.symbol)
  if (quotesResult?.fallbackReason) warnings.push(quotesResult.fallbackReason)
  if (barsResult?.fallbackReason) warnings.push(barsResult.fallbackReason)
  if (bars?.error) warnings.push(`历史 K 线提示：${bars.error}`)

  const mergedBars = mergeQuoteIntoBars(bars?.bars ?? [], quote)
  const latestBar = mergedBars.at(-1)
  const latestPrice = positive(quote?.latest) ?? latestBar?.close ?? 0
  if (!latestPrice) return { ok: false, error: "该股票暂无可用价格，无法诊断。" }

  const latestChangePct =
    finite(quote?.changePct) ??
    finite(latestBar?.changePct) ??
    (mergedBars.length >= 2 ? (latestPrice / mergedBars[mergedBars.length - 2].close - 1) * 100 : 0)
  const quoteInfo = {
    latest: round4(latestPrice) ?? latestPrice,
    changePct: roundPct(latestChangePct) ?? 0,
    tradeDate: quote?.tradeDate ?? latestBar?.date ?? session.tradeDate,
    tradeTime: quote?.tradeTime ?? "15:00:00",
    timestamp: quote ? `${quote.tradeDate} ${quote.tradeTime}` : `${latestBar?.date ?? session.tradeDate} 15:00:00`,
    source: quote ? "qveris-realtime" as const : latestBar ? "database-daily" as const : "unavailable" as const,
    fallbackReason: quote ? undefined : "未拿到 Qveris 实时报价，暂用数据库最新日线收盘价。",
  }
  if (quoteInfo.fallbackReason) warnings.push(quoteInfo.fallbackReason)

  const stockRecords = records
    .filter((record) => record.ticker === stock.item.symbol)
    .map((record) => markRecordWithLatestPrice(record, latestPrice, quoteInfo.timestamp))
    .sort((a, b) => timeValue(b.latestQuoteAt ?? b.recommendedAt) - timeValue(a.latestQuoteAt ?? a.recommendedAt))
  const openRecords = stockRecords.filter((record) => radarLifecycleStatus(record) === "open")
  const latestOpen = openRecords[0]
  const latestClosed = stockRecords.find((record) => radarLifecycleStatus(record) !== "open")
  const orders = recentOrders
    .filter((order) => order.symbol === stock.item.symbol)
    .sort((a, b) => timeValue(b.submittedAt) - timeValue(a.submittedAt))
    .slice(0, 20)
  const tech = computeTechSnapshot(mergedBars)
  const indicators = {
    ma20: round4(tech?.ema20),
    ma60: round4(tech?.ema60),
    rsi14: round2(tech?.rsi14),
    volumeRatio20: round2(tech?.volRatio),
    atr14Pct: round2(atrPct(mergedBars, 14)),
    trend: trendStatus(latestPrice, tech?.ema20, tech?.ema60),
  }
  const rule = diagnoseRule({
    latestPrice,
    latestChangePct,
    latestOpen,
    latestClosed,
    positions,
    orders,
    trend: indicators.trend,
  })
  const tradePlan = buildTradePlan({
    quoteInfo,
    indicators,
    latestOpen,
    latestPrice,
    positions,
    rule,
    barsCount: mergedBars.length,
    barsLatestDate: latestBar?.date,
    marketContext,
  })
  const metrics = buildMetrics({ quoteInfo, indicators, rule, positions, latestOpen })

  const baseResult: StockDiagnosisResult = {
    ok: true,
    generatedAt,
    query,
    stock: {
      symbol: stock.item.symbol,
      symbolQveris: stock.item.symbolQveris,
      name: stock.item.name,
      industry: stock.item.industry,
      covered: stock.covered,
    },
    quote: quoteInfo,
    bars: {
      count: mergedBars.length,
      latestDate: latestBar?.date,
      source: bars?.source,
      error: bars?.error,
    },
    indicators,
    radar: {
      open: openRecords.slice(0, 6),
      recent: stockRecords.slice(0, 12),
      latestOpen,
      latestClosed,
      strategyNames: uniqueNames(stockRecords.map((record) => record.strategyName)),
    },
    paper: {
      positions,
      orders,
      strategyNames: uniqueNames([...positions.map((item) => item.strategyName), ...orders.map((item) => item.strategyName)]),
    },
    marketContext,
    rule,
    tradePlan,
    metrics,
    warnings: uniqueNames(warnings).slice(0, 8),
  }

  if (options.includeAi) {
    baseResult.ai = await runAiDiagnosis(baseResult, options)
  }

  return baseResult
}

type ResolvedStock = {
  item: StockPoolItem
  covered: boolean
}

function resolveStock(query: string): ResolvedStock | null {
  const normalized = query.trim()
  const code = normalized.match(/\d{6}/)?.[0]
  if (code) {
    const known = STOCK_POOL.find((item) => item.symbol === code)
    if (known) return { item: known, covered: true }
    return {
      covered: false,
      item: {
        symbol: code,
        symbolQveris: `${code}.${inferExchange(code)}`,
        name: code,
        industry: "未在统一股票池",
      },
    }
  }

  const lower = normalized.toLowerCase()
  const exact = STOCK_POOL.find((item) => item.name === normalized || item.symbolQveris.toLowerCase() === lower)
  if (exact) return { item: exact, covered: true }
  const fuzzy = STOCK_POOL.find((item) => item.name.includes(normalized) || normalized.includes(item.name))
  return fuzzy ? { item: fuzzy, covered: true } : null
}

function inferExchange(symbol: string) {
  if (/^(6|9)/.test(symbol)) return "SH"
  if (/^(4|8)/.test(symbol)) return "BJ"
  return "SZ"
}

function mergeQuoteIntoBars(bars: Bar[], quote?: LatestQuote): Bar[] {
  const cleanBars = bars
    .filter((bar) => positive(bar.close))
    .sort((a, b) => a.date.localeCompare(b.date))
  if (!quote || !positive(quote.latest)) return cleanBars
  const latest = quote.latest
  const quoteBar: Bar = {
    date: quote.tradeDate,
    open: positive(quote.open) ?? cleanBars.at(-1)?.close ?? latest,
    high: Math.max(positive(quote.high) ?? latest, latest),
    low: Math.min(positive(quote.low) ?? latest, latest),
    close: latest,
    volume: positive(quote.volume) ?? cleanBars.at(-1)?.volume ?? 0,
    amount: positive(quote.amount) ?? cleanBars.at(-1)?.amount,
    preClose: positive(quote.preClose) ?? cleanBars.at(-1)?.close,
    changePct: quote.changePct,
  }
  const previous = cleanBars.at(-1)
  if (!previous) return [quoteBar]
  if (previous.date === quote.tradeDate) {
    return [...cleanBars.slice(0, -1), {
      ...previous,
      open: positive(quote.open) ?? previous.open,
      high: Math.max(previous.high, quoteBar.high),
      low: Math.min(previous.low, quoteBar.low),
      close: latest,
      volume: quoteBar.volume || previous.volume,
      amount: quoteBar.amount ?? previous.amount,
      preClose: quoteBar.preClose ?? previous.preClose,
      changePct: quote.changePct,
    }]
  }
  if (previous.date < quote.tradeDate) return [...cleanBars, quoteBar]
  return cleanBars
}

function markRecordWithLatestPrice(record: RadarHistoryRecord, latestPrice: number, quoteTimestamp: string): RadarHistoryRecord {
  const trigger = positive(record.triggerPrice) ?? latestPrice
  const returnPct = trigger > 0 ? (latestPrice / trigger - 1) * 100 : record.returnPct
  const maxReturnPct = Math.max(record.maxReturnPct ?? returnPct, returnPct)
  const maxDrawdownPct = Math.min(record.maxDrawdownPct ?? returnPct, returnPct)
  return {
    ...record,
    latestPrice: round4(latestPrice) ?? latestPrice,
    latestQuoteAt: `${quoteTimestamp.replace(" ", "T")}+08:00`,
    returnPct: roundPct(returnPct) ?? 0,
    maxReturnPct: roundPct(maxReturnPct) ?? 0,
    maxDrawdownPct: roundPct(maxDrawdownPct) ?? 0,
  }
}

function diagnoseRule({
  latestPrice,
  latestChangePct,
  latestOpen,
  latestClosed,
  positions,
  orders,
  trend,
}: {
  latestPrice: number
  latestChangePct: number
  latestOpen?: RadarHistoryRecord
  latestClosed?: RadarHistoryRecord
  positions: PaperPositionRecord[]
  orders: RecentPaperOrderRecord[]
  trend: StockDiagnosisResult["indicators"]["trend"]
}): StockDiagnosisResult["rule"] {
  const stop = positive(latestOpen?.stopLossPrice)
  const target = positive(latestOpen?.targetPrice)
  const trigger = positive(latestOpen?.triggerPrice)
  const returnSinceSignalPct = trigger ? (latestPrice / trigger - 1) * 100 : undefined
  const distanceToStopPct = stop ? (latestPrice / stop - 1) * 100 : undefined
  const distanceToTargetPct = target ? (target / latestPrice - 1) * 100 : undefined

  if (latestOpen) {
    if (stop && latestPrice <= stop) {
      return {
        action: "stop",
        label: "已触发止损",
        tone: "bad",
        summary: `${latestOpen.name} 已跌破系统止损位 ${formatNumber(stop)}，信号不再按原计划跟踪。`,
        nextStep: "按系统纪律退出或至少降到观察仓；不要用 AI 文案替代止损规则。",
        riskLine: stop,
        targetLine: target,
        triggerPrice: trigger,
        returnSinceSignalPct: roundPct(returnSinceSignalPct),
        distanceToStopPct: roundPct(distanceToStopPct),
        distanceToTargetPct: roundPct(distanceToTargetPct),
      }
    }
    if (target && latestPrice >= target) {
      return {
        action: "take-profit",
        label: "已到止盈区",
        tone: "good",
        summary: `${latestOpen.name} 已到达系统目标位 ${formatNumber(target)} 附近，优先兑现或上移止损。`,
        nextStep: "记录止盈原因；若继续持有，至少把风控线抬到成本或短线均线附近。",
        riskLine: stop,
        targetLine: target,
        triggerPrice: trigger,
        returnSinceSignalPct: roundPct(returnSinceSignalPct),
        distanceToStopPct: roundPct(distanceToStopPct),
        distanceToTargetPct: roundPct(distanceToTargetPct),
      }
    }
    if (stop && latestPrice <= stop * 1.015) {
      return {
        action: "warning",
        label: "贴近止损",
        tone: "warn",
        summary: `${latestOpen.name} 距离止损位只剩 ${formatPercentValue(distanceToStopPct)}，属于风控警戒状态。`,
        nextStep: "下一次跌破止损位应执行退出；若反抽但量能不足，不建议加仓摊低。",
        riskLine: stop,
        targetLine: target,
        triggerPrice: trigger,
        returnSinceSignalPct: roundPct(returnSinceSignalPct),
        distanceToStopPct: roundPct(distanceToStopPct),
        distanceToTargetPct: roundPct(distanceToTargetPct),
      }
    }
    if ((returnSinceSignalPct ?? 0) < -3 || latestChangePct < -4) {
      return {
        action: "warning",
        label: "信号走弱",
        tone: "warn",
        summary: `${latestOpen.name} 尚未跌破系统止损，但触发后收益为 ${formatPercentValue(returnSinceSignalPct)}，需要降级跟踪。`,
        nextStep: "继续按止损线执行，不做新增买入；如果收盘仍在弱势区，盘后复盘策略质量。",
        riskLine: stop,
        targetLine: target,
        triggerPrice: trigger,
        returnSinceSignalPct: roundPct(returnSinceSignalPct),
        distanceToStopPct: roundPct(distanceToStopPct),
        distanceToTargetPct: roundPct(distanceToTargetPct),
      }
    }
    return {
      action: "hold",
      label: "继续跟踪",
      tone: trend === "up" ? "good" : "neutral",
      summary: `${latestOpen.name} 仍在系统开放信号中，当前没有触发止损或止盈。`,
      nextStep: "按原交易计划跟踪止损和目标位；只有出现新信号或共振加强时再考虑加仓。",
      riskLine: stop,
      targetLine: target,
      triggerPrice: trigger,
      returnSinceSignalPct: roundPct(returnSinceSignalPct),
      distanceToStopPct: roundPct(distanceToStopPct),
      distanceToTargetPct: roundPct(distanceToTargetPct),
    }
  }

  if (positions.length) {
    const worst = positions.slice().sort((a, b) => a.pnlPct - b.pnlPct)[0]
    return {
      action: worst.pnlPct < -3 ? "warning" : "watch",
      label: worst.pnlPct < -3 ? "持仓回撤警戒" : "模拟盘持仓",
      tone: worst.pnlPct < -3 ? "warn" : "neutral",
      summary: `模拟盘仍有 ${positions.length} 个策略账户持有该股，但最近 14 天雷达没有开放买入信号。`,
      nextStep: "优先查看模拟盘对应策略账户的卖出规则；不要把旧持仓误认为新的今日推荐。",
      returnSinceSignalPct: roundPct(worst.pnlPct),
    }
  }

  if (latestClosed) {
    return {
      action: "watch",
      label: radarExitActionLabel(latestClosed),
      tone: radarExitReturnPct(latestClosed) >= 0 ? "neutral" : "warn",
      summary: `最近一条雷达信号已经关闭，关闭收益 ${formatPercentValue(radarExitReturnPct(latestClosed))}。`,
      nextStep: "等待新一轮上线策略信号；旧信号关闭后不应在首页继续显示为可买。",
      triggerPrice: latestClosed.triggerPrice,
      returnSinceSignalPct: roundPct(radarExitReturnPct(latestClosed)),
    }
  }

  if (orders.length) {
    return {
      action: "watch",
      label: "只有模拟流水",
      tone: "neutral",
      summary: "该股有历史模拟盘订单，但当前没有开放雷达买入信号。",
      nextStep: "可作为复盘对象，不作为新的交易入口。",
    }
  }

  return {
    action: "not-covered",
    label: "未命中系统策略",
    tone: "neutral",
    summary: "当前没有找到该股的开放雷达信号或模拟盘持仓。",
    nextStep: "除非你有独立研究依据，否则等待策略雷达重新触发；可用该诊断继续观察技术面与数据完整度。",
  }
}

function buildTradePlan({
  quoteInfo,
  indicators,
  latestOpen,
  latestPrice,
  positions,
  rule,
  barsCount,
  barsLatestDate,
  marketContext,
}: {
  quoteInfo: StockDiagnosisResult["quote"]
  indicators: StockDiagnosisResult["indicators"]
  latestOpen?: RadarHistoryRecord
  latestPrice: number
  positions: PaperPositionRecord[]
  rule: StockDiagnosisResult["rule"]
  barsCount: number
  barsLatestDate?: string
  marketContext: StockNonPriceContext
}): StockDiagnosisTradePlan {
  const trigger = positive(rule.triggerPrice)
  const stop = positive(rule.riskLine)
  const target = positive(rule.targetLine)
  const sinceSignal = rule.returnSinceSignalPct
  const positionHint = latestOpen
    ? "单票按模拟盘策略上限执行，默认不超过组合 20%；同一股票已有仓位时不重复买入。"
    : positions.length
      ? "该股已有模拟盘旧仓，新增资金不按旧信号追入，先按对应账户卖出规则管理。"
      : "没有开放信号时保持空仓观察，避免把主观判断伪装成策略买点。"
  const stopText = stop
    ? `${formatNumber(stop)}。盘中有效跌破或收盘确认跌破都视为原计划失效。`
    : "当前没有系统止损线，不能形成完整交易计划。"
  const targetText = target
    ? `${formatNumber(target)}。触及目标优先兑现，若继续持有必须上移止损到成本或短线均线。`
    : "当前没有系统目标位，只能按止损和趋势衰减退出。"
  const dataBasis = [
    `${quoteInfo.source === "qveris-realtime" ? "Qveris 实时报价" : "数据库日线"}：${quoteInfo.tradeDate} ${quoteInfo.tradeTime} 北京时间，现价 ${formatNumber(latestPrice)}`,
    `历史 K 线：${barsCount} 条${barsLatestDate ? `，最新 ${barsLatestDate}` : ""}`,
    `技术面：趋势 ${trendLabel(indicators.trend)}${indicators.ma20 ? `，EMA20 ${formatNumber(indicators.ma20)}` : ""}${indicators.ma60 ? `，EMA60 ${formatNumber(indicators.ma60)}` : ""}`,
    latestOpen ? `雷达开放信号：${latestOpen.strategyName ?? "策略雷达"}，触发 ${formatNumber(trigger)}` : "雷达开放信号：暂无",
    `模拟盘：${positions.length} 个账户持仓`,
    `资金/事件补充：${marketContextLabel(marketContext)}`,
  ]
  const watchPoints = [
    trigger ? `是否重新站稳触发价 ${formatNumber(trigger)}` : "是否出现新的策略雷达开放信号",
    stop ? `是否跌破止损 ${formatNumber(stop)}` : "是否能补齐系统止损线",
    target ? `是否接近目标 ${formatNumber(target)}` : "是否出现明确止盈区",
    indicators.volumeRatio20 ? `量能相对 20 日均量 ${formatNumber(indicators.volumeRatio20)} 倍` : "量能数据是否完整",
    indicators.rsi14 ? `RSI14 ${formatNumber(indicators.rsi14)}` : "RSI 数据是否完整",
  ]

  if (rule.action === "stop") {
    return {
      stance: "stop",
      label: "先执行风控",
      summary: "系统已经判定原信号失效，交易计划优先处理风险，不再讨论加仓。",
      entryPlan: "不新增买入；若未持有，直接剔除出可买清单。",
      stopLossPlan: stopText,
      takeProfitPlan: targetText,
      exitPlan: "已有仓位按止损纪律退出或降到观察仓；后续只有重新触发上线策略才重新评估。",
      holdingPeriod: "立即处理或在最近一个可交易窗口处理；不延长持有周期。",
      positionPlan: "仓位降到 0 或观察仓，避免亏损扩大后再靠主观判断补仓。",
      invalidation: stop ? `跌破 ${formatNumber(stop)} 已经使原计划失效。` : "系统止损缺失，无法继续按原计划持有。",
      watchPoints,
      dataBasis,
    }
  }

  if (rule.action === "take-profit") {
    return {
      stance: "take-profit",
      label: "止盈优先",
      summary: "价格已经进入系统目标区，核心任务从寻找买点切换为兑现和保护利润。",
      entryPlan: "不追高新增；若要参与，只等待回踩不破触发价或均线后重新出现策略信号。",
      stopLossPlan: stop ? `继续持有的保护线至少上移到 ${formatNumber(Math.max(stop, trigger ?? stop))} 附近。` : stopText,
      takeProfitPlan: targetText,
      exitPlan: "分批兑现或上移止损；若放量滞涨或跌回目标位下方，按减仓处理。",
      holdingPeriod: "目标区内按日内到 2 个交易日跟踪，不把短线止盈信号拖成长线。",
      positionPlan: positionHint,
      invalidation: target ? `跌回目标位 ${formatNumber(target)} 下方且量能转弱，止盈计划降级。` : "目标位缺失，不能执行目标区管理。",
      watchPoints,
      dataBasis,
    }
  }

  if (rule.action === "warning") {
    return {
      stance: "reduce",
      label: "降级跟踪",
      summary: "信号没有完全作废，但风险已经抬升，下一步不是买入，而是等价格证明自己。",
      entryPlan: trigger
        ? `不在弱势区加仓；只有重新站稳 ${formatNumber(trigger)} 并恢复量价配合，才考虑小仓验证。`
        : "不新增买入，等待新的策略雷达信号。",
      stopLossPlan: stopText,
      takeProfitPlan: targetText,
      exitPlan: "跌破止损直接退出；反抽无量或收盘仍弱，盘后复盘是否移出跟踪。",
      holdingPeriod: "1-2 个交易日内必须看到修复，否则降级为观察。",
      positionPlan: positionHint,
      invalidation: stop ? `有效跌破 ${formatNumber(stop)}。` : "缺少止损线。",
      watchPoints,
      dataBasis,
    }
  }

  if (rule.action === "hold") {
    const chaseWarning = sinceSignal != null && sinceSignal > 3
      ? `触发后已经上涨 ${formatPercentValue(sinceSignal)}，不适合追价，只能等回踩或新信号。`
      : "触发后涨幅仍在可控区，按原计划跟踪。"
    return {
      stance: "hold",
      label: "按计划持有/跟踪",
      summary: "该股仍在开放信号里，没有触发止损或止盈，交易计划继续有效。",
      entryPlan: trigger
        ? `未持有者只考虑 ${formatNumber(trigger)} 附近的回踩确认或盘中二次放量确认；${chaseWarning}`
        : "未持有者等待新的明确触发价。",
      stopLossPlan: stopText,
      takeProfitPlan: targetText,
      exitPlan: "跌破止损退出，到目标区兑现；若连续走弱但未止损，盘后按策略质量复盘。",
      holdingPeriod: latestOpen?.holdDays != null
        ? `当前已跟踪 ${latestOpen.holdDays} 天，短线计划通常按 1-5 个交易日复盘。`
        : "短线计划按 1-5 个交易日复盘。",
      positionPlan: positionHint,
      invalidation: stop ? `有效跌破 ${formatNumber(stop)} 或开放信号被雷达账本关闭。` : "止损线缺失时不应扩大仓位。",
      watchPoints,
      dataBasis,
    }
  }

  if (positions.length) {
    return {
      stance: "wait",
      label: "旧仓管理",
      summary: "模拟盘有持仓，但当前没有开放雷达买入信号，重点是管理旧仓而不是新开仓。",
      entryPlan: "不按旧持仓追买；等待策略雷达重新给出新触发。",
      stopLossPlan: stopText,
      takeProfitPlan: targetText,
      exitPlan: "查看对应模拟账户卖出规则；若个股跌破账户风控线，按账户规则退出。",
      holdingPeriod: "以对应模拟账户的持仓周期为准，盘后复盘是否仍满足原策略。",
      positionPlan: positionHint,
      invalidation: "没有新开放信号，不能把旧仓状态解释为新的买入建议。",
      watchPoints,
      dataBasis,
    }
  }

  return {
    stance: "wait",
    label: "等待信号",
    summary: "当前没有系统买入依据，专业处理方式是等待而不是硬找理由。",
    entryPlan: "不买入；等策略雷达或多策略共振重新触发，并给出触发价、止损和目标位。",
    stopLossPlan: "无交易则无止损；若未来触发，必须同时生成止损线。",
    takeProfitPlan: "无交易则无止盈；未来信号需给出目标位或退出规则。",
    exitPlan: "没有持仓时保持观察；已有主观持仓需另行提供成本价再诊断。",
    holdingPeriod: "暂无持有周期；新信号出现后再按策略周期跟踪。",
    positionPlan: positionHint,
    invalidation: "没有开放雷达信号或模拟盘新入场记录。",
    watchPoints,
    dataBasis,
  }
}

function buildMetrics({
  quoteInfo,
  indicators,
  rule,
  positions,
  latestOpen,
}: {
  quoteInfo: StockDiagnosisResult["quote"]
  indicators: StockDiagnosisResult["indicators"]
  rule: StockDiagnosisResult["rule"]
  positions: PaperPositionRecord[]
  latestOpen?: RadarHistoryRecord
}) {
  const metrics: StockDiagnosisMetric[] = [
    { label: "当前价", value: formatNumber(quoteInfo.latest), detail: `${quoteInfo.tradeDate} ${quoteInfo.tradeTime}`, tone: quoteInfo.source === "qveris-realtime" ? "good" : "warn" },
    { label: "今日涨跌", value: formatPercentValue(quoteInfo.changePct), tone: quoteInfo.changePct >= 0 ? "good" : "bad" },
    { label: "系统状态", value: rule.label, detail: "规则诊断", tone: rule.tone },
    { label: "模拟持仓", value: `${positions.length} 个账户`, detail: positions.length ? `最大仓 ${formatMoney(Math.max(...positions.map((item) => item.marketValue)))}` : "未持有" },
  ]
  if (rule.triggerPrice) metrics.push({ label: "触发价", value: formatNumber(rule.triggerPrice), detail: latestOpen?.strategyName, tone: "neutral" })
  if (rule.riskLine) metrics.push({ label: "止损线", value: formatNumber(rule.riskLine), detail: `距离 ${formatPercentValue(rule.distanceToStopPct)}`, tone: rule.distanceToStopPct != null && rule.distanceToStopPct <= 1.5 ? "warn" : "neutral" })
  if (rule.targetLine) metrics.push({ label: "目标位", value: formatNumber(rule.targetLine), detail: `空间 ${formatPercentValue(rule.distanceToTargetPct)}`, tone: "good" })
  if (indicators.ma20) metrics.push({ label: "EMA20", value: formatNumber(indicators.ma20), detail: indicators.trend })
  if (indicators.ma60) metrics.push({ label: "EMA60", value: formatNumber(indicators.ma60), detail: indicators.trend })
  if (indicators.rsi14) metrics.push({ label: "RSI14", value: formatNumber(indicators.rsi14), tone: indicators.rsi14 > 75 ? "warn" : indicators.rsi14 < 35 ? "warn" : "neutral" })
  return metrics
}

async function runAiDiagnosis(
  result: Omit<StockDiagnosisResult, "ai">,
  config: ModelRequestConfig & { question?: string },
): Promise<StockDiagnosisResult["ai"]> {
  const prompt = buildAiPrompt(result, config.question)
  if (!config.provider || config.provider === "default") {
    if (!process.env.QVERIS_API_KEY) {
      return {
        source: "rule-fallback",
        provider: "default",
        model: "qveris-default",
        content: ruleFallbackText(result),
        warning: "默认模型未配置 QVERIS_API_KEY，已展示规则诊断。",
      }
    }
    try {
      const ai = await callQverisDefaultModel({
        temperature: 0.1,
        maxTokens: 1400,
        messages: [
          { role: "system", content: stockDiagnosisSystemPrompt() },
          { role: "user", content: prompt },
        ],
      })
      return {
        source: "ai",
        provider: ai.provider,
        model: ai.model,
        content: ai.content,
      }
    } catch (error) {
      return {
        source: "rule-fallback",
        provider: "default",
        model: "qveris-default",
        content: ruleFallbackText(result),
        warning: error instanceof Error ? error.message : "默认模型调用失败",
      }
    }
  }

  const resolved = resolveModelConfig(config)
  if (!resolved.ok) {
    return {
      source: "rule-fallback",
      provider: config.provider,
      model: config.model,
      content: ruleFallbackText(result),
      warning: resolved.error,
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 45_000)
  try {
    const response = await fetch(`${resolved.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resolved.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: resolved.model,
        temperature: 0.1,
        messages: [
          { role: "system", content: stockDiagnosisSystemPrompt() },
          { role: "user", content: prompt },
        ],
      }),
      signal: controller.signal,
    })
    const json = await response.json().catch(() => null)
    if (!response.ok) {
      return {
        source: "rule-fallback",
        provider: resolved.provider,
        model: resolved.model,
        content: ruleFallbackText(result),
        warning: extractModelError(json) ?? `模型接口返回 HTTP ${response.status}`,
      }
    }
    const content = json?.choices?.[0]?.message?.content
    if (typeof content !== "string" || !content.trim()) {
      return {
        source: "rule-fallback",
        provider: resolved.provider,
        model: resolved.model,
        content: ruleFallbackText(result),
        warning: "模型响应为空或格式不兼容",
      }
    }
    return {
      source: "ai",
      provider: resolved.provider,
      model: resolved.model,
      content,
    }
  } catch (error) {
    return {
      source: "rule-fallback",
      provider: resolved.provider,
      model: resolved.model,
      content: ruleFallbackText(result),
      warning: error instanceof Error && error.name === "AbortError" ? "模型接口超时" : error instanceof Error ? error.message : "模型调用失败",
    }
  } finally {
    clearTimeout(timeout)
  }
}

function stockDiagnosisSystemPrompt() {
  return [
    "你是 Stock Radar 的 A 股专业交易员诊断助手，同时遵守量化风控纪律。",
    "必须只基于用户提供的结构化数据、系统信号、tradePlan、止盈止损、模拟盘状态和 marketContext 分析；不得编造新闻、盘口、资金流、龙虎榜或未提供的数据。",
    "若 marketContext 有资金流、北向、龙虎榜、新闻、公告或财务数据，可以纳入判断；若缺失，必须明确说缺失，不能用想象补齐。",
    "AI 不能推翻 tradePlan：若系统计划是止损、止盈、等待或降级跟踪，不能给出相反的买入建议。",
    "输出中文，简洁但可执行，必须包含：1. 交易结论；2. 数据结构；3. 买点/加仓条件；4. 卖点、止盈、止损；5. 预计持有时间和复盘点；6. 风险和数据限制。",
    "不能承诺收益，不能说必涨；所有建议必须表述为风险控制和交易计划。",
  ].join("\n")
}

function buildAiPrompt(result: Omit<StockDiagnosisResult, "ai">, question?: string) {
  const payload = {
    userQuestion: question || "请诊断这只股票现在该如何按系统规则处理。",
    generatedAt: formatChinaDateTime(result.generatedAt),
    stock: result.stock,
    quote: result.quote,
    indicators: result.indicators,
    rule: result.rule,
    tradePlan: result.tradePlan,
    marketContext: {
      status: result.marketContext.status,
      checkedAt: formatChinaDateTime(result.marketContext.checkedAt),
      availableSources: result.marketContext.availableSources,
      missingSources: result.marketContext.missingSources,
      factors: result.marketContext.factors.slice(0, 5),
      events: result.marketContext.events.slice(0, 5).map((event) => ({
        ...event,
        eventTime: formatChinaDateTime(event.eventTime),
      })),
      sentiments: result.marketContext.sentiments.slice(0, 5).map((sentiment) => ({
        ...sentiment,
        eventTime: formatChinaDateTime(sentiment.eventTime),
      })),
      fundamentals: result.marketContext.fundamentals.slice(0, 3),
      raw: result.marketContext.raw.slice(0, 5),
      limitations: result.marketContext.limitations,
    },
    radarOpenSignals: result.radar.open.map((record) => ({
      strategyName: record.strategyName,
      signal: record.signal,
      recommendedAt: formatChinaDateTime(record.recommendedAt),
      triggerPrice: record.triggerPrice,
      latestPrice: record.latestPrice,
      returnPct: record.returnPct,
      stopLossPrice: record.stopLossPrice,
      targetPrice: record.targetPrice,
      status: record.status,
    })),
    paperPositions: result.paper.positions.map((position) => ({
      strategyName: position.strategyName,
      shares: position.shares,
      costPrice: position.costPrice,
      currentPrice: position.currentPrice,
      pnlPct: position.pnlPct,
      openedAt: position.openedAt,
      sellableFrom: position.sellableFrom,
      sellable: position.sellable,
    })),
    recentOrders: result.paper.orders.slice(0, 6).map((order) => ({
      strategyName: order.strategyName,
      side: order.side,
      status: order.status,
      price: order.filledPrice ?? order.limitPrice,
      submittedAt: formatChinaDateTime(order.submittedAt),
      note: order.note,
    })),
    warnings: result.warnings,
  }
  return JSON.stringify(payload, null, 2)
}

function ruleFallbackText(result: Omit<StockDiagnosisResult, "ai">) {
  return [
    `系统结论：${result.rule.label}。${result.rule.summary}`,
    `下一步：${result.rule.nextStep}`,
    `交易计划：${result.tradePlan.label}。${result.tradePlan.summary}`,
    `买点/执行：${result.tradePlan.entryPlan}`,
    `卖出/退出：${result.tradePlan.exitPlan}`,
    `持有周期：${result.tradePlan.holdingPeriod}`,
    `资金/事件补充：${marketContextLabel(result.marketContext)}。${result.marketContext.limitations.join("；")}`,
    result.rule.riskLine ? `止损线：${formatNumber(result.rule.riskLine)}；当前距止损 ${formatPercentValue(result.rule.distanceToStopPct)}。` : "",
    result.rule.targetLine ? `目标位：${formatNumber(result.rule.targetLine)}；当前距目标 ${formatPercentValue(result.rule.distanceToTargetPct)}。` : "",
    `数据口径：${result.quote.source === "qveris-realtime" ? "Qveris 实时报价" : "数据库日线"}，时间 ${result.quote.tradeDate} ${result.quote.tradeTime} 北京时间。`,
  ].filter(Boolean).join("\n")
}

function atrPct(bars: Bar[], period: number) {
  if (bars.length < period + 1) return undefined
  const trs: number[] = []
  for (let i = bars.length - period; i < bars.length; i++) {
    const bar = bars[i]
    const prev = bars[i - 1]
    if (!bar || !prev) continue
    trs.push(Math.max(bar.high - bar.low, Math.abs(bar.high - prev.close), Math.abs(bar.low - prev.close)))
  }
  const latestClose = bars.at(-1)?.close
  if (!trs.length || !latestClose) return undefined
  return (trs.reduce((sum, value) => sum + value, 0) / trs.length / latestClose) * 100
}

function trendStatus(
  latestPrice: number,
  ma20?: number | null,
  ma60?: number | null,
): StockDiagnosisResult["indicators"]["trend"] {
  if (!ma20 || !ma60) return "unknown"
  if (latestPrice >= ma20 && ma20 >= ma60) return "up"
  if (latestPrice <= ma20 && ma20 <= ma60) return "down"
  return "mixed"
}

function shiftChinaDate(date: string, days: number) {
  const d = new Date(`${date}T12:00:00+08:00`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" })
}

function uniqueNames(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))]
}

function timeValue(value?: string) {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

function positive(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

function finite(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function roundPct(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) / 100 : undefined
}

function round2(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) / 100 : undefined
}

function round4(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 10_000) / 10_000 : undefined
}

function formatNumber(value?: number) {
  if (value == null || !Number.isFinite(value)) return "N/A"
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 3, minimumFractionDigits: 2 })
}

function formatPercentValue(value?: number) {
  if (value == null || !Number.isFinite(value)) return "N/A"
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
}

function formatMoney(value: number) {
  if (!Number.isFinite(value)) return "N/A"
  if (Math.abs(value) >= 10_000) return `￥${(value / 10_000).toFixed(2)}万`
  return `￥${value.toFixed(0)}`
}

function trendLabel(value: StockDiagnosisResult["indicators"]["trend"]) {
  if (value === "up") return "上行"
  if (value === "down") return "下行"
  if (value === "mixed") return "震荡"
  return "未知"
}

function marketContextLabel(context: StockNonPriceContext) {
  if (context.status === "ready") {
    return `已读取 ${context.availableSources.map(nonPriceSourceLabel).join("、")}`
  }
  if (context.status === "empty") return "暂无该股已落库资金/新闻/事件补充"
  if (context.status === "fallback") return "非价格数据库未配置"
  return `读取异常${context.error ? `：${context.error}` : ""}`
}

function nonPriceSourceLabel(sourceId: StockNonPriceContext["availableSources"][number]) {
  if (sourceId === "fund-flow") return "主力资金"
  if (sourceId === "north-bound") return "北向资金"
  if (sourceId === "dragon-tiger") return "龙虎榜"
  if (sourceId === "news") return "新闻/研报"
  if (sourceId === "announcement") return "公告"
  return "财务"
}

function emptyMarketContext(symbol: string, error: unknown): StockNonPriceContext {
  return {
    configured: true,
    status: "error",
    checkedAt: new Date().toISOString(),
    symbol,
    factors: [],
    events: [],
    sentiments: [],
    fundamentals: [],
    raw: [],
    availableSources: [],
    missingSources: ["fund-flow", "north-bound", "dragon-tiger", "news", "announcement", "fin-statement", "order-book"],
    limitations: ["资金、新闻、事件和盘口补充读取失败，AI 将只使用价格、策略和模拟盘数据。"],
    error: error instanceof Error ? error.message : String(error),
  }
}
