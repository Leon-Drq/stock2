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

  const url = new URL(request.url)
  const limit = Math.max(4, Math.min(30, Number(url.searchParams.get("limit")) || 18))
  const githubLimitPerQuery = Math.max(1, Math.min(8, Number(url.searchParams.get("githubLimit")) || 4))
  const immediateBacktestLimit = Math.max(0, Math.min(limit, Number(url.searchParams.get("immediateLimit")) || Math.min(12, limit)))
  const report = await runStrategyMining({
    persist: true,
    maxCandidates: limit,
    githubLimitPerQuery,
    immediateBacktestLimit,
  })

  return NextResponse.json({
    ok: true,
    generatedAt: report.generatedAt,
    summary: report.summary,
    store: report.store,
    top: report.candidates.slice(0, 8).map((candidate) => ({
      candidateId: candidate.candidateId,
      strategyId: candidate.strategy.id,
      name: candidate.strategy.name,
      status: candidate.status,
      source: candidate.source.name,
      research: candidate.research,
      annualReturn: candidate.metrics?.annualReturn,
      maxDrawdown: candidate.metrics?.maxDrawdown,
      sharpe: candidate.metrics?.sharpe,
      admission: candidate.report?.diagnosis.admission,
      incubation: candidate.incubation
        ? {
            score: candidate.incubation.score,
            gate: candidate.incubation.gate,
            overfitRisk: candidate.incubation.overfitRisk,
            marketCoverage: candidate.incubation.marketCoverage,
            walkForward: candidate.incubation.walkForward,
          }
        : null,
    })),
  })
}
