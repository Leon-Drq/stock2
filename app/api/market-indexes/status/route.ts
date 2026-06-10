import { NextResponse } from "next/server"
import { getMarketIndexDiagnostics } from "@/lib/market-indexes"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const refresh = url.searchParams.get("refresh") === "1"
  const diagnostics = await getMarketIndexDiagnostics({
    refresh,
    timeoutMs: refresh ? 8_000 : undefined,
  })

  return NextResponse.json({
    ok: diagnostics.source !== "unavailable" && diagnostics.validCount > 0,
    checkedAt: new Date().toISOString(),
    refresh,
    diagnostics,
  })
}
