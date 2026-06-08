import { NextResponse } from "next/server"
import { enforceRateLimit } from "@/lib/rate-limit"
import { createBacktestJob, getStrategyRegistrySnapshot, type BacktestJobKind } from "@/lib/strategy-registry-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const snapshot = await getStrategyRegistrySnapshot()
  return NextResponse.json(snapshot)
}

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, { namespace: "backtest-jobs-create", limit: 6, windowMs: 60_000 })
  if (limited) return limited

  try {
    const body = await request.json().catch(() => ({}))
    const kind = normalizeKind(body?.kind)
    const strategyId = typeof body?.strategyId === "string" ? body.strategyId : undefined
    const strategyName = typeof body?.strategyName === "string" ? body.strategyName : undefined
    if (kind === "mine" && !strategyId) {
      return NextResponse.json({ ok: false, error: "矿工回测任务缺少 strategyId" }, { status: 400 })
    }
    const job = await createBacktestJob({
      kind,
      strategyId,
      strategyName,
      source: kind === "mine" ? "miner" : "catalog",
    })
    const snapshot = await getStrategyRegistrySnapshot()
    return NextResponse.json({ ok: true, job, snapshot })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "创建回测任务失败" },
      { status: 500 },
    )
  }
}

function normalizeKind(value: unknown): BacktestJobKind {
  return value === "mine" ? "mine" : "catalog"
}
