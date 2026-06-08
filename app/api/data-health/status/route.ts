import { NextResponse } from "next/server"
import { getHealthReport } from "@/lib/data-health"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const report = await getHealthReport()
  const maxAge = report.rateLimitedCount > 0 ? 60 : 300
  return NextResponse.json(
    { ok: true, report },
    {
      headers: {
        "Cache-Control": `public, s-maxage=${maxAge}, stale-while-revalidate=1800`,
      },
    },
  )
}
