import { NextResponse } from "next/server"
import { getRuntimeStockPoolSummary, saveStockPoolConfig } from "@/lib/stock-pool-config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const summary = await getRuntimeStockPoolSummary()
  return NextResponse.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    ...summary,
  })
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const config = await saveStockPoolConfig(body)
    const summary = await getRuntimeStockPoolSummary()
    return NextResponse.json({
      ok: true,
      savedAt: config.updatedAt,
      ...summary,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "股票池配置保存失败" },
      { status: 500 },
    )
  }
}
