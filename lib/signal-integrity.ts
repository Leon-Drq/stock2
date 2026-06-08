import { getChinaMarketSession, type ChinaMarketSession } from "@/lib/cn-market-session"
import { PAPER_CONFLUENCE_STRATEGY_ID } from "@/lib/paper-confluence-constants"
import { loadPaperConfluenceSignals, PAPER_CONFLUENCE_ORDER_LIMIT } from "@/lib/paper-confluence"
import type { RecentPaperOrderRecord } from "@/lib/paper-trading-store"
import { listActivePaperLedgerAccounts, listRecentPaperOrders, type PaperLedgerAccountOption } from "@/lib/paper-trading-store"
import type { RadarHistoryRecord } from "@/lib/radar-history"
import { excludeSignalsWithLaterExits, recordsToExitRecordsForTradeDate, recordsToOpenSignalsForTradeDate } from "@/lib/radar-ledger-signals"
import { loadRadarSignalHistoryRecordsForTradeDate } from "@/lib/radar-signal-store"
import { loadTodayRadarSignalView, type TodayRadarSignalView } from "@/lib/signal-ledger-view"

export type SignalIntegritySeverity = "ok" | "info" | "warning" | "critical"
export type SignalIntegrityReadStatus = "ok" | "empty" | "timeout" | "error"

export type SignalIntegrityIssue = {
  id: string
  severity: Exclude<SignalIntegritySeverity, "ok">
  title: string
  detail: string
  nextStep: string
  href: string
}

export type SignalIntegritySource = {
  id: string
  label: string
  href: string
  status: SignalIntegrityReadStatus
  statusLabel: string
  count: number
  latencyMs: number
  latestAt?: string
  message: string
}

export type SignalIntegritySnapshot = {
  checkedAt: string
  session: ChinaMarketSession
  status: SignalIntegritySeverity
  statusLabel: string
  score: number
  summary: {
    homeSignals: number
    ledgerOpenSignals: number
    ledgerRecords: number
    ledgerExitRecords: number
    snapshotSignals: number
    paperAccounts: number
    todayOrders: number
    todayBuyOrders: number
    filledBuyOrders: number
    skippedOrders: number
    rejectedOrders: number
    confluenceSignals: number
    confluenceFilledSignals: number
    confluenceAccountOnline: boolean
  }
  sources: SignalIntegritySource[]
  issues: SignalIntegrityIssue[]
  notes: string[]
}

type IntegrityRead<T> = {
  value: T
  status: SignalIntegrityReadStatus
  latencyMs: number
  itemCount: number
  latestAt?: string
  error?: string
}

const SIGNAL_INTEGRITY_TIMEOUT_MS = 10_000
const SIGNAL_INTEGRITY_CACHE_MS = 12_000

let integrityCache: { expiresAt: number; value: SignalIntegritySnapshot } | undefined
let integrityInFlight: Promise<SignalIntegritySnapshot> | undefined

export async function loadSignalIntegritySnapshot(): Promise<SignalIntegritySnapshot> {
  const now = Date.now()
  if (integrityCache && integrityCache.expiresAt > now) return integrityCache.value
  if (integrityInFlight) return integrityInFlight

  const promise = readSignalIntegritySnapshot()
  integrityInFlight = promise
  try {
    const value = await promise
    integrityCache = {
      value,
      expiresAt: Date.now() + SIGNAL_INTEGRITY_CACHE_MS,
    }
    return value
  } finally {
    if (integrityInFlight === promise) integrityInFlight = undefined
  }
}

