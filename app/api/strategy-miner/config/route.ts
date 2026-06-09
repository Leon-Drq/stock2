import { NextResponse } from "next/server"
import { requireAdminSession } from "@/lib/control-session"
import {
  DEFAULT_STRATEGY_MINER_CONFIG,
  getStrategyMinerConfig,
  saveStrategyMinerConfig,
} from "@/lib/strategy-miner-config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const unauthorized = await requireAdminSession(request)
  if (unauthorized) return unauthorized
  const config = await getStrategyMinerConfig()
  return NextResponse.json({ ok: true, config, defaults: DEFAULT_STRATEGY_MINER_CONFIG })
}

export async function PUT(request: Request) {
  const unauthorized = await requireAdminSession(request)
  if (unauthorized) return unauthorized
  const body = await request.json().catch(() => null)
  const { config, persisted } = await saveStrategyMinerConfig(body)
  return NextResponse.json({ ok: true, config, persisted })
}
