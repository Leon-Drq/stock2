import { PaperTradingDashboard } from "@/components/simulation/paper-trading-dashboard"
import { PageMasthead, PageShell } from "@/components/shared/page-shell"
import { resolveWithFallback } from "@/lib/async-timeout"
import { loadStockBarsBatchFromStore } from "@/lib/backtest-data-store"
import { getChinaMarketSession } from "@/lib/cn-market-session"
import { formatChinaDate } from "@/lib/format"
import { loadPaperConfluenceSignals, PAPER_CONFLUENCE_ORDER_LIMIT } from "@/lib/paper-confluence"
import { PAPER_CONFLUENCE_STRATEGY_ID } from "@/lib/paper-confluence-constants"
import { attachPaperRuntime, enrichPaperAccountWithTradeCharts, type PaperAccount, type PaperBacktestProfile, type PaperRange, type PaperStrategyOption, type PaperSyncResult } from "@/lib/paper-trading"
import { runPaperTradingCycle } from "@/lib/paper-trading-runner"
import { listActivePaperLedgerAccounts, loadPaperLedgerSnapshot, type PaperLedgerAccountOption } from "@/lib/paper-trading-store"
import { buildRadarConfluenceSignals } from "@/lib/radar-confluence"
import { loadTodayRadarSignalView } from "@/lib/signal-ledger-view"

export const metadata = {
  title: "实盘模拟 — Stock Radar",
}

export const dynamic = "force-dynamic"

type SearchParams = Record<string, string | string[] | undefined>
const SIMULATION_ACCOUNT_TIMEOUT_MS = 3_500
const SIMULATION_SECONDARY_TIMEOUT_MS = 3_500
const SIMULATION_AUXILIARY_TIMEOUT_MS = 4_000
const SIMULATION_CHART_TIMEOUT_MS = 2_000
const SIMULATION_ACCOUNT_LIST_LIMIT = 64
const TODAY_SIGNAL_LEDGER_LIMIT = 500

export default async function SimulationPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const params = searchParams ? await searchParams : {}

  return (
    <PageShell width="wide">
      <PageMasthead
        layer="Layer 5"
        layerEn="Paper Trading"
        title="实盘模拟"
        subtitle="从首次接入策略的时间点开始计算纸面账户收益、持仓和交易流水；历史回测只作为策略准入参考，不计入模拟盘收益。"
      />
      <SimulationContent params={params} />
    </PageShell>
  )
}