async function readSignalIntegritySnapshot(): Promise<SignalIntegritySnapshot> {
  const session = getChinaMarketSession()
  const viewPromise = loadTodayRadarSignalView({
    marketSession: session,
    includeTodaySignals: session.isTradingDay,
    ledgerLimit: 800,
    ledgerTimeoutMs: 5_000,
    snapshotTimeoutMs: 5_000,
  })

  const [todayViewRead, ledgerRead, accountsRead, ordersRead, confluenceRead] = await Promise.all([
    readIntegritySource({
      promise: viewPromise,
      fallback: null,
      count: (value) => value?.signals.length ?? 0,
      latestAt: (value) => latestDate(value?.signals.map((signal) => signal.recommendedAt ?? signal.latestQuoteAt).filter(Boolean) as string[]),
    }),
    readIntegritySource({
      promise: session.isTradingDay ? loadRadarSignalHistoryRecordsForTradeDate(session.tradeDate, 1200) : Promise.resolve([]),
      fallback: [],
      count: (value) => value.length,
      latestAt: (value) => latestRecordAt(value),
    }),
    readIntegritySource({
      promise: listActivePaperLedgerAccounts(48),
      fallback: [],
      count: (value) => value.length,
      latestAt: (value) => latestDate(value.map((account) => account.lastSyncedAt ?? account.startedAt).filter(Boolean)),
    }),
    readIntegritySource({
      promise: listRecentPaperOrders(800),
      fallback: [],
      count: (value) => value.length,
      latestAt: (value) => latestDate(value.map((order) => order.filledAt ?? order.submittedAt).filter(Boolean)),
    }),
    readIntegritySource({
      promise: loadPaperConfluenceSignals({
        tradeDate: session.tradeDate,
        windowDays: 1,
        minStrategies: 2,
        limit: PAPER_CONFLUENCE_ORDER_LIMIT,
      }),
      fallback: [],
      count: (value) => value.length,
      latestAt: (value) => latestDate(value.map((signal) => signal.latestAt ?? signal.triggerAt).filter(Boolean)),
    }),
  ])

  const todayView = todayViewRead.value
  const ledgerRecords = ledgerRead.value
  const exitRecords = recordsToExitRecordsForTradeDate(ledgerRecords, session.tradeDate)
  const openSignals = excludeSignalsWithLaterExits(
    recordsToOpenSignalsForTradeDate(ledgerRecords, session.tradeDate),
    exitRecords,
  )
  const activeAccounts = accountsRead.value
  const recentOrders = ordersRead.value
  const todayOrders = recentOrders.filter((order) => chinaDate(order.submittedAt) === session.tradeDate)
  const todayBuyOrders = todayOrders.filter((order) => order.side === "buy")
  const filledBuyOrders = todayBuyOrders.filter((order) => order.status === "filled")
  const skippedOrders = todayOrders.filter((order) => order.status === "skipped")
  const rejectedOrders = todayOrders.filter((order) => order.status === "rejected")
  const confluenceSignals = confluenceRead.value
  const filledConfluenceSignals = confluenceSignals.filter((signal) => signal.status === "filled")
  const confluenceAccountOnline = activeAccounts.some((account) => account.strategyId === PAPER_CONFLUENCE_STRATEGY_ID)
  const confluenceOrdersToday = todayOrders.filter((order) => order.strategyId === PAPER_CONFLUENCE_STRATEGY_ID)

  const summary = {
    homeSignals: todayView?.signals.length ?? 0,
    ledgerOpenSignals: openSignals.length,
    ledgerRecords: ledgerRecords.length,
    ledgerExitRecords: exitRecords.length,
    snapshotSignals: todayView?.snapshotSignals.length ?? 0,
    paperAccounts: activeAccounts.length,
    todayOrders: todayOrders.length,
    todayBuyOrders: todayBuyOrders.length,
    filledBuyOrders: filledBuyOrders.length,
    skippedOrders: skippedOrders.length,
    rejectedOrders: rejectedOrders.length,
    confluenceSignals: confluenceSignals.length,
    confluenceFilledSignals: filledConfluenceSignals.length,
    confluenceAccountOnline,
  }

  const issues = buildIntegrityIssues({
    session,
    todayViewRead,
    ledgerRead,
    accountsRead,
    ordersRead,
    confluenceRead,
    todayView,
    ledgerRecords,
    openSignals,
    activeAccounts,
    todayOrders,
    filledBuyOrders,
    confluenceSignals,
    filledConfluenceSignals,
    confluenceAccountOnline,
    confluenceOrdersToday,
  })
  const status = issueStatus(issues)
  const score = integrityScore(issues)

  return {
    checkedAt: new Date().toISOString(),
    session,
    status,
    statusLabel: statusLabel(status),
    score,
    summary,
    sources: [
      sourceDiagnostic({
        id: "home",
        label: "首页驾驶舱",
        href: "/",
        read: todayViewRead,
        count: summary.homeSignals,
        message: todayView
          ? `${todayView.source} · ${summary.homeSignals} 条主信号 / ${summary.snapshotSignals} 条快照信号`
          : "首页信号视图读取失败",
      }),
      sourceDiagnostic({
        id: "radar-ledger",
        label: "雷达信号账本",
        href: "/radar/history",
        read: ledgerRead,
        count: summary.ledgerRecords,
        message: `${summary.ledgerOpenSignals} 条跟踪中，${summary.ledgerExitRecords} 条今日卖出/关闭`,
      }),
      sourceDiagnostic({
        id: "paper-accounts",
        label: "模拟账户",
        href: "/simulation",
        read: accountsRead,
        count: summary.paperAccounts,
        message: `${summary.paperAccounts} 个 active 策略账户`,
      }),
      sourceDiagnostic({
        id: "paper-orders",
        label: "模拟撮合流水",
        href: "/simulation",
        read: ordersRead,
        count: summary.todayOrders,
        message: `${summary.todayBuyOrders} 条今日买入，成交 ${summary.filledBuyOrders}，跳过 ${summary.skippedOrders}，拒单 ${summary.rejectedOrders}`,
      }),
      sourceDiagnostic({
        id: "paper-confluence",
        label: "多策略共振",
        href: "/simulation?strategy=paper-confluence",
        read: confluenceRead,
        count: summary.confluenceSignals,
        message: `${summary.confluenceSignals} 条共振，${summary.confluenceFilledSignals} 条已成交共振`,
      }),
    ],
    issues,
    notes: integrityNotes(session, todayView, summary),
  }
}

