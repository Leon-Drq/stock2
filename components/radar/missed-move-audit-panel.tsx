"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, CheckCircle2, CircleSlash2, Loader2, Search, WifiOff } from "lucide-react"
import { CHINA_TIME_LABEL, formatBeijingDateTime, formatPrice } from "@/lib/format"

type AuditItem = {
  symbol: string
  name: string
  inStockPool: boolean
  inScanUniverse: boolean
  hasHistory: boolean
  hasRealtimeQuote: boolean
  wasRecommendedToday: boolean
  quote?: {
    latest: number
    changePct: number
    tradeDate: string
    tradeTime: string
  }
  reasonCode:
    | "not-in-stock-pool"
    | "not-in-scan-universe"
    | "missing-history"
    | "missing-quote"
    | "recommended"
    | "not-triggered"
  reason: string
}

type AuditReport = {
  generatedAt: string
  tradeDate: string
  universe: {
    id: string
    label: string
    requestedSymbols: number
    note: string
  }
  parsed: number
  items: AuditItem[]
  summary: {
    notInStockPool: number
    notInScanUniverse: number
    missingHistory: number
    missingQuote: number
    recommended: number
    notTriggered: number
  }
  quoteFallbackReason?: string
}

type AuditResponse = {
  ok: boolean
  report?: AuditReport
  error?: string
}

const SAMPLE_INPUT = "光云科技 688365、软通动力 301236、用友网络 600588、星环科技 688031"

const REASON_META: Record<AuditItem["reasonCode"], { label: string; tone: string; icon: typeof Search }> = {
  "not-in-stock-pool": {
    label: "股票池缺失",
    tone: "border-[#ead9b8] bg-[#fff8e9] text-warning",
    icon: CircleSlash2,
  },
  "not-in-scan-universe": {
    label: "未进扫描池",
    tone: "border-[#ead9b8] bg-[#fff8e9] text-warning",
    icon: CircleSlash2,
  },
  "missing-history": {
    label: "缺历史K线",
    tone: "border-[#ead9b8] bg-[#fff8e9] text-warning",
    icon: AlertTriangle,
  },
  "missing-quote": {
    label: "缺实时报价",
    tone: "border-[#ead9b8] bg-[#fff8e9] text-warning",
    icon: WifiOff,
  },
  recommended: {
    label: "已推荐",
    tone: "border-[#cfe6d8] bg-[#eef8f2] text-health-ok",
    icon: CheckCircle2,
  },
  "not-triggered": {
    label: "未触发",
    tone: "border-rule bg-[#fafafa] text-ink-muted",
    icon: Search,
  },
}

