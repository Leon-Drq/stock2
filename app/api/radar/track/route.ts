import { NextResponse } from "next/server"
import { isCronAuthorized } from "@/lib/cron-auth"
import { getChinaMarketSession, shouldTrackRadarPrices } from "@/lib/cn-market-session"
import { runPaperTradingBatch } from "@/lib/paper-trading-runner"
import { trackOpenRadarSignals } from "@/lib/radar-signal-store"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const limitParam = new URL(request.url).searchParams.get("limit")
  const force = new URL(request.url).searchParams.get("force") === "1"
  const limit = limitParam ? Number(limitParam) : undefined
  const marketSession = getChinaMarketSession()
  if (!force && !shouldTrackRadarPrices(marketSession)) {
    return NextResponse.json({
      ok: true,
      checkedAt: marketSession.now,
      skipped: true,
      reason: marketSession.note,
      marketSession,
      tracking: null,
    })
  }
  const [tracking, paperTrading] = await Promise.all([
    trackOpenRadarSignals({ limit: Number.isFinite(limit) ? limit : undefined }),
    runPaperTradingBatch({
      includeBacktests: false,
      signalLimit: 500,
      quoteLimit: 8,
      accountLimit: 10,
      source: "radar-track-cron-batch",
    }).catch((error) => ({
      ok: false,
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    })),
  ])

  const paperTradingPayload = "accounts" in paperTrading
    ? {
        ok: paperTrading.ok,
        checkedAt: paperTrading.checkedAt,
        updated: paperTrading.updated,
        failed: paperTrading.failed,
        signalCount: paperTrading.signalCount,
        accounts: paperTrading.accounts,
      }
    : paperTrading

  return NextResponse.json({
    ok: tracking.ok,
    checkedAt: tracking.checkedAt,
    marketSession,
    tracking,
    paperTrading: paperTradingPayload,
  })
}
