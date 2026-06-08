"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  Braces,
  CheckCircle2,
  Clipboard,
  FileText,
  Image as ImageIcon,
  KeyRound,
  LibraryBig,
  Loader2,
  PlusCircle,
  Play,
  Search,
  Settings2,
  Upload,
  X,
} from "lucide-react"
import type { ProviderId } from "@/lib/model-providers"
import type { StrategyDraft, StrategyFactorMapping, StrategyLabMode } from "@/lib/strategy-lab"
import {
  buildCustomFactorCandidates,
  loadCustomFactors,
  patchDraftWithCustomFactor,
  upsertCustomFactor,
  type CustomFactor,
} from "@/lib/custom-factors"
import { persistStrategyDraftForBacktest } from "@/lib/custom-strategies"
import { buildFactorDataPlanForDraft } from "@/lib/factor-data-bindings"
import { FactorDataCompletionPanel } from "@/components/shared/factor-data-completion-panel"

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

type AnalyzeResponse = {
  source: "ai" | "heuristic"
  warning?: string
  rawContent?: string
  provider?: ProviderId
  model?: string | null
  draft: StrategyDraft
  usage?: {
    total_tokens?: number
  } | null
}

const SAMPLE_TEXT = [
  "利弗莫尔买入法：只在趋势确认后买入，等待价格突破关键点，突破时成交量明显放大。",
  "买入后如果跌破关键点或回撤超过 7% 立刻止损；若价格继续沿趋势上行则分批加仓。",
  "避免在大盘弱势和流动性不足时交易，优先选择成交活跃、形态清晰、突破后仍能维持强势的股票。",
].join("\n")

const MARKET_SAMPLE_TEXT = [
  "今天观察到几只强势上涨股票：光迅科技 002281、国科微 300672、江苏银行 600919。",
  "共同现象：盘中放量、突破近期平台，部分股票所属板块也有共振。想分析上涨原因，挖掘可回测因子，并生成策略。",
  "如果需要资金流、盘口、新闻或板块数据，请列出缺口。",
].join("\n")

