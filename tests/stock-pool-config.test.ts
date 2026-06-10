import assert from "node:assert/strict"
import test from "node:test"

import { buildRuntimeStockPool, normalizeConfig } from "@/lib/stock-pool-config"

test("normalizeConfig cleans manual includes and exclusions", () => {
  const config = normalizeConfig({
    targetSize: "60",
    include: [
      { symbol: "688365", name: "光云科技", industry: "软件开发" },
      { symbolQveris: "688365.SH", name: "重复", industry: "软件开发" },
    ],
    excludeSymbols: ["600519.SH", "600519"],
    filters: {
      exchanges: ["SH", "bad"],
      industries: ["银行Ⅱ", ""],
      symbolPrefixes: ["6000", " 601 "],
      minBars: "90",
      maxStaleDays: "",
    },
  })

  assert.equal(config.targetSize, 60)
  assert.equal(config.include.length, 1)
  assert.deepEqual(config.excludeSymbols, ["600519"])
  assert.deepEqual(config.filters.exchanges, ["SH"])
  assert.deepEqual(config.filters.industries, ["银行Ⅱ"])
  assert.deepEqual(config.filters.symbolPrefixes, ["600", "601"])
  assert.equal(config.filters.minBars, 90)
  assert.equal(config.filters.maxStaleDays, null)
})

test("buildRuntimeStockPool applies static filters, manual include, exclude, and target size", async () => {
  const result = await buildRuntimeStockPool(normalizeConfig({
    targetSize: 30,
    include: [{ symbol: "688365", name: "光云科技", industry: "软件开发" }],
    excludeSymbols: ["601939"],
    filters: {
      exchanges: ["SH"],
      industries: [],
      symbolPrefixes: ["601"],
      requireHistory: false,
      minBars: 0,
      maxStaleDays: null,
    },
  }))

  assert.equal(result.stocks.length, 30)
  assert.equal(result.stocks.some((stock) => stock.symbol === "688365"), true)
  assert.equal(result.stocks.some((stock) => stock.symbol === "601939"), false)
  assert.equal(result.manualIncludeCount, 1)
  assert.equal(result.excludedCount, 1)
})
