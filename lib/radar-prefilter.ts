import { getSharedPostgresClient, hasSharedPostgresConfig } from "@/lib/backtest-data-store"
import type { StockPoolItem } from "@/lib/stock-pool"

type PrefilterRow = {
  symbol: string
  latest_date: string | Date | null
  bars: number | string | null
  close: number | string | null
  change_pct: number | string | null
  amount: number | string | null
  turnover_ratio: number | string | null
  is_limit_up: boolean | null
  is_suspended: boolean | null
  ma20: number | string | null
  ma60: number | string | null
  ret20: number | string | null
  ret60: number | string | null
  volume_ratio20: number | string | null
  volatility20: number | string | null
  atr14: number | string | null
  factor_strength: number | string | null
}

export type RadarPrefilterDiagnostics = {
  source: "postgres-indicators" | "unavailable"
  inputSymbols: number
  selectedSymbols: number
  eligibleSymbols: number
  latestDate?: string
  minBars: number
  note: string
}

export type RadarPrefilterResult = {
  stocks: StockPoolItem[]
  diagnostics: RadarPrefilterDiagnostics
}

export async function selectRadarPrefilterUniverse(
  pool: StockPoolItem[],
  opts: {
    limit: number
    minBars?: number
  },
): Promise<RadarPrefilterResult> {
  const inputSymbols = pool.length
  const limit = Math.max(30, Math.min(inputSymbols, Math.floor(opts.limit)))
  const minBars = Math.max(30, opts.minBars ?? 60)
  const unavailable = (note: string): RadarPrefilterResult => ({
    stocks: pool.slice(0, limit),
    diagnostics: {
      source: "unavailable",
      inputSymbols,
      selectedSymbols: Math.min(inputSymbols, limit),
      eligibleSymbols: 0,
      minBars,
      note,
    },
  })

  if (!hasSharedPostgresConfig() || inputSymbols <= limit) {
    return unavailable(inputSymbols <= limit ? "扫描池未超过深算上限，跳过预筛。" : "Postgres 未配置，跳过预筛。")
  }

  try {
    const sql = await getSharedPostgresClient()
    const exists = await sql<{ bars_table: string | null; indicators_table: string | null }[]>`
      select to_regclass('public.stock_daily_bars')::text as bars_table,
             to_regclass('public.stock_daily_indicators')::text as indicators_table
    `
    if (!exists[0]?.bars_table || !exists[0]?.indicators_table) {
      return unavailable("数据库日线或指标表不存在，跳过预筛。")
    }

    const symbols = pool.map((stock) => stock.symbol)
    const rows = await sql<PrefilterRow[]>`
      with requested(symbol, ordinal) as (
        select * from unnest(${symbols}::text[]) with ordinality
      )
      select r.symbol,
             lb.latest_date,
             case when li.ma60 is not null then 60 when li.ma20 is not null then 20 else 0 end as bars,
             lb.close,
             lb.change_pct,
             lb.amount,
             lb.turnover_ratio,
             lb.is_limit_up,
             lb.is_suspended,
             li.ma20,
             li.ma60,
             li.ret20,
             li.ret60,
             li.volume_ratio20,
             li.volatility20,
             li.atr14,
             null::double precision as factor_strength
      from requested r
      left join lateral (
        select b.trade_date as latest_date,
               b.close,
               b.change_pct,
               b.amount,
               b.turnover_ratio,
               b.is_limit_up,
               b.is_suspended
        from stock_daily_bars b
        where b.symbol = r.symbol
        order by b.trade_date desc
        limit 1
      ) lb on true
      left join lateral (
        select i.ma20,
               i.ma60,
               i.ret20,
               i.ret60,
               i.volume_ratio20,
               i.volatility20,
               i.atr14
        from stock_daily_indicators i
        where i.symbol = r.symbol
        order by i.trade_date desc
        limit 1
      ) li on true
      order by r.ordinal asc
    `

    const bySymbol = new Map(pool.map((stock) => [stock.symbol, stock]))
    const scored = rows
      .map((row) => ({ row, score: prefilterScore(row) }))
      .filter(({ row, score }) => score > 0 && (number(row.bars) ?? 0) >= minBars && row.is_suspended !== true)
      .sort((a, b) => b.score - a.score)

    const selected = scored
      .slice(0, limit)
      .map(({ row }) => bySymbol.get(row.symbol))
      .filter((stock): stock is StockPoolItem => Boolean(stock))

    if (selected.length < 30) {
      return unavailable(`预筛可用样本不足 ${selected.length}/30，沿用前 ${limit} 只扫描池。`)
    }

    const latestDate = scored
      .map(({ row }) => formatDate(row.latest_date))
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1)

    return {
      stocks: selected,
      diagnostics: {
        source: "postgres-indicators",
        inputSymbols,
        selectedSymbols: selected.length,
        eligibleSymbols: scored.length,
        latestDate,
        minBars,
        note: `先用数据库轻量指标扫描 ${inputSymbols} 只，筛出 ${selected.length} 只做完整 K 线和策略深算。`,
      },
    }
  } catch (error) {
    return unavailable(`预筛失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

function prefilterScore(row: PrefilterRow) {
  const close = number(row.close)
  if (!close || close <= 0) return 0
  const amount = number(row.amount)
  const ma20 = number(row.ma20)
  const ma60 = number(row.ma60)
  const ret20 = number(row.ret20)
  const ret60 = number(row.ret60)
  const volumeRatio = number(row.volume_ratio20)
  const volatility20 = number(row.volatility20)
  const turnover = number(row.turnover_ratio)
  const factorStrength = number(row.factor_strength)

  const trendAlign = ma20 && ma60
    ? close > ma20 && ma20 > ma60
      ? 1
      : close > ma20
        ? 0.65
        : close > ma60
          ? 0.45
          : 0.15
    : 0.35
  const momentum20 = clamp(((ret20 ?? 0) + 0.08) / 0.3)
  const momentum60 = clamp(((ret60 ?? 0) + 0.12) / 0.45)
  const volumeScore = clamp(((volumeRatio ?? 1) - 0.8) / 2.7)
  const liquidityScore = amount && amount > 0
    ? clamp((Math.log10(amount) - 7.4) / 2.2)
    : clamp(((turnover ?? 0) - 0.5) / 5)
  const factorScore = clamp(factorStrength ?? 0)
  const riskPenalty = (volatility20 ?? 0) > 0.08 ? 0.12 : 0
  const limitPenalty = row.is_limit_up ? 0.08 : 0

  return Math.max(
    0,
    0.26 * trendAlign +
      0.2 * momentum20 +
      0.16 * momentum60 +
      0.14 * volumeScore +
      0.14 * liquidityScore +
      0.1 * factorScore -
      riskPenalty -
      limitPenalty,
  )
}

function number(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function formatDate(value: string | Date | null) {
  if (!value) return undefined
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}
