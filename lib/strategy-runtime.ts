import { getChinaMarketSession, type ChinaMarketSession } from "@/lib/cn-market-session"
import type { RecentPaperOrderRecord, PaperLedgerAccountOption } from "@/lib/paper-trading-store"
import { listActivePaperLedgerAccounts, listRecentPaperOrders } from "@/lib/paper-trading-store"
import type { RadarHistoryRecord } from "@/lib/radar-history"
import { loadRadarSignalHistoryRecords } from "@/lib/radar-signal-store"
import { buildStrategyDeploymentSnapshot, strategyDeploymentDecision, type StrategyDeploymentDecision, type StrategyDeploymentLane } from "@/lib/strategy-deployment"
import { getStrategyRegistrySnapshot, type StrategyRegistryEntry, type StrategyRegistrySnapshot } from "@/lib/strategy-registry-store"

export type StrategyRuntimeHealth = "online" | "watch" | "stale" | "idle" | "pending" | "blocked"
export type StrategyRuntimeActionSeverity = "critical" | "warning" | "info" | "ok"
export type StrategyRuntimeActionCategory = "data" | "registry" | "backtest" | "execution" | "radar" | "paper" | "market"
export type StrategyRuntimeSourceStatus = "ok" | "empty" | "fallback" | "timeout" | "error"
export type StrategyRuntimeSourceId = "registry" | "paperAccounts" | "radarSignals" | "paperOrders"

export type StrategyRuntimeSourceDiagnostic = {
  id: StrategyRuntimeSourceId
  label: string
  driver: string
  status: StrategyRuntimeSourceStatus
  statusLabel: string
  latencyMs: number
  itemCount: number
  checkedAt: string
  message: string
  nextStep: string
  href: string
}

export type StrategyRuntimeAction = {
  id: string
  severity: StrategyRuntimeActionSeverity
  category: StrategyRuntimeActionCategory
  title: string
  summary: string
  impact: string
  nextStep: string
  href: string
  badge: string
  strategyIds?: string[]
  deadline?: string
}

export type StrategyRuntimeRow = {
  strategyId: string
  name: string
  source: StrategyRegistryEntry["source"] | "paper" | "signal"
  lane: StrategyDeploymentLane | "signal-only"
  health: StrategyRuntimeHealth
  healthLabel: string
  healthNote: string
  score: number
  annualReturn: number
  maxDrawdown: number
  hasExecutableMapping: boolean
  lastBacktestedAt?: string
  lastSignalAt?: string
  lastPaperSyncAt?: string
  recentOrderAt?: string
  todaySignals: number
  openSignals: number
  totalSignals: number
  orderCount: number
  todayOrders: number
  positionCount: number
  closedTradeCount: number
  admissionStatus: string
  primaryAction: string
  decisionReason: string
}

export type StrategyRuntimeSnapshot = {
  generatedAt: string
  session: ChinaMarketSession
  registry: Pick<StrategyRegistrySnapshot, "driver" | "status" | "summary" | "error">
  deployment: ReturnType<typeof buildStrategyDeploymentSnapshot>["summary"]
  summary: {
    total: number
    online: number
    watch: number
    stale: number
    pending: number
    blocked: number
    activeAccounts: number
    todaySignals: number
    openSignals: number
    todayOrders: number
  }
  rows: StrategyRuntimeRow[]
  recentSignals: RadarHistoryRecord[]
  recentOrders: RecentPaperOrderRecord[]
  diagnostics: StrategyRuntimeSourceDiagnostic[]
  warnings: string[]
  actions: StrategyRuntimeAction[]
}

type RuntimeInputs = {
  registry: StrategyRegistrySnapshot
  accounts: PaperLedgerAccountOption[]
  signals: RadarHistoryRecord[]
  orders: RecentPaperOrderRecord[]
  diagnostics: StrategyRuntimeSourceDiagnostic[]
  session: ChinaMarketSession
}

const RUNTIME_SOURCE_TIMEOUT_MS = 15_000
const RUNTIME_SNAPSHOT_CACHE_MS = 15_000

