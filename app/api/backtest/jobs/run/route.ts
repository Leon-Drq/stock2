import { NextResponse } from "next/server"
import { isCronAuthorized } from "@/lib/cron-auth"
import { runNextBacktestJob } from "@/lib/backtest-job-runner"
import { createBacktestJob, getStrategyRegistrySnapshot } from "@/lib/strategy-registry-store"
import { enforceRateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }
  const url = new URL(request.url)
  const ensureCatalog = url.searchParams.get("ensure") === "catalog"
  if (ensureCatalog) await createBacktestJob({ kind: "catalog", source: "catalog" })
  const result = await runNextBacktestJob(url.searchParams.get("jobId") ?? undefined)
  const snapshot = await getStrategyRegistrySnapshot()
  return NextResponse.json({ ...result, snapshot })
}

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, { namespace: "backtest-jobs-run", limit: 4, windowMs: 10 * 60_000 })
  if (limited) return limited

  try {
    const body = await request.json().catch(() => ({}))
    const jobId = typeof body?.jobId === "string" ? body.jobId : undefined
    const result = await runNextBacktestJob(jobId)
    const snapshot = await getStrategyRegistrySnapshot()
    return NextResponse.json({ ...result, snapshot }, { status: result.ok ? 200 : 500 })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "运行回测任务失败" },
      { status: 500 },
    )
  }
}
