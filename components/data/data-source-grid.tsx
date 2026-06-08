"use client"

import { useState } from "react"
import { AlertTriangle, CheckCircle2, Clipboard, ExternalLink, X } from "lucide-react"
import type { HealthReport, DataHealthIssue, DataSourceHealth, HealthStatus } from "@/lib/data-health"
import { FACTORS, STRATEGIES } from "@/lib/catalog"

const STATUS_LABEL: Record<HealthStatus, string> = {
  healthy: "正常",
  degraded: "降级",
  down: "中断",
  "rate-limited": "限速",
  unknown: "未知",
}

const STATUS_DOT: Record<HealthStatus, string> = {
  healthy: "bg-health-ok",
  degraded: "bg-health-warn",
  down: "bg-health-bad",
  "rate-limited": "bg-health-warn",
  unknown: "bg-health-mute",
}

const STATUS_TEXT: Record<HealthStatus, string> = {
  healthy: "text-health-ok",
  degraded: "text-health-warn",
  down: "text-health-bad",
  "rate-limited": "text-health-warn",
  unknown: "text-health-mute",
}

const STATUS_RING: Record<HealthStatus, string> = {
  healthy: "stroke-health-ok",
  degraded: "stroke-health-warn",
  down: "stroke-health-bad",
  "rate-limited": "stroke-health-warn",
  unknown: "stroke-health-mute",
}

const CATEGORIES: Array<DataSourceHealth["source"]["category"]> = ["行情", "财务", "资金", "情绪", "事件", "另类"]

const ISSUE_TONE: Record<DataHealthIssue["severity"], string> = {
  info: "border-health-ok/20 bg-health-ok/5",
  warning: "border-health-warn/30 bg-health-warn/5",
  critical: "border-health-bad/25 bg-health-bad/5",
}

const OWNER_TONE: Record<DataHealthIssue["owner"], string> = {
  Qveris: "border-health-warn/30 bg-health-warn/5 text-health-warn",
  本系统: "border-ink/10 bg-ink/[0.03] text-ink-soft",
  数据口径: "border-blue-200 bg-blue-50 text-blue-700",
}

const SOURCE_FACTOR_HINTS: Record<string, string[]> = {
  "k-line": [
    "f-rev-5d",
    "f-mom-60d",
    "f-vol-spike",
    "f-donchian-55",
    "f-atr-compression",
    "f-minervini-trend",
    "f-absolute-momentum",
    "f-low-vol-mom",
    "f-rsi2-reversal",
    "f-bollinger-revert",
    "f-sma200-momentum",
    "f-risk-adjusted-mom",
    "f-macd-trend",
    "f-tight-breakout",
    "f-pullback-uptrend",
    "f-vcp-breakout",
    "f-keltner-breakout",
    "f-post-breakout-hold",
    "f-rsrs-right-side",
    "f-residual-mom-low-vol",
    "f-mid-vol-reversal",
    "f-value-low-vol",
  ],
  realtime: ["f-intra-vwap", "f-overnight", "f-keltner-breakout", "f-tight-breakout", "f-post-breakout-hold"],
  "fin-statement": ["f-canslim-proxy", "f-pe-rev", "f-value-low-vol"],
  "north-bound": ["f-north-net", "f-ai-flow"],
  "dragon-tiger": ["f-dragon-inst", "f-ai-flow"],
  margin: ["f-margin-spike", "f-ai-flow"],
  "fund-flow": ["f-ai-flow", "f-vol-spike"],
  announcement: ["f-news-sent", "f-ai-breakout"],
  news: ["f-news-sent", "f-ai-breakout"],
  index: ["f-absolute-momentum", "f-sma200-momentum", "f-risk-adjusted-mom"],
  concept: ["f-news-sent", "f-ai-breakout", "f-vol-spike"],
  macro: ["f-absolute-momentum", "f-risk-adjusted-mom", "f-low-vol-mom"],
}