function buildIntegrityIssues({
  session,
  todayViewRead,
  ledgerRead,
  accountsRead,
  ordersRead,
  confluenceRead,
  todayView,
  ledgerRecords,
  openSignals,
  activeAccounts,
  todayOrders,
  filledBuyOrders,
  confluenceSignals,
  filledConfluenceSignals,
  confluenceAccountOnline,
  confluenceOrdersToday,
}: {
  session: ChinaMarketSession
  todayViewRead: IntegrityRead<TodayRadarSignalView | null>
  ledgerRead: IntegrityRead<RadarHistoryRecord[]>
  accountsRead: IntegrityRead<PaperLedgerAccountOption[]>
  ordersRead: IntegrityRead<RecentPaperOrderRecord[]>
  confluenceRead: IntegrityRead<Awaited<ReturnType<typeof loadPaperConfluenceSignals>>>
  todayView: TodayRadarSignalView | null
  ledgerRecords: RadarHistoryRecord[]
  openSignals: ReturnType<typeof recordsToOpenSignalsForTradeDate>
  activeAccounts: PaperLedgerAccountOption[]
  todayOrders: RecentPaperOrderRecord[]
  filledBuyOrders: RecentPaperOrderRecord[]
  confluenceSignals: Awaited<ReturnType<typeof loadPaperConfluenceSignals>>
  filledConfluenceSignals: Awaited<ReturnType<typeof loadPaperConfluenceSignals>>
  confluenceAccountOnline: boolean
  confluenceOrdersToday: RecentPaperOrderRecord[]
}) {
  const issues: SignalIntegrityIssue[] = []

  for (const [id, label, href, read] of [
    ["home-read", "首页信号视图", "/", todayViewRead],
    ["ledger-read", "雷达信号账本", "/radar/history", ledgerRead],
    ["paper-accounts-read", "模拟账户", "/simulation", accountsRead],
    ["paper-orders-read", "模拟撮合流水", "/simulation", ordersRead],
    ["paper-confluence-read", "多策略共振", "/simulation?strategy=paper-confluence", confluenceRead],
  ] as const) {
    if (read.status === "timeout" || read.status === "error") {
      issues.push({
        id,
        severity: read.status === "timeout" ? "warning" : "critical",
        title: `${label}读取${read.status === "timeout" ? "超时" : "失败"}`,
        detail: read.error ?? `读取耗时超过 ${SIGNAL_INTEGRITY_TIMEOUT_MS / 1000} 秒，页面可能会出现空态或旧数据。`,
        nextStep: `进入${label}对应页面核对，必要时检查数据库连接和相关 API 日志。`,
        href,
      })
    }
  }

  if (!session.isTradingDay) {
    issues.push({
      id: "market-closed",
      severity: "info",
      title: `${session.phaseLabel}不新增交易信号`,
      detail: session.note,
      nextStep: "等到下一个 A 股连续竞价时段，再检查雷达扫描、首页精选和模拟盘撮合是否同步。",
      href: "/radar",
    })
    return issues
  }

  const staleReason = todayView?.dataFreshness?.staleReason
  if (session.allowsNewSignals && todayView?.dataFreshness?.blocksNewSignals) {
    issues.push({
      id: "freshness-blocks-new-signals",
      severity: "critical",
      title: "行情新鲜度阻断今日新信号",
      detail: staleReason ?? "雷达快照标记数据不够新，系统不会用旧数据生成买入推荐。",
      nextStep: "先补齐最新 Qveris 行情或日线缓存，再运行雷达扫描任务。",
      href: "/data",
    })
  }

  if (session.allowsNewSignals && todayView?.source === "qveris+snapshot") {
    issues.push({
      id: "home-snapshot-fallback",
      severity: todayView.snapshotStale ? "critical" : "warning",
      title: "首页正在用雷达快照兜底",
      detail: todayView.fallbackReason ?? "今日信号账本为空，但快照里有动作级信号；这说明雷达写账或模拟盘接入可能滞后。",
      nextStep: "检查 /api/radar/cron 或 /api/radar/refresh 是否把快照信号写入雷达账本。",
      href: "/radar",
    })
  }

  if (todayView?.source === "qveris+ledger" && todayView.signals.length !== openSignals.length) {
    issues.push({
      id: "home-ledger-count-mismatch",
      severity: "warning",
      title: "首页主信号与雷达账本数量不一致",
      detail: `首页显示 ${todayView.signals.length} 条，雷达账本按同一交易日过滤后为 ${openSignals.length} 条。`,
      nextStep: "检查信号关闭记录、重复去重和北京时间过滤逻辑。",
      href: "/radar/history",
    })
  }

  if (openSignals.length > 0 && activeAccounts.length === 0) {
    issues.push({
      id: "no-paper-account-for-signals",
      severity: "critical",
      title: "雷达有信号但没有 active 模拟账户",
      detail: `今日雷达账本已有 ${openSignals.length} 条跟踪信号，但模拟盘没有在线账户，无法形成接入后收益。`,
      nextStep: "进入真实回测或正式目录，让通过准入的策略上线模拟盘。",
      href: "/simulation",
    })
  }

  if (openSignals.length > 0 && activeAccounts.length > 0 && todayOrders.length === 0) {
    issues.push({
      id: "signals-without-paper-orders",
      severity: "warning",
      title: "雷达账本已有信号但模拟盘没有今日流水",
      detail: `今日 ${openSignals.length} 条雷达跟踪信号尚未对应到模拟盘买入、跳过或拒单记录。`,
      nextStep: "运行模拟盘刷新任务，检查风控是否阻断，或者确认策略是否已绑定到模拟账户。",
      href: "/simulation",
    })
  }

  if (filledConfluenceSignals.length > 0 && !confluenceAccountOnline) {
    issues.push({
      id: "confluence-account-offline",
      severity: "warning",
      title: "有多策略共振但共振模拟账户未上线",
      detail: `今日已有 ${filledConfluenceSignals.length} 条已成交共振信号，但未发现多策略共振模拟账户。`,
      nextStep: "把多策略共振作为独立模拟账户接入，避免首页有共振、模拟盘无账户。",
      href: "/simulation?strategy=paper-confluence",
    })
  }

  if (confluenceAccountOnline && filledConfluenceSignals.length > 0 && confluenceOrdersToday.length === 0) {
    issues.push({
      id: "confluence-without-own-orders",
      severity: "warning",
      title: "共振账户在线但没有今日共振订单",
      detail: `今日检测到 ${filledConfluenceSignals.length} 条成交共振，但共振模拟账户没有写入自己的买入流水。`,
      nextStep: "检查多策略共振账户的撮合写账路径，确认共振信号是否被风险规则阻断。",
      href: "/simulation?strategy=paper-confluence",
    })
  }

  if (ledgerRecords.length > 0 && filledBuyOrders.length > 0) {
    const latestSignalAt = latestRecordAt(ledgerRecords)
    const latestFilledAt = latestDate(filledBuyOrders.map((order) => order.filledAt ?? order.submittedAt))
    if (latestSignalAt && latestFilledAt && new Date(latestSignalAt).getTime() > new Date(latestFilledAt).getTime() + 10 * 60_000) {
      issues.push({
        id: "paper-orders-lag-latest-signal",
        severity: "info",
        title: "最新雷达信号晚于最近成交",
        detail: "这可能只是最新信号被跳过或拒单；如果持续出现，说明模拟盘刷新频率可能慢于雷达。",
        nextStep: "打开模拟盘撮合流水，确认最新信号是否有跳过/拒单原因。",
        href: "/simulation",
      })
    }
  }

  if (confluenceSignals.length > 0 && confluenceSignals.every((signal) => signal.status === "blocked")) {
    issues.push({
      id: "all-confluence-blocked",
      severity: "info",
      title: "今日多策略共振全部被风控阻断",
      detail: "策略同向命中存在，但成交数为 0，通常是仓位上限、T+1、现金或重复持仓约束导致。",
      nextStep: "在模拟盘查看每条订单的拒单/跳过原因，判断是合理风控还是参数过严。",
      href: "/simulation",
    })
  }

  return issues
}

