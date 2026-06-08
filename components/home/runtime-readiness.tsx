import Link from "next/link"
import { unstable_cache } from "next/cache"
import { Activity, ArrowRight, Database, Radio, ShieldCheck, WalletCards } from "lucide-react"
import { resolveWithFallback } from "@/lib/async-timeout"
import { CHINA_TIME_LABEL, formatBeijingDateTime, formatChinaDate } from "@/lib/format"
import { loadStrategyRuntimeSnapshot, type StrategyRuntimeRow, type StrategyRuntimeSnapshot } from "@/lib/strategy-runtime"

type RuntimeTone = "good" | "warning" | "bad"

const RUNTIME_TIMEOUT_MS = 2_500
const getCachedRuntimeReadinessSnapshot = unstable_cache(
  async () => loadStrategyRuntimeSnapshot(),
  ["home-runtime-readiness:v1"],
  { revalidate: 60 },
)

export async function RuntimeReadiness() {
  const snapshot = await resolveWithFallback(getCachedRuntimeReadinessSnapshot(), {
    timeoutMs: RUNTIME_TIMEOUT_MS,
    onFallback: (reason, error) => runtimeReadinessFallback(reason, error),
  })
  const tone = runtimeTone(snapshot)
  const nextAction = runtimeNextAction(snapshot, tone)
  const rows = snapshot.rows.slice(0, 4)

  return (
    <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-ink-muted">
            <Radio className="size-4" aria-hidden />
            P3 · Runtime Readiness
            <span className={`inline-flex items-center gap-1 rounded-[5px] px-2 py-0.5 ${tonePillClass(tone)}`}>
              <span className={`size-1.5 rounded-full ${toneDotClass(tone)}`} aria-hidden />
              {toneLabel(tone)}
            </span>
          </div>
          <h2 className="mt-2 text-[22px] font-semibold text-ink">系统运行可信度</h2>
          <p className="mt-1 max-w-[820px] text-[13px] leading-6 text-ink-muted">
            交易机会之外，先看策略是否在线、数据是否新鲜、模拟盘是否写入；所有时间统一按 {CHINA_TIME_LABEL} 展示。
          </p>
        </div>
        <Link
          href="/ops"
          className="inline-flex h-9 w-fit items-center gap-1.5 rounded-[7px] bg-ink px-3 text-[12px] text-white"
        >
          打开运行中枢 <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <RuntimeCard
          icon={Radio}
          label="在线策略"
          value={`${snapshot.summary.online + snapshot.summary.watch}/${snapshot.summary.total}`}
          detail={`运行 ${snapshot.summary.online} · 观察 ${snapshot.summary.watch} · 滞后 ${snapshot.summary.stale}`}
          tone={snapshot.summary.stale > 0 ? "warning" : "good"}
        />
        <RuntimeCard
          icon={Activity}
          label="今日信号"
          value={`${snapshot.summary.todaySignals}`}
          detail={`开放跟踪 ${snapshot.summary.openSignals} · ${snapshot.session.phaseLabel}`}
          tone={snapshot.summary.todaySignals > 0 ? "good" : "neutral"}
        />
        <RuntimeCard
          icon={WalletCards}
          label="模拟账户"
          value={`${snapshot.summary.activeAccounts}`}
          detail={`今日订单 ${snapshot.summary.todayOrders} · 独立账户`}
          tone={snapshot.summary.activeAccounts > 0 ? "good" : "warning"}
        />
        <RuntimeCard
          icon={Database}
          label="注册表"
          value={`${snapshot.registry.summary.radarReady}`}
          detail={`${snapshot.registry.driver} · ${snapshot.registry.status} · ${formatShortTime(snapshot.generatedAt)}`}
          tone={snapshot.registry.status === "ready" ? "good" : "warning"}
        />
      </div>

      <div className="mt-3 grid gap-2 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
                <ShieldCheck className="size-4" aria-hidden />
                Next Check
              </div>
              <p className="mt-2 text-[14px] font-semibold text-ink">{nextAction.title}</p>
              <p className="mt-1 max-w-[760px] text-[12px] leading-5 text-ink-muted">{nextAction.desc}</p>
            </div>
            <Link
              href={nextAction.href}
              className="inline-flex h-8 shrink-0 items-center rounded-[7px] border border-rule bg-white px-3 font-mono text-[11px] text-ink-muted hover:text-ink"
            >
              {nextAction.cta} →
            </Link>
          </div>
        </div>

        <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
          <p className="font-mono text-[11px] text-ink-muted">heartbeat</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <MiniStamp label="交易日" value={snapshot.session.tradeDate} />
            <MiniStamp label="生成" value={formatShortTime(snapshot.generatedAt)} />
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {rows.map((row) => (
          <RuntimeStrategyCard key={row.strategyId} row={row} />
        ))}
        {!rows.length && (
          <div className="rounded-[7px] border border-dashed border-rule bg-[#fafafa] px-4 py-6 text-center text-[13px] text-ink-muted md:col-span-2 xl:col-span-4">
            暂无可展示的策略运行记录；请先到真实回测页同步策略注册表。
          </div>
        )}
      </div>
    </section>
  )
}

