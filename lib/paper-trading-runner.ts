import { resolveWithFallback } from "@/lib/async-timeout"
import { runStrategyBacktestReports, type StrategyBacktestReports } from "@/lib/backtest"
import { getChinaMarketSession } from "@/lib/cn-market-session"
import {
  PAPER_CONFLUENCE_ADMISSION_SCORE,
  PAPER_CONFLUENCE_ADMISSION_STATUS,
  PAPER_CONFLUENCE_STRATEGY_ID,
  PAPER_CONFLUENCE_STRATEGY_NAME,
} from "@/lib/paper-confluence-constants"
import { loadPaperConfluenceSignalRecords, PAPER_CONFLUENCE_ORDER_LIMIT } from "@/lib/paper-confluence"
import { applyRealtimeQuotesToPaperAccount, attachPaperRuntime, buildPaperAccount, type PaperAccount, type PaperRange } from "@/lib/paper-trading"
import {
  getOrCreatePaperLedgerAccount,
  listActivePaperLedgerAccounts,
  loadPaperLedgerSnapshot,
  syncPaperLedgerSnapshot,
  touchPaperLedgerAccount,
  type PaperLedgerState,
} from "@/lib/paper-trading-store"
import { fetchLatestQuotes, type LatestQuotesResult } from "@/lib/qveris-quotes"
import { recordsFromSignals, type RadarHistoryRecord } from "@/lib/radar-history"
import { buildRadarReport } from "@/lib/radar-pick"
import { loadRadarSignalHistoryRecords, loadRadarSignalHistoryRecordsForDateRange, loadRadarSignalHistoryRecordsForStrategySince } from "@/lib/radar-signal-store"
import { findStock, type StockPoolItem } from "@/lib/stock-pool"

export type PaperTradingCycleOptions = {
  strategyId?: string | null
  range?: PaperRange
  startedAt?: string | null
  resetStartedAt?: boolean
  includeBacktests?: boolean
  signalLimit?: number
  quoteLimit?: number
  source?: string
}

export type PaperTradingCycleResult = {
  ok: boolean
  checkedAt: string
  source: string
  account: PaperAccount
  ledger: PaperLedgerState
  sync: Awaited<ReturnType<typeof syncPaperLedgerSnapshot>>
  quotes: {
    requested: number
    qverisCount: number
    fetchedAt?: string
    fallbackReason?: string
  } | null
  signalCount: number
}

export type PaperTradingBatchResult = {
  ok: boolean
  checkedAt: string
  source: string
  updated: number
  failed: number
  signalCount: number
  accounts: Array<{
    strategyId: string
    strategyName: string
    ok: boolean
    startedAt: string
    openPositionCount: number
    orderCount: number
    closedTradeCount: number
    rangeReturnPct: number
    error?: string
  }>
}

type PaperAccountSeed = {
  strategyId?: string | null
  strategyName: string
  admissionStatus?: string
  admissionScore?: number
  startedAt?: string | null
  lastSyncedAt?: string
  positionCount?: number
  orderCount?: number
  closedTradeCount?: number
}

const PAPER_SIGNAL_LEDGER_LIMIT = 3000

