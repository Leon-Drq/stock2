import { NextResponse } from "next/server"
import { buildStockDiagnosis } from "@/lib/stock-diagnosis"
import { enforceRateLimit } from "@/lib/rate-limit"
import type { ProviderId } from "@/lib/model-providers"

export const dynamic = "force-dynamic"

type DiagnosisRequest = {
  query?: string
  includeAi?: boolean
  question?: string
  provider?: ProviderId
  baseUrl?: string
  model?: string
  apiKey?: string
}

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, { namespace: "stock-diagnosis", limit: 20, windowMs: 60_000 })
  if (limited) return limited

  let body: DiagnosisRequest
  try {
    body = await req.json() as DiagnosisRequest
  } catch {
    return NextResponse.json({ ok: false, error: "请求体不是有效 JSON" }, { status: 400 })
  }

  const query = body.query?.trim()
  if (!query) {
    return NextResponse.json({ ok: false, error: "请输入股票名称或 6 位代码" }, { status: 400 })
  }

  const result = await buildStockDiagnosis({
    query,
    includeAi: body.includeAi !== false,
    question: body.question?.trim() || undefined,
    provider: body.provider,
    baseUrl: body.baseUrl,
    model: body.model,
    apiKey: body.apiKey,
  })

  return NextResponse.json(result, { status: result.ok ? 200 : 404 })
}
