import { NextResponse } from "next/server"
import { loadStrategyRuntimeSnapshot } from "@/lib/strategy-runtime"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

export async function GET() {
  const snapshot = await loadStrategyRuntimeSnapshot()
  return NextResponse.json({
    ok: true,
    ...snapshot,
    strategies: snapshot.rows.map((row) => ({
      strategyId: row.strategyId,
      name: row.name,
      health: row.health,
      healthLabel: row.healthLabel,
      lane: row.lane,
      score: row.score,
      annualReturn: row.annualReturn,
      maxDrawdown: row.maxDrawdown,
      todaySignals: row.todaySignals,
      openSignals: row.openSignals,
      orderCount: row.orderCount,
      todayOrders: row.todayOrders,
      positionCount: row.positionCount,
      lastSignalAt: row.lastSignalAt,
      lastPaperSyncAt: row.lastPaperSyncAt,
    })),
  })
}
