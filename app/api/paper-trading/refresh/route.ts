import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { runPaperTradingCycle } from "@/lib/paper-trading-runner"
import { enforceRateLimit } from "@/lib/rate-limit"
import type { PaperRange } from "@/lib/paper-trading"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, { namespace: "paper-trading-refresh", limit: 8, windowMs: 60_000 })
  if (limited) return limited

  if (!isSameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })
  }

  const body = await readJson(request)
  const strategyId = typeof body.strategyId === "string" ? body.strategyId.trim() : ""
  if (!strategyId) {
    return NextResponse.json({ ok: false, error: "缺少 strategyId，无法刷新模拟盘。" }, { status: 400 })
  }

  const range = normalizeRange(typeof body.range === "string" ? body.range : undefined)
  const startedAt = typeof body.startedAt === "string" ? body.startedAt : undefined
  const cycle = await runPaperTradingCycle({
    strategyId,
    range,
    startedAt,
    includeBacktests: false,
    signalLimit: 500,
    quoteLimit: 12,
    source: "simulation-auto-refresh",
  })

  revalidatePath("/simulation")

  return NextResponse.json({
    ok: cycle.ok,
    checkedAt: cycle.checkedAt,
    strategyId: cycle.account.strategyId,
    strategyName: cycle.account.strategyName,
    signalCount: cycle.signalCount,
    orderCount: cycle.account.orderCount,
    openPositionCount: cycle.account.openPositionCount,
    closedTradeCount: cycle.account.closedTradeCount,
    sync: cycle.sync,
    quotes: cycle.quotes,
  })
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json()
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function normalizeRange(value?: string): PaperRange {
  if (value === "1m" || value === "3m" || value === "all") return value
  return "3m"
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin")
  if (!origin) return true
  const host = request.headers.get("host")
  if (!host) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}
