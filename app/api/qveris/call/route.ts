import { NextResponse } from "next/server"
import { call } from "@/lib/qveris"
import { enforceRateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, { namespace: "qveris-call", limit: 20, windowMs: 60_000 })
  if (limited) return limited

  try {
    const body = (await req.json().catch(() => ({}))) as {
      tool_id?: string
      search_id?: string
      parameters?: Record<string, unknown>
      session_id?: string
      max_response_size?: number
    }

    if (!body.tool_id || !body.search_id) {
      return NextResponse.json({ error: "tool_id 与 search_id 均为必填" }, { status: 400 })
    }

    const result = await call(
      body.tool_id,
      body.search_id,
      body.parameters ?? {},
      body.session_id,
      body.max_response_size,
      undefined,
      {
        source: "manual-qveris-call",
        category: "manual",
        route: "/api/qveris/call",
      },
    )
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