function integrityNotes(session: ChinaMarketSession, todayView: TodayRadarSignalView | null, summary: SignalIntegritySnapshot["summary"]) {
  const notes = [
    `所有时间按北京时间统计；当前交易日 ${session.tradeDate}，阶段：${session.phaseLabel}。`,
    "本诊断只读 Supabase/Postgres 与本地快照，不会触发新的 Qveris 付费行情调用。",
  ]
  if (!session.allowsNewSignals) {
    notes.push("非连续竞价时段不新增信号，空态不等于系统异常。")
  }
  if (todayView?.source === "qveris+snapshot") {
    notes.push("首页正在使用雷达快照兜底，应该尽快确认账本写入是否恢复。")
  }
  if (summary.todayOrders > 0) {
    notes.push(`模拟盘今日已有 ${summary.todayOrders} 条流水，成交买入 ${summary.filledBuyOrders} 条。`)
  }
  return notes
}

function sourceDiagnostic({
  id,
  label,
  href,
  read,
  count,
  message,
}: {
  id: string
  label: string
  href: string
  read: IntegrityRead<unknown>
  count: number
  message: string
}): SignalIntegritySource {
  return {
    id,
    label,
    href,
    status: read.status,
    statusLabel: readStatusLabel(read.status),
    count,
    latencyMs: read.latencyMs,
    latestAt: read.latestAt,
    message: read.error ?? message,
  }
}

