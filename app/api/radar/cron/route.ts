import { NextResponse } from "next/server"
import { isCronAuthorized } from "@/lib/cron-auth"
import { getChinaMarketSession, shouldRunRadarScan, shouldTrackRadarPrices } from "@/lib/cn-market-session"
import { refreshRadarSnapshot } from "@/lib/radar-snapshot-store"
import { trackOpenRadarSignals } from "@/lib/radar-signal-store"

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const marketSession = getChinaMarketSession()
  const canScan = shouldRunRadarScan(marketSession)
  const canTrack = shouldTrackRadarPrices(marketSession)
  const refreshed = canScan
    ? await refreshRadarSnapshot({ source: "cron", marketSession })
    : null
  const payload = refreshed?.payload
  const tracking = payload?.tracking ?? (canTrack ? await trackOpenRadarSignals({ limit: 20 }) : null)

  return NextResponse.json({
    ok: true,
    generatedAt: payload?.generatedAt ?? marketSession.now,
    skippedScan: !canScan,
    marketSession,
    tracking,
    snapshot: payload?.snapshot ?? null,
    persisted: refreshed?.persisted ?? null,
    diagnosticsSummary: payload?.diagnosticsSummary ?? null,
    topSignal: payload?.report.suggestions[0]
      ? {
          ticker: payload.report.suggestions[0].ticker,
          name: payload.report.suggestions[0].name,
          lifecycleStatus: payload.report.suggestions[0].lifecycleStatus,
          returnSinceSignalPct: payload.report.suggestions[0].returnSinceSignalPct,
        }
      : null,
  })
}
