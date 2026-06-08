import { NextResponse } from "next/server"
import { loadSignalIntegritySnapshot } from "@/lib/signal-integrity"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

export async function GET() {
  try {
    const snapshot = await loadSignalIntegritySnapshot()
    return NextResponse.json({
      ok: snapshot.status !== "critical",
      ...snapshot,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