export function StrategyLabClient() {
  const [mode, setMode] = useState<StrategyLabMode>("market-observation")
  const [provider, setProvider] = useState<ProviderId>("default")
  const preset = useMemo(() => PROVIDERS.find((item) => item.id === provider) ?? PROVIDERS[0], [provider])
  const [baseUrl, setBaseUrl] = useState(preset.baseUrl)
  const [model, setModel] = useState(preset.model)
  const [apiKey, setApiKey] = useState("")
  const [title, setTitle] = useState("上涨样本因子挖掘")
  const [text, setText] = useState(MARKET_SAMPLE_TEXT)
  const [imageDataUrl, setImageDataUrl] = useState("")
  const [imageName, setImageName] = useState("")
  const [fileNote, setFileNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnalyzeResponse | null>(null)
  const [copied, setCopied] = useState(false)
  const [customFactors, setCustomFactors] = useState<CustomFactor[]>([])
  const [sendingBacktest, setSendingBacktest] = useState(false)

  const dslText = useMemo(() => result ? JSON.stringify(result.draft.dsl, null, 2) : "", [result])
  const factorCandidates = useMemo(() => result ? buildCustomFactorCandidates(result.draft) : [], [result])
  const dataPlan = useMemo(() => result ? buildFactorDataPlanForDraft(result.draft) : null, [result])
  const usesPlatformDefaultModel = provider === "default"

  useEffect(() => {
    setCustomFactors(loadCustomFactors())
  }, [])

  function selectProvider(next: ProviderId) {
    const nextPreset = PROVIDERS.find((item) => item.id === next) ?? PROVIDERS[0]
    setProvider(next)
    setBaseUrl(nextPreset.baseUrl)
    setModel(nextPreset.model)
    setApiKey("")
    setError(null)
  }

  function selectMode(next: StrategyLabMode) {
    setMode(next)
    setResult(null)
    setError(null)
    setCopied(false)
    if (next === "market-observation") {
      setTitle("上涨样本因子挖掘")
      setText(MARKET_SAMPLE_TEXT)
    } else {
      setTitle("利弗莫尔买入法")
      setText(SAMPLE_TEXT)
      clearImage()
    }
  }

  async function readFile(file: File) {
    setFileNote(null)
    setResult(null)
    if (file.type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(file.name)) {
      await readImageFile(file)
      return
    }

    const cleanName = file.name.replace(/\.(txt|md|pdf)$/i, "")
    if (cleanName) setTitle(cleanName)

    if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
      setFileNote("已选择 PDF。当前版本先支持粘贴 PDF 正文；下一步可接入服务端 PDF 解析/OCR，把整份文件直接转策略。")
      return
    }

    try {
      const content = await file.text()
      setText(content.slice(0, 60_000))
      setFileNote(`${file.name} 已导入，长度 ${content.length.toLocaleString("zh-CN")} 字符。`)
    } catch {
      setFileNote("文件读取失败，请改用粘贴正文。")
    }
  }

  async function readImageFile(file: File) {
    setMode("market-observation")
    const cleanName = file.name.replace(/\.(png|jpe?g|webp)$/i, "")
    if (cleanName && title === "上涨样本因子挖掘") setTitle(cleanName)
    try {
      const dataUrl = await compressImageFile(file)
      setImageDataUrl(dataUrl)
      setImageName(file.name)
      setFileNote(`${file.name} 已附加为市场截图；支持视觉的模型会直接读取，默认模型会把截图识别列为待校验数据。`)
    } catch {
      setFileNote("截图读取失败，请压缩后重试，或把截图里的股票、时间和指标文字粘贴到观察文本。")
    }
  }

  function clearImage() {
    setImageDataUrl("")
    setImageName("")
  }

  async function analyze() {
    const trimmed = text.trim()
    if (!trimmed && !imageDataUrl) {
      setError(mode === "market-observation" ? "请先输入观察文字或上传截图" : "请先上传或粘贴策略文档正文")
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)
    setCopied(false)
    try {
      const res = await fetch("/api/strategy-lab/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          mode,
          baseUrl: usesPlatformDefaultModel ? undefined : baseUrl.trim() || undefined,
          model: usesPlatformDefaultModel ? undefined : model.trim() || undefined,
          apiKey: usesPlatformDefaultModel ? undefined : apiKey.trim() || undefined,
          title,
          text: trimmed,
          imageDataUrl: imageDataUrl || undefined,
          imageName: imageName || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }
      setResult(json as AnalyzeResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : "策略解析失败")
    } finally {
      setLoading(false)
    }
  }

  async function copyDsl() {
    if (!dslText) return
    await navigator.clipboard.writeText(dslText)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  function addCustomFactor(factor: CustomFactor) {
    const saved = upsertCustomFactor(factor)
    setCustomFactors(loadCustomFactors())
    setResult((current) => current ? { ...current, draft: patchDraftWithCustomFactor(current.draft, saved) } : current)
  }

  function addAllCustomFactors() {
    for (const factor of factorCandidates) upsertCustomFactor(factor)
    const saved = loadCustomFactors()
    setCustomFactors(saved)
    setResult((current) => {
      if (!current) return current
      const patched = factorCandidates.reduce((draft, factor) => {
        const savedFactor = saved.find((item) => item.id === factor.id) ?? factor
        return patchDraftWithCustomFactor(draft, savedFactor)
      }, current.draft)
      return { ...current, draft: patched }
    })
  }

  function goToBacktest() {
    if (!result) return
    setSendingBacktest(true)
    let draft = result.draft
    if (factorCandidates.length > 0) {
      for (const factor of factorCandidates) upsertCustomFactor(factor)
      const savedFactors = loadCustomFactors()
      draft = factorCandidates.reduce((currentDraft, factor) => {
        const savedFactor = savedFactors.find((item) => item.id === factor.id) ?? factor
        return patchDraftWithCustomFactor(currentDraft, savedFactor)
      }, draft)
      setCustomFactors(savedFactors)
      setResult((current) => current ? { ...current, draft } : current)
    }
    const saved = persistStrategyDraftForBacktest(draft)
    window.location.href = `/backtest?strategy=${encodeURIComponent(saved.id)}`
  }

  return (
    <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[minmax(420px,0.82fr)_minmax(0,1.18fr)]">
      <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5 xl:sticky xl:top-5 xl:self-start">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
              <Upload className="size-4" aria-hidden />
              {mode === "market-observation" ? "市场观察输入" : "文档输入"}
            </p>
            <h2 className="mt-2 text-[20px] font-semibold text-ink">
              {mode === "market-observation" ? "观察 / 截图生成策略" : "上传 / 粘贴策略"}
            </h2>
          </div>
          <span className="rounded-[6px] border border-rule bg-[#fafafa] px-2 py-1 font-mono text-[10px] text-ink-muted">
            {mode === "market-observation" ? "phenomenon first" : "text first"}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => selectMode("market-observation")}
            className={`rounded-[7px] border px-3 py-3 text-left transition ${
              mode === "market-observation" ? "border-ink bg-ink text-white" : "border-rule bg-[#fafafa] text-ink"
            }`}
          >
            <span className="flex items-center gap-2 text-[13px] font-semibold">
              <Search className="size-4" aria-hidden />
              市场现象
            </span>
            <span className={`mt-1 block text-[11px] leading-4 ${mode === "market-observation" ? "text-white/70" : "text-ink-muted"}`}>
              截图/股票样本 → 因子假设
            </span>
          </button>
          <button
            type="button"
            onClick={() => selectMode("document")}
            className={`rounded-[7px] border px-3 py-3 text-left transition ${
              mode === "document" ? "border-ink bg-ink text-white" : "border-rule bg-[#fafafa] text-ink"
            }`}
          >
            <span className="flex items-center gap-2 text-[13px] font-semibold">
              <FileText className="size-4" aria-hidden />
              策略文档
            </span>
            <span className={`mt-1 block text-[11px] leading-4 ${mode === "document" ? "text-white/70" : "text-ink-muted"}`}>
              文档/笔记 → 策略 DSL
            </span>
          </button>
        </div>

        <label className="mt-4 block">
          <span className="mb-2 block font-mono text-[11px] text-ink-muted">
            {mode === "market-observation" ? "研究名称" : "策略名称"}
          </span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="h-10 w-full rounded-[7px] border border-rule bg-[#fafafa] px-3 text-[14px] text-ink focus:border-ink focus:outline-none"
          />
        </label>

        <label className="mt-3 flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-[7px] border border-dashed border-rule bg-[#fafafa] px-4 py-5 text-center hover:bg-white">
          {mode === "market-observation" ? <ImageIcon className="size-5 text-ink-muted" aria-hidden /> : <FileText className="size-5 text-ink-muted" aria-hidden />}
          <span className="mt-2 text-[13px] font-medium text-ink">
            {mode === "market-observation" ? "选择截图 / 文本文件" : "选择 .txt / .md / .pdf 文件"}
          </span>
          <span className="mt-1 text-[12px] text-ink-muted">
            {mode === "market-observation" ? "图片会压缩后附加；也可以只粘贴股票列表和观察文字" : "文本文件会直接导入；PDF 暂先粘贴正文"}
          </span>
          <input
            type="file"
            accept=".txt,.md,.pdf,.png,.jpg,.jpeg,.webp,text/plain,text/markdown,application/pdf,image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void readFile(file)
              event.currentTarget.value = ""
            }}
          />
        </label>

        {fileNote && (
          <p className="mt-3 rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 text-[12px] leading-5 text-ink-muted">
            {fileNote}
          </p>
        )}

        {imageDataUrl && (
          <div className="mt-3 rounded-[7px] border border-rule bg-[#fafafa] p-2">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="truncate font-mono text-[11px] text-ink-muted">{imageName || "market-screenshot"}</span>
              <button
                type="button"
                onClick={clearImage}
                className="inline-flex size-7 items-center justify-center rounded-[6px] border border-rule bg-white text-ink-muted hover:text-ink"
                aria-label="移除截图"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
            <img src={imageDataUrl} alt="已上传市场截图" className="max-h-56 w-full rounded-[6px] object-contain" />
          </div>
        )}

        <label className="mt-4 block">
          <span className="mb-2 block font-mono text-[11px] text-ink-muted">
            {mode === "market-observation" ? "观察文本 / 股票样本" : "文档正文"}
          </span>
          <textarea
            rows={12}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={mode === "market-observation" ? "粘贴上涨股票、截图里的文字、盘口描述、新闻催化或你的观察..." : "粘贴你的策略文档、交易笔记或规则说明..."}
            className="w-full resize-y rounded-[7px] border border-rule bg-[#fafafa] p-3 text-[14px] leading-6 text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none"
          />
        </label>

        <div className="mt-4 rounded-[7px] border border-rule bg-[#fafafa] p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 font-mono text-[11px] text-ink-muted">
              <Settings2 className="size-3.5" aria-hidden />
              模型
            </p>
            <span className="font-mono text-[10px] text-ink-faint">{preset.keyHint}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {PROVIDERS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => selectProvider(item.id)}
                className={`h-8 rounded-[6px] border px-3 font-mono text-[11px] ${
                  provider === item.id ? "border-ink bg-ink text-white" : "border-rule bg-white text-ink-muted"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <input
              value={usesPlatformDefaultModel ? "" : baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={provider === "default" ? "默认模型无需填写" : "Base URL"}
              disabled={usesPlatformDefaultModel}
              className="h-9 rounded-[7px] border border-rule bg-white px-3 font-mono text-[11px] text-ink focus:border-ink focus:outline-none disabled:bg-[#f5f5f4] disabled:text-ink-faint"
            />
            <input
              value={usesPlatformDefaultModel ? "" : model}
              onChange={(event) => setModel(event.target.value)}
              placeholder={provider === "default" ? "默认模型无需填写" : "model"}
              disabled={usesPlatformDefaultModel}
              className="h-9 rounded-[7px] border border-rule bg-white px-3 font-mono text-[11px] text-ink focus:border-ink focus:outline-none disabled:bg-[#f5f5f4] disabled:text-ink-faint"
            />
          </div>
          <label className="mt-2 flex h-9 items-center gap-2 rounded-[7px] border border-rule bg-white px-3">
            <KeyRound className="size-3.5 text-ink-muted" aria-hidden />
            <input
              value={usesPlatformDefaultModel ? "" : apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              type="password"
              autoComplete="off"
              placeholder={provider === "default" ? "留空使用平台默认模型" : `API Key，可留空使用服务端 ${preset.keyHint}`}
              disabled={usesPlatformDefaultModel}
              className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-ink outline-none placeholder:text-ink-faint disabled:text-ink-faint"
            />
          </label>
        </div>

        {error && (
          <p className="mt-3 rounded-[7px] border border-bear/30 bg-bear/5 px-3 py-2 text-[13px] text-bear">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={analyze}
          disabled={loading || (!text.trim() && !imageDataUrl)}
          className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-[7px] bg-ink px-4 font-mono text-[12px] text-white disabled:opacity-40"
        >
          {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
          {loading ? "解析中" : mode === "market-observation" ? "AI 研究现象并生成策略" : "AI 解析策略"}
        </button>
      </section>

      <section className="space-y-5">
        {!result && (
          <EmptyState />
        )}

        {result && (
          <>
            {result.warning && (
              <div className="rounded-[7px] border border-warning/30 bg-warning/5 px-4 py-3 text-[13px] leading-5 text-warning">
                {result.warning}
              </div>
            )}

            <article className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-rule-soft pb-4">
                <div>
                  <p className="font-mono text-[11px] text-ink-muted">
                    {result.source === "ai" ? "AI strategy draft" : "heuristic draft"}
                    {result.model ? ` · ${result.model}` : ""}
                    {result.usage?.total_tokens ? ` · ${result.usage.total_tokens} tokens` : ""}
                  </p>
                  <h2 className="mt-2 break-words text-[22px] font-semibold leading-tight text-ink sm:text-[28px]">{result.draft.name}</h2>
                  <p className="mt-2 max-w-[780px] text-[14px] leading-6 text-ink-muted">{result.draft.summary}</p>
                </div>
                <Readiness readiness={result.draft.backtestReadiness} />
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <MiniSpec label="市场" value={result.draft.market} />
                <MiniSpec label="周期" value={result.draft.timeframe} />
                <MiniSpec label="数据" value={`${result.draft.backtestReadiness.requiredData.length} 类`} />
                <MiniSpec label="因子" value={`${result.draft.factorMap.length} 个`} />
              </div>
            </article>

            {result.draft.research?.mode === "market-observation" && (
              <MarketResearchPanel research={result.draft.research} />
            )}

            {dataPlan && (
              <FactorDataCompletionPanel
                plan={dataPlan}
                title="数据补齐预检"
                subtitle="真实回测前先确认每个因子需要哪些 Qveris 原始字段；未绑定的非价格因子会在回测里暂时降级为 K 线代理。"
              />
            )}

            <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_420px]">
              <article className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
                <SectionTitle icon={CheckCircle2} title="规则拆解" right="entry / exit / risk" />
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <RuleBlock title="入场" items={result.draft.entryRules} />
                  <RuleBlock title="出场" items={result.draft.exitRules} />
                  <RuleBlock title="风控" items={result.draft.riskRules} />
                  <RuleBlock title="仓位" items={result.draft.positionRules} />
                </div>
              </article>

              <article className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
                <SectionTitle icon={AlertCircle} title="回测准备" right={`${result.draft.backtestReadiness.score}/100`} />
                <div className="mt-4 space-y-2">
                  {result.draft.backtestReadiness.issues.map((issue) => (
                    <p key={issue} className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 text-[12px] leading-5 text-ink-muted">
                      {issue}
                    </p>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {result.draft.backtestReadiness.requiredData.map((item) => (
                    <span key={item} className="rounded-[5px] border border-rule bg-[#fafafa] px-2 py-1 font-mono text-[10px] text-ink-muted">
                      {item}
                    </span>
                  ))}
                </div>
              </article>
            </div>

            <article className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <SectionTitle icon={Braces} title="因子映射" right="document → factor" />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-[6px] border border-rule bg-[#fafafa] px-2 py-1 font-mono text-[10px] text-ink-muted">
                    用户因子库 {customFactors.length}
                  </span>
                  {factorCandidates.length > 0 && (
                    <button
                      type="button"
                      onClick={addAllCustomFactors}
                      className="inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-ink px-3 font-mono text-[11px] text-white"
                    >
                      <LibraryBig className="size-3.5" aria-hidden />
                      全部加入因子库 {factorCandidates.length}
                    </button>
                  )}
                </div>
              </div>
              {factorCandidates.length > 0 && (
                <div className="mt-4 rounded-[7px] border border-rule bg-[#fafafa] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
                      <LibraryBig className="size-4" aria-hidden />
                      可生成自定义因子
                    </p>
                    <span className="font-mono text-[10px] text-ink-faint">factor draft → factor library</span>
                  </div>
                  <div className="mt-3 grid gap-2 lg:grid-cols-2">
                    {factorCandidates.map((factor) => (
                      <div key={factor.id} className="rounded-[7px] border border-rule bg-white px-3 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[14px] font-semibold text-ink">{factor.name}</p>
                            <p className="mt-1 font-mono text-[10px] leading-4 text-ink-muted">{factor.formula}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => addCustomFactor(factor)}
                            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[6px] border border-ink bg-ink px-3 font-mono text-[11px] text-white"
                          >
                            <PlusCircle className="size-3.5" aria-hidden />
                            加入
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-4 grid gap-2">
                {result.draft.factorMap.map((mapping, index) => {
                  const candidate = factorCandidates.find((factor) =>
                    factor.sourceText === mapping.sourceText || factor.name === mapping.factorName,
                  )
                  return (
                    <FactorRow
                      key={`${mapping.factorId ?? mapping.factorName}-${index}`}
                      mapping={mapping}
                      candidate={candidate}
                      onAdd={candidate ? () => addCustomFactor(candidate) : undefined}
                    />
                  )
                })}
              </div>
            </article>

            <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_420px]">
              <article className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
                <div className="flex items-center justify-between gap-3">
                  <SectionTitle icon={Braces} title="策略 DSL" right={result.draft.dsl.frequency} />
                  <button
                    type="button"
                    onClick={copyDsl}
                    className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-rule bg-[#fafafa] px-3 font-mono text-[11px] text-ink-muted hover:text-ink"
                  >
                    <Clipboard className="size-3.5" aria-hidden />
                    {copied ? "已复制" : "复制"}
                  </button>
                </div>
                <pre className="mt-4 overflow-x-auto rounded-[7px] border border-rule bg-[#111] p-4 font-mono text-[12px] leading-6 text-white">
                  {dslText}
                </pre>
              </article>

              <article className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
                <SectionTitle icon={Play} title="下一步" right="SOP" />
                <ol className="mt-4 space-y-2">
                  {result.draft.nextSteps.map((step, index) => (
                    <li key={step} className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
                      <span className="font-mono text-[10px] text-ink-faint">{String(index + 1).padStart(2, "0")}</span>
                      <p className="mt-1 text-[13px] leading-5 text-ink-muted">{step}</p>
                    </li>
                  ))}
                </ol>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={goToBacktest}
                    disabled={sendingBacktest}
                    className="rounded-[7px] bg-ink px-3 py-2 text-center font-mono text-[12px] text-white disabled:opacity-50"
                  >
                    {sendingBacktest ? "提交中" : "入库并真实回测"}
                  </button>
                  <Link href="/strategies" className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 text-center font-mono text-[12px] text-ink-muted">
                    看策略目录
                  </Link>
                </div>
              </article>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function EmptyState() {
  return (
    <section className="rounded-[7px] border border-rule bg-white px-4 py-12 text-center md:px-5">
      <Search className="mx-auto size-8 text-ink-muted" aria-hidden />
      <h2 className="mt-4 text-[22px] font-semibold text-ink">从市场现象生成策略草稿</h2>
      <p className="mx-auto mt-2 max-w-[560px] text-[14px] leading-6 text-ink-muted">
        输入上涨样本、盘口文字、新闻线索或截图，AI 会先提炼假设和数据缺口，再生成因子映射、策略 DSL 和回测准备清单。
      </p>
    </section>
  )
}

function MarketResearchPanel({ research }: { research: NonNullable<StrategyDraft["research"]> }) {
  const sampleCount = research.samples.length
  return (
    <article className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <Search className="size-4" aria-hidden />
            AI Research
          </p>
          <h3 className="mt-2 text-[20px] font-semibold text-ink">市场现象研究</h3>
          <p className="mt-2 max-w-[860px] text-[13px] leading-6 text-ink-muted">{research.strategyThesis}</p>
        </div>
        <span className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 font-mono text-[11px] text-ink-muted">
          {research.mode === "market-observation" ? "phenomenon" : "document"} · {sampleCount} samples
        </span>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="rounded-[7px] border border-rule bg-[#fafafa] p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="font-mono text-[11px] text-ink-muted">样本识别</p>
            <span className="font-mono text-[10px] text-ink-faint">{sampleCount || "待补充"} 个</span>
          </div>
          <div className="grid gap-2">
            {research.samples.map((sample) => (
              <div key={`${sample.symbol}-${sample.name}`} className="rounded-[7px] border border-rule bg-white px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold text-ink">{sample.name}</p>
                    <p className="mt-1 font-mono text-[11px] text-ink-muted">{sample.symbol}</p>
                  </div>
                  <span className="shrink-0 font-mono text-[12px] text-bull">{sample.move}</span>
                </div>
                <p className="mt-2 text-[12px] leading-5 text-ink-muted">{sample.evidence.join(" / ")}</p>
              </div>
            ))}
            {research.samples.length === 0 && (
              <div className="rounded-[7px] border border-rule bg-white px-3 py-6 text-center text-[13px] text-ink-muted">
                还没有明确股票代码；补充“股票名 + 代码 + 涨幅/时间”后，AI 能更准确提炼共同因子。
              </div>
            )}
          </div>
        </div>

        <div className="rounded-[7px] border border-rule bg-[#fafafa] p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="font-mono text-[11px] text-ink-muted">上涨原因假设</p>
            <span className="font-mono text-[10px] text-ink-faint">hypothesis → factor</span>
          </div>
          <div className="grid gap-2">
            {research.hypotheses.map((item) => (
              <div key={item.title} className="rounded-[7px] border border-rule bg-white px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[14px] font-semibold text-ink">{item.title}</p>
                  <span className="font-mono text-[12px] text-ink">{Math.round(item.confidence * 100)}%</span>
                </div>
                <p className="mt-2 text-[12px] leading-5 text-ink-muted">{item.evidence.join(" / ")}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {item.factorIds.map((id) => (
                    <span key={id} className="rounded-[5px] border border-rule bg-[#fafafa] px-2 py-1 font-mono text-[10px] text-ink-muted">
                      {id}
                    </span>
                  ))}
                </div>
                <p className="mt-3 rounded-[6px] border border-rule bg-[#fafafa] px-2 py-2 text-[12px] leading-5 text-ink-muted">
                  验证：{item.test}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-[7px] border border-rule bg-[#fafafa] p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="font-mono text-[11px] text-ink-muted">数据缺口</p>
          <span className="font-mono text-[10px] text-ink-faint">Qveris readiness</span>
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {research.dataGaps.map((gap) => (
            <div key={`${gap.data}-${gap.qverisQuery}`} className="rounded-[7px] border border-rule bg-white px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[13px] font-semibold text-ink">{gap.data}</p>
                <span className={`rounded-[5px] border px-1.5 py-0.5 font-mono text-[10px] ${dataGapClass(gap.status)}`}>
                  {gap.status}
                </span>
              </div>
              <p className="mt-2 text-[12px] leading-5 text-ink-muted">{gap.reason}</p>
              <p className="mt-2 truncate font-mono text-[10px] text-ink-faint">{gap.qverisQuery}</p>
            </div>
          ))}
        </div>
      </div>
    </article>
  )
}

function dataGapClass(status: NonNullable<StrategyDraft["research"]>["dataGaps"][number]["status"]) {
  if (status === "available") return "border-[#c8ead2] bg-[#e7f4eb] text-health-ok"
  if (status === "partial") return "border-[#ecd9b6] bg-[#fff8e7] text-warning"
  return "border-[#f0cbc6] bg-[#fae8e6] text-bear"
}

function Readiness({ readiness }: { readiness: StrategyDraft["backtestReadiness"] }) {
  return (
    <div className="min-w-[150px] rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2">
      <p className="font-mono text-[10px] text-ink-muted">回测准备度</p>
      <p className={`mt-1 font-mono text-[24px] ${readiness.ready ? "text-health-ok" : "text-warning"}`}>
        {readiness.score}
      </p>
      <p className="font-mono text-[10px] text-ink-faint">{readiness.ready ? "ready" : "needs review"}</p>
    </div>
  )
}

function MiniSpec({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className="mt-1 truncate text-[13px] font-medium text-ink">{value}</p>
    </div>
  )
}

function SectionTitle({
  icon: Icon,
  title,
  right,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  title: string
  right?: string
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-[17px] font-semibold text-ink">
        <Icon className="size-4 text-ink-muted" aria-hidden />
        {title}
      </h3>
      {right && <span className="font-mono text-[10px] text-ink-muted">{right}</span>}
    </div>
  )
}

function RuleBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] p-3">
      <p className="font-mono text-[11px] text-ink-muted">{title}</p>
      <ul className="mt-2 space-y-2">
        {items.map((item) => (
          <li key={item} className="text-[13px] leading-5 text-ink-muted">
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

function FactorRow({
  mapping,
  candidate,
  onAdd,
}: {
  mapping: StrategyFactorMapping
  candidate?: CustomFactor
  onAdd?: () => void
}) {
  const statusClass =
    mapping.status === "mapped"
      ? "text-health-ok"
      : mapping.status === "proxy"
        ? "text-warning"
        : "text-bear"

  const canAdd = Boolean(candidate && onAdd)

  return (
    <div className="grid gap-3 rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3 lg:grid-cols-[minmax(0,1fr)_180px_120px_150px] lg:items-center">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] text-ink-faint">{mapping.sourceText}</span>
          <span className={`rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] ${statusClass}`}>
            {mapping.status}
          </span>
        </div>
        <p className="mt-1 text-[14px] font-semibold text-ink">{mapping.factorName}</p>
        <p className="mt-1 text-[12px] leading-5 text-ink-muted">{mapping.note}</p>
        {candidate && (
          <p className="mt-2 rounded-[6px] border border-rule bg-white px-2 py-1 font-mono text-[10px] leading-4 text-ink-muted">
            生成公式：{candidate.formula}
          </p>
        )}
      </div>
      <p className="font-mono text-[11px] text-ink-muted">{mapping.factorId ?? "missing"}</p>
      <p className="font-mono text-[18px] text-ink">{Math.round(mapping.confidence * 100)}%</p>
      <div className="lg:text-right">
        {canAdd ? (
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-ink bg-ink px-3 font-mono text-[11px] text-white"
          >
            <PlusCircle className="size-3.5" aria-hidden />
            加入因子库
          </button>
        ) : mapping.factorId ? (
          <span className="inline-flex h-8 items-center rounded-[6px] border border-rule bg-white px-3 font-mono text-[11px] text-health-ok">
            已可引用
          </span>
        ) : (
          <span className="inline-flex h-8 items-center rounded-[6px] border border-rule bg-white px-3 font-mono text-[11px] text-ink-faint">
            待定义
          </span>
        )}
      </div>
    </div>
  )
}

async function compressImageFile(file: File) {
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await loadImage(objectUrl)
    const maxSide = 1400
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight))
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d")
    if (!context) throw new Error("canvas unavailable")
    context.drawImage(image, 0, 0, width, height)
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82)
    if (dataUrl.length > 2_700_000) {
      return canvas.toDataURL("image/jpeg", 0.68)
    }
    return dataUrl
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("image load failed"))
    image.src = src
  })
}
