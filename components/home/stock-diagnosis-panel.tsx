"use client"

import { useMemo, useState } from "react"
import { Bot, BrainCircuit, ChevronDown, LineChart, Loader2, Search, ShieldCheck, SlidersHorizontal } from "lucide-react"
import { formatChinaDateTime } from "@/lib/format"
import type { ProviderId } from "@/lib/model-providers"
import type { StockDiagnosisFailure, StockDiagnosisResult, StockDiagnosisTone } from "@/lib/stock-diagnosis"

type ProviderPreset = {
  id: ProviderId
  label: string
  baseUrl: string
  model: string
  keyHint: string
}

const PROVIDERS: ProviderPreset[] = [
  { id: "default", label: "默认模型", baseUrl: "", model: "", keyHint: "平台内置" },
  { id: "kimi", label: "Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k", keyHint: "KIMI_API_KEY" },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", keyHint: "OPENAI_API_KEY" },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", keyHint: "DEEPSEEK_API_KEY" },
  { id: "qwen", label: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", keyHint: "QWEN_API_KEY" },
  { id: "custom", label: "自定义", baseUrl: "", model: "", keyHint: "MODEL_API_KEY" },
]

type DiagnosisApiResponse = StockDiagnosisResult | StockDiagnosisFailure

export function StockDiagnosisPanel({ variant = "section" }: { variant?: "section" | "cockpit" }) {
  const [query, setQuery] = useState("")
  const [question, setQuestion] = useState("")
  const [includeAi, setIncludeAi] = useState(true)
  const [provider, setProvider] = useState<ProviderId>("default")
  const preset = useMemo(() => PROVIDERS.find((item) => item.id === provider) ?? PROVIDERS[0], [provider])
  const [baseUrl, setBaseUrl] = useState("")
  const [model, setModel] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [showModel, setShowModel] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<StockDiagnosisResult | null>(null)
  const isCockpit = variant === "cockpit"

  function selectProvider(next: ProviderId) {
    const nextPreset = PROVIDERS.find((item) => item.id === next) ?? PROVIDERS[0]
    setProvider(next)
    setBaseUrl(nextPreset.baseUrl)
    setModel(nextPreset.model)
    setApiKey("")
  }

  async function submit(nextQuery?: string) {
    const target = (nextQuery ?? query).trim()
    if (!target) {
      setError("请输入股票名称或 6 位代码")
      return
    }
    setQuery(target)
    setLoading(true)
    setError("")
    try {
      const usesDefault = provider === "default"
      const response = await fetch("/api/stock-diagnosis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: target,
          question: question.trim() || undefined,
          includeAi,
          provider,
          baseUrl: usesDefault ? undefined : baseUrl.trim() || undefined,
          model: usesDefault ? undefined : model.trim() || undefined,
          apiKey: usesDefault ? undefined : apiKey.trim() || undefined,
        }),
      })
      const payload = await response.json() as DiagnosisApiResponse
      if (!payload.ok) {
        setResult(null)
        setError(payload.error)
        return
      }
      setResult(payload)
    } catch (err) {
      setResult(null)
      setError(err instanceof Error ? err.message : "诊断请求失败")
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className={isCockpit
      ? "mb-4 rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3 md:px-4"
      : "rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5"}
    >
      <div className={`flex flex-col gap-3 ${isCockpit ? "lg:flex-row lg:items-center lg:justify-between" : "lg:flex-row lg:items-start lg:justify-between"}`}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <BrainCircuit className="size-4" aria-hidden />
            {isCockpit ? "AI Dialog · 交易驾驶舱" : "AI Stock Diagnosis · 北京时间"}
          </div>
          <h2 className={`mt-1 font-semibold text-ink ${isCockpit ? "text-[18px] md:text-[20px]" : "text-[22px] md:text-[26px]"}`}>
            {isCockpit ? "问一只股票现在怎么处理" : "个股诊断中枢"}
          </h2>
          <p className={`mt-2 max-w-[860px] leading-6 text-ink-muted ${isCockpit ? "text-[12px]" : "text-[13px]"}`}>
            {isCockpit
              ? "输入股票名或代码，直接用 Qveris 最新报价、雷达信号、模拟盘持仓和统一风控规则诊断。"
              : "输入股票名或代码，系统会读取 Qveris 最新报价、历史 K 线、雷达信号、模拟盘持仓与订单，再按统一风控规则给出诊断；AI 只在交易计划内分析，不另起一套推荐逻辑。"}
          </p>
        </div>
        <div className="w-fit rounded-[7px] border border-rule bg-white px-3 py-2 font-mono text-[11px] text-ink-muted">
          radar / paper / AI
        </div>
      </div>

      <div className={`grid gap-3 ${isCockpit ? "mt-3 xl:grid-cols-[minmax(0,1fr)_160px]" : "mt-4 xl:grid-cols-[minmax(0,1fr)_220px]"}`}>
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <label className="block">
            <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">股票</span>
            <div className="flex min-w-0 items-center gap-2 rounded-[7px] border border-rule bg-[#fafafa] px-3">
              <Search className="size-4 shrink-0 text-ink-faint" aria-hidden />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submit()
                }}
                placeholder="例如 深南电路 / 002916 / 北方华创"
                className="h-10 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-ink-faint"
              />
            </div>
          </label>
          <label className="block">
            <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">你关心的问题</span>
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="例如：昨天推荐后大跌，是否止损？"
              className="h-10 w-full rounded-[7px] border border-rule bg-[#fafafa] px-3 text-[14px] outline-none placeholder:text-ink-faint"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={loading}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-[7px] border border-ink bg-ink px-4 font-mono text-[11px] uppercase tracking-[0.12em] text-paper transition hover:bg-paper hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LineChart className="size-4" aria-hidden />}
          {isCockpit ? "问一下" : "诊断"}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {["002916", "002371", "601777"].map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => void submit(item)}
            className="rounded-[7px] border border-rule bg-[#fafafa] px-2.5 py-1.5 font-mono text-[11px] text-ink-muted hover:border-ink hover:text-ink"
          >
            {item}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setIncludeAi((value) => !value)}
          className={`rounded-[7px] border px-2.5 py-1.5 font-mono text-[11px] ${includeAi ? "border-[#b9dfc2] bg-[#eef8f0] text-health-ok" : "border-rule bg-[#fafafa] text-ink-muted"}`}
        >
          AI 解释 {includeAi ? "开" : "关"}
        </button>
        <button
          type="button"
          onClick={() => setShowModel((value) => !value)}
          className="inline-flex items-center gap-1 rounded-[7px] border border-rule bg-[#fafafa] px-2.5 py-1.5 font-mono text-[11px] text-ink-muted hover:text-ink"
        >
          <SlidersHorizontal className="size-3.5" aria-hidden />
          模型
          <ChevronDown className={`size-3.5 transition-transform ${showModel ? "rotate-180" : ""}`} aria-hidden />
        </button>
      </div>

      {showModel && (
        <div className="mt-3 rounded-[7px] border border-rule-soft bg-[#fafafa] p-3">
          <div className="flex flex-wrap gap-2">
            {PROVIDERS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => selectProvider(item.id)}
                className={`rounded-[7px] border px-3 py-2 text-[12px] ${provider === item.id ? "border-ink bg-ink text-paper" : "border-rule bg-white text-ink-muted hover:text-ink"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_220px]">
            <input
              value={provider === "default" ? "" : baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              disabled={provider === "default"}
              placeholder={provider === "default" ? "默认模型无需填写" : "Base URL"}
              className="h-10 rounded-[7px] border border-rule bg-white px-3 font-mono text-[12px] outline-none disabled:bg-[#f5f5f4] disabled:text-ink-faint"
            />
            <input
              value={provider === "default" ? "" : model}
              onChange={(event) => setModel(event.target.value)}
              disabled={provider === "default"}
              placeholder={provider === "default" ? "默认模型无需填写" : "model"}
              className="h-10 rounded-[7px] border border-rule bg-white px-3 font-mono text-[12px] outline-none disabled:bg-[#f5f5f4] disabled:text-ink-faint"
            />
          </div>
          <input
            value={provider === "default" ? "" : apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            disabled={provider === "default"}
            type="password"
            placeholder={provider === "default" ? "留空使用平台默认模型" : `API Key，可留空使用服务端 ${preset.keyHint}`}
            className="mt-2 h-10 w-full rounded-[7px] border border-rule bg-white px-3 font-mono text-[12px] outline-none disabled:bg-[#f5f5f4] disabled:text-ink-faint"
          />
          <p className="mt-2 text-[11px] leading-5 text-ink-faint">
            临时 API Key 只随本次请求发送，不在浏览器或数据库保存；长期密钥建议放到运行环境变量。
          </p>
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-[7px] border border-[#ead8b7] bg-[#fff8ed] px-3 py-2 text-[12px] text-[#8a5a16]">
          {error}
        </div>
      )}

      {result ? <DiagnosisResultView result={result} /> : (
        <div className="mt-4 rounded-[7px] border border-dashed border-rule bg-[#fafafa] px-4 py-6 text-center text-[13px] text-ink-muted">
          可先诊断昨天推荐过的股票，系统会直接显示是否跌破止损、是否仍在开放信号、模拟盘是否持有。
        </div>
      )}
    </section>
  )
}

function DiagnosisResultView({ result }: { result: StockDiagnosisResult }) {
  return (
    <div className="mt-4 space-y-3">
      <div className={`rounded-[7px] border px-4 py-4 ${toneSurface(result.rule.tone)}`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-[6px] border border-ink bg-ink px-2 py-1 font-mono text-[10px] text-paper">
                {result.rule.label}
              </span>
              <span className="rounded-[6px] border border-rule bg-white/75 px-2 py-1 font-mono text-[10px] text-ink-muted">
                {result.quote.source === "qveris-realtime" ? "Qveris 实时报价" : "数据库日线"}
              </span>
              {!result.stock.covered && (
                <span className="rounded-[6px] border border-[#ead8b7] bg-[#fff8ed] px-2 py-1 font-mono text-[10px] text-[#8a5a16]">
                  未在统一股票池
                </span>
              )}
            </div>
            <h3 className="mt-3 text-[24px] font-semibold leading-tight text-ink">
              {result.stock.name} <span className="font-mono text-[16px] text-ink-muted">{result.stock.symbol}</span>
            </h3>
            <p className="mt-2 max-w-[900px] text-[13px] leading-6 text-ink-muted">{result.rule.summary}</p>
          </div>
          <div className="shrink-0 text-left md:text-right">
            <div className="font-mono text-[32px] leading-none text-ink">{formatPrice(result.quote.latest)}</div>
            <div className={`mt-1 font-mono text-[13px] ${result.quote.changePct >= 0 ? "text-bull" : "text-bear"}`}>
              {formatPct(result.quote.changePct)}
            </div>
            <div className="mt-2 font-mono text-[10px] text-ink-faint">{result.quote.tradeDate} {result.quote.tradeTime} 北京时间</div>
          </div>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {result.metrics.slice(0, 8).map((metric) => (
          <div key={`${metric.label}-${metric.value}`} className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">{metric.label}</p>
            <p className={`mt-2 font-mono text-[18px] ${toneText(metric.tone)}`}>{metric.value}</p>
            {metric.detail && <p className="mt-1 truncate text-[11px] text-ink-muted">{metric.detail}</p>}
          </div>
        ))}
      </div>

      <div className={`rounded-[7px] border px-4 py-4 ${planSurface(result.tradePlan.stance)}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
              Trading Plan · 北京时间
            </div>
            <h4 className="mt-2 text-[18px] font-semibold text-ink">{result.tradePlan.label}</h4>
            <p className="mt-2 max-w-[980px] text-[13px] leading-6 text-ink-muted">{result.tradePlan.summary}</p>
          </div>
          <span className="w-fit rounded-[7px] border border-rule bg-white/75 px-3 py-2 font-mono text-[11px] text-ink-muted">
            {planStanceLabel(result.tradePlan.stance)}
          </span>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          <PlanCell label="买点 / 执行" value={result.tradePlan.entryPlan} />
          <PlanCell label="止损" value={result.tradePlan.stopLossPlan} />
          <PlanCell label="止盈" value={result.tradePlan.takeProfitPlan} />
          <PlanCell label="卖出 / 退出" value={result.tradePlan.exitPlan} />
          <PlanCell label="持有时间" value={result.tradePlan.holdingPeriod} />
          <PlanCell label="仓位" value={result.tradePlan.positionPlan} />
        </div>
        <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-[7px] border border-rule-soft bg-white/70 px-3 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">失效条件</p>
            <p className="mt-2 text-[12px] leading-5 text-ink-muted">{result.tradePlan.invalidation}</p>
          </div>
          <div className="rounded-[7px] border border-rule-soft bg-white/70 px-3 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">观察点</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {result.tradePlan.watchPoints.slice(0, 5).map((item) => (
                <span key={item} className="rounded-[6px] border border-rule bg-white px-2 py-1 text-[11px] leading-4 text-ink-muted">
                  {item}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-[7px] border border-rule bg-white px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
              Market Context · 资金 / 事件
            </div>
            <h4 className="mt-2 text-[18px] font-semibold text-ink">AI 可用的非价格补充</h4>
            <p className="mt-2 text-[13px] leading-6 text-ink-muted">
              {result.marketContext.status === "ready"
                ? `已读取 ${result.marketContext.availableSources.map(marketSourceLabel).join("、")}；AI 会把这些真实字段纳入分析。`
                : "当前没有该股可用的资金流、新闻、公告或财务缓存；AI 不会编造这些结论。"}
            </p>
          </div>
          <span className={`w-fit rounded-[7px] border px-3 py-2 font-mono text-[11px] ${result.marketContext.status === "ready" ? "border-[#b9dfc2] bg-[#eef8f0] text-health-ok" : "border-[#ead8b7] bg-[#fff8ed] text-[#8a5a16]"}`}>
            {result.marketContext.status}
          </span>
        </div>
        <div className="mt-4 grid gap-2 lg:grid-cols-3">
          <MarketContextColumn
            title="资金 / 因子"
            empty="暂无主力资金、北向或龙虎榜缓存。"
            rows={result.marketContext.factors.map((item) => ({
              key: `${item.sourceId}-${item.asOf}`,
              title: marketSourceLabel(item.sourceId),
              meta: `${item.asOf}${item.score != null ? ` · score ${formatPrice(item.score)}` : ""}`,
              detail: item.summary,
            }))}
          />
          <MarketContextColumn
            title="新闻 / 公告"
            empty="暂无新闻、研报或公告缓存。"
            rows={[...result.marketContext.events, ...result.marketContext.sentiments].slice(0, 5).map((item, index) => ({
              key: `${item.source}-${item.eventTime}-${index}`,
              title: "eventType" in item ? marketSourceLabel(item.eventType) : marketSourceLabel(item.sourceId),
              meta: formatBeijingDateTime(item.eventTime),
              detail: item.title ?? (item.sentiment != null ? `情绪 ${formatPrice(item.sentiment)}` : "暂无标题"),
            }))}
          />
          <MarketContextColumn
            title="财务 / 原始数据"
            empty="暂无财务或原始非价格缓存。"
            rows={[...result.marketContext.fundamentals.map((item) => ({
              key: `fund-${item.reportPeriod}`,
              title: "财务",
              meta: item.reportPeriod,
              detail: item.summary,
            })), ...result.marketContext.raw.map((item, index) => ({
              key: `raw-${item.sourceId}-${item.asOf}-${index}`,
              title: marketSourceLabel(item.sourceId),
              meta: `${item.asOf}${item.toolName ? ` · ${item.toolName}` : ""}`,
              detail: item.summary,
            }))].slice(0, 5)}
          />
        </div>
        {result.marketContext.limitations.length > 0 && (
          <div className="mt-3 rounded-[7px] border border-[#ead8b7] bg-[#fff8ed] px-3 py-2 text-[11px] leading-5 text-[#8a5a16]">
            {result.marketContext.limitations.join("；")}
          </div>
        )}
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-[7px] border border-rule bg-white px-4 py-4">
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <ShieldCheck className="size-4" aria-hidden />
            system rule
          </div>
          <h4 className="mt-2 text-[18px] font-semibold text-ink">下一步动作</h4>
          <p className="mt-2 text-[14px] leading-6 text-ink-muted">{result.rule.nextStep}</p>
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            <MiniStat label="开放信号" value={`${result.radar.open.length}`} />
            <MiniStat label="模拟持仓" value={`${result.paper.positions.length}`} />
            <MiniStat label="最近订单" value={`${result.paper.orders.length}`} />
          </div>
          {result.radar.open.length > 0 && (
            <div className="mt-4 space-y-2">
              {result.radar.open.slice(0, 3).map((record) => (
                <div key={record.id} className="rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[13px] font-semibold text-ink">{record.strategyName ?? "雷达策略"}</p>
                    <p className={`font-mono text-[12px] ${record.returnPct >= 0 ? "text-bull" : "text-bear"}`}>{formatPct(record.returnPct)}</p>
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-ink-muted">
                    触发 {formatPrice(record.triggerPrice)} · 止损 {record.stopLossPrice ? formatPrice(record.stopLossPrice) : "N/A"} · 目标 {record.targetPrice ? formatPrice(record.targetPrice) : "N/A"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-[7px] border border-rule bg-white px-4 py-4">
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <Bot className="size-4" aria-hidden />
            AI trader analysis
          </div>
          <h4 className="mt-2 text-[18px] font-semibold text-ink">{result.ai?.source === "ai" ? "AI 交易员分析" : "规则交易计划"}</h4>
          <div className="mt-3 whitespace-pre-line text-[13px] leading-6 text-ink-muted">
            {result.ai?.content ?? result.rule.summary}
          </div>
          {result.ai?.warning && (
            <div className="mt-3 rounded-[7px] border border-[#ead8b7] bg-[#fff8ed] px-3 py-2 text-[11px] leading-5 text-[#8a5a16]">
              {result.ai.warning}
            </div>
          )}
        </div>
      </div>

      {(result.paper.positions.length > 0 || result.paper.orders.length > 0) && (
        <div className="rounded-[7px] border border-rule bg-white px-4 py-4">
          <h4 className="text-[16px] font-semibold text-ink">模拟盘匹配</h4>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {result.paper.positions.slice(0, 4).map((position) => (
              <div key={`${position.accountId}-${position.symbol}`} className="rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-semibold text-ink">{position.strategyName}</p>
                    <p className="mt-1 font-mono text-[10px] text-ink-faint">买入 {formatBeijingDateTime(position.openedAt)} · 可卖 {formatBeijingDateTime(position.sellableFrom)}</p>
                  </div>
                  <p className={`font-mono text-[13px] ${position.pnlPct >= 0 ? "text-bull" : "text-bear"}`}>{formatPct(position.pnlPct)}</p>
                </div>
                <p className="mt-2 font-mono text-[11px] text-ink-muted">持仓 {position.shares.toLocaleString("zh-CN")} · 成本 {formatPrice(position.costPrice)} · 现价 {formatPrice(position.currentPrice)}</p>
              </div>
            ))}
            {result.paper.orders.slice(0, 4).map((order) => (
              <div key={order.orderId} className="rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-semibold text-ink">{order.strategyName}</p>
                    <p className="mt-1 font-mono text-[10px] text-ink-faint">{formatBeijingDateTime(order.submittedAt)} 北京时间</p>
                  </div>
                  <span className="rounded-[6px] border border-rule bg-white px-2 py-1 font-mono text-[10px] text-ink-muted">
                    {order.side === "buy" ? "买入" : "卖出"} · {order.status}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-ink-muted">{order.note}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.warnings.length > 0 && (
        <div className="rounded-[7px] border border-[#ead8b7] bg-[#fff8ed] px-3 py-2 text-[12px] leading-5 text-[#8a5a16]">
          {result.warnings.join("；")}
        </div>
      )}
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-2">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className="mt-1 font-mono text-[16px] text-ink">{value}</p>
    </div>
  )
}

function PlanCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[7px] border border-rule-soft bg-white/70 px-3 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">{label}</p>
      <p className="mt-2 text-[12px] leading-5 text-ink">{value}</p>
    </div>
  )
}

function MarketContextColumn({
  title,
  empty,
  rows,
}: {
  title: string
  empty: string
  rows: Array<{ key: string; title: string; meta: string; detail: string }>
}) {
  return (
    <div className="rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">{title}</p>
      <div className="mt-2 space-y-2">
        {rows.slice(0, 4).map((row) => (
          <div key={row.key} className="rounded-[6px] border border-rule bg-white px-2.5 py-2">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[12px] font-semibold text-ink">{row.title}</p>
              <p className="shrink-0 font-mono text-[10px] text-ink-faint">{row.meta}</p>
            </div>
            <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-ink-muted">{row.detail}</p>
          </div>
        ))}
        {!rows.length && <p className="rounded-[6px] border border-dashed border-rule bg-white px-2.5 py-4 text-center text-[11px] text-ink-faint">{empty}</p>}
      </div>
    </div>
  )
}

function marketSourceLabel(sourceId: string) {
  if (sourceId === "fund-flow") return "主力资金"
  if (sourceId === "north-bound") return "北向资金"
  if (sourceId === "dragon-tiger") return "龙虎榜"
  if (sourceId === "news") return "新闻/研报"
  if (sourceId === "announcement") return "公告"
  if (sourceId === "fin-statement") return "财务"
  if (sourceId === "order-book") return "盘口"
  return sourceId
}

function planSurface(stance: StockDiagnosisResult["tradePlan"]["stance"]) {
  if (stance === "stop") return "border-[#efc6c1] bg-[#fff4f2]"
  if (stance === "take-profit" || stance === "hold" || stance === "buy-zone") return "border-[#b9dfc2] bg-[#f2fbf4]"
  if (stance === "reduce") return "border-[#ead8b7] bg-[#fff8ed]"
  return "border-rule bg-[#fafafa]"
}

function planStanceLabel(stance: StockDiagnosisResult["tradePlan"]["stance"]) {
  if (stance === "stop") return "risk-off"
  if (stance === "take-profit") return "take profit"
  if (stance === "hold") return "hold"
  if (stance === "buy-zone") return "buy zone"
  if (stance === "reduce") return "reduce"
  return "wait"
}

function toneSurface(tone: StockDiagnosisTone) {
  if (tone === "good") return "border-[#b9dfc2] bg-[#f2fbf4]"
  if (tone === "warn") return "border-[#ead8b7] bg-[#fff8ed]"
  if (tone === "bad") return "border-[#efc6c1] bg-[#fff4f2]"
  return "border-rule bg-[#fafafa]"
}

function toneText(tone?: StockDiagnosisTone) {
  if (tone === "good") return "text-health-ok"
  if (tone === "warn") return "text-[#9b6415]"
  if (tone === "bad") return "text-bear"
  return "text-ink"
}

function formatPrice(value: number) {
  return value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 3 })
}

function formatPct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
}

function formatBeijingDateTime(value?: string) {
  if (!value) return "N/A"
  return formatChinaDateTime(value, { dateStyle: "short" })
}
