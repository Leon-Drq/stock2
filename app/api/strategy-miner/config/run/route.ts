import { NextResponse } from "next/server"
import { requireAdminSession } from "@/lib/control-session"
import { enforceRateLimit } from "@/lib/rate-limit"
import { getStrategyMinerConfig } from "@/lib/strategy-miner-config"
import { runStrategyMining } from "@/lib/strategy-miner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Invalid origin" }, { status: 403 })
  }
  const unauthorized = await requireAdminSession(request)
  if (unauthorized) return unauthorized
  const limited = enforceRateLimit(request, {
    namespace: "strategy-miner-config-run",
    limit: 4,
    windowMs: 60_000,
  })
  if (limited) return limited

  const config = await getStrategyMinerConfig()
  const report = await runStrategyMining({
    persist: true,
    config,
    maxCandidates: config.maxCandidates,
    githubLimitPerQuery: config.githubLimitPerQuery,
    immediateBacktestLimit: config.immediateBacktestLimit,
  })

  return NextResponse.json({
    ok: true,
    generatedAt: report.generatedAt,
    summary: report.summary,
    store: report.store,
  })
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin")
  if (!origin) return true
  const url = new URL(request.url)
  return origin === `${url.protocol}//${url.host}`
}
