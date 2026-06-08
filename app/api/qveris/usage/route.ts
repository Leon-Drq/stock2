import { NextResponse } from "next/server"
import { getQverisUsageSummary } from "@/lib/qveris-usage-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const days = Number(url.searchParams.get("days") ?? 7)
  const limit = Number(url.searchParams.get("limit") ?? 80)
  const summary = await getQverisUsageSummary({ days, limit })
  return NextResponse.json(summary)
}