export function RuntimeReadinessFallback() {
  const session = {
    tradeDate: formatChinaDate(new Date().toISOString()),
    generatedAt: new Date().toISOString(),
  }
  return (
    <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-ink-muted">
            <Radio className="size-4" aria-hidden />
            P3 · Runtime Readiness
            <span className="inline-flex items-center gap-1 rounded-[5px] bg-[#eef4f8] px-2 py-0.5 text-[#42627b]">
              <span className="size-1.5 rounded-full bg-[#7aa2bd]" aria-hidden />
              读取缓存
            </span>
          </div>
          <h2 className="mt-2 text-[22px] font-semibold text-ink">系统运行可信度</h2>
          <p className="mt-1 max-w-[820px] text-[13px] leading-6 text-ink-muted">
            正在读取最近一次运行中枢快照；首页主交易卡不会被这部分阻塞。
          </p>
        </div>
        <span className="inline-flex h-9 w-fit items-center rounded-[7px] border border-rule bg-[#fafafa] px-3 font-mono text-[11px] text-ink-muted">
          {CHINA_TIME_LABEL} · {session.tradeDate}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <RuntimeCard icon={Radio} label="在线策略" value="--" detail="读取缓存" tone="neutral" />
        <RuntimeCard icon={Activity} label="今日信号" value="--" detail="读取缓存" tone="neutral" />
        <RuntimeCard icon={WalletCards} label="模拟账户" value="--" detail="读取缓存" tone="neutral" />
        <RuntimeCard icon={Database} label="注册表" value="--" detail={formatShortTime(session.generatedAt)} tone="neutral" />
      </div>
    </section>
  )
}

function RuntimeCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "neutral",
}: {
  icon: typeof Radio
  label: string
  value: string
  detail: string
  tone?: RuntimeTone | "neutral"
}) {
  return (
    <div className="min-w-0 rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
      <div className="flex items-center gap-2 text-[12px] text-ink-muted">
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </div>
      <p className={`mt-3 truncate font-mono text-[24px] font-semibold leading-none ${metricToneClass(tone)}`}>
        {value}
      </p>
      <p className="mt-2 truncate font-mono text-[11px] text-ink-muted">{detail}</p>
    </div>
  )
}

function RuntimeStrategyCard({ row }: { row: StrategyRuntimeRow }) {
  return (
    <Link
      href={`/simulation?strategy=${encodeURIComponent(row.strategyId)}`}
      className="block rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3 transition hover:bg-white"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-ink">{row.name}</p>
          <p className="mt-1 truncate font-mono text-[10px] text-ink-faint">{row.strategyId}</p>
        </div>
        <span className={`shrink-0 rounded-[5px] px-1.5 py-0.5 font-mono text-[10px] ${healthClass(row.health)}`}>
          {row.healthLabel}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1.5 font-mono text-[10px]">
        <MiniMetric label="score" value={`${row.score}`} />
        <MiniMetric label="信号" value={`${row.todaySignals}/${row.openSignals}`} />
        <MiniMetric label="订单" value={`${row.todayOrders}/${row.orderCount}`} />
      </div>
      <p className="mt-3 line-clamp-2 text-[11px] leading-4 text-ink-muted">{row.healthNote}</p>
    </Link>
  )
}

function MiniStamp({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[7px] border border-rule bg-white px-2.5 py-2">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className="mt-1 truncate font-mono text-[12px] text-ink">{value}</p>
    </div>
  )
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-[5px] border border-rule-soft bg-white px-2 py-1">
      <span className="block text-ink-faint">{label}</span>
      <span className="text-ink">{value}</span>
    </span>
  )
}

function runtimeTone(snapshot: StrategyRuntimeSnapshot): RuntimeTone {
  if (snapshot.registry.status === "error" || snapshot.summary.blocked > snapshot.summary.online + snapshot.summary.watch + snapshot.summary.pending) {
    return "bad"
  }
  if (snapshot.warnings.length || snapshot.summary.stale > 0 || snapshot.registry.status !== "ready") return "warning"
  return "good"
}

function runtimeNextAction(snapshot: StrategyRuntimeSnapshot, tone: RuntimeTone) {
  if (tone === "bad") {
    return {
      title: "先修复运行中枢",
      desc: snapshot.warnings[0] ?? "注册表或运行账本异常，先进入运行中枢查看阻塞项。",
      href: "/ops",
      cta: "排查",
    }
  }
  if (snapshot.summary.stale > 0) {
    return {
      title: "检查策略心跳",
      desc: `${snapshot.summary.stale} 个策略账户心跳滞后，优先确认 cron、行情和模拟盘写入。`,
      href: "/ops",
      cta: "查看",
    }
  }
  if (snapshot.summary.todaySignals === 0) {
    return {
      title: snapshot.session.isOpen ? "盘中暂无新信号" : "等待下个交易窗口",
      desc: snapshot.session.isOpen
        ? "策略在线但今天还没有动作级买入，建议进入策略雷达看候选和过滤原因。"
        : "非连续竞价时段不新增信号，当前主要看账本、持仓和上一交易日复盘。",
      href: "/radar",
      cta: "看雷达",
    }
  }
  return {
    title: "运行链路正常",
    desc: "策略、雷达和模拟盘都有记录；下一步重点看信号质量、持仓盈亏和盘后复盘。",
    href: "/simulation",
    cta: "看模拟",
  }
}