export async function loadStrategyRuntimeSnapshot(): Promise<StrategyRuntimeSnapshot> {
  const now = Date.now()
  if (runtimeSnapshotCache && runtimeSnapshotCache.expiresAt > now) return runtimeSnapshotCache.value
  if (runtimeSnapshotInFlight) return runtimeSnapshotInFlight

  const promise = readStrategyRuntimeSnapshot()
  runtimeSnapshotInFlight = promise
  try {
    const value = await promise
    runtimeSnapshotCache = {
      value,
      expiresAt: Date.now() + RUNTIME_SNAPSHOT_CACHE_MS,
    }
    return value
  } finally {
    if (runtimeSnapshotInFlight === promise) runtimeSnapshotInFlight = undefined
  }
}

let runtimeSnapshotInFlight: Promise<StrategyRuntimeSnapshot> | undefined
let runtimeSnapshotCache: { value: StrategyRuntimeSnapshot; expiresAt: number } | undefined

async function readStrategyRuntimeSnapshot(): Promise<StrategyRuntimeSnapshot> {
  const session = getChinaMarketSession()
  const [registryRead, accountsRead, signalsRead, ordersRead] = await Promise.all([
    readRuntimeSource({
      id: "registry",
      label: "策略注册表",
      driver: "postgres",
      href: "/strategies",
      timeoutMs: RUNTIME_SOURCE_TIMEOUT_MS,
      fallback: emptyRegistrySnapshot("策略注册表读取超时"),
      promise: getStrategyRegistrySnapshot(120),
      count: (value) => value.summary.total,
      status: registryDiagnosticStatus,
      okMessage: (value) => `读取 ${value.summary.total} 个策略，雷达准入 ${value.summary.radarReady} 个。`,
      emptyMessage: "策略注册表可访问，但没有策略记录。",
      emptyNextStep: "进入真实回测或策略矿工，生成并写回策略注册表。",
    }),
    readRuntimeSource({
      id: "paperAccounts",
      label: "模拟账户",
      driver: "postgres",
      href: "/simulation",
      timeoutMs: RUNTIME_SOURCE_TIMEOUT_MS,
      fallback: [],
      promise: listActivePaperLedgerAccounts(48),
      count: (value) => value.length,
      okMessage: (value) => `读取 ${value.length} 个 active 模拟账户。`,
      emptyMessage: "模拟账户表可读，但没有 active 账户。",
      emptyNextStep: "从策略目录或模拟盘接入至少一个通过准入的策略。",
    }),
    readRuntimeSource({
      id: "radarSignals",
      label: "雷达信号",
      driver: "postgres",
      href: "/radar/history",
      timeoutMs: RUNTIME_SOURCE_TIMEOUT_MS,
      fallback: [],
      promise: loadRadarSignalHistoryRecords(80),
      count: (value) => value.length,
      okMessage: (value) => `读取 ${value.length} 条近期雷达信号。`,
      emptyMessage: "雷达信号账本为空，当前没有可跟踪推荐。",
      emptyNextStep: "交易时段进入策略雷达，确认是否有候选池、过滤原因或扫描任务滞后。",
    }),
    readRuntimeSource({
      id: "paperOrders",
      label: "撮合流水",
      driver: "postgres",
      href: "/simulation",
      timeoutMs: RUNTIME_SOURCE_TIMEOUT_MS,
      fallback: [],
      promise: listRecentPaperOrders(80),
      count: (value) => value.length,
      okMessage: (value) => `读取 ${value.length} 条近期模拟撮合流水。`,
      emptyMessage: "撮合流水为空，模拟账户还没有接入后的买卖/跳过/拒单记录。",
      emptyNextStep: "检查在线策略是否产生信号；若雷达有信号但流水为空，重点查模拟盘写账。",
    }),
  ])

  return buildRuntimeSnapshot({
    registry: registryRead.value,
    accounts: accountsRead.value,
    signals: signalsRead.value,
    orders: ordersRead.value,
    diagnostics: [registryRead.diagnostic, accountsRead.diagnostic, signalsRead.diagnostic, ordersRead.diagnostic],
    session,
  })
}