async function readIntegritySource<T>({
  promise,
  fallback,
  count,
  latestAt,
  timeoutMs = SIGNAL_INTEGRITY_TIMEOUT_MS,
}: {
  promise: Promise<T>
  fallback: T
  count: (value: T) => number
  latestAt?: (value: T) => string | undefined
  timeoutMs?: number
}): Promise<IntegrityRead<T>> {
  const startedAt = Date.now()
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let timedOut = false

  try {
    const value = await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeoutId = setTimeout(() => {
          timedOut = true
          resolve(fallback)
        }, timeoutMs)
      }),
    ])
    const itemCount = count(value)
    return {
      value,
      status: timedOut ? "timeout" : itemCount > 0 ? "ok" : "empty",
      latencyMs: Date.now() - startedAt,
      itemCount,
      latestAt: latestAt?.(value),
    }
  } catch (error) {
    return {
      value: fallback,
      status: "error",
      latencyMs: Date.now() - startedAt,
      itemCount: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

function issueStatus(issues: SignalIntegrityIssue[]): SignalIntegritySeverity {
  if (issues.some((issue) => issue.severity === "critical")) return "critical"
  if (issues.some((issue) => issue.severity === "warning")) return "warning"
  if (issues.some((issue) => issue.severity === "info")) return "info"
  return "ok"
}

function integrityScore(issues: SignalIntegrityIssue[]) {
  const penalty = issues.reduce((sum, issue) => {
    if (issue.severity === "critical") return sum + 35
    if (issue.severity === "warning") return sum + 16
    return sum + 4
  }, 0)
  return Math.max(0, Math.min(100, 100 - penalty))
}

function statusLabel(status: SignalIntegritySeverity) {
  if (status === "critical") return "需处理"
  if (status === "warning") return "有风险"
  if (status === "info") return "需关注"
  return "一致"
}

function readStatusLabel(status: SignalIntegrityReadStatus) {
  if (status === "ok") return "正常"
  if (status === "empty") return "空"
  if (status === "timeout") return "超时"
  return "异常"
}

function latestRecordAt(records: RadarHistoryRecord[]) {
  return latestDate(records.map((record) => record.closedAt ?? record.latestQuoteAt ?? record.recommendedAt).filter(Boolean))
}

function latestDate(values: string[]) {
  return values
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => b - a)
    .map((time) => new Date(time).toISOString())
    .at(0)
}

function chinaDate(value?: string) {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" })
}
