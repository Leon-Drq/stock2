import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { clearHealthCache } from "@/lib/data-health"
import { enforceRateLimit } from "@/lib/rate-limit"

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, { namespace: "data-health-refresh", limit: 10, windowMs: 60_000 })
  if (limited) return limited

  clearHealthCache()
  revalidatePath("/data")
  return NextResponse.json({ ok: true, refreshedAt: new Date().toISOString() })
}