function buildRuntimeSnapshot({ registry, accounts, signals, orders, diagnostics, session }: RuntimeInputs): StrategyRuntimeSnapshot {
  const deploymentSnapshot = buildStrategyDeploymentSnapshot(registry)
  const decisionById = new Map(deploymentSnapshot.decisions.map((decision) => [decision.strategyId, decision]))
  const entryById = new Map(registry.entries.map((entry) => [entry.strategyId, entry]))
  const accountById = new Map(accounts.map((account) => [account.strategyId, account]))
  const signalGroups = groupSignals(signals)
  const orderGroups = groupOrders(orders)
  const strategyIds = new Set<string>([
    ...registry.entries.map((entry) => entry.strategyId),
    ...accounts.map((account) => account.strategyId),
    ...Array.from(signalGroups.keys()),
    ...Array.from(orderGroups.keys()),
  ])

  const rows = Array.from(strategyIds)
    .map((strategyId) => runtimeRow({
      strategyId,
      entry: entryById.get(strategyId),
      decision: decisionById.get(strategyId),
      account: accountById.get(strategyId),
      signals: signalGroups.get(strategyId) ?? [],
      orders: orderGroups.get(strategyId) ?? [],
      session,
    }))
    .sort((a, b) => healthRank(b.health) - healthRank(a.health) || b.todaySignals - a.todaySignals || b.score - a.score)

  const todaySignals = signals.filter((signal) => chinaDate(signal.recommendedAt) === session.tradeDate)
  const openSignals = signals.filter((signal) => signal.lifecycleStatus === "open")
  const todayOrders = orders.filter((order) => chinaDate(order.submittedAt) === session.tradeDate)
  const warnings = buildWarnings(rows, session, registry, diagnostics)
  const actions = buildRuntimeActions({
    rows,
    session,
    registry,
    diagnostics,
    deployment: deploymentSnapshot.summary,
    todaySignals: todaySignals.length,
    openSignals: openSignals.length,
    todayOrders: todayOrders.length,
  })

  return {
    generatedAt: new Date().toISOString(),
    session,
    registry: {
      driver: registry.driver,
      status: registry.status,
      summary: registry.summary,
      error: registry.error,
    },
    deployment: deploymentSnapshot.summary,
    summary: {
      total: rows.length,
      online: rows.filter((row) => row.health === "online").length,
      watch: rows.filter((row) => row.health === "watch").length,
      stale: rows.filter((row) => row.health === "stale").length,
      pending: rows.filter((row) => row.health === "pending").length,
      blocked: rows.filter((row) => row.health === "blocked").length,
      activeAccounts: accounts.length,
      todaySignals: todaySignals.length,
      openSignals: openSignals.length,
      todayOrders: todayOrders.length,
    },
    rows,
    recentSignals: signals.slice(0, 24),
    recentOrders: orders.slice(0, 24),
    diagnostics,
    warnings,
    actions,
  }
}

function runtimeRow({
  strategyId,
  entry,
  decision,
  account,
  signals,
  orders,
  session,
}: {
  strategyId: string
  entry?: StrategyRegistryEntry
  decision?: StrategyDeploymentDecision
  account?: PaperLedgerAccountOption
  signals: RadarHistoryRecord[]
  orders: RecentPaperOrderRecord[]
  session: ChinaMarketSession
}): StrategyRuntimeRow {
  const fallbackDecision = entry ? strategyDeploymentDecision(entry) : undefined
  const resolvedDecision = decision ?? fallbackDecision
  const signalName = signals[0]?.strategyName
  const name = entry?.name ?? account?.strategyName ?? signalName ?? strategyId
  const todaySignals = signals.filter((signal) => chinaDate(signal.recommendedAt) === session.tradeDate).length
  const openSignals = signals.filter((signal) => signal.lifecycleStatus === "open").length
  const todayOrders = orders.filter((order) => chinaDate(order.submittedAt) === session.tradeDate).length
  const lastSignalAt = latestDate(signals.map((signal) => signal.recommendedAt))
  const recentOrderAt = latestDate(orders.map((order) => order.filledAt ?? order.submittedAt))
  const health = runtimeHealth(resolvedDecision, account, session)
  return {
    strategyId,
    name,
    source: entry?.source ?? (account ? "paper" : "signal"),
    lane: resolvedDecision?.lane ?? "signal-only",
    health,
    healthLabel: healthLabel(health, resolvedDecision),
    healthNote: healthNote(health, resolvedDecision, account, session),
    score: Math.round(entry?.score ?? account?.admissionScore ?? resolvedDecision?.score ?? 0),
    annualReturn: round1(entry?.annualReturn ?? resolvedDecision?.annualReturn ?? 0),
    maxDrawdown: round1(entry?.maxDrawdown ?? resolvedDecision?.maxDrawdown ?? 0),
    hasExecutableMapping: resolvedDecision?.hasExecutableMapping ?? false,
    lastBacktestedAt: entry?.lastBacktestedAt,
    lastSignalAt,
    lastPaperSyncAt: account?.lastSyncedAt,
    recentOrderAt,
    todaySignals,
    openSignals,
    totalSignals: signals.length,
    orderCount: account?.orderCount ?? orders.length,
    todayOrders,
    positionCount: account?.positionCount ?? 0,
    closedTradeCount: account?.closedTradeCount ?? 0,
    admissionStatus: account?.admissionStatus ?? entry?.admissionGate ?? resolvedDecision?.paper.label ?? "未接入",
    primaryAction: resolvedDecision?.primaryAction ?? (account ? "观察模拟账户" : "补齐策略注册"),
    decisionReason: resolvedDecision?.reason ?? "该策略只有信号或模拟流水，还没有完整注册表记录。",
  }
}

