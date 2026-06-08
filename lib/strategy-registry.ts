import type { FactorId } from "@/lib/factors/engine"

export type StrategyFactorId = FactorId

export type RadarStrategyConfig = {
  id: string
  name: string
  version: string
  status: "已回测" | "实验中"
  description: string
  universe: string
  rebalance: string
  holdingPeriod: string
  factorWeights: Array<{
    id: StrategyFactorId
    label: string
    weight: number
  }>
  intradayWeights: {
    factorBase: number
    move: number
    direction: number
    volume: number
    priceStructure: number
  }
  risk: {
    atrMultiple: number
    maxPositionPct: number
    stopLossFloorPct: number
  }
  backtestProfile: {
    annualReturn: number
    maxDrawdown: number
    sharpe: number
    winRate: number
  }
}

const EMPTY_INTRADAY_WEIGHTS: RadarStrategyConfig["intradayWeights"] = {
  factorBase: 0,
  move: 0,
  direction: 0,
  volume: 0,
  priceStructure: 0,
}

const EMPTY_RISK: RadarStrategyConfig["risk"] = {
  atrMultiple: 0,
  maxPositionPct: 0,
  stopLossFloorPct: 0,
}

export const RADAR_STRATEGY: RadarStrategyConfig = {
  id: "open-source-placeholder",
  name: "未配置策略",
  version: "0.0.0",
  status: "实验中",
  description: "开源版不内置任何交易策略；请通过策略实验室或自己的注册表添加策略后再运行雷达。",
  universe: "未配置",
  rebalance: "未配置",
  holdingPeriod: "未配置",
  factorWeights: [],
  intradayWeights: EMPTY_INTRADAY_WEIGHTS,
  risk: EMPTY_RISK,
  backtestProfile: {
    annualReturn: 0,
    maxDrawdown: 0,
    sharpe: 0,
    winRate: 0,
  },
}

export const EXECUTABLE_RADAR_STRATEGIES: RadarStrategyConfig[] = []

export const EXECUTABLE_RADAR_STRATEGY_BY_ID = new Map(
  EXECUTABLE_RADAR_STRATEGIES.map((strategy) => [strategy.id, strategy] as const),
)
