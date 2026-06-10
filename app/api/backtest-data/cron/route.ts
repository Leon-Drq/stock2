import { NextResponse } from "next/server"
import { getBacktestDataStoreSnapshot } from "@/lib/backtest-data-store"
import { buildBacktestWarmPlan } from "@/lib/backtest-data-warm"
import { getChinaMarketSession } from "@/lib/cn-market-session"
import { isCronAuthorized } from "@/lib/cron-auth"
import { fetchMarketIndexes } from "@/lib/market-indexes"
import { fetchPoolBars } from "@/lib/qveris-data"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const limit = Math.max(1, Math.min(5, Number(url.searchParams.get("limit")) || 5))
  const refresh = url.searchParams.get("refresh") === "1"
  const marketSession = getChinaMarketSession()
  const before = await getBacktestDataStoreSnapshot()
  const offset = Math.min(before.totalSymbols, Math.max(0, (before.stockPoolSymbols ?? before.totalSymbols) - 1))
  const plan = await buildBacktestWarmPlan({ mode: "missing", offset, limit })
  const result = plan.pool.length
    ? await fetchPoolBars({
        lookbackDays: plan.lookbackDays,
        useReal: true,
        pool: plan.pool,
        refresh: refresh || plan.refresh,
      })
    : null
  const indexes = await fetchMarketIndexes({ refresh: true }).catch((error) => ({
    source: "unavailable" as const,
    fallbackReason: error instanceof Error ? error.message : "指数基准拉取失败",
  }))
  const after = await getBacktestDataStoreSnapshot()

  return NextResponse.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    marketSession,
    plan: {
      mode: plan.mode,
      reason: plan.reason,
      symbols: plan.pool.map((stock) => ({ symbol: stock.symbol, name: stock.name })),
      limit: plan.limit,
      offset: plan.offset,
      missingCount: plan.missingCount,
      staleCount: plan.staleCount,
      selectedStaleCount: plan.selectedStaleCount,
      refresh: refresh || plan.refresh,
      lookbackDays: plan.lookbackDays,
    },
    warmed: result
      ? {
          symbols: plan.pool.length,
          qverisCount: result.qverisCount,
          databaseCount: result.databaseCount ?? 0,
          mockCount: result.mockCount,
          fallbackReason: result.fallbackReason,
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
        }
      : null,
    coverage: {
      before: `${before.totalSymbols}/${before.stockPoolSymbols ?? before.totalSymbols}`,
      after: `${after.totalSymbols}/${after.stockPoolSymbols ?? after.totalSymbols}`,
      barRows: after.totalBars,
      latestDate: after.marketData?.latestDate,
      calendarRows: after.marketData?.calendarRows,
      indexRows: after.marketData?.indexRows,
    },
    indexes: {
      source: indexes.source,
      fallbackReason: indexes.fallbackReason,
    },
  })
}