function runtimeHealth(
  decision: StrategyDeploymentDecision | undefined,
  account: PaperLedgerAccountOption | undefined,
  session: ChinaMarketSession,
): StrategyRuntimeHealth {
  if (decision?.lane === "blocked") return "blocked"
  if (decision?.lane === "pending") return "pending"
  if (!account) return decision?.paper.status === "watch" ? "idle" : decision?.paper.status === "online" ? "idle" : "blocked"
  if (isStale(account.lastSyncedAt, session)) return "stale"
  if (decision?.paper.status === "watch" || decision?.lane === "paper-watch" || decision?.lane === "mapping-missing") return "watch"
  return "online"
}

function healthLabel(health: StrategyRuntimeHealth, decision?: StrategyDeploymentDecision) {
  if (health === "online") return decision?.radar.status === "online" ? "雷达+模拟运行" : "模拟运行"
  if (health === "watch") return "观察运行"
  if (health === "stale") return "运行滞后"
  if (health === "idle") return "待接入"
  if (health === "pending") return "等待回测"
  return "未上线"
}

function healthNote(
  health: StrategyRuntimeHealth,
  decision: StrategyDeploymentDecision | undefined,
  account: PaperLedgerAccountOption | undefined,
  session: ChinaMarketSession,
) {
  if (health === "stale") return `最近心跳 ${formatChinaTime(account?.lastSyncedAt)}，超过当前阶段容忍窗口。`
  if (health === "online") return session.isOpen ? "交易时段内应持续扫描和写入模拟盘。" : "账户在线，当前按市场阶段等待下一次扫描。"
  if (health === "watch") return "策略进入模拟观察池，先看接入后的真实信号表现。"
  if (health === "idle") return decision?.paper.reason ?? "已满足观察条件，但还没有独立模拟账户。"
  if (health === "pending") return decision?.reason ?? "等待真实回测完成。"
  return decision?.reason ?? "未满足上线或模拟观察条件。"
}

function groupSignals(signals: RadarHistoryRecord[]) {
  const groups = new Map<string, RadarHistoryRecord[]>()
  for (const signal of signals) {
    const key = signal.strategyId ?? signal.strategyName ?? "unknown-signal-strategy"
    const values = groups.get(key) ?? []
    values.push(signal)
    groups.set(key, values)
  }
  return groups
}

function groupOrders(orders: RecentPaperOrderRecord[]) {
  const groups = new Map<string, RecentPaperOrderRecord[]>()
  for (const order of orders) {
    const key = order.strategyId || order.strategyName || "unknown-paper-strategy"
    const values = groups.get(key) ?? []
    values.push(order)
    groups.set(key, values)
  }
  return groups
}

function buildWarnings(
  rows: StrategyRuntimeRow[],
  session: ChinaMarketSession,
  registry: StrategyRegistrySnapshot,
  diagnostics: StrategyRuntimeSourceDiagnostic[],
) {
  const stale = rows.filter((row) => row.health === "stale")
  const onlineWithoutSignals = rows.filter((row) => (row.health === "online" || row.health === "watch") && row.todaySignals === 0)
  const dataIssues = diagnostics.filter((item) => item.status !== "ok")
  return [
    ...dataIssues.slice(0, 3).map((item) => `${item.label} ${item.statusLabel}：${item.message}`),
    registry.status === "error" ? `策略注册表异常：${registry.error ?? "未知错误"}` : "",
    stale.length ? `${stale.length} 个策略账户心跳滞后，需要检查 cron 或行情接口。` : "",
    session.isOpen && onlineWithoutSignals.length ? `交易时段内 ${onlineWithoutSignals.length} 个在线策略今天还没有信号。` : "",
    !session.isTradingDay ? "当前不是 A 股交易日，只展示账本与模拟账户状态，不新增触发。" : "",
  ].filter(Boolean)
}

