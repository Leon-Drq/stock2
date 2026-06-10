import assert from "node:assert/strict"
import test from "node:test"
import {
  buildMarketIndexDiagnostics,
  parseMarketIndexQuotes,
  type MarketIndexesResult,
} from "../lib/market-indexes"

test("parseMarketIndexQuotes handles nested Qveris payloads and mixed code formats", () => {
  const quotes = parseMarketIndexQuotes({
    data: {
      rows: [
        {
          stockCode: "SH000001",
          latestPrice: "3234.56",
          changePCT: "0.42",
          tradeDate: "20260610",
          tradeTime: "14:59:00",
        },
        {
          thscode: "399001.SZ",
          latest: 10234.12,
          changeRatio: -0.31,
          date: "2026/06/10",
          time: "15:00:00",
        },
        [
          {
            code: "399006",
            price: "2012.30",
            pct_chg: "1.23",
            date: "2026-06-10",
          },
          {
            symbol: "000905.SH",
            close: "5321.09",
            change_pct: "-0.08",
            tradeDate: "2026-06-10",
          },
        ],
      ],
    },
  })

  assert.equal(quotes.length, 4)
  assert.deepEqual(
    quotes.map((quote) => [quote.codeQveris, quote.value, quote.changePct, quote.tradeDate]),
    [
      ["000001.SH", 3234.56, 0.42, "2026-06-10"],
      ["399001.SZ", 10234.12, -0.31, "2026-06-10"],
      ["399006.SZ", 2012.3, 1.23, "2026-06-10"],
      ["000905.SH", 5321.09, -0.08, "2026-06-10"],
    ],
  )
})

test("parseMarketIndexQuotes returns null-valued specs for missing index rows", () => {
  const quotes = parseMarketIndexQuotes([
    { thscode: "000001.SH", latest: 3200, changeRatio: 0.1, tradeDate: "2026-06-10" },
  ])

  assert.equal(quotes.length, 4)
  assert.equal(quotes[0].value, 3200)
  assert.equal(quotes[1].value, null)
  assert.equal(quotes[2].value, null)
  assert.equal(quotes[3].value, null)
})

test("buildMarketIndexDiagnostics marks stale and missing index quotes", () => {
  const result: MarketIndexesResult = {
    source: "database",
    fetchedAt: "2026-06-10T01:00:00.000Z",
    cacheAgeMs: 11 * 60_000,
    ttlMs: 5 * 60_000,
    quotes: [
      {
        code: "000001",
        codeQveris: "000001.SH",
        name: "上证指数",
        value: 3200,
        changePct: 0.1,
        tradeDate: "2026-06-09",
      },
      {
        code: "399001",
        codeQveris: "399001.SZ",
        name: "深证成指",
        value: null,
        changePct: null,
      },
    ],
  }

  const diagnostics = buildMarketIndexDiagnostics(result, "2026-06-10")

  assert.equal(diagnostics.validCount, 1)
  assert.equal(diagnostics.totalCount, 4)
  assert.equal(diagnostics.staleCount, 2)
  assert.deepEqual(diagnostics.quotes[0].staleReasons, [
    "trade-date-before-2026-06-10",
    "cache-age-exceeded",
  ])
  assert.deepEqual(diagnostics.quotes[1].staleReasons, [
    "missing-value",
    "missing-trade-date",
    "cache-age-exceeded",
  ])
})