export async function runPaperTradingCycle(opts: PaperTradingCycleOptions = {}): Promise<PaperTradingCycleResult> {
  const source = opts.source ?? "paper-trading-cycle"
  const checkedAt = new Date().toISOString()
  const range = opts.range ?? "3m"
  const requestedStartedAt = opts.resetStartedAt ? checkedAt : opts.startedAt
  const shouldLoadSignalLedger = opts.strategyId !== PAPER_CONFLUENCE_STRATEGY_ID
  const [batch, signalRecords] = await Promise.all([
    loadPaperBacktests(opts.includeBacktests !== false),
    shouldLoadSignalLedger
      ? loadPaperSignalLedger(paperSignalLedgerLimit(opts.signalLimit), { startedAt: requestedStartedAt })
      : Promise.resolve([]),
  ])
  let sourceSignalRecords = signalRecords
  let paperSignalRecords = opts.strategyId
    ? await loadPaperSignalsForStrategy(opts.strategyId, signalRecords, opts)
    : signalRecords

  const previewAccount = buildPaperAccount(batch.reports, {
    strategyId: opts.strategyId,
    range,
    startedAt: requestedStartedAt,
    signalRecords: paperSignalRecords,
  })
  const ledger = await resolveWithFallback(getOrCreatePaperLedgerAccount(previewAccount, {
    resetStartedAt: opts.resetStartedAt,
    source,
  }), {
    timeoutMs: 15_000,
    onFallback: (reason, error) => paperLedgerFallback(previewAccount.startedAt, reason, error),
  })

  if (shouldLoadSignalLedger) {
    const rangedSignalRecords = await loadPaperSignalLedger(paperSignalLedgerLimit(opts.signalLimit), {
      startedAt: ledger.startedAt,
    })
    sourceSignalRecords = mergeSignalRecords(sourceSignalRecords, rangedSignalRecords)
    paperSignalRecords = opts.strategyId
      ? await loadPaperSignalsForStrategy(opts.strategyId, sourceSignalRecords, { ...opts, startedAt: ledger.startedAt })
      : sourceSignalRecords
  }

  if (previewAccount.strategyId === PAPER_CONFLUENCE_STRATEGY_ID) {
    paperSignalRecords = await loadPaperSignalsForStrategy(previewAccount.strategyId, sourceSignalRecords, {
      ...opts,
      startedAt: ledger.startedAt,
    })
  }

  let accountDraft: PaperAccount = {
    ...buildPaperAccount(batch.reports, {
      strategyId: previewAccount.strategyId,
      range,
      startedAt: ledger.startedAt,
      signalRecords: paperSignalRecords,
    }),
    ledger: {
      driver: ledger.driver,
      persisted: ledger.persisted,
      accountId: ledger.accountId,
      status: ledger.status,
      lastSyncedAt: ledger.lastSyncedAt,
      error: ledger.error,
    },
  }

  const quotes = await resolveWithFallback(loadPaperRealtimeQuotes(accountDraft, opts.quoteLimit ?? 10), {
    timeoutMs: 24_000,
    onFallback: () => null,
  })
  accountDraft = applyRealtimeQuotesToPaperAccount(accountDraft, quotes)

  const sync = await resolveWithFallback(syncPaperLedgerSnapshot(accountDraft), {
    timeoutMs: 15_000,
    onFallback: (reason, error) => ({
      ok: false,
      driver: "postgres" as const,
      error: reason === "timeout"
        ? "模拟盘后台同步超过 8 秒，已保留本次计算快照。"
        : error instanceof Error ? error.message : "模拟盘后台同步失败。",
    }),
  })
  const account = await accountForSyncResult(accountDraft, sync)

  return {
    ok: sync.ok,
    checkedAt,
    source,
    account,
    ledger,
    sync,
    quotes: quotes
      ? {
          requested: quotes.totalSymbols,
          qverisCount: quotes.qverisCount,
          fetchedAt: quotes.fetchedAt,
          fallbackReason: quotes.fallbackReason,
        }
      : null,
    signalCount: paperSignalRecords.length,
  }
}