function buildRuntimeActions({
  rows,
  session,
  registry,
  diagnostics,
  deployment,
  todaySignals,
  openSignals,
  todayOrders,
}: {
  rows: StrategyRuntimeRow[]
  session: ChinaMarketSession
  registry: StrategyRegistrySnapshot
  diagnostics: StrategyRuntimeSourceDiagnostic[]
  deployment: ReturnType<typeof buildStrategyDeploymentSnapshot>["summary"]
  todaySignals: number
  openSignals: number
  todayOrders: number
}): StrategyRuntimeAction[] {
  const actions: StrategyRuntimeAction[] = []
  const onlineRows = rows.filter((row) => row.health === "online")
  const watchRows = rows.filter((row) => row.health === "watch")
  const staleRows = rows.filter((row) => row.health === "stale")
  const blockedRows = rows.filter((row) => row.health === "blocked")
  const pendingRows = rows.filter((row) => row.health === "pending")
  const idleRows = rows.filter((row) => row.health === "idle")
  const mappingMissingRows = rows.filter((row) => row.lane === "mapping-missing")
  const liveRows = [...onlineRows, ...watchRows]
  const unhealthySources = diagnostics.filter((item) => item.status === "timeout" || item.status === "error" || item.status === "fallback")
  const emptySources = diagnostics.filter((item) => item.status === "empty")

  if (unhealthySources.length || emptySources.length) {
    const source = unhealthySources[0] ?? emptySources[0]
    actions.push({
      id: "runtime-source-diagnostics",
      severity: unhealthySources.length ? "critical" : "warning",
      category: "data",
      title: unhealthySources.length ? `${unhealthySources.length} 个运行数据源异常` : `${emptySources.length} 个运行数据源为空`,
      summary: `${source.label}：${source.message}`,
      impact: unhealthySources.length
        ? "策略在线状态、雷达信号或模拟盘流水可能不完整。"
        : "页面可访问，但当前链路缺样本；用户需要知道是无信号而不是页面坏了。",
      nextStep: source.nextStep,
      href: source.href,
      badge: source.statusLabel,
      deadline: unhealthySources.length ? "立即处理" : "下个交易窗口复核",
    })
  }

  if (registry.status === "error") {
    actions.push({
      id: "registry-error",
      severity: "critical",
      category: "registry",
      title: "策略注册表不可用",
      summary: registry.error ?? "读取策略注册表失败，当前只能展示降级数据。",
      impact: "策略准入、雷达上线和模拟盘账户可能不同步。",
      nextStep: "先检查 Supabase/Postgres 连接、RLS 和 strategy_registry 表权限。",
      href: "/data",
      badge: registry.driver,
      deadline: "立即处理",
    })
  } else if (registry.status === "fallback") {
    actions.push({
      id: "registry-fallback",
      severity: "warning",
      category: "registry",
      title: "策略注册表处于降级模式",
      summary: "系统正在使用内存或本地回退注册表。",
      impact: "刷新或重新部署后，策略状态可能和线上模拟账户不一致。",
      nextStep: "确认 Postgres 环境变量和表结构，恢复持久化注册表。",
      href: "/data",
      badge: registry.driver,
      deadline: "今天收盘前",
    })
  }

  if (staleRows.length) {
    const names = summarizeNames(staleRows)
    actions.push({
      id: "paper-heartbeat-stale",
      severity: session.isOpen ? "critical" : "warning",
      category: "paper",
      title: `${staleRows.length} 个模拟账户心跳滞后`,
      summary: `滞后账户：${names}。`,
      impact: session.isOpen ? "盘中可能漏记买入、卖出或持仓浮盈。" : "非交易时段仍需确认上一交易日收盘后是否完成写账。",
      nextStep: "进入模拟盘核对最近心跳和撮合流水，必要时触发下一交易窗口校验。",
      href: "/simulation",
      badge: session.isOpen ? "盘中" : "收盘后",
      strategyIds: staleRows.map((row) => row.strategyId),
      deadline: session.isOpen ? "立即处理" : "下个开盘前",
    })
  }

  if (deployment.mappingMissing || mappingMissingRows.length) {
    const rowsToShow = mappingMissingRows.length ? mappingMissingRows : rows.filter((row) => !row.hasExecutableMapping && row.score >= 50)
    actions.push({
      id: "execution-mapping-missing",
      severity: "warning",
      category: "execution",
      title: `${deployment.mappingMissing || rowsToShow.length} 个策略缺执行映射`,
      summary: `代表策略：${summarizeNames(rowsToShow)}。`,
      impact: "回测通过但无法进入正式策略雷达，只能先做模拟观察或候选展示。",
      nextStep: "补齐 DSL/因子到雷达扫描规则的适配器，再重新评估上线。",
      href: "/strategy-research",
      badge: "mapping",
      strategyIds: rowsToShow.map((row) => row.strategyId),
      deadline: "本周内",
    })
  }

  if (pendingRows.length || registry.summary.queuedJobs || registry.summary.runningJobs) {
    actions.push({
      id: "backtest-queue",
      severity: "info",
      category: "backtest",
      title: "真实回测队列未清空",
      summary: `${pendingRows.length} 个策略等待结果，队列 ${registry.summary.queuedJobs}，运行 ${registry.summary.runningJobs}。`,
      impact: "策略目录和雷达准入会等回测写回后再更新。",
      nextStep: "进入真实回测页查看任务状态，优先处理失败或超时任务。",
      href: "/backtest",
      badge: "BT",
      strategyIds: pendingRows.map((row) => row.strategyId),
      deadline: "后台运行",
    })
  }

  if (blockedRows.length) {
    actions.push({
      id: "strategy-admission-blocked",
      severity: "info",
      category: "backtest",
      title: `${blockedRows.length} 个策略未通过准入`,
      summary: `阻塞策略：${summarizeNames(blockedRows)}。`,
      impact: "这些策略不会进入策略目录、策略雷达或模拟盘，避免污染推荐位。",
      nextStep: "保留原因和回测指标，后续只重测有明确改进假设的策略。",
      href: "/strategies",
      badge: "gate",
      strategyIds: blockedRows.map((row) => row.strategyId),
      deadline: "无需立即处理",
    })
  }

  if (session.isOpen && liveRows.length && todaySignals === 0) {
    actions.push({
      id: "radar-no-signal-open",
      severity: "warning",
      category: "radar",
      title: "盘中在线策略暂无动作级信号",
      summary: `${liveRows.length} 个在线/观察策略今天没有新信号。`,
      impact: "用户看到雷达为空时，需要知道是市场无机会、过滤过严，还是扫描失败。",
      nextStep: "进入策略雷达查看候选池和过滤原因；若候选也为空，再检查行情快照。",
      href: "/radar",
      badge: "scan",
      strategyIds: liveRows.map((row) => row.strategyId),
      deadline: "下次扫描后复核",
    })
  }

  if (todaySignals > 0 && todayOrders === 0 && liveRows.some((row) => row.health === "online")) {
    actions.push({
      id: "paper-no-orders-with-signals",
      severity: "warning",
      category: "paper",
      title: "雷达有信号但模拟盘无今日订单",
      summary: `今日 ${todaySignals} 条信号，开放跟踪 ${openSignals} 条，模拟盘今日订单 0。`,
      impact: "可能是仓位限制、重复信号跳过，也可能是撮合写入异常。",
      nextStep: "进入模拟盘查看拒单、跳过和仓位上限原因。",
      href: "/simulation",
      badge: "ledger",
      deadline: "今日收盘前",
    })
  }

  if (idleRows.length) {
    actions.push({
      id: "paper-account-not-created",
      severity: "info",
      category: "paper",
      title: `${idleRows.length} 个策略待接入模拟账户`,
      summary: `待接入：${summarizeNames(idleRows)}。`,
      impact: "策略已具备观察价值，但还没有接入后的真实纸面表现。",
      nextStep: "确认是否要为这些策略开独立模拟账户；每个策略独立账户，便于归因。",
      href: "/simulation",
      badge: "paper",
      strategyIds: idleRows.map((row) => row.strategyId),
      deadline: "按需接入",
    })
  }

  if (!session.isTradingDay) {
    actions.push({
      id: "market-closed",
      severity: "info",
      category: "market",
      title: "当前不是 A 股交易日",
      summary: "系统不新增雷达触发，只展示历史账本、模拟账户和数据健康。",
      impact: "周末看到无新信号是正常状态；不要把旧信号标记成刚触发。",
      nextStep: "下个交易日开盘后再看雷达和模拟盘心跳。",
      href: "/radar/history",
      badge: "休市",
      deadline: "下个交易日",
    })
  }

  const ranked = actions
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || categoryRank(a.category) - categoryRank(b.category))
    .slice(0, 8)

  if (ranked.length) return ranked

  return [
    {
      id: "runtime-ok",
      severity: "ok",
      category: "market",
      title: "运行闭环暂未发现阻塞",
      summary: "策略注册表、雷达信号和模拟盘账户处于可用状态。",
      impact: "可以把注意力放到信号质量、持仓盈亏和盘后复盘。",
      nextStep: "继续观察策略雷达和模拟盘表现。",
      href: "/simulation",
      badge: "OK",
      deadline: "持续观察",
    },
  ]
}

