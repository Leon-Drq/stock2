import Link from "next/link"
import type { ComponentType, ReactNode } from "react"
import { Activity, AlertTriangle, ArrowRight, ArrowUpRight, CheckCircle2, Clock3, Database, ListChecks, Radio, Route, ShieldAlert, WalletCards, Wrench } from "lucide-react"
import type { RecentPaperOrderRecord } from "@/lib/paper-trading-store"
import type { RadarHistoryRecord } from "@/lib/radar-history"
import type { StrategyRuntimeAction, StrategyRuntimeActionSeverity, StrategyRuntimeHealth, StrategyRuntimeRow, StrategyRuntimeSnapshot, StrategyRuntimeSourceDiagnostic, StrategyRuntimeSourceStatus } from "@/lib/strategy-runtime"
import { formatBeijingDateTime } from "@/lib/format"

export function StrategyRuntimeDashboard({ snapshot }: { snapshot: StrategyRuntimeSnapshot }) {
  return (
    <div className="mt-5 space-y-5">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <RuntimeMetric icon={Radio} label="在线策略" value={`${snapshot.summary.online}`} detail={`观察 ${snapshot.summary.watch} · 滞后 ${snapshot.summary.stale}`} tone="good" />
        <RuntimeMetric icon={Activity} label="今日信号" value={`${snapshot.summary.todaySignals}`} detail={`开放跟踪 ${snapshot.summary.openSignals}`} />
        <RuntimeMetric icon={WalletCards} label="模拟账户" value={`${snapshot.summary.activeAccounts}`} detail={`今日订单 ${snapshot.summary.todayOrders}`} />
        <RuntimeMetric icon={Database} label="注册表" value={`${snapshot.registry.summary.total}`} detail={`${snapshot.registry.driver} · ${snapshot.registry.status}`} />
      </section>

      <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
                <Clock3 className="size-4" aria-hidden />
                Market Heartbeat
              </div>
              <h2 className="mt-1 text-[20px] font-semibold text-ink">{snapshot.session.phaseLabel}</h2>
              <p className="mt-2 max-w-[760px] text-[13px] leading-5 text-ink-muted">{snapshot.session.note}</p>
            </div>
            <div className="grid min-w-[260px] gap-2 sm:grid-cols-2 lg:grid-cols-1">
              <Stamp label="交易日" value={snapshot.session.tradeDate} />
              <Stamp label="刷新节奏" value={`${Math.round(snapshot.session.radarRefreshMs / 60_000)}m radar / ${Math.round(snapshot.session.quoteRefreshMs / 60_000)}m quote`} />
              <Stamp label="生成时间" value={formatDateTime(snapshot.generatedAt)} />
            </div>
          </div>
        </div>

        <div className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <ShieldAlert className="size-4" aria-hidden />
            Risk Notes
          </div>
          <div className="mt-3 space-y-2">
            {snapshot.warnings.length ? (
              snapshot.warnings.slice(0, 4).map((warning) => (
                <div key={warning} className="rounded-[7px] border border-[#ead8b7] bg-[#fff8ed] px-3 py-2 text-[12px] leading-5 text-[#8a5a16]">
                  {warning}
                </div>
              ))
            ) : (
              <div className="rounded-[7px] border border-[#cce8d4] bg-[#f6fcf8] px-3 py-2 text-[12px] leading-5 text-health-ok">
                当前没有发现运行级阻塞；重点看下方是否有单策略信号或模拟盘滞后。
              </div>
            )}
          </div>
        </div>
      </section>

      <RuntimeSourceDiagnostics diagnostics={snapshot.diagnostics} />

      <RuntimeActionQueue actions={snapshot.actions} />

      <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
              <Route className="size-4" aria-hidden />
              Strategy Runtime Matrix
            </div>
            <h2 className="mt-1 text-[20px] font-semibold text-ink">策略运行矩阵</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/strategies" label="策略目录" />
            <LinkButton href="/radar" label="策略雷达" />
            <LinkButton href="/simulation" label="模拟盘" />
          </div>
        </div>
        <div className="grid gap-2 md:hidden">
          {snapshot.rows.map((row) => (
            <StrategyRuntimeMobileCard key={row.strategyId} row={row} />
          ))}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1120px] border-separate border-spacing-0 text-left">
            <thead>
              <tr className="border-b border-rule text-[11px] text-ink-faint">
                <Th>策略</Th>
                <Th>状态</Th>
                <Th>回测质量</Th>
                <Th>今日信号</Th>
                <Th>模拟账户</Th>
                <Th>最近心跳</Th>
                <Th>动作</Th>
              </tr>
            </thead>
            <tbody>
              {snapshot.rows.map((row) => (
                <StrategyRuntimeTableRow key={row.strategyId} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-3 xl:grid-cols-2">
        <RecentSignals signals={snapshot.recentSignals} />
        <RecentOrders orders={snapshot.recentOrders} />
      </section>
    </div>
  )
}

function RuntimeSourceDiagnostics({ diagnostics }: { diagnostics: StrategyRuntimeSourceDiagnostic[] }) {
  const bad = diagnostics.filter((item) => item.status === "error" || item.status === "timeout" || item.status === "fallback").length
  const empty = diagnostics.filter((item) => item.status === "empty").length
  return (
    <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-ink-muted">
            <Database className="size-4" aria-hidden />
            P1 · Source Diagnostics
            <span className={`inline-flex items-center gap-1 rounded-[5px] px-2 py-0.5 ${bad ? "bg-[#fff2f0] text-bear" : empty ? "bg-[#fff8ed] text-[#9b6415]" : "bg-[#e7f4eb] text-health-ok"}`}>
              {bad ? `${bad} 异常` : empty ? `${empty} 空源` : "全部正常"}
            </span>
          </div>
          <h2 className="mt-1 text-[20px] font-semibold text-ink">数据源诊断</h2>
          <p className="mt-1 max-w-[760px] text-[13px] leading-5 text-ink-muted">
            把运行中枢拆成独立数据源：注册表、模拟账户、雷达信号和撮合流水分别显示延迟、行数、降级原因和下一步排查。
          </p>
        </div>
        <LinkButton href="/data" label="数据源目录" />
      </div>

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {diagnostics.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className={`block rounded-[7px] border px-3 py-3 transition hover:bg-white ${sourceCardClass(item.status)}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold text-ink">{item.label}</p>
                <p className="mt-1 font-mono text-[10px] text-ink-faint">{item.driver} · {formatDateTime(item.checkedAt)}</p>
              </div>
              <span className={`shrink-0 rounded-[6px] px-2 py-1 font-mono text-[10px] ${sourceBadgeClass(item.status)}`}>
                {item.statusLabel}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-1.5 font-mono text-[11px]">
              <CellStat label="rows" value={`${item.itemCount}`} tone={item.itemCount > 0 ? "good" : "neutral"} />
              <CellStat label="latency" value={`${item.latencyMs}ms`} tone={item.latencyMs > 2500 ? "bad" : item.latencyMs > 1200 ? "neutral" : "good"} />
            </div>
            <p className="mt-3 line-clamp-2 text-[12px] leading-5 text-ink-muted">{item.message}</p>
            {item.status !== "ok" && (
              <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-ink-faint">下一步：{item.nextStep}</p>
            )}
          </Link>
        ))}
      </div>
    </section>
  )
}

function RuntimeActionQueue({ actions }: { actions: StrategyRuntimeAction[] }) {
  const top = actions[0]
  const counts = actions.reduce(
    (acc, action) => {
      acc[action.severity] += 1
      return acc
    },
    { critical: 0, warning: 0, info: 0, ok: 0 } as Record<StrategyRuntimeActionSeverity, number>,
  )

  return (
    <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-ink-muted">
            <Wrench className="size-4" aria-hidden />
            P4 · Runtime Intervention
            <span className={`inline-flex items-center gap-1 rounded-[5px] px-2 py-0.5 ${actionBadgeClass(top?.severity ?? "ok")}`}>
              {top ? severityLabel(top.severity) : "无阻塞"}
            </span>
          </div>
          <h2 className="mt-1 text-[20px] font-semibold text-ink">运行干预队列</h2>
          <p className="mt-1 max-w-[760px] text-[13px] leading-5 text-ink-muted">
            把红灯翻译成可执行动作：先处理会影响推荐、模拟盘写账和数据可信度的问题，再处理观察类事项。
          </p>
        </div>
        <div className="grid grid-cols-4 gap-1.5 font-mono text-[10px] sm:min-w-[320px]">
          <QueueStat label="阻塞" value={counts.critical} tone="critical" />
          <QueueStat label="关注" value={counts.warning} tone="warning" />
          <QueueStat label="观察" value={counts.info} tone="info" />
          <QueueStat label="正常" value={counts.ok} tone="ok" />
        </div>
      </div>

      <div className="grid gap-2 xl:grid-cols-2">
        {actions.map((action) => (
          <RuntimeActionCard key={action.id} action={action} />
        ))}
      </div>
    </section>
  )
}

function RuntimeActionCard({ action }: { action: StrategyRuntimeAction }) {
  const Icon = action.severity === "ok" ? CheckCircle2 : action.severity === "info" ? Radio : AlertTriangle
  return (
    <article className={`rounded-[7px] border px-3 py-3 md:px-4 ${actionCardClass(action.severity)}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 font-mono text-[10px] ${actionBadgeClass(action.severity)}`}>
              <Icon className="size-3.5" aria-hidden />
              {severityLabel(action.severity)}
            </span>
            <span className="rounded-[5px] border border-rule-soft bg-white/70 px-2 py-1 font-mono text-[10px] text-ink-muted">
              {categoryLabel(action.category)}
            </span>
            <span className="rounded-[5px] border border-rule-soft bg-white/70 px-2 py-1 font-mono text-[10px] text-ink-muted">
              {action.badge}
            </span>
          </div>
          <h3 className="mt-3 text-[16px] font-semibold text-ink">{action.title}</h3>
          <p className="mt-1 text-[12px] leading-5 text-ink-muted">{action.summary}</p>
        </div>
        <Link
          href={action.href}
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[7px] border border-rule bg-white px-3 font-mono text-[11px] text-ink-muted hover:text-ink"
        >
          处理 <ArrowRight className="size-3" aria-hidden />
        </Link>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <ActionMiniBlock label="影响" value={action.impact} />
        <ActionMiniBlock label="下一步" value={action.nextStep} />
        <ActionMiniBlock label="时限" value={action.deadline ?? "持续观察"} />
      </div>
    </article>
  )
}

function StrategyRuntimeMobileCard({ row }: { row: StrategyRuntimeRow }) {
  return (
    <article className="rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-ink">{row.name}</p>
          <p className="mt-1 font-mono text-[10px] text-ink-faint">{row.strategyId}</p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 font-mono text-[10px] ${healthClass(row.health)}`}>
          <span className={`size-1.5 rounded-full ${healthDotClass(row.health)}`} aria-hidden />
          {row.healthLabel}
        </span>
      </div>
      <p className="mt-2 text-[11px] leading-4 text-ink-muted">{row.healthNote}</p>
      <div className="mt-3 grid grid-cols-3 gap-1.5 font-mono text-[11px]">
        <CellStat label="score" value={`${row.score}`} />
        <CellStat label="年化" value={formatPercent(row.annualReturn)} tone={row.annualReturn >= 10 ? "good" : "bad"} />
        <CellStat label="回撤" value={formatPercent(row.maxDrawdown)} tone={row.maxDrawdown <= 25 ? "good" : "bad"} />
      </div>
      <div className="mt-3 grid gap-2 text-[12px] sm:grid-cols-2">
        <Stamp label="今日信号" value={`${row.todaySignals} today / ${row.openSignals} open`} />
        <Stamp label="模拟账户" value={`${row.positionCount} 持仓 / ${row.orderCount} 订单`} />
        <Stamp label="最近心跳" value={formatDateTime(row.lastPaperSyncAt) || "未写入"} />
        <Stamp label="最近订单" value={row.recentOrderAt ? formatDateTime(row.recentOrderAt) : "暂无"} />
      </div>
      <p className="mt-3 text-[11px] leading-4 text-ink-muted">{row.decisionReason}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <MiniLink href={`/simulation?strategy=${encodeURIComponent(row.strategyId)}`} label="模拟" />
        <MiniLink href={`/backtest?strategy=${encodeURIComponent(row.strategyId)}`} label="回测" />
      </div>
    </article>
  )
}

function StrategyRuntimeTableRow({ row }: { row: StrategyRuntimeRow }) {
  return (
    <tr className="border-b border-rule-soft align-top">
      <Td>
        <div className="max-w-[280px]">
          <p className="truncate text-[14px] font-semibold text-ink">{row.name}</p>
          <p className="mt-1 font-mono text-[10px] text-ink-faint">{row.strategyId}</p>
        </div>
      </Td>
      <Td>
        <div className="flex flex-col gap-1.5">
          <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-1 font-mono text-[10px] ${healthClass(row.health)}`}>
            <span className={`size-1.5 rounded-full ${healthDotClass(row.health)}`} aria-hidden />
            {row.healthLabel}
          </span>
          <p className="max-w-[240px] text-[11px] leading-4 text-ink-muted">{row.healthNote}</p>
        </div>
      </Td>
      <Td>
        <div className="grid grid-cols-3 gap-1.5 font-mono text-[11px]">
          <CellStat label="score" value={`${row.score}`} />
          <CellStat label="年化" value={formatPercent(row.annualReturn)} tone={row.annualReturn >= 10 ? "good" : "bad"} />
          <CellStat label="回撤" value={formatPercent(row.maxDrawdown)} tone={row.maxDrawdown <= 25 ? "good" : "bad"} />
        </div>
      </Td>
      <Td>
        <div className="font-mono text-[12px] text-ink">
          {row.todaySignals} today · {row.openSignals} open
        </div>
        <p className="mt-1 text-[11px] text-ink-muted">{formatDateTime(row.lastSignalAt) || "暂无信号"}</p>
      </Td>
      <Td>
        <div className="font-mono text-[12px] text-ink">
          {row.positionCount} 持仓 · {row.orderCount} 订单
        </div>
        <p className="mt-1 text-[11px] text-ink-muted">{row.closedTradeCount} 平仓 · 今日 {row.todayOrders}</p>
      </Td>
      <Td>
        <p className="font-mono text-[12px] text-ink">{formatDateTime(row.lastPaperSyncAt) || "未写入"}</p>
        <p className="mt-1 text-[11px] text-ink-muted">{row.recentOrderAt ? `最近订单 ${formatDateTime(row.recentOrderAt)}` : "暂无撮合流水"}</p>
      </Td>
      <Td>
        <div className="flex flex-col gap-2">
          <span className="max-w-[220px] text-[11px] leading-4 text-ink-muted">{row.decisionReason}</span>
          <div className="flex flex-wrap gap-1.5">
            <MiniLink href={`/simulation?strategy=${encodeURIComponent(row.strategyId)}`} label="模拟" />
            <MiniLink href={`/backtest?strategy=${encodeURIComponent(row.strategyId)}`} label="回测" />
          </div>
        </div>
      </Td>
    </tr>
  )
}

function RecentSignals({ signals }: { signals: RadarHistoryRecord[] }) {
  return (
    <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <Activity className="size-4" aria-hidden />
            Recent Radar Signals
          </div>
          <h2 className="mt-1 text-[18px] font-semibold text-ink">最近信号</h2>
        </div>
        <LinkButton href="/radar/history" label="信号账本" />
      </div>
      <div className="space-y-2">
        {signals.slice(0, 8).map((signal) => (
          <div key={signal.id} className="rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[13px] font-semibold text-ink">{signal.name} {signal.ticker}</p>
                <p className="mt-1 text-[11px] leading-4 text-ink-muted">{signal.strategyName ?? "策略雷达"} · {signal.signal}</p>
              </div>
              <div className="text-right font-mono text-[11px]">
                <p className={signal.returnPct >= 0 ? "text-bull" : "text-bear"}>{signedPercent(signal.returnPct)}</p>
                <p className="mt-1 text-ink-faint">{formatDateTime(signal.recommendedAt)}</p>
              </div>
            </div>
          </div>
        ))}
        {!signals.length && <EmptyLine text="暂无雷达信号记录。" />}
      </div>
    </section>
  )
}

function RecentOrders({ orders }: { orders: RecentPaperOrderRecord[] }) {
  return (
    <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <ListChecks className="size-4" aria-hidden />
            Paper Order Ledger
          </div>
          <h2 className="mt-1 text-[18px] font-semibold text-ink">最近撮合</h2>
        </div>
        <LinkButton href="/simulation" label="实盘模拟" />
      </div>
      <div className="space-y-2">
        {orders.slice(0, 8).map((order) => (
          <div key={order.orderId} className="rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[13px] font-semibold text-ink">{order.name} {order.symbol}</p>
                <p className="mt-1 text-[11px] leading-4 text-ink-muted">{order.strategyName} · {order.note || "模拟撮合"}</p>
              </div>
              <div className="text-right font-mono text-[11px]">
                <p className={order.side === "buy" ? "text-bull" : "text-bear"}>{order.side === "buy" ? "BUY" : "SELL"} · {order.status}</p>
                <p className="mt-1 text-ink-faint">{formatDateTime(order.filledAt ?? order.submittedAt)}</p>
              </div>
            </div>
          </div>
        ))}
        {!orders.length && <EmptyLine text="暂无模拟撮合流水。" />}
      </div>
    </section>
  )
}

function RuntimeMetric({
  icon: Icon,
  label,
  value,
  detail,
  tone = "neutral",
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  label: string
  value: string
  detail: string
  tone?: "good" | "bad" | "neutral"
}) {
  return (
    <div className="rounded-[7px] border border-rule bg-white px-4 py-4">
      <div className="flex items-center gap-2 text-[12px] text-ink-muted">
        <Icon className="size-4" aria-hidden />
        {label}
      </div>
      <div className={`mt-3 font-mono text-[28px] font-semibold leading-none ${tone === "good" ? "text-health-ok" : tone === "bad" ? "text-bear" : "text-ink"}`}>
        {value}
      </div>
      <p className="mt-2 font-mono text-[11px] text-ink-muted">{detail}</p>
    </div>
  )
}

function Stamp({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className="mt-1 font-mono text-[12px] text-ink">{value}</p>
    </div>
  )
}

function CellStat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "good" | "bad" | "neutral" }) {
  return (
    <span className="rounded-[5px] border border-rule-soft bg-[#fafafa] px-2 py-1">
      <span className="block text-[9px] text-ink-faint">{label}</span>
      <span className={tone === "good" ? "text-health-ok" : tone === "bad" ? "text-bear" : "text-ink"}>{value}</span>
    </span>
  )
}

function QueueStat({ label, value, tone }: { label: string; value: number; tone: StrategyRuntimeActionSeverity }) {
  return (
    <span className="rounded-[7px] border border-rule bg-[#fafafa] px-2 py-2 text-center">
      <span className="block text-ink-faint">{label}</span>
      <span className={`mt-1 block text-[18px] font-semibold leading-none ${actionTextClass(tone)}`}>{value}</span>
    </span>
  )
}

function ActionMiniBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[7px] border border-rule-soft bg-white/70 px-3 py-2">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className="mt-1 text-[12px] leading-5 text-ink-muted">{value}</p>
    </div>
  )
}

function LinkButton({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex h-9 items-center gap-1.5 rounded-[7px] border border-rule bg-white px-3 text-[12px] font-medium text-ink-muted transition hover:bg-[#fafafa] hover:text-ink">
      {label}
      <ArrowUpRight className="size-3.5" aria-hidden />
    </Link>
  )
}

function MiniLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="rounded-[5px] border border-rule bg-white px-2 py-1 text-[11px] text-ink-muted hover:bg-[#fafafa] hover:text-ink">
      {label}
    </Link>
  )
}

function Th({ children }: { children: ReactNode }) {
  return <th className="border-b border-rule px-3 py-2 font-mono text-[11px] font-medium text-ink-faint">{children}</th>
}

function Td({ children }: { children: ReactNode }) {
  return <td className="border-b border-rule-soft px-3 py-3">{children}</td>
}

function EmptyLine({ text }: { text: string }) {
  return <div className="rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-6 text-center text-[13px] text-ink-muted">{text}</div>
}

function healthClass(health: StrategyRuntimeHealth) {
  if (health === "online") return "bg-[#e7f4eb] text-health-ok"
  if (health === "watch") return "bg-[#e6f1ff] text-[#1e5a91]"
  if (health === "stale") return "bg-[#fff8ed] text-[#9b6415]"
  if (health === "pending" || health === "idle") return "bg-[#fafafa] text-ink-muted"
  return "bg-[#fff2f0] text-bear"
}

function healthDotClass(health: StrategyRuntimeHealth) {
  if (health === "online") return "bg-health-ok"
  if (health === "watch") return "bg-[#1e5a91]"
  if (health === "stale") return "bg-[#d99120]"
  if (health === "pending" || health === "idle") return "bg-ink-faint"
  return "bg-bear"
}

function severityLabel(severity: StrategyRuntimeActionSeverity) {
  if (severity === "critical") return "阻塞"
  if (severity === "warning") return "需关注"
  if (severity === "info") return "观察"
  return "正常"
}

function categoryLabel(category: StrategyRuntimeAction["category"]) {
  if (category === "data") return "数据源"
  if (category === "registry") return "注册表"
  if (category === "backtest") return "回测"
  if (category === "execution") return "执行映射"
  if (category === "radar") return "策略雷达"
  if (category === "paper") return "模拟盘"
  return "交易时段"
}

function actionBadgeClass(severity: StrategyRuntimeActionSeverity) {
  if (severity === "critical") return "bg-[#fff2f0] text-bear"
  if (severity === "warning") return "bg-[#fff8ed] text-[#9b6415]"
  if (severity === "info") return "bg-[#e6f1ff] text-[#1e5a91]"
  return "bg-[#e7f4eb] text-health-ok"
}

function actionCardClass(severity: StrategyRuntimeActionSeverity) {
  if (severity === "critical") return "border-[#f0c9c2] bg-[#fff8f7]"
  if (severity === "warning") return "border-[#ead8b7] bg-[#fffaf1]"
  if (severity === "info") return "border-[#cfdef0] bg-[#f7fbff]"
  return "border-[#cce8d4] bg-[#f8fcfa]"
}

function actionTextClass(severity: StrategyRuntimeActionSeverity) {
  if (severity === "critical") return "text-bear"
  if (severity === "warning") return "text-[#9b6415]"
  if (severity === "info") return "text-[#1e5a91]"
  return "text-health-ok"
}

function sourceCardClass(status: StrategyRuntimeSourceStatus) {
  if (status === "ok") return "border-[#cce8d4] bg-[#f8fcfa]"
  if (status === "empty") return "border-[#ead8b7] bg-[#fffaf1]"
  if (status === "fallback") return "border-[#cfdef0] bg-[#f7fbff]"
  return "border-[#f0c9c2] bg-[#fff8f7]"
}

function sourceBadgeClass(status: StrategyRuntimeSourceStatus) {
  if (status === "ok") return "bg-[#e7f4eb] text-health-ok"
  if (status === "empty") return "bg-[#fff8ed] text-[#9b6415]"
  if (status === "fallback") return "bg-[#e6f1ff] text-[#1e5a91]"
  return "bg-[#fff2f0] text-bear"
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`
}

function signedPercent(value: number) {
  const prefix = value > 0 ? "+" : ""
  return `${prefix}${value.toFixed(2)}%`
}

function formatDateTime(value?: string) {
  if (!value) return ""
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return formatBeijingDateTime(date, { dateStyle: "short" })
}