export async function runPaperTradingBatch(opts: PaperTradingCycleOptions & { accountLimit?: number } = {}): Promise<PaperTradingBatchResult> {
  const source = opts.source ?? "paper-trading-batch"
  const checkedAt = new Date().toISOString()
  const [batch, listedAccounts] = await Promise.all([
    loadPaperBacktests(opts.includeBacktests !== false),
    listActivePaperLedgerAccounts(opts.accountLimit ?? 10),
  ])
  const activeAccounts = withPaperConfluenceAccount(
    listedAccounts.length ? listedAccounts : await loadPaperAccountsFromSnapshot(opts),
    checkedAt,
  )
  let signalRecords = await loadPaperSignalLedger(paperSignalLedgerLimit(opts.signalLimit), {
    startedAt: earliestPaperStartedAt(activeAccounts, opts.startedAt),
  })

  const accountSeeds = activeAccounts.length
    ? activeAccounts
    : [{
        strategyId: undefined,
        strategyName: "",
        startedAt: opts.startedAt ?? null,
      }]

  const accounts: PaperTradingBatchResult["accounts"] = []
  for (const seed of accountSeeds) {
    let cycleSignalRecords = signalRecords
    if (seed.strategyId) {
      cycleSignalRecords = await loadPaperSignalsForStrategy(seed.strategyId, cycleSignalRecords, {
        ...opts,
        startedAt: seed.startedAt ?? opts.startedAt,
      })
      signalRecords = mergeSignalRecords(signalRecords, cycleSignalRecords)
    }

    if (seed.strategyId && seed.strategyId !== PAPER_CONFLUENCE_STRATEGY_ID && !hasSignalForStrategy(cycleSignalRecords, seed.strategyId)) {
      const heartbeat = await touchPaperLedgerAccount(seed.strategyId, {
        source,
        signalCount: cycleSignalRecords.length,
      })
      accounts.push({
        strategyId: seed.strategyId,
        strategyName: seed.strategyName,
        ok: heartbeat.persisted && !heartbeat.error,
        startedAt: heartbeat.startedAt ?? seed.startedAt ?? checkedAt,
        openPositionCount: seed.positionCount ?? 0,
        orderCount: seed.orderCount ?? 0,
        closedTradeCount: seed.closedTradeCount ?? 0,
        rangeReturnPct: 0,
        error: heartbeat.error,
      })
      continue
    }

    try {
      const cycle = await runPaperTradingCycleFromLoadedData(batch, cycleSignalRecords, {
        ...opts,
        strategyId: seed.strategyId ?? opts.strategyId,
        startedAt: opts.resetStartedAt ? checkedAt : (opts.startedAt ?? seed.startedAt),
        source,
      })
      accounts.push({
        strategyId: cycle.account.strategyId,
        strategyName: cycle.account.strategyName,
        ok: cycle.sync.ok,
        startedAt: cycle.account.startedAt,
        openPositionCount: cycle.account.openPositionCount,
        orderCount: cycle.account.orderCount,
        closedTradeCount: cycle.account.closedTradeCount,
        rangeReturnPct: cycle.account.rangeReturnPct,
        error: cycle.sync.error,
      })
    } catch (error) {
      accounts.push({
        strategyId: seed.strategyId ?? opts.strategyId ?? "",
        strategyName: seed.strategyName,
        ok: false,
        startedAt: opts.startedAt ?? seed.startedAt ?? checkedAt,
        openPositionCount: 0,
        orderCount: 0,
        closedTradeCount: 0,
        rangeReturnPct: 0,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const failed = accounts.filter((account) => !account.ok).length
  return {
    ok: accounts.length > 0 && failed === 0,
    checkedAt,
    source,
    updated: accounts.length - failed,
    failed,
    signalCount: signalRecords.length,
    accounts,
  }
}

function hasSignalForStrategy(signalRecords: RadarHistoryRecord[], strategyId: string) {
  return signalRecords.some((record) => record.strategyId === strategyId)
}

async function loadPaperSignalsForStrategy(
  strategyId: string,
  signalRecords: RadarHistoryRecord[],
  opts: PaperTradingCycleOptions = {},
): Promise<RadarHistoryRecord[]> {
  if (!strategyId) return signalRecords
  if (strategyId === PAPER_CONFLUENCE_STRATEGY_ID) {
    const generated = await resolveWithFallback(loadPaperConfluenceSignalRecords({
      tradeDate: getChinaMarketSession().tradeDate,
      windowDays: paperConfluenceWindowDays(opts.startedAt),
      minStrategies: 2,
      limit: PAPER_CONFLUENCE_ORDER_LIMIT,
      startedAt: opts.startedAt,
    }), {
      timeoutMs: 12_000,
      onFallback: () => [],
    })
    return generated
  }
  if (opts.startedAt) {
    const exactLedger = await resolveWithFallback(loadRadarSignalHistoryRecordsForStrategySince(
      strategyId,
      opts.startedAt,
      paperSignalLedgerLimit(opts.signalLimit),
    ), {
      timeoutMs: 10_000,
      onFallback: () => [],
    })
    if (exactLedger.length) {
      return mergeSignalRecords(signalRecords, exactLedger)
    }
  }
  if (hasSignalForStrategy(signalRecords, strategyId)) return signalRecords

  const scan = await resolveWithFallback(buildRadarReport({
    useReal: true,
    topN: 20,
    includePaperWatch: true,
    strategyIds: [strategyId],
    signalScope: "paper",
    allowNewSignals: true,
    allowPriceUpdates: true,
    persistSignals: true,
    requireCurrentQuotes: false,
  }), {
    timeoutMs: 45_000,
    onFallback: () => null,
  })
  if (!scan?.report.suggestions.length) return signalRecords

  const generated = recordsFromSignals(scan.report.suggestions)
    .filter((record) => record.strategyId === strategyId)
    .filter(isExecutablePaperSignal)

  if (!generated.length) return signalRecords
  return mergeSignalRecords(signalRecords, generated)
}

function isExecutablePaperSignal(record: RadarHistoryRecord) {
  return (
    record.lifecycleStage !== "candidate" &&
    (record.lifecycleStatus ?? "open") === "open" &&
    record.status === "跟踪中" &&
    (record.signalKind === "high-confidence-buy" || record.signalKind === "add-confirm") &&
    record.triggerPrice > 0 &&
    record.latestPrice > 0
  )
}

function mergeSignalRecords(...groups: RadarHistoryRecord[][]) {
  const byId = new Map<string, RadarHistoryRecord>()
  for (const group of groups) {
    for (const record of group) {
      const existing = byId.get(record.id)
      if (!existing || signalRecordTime(record) >= signalRecordTime(existing)) {
        byId.set(record.id, record)
      }
    }
  }
  return Array.from(byId.values()).sort((a, b) => signalRecordTime(b) - signalRecordTime(a))
}

function signalRecordTime(record: RadarHistoryRecord) {
  const value = new Date(record.latestQuoteAt ?? record.recommendedAt).getTime()
  return Number.isFinite(value) ? value : 0
}

function paperConfluenceWindowDays(startedAt?: string | null) {
  const tradeDate = getChinaMarketSession().tradeDate
  const startedTradeDate = startedAt ? chinaDateOnly(startedAt) : null
  if (!startedTradeDate) return 10
  const days = dateDiffDays(startedTradeDate, tradeDate) + 1
  return Math.max(5, Math.min(days, 30))
}

function chinaDateOnly(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" })
}

function dateDiffDays(fromDate: string, toDate: string) {
  const from = Date.parse(`${fromDate}T00:00:00Z`)
  const to = Date.parse(`${toDate}T00:00:00Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0
  return Math.max(0, Math.round((to - from) / 86_400_000))
}

async function loadPaperAccountsFromSnapshot(opts: PaperTradingCycleOptions & { accountLimit?: number }) {
  const snapshot = await loadPaperLedgerSnapshot({ strategyId: opts.strategyId, range: opts.range })
  if (!snapshot) return []
  const limit = Math.max(1, Math.min(opts.accountLimit ?? 10, 24))
  return withPaperConfluenceAccount(snapshot.options.slice(0, limit).map((option) => ({
    strategyId: option.id,
    strategyName: option.name,
    admissionStatus: option.status,
    admissionScore: option.score,
    startedAt: option.startedAt ?? snapshot.startedAt,
    lastSyncedAt: option.lastSyncedAt,
    positionCount: option.positionCount ?? 0,
    orderCount: option.orderCount ?? 0,
    closedTradeCount: option.closedTradeCount ?? 0,
  })), opts.startedAt ?? new Date().toISOString())
}

function withPaperConfluenceAccount(
  accounts: PaperAccountSeed[],
  fallbackStartedAt: string,
) {
  if (accounts.some((account) => account.strategyId === PAPER_CONFLUENCE_STRATEGY_ID)) return accounts
  return [
    ...accounts,
    {
      strategyId: PAPER_CONFLUENCE_STRATEGY_ID,
      strategyName: PAPER_CONFLUENCE_STRATEGY_NAME,
      admissionStatus: PAPER_CONFLUENCE_ADMISSION_STATUS,
      admissionScore: PAPER_CONFLUENCE_ADMISSION_SCORE,
      startedAt: fallbackStartedAt,
      positionCount: 0,
      orderCount: 0,
      closedTradeCount: 0,
    },
  ]
}

function earliestPaperStartedAt(accounts: PaperAccountSeed[], fallback?: string | null) {
  const values = accounts
    .map((account) => account.startedAt)
    .concat(fallback ?? null)
    .filter((value): value is string => Boolean(value && Number.isFinite(new Date(value).getTime())))
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
  return values[0] ?? fallback ?? null
}

function paperSignalLedgerLimit(limit?: number) {
  return Math.max(PAPER_SIGNAL_LEDGER_LIMIT, limit ?? 0)
}

async function runPaperTradingCycleFromLoadedData(
  batch: StrategyBacktestReports,
  loadedSignalRecords: RadarHistoryRecord[],
  opts: PaperTradingCycleOptions = {},
): Promise<PaperTradingCycleResult> {
  const source = opts.source ?? "paper-trading-cycle"
  const checkedAt = new Date().toISOString()
  const range = opts.range ?? "3m"
  const requestedStartedAt = opts.resetStartedAt ? checkedAt : opts.startedAt
  let signalRecords = loadedSignalRecords
  let paperSignalRecords = opts.strategyId
    ? await loadPaperSignalsForStrategy(opts.strategyId, signalRecords, opts)
    : signalRecords

  const previewAccount = buildPaperAccount(batch.reports, {
    strategyId: opts.strategyId,
    range,
    startedAt: requestedStartedAt,
    signalRecords: paperSignalRecords,
  })
  const ledger = await resolveWithFallback(getOrCreatePaperLedgerAccount(previewAccount, {
    resetStartedAt: opts.resetStartedAt,
    source,
  }), {
    timeoutMs: 15_000,
    onFallback: (reason, error) => paperLedgerFallback(previewAccount.startedAt, reason, error),
  })

  if (opts.strategyId !== PAPER_CONFLUENCE_STRATEGY_ID) {
    const rangedSignalRecords = await loadPaperSignalLedger(paperSignalLedgerLimit(opts.signalLimit), {
      startedAt: ledger.startedAt,
    })
    signalRecords = mergeSignalRecords(signalRecords, rangedSignalRecords)
    paperSignalRecords = opts.strategyId
      ? await loadPaperSignalsForStrategy(opts.strategyId, signalRecords, { ...opts, startedAt: ledger.startedAt })
      : signalRecords
  }

  if (previewAccount.strategyId === PAPER_CONFLUENCE_STRATEGY_ID) {
    paperSignalRecords = await loadPaperSignalsForStrategy(previewAccount.strategyId, signalRecords, {
      ...opts,
      startedAt: ledger.startedAt,
    })
  }

  let accountDraft: PaperAccount = {
    ...buildPaperAccount(batch.reports, {
      strategyId: previewAccount.strategyId,
      range,
      startedAt: ledger.startedAt,
      signalRecords: paperSignalRecords,
    }),
    ledger: {
      driver: ledger.driver,
      persisted: ledger.persisted,
      accountId: ledger.accountId,
      status: ledger.status,
      lastSyncedAt: ledger.lastSyncedAt,
      error: ledger.error,
    },
  }

  const quotes = await resolveWithFallback(loadPaperRealtimeQuotes(accountDraft, opts.quoteLimit ?? 10), {
    timeoutMs: 24_000,
    onFallback: () => null,
  })
  accountDraft = applyRealtimeQuotesToPaperAccount(accountDraft, quotes)

  const sync = await resolveWithFallback(syncPaperLedgerSnapshot(accountDraft), {
    timeoutMs: 15_000,
    onFallback: (reason, error) => ({
      ok: false,
      driver: "postgres" as const,
      error: reason === "timeout"
        ? "模拟盘后台同步超过 8 秒，已保留本次计算快照。"
        : error instanceof Error ? error.message : "模拟盘后台同步失败。",
    }),
  })
  const account = await accountForSyncResult(accountDraft, sync)

  return {
    ok: sync.ok,
    checkedAt,
    source,
    account,
    ledger,
    sync,
    quotes: quotes
      ? {
          requested: quotes.totalSymbols,
          qverisCount: quotes.qverisCount,
          fetchedAt: quotes.fetchedAt,
          fallbackReason: quotes.fallbackReason,
        }
      : null,
    signalCount: paperSignalRecords.length,
  }
}

async function accountForSyncResult(
  accountDraft: PaperAccount,
  sync: Awaited<ReturnType<typeof syncPaperLedgerSnapshot>>,
) {
  if (!sync.preservedExisting || !accountDraft.strategyId) return accountDraft
  const snapshot = await resolveWithFallback(loadPaperLedgerSnapshot({
    strategyId: accountDraft.strategyId,
    range: accountDraft.range,
  }), {
    timeoutMs: 8_000,
    onFallback: () => null,
  })
  if (!snapshot) return accountDraft
  return attachPaperRuntime({
    ...snapshot,
    ledger: {
      ...snapshot.ledger,
      error: sync.error,
    },
  }, sync)
}

export async function loadPaperBacktests(includeBacktests = true): Promise<StrategyBacktestReports> {
  if (!includeBacktests) {
    return {
      reports: [],
      generatedAt: new Date().toISOString(),
      notes: ["后台实盘模拟跳过完整回测，只按雷达信号账本撮合。"],
    }
  }
  try {
    return await runStrategyBacktestReports()
  } catch (error) {
    return {
      reports: [],
      generatedAt: new Date().toISOString(),
      notes: [`模拟盘回测基准读取失败：${error instanceof Error ? error.message : "已降级为雷达信号账本"}`],
    }
  }
}

export async function loadPaperSignalLedger(
  limit = PAPER_SIGNAL_LEDGER_LIMIT,
  opts: { startedAt?: string | null; tradeDate?: string } = {},
) {
  try {
    const tradeDate = opts.tradeDate ?? getChinaMarketSession().tradeDate
    const startedTradeDate = opts.startedAt ? chinaDateOnly(opts.startedAt) : null
    if (startedTradeDate) {
      return await loadRadarSignalHistoryRecordsForDateRange(startedTradeDate, tradeDate, limit)
    }
    return await loadRadarSignalHistoryRecords(limit)
  } catch {
    return []
  }
}

export async function loadPaperRealtimeQuotes(account: PaperAccount, limit = 10): Promise<LatestQuotesResult | null> {
  const pool = paperQuotePool(account, limit)
  if (!pool.length) return null
  return fetchLatestQuotes(pool, {
    discoverTimeoutMs: 8_000,
    callTimeoutMs: 18_000,
  })
}

export function paperQuotePool(account: PaperAccount, limit = 10) {
  const bySymbol = new Map<string, StockPoolItem>()
  const add = (symbol: string, name: string) => {
    const stock = findStock(symbol) ?? inferStock(symbol, name)
    bySymbol.set(stock.symbol, stock)
  }
  for (const position of account.positions) add(position.symbol, position.name)
  for (const order of account.orders.slice(0, 24)) add(order.symbol, order.name)
  for (const trade of account.closedTrades.slice(0, 10)) add(trade.symbol, trade.name)
  return Array.from(bySymbol.values()).slice(0, limit)
}

function inferStock(symbol: string, name: string): StockPoolItem {
  const normalized = symbol.slice(0, 6)
  return {
    symbol: normalized,
    symbolQveris: `${normalized}.${normalized.startsWith("6") ? "SH" : "SZ"}`,
    name: name || normalized,
    industry: "模拟盘",
  }
}

function paperLedgerFallback(startedAt: string, reason: "timeout" | "error", error?: unknown): PaperLedgerState {
  return {
    driver: "postgres",
    persisted: false,
    startedAt,
    error: reason === "timeout" ? "模拟盘账户读取超过 8 秒。" : error instanceof Error ? error.message : "模拟盘账户读取失败。",
  }
}