const SOURCE_WORKFLOW_HINTS: Record<string, string[]> = {
  "k-line": ["真实回测", "策略目录评分", "策略雷达", "实盘模拟持仓盈亏"],
  realtime: ["今日精选", "策略雷达盘中刷新", "实盘模拟撮合", "信号触发后涨跌跟踪"],
  "fin-statement": ["基本面因子", "策略实验室文档转因子", "策略上线诊断"],
  "north-bound": ["资金面因子", "多策略交集信号", "策略雷达准入"],
  "dragon-tiger": ["主力席位因子", "事件驱动策略", "盘后复盘报告"],
  margin: ["杠杆资金因子", "风控诊断", "策略雷达准入"],
  "fund-flow": ["主力资金因子", "AI 资金共振", "实盘模拟加减仓"],
  announcement: ["公告事件因子", "自然语言研究", "策略实验室事件抽取"],
  news: ["新闻情绪因子", "AI 现象挖掘", "每日复盘报告"],
  index: ["市场状态过滤", "指数快照", "弱市空仓判断"],
  concept: ["题材热度因子", "涨停/连板复盘", "事件驱动雷达"],
  macro: ["宏观过滤", "长周期风控", "资产状态诊断"],
}

function fmtPct(v: number | null): string {
  if (v == null) return "—"
  return `${Math.round(v * 100)}`
}

function fmtMs(v: number | null): string {
  if (v == null) return "—"
  if (v < 1000) return `${v}`
  return `${(v / 1000).toFixed(1)}`
}

function fmtMsUnit(v: number | null): string {
  if (v == null) return ""
  return v < 1000 ? "ms" : "s"
}

function fmtDateTime(v: string): string {
  const date = new Date(v)
  if (Number.isNaN(date.getTime())) return v
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)
}

function qverisVerdict(item: DataSourceHealth): string {
  const issues = item.issues ?? []
  if (issues.some((issue) => issue.owner === "本系统" && issue.severity === "critical")) {
    return "优先看本系统配置或数据库权限。"
  }
  if (issues.some((issue) => issue.owner === "Qveris" && issue.severity === "critical")) {
    return "主要像 Qveris 通道或工具稳定性问题。"
  }
  if (issues.some((issue) => issue.owner === "数据口径")) {
    return "更像查询口径或字段映射问题。"
  }
  if (issues.some((issue) => issue.owner === "Qveris")) {
    return "包含 Qveris 工具统计降级，需要实测确认。"
  }
  return "当前探活没有明显 Qveris 异常。"
}

function toolSuccessLabel(tool: DataSourceHealth["topTools"][number]) {
  const rate = tool.stats?.success_rate
  return typeof rate === "number" ? `${Math.round(rate * 100)}%` : "—"
}

function toolLatencyLabel(tool: DataSourceHealth["topTools"][number]) {
  const latency = tool.stats?.avg_execution_time_ms
  return typeof latency === "number" ? `${latency}ms` : "—"
}

function impactForSource(item: DataSourceHealth) {
  const factorIds = new Set(SOURCE_FACTOR_HINTS[item.source.id] ?? [])
  const factors = FACTORS.filter((factor) => factorIds.has(factor.id))
  const strategies = STRATEGIES
    .filter((strategy) => strategy.factors.some((factorId) => factorIds.has(factorId)))
    .slice(0, 8)
  const workflows = SOURCE_WORKFLOW_HINTS[item.source.id] ?? ["数据源目录", "策略诊断", "系统健康监控"]
  return { factors, strategies, workflows }
}

function remediationActions(item: DataSourceHealth): Array<{ label: string; detail: string }> {
  const issues = item.issues ?? []
  const actions: Array<{ label: string; detail: string }> = []

  if (issues.some((issue) => issue.owner === "Qveris")) {
    actions.push({
      label: "1. 复核 Qveris 工具",
      detail: "重新 discover 并抽样执行 Top 工具，确认它是否还能返回目标字段、日期和证券代码。",
    })
  }
  if (issues.some((issue) => issue.owner === "本系统")) {
    actions.push({
      label: "2. 检查本系统链路",
      detail: "优先看环境变量、Supabase RLS、缓存写入和定时任务，避免真实数据拿到却写不进去。",
    })
  }
  if (issues.some((issue) => issue.owner === "数据口径")) {
    actions.push({
      label: "3. 修正字段口径",
      detail: "把 Qveris 原始字段映射到本系统标准字段，再用小样本回测确认计算结果。",
    })
  }
  if (item.source.id === "realtime" || item.source.id === "k-line") {
    actions.push({
      label: "4. 建立备用行情",
      detail: "行情是雷达和模拟交易主链路，需保留缓存兜底，并在失败时阻止生成伪实时信号。",
    })
  }

  if (actions.length === 0) {
    actions.push(
      {
        label: "1. 保持监控",
        detail: "当前探活正常，继续按 5 分钟 TTL 监控成功率和延迟。",
      },
      {
        label: "2. 抽样验字段",
        detail: "上线到策略前仍要做少量实际 call，确认字段完整性和复权口径。",
      },
    )
  }

  return actions.slice(0, 4)
}

