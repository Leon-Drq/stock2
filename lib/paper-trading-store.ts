import type { Sql, TransactionSql } from "postgres"
import type { PaperAccount, PaperBacktestProfile, PaperClosedTrade, PaperOrder, PaperPosition } from "@/lib/paper-trading"
import { getSharedPostgresClient, hasSharedPostgresConfig } from "@/lib/backtest-data-store"
import {
  PAPER_CONFLUENCE_ADMISSION_SCORE,
  PAPER_CONFLUENCE_ADMISSION_STATUS,
  PAPER_CONFLUENCE_STRATEGY_ID,
  PAPER_CONFLUENCE_STRATEGY_NAME,
} from "@/lib/paper-confluence-constants"
import { strategyDeploymentDecision } from "@/lib/strategy-deployment"
import type { StrategyRegistryEntry } from "@/lib/strategy-registry-store"

export type PaperLedgerState = {
  driver: "postgres" | "memory"
  persisted: boolean
  accountId?: string
  startedAt: string
  status?: string
  lastSyncedAt?: string
  error?: string
}

type PaperAccountRow = {
  account_id: string
  strategy_id: string
  strategy_name: string
  admission_status: string | null
  admission_score: number | null
  initial_capital: number
  started_at: string | Date
  status: string
  last_synced_at: string | Date | null
  payload: unknown
  position_count?: number
  order_count?: number
  closed_trade_count?: number
  recent_order_at?: string | Date | null
}

export type PaperLedgerAccountOption = {
  strategyId: string
  strategyName: string
  admissionStatus: string
  admissionScore: number
  startedAt: string
  lastSyncedAt?: string
  positionCount: number
  orderCount: number
  closedTradeCount: number
}

export type RecentPaperOrderRecord = {
  orderId: string
  accountId: string
  strategyId: string
  strategyName: string
  symbol: string
  name: string
  side: "buy" | "sell"
  status: PaperOrder["status"]
  requestedShares: number
  filledShares: number
  limitPrice: number
  filledPrice?: number
  submittedAt: string
  filledAt?: string
  note: string
}

export type PaperPositionRecord = {
  accountId: string
  strategyId: string
  strategyName: string
  symbol: string
  name: string
  shares: number
  costPrice: number
  currentPrice: number
  marketValue: number
  pnlPct: number
  openedAt?: string
  sellableFrom?: string
  sellable: boolean
}

type PaperEquityRow = {
  as_of: string | Date
  equity: number
  cash: number
  invested_value: number
  benchmark_equity: number | null
  return_pct: number
  drawdown_pct: number
}

type PaperPositionRow = {
  symbol: string
  name: string
  shares: number
  weight_pct: number
  cost_price: number
  current_price: number
  market_value: number
  unrealized_pnl: number
  pnl_pct: number
  holding_days: number
  opened_at: string | Date | null
  payload: unknown
}

type PaperOrderRow = {
  order_id: string
  account_id?: string
  strategy_id?: string | null
  strategy_name?: string | null
  source_signal_id: string | null
  symbol: string
  name: string | null
  side: "buy" | "sell"
  status: string
  requested_qty: number | null
  filled_qty: number | null
  limit_price: number | null
  filled_price: number | null
  submitted_at: string | Date
  filled_at: string | Date | null
  note: string | null
  payload: unknown
}

type PaperTradeRow = {
  trade_id: string
  order_id: string | null
  symbol: string
  name: string | null
  qty: number | null
  price: number | null
  amount: number | null
  trade_time: string | Date
  payload: unknown
}

const ACCOUNT_SCOPE = "default"
const SEEDED_INITIAL_CAPITAL = 1_000_000
const MAX_RECENT_PAPER_ORDERS = 2_000
const MAX_CONFLUENCE_PAPER_ORDERS = 10_000

let paperTablesReady = false
let paperTablesUnavailable = false

