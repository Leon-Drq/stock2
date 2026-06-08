import { NextResponse } from "next/server"
import { isCronAuthorized } from "@/lib/cron-auth"
import { runStrategyMining } from "@/lib/strategy-miner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const report = await runStrategyMining({
    persist: true,
    maxCandidates: 28,
    githubLimitPerQuery: 5,
    immediateBacktestLimit: 12,
  })

  return NextResponse.json({
    ok: true,
    generatedAt: report.generatedAt,
    summary: report.summary,
    store: report.store,
  })
}
