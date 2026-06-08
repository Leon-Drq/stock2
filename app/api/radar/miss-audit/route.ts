import { NextResponse } from "next/server"
import { buildMissedMoveAudit } from "@/lib/missed-move-audit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const input = typeof body.input === "string" ? body.input : ""

  if (!input.trim()) {
    return NextResponse.json(
      { ok: false, error: "请输入股票名称或代码，用于检查是否在统一扫描链路内。" },
      { status: 400 },
    )
  }

  const report = await buildMissedMoveAudit(input)
  return NextResponse.json({ ok: true, report })
}
