import { NextResponse } from "next/server"
import { getMarketDataQualitySnapshot } from "@/lib/backtest-data-store"
import { fetchLatestQuotes } from "@/lib/qveris-quotes"
import { STOCK_POOL } from "@/lib/stock-pool"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const realtimeSamplePool = STOCK_POOL.slice(0, 10)
  const [quality, quotes] = await Promise.all([
    getMarketDataQualitySnapshot(),
    fetchLatestQuotes(realtimeSamplePool, { discoverTimeoutMs: 10_000, callTimeoutMs: 30_000 }),
  ])

  return NextResponse.json({
    ok: quality.status !== "error",
    checkedAt: new Date().toISOString(),
    quality,
    realtimeQuotes: {
      qverisCount: quotes.qverisCount,
      totalSymbols: quotes.totalSymbols,
      fetchedAt: quotes.fetchedAt,
      ttlMs: quotes.ttlMs,
      cacheAgeMs: quotes.cacheAgeMs,
      fallbackReason: quotes.fallbackReason,
      latestTradeStamp: latestQuoteStamp(Array.from(quotes.quotes.values())),
      missingSymbols: realtimeSamplePool
        .filter((stock) => !quotes.quotes.has(stock.symbol))
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
