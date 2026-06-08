import { NextResponse } from "next/server"
import { getBacktestDataStoreSnapshot } from "@/lib/backtest-data-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const snapshot = await getBacktestDataStoreSnapshot()
  return NextResponse.json(snapshot)
}
