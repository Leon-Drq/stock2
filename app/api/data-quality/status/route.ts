import { NextResponse } from "next/server"
import { getMarketDataQualitySnapshot } from "@/lib/backtest-data-store"
import { fetchLatestQuotes } from "@/lib/qveris-quotes"
import { STOCK_POOL } from "@/lib/stock-pool"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const includeRealtime = url.searchParams.get("realtime") === "1"
  const realtimeSamplePool = includeRealtime ? STOCK_POOL.slice(0, 5) : []
  const quality = await getMarketDataQualitySnapshot()
  const quotes = includeRealtime
    ? await fetchLatestQuotes(realtimeSamplePool, { discoverTimeoutMs: 2_000, callTimeoutMs: 5_000 })
    : null

  return NextResponse.json({
    ok: quality.status !== "error",
    checkedAt: new Date().toISOString(),
    quality,
    realtimeQuotes: {
      qverisCount: quotes?.qverisCount ?? 0,
      totalSymbols: quotes?.totalSymbols ?? realtimeSamplePool.length,
      fetchedAt: quotes?.fetchedAt ?? new Date().toISOString(),
      ttlMs: quotes?.ttlMs ?? 0,
      cacheAgeMs: quotes?.cacheAgeMs ?? 0,
      fallbackReason: quotes?.fallbackReason ?? (includeRealtime ? undefined : "实时行情采样已延后，点击刷新后采样。"),
      latestTradeStamp: quotes ? latestQuoteStamp(Array.from(quotes.quotes.values())) : null,
      missingSymbols: realtimeSamplePool
        .filter((stock) => !quotes?.quotes.has(stock.symbol))
        .slice(0, 40)
        .map(({ symbol, name, industry }) => ({ symbol, name, industry })),
    },
  })
}

function latestQuoteStamp(quotes: Array<{ tradeDate: string; tradeTime: string }>) {
  if (!quotes.length) return null
  return quotes
    .map((quote) => `${quote.tradeDate} ${quote.tradeTime}`)
    .sort()
    .at(-1)
}
