import { NextResponse } from "next/server"
import { resolveWithFallback } from "@/lib/async-timeout"
import { runCustomDraftBacktest } from "@/lib/backtest"
import { syncStrategyRegistryFromReports } from "@/lib/strategy-registry-store"
import type { StrategyDraft } from "@/lib/strategy-lab"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const draft = body?.draft as StrategyDraft | undefined
    if (!draft?.name || !draft.dsl) {
      return NextResponse.json({ error: "缺少策略草稿" }, { status: 400 })
    }

    const report = await runCustomDraftBacktest(draft)
    await resolveWithFallback(syncStrategyRegistryFromReports([report]), {
      timeoutMs: 1_000,
      // 自定义回测结果返回给前端是主路径；注册表同步失败时由回测页/任务中心后续补偿。
      onFallback: () => [],
    })
    return NextResponse.json({ report })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "自定义策略回测失败" },
      { status: 500 },
    )
  }
}
