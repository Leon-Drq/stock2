import { NextResponse } from "next/server"
import { isCronAuthorized } from "@/lib/cron-auth"
import { runNextBacktestJob } from "@/lib/backtest-job-runner"
import { createBacktestJob, getStrategyRegistrySnapshot } from "@/lib/strategy-registry-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }
  const job = await createBacktestJob({ kind: "catalog", source: "catalog" })
  const result = await runNextBacktestJob(job.jobId)
  const snapshot = await getStrategyRegistrySnapshot()
  return NextResponse.json({ ...result, snapshot })
}