async function SimulationContent({ params }: { params: SearchParams }) {
  const strategyId = firstParam(params, "strategy")
  const range = normalizeRange(firstParam(params, "range"))
  const startedAt = firstParam(params, "startedAt")
  const resetStartedAt = startedAt === "now" || firstParam(params, "reset") === "1"
  const forceRefresh = resetStartedAt || firstParam(params, "refresh") === "1"
  const requestedStartedAt = resetStartedAt ? new Date().toISOString() : startedAt
  const session = getChinaMarketSession()
  const activeAccountsPromise = resolveWithFallback(listActivePaperLedgerAccounts(SIMULATION_ACCOUNT_LIST_LIMIT), {
    timeoutMs: SIMULATION_ACCOUNT_TIMEOUT_MS,
    onFallback: () => [],
  })
  let activeAccounts: PaperLedgerAccountOption[] | null = null
  let defaultAccount: PaperLedgerAccountOption | undefined
  let selectedStrategyId = strategyId ?? null
  if (!selectedStrategyId) {
    // When no strategy is requested, the account rail decides the default.
    // Keep this path conservative so the page does not show a false empty state.
    activeAccounts = await activeAccountsPromise
    defaultAccount = chooseDefaultPaperAccount(activeAccounts)
    selectedStrategyId = defaultAccount?.strategyId ?? null
  }
  const computeFromRequestedStart = Boolean(startedAt && startedAt !== "now" && !selectedStrategyId)

  const paperConfluencePromise = resolveWithFallback(loadPaperConfluenceSignals({
    tradeDate: session.tradeDate,
    windowDays: 5,
    minStrategies: 2,
    limit: PAPER_CONFLUENCE_ORDER_LIMIT,
  }), {
    timeoutMs: SIMULATION_AUXILIARY_TIMEOUT_MS,
    onFallback: () => [],
  })
  const radarConfluencePromise = resolveWithFallback(loadSimulationRadarConfluence(session), {
    timeoutMs: SIMULATION_AUXILIARY_TIMEOUT_MS,
    onFallback: () => [],
  })

  const snapshotPromise = forceRefresh || computeFromRequestedStart
    ? Promise.resolve(null)
    : resolveWithFallback(loadPaperLedgerSnapshot({ strategyId: selectedStrategyId, range }), {
        timeoutMs: SIMULATION_SECONDARY_TIMEOUT_MS,
        onFallback: () => null,
      })
  const [resolvedActiveAccounts, snapshot] = await Promise.all([
    activeAccounts ? Promise.resolve(activeAccounts) : activeAccountsPromise,
    snapshotPromise,
  ])
  activeAccounts = resolvedActiveAccounts
  defaultAccount = defaultAccount ?? chooseDefaultPaperAccount(activeAccounts)
  const selectedAccount = activeAccounts.find((item) => item.strategyId === selectedStrategyId) ?? defaultAccount
  const shouldRunCycle = forceRefresh || computeFromRequestedStart
  const cycle = snapshot || !shouldRunCycle
    ? null
    : await resolveWithFallback(runPaperTradingCycle({
        strategyId: selectedStrategyId ?? undefined,
        range,
        startedAt: requestedStartedAt,
        resetStartedAt,
        includeBacktests: !snapshot && Boolean(selectedStrategyId),
        quoteLimit: 8,
        source: "simulation-page-refresh",
      }), {
        timeoutMs: 24_000,
        onFallback: () => null,
      })

  const accountDraft = snapshot ?? cycle?.account ?? emptySimulationAccount(range, requestedStartedAt, selectedAccount, activeAccounts)
  const syncResult: PaperSyncResult = cycle?.sync ?? {
    ok: Boolean(snapshot?.ledger.persisted),
    driver: snapshot?.ledger.driver ?? (activeAccounts.length ? "postgres" : "memory"),
    syncedAt: snapshot?.ledger.lastSyncedAt,
    error: snapshot
      ? undefined
      : activeAccounts.length
        ? "模拟账户总览已加载，账户明细读取较慢；可直接点击任一账户查看。"
        : forceRefresh
          ? "模拟盘刷新超时，请等待后台心跳写入。"
          : "暂未读到已上线模拟账户。",
  }

  const accountBase = attachPaperRuntime(accountDraft, syncResult)
  const chartBars = await resolveWithFallback(loadPaperTradeBars(accountBase), {
    timeoutMs: SIMULATION_CHART_TIMEOUT_MS,
    onFallback: () => new Map(),
  })
  const [paperConfluence, radarConfluence] = await Promise.all([paperConfluencePromise, radarConfluencePromise])
  const account = enrichPaperAccountWithTradeCharts(accountBase, chartBars)

  return <PaperTradingDashboard account={account} paperConfluence={paperConfluence} radarConfluence={radarConfluence} />
}

async function loadSimulationRadarConfluence(session: ReturnType<typeof getChinaMarketSession>) {
  const view = await loadTodayRadarSignalView({
    marketSession: session,
    ledgerLimit: TODAY_SIGNAL_LEDGER_LIMIT,
    ledgerTimeoutMs: SIMULATION_AUXILIARY_TIMEOUT_MS,
    snapshotTimeoutMs: SIMULATION_AUXILIARY_TIMEOUT_MS,
  })
  return buildRadarConfluenceSignals(view.signals, { includeCandidates: false })
}

async function loadPaperTradeBars(account: PaperAccount) {
  const bySymbol = new Map<string, { symbol: string; name: string; industry: string }>()
  for (const position of account.positions) bySymbol.set(position.symbol, { symbol: position.symbol, name: position.name, industry: "" })
  for (const order of account.orders) bySymbol.set(order.symbol, { symbol: order.symbol, name: order.name, industry: "" })
  for (const trade of account.closedTrades) bySymbol.set(trade.symbol, { symbol: trade.symbol, name: trade.name, industry: "" })
  if (!bySymbol.size) return new Map()
  return loadStockBarsBatchFromStore(Array.from(bySymbol.values()).slice(0, 8), 160)
}

function firstParam(params: SearchParams, key: string) {
  const value = params[key]
  return Array.isArray(value) ? value[0] : value
}

