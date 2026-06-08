import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

import { buildBacktestWarmPlan } from "../lib/backtest-data-warm"
import { getMarketDataQualitySnapshot } from "../lib/backtest-data-store"
import { fetchPoolBars } from "../lib/qveris-data"

type Args = {
  batch: number
  maxBatches: number
  lookbackDays: number
  delayMs: number
  refresh: boolean
}

loadEnvLocal()

const args = parseArgs(process.argv.slice(2))

if (!process.env.QVERIS_API_KEY) {
  throw new Error("QVERIS_API_KEY is missing. Add it to .env.local or export it before running.")
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing. Add it to .env.local or export it before running.")
}

console.log(
  `[warm] start batch=${args.batch} maxBatches=${args.maxBatches} lookbackDays=${args.lookbackDays || "auto"} delayMs=${args.delayMs} refresh=${args.refresh}`,
)

main()
  .then(() => {
    process.exit(0)
  })
  .catch((error) => {
    console.error("[warm] failed", error)
    process.exit(1)
  })

async function main() {
  let previousCovered = -1

  for (let i = 0; i < args.maxBatches; i++) {
    const before = await getMarketDataQualitySnapshot()
    const missingCount = Math.max(0, before.stockPoolSymbols - before.coveredStockPoolSymbols)
    const staleCount = before.staleSymbols.length

    console.log(
      `[warm] batch ${i + 1}/${args.maxBatches} before covered=${before.coveredStockPoolSymbols}/${before.stockPoolSymbols} missing=${missingCount} stale=${staleCount} rows=${before.barRows}`,
    )

    if (missingCount === 0 && staleCount === 0) {
      console.log("[warm] complete: no missing or stale symbols remain.")
      break
    }

    const plan = await buildBacktestWarmPlan({
      mode: "missing",
      limit: args.batch,
    })

    if (!plan.pool.length) {
      console.log("[warm] no symbols selected by warm plan; stopping.")
      break
    }

    console.log(`[warm] symbols ${plan.pool.map((stock) => `${stock.symbol}/${stock.name}`).join(", ")}`)
    const started = Date.now()
    const lookbackDays = args.lookbackDays || plan.lookbackDays
    const result = await fetchPoolBars({
      lookbackDays,
      useReal: true,
      pool: plan.pool,
      refresh: args.refresh || plan.refresh,
    })

    const fetched = result.stocks.map((stock) => ({
      symbol: stock.symbol,
      source: stock.source,
      bars: stock.bars.length,
      latest: stock.bars.at(-1)?.date ?? "n/a",
      error: stock.error,
    }))

    console.log(
      `[warm] result qveris=${result.qverisCount} database=${result.databaseCount ?? 0} mock=${result.mockCount} ms=${Date.now() - started}`,
    )
    for (const stock of fetched) {
      const suffix = stock.error ? ` error=${stock.error.slice(0, 180)}` : ""
      console.log(`[warm]   ${stock.symbol} ${stock.source} bars=${stock.bars} latest=${stock.latest}${suffix}`)
    }

    const after = await getMarketDataQualitySnapshot()
    const afterMissing = Math.max(0, after.stockPoolSymbols - after.coveredStockPoolSymbols)
    console.log(
      `[warm] after covered=${after.coveredStockPoolSymbols}/${after.stockPoolSymbols} missing=${afterMissing} stale=${after.staleSymbols.length} rows=${after.barRows}`,
    )

    if (after.coveredStockPoolSymbols === previousCovered && result.qverisCount === 0) {
      console.log("[warm] coverage did not improve and Qveris returned no usable bars; stopping to avoid a retry loop.")
      break
    }
    previousCovered = after.coveredStockPoolSymbols

    if (i < args.maxBatches - 1 && (afterMissing > 0 || after.staleSymbols.length > 0)) {
      await sleep(args.delayMs)
    }
  }

  const finalSnapshot = await getMarketDataQualitySnapshot()
  console.log("[warm] final", {
    covered: `${finalSnapshot.coveredStockPoolSymbols}/${finalSnapshot.stockPoolSymbols}`,
    missing: Math.max(0, finalSnapshot.stockPoolSymbols - finalSnapshot.coveredStockPoolSymbols),
    stale: finalSnapshot.staleSymbols.length,
    rows: finalSnapshot.barRows,
    latestDate: finalSnapshot.latestDate,
    notes: finalSnapshot.notes,
  })
}

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string | boolean>()
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue
    const [key, rawValue] = arg.slice(2).split("=", 2)
    values.set(key, rawValue ?? true)
  }

  return {
    batch: clampNumber(values.get("batch"), 1, 50, 10),
    maxBatches: clampNumber(values.get("max-batches") ?? values.get("maxBatches"), 1, 200, 1),
    lookbackDays: clampNumber(values.get("lookback-days") ?? values.get("lookbackDays"), 0, 750, 0),
    delayMs: clampNumber(values.get("delay-ms") ?? values.get("delayMs"), 0, 120_000, 20_000),
    refresh: values.get("refresh") === true || values.get("refresh") === "true" || values.get("refresh") === "1",
  }
}

function clampNumber(value: string | boolean | undefined, min: number, max: number, fallback: number) {
  const parsed = typeof value === "string" ? Number(value) : NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.floor(parsed)))
}

function sleep(ms: number) {
  return new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms))
}

function loadEnvLocal() {
  const envPath = resolve(process.cwd(), ".env.local")
  if (!existsSync(envPath)) return

  const text = readFileSync(envPath, "utf8")
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIndex = trimmed.indexOf("=")
    if (eqIndex <= 0) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const rawValue = trimmed.slice(eqIndex + 1).trim()
    if (process.env[key]) continue
    process.env[key] = unquote(rawValue)
  }
}

function unquote(value: string) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}
