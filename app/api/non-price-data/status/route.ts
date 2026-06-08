import { NextResponse } from "next/server"
import { getNonPriceCoverageSnapshot } from "@/lib/non-price-data-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const coverage = await getNonPriceCoverageSnapshot()
  return NextResponse.json({
    ok: coverage.status !== "error",
    coverage,
  })
}
