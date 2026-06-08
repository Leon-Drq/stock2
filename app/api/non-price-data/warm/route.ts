import { NextResponse } from "next/server"
import { enforceRateLimit } from "@/lib/rate-limit"
import { DEFAULT_NON_PRICE_SOURCE_IDS, warmQverisNonPriceData } from "@/lib/qveris-non-price-data"
import type { NonPriceSourceId } from "@/lib/non-price-data-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, { namespace: "non-price-data-warm", limit: 4, windowMs: 10 * 60_000 })
  if (limited) return limited

  try {
    const body = await request.json().catch(() => ({})) as {
      sourceIds?: NonPriceSourceId[]
      symbols?: string[]
      maxCalls?: number
      sample?: boolean
      persist?: boolean
    }
    const sourceIds = Array.isArray(body.sourceIds) && body.sourceIds.length
      ? body.sourceIds.filter(isNonPriceSourceId).slice(0, 6)
      : DEFAULT_NON_PRICE_SOURCE_IDS
    const result = await warmQverisNonPriceData({
      sourceIds,
      symbols: Array.isArray(body.symbols) ? body.symbols.slice(0, 10) : undefined,
      maxCalls: Math.max(0, Math.min(24, Number(body.maxCalls) || 6)),
      sample: body.sample !== false,
      persist: body.persist !== false,
    })

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "非价格数据补齐失败" },
      { status: 500 },
    )
  }
}

function isNonPriceSourceId(value: string): value is NonPriceSourceId {
  return ["fund-flow", "north-bound", "dragon-tiger", "news", "announcement", "fin-statement"].includes(value)
}
