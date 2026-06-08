import { NextResponse } from "next/server"
import { isCronAuthorized } from "@/lib/cron-auth"
import { getChinaMarketSession } from "@/lib/cn-market-session"
import { runPaperTradingBatch, runPaperTradingCycle } from "@/lib/paper-trading-runner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const force = url.searchParams.get("force") === "1"
  const strategyId = url.searchParams.get("strategy")
  const marketSession = getChinaMarketSession()

  if (!strategyId) {
    const batch = await runPaperTradingBatch({
      includeBacktests: false,
      signalLimit: 500,
      quoteLimit: 8,
      accountLimit: 24,
      source: force ? "paper-trading-manual-batch" : "paper-trading-cron-batch",
    })

    return NextResponse.json({
      ok: batch.ok,
      checkedAt: batch.checkedAt,
      marketSession,
      batch: {
        updated: batch.updated,
        failed: batch.failed,
        signalCount: batch.signalCount,
        accounts: batch.accounts,
      },
    })
  }

  const cycle = await runPaperTradingCycle({
    strategyId,
    includeBacktests: false,
    signalLimit: 400,
    quoteLimit: 12,
    source: force ? "paper-trading-manual-refresh" : "paper-trading-cron",
  })

  return NextResponse.json({
    ok: cycle.ok,
    checkedAt: cycle.checkedAt,
    marketSession,
    account: {
      strategyId: cycle.account.strategyId,
      strategyName: cycle.account.strategyName,
      status: cycle.account.ledger.status ?? "active",
      startedAt: cycle.account.startedAt,
      generatedAt: cycle.account.generatedAt,
      currentEquity: cycle.account.currentEquity,
      rangeReturnPct: cycle.account.rangeReturnPct,
      openPositionCount: cycle.account.openPositionCount,
      orderCount: cycle.account.orderCount,
      closedTradeCount: cycle.account.closedTradeCount,
    },
    ledger: cycle.ledger,
    sync: cycle.sync,
    quotes: cycle.quotes,
    signalCount: cycle.signalCount,
  })
}
