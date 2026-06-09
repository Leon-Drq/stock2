import { readSharedCache, writeSharedCache } from "@/lib/backtest-data-store"

export type StrategyMinerConfig = {
  githubEnabled: boolean
  githubLimitPerQuery: number
  maxCandidates: number
  immediateBacktestLimit: number
  queries: string[]
}

export const DEFAULT_STRATEGY_MINER_QUERIES = [
  "quant trading strategy stock momentum language:Python",
  "backtrader momentum strategy language:Python",
  "rsi mean reversion trading strategy language:Python",
  "turtle trading donchian breakout language:Python",
  "bollinger bands strategy backtest language:Python",
  "macd trading strategy backtest language:Python",
]

export const DEFAULT_STRATEGY_MINER_CONFIG: StrategyMinerConfig = {
  githubEnabled: process.env.STRATEGY_MINER_DISABLE_GITHUB !== "1",
  githubLimitPerQuery: 4,
  maxCandidates: 18,
  immediateBacktestLimit: 12,
  queries: DEFAULT_STRATEGY_MINER_QUERIES,
}

const CACHE_KEY = "stock-radar:strategy-miner:config:v1"
const CONFIG_TTL_SECONDS = 60 * 60 * 24 * 365 * 10

export async function getStrategyMinerConfig(): Promise<StrategyMinerConfig> {
  const raw = await readSharedCache(CACHE_KEY)
  if (!raw) return normalizeStrategyMinerConfig()
  try {
    return normalizeStrategyMinerConfig(JSON.parse(raw))
  } catch {
    return normalizeStrategyMinerConfig()
  }
}

export async function saveStrategyMinerConfig(input: unknown) {
  const config = normalizeStrategyMinerConfig(input)
  const persisted = await writeSharedCache(CACHE_KEY, JSON.stringify(config), CONFIG_TTL_SECONDS)
  return { config, persisted }
}

export function normalizeStrategyMinerConfig(input?: unknown): StrategyMinerConfig {
  const obj = input && typeof input === "object" && !Array.isArray(input) ? input as Partial<StrategyMinerConfig> : {}
  const maxCandidates = clampInt(obj.maxCandidates, 4, 30, DEFAULT_STRATEGY_MINER_CONFIG.maxCandidates)
  return {
    githubEnabled: typeof obj.githubEnabled === "boolean" ? obj.githubEnabled : DEFAULT_STRATEGY_MINER_CONFIG.githubEnabled,
    githubLimitPerQuery: clampInt(obj.githubLimitPerQuery, 1, 8, DEFAULT_STRATEGY_MINER_CONFIG.githubLimitPerQuery),
    maxCandidates,
    immediateBacktestLimit: clampInt(obj.immediateBacktestLimit, 0, maxCandidates, Math.min(DEFAULT_STRATEGY_MINER_CONFIG.immediateBacktestLimit, maxCandidates)),
    queries: normalizeQueries(obj.queries),
  }
}

function normalizeQueries(value: unknown) {
  const source = Array.isArray(value) ? value : DEFAULT_STRATEGY_MINER_QUERIES
  const seen = new Set<string>()
  const queries: string[] = []
  for (const item of source) {
    if (typeof item !== "string") continue
    const query = item.trim().replace(/\s+/g, " ")
    if (!query || seen.has(query)) continue
    seen.add(query)
    queries.push(query)
    if (queries.length >= 12) break
  }
  return queries.length ? queries : DEFAULT_STRATEGY_MINER_QUERIES
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(Math.trunc(parsed), max))
}