function isStale(value: string | undefined, session: ChinaMarketSession) {
  if (!value) return true
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return true
  const maxAgeMs = session.isOpen ? 90 * 60_000 : 30 * 60 * 60_000
  return Date.now() - time > maxAgeMs
}

function latestDate(values: Array<string | undefined>) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
}

function chinaDate(value?: string) {
  if (!value) return ""
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value.slice(0, 10)
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

function formatChinaTime(value?: string) {
  if (!value) return "未写入"
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  const formatted = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
  return `北京时间 ${formatted}`
}

function healthRank(health: StrategyRuntimeHealth) {
  if (health === "online") return 6
  if (health === "watch") return 5
  if (health === "stale") return 4
  if (health === "pending") return 3
  if (health === "idle") return 2
  return 1
}

function severityRank(severity: StrategyRuntimeActionSeverity) {
  if (severity === "critical") return 4
  if (severity === "warning") return 3
  if (severity === "info") return 2
  return 1
}

function categoryRank(category: StrategyRuntimeActionCategory) {
  if (category === "data") return 0
  if (category === "registry") return 1
  if (category === "paper") return 2
  if (category === "radar") return 3
  if (category === "execution") return 4
  if (category === "backtest") return 5
  return 6
}

function summarizeNames(rows: StrategyRuntimeRow[]) {
  if (!rows.length) return "暂无"
  const names = rows.slice(0, 3).map((row) => row.name).join(" / ")
  return rows.length > 3 ? `${names} 等 ${rows.length} 个` : names
}

function round1(value: number) {
  return Math.round((Number(value) || 0) * 10) / 10
}

function emptyRegistrySnapshot(error?: unknown): StrategyRegistrySnapshot {
  return {
    driver: "memory",
    configured: false,
    status: "error",
    entries: [],
    jobs: [],
    summary: {
      total: 0,
      radarReady: 0,
      watchlist: 0,
      blocked: 0,
      queuedJobs: 0,
      runningJobs: 0,
    },
    error: errorMessage(error),
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "未知错误")
}

type RuntimeSourceReadOptions<T> = {
  id: StrategyRuntimeSourceId
  label: string
  driver: string
  href: string
  promise: Promise<T>
  fallback: T
  timeoutMs: number
  count: (value: T) => number
  status?: (value: T, count: number) => StrategyRuntimeSourceStatus
  okMessage: (value: T, count: number) => string
  emptyMessage: string
  emptyNextStep: string
}

class RuntimeSourceTimeoutError extends Error {
  constructor(readonly sourceLabel: string, readonly timeoutMs: number) {
    super(`${sourceLabel} 读取超过 ${timeoutMs}ms`)
  }
}

async function readRuntimeSource<T>(opts: RuntimeSourceReadOptions<T>): Promise<{ value: T; diagnostic: StrategyRuntimeSourceDiagnostic }> {
  const startedAt = Date.now()
  const checkedAt = new Date().toISOString()
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    const value = await Promise.race([
      opts.promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new RuntimeSourceTimeoutError(opts.label, opts.timeoutMs)), opts.timeoutMs)
      }),
    ])
    const latencyMs = Date.now() - startedAt
    const itemCount = Math.max(0, opts.count(value))
    const status = opts.status?.(value, itemCount) ?? (itemCount > 0 ? "ok" : "empty")
    const issue = status === "ok" ? null : diagnosticIssueForStatus(status, opts.emptyMessage, opts.emptyNextStep, opts.label)
    return {
      value,
      diagnostic: {
        id: opts.id,
        label: opts.label,
        driver: runtimeSourceDriver(opts.driver, value),
        status,
        statusLabel: sourceStatusLabel(status),
        latencyMs,
        itemCount,
        checkedAt,
        message: issue?.message ?? opts.okMessage(value, itemCount),
        nextStep: issue?.nextStep ?? "继续监控；若盘中信号突然归零，再查看运行中枢。",
        href: opts.href,
      },
    }
  } catch (error) {
    const latencyMs = Date.now() - startedAt
    const timeout = error instanceof RuntimeSourceTimeoutError
    const issue = classifyRuntimeSourceError(error, opts.label)
    return {
      value: opts.fallback,
      diagnostic: {
        id: opts.id,
        label: opts.label,
        driver: opts.driver,
        status: timeout ? "timeout" : "error",
        statusLabel: sourceStatusLabel(timeout ? "timeout" : "error"),
        latencyMs,
        itemCount: 0,
        checkedAt,
        message: issue.message,
        nextStep: issue.nextStep,
        href: opts.href,
      },
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function registryDiagnosticStatus(value: StrategyRegistrySnapshot, count: number): StrategyRuntimeSourceStatus {
  if (value.status === "error") return "error"
  if (value.status === "fallback") return "fallback"
  return count > 0 ? "ok" : "empty"
}

function runtimeSourceDriver<T>(fallback: string, value: T) {
  if (value && typeof value === "object" && "driver" in value && typeof (value as { driver?: unknown }).driver === "string") {
    return (value as { driver: string }).driver
  }
  return fallback
}

function diagnosticIssueForStatus(
  status: StrategyRuntimeSourceStatus,
  emptyMessage: string,
  emptyNextStep: string,
  label: string,
) {
  if (status === "empty") {
    return { message: emptyMessage, nextStep: emptyNextStep }
  }
  if (status === "fallback") {
    return {
      message: `${label} 正在使用降级数据。`,
      nextStep: "检查数据库连接、环境变量和表权限，恢复持久化数据源。",
    }
  }
  if (status === "error") {
    return {
      message: `${label} 返回错误状态。`,
      nextStep: "打开数据源目录或服务端日志，定位 Supabase/Postgres 查询错误。",
    }
  }
  if (status === "timeout") {
    return {
      message: `${label} 读取超时。`,
      nextStep: "检查慢查询、索引和外部接口超时。",
    }
  }
  return null
}

function classifyRuntimeSourceError(error: unknown, label: string) {
  const message = errorMessage(error)
  const lower = message.toLowerCase()
  if (error instanceof RuntimeSourceTimeoutError) {
    return {
      message: `${label} 读取超过 ${error.timeoutMs}ms，已使用降级空数据避免页面卡死。`,
      nextStep: "先看 Supabase/Postgres 是否慢查询，再检查外部行情接口是否卡住。",
    }
  }
  if (lower.includes("row-level security") || lower.includes("rls") || lower.includes("permission denied")) {
    return {
      message: `${label} 权限或 RLS 拒绝：${message}`,
      nextStep: "检查对应表的 RLS policy、service role/当前 role 权限，以及 Data API 暴露设置。",
    }
  }
  if (lower.includes("does not exist") || lower.includes("42p01") || lower.includes("relation")) {
    return {
      message: `${label} 表结构缺失：${message}`,
      nextStep: "执行数据库迁移或打开数据源目录确认表是否创建。",
    }
  }
  if (lower.includes("fetch failed") || lower.includes("econn") || lower.includes("network") || lower.includes("timeout")) {
    return {
      message: `${label} 网络/连接异常：${message}`,
      nextStep: "检查 Supabase 连接串、Vercel 环境变量和数据库连接池。",
    }
  }
  return {
    message: `${label} 读取失败：${message}`,
    nextStep: "查看 Vercel 函数日志和数据源详情，确认具体查询失败点。",
  }
}

function sourceStatusLabel(status: StrategyRuntimeSourceStatus) {
  if (status === "ok") return "正常"
  if (status === "empty") return "空数据"
  if (status === "fallback") return "降级"
  if (status === "timeout") return "超时"
  return "异常"
}