/** 单张迷你卡：状态点 + 名称 + 类目 + 圆环成功率 + 延迟 + 工具数。Apple 风。 */
function SourceCard({ item, onSelect }: { item: DataSourceHealth; onSelect: (item: DataSourceHealth) => void }) {
  const { source, status, avgSuccessRate, avgLatencyMs, topTools } = item
  const sampledCount = item.sampledCount ?? item.toolCount ?? 0
  const sampleLimit = item.sampleLimit ?? 20
  const successPct = avgSuccessRate != null ? avgSuccessRate * 100 : 0
  const ringCirc = 2 * Math.PI * 22
  const ringOffset = ringCirc * (1 - successPct / 100)
  const primaryIssue = item.issues?.find((issue) => issue.severity !== "info") ?? item.issues?.[0]

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className="group flex min-h-[234px] flex-col gap-3 rounded-[7px] border border-rule bg-white p-4 text-left transition-colors hover:border-ink/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 sm:p-5"
      aria-label={`查看 ${source.name} 数据诊断`}
    >
      {/* Header: status dot + name + category */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`size-1.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
            <span className={`font-mono text-[9px] uppercase tracking-[0.16em] ${STATUS_TEXT[status]}`}>
              {STATUS_LABEL[status]}
            </span>
            {item.stale && (
              <span
                className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-faint"
                title={item.error || "上次成功值（限速降级）"}
              >
                · stale
              </span>
            )}
          </div>
          <h3 className="mt-1.5 truncate text-[15px] font-semibold text-ink">
            {source.name}
          </h3>
          <p className="font-mono text-[10px] tracking-wider text-ink-faint">
            {source.category} · {source.freq.split(/[/\s]/)[0]}
          </p>
          {primaryIssue && (
            <p className="mt-1 line-clamp-1 text-[11px] text-ink-muted">
              {primaryIssue.label}
            </p>
          )}
        </div>
        {/* 成功率圆环 */}
        <svg width="52" height="52" viewBox="0 0 52 52" className="shrink-0">
          <circle cx="26" cy="26" r="22" fill="none" stroke="var(--color-rule)" strokeWidth="3" />
          {avgSuccessRate != null && (
            <circle
              cx="26"
              cy="26"
              r="22"
              fill="none"
              className={STATUS_RING[status]}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={ringCirc}
              strokeDashoffset={ringOffset}
              transform="rotate(-90 26 26)"
            />
          )}
          <text
            x="26"
            y="27"
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-ink font-sans text-[13px] font-semibold tabular-nums"
          >
            {fmtPct(avgSuccessRate)}
          </text>
          <text
            x="26"
            y="38"
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-ink-faint font-mono text-[7px] tracking-wider"
          >
            %
          </text>
        </svg>
      </header>

      {/* Metrics row */}
      <div className="grid grid-cols-3 gap-2 border-t border-rule-soft pt-3">
        <div className="flex flex-col">
          <span className="font-mono text-[9px] uppercase tracking-wider text-ink-faint">延迟</span>
          <span className="text-[15px] font-semibold tabular-nums text-ink">
            {fmtMs(avgLatencyMs)}
            <span className="ml-0.5 font-mono text-[9px] font-normal text-ink-muted">
              {fmtMsUnit(avgLatencyMs)}
            </span>
          </span>
        </div>
        <div
          className="flex flex-col"
          title={`Qveris 按相关性返回 Top-${sampleLimit}，本次实际采样 ${sampledCount} 个。Qveris API 单次 limit 上限 100。`}
        >
          <span className="font-mono text-[9px] uppercase tracking-wider text-ink-faint">
            Top {sampleLimit}
          </span>
          <span className="text-[15px] font-semibold tabular-nums text-ink">
            {sampledCount}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="font-mono text-[9px] uppercase tracking-wider text-ink-faint">覆盖</span>
          <span className="truncate font-sans text-[11px] font-medium text-ink-soft" title={source.coverage}>
            {source.coverage}
          </span>
        </div>
      </div>

      {/* Top tool preview */}
      {topTools.length > 0 ? (
        <div className="border-t border-rule-soft pt-3">
          <p className="font-mono text-[9px] uppercase tracking-wider text-ink-faint">Top 工具</p>
          <p
            className="mt-1 line-clamp-1 break-all text-[12px] text-ink-soft"
            title={topTools[0].name}
          >
            {topTools[0].name}
          </p>
          {topTools.length > 1 && (
            <p className="font-mono text-[10px] text-ink-faint">
              +{topTools.length - 1} 个其他
            </p>
          )}
        </div>
      ) : item.error ? (
        <div className="border-t border-rule-soft pt-3">
          <p className="font-mono text-[9px] uppercase tracking-wider text-health-bad">采样失败</p>
          <p
            className="mt-1 line-clamp-2 break-all font-sans text-[11px] text-ink-muted"
            title={item.error}
          >
            {/^Qveris.*429/i.test(item.error)
              ? "Qveris 限速 · 稍后自动重试"
              : item.error}
          </p>
        </div>
      ) : (
        <div className="border-t border-rule-soft pt-3">
          <p className="font-mono text-[9px] uppercase tracking-wider text-ink-faint">无匹配</p>
          <p className="mt-1 font-sans text-[11px] text-ink-muted">Qveris 未返回工具</p>
        </div>
      )}
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-rule-soft pt-3 font-mono text-[10px] text-ink-faint">
        <span className="line-clamp-1">{qverisVerdict(item)}</span>
        <span className="inline-flex shrink-0 items-center gap-1 text-ink-soft group-hover:text-ink">
          诊断 <ExternalLink className="size-3" aria-hidden />
        </span>
      </div>
    </button>
  )
}

function DataSourceDetailPanel({
  item,
  onClose,
}: {
  item: DataSourceHealth
  onClose: () => void
}) {
  const [copiedIssue, setCopiedIssue] = useState(false)
  const { source, topTools } = item
  const issues = item.issues?.length
    ? item.issues
    : [
        {
          severity: "warning" as const,
          label: "缺少诊断明细",
          detail: "当前接口返回的是旧版健康报告，请刷新数据源健康页后再查看。",
          owner: "本系统" as const,
        },
      ]
  const hasCritical = issues.some((issue) => issue.severity === "critical")
  const impact = impactForSource(item)
  const actions = remediationActions(item)
  const issueDraft = buildQverisIssueDraft(item)
  const issueUrl = githubIssueUrl(issueDraft)

  async function copyIssueDraft() {
    try {
      await navigator.clipboard.writeText(`${issueDraft.title}\n\n${issueDraft.body}`)
      setCopiedIssue(true)
      window.setTimeout(() => setCopiedIssue(false), 1800)
    } catch {
      setCopiedIssue(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-ink/20 p-0 backdrop-blur-[2px] sm:items-center sm:justify-center sm:p-6">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        aria-label="关闭诊断面板"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="data-source-detail-heading"
        className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-[10px] border border-rule bg-white shadow-2xl sm:max-w-4xl sm:rounded-[10px]"
      >
        <header className="sticky top-0 z-10 flex flex-col gap-3 border-b border-rule bg-white/95 px-5 py-4 backdrop-blur sm:px-6 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
              Data Source Diagnosis
            </p>
            <h3 id="data-source-detail-heading" className="mt-1 text-[22px] font-semibold text-ink">
              {source.name}
            </h3>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">{source.desc}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void copyIssueDraft()}
              className="inline-flex h-9 items-center gap-1.5 rounded-[7px] border border-rule bg-[#fafafa] px-3 font-mono text-[11px] text-ink-muted transition-colors hover:bg-white hover:text-ink"
            >
              <Clipboard className="size-3.5" aria-hidden />
              {copiedIssue ? "已复制" : "复制 Issue"}
            </button>
            <a
              href={issueUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-[7px] bg-ink px-3 font-mono text-[11px] text-white transition-colors hover:bg-ink-soft"
            >
              提交到 Qveris
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
            <button
              type="button"
              onClick={onClose}
              className="grid size-9 shrink-0 place-items-center rounded-[6px] border border-rule bg-white text-ink-muted transition-colors hover:border-ink/30 hover:text-ink"
              aria-label="关闭"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </header>

        <div className="grid gap-4 px-5 py-5 sm:px-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-[7px] border border-rule bg-paper p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
                  是否 Qveris 问题
                </p>
                <p className={`mt-2 text-[18px] font-semibold ${hasCritical ? "text-health-bad" : "text-ink"}`}>
                  {qverisVerdict(item)}
                </p>
              </div>
              {hasCritical ? (
                <AlertTriangle className="size-5 text-health-bad" aria-hidden />
              ) : (
                <CheckCircle2 className="size-5 text-health-ok" aria-hidden />
              )}
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
              当前健康页使用 Qveris discover 的 Top-{item.sampleLimit ?? 20} 工具元数据做探活。
              它能判断工具是否匹配、历史成功率、延迟、限速/超时，但还不等于实际字段完整性回测。
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
            <Metric label="状态" value={STATUS_LABEL[item.status]} tone={STATUS_TEXT[item.status]} />
            <Metric label="成功率" value={`${fmtPct(item.avgSuccessRate)}%`} />
            <Metric
              label="平均延迟"
              value={`${fmtMs(item.avgLatencyMs)}${fmtMsUnit(item.avgLatencyMs)}`}
            />
            <Metric label="采样工具" value={`${item.sampledCount ?? item.toolCount}/${item.sampleLimit ?? 20}`} />
          </div>

          <div className="rounded-[7px] border border-rule bg-white p-4 lg:col-span-2">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">问题明细</p>
                <h4 className="text-[16px] font-semibold text-ink">诊断结果</h4>
              </div>
              <span className="font-mono text-[10px] text-ink-faint">北京时间 {fmtDateTime(item.checkedAt)}</span>
            </div>
            <div className="grid gap-2">
              {issues.map((issue, index) => (
                <div key={`${issue.label}-${index}`} className={`rounded-[7px] border p-3 ${ISSUE_TONE[issue.severity]}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold text-ink">{issue.label}</span>
                    <span className={`rounded-[4px] border px-1.5 py-0.5 font-mono text-[9px] ${OWNER_TONE[issue.owner]}`}>
                      {issue.owner}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">{issue.detail}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[7px] border border-rule bg-white p-4 lg:col-span-2">
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">Impact Chain</p>
                <h4 className="text-[16px] font-semibold text-ink">影响链路</h4>
              </div>
              <p className="text-[11px] leading-relaxed text-ink-muted sm:max-w-[420px] sm:text-right">
                这里按数据源字段推断影响范围，用于判断异常会拖累哪些因子、策略和页面。
              </p>
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
              <ImpactGroup
                label="因子"
                count={impact.factors.length}
                items={impact.factors.slice(0, 8).map((factor) => `${factor.name} · IC ${factor.ic.toFixed(3)}`)}
                empty="暂无直接绑定因子"
              />
              <ImpactGroup
                label="策略"
                count={impact.strategies.length}
                items={impact.strategies.slice(0, 8).map((strategy) => `${strategy.name} · ${strategy.freq}`)}
                empty="暂无直接绑定策略"
              />
              <ImpactGroup
                label="工作流"
                count={impact.workflows.length}
                items={impact.workflows}
                empty="暂无直接绑定工作流"
              />
            </div>
          </div>

          <div className="rounded-[7px] border border-rule bg-white p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">字段与口径</p>
            <div className="mt-3 grid gap-2">
              <KeyValue label="类目" value={source.category} />
              <KeyValue label="频率" value={source.freq} />
              <KeyValue label="覆盖" value={source.coverage} />
              <KeyValue label="提供方" value={source.provider} />
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {source.fields.map((field) => (
                <span key={field} className="rounded-[5px] border border-rule bg-paper px-2 py-1 font-mono text-[10px] text-ink-soft">
                  {field}
                </span>
              ))}
            </div>
            <div className="mt-4 rounded-[6px] border border-rule-soft bg-paper p-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-faint">discoverQuery</p>
              <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-ink-soft">{source.discoverQuery}</p>
            </div>
          </div>

          <div className="rounded-[7px] border border-rule bg-white p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">Qveris Top 工具</p>
            <div className="mt-3 grid gap-2">
              {topTools.length > 0 ? (
                topTools.map((tool) => (
                  <div key={tool.tool_id} className="rounded-[6px] border border-rule-soft bg-paper p-3">
                    <p className="line-clamp-1 text-[13px] font-semibold text-ink" title={tool.name}>
                      {tool.name}
                    </p>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-ink-muted" title={tool.description}>
                      {tool.description || "无描述"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[10px] text-ink-faint">
                      <span className="rounded-[4px] border border-rule bg-white px-1.5 py-0.5">成功率 {toolSuccessLabel(tool)}</span>
                      <span className="rounded-[4px] border border-rule bg-white px-1.5 py-0.5">延迟 {toolLatencyLabel(tool)}</span>
                      {tool.provider_name && (
                        <span className="rounded-[4px] border border-rule bg-white px-1.5 py-0.5">{tool.provider_name}</span>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-[6px] border border-rule-soft bg-paper p-3 text-[12px] text-ink-muted">
                  本次没有返回工具。优先调整 discoverQuery 或检查 Qveris 工具目录。
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[7px] border border-rule bg-white p-4 lg:col-span-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">建议动作</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {actions.map((action) => (
                <Action key={action.label} label={action.label} detail={action.detail} />
              ))}
            </div>
          </div>

          <div className="rounded-[7px] border border-rule bg-white p-4 lg:col-span-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">Qveris Issue Draft</p>
                <h4 className="mt-1 text-[16px] font-semibold text-ink">可提交的问题草稿</h4>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
                  当异常属于 Qveris 工具、字段或稳定性问题时，直接复制这段内容提交给 Qveris 团队排查。
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => void copyIssueDraft()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-rule bg-[#fafafa] px-3 font-mono text-[11px] text-ink-muted transition hover:bg-white"
                >
                  <Clipboard className="size-3.5" aria-hidden />
                  {copiedIssue ? "已复制" : "复制"}
                </button>
                <a
                  href={issueUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-rule bg-[#fafafa] px-3 font-mono text-[11px] text-ink-muted transition hover:bg-white hover:text-ink"
                >
                  GitHub
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              </div>
            </div>
            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-[7px] border border-rule bg-[#0f0f0f] p-3 font-mono text-[11px] leading-5 text-white">
              {issueDraft.body}
            </pre>
          </div>
        </div>
      </section>
    </div>
  )
}

type QverisIssueDraft = {
  title: string
  body: string
}

function buildQverisIssueDraft(item: DataSourceHealth): QverisIssueDraft {
  const { source } = item
  const checkedAt = `北京时间 ${fmtDateTime(item.checkedAt)}`
  const issues = item.issues?.length
    ? item.issues.map((issue, index) => `${index + 1}. [${issue.severity}/${issue.owner}] ${issue.label}\n   ${issue.detail}`).join("\n")
    : "无结构化 issue，只有健康状态异常。"
  const tools = item.topTools.length
    ? item.topTools.map((tool, index) => {
        const success = toolSuccessLabel(tool)
        const latency = toolLatencyLabel(tool)
        const provider = tool.provider_name ? ` / provider=${tool.provider_name}` : ""
        return `${index + 1}. ${tool.name} (${tool.tool_id})${provider}\n   success=${success}, latency=${latency}\n   ${tool.description || "无描述"}`
      }).join("\n")
    : "本次未返回 Top 工具。"
  const impact = impactForSource(item)
  const workflows = impact.workflows.join(" / ") || "未知"
  const fields = source.fields.join(", ")
  const error = item.error ? `\n\n## Raw Error\n${item.error}` : ""

  return {
    title: `[Data Health] ${source.name} ${STATUS_LABEL[item.status]} / ${source.id}`,
    body: [
      "## Summary",
      `- 数据源：${source.name} (${source.id})`,
      `- 类目/频率：${source.category} / ${source.freq}`,
      `- 覆盖范围：${source.coverage}`,
      `- 状态：${STATUS_LABEL[item.status]}${item.stale ? " / stale cache" : ""}`,
      `- 成功率：${fmtPct(item.avgSuccessRate)}%`,
      `- 平均延迟：${fmtMs(item.avgLatencyMs)}${fmtMsUnit(item.avgLatencyMs)}`,
      `- 采样工具：${item.sampledCount ?? item.toolCount}/${item.sampleLimit ?? 20}`,
      `- 检查时间：${checkedAt}`,
      "",
      "## Discover Query",
      source.discoverQuery,
      "",
      "## Expected Fields",
      fields,
      "",
      "## Issues",
      issues,
      "",
      "## Top Tools",
      tools,
      "",
      "## Impact",
      `- 影响工作流：${workflows}`,
      `- 影响因子数：${impact.factors.length}`,
      `- 影响策略数：${impact.strategies.length}`,
      "",
      "## Expected Behavior",
      "Qveris 能返回稳定工具，且工具可覆盖上述字段、日期、股票代码和 A 股交易口径。",
      "",
      "## Actual Behavior",
      qverisVerdict(item),
      error,
    ].join("\n"),
  }
}

function githubIssueUrl(draft: QverisIssueDraft) {
  const params = new URLSearchParams({
    title: draft.title,
    body: draft.body,
  })
  return `https://github.com/WonderfulValley/quaestio/issues/new?${params.toString()}`
}

function Metric({ label, value, tone = "text-ink" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-[7px] border border-rule bg-white p-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-faint">{label}</p>
      <p className={`mt-1 text-[17px] font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  )
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[6px] border border-rule-soft bg-paper px-3 py-2">
      <span className="text-[11px] text-ink-muted">{label}</span>
      <span className="text-right text-[12px] font-medium text-ink">{value}</span>
    </div>
  )
}

function Action({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="rounded-[6px] border border-rule-soft bg-paper p-3">
      <p className="text-[12px] font-semibold text-ink">{label}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">{detail}</p>
    </div>
  )
}

function ImpactGroup({
  label,
  count,
  items,
  empty,
}: {
  label: string
  count: number
  items: string[]
  empty: string
}) {
  return (
    <div className="rounded-[6px] border border-rule-soft bg-paper p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] font-semibold text-ink">{label}</p>
        <span className="font-mono text-[10px] text-ink-faint">{count}</span>
      </div>
      {items.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {items.map((entry) => (
            <li key={entry} className="rounded-[5px] border border-rule bg-white px-2 py-1.5 text-[11px] leading-snug text-ink-muted">
              {entry}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 rounded-[5px] border border-rule bg-white px-2 py-1.5 text-[11px] text-ink-faint">
          {empty}
        </p>
      )}
    </div>
  )
}

/** 摘要状态条：5 个 KPI + 状态分布 stacked bar，紧凑横条。 */
function SummaryBar({ report }: { report: HealthReport }) {
  const total = report.totalSources
  const healthy = report.healthyCount
  const degraded = report.degradedCount + report.rateLimitedCount
  const down = report.downCount

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-4 rounded-[7px] border border-rule bg-white px-5 py-4 sm:grid-cols-4 sm:px-6 lg:grid-cols-[auto_1fr_auto_auto_auto] lg:gap-6">
      {/* 总数 */}
      <div className="flex flex-col">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-faint">数据源</span>
        <span className="text-2xl font-semibold tabular-nums text-ink">{total}</span>
      </div>

      {/* 状态分布 stacked bar */}
      <div className="col-span-2 flex flex-col justify-center sm:col-span-2 lg:col-span-1">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-faint">状态分布</span>
        <div className="mt-2 flex h-2 w-full overflow-hidden bg-rule-soft">
          {healthy > 0 && <div className="bg-health-ok" style={{ width: `${(healthy / total) * 100}%` }} />}
          {degraded > 0 && <div className="bg-health-warn" style={{ width: `${(degraded / total) * 100}%` }} />}
          {down > 0 && <div className="bg-health-bad" style={{ width: `${(down / total) * 100}%` }} />}
        </div>
        <div className="mt-1.5 flex gap-3 font-mono text-[10px] tabular-nums">
          <span className="text-health-ok">正常 {healthy}</span>
          <span className="text-health-warn">降级 {degraded}</span>
          <span className="text-health-bad">中断 {down}</span>
        </div>
      </div>

      {/* 采样工具 Σ：每 source Top-20 之和；Qveris 单次 limit 上限 100，"真实命中总数" 不可知 */}
      <div
        className="flex flex-col"
        title={`每个数据源按 limit=20 采样相关性 Top-20 工具，共 ${report.totalTools} 个。\nQveris API 单次 limit 上限 100，未暴露"真实命中总数"。`}
      >
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-faint">
          采样工具 Σ
        </span>
        <span className="text-2xl font-semibold tabular-nums text-ink">
          {report.totalTools}
        </span>
      </div>

      {/* 健康率 */}
      <div className="flex flex-col">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-faint">健康率</span>
        <span className="text-2xl font-semibold tabular-nums text-ink">
          {Math.round((healthy / total) * 100)}
          <span className="ml-0.5 font-mono text-[10px] font-normal text-ink-muted">%</span>
        </span>
      </div>
    </div>
  )
}

/** 类目过滤器 chip 行。 */
function CategoryFilter({
  active,
  setActive,
  counts,
}: {
  active: string | null
  setActive: (c: string | null) => void
  counts: Record<string, number>
}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => setActive(null)}
        className={`h-8 rounded-[6px] border px-2.5 text-[12px] transition-colors ${
          active === null
            ? "border-ink bg-ink text-paper"
            : "border-rule bg-white text-ink-soft hover:border-ink/40"
        }`}
      >
        全部 <span className="ml-0.5 font-mono text-[10px] opacity-70">{total}</span>
      </button>
      {CATEGORIES.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => setActive(c === active ? null : c)}
          className={`h-8 rounded-[6px] border px-2.5 text-[12px] transition-colors ${
            active === c
              ? "border-ink bg-ink text-paper"
              : "border-rule bg-white text-ink-soft hover:border-ink/40"
          }`}
        >
          {c} <span className="ml-0.5 font-mono text-[10px] opacity-70">{counts[c] ?? 0}</span>
        </button>
      ))}
    </div>
  )
}

export function DataSourceGrid({ report }: { report: HealthReport }) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [selectedSource, setSelectedSource] = useState<DataSourceHealth | null>(null)

  const counts: Record<string, number> = {}
  for (const item of report.items) {
    counts[item.source.category] = (counts[item.source.category] ?? 0) + 1
  }

  const filtered = activeCategory
    ? report.items.filter((i) => i.source.category === activeCategory)
    : report.items

  // 排序：先按状态健康度，再按成功率降序
  const statusOrder: Record<HealthStatus, number> = {
    healthy: 0,
    degraded: 1,
    "rate-limited": 2,
    down: 3,
    unknown: 4,
  }
  const sorted = [...filtered].sort((a, b) => {
    const sd = statusOrder[a.status] - statusOrder[b.status]
    if (sd !== 0) return sd
    return (b.avgSuccessRate ?? 0) - (a.avgSuccessRate ?? 0)
  })

  return (
    <section aria-labelledby="data-grid-heading" className="mt-5">
      {/* 标题 */}
      <header className="mb-4 flex flex-col gap-2 sm:mb-5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
        <div>
          <p className="font-mono text-[11px] text-ink-faint">
            Sources · 数据源全景
          </p>
          <h2
            id="data-grid-heading"
            className="mt-1 text-[24px] font-semibold text-ink"
          >
            {report.totalSources} 个数据源 · {report.totalTools} 个工具
          </h2>
        </div>
        <p className="text-[12px] leading-snug text-ink-muted sm:text-right">
          点击类目过滤，点击卡片查看诊断
        </p>
      </header>

      {/* 摘要状态条 */}
      <SummaryBar report={report} />

      {/* 类目过滤 */}
      <div className="mt-5 overflow-x-auto pb-1">
        <CategoryFilter active={activeCategory} setActive={setActiveCategory} counts={counts} />
      </div>

      {/* 卡片网格 */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {sorted.map((item) => (
          <SourceCard key={item.source.id} item={item} onSelect={setSelectedSource} />
        ))}
      </div>
      {selectedSource && (
        <DataSourceDetailPanel item={selectedSource} onClose={() => setSelectedSource(null)} />
      )}
    </section>
  )
}
