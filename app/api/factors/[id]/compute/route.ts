/**
 * POST /api/factors/[id]/compute
 *
 * Body: { useReal?: boolean, lookbackDays?: number }
 *
 * 流程：
 *   1. 按 useReal 决定调 Qveris 还是用 mock
 *   2. 拉股票池所有股票的 K 线
 *   3. 跑因子引擎，返回完整的 IC 时序 + 统计 + 选股快照
 *
 * 任何错误都返回 200 + { ok: false, error }，避免客户端要做 5xx 处理。
 */
import { NextResponse } from "next/server"
import { fetchPoolBars } from "@/lib/qveris-data"
import { runFactor, type FactorId, FACTOR_CONFIGS } from "@/lib/factors/engine"

const VALID_IDS = new Set<FactorId>([
  "f-mom-60d",
  "f-rev-5d",
  "f-vol-spike",
  "f-tight-breakout",
  "f-atr-compression",
  "f-absolute-momentum",
])

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  if (!VALID_IDS.has(id as FactorId)) {
    return NextResponse.json({
      ok: false,
      error: `因子 ${id} 暂不支持实时计算，当前可用：${Array.from(VALID_IDS).join(", ")}`,
      supportedIds: Array.from(VALID_IDS),
    })
  }

  let body: { useReal?: boolean; lookbackDays?: number } = {}
  try {
    body = await req.json()
  } catch {
    // 空 body 也接受
  }

  const useReal = body.useReal === true
  const lookbackDays = typeof body.lookbackDays === "number" ? body.lookbackDays : 120

  try {
    const fetchResult = await fetchPoolBars({ useReal, lookbackDays, databaseOnly: useReal })
    const factorResult = runFactor(fetchResult.stocks, id as FactorId)

    return NextResponse.json({
      ok: true,
      factorId: id,
      factor: FACTOR_CONFIGS[id as FactorId],
      computedAt: new Date().toISOString(),
      dataSource: {
        useReal,
        qverisCount: fetchResult.qverisCount,
        databaseCount: fetchResult.databaseCount ?? 0,
        mockCount: fetchResult.mockCount,
        fallbackReason: fetchResult.fallbackReason,
        durationMs:
          new Date(fetchResult.finishedAt).getTime() -
          new Date(fetchResult.startedAt).getTime(),
        // 每只股的来源 + tool_id
        bySymbol: fetchResult.stocks.map((s) => ({
          symbol: s.symbol,
          name: s.name,
          source: s.source,
          toolId: s.toolId,
          toolName: s.toolName,
          error: s.error,
          barCount: s.bars.length,
        })),
      },
      stats: {
        meanIC: factorResult.meanIC,
        irAnnualized: factorResult.irAnnualized,
        q1q5Pct: factorResult.q1q5Pct,
        winRatePct: factorResult.winRatePct,
        symbolCount: factorResult.symbolCount,
        observationDays: factorResult.observationDays,
      },
      dailyIC: factorResult.dailyIC,
      cumulativeIC: factorResult.cumulativeIC,
      snapshots: factorResult.snapshots,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg })
  }
}
