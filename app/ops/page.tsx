import { headers } from "next/headers"
import { Bot, KeyRound, ServerCog } from "lucide-react"
import { StrategyRuntimeDashboard } from "@/components/ops/strategy-runtime-dashboard"
import { PageMasthead, PageShell } from "@/components/shared/page-shell"
import { resolveWithFallback } from "@/lib/async-timeout"
import { getDefaultModelRuntime } from "@/lib/model-providers"
import { loadStrategyRuntimeSnapshot, type StrategyRuntimeSnapshot } from "@/lib/strategy-runtime"

export const metadata = {
  title: "策略运行中枢 — Stock Radar",
}

export const dynamic = "force-dynamic"

export default async function OpsPage() {
  const snapshot = await resolveWithFallback(loadRuntimeSnapshotForPage(), {
    timeoutMs: 6_000,
    onFallback: (reason, error) => runtimeFallback(reason, error),
  })

  return (
    <PageShell width="wide">
      <PageMasthead
        layer="Ops"
        layerEn="Runtime"
        title="策略运行中枢"
        subtitle="把策略准入、雷达信号、模拟账户、撮合流水和数据新鲜度放到同一个工作台，优先回答：策略是否在线、为何没出信号、模拟盘有没有写入。"
      />
      <AiModelRuntimeCard />
      <StrategyRuntimeDashboard snapshot={snapshot} />
    </PageShell>
  )
}

function AiModelRuntimeCard() {
  const runtime = getDefaultModelRuntime()
  const baseUrl = runtime.baseUrl
  const model = runtime.model
  const qverisModel = process.env.QVERIS_DEFAULT_MODEL || "gpt-4.1"
  const hasDirectKey = runtime.keyConfigured
  const hasQverisDefault = Boolean(process.env.QVERIS_API_KEY)
  const ready = hasDirectKey || hasQverisDefault
  const providerLabel = runtime.provider
  const modelLabel = hasDirectKey ? model : hasQverisDefault ? `${qverisModel} (Qveris fallback)` : model || "未配置"
  const baseUrlLabel = hasDirectKey ? baseUrl : hasQverisDefault ? "qveris://default-model-fallback" : baseUrl
  const keyLabel = hasDirectKey
    ? `${runtime.keyHint} 已配置`
    : hasQverisDefault
      ? "QVERIS_API_KEY fallback 可用"
      : "未配置"

  return (
    <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <Bot className="size-4" aria-hidden />
            AI Model Runtime
          </div>
          <h2 className="mt-1 text-[20px] font-semibold text-ink">个股诊断与 AI 解释模型</h2>
          <p className="mt-2 max-w-[820px] text-[13px] leading-6 text-ink-muted">
            首页个股诊断默认使用这里的模型配置。优先读取 MODEL_PROVIDER_KEY；没有配置直接模型 Key 时，才会回退到 Qveris 默认模型。
          </p>
        </div>
        <span className={`w-fit rounded-[7px] border px-3 py-2 font-mono text-[11px] ${ready ? "border-[#b9dfc2] bg-[#eef8f0] text-health-ok" : "border-[#ead8b7] bg-[#fff8ed] text-[#8a5a16]"}`}>
          {ready ? "ready" : "missing key"}
        </span>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-3">
        <AiConfigCell icon={ServerCog} label="provider" value={providerLabel} />
        <AiConfigCell icon={Bot} label="model" value={modelLabel || "未配置"} />
        <AiConfigCell icon={KeyRound} label="key" value={keyLabel} />
      </div>
      <div className="mt-2 rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-2 font-mono text-[10px] text-ink-faint">
        base URL: {maskUrl(baseUrlLabel)}
      </div>
    </section>
  )
}

function AiConfigCell({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Bot
  label: string
  value: string
}) {
  return (
    <div className="rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-3">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </div>
      <p className="mt-2 truncate text-[14px] font-semibold text-ink">{value}</p>
    </div>
  )
}

function maskUrl(value: string) {
  if (!value) return "未配置"
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}`
  } catch {
    return value.slice(0, 48)
  }
}

async function loadRuntimeSnapshotForPage(): Promise<StrategyRuntimeSnapshot> {
  const headerStore = await headers()
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host")
  if (!host) return loadStrategyRuntimeSnapshot()

  const proto = headerStore.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https")
  const cookie = headerStore.get("cookie")
  const response = await fetch(`${proto}://${host}/api/ops`, {
    cache: "no-store",
    headers: {
      accept: "application/json",
      ...(cookie ? { cookie } : {}),
    },
  })
  if (!response.ok) throw new Error(`运行中枢 API 返回 HTTP ${response.status}`)

  const payload = await response.json() as StrategyRuntimeSnapshot & { ok?: boolean }
  return payload
}

function runtimeFallback(reason: "timeout" | "error", error?: unknown): StrategyRuntimeSnapshot {
  const now = new Date().toISOString()
  return {
    generatedAt: now,
    session: {
      now,
      timeZone: "Asia/Shanghai",
      tradeDate: now.slice(0, 10),
      weekday: 0,
      minutesOfDay: 0,
      phase: "closed",
      phaseLabel: "运行状态读取失败",
      isTradingDay: false,
      isOpen: false,
      isClosingWindow: false,
      allowsNewSignals: false,
      allowsPriceTracking: false,
      radarRefreshMs: 0,
      quoteRefreshMs: 0,
      note: reason === "timeout" ? "运行中枢读取超过 6 秒，已进入降级视图。" : error instanceof Error ? error.message : "运行中枢读取失败。",
    },
    registry: {
      driver: "memory",
      status: "error",
      summary: {
        total: 0,
        radarReady: 0,
        watchlist: 0,
        blocked: 0,
        queuedJobs: 0,
        runningJobs: 0,
      },
      error: reason,
    },
    deployment: {
      total: 0,
      radarOnline: 0,
      paperWatch: 0,
      mappingMissing: 0,
      blocked: 0,
      pending: 0,
    },
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
        label: "运行中枢",
        driver: "postgres",
        status: reason === "timeout" ? "timeout" : "error",
        statusLabel: reason === "timeout" ? "超时" : "异常",
        latencyMs: 6000,
        itemCount: 0,
        checkedAt: now,
        message: reason === "timeout" ? "运行中枢读取超过 6 秒。" : error instanceof Error ? error.message : "运行中枢读取失败。",
        nextStep: "检查 Vercel 函数日志、Supabase/Postgres 连接和运行表权限。",
        href: "/data",
      },
    ],
    warnings: [reason === "timeout" ? "运行中枢读取超时，请稍后刷新。" : "运行中枢读取失败，请检查服务端日志。"],
    actions: [
      {
        id: "ops-runtime-fallback",
        severity: "critical",
        category: "registry",
        title: reason === "timeout" ? "运行中枢读取超时" : "运行中枢读取失败",
        summary: reason === "timeout" ? "服务端超过 20 秒未返回完整运行快照。" : error instanceof Error ? error.message : "运行中枢服务端异常。",
        impact: "暂时无法判断策略、雷达和模拟盘是否在线。",
        nextStep: "刷新页面并检查 Vercel 函数日志、数据库连接和 Supabase RLS。",
        href: "/data",
        badge: "fallback",
        deadline: "立即处理",
      },
    ],
  }
}
