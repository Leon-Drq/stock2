import Link from "next/link"
import type { ComponentType } from "react"
import { AlertTriangle, CheckCircle2, Clock3, Database, GitMerge, RadioTower, RefreshCw, WalletCards } from "lucide-react"
import { loadSignalIntegritySnapshot, type SignalIntegritySeverity, type SignalIntegritySource } from "@/lib/signal-integrity"

export async function SignalIntegritySection() {
  const snapshot = await loadSignalIntegritySnapshot().catch((error) => ({
    checkedAt: new Date().toISOString(),
    session: null,
    status: "critical" as const,
    statusLabel: "异常",
    score: 0,
    summary: null,
    sources: [] as SignalIntegritySource[],
    issues: [{
      id: "signal-integrity-load-failed",
      severity: "critical" as const,
      title: "信号一致性诊断读取失败",
      detail: error instanceof Error ? error.message : String(error),
      nextStep: "检查 /api/signal-integrity/status、数据库连接和最近部署日志。",
      href: "/data",
    }],
    notes: ["该面板读取失败不会触发 Qveris 付费调用。"],
  }))
  const summary = snapshot.summary

  return (
    <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <GitMerge className="size-4" aria-hidden />
            signal ledger integrity
          </div>
          <h2 className="mt-2 text-[20px] font-semibold text-ink">信号账本一致性检查</h2>
          <p className="mt-1 max-w-[900px] text-[13px] leading-6 text-ink-muted">
            对齐首页精选、策略雷达、模拟账户、撮合流水和多策略共振。这里不拉 Qveris 新行情，只检查各页面是否读同一套账本。
          </p>
        </div>
        <div className={`rounded-[7px] border px-3 py-2 text-right ${statusPanelClass(snapshot.status)}`}>
          <p className="font-mono text-[10px] opacity-70">integrity score</p>
          <p className="font-mono text-[26px] font-semibold">{snapshot.score}</p>
          <p className="font-mono text-[10px]">{snapshot.statusLabel}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        <IntegrityKpi icon={RadioTower} label="首页主信号" value={summary ? String(summary.homeSignals) : "N/A"} sub="交易驾驶舱" tone={summary?.homeSignals ? "ok" : "neutral"} />
        <IntegrityKpi icon={Database} label="雷达账本" value={summary ? String(summary.ledgerOpenSignals) : "N/A"} sub={summary ? `${summary.ledgerRecords} 条今日记录` : "读取失败"} tone={summary?.ledgerOpenSignals ? "ok" : "neutral"} />
        <IntegrityKpi icon={GitMerge} label="多策略共振" value={summary ? String(summary.confluenceSignals) : "N/A"} sub={summary ? `${summary.confluenceFilledSignals} 条成交共振` : "读取失败"} tone={summary?.confluenceSignals ? "ok" : "neutral"} />
        <IntegrityKpi icon={WalletCards} label="模拟账户" value={summary ? String(summary.paperAccounts) : "N/A"} sub={summary?.confluenceAccountOnline ? "共振账户在线" : "检查账户接入"} tone={summary?.paperAccounts ? "ok" : "warning"} />
        <IntegrityKpi icon={RefreshCw} label="今日流水" value={summary ? String(summary.todayOrders) : "N/A"} sub={summary ? `买入 ${summary.todayBuyOrders} / 成交 ${summary.filledBuyOrders}` : "读取失败"} tone={summary?.todayOrders ? "ok" : "neutral"} />
        <IntegrityKpi icon={Clock3} label="检查时间" value={formatBeijing(snapshot.checkedAt, "time")} sub="北京时间" tone="neutral" />
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-[7px] border border-rule bg-[#fafafa] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[13px] font-semibold text-ink">链路来源</h3>
            <span className="font-mono text-[10px] text-ink-faint">北京时间 · 只读账本</span>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {snapshot.sources.length > 0 ? snapshot.sources.map((source) => (
              <SourceRow key={source.id} source={source} />
            )) : (
              <div className="rounded-[7px] border border-dashed border-rule bg-white px-3 py-6 text-center text-[12px] text-ink-muted md:col-span-2">
                暂无链路来源数据。
              </div>
            )}
          </div>
        </div>

        <div className="rounded-[7px] border border-rule bg-[#fafafa] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[13px] font-semibold text-ink">需要关注</h3>
            <span className="font-mono text-[10px] text-ink-faint">{snapshot.issues.length} issues</span>
          </div>
          <div className="mt-3 space-y-2">
            {snapshot.issues.length > 0 ? snapshot.issues.map((issue) => (
              <Link
                key={issue.id}
                href={issue.href}
                className={`block rounded-[7px] border px-3 py-3 text-[12px] leading-5 transition hover:border-ink/30 ${issueClass(issue.severity)}`}
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <div>
                    <p className="font-semibold">{issue.title}</p>
                    <p className="mt-1 opacity-80">{issue.detail}</p>
                    <p className="mt-2 font-mono text-[10px] opacity-70">{issue.nextStep}</p>
                  </div>
                </div>
              </Link>
            )) : (
              <div className="rounded-[7px] border border-health-ok/20 bg-health-ok/5 px-3 py-3 text-[12px] leading-5 text-health-ok">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <p>首页、雷达、模拟盘和多策略共振当前没有发现明显口径冲突。</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {snapshot.notes.map((note) => (
          <p key={note} className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 text-[12px] leading-5 text-ink-muted">
            {note}
          </p>
        ))}
      </div>
    </section>
  )
}

function IntegrityKpi({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  label: string
  value: string
  sub: string
  tone: "ok" | "warning" | "neutral"
}) {
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-ink-faint">{label}</span>
        <Icon className={`size-3.5 ${tone === "ok" ? "text-health-ok" : tone === "warning" ? "text-warning" : "text-ink-faint"}`} aria-hidden />
      </div>
      <p className="mt-2 truncate font-mono text-[18px] font-semibold text-ink">{value}</p>
      <p className="mt-1 truncate text-[11px] text-ink-muted">{sub}</p>
    </div>
  )
}

function SourceRow({ source }: { source: SignalIntegritySource }) {
  return (
    <Link href={source.href} className="rounded-[7px] border border-rule bg-white px-3 py-3 transition hover:border-ink/30">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-semibold text-ink">{source.label}</p>
          <p className="mt-1 font-mono text-[10px] text-ink-faint">{source.latencyMs}ms · {source.latestAt ? formatBeijing(source.latestAt, "datetime") : "无最新时间"}</p>
        </div>
        <span className={`rounded-[6px] border px-2 py-1 font-mono text-[10px] ${readStatusClass(source.status)}`}>
          {source.statusLabel}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-[72px_1fr] gap-2 border-t border-rule pt-3 text-[12px]">
        <span className="text-ink-faint">数量</span>
        <span className="font-mono font-semibold text-ink">{source.count}</span>
        <span className="text-ink-faint">说明</span>
        <span className="text-ink-muted">{source.message}</span>
      </div>
    </Link>
  )
}

function statusPanelClass(status: SignalIntegritySeverity) {
  if (status === "critical") return "border-bear/25 bg-bear/5 text-bear"
  if (status === "warning") return "border-warning/25 bg-warning/5 text-warning"
  if (status === "info") return "border-brand/20 bg-brand/5 text-brand"
  return "border-health-ok/25 bg-health-ok/5 text-health-ok"
}

function readStatusClass(status: SignalIntegritySource["status"]) {
  if (status === "ok") return "border-health-ok/20 bg-health-ok/5 text-health-ok"
  if (status === "empty") return "border-rule bg-[#fafafa] text-ink-muted"
  if (status === "timeout") return "border-warning/20 bg-warning/5 text-warning"
  return "border-bear/20 bg-bear/5 text-bear"
}

function issueClass(severity: "info" | "warning" | "critical") {
  if (severity === "critical") return "border-bear/20 bg-bear/5 text-bear"
  if (severity === "warning") return "border-warning/20 bg-warning/5 text-warning"
  return "border-brand/20 bg-brand/5 text-brand"
}

function formatBeijing(value: string, mode: "time" | "datetime") {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "N/A"
  if (mode === "time") {
    return date.toLocaleTimeString("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
  }
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}
