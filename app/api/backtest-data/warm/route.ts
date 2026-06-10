import { NextResponse } from "next/server"
import { getBacktestDataStoreSnapshot } from "@/lib/backtest-data-store"
import { buildBacktestWarmPlan, type BacktestWarmMode } from "@/lib/backtest-data-warm"
import { fetchMarketIndexes } from "@/lib/market-indexes"
import { fetchPoolBars } from "@/lib/qveris-data"
import { enforceRateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, { namespace: "backtest-data-warm", limit: 4, windowMs: 10 * 60_000 })
  if (limited) return limited

  try {
    const body = await request.json().catch(() => ({})) as {
      limit?: number
      offset?: number
      lookbackDays?: number
      refresh?: boolean
      mode?: BacktestWarmMode
    }
    const limit = Math.max(1, Math.min(25, Number(body.limit) || 10))
    const offset = Math.max(0, Number(body.offset) || 0)
    const plan = await buildBacktestWarmPlan({
      mode: body.mode === "offset" ? "offset" : "missing",
      offset,
      limit,
    })
    const lookbackDays = body.lookbackDays
      ? Math.max(60, Math.min(750, Number(body.lookbackDays) || plan.lookbackDays))
      : plan.lookbackDays
    const pool = plan.pool
    const result = await fetchPoolBars({
      lookbackDays,
      useReal: true,
      pool,
      refresh: body.refresh === true || plan.refresh,
    })
    const indexes = await fetchMarketIndexes({ refresh: body.refresh === true }).catch((error) => ({
      source: "unavailable" as const,
      fallbackReason: error instanceof Error ? error.message : "指数基准拉取失败",
    }))
    const snapshot = await getBacktestDataStoreSnapshot()

    return NextResponse.json({
      ok: true,
      warmed: {
        mode: plan.mode,
        reason: plan.reason,
        offset: plan.offset,
        symbols: pool.length,
        lookbackDays,
        qverisCount: result.qverisCount,
        databaseCount: result.databaseCount ?? 0,
        mockCount: result.mockCount,
        fallbackReason: result.fallbackReason,
        refresh: body.refresh === true || plan.refresh,
        selectedStaleCount: plan.selectedStaleCount ?? 0,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
      },
      indexes: {
        source: indexes.source,
        fallbackReason: indexes.fallbackReason,
      },
      snapshot,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "回测数据预热失败" },
      { status: 500 },
    )
  }
}