function runtimeReadinessFallback(reason: "timeout" | "error", error?: unknown): StrategyRuntimeSnapshot {
  const now = new Date().toISOString()
  return {
    generatedAt: now,
    session: {
      now,
      timeZone: "Asia/Shanghai",
      tradeDate: formatChinaDate(now),
      weekday: 0,
      minutesOfDay: 0,
      phase: "closed",
      phaseLabel: "运行状态待确认",
      isTradingDay: false,
      isOpen: false,
      isClosingWindow: false,
      allowsNewSignals: false,
      allowsPriceTracking: false,
      radarRefreshMs: 0,
      quoteRefreshMs: 0,
      note: reason === "timeout" ? "首页运行状态读取超时。" : error instanceof Error ? error.message : "首页运行状态读取失败。",
    },
    registry: {
      driver: "memory",
      status: "error",
      summary: { total: 0, radarReady: 0, watchlist: 0, blocked: 0, queuedJobs: 0, runningJobs: 0 },
      error: reason,
    },
    deployment: { total: 0, radarOnline: 0, paperWatch: 0, mappingMissing: 0, blocked: 0, pending: 0 },
    summary: {
      total: 0,
      online: 0,
      watch: 0,
      stale: 0,
      pending: 0,
      blocked: 0,
      activeAccounts: 0,
      todaySignals: 0,
      openSignals: 0,
      todayOrders: 0,
    },
    rows: [],
    recentSignals: [],
    recentOrders: [],
    diagnostics: [
      {
        id: "registry",
        label: "首页运行可信度",
        driver: "postgres",
        status: reason === "timeout" ? "timeout" : "error",
        statusLabel: reason === "timeout" ? "超时" : "异常",
        latencyMs: RUNTIME_TIMEOUT_MS,
        itemCount: 0,
        checkedAt: now,
        message: reason === "timeout" ? "首页运行可信度读取超过 2.5 秒。" : error instanceof Error ? error.message : "首页运行状态读取失败。",
        nextStep: "进入运行中枢查看具体数据源诊断。",
        href: "/ops",
      },
    ],
    warnings: [reason === "timeout" ? "首页运行可信度读取超过 2.5 秒，已降级显示。" : "首页运行可信度读取失败。"],
    actions: [
      {
        id: "home-runtime-fallback",
        severity: "critical",
        category: "registry",
        title: reason === "timeout" ? "首页运行可信度读取超时" : "首页运行可信度读取失败",
        summary: reason === "timeout" ? "首页超过 2.5 秒未拿到完整运行快照。" : error instanceof Error ? error.message : "首页运行状态读取失败。",
        impact: "首页只能展示降级运行状态。",
        nextStep: "进入运行中枢查看数据库、雷达和模拟盘心跳。",
        href: "/ops",
        badge: "fallback",
        deadline: "立即处理",
      },
    ],
  }
}

function formatShortTime(value?: string) {
  return formatBeijingDateTime(value, { dateStyle: "short" }).replace(`${CHINA_TIME_LABEL} `, "")
}

function toneLabel(tone: RuntimeTone) {
  if (tone === "good") return "可用"
  if (tone === "warning") return "需关注"
  return "阻塞"
}

function tonePillClass(tone: RuntimeTone) {
  if (tone === "good") return "bg-[#e7f4eb] text-health-ok"
  if (tone === "warning") return "bg-[#fff8ed] text-[#9b6415]"
  return "bg-[#fff2f0] text-bear"
}

function toneDotClass(tone: RuntimeTone) {
  if (tone === "good") return "bg-health-ok"
  if (tone === "warning") return "bg-[#d99120]"
  return "bg-bear"
}

function metricToneClass(tone: RuntimeTone | "neutral") {
  if (tone === "good") return "text-health-ok"
  if (tone === "warning") return "text-warning"
  if (tone === "bad") return "text-bear"
  return "text-ink"
}

function healthClass(health: StrategyRuntimeRow["health"]) {
  if (health === "online") return "bg-[#e7f4eb] text-health-ok"
  if (health === "watch") return "bg-[#e6f1ff] text-[#1e5a91]"
  if (health === "stale") return "bg-[#fff8ed] text-[#9b6415]"
  if (health === "pending" || health === "idle") return "bg-white text-ink-muted"
  return "bg-[#fff2f0] text-bear"
}
