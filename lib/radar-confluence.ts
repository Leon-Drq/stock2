import type { BuyPoint, SignalKind, SignalLevel, StockSignal } from "@/lib/radar-data"

export type RadarConfluenceSignal = {
  ticker: string
  symbol: string
  name: string
  strategyCount: number
  strategyIds: string[]
  strategyNames: string[]
  signalCount: number
  triggerAt: string
  latestAt: string
  triggerPrice?: number
  latestPrice?: number
  returnPct: number
  maxReturnPct: number
  signalLevels: SignalLevel[]
  signalKinds: SignalKind[]
  buyPoints: BuyPoint[]
}

type RadarConfluenceOptions = {
  minStrategies?: number
  includeClosed?: boolean
  includeCandidates?: boolean
}

type StrategyHit = {
  id: string
  name: string
  firstAt: string
  latestAt: string
  firstPrice?: number
  latestPrice?: number
}

type Draft = {
  ticker: string
  name: string
  strategyHits: Map<string, StrategyHit>
  signalCount: number
  latestAt: string
  latestPrice?: number
  returnPct: number
  maxReturnPct: number
  signalLevels: Set<SignalLevel>
  signalKinds: Set<SignalKind>
  buyPoints: Set<BuyPoint>
}

export function buildRadarConfluenceSignals(
  signals: StockSignal[],
  options: RadarConfluenceOptions = {},
): RadarConfluenceSignal[] {
  const minStrategies = Math.max(2, Math.min(options.minStrategies ?? 2, 8))
  const rows = new Map<string, Draft>()

  for (const signal of signals) {
    if (!options.includeClosed && signal.signalLifecycle === "closed") continue
    if (!options.includeCandidates && signal.signalLifecycle === "candidate") continue

    const strategyName = normalizeStrategyName(signal.strategyName ?? signal.strategyId ?? "未知策略")
    const strategyId = signal.strategyId ?? strategyName
    const signalAt = signalTime(signal)
    const latestAt = signal.latestQuoteAt ?? signal.lastSeenAt ?? signalAt
    const price = validPrice(signal.triggerPrice ?? signal.price)
    const latestPrice = validPrice(signal.price)
    const signalReturn = signal.returnSinceSignalPct ?? (price && latestPrice ? (latestPrice / price - 1) * 100 : 0)
    const row = rows.get(signal.ticker) ?? {
      ticker: signal.ticker,
      name: signal.name,
      strategyHits: new Map<string, StrategyHit>(),
      signalCount: 0,
      latestAt,
      latestPrice,
      returnPct: signalReturn,
      maxReturnPct: signal.mfePct ?? signalReturn,
      signalLevels: new Set<SignalLevel>(),
      signalKinds: new Set<SignalKind>(),
      buyPoints: new Set<BuyPoint>(),
    }

    row.signalCount += 1
    row.latestAt = newerDate(row.latestAt, latestAt)
    row.latestPrice = latestPrice ?? row.latestPrice
    row.returnPct = Math.max(row.returnPct, signalReturn)
    row.maxReturnPct = Math.max(row.maxReturnPct, signal.mfePct ?? signalReturn)
    row.signalLevels.add(signal.signalLevel)
    row.signalKinds.add(signal.signalKind)
    row.buyPoints.add(signal.buyPoint)

    const existing = row.strategyHits.get(strategyId)
    const hit: StrategyHit = existing
      ? {
          id: strategyId,
          name: strategyName,
          firstAt: olderDate(existing.firstAt, signalAt),
          latestAt: newerDate(existing.latestAt, latestAt),
          firstPrice: olderDate(existing.firstAt, signalAt) === existing.firstAt ? existing.firstPrice : price ?? existing.firstPrice,
          latestPrice: newerDate(existing.latestAt, latestAt) === existing.latestAt ? existing.latestPrice : latestPrice ?? existing.latestPrice,
        }
      : {
          id: strategyId,
          name: strategyName,
          firstAt: signalAt,
          latestAt,
          firstPrice: price,
          latestPrice,
        }

    row.strategyHits.set(strategyId, hit)
    rows.set(signal.ticker, row)
  }

  return Array.from(rows.values())
    .map((row) => toConfluenceSignal(row, minStrategies))
    .filter((row) => row.strategyCount >= minStrategies)
    .sort((a, b) => {
      if (b.strategyCount !== a.strategyCount) return b.strategyCount - a.strategyCount
      if (b.returnPct !== a.returnPct) return b.returnPct - a.returnPct
      return timeMs(b.latestAt) - timeMs(a.latestAt)
    })
}

function toConfluenceSignal(row: Draft, minStrategies: number): RadarConfluenceSignal {
  const strategies = Array.from(row.strategyHits.values()).sort((a, b) => timeMs(a.firstAt) - timeMs(b.firstAt))
  const trigger = strategies[Math.min(Math.max(minStrategies, 1), strategies.length) - 1] ?? strategies.at(-1)
  return {
    ticker: row.ticker,
    symbol: row.ticker,
    name: row.name,
    strategyCount: strategies.length,
    strategyIds: strategies.map((strategy) => strategy.id),
    strategyNames: strategies.map((strategy) => strategy.name).slice(0, 6),
    signalCount: row.signalCount,
    triggerAt: trigger?.firstAt ?? row.latestAt,
    latestAt: row.latestAt,
    triggerPrice: trigger?.firstPrice ?? strategies[0]?.firstPrice,
    latestPrice: row.latestPrice ?? trigger?.latestPrice,
    returnPct: row.returnPct,
    maxReturnPct: row.maxReturnPct,
    signalLevels: Array.from(row.signalLevels),
    signalKinds: Array.from(row.signalKinds),
    buyPoints: Array.from(row.buyPoints),
  }
}

function signalTime(signal: StockSignal) {
  return signal.firstTriggeredAt ?? signal.recommendedAt ?? signal.latestQuoteAt ?? `${signal.date}T${signal.quoteTime ?? "09:30:00"}+08:00`
}

function normalizeStrategyName(name: string) {
  return name.replace(/\s*\+\s*盘中确认$/, "").replace(/\s*候选$/, "")
}

function validPrice(value?: number) {
  return Number.isFinite(value) && value && value > 0 ? value : undefined
}

function olderDate(a: string, b: string) {
  return timeMs(a) <= timeMs(b) ? a : b
}

function newerDate(a: string, b: string) {
  return timeMs(a) >= timeMs(b) ? a : b
}

function timeMs(value: string) {
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}