export async function syncPaperDeploymentAccounts(
  entries: StrategyRegistryEntry[],
  opts: { source?: string } = {},
) {
  if (!entries.length || !(await ensurePaperLedgerTables())) {
    return { ok: false, driver: hasSharedPostgresConfig() ? "postgres" as const : "memory" as const, synced: 0 }
  }

  const decisions = entries
    .map(strategyDeploymentDecision)
    .filter((decision) => decision.paper.status === "online" || decision.paper.status === "watch")

  if (!decisions.length) return { ok: true, driver: "postgres" as const, synced: 0 }

  try {
    const sql = await getSharedPostgresClient()
    const now = new Date()
    for (const decision of decisions) {
      const payload = {
        source: opts.source ?? "strategy-deployment",
        deploymentLane: decision.lane,
        backtestStatus: "真实回测",
        backtestSource: "Qveris",
        backtestScore: decision.score,
        annualReturnPct: decision.annualReturn,
        maxDrawdownPct: decision.maxDrawdown,
        radarStatus: decision.radar.status,
        paperStatus: decision.paper.status,
        reason: decision.reason,
      }
      await sql`
        insert into paper_accounts (
          account_id,
          account_scope,
          strategy_id,
          strategy_name,
          admission_status,
          admission_score,
          initial_capital,
          started_at,
          status,
          payload,
          last_synced_at
        )
        values (
          ${paperAccountId(decision.strategyId)},
          ${ACCOUNT_SCOPE},
          ${decision.strategyId},
          ${decision.name},
          ${decision.paper.label},
          ${Math.round(decision.score)},
          ${SEEDED_INITIAL_CAPITAL},
          ${now},
          'active',
          ${sql.json(payload)},
          now()
        )
        on conflict (account_scope, strategy_id) do update set
          strategy_name = excluded.strategy_name,
          admission_status = excluded.admission_status,
          admission_score = excluded.admission_score,
          initial_capital = excluded.initial_capital,
          status = case when paper_accounts.status = 'closed' then 'active' else paper_accounts.status end,
          payload = (
            case
              when jsonb_typeof(coalesce(paper_accounts.payload, '{}'::jsonb)) = 'object'
                then coalesce(paper_accounts.payload, '{}'::jsonb)
              else '{}'::jsonb
            end
          ) || excluded.payload,
          last_synced_at = coalesce(paper_accounts.last_synced_at, now()),
          updated_at = now()
      `
    }
    return { ok: true, driver: "postgres" as const, synced: decisions.length }
  } catch (error) {
    return {
      ok: false,
      driver: "postgres" as const,
      synced: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function touchPaperLedgerAccount(
  strategyId: string,
  opts: { source?: string; reason?: string; signalCount?: number } = {},
): Promise<PaperLedgerState> {
  const fallback: PaperLedgerState = {
    driver: hasSharedPostgresConfig() ? "postgres" : "memory",
    persisted: false,
    accountId: strategyId ? paperAccountId(strategyId) : undefined,
    startedAt: new Date().toISOString(),
  }
  if (!strategyId || !(await ensurePaperLedgerTables())) return fallback

  try {
    const sql = await getSharedPostgresClient()
    const payload = {
      source: opts.source ?? "paper-trading-heartbeat",
      heartbeat: "no-new-signal",
      reason: opts.reason ?? "该策略本轮没有新的雷达信号，账户保持空仓观察。",
      signalCount: opts.signalCount ?? 0,
      generatedAt: new Date().toISOString(),
    }
    const rows = await sql<PaperAccountRow[]>`
      update paper_accounts
      set last_synced_at = now(),
          payload = (
            case
              when jsonb_typeof(coalesce(paper_accounts.payload, '{}'::jsonb)) = 'object'
                then coalesce(paper_accounts.payload, '{}'::jsonb)
              else '{}'::jsonb
            end
          ) || ${sql.json(payload)},
          updated_at = now()
      where account_scope = ${ACCOUNT_SCOPE}
        and strategy_id = ${strategyId}
        and status = 'active'
      returning account_id, started_at, status, last_synced_at
    `
    const row = rows[0]
    return {
      driver: "postgres",
      persisted: Boolean(row),
      accountId: row?.account_id ?? paperAccountId(strategyId),
      startedAt: formatTimestamp(row?.started_at) ?? fallback.startedAt,
      status: row?.status ?? "active",
      lastSyncedAt: formatTimestamp(row?.last_synced_at) ?? undefined,
      error: row ? undefined : "未找到 active 模拟账户。",
    }
  } catch (error) {
    return {
      ...fallback,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function getOrCreatePaperLedgerAccount(
  account: PaperAccount,
  opts: { resetStartedAt?: boolean; source?: string } = {},
): Promise<PaperLedgerState> {
  const fallback: PaperLedgerState = {
    driver: hasSharedPostgresConfig() ? "postgres" : "memory",
    persisted: false,
    accountId: account.strategyId ? paperAccountId(account.strategyId) : undefined,
    startedAt: account.startedAt,
  }
  if (!account.strategyId || !(await ensurePaperLedgerTables())) return fallback

  try {
    const sql = await getSharedPostgresClient()
    const accountId = paperAccountId(account.strategyId)
    const resetStartedAt = opts.resetStartedAt === true
    const rows = await sql<PaperAccountRow[]>`
      insert into paper_accounts (
        account_id,
        account_scope,
        strategy_id,
        strategy_name,
        admission_status,
        admission_score,
        initial_capital,
        started_at,
        status,
        payload,
        last_synced_at
      )
      values (
        ${accountId},
        ${ACCOUNT_SCOPE},
        ${account.strategyId},
        ${account.strategyName},
        ${account.admissionStatus},
        ${account.admissionScore},
        ${account.initialCapital},
        ${new Date(account.startedAt)},
        'active',
        ${sql.json({ source: opts.source ?? "simulation-page" })},
        now()
      )
      on conflict (account_scope, strategy_id) do update set
        strategy_name = excluded.strategy_name,
        admission_status = excluded.admission_status,
        admission_score = excluded.admission_score,
        initial_capital = excluded.initial_capital,
        started_at = case
          when ${resetStartedAt} then excluded.started_at
          else paper_accounts.started_at
        end,
        status = case when paper_accounts.status = 'closed' then 'active' else paper_accounts.status end,
        last_synced_at = now(),
        updated_at = now()
      returning account_id, started_at, status, last_synced_at
    `
    const row = rows[0]
    if (resetStartedAt) {
      await clearPaperLedgerExecutions(sql, row?.account_id ?? accountId)
    }
    return {
      driver: "postgres",
      persisted: true,
      accountId: row?.account_id ?? accountId,
      startedAt: formatTimestamp(row?.started_at) ?? account.startedAt,
      status: row?.status ?? "active",
      lastSyncedAt: formatTimestamp(row?.last_synced_at) ?? undefined,
    }
  } catch (error) {
    return {
      ...fallback,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function loadPaperLedgerSnapshot(opts: { strategyId?: string | null; range?: PaperAccount["range"] } = {}) {
  if (!(await ensurePaperLedgerTables())) return null

  try {
    const sql = await getSharedPostgresClient()
    const accountRows = opts.strategyId
      ? await sql<PaperAccountRow[]>`
          select account_id, strategy_id, strategy_name, admission_status, admission_score,
                 initial_capital, started_at, status, last_synced_at, payload
          from paper_accounts
          where account_scope = ${ACCOUNT_SCOPE} and strategy_id = ${opts.strategyId}
          limit 1
        `
      : await sql<PaperAccountRow[]>`
          with active_accounts as (
            select account_id, strategy_id, strategy_name, admission_status, admission_score,
                   initial_capital, started_at, status, last_synced_at, payload, updated_at
            from paper_accounts
            where account_scope = ${ACCOUNT_SCOPE} and status = 'active'
          ),
          position_counts as (
            select p.account_id, count(*)::int as position_count
            from paper_positions p
            join active_accounts a using (account_id)
            group by p.account_id
          ),
          order_counts as (
            select o.account_id, count(*)::int as order_count, max(o.submitted_at) as recent_order_at
            from paper_orders o
            join active_accounts a using (account_id)
            group by o.account_id
          ),
          trade_counts as (
            select t.account_id, count(*)::int as closed_trade_count
            from paper_trades t
            join active_accounts a using (account_id)
            group by t.account_id
          )
          select a.account_id, a.strategy_id, a.strategy_name, a.admission_status, a.admission_score,
                 a.initial_capital, a.started_at, a.status, a.last_synced_at, a.payload,
                 coalesce(pc.position_count, 0)::int as position_count,
                 coalesce(oc.order_count, 0)::int as order_count,
                 coalesce(tc.closed_trade_count, 0)::int as closed_trade_count,
                 oc.recent_order_at
          from active_accounts a
          left join position_counts pc using (account_id)
          left join order_counts oc using (account_id)
          left join trade_counts tc using (account_id)
          order by position_count desc, order_count desc, recent_order_at desc nulls last, last_synced_at desc nulls last, updated_at desc
          limit 1
        `
    const row = accountRows[0]
    if (!row) return null

    const [curveRows, positionRows, orderRows, tradeRows, countRows, optionRows] = await Promise.all([
      sql<PaperEquityRow[]>`
        select as_of, equity, cash, invested_value, benchmark_equity, return_pct, drawdown_pct
        from paper_equity_curve
        where account_id = ${row.account_id}
        order by as_of asc
      `,
      sql<PaperPositionRow[]>`
        select symbol, name, shares, weight_pct, cost_price, current_price,
               market_value, unrealized_pnl, pnl_pct, holding_days, opened_at, payload
        from paper_positions
        where account_id = ${row.account_id}
        order by market_value desc
      `,
      sql<PaperOrderRow[]>`
        select order_id, source_signal_id, symbol, name, side, status, requested_qty, filled_qty,
               limit_price, filled_price, submitted_at, filled_at, note, payload
        from paper_orders
        where account_id = ${row.account_id}
        order by submitted_at desc
        limit 180
      `,
      sql<PaperTradeRow[]>`
        select trade_id, order_id, symbol, name, qty, price, amount, trade_time, payload
        from paper_trades
        where account_id = ${row.account_id}
        order by trade_time desc
        limit 120
      `,
      sql<Array<{ order_count: number; closed_trade_count: number; closed_trade_winners: number }>>`
        select
          (select count(*)::int from paper_orders where account_id = ${row.account_id}) as order_count,
          (select count(*)::int from paper_trades where account_id = ${row.account_id}) as closed_trade_count,
          (
            select count(*)::int
            from paper_trades
            where account_id = ${row.account_id}
              and case
                when payload->>'returnPct' ~ '^-?[0-9]+(\\.[0-9]+)?$'
                  then (payload->>'returnPct')::double precision
                else 0
              end > 0
          ) as closed_trade_winners
      `,
      sql<PaperAccountRow[]>`
        with active_accounts as (
          select account_id, strategy_id, strategy_name, admission_status, admission_score,
                 initial_capital, started_at, status, last_synced_at, payload, updated_at
          from paper_accounts
          where account_scope = ${ACCOUNT_SCOPE} and status = 'active'
        ),
        position_counts as (
          select p.account_id, count(*)::int as position_count
          from paper_positions p
          join active_accounts a using (account_id)
          group by p.account_id
        ),
        order_counts as (
          select o.account_id, count(*)::int as order_count, max(o.submitted_at) as recent_order_at
          from paper_orders o
          join active_accounts a using (account_id)
          group by o.account_id
        ),
        trade_counts as (
          select t.account_id, count(*)::int as closed_trade_count
          from paper_trades t
          join active_accounts a using (account_id)
          group by t.account_id
        )
        select a.account_id, a.strategy_id, a.strategy_name, a.admission_status, a.admission_score,
               a.initial_capital, a.started_at, a.status, a.last_synced_at, a.payload,
               coalesce(pc.position_count, 0)::int as position_count,
               coalesce(oc.order_count, 0)::int as order_count,
               coalesce(tc.closed_trade_count, 0)::int as closed_trade_count,
               oc.recent_order_at
        from active_accounts a
        left join position_counts pc using (account_id)
        left join order_counts oc using (account_id)
        left join trade_counts tc using (account_id)
        order by position_count desc, order_count desc, recent_order_at desc nulls last, last_synced_at desc nulls last, updated_at desc
      `,
    ])

    const payload = parsePayload(row.payload)
    const positions = positionRows.map(positionFromRow)
    const orders = orderRows.map(orderFromRow)
    const closedTrades = tradeRows.map(tradeFromRow)
    const orderCount = finiteCount(countRows[0]?.order_count, orders.length)
    const closedTradeCount = finiteCount(countRows[0]?.closed_trade_count, closedTrades.length)
    const closedTradeWinners = finiteCount(
      countRows[0]?.closed_trade_winners,
      closedTrades.filter((trade) => trade.returnPct > 0).length,
    )
    const initialCapital = finiteNumber(row.initial_capital, SEEDED_INITIAL_CAPITAL)
    const latestCurveRow = curveRows.at(-1)
    const curveCash = finiteNumberOrNull(latestCurveRow?.cash)
    const curveEquity = finiteNumberOrNull(latestCurveRow?.equity)
    const hasExecutedLedger = hasPaperExecution({ positions, orders, closedTrades })
    const investedValue = hasExecutedLedger
      ? roundMoney(positions.reduce((sum, position) => sum + position.marketValue, 0))
      : 0
    const positionMarkedEquity = curveCash === null ? null : roundMoney(Math.max(0, curveCash) + investedValue)
    const currentEquity = hasExecutedLedger
      ? roundMoney(positionMarkedEquity ?? curveEquity ?? initialCapital)
      : initialCapital
    const availableCash = hasExecutedLedger
      ? roundMoney(curveCash ?? Math.max(0, currentEquity - investedValue))
      : initialCapital
    const startEquity = initialCapital
    const curve = normalizePaperEquityCurve(hasExecutedLedger ? curveRows : [], {
      initialCapital,
      startedAt: row.started_at,
      currentEquity,
    })
    const totalReturnPct = startEquity > 0 ? roundPct((currentEquity / startEquity - 1) * 100) : 0
    const benchmarkReturnPct = benchmarkReturnFromCurve(curve) ?? finiteNumberOrNull(payload.benchmarkReturnPct) ?? 0

    return {
      strategyId: row.strategy_id,
      strategyName: row.strategy_name,
      admissionStatus: row.admission_status ?? "纸面模拟",
      admissionScore: row.admission_score ?? 0,
      backtestProfile: paperProfileFromPayload(row, payload),
      ledger: {
        driver: "postgres" as const,
        persisted: true,
        accountId: row.account_id,
        status: row.status,
        lastSyncedAt: formatTimestamp(row.last_synced_at) ?? undefined,
      },
      startedAt: formatTimestamp(row.started_at) ?? new Date().toISOString(),
      generatedAt: formatTimestamp(row.last_synced_at) ?? stringPayload(payload.generatedAt, new Date().toISOString()),
      range: opts.range ?? normalizeRange(payload.range),
      rangeLabel: stringPayload(payload.rangeLabel, rangeLabel(opts.range ?? normalizeRange(payload.range))),
      rangeStart: formatDateOnly(row.started_at) || curve[0]?.date || "",
      rangeEnd: curve.at(-1)?.date ?? formatDateOnly(row.last_synced_at ?? row.started_at),
      initialCapital,
      startEquity,
      currentEquity,
      availableCash,
      investedValue,
      rangeReturnPct: totalReturnPct,
      totalReturnPct,
      benchmarkReturnPct,
      maxDrawdownPct: Math.min(...curve.map((point) => point.drawdownPct), 0),
      tradeWinRatePct: closedTradeCount
        ? (closedTradeWinners / closedTradeCount) * 100
        : 0,
      openPositionCount: positions.length,
      closedTradeCount,
      orderCount,
      curve,
      positions: hasExecutedLedger ? positions : [],
      orders,
      closedTrades: hasExecutedLedger ? closedTrades : [],
      tradeCharts: [],
      options: withPaperConfluenceOption(optionRows.map((option) => ({
        id: option.strategy_id,
        name: option.strategy_name,
        status: option.admission_status ?? "纸面模拟",
        score: option.admission_score ?? 0,
        annualReturnPct: Number(parsePayload(option.payload).annualReturnPct) || 0,
        backtestProfile: paperProfileFromPayload(option, parsePayload(option.payload)),
        positionCount: Number(option.position_count) || 0,
        orderCount: Number(option.order_count) || 0,
        closedTradeCount: Number(option.closed_trade_count) || 0,
        lastSyncedAt: formatTimestamp(option.last_synced_at) ?? undefined,
        startedAt: formatTimestamp(option.started_at) ?? undefined,
      }))),
    } satisfies Omit<PaperAccount, "runtime">
  } catch {
    return null
  }
}

export async function listActivePaperLedgerAccounts(limit = 12): Promise<PaperLedgerAccountOption[]> {
  if (!(await ensurePaperLedgerTables())) return []

  try {
    const sql = await getSharedPostgresClient()
    const rows = await sql<PaperAccountRow[]>`
      with active_accounts as (
        select account_id, strategy_id, strategy_name, admission_status, admission_score,
               initial_capital, started_at, status, last_synced_at, payload, updated_at
        from paper_accounts
        where account_scope = ${ACCOUNT_SCOPE} and status = 'active'
      ),
      position_counts as (
        select p.account_id, count(*)::int as position_count
        from paper_positions p
        join active_accounts a using (account_id)
        group by p.account_id
      ),
      order_counts as (
        select o.account_id, count(*)::int as order_count, max(o.submitted_at) as recent_order_at
        from paper_orders o
        join active_accounts a using (account_id)
        group by o.account_id
      ),
      trade_counts as (
        select t.account_id, count(*)::int as closed_trade_count
        from paper_trades t
        join active_accounts a using (account_id)
        group by t.account_id
      )
      select a.account_id, a.strategy_id, a.strategy_name, a.admission_status, a.admission_score,
             a.initial_capital, a.started_at, a.status, a.last_synced_at, a.payload,
             coalesce(pc.position_count, 0)::int as position_count,
             coalesce(oc.order_count, 0)::int as order_count,
             coalesce(tc.closed_trade_count, 0)::int as closed_trade_count,
             oc.recent_order_at
      from active_accounts a
      left join position_counts pc using (account_id)
      left join order_counts oc using (account_id)
      left join trade_counts tc using (account_id)
      order by
        position_count desc,
        order_count desc,
        coalesce(a.admission_score, 0) desc,
        recent_order_at desc nulls last,
        last_synced_at desc nulls last,
        updated_at desc
      limit ${Math.max(1, Math.min(limit, 64))}
    `
    return rows.map((row) => ({
      strategyId: row.strategy_id,
      strategyName: row.strategy_name,
      admissionStatus: row.admission_status ?? "纸面模拟",
      admissionScore: row.admission_score ?? 0,
      startedAt: formatTimestamp(row.started_at) ?? new Date().toISOString(),
      lastSyncedAt: formatTimestamp(row.last_synced_at) ?? undefined,
      positionCount: Number(row.position_count) || 0,
      orderCount: Number(row.order_count) || 0,
      closedTradeCount: Number(row.closed_trade_count) || 0,
    }))
  } catch {
    return []
  }
}

export async function listRecentPaperOrders(limit = 80): Promise<RecentPaperOrderRecord[]> {
  if (!(await ensurePaperLedgerTables())) return []

  try {
    const sql = await getSharedPostgresClient()
    const rows = await sql<PaperOrderRow[]>`
      select
        o.order_id,
        o.account_id,
        coalesce(o.strategy_id, a.strategy_id) as strategy_id,
        a.strategy_name,
        o.source_signal_id,
        o.symbol,
        o.name,
        o.side,
        o.status,
        o.requested_qty,
        o.filled_qty,
        o.limit_price,
        o.filled_price,
        o.submitted_at,
        o.filled_at,
        o.note,
        o.payload
      from paper_orders o
      join paper_accounts a on a.account_id = o.account_id
      where a.account_scope = ${ACCOUNT_SCOPE}
      order by o.submitted_at desc
      limit ${Math.max(1, Math.min(limit, MAX_RECENT_PAPER_ORDERS))}
    `
    return rows.map(recentPaperOrderFromRow)
  } catch {
    return []
  }
}

export async function listPaperPositionsForSymbol(symbol: string, limit = 24): Promise<PaperPositionRecord[]> {
  const normalized = symbol.trim().slice(0, 6)
  if (!/^\d{6}$/.test(normalized) || !(await ensurePaperLedgerTables())) return []

  try {
    const sql = await getSharedPostgresClient()
    const rows = await sql<Array<PaperPositionRow & {
      account_id: string
      strategy_id: string
      strategy_name: string
    }>>`
      select
        p.symbol,
        p.name,
        p.shares,
        p.weight_pct,
        p.cost_price,
        p.current_price,
        p.market_value,
        p.unrealized_pnl,
        p.pnl_pct,
        p.holding_days,
        p.opened_at,
        p.payload,
        a.account_id,
        a.strategy_id,
        a.strategy_name
      from paper_positions p
      join paper_accounts a on a.account_id = p.account_id
      where a.account_scope = ${ACCOUNT_SCOPE}
        and a.status = 'active'
        and p.symbol = ${normalized}
      order by p.market_value desc, p.opened_at asc nulls last
      limit ${Math.max(1, Math.min(limit, 80))}
    `
    return rows.map((row) => {
      const position = positionFromRow(row)
      return {
        accountId: row.account_id,
        strategyId: row.strategy_id,
        strategyName: row.strategy_name,
        symbol: position.symbol,
        name: position.name,
        shares: position.shares,
        costPrice: position.costPrice,
        currentPrice: position.currentPrice,
        marketValue: position.marketValue,
        pnlPct: position.pnlPct,
        openedAt: position.openedAt,
        sellableFrom: position.sellableFrom,
        sellable: position.sellable,
      }
    })
  } catch {
    return []
  }
}

export async function listPaperOrdersForConfluence(options: {
  fromDate: string
  toDate: string
  limit?: number
}): Promise<RecentPaperOrderRecord[]> {
  if (!(await ensurePaperLedgerTables())) return []

  try {
    const sql = await getSharedPostgresClient()
    const rows = await sql<PaperOrderRow[]>`
      select
        o.order_id,
        o.account_id,
        coalesce(o.strategy_id, a.strategy_id) as strategy_id,
        a.strategy_name,
        o.source_signal_id,
        o.symbol,
        o.name,
        o.side,
        o.status,
        o.requested_qty,
        o.filled_qty,
        o.limit_price,
        o.filled_price,
        o.submitted_at,
        o.filled_at,
        o.note,
        o.payload
      from paper_orders o
      join paper_accounts a on a.account_id = o.account_id
      where a.account_scope = ${ACCOUNT_SCOPE}
        and a.status = 'active'
        and o.side = 'buy'
        and coalesce(o.strategy_id, a.strategy_id) <> ${PAPER_CONFLUENCE_STRATEGY_ID}
        and o.submitted_at >= ${chinaDateStart(options.fromDate)}
        and o.submitted_at < ${chinaDateStart(shiftDateOnly(options.toDate, 1))}
      order by o.submitted_at desc
      limit ${Math.max(1, Math.min(options.limit ?? MAX_CONFLUENCE_PAPER_ORDERS, MAX_CONFLUENCE_PAPER_ORDERS))}
    `
    return rows.map(recentPaperOrderFromRow)
  } catch {
    return []
  }
}

export async function syncPaperLedgerSnapshot(account: PaperAccount) {
  if (!account.strategyId || !(await ensurePaperLedgerTables())) {
    return { ok: false, driver: hasSharedPostgresConfig() ? "postgres" as const : "memory" as const }
  }

  try {
    const sql = await getSharedPostgresClient()
    const accountId = account.ledger.accountId ?? paperAccountId(account.strategyId)
    const asOf = account.rangeEnd || formatDateOnly(account.startedAt)
    const syncedAt = new Date().toISOString()
    const selectedOption = account.options.find((option) => option.id === account.strategyId)
    const accountPayload: {
      range: PaperAccount["range"]
      rangeLabel: string
      currentEquity: number
      rangeReturnPct: number
      generatedAt: string
      openPositionCount: number
      orderCount: number
      closedTradeCount: number
      annualReturnPct?: number
      backtestProfile?: PaperBacktestProfile
    } = {
      range: account.range,
      rangeLabel: account.rangeLabel,
      currentEquity: account.currentEquity,
      rangeReturnPct: account.rangeReturnPct,
      generatedAt: account.generatedAt,
      openPositionCount: account.openPositionCount,
      orderCount: account.orderCount,
      closedTradeCount: account.closedTradeCount,
    }
    if (selectedOption && selectedOption.annualReturnPct !== 0) {
      accountPayload.annualReturnPct = selectedOption.annualReturnPct
    }
    if (selectedOption?.backtestProfile) {
      accountPayload.backtestProfile = selectedOption.backtestProfile
    }

    const existingExecutionCounts = await paperExecutionCounts(sql, accountId)
    const emptyComputedLedger = !account.positions.length && !account.orders.length && !account.closedTrades.length
    if (emptyComputedLedger) {
      if (existingExecutionCounts.positions > 0 || existingExecutionCounts.orders > 0 || existingExecutionCounts.trades > 0) {
        await sql`
          update paper_accounts
          set last_synced_at = now(),
              payload = (
                case
                  when jsonb_typeof(coalesce(paper_accounts.payload, '{}'::jsonb)) = 'object'
                    then coalesce(paper_accounts.payload, '{}'::jsonb)
                  else '{}'::jsonb
                end
              ) || ${sql.json({
                lastEmptyReplaySkippedAt: syncedAt,
                lastEmptyReplayReason: "signal ledger replay returned no execution records; preserved existing paper ledger",
              })},
              updated_at = now()
          where account_id = ${accountId}
        `
        return {
        ok: true,
        driver: "postgres" as const,
        syncedAt,
        preservedExisting: true,
        error: "本次信号回放为空，已保留原有模拟账户，避免误清仓。",
      }
      }
    }

    const replayLooksTruncated =
      (existingExecutionCounts.orders > 0 && account.orders.length > 0 && account.orders.length < existingExecutionCounts.orders) ||
      (existingExecutionCounts.trades > 0 && account.closedTrades.length > 0 && account.closedTrades.length < existingExecutionCounts.trades)
    if (replayLooksTruncated) {
      await sql`
        update paper_accounts
        set last_synced_at = now(),
            payload = (
              case
                when jsonb_typeof(coalesce(paper_accounts.payload, '{}'::jsonb)) = 'object'
                  then coalesce(paper_accounts.payload, '{}'::jsonb)
                else '{}'::jsonb
              end
            ) || ${sql.json({
              lastTruncatedReplaySkippedAt: syncedAt,
              lastTruncatedReplayReason: "signal ledger replay produced fewer execution rows than the persisted paper ledger; preserved existing ledger",
              computedOrderCount: account.orders.length,
              computedClosedTradeCount: account.closedTrades.length,
              persistedOrderCount: existingExecutionCounts.orders,
              persistedClosedTradeCount: existingExecutionCounts.trades,
            })},
            updated_at = now()
        where account_id = ${accountId}
      `
      return {
        ok: true,
        driver: "postgres" as const,
        syncedAt,
        preservedExisting: true,
        error: "本次账本回放少于数据库既有记录，已保留原模拟账户，避免历史订单或平仓被截断覆盖。",
      }
    }

    await sql.begin(async (tx) => {
      await tx`
        update paper_accounts
        set strategy_name = ${account.strategyName},
            admission_status = ${account.admissionStatus},
            admission_score = ${account.admissionScore},
            last_synced_at = now(),
            payload = (
              case
                when jsonb_typeof(coalesce(paper_accounts.payload, '{}'::jsonb)) = 'object'
                  then coalesce(paper_accounts.payload, '{}'::jsonb)
                else '{}'::jsonb
              end
            ) || ${tx.json(accountPayload)},
            updated_at = now()
        where account_id = ${accountId}
      `

      await replaceEquityCurve(tx, accountId, account, asOf)
      await replacePositions(tx, accountId, account)
      await upsertOrders(tx, accountId, account)
      await replaceClosedTrades(tx, accountId, account)
    })

    return { ok: true, driver: "postgres" as const, syncedAt }
  } catch (error) {
    return {
      ok: false,
      driver: "postgres" as const,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function paperExecutionCounts(sql: Awaited<ReturnType<typeof getSharedPostgresClient>>, accountId: string) {
  const rows = await sql<Array<{ positions: number; orders: number; trades: number }>>`
    select
      (select count(*)::int from paper_positions where account_id = ${accountId}) as positions,
      (select count(*)::int from paper_orders where account_id = ${accountId}) as orders,
      (select count(*)::int from paper_trades where account_id = ${accountId}) as trades
  `
  const row = rows[0]
  return {
    positions: Number(row?.positions) || 0,
    orders: Number(row?.orders) || 0,
    trades: Number(row?.trades) || 0,
  }
}

function finiteCount(value: unknown, fallback: number) {
  const count = Number(value)
  return Number.isFinite(count) && count >= 0 ? count : fallback
}

async function clearPaperLedgerExecutions(sql: Awaited<ReturnType<typeof getSharedPostgresClient>>, accountId: string) {
  await sql.begin(async (tx) => {
    await tx`delete from paper_trades where account_id = ${accountId}`
    await tx`delete from paper_orders where account_id = ${accountId}`
    await tx`delete from paper_positions where account_id = ${accountId}`
    await tx`delete from paper_equity_curve where account_id = ${accountId}`
  })
}

function paperAccountId(strategyId: string) {
  return `paper:${ACCOUNT_SCOPE}:${strategyId}`
}

function withPaperConfluenceOption(options: PaperAccount["options"]): PaperAccount["options"] {
  if (options.some((option) => option.id === PAPER_CONFLUENCE_STRATEGY_ID)) return options
  return [
    ...options,
    {
      id: PAPER_CONFLUENCE_STRATEGY_ID,
      name: PAPER_CONFLUENCE_STRATEGY_NAME,
      status: PAPER_CONFLUENCE_ADMISSION_STATUS,
      score: PAPER_CONFLUENCE_ADMISSION_SCORE,
      annualReturnPct: 0,
      backtestProfile: {
        status: "信号代理",
        source: "paper-confluence",
        score: PAPER_CONFLUENCE_ADMISSION_SCORE,
        annualReturnPct: 0,
        excessReturnPct: 0,
        maxDrawdownPct: 0,
        winRatePct: 0,
        sharpe: 0,
      },
      positionCount: 0,
      orderCount: 0,
      closedTradeCount: 0,
    },
  ]
}

async function replaceEquityCurve(tx: TransactionSql, accountId: string, account: PaperAccount, asOf: string) {
  await tx`delete from paper_equity_curve where account_id = ${accountId}`

  const points = account.curve.length
    ? account.curve
    : [{
        date: asOf,
        equity: account.currentEquity,
        benchmarkEquity: account.initialCapital,
        returnPct: account.rangeReturnPct,
        drawdownPct: account.maxDrawdownPct,
      }]
  const rows = points.map((point) => ({
    account_id: accountId,
    as_of: point.date || asOf,
    equity: point.equity,
    cash: point.date === account.rangeEnd ? account.availableCash : point.equity,
    invested_value: point.date === account.rangeEnd ? account.investedValue : 0,
    benchmark_equity: point.benchmarkEquity ?? account.initialCapital,
    return_pct: point.returnPct,
    drawdown_pct: point.drawdownPct,
    payload: JSON.stringify({
      range: account.range,
      points: points.length,
      startEquity: account.startEquity,
      totalReturnPct: account.totalReturnPct,
      benchmarkReturnPct: account.benchmarkReturnPct,
    }),
  }))

  if (!rows.length) return
  for (const chunk of chunks(rows, 100)) {
    await tx`
      insert into paper_equity_curve ${tx(
        chunk,
        "account_id",
        "as_of",
        "equity",
        "cash",
        "invested_value",
        "benchmark_equity",
        "return_pct",
        "drawdown_pct",
        "payload",
      )}
      on conflict (account_id, as_of) do update set
        equity = excluded.equity,
        cash = excluded.cash,
        invested_value = excluded.invested_value,
        benchmark_equity = excluded.benchmark_equity,
        return_pct = excluded.return_pct,
        drawdown_pct = excluded.drawdown_pct,
        payload = excluded.payload,
        updated_at = now()
    `
  }
}

async function replacePositions(tx: TransactionSql, accountId: string, account: PaperAccount) {
  await tx`delete from paper_positions where account_id = ${accountId}`
  if (!account.positions.length) return

  const rows = account.positions.map((position) => ({
    account_id: accountId,
    symbol: position.symbol,
    name: position.name,
    shares: position.shares,
    weight_pct: position.weightPct,
    cost_price: position.costPrice,
    current_price: position.currentPrice,
    market_value: position.marketValue,
    unrealized_pnl: position.unrealizedPnl,
    pnl_pct: position.pnlPct,
    holding_days: position.holdingDays,
    opened_at: position.openedAt,
    payload: JSON.stringify({
      source: "paper-account-snapshot",
      sellableFrom: position.sellableFrom,
      sellable: position.sellable,
    }),
  }))

  for (const chunk of chunks(rows, 100)) {
    await tx`
      insert into paper_positions ${tx(
        chunk,
        "account_id",
        "symbol",
        "name",
        "shares",
        "weight_pct",
        "cost_price",
        "current_price",
        "market_value",
        "unrealized_pnl",
        "pnl_pct",
        "holding_days",
        "opened_at",
        "payload",
      )}
      on conflict (account_id, symbol) do update set
        name = excluded.name,
        shares = excluded.shares,
        weight_pct = excluded.weight_pct,
        cost_price = excluded.cost_price,
        current_price = excluded.current_price,
        market_value = excluded.market_value,
        unrealized_pnl = excluded.unrealized_pnl,
        pnl_pct = excluded.pnl_pct,
        holding_days = excluded.holding_days,
        opened_at = excluded.opened_at,
        payload = excluded.payload,
        updated_at = now()
    `
  }
}

async function upsertOrders(tx: TransactionSql, accountId: string, account: PaperAccount) {
  await tx`delete from paper_orders where account_id = ${accountId}`
  if (!account.orders.length) return

  const rows = account.orders.map((order) => paperOrderRow(accountId, account, order))
  for (const chunk of chunks(rows, 100)) {
    await tx`
      insert into paper_orders ${tx(
        chunk,
        "order_id",
        "account_id",
        "strategy_id",
        "source_signal_id",
        "symbol",
        "name",
        "side",
        "order_type",
        "status",
        "requested_qty",
        "filled_qty",
        "limit_price",
        "filled_price",
        "submitted_at",
        "filled_at",
        "note",
        "payload",
      )}
      on conflict (order_id) do update set
        status = excluded.status,
        requested_qty = excluded.requested_qty,
        filled_qty = excluded.filled_qty,
        limit_price = excluded.limit_price,
        filled_price = excluded.filled_price,
        filled_at = excluded.filled_at,
        note = excluded.note,
        payload = excluded.payload,
        updated_at = now()
    `
  }
}

function paperOrderRow(accountId: string, account: PaperAccount, order: PaperOrder) {
  return {
    order_id: order.orderId,
    account_id: accountId,
    strategy_id: account.strategyId,
    source_signal_id: order.signalId ?? null,
    symbol: order.symbol,
    name: order.name,
    side: order.side,
    order_type: "market",
    status: order.status === "skipped" ? "cancelled" : order.status,
    requested_qty: order.requestedShares,
    filled_qty: order.filledShares,
    limit_price: order.limitPrice,
    filled_price: order.filledPrice ?? null,
    submitted_at: new Date(order.submittedAt),
    filled_at: order.filledAt ? new Date(order.filledAt) : null,
    note: order.note,
    payload: JSON.stringify({
      amount: order.amount,
      paperStatus: order.status,
      source: "paper-signal-execution",
    }),
  }
}

async function replaceClosedTrades(tx: TransactionSql, accountId: string, account: PaperAccount) {
  await tx`delete from paper_trades where account_id = ${accountId}`
  if (!account.closedTrades.length) return

  const rows = account.closedTrades.map((trade) => ({
    trade_id: trade.tradeId ?? `${accountId}:${trade.symbol}:${trade.entryDate}:${trade.exitDate}`,
    account_id: accountId,
    order_id: trade.exitOrderId ?? null,
    symbol: trade.symbol,
    name: trade.name,
    side: "sell",
    qty: trade.shares ?? null,
    price: trade.exitPrice ?? null,
    amount: trade.amount ?? null,
    commission: 0,
    trade_time: new Date(`${trade.exitDate}T15:00:00+08:00`),
    payload: JSON.stringify({
      entryDate: trade.entryDate,
      exitDate: trade.exitDate,
      exitReason: trade.exitReason,
      entryOrderId: trade.entryOrderId,
      entryPrice: trade.entryPrice,
      returnPct: trade.returnPct,
      alphaPct: trade.alphaPct,
      holdingDays: trade.holdingDays,
    }),
  }))

  for (const chunk of chunks(rows, 100)) {
    await tx`
      insert into paper_trades ${tx(
        chunk,
        "trade_id",
        "account_id",
        "order_id",
        "symbol",
        "name",
        "side",
        "qty",
        "price",
        "amount",
        "commission",
        "trade_time",
        "payload",
      )}
      on conflict (trade_id) do update set
        name = excluded.name,
        order_id = excluded.order_id,
        qty = excluded.qty,
        price = excluded.price,
        amount = excluded.amount,
        commission = excluded.commission,
        trade_time = excluded.trade_time,
        payload = excluded.payload
    `
  }
}

async function ensurePaperLedgerTables() {
  if (paperTablesReady) return true
  if (paperTablesUnavailable || !hasSharedPostgresConfig()) return false

  try {
    const sql = await getSharedPostgresClient()
    try {
      await Promise.all([
        sql`select account_id from paper_accounts where false`,
        sql`select as_of from paper_equity_curve where false`,
        sql`select symbol from paper_positions where false`,
        sql`select order_id from paper_orders where false`,
        sql`select trade_id from paper_trades where false`,
      ])
      paperTablesReady = true
      return true
    } catch (error) {
      if (!isUndefinedTable(error)) throw error
    }

    await createPaperLedgerTables(sql)
    paperTablesReady = true
    return true
  } catch {
    paperTablesUnavailable = true
    return false
  }
}

async function createPaperLedgerTables(sql: Sql) {
  await sql`
    create table if not exists paper_accounts (
      account_id text primary key,
      account_scope text not null default 'default',
      strategy_id text not null,
      strategy_name text not null,
      admission_status text,
      admission_score integer not null default 0,
      initial_capital double precision not null default 1000000,
      started_at timestamptz not null,
      status text not null default 'active',
      last_synced_at timestamptz,
      payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (account_scope, strategy_id)
    )
  `
  await sql`
    create table if not exists paper_equity_curve (
      account_id text not null references paper_accounts(account_id) on delete cascade,
      as_of date not null,
      equity double precision not null,
      cash double precision not null,
      invested_value double precision not null,
      benchmark_equity double precision,
      return_pct double precision not null default 0,
      drawdown_pct double precision not null default 0,
      payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (account_id, as_of)
    )
  `
  await sql`
    create table if not exists paper_positions (
      account_id text not null references paper_accounts(account_id) on delete cascade,
      symbol text not null,
      name text not null,
      shares double precision not null default 0,
      weight_pct double precision not null default 0,
      cost_price double precision not null default 0,
      current_price double precision not null default 0,
      market_value double precision not null default 0,
      unrealized_pnl double precision not null default 0,
      pnl_pct double precision not null default 0,
      holding_days integer not null default 0,
      opened_at date,
      payload jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      primary key (account_id, symbol)
    )
  `
  await sql`
    create table if not exists paper_orders (
      order_id text primary key,
      account_id text not null references paper_accounts(account_id) on delete cascade,
      strategy_id text,
      source_signal_id text,
      symbol text not null,
      name text,
      side text not null,
      order_type text not null default 'market',
      status text not null default 'pending',
      requested_qty double precision,
      filled_qty double precision,
      limit_price double precision,
      filled_price double precision,
      submitted_at timestamptz not null default now(),
      filled_at timestamptz,
      note text,
      payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `
  await sql`
    create table if not exists paper_trades (
      trade_id text primary key,
      account_id text not null references paper_accounts(account_id) on delete cascade,
      order_id text references paper_orders(order_id) on delete set null,
      symbol text not null,
      name text,
      side text not null,
      qty double precision,
      price double precision,
      amount double precision,
      commission double precision not null default 0,
      trade_time timestamptz not null,
      payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    )
  `
  await sql`create index if not exists paper_accounts_strategy_idx on paper_accounts (strategy_id, status)`
  await tryEnsurePaperLedgerIndexes(sql)
  await sql`alter table paper_accounts enable row level security`
  await sql`alter table paper_equity_curve enable row level security`
  await sql`alter table paper_positions enable row level security`
  await sql`alter table paper_orders enable row level security`
  await sql`alter table paper_trades enable row level security`
  await configurePaperLedgerSecurity(sql)
}

async function ensurePaperLedgerIndexes(sql: Sql) {
  await sql`create index if not exists paper_accounts_scope_strategy_idx on paper_accounts (account_scope, strategy_id)`
  await sql`create index if not exists paper_accounts_scope_status_idx on paper_accounts (account_scope, status, updated_at desc)`
  await sql`create index if not exists paper_equity_curve_as_of_idx on paper_equity_curve (account_id, as_of desc)`
  await sql`create index if not exists paper_positions_account_value_idx on paper_positions (account_id, market_value desc)`
  await sql`create index if not exists paper_orders_account_status_idx on paper_orders (account_id, status, submitted_at desc)`
  await sql`create index if not exists paper_orders_account_submitted_idx on paper_orders (account_id, submitted_at desc)`
  await sql`create index if not exists paper_orders_side_submitted_idx on paper_orders (side, submitted_at desc)`
  await sql`create index if not exists paper_orders_submitted_at_idx on paper_orders (submitted_at desc)`
  await sql`create index if not exists paper_trades_account_time_idx on paper_trades (account_id, trade_time desc)`
  await sql`create index if not exists paper_trades_order_id_idx on paper_trades (order_id)`
}

async function tryEnsurePaperLedgerIndexes(sql: Sql) {
  try {
    await ensurePaperLedgerIndexes(sql)
  } catch {
    // Index creation is an optimization. A read-only or RLS-constrained role must still be able to read the ledger.
  }
}

async function configurePaperLedgerSecurity(sql: Sql) {
  await sql`
    do $$
    declare
      app_role text;
      table_name text;
    begin
      foreach app_role in array array[current_user, 'service_role']
      loop
        if exists (select 1 from pg_roles where rolname = app_role) then
          foreach table_name in array array[
            'paper_accounts',
            'paper_equity_curve',
            'paper_positions',
            'paper_orders',
            'paper_trades'
          ]
          loop
            execute format('drop policy if exists %I on public.%I', app_role || '_all', table_name);
            execute format(
              'create policy %I on public.%I for all to %I using (true) with check (true)',
              app_role || '_all',
              table_name,
              app_role
            );
          end loop;
        end if;
      end loop;
    end $$;
  `
}

function isUndefinedTable(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "42P01",
  )
}

function formatTimestamp(value?: string | Date | null) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function formatDateOnly(value?: string | Date | null) {
  if (!value) return ""
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return typeof value === "string" ? value.slice(0, 10) : ""
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

function chinaDateStart(date: string) {
  return new Date(`${date}T00:00:00+08:00`)
}

function shiftDateOnly(date: string, days: number) {
  const parsed = chinaDateStart(date)
  if (!Number.isFinite(parsed.getTime())) return date
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return formatDateOnly(parsed)
}

function finiteNumber(value: unknown, fallback: number) {
  if (value === null || value === undefined || value === "") return fallback
  const number = typeof value === "number" ? value : Number(value)
  return Number.isFinite(number) ? number : fallback
}

function finiteNumberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const number = typeof value === "number" ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function hasPaperExecution(input: {
  positions: PaperPosition[]
  orders: PaperOrder[]
  closedTrades: PaperClosedTrade[]
}) {
  return input.positions.length > 0 ||
    input.closedTrades.length > 0 ||
    input.orders.some((order) => order.status === "filled" && order.filledShares > 0)
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

function roundPct(value: number) {
  return Math.round(value * 100) / 100
}

function normalizePaperEquityCurve(
  rows: PaperEquityRow[],
  opts: { initialCapital: number; startedAt: string | Date; currentEquity: number },
): PaperAccount["curve"] {
  const initialCapital = finiteNumber(opts.initialCapital, SEEDED_INITIAL_CAPITAL)
  const startDate = formatDateOnly(opts.startedAt)
  const pointsByDate = new Map<string, PaperAccount["curve"][number]>()

  for (const row of rows) {
    const date = formatDateOnly(row.as_of)
    if (!date) continue
    pointsByDate.set(date, {
      date,
      equity: roundMoney(finiteNumber(row.equity, initialCapital)),
      benchmarkEquity: roundMoney(finiteNumber(row.benchmark_equity, initialCapital)),
      returnPct: 0,
      drawdownPct: 0,
    })
  }

  if (startDate && !pointsByDate.has(startDate)) {
    pointsByDate.set(startDate, {
      date: startDate,
      equity: initialCapital,
      benchmarkEquity: initialCapital,
      returnPct: 0,
      drawdownPct: 0,
    })
  }

  const fallbackDate = startDate || formatDateOnly(new Date())
  if (!pointsByDate.size) {
    pointsByDate.set(fallbackDate, {
      date: fallbackDate,
      equity: roundMoney(opts.currentEquity),
      benchmarkEquity: initialCapital,
      returnPct: 0,
      drawdownPct: 0,
    })
  }

  const points = Array.from(pointsByDate.values()).sort((a, b) => a.date.localeCompare(b.date))
  const lastPoint = points.at(-1)
  if (lastPoint) {
    lastPoint.equity = roundMoney(opts.currentEquity)
  }

  let peak = initialCapital
  return points.map((point) => {
    peak = Math.max(peak, point.equity)
    return {
      ...point,
      returnPct: initialCapital > 0 ? roundPct((point.equity / initialCapital - 1) * 100) : 0,
      drawdownPct: peak > 0 ? roundPct((point.equity / peak - 1) * 100) : 0,
    }
  })
}

function benchmarkReturnFromCurve(curve: PaperAccount["curve"]) {
  const first = curve[0]?.benchmarkEquity
  const latest = curve.at(-1)?.benchmarkEquity
  if (!first || !latest || first <= 0) return null
  return roundPct((latest / first - 1) * 100)
}

function parsePayload(value: unknown): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== "string") return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function paperProfileFromPayload(
  row: Pick<PaperAccountRow, "strategy_id" | "admission_score" | "last_synced_at" | "payload">,
  payload = parsePayload(row.payload),
): PaperBacktestProfile {
  const nested = parsePayload(payload.backtestProfile)
  const isConfluence = row.strategy_id === PAPER_CONFLUENCE_STRATEGY_ID
  const source = stringPayload(nested.source ?? payload.backtestSource, isConfluence ? "paper-confluence" : "Qveris")
  const annualReturnPct = finiteNumber(nested.annualReturnPct ?? payload.annualReturnPct, 0)
  const maxDrawdownPct = Math.abs(finiteNumber(nested.maxDrawdownPct ?? payload.maxDrawdownPct, 0))
  const score = finiteNumber(nested.score ?? payload.backtestScore ?? row.admission_score, 0)
  const status = isConfluence
    ? "信号代理"
    : normalizeBacktestStatus(nested.status ?? payload.backtestStatus, {
        source,
        score,
        annualReturnPct,
      })

  return {
    status,
    source,
    score,
    annualReturnPct,
    excessReturnPct: finiteNumber(nested.excessReturnPct ?? payload.excessReturnPct, 0),
    maxDrawdownPct,
    winRatePct: finiteNumber(nested.winRatePct ?? payload.winRatePct, 0),
    sharpe: finiteNumber(nested.sharpe ?? payload.sharpe, 0),
    period: stringPayload(nested.period ?? payload.backtestPeriod, ""),
    finishedAt: stringPayload(
      nested.finishedAt ?? payload.backtestedAt ?? payload.generatedAt,
      formatTimestamp(row.last_synced_at) ?? "",
    ),
  }
}

function normalizeBacktestStatus(
  value: unknown,
  fallback: { source: string; score: number; annualReturnPct: number },
): PaperBacktestProfile["status"] {
  if (value === "真实回测" || value === "代理回测" || value === "信号代理" || value === "待补回测") return value
  if (fallback.source.includes("signal") || fallback.source.includes("confluence")) return "信号代理"
  if (fallback.source.includes("代理")) return "代理回测"
  if (fallback.score !== 0 || fallback.annualReturnPct !== 0) return "真实回测"
  return "待补回测"
}

function normalizeRange(value: unknown): PaperAccount["range"] {
  if (value === "1m" || value === "3m" || value === "all") return value
  return "3m"
}

function rangeLabel(range: PaperAccount["range"]) {
  if (range === "1m") return "近一月"
  if (range === "3m") return "近三月"
  return "交易至今"
}

function positionFromRow(row: PaperPositionRow): PaperPosition {
  const payload = parsePayload(row.payload)
  const openedAt = formatDateOnly(row.opened_at)
  return {
    symbol: row.symbol,
    name: row.name,
    shares: row.shares,
    weightPct: row.weight_pct,
    costPrice: row.cost_price,
    currentPrice: row.current_price,
    marketValue: row.market_value,
    unrealizedPnl: row.unrealized_pnl,
    pnlPct: row.pnl_pct,
    holdingDays: row.holding_days,
    openedAt,
    sellableFrom: typeof payload.sellableFrom === "string" ? payload.sellableFrom : openedAt,
    sellable: typeof payload.sellable === "boolean" ? payload.sellable : true,
  }
}

function orderFromRow(row: PaperOrderRow): PaperOrder {
  const payload = parsePayload(row.payload)
  return {
    orderId: row.order_id,
    signalId: row.source_signal_id ?? undefined,
    symbol: row.symbol,
    name: row.name ?? row.symbol,
    side: row.side,
    status: paperOrderStatus(row.status, payload.paperStatus),
    requestedShares: row.requested_qty ?? 0,
    filledShares: row.filled_qty ?? 0,
    limitPrice: row.limit_price ?? 0,
    filledPrice: row.filled_price ?? undefined,
    submittedAt: formatTimestamp(row.submitted_at) ?? new Date().toISOString(),
    filledAt: formatTimestamp(row.filled_at) ?? undefined,
    amount: numberPayload(payload.amount, 0),
    note: row.note ?? "",
  }
}

function recentPaperOrderFromRow(row: PaperOrderRow): RecentPaperOrderRecord {
  const order = orderFromRow(row)
  return {
    orderId: row.order_id,
    accountId: row.account_id ?? "",
    strategyId: row.strategy_id ?? "",
    strategyName: row.strategy_name ?? row.strategy_id ?? "策略账户",
    symbol: order.symbol,
    name: order.name,
    side: order.side,
    status: order.status,
    requestedShares: order.requestedShares,
    filledShares: order.filledShares,
    limitPrice: order.limitPrice,
    filledPrice: order.filledPrice,
    submittedAt: order.submittedAt,
    filledAt: order.filledAt,
    note: order.note,
  }
}

function tradeFromRow(row: PaperTradeRow): PaperClosedTrade {
  const payload = parsePayload(row.payload)
  const tradeDate = formatDateOnly(row.trade_time)
  return {
    tradeId: row.trade_id,
    entryOrderId: typeof payload.entryOrderId === "string" ? payload.entryOrderId : undefined,
    exitOrderId: row.order_id ?? (typeof payload.exitOrderId === "string" ? payload.exitOrderId : undefined),
    symbol: row.symbol,
    name: row.name ?? row.symbol,
    entryDate: typeof payload.entryDate === "string" ? payload.entryDate : tradeDate,
    exitDate: typeof payload.exitDate === "string" ? payload.exitDate : tradeDate,
    exitReason: paperExitReason(payload.exitReason),
    entryPrice: numberOrUndefined(payload.entryPrice),
    exitPrice: row.price ?? numberOrUndefined(payload.exitPrice),
    shares: row.qty ?? numberOrUndefined(payload.shares),
    amount: row.amount ?? numberOrUndefined(payload.amount),
    returnPct: numberPayload(payload.returnPct, 0),
    alphaPct: numberPayload(payload.alphaPct, numberPayload(payload.returnPct, 0)),
    holdingDays: Math.round(numberPayload(payload.holdingDays, 0)),
  }
}

function paperOrderStatus(status: string, payloadStatus: unknown): PaperOrder["status"] {
  if (payloadStatus === "filled" || payloadStatus === "rejected" || payloadStatus === "skipped") return payloadStatus
  if (status === "filled") return "filled"
  if (status === "rejected") return "rejected"
  return "skipped"
}

function paperExitReason(value: unknown): PaperClosedTrade["exitReason"] {
  return typeof value === "string" && value ? value as PaperClosedTrade["exitReason"] : "雷达退出"
}

function numberOrUndefined(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function numberPayload(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function stringPayload(value: unknown, fallback: string) {
  return typeof value === "string" && value ? value : fallback
}

function chunks<T>(values: T[], size: number) {
  const out: T[][] = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
  return out
}
