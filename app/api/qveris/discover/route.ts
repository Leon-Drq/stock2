import { NextResponse } from "next/server"
import { discover } from "@/lib/qveris"
import { enforceRateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, { namespace: "qveris-discover", limit: 30, windowMs: 60_000 })
  if (limited) return limited

  try {
    const body = (await req.json().catch(() => ({}))) as {
      query?: string
      limit?: number
      session_id?: string
    }
    const query = (body.query ?? "").trim()
    if (!query) {
      return NextResponse.json({ error: "query 不能为空" }, { status: 400 })
    }

    const result = await discover(query, body.session_id, body.limit ?? 12)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