function normalizeRange(value?: string): PaperRange {
  if (value === "1m" || value === "3m" || value === "all") return value
  return "3m"
}

function emptySimulationAccount(
  range: PaperRange,
  startedAt?: string | null,
  selectedAccount?: PaperLedgerAccountOption,
  activeAccounts: PaperLedgerAccountOption[] = [],
): Omit<PaperAccount, "runtime"> {
  const now = new Date().toISOString()
  const start = validIso(startedAt) ?? selectedAccount?.startedAt ?? now
  const startDate = formatChinaDate(start)
  const strategyId = selectedAccount?.strategyId ?? ""
  const strategyName = selectedAccount?.strategyName ?? (activeAccounts.length ? "模拟账户总览" : "暂无已上线模拟账户")
  return {
    strategyId,
    strategyName,
    admissionStatus: selectedAccount?.admissionStatus ?? (activeAccounts.length ? "读取中" : "待接入"),
    admissionScore: selectedAccount?.admissionScore ?? 0,
    backtestProfile: backtestProfileFromAccountOption(selectedAccount),
    ledger: {
      driver: activeAccounts.length ? "postgres" : "memory",
      persisted: false,
      lastSyncedAt: selectedAccount?.lastSyncedAt,
      error: activeAccounts.length ? "账户明细读取中，先展示已上线账户总览。" : "暂未读到已上线模拟账户。",
    },
    startedAt: start,
    generatedAt: now,
    range,
    rangeLabel: range === "1m" ? "近一月" : range === "3m" ? "近三月" : "交易至今",
    rangeStart: startDate,
    rangeEnd: startDate,
    initialCapital: 1_000_000,
    startEquity: 1_000_000,
    currentEquity: 1_000_000,
    availableCash: 1_000_000,
    investedValue: 0,
    rangeReturnPct: 0,
    totalReturnPct: 0,
    benchmarkReturnPct: 0,
    maxDrawdownPct: 0,
    tradeWinRatePct: 0,
    openPositionCount: 0,
    closedTradeCount: 0,
    orderCount: 0,
    curve: [{
      date: startDate,
      equity: 1_000_000,
      benchmarkEquity: 1_000_000,
      returnPct: 0,
      drawdownPct: 0,
    }],
    positions: [],
    orders: [],
    closedTrades: [],
    tradeCharts: [],
    options: activeAccounts.map(paperOptionFromLedgerAccount),
  }
}

function chooseDefaultPaperAccount(accounts: PaperLedgerAccountOption[]) {
  const confluenceAccount = accounts.find((account) =>
    account.strategyId === PAPER_CONFLUENCE_STRATEGY_ID &&
    ((account.positionCount ?? 0) > 0 || (account.orderCount ?? 0) > 0)
  )
  if (confluenceAccount) return confluenceAccount

  return accounts
    .slice()
    .sort((a, b) =>
      b.positionCount - a.positionCount ||
      b.orderCount - a.orderCount ||
      b.closedTradeCount - a.closedTradeCount ||
      new Date(b.lastSyncedAt ?? b.startedAt).getTime() - new Date(a.lastSyncedAt ?? a.startedAt).getTime(),
    )[0]
}

function paperOptionFromLedgerAccount(account: PaperLedgerAccountOption): PaperStrategyOption {
  return {
    id: account.strategyId,
    name: account.strategyName,
    status: account.admissionStatus,
    score: account.admissionScore,
    annualReturnPct: 0,
    backtestProfile: backtestProfileFromAccountOption(account),
    positionCount: account.positionCount,
    orderCount: account.orderCount,
    closedTradeCount: account.closedTradeCount,
    lastSyncedAt: account.lastSyncedAt,
    startedAt: account.startedAt,
  }
}

function backtestProfileFromAccountOption(account?: PaperLedgerAccountOption): PaperBacktestProfile {
  return {
    status: account ? "信号代理" : "待补回测",
    source: account ? "Postgres ledger" : "N/A",
    score: account?.admissionScore ?? 0,
    annualReturnPct: 0,
    excessReturnPct: 0,
    maxDrawdownPct: 0,
    winRatePct: 0,
    sharpe: 0,
  }
}

function validIso(value?: string | null) {
  if (!value || value === "now") return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}