export function MissedMoveAuditPanel() {
  const [input, setInput] = useState("")
  const [report, setReport] = useState<AuditReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const sortedItems = useMemo(() => {
    if (!report) return []
    const order: Record<AuditItem["reasonCode"], number> = {
      recommended: 0,
      "not-triggered": 1,
      "missing-quote": 2,
      "missing-history": 3,
      "not-in-scan-universe": 4,
      "not-in-stock-pool": 5,
    }
    return [...report.items].sort((a, b) => order[a.reasonCode] - order[b.reasonCode])
  }, [report])

  async function runAudit(value = input) {
    const payload = value.trim()
    if (!payload) {
      setInput(SAMPLE_INPUT)
      return runAudit(SAMPLE_INPUT)
    }

    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/radar/miss-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: payload }),
      })
      const json = (await res.json()) as AuditResponse
      if (!res.ok || !json.ok || !json.report) {
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }
      setReport(json.report)
    } catch (err) {
      setError(err instanceof Error ? err.message : "漏涨复盘失败")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section className="mt-5 rounded-[7px] border border-rule bg-white px-3 py-3 md:px-5 md:py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-normal text-ink-faint">missed move audit</p>
          <h2 className="mt-1 text-[16px] font-semibold text-ink">漏涨复盘</h2>
          <p className="mt-1 max-w-3xl text-[12px] leading-5 text-ink-muted">
            粘贴今天强势股名单，系统只检查一致性链路：股票池、统一扫描池、历史 K 线、近实时报价和是否已进入信号账本。
          </p>
        </div>
        {report && (
          <span className="rounded-[6px] border border-rule bg-[#fafafa] px-2.5 py-1 font-mono text-[11px] text-ink-muted">
            {CHINA_TIME_LABEL} · {report.tradeDate}
          </span>
        )}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          rows={3}
          className="min-h-24 w-full resize-y rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 text-[13px] leading-6 text-ink outline-none transition placeholder:text-ink-faint focus:border-ink focus:bg-white"
          placeholder={`例如：${SAMPLE_INPUT}`}
        />
        <button
          type="button"
          onClick={() => void runAudit()}
          disabled={isLoading}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-[7px] bg-ink px-4 text-[13px] font-medium text-white transition hover:bg-black disabled:cursor-wait disabled:opacity-70 lg:self-end"
        >
          {isLoading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Search className="size-4" aria-hidden />}
          {isLoading ? "检查中" : "检查漏涨原因"}
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-[7px] border border-[#ead9b8] bg-[#fff8e9] px-3 py-2 text-[12px] leading-5 text-warning">
          {error}
        </div>
      )}

      {report && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-6">
            <AuditMetric label="解析" value={report.parsed} />
            <AuditMetric label="已推荐" value={report.summary.recommended} tone="good" />
            <AuditMetric label="未触发" value={report.summary.notTriggered} />
            <AuditMetric label="缺报价" value={report.summary.missingQuote} tone={report.summary.missingQuote ? "warn" : undefined} />
            <AuditMetric label="缺K线" value={report.summary.missingHistory} tone={report.summary.missingHistory ? "warn" : undefined} />
            <AuditMetric label="池外" value={report.summary.notInScanUniverse + report.summary.notInStockPool} tone={report.summary.notInScanUniverse + report.summary.notInStockPool ? "warn" : undefined} />
          </div>

          <div className="mt-3 rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-2 text-[12px] leading-5 text-ink-muted">
            <span className="font-mono text-[11px] text-ink-faint">{report.universe.label}</span>
            <span className="mx-2 text-ink-faint">/</span>
            扫描池 {report.universe.requestedSymbols} 只。生成时间 {formatBeijingDateTime(report.generatedAt, { seconds: true })}。
            {report.quoteFallbackReason ? ` ${report.quoteFallbackReason}` : ""}
          </div>

          <div className="mt-3 grid gap-2 xl:grid-cols-2">
            {sortedItems.length > 0 ? (
              sortedItems.map((item) => <AuditItemCard key={`${item.symbol}-${item.reasonCode}`} item={item} />)
            ) : (
              <div className="rounded-[7px] border border-dashed border-rule bg-[#fafafa] px-3 py-8 text-center text-[12px] text-ink-muted xl:col-span-2">
                没有解析到股票代码。可粘贴 6 位代码，或常见股票名称。
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}

function AuditMetric({ label, value, tone }: { label: string; value: number; tone?: "good" | "warn" }) {
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className={`mt-1 font-mono text-[18px] font-semibold ${tone === "good" ? "text-health-ok" : tone === "warn" ? "text-warning" : "text-ink"}`}>
        {value}
      </p>
    </div>
  )
}

function AuditItemCard({ item }: { item: AuditItem }) {
  const meta = REASON_META[item.reasonCode]
  const Icon = meta.icon
  const changeClass = item.quote?.changePct == null
    ? "text-ink-muted"
    : item.quote.changePct >= 0
      ? "text-bull"
      : "text-bear"

  return (
    <article className="rounded-[7px] border border-rule bg-white px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-[5px] border px-2 py-0.5 text-[11px] ${meta.tone}`}>
              <Icon className="size-3" aria-hidden />
              {meta.label}
            </span>
            {item.wasRecommendedToday && (
              <span className="rounded-[5px] border border-[#cfe6d8] bg-[#eef8f2] px-2 py-0.5 text-[11px] text-health-ok">
                信号账本
              </span>
            )}
          </div>
          <h3 className="mt-2 truncate text-[15px] font-semibold text-ink">
            {item.name} <span className="font-mono text-[13px]">{item.symbol}</span>
          </h3>
        </div>
        <div className="shrink-0 text-right font-mono">
          <p className="text-[16px] font-semibold text-ink">{item.quote ? formatPrice(item.quote.latest) : "-"}</p>
          <p className={`mt-1 text-[12px] ${changeClass}`}>
            {item.quote ? `${item.quote.changePct >= 0 ? "+" : ""}${item.quote.changePct.toFixed(2)}%` : "无报价"}
          </p>
        </div>
      </div>

      <p className="mt-3 text-[12px] leading-5 text-ink-muted">{item.reason}</p>

      <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[10px] text-ink-muted sm:grid-cols-4">
        <AuditBool label="股票池" ok={item.inStockPool} />
        <AuditBool label="扫描池" ok={item.inScanUniverse} />
        <AuditBool label="K线" ok={item.hasHistory} />
        <AuditBool label="报价" ok={item.hasRealtimeQuote} />
      </div>
      {item.quote && (
        <p className="mt-2 font-mono text-[10px] text-ink-faint">
          行情 {item.quote.tradeDate} {item.quote.tradeTime} · {CHINA_TIME_LABEL}
        </p>
      )}
    </article>
  )
}

function AuditBool({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className={`rounded-[5px] border px-2 py-1 ${ok ? "border-[#cfe6d8] bg-[#eef8f2] text-health-ok" : "border-[#ead9b8] bg-[#fff8e9] text-warning"}`}>
      {label} {ok ? "OK" : "缺"}
    </span>
  )
}
